const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const vm = require('vm');

async function runExportFormatsTests() {
  console.log('Testing export serializers (YAML, NDJSON, XML, CSV, JSON)...');

  // 1. Bundle and load src/export.ts
  const exportBuild = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/export.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const exportMod = { exports: {} };
  const exportFn = new Function('module', 'exports', 'require', '__dirname', exportBuild.outputFiles[0].text);
  exportFn(exportMod, exportMod.exports, require, path.join(__dirname, '../src'));

  const {
    toJson,
    toCsv,
    toYaml,
    toNdjson,
    toXml,
    formatData,
    getFileExtension,
    getLanguageId,
    getMimeType,
    getFormatFilters,
    escapeXml,
    sanitizeXmlTagName
  } = exportMod.exports;

  // --- toJson tests ---
  console.log('  Testing toJson...');
  const jsonWithBigInt = toJson({ id: 100n, name: 'Alice' }, 2);
  assert.strictEqual(JSON.parse(jsonWithBigInt).id, '100');
  assert.strictEqual(JSON.parse(jsonWithBigInt).name, 'Alice');

  // --- toCsv tests ---
  console.log('  Testing toCsv...');
  const csvData = [
    { id: 1, name: 'John Doe', notes: 'line 1\nline 2' },
    { id: 2, name: 'Jane "Ace", Jr.', notes: 'simple' }
  ];
  const csvResult = toCsv(csvData);
  assert(csvResult.includes('id,name,notes'));
  assert(csvResult.includes('"Jane ""Ace"", Jr."'));
  assert(csvResult.includes('"line 1\nline 2"'));

  const primitiveCsv = toCsv(['apple', 'banana, with comma', 123]);
  assert.strictEqual(primitiveCsv, 'Value\napple\n"banana, with comma"\n123');

  // --- toYaml tests ---
  console.log('  Testing toYaml...');
  const yamlObj = {
    appName: 'json-tools',
    version: 1.2,
    enabled: true,
    description: 'A tool: for queries',
    ports: [8080, 9090],
    users: [
      { id: 1, username: 'admin' },
      { id: 2, username: 'guest' }
    ],
    metadata: {
      tags: ['json', 'vscode'],
      active: null
    }
  };

  const yamlResult = toYaml(yamlObj);
  assert(yamlResult.includes('appName: json-tools'));
  assert(yamlResult.includes('version: 1.2'));
  assert(yamlResult.includes('enabled: true'));
  // String with colon needs quotes
  assert(yamlResult.includes('description: "A tool: for queries"'));
  assert(yamlResult.includes('- 8080'));
  assert(yamlResult.includes('- id: 1'));
  assert(yamlResult.includes('username: admin'));
  assert(yamlResult.includes('active: null'));

  // Test circular reference in YAML
  const circularObj = { name: 'cycle' };
  circularObj.self = circularObj;
  const circularYaml = toYaml(circularObj);
  assert(circularYaml.includes('self: "[Circular]"'));

  // --- toNdjson tests ---
  console.log('  Testing toNdjson...');
  const ndjsonData = [
    { id: 1, text: 'first' },
    { id: 2n, text: 'second' }
  ];
  const ndjsonResult = toNdjson(ndjsonData);
  const ndjsonLines = ndjsonResult.split('\n');
  assert.strictEqual(ndjsonLines.length, 2);
  assert.strictEqual(JSON.parse(ndjsonLines[0]).text, 'first');
  assert.strictEqual(JSON.parse(ndjsonLines[1]).id, '2');

  // Single item in toNdjson
  assert.strictEqual(toNdjson({ single: true }), '{"single":true}');

  // --- toXml tests ---
  console.log('  Testing toXml...');
  assert.strictEqual(escapeXml('foo & bar < baz > "quote" \'apostrophe\''), 'foo &amp; bar &lt; baz &gt; &quot;quote&quot; &apos;apostrophe&apos;');
  assert.strictEqual(sanitizeXmlTagName('123item'), '_123item');
  assert.strictEqual(sanitizeXmlTagName('item name with spaces'), 'item_name_with_spaces');
  assert.strictEqual(sanitizeXmlTagName(''), 'item');

  const xmlData = {
    title: 'Books & Movies',
    count: 2,
    available: true,
    items: [
      { id: 101, title: 'Clean Code' },
      { id: 102, title: 'Refactoring' }
    ]
  };

  const xmlResult = toXml(xmlData, 'catalog');
  assert(xmlResult.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert(xmlResult.includes('<catalog>'));
  assert(xmlResult.includes('</catalog>'));
  assert(xmlResult.includes('<title>Books &amp; Movies</title>'));
  assert(xmlResult.includes('<count>2</count>'));
  assert(xmlResult.includes('<available>true</available>'));
  assert(xmlResult.includes('<id>101</id>'));
  assert(xmlResult.includes('<title>Clean Code</title>'));

  // Test array of objects in XML
  const xmlArray = [
    { name: 'Alpha' },
    { name: 'Beta' }
  ];
  const xmlArrayResult = toXml(xmlArray, 'list');
  assert(xmlArrayResult.includes('<list>'));
  assert(xmlArrayResult.includes('<item>'));
  assert(xmlArrayResult.includes('<name>Alpha</name>'));
  assert(xmlArrayResult.includes('</list>'));

  // Test circular reference in XML
  const circularXml = { name: 'xmlCycle' };
  circularXml.ref = circularXml;
  const circularXmlRes = toXml(circularXml);
  assert(circularXmlRes.includes('<ref>[Circular]</ref>'));

  // --- formatData tests ---
  console.log('  Testing formatData and format helpers...');
  assert.strictEqual(formatData({ a: 1 }, 'json').trim(), '{\n  "a": 1\n}');
  assert(formatData([{ a: 1 }], 'csv').includes('a\n1'));
  assert(formatData({ a: 1 }, 'yaml').includes('a: 1'));
  assert(formatData([{ a: 1 }], 'ndjson').includes('{"a":1}'));
  assert(formatData({ a: 1 }, 'xml').includes('<a>1</a>'));

  // Helpers
  assert.strictEqual(getFileExtension('yaml'), '.yaml');
  assert.strictEqual(getFileExtension('yml'), '.yaml');
  assert.strictEqual(getFileExtension('ndjson'), '.ndjson');
  assert.strictEqual(getFileExtension('jsonl'), '.ndjson');
  assert.strictEqual(getFileExtension('xml'), '.xml');
  assert.strictEqual(getFileExtension('csv'), '.csv');
  assert.strictEqual(getFileExtension('json'), '.json');

  assert.strictEqual(getLanguageId('yaml'), 'yaml');
  assert.strictEqual(getLanguageId('ndjson'), 'jsonl');
  assert.strictEqual(getLanguageId('xml'), 'xml');
  assert.strictEqual(getLanguageId('csv'), 'csv');
  assert.strictEqual(getLanguageId('json'), 'json');

  assert.deepStrictEqual(getFormatFilters('yaml'), { 'YAML': ['yaml', 'yml'] });
  assert.deepStrictEqual(getFormatFilters('ndjson'), { 'NDJSON': ['ndjson', 'jsonl'] });
  assert.deepStrictEqual(getFormatFilters('xml'), { 'XML': ['xml'] });

  // 2. Test webview parity
  console.log('  Testing webview script export parity...');
  const htmlBuild = await esbuild.build({
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

  const htmlMod = { exports: {} };
  const htmlFn = new Function('module', 'exports', 'require', '__dirname', htmlBuild.outputFiles[0].text);
  htmlFn(htmlMod, htmlMod.exports, require, path.join(__dirname, '../src/webview'));

  const { getQueryEditorHtml } = htmlMod.exports;
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce',
    sources: []
  });

  // Verify UI elements exist in HTML
  assert(html.includes('id="saveYaml"'), 'saveYaml button should exist');
  assert(html.includes('id="saveNdjson"'), 'saveNdjson button should exist');
  assert(html.includes('id="saveXml"'), 'saveXml button should exist');
  assert(html.includes('id="exportDropdown"'), 'exportDropdown should exist');
  assert(html.includes('<option value="yaml">YAML</option>'), 'resultFormat should include YAML');
  assert(html.includes('<option value="ndjson">NDJSON</option>'), 'resultFormat should include NDJSON');
  assert(html.includes('<option value="xml">XML</option>'), 'resultFormat should include XML');

  // Extract script and verify client-side serializers run in sandbox
  const scriptRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match;
  let targetScript = null;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].includes('function generateXml') && match[1].includes('function generateYaml')) {
      targetScript = match[1];
      break;
    }
  }

  assert(targetScript, 'Webview script containing generateXml and generateYaml must exist');

  const sandbox = {
    acquireVsCodeApi: () => ({
      postMessage: () => {},
      getState: () => ({}),
      setState: () => {}
    }),
    document: {
      getElementById: () => ({ addEventListener: () => {}, style: {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
      addEventListener: () => {}
    },
    window: { addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    CodeMirror: {},
    js_beautify: () => '',
    acorn: {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    resultTableHead: null,
    resultTableBody: null,
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(targetScript, sandbox);

  const clientGenerateYaml = sandbox.generateYaml;
  const clientGenerateNdjson = sandbox.generateNdjson;
  const clientGenerateXml = sandbox.generateXml;
  const clientFormatResultData = sandbox.formatResultData;

  assert.strictEqual(typeof clientGenerateYaml, 'function');
  assert.strictEqual(typeof clientGenerateNdjson, 'function');
  assert.strictEqual(typeof clientGenerateXml, 'function');
  assert.strictEqual(typeof clientFormatResultData, 'function');

  // Test webview YAML serializer
  const clientYaml = clientGenerateYaml({ name: 'WebviewTest', count: 5 });
  assert(clientYaml.includes('name: WebviewTest'));
  assert(clientYaml.includes('count: 5'));

  // Test webview NDJSON serializer
  const clientNdjson = clientGenerateNdjson([{ a: 1 }, { b: 2 }]);
  assert.strictEqual(clientNdjson, '{"a":1}\n{"b":2}');

  // Test webview XML serializer
  const clientXml = clientGenerateXml({ title: 'Webview XML' });
  assert(clientXml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
  assert(clientXml.includes('<title>Webview XML</title>'));

  // Test webview formatResultData
  assert(clientFormatResultData({ x: 1 }, 'yaml').includes('x: 1'));
  assert(clientFormatResultData([{ x: 1 }], 'ndjson').includes('{"x":1}'));
  assert(clientFormatResultData({ x: 1 }, 'xml').includes('<x>1</x>'));

  console.log('\n✅ All export format tests passed successfully!\n');
}

runExportFormatsTests().catch(err => {
  console.error('\n❌ Export format tests failed:', err);
  process.exit(1);
});
