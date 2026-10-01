import * as http from 'http';
import * as url from 'url';
import { Socket } from 'net';
import { MockServerConfig, MockServerRequestLog, MockServerState, MockRequestContext } from './types';
import { stringify } from './evaluator';

export const DEFAULT_MOCK_PORT = 3000;
export const DEFAULT_MOCK_ENDPOINT = '/api';
export const MAX_REQUEST_LOGS = 50;

/**
 * Filters an array of objects based on HTTP query string parameters.
 * Supports:
 * - Direct field equality: ?status=active -> item.status === 'active'
 * - Limit: ?limit=10 or ?_limit=10 -> items.slice(0, 10)
 * - Offset / Skip: ?offset=5 or ?skip=5 -> items.slice(5)
 * - Sorting: ?sort=price (asc) or ?sort=-price (desc), or ?_sort=price&_order=desc
 */
export function filterArrayByQuery(
  items: unknown[],
  query: Record<string, string | string[] | undefined>
): unknown[] {
  if (!Array.isArray(items) || items.length === 0 || !query || Object.keys(query).length === 0) {
    return items;
  }

  let result = [...items];

  // Extract pagination and sort params
  const limitParam = query.limit || query._limit;
  const offsetParam = query.offset || query._offset || query.skip || query._skip;
  const sortParam = query.sort || query._sort;
  const orderParam = (query.order || query._order || '') as string;

  // 1. Direct field filtering
  for (const [key, rawVal] of Object.entries(query)) {
    if (
      key === 'limit' || key === '_limit' ||
      key === 'offset' || key === '_offset' || key === 'skip' || key === '_skip' ||
      key === 'sort' || key === '_sort' || key === 'order' || key === '_order' ||
      rawVal === undefined
    ) {
      continue;
    }

    const valStr = String(Array.isArray(rawVal) ? rawVal[0] : rawVal).trim();

    result = result.filter(item => {
      if (item === null || typeof item !== 'object') return false;
      const itemVal = (item as Record<string, unknown>)[key];
      if (itemVal === undefined) return false;

      // Type-aware comparisons
      if (typeof itemVal === 'boolean') {
        const lower = valStr.toLowerCase();
        return itemVal === (lower === 'true' || lower === '1');
      }
      if (typeof itemVal === 'number') {
        const num = Number(valStr);
        return !isNaN(num) && itemVal === num;
      }
      return String(itemVal).toLowerCase() === valStr.toLowerCase();
    });
  }

  // 2. Sorting
  if (sortParam) {
    const rawSort = String(Array.isArray(sortParam) ? sortParam[0] : sortParam).trim();
    const isDesc = rawSort.startsWith('-') || orderParam.toLowerCase() === 'desc';
    const sortField = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

    result.sort((a, b) => {
      if (!a || typeof a !== 'object') return 0;
      if (!b || typeof b !== 'object') return 0;
      const valA = (a as Record<string, unknown>)[sortField];
      const valB = (b as Record<string, unknown>)[sortField];

      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return isDesc ? 1 : -1;
      if (valB === undefined || valB === null) return isDesc ? -1 : 1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return isDesc ? valB - valA : valA - valB;
      }
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      return isDesc ? strB.localeCompare(strA) : strA.localeCompare(strB);
    });
  }

  // 3. Offset
  if (offsetParam) {
    const offset = parseInt(String(Array.isArray(offsetParam) ? offsetParam[0] : offsetParam), 10);
    if (!isNaN(offset) && offset > 0) {
      result = result.slice(offset);
    }
  }

  // 4. Limit
  if (limitParam) {
    const limit = parseInt(String(Array.isArray(limitParam) ? limitParam[0] : limitParam), 10);
    if (!isNaN(limit) && limit >= 0) {
      result = result.slice(0, limit);
    }
  }

  return result;
}

/**
 * Checks whether an incoming request path matches the configured endpoint.
 */
export function matchesEndpoint(reqPath: string, endpoint: string): boolean {
  const normReq = reqPath.replace(/\/+$/, '') || '/';
  const normEndpoint = endpoint.replace(/\/+$/, '') || '/';
  if (normEndpoint === '/') return true;
  return normReq === normEndpoint || normReq.startsWith(normEndpoint + '/');
}

export type DynamicEvaluator = (context: MockRequestContext) => Promise<unknown> | unknown;

export interface MockServerManagerEvents {
  onStateChange?: (state: MockServerState) => void;
  onRequest?: (log: MockServerRequestLog) => void;
}

/**
 * Zero-dependency local Mock HTTP API server using Node.js native http.createServer.
 */
