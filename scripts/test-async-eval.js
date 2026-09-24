const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runAsyncEvalTests() {
  console.log('Testing Asynchronous Query Support (async/await and Promises in Expressions)...');

  let warningMessageShown = null;

  // 1. Bundle src/evaluator.ts in memory with mock vscode
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
                  showWarningMessage: (msg) => { globalThis.__lastWarning = msg; },
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

  const boundFiles = [
    { alias: 'users', uri: { fsPath: '/test/users.json' } },
    { alias: 'orders', uri: { fsPath: '/test/orders.json' } }
  ];
  const dataMap = {
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    orders: [
      { id: 101, userId: 1, total: 50 },
      { id: 102, userId: 1, total: 30 },
      { id: 103, userId: 2, total: 100 }
    ]
  };

  // 2. Async arrow function returning mapped data
  const exprAsyncArrow = `async (users) => {
    const names = await Promise.resolve(users.map(u => u.name));
    return names;
  }`;
  const resAsyncArrow = await evaluateExpression(boundFiles, dataMap, exprAsyncArrow);
  assert.deepStrictEqual(resAsyncArrow, ['Alice', 'Bob']);
  console.log('  ✓ Async arrow function with await resolves to expected result');

  // 3. Multi-source async query function
  const exprMultiAsync = `async (users, orders) => {
    const res = await Promise.resolve(
      users.map(u => ({
        name: u.name,
        spent: orders.filter(o => o.userId === u.id).reduce((sum, o) => sum + o.total, 0)
      }))
    );
    return res;
  }`;
  const resMultiAsync = await evaluateExpression(boundFiles, dataMap, exprMultiAsync);
  assert.deepStrictEqual(resMultiAsync, [
    { name: 'Alice', spent: 80 },
    { name: 'Bob', spent: 100 }
  ]);
  console.log('  ✓ Multi-source async query function receives all bound sources');

  // 4. Expression explicitly returning a Promise
  const exprPromiseReturn = 'return Promise.resolve(users.length + orders.length);';
  const resPromiseReturn = await evaluateExpression(boundFiles, dataMap, exprPromiseReturn);
  assert.strictEqual(resPromiseReturn, 5);
  console.log('  ✓ Expression with explicit return Promise.resolve resolves correctly');

  // 5. Single expression returning a Promise without return keyword (implicit return)
  const exprPromiseImplicit = 'Promise.resolve(users.map(u => u.id))';
  const resPromiseImplicit = await evaluateExpression(boundFiles, dataMap, exprPromiseImplicit);
  assert.deepStrictEqual(resPromiseImplicit, [1, 2]);
  console.log('  ✓ Single Promise expression with implicit return resolves correctly');

  // 6. Top-level await expression with return statement
  const exprTopLevelAwait = `const u = await Promise.resolve(users);
const total = await Promise.resolve(orders.reduce((sum, o) => sum + o.total, 0));
return { userCount: u.length, grandTotal: total };`;
  const resTopLevelAwait = await evaluateExpression(boundFiles, dataMap, exprTopLevelAwait);
  assert.deepStrictEqual(resTopLevelAwait, { userCount: 2, grandTotal: 180 });
  console.log('  ✓ Top-level await expression with explicit return works');

  // 7. Top-level await expression without return keyword (implicit return)
  const exprAwaitImplicit = 'await Promise.resolve(users.map(u => u.name.toUpperCase()))';
  const resAwaitImplicit = await evaluateExpression(boundFiles, dataMap, exprAwaitImplicit);
  assert.deepStrictEqual(resAwaitImplicit, ['ALICE', 'BOB']);
  console.log('  ✓ Top-level await expression with implicit return works');

  // 8. Custom Thenable object resolution
  const exprThenable = `return {
    then(onFulfilled) {
      onFulfilled({ custom: 'thenable-result', ok: true });
    }
  };`;
  const resThenable = await evaluateExpression(boundFiles, dataMap, exprThenable);
  assert.deepStrictEqual(resThenable, { custom: 'thenable-result', ok: true });
  console.log('  ✓ Custom thenable object is awaited and unwrapped');

  // 9. Rejection handling
  let rejectedCaught = false;
  try {
    await evaluateExpression(boundFiles, dataMap, 'return Promise.reject(new Error("Async computation failed"));');
  } catch (err) {
    rejectedCaught = true;
    assert.strictEqual(err.message, 'Async computation failed');
  }
  assert.ok(rejectedCaught, 'Should reject and propagate error on Promise.reject');

  let asyncThrowCaught = false;
  try {
    await evaluateExpression(boundFiles, dataMap, 'async () => { throw new Error("Async throw inside function"); }');
  } catch (err) {
    asyncThrowCaught = true;
    assert.strictEqual(err.message, 'Async throw inside function');
  }
  assert.ok(asyncThrowCaught, 'Should propagate error thrown inside async query function');
  console.log('  ✓ Promise rejections and thrown errors in async expressions are propagated');

  // 10. Async void/undefined shows warning
  globalThis.__lastWarning = null;
  const resVoid = await evaluateExpression(boundFiles, dataMap, 'async () => { /* returns nothing */ }');
  assert.strictEqual(resVoid, undefined);
  assert.ok(
    globalThis.__lastWarning && globalThis.__lastWarning.includes('Expression returned void'),
    'Should trigger warning message on async void result'
  );
  console.log('  ✓ Async query returning void (undefined) triggers warning notification');

  // 11. Standalone async evaluation
  const resStandalone = await evaluateExpression([], {}, 'async () => Array.from({ length: 4 }, (_, i) => i * 2)');
  assert.deepStrictEqual(resStandalone, [0, 2, 4, 6]);
  console.log('  ✓ Standalone mode evaluates async queries properly');

  // 12. Synchronous queries still return synchronously
  const syncRes = evaluateExpression([], { data: [10, 20] }, 'data.map(x => x / 2)');
  assert.ok(!(syncRes instanceof Promise), 'Synchronous expression should return synchronous value');
  assert.deepStrictEqual(syncRes, [5, 10]);
  console.log('  ✓ Synchronous expressions retain non-Promise synchronous return value');

  console.log('\n✅ All Asynchronous Query evaluator tests passed successfully!');
}

runAsyncEvalTests().catch(err => {
  console.error('Fatal error during async eval tests:', err);
  process.exit(1);
});
