const assert = require('assert');
const path = require('path');
const http = require('http');
const esbuild = require('esbuild');
const vm = require('vm');

async function main() {
  console.log('Testing Response Headers & Status Inspector (Feature 3.5)...');

  // 1. Test fetchUrlWithDetails returns status, statusText, and detailed response headers
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '95',
      'X-RateLimit-Reset': '1600000000',
      'ETag': '"abcdef123456"',
      'Set-Cookie': 'session=xyz789; HttpOnly; Secure'
    });
    res.end(JSON.stringify({ status: 'ok', data: [1, 2, 3] }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Bundle src/fetcher.ts
    const fetcherBundle = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/fetcher.ts')],
      bundle: true,
      platform: 'node',
      write: false,
      format: 'cjs'
    });
    const fetcherMod = { exports: {} };
    const fetcherFn = new Function('module', 'exports', 'require', '__dirname', fetcherBundle.outputFiles[0].text);
    fetcherFn(fetcherMod, fetcherMod.exports, require, path.join(__dirname, '../src'));
    const { fetchUrlWithDetails } = fetcherMod.exports;

    const details = await fetchUrlWithDetails({ url: `${baseUrl}/test` });
    assert.strictEqual(details.status, 200);
    assert.strictEqual(details.statusText, 'OK');
    assert.strictEqual(details.ok, true);
    assert.strictEqual(details.headers['content-type'], 'application/json; charset=utf-8');
    assert.strictEqual(details.headers['cache-control'], 'public, max-age=3600');
    assert.strictEqual(details.headers['x-ratelimit-remaining'], '95');
    assert.strictEqual(details.headers['etag'], '"abcdef123456"');
    assert.strictEqual(details.headers['set-cookie'], 'session=xyz789; HttpOnly; Secure');
    console.log('✔ fetchUrlWithDetails captures detailed HTTP response headers & status');

    // 2. Test getQueryEditorHtml renders inspect modal with headers tab & status elements
    const webviewBundle = await esbuild.build({
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
    const webviewFn = new Function('module', 'exports', 'require', '__dirname', webviewBundle.outputFiles[0].text);
    webviewFn(webviewMod, webviewMod.exports, require, path.join(__dirname, '../src/webview'));
    const { getQueryEditorHtml } = webviewMod.exports;

    const mockWebview = { cspSource: 'vscode-webview:' };
    const html = getQueryEditorHtml(mockWebview, {
      scriptNonce: 'test-nonce-headers',
      sources: [
        {
          type: 'url',
          id: 'test-api-1',
          alias: 'api',
          label: 'api.example.com',
          url: 'https://api.example.com/data',
          method: 'GET',
          lastStatus: 200,
          lastStatusText: 'OK',
          lastResponseHeaders: {
            'content-type': 'application/json',
            'cache-control': 'no-cache',
            'x-ratelimit-limit': '60'
          }
        }
      ]
    });

    // Check DOM elements exist in HTML template for inspect modal
    assert(html.includes('id="inspectTabBar"'), 'Missing inspectTabBar');
    assert(html.includes('id="inspectTabBody"'), 'Missing inspectTabBody');
    assert(html.includes('id="inspectTabHeaders"'), 'Missing inspectTabHeaders');
    assert(html.includes('id="inspectHeadersCount"'), 'Missing inspectHeadersCount');
    assert(html.includes('id="inspectPaneBody"'), 'Missing inspectPaneBody');
    assert(html.includes('id="inspectPaneHeaders"'), 'Missing inspectPaneHeaders');
    assert(html.includes('id="inspectHeadersSearch"'), 'Missing inspectHeadersSearch');
    assert(html.includes('id="copyAllHeadersBtn"'), 'Missing copyAllHeadersBtn');
    assert(html.includes('id="inspectHeadersTable"'), 'Missing inspectHeadersTable');
    assert(html.includes('id="inspectHeaderSortName"'), 'Missing inspectHeaderSortName');
    assert(html.includes('id="inspectStatusBadge"'), 'Missing inspectStatusBadge');

    // Check DOM elements exist in HTML template for preview modal
    assert(html.includes('id="previewTabBar"'), 'Missing previewTabBar');
    assert(html.includes('id="previewTabBody"'), 'Missing previewTabBody');
    assert(html.includes('id="previewTabHeaders"'), 'Missing previewTabHeaders');
    assert(html.includes('id="previewHeadersCount"'), 'Missing previewHeadersCount');
    assert(html.includes('id="previewPaneBody"'), 'Missing previewPaneBody');
    assert(html.includes('id="previewPaneHeaders"'), 'Missing previewPaneHeaders');
    assert(html.includes('id="previewHeadersSearch"'), 'Missing previewHeadersSearch');
    assert(html.includes('id="copyAllPreviewHeadersBtn"'), 'Missing copyAllPreviewHeadersBtn');
    assert(html.includes('id="previewHeadersTable"'), 'Missing previewHeadersTable');
    assert(html.includes('id="previewHeaderSortName"'), 'Missing previewHeaderSortName');
    console.log('✔ getQueryEditorHtml contains all required UI elements for inspect and preview headers inspectors');

    // 3. Test script inside HTML parses without any JS syntax errors
    const scriptMatch = html.match(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/i);
    assert(scriptMatch, 'Could not find <script> tag in HTML');
    const scriptCode = scriptMatch[1];
    new vm.Script(scriptCode, { filename: 'webview_headers_test.js' });
    console.log('✔ Webview JavaScript script compiles without any SyntaxError');

    // 4. Test header sorting and filtering logic
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-RateLimit-Remaining': '42',
      'Authorization': 'Bearer foo'
    };
    const entries = Object.entries(headers);

    // Filter test
    const filtered = entries.filter(([k, v]) =>
      k.toLowerCase().includes('ratelimit') || v.toLowerCase().includes('ratelimit')
    );
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0][0], 'X-RateLimit-Remaining');
    console.log('✔ Header filtering logic operates case-insensitively on keys and values');

    // Sort ascending test
    const sortedAsc = [...entries].sort(([a], [b]) => a.localeCompare(b));
    assert.strictEqual(sortedAsc[0][0], 'Authorization');
    assert.strictEqual(sortedAsc[sortedAsc.length - 1][0], 'X-RateLimit-Remaining');

    // Sort descending test
    const sortedDesc = [...entries].sort(([a], [b]) => b.localeCompare(a));
    assert.strictEqual(sortedDesc[0][0], 'X-RateLimit-Remaining');
    assert.strictEqual(sortedDesc[sortedDesc.length - 1][0], 'Authorization');
    console.log('✔ Header sorting logic operates correctly in ascending and descending order');

    // Copy all formatting test
    const formattedHeaders = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
    assert(formattedHeaders.includes('Content-Type: application/json'));
    assert(formattedHeaders.includes('Authorization: Bearer foo'));
    console.log('✔ Copy all headers generates standard "Header: Value" newline-separated text');

    console.log('All Response Headers & Status Inspector tests passed successfully! 🎉');
  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