export class MockServerManager {
  private server: http.Server | null = null;
  private openSockets: Set<Socket> = new Set();
  private config: MockServerConfig = {
    port: DEFAULT_MOCK_PORT,
    endpoint: DEFAULT_MOCK_ENDPOINT,
    method: 'ALL',
    mode: 'static',
    autoFilter: true,
    latencyMs: 0,
    statusCode: 200,
    cors: true
  };
  private currentPayload: unknown = null;
  private dynamicEvaluator?: DynamicEvaluator;
  private logs: MockServerRequestLog[] = [];
  private requestCount = 0;
  private activePort = DEFAULT_MOCK_PORT;
  private activeUrl = `http://localhost:${DEFAULT_MOCK_PORT}${DEFAULT_MOCK_ENDPOINT}`;
  private isRunning = false;
  private lastError?: string;

  constructor(private events?: MockServerManagerEvents) {}

  /**
   * Updates the static payload served by the mock server.
   */
  public updatePayload(payload: unknown): void {
    this.currentPayload = payload;
  }

  /**
   * Sets the dynamic query evaluator invoked on incoming requests.
   */
  public setDynamicEvaluator(evaluator?: DynamicEvaluator): void {
    this.dynamicEvaluator = evaluator;
  }

  /**
   * Returns current mock server state.
   */
  public getState(): MockServerState {
    return {
      isRunning: this.isRunning,
      port: this.activePort,
      endpoint: this.config.endpoint,
      url: this.activeUrl,
      method: (this.config.method || 'ALL').toUpperCase(),
      mode: this.config.mode,
      autoFilter: this.config.autoFilter,
      latencyMs: this.config.latencyMs,
      statusCode: this.config.statusCode,
      requestCount: this.requestCount,
      logs: [...this.logs],
      error: this.lastError
    };
  }

  /**
   * Clears the request log buffer.
   */
  public clearLogs(): void {
    this.logs = [];
    this.events?.onStateChange?.(this.getState());
  }

  /**
   * Starts the local mock HTTP server.
   */
  public async start(
    customConfig?: Partial<MockServerConfig>,
    evaluator?: DynamicEvaluator
  ): Promise<MockServerState> {
    if (this.isRunning) {
      await this.stop();
    }

    if (customConfig) {
      this.config = {
        ...this.config,
        ...customConfig
      };
    }

    // Normalize endpoint
    let endpoint = (this.config.endpoint || DEFAULT_MOCK_ENDPOINT).trim();
    if (!endpoint.startsWith('/')) {
      endpoint = '/' + endpoint;
    }
    this.config.endpoint = endpoint;

    // Normalize method
    let method = (this.config.method || 'ALL').trim().toUpperCase();
    if (!method) {
      method = 'ALL';
    }
    this.config.method = method;

    if (evaluator) {
      this.dynamicEvaluator = evaluator;
    }

    this.lastError = undefined;

    const targetPort = this.config.port || DEFAULT_MOCK_PORT;
    const { server, port } = await this.listenWithFallback(targetPort, 10);
    this.server = server;
    this.activePort = port;
    this.activeUrl = `http://localhost:${port}${this.config.endpoint}`;
    this.isRunning = true;

    // Track active connection sockets to guarantee immediate cleanup on stop
    server.on('connection', socket => {
      this.openSockets.add(socket);
      socket.on('close', () => {
        this.openSockets.delete(socket);
      });
    });

    const state = this.getState();
    this.events?.onStateChange?.(state);
    return state;
  }

  /**
   * Stops the mock server and releases the port.
   */
  public async stop(): Promise<void> {
    if (!this.server && !this.isRunning) return;

    for (const socket of this.openSockets) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
    this.openSockets.clear();

    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.isRunning = false;
    const state = this.getState();
    this.events?.onStateChange?.(state);
  }

