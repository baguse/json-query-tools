const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runStringifyTests() {
  console.log('Testing stringify() edge cases for undefined, BigInt, and functions (#1.15)...');

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
                workspace: {
                  workspaceFolders: []
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

  const { stringify } = mod.exports;
  assert.strictEqual(typeof stringify, 'function', 'stringify must be an exported function');

  // 1. undefined returns 'undefined' string
  const undefinedResult = stringify(undefined);
  assert.strictEqual(typeof undefinedResult, 'string', 'stringify(undefined) must return a string');
  assert.strictEqual(undefinedResult, 'undefined', 'stringify(undefined) must return "undefined"');
  console.log('  ✓ stringify(undefined) returns "undefined" string');

  // 2. null returns 'null' string
  const nullResult = stringify(null);
  assert.strictEqual(nullResult, 'null', 'stringify(null) must return "null"');
  console.log('  ✓ stringify(null) returns "null" string');

  // 3. Raw BigInt primitive
  const rawBigIntResult = stringify(9007199254740993n);
  assert.strictEqual(typeof rawBigIntResult, 'string');
  assert.strictEqual(rawBigIntResult, '"9007199254740993"');
  console.log('  ✓ stringify(raw BigInt) serializes without TypeError');

  // 4. Object containing BigInt
  const objWithBigInt = { id: 100n, label: 'item' };
  const objResult = stringify(objWithBigInt);
  assert.ok(objResult.includes('"id": "100"'), 'BigInt in object must serialize to string representation');
  assert.ok(objResult.includes('"label": "item"'));
  assert.strictEqual(JSON.parse(objResult).id, '100');
  console.log('  ✓ Object containing BigInt property serializes cleanly');

  // 5. Array containing BigInt
  const arrWithBigInt = [1n, 2n, 3n];
  const arrResult = stringify(arrWithBigInt);
  assert.deepStrictEqual(JSON.parse(arrResult), ['1', '2', '3']);
  console.log('  ✓ Array containing BigInt items serializes cleanly');

  // 6. Deeply nested BigInt
  const nested = { a: { b: { c: 999999999999999999n } } };
  const nestedResult = stringify(nested);
  assert.strictEqual(JSON.parse(nestedResult).a.b.c, '999999999999999999');
  console.log('  ✓ Deeply nested BigInt serializes cleanly');

  // 7. Functions
  const fnVal = () => 42;
  const fnResult = stringify(fnVal);
  assert.strictEqual(typeof fnResult, 'string');
  assert.ok(fnResult.includes('42'), 'Functions should serialize to their string representation');
  console.log('  ✓ Function value stringifies to function body string without error');

  // 8. Symbols
  const symVal = Symbol('jsonTools');
  const symResult = stringify(symVal);
  assert.strictEqual(symResult, 'Symbol(jsonTools)');
  console.log('  ✓ Symbol value stringifies to string representation');

  // 9. Standard JSON objects and formatting
  const standardObj = { x: 1, y: [true, false] };
  const standardResult = stringify(standardObj);
  assert.strictEqual(
    standardResult,
    '{\n  "x": 1,\n  "y": [\n    true,\n    false\n  ]\n}'
  );
  console.log('  ✓ Standard objects format with 2-space indentation');

  // 10. Circular reference fallback
  const circular = { name: 'circular' };
  circular.self = circular;
  const circularResult = stringify(circular);
  assert.strictEqual(typeof circularResult, 'string');
  assert.strictEqual(circularResult, '[object Object]');
  console.log('  ✓ Circular structures safely fall back to String(value)');

  console.log('\n✅ All stringify edge case tests passed successfully!');
}

runStringifyTests().catch(err => {
  console.error('Fatal error during stringify tests:', err);
  process.exit(1);
});
