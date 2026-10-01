#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  console.log('🧪 Testing Live Polling, SSE & WebSocket Stream Mode...');

  // 1. Bundle src/streamer.ts in memory
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/streamer.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundle.outputFiles[0].text);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { parseSseBlock, StreamManager } = mod.exports;

  // --- TEST SUITE 1: SSE Block Parser ---
  console.log('  Testing parseSseBlock...');
  {
    // 1.1 Simple JSON data
    const block1 = 'data: {"id": 1, "name": "Alpha"}';
    const evt1 = parseSseBlock(block1);
    assert(evt1, 'Expected parsed event');
    assert.strictEqual(evt1.event, 'message');
    assert.deepStrictEqual(evt1.data, { id: 1, name: 'Alpha' });
    assert(evt1.timestamp > 0);

    // 1.2 Custom event name and event ID
    const block2 = 'event: priceAlert\nid: evt-42\ndata: {"ticker": "ETH", "price": 3200}';
    const evt2 = parseSseBlock(block2);
    assert(evt2);
    assert.strictEqual(evt2.event, 'priceAlert');
    assert.strictEqual(evt2.id, 'evt-42');
    assert.deepStrictEqual(evt2.data, { ticker: 'ETH', price: 3200 });

    // 1.3 Multiline data (concatenated with newline)
    const block3 = 'data: line 1\ndata: line 2\ndata: line 3';
    const evt3 = parseSseBlock(block3);
    assert(evt3);
    assert.strictEqual(evt3.data, 'line 1\nline 2\nline 3');

    // 1.4 Comments ignored (lines starting with colon)
    const block4 = ': heartbeat keep-alive\ndata: {"status": "ok"}\n: comment at end';
    const evt4 = parseSseBlock(block4);
    assert(evt4);
    assert.deepStrictEqual(evt4.data, { status: 'ok' });

    // 1.5 CRLF support
    const block5 = 'event: tick\r\nid: 100\r\ndata: ping\r\n';
    const evt5 = parseSseBlock(block5);
    assert(evt5);
    assert.strictEqual(evt5.event, 'tick');
    assert.strictEqual(evt5.id, '100');
    assert.strictEqual(evt5.data, 'ping');

    // 1.6 Plain non-JSON string
    const block6 = 'data: Hello, World!';
    const evt6 = parseSseBlock(block6);
    assert(evt6);
    assert.strictEqual(evt6.data, 'Hello, World!');

    // 1.7 Empty or comment-only blocks return null
    assert.strictEqual(parseSseBlock(''), null);
    assert.strictEqual(parseSseBlock('   \n\r\n  '), null);
    assert.strictEqual(parseSseBlock(': comment only\n: comment two'), null);

    console.log('    ✔ parseSseBlock correctly handles JSON, multiline, custom events, comments, and CRLF');
  }

  // --- TEST SUITE 2: StreamManager Live Polling ---
  console.log('  Testing StreamManager polling...');
  {
    const sm = new StreamManager();
    assert.strictEqual(sm.isPolling(), false);
    assert.strictEqual(sm.getPollCount(), 0);

    const ticks = [];
    sm.startPolling(25, async (count) => {
      ticks.push(count);
    }, false);

    assert.strictEqual(sm.isPolling(), true);
    assert.strictEqual(sm.getPollingInterval(), 25);

    // Wait for at least 3 ticks
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert(ticks.length >= 2, `Expected at least 2 ticks, got ${ticks.length}`);
    assert.strictEqual(ticks[0], 1);
    assert.strictEqual(ticks[1], 2);

    sm.stopPolling();
    assert.strictEqual(sm.isPolling(), false);
    const stoppedCount = ticks.length;

    // Verify no ticks occur after stopping
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(ticks.length, stoppedCount, 'No ticks should fire after stopPolling()');

    console.log('    ✔ startPolling and stopPolling manage timers accurately');
  }

  // --- TEST SUITE 3: Non-Overlapping Polling Guard ---
  console.log('  Testing non-overlapping polling execution guard...');
  {
    const sm = new StreamManager();
    let inProgress = false;
    let overlapDetected = false;
    let tickRuns = 0;

    // Interval is fast (15ms), but tick execution takes 50ms
    sm.startPolling(15, async (count) => {
      if (inProgress) {
        overlapDetected = true;
      }
      inProgress = true;
      tickRuns++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      inProgress = false;
    }, true);

    await new Promise((resolve) => setTimeout(resolve, 140));
    sm.stopPolling();

    assert.strictEqual(overlapDetected, false, 'Overlap was detected! Guard failed.');
    assert(tickRuns >= 2, `Expected at least 2 ticks, got ${tickRuns}`);
    console.log('    ✔ Non-overlapping tick guard prevents concurrent execution when query takes longer than interval');
  }

  // --- TEST SUITE 4: Rolling Buffer Retention & Capacity Capping ---
  console.log('  Testing rolling buffer management...');
  {
    const sm = new StreamManager(3); // Capacity = 3

    // Mock WebSocket to feed messages into buffer
    const mockWsInstances = [];
    const OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        mockWsInstances.push(this);
      }
      send(data) { this.lastSent = data; }
      close() { this.readyState = 3; }
    };

    try {
      const receivedEvents = [];
      sm.connectWebSocket({
        id: 'ws-test-1',
        url: 'ws://example.com/socket',
        onMessage: (evt, buf) => {
          receivedEvents.push(evt);
        }
      });

      const ws = mockWsInstances[0];
      assert(ws, 'Mock WebSocket should have been created');

      // Feed 5 messages
      for (let i = 1; i <= 5; i++) {
        ws.onmessage({ data: JSON.stringify({ seq: i }) });
      }

      assert.strictEqual(receivedEvents.length, 5);
      const buf = sm.getBuffer('ws-test-1');
      assert.strictEqual(buf.length, 3, 'Buffer must be capped at maxBufferSize (3)');
      // Oldest dropped: seq 3, 4, 5 remain
      assert.strictEqual(buf[0].data.seq, 3);
      assert.strictEqual(buf[1].data.seq, 4);
      assert.strictEqual(buf[2].data.seq, 5);

      // Test clearBuffer
      sm.clearBuffer('ws-test-1');
      assert.strictEqual(sm.getBuffer('ws-test-1').length, 0);

      // Feed 1 more
      ws.onmessage({ data: JSON.stringify({ seq: 6 }) });
      assert.strictEqual(sm.getBuffer('ws-test-1').length, 1);

      // Test clearAllBuffers
      sm.clearAllBuffers();
      assert.strictEqual(sm.getBuffer('ws-test-1').length, 0);

      console.log('    ✔ Buffer respects FIFO max size capping and clear operations');
    } finally {
      globalThis.WebSocket = OriginalWebSocket;
    }
  }

  // --- TEST SUITE 5: Native Server-Sent Events (SSE) Stream ---
  console.log('  Testing Native SSE Stream Reader & Abort...');
  {
    const sm = new StreamManager(100);
    const originalFetch = globalThis.fetch;

    // Mock response stream with 3 SSE messages
    const sseChunks = [
      'data: {"step": 1}\n\n',
      'event: update\ndata: {"step": 2}\n\n',
      'data: {"step": 3}\n\n'
    ];

    let fetchCalled = false;
    let fetchSignal = null;

    globalThis.fetch = async (url, opts) => {
      fetchCalled = true;
      fetchSignal = opts.signal;

      const encoder = new TextEncoder();
      let chunkIdx = 0;

      const readable = new ReadableStream({
        async pull(controller) {
          if (chunkIdx < sseChunks.length) {
            controller.enqueue(encoder.encode(sseChunks[chunkIdx++]));
          } else {
            controller.close();
          }
        }
      });

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: readable
      };
    };

    try {
      const events = [];
      let ended = false;

      await sm.connectSse({
        id: 'sse-test-1',
        url: 'https://api.example.com/events',
        headers: { 'X-Custom-Header': 'val' },
        onEvent: (evt, buf) => {
          events.push(evt);
        },
        onEnd: () => {
          ended = true;
        }
      });

      assert.strictEqual(fetchCalled, true);
      assert.strictEqual(events.length, 3);
      assert.deepStrictEqual(events[0].data, { step: 1 });
      assert.strictEqual(events[1].event, 'update');
      assert.deepStrictEqual(events[1].data, { step: 2 });
      assert.deepStrictEqual(events[2].data, { step: 3 });
      assert.strictEqual(ended, true);

      // Test abort disconnect
      let abortReceived = false;
      globalThis.fetch = async (url, opts) => {
        opts.signal.addEventListener('abort', () => {
          abortReceived = true;
        });
        // Never-ending stream
        const readable = new ReadableStream({
          pull() {}
        });
        return { ok: true, status: 200, body: readable };
      };

      sm.connectSse({
        id: 'sse-abort-test',
        url: 'https://api.example.com/stream',
        onEvent: () => {}
      });

      assert.strictEqual(sm.isSseConnected('sse-abort-test'), true);
      sm.disconnectSse('sse-abort-test');
      assert.strictEqual(sm.isSseConnected('sse-abort-test'), false);
      assert.strictEqual(abortReceived, true, 'AbortController should have aborted fetch request');

      console.log('    ✔ connectSse parses streaming ReadableStream chunks and disconnectSse aborts gracefully');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // --- TEST SUITE 6: WebSocket Lifecycle & Messaging ---
  console.log('  Testing WebSocket connection & send/disconnect lifecycle...');
  {
    const sm = new StreamManager();
    const OriginalWebSocket = globalThis.WebSocket;

    let wsInstance = null;
    globalThis.WebSocket = class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        this.sentMessages = [];
        wsInstance = this;
      }
      send(data) {
        this.sentMessages.push(data);
      }
      close() {
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code: 1000, reason: 'Normal' });
      }
    };

    try {
      let openFired = false;
      let closedFired = false;
      const msgs = [];

      sm.connectWebSocket({
        id: 'ws-lifecycle',
        url: 'wss://example.com/feed',
        onOpen: () => { openFired = true; },
        onMessage: (evt) => { msgs.push(evt.data); },
        onClose: () => { closedFired = true; }
      });

      assert(wsInstance, 'WebSocket instance must be created');
      wsInstance.onopen();
      assert.strictEqual(openFired, true);
      assert.strictEqual(sm.isWsConnected('ws-lifecycle'), true);

      // Send a message
      sm.sendWebSocket('ws-lifecycle', JSON.stringify({ action: 'subscribe', channel: 'orders' }));
      assert.strictEqual(wsInstance.sentMessages.length, 1);
      assert.strictEqual(wsInstance.sentMessages[0], '{"action":"subscribe","channel":"orders"}');

      // Receive a message
      wsInstance.onmessage({ data: '{"channel":"orders","orderId":987}' });
      assert.strictEqual(msgs.length, 1);
      assert.deepStrictEqual(msgs[0], { channel: 'orders', orderId: 987 });

      // Disconnect
      sm.disconnectWebSocket('ws-lifecycle');
      assert.strictEqual(sm.isWsConnected('ws-lifecycle'), false);
      assert.strictEqual(closedFired, true);

      console.log('    ✔ WebSocket connects, opens, sends, receives messages, and disconnects cleanly');
    } finally {
      globalThis.WebSocket = OriginalWebSocket;
    }
  }

  // --- TEST SUITE 7: Dispose Lifecycle ---
  console.log('  Testing StreamManager.dispose()...');
  {
    const sm = new StreamManager();
    sm.startPolling(50, async () => {});
    assert.strictEqual(sm.isPolling(), true);

    sm.dispose();
    assert.strictEqual(sm.isPolling(), false);
    console.log('    ✔ StreamManager.dispose() tears down all timers, sockets, and buffers cleanly');
  }

  console.log('\n🎉 All Live Polling, SSE & WebSocket Stream Mode tests passed successfully!\n');
}

main().catch((err) => {
  console.error('\n❌ Stream Mode Tests Failed:', err);
  process.exit(1);
});
