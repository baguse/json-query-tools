const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  console.log('Testing helpers module (src/helpers.ts)...');

  // Bundle src/helpers.ts in memory for Node execution
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/helpers.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundle.outputFiles[0].text);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const {
    formatBytes,
    formatDuration,
    escapeHtml,
    escapeXml,
    isValidJsIdentifier,
    toBase64,
    getPrimaryUri,
    generateTimestampFileName,
    getDefaultSaveUri,
    getUriLabel
  } = mod.exports;

  // 1. formatBytes
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(null), '0 B');
  assert.strictEqual(formatBytes(undefined), '0 B');
  assert.strictEqual(formatBytes(NaN), '0 B');
  assert.strictEqual(formatBytes(-10), '0 B');
  assert.strictEqual(formatBytes(500), '500 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.strictEqual(formatBytes(1048576), '1 MB');
  assert.strictEqual(formatBytes(1073741824), '1 GB');
  console.log('✔ formatBytes passed');

  // 2. formatDuration
  assert.strictEqual(formatDuration(0), '0ms');
  assert.strictEqual(formatDuration(null), '0ms');
  assert.strictEqual(formatDuration(undefined), '0ms');
  assert.strictEqual(formatDuration(NaN), '0ms');
  assert.strictEqual(formatDuration(-5), '0ms');
  assert.strictEqual(formatDuration(0.4), '0.4ms');
  assert.strictEqual(formatDuration(25.4), '25.4ms');
  assert.strictEqual(formatDuration(999), '999ms');
  assert.strictEqual(formatDuration(1000), '1.00s');
  assert.strictEqual(formatDuration(1500), '1.50s');
  console.log('✔ formatDuration passed');

  // 3. escapeHtml
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml('hello world'), 'hello world');
  assert.strictEqual(escapeHtml('<script>alert("xss") & \'test\'</script>'), '&lt;script&gt;alert(&quot;xss&quot;) &amp; &#039;test&#039;&lt;/script&gt;');
  console.log('✔ escapeHtml passed');

  // 4. escapeXml
  assert.strictEqual(escapeXml(null), '');
  assert.strictEqual(escapeXml(undefined), '');
  assert.strictEqual(escapeXml('foo & bar < baz > "quote" \'apostrophe\''), 'foo &amp; bar &lt; baz &gt; &quot;quote&quot; &apos;apostrophe&apos;');
  console.log('✔ escapeXml passed');

  // 5. isValidJsIdentifier
  assert.strictEqual(isValidJsIdentifier('data'), true);
  assert.strictEqual(isValidJsIdentifier('data1'), true);
  assert.strictEqual(isValidJsIdentifier('_test'), true);
  assert.strictEqual(isValidJsIdentifier('$val'), true);
  assert.strictEqual(isValidJsIdentifier('user_profile_2'), true);

  assert.strictEqual(isValidJsIdentifier('1data'), false);
  assert.strictEqual(isValidJsIdentifier('data-1'), false);
  assert.strictEqual(isValidJsIdentifier('foo bar'), false);
  assert.strictEqual(isValidJsIdentifier(''), false);
  assert.strictEqual(isValidJsIdentifier(null), false);
  assert.strictEqual(isValidJsIdentifier(undefined), false);
  console.log('✔ isValidJsIdentifier passed');

  // 6. toBase64
  assert.strictEqual(toBase64('hello world'), Buffer.from('hello world').toString('base64'));
  assert.strictEqual(toBase64('test:secret123'), Buffer.from('test:secret123').toString('base64'));
  console.log('✔ toBase64 passed');

  // 7. getPrimaryUri
  const mockFile1 = { alias: 'other', uri: { fsPath: '/path/to/other.json' } };
  const mockFile2 = { alias: 'data', uri: { fsPath: '/path/to/data.json' } };
  const mockFile3 = { alias: 'extra', uri: { fsPath: '/path/to/extra.json' } };

  assert.strictEqual(getPrimaryUri([mockFile1, mockFile2]), mockFile2.uri);
  assert.strictEqual(getPrimaryUri([mockFile1, mockFile3]), mockFile1.uri);
  assert.strictEqual(getPrimaryUri([]), undefined);
  console.log('✔ getPrimaryUri passed');

  // 8. generateTimestampFileName
  const testDate = new Date('2026-09-25T12:34:56.789Z');
  const expectedTs = testDate.toISOString().replace(/[:.]/g, '-');
  assert.strictEqual(generateTimestampFileName('.png', testDate), `${expectedTs}.png`);
  assert.strictEqual(generateTimestampFileName('query.js', testDate), `${expectedTs}-query.js`);
  assert.strictEqual(generateTimestampFileName('-export.csv', testDate), `${expectedTs}-export.csv`);
  console.log('✔ generateTimestampFileName passed');

  // 9. getDefaultSaveUri
  const mockPrimary = {
    fsPath: '/workspace/project/data.json'
  };
  const mockJoinPath = (base, ...segments) => ({
    fsPath: [base.fsPath, ...segments].join('/')
  });

  const customWf = [{ uri: { fsPath: '/workspace/project' } }];
  const saveUri1 = getDefaultSaveUri({
    defaultName: 'out.json',
    primaryUri: mockPrimary
  });
  assert.ok(saveUri1.fsPath.includes('out.json'));

  const saveUri2 = getDefaultSaveUri({
    defaultName: 'export.csv',
    workspaceFolders: customWf
  });
  assert.ok(saveUri2.fsPath.includes('export.csv'));
  console.log('✔ getDefaultSaveUri passed');

  // 10. getUriLabel
  assert.strictEqual(getUriLabel(null), '(none)');
  assert.strictEqual(getUriLabel(undefined), '(none)');
  assert.strictEqual(getUriLabel({ fsPath: '/home/user/test.json' }), '/home/user/test.json');
  console.log('✔ getUriLabel passed');

  console.log('All helpers unit tests passed successfully!');
}

main().catch(err => {
  console.error('helpers tests failed:', err);
  process.exit(1);
});
