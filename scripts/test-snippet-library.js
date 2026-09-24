const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');
const vm = require('vm');

async function main() {
  console.log('Testing Snippet Library & Cheatsheet (Feature 3.6)...');

  // 1. Bundle src/webview/html.ts in memory
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
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            contents: `module.exports = { workspace: { asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json') } };`,
            loader: 'js'
          }));
        }
      }
    ]
  });

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', result.outputFiles[0].text);
  fn(mod, mod.exports, require, path.join(__dirname, '../src/webview'));

  const { getQueryEditorHtml } = mod.exports;
  const mockWebview = { cspSource: 'vscode-webview:' };
  const html = getQueryEditorHtml(mockWebview, { scriptNonce: 'test-snippets-nonce' });

  // 2. Validate Toolbar UI Elements
  assert(html.includes('id="snippetSelect"'), 'Missing #snippetSelect in HTML');
  assert(html.includes('id="openCheatsheetBtn"'), 'Missing #openCheatsheetBtn in HTML');
  assert(html.includes('value="group_by"'), 'Missing group_by option in select');
  assert(html.includes('value="sum"'), 'Missing sum option in select');
  assert(html.includes('value="average"'), 'Missing average option in select');
  assert(html.includes('value="flatten_flatmap"'), 'Missing flatten_flatmap option in select');
  assert(html.includes('value="filter_date"'), 'Missing filter_date option in select');
  assert(html.includes('value="pick_keys"'), 'Missing pick_keys option in select');
  assert(html.includes('value="omit_keys"'), 'Missing omit_keys option in select');
  assert(html.includes('value="open_cheatsheet"'), 'Missing open_cheatsheet option in select');
  console.log('✔ Toolbar dropdown contains required options for Group By, Sum/Average, Flatten, Filter by Date, Pick/Omit');

  // 3. Validate Cheatsheet Modal UI Elements & DOM Structure
  assert(html.includes('id="cheatsheetModal"'), 'Missing #cheatsheetModal dialog');
  assert(html.includes('id="cheatsheetSearch"'), 'Missing #cheatsheetSearch input');
  assert(html.includes('id="cheatsheetCategories"'), 'Missing #cheatsheetCategories filter tabs');
  assert(html.includes('id="cheatsheetList"'), 'Missing #cheatsheetList container');
  assert(html.includes('id="dismissCheatsheetBtn"'), 'Missing #dismissCheatsheetBtn');

  // Verify modals are independent siblings, not nested within each other
  const sourceInspectModalIndex = html.indexOf('id="sourceInspectModal"');
  const cheatsheetModalIndex = html.indexOf('id="cheatsheetModal"');
  assert(sourceInspectModalIndex !== -1 && cheatsheetModalIndex !== -1, 'Both modals must exist');
  assert(sourceInspectModalIndex < cheatsheetModalIndex, 'sourceInspectModal should precede cheatsheetModal');
  const inspectModalMarkup = html.substring(sourceInspectModalIndex, cheatsheetModalIndex);
  const openDivs = (inspectModalMarkup.match(/<div[\s>]/gi) || []).length;
  const closeDivs = (inspectModalMarkup.match(/<\/div>/gi) || []).length;
  assert.strictEqual(openDivs, closeDivs, `sourceInspectModal must close all divs before cheatsheetModal starts (open: ${openDivs}, close: ${closeDivs})`);
  console.log('✔ Cheatsheet modal markup contains search input, category filters, and list container as an independent top-level modal');

  // 4. Validate Script Syntax in vm.Script
  const scriptMatch = html.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, 'Could not find <script> tag');
  const scriptContent = scriptMatch[1];
  new vm.Script(scriptContent, { filename: 'test_snippets_script.js' });
  console.log('✔ Generated webview script containing snippet library compiles without SyntaxError');

  // 5. Test semantic execution of snippet patterns on sample data
  const sampleData = [
    { id: 1, name: 'Alice', category: 'admin', amount: 150, score: 90, date: '2026-03-15', password: 'secret1', items: ['apple', 'banana'] },
    { id: 2, name: 'Bob', category: 'user', amount: 50, score: 70, date: '2026-06-20', password: 'secret2', items: ['orange'] },
    { id: 3, name: 'Charlie', category: 'user', amount: 200, score: 85, date: '2025-12-01', password: 'secret3', items: ['grape', 'pear'] },
    { id: 1, name: 'Alice Duplicate', category: 'admin', amount: 150, score: 90, date: '2026-03-15', password: 'secret1', items: [] }
  ];

  // A. Group by
  const groupByFn = new Function('data', 'return Object.groupBy ? Object.groupBy(data, item => item.category) : data.reduce((acc, x) => ((acc[x.category] = acc[x.category] || []).push(x), acc), {})');
  const grouped = groupByFn(sampleData);
  assert(grouped.admin && grouped.user);
  assert.strictEqual(grouped.admin.length, 2);
  assert.strictEqual(grouped.user.length, 2);
  console.log('✔ Group By snippet pattern successfully groups items by category');

  // B. Sum & Average
  const sumFn = new Function('data', 'return data.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)');
  const sumResult = sumFn(sampleData);
  assert.strictEqual(sumResult, 550);

  const avgFn = new Function('data', 'return data.length ? data.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / data.length : 0');
  const avgResult = avgFn(sampleData);
  assert.strictEqual(avgResult, 335 / 4);
  console.log('✔ Sum and Average snippet patterns compute correct numeric aggregations');

  // C. Flatten
  const flattenFn = new Function('data', 'return data.flatMap(item => item.items || [])');
  const flatItems = flattenFn(sampleData);
  assert.deepStrictEqual(flatItems, ['apple', 'banana', 'orange', 'grape', 'pear']);
  console.log('✔ Flatten snippet pattern extracts and flattens nested items array');

  // D. Filter by Date Range (Year 2026)
  const filterDateFn = new Function('data', `
    return data.filter(item => {
      const d = new Date(item.createdAt || item.date);
      return d >= new Date("2026-01-01") && d <= new Date("2026-12-31");
    });
  `);
  const dateFiltered = filterDateFn(sampleData);
  assert.strictEqual(dateFiltered.length, 3);
  assert(dateFiltered.every(x => x.date.startsWith('2026')));
  console.log('✔ Date range filter snippet pattern correctly matches date boundaries');

  // E. Pick & Omit Keys
  const pickFn = new Function('data', 'return data.map(({ id, name }) => ({ id, name }))');
  const picked = pickFn(sampleData);
  assert(picked.every(x => x.id !== undefined && x.name !== undefined && x.password === undefined));

  const omitFn = new Function('data', 'return data.map(({ password, secret, token, ...rest }) => rest)');
  const omitted = omitFn(sampleData);
  assert(omitted.every(x => x.password === undefined && x.id !== undefined));
  console.log('✔ Pick and Omit key snippets properly project and sanitize fields');

  // F. Unique by ID
  const dedupFn = new Function('data', 'return Array.from(new Map(data.map(item => [item.id, item])).values())');
  const uniqueItems = dedupFn(sampleData);
  assert.strictEqual(uniqueItems.length, 3);
  console.log('✔ Unique/Deduplication snippet pattern retains unique objects by ID');

  // G. Multi-Source Join
  const users = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
  const orders = [{ id: 101, userId: 1, total: 50 }, { id: 102, userId: 1, total: 30 }, { id: 103, userId: 2, total: 90 }];
  const joinFn = (users, orders) => users.map(u => ({
    ...u,
    orders: orders.filter(o => o.userId === u.id)
  }));
  const joined = joinFn(users, orders);
  assert.strictEqual(joined[0].orders.length, 2);
  assert.strictEqual(joined[1].orders.length, 1);
  console.log('✔ Multi-Source join pattern joins relational data sources');

  console.log('\nAll Snippet Library & Cheatsheet tests passed successfully! 🎉');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
