const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runCommandTransformTests() {
  console.log('Testing commandTransformWithExpression security and error handling...');

  // Set up mock state
  global.__mockActiveUri = null;
  global.__mockInputBoxValue = null;
  global.__mockWarningChoice = null;
  global.__mockErrorMessages = [];
  global.__mockWarningMessages = [];
  global.__mockOpenedDocs = [];
  global.__mockHistory = [];

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
                    return global.__mockActiveUri ? { document: { uri: global.__mockActiveUri, languageId: 'json' } } : undefined;
                  },
                  visibleTextEditors: [],
                  showErrorMessage: (msg) => { global.__mockErrorMessages.push(msg); },
                  showWarningMessage: async (msg, opts, ...items) => {
                    global.__mockWarningMessages.push({ msg, opts, items });
                    return global.__mockWarningChoice;
                  },
                  showInputBox: async () => global.__mockInputBoxValue,
                  showTextDocument: async (doc) => {}
                },
                workspace: {
                  asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json'),
                  getConfiguration: () => ({ get: () => ({}) }),
                  getWorkspaceFolder: () => undefined,
                  workspaceFolders: [],
                  openTextDocument: async (arg) => {
                    if (arg && arg.content !== undefined) {
                      global.__mockOpenedDocs.push(arg);
                      return arg;
                    }
                    // Opening file by URI
                    return {
                      getText: () => JSON.stringify([{ id: 1, name: 'Sample' }])
                    };
                  },
                  fs: {
                    readFile: async () => Buffer.from('[]')
                  }
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

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { commandTransformWithExpression } = mod.exports;

  const mockContext = {
    globalState: {
      get: () => global.__mockHistory,
      update: async (k, v) => { global.__mockHistory = v; }
    }
  };

  // 1. Missing target file
  global.__mockActiveUri = null;
  global.__mockErrorMessages = [];
  await commandTransformWithExpression(mockContext);
  assert.strictEqual(global.__mockErrorMessages.length, 1);
  assert.ok(global.__mockErrorMessages[0].includes('Open a JSON file first'));
  console.log('  ✓ Missing JSON file displays error message');

  // 2. Canceled input box
  global.__mockActiveUri = { fsPath: '/test/sample.json', path: '/test/sample.json' };
  global.__mockInputBoxValue = undefined;
  global.__mockErrorMessages = [];
  await commandTransformWithExpression(mockContext);
  assert.strictEqual(global.__mockErrorMessages.length, 0);
  console.log('  ✓ Canceled input returns cleanly without errors');

  // 3. Security Warning: Dangerous expression blocked when dismissed
  global.__mockActiveUri = { fsPath: '/test/sample.json', path: '/test/sample.json' };
  global.__mockInputBoxValue = 'require("child_process").execSync("whoami")';
  global.__mockWarningChoice = undefined; // User cancels/dismisses modal
  global.__mockWarningMessages = [];
  global.__mockOpenedDocs = [];

  await commandTransformWithExpression(mockContext);
  assert.strictEqual(global.__mockWarningMessages.length, 1);
  assert.ok(global.__mockWarningMessages[0].msg.includes('Security Warning'));
  assert.strictEqual(global.__mockOpenedDocs.length, 0, 'Must not execute or open doc when security warning dismissed');
  console.log('  ✓ Dangerous expression triggers security warning and blocks execution when dismissed');

  // 4. Security Warning: Execution proceeds when user confirms 'Run Anyway'
  global.__mockWarningChoice = 'Run Anyway';
  global.__mockInputBoxValue = 'require("os").platform()'; // Matches os pattern
  global.__mockWarningMessages = [];
  global.__mockOpenedDocs = [];

  await commandTransformWithExpression(mockContext);
  assert.strictEqual(global.__mockWarningMessages.length, 1);
  assert.strictEqual(global.__mockOpenedDocs.length, 1, 'Executes when user explicitly confirms Run Anyway');
  console.log('  ✓ Dangerous expression executes when user confirms "Run Anyway"');

  // 5. Error handling on evaluation / runtime error
  global.__mockInputBoxValue = 'data.nonExistentProperty.map(x => x)';
  global.__mockErrorMessages = [];
  global.__mockOpenedDocs = [];

  // Must not throw unhandled rejection
  await commandTransformWithExpression(mockContext);
  assert.strictEqual(global.__mockErrorMessages.length, 1);
  assert.ok(
    global.__mockErrorMessages[0].includes('Failed to transform with expression:'),
    'Expected user-friendly error message on eval failure'
  );
  assert.strictEqual(global.__mockOpenedDocs.length, 0);
  console.log('  ✓ Runtime evaluation errors are caught and surfaced via showErrorMessage');

  // 6. Normal successful transform
  global.__mockInputBoxValue = 'data.map(x => ({ ...x, processed: true }))';
  global.__mockErrorMessages = [];
  global.__mockOpenedDocs = [];

  await commandTransformWithExpression(mockContext);
  assert.strictEqual(global.__mockErrorMessages.length, 0);
  assert.strictEqual(global.__mockOpenedDocs.length, 1);
  const resultData = JSON.parse(global.__mockOpenedDocs[0].content);
  assert.deepStrictEqual(resultData, [{ id: 1, name: 'Sample', processed: true }]);
  console.log('  ✓ Valid expression transforms data and opens new editor tab');

  console.log('\n✅ All commandTransformWithExpression tests passed successfully!');
}

runCommandTransformTests().catch(err => {
  console.error('Fatal error during command-transform tests:', err);
  process.exit(1);
});
