import * as vscode from 'vscode';

/** Template variable syntax: {{variableName}}. Built-ins: workspaceFolder. */
export function getTemplateVariables(targetUri?: vscode.Uri): Record<string, string> {
  const config = vscode.workspace.getConfiguration('jsonQueryTools');
  const custom = config.get<Record<string, string>>('templateVariables') ?? {};
  const builtins: Record<string, string> = { ...custom };
  if (targetUri) {
    const wf = vscode.workspace.getWorkspaceFolder(targetUri);
    if (wf) builtins['workspaceFolder'] = wf.uri.fsPath;
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
