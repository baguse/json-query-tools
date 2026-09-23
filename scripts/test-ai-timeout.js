const assert = require('assert');
const http = require('http');
const esbuild = require('esbuild');
const path = require('path');

async function runAiTimeoutTests() {
  console.log('Testing AI generation timeout and cancellation (#1.12)...');

  // Bundle src/ai.ts in memory
  const buildResult = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/ai.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const bundledCode = buildResult.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { callOllama, callGemini, fetchOllamaModels, fetchGeminiModels } = mod.exports;

  // Start a local test HTTP server to simulate hanging, slow, and fast endpoints
  let serverMode = 'hang'; // 'hang' | 'fast'
  const server = http.createServer((req, res) => {
    if (serverMode === 'hang') {
      // Deliberately do not respond, simulating hanging endpoint / network stall
      return;
    }
    if (serverMode === 'fast') {
      if (req.url.includes('/api/generate')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: 'return data.filter(x => x.ok);' }));
      } else if (req.url.includes('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3:latest' }] }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'return data.map(x => x.id);' }] } }]
        }));
      }
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. callOllama timeout when endpoint hangs
    serverMode = 'hang';
    let ollamaTimeoutThrew = false;
    const startOllama = Date.now();
    try {
      await callOllama(baseUrl, 'llama3', 'filter active users', '{}', 100);
    } catch (err) {
      ollamaTimeoutThrew = true;
      assert.ok(
        err.message.includes('timed out after'),
        `Expected timeout error message, got: ${err.message}`
      );
    }
    const elapsedOllama = Date.now() - startOllama;
    assert.ok(ollamaTimeoutThrew, 'callOllama must reject on timeout');
    assert.ok(elapsedOllama < 500, `callOllama timeout should fire promptly, took ${elapsedOllama}ms`);
    console.log(`  ✓ callOllama times out cleanly after specified duration (${elapsedOllama}ms)`);

    // 2. callGemini timeout when endpoint hangs
    let geminiTimeoutThrew = false;
    const startGemini = Date.now();
    try {
      await callGemini('test-key', 'gemini-1.5-flash', 'filter active users', '{}', 100, undefined, baseUrl);
    } catch (err) {
      geminiTimeoutThrew = true;
      assert.ok(
        err.message.includes('timed out after'),
        `Expected timeout error message, got: ${err.message}`
      );
    }
    const elapsedGemini = Date.now() - startGemini;
    assert.ok(geminiTimeoutThrew, 'callGemini must reject on timeout');
    assert.ok(elapsedGemini < 500, `callGemini timeout should fire promptly, took ${elapsedGemini}ms`);
    console.log(`  ✓ callGemini times out cleanly after specified duration (${elapsedGemini}ms)`);

    // 3. callOllama cancellation via external AbortSignal
    const cancelControllerOllama = new AbortController();
    setTimeout(() => cancelControllerOllama.abort(), 30);
    let ollamaCancelThrew = false;
    try {
      await callOllama(baseUrl, 'llama3', 'test', '{}', 2000, cancelControllerOllama.signal);
    } catch (err) {
      ollamaCancelThrew = true;
      assert.ok(
        err.message.includes('canceled'),
        `Expected cancellation error, got: ${err.message}`
      );
    }
    assert.ok(ollamaCancelThrew, 'callOllama must abort when external signal triggers');
    console.log('  ✓ callOllama aborts immediately on external cancellation signal');

    // 4. callGemini cancellation via external AbortSignal
    const cancelControllerGemini = new AbortController();
    setTimeout(() => cancelControllerGemini.abort(), 30);
    let geminiCancelThrew = false;
    try {
      await callGemini('test-key', 'model', 'test', '{}', 2000, cancelControllerGemini.signal, baseUrl);
    } catch (err) {
      geminiCancelThrew = true;
      assert.ok(
        err.message.includes('canceled'),
        `Expected cancellation error, got: ${err.message}`
      );
    }
    assert.ok(geminiCancelThrew, 'callGemini must abort when external signal triggers');
    console.log('  ✓ callGemini aborts immediately on external cancellation signal');

    // 5. fetchOllamaModels timeout when endpoint hangs
    const startFetchOllama = Date.now();
    const ollamaModels = await fetchOllamaModels(baseUrl, 100);
    const elapsedFetchOllama = Date.now() - startFetchOllama;
    assert.deepStrictEqual(ollamaModels, [], 'fetchOllamaModels must return empty array on timeout');
    assert.ok(elapsedFetchOllama < 500, `fetchOllamaModels timeout should fire promptly, took ${elapsedFetchOllama}ms`);
    console.log(`  ✓ fetchOllamaModels recovers gracefully on timeout (${elapsedFetchOllama}ms)`);

    // 6. Fast response succeeds within timeout
    serverMode = 'fast';
    const ollamaFastResult = await callOllama(baseUrl, 'llama3', 'test', '{}', 2000);
    assert.strictEqual(ollamaFastResult, 'return data.filter(x => x.ok);');
    console.log('  ✓ callOllama completes normally when response is received within timeout');

    console.log('\n✅ All AI timeout and cancellation tests passed successfully!');
  } finally {
    server.close();
  }
}

runAiTimeoutTests().catch(err => {
  console.error('Fatal error during AI timeout tests:', err);
  process.exit(1);
});
