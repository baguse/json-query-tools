const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  console.log('Testing cURL module (parser & generator)...');

  // Bundle src/curl.ts in memory for Node execution
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/curl.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundle.outputFiles[0].text);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { tokenizeArgs, parseCurl, generateCurl } = mod.exports;

  // 1. Basic GET
  {
    const parsed = parseCurl('curl https://api.example.com/v1/items?limit=10');
    assert.strictEqual(parsed.url, 'https://api.example.com/v1/items?limit=10');
    assert.strictEqual(parsed.method, 'GET');
    assert.deepStrictEqual(parsed.headers, {});
    assert.strictEqual(parsed.body, '');
    console.log('✔ Basic GET passed');
  }

  // 2. DevTools cURL format with multiline backslash
  {
    const devtoolsCurl = `curl 'https://api.github.com/user/repos?per_page=100' \\
  -H 'accept: application/vnd.github.v3+json' \\
  -H 'authorization: token ghp_secret123' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64)' \\
  --data-raw '{"name":"awesome-repo","private":true}' \\
  --compressed`;

    const parsed = parseCurl(devtoolsCurl);
    assert.strictEqual(parsed.url, 'https://api.github.com/user/repos?per_page=100');
    assert.strictEqual(parsed.method, 'POST'); // Inferred from --data-raw without -X
    assert.strictEqual(parsed.headers['accept'], 'application/vnd.github.v3+json');
    assert.strictEqual(parsed.headers['authorization'], 'token ghp_secret123');
    assert.strictEqual(parsed.headers['user-agent'], 'Mozilla/5.0 (X11; Linux x86_64)');
    assert.strictEqual(parsed.body, '{"name":"awesome-repo","private":true}');
    console.log('✔ DevTools multiline cURL passed');
  }

  // 3. Windows CMD format with ^ and escaped double quotes
  {
    const cmdCurl = `curl "https://api.example.com/users" ^
  -X POST ^
  -H "Content-Type: application/json" ^
  -d "{""username"":""alice"",""role"":""admin""}"`;

    const parsed = parseCurl(cmdCurl);
    assert.strictEqual(parsed.url, 'https://api.example.com/users');
    assert.strictEqual(parsed.method, 'POST');
    assert.strictEqual(parsed.headers['Content-Type'], 'application/json');
    assert.strictEqual(parsed.body, '{"username":"alice","role":"admin"}');
    console.log('✔ Windows CMD cURL passed');
  }

  // 4. PowerShell format with backtick continuations
  {
    const psCurl = `curl.exe 'https://api.example.com/data' \`
  --request PUT \`
  --header 'Authorization: Bearer token-xyz' \`
  --data '{"status":"active"}'`;

    const parsed = parseCurl(psCurl);
    assert.strictEqual(parsed.url, 'https://api.example.com/data');
    assert.strictEqual(parsed.method, 'PUT');
    assert.strictEqual(parsed.headers['Authorization'], 'Bearer token-xyz');
    assert.strictEqual(parsed.body, '{"status":"active"}');
    console.log('✔ PowerShell cURL passed');
  }

  // 5. Basic Auth (-u username:password)
  {
    const parsed = parseCurl('curl -u admin:secret123 https://api.example.com/secure');
    assert.strictEqual(parsed.url, 'https://api.example.com/secure');
    assert.strictEqual(parsed.headers['Authorization'], 'Basic YWRtaW46c2VjcmV0MTIz');
    console.log('✔ Basic Auth (-u) passed');
  }

  // 6. User-Agent (-A) and Cookie (-b) flags
  {
    const parsed = parseCurl('curl -A "CustomAgent/2.0" -b "sessionId=xyz987" https://api.example.com/info');
    assert.strictEqual(parsed.headers['User-Agent'], 'CustomAgent/2.0');
    assert.strictEqual(parsed.headers['Cookie'], 'sessionId=xyz987');
    console.log('✔ User-Agent and Cookie flags passed');
  }

  // 7. Multiple -d flags concatenate with &
  {
    const parsed = parseCurl('curl https://api.example.com/form -d "field1=val1" -d "field2=val2"');
    assert.strictEqual(parsed.method, 'POST');
    assert.strictEqual(parsed.body, 'field1=val1&field2=val2');
    console.log('✔ Multiple -d flags concatenation passed');
  }

  // 8. Head and Get flags
  {
    const headParsed = parseCurl('curl -I https://api.example.com/health');
    assert.strictEqual(headParsed.method, 'HEAD');

    const getParsed = parseCurl('curl -G https://api.example.com/query -d "filter=active"');
    assert.strictEqual(getParsed.method, 'GET');
    console.log('✔ -I and -G method flags passed');
  }

  // 9. cURL Generation - Basic GET
  {
    const cmd = generateCurl({
      url: 'https://api.example.com/v1/items'
    });
    assert.strictEqual(cmd, 'curl "https://api.example.com/v1/items"');
    console.log('✔ generateCurl Basic GET passed');
  }

  // 10. cURL Generation - POST with headers and JSON body
  {
    const cmd = generateCurl({
      url: 'https://api.example.com/v1/items',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: '{"name":"test"}'
    });

    assert.ok(cmd.includes('-X POST'));
    assert.ok(cmd.includes('"https://api.example.com/v1/items"'));
    assert.ok(cmd.includes('-H "Accept: application/json"'));
    assert.ok(cmd.includes('-H "Content-Type: application/json"'));
    assert.ok(cmd.includes("-d '{\"name\":\"test\"}'"));
    console.log('✔ generateCurl POST passed');
  }

  // 11. cURL Generation - Single quote escaping in body
  {
    const cmd = generateCurl({
      url: 'https://api.example.com/v1/books',
      method: 'POST',
      body: "{\"title\":\"O'Reilly Books\"}"
    });

    assert.ok(cmd.includes("-d '{\"title\":\"O'\\''Reilly Books\"}'"));
    console.log('✔ generateCurl single quote escaping passed');
  }

  // 12. Full Round-trip test
  {
    const original = {
      url: 'https://api.example.com/v1/search?category=books&sort=desc',
      method: 'PUT',
      headers: 'Authorization: Bearer token-abc\nContent-Type: application/json',
      body: JSON.stringify({ action: 'update', count: 42 })
    };

    const generated = generateCurl(original);
    const parsedBack = parseCurl(generated);

    assert.strictEqual(parsedBack.url, original.url);
    assert.strictEqual(parsedBack.method, original.method);
    assert.strictEqual(parsedBack.headers['Authorization'], 'Bearer token-abc');
    assert.strictEqual(parsedBack.headers['Content-Type'], 'application/json');
    assert.strictEqual(parsedBack.body, original.body);
    console.log('✔ Full round-trip test passed');
  }

  // 13. Graceful handling of empty/malformed inputs
  {
    assert.deepStrictEqual(tokenizeArgs(''), []);
    const emptyParsed = parseCurl('');
    assert.strictEqual(emptyParsed.url, '');
    assert.strictEqual(emptyParsed.method, 'GET');
    assert.strictEqual(emptyParsed.body, '');
    console.log('✔ Graceful handling of empty inputs passed');
  }

  console.log('All cURL module tests passed successfully! ✅');
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