  /**
   * Tries to bind to targetPort; if in use, auto-increments up to maxAttempts.
   */
  private listenWithFallback(
    startPort: number,
    maxAttempts: number
  ): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve, reject) => {
      let currentPort = startPort;
      let attempts = 0;

      const tryListen = () => {
        const srv = http.createServer((req, res) => this.handleRequest(req, res));

        srv.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
            attempts++;
            currentPort++;
            tryListen();
          } else {
            this.lastError = err.message || String(err);
            reject(err);
          }
        });

        srv.once('listening', () => {
          resolve({ server: srv, port: currentPort });
        });

        srv.listen(currentPort, '127.0.0.1');
      };

      tryListen();
    });
  }

  /**
   * Handles incoming HTTP requests.
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startTime = performance.now();
    const reqMethod = (req.method || 'GET').toUpperCase();
    const parsedUrl = url.parse(req.url || '/', true);
    const reqPath = parsedUrl.pathname || '/';
    const query = (parsedUrl.query || {}) as Record<string, string | string[]>;

    // 1. CORS headers
    if (this.config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const standardMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
      const expMethod = (this.config.method || 'ALL').toUpperCase();
      if (expMethod !== 'ALL' && expMethod !== '*' && expMethod !== 'ANY' && !standardMethods.includes(expMethod)) {
        standardMethods.push(expMethod);
      }
      res.setHeader('Access-Control-Allow-Methods', standardMethods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', '*');
    }

    // 2. Handle OPTIONS preflight
    if (reqMethod === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 3. Read body if present
    let rawBody = '';
    try {
      rawBody = await this.readRequestBody(req);
    } catch {
      // Ignore body read errors
    }

    let parsedBody: unknown = rawBody;
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    // 4. Latency simulation
    if (this.config.latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.latencyMs));
    }

    // 5. Root status inspection if requested at "/" and endpoint is not "/"
    if (reqPath === '/' && this.config.endpoint !== '/') {
      const rootInfo = {
        name: 'JSON Tools Mock API Server',
        status: 'online',
        endpoint: this.config.endpoint,
        url: this.activeUrl,
        mode: this.config.mode,
        method: this.config.method || 'ALL',
        requestCount: this.requestCount
      };
      this.sendJsonResponse(res, 200, rootInfo);
      this.recordLog(req, reqMethod, reqPath, query, 200, startTime);
      return;
    }

    // 6. Route matching
    const isMatched = matchesEndpoint(reqPath, this.config.endpoint);
    if (!isMatched) {
      const notFoundData = {
        error: 'Not Found',
        message: `Endpoint ${reqPath} does not match mock endpoint ${this.config.endpoint}`,
        activeEndpoint: this.config.endpoint
      };
      this.sendJsonResponse(res, 404, notFoundData);
      this.recordLog(req, reqMethod, reqPath, query, 404, startTime);
      return;
    }

    // 6.5. Method validation
    const expectedMethod = (this.config.method || 'ALL').toUpperCase();
    const isMethodAllowed =
      expectedMethod === 'ALL' ||
      expectedMethod === '*' ||
      expectedMethod === 'ANY' ||
      reqMethod === expectedMethod;

    if (!isMethodAllowed) {
      res.setHeader('Allow', expectedMethod);
      const methodNotAllowedData = {
        error: 'Method Not Allowed',
        message: `HTTP Method ${reqMethod} is not allowed on ${reqPath}. Expected ${expectedMethod}`,
        expectedMethod,
        receivedMethod: reqMethod
      };
      this.sendJsonResponse(res, 405, methodNotAllowedData);
      this.recordLog(req, reqMethod, reqPath, query, 405, startTime);
      return;
    }

    // 7. Resolve payload (Static vs Dynamic)
    let statusCode = this.config.statusCode || 200;
    let responseData: unknown = null;

    if (this.config.mode === 'dynamic' && this.dynamicEvaluator) {
      try {
        const reqContext: MockRequestContext = {
          method: reqMethod,
          url: req.url || '/',
          path: reqPath,
          query,
          headers: req.headers,
          body: parsedBody
        };
        const dynamicResult = await this.dynamicEvaluator(reqContext);
        responseData = dynamicResult !== undefined ? dynamicResult : null;
      } catch (err: any) {
        statusCode = 500;
        responseData = {
          error: 'Dynamic Mock Evaluation Error',
          message: err?.message || String(err)
        };
      }
    } else {
      responseData = this.currentPayload !== undefined ? this.currentPayload : null;
    }

    // 8. Auto-filter query params on array results
    if (statusCode === 200 && this.config.autoFilter && Array.isArray(responseData)) {
      responseData = filterArrayByQuery(responseData, query);
    }

    this.sendJsonResponse(res, statusCode, responseData);
    this.recordLog(req, reqMethod, reqPath, query, statusCode, startTime);
  }

  /**
   * Buffers request body up to 1 MB limit.
   */
  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      const MAX_BODY = 1024 * 1024; // 1 MB

      req.on('data', chunk => {
        data += chunk;
        if (data.length > MAX_BODY) {
          req.destroy();
          reject(new Error('Payload Too Large'));
        }
      });

      req.on('end', () => resolve(data));
      req.on('error', err => reject(err));
    });
  }

  /**
   * Sends JSON response with standard metadata headers.
   */
  private sendJsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
    const jsonStr = data === null ? 'null' : (typeof data === 'string' ? data : stringify(data));
    const byteLength = Buffer.byteLength(jsonStr, 'utf-8');

    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': byteLength,
      'X-Powered-By': 'JSON-Tools-Mock-Server'
    });
    res.end(jsonStr);
  }

  /**
   * Records a request into the ring buffer and triggers event notifications.
   */
  private recordLog(
    req: http.IncomingMessage,
    method: string,
    reqPath: string,
    query: Record<string, string | string[]>,
    status: number,
    startTime: number
  ): void {
    const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
    this.requestCount++;

    const log: MockServerRequestLog = {
      id: 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      timestamp: Date.now(),
      method,
      path: reqPath,
      query,
      status,
      durationMs,
      ip: (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    };

    this.logs.unshift(log);
    if (this.logs.length > MAX_REQUEST_LOGS) {
      this.logs.pop();
    }

    this.events?.onRequest?.(log);
  }
}
