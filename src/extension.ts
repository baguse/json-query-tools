import * as vscode from 'vscode';
import { commandTransformWithExpression, commandOpenQueryEditor, commandOpenScratchpad, commandDiffResult, commandExportHistory, commandImportHistory, commandGenerateTypes, commandRunTests, diffProvider } from './commands';
import { DIFF_SCHEME } from './diff';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
    vscode.commands.registerCommand('jsonQueryTools.transformWithExpression', () => commandTransformWithExpression(context)),
    vscode.commands.registerCommand('jsonQueryTools.openHistory', () => commandOpenQueryEditor(context)),
    vscode.commands.registerCommand('jsonQueryTools.openScratchpad', () => commandOpenScratchpad(context)),
    vscode.commands.registerCommand('jsonQueryTools.diffResult', () => commandDiffResult()),
    vscode.commands.registerCommand('jsonQueryTools.exportHistory', () => commandExportHistory(context)),
    vscode.commands.registerCommand('jsonQueryTools.importHistory', () => commandImportHistory(context)),
    vscode.commands.registerCommand('jsonQueryTools.generateTypes', () => commandGenerateTypes(context)),
    vscode.commands.registerCommand('jsonQueryTools.runTests', () => commandRunTests(context))
  );
}

export function deactivate() {
  diffProvider.dispose();
}

