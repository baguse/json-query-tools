const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function runNonceTests() {
  console.log('Testing cryptographically secure nonce generation (#1.17)...');

  // 1. Static check: Verify Math.random() is eliminated from nonce()
  const htmlSource = fs.readFileSync(path.join(__dirname, '../src/webview/html.ts'), 'utf8');
  const nonceFuncMatch = htmlSource.match(/export function nonce\(\)[\s\S]*?\{([\s\S]*?)\}/);
  assert.ok(nonceFuncMatch, 'nonce() function must be defined');
  assert.ok(
    !nonceFuncMatch[1].includes('Math.random()'),
    'nonce() must not use Math.random()'
  );
  assert.ok(
    nonceFuncMatch[1].includes('crypto.randomBytes') || nonceFuncMatch[1].includes('crypto.randomUUID'),
    'nonce() must use Node.js crypto'
  );
  console.log('  ✓ Static analysis: Math.random() is eliminated from nonce() in html.ts');

  // 2. Bundle html.ts in memory
  const result = await esbuild.build({
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
  fn(mod, mod.exports, require, path.join(__dirname, '../src/webview'));

  const { nonce, getQueryEditorHtml } = mod.exports;
  assert.strictEqual(typeof nonce, 'function', 'nonce must be an exported function');

  // 3. Format and length validation
  const testNonce = nonce();
  assert.strictEqual(typeof testNonce, 'string', 'nonce must return a string');
  assert.strictEqual(testNonce.length, 32, 'nonce must be 32 hex characters (128 bits)');
  assert.match(testNonce, /^[0-9a-f]{32}$/, 'nonce must consist strictly of lowercase hexadecimal characters');
  console.log('  ✓ nonce() produces 32-character hexadecimal token (128-bit entropy)');

  // 4. Entropy and uniqueness (zero collisions across 1,000 generated nonces)
  const generatedNonces = new Set();
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    const val = nonce();
    assert.strictEqual(val.length, 32);
    generatedNonces.add(val);
  }
  assert.strictEqual(
    generatedNonces.size,
    iterations,
    `All ${iterations} generated nonces must be strictly unique`
  );
  console.log(`  ✓ Zero collisions across ${iterations} generated nonces`);

  // 5. Integration with webview Content Security Policy
  const generatedScriptNonce = nonce();
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: generatedScriptNonce,
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  assert.ok(
    html.includes(`'nonce-${generatedScriptNonce}'`),
    'HTML CSP header must contain generated scriptNonce'
  );
  assert.ok(
    html.includes(`nonce="${generatedScriptNonce}"`),
    'HTML script tag must contain matching nonce attribute'
  );
  console.log('  ✓ Webview CSP meta header and script tags accurately adopt generated nonce');

  console.log('\n✅ All nonce security tests passed successfully!');
}

runNonceTests().catch(err => {
  console.error('Fatal error during nonce tests:', err);
  process.exit(1);
});
