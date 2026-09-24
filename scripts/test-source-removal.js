const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function runSourceRemovalTests() {
  console.log('Testing symmetrical source deletion UI and backend handling...');

  // 1. Bundle webview HTML generator in memory
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

  // Test Case 1: Single file source with alias 'data' (previously prevented deletion)
  const singleFileHtml = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  assert.ok(
    singleFileHtml.includes('class="remove-source" data-alias="data"'),
    'Expected sole file source with alias "data" to have a remove button'
  );
  assert.ok(
    singleFileHtml.includes('aria-label="Remove source"'),
    'Expected remove button to include aria-label="Remove source"'
  );
  console.log('  ✓ Single file source with alias "data" renders remove button with aria-label');

  // Test Case 2: Single URL source with alias 'data'
  const singleUrlHtml = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce',
    sources: [{
      type: 'url',
      id: 'url-1',
      alias: 'data',
      url: 'https://api.example.com/items',
      method: 'GET'
    }]
  });

  assert.ok(
    singleUrlHtml.includes('class="remove-source" data-alias="data" data-id="url-1"'),
    'Expected sole URL source with alias "data" to have a remove button'
  );
  console.log('  ✓ Single URL source with alias "data" renders remove button with id');

  // Test Case 3: Verify dynamic renderSources in webview script contains remove buttons for both types
  assert.ok(
    singleFileHtml.includes('class="remove-source" data-alias="\' + escapeHtml(s.alias) + \'" title="Remove source" aria-label="Remove source">×'),
    'Expected dynamic renderSources to render remove button for file sources'
  );
  assert.ok(
    singleFileHtml.includes('class="remove-source" data-alias="\' + escapeHtml(s.alias) + \'" data-id="\' + escapeHtml(s.id || \'\') + \'" title="Remove source" aria-label="Remove source">×'),
    'Expected dynamic renderSources to render remove button for URL sources'
  );
  console.log('  ✓ Dynamic renderSources renders symmetric remove buttons for files and URLs');

  // Test Case 4: Verify click handler extracts alias and id from target or span
  assert.ok(
    singleFileHtml.includes("target.getAttribute('data-alias') || span?.getAttribute('data-alias')"),
    'Expected click handler to support attribute extraction from target or parent span'
  );
  console.log('  ✓ Webview click handler extracts alias/id reliably');

  // Test Case 5: Standalone mode (0 sources) shows standalone badge and no remove buttons in markup
  const standaloneHtml = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce',
    sources: []
  });
  const staticMarkup = standaloneHtml.split('<script')[0];
  assert.ok(
    staticMarkup.includes('⚡ Standalone Mode'),
    'Expected standalone tag in markup when no sources are bound'
  );
  assert.ok(
    !staticMarkup.includes('<button class="remove-source"'),
    'Expected no remove buttons rendered in markup when in standalone mode'
  );
  console.log('  ✓ Standalone mode displays indicator without remove buttons in markup');

  // Test Case 6: Simulate backend removeSource logic
  function simulateRemoveSource({ boundFiles, boundUrls, msg }) {
    let files = [...boundFiles];
    let urls = [...boundUrls];
    let removedUrl = false;

    if (msg.id) {
      const prevLen = urls.length;
      urls = urls.filter(u => u.id !== msg.id);
      if (urls.length !== prevLen) {
        removedUrl = true;
      }
    }
    if (!removedUrl && msg.alias) {
      files = files.filter(f => f.alias !== msg.alias);
      const urlIdx = urls.findIndex(u => u.alias === msg.alias);
      if (urlIdx !== -1) {
        urls.splice(urlIdx, 1);
      }
    }
    return { boundFiles: files, boundUrls: urls };
  }

  // Deleting sole file source
  const afterFileRemove = simulateRemoveSource({
    boundFiles: [{ alias: 'data', uri: '/workspace/data.json' }],
    boundUrls: [],
    msg: { type: 'removeSource', alias: 'data', id: null }
  });
  assert.strictEqual(afterFileRemove.boundFiles.length, 0, 'Sole file source should be removed');
  assert.strictEqual(afterFileRemove.boundUrls.length, 0);

  // Deleting sole URL source by id
  const afterUrlRemove = simulateRemoveSource({
    boundFiles: [],
    boundUrls: [{ id: 'url_123', alias: 'data', url: 'https://example.com' }],
    msg: { type: 'removeSource', alias: 'data', id: 'url_123' }
  });
  assert.strictEqual(afterUrlRemove.boundUrls.length, 0, 'Sole URL source should be removed');

  // Deleting sole URL source by alias fallback
  const afterUrlAliasRemove = simulateRemoveSource({
    boundFiles: [],
    boundUrls: [{ id: 'url_456', alias: 'apiData', url: 'https://example.com' }],
    msg: { type: 'removeSource', alias: 'apiData', id: null }
  });
  assert.strictEqual(afterUrlAliasRemove.boundUrls.length, 0, 'URL source should be removed by alias fallback');

  console.log('  ✓ Backend source removal simulation correctly clears files and URLs');

  console.log('\n✅ All symmetrical source deletion tests passed successfully!');
}

runSourceRemovalTests().catch(err => {
  console.error('\n❌ Source removal test failed:', err);
  process.exit(1);
});
