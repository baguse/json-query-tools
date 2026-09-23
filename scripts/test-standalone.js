const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runStandaloneTests() {
  console.log('Testing standalone mode and expression evaluation...');

  // Bundle evaluator in memory with mock vscode
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/evaluator.ts')],
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
                  showWarningMessage: () => {},
                  showErrorMessage: () => {}
                },
                workspace: {
                  workspaceFolders: [{ uri: { fsPath: __dirname } }],
                  getWorkspaceFolder: () => ({ uri: { fsPath: __dirname } }),
                  getConfiguration: () => ({ get: () => ({}) })
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

  const { evaluateExpression, stringify } = mod.exports;

  // 1. Standalone mode (0 sources bound): direct array generator expression
  const res1 = evaluateExpression([], {}, 'return [1, 2, 3].map(x => x * 10);');
  assert.deepStrictEqual(res1, [10, 20, 30]);
  console.log('  ✓ Standalone mode: direct array generator expression works');

  // 2. Standalone mode: arrow query function with return
  const res2 = evaluateExpression([], {}, 'return (data) => Array.from({ length: 3 }, (_, i) => ({ id: i + 1 }));');
  assert.deepStrictEqual(res2, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  console.log('  ✓ Standalone mode: arrow query function works');

  // 3. Standalone mode: reference to `data` variable safely defaults to undefined
  const res3 = evaluateExpression([], {}, 'return data ? data : { status: "standalone" };');
  assert.deepStrictEqual(res3, { status: "standalone" });
  console.log('  ✓ Standalone mode: `data` variable safely defaults to undefined without ReferenceError');

  // 4. Standalone mode: math and object generation
  const res4 = evaluateExpression([], {}, 'return { pi: Math.PI, generated: true };');
  assert.strictEqual(res4.generated, true);
  assert.strictEqual(typeof res4.pi, 'number');
  console.log('  ✓ Standalone mode: math & object generation works');

  // 5. Normal mode with bound sources: ensure existing functionality is preserved
  const sampleData = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }];
  const res5 = evaluateExpression([{ alias: 'data', uri: { fsPath: '/test/data.json' } }], { data: sampleData }, 'return data.filter(u => u.age > 26);');
  assert.deepStrictEqual(res5, [{ name: 'Alice', age: 30 }]);
  console.log('  ✓ Bound source mode: data filtering continues to work as expected');

  console.log('\n✅ All standalone mode tests passed successfully!\n');
}

runStandaloneTests().catch(err => {
  console.error('\n❌ Standalone test failed:', err);
  process.exit(1);
});
