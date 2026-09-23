import { HttpMethod } from './types';

export interface FetchOptions {
  url: string;
  method?: HttpMethod | string;
  headers?: Record<string, string> | string;
  body?: string;
  timeoutMs?: number;
}

/**
 * Parses raw header string (lines of "Key: Value" or JSON) into a Record<string, string>.
 */
export function parseHeaders(raw: string | Record<string, string> | undefined): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...raw };

  const trimmed = raw.trim();
  if (!trimmed) return {};

  // Try parsing as JSON first
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          result[String(k).trim()] = String(v);
        }
        return result;
      }
    } catch {
      // Fall through to line-by-line parsing
    }
  }

  // Parse multiline "Key: Value" format
  const headers: Record<string, string> = {};
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key) {
        headers[key] = val;
      }
    }
  }
  return headers;
}

/**
 * Formats a headers Record into a multiline string for editing.
 */
export function formatHeaders(headers: Record<string, string> | undefined): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export interface FetchDetailsResult {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  data: unknown;
  timeMs: number;
  sizeBytes: number;
}

/**
 * Fetches JSON or text data from a remote URL with custom method, headers, and body,
 * returning full response status, timing, headers, and parsed data.
 */
export async function fetchUrlWithDetails(options: FetchOptions): Promise<FetchDetailsResult> {
  const urlStr = (options.url || '').trim();
  if (!urlStr) {
    throw new Error('URL cannot be empty.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: "${urlStr}". URL must start with http:// or https://`);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: "${parsedUrl.protocol}". Only http:// and https:// are supported.`);
  }

  const method = (options.method || 'GET').toUpperCase() as HttpMethod;
  const parsedHeaders = parseHeaders(options.headers);

  // Set default Accept header if not explicitly defined
  const hasAccept = Object.keys(parsedHeaders).some(k => k.toLowerCase() === 'accept');
  if (!hasAccept) {
    parsedHeaders['Accept'] = 'application/json, text/plain, */*';
  }

  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchInit: RequestInit = {
    method,
    headers: parsedHeaders,
    signal: controller.signal
  };

  // Attach body for methods that support payload
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && options.body !== undefined && options.body.trim() !== '') {
    fetchInit.body = options.body;
    const hasContentType = Object.keys(parsedHeaders).some(k => k.toLowerCase() === 'content-type');
    if (!hasContentType) {
      const trimmedBody = options.body.trim();
      if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
        (fetchInit.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }
  }

  const startTime = Date.now();
  try {
    const res = await fetch(urlStr, fetchInit);
    const timeMs = Date.now() - startTime;

    const respHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      respHeaders[key] = val;
    });

    if (res.status === 204) {
      return {
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        headers: respHeaders,
        data: null,
        timeMs,
        sizeBytes: 0
      };
    }

    const text = await res.text();
    const sizeBytes = Buffer.byteLength(text, 'utf-8');
    const trimmed = text.trim();
    let data: unknown = null;

    if (trimmed) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        data = text;
      }
    }

    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      headers: respHeaders,
      data,
      timeMs,
      sizeBytes
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request to ${urlStr} timed out after ${timeoutMs / 1000} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches JSON or text data from a remote URL with custom method, headers, and body.
 */
export async function fetchUrlData(options: FetchOptions): Promise<unknown> {
  const result = await fetchUrlWithDetails(options);
  if (!result.ok) {
    let errSnippet = '';
    if (result.data !== null && result.data !== undefined) {
      const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      if (s) errSnippet = `: ${s.slice(0, 300)}${s.length > 300 ? '...' : ''}`;
    }
    throw new Error(`HTTP ${result.status} ${result.statusText}${errSnippet}`);
  }
  return result.data;
}

