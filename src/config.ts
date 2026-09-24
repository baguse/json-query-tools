import * as vscode from 'vscode';
import {
  getBuiltinVariables,
  resolveVariables,
  resolveFetchOptions,
  UrlTemplateContext,
  TemplateResolutionOptions
} from './template';

export {
  getBuiltinVariables,
  resolveVariables,
  resolveFetchOptions,
  UrlTemplateContext,
  TemplateResolutionOptions
};

/**
 * Returns all active template variables including custom variables,
 * workspace folder, active file paths, and URL context (if provided).
 */
export function getTemplateVariables(
  targetUri?: vscode.Uri,
  urlContext?: UrlTemplateContext
): Record<string, string> {
  const config = vscode.workspace.getConfiguration('jsonQueryTools');
  const custom = config.get<Record<string, string>>('templateVariables') ?? {};

  let targetPath: string | undefined;
  if (targetUri) {
    targetPath = targetUri.fsPath;
  }

  let workspaceFolder: string | undefined;
  const wf = targetUri
    ? vscode.workspace.getWorkspaceFolder(targetUri)
    : vscode.workspace.workspaceFolders?.[0];
  if (wf) {
    workspaceFolder = wf.uri.fsPath;
  }

  return getBuiltinVariables({
    targetPath,
    workspaceFolder,
    urlContext,
    customVariables: custom
  });
}

/**
 * Substitutes template variables in an expression or string using VS Code workspace context.
 */
export function resolveTemplateVariables(
  expr: string,
  targetUri?: vscode.Uri,
  urlContext?: UrlTemplateContext
): string {
  const vars = getTemplateVariables(targetUri, urlContext);
  return resolveVariables(expr, vars);
}
