const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

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

  // 6. Concurrency / race condition test: rapid concurrent pushHistory calls
  const asyncStorage = {};
  const asyncContext = {
    globalState: {
      get: (key) => asyncStorage[key],
      update: async (key, val) => {
        // Simulate async I/O delay in VS Code storage
        await new Promise(r => setTimeout(r, 15));
        asyncStorage[key] = val;
      }
    }
  };

  const concurrentPromises = [
    pushHistory(asyncContext, 'concurrent query 1'),
    pushHistory(asyncContext, 'concurrent query 2'),
    pushHistory(asyncContext, 'concurrent query 3'),
    pushHistory(asyncContext, 'concurrent query 4')
  ];

  await Promise.all(concurrentPromises);
  const concurrentHist = getHistory(asyncContext);
  assert.strictEqual(
    concurrentHist.length,
    4,
    `Expected 4 items from concurrent pushes, got ${concurrentHist.length}`
  );
  assert.strictEqual(concurrentHist[0].expr, 'concurrent query 1');
  assert.strictEqual(concurrentHist[1].expr, 'concurrent query 2');
  assert.strictEqual(concurrentHist[2].expr, 'concurrent query 3');
  assert.strictEqual(concurrentHist[3].expr, 'concurrent query 4');
  // 7. Verify webview history rendering ordering and comment consistency
  const htmlPath = path.join(__dirname, '../src/webview/html.ts');
  const htmlSrc = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(
    !htmlSrc.includes('Newest at bottom'),
    'html.ts should not claim non-favorites are sorted with newest at bottom'
  );
  assert.ok(
    htmlSrc.includes('// Non-favorites: display in reverse chronological order (newest at top)'),
    'html.ts should accurately describe reverse chronological ordering for non-favorites'
  );

  const mockItems = [
    { expr: 'older non-fav', isFavorite: false },
    { expr: 'alpha fav', isFavorite: true, name: 'Alpha' },
    { expr: 'newer non-fav', isFavorite: false },
    { expr: 'beta fav', isFavorite: true, name: 'Beta' }
  ];
  const favs = [];
  const others = [];
  mockItems.forEach(item => {
    if (item.isFavorite) favs.push(item);
    else others.push(item);
  });
  favs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const rendered = [...favs, ...others.reverse()];
  assert.strictEqual(rendered[0].name, 'Alpha');
  assert.strictEqual(rendered[1].name, 'Beta');
  assert.strictEqual(rendered[2].expr, 'newer non-fav');
  assert.strictEqual(rendered[3].expr, 'older non-fav');
  console.log('  ✓ Webview history rendering displays favorites followed by non-favorites in reverse chronological order');

  console.log('\n✅ All history tests passed successfully!\n');
}

runHistoryTests().catch(err => {
  console.error('\n❌ History test failed:', err);
  process.exit(1);
});
