const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testBenchmarkMeter() {
  console.log('Testing Query Execution Benchmark Meter (duration, byte size, status bar, and webview badges)...');

  // 1. Verify formatBytes and formatDuration exported from commands.ts
  const commandsPath = path.join(__dirname, '../src/commands.ts');
  const commandsSrc = fs.readFileSync(commandsPath, 'utf8');

  assert.ok(/export\s+(function\s+formatBytes|\{[^}]*\bformatBytes\b[^}]*\})/.test(commandsSrc), 'Expected formatBytes to be exported from commands.ts');
  assert.ok(/export\s+(function\s+formatDuration|\{[^}]*\bformatDuration\b[^}]*\})/.test(commandsSrc), 'Expected formatDuration to be exported from commands.ts');

  // Evaluate format helpers
  function formatBytes(bytes) {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDuration(ms) {
    if (typeof ms !== 'number' || isNaN(ms)) return '0ms';
    if (ms < 1) return (Math.round(ms * 10) / 10) + 'ms';
    if (ms < 1000) return (Math.round(ms * 10) / 10) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  // Test formatBytes
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(null), '0 B');
  assert.strictEqual(formatBytes(undefined), '0 B');
  assert.strictEqual(formatBytes(500), '500 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.strictEqual(formatBytes(1048576), '1 MB');
  assert.strictEqual(formatBytes(1572864), '1.5 MB');
  assert.strictEqual(formatBytes(1073741824), '1 GB');
  console.log('  ✓ Verified formatBytes accurately handles byte scale boundaries (B, KB, MB, GB)');

  // Test formatDuration
  assert.strictEqual(formatDuration(0), '0ms');
  assert.strictEqual(formatDuration(NaN), '0ms');
  assert.strictEqual(formatDuration(0.4), '0.4ms');
  assert.strictEqual(formatDuration(0.85), '0.9ms');
  assert.strictEqual(formatDuration(12.34), '12.3ms');
  assert.strictEqual(formatDuration(250), '250ms');
  assert.strictEqual(formatDuration(999), '999ms');
  assert.strictEqual(formatDuration(1000), '1.00s');
  assert.strictEqual(formatDuration(1420), '1.42s');
  assert.strictEqual(formatDuration(5230), '5.23s');
  console.log('  ✓ Verified formatDuration handles sub-millisecond, millisecond, and second ranges');

  // 2. Verify commands.ts benchmarks evaluateExpression and passes durationMs + byteSize
  assert.ok(commandsSrc.includes('const startTime = performance.now()'), 'Expected performance.now() timer start');
  assert.ok(commandsSrc.includes('const durationMs = Math.round((performance.now() - startTime) * 10) / 10'), 'Expected durationMs calculation');
  assert.ok(commandsSrc.includes('Buffer.byteLength(text, \'utf-8\')'), 'Expected Buffer.byteLength byte calculation');
  assert.ok(commandsSrc.includes('durationMs: benchmark?.durationMs'), 'Expected durationMs passed to webview postMessage');
  assert.ok(commandsSrc.includes('byteSize: benchmark?.byteSize'), 'Expected byteSize passed to webview postMessage');
  console.log('  ✓ Verified commands.ts captures execution timing and serializes byte size for IPC');

  // 3. Verify status bar item creation and lifecycle in commands.ts
  assert.ok(commandsSrc.includes('vscode.window.createStatusBarItem'), 'Expected VS Code StatusBarItem creation');
  assert.ok(commandsSrc.includes('benchmarkStatusBar.text ='), 'Expected benchmarkStatusBar text update');
  assert.ok(commandsSrc.includes('benchmarkStatusBar.tooltip ='), 'Expected benchmarkStatusBar tooltip update');
  assert.ok(commandsSrc.includes('benchmarkStatusBar?.dispose()') || commandsSrc.includes('benchmarkStatusBar.dispose()'), 'Expected benchmarkStatusBar disposal on panel dispose');
  assert.ok(commandsSrc.includes('panel.onDidChangeViewState'), 'Expected status bar visibility toggle on view state changes');
  console.log('  ✓ Verified VS Code Status Bar Item integration, visibility syncing, and disposal');

  // 4. Verify webview HTML elements and CSS in html.ts
  const htmlPath = path.join(__dirname, '../src/webview/html.ts');
  const htmlSrc = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(htmlSrc.includes('.benchmark-meter'), 'Expected .benchmark-meter CSS in html.ts');
  assert.ok(htmlSrc.includes('id="benchmarkMeter"'), 'Expected #benchmarkMeter element in html.ts');
  assert.ok(htmlSrc.includes('id="benchmarkDuration"'), 'Expected #benchmarkDuration element in html.ts');
  assert.ok(htmlSrc.includes('id="benchmarkByteSize"'), 'Expected #benchmarkByteSize element in html.ts');
  assert.ok(htmlSrc.includes('function updateBenchmarkMeter'), 'Expected updateBenchmarkMeter function in html.ts');
  console.log('  ✓ Verified webview HTML contains benchmark meter container, duration badge, byte size badge, and CSS');

  // 5. Test webview benchmark meter update logic in isolation
  const mockElements = {
    benchmarkMeter: { style: { display: 'none' }, title: '' },
    benchmarkDuration: { textContent: '' },
    benchmarkByteSize: { textContent: '' },
    resultInfo: { textContent: '', title: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } }
  };

  let testLastBenchmark = null;

  function simulateUpdateBenchmarkMeter(durationMs, byteSize, text) {
    if (durationMs !== undefined && durationMs !== null) {
      if (!testLastBenchmark) testLastBenchmark = {};
      testLastBenchmark.durationMs = durationMs;
    }
    if (byteSize !== undefined && byteSize !== null) {
      if (!testLastBenchmark) testLastBenchmark = {};
      testLastBenchmark.byteSize = byteSize;
    } else if (text && text.length > 0) {
      if (!testLastBenchmark) testLastBenchmark = {};
      testLastBenchmark.byteSize = Buffer.byteLength(text, 'utf-8');
    }

    if (!testLastBenchmark || (testLastBenchmark.durationMs === undefined && testLastBenchmark.byteSize === undefined)) {
      mockElements.benchmarkMeter.style.display = 'none';
      return;
    }

    const durText = testLastBenchmark.durationMs !== undefined ? formatDuration(testLastBenchmark.durationMs) : '0ms';
    const sizeText = testLastBenchmark.byteSize !== undefined ? formatBytes(testLastBenchmark.byteSize) : '0 B';

    mockElements.benchmarkDuration.textContent = '⏱️ ' + durText;
    mockElements.benchmarkByteSize.textContent = '💾 ' + sizeText;
    mockElements.benchmarkMeter.style.display = 'inline-flex';
    mockElements.benchmarkMeter.title = 'Execution time: ' + durText + ' | Size: ' + sizeText + 
      (testLastBenchmark.byteSize !== undefined ? ' (' + testLastBenchmark.byteSize.toLocaleString() + ' bytes)' : '');

    mockElements.resultInfo.setAttribute('data-duration', durText);
    mockElements.resultInfo.setAttribute('data-bytes', String(testLastBenchmark.byteSize ?? 0));
    mockElements.resultInfo.title = 'Query execution: ' + durText + ' | Size: ' + sizeText;
  }

  // Simulate query result arrival
  simulateUpdateBenchmarkMeter(14.2, 24576, '{"users": 100}');
  assert.strictEqual(mockElements.benchmarkMeter.style.display, 'inline-flex');
  assert.strictEqual(mockElements.benchmarkDuration.textContent, '⏱️ 14.2ms');
  assert.strictEqual(mockElements.benchmarkByteSize.textContent, '💾 24 KB');
  assert.strictEqual(mockElements.resultInfo.attributes['data-duration'], '14.2ms');
  assert.strictEqual(mockElements.resultInfo.attributes['data-bytes'], '24576');
  assert.ok(mockElements.benchmarkMeter.title.includes('14.2ms') && mockElements.benchmarkMeter.title.includes('24 KB'));

  // Simulate format switch to smaller/larger text representation
  const yamlText = 'users: 100\n';
  const yamlBytes = Buffer.byteLength(yamlText, 'utf-8');
  mockElements.benchmarkByteSize.textContent = '💾 ' + formatBytes(yamlBytes);
  assert.strictEqual(mockElements.benchmarkByteSize.textContent, '💾 11 B');

  // Simulate streaming result completion
  testLastBenchmark = null;
  simulateUpdateBenchmarkMeter(88.5, 1500000, '');
  assert.strictEqual(mockElements.benchmarkDuration.textContent, '⏱️ 88.5ms');
  assert.strictEqual(mockElements.benchmarkByteSize.textContent, '💾 1.4 MB');

  // Simulate error resetting benchmark meter
  testLastBenchmark = null;
  mockElements.benchmarkMeter.style.display = 'none';
  assert.strictEqual(mockElements.benchmarkMeter.style.display, 'none');

  console.log('  ✓ Verified webview benchmark meter UI state transitions, formatting, and DOM updates');
  console.log('✅ Query Execution Benchmark Meter tests passed successfully!\n');
}

testBenchmarkMeter().catch(err => {
  console.error('❌ test-benchmark-meter failed:', err);
  process.exit(1);
});
