import { StreamEvent } from './types';

/**
 * Parses a single raw SSE message block into a StreamEvent.
 */
export function parseSseBlock(block: string): StreamEvent | null {
  const trimmed = block.trim();
  if (!trimmed) return null;

  let eventType = 'message';
  let eventId: string | undefined;
  const dataLines: string[] = [];

  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith(':')) {
      // Comment line, ignore per SSE spec
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      if (line.trim() === 'data') {
        dataLines.push('');
      }
      continue;
    }

    const field = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      eventType = value;
    } else if (field === 'data') {
      dataLines.push(value);
    } else if (field === 'id') {
      eventId = value;
    }
  }

  if (dataLines.length === 0 && !eventId) {
    return null;
  }

  const rawData = dataLines.join('\n');
  let parsedData: unknown = rawData;
  if (rawData) {
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      parsedData = rawData;
    }
  }

  return {
    event: eventType,
    data: parsedData,
    id: eventId,
    timestamp: Date.now()
  };
}

export interface SseConnectOptions {
  id: string;
  url: string;
  headers?: Record<string, string>;
  onEvent: (event: StreamEvent, buffer: StreamEvent[]) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
}

export interface WsConnectOptions {
  id: string;
  url: string;
  onMessage: (event: StreamEvent, buffer: StreamEvent[]) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;
  onOpen?: () => void;
}

/**
 * Manages live polling, Server-Sent Events (SSE), and WebSocket streams
 * with rolling event buffers and safe lifecycle cleanup.
 */
export class StreamManager {
  private pollingTimer: NodeJS.Timeout | null = null;
  private isPollingActive = false;
  private isTickInProgress = false;
  private pollCount = 0;
  private currentIntervalMs = 0;

  private activeSseControllers = new Map<string, AbortController>();
  private activeWebSockets = new Map<string, any>();
  private streamBuffers = new Map<string, StreamEvent[]>();
  private maxBufferSize: number;

  constructor(maxBufferSize = 500) {
    this.maxBufferSize = maxBufferSize;
  }

  // --- LIVE POLLING ---

  /**
   * Starts periodic polling with non-overlapping execution guard.
   */
  public startPolling(
    intervalMs: number,
    onTick: (pollCount: number) => Promise<void>,
    runImmediately = false
  ): void {
    this.stopPolling();
    this.currentIntervalMs = intervalMs;
    this.isPollingActive = true;
    this.pollCount = 0;

    const executeTick = async () => {
      if (!this.isPollingActive || this.isTickInProgress) return;
      this.isTickInProgress = true;
      this.pollCount++;
      try {
        await onTick(this.pollCount);
      } finally {
        this.isTickInProgress = false;
      }
    };

    if (runImmediately) {
      executeTick();
    }

    this.pollingTimer = setInterval(executeTick, intervalMs);
  }

