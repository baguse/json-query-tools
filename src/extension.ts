import * as vscode from 'vscode';
import { commandTransformWithExpression, commandOpenQueryEditor, commandOpenScratchpad, commandDiffResult, diffProvider } from './commands';
import { DIFF_SCHEME } from './diff';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
    vscode.commands.registerCommand('jsonQueryTools.transformWithExpression', () => commandTransformWithExpression(context)),
    vscode.commands.registerCommand('jsonQueryTools.openHistory', () => commandOpenQueryEditor(context)),
    vscode.commands.registerCommand('jsonQueryTools.openScratchpad', () => commandOpenScratchpad(context)),
    vscode.commands.registerCommand('jsonQueryTools.diffResult', () => commandDiffResult())
  );
}

export function deactivate() {
  diffProvider.dispose();
}

