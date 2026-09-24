const assert = require('assert');
const http = require('http');
const esbuild = require('esbuild');
const path = require('path');

async function runFetcherTests() {
  console.log('Testing fetcher functions...');

  // Bundle fetcher in memory
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/fetcher.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { parseHeaders, formatHeaders, fetchUrlWithDetails, fetchUrlData } = mod.exports;

  // 1. parseHeaders tests
  assert.deepStrictEqual(parseHeaders(''), {});
  assert.deepStrictEqual(parseHeaders(undefined), {});
  assert.deepStrictEqual(parseHeaders({ 'X-Key': 'Val' }), { 'X-Key': 'Val' });
  assert.deepStrictEqual(
    parseHeaders('Authorization: Bearer test\nContent-Type: application/json'),
    { 'Authorization': 'Bearer test', 'Content-Type': 'application/json' }
  );
  assert.deepStrictEqual(
    parseHeaders('{"Authorization": "Bearer json-token", "X-Custom": "123"}'),
    { 'Authorization': 'Bearer json-token', 'X-Custom': '123' }
  );
  assert.deepStrictEqual(
    parseHeaders('{\n  // Auth token\n  "Authorization": "Bearer json-token",\n  /* custom header */\n  "X-Custom": "123",\n}'),
    { 'Authorization': 'Bearer json-token', 'X-Custom': '123' }
  );
  console.log('  ✓ parseHeaders passes all checks');

  // 2. formatHeaders tests
  assert.strictEqual(formatHeaders({ A: '1', B: '2' }), 'A: 1\nB: 2');
  console.log('  ✓ formatHeaders passes check');

  // 3. Invalid URL validation tests
  await assert.rejects(
    () => fetchUrlWithDetails({ url: '' }),
    /URL cannot be empty/
  );
  await assert.rejects(
    () => fetchUrlWithDetails({ url: 'ftp://files.example.com' }),
    /Unsupported protocol/
  );
  console.log('  ✓ URL validation rejected invalid protocols properly');

  // 4. Live local HTTP mock server tests
  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Server': 'Mock' });
      res.end(JSON.stringify({ status: 'success', items: [1, 2, 3] }));
    } else if (req.url === '/jsonc') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(`// Configuration file
{
  "name": "json-tools",
  // Single-line comment
  "features": [
    "json",
    "jsonc", // Trailing comma in array
  ],
  /* Multi-line
     comment */
  "nested": {
    "url": "https://api.example.com//test/*literal*/",
    "enabled": true,
  }, // Trailing comma in object
}`);
    } else if (req.url === '/no-content') {
      res.writeHead(204);
      res.end();
    } else if (req.url === '/text') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello Plain Text');
    } else if (req.url === '/echo') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          method: req.method,
          headers: req.headers,
          body: body ? JSON.parse(body) : null
        }));
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test JSON response
    const jsonRes = await fetchUrlWithDetails({ url: `${baseUrl}/json` });
    assert.strictEqual(jsonRes.status, 200);
    assert.strictEqual(jsonRes.ok, true);
    assert.deepStrictEqual(jsonRes.data, { status: 'success', items: [1, 2, 3] });
    assert.strictEqual(jsonRes.headers['x-server'], 'Mock');
    assert(jsonRes.timeMs >= 0);
    assert(jsonRes.sizeBytes > 0);
    console.log('  ✓ fetchUrlWithDetails returns JSON, headers, size, time');

    // Test JSONC response (comments and trailing commas)
    const jsoncRes = await fetchUrlWithDetails({ url: `${baseUrl}/jsonc` });
    assert.strictEqual(jsoncRes.status, 200);
    assert.strictEqual(jsoncRes.ok, true);
    assert.deepStrictEqual(jsoncRes.data, {
      name: 'json-tools',
      features: ['json', 'jsonc'],
      nested: {
        url: 'https://api.example.com//test/*literal*/',
        enabled: true
      }
    });
    const jsoncData = await fetchUrlData({ url: `${baseUrl}/jsonc` });
    assert.deepStrictEqual(jsoncData, {
      name: 'json-tools',
      features: ['json', 'jsonc'],
      nested: {
        url: 'https://api.example.com//test/*literal*/',
        enabled: true
      }
    });
    console.log('  ✓ fetchUrlWithDetails and fetchUrlData parse JSONC payloads with comments & trailing commas');

    // Test 204 No Content
    const noContentRes = await fetchUrlWithDetails({ url: `${baseUrl}/no-content` });
    assert.strictEqual(noContentRes.status, 204);
    assert.strictEqual(noContentRes.ok, true);
    assert.strictEqual(noContentRes.data, null);
    assert.strictEqual(noContentRes.sizeBytes, 0);
    console.log('  ✓ fetchUrlWithDetails handles 204 No Content');

    // Test Plain Text
    const textRes = await fetchUrlWithDetails({ url: `${baseUrl}/text` });
    assert.strictEqual(textRes.status, 200);
    assert.strictEqual(textRes.data, 'Hello Plain Text');
    console.log('  ✓ fetchUrlWithDetails handles raw text');

    // Test POST with headers and body
    const echoRes = await fetchUrlWithDetails({
      url: `${baseUrl}/echo`,
      method: 'POST',
      headers: 'X-App-Id: test-client\nContent-Type: application/json',
      body: JSON.stringify({ hello: 'world' })
    });
    assert.strictEqual(echoRes.status, 200);
    assert.strictEqual(echoRes.data.method, 'POST');
    assert.strictEqual(echoRes.data.headers['x-app-id'], 'test-client');
    assert.deepStrictEqual(echoRes.data.body, { hello: 'world' });
    console.log('  ✓ fetchUrlWithDetails handles POST with custom headers and body');

    // Test 404 via fetchUrlData
    await assert.rejects(
      () => fetchUrlData({ url: `${baseUrl}/not-found` }),
      /HTTP 404/
    );
    console.log('  ✓ fetchUrlData throws on non-2xx response');

    // Test template variables in URL, headers, and body
    process.env.JSON_TOOLS_FETCHER_KEY = 'secret-fetcher-token';
    const templatedRes = await fetchUrlWithDetails({
      url: '{{mockBase}}/echo',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{$env.JSON_TOOLS_FETCHER_KEY}}',
        'X-Service': '{{serviceName}}'
      },
      body: JSON.stringify({ path: '{{pathname}}', token: '{{$env.JSON_TOOLS_FETCHER_KEY}}' }),
      templateVariables: {
        mockBase: baseUrl,
        serviceName: 'my-microservice'
      }
    });
    assert.strictEqual(templatedRes.status, 200);
    assert.strictEqual(templatedRes.data.headers['authorization'], 'Bearer secret-fetcher-token');
    assert.strictEqual(templatedRes.data.headers['x-service'], 'my-microservice');
    assert.deepStrictEqual(templatedRes.data.body, { path: '/echo', token: 'secret-fetcher-token' });
    delete process.env.JSON_TOOLS_FETCHER_KEY;
    console.log('  ✓ fetchUrlWithDetails dynamically resolves template variables in URL, headers, and body');

  } finally {
    server.close();
  }

  console.log('\n✅ All fetcher tests passed successfully!');
}

runFetcherTests().catch(err => {
  console.error('Fetcher test error:', err);
  process.exit(1);
});
