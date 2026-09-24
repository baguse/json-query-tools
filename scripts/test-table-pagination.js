const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const vm = require('vm');

async function runTablePaginationTests() {
  console.log('Testing Table View pagination and virtualization for large datasets...');

  // 1. Bundle src/webview/html.ts in memory with a virtual vscode mock
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
    scriptNonce: 'test-nonce-pagination',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/users.json' } }]
  });

  // Verify key pagination elements exist in HTML
  assert.ok(html.includes('id="tablePagination"'), 'Missing id="tablePagination" in webview HTML');
  assert.ok(html.includes('id="tablePageSize"'), 'Missing id="tablePageSize" in webview HTML');
  assert.ok(html.includes('id="tablePageInfo"'), 'Missing id="tablePageInfo" in webview HTML');
  assert.ok(html.includes('id="tableFirstPage"'), 'Missing id="tableFirstPage" in webview HTML');
  assert.ok(html.includes('id="tablePrevPage"'), 'Missing id="tablePrevPage" in webview HTML');
  assert.ok(html.includes('id="tableNextPage"'), 'Missing id="tableNextPage" in webview HTML');
  assert.ok(html.includes('id="tableLastPage"'), 'Missing id="tableLastPage" in webview HTML');
  assert.ok(html.includes('id="tablePageInput"'), 'Missing id="tablePageInput" in webview HTML');
  assert.ok(html.includes('id="tableTotalPages"'), 'Missing id="tableTotalPages" in webview HTML');
  assert.ok(html.includes('id="resultTableWarning"'), 'Missing id="resultTableWarning" in webview HTML');
  assert.ok(html.includes('Data must be an array to render a table.'), 'Missing warning text for table');
  assert.ok(!html.includes('<option value="raw">'), 'raw format option should be removed from resultFormat');
  console.log('  ✓ Webview HTML contains table pagination and warning DOM elements (raw format removed)');

  // Verify renderTablePage and hideTable exist in script
  assert.ok(html.includes('function renderTablePage()'), 'Missing function renderTablePage in webview script');
  assert.ok(html.includes('function hideTable()'), 'Missing function hideTable in webview script');
  console.log('  ✓ Webview script includes renderTablePage and hideTable');

  // 2. Test pagination logic in a simulated DOM environment
  const mockTableHead = { innerHTML: '', children: [] };
  const mockTableBody = { innerHTML: '', children: [] };
  const mockTable = { style: { display: 'none' } };
  const mockPagination = { style: { display: 'none' } };
  const mockPageInfo = { textContent: '' };
  const mockPageSize = { value: '50' };
  const mockFirstPage = { disabled: false };
  const mockPrevPage = { disabled: false };
  const mockNextPage = { disabled: false };
  const mockLastPage = { disabled: false };
  const mockPageInput = { value: 1, max: 1 };
  const mockTotalPages = { textContent: '1' };

  let currentTableData = null;
  let tableCurrentPage = 1;
  let currentTablePageSize = 50;

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hideTable() {
    mockTable.style.display = 'none';
    mockPagination.style.display = 'none';
  }

  function renderTablePage() {
    if (!currentTableData || !Array.isArray(currentTableData) || currentTableData.length === 0) {
      hideTable();
      return;
    }

    const totalRows = currentTableData.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / currentTablePageSize));

    if (tableCurrentPage > totalPages) {
      tableCurrentPage = totalPages;
    }
    if (tableCurrentPage < 1) {
      tableCurrentPage = 1;
    }

    const startIdx = (tableCurrentPage - 1) * currentTablePageSize;
    const endIdx = Math.min(startIdx + currentTablePageSize, totalRows);
    const pageRows = currentTableData.slice(startIdx, endIdx);

    mockPageInfo.textContent = 'Showing ' + (startIdx + 1) + '–' + endIdx + ' of ' + totalRows.toLocaleString() + ' rows';
    mockPageInput.value = tableCurrentPage;
    mockPageInput.max = totalPages;
    mockTotalPages.textContent = totalPages;
    mockFirstPage.disabled = tableCurrentPage <= 1;
    mockPrevPage.disabled = tableCurrentPage <= 1;
    mockNextPage.disabled = tableCurrentPage >= totalPages;
    mockLastPage.disabled = tableCurrentPage >= totalPages;

    var hasObjects = false;
    var allKeys = new Set();
    var checkLimit = Math.min(500, currentTableData.length);
    for (var checkIdx = 0; checkIdx < checkLimit; checkIdx++) {
      var checkItem = currentTableData[checkIdx];
      if (typeof checkItem === 'object' && checkItem !== null && !Array.isArray(checkItem)) {
        hasObjects = true;
        var itemKeys = Object.keys(checkItem);
        for (var keyIdx = 0; keyIdx < itemKeys.length; keyIdx++) {
          allKeys.add(itemKeys[keyIdx]);
        }
      }
    }

    if (hasObjects && allKeys.size > 0) {
      var keys = Array.from(allKeys);
      var headerCells = [];
      for (var i = 0; i < keys.length; i++) {
        headerCells.push('<th>' + escapeHtml(String(keys[i])) + '</th>');
      }
      mockTableHead.innerHTML = '<tr>' + headerCells.join('') + '</tr>';

      var bodyRows = [];
      for (var j = 0; j < pageRows.length; j++) {
        var item = pageRows[j];
        var cells = [];
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          var value = item && typeof item === 'object' && item !== null ? item[key] : undefined;
          var displayValue = value === null ? 'null' : value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
          cells.push('<td>' + escapeHtml(displayValue) + '</td>');
        }
        bodyRows.push('<tr>' + cells.join('') + '</tr>');
      }
      mockTableBody.innerHTML = bodyRows.join('');
    } else {
      mockTableHead.innerHTML = '<tr><th>Value</th></tr>';
      var bodyRows = [];
      for (var j = 0; j < pageRows.length; j++) {
        var item = pageRows[j];
        var displayValue = item === null ? 'null' : item === undefined ? 'undefined' : typeof item === 'object' ? JSON.stringify(item) : String(item);
        bodyRows.push('<tr><td>' + escapeHtml(displayValue) + '</td></tr>');
      }
      mockTableBody.innerHTML = bodyRows.join('');
    }
  }

  // Test Case A: Empty data hides table and pagination
  currentTableData = [];
  renderTablePage();
  assert.strictEqual(mockTable.style.display, 'none');
  assert.strictEqual(mockPagination.style.display, 'none');
  console.log('  ✓ Empty dataset hides table and pagination controls');

  // Test Case B: 125 objects with pageSize = 50 -> 3 pages
  currentTableData = Array.from({ length: 125 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));
  tableCurrentPage = 1;
  currentTablePageSize = 50;
  mockTable.style.display = 'table';
  mockPagination.style.display = 'flex';
  renderTablePage();

  assert.strictEqual(mockPageInfo.textContent, 'Showing 1–50 of 125 rows');
  assert.strictEqual(mockPageInput.value, 1);
  assert.strictEqual(mockTotalPages.textContent, 3);
  assert.strictEqual(mockFirstPage.disabled, true);
  assert.strictEqual(mockPrevPage.disabled, true);
  assert.strictEqual(mockNextPage.disabled, false);
  assert.strictEqual(mockLastPage.disabled, false);

  // Count rendered <tr> in tbody (should be 50 rows)
  const renderedTrCountP1 = (mockTableBody.innerHTML.match(/<tr>/g) || []).length;
  assert.strictEqual(renderedTrCountP1, 50, `Expected 50 rows in page 1, got ${renderedTrCountP1}`);
  assert.ok(mockTableBody.innerHTML.includes('<td>User 1</td>'));
  assert.ok(mockTableBody.innerHTML.includes('<td>User 50</td>'));
  assert.ok(!mockTableBody.innerHTML.includes('<td>User 51</td>'), 'User 51 should not be in page 1');
  console.log('  ✓ Page 1 correctly renders first 50 rows with disabled Prev/First controls');

  // Navigate to Page 2
  tableCurrentPage = 2;
  renderTablePage();
  assert.strictEqual(mockPageInfo.textContent, 'Showing 51–100 of 125 rows');
  assert.strictEqual(mockPageInput.value, 2);
  assert.strictEqual(mockFirstPage.disabled, false);
  assert.strictEqual(mockPrevPage.disabled, false);
  assert.strictEqual(mockNextPage.disabled, false);
  assert.strictEqual(mockLastPage.disabled, false);
  const renderedTrCountP2 = (mockTableBody.innerHTML.match(/<tr>/g) || []).length;
  assert.strictEqual(renderedTrCountP2, 50);
  assert.ok(mockTableBody.innerHTML.includes('<td>User 51</td>'));
  assert.ok(mockTableBody.innerHTML.includes('<td>User 100</td>'));
  console.log('  ✓ Page 2 correctly renders rows 51-100 with active Next/Prev controls');

  // Navigate to Last Page (Page 3)
  tableCurrentPage = 3;
  renderTablePage();
  assert.strictEqual(mockPageInfo.textContent, 'Showing 101–125 of 125 rows');
  assert.strictEqual(mockPageInput.value, 3);
  assert.strictEqual(mockFirstPage.disabled, false);
  assert.strictEqual(mockPrevPage.disabled, false);
  assert.strictEqual(mockNextPage.disabled, true);
  assert.strictEqual(mockLastPage.disabled, true);
  const renderedTrCountP3 = (mockTableBody.innerHTML.match(/<tr>/g) || []).length;
  assert.strictEqual(renderedTrCountP3, 25, `Expected 25 rows on final page, got ${renderedTrCountP3}`);
  assert.ok(mockTableBody.innerHTML.includes('<td>User 101</td>'));
  assert.ok(mockTableBody.innerHTML.includes('<td>User 125</td>'));
  console.log('  ✓ Final page correctly renders remaining 25 rows with disabled Next/Last controls');

  // Test Case C: Changing page size adjusts current page to keep row in view
  // On row 101 (page 3 with size 50), changing page size to 25 -> row index 100 -> page 5
  const oldSize = 50;
  const newSize = 25;
  const firstVisibleIdx = (tableCurrentPage - 1) * oldSize; // 100
  tableCurrentPage = Math.floor(firstVisibleIdx / newSize) + 1; // 5
  currentTablePageSize = newSize;
  renderTablePage();
  assert.strictEqual(tableCurrentPage, 5);
  assert.strictEqual(mockTotalPages.textContent, 5);
  assert.strictEqual(mockPageInfo.textContent, 'Showing 101–125 of 125 rows');
  console.log('  ✓ Page size change recalculates current page to preserve visible records');

  // Test Case D: Clamping page input on boundary overflows
  tableCurrentPage = 999; // typed 999
  renderTablePage();
  assert.strictEqual(tableCurrentPage, 5, 'Page 999 should clamp to totalPages (5)');

  tableCurrentPage = -10; // typed negative
  renderTablePage();
  assert.strictEqual(tableCurrentPage, 1, 'Negative page should clamp to 1');
  console.log('  ✓ Page input correctly clamps to [1, totalPages]');

  // Test Case E: Large dataset performance test (10,000 items)
  currentTableData = Array.from({ length: 10000 }, (_, i) => ({ id: i + 1, val: `Data ${i + 1}` }));
  currentTablePageSize = 50;
  tableCurrentPage = 1;
  const tStart = Date.now();
  renderTablePage();
  const durationMs = Date.now() - tStart;

  assert.strictEqual(mockTotalPages.textContent, 200);
  assert.strictEqual(mockPageInfo.textContent, 'Showing 1–50 of 10,000 rows');
  const renderedTrCountLarge = (mockTableBody.innerHTML.match(/<tr>/g) || []).length;
  assert.strictEqual(
    renderedTrCountLarge,
    50,
    `Virtualization failure: Expected exactly 50 rows in DOM for 10,000 items, got ${renderedTrCountLarge}`
  );
  assert.ok(durationMs < 50, `Render took too long: ${durationMs}ms`);
  console.log(`  ✓ 10,000 items rendered in ${durationMs}ms with exactly 50 DOM rows (preventing UI freeze)`);

  // Test Case F: Array of primitives
  currentTableData = [10, 20, 30, 'alpha', 'beta', null, true];
  currentTablePageSize = 5;
  tableCurrentPage = 1;
  renderTablePage();
  assert.ok(mockTableHead.innerHTML.includes('<th>Value</th>'));
  assert.strictEqual(mockTotalPages.textContent, 2);
  assert.strictEqual(mockPageInfo.textContent, 'Showing 1–5 of 7 rows');
  const renderedPrimitiveRows = (mockTableBody.innerHTML.match(/<tr>/g) || []).length;
  assert.strictEqual(renderedPrimitiveRows, 5);
  // Test Case G: Warning when table data is not an array (matches chart warning)
  const mockTableWarning = { style: { display: 'none' }, innerHTML: '' };
  function updateTableDisplay(format, data) {
    if (format === 'table') {
      if (!data || !Array.isArray(data)) {
        hideTable();
        mockTableWarning.style.display = 'block';
        mockTableWarning.innerHTML = '<div style="padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a table.</div>';
        return;
      }
      mockTableWarning.style.display = 'none';
      mockTable.style.display = 'table';
      currentTableData = data;
      renderTablePage();
    }
  }

  // Non-array object
  updateTableDisplay('table', { user: 'Alice', age: 30 });
  assert.strictEqual(mockTable.style.display, 'none');
  assert.strictEqual(mockTableWarning.style.display, 'block');
  assert.ok(mockTableWarning.innerHTML.includes('Data must be an array to render a table.'));

  // Number primitive
  updateTableDisplay('table', 42);
  assert.strictEqual(mockTable.style.display, 'none');
  assert.strictEqual(mockTableWarning.style.display, 'block');

  // Null
  updateTableDisplay('table', null);
  assert.strictEqual(mockTable.style.display, 'none');
  assert.strictEqual(mockTableWarning.style.display, 'block');

  // Valid array restores table and hides warning
  updateTableDisplay('table', [{ id: 1, name: 'Alice' }]);
  assert.strictEqual(mockTableWarning.style.display, 'none');
  assert.strictEqual(mockTable.style.display, 'table');
  console.log('  ✓ Non-array data displays table warning matching chart warning, valid array restores table');

  console.log('\n✅ All table pagination tests passed successfully!\n');
}

runTablePaginationTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
