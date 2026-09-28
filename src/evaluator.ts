import * as vscode from 'vscode';
import { createRequire } from 'module';
import { BoundFile, ResolvedEnvironment } from './types';
import { resolveTemplateVariables } from './config';
import { stripJsoncComments } from './jsonc';
import { getPrimaryUri } from './helpers';

export { stripJsoncComments };

export function stringify(value: unknown): string {
  try {
    const json = JSON.stringify(
      value,
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      2
    );
    return json ?? (value !== undefined ? String(value) : 'undefined');
  } catch {
    return String(value);
  }
}

const MALICIOUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?child_process(?:\/|\b)/, description: 'spawning child processes' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?fs(?:\/|\b)/, description: 'accessing the file system' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?net(?:\/|\b)/, description: 'opening network connections' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?http(?:\/|\b)/, description: 'making HTTP requests' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?https(?:\/|\b)/, description: 'making HTTPS requests' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?dgram(?:\/|\b)/, description: 'opening UDP sockets' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?os(?:\/|\b)/, description: 'accessing OS-level operations' },
  { pattern: /\b(?:require|import)\s*\(\s*['"`]\s*(?:node:)?(?:vm|worker_threads|cluster)\b/, description: 'accessing system or worker modules' },
  { pattern: /\bprocess\s*(?:\.\s*|\[\s*['"`])(?:exit|kill|abort|reallyExit|binding|dlopen|mainModule)\b/, description: 'terminating or manipulating the process' },
  { pattern: /\bprocess\s*(?:\.\s*|\[\s*['"`])env\b/, description: 'reading environment variables' },
  { pattern: /\beval\s*\(/, description: 'nested eval()' },
  { pattern: /\bFunction\s*\(/, description: 'dynamic Function() constructor' },
];

export function checkForMaliciousExpression(expr: string): string | null {
  for (const { pattern, description } of MALICIOUS_PATTERNS) {
    if (pattern.test(expr)) {
      return `Expression accesses restricted module: ${description}`;
    }
  }
  return null;
}

export interface StdoutEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'table' | 'time' | 'clear';
  text: string;
  message: string;
  args?: unknown[];
  timestamp: number;
}

export type StdoutCallback = (entry: StdoutEntry) => void;

export function createExecutionConsole(onStdout?: StdoutCallback): Record<string, any> {
  const timers = new Map<string, number>();

  function formatArg(arg: unknown): string {
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'undefined') return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'function') return `[Function: ${(arg as Function).name || '(anonymous)'}]`;
    if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
    try {
      const seen = new WeakSet();
      return JSON.stringify(
        arg,
        (_k, v) => {
          if (typeof v === 'bigint') return v.toString();
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        },
        2
      );
    } catch {
      return String(arg);
    }
  }

  function emit(level: StdoutEntry['level'], args: unknown[]) {
    const formatted = args.map(formatArg).join(' ');
    if (onStdout) {
      onStdout({
        level,
        text: formatted,
        message: formatted,
        args: args.map(a => {
          try {
            if (typeof a === 'object' && a !== null) {
              return JSON.parse(JSON.stringify(a));
            }
            return a;
          } catch {
            return String(a);
          }
        }),
        timestamp: Date.now()
      });
    }
  }

  return {
    log: (...args: unknown[]) => emit('log', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
    debug: (...args: unknown[]) => emit('debug', args),
    dir: (...args: unknown[]) => emit('log', args),
    table: (tabularData: unknown) => {
      emit('table', [tabularData]);
    },
    time: (label: string = 'default') => {
      timers.set(label, performance.now());
    },
    timeEnd: (label: string = 'default') => {
      const start = timers.get(label);
      if (start !== undefined) {
        const elapsed = (performance.now() - start).toFixed(2);
        timers.delete(label);
        emit('time', [`${label}: ${elapsed}ms`]);
      } else {
        emit('warn', [`Timer '${label}' does not exist`]);
      }
    },
    clear: () => {
      if (onStdout) {
        onStdout({
          level: 'clear',
          text: 'Console was cleared',
          message: 'Console was cleared',
          timestamp: Date.now()
        });
      }
    }
  };
}

const AsyncFunction: new (...args: string[]) => Function = Object.getPrototypeOf(async function () {}).constructor;

export function evaluateExpression(
  boundFiles: BoundFile[],
  dataMap: Record<string, unknown>,
  expr: string,
  environmentVariables?: Record<string, string> | ResolvedEnvironment,
  onStdout?: StdoutCallback
): unknown | Promise<unknown> {
  const primaryUri = getPrimaryUri(boundFiles);

  let envVars: Record<string, string> = {};
  let envName = '';
  if (environmentVariables) {
    if ('variables' in environmentVariables && typeof (environmentVariables as any).variables === 'object') {
      envVars = (environmentVariables as ResolvedEnvironment).variables || {};
      envName = (environmentVariables as ResolvedEnvironment).name || '';
    } else {
      envVars = environmentVariables as Record<string, string>;
      envName = envVars['activeEnv'] || envVars['activeEnvironment'] || envVars['name'] || '';
    }
  }

  // Check if expression is a single standalone template placeholder (e.g. `{{env.baseURL}}` or `{{baseUrl}}`)
  const trimmedExpr = expr.trim();
  const singlePlaceholderMatch = trimmedExpr.match(/^(?:\{\{|%7B%7B)\s*([a-zA-Z0-9_$.-]+)\s*(?:\}\}|%7D%7D)$/);
  if (singlePlaceholderMatch) {
    const substituted = resolveTemplateVariables(trimmedExpr, primaryUri, undefined, envVars);
    if (substituted !== trimmedExpr) {
      return substituted;
    }
  }

  const resolvedExpr = resolveTemplateVariables(expr, primaryUri, undefined, envVars);
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const baseUri = primaryUri ?? workspaceUri;
  const req = baseUri ? createRequire(baseUri.fsPath) : require;

  const envBaseUrl = envVars['baseUrl'] || envVars['baseURL'] || envVars['BASE_URL'] || '';
  const envTarget: Record<string, any> = {
    name: envName,
    activeEnv: envName,
    baseUrl: envBaseUrl,
    baseURL: envBaseUrl,
    BASE_URL: envBaseUrl,
    variables: { ...envVars },
    ...envVars
  };

  const envProxy = new Proxy(envTarget, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        if (prop in target) {
          return target[prop];
        }
        const lower = prop.toLowerCase();
        for (const [k, v] of Object.entries(target)) {
          if (k.toLowerCase() === lower) {
            return v;
          }
        }
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  const aliases = Object.keys(dataMap);
  // In standalone mode (no sources bound), make `data` available as an argument (undefined)
  // so expressions referencing `data` or arrow functions do not throw a ReferenceError.
  if (aliases.length === 0) {
    aliases.push('data');
  }
  const dataValues = aliases.map(a => dataMap[a]);

  const hasEnvAlias = aliases.includes('env');
  const hasRequireAlias = aliases.includes('require');
  const hasConsoleAlias = aliases.includes('console');

  const extraParamNames: string[] = [];
  const extraParamValues: any[] = [];

  if (!hasRequireAlias) {
    extraParamNames.push('require');
    extraParamValues.push(req);
  }
  if (!hasEnvAlias) {
    extraParamNames.push('env');
    extraParamValues.push(envProxy);
  }
  if (!hasConsoleAlias) {
    extraParamNames.push('console');
    extraParamValues.push(createExecutionConsole(onStdout));
  }

  const isAwait = /\bawait\b/.test(resolvedExpr);
  const trimmed = resolvedExpr.trim();
  const cleanForReturn = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed;

  // Try expression with implicit return first (e.g. `data.map(...)` or `console.log(...)`)
  let fn: Function;
  let isExpression = true;
  try {
    const returnBody = `return (${cleanForReturn});`;
    fn = isAwait
      ? new AsyncFunction(...aliases, ...extraParamNames, returnBody)
      : new Function(...aliases, ...extraParamNames, returnBody);
  } catch (err: any) {
    if (err instanceof SyntaxError) {
      isExpression = false;
      // Multi-statement block or declaration (e.g. `const x = 1; return x;`)
      fn = isAwait
        ? new AsyncFunction(...aliases, ...extraParamNames, resolvedExpr)
        : new Function(...aliases, ...extraParamNames, resolvedExpr);
    } else {
      throw err;
    }
  }

  let firstResult = fn(...dataValues, ...extraParamValues) as unknown;

  const resolveResult = (res: unknown): unknown | Promise<unknown> => {
    const finalResult =
      typeof res === 'function'
        ? (res as (...args: unknown[]) => unknown)(...dataValues, ...extraParamValues)
        : res;

    if (finalResult && (finalResult instanceof Promise || typeof (finalResult as any).then === 'function')) {
      return (async () => {
        const resolved = await finalResult;
        if (typeof resolved === 'undefined') {
          vscode.window.showWarningMessage(
            'Expression returned void (undefined). Ensure your expression or query function includes a `return` statement to provide a result.'
          );
        }
        return resolved;
      })();
    }

    if (typeof finalResult === 'undefined') {
      vscode.window.showWarningMessage(
        'Expression returned void (undefined). Ensure your expression or query function includes a `return` statement to provide a result.'
      );
    }

    return finalResult;
  };

  // If firstResult is a Promise/Thenable, await it
  if (firstResult && (firstResult instanceof Promise || typeof (firstResult as any).then === 'function')) {
    return (async () => {
      let awaitedFirst = await firstResult;
      // If result is undefined and was not an expression, try implicit return
      if (typeof awaitedFirst === 'undefined' && !isExpression) {
        try {
          const implicitReturnFn = isAwait
            ? new AsyncFunction(...aliases, ...extraParamNames, `return (${cleanForReturn});`)
            : new Function(...aliases, ...extraParamNames, `return (${cleanForReturn});`);
          awaitedFirst = await implicitReturnFn(...dataValues, ...extraParamValues);
        } catch {
          // Statement block was not a single expression
        }
      }
      return resolveResult(awaitedFirst);
    })();
  }

  // If result is undefined and was not an expression, try implicit return
  if (typeof firstResult === 'undefined' && !isExpression) {
    try {
      const implicitReturnFn = isAwait
        ? new AsyncFunction(...aliases, ...extraParamNames, `return (${cleanForReturn});`)
        : new Function(...aliases, ...extraParamNames, `return (${cleanForReturn});`);
      firstResult = implicitReturnFn(...dataValues, ...extraParamValues);
    } catch {
      // Statement block was not a single expression
    }
  }

  return resolveResult(firstResult);
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


export function pickInitialTargetUri(): vscode.Uri | null {
  const active = vscode.window.activeTextEditor?.document;
  if (active && (active.languageId === 'json' || active.languageId === 'jsonc')) return active.uri;
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document.languageId === 'json' || ed.document.languageId === 'jsonc') return ed.document.uri;
  }
  return null;
}
