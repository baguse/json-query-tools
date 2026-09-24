/**
 * cURL command parser and generator for HTTP requests.
 * Supports bash, Windows CMD, and PowerShell cURL formats.
 */

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  headersString: string;
  body: string;
}

export interface CurlGenerateOptions {
  url: string;
  method?: string;
  headers?: string | Record<string, string>;
  body?: string;
}

function toBase64(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return '';
}

/**
 * Tokenizes a command string into arguments, handling single/double quotes,
 * ANSI-C quotes ($'...'), backslash escapes, and shell line continuations.
 */
export function tokenizeArgs(cmd: string): string[] {
  if (!cmd) return [];

  // Normalize line continuations:
  // Bash: \ followed by newline
  // Windows cmd: ^ followed by newline
  // PowerShell: ` followed by newline
  const lines = cmd.split(/\r?\n/);
  let combined = '';
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    const trimEnd = l.replace(/\s+$/, '');
    if (trimEnd.endsWith('\\') || trimEnd.endsWith('^') || trimEnd.endsWith('`')) {
      combined += trimEnd.slice(0, -1) + ' ';
    } else {
      combined += l + '\n';
    }
  }
  const clean = combined.trim();

  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inAnsiCQuote = false;
  let isEscaped = false;
  let tokenStarted = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (isEscaped) {
      current += char;
      tokenStarted = true;
      isEscaped = false;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (inAnsiCQuote) {
      if (char === '\\') {
        if (i + 1 < clean.length) {
          const next = clean[++i];
          if (next === 'n') current += '\n';
          else if (next === 'r') current += '\r';
          else if (next === 't') current += '\t';
          else if (next === "'") current += "'";
          else if (next === '\\') current += '\\';
          else current += next;
        }
      } else if (char === "'") {
        inAnsiCQuote = false;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '\\') {
        if (i + 1 < clean.length) {
          const next = clean[++i];
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
          } else if (next === 'n') {
            current += '\n';
          } else if (next === 'r') {
            current += '\r';
          } else if (next === 't') {
            current += '\t';
          } else {
            current += '\\' + next;
          }
        } else {
          current += '\\';
        }
      } else if (char === '"') {
        // Handle escaped double-quote in Windows CMD ("")
        if (i + 1 < clean.length && clean[i + 1] === '"') {
          current += '"';
          i++; // skip second quote
        } else {
          inDoubleQuote = false;
        }
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    // Outside quotes
    if (char === '\\') {
      if (i + 1 < clean.length) {
        current += clean[++i];
        tokenStarted = true;
      }
      continue;
    }

    if (char === '$' && i + 1 < clean.length && clean[i + 1] === "'") {
      inAnsiCQuote = true;
      tokenStarted = true;
      i++; // skip quote
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      tokenStarted = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (tokenStarted) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parses a cURL command into structured URL, method, headers, and body.
 */
export function parseCurl(cmd: string): ParsedCurl {
  const tokens = tokenizeArgs(cmd);
  let url = '';
  let method = '';
  const headers: Record<string, string> = {};
  const headerLines: string[] = [];
  const bodyChunks: string[] = [];

  let startIdx = 0;
  if (tokens.length > 0 && /^(curl|curl\.exe)$/i.test(tokens[0])) {
    startIdx = 1;
  }

  const argFlags = new Set([
    '-X', '--request',
    '-H', '--header',
    '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode',
    '-u', '--user',
    '-A', '--user-agent',
    '-b', '--cookie',
    '--url',
    '-m', '--max-time',
    '--connect-timeout',
    '-e', '--referer',
    '-o', '--output',
    '--retry'
  ]);

  const boolFlags = new Set([
    '-k', '--insecure',
    '-s', '--silent',
    '-S', '--show-error',
    '-v', '--verbose',
    '-L', '--location',
    '-i', '--include',
    '-I', '--head',
    '-G', '--get',
    '--compressed',
    '--no-buffer',
    '-N',
    '-f', '--fail',
    '-0', '--http1.0',
    '--http1.1',
    '--http2'
  ]);

  function addHeader(headerStr: string) {
    if (!headerStr) return;
    const colonIdx = headerStr.indexOf(':');
    if (colonIdx > 0) {
      const key = headerStr.slice(0, colonIdx).trim();
      const val = headerStr.slice(colonIdx + 1).trim();
      headers[key] = val;
      headerLines.push(`${key}: ${val}`);
    } else {
      headerLines.push(headerStr.trim());
    }
  }

  function handleBasicAuth(userPass: string) {
    const b64 = toBase64(userPass);
    if (b64) {
      headers['Authorization'] = `Basic ${b64}`;
      headerLines.push(`Authorization: Basic ${b64}`);
    }
  }

  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-I' || token === '--head') {
      method = 'HEAD';
      continue;
    }
    if (token === '-G' || token === '--get') {
      method = 'GET';
      continue;
    }

    if (token === '--url' && i + 1 < tokens.length) {
      url = tokens[++i];
      continue;
    }
    if (token.startsWith('--url=')) {
      url = token.slice(6);
      continue;
    }

    if ((token === '-X' || token === '--request') && i + 1 < tokens.length) {
      method = tokens[++i].toUpperCase();
      continue;
    }
    if (token.startsWith('--request=')) {
      method = token.slice(10).toUpperCase();
      continue;
    }
    if (token.startsWith('-X') && token.length > 2) {
      method = token.slice(2).toUpperCase();
      continue;
    }

    if ((token === '-H' || token === '--header') && i + 1 < tokens.length) {
      addHeader(tokens[++i]);
      continue;
    }
    if (token.startsWith('--header=')) {
      addHeader(token.slice(9));
      continue;
    }
    if (token.startsWith('-H') && token.length > 2) {
      addHeader(token.slice(2));
      continue;
    }

    if ((token === '-A' || token === '--user-agent') && i + 1 < tokens.length) {
      addHeader('User-Agent: ' + tokens[++i]);
      continue;
    }
    if (token.startsWith('--user-agent=')) {
      addHeader('User-Agent: ' + token.slice(14));
      continue;
    }

    if ((token === '-b' || token === '--cookie') && i + 1 < tokens.length) {
      addHeader('Cookie: ' + tokens[++i]);
      continue;
    }
    if (token.startsWith('--cookie=')) {
      addHeader('Cookie: ' + token.slice(9));
      continue;
    }

    if ((token === '-u' || token === '--user') && i + 1 < tokens.length) {
      handleBasicAuth(tokens[++i]);
      continue;
    }
    if (token.startsWith('--user=')) {
      handleBasicAuth(token.slice(7));
      continue;
    }
    if (token.startsWith('-u') && token.length > 2) {
      handleBasicAuth(token.slice(2));
      continue;
    }

    if ((token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-ascii' || token === '--data-urlencode') && i + 1 < tokens.length) {
      bodyChunks.push(tokens[++i]);
      continue;
    }
    if (token.startsWith('--data=') || token.startsWith('--data-raw=') || token.startsWith('--data-binary=') || token.startsWith('--data-ascii=') || token.startsWith('--data-urlencode=')) {
      const eqIdx = token.indexOf('=');
      bodyChunks.push(token.slice(eqIdx + 1));
      continue;
    }
    if (token.startsWith('-d') && token.length > 2) {
      bodyChunks.push(token.slice(2));
      continue;
    }

    if (argFlags.has(token) && i + 1 < tokens.length) {
      i++; // skip argument
      continue;
    }

    if (token.startsWith('-') && token.includes('=')) {
      continue;
    }

    if (boolFlags.has(token) || token.startsWith('-')) {
      continue;
    }

    if (!url) {
      url = token;
    }
  }

  const finalBody = bodyChunks.join('&');
  if (!method) {
    method = bodyChunks.length > 0 ? 'POST' : 'GET';
  }

  return {
    url: url.trim(),
    method: method || 'GET',
    headers,
    headersString: headerLines.join('\n'),
    body: finalBody
  };
}

/**
 * Generates a clean multiline bash-compatible cURL command from options.
 */
export function generateCurl(options: CurlGenerateOptions): string {
  const url = (options.url || '').trim();
  let method = (options.method || 'GET').toUpperCase();
  const body = options.body !== undefined && options.body !== null ? String(options.body).trim() : '';

  const headerList: Array<{ key: string; value: string }> = [];

  function parseLines(str: string) {
    const lines = str.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      if (idx > 0) {
        headerList.push({
          key: trimmed.slice(0, idx).trim(),
          value: trimmed.slice(idx + 1).trim()
        });
      }
    }
  }

  if (typeof options.headers === 'string') {
    const raw = options.headers.trim();
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const obj = JSON.parse(raw);
        for (const [k, v] of Object.entries(obj)) {
          if (k && v !== undefined && v !== null) {
            headerList.push({ key: k.trim(), value: String(v).trim() });
          }
        }
      } catch {
        parseLines(raw);
      }
    } else {
      parseLines(raw);
    }
  } else if (typeof options.headers === 'object' && options.headers !== null) {
    for (const [k, v] of Object.entries(options.headers)) {
      if (k && v !== undefined && v !== null) {
        headerList.push({ key: k.trim(), value: String(v).trim() });
      }
    }
  }

  const parts: string[] = ['curl'];

  if (method !== 'GET' || body) {
    parts.push(`-X ${method}`);
  }

  const escapedUrl = url.split('"').join('\\"');
  parts.push(`"${escapedUrl}"`);

  const lines: string[] = [];
  lines.push(parts.join(' '));

  for (const h of headerList) {
    const escapedVal = `${h.key}: ${h.value}`.split('"').join('\\"');
    lines.push(`  -H "${escapedVal}"`);
  }

  if (body && method !== 'GET' && method !== 'HEAD') {
    const safeBody = body.split("'").join("'\\''");
    lines.push(`  -d '${safeBody}'`);
  }

  return lines.join(' \\\n');
}
