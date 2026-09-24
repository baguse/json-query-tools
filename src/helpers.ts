import type * as vscode from 'vscode';
import type { BoundFile } from './types';

/**
 * Shared utility helpers for formatting, file path resolution, and string sanitization.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
};

const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
};

const JS_IDENTIFIER_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Converts a byte count to a human-readable string with units (B, KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0 || !bytes || typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Converts milliseconds to a human-readable duration (ms or s).
 */
export function formatDuration(ms: number): string {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '0ms';
  if (ms < 1) return (Math.round(ms * 10) / 10) + 'ms';
  if (ms < 1000) return (Math.round(ms * 10) / 10) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

/**
 * Escapes characters for safe inclusion in HTML.
 */
export function escapeHtml(text: string): string {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch] || ch);
}

/**
 * Escapes characters for safe inclusion in XML.
 */
export function escapeXml(str: string): string {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, ch => XML_ESCAPE_MAP[ch] || ch);
}

/**
 * Validates whether a given string is a valid JavaScript variable identifier.
 */
export function isValidJsIdentifier(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  return JS_IDENTIFIER_REGEX.test(name.trim());
}

/**
 * Encodes a UTF-8 string into base64 across Node.js and browser runtimes.
 */
export function toBase64(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8').toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return '';
}

/**
 * Finds the primary file URI among bound files (prioritizing the 'data' alias, falling back to the first bound file).
 */
export function getPrimaryUri(
  boundFiles: Array<{ alias: string; uri: vscode.Uri }>
): vscode.Uri | undefined {
  return boundFiles.find(f => f.alias === 'data')?.uri ?? boundFiles[0]?.uri;
}

/**
 * Generates an ISO-based timestamped file name with a given suffix or extension.
 */
export function generateTimestampFileName(suffixOrExtension: string, date: Date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  const prefix = suffixOrExtension.startsWith('.') || suffixOrExtension.startsWith('-') ? '' : '-';
  return `${timestamp}${prefix}${suffixOrExtension}`;
}

function getVsCode(): typeof vscode | undefined {
  try {
    return typeof require === 'function' ? require('vscode') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Computes default target save URI relative to primary file or workspace folder.
 */
export function getDefaultSaveUri(options: {
  defaultName: string;
  primaryUri?: vscode.Uri;
  workspaceFolders?: readonly vscode.WorkspaceFolder[];
}): vscode.Uri {
  const { defaultName, primaryUri, workspaceFolders } = options;
  const v = getVsCode();
  if (primaryUri && v?.Uri) {
    return v.Uri.joinPath(primaryUri, '..', defaultName);
  }
  const wf = workspaceFolders ?? v?.workspace?.workspaceFolders;
  if (wf && wf.length > 0 && v?.Uri) {
    return v.Uri.joinPath(wf[0].uri, defaultName);
  }
  if (v?.Uri) {
    return v.Uri.file(defaultName);
  }
  return { fsPath: defaultName } as vscode.Uri;
}

/**
 * Generates a relative workspace path label for a given URI.
 */
export function getUriLabel(uri: vscode.Uri | null | undefined): string {
  if (!uri) return '(none)';
  const v = getVsCode();
  return v?.workspace ? v.workspace.asRelativePath(uri) : (uri.fsPath || '(none)');
}
