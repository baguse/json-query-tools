const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runReusePanelTests() {
  console.log('Testing Query Editor webview panel reuse...');

  global.__mockPanelCount = 0;
  global.__mockPanels = [];
  global.__mockRevealCount = 0;
  global.__mockRevealedColumns = [];

  class MockWebviewPanel {
    constructor(viewType, title, column, options) {
      this.viewType = viewType;
      this.title = title;
      this.viewColumn = column;
      this.options = options;
      this.disposed = false;
      this._disposeListeners = [];
      this._messageListeners = [];
      this.webview = {
        html: '',
        postMessage: () => {},
        onDidReceiveMessage: (fn) => {
          this._messageListeners.push(fn);
        }
      };
      global.__mockPanelCount++;
      global.__mockPanels.push(this);
    }

    reveal(column) {
      global.__mockRevealCount++;
      global.__mockRevealedColumns.push(column);
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
                  activeTextEditor: undefined,
                  visibleTextEditors: [],
                  createWebviewPanel: (viewType, title, column, options) => {
                    return new global.__MockWebviewPanel(viewType, title, column, options);
                  },
                  showErrorMessage: () => {},
                  showWarningMessage: async () => {},
                  showInformationMessage: () => {}
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

  const { commandOpenQueryEditor, getCurrentPanel, setCurrentPanel } = mod.exports;

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

  // 1. Initial State: no panel exists
  assert.strictEqual(getCurrentPanel(), undefined);
  assert.strictEqual(global.__mockPanelCount, 0);
  console.log('  ✓ Initial panel state is undefined');

  // 2. First call: creates a new webview panel
  await commandOpenQueryEditor(mockContext);
  assert.strictEqual(global.__mockPanelCount, 1, 'Should create exactly 1 panel on first launch');
  const firstPanel = getCurrentPanel();
  assert.ok(firstPanel instanceof MockWebviewPanel, 'currentPanel should be the newly created panel');
  assert.strictEqual(firstPanel.title, 'JSON Tools — Query Editor');
  assert.strictEqual(global.__mockRevealCount, 0, 'reveal() should not be called when creating first panel');
  console.log('  ✓ First call creates a new WebviewPanel and tracks it as currentPanel');

  // 3. Second call: reuses existing panel and calls reveal()
  await commandOpenQueryEditor(mockContext);
  assert.strictEqual(global.__mockPanelCount, 1, 'Should NOT create another panel');
  assert.strictEqual(global.__mockRevealCount, 1, 'Should reveal the existing panel');
  assert.strictEqual(getCurrentPanel(), firstPanel, 'currentPanel should remain the same instance');
  console.log('  ✓ Subsequent call reuses existing panel and calls reveal() without creating duplicate tabs');

  // 4. Third call: continues to reuse the same panel
  await commandOpenQueryEditor(mockContext);
  assert.strictEqual(global.__mockPanelCount, 1, 'Still only 1 panel created');
  assert.strictEqual(global.__mockRevealCount, 2, 'Should reveal existing panel again');
  console.log('  ✓ Multiple repeated calls continue reusing the active panel');

  // 5. Dispose panel: currentPanel resets to undefined
  firstPanel.dispose();
  assert.strictEqual(getCurrentPanel(), undefined, 'Disposing the panel should clear currentPanel');
  console.log('  ✓ Disposing the panel resets currentPanel to undefined');

  // 6. Next call after disposal: creates a new panel
  await commandOpenQueryEditor(mockContext);
  assert.strictEqual(global.__mockPanelCount, 2, 'Should create a new panel after previous was disposed');
  const secondPanel = getCurrentPanel();
  assert.ok(secondPanel instanceof MockWebviewPanel);
  assert.notStrictEqual(secondPanel, firstPanel, 'New panel should be a fresh instance');
  console.log('  ✓ Opening editor after disposal creates a fresh WebviewPanel');

  // Clean up
  secondPanel.dispose();
  assert.strictEqual(getCurrentPanel(), undefined);

  console.log('\n✅ All Query Editor Panel Reuse tests passed successfully!');
}

runReusePanelTests().catch(err => {
  console.error('Fatal error during panel reuse tests:', err);
  process.exit(1);
});
