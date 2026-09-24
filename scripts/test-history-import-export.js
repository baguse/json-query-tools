const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');
const vm = require('vm');

async function main() {
  console.log('Testing Query History Export / Import as JSON (Feature 3.9)...');

  // 1. Bundle src/history.ts in memory
  const historyBundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/history.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
    external: ['vscode']
  });

  const historyMod = { exports: {} };
  const historyFn = new Function('module', 'exports', 'require', '__dirname', historyBundle.outputFiles[0].text);
  historyFn(historyMod, historyMod.exports, require, path.join(__dirname, '../src'));

  const {
    serializeHistoryJson,
    parseHistoryJson,
    mergeHistory,
    saveImportedHistory,
    enforceHistoryLimit,
    normalizeHistory
  } = historyMod.exports;

  // 2. Test serializeHistoryJson
  const sampleHistory = [
    { expr: 'data.users.filter(u => u.active)', isFavorite: true, name: 'Active Users' },
    { expr: 'data.reduce((sum, x) => sum + x.price, 0)', isFavorite: true, name: 'Total Revenue' },
    { expr: 'data.slice(0, 10)', isFavorite: false },
    { expr: 'Object.keys(data)', isFavorite: false }
  ];

  // A. All queries
  const allJson = serializeHistoryJson(sampleHistory);
  const parsedAll = JSON.parse(allJson);
  assert.strictEqual(parsedAll.version, '1.0');
  assert.strictEqual(parsedAll.count, 4);
  assert.strictEqual(parsedAll.queries.length, 4);
  assert.strictEqual(parsedAll.queries[0].name, 'Active Users');
  assert.strictEqual(parsedAll.queries[0].isFavorite, true);
  assert.strictEqual(parsedAll.queries[2].isFavorite, false);
  assert.strictEqual(parsedAll.queries[2].name, undefined);
  console.log('✔ serializeHistoryJson correctly serializes full query history to JSON');

  // B. Favorites only
  const favJson = serializeHistoryJson(sampleHistory, { favoritesOnly: true });
  const parsedFav = JSON.parse(favJson);
  assert.strictEqual(parsedFav.count, 2);
  assert.strictEqual(parsedFav.queries.length, 2);
  assert(parsedFav.queries.every(q => q.isFavorite));
  console.log('✔ serializeHistoryJson supports favoritesOnly filtering');

  // 3. Test parseHistoryJson
  // A. Standard exported format
  const parsedRes1 = parseHistoryJson(allJson);
  assert.strictEqual(parsedRes1.validCount, 4);
  assert.strictEqual(parsedRes1.invalidCount, 0);
  assert.strictEqual(parsedRes1.items[0].name, 'Active Users');
  assert.strictEqual(parsedRes1.items[0].expr, 'data.users.filter(u => u.active)');
  console.log('✔ parseHistoryJson parses standard exported JSON envelope');

  // B. Object with 'history' or 'favorites' array
  const parsedRes2 = parseHistoryJson(JSON.stringify({
    history: [
      { expr: 'data.map(x => x.id)', isFavorite: true, name: 'User IDs' },
      { expr: 'data.length' }
    ]
  }));
  assert.strictEqual(parsedRes2.validCount, 2);
  assert.strictEqual(parsedRes2.items[0].name, 'User IDs');
  assert.strictEqual(parsedRes2.items[1].isFavorite, false);

  const parsedRes3 = parseHistoryJson(JSON.stringify({
    favorites: [
      { expr: 'data.filter(Boolean)', isFavorite: true }
    ]
  }));
  assert.strictEqual(parsedRes3.validCount, 1);
  assert.strictEqual(parsedRes3.items[0].isFavorite, true);
  console.log('✔ parseHistoryJson parses alternative history/favorites envelope properties');

  // C. Raw Array format
  const rawArray = [
    { expr: 'data.items', name: 'Items' },
    'data.categories',
    { expr: '', name: 'Empty expression' }, // invalid
    null, // invalid
    123 // invalid
  ];
  const parsedRes4 = parseHistoryJson(JSON.stringify(rawArray));
  assert.strictEqual(parsedRes4.validCount, 2);
  assert.strictEqual(parsedRes4.invalidCount, 3);
  assert.strictEqual(parsedRes4.items[0].expr, 'data.items');
  assert.strictEqual(parsedRes4.items[1].expr, 'data.categories');
  console.log('✔ parseHistoryJson parses raw arrays with strings and ignores invalid entries');

  // D. Single query object
  const singleQuery = { expr: 'data.find(x => x.id === 1)', name: 'Find One', isFavorite: true };
  const parsedRes5 = parseHistoryJson(JSON.stringify(singleQuery));
  assert.strictEqual(parsedRes5.validCount, 1);
  assert.strictEqual(parsedRes5.items[0].expr, singleQuery.expr);
  console.log('✔ parseHistoryJson handles a single standalone query object');

  // E. Error cases
  assert.throws(() => parseHistoryJson('invalid-json'), /Invalid JSON syntax/);
  assert.throws(() => parseHistoryJson(JSON.stringify({ foo: 'bar' })), /JSON object does not contain a "queries", "history", or "favorites" array/);
  assert.throws(() => parseHistoryJson(JSON.stringify(42)), /JSON content must be an array or object containing queries/);
  console.log('✔ parseHistoryJson throws descriptive errors on malformed payloads');

  // 4. Test mergeHistory
  const existingHist = [
    { expr: 'data.A', isFavorite: false, name: 'Old A' },
    { expr: 'data.B', isFavorite: true, name: 'B' }
  ];
  const incomingHist = [
    { expr: 'data.A', isFavorite: true, name: 'Updated A' }, // updates favorite and name
    { expr: 'data.B', isFavorite: false, name: 'B' }, // does not downgrade favorite
    { expr: 'data.C', isFavorite: true, name: 'New C' } // adds new
  ];

  const merged = mergeHistory(existingHist, incomingHist);
  assert.strictEqual(merged.addedCount, 1);
  assert.strictEqual(merged.updatedCount, 1);
  assert.strictEqual(merged.history.length, 3);

  const mergedA = merged.history.find(h => h.expr === 'data.A');
  assert.strictEqual(mergedA.isFavorite, true);
  assert.strictEqual(mergedA.name, 'Updated A');

  const mergedB = merged.history.find(h => h.expr === 'data.B');
  assert.strictEqual(mergedB.isFavorite, true); // preserved favorite

  const mergedC = merged.history.find(h => h.expr === 'data.C');
  assert.strictEqual(mergedC.name, 'New C');
  console.log('✔ mergeHistory preserves favorites, updates metadata, and computes correct stats');

  // 5. Test enforceHistoryLimit
  const largeList = [];
  for (let i = 0; i < 110; i++) {
    largeList.push({ expr: `expr_${i}`, isFavorite: i >= 95, name: `N_${i}` });
  }
  const pruned = enforceHistoryLimit(largeList, 100);
  assert.strictEqual(pruned.length, 100);
  // Favorites must be preserved
  const favsInPruned = pruned.filter(h => h.isFavorite);
  assert.strictEqual(favsInPruned.length, 15);
  console.log('✔ enforceHistoryLimit prioritizes preserving favorite queries');

  // 6. Test saveImportedHistory with mock context
  let globalStore = {};
  const mockContext = {
    globalState: {
      get: (key) => globalStore[key] || [],
      update: async (key, val) => { globalStore[key] = val; }
    }
  };

  // Test merge mode
  globalStore['jsonQueryTools.history'] = [{ expr: 'data.existing', isFavorite: false }];
  const saveResMerge = await saveImportedHistory(mockContext, [
    { expr: 'data.new1', isFavorite: true, name: 'New 1' }
  ], 'merge');
  assert.strictEqual(saveResMerge.history.length, 2);
  assert.strictEqual(saveResMerge.addedCount, 1);
  assert.strictEqual(globalStore['jsonQueryTools.history'].length, 2);
  console.log('✔ saveImportedHistory persists merged queries in extension context');

  // Test replace mode
  const saveResReplace = await saveImportedHistory(mockContext, [
    { expr: 'data.replaced1', isFavorite: true },
    { expr: 'data.replaced2', isFavorite: false }
  ], 'replace');
  assert.strictEqual(saveResReplace.history.length, 2);
  assert.strictEqual(saveResReplace.addedCount, 2);
  assert(saveResReplace.history.some(h => h.expr === 'data.replaced1'));
  assert(!saveResReplace.history.some(h => h.expr === 'data.existing'));
  console.log('✔ saveImportedHistory replaces existing queries in replace mode');

  // 7. Validate package.json commands and activation events
  const pkg = require('../package.json');
  const exportCmd = pkg.contributes.commands.find(c => c.command === 'jsonQueryTools.exportHistory');
  const importCmd = pkg.contributes.commands.find(c => c.command === 'jsonQueryTools.importHistory');
  assert(exportCmd, 'Missing jsonQueryTools.exportHistory in package.json contributes.commands');
  assert(importCmd, 'Missing jsonQueryTools.importHistory in package.json contributes.commands');
  assert(pkg.activationEvents.includes('onCommand:jsonQueryTools.exportHistory'));
  assert(pkg.activationEvents.includes('onCommand:jsonQueryTools.importHistory'));
  console.log('✔ package.json registers exportHistory and importHistory commands');

  // 8. Validate Webview HTML elements & script syntax
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
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, { scriptNonce: 'test-history-import-export' });

  assert(html.includes('id="importHistoryJsonBtn"'), 'Missing #importHistoryJsonBtn in webview HTML');
  assert(html.includes('id="exportHistoryJsonBtn"'), 'Missing #exportHistoryJsonBtn in webview HTML');
  console.log('✔ Webview HTML contains #importHistoryJsonBtn and #exportHistoryJsonBtn buttons');

  const scriptMatch = html.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'Missing <script> tag in webview');
  new vm.Script(scriptMatch[1], { filename: 'test_history_script.js' });
  console.log('✔ Webview script compiles without syntax errors');

  console.log('\nAll Query History Export / Import as JSON tests passed successfully! 🎉');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
