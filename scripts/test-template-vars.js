const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runTemplateVarsTests() {
  console.log('Testing template variable resolution and Windows path normalization...');

  global.__testConfig = {};
  global.__testWorkspaceFolder = {
    uri: { fsPath: 'C:\\Users\\Baguse\\Projects\\json-tools' }
  };

  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/config.ts')],
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
                  getConfiguration: (section) => ({
                    get: (key) => (global.__testConfig && global.__testConfig[key])
                  }),
                  getWorkspaceFolder: (uri) => global.__testWorkspaceFolder,
                  get workspaceFolders() {
                    return global.__testWorkspaceFolder ? [global.__testWorkspaceFolder] : [];
                  }
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
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { getTemplateVariables, resolveTemplateVariables } = mod.exports;

  // 1. Windows path test
  const winUri = { fsPath: 'C:\\Users\\Baguse\\Projects\\json-tools\\test\\sample.json' };
  const winVars = getTemplateVariables(winUri);

  assert.strictEqual(winVars.fileName, 'sample.json');
  assert.strictEqual(winVars.filePath, 'C:/Users/Baguse/Projects/json-tools/test/sample.json');
  assert.strictEqual(winVars.fileDir, 'C:/Users/Baguse/Projects/json-tools/test');
  assert.strictEqual(winVars.workspaceFolder, 'C:/Users/Baguse/Projects/json-tools');

  // Verify no backslashes in paths
  assert.ok(!winVars.filePath.includes('\\'), 'filePath must not contain backslashes');
  assert.ok(!winVars.fileDir.includes('\\'), 'fileDir must not contain backslashes');
  assert.ok(!winVars.workspaceFolder.includes('\\'), 'workspaceFolder must not contain backslashes');
  console.log('  ✓ Windows path variables normalized to forward slashes');

  // 2. JavaScript syntax test with Windows paths
  // Un-normalized Windows paths like C:\Users\Test cause escape sequence errors (\U, \t, etc.)
  const expr = 'const p = "{{filePath}}"; const d = "{{fileDir}}"; return p + " in " + d;';
  const resolved = resolveTemplateVariables(expr, winUri);
  assert.strictEqual(
    resolved,
    'const p = "C:/Users/Baguse/Projects/json-tools/test/sample.json"; const d = "C:/Users/Baguse/Projects/json-tools/test"; return p + " in " + d;'
  );

  // Validate that the resolved expression parses and runs in JavaScript engine without syntax errors
  const testFn = new Function(resolved);
  const evalResult = testFn();
  assert.strictEqual(evalResult, 'C:/Users/Baguse/Projects/json-tools/test/sample.json in C:/Users/Baguse/Projects/json-tools/test');
  console.log('  ✓ Substituted expression parses and executes without JS escape sequence errors');

  // 3. POSIX path test
  const posixUri = { fsPath: '/home/baguse/repo/data.json' };
  global.__testWorkspaceFolder = { uri: { fsPath: '/home/baguse/repo' } };
  const posixVars = getTemplateVariables(posixUri);

  assert.strictEqual(posixVars.fileName, 'data.json');
  assert.strictEqual(posixVars.filePath, '/home/baguse/repo/data.json');
  assert.strictEqual(posixVars.fileDir, '/home/baguse/repo');
  assert.strictEqual(posixVars.workspaceFolder, '/home/baguse/repo');
  console.log('  ✓ POSIX path variables resolved correctly');

  // 4. Root path test
  const rootUri = { fsPath: '/data.json' };
  const rootVars = getTemplateVariables(rootUri);
  assert.strictEqual(rootVars.fileName, 'data.json');
  assert.strictEqual(rootVars.fileDir, '/');
  console.log('  ✓ Root fileDir resolves to "/"');

  // 5. Standalone mode (targetUri is undefined, but workspace folder is open)
  global.__testWorkspaceFolder = { uri: { fsPath: 'C:\\Users\\Baguse\\StandaloneProject' } };
  const standaloneVars = getTemplateVariables(undefined);
  assert.strictEqual(standaloneVars.fileName, undefined);
  assert.strictEqual(standaloneVars.filePath, undefined);
  assert.strictEqual(standaloneVars.workspaceFolder, 'C:/Users/Baguse/StandaloneProject');
  console.log('  ✓ Standalone mode falls back to workspace folder with normalized path');

  // 6. Custom template variables configuration
  global.__testConfig = {
    templateVariables: {
      apiVersion: 'v3',
      env: 'staging'
    }
  };
  const customExpr = 'return "https://api.example.com/{{apiVersion}}?env={{env}}&file={{fileName}}";';
  const customResolved = resolveTemplateVariables(customExpr, posixUri);
  assert.strictEqual(
    customResolved,
    'return "https://api.example.com/v3?env=staging&file=data.json";'
  );
  console.log('  ✓ Custom template variables merged and resolved alongside built-ins');

  // 7. Multiple occurrences of the same variable
  const multiExpr = 'const a = "{{fileName}}"; const b = "{{fileName}}"; return a === b;';
  const multiResolved = resolveTemplateVariables(multiExpr, posixUri);
  assert.strictEqual(
    multiResolved,
    'const a = "data.json"; const b = "data.json"; return a === b;'
  );
  assert.strictEqual(new Function(multiResolved)(), true);
  console.log('  ✓ Multiple variable occurrences all replaced');

  // 8. Environment variables resolution ($env.VAR and env.VAR)
  process.env.JSON_TOOLS_TEST_KEY = 'secret-token-12345';
  process.env.JSON_TOOLS_TEST_PORT = '9000';

  const envExpr1 = 'Bearer {{$env.JSON_TOOLS_TEST_KEY}}';
  assert.strictEqual(resolveTemplateVariables(envExpr1), 'Bearer secret-token-12345');

  const envExpr2 = 'Bearer {{env.JSON_TOOLS_TEST_KEY}}';
  assert.strictEqual(resolveTemplateVariables(envExpr2), 'Bearer secret-token-12345');

  const envExprSpaces = 'Bearer {{  $env.JSON_TOOLS_TEST_KEY   }}';
  assert.strictEqual(resolveTemplateVariables(envExprSpaces), 'Bearer secret-token-12345');

  const envUndefined = 'Key: {{$env.UNDEFINED_VAR_XYZ}}';
  assert.strictEqual(resolveTemplateVariables(envUndefined), 'Key: ');
  console.log('  ✓ Environment variables ($env.VAR and env.VAR with spaces) resolved properly');

  // 9. URL Context built-in variables (url, host, hostname, origin, pathname, port, method, alias)
  const urlContext = {
    url: 'https://api.example.com:8443/v1/orders/export?limit=10',
    method: 'POST',
    alias: 'ordersApi'
  };
  const urlVars = getTemplateVariables(undefined, urlContext);
  assert.strictEqual(urlVars.url, 'https://api.example.com:8443/v1/orders/export?limit=10');
  assert.strictEqual(urlVars.host, 'api.example.com:8443');
  assert.strictEqual(urlVars.hostname, 'api.example.com');
  assert.strictEqual(urlVars.origin, 'https://api.example.com:8443');
  assert.strictEqual(urlVars.pathname, '/v1/orders/export');
  assert.strictEqual(urlVars.port, '8443');
  assert.strictEqual(urlVars.method, 'POST');
  assert.strictEqual(urlVars.alias, 'ordersApi');

  const urlSubstituted = resolveTemplateVariables(
    'Host is {{host}}, method is {{method}}, alias is {{alias}}',
    undefined,
    urlContext
  );
  assert.strictEqual(urlSubstituted, 'Host is api.example.com:8443, method is POST, alias is ordersApi');
  console.log('  ✓ URL context built-in variables (url, host, pathname, port, method, alias) resolved correctly');

  // 10. resolveFetchOptions with URL template substitution
  const { resolveFetchOptions } = mod.exports;
  const rawFetchOpts = {
    url: '{{baseUrl}}/users/{{$env.JSON_TOOLS_TEST_PORT}}?api_key={{$env.JSON_TOOLS_TEST_KEY}}',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer {{$env.JSON_TOOLS_TEST_KEY}}',
      'X-Forwarded-Host': '{{host}}',
      'X-Method': '{{method}}'
    },
    body: '{"service": "json-tools", "folder": "{{workspaceFolder}}", "token": "{{$env.JSON_TOOLS_TEST_KEY}}"}',
    templateVariables: {
      baseUrl: 'https://api.internal.net'
    }
  };

  const resolvedOpts = resolveFetchOptions(rawFetchOpts, {
    workspaceFolder: 'C:/Test/Workspace'
  });

  assert.strictEqual(
    resolvedOpts.url,
    'https://api.internal.net/users/9000?api_key=secret-token-12345'
  );
  assert.strictEqual(resolvedOpts.headers['Authorization'], 'Bearer secret-token-12345');
  assert.strictEqual(resolvedOpts.headers['X-Forwarded-Host'], 'api.internal.net');
  assert.strictEqual(resolvedOpts.headers['X-Method'], 'POST');
  assert.strictEqual(
    resolvedOpts.body,
    '{"service": "json-tools", "folder": "C:/Test/Workspace", "token": "secret-token-12345"}'
  );
  console.log('  ✓ resolveFetchOptions resolves URL, headers, and body with cascading context');

  // 11. Percent-encoded URL braces (%7B%7B...%7D%7D)
  const encodedUrlExpr = 'https://api.example.com/v1?token=%7B%7B$env.JSON_TOOLS_TEST_KEY%7D%7D';
  const encodedResolved = mod.exports.resolveVariables(encodedUrlExpr);
  assert.strictEqual(encodedResolved, 'https://api.example.com/v1?token=secret-token-12345');
  console.log('  ✓ Percent-encoded braces (%7B%7B...%7D%7D) in URLs properly resolved');

  // 12. Preservation of unmatched template variables
  const unmatchedExpr = 'Hello {{unknownVar}}, your order {{order_id}} is ready: {{$env.JSON_TOOLS_TEST_KEY}}';
  const unmatchedResolved = mod.exports.resolveVariables(unmatchedExpr);
  assert.strictEqual(
    unmatchedResolved,
    'Hello {{unknownVar}}, your order {{order_id}} is ready: secret-token-12345'
  );
  console.log('  ✓ Unmatched template variables preserved intact without corruption');

  // 13. Direct zero-dependency bundle verification for src/template.ts
  const templateResult = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/template.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });
  const standaloneTemplateMod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', templateResult.outputFiles[0].text)(
    standaloneTemplateMod,
    standaloneTemplateMod.exports,
    require,
    path.join(__dirname, '../src')
  );

  const directResolved = standaloneTemplateMod.exports.resolveVariables(
    '{{baseUrl}}/status',
    { customVariables: { baseUrl: 'https://status.io' } }
  );
  assert.strictEqual(directResolved, 'https://status.io/status');
  console.log('  ✓ src/template.ts functions standalone without vscode runtime dependency');

  delete process.env.JSON_TOOLS_TEST_KEY;
  delete process.env.JSON_TOOLS_TEST_PORT;

  console.log('\n✅ All template variable tests passed successfully!');
}

runTemplateVarsTests().catch(err => {
  console.error('Fatal error during template variables tests:', err);
  process.exit(1);
});
