const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const vm = require('vm');

async function runCsvTests() {
  console.log('Testing CSV generation and escaping...');

  // Bundle html.ts in memory with mock vscode
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/webview/html.ts')],
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
                workspace: {
                  asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json')
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
  fn(mod, mod.exports, require, path.join(__dirname, '../src/webview'));

  const { getQueryEditorHtml } = mod.exports;
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce',
    sources: []
  });

  // Extract script containing escapeCsvCell and generateCsv
  const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  let targetScript = null;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].includes('function escapeCsvCell') && match[1].includes('function generateCsv')) {
      targetScript = match[1];
      break;
    }
  }

  assert(targetScript, 'Could not find script containing escapeCsvCell and generateCsv in webview HTML');

  // Create sandbox environment to run generateCsv
  const sandbox = {
    acquireVsCodeApi: () => ({
      postMessage: () => {},
      getState: () => ({}),
      setState: () => {}
    }),
    document: {
      getElementById: () => ({ addEventListener: () => {}, style: {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
      addEventListener: () => {}
    },
    window: {
      addEventListener: () => {}
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {}
    },
    CodeMirror: {},
    js_beautify: () => '',
    acorn: {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    resultTableHead: null,
    resultTableBody: null,
    console
  };
  vm.createContext(sandbox);

  // Evaluate definitions in sandbox
  vm.runInContext(targetScript, sandbox);

  // Retrieve functions from sandbox
  const generateCsv = sandbox.generateCsv;
  const escapeCsvCell = sandbox.escapeCsvCell;

  assert.strictEqual(typeof generateCsv, 'function', 'generateCsv is not a function');
  assert.strictEqual(typeof escapeCsvCell, 'function', 'escapeCsvCell is not a function');

  // 1. Test escapeCsvCell unit cases
  assert.strictEqual(escapeCsvCell('simple'), 'simple');
  assert.strictEqual(escapeCsvCell('hello, world'), '"hello, world"');
  assert.strictEqual(escapeCsvCell('he said "yes"'), '"he said ""yes"""');
  assert.strictEqual(escapeCsvCell('multi\nline'), '"multi\nline"');
  assert.strictEqual(escapeCsvCell('multi\r\nline'), '"multi\r\nline"');
  assert.strictEqual(escapeCsvCell(null), '');
  assert.strictEqual(escapeCsvCell(undefined), '');
  assert.strictEqual(escapeCsvCell(123), '123');
  assert.strictEqual(escapeCsvCell(false), 'false');
  console.log('  ✓ escapeCsvCell handles quotes, commas, newlines, and nulls properly');

  // 2. Test generateCsv with array of objects containing special characters
  const sampleData = [
    { name: 'Doe, John', occupation: 'Engineer "Senior"', bio: 'Line 1\nLine 2', age: 30 },
    { name: 'Smith, Jane', occupation: 'Designer', bio: 'Simple bio', age: 25 },
    { name: 'Null, Test', occupation: null, bio: undefined, age: 40 }
  ];

  const csv = generateCsv(sampleData);
  const expectedRows = [
    'name,occupation,bio,age',
    '"Doe, John","Engineer ""Senior""","Line 1\nLine 2",30',
    '"Smith, Jane",Designer,Simple bio,25',
    '"Null, Test",,,40'
  ];
  assert.strictEqual(csv, expectedRows.join('\n'));
  console.log('  ✓ generateCsv outputs RFC 4180 compliant CSV for objects with commas, quotes, and newlines');

  // 3. Test generateCsv with array of primitives
  const primitives = ['item 1', 'item, with comma', 'item with "quotes"'];
  const primCsv = generateCsv(primitives);
  const expectedPrim = [
    'Value',
    'item 1',
    '"item, with comma"',
    '"item with ""quotes"""'
  ];
  assert.strictEqual(primCsv, expectedPrim.join('\n'));
  console.log('  ✓ generateCsv formats array of primitives with Value header');

  console.log('\n✅ All CSV tests passed successfully!\n');
}

runCsvTests().catch(err => {
  console.error('\n❌ CSV test failed:', err);
  process.exit(1);
});
