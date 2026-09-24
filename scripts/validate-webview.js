const esbuild = require('esbuild');
const vm = require('vm');
const path = require('path');

async function validate() {
  console.log('Validating webview scripts syntax...');

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

  // 2. Evaluate module in sandbox to obtain getQueryEditorHtml
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src/webview'));

  const { getQueryEditorHtml } = mod.exports;

  if (typeof getQueryEditorHtml !== 'function') {
    console.error('FAIL: getQueryEditorHtml is not exported.');
    process.exit(1);
  }

  // 3. Test multiple scenarios
  const testCases = [
    {
      name: 'Default File Source',
      params: {
        scriptNonce: 'test-nonce-1',
        boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/sample.json' } }]
      }
    },
    {
      name: 'URL Source with Headers',
      params: {
        scriptNonce: 'test-nonce-2',
        sources: [
          {
            type: 'url',
            id: 'test-url-1',
            alias: 'apiData',
            label: 'api.example.com',
            url: 'https://api.example.com/v1/data',
            method: 'GET',
            headers: { 'Authorization': 'Bearer secret', 'X-Custom': '123' },
            body: ''
          }
        ]
      }
    },
    {
      name: 'Standalone Mode (No Sources)',
      params: {
        scriptNonce: 'test-nonce-3',
        sources: []
      }
    }
  ];

  let hasErrors = false;

  for (const tc of testCases) {
    const mockWebview = { cspSource: 'vscode-webview:' };
    const html = getQueryEditorHtml(mockWebview, tc.params);

    // Verify key UI elements exist in HTML
    const requiredElements = [
      'id="urlModalPreview"',
      'id="testUrlModal"',
      'id="sourceInspectModal"',
      'id="openResultInEditorBtn"',
      'id="openInspectInEditorBtn"',
      'id="inspectDataPre"',
      'id="tabBtnParams"',
      'id="tabBtnHeaders"',
      'id="queryParamsTable"',
      'id="queryParamsBody"',
      'id="addParamRowBtn"',
      'id="aiAlert"',
      'id="aiAlertMessage"',
      'id="tablePagination"',
      'id="tablePageSize"',
      'id="tablePrevPage"',
      'id="tableNextPage"',
      'id="tablePageInput"',
      'id="tableTotalPages"',
      'id="importCurlBtn"',
      'id="copyCurlBtn"',
      'id="curlImportPanel"',
      'id="copyInspectCurlBtn"',
      'id="inspectTabBar"',
      'id="inspectTabBody"',
      'id="inspectTabHeaders"',
      'id="inspectPaneBody"',
      'id="inspectPaneHeaders"',
      'id="inspectHeadersTable"',
      'id="inspectStatusBadge"',
      'id="copyAllHeadersBtn"',
      'id="previewTabBar"',
      'id="previewTabBody"',
      'id="previewTabHeaders"',
      'id="previewPaneBody"',
      'id="previewPaneHeaders"',
      'id="previewHeadersTable"',
      'id="copyAllPreviewHeadersBtn"',
      'id="previewHeadersSearch"',
      'class="search-icon">&#128269;</span>'
    ];

    for (const elem of requiredElements) {
      if (!html.includes(elem)) {
        hasErrors = true;
        console.error(`\n❌ Missing expected UI element ${elem} in [${tc.name}]`);
      }
    }

    if (html.includes('\uFFFD')) {
      hasErrors = true;
      console.error(`\n❌ Found corrupted Unicode replacement character (\\uFFFD) in [${tc.name}] HTML output`);
    }

    // Extract all <script> contents
    const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
    let match;
    let scriptIndex = 1;

    while ((match = scriptRegex.exec(html)) !== null) {
      const scriptContent = match[1];
      if (!scriptContent.trim()) continue;

      try {
        new vm.Script(scriptContent, { filename: `${tc.name.replace(/\s+/g, '_')}_script_${scriptIndex}.js` });
        console.log(`  ✓ [${tc.name}] Script tag #${scriptIndex} syntax is valid.`);
      } catch (err) {
        hasErrors = true;
        console.error(`\n❌ SYNTAX ERROR in [${tc.name}] Script tag #${scriptIndex}:`);
        console.error(err);
      }
      scriptIndex++;
    }
  }

  if (hasErrors) {
    console.error('\n❌ Webview script syntax validation FAILED.');
    process.exit(1);
  } else {
    console.log('\n✅ All webview scripts passed JavaScript syntax validation successfully!');
  }
}

validate().catch(err => {
  console.error('Fatal error during validation:', err);
  process.exit(1);
});
