const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');
const vm = require('vm');

async function main() {
  console.log('Testing Side-by-Side Diff View (Feature 3.7)...');

  // 1. Bundle diff.ts and commands.ts in memory with virtual vscode mock
  let executedCommands = [];
  let showWarningMessages = [];
  let showInfoMessages = [];
  let registeredProviders = new Map();

  const mockVscode = {
    Uri: {
      from: (components) => ({
        scheme: components.scheme,
        path: components.path,
        toString: () => `${components.scheme}:${components.path}`
      }),
      parse: (val) => {
        const parts = val.split(':');
        return {
          scheme: parts[0],
          path: parts.slice(1).join(':'),
          toString: () => val
        };
      }
    },
    EventEmitter: class {
      constructor() {
        this.listeners = [];
        this.event = (listener) => {
          this.listeners.push(listener);
          return { dispose: () => {} };
        };
      }
      fire(data) {
        for (const l of this.listeners) l(data);
      }
      dispose() {
        this.listeners = [];
      }
    },
    workspace: {
      asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json'),
      registerTextDocumentContentProvider: (scheme, provider) => {
        registeredProviders.set(scheme, provider);
        return { dispose: () => registeredProviders.delete(scheme) };
      }
    },
    window: {
      showWarningMessage: (msg) => {
        showWarningMessages.push(msg);
        return Promise.resolve();
      },
      showInformationMessage: (msg) => {
        showInfoMessages.push(msg);
        return Promise.resolve();
      },
      showErrorMessage: (msg) => Promise.resolve()
    },
    commands: {
      executeCommand: (cmd, ...args) => {
        executedCommands.push({ cmd, args });
        return Promise.resolve();
      }
    }
  };

  const diffBundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/diff.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
    external: ['vscode']
  });

  const diffMod = { exports: {} };
  const diffFn = new Function('module', 'exports', 'require', '__dirname', diffBundle.outputFiles[0].text);
  const customRequire = (id) => {
    if (id === 'vscode') return mockVscode;
    return require(id);
  };
  diffFn(diffMod, diffMod.exports, customRequire, path.join(__dirname, '../src'));

  const {
    JsonDiffProvider,
    DIFF_SCHEME,
    sanitizeDiffName,
    getDiffUris,
    showJsonDiff
  } = diffMod.exports;

  // 2. Validate DIFF_SCHEME constant
  assert.strictEqual(DIFF_SCHEME, 'json-query-diff', 'DIFF_SCHEME must be json-query-diff');
  console.log('✔ DIFF_SCHEME is defined as json-query-diff');

  // 3. Test sanitizeDiffName
  assert.strictEqual(sanitizeDiffName('users.json'), 'users.json');
  assert.strictEqual(sanitizeDiffName('/workspace/data/users.json'), 'users.json');
  assert.strictEqual(sanitizeDiffName('C:\\project\\data\\customers.json'), 'customers.json');
  assert.strictEqual(sanitizeDiffName('https://api.example.com/v1/orders'), 'orders');
  assert.strictEqual(sanitizeDiffName('invalid:name*with?chars'), 'invalid_name_with_chars');
  assert.strictEqual(sanitizeDiffName(''), 'Original');
  assert.strictEqual(sanitizeDiffName(null), 'Original');
  console.log('✔ sanitizeDiffName correctly normalizes file names, URLs, Windows paths, and special characters');

  // 4. Test getDiffUris
  const uris = getDiffUris('users.json');
  assert.strictEqual(uris.leftUri.scheme, 'json-query-diff');
  assert.strictEqual(uris.leftUri.path, '/users.json (Original).json');
  assert.strictEqual(uris.rightUri.scheme, 'json-query-diff');
  assert.strictEqual(uris.rightUri.path, '/Transformed Result.json');
  assert.strictEqual(uris.title, 'users.json (Original) ↔ Transformed Result');
  console.log('✔ getDiffUris builds proper virtual document URIs and comparison title');

  // 5. Test JsonDiffProvider
  const provider = new JsonDiffProvider();
  let changeFiredUri = null;
  provider.onDidChange((u) => {
    changeFiredUri = u;
  });

  const testUri = uris.leftUri;
  assert.strictEqual(provider.provideTextDocumentContent(testUri), '');
  provider.setContent(testUri, '{"id": 1}');
  assert.strictEqual(provider.provideTextDocumentContent(testUri), '{"id": 1}');
  assert.strictEqual(changeFiredUri, testUri);
  console.log('✔ JsonDiffProvider stores virtual content and notifies onDidChange listeners');

  // 6. Test showJsonDiff
  const originalData = { id: 1, name: 'Alice', active: true };
  const resultData = [{ id: 1, name: 'Alice', status: 'verified' }];

  executedCommands = [];
  await showJsonDiff(provider, {
    sourceName: 'users.json',
    originalData,
    resultData
  });

  assert.strictEqual(executedCommands.length, 1);
  const diffCmd = executedCommands[0];
  assert.strictEqual(diffCmd.cmd, 'vscode.diff');
  assert.strictEqual(diffCmd.args[0].path, '/users.json (Original).json');
  assert.strictEqual(diffCmd.args[1].path, '/Transformed Result.json');
  assert.strictEqual(diffCmd.args[2], 'users.json (Original) ↔ Transformed Result');
  assert.deepStrictEqual(diffCmd.args[3], { preview: false });

  // Verify formatted JSON contents in provider
  const storedOriginal = provider.provideTextDocumentContent(diffCmd.args[0]);
  const storedResult = provider.provideTextDocumentContent(diffCmd.args[1]);
  assert.strictEqual(storedOriginal, JSON.stringify(originalData, null, 2) + '\n');
  assert.strictEqual(storedResult, JSON.stringify(resultData, null, 2) + '\n');
  console.log('✔ showJsonDiff formats original and result as 2-space indented JSON and calls vscode.diff');

  // Test showJsonDiff with pre-formatted text and primitives
  await showJsonDiff(provider, {
    sourceName: 'calc',
    originalText: '100\n',
    resultText: '200\n'
  });
  assert.strictEqual(executedCommands.length, 2);
  const lastDiff = executedCommands[1];
  assert.strictEqual(provider.provideTextDocumentContent(lastDiff.args[0]), '100\n');
  assert.strictEqual(provider.provideTextDocumentContent(lastDiff.args[1]), '200\n');
  console.log('✔ showJsonDiff cleanly handles primitive values and explicit text');

  provider.dispose();

  // 7. Validate package.json command and activation registration
  const pkg = require('../package.json');
  const diffCommandEntry = pkg.contributes.commands.find(c => c.command === 'jsonQueryTools.diffResult');
  assert(diffCommandEntry, 'Missing jsonQueryTools.diffResult command in package.json');
  assert(pkg.activationEvents.includes('onCommand:jsonQueryTools.diffResult'), 'Missing onCommand:jsonQueryTools.diffResult in activationEvents');
  console.log('✔ package.json registers jsonQueryTools.diffResult command and activationEvent');

  // 8. Validate Webview HTML elements and script syntax
  const htmlModResult = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/webview/html.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            contents: `module.exports = { workspace: { asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json') } };`,
            loader: 'js'
          }));
        }
      }
    ]
  });

  const webviewMod = { exports: {} };
  const webviewFn = new Function('module', 'exports', 'require', '__dirname', htmlModResult.outputFiles[0].text);
  webviewFn(webviewMod, webviewMod.exports, require, path.join(__dirname, '../src/webview'));

  const { getQueryEditorHtml } = webviewMod.exports;
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, { scriptNonce: 'test-diff-nonce' });

  assert(html.includes('id="diffResultBtn"'), 'Missing #diffResultBtn in result toolbar');
  assert(html.includes('id="diffInspectWithResultBtn"'), 'Missing #diffInspectWithResultBtn in inspection modal');
  console.log('✔ Webview HTML contains #diffResultBtn in toolbar and #diffInspectWithResultBtn in modal');

  const scriptMatch = html.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'Missing <script> in webview HTML');
  new vm.Script(scriptMatch[1], { filename: 'test_diff_script.js' });
  console.log('✔ Webview script compiles without syntax errors');

  console.log('\nAll Side-by-Side Diff View tests passed successfully! 🚀');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
