import * as vscode from 'vscode';
import { commandTransformWithExpression, commandOpenQueryEditor } from './commands';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('jsonQueryTools.transformWithExpression', () => commandTransformWithExpression(context)),
    vscode.commands.registerCommand('jsonQueryTools.openHistory', () => commandOpenQueryEditor(context))
  );
}

export function deactivate() {}
