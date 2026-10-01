#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const http = require('http');
const esbuild = require('esbuild');

// Helper to make simple HTTP requests in tests
function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawBody: data
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runMockServerTests() {
  console.log('📡 Testing Instant Local Mock Server & Quick Stub Endpoint...');

  // 1. Bundle src/mockServer.ts with mock-vscode
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/mockServer.ts')],
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
            contents: 'module.exports = {};',
            loader: 'js'
          }));
        }
      }
    ]
  });

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { MockServerManager, filterArrayByQuery, matchesEndpoint } = mod.exports;

  assert.strictEqual(typeof MockServerManager, 'function', 'MockServerManager class must be exported');
  assert.strictEqual(typeof filterArrayByQuery, 'function', 'filterArrayByQuery must be exported');
  assert.strictEqual(typeof matchesEndpoint, 'function', 'matchesEndpoint must be exported');

  // Test Case 1: Route matching logic
  {
    console.log('  ✓ Test Case 1: Route endpoint matching helper');
    assert.strictEqual(matchesEndpoint('/api', '/api'), true);
    assert.strictEqual(matchesEndpoint('/api/', '/api'), true);
    assert.strictEqual(matchesEndpoint('/api/users', '/api'), true);
    assert.strictEqual(matchesEndpoint('/api/v1/items', '/api'), true);
    assert.strictEqual(matchesEndpoint('/other', '/api'), false);
    assert.strictEqual(matchesEndpoint('/api-foo', '/api'), false);
    assert.strictEqual(matchesEndpoint('/anything', '/'), true);
  }

  // Test Case 2: Array query filtering & pagination helper
  {
    console.log('  ✓ Test Case 2: Array query parameter filtering, sorting, and pagination');
    const items = [
      { id: 1, name: 'Apple', category: 'fruit', price: 1.5, active: true },
      { id: 2, name: 'Banana', category: 'fruit', price: 0.8, active: true },
      { id: 3, name: 'Carrot', category: 'vegetable', price: 1.2, active: false },
      { id: 4, name: 'Donut', category: 'bakery', price: 2.5, active: true }
    ];

    // Filter by field
    const fruits = filterArrayByQuery(items, { category: 'fruit' });
    assert.strictEqual(fruits.length, 2);
    assert.strictEqual(fruits[0].name, 'Apple');
    assert.strictEqual(fruits[1].name, 'Banana');

    // Filter by boolean
    const activeOnly = filterArrayByQuery(items, { active: 'true' });
    assert.strictEqual(activeOnly.length, 3);

    // Limit and offset
    const page = filterArrayByQuery(items, { offset: '1', limit: '2' });
    assert.strictEqual(page.length, 2);
    assert.strictEqual(page[0].name, 'Banana');
    assert.strictEqual(page[1].name, 'Carrot');

    // Sort ascending
    const sortedAsc = filterArrayByQuery(items, { sort: 'price' });
    assert.strictEqual(sortedAsc[0].name, 'Banana');
    assert.strictEqual(sortedAsc[sortedAsc.length - 1].name, 'Donut');

    // Sort descending
    const sortedDesc = filterArrayByQuery(items, { sort: '-price' });
    assert.strictEqual(sortedDesc[0].name, 'Donut');
    assert.strictEqual(sortedDesc[sortedDesc.length - 1].name, 'Banana');
  }

  // Test Case 3: Starting MockServer and serving static JSON with CORS
  const manager = new MockServerManager();
  const TEST_PORT = 3987;

  try {
    console.log('  ✓ Test Case 3: Serving static JSON payload with CORS headers');
    const sampleData = [
      { id: 10, title: 'Mock Item 1', category: 'books', price: 15 },
      { id: 20, title: 'Mock Item 2', category: 'games', price: 50 },
      { id: 30, title: 'Mock Item 3', category: 'books', price: 25 }
    ];

    manager.updatePayload(sampleData);

    const state = await manager.start({
      port: TEST_PORT,
      endpoint: '/api/v1',
      mode: 'static',
      autoFilter: true,
      statusCode: 200,
      cors: true
    });

    assert.strictEqual(state.isRunning, true);
    assert.strictEqual(state.port, TEST_PORT);
    assert.strictEqual(state.endpoint, '/api/v1');

    // Make GET request to /api/v1
    const res1 = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/v1',
      method: 'GET'
    });

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1.headers['access-control-allow-origin'], '*');
    assert.strictEqual(res1.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepStrictEqual(res1.body, sampleData);

    // Make OPTIONS preflight request
    const resOptions = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/v1',
      method: 'OPTIONS'
    });
    assert.strictEqual(resOptions.statusCode, 204);
    assert.strictEqual(resOptions.headers['access-control-allow-origin'], '*');

    // Make GET request with query params (?category=books&limit=1)
    const resFiltered = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/api/v1?category=books&limit=1',
      method: 'GET'
    });

    assert.strictEqual(resFiltered.statusCode, 200);
    assert.strictEqual(resFiltered.body.length, 1);
    assert.strictEqual(resFiltered.body[0].title, 'Mock Item 1');

    // Request non-existent endpoint
    const res404 = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/unmatched-route',
      method: 'GET'
    });
    assert.strictEqual(res404.statusCode, 404);
    assert.strictEqual(res404.body.error, 'Not Found');

    // Request root status info
    const resRoot = await httpRequest({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: '/',
      method: 'GET'
    });
    assert.strictEqual(resRoot.statusCode, 200);
    assert.strictEqual(resRoot.body.status, 'online');
  } finally {
    await manager.stop();
  }

  // Test Case 4: Dynamic Re-Evaluation Mode with request context
  try {
    console.log('  ✓ Test Case 4: Dynamic Live Evaluation mode receiving request context (query, body)');
    const DYNAMIC_PORT = 3988;

    const dynamicEvaluator = (reqContext) => {
      const multiplier = Number(reqContext.query.multiplier || 1);
      const postName = (reqContext.body && reqContext.body.name) || 'Anonymous';
      return {
        greeting: `Hello, ${postName}!`,
        calculated: 42 * multiplier,
        method: reqContext.method,
        query: reqContext.query
      };
    };

    await manager.start({
      port: DYNAMIC_PORT,
      endpoint: '/api/dynamic',
      mode: 'dynamic'
    }, dynamicEvaluator);

    const postRes = await httpRequest({
      hostname: '127.0.0.1',
      port: DYNAMIC_PORT,
      path: '/api/dynamic?multiplier=3',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, { name: 'Alice' });

    assert.strictEqual(postRes.statusCode, 200);
    assert.strictEqual(postRes.body.greeting, 'Hello, Alice!');
    assert.strictEqual(postRes.body.calculated, 126);
    assert.strictEqual(postRes.body.method, 'POST');
    assert.strictEqual(postRes.body.query.multiplier, '3');
  } finally {
    await manager.stop();
  }

  // Test Case 5: Latency simulation and Request Logging
  try {
    console.log('  ✓ Test Case 5: Simulated response latency and request log recording');
    const LATENCY_PORT = 3989;

    manager.updatePayload({ ok: true });
    await manager.start({
      port: LATENCY_PORT,
      endpoint: '/api/slow',
      mode: 'static',
      latencyMs: 50
    });

    const t0 = performance.now();
    const slowRes = await httpRequest({
      hostname: '127.0.0.1',
      port: LATENCY_PORT,
      path: '/api/slow',
      method: 'GET'
    });
    const elapsed = performance.now() - t0;

    assert.strictEqual(slowRes.statusCode, 200);
    assert.ok(elapsed >= 45, `Expected elapsed time >= 45ms, got ${elapsed}ms`);

    const currentState = manager.getState();
    assert.ok(currentState.requestCount >= 1, 'Request count should be tracked');
    assert.ok(currentState.logs.length >= 1, 'Logs should record incoming requests');
    assert.strictEqual(currentState.logs[0].path, '/api/slow');
    assert.strictEqual(currentState.logs[0].status, 200);
  } finally {
    await manager.stop();
  }

  // Test Case 6: Port collision fallback
  const firstServer = http.createServer((req, res) => res.end('occupied'));
  const COLLISION_PORT = 3990;

  try {
    console.log('  ✓ Test Case 6: Automatic port collision fallback (EADDRINUSE)');
    await new Promise(resolve => firstServer.listen(COLLISION_PORT, '127.0.0.1', resolve));

    // Start mock server targeting COLLISION_PORT; should auto-increment to COLLISION_PORT + 1
    const collState = await manager.start({
      port: COLLISION_PORT,
      endpoint: '/api'
    });

    assert.strictEqual(collState.isRunning, true);
    assert.strictEqual(collState.port, COLLISION_PORT + 1, 'Should bind to next available port');
  } finally {
    await manager.stop();
    await new Promise(resolve => firstServer.close(resolve));
  }

  // Test Case 7: Method enforcement & Custom HTTP request methods
  try {
    console.log('  ✓ Test Case 7: Method enforcement (405 Method Not Allowed) and Custom Request Method');
    const METHOD_PORT = 3991;

    // 7a. Configured for POST only
    await manager.start({
      port: METHOD_PORT,
      endpoint: '/api/submit',
      method: 'POST'
    });
    manager.updatePayload({ received: true });

    // Valid POST request
    const postRes = await httpRequest({
      hostname: '127.0.0.1',
      port: METHOD_PORT,
      path: '/api/submit',
      method: 'POST'
    });
    assert.strictEqual(postRes.statusCode, 200);
    assert.deepStrictEqual(postRes.body, { received: true });

    // Invalid GET request -> should return 405 Method Not Allowed with Allow header
    const getRes = await httpRequest({
      hostname: '127.0.0.1',
      port: METHOD_PORT,
      path: '/api/submit',
      method: 'GET'
    });
    assert.strictEqual(getRes.statusCode, 405);
    assert.strictEqual(getRes.headers['allow'], 'POST');
    assert.strictEqual(getRes.body.error, 'Method Not Allowed');

    // 7b. Configured with Custom Method (e.g. 'QUERY')
    const CUSTOM_PORT = 3992;
    await manager.start({
      port: CUSTOM_PORT,
      endpoint: '/api/graphql-custom',
      method: 'QUERY'
    });
    manager.updatePayload({ customMethod: 'OK' });

    // Valid QUERY request
    const queryRes = await httpRequest({
      hostname: '127.0.0.1',
      port: CUSTOM_PORT,
      path: '/api/graphql-custom',
      method: 'QUERY'
    });
    assert.strictEqual(queryRes.statusCode, 200);
    assert.deepStrictEqual(queryRes.body, { customMethod: 'OK' });

    // Invalid POST request -> should return 405 Method Not Allowed with Allow: QUERY
    const invalidPostRes = await httpRequest({
      hostname: '127.0.0.1',
      port: CUSTOM_PORT,
      path: '/api/graphql-custom',
      method: 'POST'
    });
    assert.strictEqual(invalidPostRes.statusCode, 405);
    assert.strictEqual(invalidPostRes.headers['allow'], 'QUERY');
  } finally {
    await manager.stop();
  }

  console.log('\n✅ All Instant Local Mock Server tests passed successfully!\n');
}

runMockServerTests().catch(err => {
  console.error('\n❌ Mock server test failed:', err);
  process.exit(1);
});
