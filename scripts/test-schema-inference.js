const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runSchemaInferenceTests() {
  console.log('Testing Schema Inference recursion depth and circular reference guards...');

  // 1. Bundle src/schema.ts in memory
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/schema.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { inferSchemaFromData, detectType, unionTypes, DEFAULT_SCHEMA_MAX_DEPTH } = mod.exports;

  assert.strictEqual(DEFAULT_SCHEMA_MAX_DEPTH, 6);
  console.log('  ✓ Verified DEFAULT_SCHEMA_MAX_DEPTH is 6');

  // 2. Normal schema inference
  const basicData = {
    id: 123,
    title: 'Item',
    tags: ['a', 'b'],
    nested: { count: 10 }
  };
  const basicSchema = inferSchemaFromData(basicData);
  assert.strictEqual(basicSchema.type, 'object');
  assert.strictEqual(basicSchema.properties.id.type, 'number');
  assert.strictEqual(basicSchema.properties.title.type, 'string');
  assert.strictEqual(basicSchema.properties.tags.type, 'array');
  assert.strictEqual(basicSchema.properties.nested.type, 'object');
  assert.strictEqual(basicSchema.properties.nested.properties.count.type, 'number');
  console.log('  ✓ Standard nested object and array schema inference works as expected');

  // 3. Circular Reference Guard (Direct self-reference)
  const selfRefObj = { name: 'selfRef' };
  selfRefObj.itself = selfRefObj;

  const selfRefSchema = inferSchemaFromData(selfRefObj);
  assert.strictEqual(selfRefSchema.type, 'object');
  assert.strictEqual(selfRefSchema.properties.name.type, 'string');
  assert.strictEqual(selfRefSchema.properties.itself.type, 'object');
  assert.deepStrictEqual(selfRefSchema.properties.itself.properties, {});
  console.log('  ✓ Direct self-referencing circular object handled without call stack overflow');

  // 4. Circular Reference Guard (Mutual / indirect circular reference)
  const nodeA = { name: 'NodeA' };
  const nodeB = { name: 'NodeB', link: nodeA };
  nodeA.link = nodeB;

  const mutualSchema = inferSchemaFromData(nodeA);
  assert.strictEqual(mutualSchema.type, 'object');
  assert.strictEqual(mutualSchema.properties.name.type, 'string');
  assert.strictEqual(mutualSchema.properties.link.properties.name.type, 'string');
  assert.strictEqual(mutualSchema.properties.link.properties.link.type, 'object');
  console.log('  ✓ Indirect mutual circular references handled cleanly');

  // 5. Circular Array Reference
  const circularArr = [];
  circularArr.push(circularArr);

  const arrSchema = inferSchemaFromData(circularArr);
  assert.strictEqual(arrSchema.type, 'array');
  console.log('  ✓ Circular array self-reference handled safely');

  // 6. Deeply nested JSON structure (> 25 levels)
  let deepObj = { level: 25 };
  for (let i = 24; i >= 0; i--) {
    deepObj = { level: i, child: deepObj };
  }

  // With default maxDepth = 6
  const deepSchemaDefault = inferSchemaFromData(deepObj);
  assert.strictEqual(deepSchemaDefault.type, 'object');
  let current = deepSchemaDefault;
  let depth = 0;
  while (current && current.properties && current.properties.child && current.properties.child.properties) {
    depth++;
    current = current.properties.child;
  }
  assert.ok(depth <= 6, `Schema depth should not exceed default maxDepth (got ${depth})`);
  console.log(`  ✓ Deeply nested structure correctly bounded by default maxDepth=6 (depth: ${depth})`);

  // With custom maxDepth = 3
  const deepSchema3 = inferSchemaFromData(deepObj, 3);
  let depth3 = 0;
  let cur3 = deepSchema3;
  while (cur3 && cur3.properties && cur3.properties.child && cur3.properties.child.properties) {
    depth3++;
    cur3 = cur3.properties.child;
  }
  assert.ok(depth3 <= 3, `Schema depth should not exceed custom maxDepth 3 (got ${depth3})`);
  console.log(`  ✓ Deeply nested structure respects custom maxDepth=3 (depth: ${depth3})`);

  // 7. Primitive and null handling
  assert.deepStrictEqual(inferSchemaFromData(null), { type: 'primitive', valueType: 'null' });
  assert.deepStrictEqual(inferSchemaFromData(undefined), { type: 'primitive', valueType: 'null' });
  assert.deepStrictEqual(inferSchemaFromData(42), { type: 'primitive', valueType: 'number' });
  assert.deepStrictEqual(inferSchemaFromData('hello'), { type: 'primitive', valueType: 'string' });
  assert.deepStrictEqual(inferSchemaFromData(true), { type: 'primitive', valueType: 'boolean' });
  console.log('  ✓ Primitive values and nulls return expected SchemaInfo');

  console.log('\n✅ All Schema Inference tests passed successfully!');
}

runSchemaInferenceTests().catch(err => {
  console.error('Fatal error during Schema Inference tests:', err);
  process.exit(1);
});
