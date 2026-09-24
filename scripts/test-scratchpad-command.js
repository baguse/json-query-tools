const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runScratchpadCommandTests() {
  console.log('Testing Standalone Scratchpad Mode commands and UI integration...');

  global.__mockPanelCount = 0;
  global.__mockPanels = [];
  global.__mockRevealCount = 0;
  global.__mockActiveEditor = null;
  global.__mockInfoMessages = [];

  class MockWebviewPanel {
    constructor(viewType, title, column, options) {
      this.viewType = viewType;
      this.title = title;
      this.viewColumn = column;
      this.options = options;
      this.disposed = false;
      this._disposeListeners = [];
      this._messageListeners = [];
      this.postedMessages = [];
      this.webview = {
        html: '',
        postMessage: (msg) => {
          this.postedMessages.push(msg);
        },
        onDidReceiveMessage: (fn) => {
          this._messageListeners.push(fn);
        }
      };
      global.__mockPanelCount++;
      global.__mockPanels.push(this);
    }

    reveal(column) {
      global.__mockRevealCount++;
    }

    onDidDispose(fn) {
      this._disposeListeners.push(fn);
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const listener of this._disposeListeners) {
        listener();
      }
    }

    async simulateMessage(msg) {
      for (const listener of this._messageListeners) {
        await listener(msg);
      }
    }
  }

  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/commands.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({
            path: 'vscode',
            namespace: 'mock-vscode'
          }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            contents: `
              module.exports = {
                window: {
                  get activeTextEditor() {
                    return global.__mockActiveEditor;
                  },
                  visibleTextEditors: [],
                  createWebviewPanel: (viewType, title, column, options) => {
                    return new global.__MockWebviewPanel(viewType, title, column, options);
                  },
                  showErrorMessage: () => {},
                  showWarningMessage: async () => {},
                  showInformationMessage: (msg) => { global.__mockInfoMessages.push(msg); }
                },
                workspace: {
                  asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json'),
                  getConfiguration: () => ({ get: () => ({}) }),
                  getWorkspaceFolder: () => undefined,
                  workspaceFolders: []
                },
                ViewColumn: { One: 1, Beside: 2 },
                Uri: {
                  file: (p) => ({ fsPath: p, scheme: 'file', path: p }),
                  parse: (s) => ({ fsPath: s, scheme: 'file', toString: () => s })
                }
              };
            `,
            loader: 'js'
          }));
        }
      }
    ]
  });

  global.__MockWebviewPanel = MockWebviewPanel;

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const {
    commandOpenQueryEditor,
    commandOpenScratchpad,
    getCurrentPanel,
    setCurrentPanel,
    evaluateExpression
  } = mod.exports;

  const mockContext = {
    globalState: {
      get: () => [],
      update: async () => {}
    },
    workspaceState: {
      get: () => undefined,
      update: async () => {}
    },
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {}
    }
  };

  // 1. Open Scratchpad directly when an active JSON editor is focused
  global.__mockActiveEditor = {
    document: {
      uri: { fsPath: '/test/active.json' },
      languageId: 'json'
    }
  };

  await commandOpenScratchpad(mockContext);
  assert.strictEqual(global.__mockPanelCount, 1);
  const panel = getCurrentPanel();
  assert.ok(panel, 'Should have instantiated a webview panel');
  assert.strictEqual(panel.title, 'JSON Tools — JS Scratchpad', 'Title should indicate JS Scratchpad mode');
  
  // Verify that active JSON editor was NOT bound as source in standalone mode
  await panel.simulateMessage({ type: 'ready' });
  const updateTargetsMsg = panel.postedMessages.find(m => m.type === 'updateTargets');
  assert.ok(updateTargetsMsg, 'Should send updateTargets to webview');
  assert.deepStrictEqual(updateTargetsMsg.sources, [], 'Sources should be empty in scratchpad mode');
  console.log('  ✓ commandOpenScratchpad creates panel with empty sources and Scratchpad title');

  // 2. Rebind button rebinds active editor and updates title back to Query Editor
  await panel.simulateMessage({ type: 'rebind' });
  assert.strictEqual(panel.title, 'JSON Tools — Query Editor', 'Rebinding should change title to Query Editor');
  const reboundTargetsMsg = [...panel.postedMessages].reverse().find(m => m.type === 'updateTargets');
  assert.strictEqual(reboundTargetsMsg.sources.length, 1);
  assert.strictEqual(reboundTargetsMsg.sources[0].alias, 'data');
  console.log('  ✓ Rebinding active file updates title back to Query Editor and populates sources');

  // 3. Webview switchToScratchpad action switches back to Standalone Scratchpad
  global.__mockInfoMessages = [];
  await panel.simulateMessage({ type: 'switchToScratchpad' });
  assert.strictEqual(panel.title, 'JSON Tools — JS Scratchpad', 'Title should update to JS Scratchpad');
  const scratchpadTargetsMsg = [...panel.postedMessages].reverse().find(m => m.type === 'updateTargets');
  assert.deepStrictEqual(scratchpadTargetsMsg.sources, []);
  assert.ok(global.__mockInfoMessages.some(m => m.includes('Standalone Scratchpad Mode')));
  console.log('  ✓ switchToScratchpad clears all sources and updates title to JS Scratchpad');

  // 4. Calling commandOpenScratchpad while panel is open in Query Editor mode switches it to scratchpad
  await panel.simulateMessage({ type: 'rebind' });
  assert.strictEqual(panel.title, 'JSON Tools — Query Editor');
  await commandOpenScratchpad(mockContext);
  assert.strictEqual(global.__mockPanelCount, 1, 'Should reuse existing panel');
  assert.strictEqual(panel.title, 'JSON Tools — JS Scratchpad', 'Should switch existing panel to JS Scratchpad');
  console.log('  ✓ commandOpenScratchpad switches existing open panel into scratchpad mode');

  // 5. Clean disposal
  panel.dispose();
  assert.strictEqual(getCurrentPanel(), undefined);

  // 6. Test Scratchpad evaluation expressions
  const mockGen = evaluateExpression([], {}, 'return Array.from({length: 4}, (_, i) => ({ id: i + 1, active: i % 2 === 0 }));');
  assert.deepStrictEqual(mockGen, [
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true },
    { id: 4, active: false }
  ]);
  console.log('  ✓ Scratchpad: mock array generator expression evaluates accurately');

  const mathRes = evaluateExpression([], {}, 'Math.hypot(3, 4) * 10');
  assert.strictEqual(mathRes, 50);
  console.log('  ✓ Scratchpad: math expression evaluates accurately');

  const regexRes = evaluateExpression([], {}, 'return /^[a-z0-9_-]+$/i.test("my-test_identifier123");');
  assert.strictEqual(regexRes, true);
  console.log('  ✓ Scratchpad: regex testing expression evaluates accurately');

  console.log('\n✅ All Standalone Scratchpad Mode tests passed successfully!');
}

runScratchpadCommandTests().catch(err => {
  console.error('Fatal error during scratchpad command tests:', err);
  process.exit(1);
});
