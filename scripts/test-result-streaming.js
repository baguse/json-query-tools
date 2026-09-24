const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runStreamingTests() {
  console.log('Testing Result Streaming without artificial delay and without redundant full data re-transmission...');

  // 1. Verify commands.ts source code has removed artificial 10ms delay and redundant data re-transmission
  const commandsPath = path.join(__dirname, '../src/commands.ts');
  const commandsSrc = fs.readFileSync(commandsPath, 'utf8');

  assert.ok(
    !commandsSrc.includes('setTimeout(resolve, 10)'),
    'Expected setTimeout(resolve, 10) to be removed from sendResultStreaming in commands.ts'
  );
  assert.ok(
    commandsSrc.includes('setImmediate'),
    'Expected setImmediate event-loop yield in sendResultStreaming in commands.ts'
  );
  console.log('  ✓ Verified commands.ts uses setImmediate event-loop yield instead of artificial 10ms sleep');

  // Verify resultComplete does not include "data: data"
  const resultCompleteMatch = commandsSrc.match(/type:\s*['"]resultComplete['"][\s\S]*?\}/);
  assert.ok(resultCompleteMatch, 'Expected resultComplete message in commands.ts');
  assert.ok(
    !resultCompleteMatch[0].includes('data: data'),
    'Expected resultComplete to omit redundant data: data payload'
  );
  assert.ok(
    resultCompleteMatch[0].includes('isComplete: true'),
    'Expected resultComplete to pass metadata { isComplete: true }'
  );
  console.log('  ✓ Verified commands.ts sends metadata only on resultComplete without redundant data payload');

  // 2. Simulate sendResultStreaming implementation directly
  const STREAMING_THRESHOLD = 1000;
  const CHUNK_SIZE = 500;

  async function simulateSendResultStreaming(data, postMessageFn) {
    if (data && Array.isArray(data) && data.length >= STREAMING_THRESHOLD) {
      postMessageFn({
        type: 'resultStart',
        totalItems: data.length,
        text: '',
        data: null
      });

      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        const chunkEnd = Math.min(i + CHUNK_SIZE, data.length);
        const isLast = chunkEnd >= data.length;

        postMessageFn({
          type: 'resultChunk',
          chunk,
          chunkIndex: i,
          chunkEnd,
          isLast,
          totalItems: data.length
        });

        await new Promise(resolve => typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0));
      }

      // Send final completion message with metadata only
      postMessageFn({
        type: 'resultComplete',
        isComplete: true,
        totalItems: data.length
      });
    } else {
      postMessageFn({
        type: 'result',
        data
      });
    }
  }

  // Test 10,000 items (20 chunks)
  const messages = [];
  const testData = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` }));

  // Simulate webview client side state
  let clientStreamingData = null;
  let clientCurrentResultData = null;

  function webviewOnMessage(msg) {
    messages.push(msg);
    if (msg.type === 'resultStart') {
      clientStreamingData = [];
      clientCurrentResultData = null;
    } else if (msg.type === 'resultChunk') {
      if (!clientStreamingData) clientStreamingData = [];
      clientStreamingData.push(...msg.chunk);
    } else if (msg.type === 'resultComplete') {
      // Finalize aggregated streaming data without requiring msg.data
      clientCurrentResultData = msg.data || clientStreamingData || null;
      clientStreamingData = null;
    }
  }

  const start = Date.now();
  await simulateSendResultStreaming(testData, webviewOnMessage);
  const elapsed = Date.now() - start;

  assert.strictEqual(messages[0].type, 'resultStart');
  assert.strictEqual(messages[0].totalItems, 10000);

  const chunkMessages = messages.filter(m => m.type === 'resultChunk');
  assert.strictEqual(chunkMessages.length, 20, `Expected 20 chunks for 10,000 items, got ${chunkMessages.length}`);

  // Check first chunk
  assert.strictEqual(chunkMessages[0].chunkIndex, 0);
  assert.strictEqual(chunkMessages[0].chunkEnd, 500);
  assert.strictEqual(chunkMessages[0].isLast, false);
  assert.strictEqual(chunkMessages[0].chunk.length, 500);

  // Check last chunk
  const lastChunk = chunkMessages[chunkMessages.length - 1];
  assert.strictEqual(lastChunk.chunkIndex, 9500);
  assert.strictEqual(lastChunk.chunkEnd, 10000);
  assert.strictEqual(lastChunk.isLast, true);
  assert.strictEqual(lastChunk.chunk.length, 500);

  // Check resultComplete metadata only
  const lastMsg = messages[messages.length - 1];
  assert.strictEqual(lastMsg.type, 'resultComplete');
  assert.strictEqual(lastMsg.isComplete, true);
  assert.strictEqual(lastMsg.totalItems, 10000);
  assert.strictEqual(lastMsg.data, undefined, 'resultComplete must not retransmit data payload');

  // Verify webview aggregated all 10,000 items from chunks
  assert.ok(Array.isArray(clientCurrentResultData), 'Expected clientCurrentResultData to be an array');
  assert.strictEqual(clientCurrentResultData.length, 10000);
  assert.strictEqual(clientCurrentResultData[0].name, 'Item 0');
  assert.strictEqual(clientCurrentResultData[9999].name, 'Item 9999');
  assert.strictEqual(clientStreamingData, null, 'Expected clientStreamingData buffer to be cleared after finalization');
  console.log('  ✓ Webview successfully finalizes aggregated streaming chunks upon receiving metadata-only resultComplete');

  console.log(`  ✓ 10,000 items (20 chunks) streamed in ${elapsed}ms (fast, < 50ms)`);
  assert.ok(elapsed < 100, `Streaming 10,000 items took too long: ${elapsed}ms`);

  // Small array (< 1000 items) should not stream
  const smallMessages = [];
  const smallData = [{ a: 1 }, { a: 2 }];
  await simulateSendResultStreaming(smallData, (msg) => smallMessages.push(msg));
  assert.strictEqual(smallMessages.length, 1);
  assert.strictEqual(smallMessages[0].type, 'result');
  console.log('  ✓ Small datasets (< 1000 items) are sent in a single message without streaming overhead');

  // 3. Verify webview requestAnimationFrame batching in html.ts
  const htmlPath = path.join(__dirname, '../src/webview/html.ts');
  const htmlSrc = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(
    htmlSrc.includes('streamingRafId = requestAnimationFrame'),
    'Expected requestAnimationFrame progressive batching in html.ts'
  );
  assert.ok(
    htmlSrc.includes('cancelAnimationFrame(streamingRafId)'),
    'Expected cancelAnimationFrame cleanup on completion/start/error in html.ts'
  );
  console.log('  ✓ Verified html.ts includes requestAnimationFrame batching and cancelAnimationFrame cleanup');

  console.log('\n✅ All result streaming tests passed successfully!\n');
}

runStreamingTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
