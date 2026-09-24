const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runStreamingTests() {
  console.log('Testing Result Streaming without artificial delay...');

  // 1. Verify commands.ts source code has removed the artificial 10ms delay
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

      postMessageFn({
        type: 'resultComplete',
        text: 'done',
        data
      });
    } else {
      postMessageFn({
        type: 'result',
        data
      });
    }
  }

  // Test 10,000 items (20 chunks)
  // With 10ms delay: 20 * 10ms = 200ms+
  // With setImmediate: < 30ms
  const messages = [];
  const testData = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `Item ${i}` }));

  const start = Date.now();
  await simulateSendResultStreaming(testData, (msg) => messages.push(msg));
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

  // Check resultComplete
  const lastMsg = messages[messages.length - 1];
  assert.strictEqual(lastMsg.type, 'resultComplete');
  assert.strictEqual(lastMsg.data.length, 10000);

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
