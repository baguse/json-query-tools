const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runHistoryTests() {
  console.log('Testing history functions and name preservation...');

  // Mock globalState
  const storage = {};
  const mockContext = {
    globalState: {
      get: (key) => storage[key],
      update: async (key, val) => {
        storage[key] = val;
      }
    }
  };

  // Bundle history in memory with mock vscode
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/history.ts')],
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
            contents: `module.exports = {};`,
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

  const { pushHistory, getHistory, normalizeHistory } = mod.exports;

  // 1. Basic push
  await pushHistory(mockContext, 'data.map(x => x.id)');
  let hist = getHistory(mockContext);
  assert.strictEqual(hist.length, 1);
  assert.strictEqual(hist[0].expr, 'data.map(x => x.id)');
  assert.strictEqual(hist[0].isFavorite, false);
  console.log('  ✓ pushHistory adds new item');

  // 2. Add custom name and favorite to item
  hist[0].name = 'Extract IDs';
  hist[0].isFavorite = true;
  await mockContext.globalState.update('jsonQueryTools.history', hist);

  // 3. Re-running the same expression must PRESERVE custom name and favorite
  await pushHistory(mockContext, 'data.map(x => x.id)');
  hist = getHistory(mockContext);
  assert.strictEqual(hist.length, 1);
  assert.strictEqual(hist[0].expr, 'data.map(x => x.id)');
  assert.strictEqual(hist[0].isFavorite, true);
  assert.strictEqual(hist[0].name, 'Extract IDs');
  console.log('  ✓ pushHistory preserves custom name and isFavorite when re-run (#1.2 fix verified)');

  // 4. Push another expression
  await pushHistory(mockContext, 'data.filter(x => x.active)');
  hist = getHistory(mockContext);
  assert.strictEqual(hist.length, 2);
  assert.strictEqual(hist[0].name, 'Extract IDs'); // First item still named
  assert.strictEqual(hist[1].name, undefined); // New item has no name
  console.log('  ✓ Multiple history items tracked properly');

  // 5. normalizeHistory handles legacy string items
  const legacy = ['expr1', { expr: 'expr2', isFavorite: true, name: 'Named' }];
  const normalized = normalizeHistory(legacy);
  assert.deepStrictEqual(normalized, [
    { expr: 'expr1', isFavorite: false },
    { expr: 'expr2', isFavorite: true, name: 'Named' }
  ]);
  console.log('  ✓ normalizeHistory handles legacy string array and objects');

  console.log('\n✅ All history tests passed successfully!\n');
}

runHistoryTests().catch(err => {
  console.error('\n❌ History test failed:', err);
  process.exit(1);
});
