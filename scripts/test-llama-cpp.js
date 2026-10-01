const assert = require('assert');
const http = require('http');
const path = require('path');
const esbuild = require('esbuild');

async function runTests() {
  console.log('Testing llama.cpp / OpenAI-Compatible AI Provider Integration...');

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
    getOpenAiUrls,
    fetchOpenAiCompatibleModels,
    callOpenAiCompatible,
    stripMarkdownCode
  } = aiMod.exports;

  // -------------------------------------------------------------
  // Test 1: URL Auto-Normalization
  // -------------------------------------------------------------
  console.log('  1. Testing endpoint URL auto-normalization...');
  {
    // Case A: Full /v1/models URL as provided by user
    const u1 = getOpenAiUrls('http://192.168.1.23:8081/v1/models');
    assert.strictEqual(u1.baseUrl, 'http://192.168.1.23:8081/v1');
    assert.strictEqual(u1.modelsUrl, 'http://192.168.1.23:8081/v1/models');
    assert.strictEqual(u1.chatUrl, 'http://192.168.1.23:8081/v1/chat/completions');

    // Case B: URL with /v1
    const u2 = getOpenAiUrls('http://192.168.1.23:8081/v1');
    assert.strictEqual(u2.baseUrl, 'http://192.168.1.23:8081/v1');
    assert.strictEqual(u2.modelsUrl, 'http://192.168.1.23:8081/v1/models');
    assert.strictEqual(u2.chatUrl, 'http://192.168.1.23:8081/v1/chat/completions');

    // Case C: Base URL without /v1
    const u3 = getOpenAiUrls('http://192.168.1.23:8081');
    assert.strictEqual(u3.baseUrl, 'http://192.168.1.23:8081/v1');
    assert.strictEqual(u3.modelsUrl, 'http://192.168.1.23:8081/v1/models');
    assert.strictEqual(u3.chatUrl, 'http://192.168.1.23:8081/v1/chat/completions');

    // Case D: Trailing slash handling
    const u4 = getOpenAiUrls('http://192.168.1.23:8081/');
    assert.strictEqual(u4.baseUrl, 'http://192.168.1.23:8081/v1');
    assert.strictEqual(u4.modelsUrl, 'http://192.168.1.23:8081/v1/models');
    assert.strictEqual(u4.chatUrl, 'http://192.168.1.23:8081/v1/chat/completions');

    // Case E: Default fallback
    const u5 = getOpenAiUrls('');
    assert.strictEqual(u5.baseUrl, 'http://localhost:8080/v1');
  }
  console.log('    ✓ URL auto-normalization passed');

  // -------------------------------------------------------------
  // Test 2: Mock Server - Model Discovery (/v1/models)
  // -------------------------------------------------------------
  console.log('  2. Testing model discovery from mock llama.cpp server...');
  let lastAuthHeader = null;
  let lastRequestBody = null;

  const mockServer = http.createServer((req, res) => {
    lastAuthHeader = req.headers['authorization'] || null;

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'qwen2.5-coder-7b-instruct', object: 'model', owned_by: 'llamacpp' },
          { id: 'deepseek-coder-6.7b', object: 'model', owned_by: 'llamacpp' }
        ]
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          lastRequestBody = JSON.parse(body);
        } catch {
          lastRequestBody = body;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock-123',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '```javascript\nreturn data.filter(u => u.age > 25);\n```'
              },
              finish_reason: 'stop'
            }
          ]
        }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const serverPort = mockServer.address().port;
  const mockEndpoint = `http://127.0.0.1:${serverPort}`;

  try {
    // Discovery without API Key
    const models = await fetchOpenAiCompatibleModels(mockEndpoint);
    assert.deepStrictEqual(models, ['qwen2.5-coder-7b-instruct', 'deepseek-coder-6.7b']);
    assert.strictEqual(lastAuthHeader, null);

    // Discovery with API Key
    await fetchOpenAiCompatibleModels(`${mockEndpoint}/v1/models`, 'mock-secret-token');
    assert.strictEqual(lastAuthHeader, 'Bearer mock-secret-token');
    console.log('    ✓ Model discovery passed');

    // -------------------------------------------------------------
    // Test 3: Chat Completions (/v1/chat/completions)
    // -------------------------------------------------------------
    console.log('  3. Testing chat completion query generation...');
    const prompt = 'Find users older than 25';
    const sampleData = JSON.stringify([{ id: 1, name: 'Alice', age: 30 }]);

    const code = await callOpenAiCompatible(
      mockEndpoint,
      'qwen2.5-coder-7b-instruct',
      prompt,
      sampleData,
      'mock-secret-token'
    );

    // Verify response was un-fenced properly
    assert.strictEqual(code, 'return data.filter(u => u.age > 25);');

    // Verify payload dispatched to llama.cpp
    assert.ok(lastRequestBody !== null);
    assert.strictEqual(lastRequestBody.model, 'qwen2.5-coder-7b-instruct');
    assert.strictEqual(lastRequestBody.temperature, 0.2);
    assert.strictEqual(lastRequestBody.messages.length, 2);
    assert.strictEqual(lastRequestBody.messages[0].role, 'system');
    assert.ok(lastRequestBody.messages[0].content.includes('JavaScript expert'));
    assert.strictEqual(lastRequestBody.messages[1].role, 'user');
    assert.strictEqual(lastRequestBody.messages[1].content, 'Request: Find users older than 25');
    console.log('    ✓ Chat completion generation passed');

    // -------------------------------------------------------------
    // Test 4: AbortController Cancellation
    // -------------------------------------------------------------
    console.log('  4. Testing request cancellation...');
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await callOpenAiCompatible(
          mockEndpoint,
          'qwen2.5-coder-7b-instruct',
          'should abort',
          '{}',
          undefined,
          5000,
          controller.signal
        );
      },
      /canceled|aborted/i
    );
    console.log('    ✓ Request cancellation passed');

  } finally {
    mockServer.close();
  }

  // -------------------------------------------------------------
  // Test 5: Webview UI Markup & Input Elements
  // -------------------------------------------------------------
  console.log('  5. Testing Webview UI integration for llama.cpp...');
  {
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
      scriptNonce: 'test-nonce-llamacpp',
      boundFiles: [{ alias: 'data', uri: { fsPath: '/test.json' } }]
    });

    // Assert UI elements exist
    assert.ok(html.includes('value="llama-cpp"'), 'Missing option value="llama-cpp" in #aiProvider');
    assert.ok(html.includes('id="llamaCppConfig"'), 'Missing #llamaCppConfig container');
    assert.ok(html.includes('id="llamaCppEndpoint"'), 'Missing #llamaCppEndpoint input');
    assert.ok(html.includes('id="llamaCppApiKey"'), 'Missing #llamaCppApiKey input');
    assert.ok(html.includes('id="aiTimeout"'), 'Missing #aiTimeout input');
    assert.ok(html.includes("localStorage.getItem('jsonQueryTools.llamaCppEndpoint')"), 'Missing persistence for llamaCppEndpoint');
    assert.ok(html.includes("localStorage.getItem('jsonQueryTools.aiTimeout')"), 'Missing persistence for aiTimeout');
  }
  console.log('    ✓ Webview UI elements and persistence verified');

  console.log('\n🎉 All llama.cpp / OpenAI-Compatible integration tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
