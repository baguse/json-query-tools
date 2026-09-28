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
  urlContext?: UrlTemplateContext,
  environmentVariables?: Record<string, string>
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

  const mergedCustom: Record<string, string> = {
    ...custom,
    ...(environmentVariables ?? {})
  };

  const base = mergedCustom['baseUrl'] || mergedCustom['baseURL'] || mergedCustom['BASE_URL'];
  if (base) {
    mergedCustom['baseUrl'] = base;
    mergedCustom['baseURL'] = base;
    mergedCustom['BASE_URL'] = base;
    mergedCustom['env.baseUrl'] = base;
    mergedCustom['env.baseURL'] = base;
    mergedCustom['env.BASE_URL'] = base;
  }

  for (const [k, v] of Object.entries(mergedCustom)) {
    if (!k.startsWith('env.')) {
      mergedCustom[`env.${k}`] = v;
    }
  }

  return getBuiltinVariables({
    targetPath,
    workspaceFolder,
    urlContext,
    customVariables: mergedCustom
  });
}

/**
 * Substitutes template variables in an expression or string using VS Code workspace context.
 */
export function resolveTemplateVariables(
  expr: string,
  targetUri?: vscode.Uri,
  urlContext?: UrlTemplateContext,
  environmentVariables?: Record<string, string>
): string {
  const vars = getTemplateVariables(targetUri, urlContext, environmentVariables);
  return resolveVariables(expr, vars);
}
