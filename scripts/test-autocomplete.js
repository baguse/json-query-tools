const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

async function runAutocompleteTests() {
  console.log('Testing CodeMirror autocomplete and dot suggestion features...');

  // 1. Static Verification of source code
  const htmlPath = path.join(__dirname, '../src/webview/html.ts');
  const htmlSource = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(htmlSource.includes('buildEnvCompletions'), 'html.ts should define buildEnvCompletions');
  assert.ok(htmlSource.includes('buildMathCompletions'), 'html.ts should define buildMathCompletions');
  assert.ok(htmlSource.includes('buildJsonCompletions'), 'html.ts should define buildJsonCompletions');
  assert.ok(htmlSource.includes('buildObjectConstructorCompletions'), 'html.ts should define buildObjectConstructorCompletions');
  assert.ok(htmlSource.includes('buildArrayConstructorCompletions'), 'html.ts should define buildArrayConstructorCompletions');
  assert.ok(htmlSource.includes('buildConsoleCompletions'), 'html.ts should define buildConsoleCompletions');
  assert.ok(htmlSource.includes('buildAnyFallbackCompletions'), 'html.ts should define buildAnyFallbackCompletions');
  assert.ok(htmlSource.includes('isPositionInStringOrComment'), 'html.ts should define isPositionInStringOrComment');
  assert.ok(htmlSource.includes("editor.on('inputRead'"), 'html.ts should listen for inputRead to trigger autocomplete');
  assert.ok(!htmlSource.includes('if (!currentSchema) return null;'), 'html.ts should not block autocomplete when currentSchema is null');

  console.log('  ✓ Static code checks in html.ts passed');

  // 2. Bundle html.ts to evaluate actual generated webview script
  const result = await esbuild.build({
    entryPoints: [htmlPath],
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
    scriptNonce: 'test-nonce',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  const scriptMatch = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Generated HTML must contain a script tag with nonce');
  const webviewScript = scriptMatch[1];

  // 3. Extract autocomplete section from rendered webview script
  const startMarker = '// Schema-aware autocomplete';
  const endMarker = 'function setupSchemaAutocomplete() {';
  const startIdx = webviewScript.indexOf(startMarker);
  const endIdx = webviewScript.indexOf(endMarker, startIdx);
  assert.ok(startIdx !== -1 && endIdx !== -1, 'Failed to find autocomplete section in generated webview script');

  const autocompleteCode = webviewScript.slice(startIdx, endIdx);

  const sandbox = {
    console: console,
    Set: Set,
    Map: Map,
    currentSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'primitive', valueType: 'number' },
          name: { type: 'primitive', valueType: 'string' }
        }
      }
    },
    currentSources: [{ alias: 'users' }],
    currentEnvVariables: {
      baseURL: 'https://api.example.com',
      authToken: 'token-xyz'
    }
  };

  vm.runInNewContext(autocompleteCode, sandbox);

  // 4. Test extractChainForAutocomplete on "blabla."
  const line1 = 'const x = blabla.';
  const res1 = sandbox.extractChainForAutocomplete(line1, line1.length, null, 0);
  assert.ok(res1, 'Should extract chain for blabla.');
  assert.strictEqual(res1.chain, 'blabla.');
  assert.strictEqual(res1.chainStartInLine, 10);
  console.log('  ✓ extractChainForAutocomplete properly extracts "blabla."');

  // 5. Test extractChainForAutocomplete on "env.base"
  const line2 = 'const x = env.base';
  const res2 = sandbox.extractChainForAutocomplete(line2, line2.length, null, 0);
  assert.ok(res2, 'Should extract chain for env.base');
  assert.strictEqual(res2.chain, 'env.base');
  console.log('  ✓ extractChainForAutocomplete properly extracts "env.base"');

  // 6. Test inferTypeFromChain for globals and env
  const envType = sandbox.inferTypeFromChain('env');
  assert.strictEqual(envType.typeName, 'environment');

  const mathType = sandbox.inferTypeFromChain('Math');
  assert.strictEqual(mathType.typeName, 'Math');

  const jsonType = sandbox.inferTypeFromChain('JSON');
  assert.strictEqual(jsonType.typeName, 'JSON');

  const objType = sandbox.inferTypeFromChain('Object');
  assert.strictEqual(objType.typeName, 'Object');

  const consoleType = sandbox.inferTypeFromChain('console');
  assert.strictEqual(consoleType.typeName, 'console');

  const consoleCompletions = sandbox.buildConsoleCompletions();
  assert.ok(consoleCompletions.some(c => c.text === 'debug'), 'Should include debug in console completions');
  assert.ok(consoleCompletions.some(c => c.text === 'log'), 'Should include log in console completions');
  assert.ok(consoleCompletions.some(c => c.text === 'warn'), 'Should include warn in console completions');
  assert.ok(consoleCompletions.some(c => c.text === 'error'), 'Should include error in console completions');

  // Verify typing console.deb extracts chain for prefix filtering
  const consoleDebRes = sandbox.extractChainForAutocomplete('console.deb', 11, null, 0);
  assert.ok(consoleDebRes);
  assert.strictEqual(consoleDebRes.chain, 'console.deb');

  console.log('  ✓ inferTypeFromChain recognizes env, Math, JSON, Object, and console (including console.debug)');

  // 7. Test local variable declaration inspection
  const fullDocText = `
    const blabla = { foo: 'bar', count: 42 };
    const items = [1, 2, 3];
    const greeting = 'hello';
  `;
  const blablaInferred = sandbox.inferTypeFromChain('blabla', null, fullDocText);
  assert.strictEqual(blablaInferred.typeName, 'object');
  assert.ok(blablaInferred.schemaPart && blablaInferred.schemaPart.properties.foo);
  assert.ok(blablaInferred.schemaPart && blablaInferred.schemaPart.properties.count);

  const itemsInferred = sandbox.inferTypeFromChain('items', null, fullDocText);
  assert.strictEqual(itemsInferred.typeName, 'array');

  const greetingInferred = sandbox.inferTypeFromChain('greeting', null, fullDocText);
  assert.strictEqual(greetingInferred.typeName, 'string');
  console.log('  ✓ inferTypeFromChain extracts inferred types and properties from local variable declarations');

  // 8. Test multi-line callback bindings
  const fakeCm = {
    getLine: (lineNum) => {
      const lines = [
        'data.map(user => {',
        '  const formatted = user.'
      ];
      return lines[lineNum] || '';
    }
  };
  const bindings = sandbox.findCallbackBindings(fakeCm.getLine(1), fakeCm.getLine(1).length, fakeCm, 1);
  assert.ok(bindings.user, 'Should detect "user" binding from previous line arrow function');
  assert.strictEqual(bindings.user.inferredType, 'object');
  assert.ok(bindings.user.schemaPart && bindings.user.schemaPart.properties.id);
  assert.ok(bindings.user.schemaPart && bindings.user.schemaPart.properties.name);
  console.log('  ✓ findCallbackBindings resolves multi-line callback parameters');

  // 9. Test buildEnvCompletions contains env keys
  const envCompletions = sandbox.buildEnvCompletions();
  assert.ok(envCompletions.some(c => c.text === 'baseURL'), 'Should include baseURL in env completions');
  assert.ok(envCompletions.some(c => c.text === 'authToken'), 'Should include custom authToken from currentEnvVariables');
  console.log('  ✓ buildEnvCompletions includes active environment variables');

  // 10. Test buildAnyFallbackCompletions does not have duplicates
  const fallbackList = sandbox.buildAnyFallbackCompletions('unknownObj', 'unknownObj.customField = 10;');
  const customFieldItem = fallbackList.find(c => c.text === 'customField');
  assert.ok(customFieldItem, 'Should infer customField from usage');
  const seenTexts = new Set();
  let hasDuplicate = false;
  for (const item of fallbackList) {
    if (seenTexts.has(item.text)) {
      hasDuplicate = true;
      break;
    }
    seenTexts.add(item.text);
  }
  assert.strictEqual(hasDuplicate, false, 'Fallback completions should not contain duplicates');
  console.log('  ✓ buildAnyFallbackCompletions infers properties and eliminates duplicate methods');

  // 11. Test composite schema unwrapping and data.data array resolution
  const compositeSchema = {
    type: 'object',
    properties: {
      data: {
        name: 'data',
        type: 'object',
        properties: {
          data: {
            name: 'data',
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { name: 'id', type: 'number' },
                title: { name: 'title', type: 'string' }
              }
            }
          }
        }
      }
    }
  };

  sandbox.currentSchema = compositeSchema;

  const dataInferred = sandbox.inferTypeFromChain('data');
  assert.strictEqual(dataInferred.typeName, 'object', 'data should resolve to object');
  assert.ok(dataInferred.schemaPart && dataInferred.schemaPart.properties.data, 'data should have property data');

  const dataDataInferred = sandbox.inferTypeFromChain('data.data');
  assert.strictEqual(dataDataInferred.typeName, 'array', 'data.data should resolve to array');
  assert.ok(dataDataInferred.schemaPart && dataDataInferred.schemaPart.items, 'data.data should have items');

  const dataData0Inferred = sandbox.inferTypeFromChain('data.data[0]');
  assert.strictEqual(dataData0Inferred.typeName, 'object', 'data.data[0] should resolve to object');
  assert.ok(dataData0Inferred.schemaPart && dataData0Inferred.schemaPart.properties.id, 'data.data[0] should have id property');
  assert.ok(dataData0Inferred.schemaPart && dataData0Inferred.schemaPart.properties.title, 'data.data[0] should have title property');

  const mapCm = {
    getLine: (lineNum) => {
      const lines = [
        'data.data.map(item => {',
        '  return item.'
      ];
      return lines[lineNum] || '';
    }
  };
  const mapBindings = sandbox.findCallbackBindings(mapCm.getLine(1), mapCm.getLine(1).length, mapCm, 1);
  assert.ok(mapBindings.item, 'Should detect item binding on data.data.map');
  assert.strictEqual(mapBindings.item.inferredType, 'object', 'item in data.data.map should infer as object');
  assert.ok(mapBindings.item.schemaPart && mapBindings.item.schemaPart.properties.title);
  console.log('  ✓ Verified data.data array of objects does not duplicate data and correctly resolves array and item schemas');

  // 12. Test extractChainForAutocomplete with optional chaining (?.) and non-null assertion (!.)
  const optLine1 = 'const x = data?.';
  const optRes1 = sandbox.extractChainForAutocomplete(optLine1, optLine1.length, null, 0);
  assert.ok(optRes1, 'Should extract chain for data?.');
  assert.strictEqual(optRes1.chain, 'data?.');

  const bangLine1 = 'const x = data!.';
  const bangRes1 = sandbox.extractChainForAutocomplete(bangLine1, bangLine1.length, null, 0);
  assert.ok(bangRes1, 'Should extract chain for data!.');
  assert.strictEqual(bangRes1.chain, 'data!.');

  const optLine2 = 'const x = data?.items';
  const optRes2 = sandbox.extractChainForAutocomplete(optLine2, optLine2.length, null, 0);
  assert.ok(optRes2, 'Should extract chain for data?.items');
  assert.strictEqual(optRes2.chain, 'data?.items');

  const bangLine2 = 'const x = data!.items';
  const bangRes2 = sandbox.extractChainForAutocomplete(bangLine2, bangLine2.length, null, 0);
  assert.ok(bangRes2, 'Should extract chain for data!.items');
  assert.strictEqual(bangRes2.chain, 'data!.items');

  const optLine3 = 'const x = data?.data?.';
  const optRes3 = sandbox.extractChainForAutocomplete(optLine3, optLine3.length, null, 0);
  assert.ok(optRes3, 'Should extract chain for data?.data?.');
  assert.strictEqual(optRes3.chain, 'data?.data?.');

  const optLine4 = 'const x = data?.[0]?.';
  const optRes4 = sandbox.extractChainForAutocomplete(optLine4, optLine4.length, null, 0);
  assert.ok(optRes4, 'Should extract chain for data?.[0]?.');
  assert.strictEqual(optRes4.chain, 'data?.[0]?.');

  console.log('  ✓ extractChainForAutocomplete extracts chains with ?. and !.');

  // 13. Test cleanChain helper
  assert.strictEqual(sandbox.cleanChain('data?.'), 'data.');
  assert.strictEqual(sandbox.cleanChain('data!.'), 'data.');
  assert.strictEqual(sandbox.cleanChain('data?.items'), 'data.items');
  assert.strictEqual(sandbox.cleanChain('data!.items'), 'data.items');
  assert.strictEqual(sandbox.cleanChain('data?.data?.'), 'data.data.');
  assert.strictEqual(sandbox.cleanChain('data?.[0]'), 'data[0]');
  assert.strictEqual(sandbox.cleanChain('data!.[0]'), 'data[0]');
  assert.strictEqual(sandbox.cleanChain('data![0]'), 'data[0]');
  assert.strictEqual(sandbox.cleanChain('data?.[0]?.items'), 'data[0].items');
  assert.strictEqual(sandbox.cleanChain('data?'), 'data');
  assert.strictEqual(sandbox.cleanChain('data!'), 'data');
  console.log('  ✓ cleanChain properly normalizes optional chaining and non-null assertion syntax');

  // 14. Test inferTypeFromChain with ?. and !.
  const optInferData = sandbox.inferTypeFromChain('data?.');
  assert.strictEqual(optInferData.typeName, 'object');

  const bangInferData = sandbox.inferTypeFromChain('data!.');
  assert.strictEqual(bangInferData.typeName, 'object');

  const optInferDataData = sandbox.inferTypeFromChain('data?.data?.');
  assert.strictEqual(optInferDataData.typeName, 'array');

  const optInferElem = sandbox.inferTypeFromChain('data?.data?.[0]?.');
  assert.strictEqual(optInferElem.typeName, 'object');
  assert.ok(optInferElem.schemaPart && optInferElem.schemaPart.properties.title);

  const bangInferElem = sandbox.inferTypeFromChain('data!.data!.[0]!.');
  assert.strictEqual(bangInferElem.typeName, 'object');
  assert.ok(bangInferElem.schemaPart && bangInferElem.schemaPart.properties.id);
  console.log('  ✓ inferTypeFromChain resolves schema and types through ?. and !.');

  // 15. Test callback bindings with optional chaining
  const optMapCm = {
    getLine: (lineNum) => {
      const lines = [
        'data?.data?.map(item => {',
        '  return item?.'
      ];
      return lines[lineNum] || '';
    }
  };
  const optMapBindings = sandbox.findCallbackBindings(optMapCm.getLine(1), optMapCm.getLine(1).length, optMapCm, 1);
  assert.ok(optMapBindings.item, 'Should detect item binding on data?.data?.map');
  assert.strictEqual(optMapBindings.item.inferredType, 'object');
  assert.ok(optMapBindings.item.schemaPart && optMapBindings.item.schemaPart.properties.id);
  assert.ok(optMapBindings.item.schemaPart && optMapBindings.item.schemaPart.properties.title);

  const itemChain = sandbox.extractChainForAutocomplete(optMapCm.getLine(1), optMapCm.getLine(1).length, optMapCm, 1);
  assert.ok(itemChain, 'Should extract callback parameter chain with ?.');
  assert.strictEqual(itemChain.chain, 'item?.');
  console.log('  ✓ findCallbackBindings and extractChainForAutocomplete handle arrow functions with ?.');

  // 16. Test buildAnyFallbackCompletions infers properties accessed via ?. and !.
  const fallbackOptList = sandbox.buildAnyFallbackCompletions('unknownObj', 'unknownObj?.customProp = 10; unknownObj!.anotherProp = 20;');
  assert.ok(fallbackOptList.some(c => c.text === 'customProp'), 'Should infer customProp accessed via ?.');
  assert.ok(fallbackOptList.some(c => c.text === 'anotherProp'), 'Should infer anotherProp accessed via !.');
  console.log('  ✓ buildAnyFallbackCompletions infers properties accessed via ?. and !.');

  // 17. Test suppression of autocomplete inside strings and comments (e.g. typing admin. inside a string)
  // Single-quoted string
  const strLineSingle = "const role = 'admin.'";
  const strResSingle = sandbox.extractChainForAutocomplete(strLineSingle, strLineSingle.length - 1, null, 0);
  assert.strictEqual(strResSingle, null, "Should NOT extract chain when typing admin. inside single-quoted string");

  const strLineSingleUnclosed = "const role = 'admin.";
  const strResSingleUnclosed = sandbox.extractChainForAutocomplete(strLineSingleUnclosed, strLineSingleUnclosed.length, null, 0);
  assert.strictEqual(strResSingleUnclosed, null, "Should NOT extract chain when typing admin. inside unclosed single-quoted string");

  // Double-quoted string
  const strLineDouble = 'const role = "admin."';
  const strResDouble = sandbox.extractChainForAutocomplete(strLineDouble, strLineDouble.length - 1, null, 0);
  assert.strictEqual(strResDouble, null, "Should NOT extract chain when typing admin. inside double-quoted string");

  // Template string literal
  const BT = String.fromCharCode(96);
  const strLineTemplate = 'const role = ' + BT + 'admin.' + BT;
  const strResTemplate = sandbox.extractChainForAutocomplete(strLineTemplate, strLineTemplate.length - 1, null, 0);
  assert.strictEqual(strResTemplate, null, "Should NOT extract chain when typing admin. inside template literal");

  // Single-line comment
  const commentLineSingle = '// admin.';
  const commentResSingle = sandbox.extractChainForAutocomplete(commentLineSingle, commentLineSingle.length, null, 0);
  assert.strictEqual(commentResSingle, null, "Should NOT extract chain when typing admin. inside single-line comment");

  // Block comment
  const commentLineBlock = '/* admin. */';
  const commentResBlock = sandbox.extractChainForAutocomplete(commentLineBlock, 9, null, 0);
  assert.strictEqual(commentResBlock, null, "Should NOT extract chain when typing admin. inside block comment");

  // Inside callback filter string argument
  const filterStringLine = "data.filter(x => x.role === 'admin.')";
  const filterStringRes = sandbox.extractChainForAutocomplete(filterStringLine, 35, null, 0);
  assert.strictEqual(filterStringRes, null, "Should NOT extract chain when typing admin. inside string argument in callback");

  // But outside string after closing quote, e.g. const str = 'admin'; str.
  const afterStringLine = "const str = 'admin'; str.";
  const afterStringRes = sandbox.extractChainForAutocomplete(afterStringLine, afterStringLine.length, null, 0);
  assert.ok(afterStringRes, "Should allow autocomplete for identifier after string literal");
  assert.strictEqual(afterStringRes.chain, 'str.');

  // Inside template string interpolation, e.g. `User is ${data.`
  const templateInterpLine = 'const msg = ' + BT + 'User is ${data.' + BT;
  const templateInterpRes = sandbox.extractChainForAutocomplete(templateInterpLine, templateInterpLine.length - 1, null, 0);
  assert.ok(templateInterpRes, "Should allow autocomplete inside template interpolation ${data.");
  assert.strictEqual(templateInterpRes.chain, 'data.');

  // CodeMirror token check via mock cm
  const mockCmString = {
    getTokenAt: () => ({ type: 'string' })
  };
  assert.strictEqual(sandbox.isPositionInStringOrComment(mockCmString, { line: 0, ch: 5 }, 'admin.', 5), true);

  const mockCmComment = {
    getTokenAt: () => ({ type: 'comment' })
  };
  assert.strictEqual(sandbox.isPositionInStringOrComment(mockCmComment, { line: 0, ch: 5 }, 'admin.', 5), true);

  console.log('  ✓ Autocomplete successfully suppressed inside single-quoted, double-quoted, template strings and comments');

  console.log('\nAll autocomplete tests passed successfully!');
}

runAutocompleteTests().catch(err => {
  console.error('Autocomplete tests failed:', err);
  process.exit(1);
});