  /**
   * Stops periodic live polling.
   */
  public stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.isPollingActive = false;
    this.isTickInProgress = false;
  }

  public isPolling(): boolean {
    return this.isPollingActive;
  }

  public getPollCount(): number {
    return this.pollCount;
  }

  public getPollingInterval(): number {
    return this.currentIntervalMs;
  }

  // --- SERVER-SENT EVENTS (SSE) ---

  /**
   * Connects to a Server-Sent Events endpoint using native fetch and ReadableStream.
   */
  public async connectSse(options: SseConnectOptions): Promise<void> {
    this.disconnectSse(options.id);

    const controller = new AbortController();
    this.activeSseControllers.set(options.id, controller);

    if (!this.streamBuffers.has(options.id)) {
      this.streamBuffers.set(options.id, []);
    }
    const buffer = this.streamBuffers.get(options.id)!;

    try {
      const headers = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
      };

      const res = await fetch(options.url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`SSE HTTP ${res.status} ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error('SSE response body is not readable.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let partial = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        partial += decoder.decode(value, { stream: true });
        const parts = partial.split(/(?:\r?\n){2}/);
        // The last part might be incomplete
        partial = parts.pop() || '';

        for (const block of parts) {
          const parsed = parseSseBlock(block);
          if (parsed) {
            buffer.push(parsed);
            if (buffer.length > this.maxBufferSize) {
              buffer.shift();
            }
            options.onEvent(parsed, [...buffer]);
          }
        }
      }

      // Check any remaining buffer
      if (partial.trim()) {
        const parsed = parseSseBlock(partial);
        if (parsed) {
          buffer.push(parsed);
          if (buffer.length > this.maxBufferSize) {
            buffer.shift();
          }
          options.onEvent(parsed, [...buffer]);
        }
      }

      options.onEnd?.();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Disconnected intentionally
        return;
      }
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.activeSseControllers.delete(options.id);
    }
  }

  /**
   * Disconnects an active SSE stream by source ID.
   */
  public disconnectSse(id: string): void {
    const controller = this.activeSseControllers.get(id);
    if (controller) {
      controller.abort();
      this.activeSseControllers.delete(id);
    }
  }

  public isSseConnected(id: string): boolean {
    return this.activeSseControllers.has(id);
  }

  // --- WEBSOCKET STREAM ---

  /**
   * Connects to a WebSocket endpoint using global WebSocket.
   */
  public connectWebSocket(options: WsConnectOptions): void {
    this.disconnectWebSocket(options.id);

    const WsCtor = (globalThis as any).WebSocket;
    if (typeof WsCtor === 'undefined') {
      const err = new Error('WebSocket is not supported in this runtime environment.');
      options.onError?.(err);
      return;
    }

    if (!this.streamBuffers.has(options.id)) {
      this.streamBuffers.set(options.id, []);
    }
    const buffer = this.streamBuffers.get(options.id)!;

    try {
      const ws = new WsCtor(options.url);
      this.activeWebSockets.set(options.id, ws);

      ws.onopen = () => {
        options.onOpen?.();
      };

      ws.onmessage = (event: any) => {
        let rawData = event.data;
        let parsedData: unknown = rawData;
        if (typeof rawData === 'string') {
          try {
            parsedData = JSON.parse(rawData);
          } catch {
            parsedData = rawData;
          }
        }
        const streamEvt: StreamEvent = {
          event: 'message',
          data: parsedData,
          timestamp: Date.now()
        };
        buffer.push(streamEvt);
        if (buffer.length > this.maxBufferSize) {
          buffer.shift();
        }
        options.onMessage(streamEvt, [...buffer]);
      };

      ws.onerror = (err: any) => {
        options.onError?.(err instanceof Error ? err : new Error(String(err.message || 'WebSocket Error')));
      };

      ws.onclose = (event: any) => {
        this.activeWebSockets.delete(options.id);
        options.onClose?.(event.code || 1000, event.reason || 'Normal Closure');
      };
    } catch (err: any) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Sends a message through an active WebSocket.
   */
  public sendWebSocket(id: string, message: string): void {
    const ws = this.activeWebSockets.get(id);
    if (ws && ws.readyState === 1 /* OPEN */) {
      ws.send(message);
    } else {
      throw new Error(`WebSocket for source '${id}' is not connected.`);
    }
  }

  /**
   * Disconnects an active WebSocket by source ID.
   */
  public disconnectWebSocket(id: string): void {
    const ws = this.activeWebSockets.get(id);
    if (ws) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
      this.activeWebSockets.delete(id);
    }
  }

  public isWsConnected(id: string): boolean {
    const ws = this.activeWebSockets.get(id);
    return Boolean(ws && ws.readyState === 1 /* OPEN */);
  }

  // --- STREAM BUFFER MANAGEMENT ---

  public getBuffer(id: string): StreamEvent[] {
    return this.streamBuffers.get(id) || [];
  }

  public clearBuffer(id: string): void {
    const buffer = this.streamBuffers.get(id);
    if (buffer) {
      buffer.length = 0;
    }
  }

  public clearAllBuffers(): void {
    this.streamBuffers.clear();
  }

  // --- DISPOSAL ---

  /**
   * Cleans up all polling timers, active SSE connections, WebSockets, and stream buffers.
   */
  public dispose(): void {
    this.stopPolling();
    for (const [id, controller] of this.activeSseControllers) {
      try {
        controller.abort();
      } catch {
        // Ignore
      }
    }
    this.activeSseControllers.clear();

    for (const [id, ws] of this.activeWebSockets) {
      try {
        ws.close();
      } catch {
        // Ignore
      }
    }
    this.activeWebSockets.clear();
    this.streamBuffers.clear();
  }
}
