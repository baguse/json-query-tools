const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  console.log('Testing environments & config module (src/environments.ts)...');

  // Bundle src/environments.ts in memory for Node execution
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/environments.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundle.outputFiles[0].text);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const {
    parseDotEnv,
    getStarterEnvironmentsTemplate,
    extractEnvironmentVariables,
    resolveActiveEnvironment
  } = mod.exports;

  // 1. parseDotEnv tests
  {
    const sampleEnv = `
# Comment line
BASE_URL=https://api.example.com
PORT=8080
API_KEY="secret\\"value" # inline comment
SINGLE_QUOTED='hello world'
MULTILINE="first\\nsecond"
EMPTY_VAL=
`;
    const parsed = parseDotEnv(sampleEnv);
    assert.strictEqual(parsed['BASE_URL'], 'https://api.example.com');
    assert.strictEqual(parsed['PORT'], '8080');
    assert.strictEqual(parsed['API_KEY'], 'secret"value');
    assert.strictEqual(parsed['SINGLE_QUOTED'], 'hello world');
    assert.strictEqual(parsed['MULTILINE'], 'first\nsecond');
    assert.strictEqual(parsed['EMPTY_VAL'], '');
    console.log('✔ parseDotEnv passed');
  }

  // 2. getStarterEnvironmentsTemplate tests
  {
    const template = getStarterEnvironmentsTemplate();
    assert.ok(template.environments.local, 'Expected local environment');
    assert.ok(template.environments.staging, 'Expected staging environment');
    assert.ok(template.environments.production, 'Expected production environment');
    assert.strictEqual(template.activeEnvironment, 'staging');
    assert.strictEqual(template.environments.local.baseUrl, 'http://localhost:3000');
    assert.strictEqual(template.environments.staging.baseUrl, 'https://staging-api.example.com');
    assert.strictEqual(template.globalVariables.apiVersion, 'v1');
    console.log('✔ getStarterEnvironmentsTemplate passed');
  }

  // 3. extractEnvironmentVariables tests
  {
    const envDef = {
      name: 'Staging Env',
      baseUrl: 'https://staging.test',
      headers: {
        'X-Environment': 'staging',
        'Authorization': 'Bearer staging-token'
      },
      variables: {
        timeout: '5000',
        tenantId: 'tenant-123'
      },
      customSecret: 'top-level-secret'
    };
    const extracted = extractEnvironmentVariables(envDef);
    assert.strictEqual(extracted.variables.baseUrl, 'https://staging.test');
    assert.strictEqual(extracted.variables.timeout, '5000');
    assert.strictEqual(extracted.variables.tenantId, 'tenant-123');
    assert.strictEqual(extracted.variables.customSecret, 'top-level-secret');
    assert.strictEqual(extracted.defaultHeaders['X-Environment'], 'staging');
    assert.strictEqual(extracted.defaultHeaders['Authorization'], 'Bearer staging-token');
    console.log('✔ extractEnvironmentVariables passed');
  }

  // 4. resolveActiveEnvironment tests
  {
    const config = {
      activeEnvironment: 'staging',
      globalVariables: {
        sharedSecret: 'global-key',
        apiVersion: 'v1'
      },
      environments: {
        local: {
          baseUrl: 'http://localhost:3000',
          variables: { apiKey: 'local-key' }
        },
        staging: {
          baseUrl: 'https://staging-api.example.com',
          headers: { 'X-Env': 'staging' },
          variables: { apiKey: 'staging-key', apiVersion: 'v2' }
        }
      }
    };

    const dotEnv = {
      fallbackToken: 'dotenv-token',
      sharedSecret: 'dotenv-override'
    };

    // Staging resolution
    const stagingResolved = resolveActiveEnvironment(config, 'staging', dotEnv);
    assert.strictEqual(stagingResolved.name, 'staging');
    assert.strictEqual(stagingResolved.variables.baseUrl, 'https://staging-api.example.com');
    assert.strictEqual(stagingResolved.variables.apiKey, 'staging-key');
    // Env variable should override global
    assert.strictEqual(stagingResolved.variables.apiVersion, 'v2');
    // Dotenv fallback present
    assert.strictEqual(stagingResolved.variables.fallbackToken, 'dotenv-token');
    // Default headers
    assert.strictEqual(stagingResolved.defaultHeaders['X-Env'], 'staging');
    assert.strictEqual(stagingResolved.variables.activeEnv, 'staging');

    // Local resolution
    const localResolved = resolveActiveEnvironment(config, 'local', dotEnv);
    assert.strictEqual(localResolved.name, 'local');
    assert.strictEqual(localResolved.variables.baseUrl, 'http://localhost:3000');
    assert.strictEqual(localResolved.variables.apiKey, 'local-key');
    assert.strictEqual(localResolved.variables.apiVersion, 'v1');

    // Empty environment resolution
    const emptyResolved = resolveActiveEnvironment(config, '');
    assert.strictEqual(emptyResolved.name, '');
    assert.strictEqual(emptyResolved.variables.baseUrl, undefined);
    assert.strictEqual(emptyResolved.variables.apiVersion, 'v1');
    console.log('✔ resolveActiveEnvironment passed');
  }

  // 5. Template & Fetcher integration test
  {
    const templateBundle = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/template.ts')],
      bundle: true,
      platform: 'node',
      write: false,
      format: 'cjs'
    });
    const templateMod = { exports: {} };
    const tFn = new Function('module', 'exports', 'require', '__dirname', templateBundle.outputFiles[0].text);
    tFn(templateMod, templateMod.exports, require, path.join(__dirname, '../src'));
    const { resolveFetchOptions } = templateMod.exports;

    const resolved = resolveFetchOptions({
      url: '{{baseUrl}}/api/{{apiVersion}}/users?filter={{activeEnv}}',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer {{apiKey}}',
        'X-Tenant': '{{tenantId}}'
      },
      body: JSON.stringify({ environment: '{{activeEnv}}' }),
      templateVariables: {
        baseUrl: 'https://staging-api.example.com',
        apiVersion: 'v1',
        activeEnv: 'staging',
        apiKey: 'secret-token-xyz',
        tenantId: 'tenant-42'
      }
    });

    assert.strictEqual(resolved.url, 'https://staging-api.example.com/api/v1/users?filter=staging');
    assert.strictEqual(resolved.headers['Authorization'], 'Bearer secret-token-xyz');
    assert.strictEqual(resolved.headers['X-Tenant'], 'tenant-42');
    assert.strictEqual(resolved.body, JSON.stringify({ environment: 'staging' }));
    console.log('✔ resolveFetchOptions with environment variables passed');
  }

  // 6. Webview HTML verification
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
            build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
            build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
              contents: `module.exports = { workspace: { asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json') } };`,
              loader: 'js'
            }));
          }
        }
      ]
    });
    const htmlMod = { exports: {} };
    const hFn = new Function('module', 'exports', 'require', '__dirname', htmlBundle.outputFiles[0].text);
    hFn(htmlMod, htmlMod.exports, require, path.join(__dirname, '../src'));
    const { getQueryEditorHtml } = htmlMod.exports;

    const mockWebview = { cspSource: 'vscode-webview:' };
    const html = getQueryEditorHtml(mockWebview, {
      scriptNonce: 'test-env-nonce',
      environments: ['local', 'staging', 'production'],
      activeEnvironment: 'staging',
      environmentVariables: { baseUrl: 'https://staging.test' }
    });

    assert.ok(html.includes('id="envSelect"'), 'Expected envSelect in HTML');
    assert.ok(html.includes('id="manageEnvBtn"'), 'Expected manageEnvBtn in HTML');
    assert.ok(html.includes('id="urlModalEnvBanner"'), 'Expected urlModalEnvBanner in HTML');
    assert.ok(html.includes('id="urlModalManageEnvBtn"'), 'Expected urlModalManageEnvBtn in HTML');
    assert.ok(html.includes('value="staging" selected'), 'Expected staging to be selected in envSelect');
    assert.ok(html.includes('env_base_url'), 'Expected env_base_url snippet in HTML');
    console.log('✔ getQueryEditorHtml environment UI controls passed');
  }

  // 7. Query Editor environment evaluation tests ({{env.baseURL}} and env.baseURL)
  {
    const evalBundle = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/evaluator.ts')],
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
                  window: {
                    showWarningMessage: () => {},
                    showErrorMessage: () => {}
                  },
                  workspace: {
                    workspaceFolders: [{ uri: { fsPath: __dirname } }],
                    getWorkspaceFolder: () => ({ uri: { fsPath: __dirname } }),
                    getConfiguration: () => ({ get: () => ({}) })
                  }
                };
              `,
              loader: 'js'
            }));
          }
        }
      ]
    });

    const evalMod = { exports: {} };
    const eFn = new Function('module', 'exports', 'require', '__dirname', evalBundle.outputFiles[0].text);
    eFn(evalMod, evalMod.exports, require, path.join(__dirname, '../src'));
    const { evaluateExpression } = evalMod.exports;

    const testEnv = {
      name: 'staging',
      variables: {
        baseUrl: 'https://staging-api.example.com',
        apiKey: 'secret-token-123',
        tenantId: 'tenant-99'
      },
      defaultHeaders: {
        'Authorization': 'Bearer secret-token-123'
      }
    };

    // 7a. Template substitution inside JS string: '{{env.baseURL}}/api'
    const resStringTpl = evaluateExpression([], {}, 'return "{{env.baseURL}}/api/users";', testEnv);
    assert.strictEqual(resStringTpl, 'https://staging-api.example.com/api/users');

    // 7b. Single standalone template placeholder: '{{env.baseURL}}'
    const resSingleTpl = evaluateExpression([], {}, '{{env.baseURL}}', testEnv);
    assert.strictEqual(resSingleTpl, 'https://staging-api.example.com');

    // 7c. Single standalone template placeholder with lower case: '{{env.baseUrl}}'
    const resSingleLower = evaluateExpression([], {}, '{{env.baseUrl}}', testEnv);
    assert.strictEqual(resSingleLower, 'https://staging-api.example.com');

    // 7d. Pure JS expression accessing env.baseURL
    const resJsBaseUrl = evaluateExpression([], {}, 'return env.baseURL;', testEnv);
    assert.strictEqual(resJsBaseUrl, 'https://staging-api.example.com');

    // 7e. Pure JS expression accessing env.baseUrl
    const resJsLower = evaluateExpression([], {}, 'return env.baseUrl;', testEnv);
    assert.strictEqual(resJsLower, 'https://staging-api.example.com');

    // 7f. Pure JS expression accessing env.name
    const resJsName = evaluateExpression([], {}, 'return env.name;', testEnv);
    assert.strictEqual(resJsName, 'staging');

    // 7g. Pure JS expression accessing custom variables
    const resJsApiKey = evaluateExpression([], {}, 'return env.apiKey;', testEnv);
    assert.strictEqual(resJsApiKey, 'secret-token-123');

    // 7h. Case-insensitive JS property access on env
    const resJsCaseInsensitive = evaluateExpression([], {}, 'return env.APIKEY || env.ApiKey;', testEnv);
    assert.strictEqual(resJsCaseInsensitive, 'secret-token-123');

    // 7i. Arrow query function receiving env
    const resArrow = evaluateExpression([], {}, '() => `${env.baseURL}/v2`', testEnv);
    assert.strictEqual(resArrow, 'https://staging-api.example.com/v2');

    // 7j. Query expression with bound data and env
    const resWithData = evaluateExpression(
      [{ alias: 'data', uri: { fsPath: '/test/data.json' } }],
      { data: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] },
      'data.map(u => ({ ...u, endpoint: `${env.baseURL}/users/${u.id}` }))',
      testEnv
    );
    assert.deepStrictEqual(resWithData, [
      { id: 1, name: 'Alice', endpoint: 'https://staging-api.example.com/users/1' },
      { id: 2, name: 'Bob', endpoint: 'https://staging-api.example.com/users/2' }
    ]);

    console.log('✔ Query Editor {{env.baseURL}} and env runtime expressions passed');
  }

  console.log('All environment unit tests passed successfully!');
}

main().catch(err => {
  console.error('Environment tests failed:', err);
  process.exit(1);
});
