const assert = require('assert');
const http = require('http');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function runGeminiAuthHeaderTests() {
  console.log('Testing Gemini API key passed via x-goog-api-key header (#1.13)...');

  // Verify static source does not leak ?key= into URLs
  const aiSource = fs.readFileSync(path.join(__dirname, '../src/ai.ts'), 'utf8');
  assert.ok(
    !aiSource.includes('?key='),
    'src/ai.ts must not contain query parameter ?key='
  );
  assert.ok(
    aiSource.includes("'x-goog-api-key': apiKey"),
    "src/ai.ts must use 'x-goog-api-key': apiKey header"
  );
  console.log('  ✓ Static analysis: ?key= query parameter eliminated from src/ai.ts');

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

  const { fetchGeminiModels, callGemini } = mod.exports;

  const capturedRequests = [];
  const TEST_API_KEY = 'AIzaSy_Secret_Gemini_Key_98765';

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      capturedRequests.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body
      });

      if (req.url.startsWith('/v1beta/models') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] }
          ]
        }));
      } else if (req.url.includes(':generateContent') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'return data.filter(x => x.active);' }] } }
          ]
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Test fetchGeminiModels authentication header
    const models = await fetchGeminiModels(TEST_API_KEY, 5000, baseUrl);
    assert.deepStrictEqual(models, ['gemini-1.5-flash']);
    assert.strictEqual(capturedRequests.length, 1);

    const modelReq = capturedRequests[0];
    assert.strictEqual(modelReq.method, 'GET');
    assert.strictEqual(modelReq.url, '/v1beta/models', 'URL must not contain ?key= query string');
    assert.ok(!modelReq.url.includes('key='), 'URL must not expose API key');
    assert.strictEqual(
      modelReq.headers['x-goog-api-key'],
      TEST_API_KEY,
      'x-goog-api-key header must contain the API key'
    );
    console.log('  ✓ fetchGeminiModels sends x-goog-api-key header without URL query param');

    // 2. Test callGemini authentication header
    capturedRequests.length = 0;
    const result = await callGemini(
      TEST_API_KEY,
      'gemini-1.5-flash',
      'active users',
      '[]',
      5000,
      undefined,
      baseUrl
    );
    assert.strictEqual(result, 'return data.filter(x => x.active);');
    assert.strictEqual(capturedRequests.length, 1);

    const callReq = capturedRequests[0];
    assert.strictEqual(callReq.method, 'POST');
    assert.strictEqual(
      callReq.url,
      '/v1beta/models/gemini-1.5-flash:generateContent',
      'URL must not contain ?key= query string'
    );
    assert.ok(!callReq.url.includes('key='), 'URL must not expose API key');
    assert.strictEqual(
      callReq.headers['x-goog-api-key'],
      TEST_API_KEY,
      'x-goog-api-key header must contain the API key'
    );
    assert.strictEqual(
      callReq.headers['content-type'],
      'application/json'
    );
    console.log('  ✓ callGemini sends x-goog-api-key header without URL query param');

    console.log('\n✅ All Gemini auth header tests passed successfully!');
  } finally {
    server.close();
  }
}

runGeminiAuthHeaderTests().catch(err => {
  console.error('Fatal error during Gemini auth header tests:', err);
  process.exit(1);
});
