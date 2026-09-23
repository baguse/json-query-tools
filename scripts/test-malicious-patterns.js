const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runMaliciousPatternTests() {
  console.log('Testing checkForMaliciousExpression with node: prefixes and dynamic imports (#1.16)...');

  // Bundle evaluator.ts in memory
  const result = await esbuild.build({
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
                workspace: { workspaceFolders: [] }
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

  const { checkForMaliciousExpression } = mod.exports;
  assert.strictEqual(typeof checkForMaliciousExpression, 'function');

  // 1. Canonical node: prefixes
  const nodePrefixCases = [
    { expr: "require('node:child_process').execSync('whoami')", expected: 'child processes' },
    { expr: 'require("node:fs").readFileSync("/etc/passwd")', expected: 'file system' },
    { expr: "require('node:fs/promises').readFile('/etc/shadow')", expected: 'file system' },
    { expr: "require('node:net').createConnection(80, 'attacker.com')", expected: 'network connections' },
    { expr: "require('node:http').request('http://attacker.com')", expected: 'HTTP requests' },
    { expr: "require('node:https').request('https://attacker.com')", expected: 'HTTPS requests' },
    { expr: "require('node:dgram').createSocket('udp4')", expected: 'UDP sockets' },
    { expr: "require('node:os').userInfo()", expected: 'OS-level operations' },
    { expr: "require('node:vm').runInThisContext('code')", expected: 'system or worker modules' }
  ];

  for (const { expr, expected } of nodePrefixCases) {
    const warning = checkForMaliciousExpression(expr);
    assert.ok(warning, `Should detect malicious expression: ${expr}`);
    assert.ok(
      warning.includes(expected),
      `Expected warning to mention "${expected}", got "${warning}" for "${expr}"`
    );
  }
  console.log('  ✓ All node: prefix specifiers are detected');

  // 2. Dynamic import() syntax
  const dynamicImportCases = [
    { expr: "(await import('child_process')).execSync('id')", expected: 'child processes' },
    { expr: "(await import('node:child_process')).exec('ls')", expected: 'child processes' },
    { expr: "(await import('fs')).readFileSync('secret.txt')", expected: 'file system' },
    { expr: "(await import('node:fs/promises')).readFile('secret.txt')", expected: 'file system' },
    { expr: "(await import('node:http')).get('http://evil.com')", expected: 'HTTP requests' },
    { expr: "(await import('worker_threads'))", expected: 'system or worker modules' }
  ];

  for (const { expr, expected } of dynamicImportCases) {
    const warning = checkForMaliciousExpression(expr);
    assert.ok(warning, `Should detect dynamic import: ${expr}`);
    assert.ok(
      warning.includes(expected),
      `Expected warning to mention "${expected}", got "${warning}" for "${expr}"`
    );
  }
  console.log('  ✓ All dynamic import() calls are detected');

  // 3. Backtick / template literal require & import
  assert.ok(checkForMaliciousExpression('require(`node:child_process`)'));
  assert.ok(checkForMaliciousExpression('import(`node:fs`)'));
  console.log('  ✓ Backtick module specifiers are detected');

  // 4. Dangerous process methods and properties
  const processCases = [
    'process.kill(process.pid)',
    'process["kill"](1234)',
    'process.exit(1)',
    'process.abort()',
    'process.reallyExit(0)',
    'process.binding("fs")',
    'process.dlopen(module, "path")',
    'process.mainModule.require("child_process")',
    'process.env.AWS_SECRET_ACCESS_KEY',
    'process["env"]'
  ];

  for (const expr of processCases) {
    const warning = checkForMaliciousExpression(expr);
    assert.ok(warning, `Should detect dangerous process operation: ${expr}`);
  }
  console.log('  ✓ Dangerous process operations and environment access are detected');

  // 5. Dynamic code evaluation (eval and Function constructor)
  assert.ok(checkForMaliciousExpression('eval("process.exit()")'));
  assert.ok(checkForMaliciousExpression('Function("return process")()'));
  assert.ok(checkForMaliciousExpression('new Function("return process")()'));
  console.log('  ✓ eval() and dynamic Function() constructor are detected');

  // 6. Safe expressions must NOT trigger false positives
  const safeCases = [
    'data.filter(x => x.process === "active")',
    'data.map(item => item.fsStatus)',
    'data.filter(x => x.environment === "production")',
    'const osType = data.osType;',
    'return data.length;',
    'data.reduce((acc, cur) => acc + cur.val, 0)',
    'const requireCustom = { child_process: false };'
  ];

  for (const expr of safeCases) {
    const warning = checkForMaliciousExpression(expr);
    assert.strictEqual(
      warning,
      null,
      `Safe expression should not be flagged: ${expr} (got: ${warning})`
    );
  }
  console.log('  ✓ Safe expressions produce zero false positive warnings');

  console.log('\n✅ All malicious pattern security tests passed successfully!');
}

runMaliciousPatternTests().catch(err => {
  console.error('Fatal error during malicious pattern tests:', err);
  process.exit(1);
});
