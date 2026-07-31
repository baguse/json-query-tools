import * as vscode from 'vscode';
import { createRequire } from 'module';
import { BoundFile } from './types';
import { resolveTemplateVariables } from './config';

export function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

export function evaluateExpression(boundFiles: BoundFile[], dataMap: Record<string, unknown>, expr: string): unknown {
  const primaryUri = boundFiles.find(f => f.alias === 'data')?.uri ?? boundFiles[0]?.uri;
  const resolvedExpr = resolveTemplateVariables(expr, primaryUri);
  const req = primaryUri ? createRequire(primaryUri.fsPath) : require;

  const aliases = Object.keys(dataMap);
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
    throw new Error(`Target document is not valid JSON: ${uri.fsPath}`);
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
