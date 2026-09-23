import * as vscode from 'vscode';
import { createRequire } from 'module';
import { BoundFile } from './types';
import { resolveTemplateVariables } from './config';

export function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

const MALICIOUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brequire\s*\(\s*['"]child_process['"]\s*\)/, description: 'spawning child processes' },
  { pattern: /\brequire\s*\(\s*['"]fs['"]\s*\)/, description: 'accessing the file system' },
  { pattern: /\brequire\s*\(\s*['"]net['"]\s*\)/, description: 'opening network connections' },
  { pattern: /\brequire\s*\(\s*['"]http['"]\s*\)/, description: 'making HTTP requests' },
  { pattern: /\brequire\s*\(\s*['"]https['"]\s*\)/, description: 'making HTTPS requests' },
  { pattern: /\brequire\s*\(\s*['"]dgram['"]\s*\)/, description: 'opening UDP sockets' },
  { pattern: /\brequire\s*\(\s*['"]os['"]\s*\)/, description: 'accessing OS-level operations' },
  { pattern: /\bprocess\s*\.\s*exit\b/, description: 'terminating the process' },
  { pattern: /\bprocess\s*\.\s*env\b/, description: 'reading environment variables' },
  { pattern: /\beval\s*\(/, description: 'nested eval()' },
];

export function checkForMaliciousExpression(expr: string): string | null {
  for (const { pattern, description } of MALICIOUS_PATTERNS) {
    if (pattern.test(expr)) {
      return `Expression accesses restricted module: ${description}`;
    }
  }
  return null;
}

export function evaluateExpression(boundFiles: BoundFile[], dataMap: Record<string, unknown>, expr: string): unknown {
  const primaryUri = boundFiles.find(f => f.alias === 'data')?.uri ?? boundFiles[0]?.uri;
  const resolvedExpr = resolveTemplateVariables(expr, primaryUri);
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const baseUri = primaryUri ?? workspaceUri;
  const req = baseUri ? createRequire(baseUri.fsPath) : require;

  const aliases = Object.keys(dataMap);
  // In standalone mode (no sources bound), make `data` available as an argument (undefined)
  // so expressions referencing `data` or arrow functions do not throw a ReferenceError.
  if (aliases.length === 0) {
    aliases.push('data');
  }
  const dataValues = aliases.map(a => dataMap[a]);

  // Construct function with dynamic argument names based on aliases
  const fnArgs = [...aliases, 'require', `${resolvedExpr}`];
  const fn = new Function(...fnArgs);

  // First evaluation: run the expression against (data1, data2, ..., require)
  const firstResult = fn(...dataValues, req) as unknown;

  // If the expression itself evaluates to a function (e.g. (data) => { ... }),
  // treat that as the "query function" and invoke it with the same arguments.
  // Note: For functions, we pass the data mapped to 'data' if it exists, otherwise the first bound file's data.
  const finalResult =
    typeof firstResult === 'function'
      ? (firstResult as (data: unknown, requireFn: NodeRequire) => unknown)(dataMap['data'] ?? dataValues[0], req)
      : firstResult;

  if (typeof finalResult === 'undefined') {
    vscode.window.showWarningMessage(
      'Expression returned void (undefined). Ensure your expression or query function includes a `return` statement to provide a result.'
    );
  }

  return finalResult;
}

// --- Helpers to read JSON document by URI (works even when webview focused)
export async function readJsonFromUri(uri: vscode.Uri): Promise<unknown> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try parsing as JSONC (strip comments) then retry
    try {
      return JSON.parse(stripJsoncComments(text));
    } catch {
      throw new Error(`Target document is not valid JSON: ${uri.fsPath}`);
    }
  }
}

function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      // Skip string literals
      const quote = ch;
      result += ch;
      i++;
      while (i < text.length) {
        const c = text[i];
        result += c;
        if (c === '\\') { result += text[i + 1] ?? ''; i += 2; continue; }
        if (c === quote) break;
        i++;
      }
      i++;
    } else if (ch === '/' && text[i + 1] === '/') {
      // Single-line comment — skip to end of line
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      // Block comment — skip to closing */
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      result += ch;
      i++;
    }
  }
  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}

export function pickInitialTargetUri(): vscode.Uri | null {
  const active = vscode.window.activeTextEditor?.document;
  if (active && (active.languageId === 'json' || active.languageId === 'jsonc')) return active.uri;
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document.languageId === 'json' || ed.document.languageId === 'jsonc') return ed.document.uri;
  }
  return null;
}
