import * as vscode from 'vscode';

/** Template variable syntax: {{variableName}}. Built-ins: fileName, filePath, fileDir, workspaceFolder. */
export function getTemplateVariables(targetUri?: vscode.Uri): Record<string, string> {
  const config = vscode.workspace.getConfiguration('jsonQueryTools');
  const custom = config.get<Record<string, string>>('templateVariables') ?? {};
  const builtins: Record<string, string> = { ...custom };
  if (targetUri) {
    const normalizedFsPath = targetUri.fsPath.replace(/\\/g, '/');
    const parts = normalizedFsPath.split('/');
    builtins['fileName'] = parts[parts.length - 1] ?? '';
    builtins['filePath'] = normalizedFsPath;
    const dirParts = parts.slice(0, -1);
    builtins['fileDir'] = dirParts.length === 1 && dirParts[0] === '' ? '/' : dirParts.join('/');
  }
  const wf = targetUri 
    ? vscode.workspace.getWorkspaceFolder(targetUri) 
    : vscode.workspace.workspaceFolders?.[0];
  if (wf) {
    builtins['workspaceFolder'] = wf.uri.fsPath.replace(/\\/g, '/');
  }
  return builtins;
}

export function resolveTemplateVariables(expr: string, targetUri?: vscode.Uri): string {
  const vars = getTemplateVariables(targetUri);
  let out = expr;
  for (const [name, value] of Object.entries(vars)) {
    const placeholder = `{{${name}}}`;
    out = out.split(placeholder).join(value);
  }
  return out;
}
