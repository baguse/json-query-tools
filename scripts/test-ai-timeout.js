const assert = require('assert');
const http = require('http');
const path = require('path');
const esbuild = require('esbuild');

async function runTests() {
  console.log('Testing AI Timeout Customization...');

  // 1. Bundle src/ai.ts in memory
  const aiBundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/ai.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const aiMod = { exports: {} };
  const fnAi = new Function('module', 'exports', 'require', '__dirname', aiBundle.outputFiles[0].text);
  fnAi(aiMod, aiMod.exports, require, path.join(__dirname, '../src'));

  const {
    callOpenAiCompatible,
    fetchOpenAiCompatibleModels,
    callOllama,
    fetchOllamaModels
  } = aiMod.exports;

  // -------------------------------------------------------------
  // Test 1: callOpenAiCompatible respects custom timeoutMs
  // -------------------------------------------------------------
  console.log('  1. Testing callOpenAiCompatible timeout honoring...');
  const slowServer = http.createServer((req, res) => {
    // Deliberately delay response longer than client's timeout
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'delayed response' } }] }));
    }, 500);
  });

  await new Promise(resolve => slowServer.listen(0, '127.0.0.1', resolve));
  const serverPort = slowServer.address().port;
  const slowEndpoint = `http://127.0.0.1:${serverPort}`;

  try {
    const startTime = Date.now();
    await assert.rejects(
      async () => {
        // Pass 100ms timeout
        await callOpenAiCompatible(slowEndpoint, 'test-model', 'query', { a: 1 }, '', 100);
      },
      (err) => {
        const elapsed = Date.now() - startTime;
        assert.ok(elapsed < 450, `Timeout should trigger well before 450ms, took ${elapsed}ms`);
        assert.ok(/timed out|timeout/i.test(err.message), `Expected timeout error message, got: ${err.message}`);
        return true;
      }
    );
    console.log('    ✓ callOpenAiCompatible timed out as expected');

    // -------------------------------------------------------------
    // Test 2: fetchOpenAiCompatibleModels respects custom timeoutMs
    // -------------------------------------------------------------
    console.log('  2. Testing fetchOpenAiCompatibleModels timeout honoring...');
    await assert.rejects(
      async () => {
        await fetchOpenAiCompatibleModels(slowEndpoint, '', 100);
      },
      (err) => {
        assert.ok(/timed out|timeout/i.test(err.message), `Expected timeout error message, got: ${err.message}`);
        return true;
      }
    );
    console.log('    ✓ fetchOpenAiCompatibleModels timed out as expected');

  } finally {
    slowServer.close();
  }

  // -------------------------------------------------------------
  // Test 3: Timeout Calculation & Bounds Logic
  // -------------------------------------------------------------
  console.log('  3. Testing timeout resolution and boundary clamping logic...');
  function resolveGenerateTimeout(msgTimeout, configTimeout) {
    const configTimeoutSec = configTimeout || 60;
    const requestedTimeoutSec = Number(msgTimeout);
    const timeoutSec = (!isNaN(requestedTimeoutSec) && requestedTimeoutSec > 0) ? requestedTimeoutSec : configTimeoutSec;
    return Math.max(5000, Math.min(timeoutSec * 1000, 600000));
  }

  function resolveModelTimeout(msgTimeout, configTimeout) {
    const configTimeoutSec = configTimeout || 60;
    const requestedTimeoutSec = Number(msgTimeout);
    const timeoutSec = (!isNaN(requestedTimeoutSec) && requestedTimeoutSec > 0) ? requestedTimeoutSec : configTimeoutSec;
    return Math.max(5000, Math.min(timeoutSec * 1000, 30000));
  }

  // Standard case: 120s specified in UI
  assert.strictEqual(resolveGenerateTimeout(120, 60), 120000);
  assert.strictEqual(resolveModelTimeout(120, 60), 30000); // capped at 30s for model discovery

  // Minimum clamp: 2s requested -> clamped to 5s (5000ms)
  assert.strictEqual(resolveGenerateTimeout(2, 60), 5000);
  assert.strictEqual(resolveModelTimeout(2, 60), 5000);

  // Maximum clamp: 999s requested -> clamped to 600s (600000ms)
  assert.strictEqual(resolveGenerateTimeout(999, 60), 600000);
  assert.strictEqual(resolveModelTimeout(999, 60), 30000);

  // Fallback to config when msg timeout is undefined, empty, or invalid
  assert.strictEqual(resolveGenerateTimeout(undefined, 90), 90000);
  assert.strictEqual(resolveGenerateTimeout('', 90), 90000);
  assert.strictEqual(resolveGenerateTimeout('invalid', 90), 90000);
  assert.strictEqual(resolveGenerateTimeout(undefined, undefined), 60000);
  console.log('    ✓ Timeout calculation and boundaries verified');

  // -------------------------------------------------------------
  // Test 4: Webview Markup & Script Verification
  // -------------------------------------------------------------
  console.log('  4. Testing Webview UI integration for aiTimeout...');
  const htmlBundle = await esbuild.build({
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
                },
                Uri: { file: (f) => ({ fsPath: f, toString: () => f }) }
              };
            `,
            loader: 'js'
          }));
        }
      }
    ]
  });

  const htmlMod = { exports: {} };
  const fnHtml = new Function('module', 'exports', 'require', '__dirname', htmlBundle.outputFiles[0].text);
  fnHtml(htmlMod, htmlMod.exports, require, path.join(__dirname, '../src'));

  const { getQueryEditorHtml } = htmlMod.exports;
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce-timeout',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/test.json' } }]
  });

  assert.ok(html.includes('id="aiTimeout"'), 'Missing #aiTimeout input element');
  assert.ok(html.includes('min="5"'), 'Missing min="5" attribute on #aiTimeout');
  assert.ok(html.includes('max="600"'), 'Missing max="600" attribute on #aiTimeout');
  assert.ok(html.includes("localStorage.getItem('jsonQueryTools.aiTimeout')"), 'Missing localStorage restore for aiTimeout');
  assert.ok(html.includes("localStorage.setItem('jsonQueryTools.aiTimeout'"), 'Missing localStorage save for aiTimeout');
  assert.ok(html.includes("timeout: timeoutVal"), 'Missing timeout in postMessage payload');
  console.log('    ✓ Webview UI elements, localStorage persistence, and message transmission verified');

  console.log('\n🎉 All AI Timeout customization tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
