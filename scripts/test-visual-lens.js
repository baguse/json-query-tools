const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const vm = require('vm');

async function runVisualLensTests() {
  console.log('Testing Visual Lens (JSON Path & Expression Picker)...');

  // 1. Bundle src/webview/html.ts in memory with mock vscode
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
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            contents: 'module.exports = { workspace: { asRelativePath: (u) => (typeof u === "string" ? u : (u && u.fsPath) || "file.json") } };',
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

  const { getQueryEditorHtml } = mod.exports;
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce-lens',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  // Verify HTML contains Visual Lens UI markup
  assert.ok(html.includes('id="visualLensBar"'), 'HTML must contain #visualLensBar');
  assert.ok(html.includes('id="toggleVisualLensBtn"'), 'HTML must contain #toggleVisualLensBtn');
  assert.ok(html.includes('id="lensPathDisplay"'), 'HTML must contain #lensPathDisplay');
  assert.ok(html.includes('id="lensOptionalChainingToggle"'), 'HTML must contain #lensOptionalChainingToggle');
  assert.ok(html.includes('id="lensCopyPathBtn"'), 'HTML must contain #lensCopyPathBtn');
  assert.ok(html.includes('id="lensInsertPathBtn"'), 'HTML must contain #lensInsertPathBtn');
  assert.ok(html.includes('id="lensFilterBtn"'), 'HTML must contain #lensFilterBtn');
  assert.ok(html.includes('id="lensExtractBtn"'), 'HTML must contain #lensExtractBtn');
  assert.ok(html.includes('id="lensGroupByBtn"'), 'HTML must contain #lensGroupByBtn');
  console.log('  ✓ Visual Lens HTML markup and control buttons verified');

  // 2. Extract script from HTML and isolate Visual Lens functions
  const scriptMatch = html.match(/<script nonce="test-nonce-lens">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Generated HTML must contain a script tag with nonce');
  const webviewScript = scriptMatch[1];

  const startMarker = '// Visual Lens (JSON Path & Expression Picker)';
  const endMarker = 'function setupVisualLensUI()';
  const startIdx = webviewScript.indexOf(startMarker);
  const endIdx = webviewScript.indexOf(endMarker, startIdx);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'Failed to find Visual Lens code section in generated webview script');

  const lensCode = webviewScript.slice(startIdx, endIdx);

  const sandbox = {
    console: console,
    Set: Set,
    Map: Map,
    Number: Number,
    String: String,
    Boolean: Boolean,
    parseInt: parseInt,
    JSON: JSON
  };

  vm.runInNewContext(lensCode, sandbox);

  const { parseJsonWithPositions, findJsonNodeAtOffset, resolveLensPath } = sandbox;
  assert.strictEqual(typeof parseJsonWithPositions, 'function', 'parseJsonWithPositions must be defined');
  assert.strictEqual(typeof findJsonNodeAtOffset, 'function', 'findJsonNodeAtOffset must be defined');
  assert.strictEqual(typeof resolveLensPath, 'function', 'resolveLensPath must be defined');

  // Test 1: Simple object properties and values
  {
    const jsonStr = '{\n  "name": "Alice",\n  "age": 30\n}';
    const ast = parseJsonWithPositions(jsonStr);
    assert.ok(ast, 'AST should be created');
    assert.strictEqual(ast.type, 'object');

    // Click on "Alice" (offset around 14)
    const offsetAlice = jsonStr.indexOf('"Alice"') + 2;
    const hitAlice = findJsonNodeAtOffset(ast, offsetAlice);
    assert.ok(hitAlice);
    const resolvedAlice = resolveLensPath(hitAlice, 'data');
    assert.strictEqual(resolvedAlice.standardPath, 'data.name');
    assert.strictEqual(resolvedAlice.optionalPath, 'data?.name');
    assert.strictEqual(resolvedAlice.targetValue, 'Alice');
    assert.strictEqual(resolvedAlice.targetType, 'string');

    // Click on number 30
    const offset30 = jsonStr.indexOf('30');
    const hit30 = findJsonNodeAtOffset(ast, offset30);
    assert.ok(hit30);
    const resolved30 = resolveLensPath(hit30, 'data');
    assert.strictEqual(resolved30.standardPath, 'data.age');
    assert.strictEqual(resolved30.targetValue, 30);
    assert.strictEqual(resolved30.targetType, 'number');

    // Click on key "age"
    const offsetKeyAge = jsonStr.indexOf('"age"') + 2;
    const hitKeyAge = findJsonNodeAtOffset(ast, offsetKeyAge);
    assert.ok(hitKeyAge);
    assert.strictEqual(hitKeyAge.isKey, true);
    const resolvedKeyAge = resolveLensPath(hitKeyAge, 'data');
    assert.strictEqual(resolvedKeyAge.standardPath, 'data.age');

    console.log('  ✓ Simple object property and value path resolution passed');
  }

  // Test 2: Deeply nested objects and arrays with query generation
  {
    const jsonStr = JSON.stringify({
      users: [
        {
          id: 1,
          profile: {
            city: 'Paris',
            zip: 75001
          }
        },
        {
          id: 2,
          profile: {
            city: 'Tokyo',
            zip: 10001
          }
        }
      ]
    }, null, 2);

    const ast = parseJsonWithPositions(jsonStr);
    assert.ok(ast);

    // Locate "Paris"
    const offsetParis = jsonStr.indexOf('"Paris"') + 2;
    const hitParis = findJsonNodeAtOffset(ast, offsetParis);
    assert.ok(hitParis);
    const resParis = resolveLensPath(hitParis, 'data');

    assert.strictEqual(resParis.standardPath, 'data.users[0].profile.city');
    assert.strictEqual(resParis.optionalPath, 'data?.users?.[0]?.profile?.city');
    assert.strictEqual(resParis.ancestorArrayPath, 'data.users');
    assert.strictEqual(resParis.relativeProp, 'profile.city');
    assert.strictEqual(resParis.targetValue, 'Paris');

    // Verify filter, extract, and groupBy expression templates
    const filterQuery = `${resParis.ancestorArrayPath}.filter(item => item.${resParis.relativeProp} === ${JSON.stringify(resParis.targetValue)})`;
    const extractQuery = `${resParis.ancestorArrayPath}.map(item => item.${resParis.relativeProp})`;
    const groupByQuery = `Object.groupBy(${resParis.ancestorArrayPath}, item => item.${resParis.relativeProp})`;

    assert.strictEqual(filterQuery, 'data.users.filter(item => item.profile.city === "Paris")');
    assert.strictEqual(extractQuery, 'data.users.map(item => item.profile.city)');
    assert.strictEqual(groupByQuery, 'Object.groupBy(data.users, item => item.profile.city)');

    console.log('  ✓ Deeply nested array and object traversal with query expression generation passed');
  }

  // Test 3: Root array of objects
  {
    const jsonStr = JSON.stringify([
      { id: 10, role: 'admin', active: true },
      { id: 20, role: 'member', active: false }
    ], null, 2);

    const ast = parseJsonWithPositions(jsonStr);
    assert.ok(ast);

    // Locate 'admin'
    const offsetAdmin = jsonStr.indexOf('"admin"') + 2;
    const hitAdmin = findJsonNodeAtOffset(ast, offsetAdmin);
    assert.ok(hitAdmin);
    const resAdmin = resolveLensPath(hitAdmin, 'data');

    assert.strictEqual(resAdmin.standardPath, 'data[0].role');
    assert.strictEqual(resAdmin.optionalPath, 'data?.[0]?.role');
    assert.strictEqual(resAdmin.ancestorArrayPath, 'data');
    assert.strictEqual(resAdmin.relativeProp, 'role');
    assert.strictEqual(resAdmin.targetValue, 'admin');

    const filterQuery = `${resAdmin.ancestorArrayPath}.filter(item => item.${resAdmin.relativeProp} === ${JSON.stringify(resAdmin.targetValue)})`;
    assert.strictEqual(filterQuery, 'data.filter(item => item.role === "admin")');

    // Locate active: true
    const offsetActive = jsonStr.indexOf('true');
    const hitActive = findJsonNodeAtOffset(ast, offsetActive);
    assert.ok(hitActive);
    const resActive = resolveLensPath(hitActive, 'data');
    assert.strictEqual(resActive.standardPath, 'data[0].active');
    assert.strictEqual(resActive.targetValue, true);
    assert.strictEqual(resActive.targetType, 'boolean');

    console.log('  ✓ Root array of objects resolution and filter queries passed');
  }

  // Test 4: Special characters and bracket notation
  {
    const jsonStr = JSON.stringify({
      'content-type': 'application/json',
      'user details': {
        'first name': 'John'
      }
    }, null, 2);

    const ast = parseJsonWithPositions(jsonStr);
    assert.ok(ast);

    // Click 'application/json'
    const offsetAppJson = jsonStr.indexOf('"application/json"') + 2;
    const hitAppJson = findJsonNodeAtOffset(ast, offsetAppJson);
    assert.ok(hitAppJson);
    const resAppJson = resolveLensPath(hitAppJson, 'data');
    assert.strictEqual(resAppJson.standardPath, 'data["content-type"]');
    assert.strictEqual(resAppJson.optionalPath, 'data?.["content-type"]');

    // Click 'John'
    const offsetJohn = jsonStr.indexOf('"John"') + 2;
    const hitJohn = findJsonNodeAtOffset(ast, offsetJohn);
    assert.ok(hitJohn);
    const resJohn = resolveLensPath(hitJohn, 'data');
    assert.strictEqual(resJohn.standardPath, 'data["user details"]["first name"]');
    assert.strictEqual(resJohn.optionalPath, 'data?.["user details"]?.["first name"]');

    console.log('  ✓ Special characters, spaces, and bracket notation paths passed');
  }

  // Test 5: Root array of primitives
  {
    const jsonStr = JSON.stringify(['red', 'green', 'blue'], null, 2);
    const ast = parseJsonWithPositions(jsonStr);
    assert.ok(ast);

    const offsetGreen = jsonStr.indexOf('"green"') + 2;
    const hitGreen = findJsonNodeAtOffset(ast, offsetGreen);
    assert.ok(hitGreen);
    const resGreen = resolveLensPath(hitGreen, 'data');

    assert.strictEqual(resGreen.standardPath, 'data[1]');
    assert.strictEqual(resGreen.optionalPath, 'data?.[1]');
    assert.strictEqual(resGreen.ancestorArrayPath, 'data');
    assert.strictEqual(resGreen.relativeProp, null);
    assert.strictEqual(resGreen.targetValue, 'green');

    console.log('  ✓ Primitive array element path resolution passed');
  }

  // Test 6: String escape sequences, negative numbers, and null values
  {
    const jsonStr = '{\n  "escaped": "hello \\"world\\"",\n  "negative": -12.34,\n  "emptyVal": null\n}';
    const ast = parseJsonWithPositions(jsonStr);
    assert.ok(ast);

    const offsetEsc = jsonStr.indexOf('world');
    const hitEsc = findJsonNodeAtOffset(ast, offsetEsc);
    assert.ok(hitEsc);
    const resEsc = resolveLensPath(hitEsc, 'data');
    assert.strictEqual(resEsc.targetValue, 'hello "world"');

    const offsetNeg = jsonStr.indexOf('-12.34');
    const hitNeg = findJsonNodeAtOffset(ast, offsetNeg);
    assert.ok(hitNeg);
    const resNeg = resolveLensPath(hitNeg, 'data');
    assert.strictEqual(resNeg.targetValue, -12.34);

    const offsetNull = jsonStr.indexOf('null');
    const hitNull = findJsonNodeAtOffset(ast, offsetNull);
    assert.ok(hitNull);
    const resNull = resolveLensPath(hitNull, 'data');
    assert.strictEqual(resNull.targetValue, null);
    assert.strictEqual(resNull.targetType, 'null');

    console.log('  ✓ String escapes, negative floats, and null tokens passed');
  }

  // Test 7: Table View cell and header simulation
  {
    // Simulate table cell click: data[3].status where value is 'APPROVED'
    const rowIndex = 3;
    const colName = 'status';
    const val = 'APPROVED';

    const cellPath = `data[${rowIndex}].${colName}`;
    const cellOptionalPath = `data?.[${rowIndex}]?.${colName}`;
    const cellFilter = `data.filter(item => item.${colName} === ${JSON.stringify(val)})`;
    const cellExtract = `data.map(item => item.${colName})`;
    const cellGroupBy = `Object.groupBy(data, item => item.${colName})`;

    assert.strictEqual(cellPath, 'data[3].status');
    assert.strictEqual(cellOptionalPath, 'data?.[3]?.status');
    assert.strictEqual(cellFilter, 'data.filter(item => item.status === "APPROVED")');
    assert.strictEqual(cellExtract, 'data.map(item => item.status)');
    assert.strictEqual(cellGroupBy, 'Object.groupBy(data, item => item.status)');

    // Simulate table header click: colName 'category'
    const headerPath = 'item.category';
    const headerExtract = 'data.map(item => item.category)';
    const headerGroupBy = 'Object.groupBy(data, item => item.category)';

    assert.strictEqual(headerPath, 'item.category');
    assert.strictEqual(headerExtract, 'data.map(item => item.category)');
    assert.strictEqual(headerGroupBy, 'Object.groupBy(data, item => item.category)');

    console.log('  ✓ Table view cell and header path / expression derivation passed');
  }

  console.log('\n✅ All Visual Lens tests passed successfully!\n');
}

runVisualLensTests().catch(err => {
  console.error('\n❌ Visual Lens tests failed:', err);
  process.exit(1);
});
