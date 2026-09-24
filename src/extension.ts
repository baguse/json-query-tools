import * as vscode from 'vscode';
import { commandTransformWithExpression, commandOpenQueryEditor, commandOpenScratchpad } from './commands';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('jsonQueryTools.transformWithExpression', () => commandTransformWithExpression(context)),
    vscode.commands.registerCommand('jsonQueryTools.openHistory', () => commandOpenQueryEditor(context)),
    vscode.commands.registerCommand('jsonQueryTools.openScratchpad', () => commandOpenScratchpad(context))
  );
}

export function deactivate() {}
