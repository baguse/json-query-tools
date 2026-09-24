import * as vscode from 'vscode';
import { stringify } from './evaluator';

export const DIFF_SCHEME = 'json-query-diff';

/**
 * TextDocumentContentProvider for providing virtual JSON documents for VS Code's native diff editor.
 * Provides in-memory documents without creating temporary files on disk or leaving unsaved 'Untitled' buffers.
 */
export class JsonDiffProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange?: vscode.EventEmitter<vscode.Uri>;
  readonly onDidChange?: vscode.Event<vscode.Uri>;

  private contents = new Map<string, string>();

  constructor() {
    if (typeof vscode !== 'undefined' && typeof vscode.EventEmitter === 'function') {
      this._onDidChange = new vscode.EventEmitter<vscode.Uri>();
      this.onDidChange = this._onDidChange.event;
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this._onDidChange?.fire(uri);
  }

  getContent(uri: vscode.Uri): string | undefined {
    return this.contents.get(uri.toString());
  }

  clear(): void {
    this.contents.clear();
  }

  dispose(): void {
    this._onDidChange?.dispose();
    this.clear();
  }
}

/**
 * Sanitizes a source name for use as a URI file path segment.
 */
export function sanitizeDiffName(name: string): string {
  if (!name) return 'Original';
  // If it's a file path or URL, take meaningful trailing segment
  const trimmed = name.trim();
  const normalized = trimmed.replace(/\\/g, '/');
  const segment = normalized.includes('/') ? normalized.split('/').filter(Boolean).pop() || trimmed : trimmed;
  // Replace disallowed characters for filenames
  const safe = segment.replace(/[\/\\:*?"<>|#%]/g, '_').trim();
  return safe || 'Original';
}

/**
 * Generates diff URIs for a given source name.
 */
export function getDiffUris(sourceName: string): { leftUri: vscode.Uri; rightUri: vscode.Uri; title: string } {
  const safeName = sanitizeDiffName(sourceName);
  const leftUri = vscode.Uri.from({
    scheme: DIFF_SCHEME,
    path: `/${safeName} (Original).json`
  });
  const rightUri = vscode.Uri.from({
    scheme: DIFF_SCHEME,
    path: `/Transformed Result.json`
  });
  const title = `${safeName} (Original) ↔ Transformed Result`;
  return { leftUri, rightUri, title };
}

export interface ShowDiffOptions {
  sourceName: string;
  originalData?: unknown;
  originalText?: string;
  resultData?: unknown;
  resultText?: string;
}

/**
 * Prepares and displays a side-by-side diff comparing Original JSON and Transformed Result.
 */
export async function showJsonDiff(
  provider: JsonDiffProvider,
  options: ShowDiffOptions
): Promise<void> {
  // Format original text
  let originalFormatted = options.originalText;
  if (!originalFormatted && options.originalData !== undefined) {
    if (typeof options.originalData === 'string') {
      try {
        const parsed = JSON.parse(options.originalData);
        originalFormatted = JSON.stringify(parsed, null, 2);
      } catch {
        originalFormatted = options.originalData;
      }
    } else {
      originalFormatted = stringify(options.originalData);
    }
  }
  if (!originalFormatted) {
    originalFormatted = '(empty)';
  }
  if (!originalFormatted.endsWith('\n')) {
    originalFormatted += '\n';
  }

  // Format result text
  let resultFormatted = options.resultText;
  if (!resultFormatted && options.resultData !== undefined) {
    if (typeof options.resultData === 'string') {
      try {
        const parsed = JSON.parse(options.resultData);
        resultFormatted = JSON.stringify(parsed, null, 2);
      } catch {
        resultFormatted = options.resultData;
      }
    } else {
      resultFormatted = stringify(options.resultData);
    }
  }
  if (!resultFormatted) {
    resultFormatted = '(empty)';
  } else {
    // If resultText is a JSON string, ensure standard 2-space indentation for clean diffing
    try {
      const parsed = JSON.parse(resultFormatted);
      resultFormatted = JSON.stringify(parsed, null, 2);
    } catch {
      // Keep as-is if not valid JSON (e.g. text/yaml/csv)
    }
  }
  if (!resultFormatted.endsWith('\n')) {
    resultFormatted += '\n';
  }

  const { leftUri, rightUri, title } = getDiffUris(options.sourceName);
  provider.setContent(leftUri, originalFormatted);
  provider.setContent(rightUri, resultFormatted);

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
    preview: false
  });
}
