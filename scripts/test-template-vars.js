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

  console.log('\n✅ All template variable tests passed successfully!');
}

runTemplateVarsTests().catch(err => {
  console.error('Fatal error during template variables tests:', err);
  process.exit(1);
});
