const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const vm = require('vm');

async function runSimpleBeautifyTests() {
  console.log('Testing simpleBeautify string-literal and comment preservation (#1.14)...');

  // Bundle html.ts in memory
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
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  // Extract simpleBeautify from the generated webview HTML
  const functionMatch = html.match(/function simpleBeautify\(code\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(functionMatch, 'simpleBeautify function must exist in webview script');

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(functionMatch[0], sandbox);
  const simpleBeautify = sandbox.simpleBeautify;
  assert.strictEqual(typeof simpleBeautify, 'function', 'simpleBeautify must be a callable function');

  // 1. String literal containing braces and commas (The bug in #1.14)
  const input1 = 'data.filter(x => x.tag === "{active, urgent}")';
  const output1 = simpleBeautify(input1);
  assert.strictEqual(
    output1,
    'data.filter(x => x.tag === "{active, urgent}")',
    'String literals with braces and commas must not have formatting characters injected'
  );
  console.log('  ✓ Braces and commas inside double-quoted strings are preserved intact');

  // 2. Single-quoted string literal containing brackets and colons
  const input2 = "data.map(x => x.id === 'item: [1, 2, 3]')";
  const output2 = simpleBeautify(input2);
  assert.strictEqual(
    output2,
    "data.map(x => x.id === 'item: [1, 2, 3]')",
    'Brackets and colons inside single-quoted strings must be preserved'
  );
  console.log('  ✓ Brackets and colons inside single-quoted strings are preserved intact');

  // 3. String literal containing escaped quotes and braces
  const input3 = 'const msg = "Querying \\"{active}\\" items";';
  const output3 = simpleBeautify(input3);
  assert.strictEqual(
    output3,
    'const msg = "Querying \\"{active}\\" items";',
    'Escaped quotes inside strings must not terminate string literal scanning'
  );
  console.log('  ✓ Escaped quotes inside strings are handled properly');

  // 4. Template literals containing formatting characters
  const input4 = 'const title = `User: ${user.name}, Tags: [active, vip]`;';
  const output4 = simpleBeautify(input4);
  assert.strictEqual(
    output4,
    'const title = `User: ${user.name}, Tags: [active, vip]`;',
    'Template literals must be preserved without injected formatting'
  );
  console.log('  ✓ Template literals are preserved without corruption');

  // 5. Empty strings
  const input5 = 'const empty = ["", \'\', ``];';
  const output5 = simpleBeautify(input5);
  assert.ok(
    output5.includes('""') && output5.includes("''") && output5.includes('``'),
    'Empty strings should remain valid empty string literals'
  );
  console.log('  ✓ Empty string literals are handled without indexing errors');

  // 6. Single-line comments containing formatting characters
  const input6 = '// Filter criteria: { id: 1, tags: [admin] }\nreturn data;';
  const output6 = simpleBeautify(input6);
  assert.ok(
    output6.startsWith('// Filter criteria: { id: 1, tags: [admin] }\n'),
    'Single-line comments must not have formatting injected'
  );
  console.log('  ✓ Single-line comments with formatting characters are preserved intact');

  // 7. Multi-line comments containing formatting characters
  const input7 = '/*\n * Config: { debug: true, port: 8080 }\n */\nreturn data;';
  const output7 = simpleBeautify(input7);
  assert.ok(
    output7.includes('/*\n * Config: { debug: true, port: 8080 }\n */'),
    'Multi-line comments must not have formatting injected'
  );
  console.log('  ✓ Multi-line comments with formatting characters are preserved intact');

  // 8. Normal code formatting outside string literals still formats correctly
  const input8 = 'const obj = {a: "hello, world", b: [1, 2]};';
  const output8 = simpleBeautify(input8);
  assert.ok(output8.includes('a: "hello, world"'), 'String value must remain intact');
  assert.ok(output8.includes('{\n  a:'), 'Object opening brace must be indented');
  assert.ok(output8.includes('b: [\n    1,\n    2\n  ]'), 'Array elements must be indented');
  console.log('  ✓ Normal object and array formatting outside strings continues to format properly');

  console.log('\n✅ All simpleBeautify tests passed successfully!');
}

runSimpleBeautifyTests().catch(err => {
  console.error('Fatal error during simpleBeautify tests:', err);
  process.exit(1);
});
