const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runMultiSourceEvalTests() {
  console.log('Testing multi-source query functions and argument passing...');

  // Bundle evaluator in memory with mock-vscode
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
                workspace: {
                  getConfiguration: () => ({ get: () => ({}) }),
                  getWorkspaceFolder: () => undefined,
                  workspaceFolders: []
                },
                window: {
                  showWarningMessage: () => {}
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

  const { evaluateExpression } = mod.exports;

  // Test data fixtures
  const users = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ];
  const orders = [
    { id: 101, userId: 1, total: 50 },
    { id: 102, userId: 1, total: 30 },
    { id: 103, userId: 2, total: 100 }
  ];
  const inventory = [
    { sku: 'ITEM-1', stock: 15 },
    { sku: 'ITEM-2', stock: 0 }
  ];

  const boundFiles = [
    { alias: 'users', uri: { fsPath: '/workspace/users.json' } },
    { alias: 'orders', uri: { fsPath: '/workspace/orders.json' } },
    { alias: 'inventory', uri: { fsPath: '/workspace/inventory.json' } }
  ];

  const dataMap = {
    users,
    orders,
    inventory
  };

  // 1. Direct multi-source expression with explicit return
  const directExpr = 'return users.map(u => ({ ...u, orderCount: orders.filter(o => o.userId === u.id).length }))';
  const directResult = evaluateExpression(boundFiles, dataMap, directExpr);
  assert.deepStrictEqual(directResult, [
    { id: 1, name: 'Alice', orderCount: 2 },
    { id: 2, name: 'Bob', orderCount: 1 }
  ]);
  console.log('  ✓ Direct expression correctly references multiple bound sources');

  // 1b. Direct multi-source expression with implicit return (no return keyword)
  const implicitExpr = 'users.map(u => u.name)';
  const implicitResult = evaluateExpression(boundFiles, dataMap, implicitExpr);
  assert.deepStrictEqual(implicitResult, ['Alice', 'Bob']);
  console.log('  ✓ Multi-source expression with implicit return works');

  // 2. Multi-source arrow function (Fix #1.8)
  // Previously: orders was passed `req` instead of dataMap['orders'], throwing orders.filter is not a function
  const arrowExpr = `(users, orders) => {
    return users.map(u => ({
      name: u.name,
      orderTotal: orders.filter(o => o.userId === u.id).reduce((sum, o) => sum + o.total, 0)
    }));
  }`;
  const arrowResult = evaluateExpression(boundFiles, dataMap, arrowExpr);
  assert.deepStrictEqual(arrowResult, [
    { name: 'Alice', orderTotal: 80 },
    { name: 'Bob', orderTotal: 100 }
  ]);
  console.log('  ✓ Multi-source arrow function receives secondary sources as arguments');

  // 2b. Multi-source arrow function with explicit return statement
  const explicitArrowExpr = `return (users, orders) => users.map(u => u.id + '-' + orders.length);`;
  const explicitArrowResult = evaluateExpression(boundFiles, dataMap, explicitArrowExpr);
  assert.deepStrictEqual(explicitArrowResult, ['1-3', '2-3']);
  console.log('  ✓ Multi-source arrow function with explicit return receives all sources');

  // 3. Multi-source function receiving 3+ sources and require
  const threeSourceExpr = `(users, orders, inventory, require) => {
    return {
      userCount: users.length,
      orderCount: orders.length,
      inventoryCount: inventory.length,
      hasRequire: typeof require === 'function'
    };
  }`;
  const threeSourceResult = evaluateExpression(boundFiles, dataMap, threeSourceExpr);
  assert.deepStrictEqual(threeSourceResult, {
    userCount: 2,
    orderCount: 3,
    inventoryCount: 2,
    hasRequire: true
  });
  console.log('  ✓ 3+ sources and require are all passed in order to query functions');

  // 4. Single-source backward compatibility
  const singleBound = [{ alias: 'data', uri: { fsPath: '/workspace/data.json' } }];
  const singleDataMap = { data: [1, 2, 3, 4, 5] };
  const singleExpr = '(data) => data.filter(x => x > 2)';
  const singleResult = evaluateExpression(singleBound, singleDataMap, singleExpr);
  assert.deepStrictEqual(singleResult, [3, 4, 5]);
  console.log('  ✓ Single source query function works as expected');

  // 5. Standalone mode (empty bound sources)
  const standaloneResult = evaluateExpression([], {}, '(data) => ({ isUndefined: data === undefined })');
  assert.deepStrictEqual(standaloneResult, { isUndefined: true });
  console.log('  ✓ Standalone mode query function executes with undefined data argument');

  console.log('\n✅ All multi-source evaluator tests passed successfully!');
}

runMultiSourceEvalTests().catch(err => {
  console.error('Fatal error during multi-source eval tests:', err);
  process.exit(1);
});
