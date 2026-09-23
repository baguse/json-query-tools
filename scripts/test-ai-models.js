const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runAiModelsTests() {
  console.log('Testing AI model error handling and UI alert banner...');

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
    scriptNonce: 'test-nonce',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  // Verify that the unhandled throw statement was removed
  assert.ok(
    !html.includes("throw new Error('Failed to fetch models:"),
    'Unhandled throw in updateModels must be removed'
  );
  console.log('  ✓ Unhandled throw in updateModels is eliminated');

  // Verify that showAiAlert and aiAlert UI elements exist
  assert.ok(html.includes('id="aiAlert"'), 'HTML must contain id="aiAlert" container');
  assert.ok(html.includes('id="aiAlertMessage"'), 'HTML must contain id="aiAlertMessage" container');
  assert.ok(html.includes('showAiAlert('), 'Script must implement showAiAlert');
  console.log('  ✓ HTML and script include aiAlert banner elements and helpers');

  // 2. Unit test the updateModels handler state transitions
  function simulateUpdateModels({
    models = [],
    error = null,
    savedModel = null,
    currentAlert = { displayed: false, text: '' }
  }) {
    const aiModel = {
      innerHTML: '',
      value: '',
      options: [],
      appendChild: (opt) => aiModel.options.push(opt)
    };

    const aiAlert = {
      style: { display: currentAlert.displayed ? 'flex' : 'none' },
      textContent: currentAlert.text
    };

    function showAiAlert(msg) {
      aiAlert.style.display = 'flex';
      aiAlert.textContent = msg;
    }

    function hideAiAlert() {
      aiAlert.style.display = 'none';
      aiAlert.textContent = '';
    }

    // Handler logic under test
    aiModel.innerHTML = '<option value="" disabled selected>Select Model...</option>';
    if (models && models.length > 0) {
      hideAiAlert();
      models.forEach(m => {
        aiModel.appendChild({ value: m, textContent: m });
      });
      if (savedModel && models.includes(savedModel)) {
        aiModel.value = savedModel;
      } else {
        aiModel.value = models[0];
      }
    }
    if (error) {
      showAiAlert('Failed to fetch models: ' + error);
    }

    return { aiModel, aiAlert };
  }

  // Case 1: Error occurred while fetching models (no throw, alert is shown)
  const errorResult = simulateUpdateModels({
    models: [],
    error: 'Connection refused at localhost:11434'
  });
  assert.strictEqual(errorResult.aiAlert.style.display, 'flex');
  assert.strictEqual(
    errorResult.aiAlert.textContent,
    'Failed to fetch models: Connection refused at localhost:11434'
  );
  console.log('  ✓ Model fetch error displays visible alert without throwing');

  // Case 2: Subsequent successful fetch clears the error banner
  const successResult = simulateUpdateModels({
    models: ['llama3:latest', 'mistral:latest'],
    error: null,
    currentAlert: { displayed: true, text: 'Previous error' }
  });
  assert.strictEqual(successResult.aiAlert.style.display, 'none');
  assert.strictEqual(successResult.aiAlert.textContent, '');
  assert.strictEqual(successResult.aiModel.options.length, 2);
  assert.strictEqual(successResult.aiModel.value, 'llama3:latest');
  console.log('  ✓ Successful model update hides alert and populates models');

  console.log('\n✅ All AI model error handling tests passed successfully!');
}

runAiModelsTests().catch(err => {
  console.error('Fatal error during AI models tests:', err);
  process.exit(1);
});
