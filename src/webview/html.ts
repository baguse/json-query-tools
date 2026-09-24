import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BoundFile, SerializedBoundSource } from '../types';
import { tokenizeArgs, parseCurl, generateCurl } from '../curl';

export { tokenizeArgs, parseCurl, generateCurl };

export function nonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function escapeHtmlStr(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getQueryEditorHtml(
  webview: vscode.Webview,
  params: { boundFiles?: BoundFile[]; sources?: SerializedBoundSource[]; scriptNonce: string }
) {
  const n = params.scriptNonce;
  const sources: SerializedBoundSource[] = params.sources ?? (params.boundFiles || []).map(f => ({
    type: 'file' as const,
    alias: f.alias,
    label: vscode.workspace.asRelativePath(f.uri)
  }));

  const initialSourcesJson = JSON.stringify(sources).replace(/</g, '\\u003c');

  const sourcesHtml = sources.length > 0 ? sources.map(s => {
    if (s.type === 'url') {
      const method = s.method || 'GET';
      const methodClass = `method-${method.toLowerCase()}`;
      return `<span class="bound-file bound-url" data-alias="${escapeHtmlStr(s.alias)}" data-id="${escapeHtmlStr(s.id || '')}" title="${escapeHtmlStr(method)} ${escapeHtmlStr(s.url || '')}">
        <span class="url-badge-method ${methodClass}">${escapeHtmlStr(method)}</span>
        <span class="file-alias">${escapeHtmlStr(s.alias)}</span>: ${escapeHtmlStr(s.label || s.url || '')}
        <button class="inspect-source-btn" data-id="${escapeHtmlStr(s.id || '')}" title="View cached API response">👁️</button>
        <button class="copy-url-curl-btn" data-id="${escapeHtmlStr(s.id || '')}" title="Copy as cURL command">📋</button>
        <button class="refresh-url-btn" data-id="${escapeHtmlStr(s.id || '')}" title="Re-fetch data from URL">🔄</button>
        <button class="edit-url-btn" data-id="${escapeHtmlStr(s.id || '')}" title="Edit URL, headers, or method">✏️</button>
        <button class="remove-source" data-alias="${escapeHtmlStr(s.alias)}" data-id="${escapeHtmlStr(s.id || '')}" title="Remove source">×</button>
      </span>`;
    }
    return `<span class="bound-file" data-alias="${escapeHtmlStr(s.alias)}" title="${escapeHtmlStr(s.label)}">
      <span class="file-icon">📁</span>
      <span class="file-alias">${escapeHtmlStr(s.alias)}</span>: ${escapeHtmlStr(s.label.split('/').pop() || s.label)}
      <button class="inspect-source-btn" data-alias="${escapeHtmlStr(s.alias)}" title="View JSON data">👁️</button>
      <button class="remove-source" data-alias="${escapeHtmlStr(s.alias)}" title="Remove source">×</button>
    </span>`;
  }).join('') : '<span class="bound-file standalone-tag" style="opacity: 0.75; font-style: italic; background: transparent; border: 1px dashed var(--vscode-input-border, #3e3e42); padding: 3px 8px; border-radius: 3px;" title="Standalone Mode: No data sources bound. You can generate data or run standalone JavaScript expressions.">⚡ Standalone Mode</span>';


  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; script-src 'nonce-${n}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com;"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>JSON Tools — Query Editor</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css" nonce="${n}">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css" nonce="${n}">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldgutter.min.css" nonce="${n}">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 0;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #cccccc);
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    header {
      padding: 12px 20px;
      background: var(--vscode-titleBar-activeBackground, #2d2d30);
      border-bottom: 2px solid var(--vscode-focusBorder, #007acc);
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    header strong {
      font-size: 15px;
      font-weight: 700;
      color: var(--vscode-titleBar-activeForeground, #ffffff);
      letter-spacing: 0.3px;
    }
    .muted {
      opacity: 0.65;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #cccccc);
    }
    .row {
      display: flex;
      gap: 10px;
      padding: 14px 20px;
      align-items: center;
      flex-wrap: wrap;
    }
    .bound-files-container {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      flex: 1;
    }
    .bound-file {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--vscode-input-background, #3c3c3c);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--vscode-foreground, #cccccc);
    }
    .bound-file.bound-url {
      border-left: 3px solid #3794ff;
    }
    .url-badge-method {
      display: inline-block;
      font-size: 9px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
      text-transform: uppercase;
      color: #ffffff;
      line-height: 1.2;
    }
    .method-get { background: #007acc; }
    .method-post { background: #238636; }
    .method-put { background: #8957e5; }
    .method-patch { background: #a371f7; }
    .method-delete { background: #da3633; }
    .method-head, .method-options { background: #6e7681; }

    .file-alias {
      font-weight: bold;
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .remove-file, .remove-source, .refresh-url-btn, .edit-url-btn, .inspect-source-btn, .copy-url-curl-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground, #858585);
      cursor: pointer;
      padding: 0 2px;
      margin: 0;
      font-size: 12px;
      line-height: 1;
      border-radius: 2px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .remove-file:hover, .remove-source:hover {
      color: var(--vscode-errorForeground, #f48771);
      box-shadow: none;
      transform: none;
    }
    .refresh-url-btn:hover, .edit-url-btn:hover, .inspect-source-btn:hover, .copy-url-curl-btn:hover {
      color: var(--vscode-textLink-activeForeground, #3794ff);
    }
    .status-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      color: #ffffff;
      line-height: 1.2;
      display: inline-block;
    }
    .status-2xx { background: #238636; }
    .status-3xx { background: #0e639c; }
    .status-4xx { background: #d29922; color: #1e1e1e; }
    .status-5xx { background: #da3633; }


    /* URL Modal Styles */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(2px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-dialog {
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-widget-border, #454545);
      border-radius: 6px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      width: 100%;
      max-width: 660px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-header {
      padding: 12px 16px;
      background: var(--vscode-titleBar-activeBackground, #2d2d30);
      border-bottom: 1px solid var(--vscode-panel-border, #3e3e42);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, #fff);
    }
    .modal-close-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground, #858585);
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
    }
    .modal-close-btn:hover {
      color: var(--vscode-foreground, #fff);
    }
    .modal-body {
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .modal-footer {
      padding: 12px 16px;
      background: var(--vscode-titleBar-activeBackground, #2d2d30);
      border-top: 1px solid var(--vscode-panel-border, #3e3e42);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-group label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground, #ccc);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .form-group input, .form-group select, .form-group textarea {
      padding: 6px 10px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 3px;
      font-size: 12px;
      font-family: inherit;
    }
    .form-group textarea {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      resize: vertical;
      line-height: 1.4;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      outline: 1px solid var(--vscode-focusBorder, #007acc);
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .form-hint {
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground, #858585);
      line-height: 1.3;
    }
    .form-hint code {
      background: rgba(255,255,255,0.08);
      padding: 1px 4px;
      border-radius: 2px;
    }
    .modal-alert {
      padding: 8px 12px;
      background: rgba(244, 135, 113, 0.15);
      border: 1px solid var(--vscode-errorForeground, #f48771);
      border-radius: 4px;
      color: var(--vscode-errorForeground, #f48771);
      font-size: 12px;
      line-height: 1.4;
      word-break: break-word;
    }
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Request Configuration Tabs & Query Params Table */
    .request-tabs-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border, #3e3e42);
      gap: 2px;
      margin-top: 4px;
    }
    .request-tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground, #858585);
      font-size: 11px;
      font-weight: 600;
      padding: 6px 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: -1px;
      transition: color 0.15s, border-color 0.15s;
    }
    .request-tab-btn:hover {
      color: var(--vscode-foreground, #fff);
    }
    .request-tab-btn.active {
      color: var(--vscode-textLink-foreground, #3794ff);
      border-bottom-color: var(--vscode-textLink-foreground, #3794ff);
    }
    .tab-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      color: var(--vscode-foreground, #ccc);
      line-height: 1.2;
    }
    .request-tab-btn.active .tab-badge {
      background: var(--vscode-badge-background, #007acc);
      color: var(--vscode-badge-foreground, #ffffff);
    }
    .request-tab-pane {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .param-row {
      border-bottom: 1px solid var(--vscode-input-border, #3e3e42);
      transition: background 0.1s;
    }
    .param-row:last-child {
      border-bottom: none;
    }
    .param-row:hover {
      background: rgba(255, 255, 255, 0.02);
    }
    .param-row.param-disabled {
      opacity: 0.55;
    }
    .param-row input[type="text"] {
      background: transparent !important;
      border: none !important;
      color: var(--vscode-input-foreground, #cccccc);
      width: 100%;
      padding: 5px 6px;
      font-size: 11px;
      font-family: inherit;
      outline: none !important;
    }
    .param-row input[type="text"]:focus {
      background: rgba(255, 255, 255, 0.05) !important;
    }
    .param-row input[type="checkbox"] {
      cursor: pointer;
    }
    .remove-param-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground, #858585);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 2px;
    }
    .remove-param-btn:hover {
      color: var(--vscode-errorForeground, #f48771) !important;
      background: rgba(244, 135, 113, 0.1);
    }

    .row:has(#expr) {
      flex-direction: column;
      align-items: stretch;
      padding: 16px 20px;
      background: var(--vscode-editor-background, #1e1e1e);
      border-bottom: 1px solid var(--vscode-panel-border, #3e3e42);
    }
    .editor-container {
      position: relative;
      margin-bottom: 2px;
    }
    .editor-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground, #858585);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .editor-label::before {
      content: '✎';
      font-size: 13px;
      opacity: 0.8;
    }
    #expr {
      width: 100%;
      height: 180px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 13px;
      box-sizing: border-box;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1.5px solid var(--vscode-input-border, #3e3e42);
      border-radius: 5px;
      padding: 12px;
      resize: vertical;
      line-height: 1.6;
      tab-size: 2;
      transition: all 0.2s ease;
    }
    #expr:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.1);
    }
    #expr::placeholder {
      color: var(--vscode-input-placeholderForeground, #75715e);
      opacity: 0.6;
    }
    /* Hide textarea when CodeMirror is active */
    .CodeMirror ~ #expr,
    .editor-container:has(.CodeMirror) #expr {
      display: none !important;
      visibility: hidden !important;
      position: absolute !important;
      opacity: 0 !important;
    }
    .CodeMirror {
      height: 180px !important;
      width: 100% !important;
      border: 1.5px solid var(--vscode-input-border, #3e3e42) !important;
      border-radius: 5px !important;
      box-sizing: border-box !important;
      font-size: 13px !important;
      transition: all 0.2s ease !important;
    }
    .CodeMirror:focus,
    .CodeMirror-focused {
      border-color: var(--vscode-focusBorder, #007acc) !important;
      box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.1) !important;
    }
    .CodeMirror-wrapper {
      width: 100% !important;
    }
    .CodeMirror-scroll {
      width: 100% !important;
    }
    .cm-s-monokai .cm-syntax-error {
      background-color: rgba(244, 135, 113, 0.18);
      border-bottom: 1px dotted var(--vscode-errorForeground, #f48771);
    }
    .syntax-error-message {
      position: absolute;
      right: 8px;
      bottom: -18px;
      font-size: 11px;
      color: var(--vscode-errorForeground, #f48771);
      background: rgba(30, 30, 30, 0.95);
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      pointer-events: none;
      z-index: 5;
    }
    .button-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 2px 0;
    }
    button {
      padding: 8px 14px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: inherit;
      white-space: nowrap;
      user-select: none;
    }
    button:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(0,0,0,0.25);
    }
    button:active:not(:disabled) {
      transform: translateY(0);
    }
    button.primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      font-weight: 600;
    }
    button.primary:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3e3e42);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }
    button.secondary:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground, #4e4e52);
    }
    button.danger {
      background: rgba(244, 135, 113, 0.85);
      color: #ffffff;
    }
    button.danger:hover:not(:disabled) {
      background: var(--vscode-errorForeground, #f48771);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }
    #result {
      border-top: 1px solid var(--vscode-panel-border, #3e3e42);
      padding: 16px 20px;
      background: var(--vscode-editor-background, #1e1e1e);
      flex: 1.5;
      overflow: auto;
      display: flex;
      flex-direction: column;
      min-height: 300px;
    }
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .result-header h4 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground, #cccccc);
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .result-header h4::before {
      content: '▶';
      font-size: 12px;
      opacity: 0.7;
    }
    #resultPre {
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--vscode-textCodeBlock-background, #252526);
      color: var(--vscode-textPreformat-foreground, #d4d4d4);
      padding: 14px;
      border-radius: 4px;
      overflow: auto;
      flex: 1;
      min-height: 200px;
      border: 1px solid var(--vscode-input-border, #3e3e42);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
    }
    #resultPre.empty {
      color: var(--vscode-descriptionForeground, #858585);
      font-style: italic;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
    }
    .streaming-progress {
      display: inline-block;
      margin-left: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #858585);
    }
    .streaming-progress::after {
      content: ' ⏳';
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    #resultPre.error {
      color: var(--vscode-errorForeground, #f48771);
      background: rgba(244, 135, 113, 0.08);
    }
    #resultTable {
      flex: 1;
      min-height: 200px;
      overflow: auto;
      display: none;
    }
    #resultChartContainer {
      height: 100%;
      min-height: 300px;
      width: 100%;
      display: none;
      position: relative;
      flex: 1;
    }
    #resultTable thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 10px 12px;
      text-align: left;
      border-bottom: 2px solid var(--vscode-input-border, #3e3e42);
    }
    #resultTable tbody td {
      padding: 8px 12px;
    }
    #resultTable tbody tr:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    #tablePagination {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      margin-top: 8px;
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      font-size: 11px;
      flex-wrap: wrap;
      gap: 8px;
    }
    #tablePagination button {
      padding: 3px 8px;
      font-size: 11px;
      min-width: 24px;
      height: 24px;
      line-height: 1;
    }
    #tablePagination select {
      padding: 2px 6px;
      background: var(--vscode-dropdown-background, #3c3c3c);
      color: var(--vscode-dropdown-foreground, #cccccc);
      border: 1px solid var(--vscode-dropdown-border, #3e3e42);
      border-radius: 3px;
      font-size: 11px;
      cursor: pointer;
    }
    #tablePagination input[type="number"] {
      padding: 2px 4px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 3px;
      font-size: 11px;
      text-align: center;
      -moz-appearance: textfield;
    }
    #tablePagination input[type="number"]::-webkit-inner-spin-button,
    #tablePagination input[type="number"]::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .loading {
      opacity: 0.6;
      pointer-events: none;
    }
    .loading::after {
      content: ' ⏳';
    }
    #history {
      border-top: 1px solid var(--vscode-panel-border, #3e3e42);
      padding: 16px 20px;
      background: var(--vscode-editor-background, #1e1e1e);
      max-height: 40vh;
      overflow-y: auto;
      flex-shrink: 0;
    }
    #history h4 {
      margin: 0 0 12px 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground, #cccccc);
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    #history h4::before {
      content: '🕐';
      font-size: 14px;
    }
    #list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .item {
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      padding: 10px;
      background: var(--vscode-input-background, #3c3c3c);
      transition: all 0.15s ease;
    }
    .item:hover {
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      background: var(--vscode-list-hoverBackground, #2d2d30);
    }
    .item.favorite {
      border-color: var(--vscode-charts-yellow, #D7BA7D);
      background: rgba(215, 186, 125, 0.08);
    }
    .item.favorite:hover {
      border-color: var(--vscode-charts-yellow, #D7BA7D);
      box-shadow: 0 2px 6px rgba(215, 186, 125, 0.15);
      background: rgba(215, 186, 125, 0.12);
    }
    .item pre {
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0 0 8px 0;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 11px;
      color: var(--vscode-foreground, #cccccc);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .actions button {
      padding: 5px 10px;
      font-size: 11px;
    }
    .empty-state {
      text-align: center;
      padding: 36px 20px;
      color: var(--vscode-descriptionForeground, #858585);
      font-style: italic;
      font-size: 13px;
    }
    .empty-state::before {
      content: '📋';
      display: block;
      font-size: 28px;
      margin-bottom: 10px;
      opacity: 0.5;
    }
    .keyboard-hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #858585);
      margin-top: 6px;
      font-style: italic;
    }
    .keyboard-hint kbd {
      background: var(--vscode-keybindingLabel-background, #3c3c3c);
      border: 1px solid var(--vscode-keybindingLabel-border, #555);
      border-radius: 2px;
      padding: 2px 5px;
      font-family: monospace;
      font-size: 10px;
      margin: 0 2px;
      display: inline-block;
    }
    .CodeMirror-hints {
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      color: var(--vscode-editorWidget-foreground, #cccccc);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      z-index: 1000;
    }
    .CodeMirror-hint {
      color: var(--vscode-foreground, #cccccc);
      padding: 4px 8px;
      border-left: 2px solid transparent;
    }
    .CodeMirror-hint-active {
      background: var(--vscode-list-activeSelectionBackground, #094771);
      color: var(--vscode-list-activeSelectionForeground, #ffffff);
      border-left-color: var(--vscode-focusBorder, #007acc);
    }
    .cm-property-optional {
      opacity: 0.7;
    }
    .search-box {
      margin-bottom: 10px;
      position: relative;
    }
    .search-input {
      width: 100%;
      padding: 8px 12px;
      padding-left: 32px;
      background: var(--vscode-input-background, #3c3c3c);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      color: var(--vscode-input-foreground, #cccccc);
      border-radius: 4px;
      font-size: 12px;
      transition: all 0.15s ease;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.1);
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 13px;
      opacity: 0.6;
      pointer-events: none;
    }
    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .item-name {
      font-weight: 600;
      color: var(--vscode-textLink-foreground, #3794ff);
      font-size: 12px;
    }
    .security-warning {
      background: rgba(255, 200, 0, 0.1);
      border: 1px solid rgba(255, 200, 0, 0.4);
      border-radius: 4px;
      margin: 0 20px;
      padding: 10px 16px;
    }
    .security-warning-content {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .security-warning-icon {
      font-size: 18px;
      flex-shrink: 0;
    }
    .security-warning-text {
      flex: 1;
      font-size: 12px;
      line-height: 1.4;
    }
    .security-warning-text strong {
      display: block;
      color: #e0c36a;
      margin-bottom: 2px;
    }
    .security-warning-text span {
      color: var(--vscode-descriptionForeground, #cccccc);
    }

  </style>
</head>
<body>
  <header>
    <strong id="editorHeaderTitle">JSON Tools — Query Editor</strong>
    <div class="bound-files-container" id="boundFilesContainer">
        ${sourcesHtml}
        <button id="addFile" class="secondary" style="padding: 4px 8px; font-size: 11px;" title="Bind another JSON file from workspace or disk">+ Add File</button>
        <button id="addUrl" class="secondary" style="padding: 4px 8px; font-size: 11px;" title="Fetch data directly from an HTTP/HTTPS URL with custom headers">+ Add URL</button>
    </div>
    <div style="margin-left: auto; display: flex; gap: 6px; align-items: center;">
      <button id="scratchpadBtn" class="secondary" title="Switch to Standalone Scratchpad Mode (generate mocks, test expressions without bound sources)">⚡ Scratchpad</button>
      <button id="rebind" class="secondary" title="Rebind 'data' to currently focused editor">🔄 Rebind</button>
    </div>
  </header>


  <div class="row" style="background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 14px 20px; flex-direction: column; gap: 10px;">
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 2px;">
      <span style="font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground, #858585); text-transform: uppercase; letter-spacing: 0.3px;">🤖 AI Query</span>
      <select id="aiProvider" style="padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; font-size: 11px;">
        <option value="ollama">Ollama</option>
        <option value="gemini">Gemini</option>
      </select>
      <div id="ollamaConfig" style="display: flex; gap: 8px; flex: 1; align-items: center;">
        <input id="ollamaEndpoint" type="text" placeholder="http://localhost:11434" style="flex: 1; min-width: 140px; padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; font-size: 11px;">
      </div>
      <div id="geminiConfig" style="display: none; gap: 8px; flex: 1; align-items: center;">
        <input id="aiApiKey" type="password" placeholder="API Key" style="flex: 1; min-width: 140px; padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; font-size: 11px;">
      </div>
      <select id="aiModel" style="padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; font-size: 11px;">
        <option value="" disabled selected>Select Model...</option>
      </select>
      <button id="refreshModels" class="secondary" title="Refresh Models" style="padding: 6px 10px;">🔄</button>
    </div>
    <div id="aiAlert" class="modal-alert" style="display: none; padding: 6px 10px; font-size: 11px; align-items: center; justify-content: space-between; gap: 8px;">
      <span id="aiAlertMessage" style="flex: 1;"></span>
      <span id="aiAlertDismiss" style="cursor: pointer; margin-left: 8px; font-weight: bold; opacity: 0.8;" title="Dismiss">✕</span>
    </div>
    <div style="display: flex; gap: 8px; width: 100%;">
      <textarea id="aiPrompt" placeholder="e.g. Filter active users older than 25, return just their names" style="flex: 1; height: 128px; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; resize: none; font-family: inherit; font-size: 14px;"></textarea>
      <div style="display: flex; align-items: center;">
        <button id="aiGenerate" class="primary" style="padding: 6px 12px; height: fit-content;">Generate</button>
      </div>
    </div>
  </div>

  <div id="securityWarning" class="security-warning" style="display: none; margin-top: 10px;">
    <div class="security-warning-content">
      <span class="security-warning-icon">⚠</span>
      <div class="security-warning-text">
        <strong>Security Warning</strong>
        <span id="securityWarningMessage"></span>
      </div>
      <button id="runAnyway" class="danger">Run Anyway</button>
      <button id="dismissWarning" class="secondary">Cancel</button>
    </div>
  </div>

  <div class="row">
      <textarea id="expr" placeholder=".filter(x=>x.active).map(x=>({name:x.name})) — Template vars: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}"></textarea>
      <div class="keyboard-hint">Press <kbd>Ctrl+Enter</kbd> to run | <kbd>Ctrl+S</kbd> to save</div>
    </div>
  </div>
  <div class="row" style="gap: 12px;">
    <button id="run" class="primary">▶ Run</button>
    <button id="save" class="secondary">★ Save</button>
    <button id="beautify" class="secondary">✨ Beautify</button>
    <button id="clear" class="secondary">🗑 Clear</button>
    <button id="importQuery" class="secondary" title="Import a .js, .ts, or .txt file as the query expression" style="margin-left: auto;">📤 Import File</button>
    <button id="exportQuery" class="secondary" title="Export current query to a file" style="margin-left: 8px;">📥 Export File</button>
  </div>

  <div id="result">
    <div class="result-header">
      <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
        <h4 style="margin: 0;">Result</h4>
        <span id="resultInfo" style="font-size: 10px; color: var(--vscode-descriptionForeground, #858585);"></span>
      </div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        <select id="resultFormat" style="padding: 6px 10px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; font-family: inherit;">
          <option value="json">JSON</option>
          <option value="yaml">YAML</option>
          <option value="ndjson">NDJSON</option>
          <option value="xml">XML</option>
          <option value="table">Table</option>
          <option value="chart">Chart</option>
        </select>
        <select id="chartType" style="display: none; padding: 6px 10px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; font-family: inherit;">
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="pie">Pie</option>
        </select>
        <button id="downloadChart" class="secondary" style="display: none; padding: 6px 10px;">📥 png</button>
        <button id="saveJson" class="secondary" style="display: none; padding: 6px 10px;">📥 json</button>
        <button id="saveCsv" class="secondary" style="display: none; padding: 6px 10px;">📥 csv</button>
        <button id="saveYaml" class="secondary" style="display: none; padding: 6px 10px;">📥 yaml</button>
        <button id="saveNdjson" class="secondary" style="display: none; padding: 6px 10px;">📥 ndjson</button>
        <button id="saveXml" class="secondary" style="display: none; padding: 6px 10px;">📥 xml</button>
        <select id="exportDropdown" style="display: none; padding: 6px 10px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; font-family: inherit;" title="Export result to file">
          <option value="" disabled selected>📥 Export...</option>
          <option value="json">JSON (.json)</option>
          <option value="csv">CSV (.csv)</option>
          <option value="yaml">YAML (.yaml)</option>
          <option value="ndjson">NDJSON (.ndjson)</option>
          <option value="xml">XML (.xml)</option>
        </select>
        <button id="copy-result-to-clipboard" class="secondary" style="padding: 6px 10px;">📋 Copy</button>
        <button id="openResultInEditorBtn" class="secondary" style="padding: 6px 10px;" title="Open result in a new VS Code editor tab">↗ In Editor</button>
      </div>
    </div>
    <div id="resultContainer">
      <textarea id="resultJsonEditor" style="display: none;"></textarea>
      <pre id="resultPre" class="empty">(no result yet)</pre>
      <div id="resultTableWarning" style="display: none; padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a table.</div>
      <table id="resultTable" style="display: none; width: 100%; border-collapse: collapse; background: var(--vscode-textCodeBlock-background, #252526); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; overflow: hidden; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace; font-size: 11px;">
        <thead id="resultTableHead" style="background: var(--vscode-titleBar-activeBackground, #2d2d30); color: var(--vscode-titleBar-activeForeground, #ffffff);">
        </thead>
        <tbody id="resultTableBody" style="color: var(--vscode-textPreformat-foreground, #d4d4d4);">
        </tbody>
      </table>
      <div id="tablePagination">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span id="tablePageInfo" style="color: var(--vscode-descriptionForeground, #858585);"></span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 5px;">
            <label for="tablePageSize" style="color: var(--vscode-descriptionForeground, #858585); font-size: 11px;">Rows per page:</label>
            <select id="tablePageSize">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button id="tableFirstPage" class="secondary" title="First Page">«</button>
            <button id="tablePrevPage" class="secondary" title="Previous Page">‹ Prev</button>
            <span style="font-size: 11px; color: var(--vscode-foreground, #cccccc); margin: 0 4px; display: inline-flex; align-items: center; gap: 4px;">
              Page <input id="tablePageInput" type="number" min="1" value="1" style="width: 44px;" /> of <span id="tableTotalPages">1</span>
            </span>
            <button id="tableNextPage" class="secondary" title="Next Page">Next ›</button>
            <button id="tableLastPage" class="secondary" title="Last Page">»</button>
          </div>
        </div>
      </div>
      <div id="resultChartWarning" style="display: none; padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a chart.</div>
      <div id="resultChartContainer">
        <canvas id="resultChart"></canvas>
      </div>
    </div>
  </div>

  <div id="history">
    <h4>History</h4>
    <div class="search-box">
      <span class="search-icon">&#128269;</span>
      <input type="text" id="historySearch" class="search-input" placeholder="Search saved queries..." />
    </div>
    <div id="list"></div>
  </div>

  <!-- URL Source Modal -->
  <div id="urlModal" class="modal-backdrop" style="display: none;">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3 id="urlModalTitle">Add URL Data Source</h3>
        <button id="closeUrlModal" class="modal-close-btn" title="Close dialog">&times;</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="urlSourceId" value="">

        <!-- cURL Import Panel (Collapsible) -->
        <div id="curlImportPanel" style="display: none; background: rgba(0, 122, 204, 0.08); border: 1px solid var(--vscode-focusBorder, #007acc); border-radius: 4px; padding: 10px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-weight: 600; font-size: 11px; color: var(--vscode-foreground, #ccc);">Paste cURL Command (DevTools, Postman, Terminal)</span>
            <button type="button" id="closeCurlImportBtn" class="modal-close-btn" style="font-size: 14px; line-height: 1; padding: 0 4px;" title="Close cURL import panel">&times;</button>
          </div>
          <textarea id="curlImportInput" rows="4" style="width: 100%; box-sizing: border-box; font-family: monospace; font-size: 11px; resize: vertical;" placeholder="curl 'https://api.example.com/v1/data' -H 'Authorization: Bearer token' -d '{&quot;foo&quot;: &quot;bar&quot;}'"></textarea>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
            <button type="button" id="cancelCurlImportBtn" class="secondary" style="font-size: 11px; padding: 3px 8px;">Cancel</button>
            <button type="button" id="applyCurlImportBtn" class="primary" style="font-size: 11px; padding: 3px 12px;">Apply to Request</button>
          </div>
        </div>
        
        <div class="form-group">
          <label for="urlAlias">Source Alias (Variable Name)</label>
          <input type="text" id="urlAlias" placeholder="e.g. data or apiData" value="data">
          <span class="form-hint">Used as the variable in your JS expression (e.g. <code>data.items</code> or <code>apiData.users</code>)</span>
        </div>

        <div class="form-row" style="display: flex; gap: 8px;">
          <div class="form-group" style="width: 120px;">
            <label for="urlMethod">Method</label>
            <select id="urlMethod" style="width: 100%;">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
              <option value="HEAD">HEAD</option>
              <option value="OPTIONS">OPTIONS</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1;">
            <label for="urlEndpoint">URL</label>
            <input type="text" id="urlEndpoint" placeholder="https://api.example.com/v1/data or {{baseUrl}}/users">
            <span class="form-hint" style="font-size: 10px; margin-top: 2px;">Supports <code>{{$env.VAR_NAME}}</code> and <code>{{baseUrl}}</code></span>
          </div>
        </div>

        <!-- Request Configuration Tabs (Params | Headers | Body) -->
        <div class="request-tabs-bar">
          <button type="button" class="request-tab-btn active" data-tab="params" id="tabBtnParams">
            Params <span id="paramsCountBadge" class="tab-badge" style="display: none;">0</span>
          </button>
          <button type="button" class="request-tab-btn" data-tab="headers" id="tabBtnHeaders">
            Headers <span id="headersCountBadge" class="tab-badge" style="display: none;">0</span>
          </button>
          <button type="button" class="request-tab-btn" data-tab="body" id="tabBtnBody" style="display: none;">
            Body
          </button>
        </div>

        <!-- Tab Pane: Query Params (Postman Style) -->
        <div id="tabPaneParams" class="request-tab-pane" style="display: block;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="form-hint" style="font-size: 11px;">Query Parameters (synced with URL in real-time)</span>
            <button type="button" id="addParamRowBtn" class="secondary" style="padding: 2px 8px; font-size: 11px;">+ Add Param</button>
          </div>
          <div class="params-table-container" style="border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; overflow: hidden; background: var(--vscode-input-background, #252526);">
            <table id="queryParamsTable" style="width: 100%; border-collapse: collapse; font-size: 11px;">
              <thead>
                <tr style="background: rgba(255,255,255,0.04); border-bottom: 1px solid var(--vscode-input-border, #3e3e42); color: var(--vscode-descriptionForeground, #858585); text-align: left;">
                  <th style="width: 32px; padding: 6px; text-align: center;"></th>
                  <th style="padding: 6px 8px; font-weight: 600; width: 42%;">Key</th>
                  <th style="padding: 6px 8px; font-weight: 600;">Value</th>
                  <th style="width: 32px; padding: 6px; text-align: center;"></th>
                </tr>
              </thead>
              <tbody id="queryParamsBody">
                <!-- Dynamic param rows will be rendered here -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab Pane: Headers -->
        <div id="tabPaneHeaders" class="request-tab-pane" style="display: none;">
          <div class="form-group">
            <label for="urlHeaders">Custom Headers</label>
            <textarea id="urlHeaders" rows="4" placeholder="Authorization: Bearer {{$env.API_KEY}}&#10;Accept: application/json&#10;X-Custom-Header: value"></textarea>
            <span class="form-hint">Enter one header per line as <code>Header-Name: value</code> or as JSON. Supports <code>{{$env.VAR}}</code>.</span>
          </div>
        </div>

        <!-- Tab Pane: Body -->
        <div id="tabPaneBody" class="request-tab-pane" style="display: none;">
          <div class="form-group" id="urlBodyGroup">
            <label for="urlBody">Request Body</label>
            <textarea id="urlBody" rows="5" placeholder="{&#10;  &quot;query&quot;: &quot;value&quot;&#10;}"></textarea>
            <span class="form-hint">Payload for POST, PUT, PATCH, DELETE requests. Supports <code>{{$env.VAR}}</code> and <code>{{baseUrl}}</code>.</span>
          </div>
        </div>

        <div id="urlModalAlert" class="modal-alert" style="display: none;"></div>

        <!-- URL Response Preview Pane -->
        <div id="urlModalPreview" style="display: none; border-top: 1px solid var(--vscode-panel-border, #3e3e42); padding-top: 10px; margin-top: 5px; contain: content;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--vscode-descriptionForeground, #ccc);">Response Preview</span>
              <span id="previewStatusBadge" class="status-badge status-2xx">200 OK</span>
            </div>
            <span id="previewMeta" style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585);"></span>
          </div>

          <!-- Preview Tab Bar -->
          <div id="previewTabBar" class="request-tabs-bar" style="margin-bottom: 6px;">
            <button type="button" class="request-tab-btn active" data-preview-tab="body" id="previewTabBody">
              Body
            </button>
            <button type="button" class="request-tab-btn" data-preview-tab="headers" id="previewTabHeaders">
              Response Headers <span id="previewHeadersCount" class="tab-badge" style="display: none;">0</span>
            </button>
          </div>

          <!-- Tab: Preview Body -->
          <div id="previewPaneBody">
            <pre id="urlPreviewPre" style="margin: 0; max-height: 180px; overflow: auto; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace; font-size: 11px; line-height: 1.4; padding: 8px; background: var(--vscode-textCodeBlock-background, #252526); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; color: var(--vscode-editor-foreground, #d4d4d4); white-space: pre; contain: content;"></pre>
          </div>

          <!-- Tab: Preview Response Headers -->
          <div id="previewPaneHeaders" style="display: none;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <input id="previewHeadersSearch" type="text" placeholder="Filter headers…" style="padding: 4px 8px; font-size: 11px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; flex: 1; margin-right: 8px;" />
              <button type="button" id="copyAllPreviewHeadersBtn" class="secondary" style="padding: 3px 8px; font-size: 11px; white-space: nowrap;">📋 Copy All</button>
            </div>
            <div style="max-height: 180px; overflow-y: auto; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; background: var(--vscode-textCodeBlock-background, #252526);">
              <table id="previewHeadersTable" style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;">
                <thead>
                  <tr style="background: rgba(255,255,255,0.05); border-bottom: 2px solid var(--vscode-input-border, #3e3e42); color: var(--vscode-descriptionForeground, #858585); text-align: left; position: sticky; top: 0; z-index: 1;">
                    <th id="previewHeaderSortName" style="padding: 6px 8px; font-weight: 600; cursor: pointer; user-select: none; width: 38%;">Header Name <span id="previewSortNameIcon">↕</span></th>
                    <th style="padding: 6px 8px; font-weight: 600;">Value</th>
                  </tr>
                </thead>
                <tbody id="previewHeadersBody">
                </tbody>
              </table>
            </div>
            <div id="previewNoHeaders" style="display: none; text-align: center; padding: 15px; color: var(--vscode-descriptionForeground, #858585); font-style: italic; font-size: 11px;">No response headers available</div>
          </div>
        </div>
      </div>

      <div class="modal-footer" style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; gap: 6px;">
          <button id="testUrlModal" class="secondary" title="Test request and preview response without saving">
            <span id="testUrlSpinner" class="spinner" style="display: none;"></span>
            <span id="testUrlText">Test Request</span>
          </button>
          <button id="importCurlBtn" type="button" class="secondary" title="Import URL, headers, and payload from a cURL command">📥 Import cURL</button>
          <button id="copyCurlBtn" type="button" class="secondary" title="Copy current request configuration as a cURL command">📋 Copy as cURL</button>
        </div>
        <div style="display: flex; gap: 10px;">
          <button id="cancelUrlModal" class="secondary">Cancel</button>
          <button id="submitUrlModal" class="primary">
            <span id="submitUrlSpinner" class="spinner" style="display: none;"></span>
            <span id="submitUrlText">Fetch &amp; Bind</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Source Inspection Modal (Option A) -->
  <div id="sourceInspectModal" class="modal-backdrop" style="display: none;">
    <div class="modal-dialog" style="max-width: 720px; width: 90%;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
          <h3 id="inspectModalTitle" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;">Inspect Source</h3>
          <span id="inspectModalTypeBadge" class="status-badge status-3xx" style="display: none;">URL</span>
          <span id="inspectStatusBadge" class="status-badge status-2xx" style="display: none;"></span>
        </div>
        <button id="closeInspectModal" class="modal-close-btn" title="Close dialog">&times;</button>
      </div>
      <div class="modal-body" style="gap: 8px;">
        <div id="inspectSourceDetails" style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585); line-height: 1.4; word-break: break-all; background: rgba(255,255,255,0.03); padding: 6px 10px; border-radius: 4px; border: 1px solid var(--vscode-panel-border, #3e3e42);"></div>

        <!-- Inspect Tab Bar -->
        <div id="inspectTabBar" class="request-tabs-bar">
          <button type="button" class="request-tab-btn active" data-inspect-tab="body" id="inspectTabBody">
            Body
          </button>
          <button type="button" class="request-tab-btn" data-inspect-tab="headers" id="inspectTabHeaders" style="display: none;">
            Response Headers <span id="inspectHeadersCount" class="tab-badge" style="display: none;">0</span>
          </button>
        </div>

        <!-- Tab: Body -->
        <div id="inspectPaneBody">
          <pre id="inspectDataPre" style="margin: 0; max-height: 55vh; min-height: 150px; overflow: auto; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace; font-size: 11px; line-height: 1.4; padding: 10px; background: var(--vscode-textCodeBlock-background, #252526); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; color: var(--vscode-editor-foreground, #d4d4d4); white-space: pre; contain: content;"></pre>
        </div>

        <!-- Tab: Response Headers -->
        <div id="inspectPaneHeaders" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <input id="inspectHeadersSearch" type="text" placeholder="Filter headers…" style="padding: 4px 8px; font-size: 11px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; flex: 1; margin-right: 8px;" />
            <button type="button" id="copyAllHeadersBtn" class="secondary" style="padding: 3px 8px; font-size: 11px; white-space: nowrap;">📋 Copy All</button>
          </div>
          <div style="max-height: 55vh; min-height: 150px; overflow-y: auto; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; background: var(--vscode-textCodeBlock-background, #252526);">
            <table id="inspectHeadersTable" style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;">
              <thead>
                <tr style="background: rgba(255,255,255,0.05); border-bottom: 2px solid var(--vscode-input-border, #3e3e42); color: var(--vscode-descriptionForeground, #858585); text-align: left; position: sticky; top: 0; z-index: 1;">
                  <th id="inspectHeaderSortName" style="padding: 7px 10px; font-weight: 600; cursor: pointer; user-select: none; width: 38%;">Header Name <span id="inspectSortNameIcon">↕</span></th>
                  <th style="padding: 7px 10px; font-weight: 600;">Value</th>
                </tr>
              </thead>
              <tbody id="inspectHeadersBody">
              </tbody>
            </table>
          </div>
          <div id="inspectNoHeaders" style="display: none; text-align: center; padding: 20px; color: var(--vscode-descriptionForeground, #858585); font-style: italic; font-size: 12px;">No response headers available</div>
        </div>

      </div>
      <div class="modal-footer" style="justify-content: space-between; align-items: center;">
        <span id="inspectDataMeta" style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585);"></span>
        <div style="display: flex; gap: 8px;">
          <button id="copyInspectBtn" class="secondary">📋 Copy</button>
          <button id="copyInspectCurlBtn" class="secondary" style="display: none;" title="Copy this URL request as a cURL command">📋 Copy as cURL</button>
          <button id="openInspectInEditorBtn" class="secondary" title="Open this data in a new VS Code editor tab">↗ Open in VS Code Tab</button>
          <button id="dismissInspectBtn" class="primary">Close</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${n}">
    let beautifyReady = false;
    const vscode = acquireVsCodeApi();
    const exprTextarea = document.getElementById('expr');
    const listEl = document.getElementById('list');
    const resultPre = document.getElementById('resultPre');
    const rebindBtn = document.getElementById('rebind');
    const copyResultBtn = document.getElementById('copy-result-to-clipboard');
    const resultFormat = document.getElementById('resultFormat');
    const chartType = document.getElementById('chartType');
    const downloadChartBtn = document.getElementById('downloadChart');
    const saveJsonBtn = document.getElementById('saveJson');
    const saveCsvBtn = document.getElementById('saveCsv');
    const saveYamlBtn = document.getElementById('saveYaml');
    const saveNdjsonBtn = document.getElementById('saveNdjson');
    const saveXmlBtn = document.getElementById('saveXml');
    const exportDropdown = document.getElementById('exportDropdown');
    const resultInfo = document.getElementById('resultInfo');
    const resultTable = document.getElementById('resultTable');
    const resultTableHead = document.getElementById('resultTableHead');
    const resultTableBody = document.getElementById('resultTableBody');
    const resultTableWarning = document.getElementById('resultTableWarning');
    const tablePagination = document.getElementById('tablePagination');
    const tablePageInfo = document.getElementById('tablePageInfo');
    const tablePageSize = document.getElementById('tablePageSize');
    const tableFirstPage = document.getElementById('tableFirstPage');
    const tablePrevPage = document.getElementById('tablePrevPage');
    const tableNextPage = document.getElementById('tableNextPage');
    const tableLastPage = document.getElementById('tableLastPage');
    const tablePageInput = document.getElementById('tablePageInput');
    const tableTotalPages = document.getElementById('tableTotalPages');
    const resultChartContainer = document.getElementById('resultChartContainer');
    const resultChartWarning = document.getElementById('resultChartWarning');
    const chartCanvas = document.getElementById('resultChart');
    const resultJsonEditorTextarea = document.getElementById('resultJsonEditor');

    function hideTable() {
      if (resultTable) resultTable.style.display = 'none';
      if (tablePagination) tablePagination.style.display = 'none';
      if (resultTableWarning) resultTableWarning.style.display = 'none';
    }

    function hideChart() {
      if (resultChartContainer) resultChartContainer.style.display = 'none';
      if (resultChartWarning) resultChartWarning.style.display = 'none';
      if (chartType) chartType.style.display = 'none';
      if (downloadChartBtn) downloadChartBtn.style.display = 'none';
    }

    let currentTableData = null;
    let tableCurrentPage = 1;
    let currentTablePageSize = 50;
    try {
      const savedPageSize = parseInt(localStorage.getItem('jsonQueryTools.tablePageSize') || '50', 10);
      if ([25, 50, 100, 250, 500].includes(savedPageSize)) {
        currentTablePageSize = savedPageSize;
      }
    } catch (e) {}
    if (tablePageSize) {
      tablePageSize.value = String(currentTablePageSize);
    }
    let currentSources = ${initialSourcesJson};


    function renderSources(sources) {
      currentSources = sources || [];
      const container = document.getElementById('boundFilesContainer');
      if (!container) return;

      const itemsHtml = currentSources.map(s => {
        if (s.type === 'url') {
          const method = s.method || 'GET';
          const methodClass = 'method-' + method.toLowerCase();
          return '<span class="bound-file bound-url" data-alias="' + escapeHtml(s.alias) + '" data-id="' + escapeHtml(s.id || '') + '" title="' + escapeHtml(method) + ' ' + escapeHtml(s.url || '') + '">' +
            '<span class="url-badge-method ' + methodClass + '">' + escapeHtml(method) + '</span>' +
            '<span class="file-alias">' + escapeHtml(s.alias) + '</span>: ' + escapeHtml(s.label || s.url || '') +
            '<button class="inspect-source-btn" data-id="' + escapeHtml(s.id || '') + '" title="View cached API response">👁️</button>' +
            '<button class="copy-url-curl-btn" data-id="' + escapeHtml(s.id || '') + '" title="Copy as cURL command">📋</button>' +
            '<button class="refresh-url-btn" data-id="' + escapeHtml(s.id || '') + '" title="Re-fetch data from URL">🔄</button>' +
            '<button class="edit-url-btn" data-id="' + escapeHtml(s.id || '') + '" title="Edit URL, headers, or method">✏️</button>' +
            '<button class="remove-source" data-alias="' + escapeHtml(s.alias) + '" data-id="' + escapeHtml(s.id || '') + '" title="Remove source">×</button>' +
          '</span>';
        }
        return '<span class="bound-file" data-alias="' + escapeHtml(s.alias) + '" title="' + escapeHtml(s.label) + '">' +
          '<span class="file-icon">📁</span> ' +
          '<span class="file-alias">' + escapeHtml(s.alias) + '</span>: ' + escapeHtml(s.label.split('/').pop() || s.label) +
          '<button class="inspect-source-btn" data-alias="' + escapeHtml(s.alias) + '" title="View JSON data">👁️</button>' +
          '<button class="remove-source" data-alias="' + escapeHtml(s.alias) + '" title="Remove source">×</button>' +
        '</span>';
      }).join('');

      const sourcesHtml = currentSources.length > 0 ? itemsHtml : '<span class="bound-file standalone-tag" style="opacity: 0.75; font-style: italic; background: transparent; border: 1px dashed var(--vscode-input-border, #3e3e42); padding: 3px 8px; border-radius: 3px;" title="Standalone Mode: No data sources bound. You can generate data or run standalone JavaScript expressions.">⚡ Standalone Mode</span>';

      container.innerHTML = sourcesHtml +
        '<button id="addFile" class="secondary" style="padding: 4px 8px; font-size: 11px;" title="Bind another JSON file from workspace or disk">+ Add File</button>' +
        '<button id="addUrl" class="secondary" style="padding: 4px 8px; font-size: 11px;" title="Fetch data directly from an HTTP/HTTPS URL with custom headers">+ Add URL</button>';

      const headerTitle = document.getElementById('editorHeaderTitle');
      const exprInput = document.getElementById('expr');
      if (currentSources.length === 0) {
        if (headerTitle) headerTitle.textContent = 'JSON Tools — JS Scratchpad';
        if (exprInput && (!editor || !editor.getValue())) {
          exprInput.placeholder = "⚡ Standalone Scratchpad: return mocks, math, or regexes (e.g. Array.from({length: 5}, (_, i) => ({ id: i + 1 })))";
        }
      } else {
        if (headerTitle) headerTitle.textContent = 'JSON Tools — Query Editor';
        if (exprInput) {
          exprInput.placeholder = ".filter(x=>x.active).map(x=>({name:x.name})) — Template vars: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}";
        }
      }

    }

    let currentResultData = null;
    let editor;
    let codeMirrorLoaded = false;
    let resultJsonEditor = null;
    let resultJsonEditorWrapper = null;
    let chartJsLoaded = false;
    let currentChart = null;
    let syntaxErrorMarker = null;
    let syntaxErrorWidget = null;
    let syntaxValidationTimer = null;
    
    // Schema state
    let currentSchema = null;
    
    // Streaming state
    let streamingData = null;
    let streamingTotalItems = 0;
    let streamingReceivedItems = 0;
    let streamingIsActive = false;
    let streamingRafId = null;

    // AI Elements
    const aiProvider = document.getElementById('aiProvider');
    const ollamaConfig = document.getElementById('ollamaConfig');
    const geminiConfig = document.getElementById('geminiConfig');
    const ollamaEndpoint = document.getElementById('ollamaEndpoint');
    const aiApiKey = document.getElementById('aiApiKey');
    const aiModel = document.getElementById('aiModel');
    const refreshModelsBtn = document.getElementById('refreshModels');
    const aiPrompt = document.getElementById('aiPrompt');
    const aiGenerateBtn = document.getElementById('aiGenerate');
    const aiAlert = document.getElementById('aiAlert');
    const aiAlertMessage = document.getElementById('aiAlertMessage');
    const aiAlertDismiss = document.getElementById('aiAlertDismiss');

    function showAiAlert(msg) {
      if (aiAlert && aiAlertMessage) {
        aiAlertMessage.textContent = msg;
        aiAlert.style.display = 'flex';
      }
    }

    function hideAiAlert() {
      if (aiAlert && aiAlertMessage) {
        aiAlertMessage.textContent = '';
        aiAlert.style.display = 'none';
      }
    }

    if (aiAlertDismiss) {
      aiAlertDismiss.onclick = hideAiAlert;
    }

    // Initialize Config
    const savedProvider = localStorage.getItem('jsonQueryTools.aiProvider') || 'ollama';
    aiProvider.value = savedProvider;
    updateProviderUI();

    const savedEndpoint = localStorage.getItem('jsonQueryTools.ollamaEndpoint');
    if (savedEndpoint) ollamaEndpoint.value = savedEndpoint;
    
    // Migrate legacy plaintext API key from localStorage to SecretStorage and purge from localStorage
    try {
      const legacyKey = localStorage.getItem('jsonQueryTools.aiApiKey');
      if (legacyKey) {
        localStorage.removeItem('jsonQueryTools.aiApiKey');
        vscode.postMessage({ type: 'setAiApiKey', apiKey: legacyKey });
        if (aiApiKey) aiApiKey.value = legacyKey;
      }
    } catch {}

    if (aiApiKey) {
      aiApiKey.addEventListener('change', () => {
        const key = aiApiKey.value ? aiApiKey.value.trim() : '';
        vscode.postMessage({ type: 'setAiApiKey', apiKey: key });
      });
    }

    function updateProviderUI() {
        const provider = aiProvider.value;
        if (provider === 'gemini') {
            ollamaConfig.style.display = 'none';
            geminiConfig.style.display = 'flex';
        } else {
            ollamaConfig.style.display = 'flex';
            geminiConfig.style.display = 'none';
        }
    }

    aiProvider.onchange = () => {
        hideAiAlert();
        localStorage.setItem('jsonQueryTools.aiProvider', aiProvider.value);
        updateProviderUI();
        // Clear models when switching?
        aiModel.innerHTML = '<option value="" disabled selected>Select Model...</option>';
    };

    // Auto-fetch if possible
    setTimeout(() => {
        if (aiProvider.value === 'ollama' && ollamaEndpoint.value) {
           vscode.postMessage({ type: 'getModels', provider: 'ollama', endpoint: ollamaEndpoint.value });
        }
    }, 500);

    function loadChartJs() {
      return new Promise((resolve, reject) => {
        if (typeof Chart !== 'undefined') {
          chartJsLoaded = true;
          resolve();
          return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.setAttribute('nonce', '${n}');
        script.onload = () => {
          console.log('Chart.js loaded');
          chartJsLoaded = true;
          resolve();
        };
        script.onerror = () => {
          console.warn('Failed to load Chart.js');
          reject(new Error('Failed to load Chart.js'));
        };
        document.head.appendChild(script);
      });
    }
    
    function loadCodeMirror() {
      return new Promise((resolve, reject) => {
        if (typeof CodeMirror !== 'undefined') {
          codeMirrorLoaded = true;
          resolve();
          return;
        }
        
        // Try multiple CDNs in order
        const cdns = [
          { base: 'https://cdn.jsdelivr.net/npm/codemirror@5.65.16' },
          { base: 'https://unpkg.com/codemirror@5.65.16' },
          { base: 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16' }
        ];
        
        let cdnIndex = 0;
        
        function tryLoadFromCDN() {
          if (cdnIndex >= cdns.length) {
            reject(new Error('All CDNs failed to load'));
            return;
          }
          
          const cdn = cdns[cdnIndex];
          console.log('Trying to load CodeMirror from:', cdn.base);
          
          // Load CSS if not already loaded
          if (!document.querySelector('link[href*="codemirror"]')) {
            const cmCSS = document.createElement('link');
            cmCSS.rel = 'stylesheet';
            cmCSS.href = cdn.base + '/lib/codemirror.css';
            cmCSS.onerror = () => console.warn('Failed to load CodeMirror CSS from', cdn.base);
            document.head.appendChild(cmCSS);
            
            const themeCSS = document.createElement('link');
            themeCSS.rel = 'stylesheet';
            themeCSS.href = cdn.base + '/theme/monokai.css';
            themeCSS.onerror = () => console.warn('Failed to load theme CSS from', cdn.base);
            document.head.appendChild(themeCSS);
          }
          
          const cmScript = document.createElement('script');
          cmScript.src = cdn.base + '/lib/codemirror.js';
          cmScript.setAttribute('nonce', '${n}');
          cmScript.onload = () => {
            console.log('CodeMirror core loaded from', cdn.base);
            // Wait a bit for CodeMirror to be fully available
            setTimeout(() => {
              const jsModeScript = document.createElement('script');
              jsModeScript.src = cdn.base + '/mode/javascript/javascript.js';
              jsModeScript.setAttribute('nonce', '${n}');
              jsModeScript.onload = () => {
                const commentAddonScript = document.createElement('script');
                commentAddonScript.src = cdn.base + '/addon/comment/comment.js';
                commentAddonScript.setAttribute('nonce', '${n}');
                commentAddonScript.onload = () => {
                  // Load folding addons and CSS
                  if (!document.querySelector('link[href*="foldgutter"]')) {
                    const foldCSS = document.createElement('link');
                    foldCSS.rel = 'stylesheet';
                    foldCSS.href = cdn.base + '/addon/fold/foldgutter.css';
                    foldCSS.onerror = () => console.warn('Failed to load foldgutter CSS from', cdn.base);
                    document.head.appendChild(foldCSS);
                  }
                  
                  // Load show-hint CSS
                  if (!document.querySelector('link[href*="show-hint"]')) {
                    const hintCSS = document.createElement('link');
                    hintCSS.rel = 'stylesheet';
                    hintCSS.href = cdn.base + '/addon/hint/show-hint.css';
                    hintCSS.onerror = () => console.warn('Failed to load show-hint CSS from', cdn.base);
                    document.head.appendChild(hintCSS);
                  }
                  
                  const foldScripts = [
                    cdn.base + '/addon/fold/foldcode.js',
                    cdn.base + '/addon/fold/brace-fold.js',
                    cdn.base + '/addon/fold/foldgutter.js',
                    cdn.base + '/addon/hint/show-hint.js'
                  ];
                  let foldIndex = 0;
                  function loadNextFoldScript() {
                    if (foldIndex >= foldScripts.length) {
                      codeMirrorLoaded = true;
                      resolve();
                      return;
                    }
                    const s = document.createElement('script');
                    s.src = foldScripts[foldIndex];
                    s.setAttribute('nonce', '${n}');
                    s.onload = () => {
                      foldIndex++;
                      loadNextFoldScript();
                    };
                    s.onerror = () => {
                      console.warn('Failed to load addon:', foldScripts[foldIndex]);
                      foldIndex++;
                      loadNextFoldScript();
                    };
                    document.head.appendChild(s);
                  }
                  loadNextFoldScript();
                };
                commentAddonScript.onerror = () => {
                  codeMirrorLoaded = true;
                  resolve();
                };
                document.head.appendChild(commentAddonScript);
              };
              jsModeScript.onerror = () => {
                cdnIndex++;
                tryLoadFromCDN();
              };
              document.head.appendChild(jsModeScript);
            }, 50);
          };
          cmScript.onerror = () => {
            console.warn('Failed to load CodeMirror from', cdn.base);
            cdnIndex++;
            tryLoadFromCDN();
          };
          document.head.appendChild(cmScript);
        }
        
        tryLoadFromCDN();
      });
    }
    
    function loadJsBeautify() {
      return new Promise((resolve, reject) => {
        if (typeof js_beautify !== 'undefined') {
          beautifyReady = true;
          console.log('js-beautify already loaded');
          resolve();
          return;
        }
        
        // Try multiple CDNs in order
        const cdns = [
          'https://cdn.jsdelivr.net/npm/js-beautify@1.14.9/js/beautify.min.js',
          'https://unpkg.com/js-beautify@1.14.9/js/beautify.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/1.14.9/beautify.min.js'
        ];
        
        let cdnIndex = 0;
        
        function tryLoadFromCDN() {
          if (cdnIndex >= cdns.length) {
            reject(new Error('All CDNs failed to load js-beautify'));
            return;
          }
          
          const cdnUrl = cdns[cdnIndex];
          console.log('Trying to load js-beautify from:', cdnUrl);
          
          const script = document.createElement('script');
          script.src = cdnUrl;
          script.setAttribute('nonce', '${n}');
          script.onload = () => {
            console.log('js-beautify loaded successfully from', cdnUrl);
            beautifyReady = true;
            resolve();
          };
          script.onerror = () => {
            console.warn('Failed to load js-beautify from', cdnUrl);
            cdnIndex++;
            tryLoadFromCDN();
          };
          document.head.appendChild(script);
        }
        
        tryLoadFromCDN();
      });
    }
    
    function loadAcorn() {
      return new Promise((resolve, reject) => {
        if (typeof acorn !== 'undefined') {
          resolve(null);
          return;
        }
        
        const cdns = [
          'https://cdn.jsdelivr.net/npm/acorn@8.11.3/dist/acorn.min.js',
          'https://unpkg.com/acorn@8.11.3/dist/acorn.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/acorn/8.11.3/acorn.min.js'
        ];
        
        let cdnIndex = 0;
        
        function tryLoad() {
          if (cdnIndex >= cdns.length) {
            reject(new Error('All CDNs failed to load acorn'));
            return;
          }
          
          const script = document.createElement('script');
          script.src = cdns[cdnIndex];
          script.setAttribute('nonce', '${n}');
          script.onload = () => resolve(null);
          script.onerror = () => {
            cdnIndex++;
            tryLoad();
          };
          document.head.appendChild(script);
        }
        
        tryLoad();
      });
    }
    
    function initEditor() {
      if (codeMirrorLoaded && typeof CodeMirror !== 'undefined' && exprTextarea && !editor) {
        try {
          console.log('Initializing CodeMirror editor...');
          editor = CodeMirror.fromTextArea(exprTextarea, {
            lineNumbers: true,
            gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
            foldGutter: true,
            mode: 'javascript',
            theme: 'monokai',
            lineWrapping: true,
            indentUnit: 2,
            tabSize: 2,
            autofocus: true,
            extraKeys: {
              'Ctrl-/': 'toggleComment',
              'Cmd-/': 'toggleComment',
              'Ctrl-Q': function(cm) { cm.foldCode(cm.getCursor()); },
              'Cmd-Q': function(cm) { cm.foldCode(cm.getCursor()); }
            }
          });
          
          console.log('CodeMirror editor created:', editor);
          
          // Immediately hide textarea
          exprTextarea.style.display = 'none';
          exprTextarea.style.visibility = 'hidden';
          exprTextarea.style.position = 'absolute';
          exprTextarea.style.opacity = '0';
          exprTextarea.style.height = '0';
          exprTextarea.style.width = '0';
          
          // Force refresh to ensure proper sizing
          setTimeout(() => {
            if (editor) {
              editor.refresh();
              editor.setSize('100%', '200px');
              setupKeyboardShortcuts();
              console.log('CodeMirror editor initialized successfully');
              
              // Attach syntax validation on changes (debounced)
              editor.on('change', () => {
                scheduleSyntaxValidation(200);
              });
              editor.on('blur', () => {
                scheduleSyntaxValidation(0); // immediate check on blur
              });
              
              // Setup schema autocomplete
              setupSchemaAutocomplete();
              
              // Final check - ensure textarea is completely hidden
              const cmElement = exprTextarea.nextElementSibling;
              if (cmElement && cmElement.classList.contains('CodeMirror')) {
                exprTextarea.style.display = 'none';
                console.log('CodeMirror element found, textarea hidden');
              }
            }
          }, 150);
        } catch (err) {
          console.error('Failed to initialize CodeMirror:', err);
          // Show error in result area
          resultPre.textContent = 'Warning: CodeMirror failed to load. Using textarea fallback.';
          resultPre.className = 'error';
        }
      } else if (!codeMirrorLoaded && !editor) {
        // Retry initialization
        setTimeout(initEditor, 200);
      } else if (!exprTextarea) {
        console.error('Textarea element not found');
      } else if (editor) {
        console.log('Editor already initialized');
      } else {
        console.log('Waiting for CodeMirror to load...', { codeMirrorLoaded, hasCodeMirror: typeof CodeMirror !== 'undefined' });
      }
    }

    function initResultJsonEditor() {
      if (!codeMirrorLoaded || typeof CodeMirror === 'undefined' || !resultJsonEditorTextarea || resultJsonEditor) {
        return;
      }
      try {
        resultJsonEditor = CodeMirror.fromTextArea(resultJsonEditorTextarea, {
          lineNumbers: true,
          gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
          foldGutter: true,
          mode: { name: 'javascript', json: true },
          theme: 'monokai',
          lineWrapping: true,
          readOnly: true
        });
        resultJsonEditorWrapper = resultJsonEditor.getWrapperElement();
        resultJsonEditorWrapper.style.display = 'none';
        resultJsonEditor.setSize('100%', '200px');
      } catch (e) {
        console.error('Failed to initialize result JSON CodeMirror:', e);
        resultJsonEditor = null;
        resultJsonEditorWrapper = null;
      }
    }
    
    // Schema-aware autocomplete
    const TYPE_ANY = 'any';
    const TYPE_OBJECT = 'object';
    const TYPE_ARRAY = 'array';
    const TYPE_STRING = 'string';
    const TYPE_NUMBER = 'number';
    const TYPE_BOOLEAN = 'boolean';
    const TYPE_NULL = 'null';

    function normalizeType(t) {
      if (!t) return TYPE_ANY;
      if (Array.isArray(t)) {
        // Drop null/undefined-ish from unions for method inference
        const filtered = t.filter(x => x && x !== TYPE_NULL);
        if (filtered.length === 0) return TYPE_ANY;
        if (filtered.length === 1) return filtered[0];
        // Prefer non-any if mixed
        if (filtered.includes(TYPE_ANY)) return TYPE_ANY;
        return TYPE_ANY; // union types treated as any for method inference
      }
      return t;
    }

    function schemaTypeOf(schema) {
      if (!schema) return TYPE_ANY;
      if (schema.type === 'array') return TYPE_ARRAY;
      if (schema.type === 'object') return TYPE_OBJECT;
      if (schema.type === 'primitive') return normalizeType(schema.valueType);
      return TYPE_ANY;
    }

    function propTypeOf(prop) {
      if (!prop) return TYPE_ANY;
      if (prop.items) return TYPE_ARRAY;
      if (prop.properties) return TYPE_OBJECT;
      return normalizeType(prop.type);
    }

    function schemaForProp(prop) {
      if (!prop) return null;
      if (prop.items) return prop.items;
      if (prop.properties) return { type: 'object', properties: prop.properties };
      return { type: 'primitive', valueType: normalizeType(prop.type) };
    }

    // Very small method knowledge base (instance methods)
    // Return type can be: string | number | boolean | array | object | any | 'sameArray' | 'arrayItems' | 'stringArray'
    const METHOD_RET = {
      array: {
        map: 'sameArray',
        filter: 'sameArray',
        slice: 'sameArray',
        concat: 'sameArray',
        flat: 'sameArray',
        flatMap: 'sameArray',
        toSorted: 'sameArray',
        toReversed: 'sameArray',
        reverse: 'array',
        sort: 'array',
        push: TYPE_NUMBER,
        pop: 'arrayItems',
        shift: 'arrayItems',
        unshift: TYPE_NUMBER,
        includes: TYPE_BOOLEAN,
        some: TYPE_BOOLEAN,
        every: TYPE_BOOLEAN,
        find: 'arrayItems',
        at: 'arrayItems',
        findIndex: TYPE_NUMBER,
        indexOf: TYPE_NUMBER,
        lastIndexOf: TYPE_NUMBER,
        join: TYPE_STRING,
        toString: TYPE_STRING,
        reduce: TYPE_ANY,
        reduceRight: TYPE_ANY
      },
      string: {
        toUpperCase: TYPE_STRING,
        toLowerCase: TYPE_STRING,
        trim: TYPE_STRING,
        trimStart: TYPE_STRING,
        trimEnd: TYPE_STRING,
        slice: TYPE_STRING,
        substring: TYPE_STRING,
        replace: TYPE_STRING,
        replaceAll: TYPE_STRING,
        split: 'stringArray',
        includes: TYPE_BOOLEAN,
        startsWith: TYPE_BOOLEAN,
        endsWith: TYPE_BOOLEAN,
        indexOf: TYPE_NUMBER,
        lastIndexOf: TYPE_NUMBER,
        charAt: TYPE_STRING,
        at: TYPE_STRING,
        padStart: TYPE_STRING,
        padEnd: TYPE_STRING,
        repeat: TYPE_STRING,
        toString: TYPE_STRING,
        valueOf: TYPE_STRING,
        match: 'array',
        matchAll: 'array'
      },
      number: {
        toFixed: TYPE_STRING,
        toExponential: TYPE_STRING,
        toPrecision: TYPE_STRING,
        toString: TYPE_STRING,
        valueOf: TYPE_NUMBER
      },
      boolean: {
        toString: TYPE_STRING,
        valueOf: TYPE_BOOLEAN
      },
      object: {
        toString: TYPE_STRING,
        valueOf: TYPE_ANY,
        hasOwnProperty: TYPE_BOOLEAN,
        isPrototypeOf: TYPE_BOOLEAN,
        propertyIsEnumerable: TYPE_BOOLEAN
      }
    };

    const PROPS_RET = {
      array: { length: TYPE_NUMBER },
      string: { length: TYPE_NUMBER }
    };

    function buildMethodCompletions(typeName, schemaPart) {
      const t = normalizeType(typeName);
      const list = [];

      // properties (like length)
      const props = PROPS_RET[t];
      if (props) {
        for (const [name, ret] of Object.entries(props)) {
          list.push({
            kind: 'property',
            text: name,
            displayText: name + ' : ' + ret
          });
        }
      }

      const methods = METHOD_RET[t];
      if (!methods) return list;
      for (const [name, ret] of Object.entries(methods)) {
        const retType = resolveReturnType(t, name, ret, schemaPart);
        list.push({
          kind: 'method',
          text: name,
          displayText: name + '() : ' + retType
        });
      }
      return list;
    }

    function resolveReturnType(receiverType, methodName, retSpec, schemaPart) {
      if (retSpec === 'sameArray') {
        return TYPE_ARRAY;
      }
      if (retSpec === 'arrayItems') {
        // element type if we know items
        if (schemaPart && schemaPart.type === 'array' && schemaPart.items) {
          return schemaTypeOf(schemaPart.items);
        }
        return TYPE_ANY;
      }
      if (retSpec === 'stringArray') {
        return TYPE_ARRAY + '<' + TYPE_STRING + '>';
      }
      if (retSpec === 'array') {
        return TYPE_ARRAY;
      }
      if (retSpec === TYPE_ANY) return TYPE_ANY;
      return retSpec;
    }

    function buildObjectFieldCompletions(schemaPart) {
      const list = [];
      if (!schemaPart || schemaPart.type !== 'object' || !schemaPart.properties) return list;
      for (const [key, prop] of Object.entries(schemaPart.properties)) {
        const typeStr = Array.isArray(prop.type) ? prop.type.join(' | ') : propTypeOf(prop);
        const optionalStr = prop.optional ? ' (optional)' : '';
        list.push({
          kind: 'field',
          text: key,
          displayText: key + ' : ' + typeStr + optionalStr,
          className: prop.optional ? 'cm-property-optional' : 'cm-property'
        });
      }
      return list;
    }

    // Infer type of an expression fragment like:
    // data
    // data[0]
    // data[0].name
    // data[0].name.toUpperCase()
    // a (callback parameter)
    // a.name (callback parameter with property access)
    // Returns { typeName, schemaPart }
    function inferTypeFromChain(chain, callbackBindings) {
      if (!currentSchema && !callbackBindings) return { typeName: TYPE_ANY, schemaPart: null };
      if (!chain) return { typeName: TYPE_ANY, schemaPart: null };

      let schemaPart = null;
      let typeName = TYPE_ANY;

      // Check if chain starts with a callback parameter
      if (callbackBindings) {
        for (const [paramName, binding] of Object.entries(callbackBindings)) {
          if (chain === paramName || chain.startsWith(paramName + '.')) {
            schemaPart = binding.schemaPart;
            typeName = binding.inferredType;
            // Consume parameter name
            let rest = chain.slice(paramName.length);
            // Continue processing rest of chain (e.g., ".name", ".age", ".toUpperCase()")
            while (rest.length > 0 && rest.startsWith('.')) {
              rest = rest.slice(1);
              
              // Try property access first
              const propMatch = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
              if (propMatch) {
                const propName = propMatch[1];
                rest = rest.slice(propMatch[0].length);
                
                // Check if it's a method call
                let isCall = false;
                if (rest.startsWith('(')) {
                  isCall = true;
                  let depth = 0;
                  let i = 0;
                  for (; i < rest.length; i++) {
                    const ch = rest[i];
                    if (ch === '(') depth++;
                    else if (ch === ')') {
                      depth--;
                      if (depth === 0) { i++; break; }
                    }
                  }
                  rest = rest.slice(i > 0 ? i : 1);
                }
                
                const t = normalizeType(typeName);
                
                if (isCall) {
                  // Method call
                  const table = METHOD_RET[t];
                  const retSpec = table ? table[propName] : undefined;
                  if (retSpec) {
                    const resolved = resolveReturnType(t, propName, retSpec, schemaPart);
                    if (retSpec === 'sameArray') {
                      schemaPart = schemaPart && schemaPart.type === 'array' ? schemaPart : { type: 'array', items: null };
                      typeName = TYPE_ARRAY;
                    } else if (retSpec === 'arrayItems') {
                      if (schemaPart && schemaPart.type === 'array' && schemaPart.items) {
                        schemaPart = schemaPart.items;
                        typeName = schemaTypeOf(schemaPart);
                      } else {
                        schemaPart = null;
                        typeName = TYPE_ANY;
                      }
                    } else if (retSpec === 'stringArray') {
                      schemaPart = { type: 'array', items: { type: 'primitive', valueType: TYPE_STRING } };
                      typeName = TYPE_ARRAY;
                    } else if (retSpec === 'array') {
                      schemaPart = { type: 'array', items: null };
                      typeName = TYPE_ARRAY;
                    } else {
                      schemaPart = { type: 'primitive', valueType: resolved };
                      typeName = normalizeType(resolved);
                    }
                  } else {
                    schemaPart = null;
                    typeName = TYPE_ANY;
                    break;
                  }
                } else {
                  // Property access
                  if (t === TYPE_STRING && propName === 'length') {
                    schemaPart = { type: 'primitive', valueType: TYPE_NUMBER };
                    typeName = TYPE_NUMBER;
                  } else if (t === TYPE_ARRAY && propName === 'length') {
                    schemaPart = { type: 'primitive', valueType: TYPE_NUMBER };
                    typeName = TYPE_NUMBER;
                  } else if (schemaPart && schemaPart.type === 'object' && schemaPart.properties && schemaPart.properties[propName]) {
                    const prop = schemaPart.properties[propName];
                    schemaPart = schemaForProp(prop);
                    typeName = schemaTypeOf(schemaPart);
                  } else {
                    schemaPart = null;
                    typeName = TYPE_ANY;
                    break;
                  }
                }
              } else {
                break;
              }
            }
            return { typeName: normalizeType(typeName), schemaPart };
          }
        }
      }

      // Fallback to 'data' chain
      if (!chain.startsWith('data')) return { typeName: TYPE_ANY, schemaPart: null };

      schemaPart = currentSchema;
      typeName = schemaTypeOf(schemaPart);

      // Consume after 'data'
      let rest = chain.slice(4);
      while (rest.length > 0) {
        // index access: [0]
        const idxMatch = rest.match(/^\\[(\\d+)\\]/);
        if (idxMatch) {
          if (schemaPart && schemaPart.type === 'array' && schemaPart.items) {
            schemaPart = schemaPart.items;
            typeName = schemaTypeOf(schemaPart);
          } else {
            schemaPart = null;
            typeName = TYPE_ANY;
          }
          rest = rest.slice(idxMatch[0].length);
          continue;
        }

        // member access: .foo, .foo(), or .foo(anyArgs...)
        const memNameMatch = rest.match(/^\\.([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        if (memNameMatch) {
          const name = memNameMatch[1];
          rest = rest.slice(memNameMatch[0].length);

          // Optional call with args: ( ... )
          let isCall = false;
          if (rest.startsWith('(')) {
            isCall = true;
            let depth = 0;
            let i = 0;
            for (; i < rest.length; i++) {
              const ch = rest[i];
              if (ch === '(') depth++;
              else if (ch === ')') {
                depth--;
                if (depth === 0) { i++; break; }
              }
            }
            // Consume call args (best-effort; if unbalanced, consume the '(' only)
            rest = rest.slice(i > 0 ? i : 1);
          }

          const t = normalizeType(typeName);

          if (isCall) {
            // method call on current type
            const table = METHOD_RET[t];
            const retSpec = table ? table[name] : undefined;
            if (retSpec) {
              const resolved = resolveReturnType(t, name, retSpec, schemaPart);
              // For array-returning methods, keep schemaPart as array when possible
              if (retSpec === 'sameArray') {
                schemaPart = schemaPart && schemaPart.type === 'array' ? schemaPart : { type: 'array', items: null };
                typeName = TYPE_ARRAY;
              } else if (retSpec === 'arrayItems') {
                // element returned
                if (schemaPart && schemaPart.type === 'array' && schemaPart.items) {
                  schemaPart = schemaPart.items;
                  typeName = schemaTypeOf(schemaPart);
                } else {
                  schemaPart = null;
                  typeName = TYPE_ANY;
                }
              } else if (retSpec === 'stringArray') {
                schemaPart = { type: 'array', items: { type: 'primitive', valueType: TYPE_STRING } };
                typeName = TYPE_ARRAY;
              } else if (retSpec === 'array') {
                schemaPart = { type: 'array', items: null };
                typeName = TYPE_ARRAY;
              } else if (typeof resolved === 'string' && resolved.startsWith(TYPE_ARRAY + '<')) {
                schemaPart = { type: 'array', items: { type: 'primitive', valueType: TYPE_STRING } };
                typeName = TYPE_ARRAY;
              } else {
                schemaPart = { type: 'primitive', valueType: resolved };
                typeName = normalizeType(resolved);
              }
            } else {
              schemaPart = null;
              typeName = TYPE_ANY;
            }
          } else {
            // property access
            if (t === TYPE_STRING && name === 'length') {
              schemaPart = { type: 'primitive', valueType: TYPE_NUMBER };
              typeName = TYPE_NUMBER;
            } else if (t === TYPE_ARRAY && name === 'length') {
              schemaPart = { type: 'primitive', valueType: TYPE_NUMBER };
              typeName = TYPE_NUMBER;
            } else if (schemaPart && schemaPart.type === 'object' && schemaPart.properties && schemaPart.properties[name]) {
              const prop = schemaPart.properties[name];
              schemaPart = schemaForProp(prop);
              typeName = schemaTypeOf(schemaPart);
            } else {
              // unknown prop
              schemaPart = null;
              typeName = TYPE_ANY;
            }
          }
          continue;
        }

        // Unknown token; stop
        break;
      }

      return { typeName: normalizeType(typeName), schemaPart };
    }

    // Detect callback parameter bindings (e.g., "data.map(x =>" binds x to array items)
    function findCallbackBindings(line, cursorCh) {
      const bindings = {}; // paramName -> { receiverChain, inferredType, schemaPart }
      
      // Look backwards on this line for "=>" (arrow function)
      const arrowPos = line.lastIndexOf('=>', cursorCh);
      if (arrowPos === -1) return bindings;
      
      // Extract parameter name before =>
      let paramEnd = arrowPos; // index of '=' in '=>'
      let paramStart = paramEnd;
      // Skip whitespace before =>
      while (paramStart > 0 && /[\\s]/.test(line[paramStart - 1])) {
        paramStart--;
      }
      // Extract raw parameter segment (supports a, (a), (a, i))
      while (paramStart > 0 && /[^\\s]/.test(line[paramStart - 1]) && line[paramStart - 1] !== '(') {
        paramStart--;
      }
      let rawParam = line.slice(paramStart, paramEnd).trim();
      // Strip wrapping parentheses like "(a)" or "(a, i)"
      if (rawParam.startsWith('(') && rawParam.endsWith(')')) {
        rawParam = rawParam.slice(1, -1).trim();
      }
      // Take first identifier as the callback param
      const idMatch = rawParam.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/);
      const paramName = idMatch ? idMatch[0] : '';
      if (!paramName) return bindings;
      
      // Find the method call before => (e.g., "data.items.map(" or "data.map(")
      const prefix = line.slice(0, arrowPos); // text before =>
      const arrayMethods = ['map', 'filter', 'find', 'findIndex', 'some', 'every', 'forEach', 'reduce', 'reduceRight', 'flatMap'];
      let bestIdx = -1;
      let methodName = '';
      for (const m of arrayMethods) {
        const idx = prefix.lastIndexOf('.' + m);
        if (idx !== -1 && idx > bestIdx) {
          bestIdx = idx;
          methodName = m;
        }
      }
      if (bestIdx === -1) return bindings;
      
      // Extract receiver chain (e.g., "data" or "data.items")
      const beforeMethod = prefix.slice(0, bestIdx);
      const rcMatch = beforeMethod.match(/([a-zA-Z0-9_$\\.\\[\\]]+)\\s*$/);
      const receiverChain = rcMatch ? rcMatch[1] : beforeMethod.trim();
      
      if (!receiverChain.startsWith('data')) return bindings;
      
      // Infer type of receiver, then get array items if it's an array
      const receiverInferred = inferTypeFromChain(receiverChain, {});
      if (receiverInferred.typeName === TYPE_ARRAY && receiverInferred.schemaPart && receiverInferred.schemaPart.items) {
        bindings[paramName] = {
          receiverChain: receiverChain,
          inferredType: schemaTypeOf(receiverInferred.schemaPart.items),
          schemaPart: receiverInferred.schemaPart.items
        };
      }
      
      return bindings;
    }

    function extractChainForAutocomplete(line, cursorCh) {
      // Walk backwards from cursor to find a chain containing identifiers, dots, [digits], and calls.
      // Supports args inside parentheses (e.g. endsWith('7')) by tracking paren depth.
      let start = cursorCh;
      let parenDepth = 0;
      while (start > 0) {
        const ch = line[start - 1];
        if (ch === ')') {
          parenDepth++;
          start--;
          continue;
        }
        if (ch === '(') {
          if (parenDepth > 0) {
            parenDepth--;
            start--;
            continue;
          }
          // At depth 0, '(' isn't part of the chain start.
          break;
        }
        if (parenDepth > 0) {
          // Inside call args: accept any chars.
          start--;
          continue;
        }
        if (/[a-zA-Z0-9_$\\.\\[\\]]/.test(ch)) {
          start--;
          continue;
        }
        break;
      }
      const fragment = line.slice(start, cursorCh);

      // Check if we're inside a callback (arrow function)
      const callbackBindings = findCallbackBindings(line, cursorCh);
      
      // Extract chain - could start with 'data' or a callback parameter
      let chain = null;
      let chainStartInLine = start;
      
      // First check for callback parameter (e.g., "a." or "x.name.")
      // Check each binding to see if fragment starts with that parameter name
      for (const [paramName, binding] of Object.entries(callbackBindings)) {
        // Check if fragment starts with paramName followed by . or [ or end
        if (fragment === paramName || 
            fragment.startsWith(paramName + '.') || 
            fragment.startsWith(paramName + '[')) {
          chain = fragment;
          chainStartInLine = start;
          break;
        }
        // Also check if there's a partial match (e.g., "a.n" when param is "a")
        const paramDotIdx = fragment.indexOf(paramName + '.');
        if (paramDotIdx !== -1) {
          chain = fragment.slice(paramDotIdx);
          chainStartInLine = start + paramDotIdx;
          break;
        }
      }
      
      // Fallback to 'data' chain
      if (!chain) {
        const idx = fragment.lastIndexOf('data');
        if (idx === -1) return null;
        chain = fragment.slice(idx);
        chainStartInLine = start + idx;
      }

      return {
        chain: chain,
        chainStartInLine: chainStartInLine,
        callbackBindings: callbackBindings
      };
    }
    
    function setupSchemaAutocomplete() {
      if (!editor || typeof CodeMirror === 'undefined') {
        return;
      }
      // show-hint attaches showHint() to the editor instance (cm)
      if (typeof editor.showHint !== 'function' && !(CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function')) {
        return;
      }
      
      editor.on('keyup', function(cm, e) {
        // Trigger autocomplete on typing dot, bracket, or after certain characters
        if (e.keyCode === 190 || e.keyCode === 219 || e.keyCode === 46) { // . or [ or .
          if (typeof cm.showHint === 'function') cm.showHint();
          else if (CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function') CodeMirror.commands.autocomplete(cm);
        }
      });
      
      editor.setOption('hintOptions', {
        hint: function(cm, options) {
          if (!currentSchema) return null;
          
          const cursor = cm.getCursor();
          const line = cm.getLine(cursor.line);
          const pos = cursor.ch;

          const extracted = extractChainForAutocomplete(line, pos);
          if (!extracted) return null;

          const chain = extracted.chain;
          const callbackBindings = extracted.callbackBindings || {};
          const endsWithDot = chain.endsWith('.');

          // For completion, infer the receiver type before the dot (or before the current word)
          let receiverChain = chain;
          if (!endsWithDot) {
            // remove current partial identifier
            receiverChain = chain.replace(/\\.[a-zA-Z_$][a-zA-Z0-9_$]*$/, '');
          }
          // if user is typing right after dot, keep as-is (endsWithDot true)
          receiverChain = receiverChain.replace(/\\.$/, '');

          const inferred = inferTypeFromChain(receiverChain, callbackBindings);
          const receiverType = normalizeType(inferred.typeName);

          let completions = [];
          if (receiverType === TYPE_OBJECT) {
            completions = buildObjectFieldCompletions(inferred.schemaPart);
            // also allow common object methods
            completions.push(...buildMethodCompletions(TYPE_OBJECT, inferred.schemaPart));
          } else if (receiverType === TYPE_ARRAY) {
            completions = buildMethodCompletions(TYPE_ARRAY, inferred.schemaPart);
          } else if (receiverType === TYPE_STRING) {
            completions = buildMethodCompletions(TYPE_STRING, inferred.schemaPart);
          } else if (receiverType === TYPE_NUMBER) {
            completions = buildMethodCompletions(TYPE_NUMBER, inferred.schemaPart);
          } else if (receiverType === TYPE_BOOLEAN) {
            completions = buildMethodCompletions(TYPE_BOOLEAN, inferred.schemaPart);
          } else {
            // unknown / any: give some safe defaults
            completions = [
              ...buildMethodCompletions(TYPE_OBJECT, inferred.schemaPart),
              ...buildMethodCompletions(TYPE_ARRAY, inferred.schemaPart),
              ...buildMethodCompletions(TYPE_STRING, inferred.schemaPart),
              ...buildMethodCompletions(TYPE_NUMBER, inferred.schemaPart)
            ];
          }

          // Normalize hint object shape for CodeMirror
          completions = completions.map(c => ({
            text: c.text,
            displayText: c.displayText || c.text,
            className: c.className
          }));

          if (completions.length === 0) return null;

          // Replace only the current identifier being typed (not the dot)
          let wordStart = pos;
          while (wordStart > 0 && /[a-zA-Z0-9_$]/.test(line[wordStart - 1])) {
            wordStart--;
          }
          const fromPos = endsWithDot ? pos : wordStart;
          const prefix = endsWithDot ? '' : line.slice(wordStart, pos);

          // Filter by prefix so e.g. ".m" only shows methods starting with "m"
          let filtered = completions;
          if (prefix) {
            filtered = completions.filter(c => typeof c.text === 'string' && c.text.startsWith(prefix));
          }
          if (filtered.length === 0) return null;

          return {
            list: filtered,
            from: CodeMirror.Pos(cursor.line, fromPos),
            to: CodeMirror.Pos(cursor.line, pos)
          };
        },
        completeSingle: false,
        closeOnUnfocus: true
      });
      
      // Enable autocomplete with Ctrl+Space
      editor.setOption('extraKeys', {
        ...editor.getOption('extraKeys'),
        'Ctrl-Space': function(cm) {
          if (typeof cm.showHint === 'function') cm.showHint();
          else if (CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function') CodeMirror.commands.autocomplete(cm);
        },
        'Cmd-Space': function(cm) {
          if (typeof cm.showHint === 'function') cm.showHint();
          else if (CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function') CodeMirror.commands.autocomplete(cm);
        }
      });
    }
    
    // Load CodeMirror and initialize editor
    loadCodeMirror()
      .then(() => {
        console.log('CodeMirror loaded successfully');
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initEditor, 100);
            setTimeout(initResultJsonEditor, 150);
          });
        } else {
          setTimeout(initEditor, 100);
          setTimeout(initResultJsonEditor, 150);
        }
      })
      .catch((err) => {
        console.error('Failed to load CodeMirror:', err);
        const errorMsg = 'CodeMirror failed to load. Check console for details. Using textarea fallback.';
        resultPre.textContent = errorMsg + ' Error: ' + (err.message || 'Unknown error');
        resultPre.className = 'error';
        // Fallback: keep using textarea and setup keyboard shortcuts
        setupKeyboardShortcuts();
        // Show textarea since CodeMirror failed
        if (exprTextarea) {
          exprTextarea.style.display = 'block';
          exprTextarea.style.visibility = 'visible';
          exprTextarea.style.position = 'static';
          exprTextarea.style.opacity = '1';
          exprTextarea.style.height = '200px';
          exprTextarea.style.width = '100%';
        }
      });

    // Load js-beautify in parallel (optional, beautifier will fallback if not available)
    loadJsBeautify()
      .then(() => {
        console.log('js-beautify loaded successfully');
      })
      .catch((err) => {
        console.warn('Failed to load js-beautify, will use simple beautifier:', err.message);
      });
    
    // Load acorn in parallel (best-effort; syntax validation will be skipped if it fails)
    loadAcorn()
      .then(() => {
        console.log('acorn loaded successfully');
        // Run an initial validation on whatever is in the editor once the parser is ready
        if (editor) {
          validateExpressionSyntax();
        }
      })
      .catch((err) => {
        console.warn('Failed to load acorn, syntax validation disabled:', err.message);
      });

    const getEditorValue = () => editor ? editor.getValue().trim() : (exprTextarea ? exprTextarea.value.trim() : '');
    const setEditorValue = (value) => {
      if (editor) {
        editor.setValue(value || '');
        editor.focus();
      } else if (exprTextarea) {
        exprTextarea.value = value || '';
        exprTextarea.focus();
      }
    };

    function setLoading(isLoading) {
      const runBtn = document.getElementById('run');
      if (isLoading) {
        runBtn.classList.add('loading');
        runBtn.disabled = true;
      } else {
        runBtn.classList.remove('loading');
        runBtn.disabled = false;
      }
    }
    
    function clearSyntaxError() {
      if (syntaxErrorMarker && editor) {
        syntaxErrorMarker.clear();
      }
      if (syntaxErrorWidget && editor) {
        editor.removeLineWidget(syntaxErrorWidget);
      }
      syntaxErrorMarker = null;
      syntaxErrorWidget = null;
    }
    
    function scheduleSyntaxValidation(delayMs) {
      if (!editor) return;
      const delay = typeof delayMs === 'number' ? delayMs : 200;
      if (syntaxValidationTimer) {
        clearTimeout(syntaxValidationTimer);
      }
      syntaxValidationTimer = setTimeout(() => {
        validateExpressionSyntax();
      }, delay);
    }
    
    function showSyntaxError(message, line, column) {
      if (!editor) return;
      clearSyntaxError();
      const lineIndex = Math.max(0, (line || 1) - 1);
      const ch = Math.max(0, column || 0);
      const from = { line: lineIndex, ch };
      const to = { line: lineIndex, ch: ch + 1 };
      syntaxErrorMarker = editor.markText(from, to, { className: 'cm-syntax-error' });
      const widgetNode = document.createElement('div');
      widgetNode.className = 'syntax-error-message';
      widgetNode.textContent = message + ' (' + (line || 1) + ':' + (ch + 1) + ')';
      syntaxErrorWidget = editor.addLineWidget(lineIndex, widgetNode, { above: false });
    }
    
    function validateExpressionSyntax() {
      const expr = getEditorValue();
      clearSyntaxError();
      if (!expr) return;
      if (typeof acorn === 'undefined' || !editor) return;
      try {
        acorn.parse(expr, {
          ecmaVersion: 'latest',
          locations: true,
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true
        });
      } catch (e) {
        const anyErr = e;
        const loc = anyErr && anyErr.loc;
        const msg = anyErr && anyErr.message ? String(anyErr.message) : 'Syntax error';
        const line = loc && typeof loc.line === 'number' ? loc.line : 1;
        const column = loc && typeof loc.column === 'number' ? loc.column : 0;
        showSyntaxError(msg, line, column);
      }
    }
    
    function runExpression() {
      const expr = getEditorValue();
      if (!expr) {
        resultPre.textContent = 'Error: Expression is empty';
        resultPre.className = 'error';
        return;
      }
      
      // Re-validate syntax before running; if there's a syntax error, surface it instead of sending to host
      if (typeof acorn !== 'undefined') {
        clearSyntaxError();
        try {
          acorn.parse(expr, {
            ecmaVersion: 'latest',
            locations: true,
            allowReturnOutsideFunction: true,
            allowAwaitOutsideFunction: true
          });
        } catch (e) {
          const anyErr = e;
          const loc = anyErr && anyErr.loc;
          const msg = anyErr && anyErr.message ? String(anyErr.message) : 'Syntax error';
          const line = loc && typeof loc.line === 'number' ? loc.line : 1;
          const column = loc && typeof loc.column === 'number' ? loc.column : 0;
          showSyntaxError(msg, line, column);
          resultPre.textContent = 'Syntax error: ' + msg + ' (' + line + ':' + (column + 1) + ')';
          resultPre.className = 'error';
          return;
        }
      }
      
      setLoading(true);
      resultPre.textContent = 'Running...';
      resultPre.className = '';
      vscode.postMessage({ type: 'run', expr, save: true });
    }

    function saveExpression() {
      const expr = getEditorValue();
      if (!expr) {
        return;
      }
      vscode.postMessage({ type: 'save', expr });
      // Visual feedback
      const saveBtn = document.getElementById('save');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ Saved';
      setTimeout(() => {
        saveBtn.textContent = originalText;
      }, 1500);
    }

    function beautifyExpression() {
      const expr = getEditorValue();
      if (!expr) return;
      
      try {
        let formatted;
        
        // Use js-beautify if available, otherwise fallback to simple beautifier
        if (beautifyReady && typeof js_beautify !== 'undefined') {
          formatted = js_beautify(expr, {
            indent_size: 2,
            indent_char: ' ',
            preserve_newlines: true,
            max_preserve_newlines: 2,
            jslint_happy: false,
            space_after_anon_function: false,
            space_before_conditional: true,
            unescape_strings: false,
            wrap_line_length: 0,
            e4x: false
          });
          console.log('Formatted with js-beautify');
        } else {
          console.warn('js-beautify not available, using simple beautifier');
          formatted = simpleBeautify(expr);
        }
        
        setEditorValue(formatted);
        if (editor) editor.focus();
        
        const beautifyBtn = document.getElementById('beautify');
        const originalText = beautifyBtn.textContent;
        beautifyBtn.textContent = '✓ Beautified';
        setTimeout(() => {
          beautifyBtn.textContent = originalText;
        }, 1500);
      } catch (e) {
        console.error('Beautify error:', e);
        throw new Error('Beautify failed: ' + String(e));
      }
    }

    function simpleBeautify(code) {
      let indent = 0;
      let result = '';
      let i = 0;
      const indentStr = '  ';
      
      while (i < code.length) {
        const char = code[i];
        const nextChar = code[i + 1];
        
        // Skip string literals (double quote, single quote, backtick template)
        if (char === '"' || char === "'" || char === '\`') {
          const quote = char;
          result += quote;
          i++;
          while (i < code.length) {
            const c = code[i];
            result += c;
            if (c === '\\\\') {
              i++;
              if (i < code.length) {
                result += code[i];
              }
            } else if (c === quote) {
              break;
            }
            i++;
          }
          i++;
          continue;
        }

        // Skip single-line comments
        if (char === '/' && nextChar === '/') {
          while (i < code.length && code[i] !== '\\n') {
            result += code[i];
            i++;
          }
          continue;
        }

        // Skip multi-line comments
        if (char === '/' && nextChar === '*') {
          result += '/*';
          i += 2;
          while (i < code.length) {
            if (code[i] === '*' && code[i + 1] === '/') {
              result += '*/';
              i += 2;
              break;
            }
            result += code[i];
            i++;
          }
          continue;
        }
        
        if (char === '{' || char === '[') {
          result += char + '\\n';
          indent++;
          result += indentStr.repeat(indent);
          i++;
          // Skip whitespace after bracket
          while (code[i] === ' ' || code[i] === '\\t') i++;
          continue;
        } else if (char === '}' || char === ']') {
          if (result.endsWith(' ') || result.endsWith('\\t')) {
            result = result.trimEnd();
          }
          if (!result.endsWith('\\n')) result += '\\n';
          indent = Math.max(0, indent - 1);
          result += indentStr.repeat(indent);
          result += char;
          i++;
          // Check for comma after bracket
          if (code[i] === ',') {
            result += ',';
            i++;
          }
          if (i < code.length && code[i] !== '}' && code[i] !== ']') {
            result += '\\n';
            if (i < code.length && code[i] !== ' ' && code[i] !== '\\t') {
              result += indentStr.repeat(indent);
            }
          }
          continue;
        } else if (char === ',') {
          result += char + '\\n' + indentStr.repeat(indent);
          i++;
          // Skip whitespace after comma
          while (code[i] === ' ' || code[i] === '\\t') i++;
          continue;
        } else if (char === ':' && (result.includes('{') || result.includes('['))) {
          result += ': ';
          i++;
          // Skip whitespace after colon
          while (code[i] === ' ' || code[i] === '\\t') i++;
          continue;
        }
        
        result += char;
        i++;
      }
      
      return result;
    }

    document.getElementById('boundFilesContainer').addEventListener('click', (e) => {
      const target = e.target;
      if (target.id === 'addFile') {
        vscode.postMessage({ type: 'addFile' });
      } else if (target.id === 'addUrl') {
        openUrlModal();
      } else if (target.classList && (target.classList.contains('remove-file') || target.classList.contains('remove-source'))) {
        const span = target.closest('.bound-file');
        const alias = span?.getAttribute('data-alias');
        const id = span?.getAttribute('data-id');
        vscode.postMessage({ type: 'removeSource', alias, id });
      } else if (target.classList && target.classList.contains('refresh-url-btn')) {
        const id = target.getAttribute('data-id');
        if (id) {
          vscode.postMessage({ type: 'refreshUrlSource', id });
        }
      } else if (target.classList && target.classList.contains('edit-url-btn')) {
        const id = target.getAttribute('data-id');
        const src = currentSources.find(s => s.id === id);
        if (src) {
          openUrlModal(src);
        }
      } else if (target.classList && target.classList.contains('copy-url-curl-btn')) {
        const id = target.getAttribute('data-id');
        const src = (currentSources || []).find(s => s.id === id);
        if (src) {
          const curlCmd = generateCurl({
            url: src.url || '',
            method: src.method || 'GET',
            headers: src.headers,
            body: src.body
          });
          vscode.postMessage({ type: 'copyToClipboard', text: curlCmd });
          const originalText = target.textContent;
          target.textContent = '✓';
          setTimeout(() => {
            target.textContent = originalText;
          }, 1500);
        }
      } else if (target.classList && target.classList.contains('inspect-source-btn')) {
        const id = target.getAttribute('data-id');
        const alias = target.getAttribute('data-alias') || target.closest('.bound-file')?.getAttribute('data-alias');
        vscode.postMessage({ type: 'inspectSource', id, alias });
      }
    });


    document.getElementById('run').onclick = runExpression;
    document.getElementById('save').onclick = saveExpression;
    document.getElementById('clear').onclick = () => {
      setEditorValue('');
      if (editor) editor.focus();
    };
    document.getElementById('beautify').onclick = () => {
      beautifyExpression();
    };
    document.getElementById('importQuery').onclick = () => {
      vscode.postMessage({ type: 'importQuery' });
    };
    document.getElementById('exportQuery').onclick = () => {
      vscode.postMessage({ type: 'exportQuery', expr: getEditorValue() });
    };
    rebindBtn.onclick = () => vscode.postMessage({ type: 'rebind' });
    const scratchpadBtn = document.getElementById('scratchpadBtn');
    if (scratchpadBtn) {
      scratchpadBtn.onclick = () => vscode.postMessage({ type: 'switchToScratchpad' });
    }
    function escapeCsvCell(val) {
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      const nl = String.fromCharCode(10);
      const cr = String.fromCharCode(13);
      if (str.includes(',') || str.includes('"') || str.includes(nl) || str.includes(cr)) {
        return '"' + str.split('"').join('""') + '"';
      }
      return str;
    }

    function generateCsv(data) {
      if (!Array.isArray(data) || data.length === 0) {
        if (resultTableHead && resultTableBody) {
          const rows = [];
          const headerCells = Array.from(resultTableHead.querySelectorAll('th')).map(function(th) {
            return escapeCsvCell(th.textContent);
          });
          if (headerCells.length > 0) rows.push(headerCells.join(','));
          Array.from(resultTableBody.querySelectorAll('tr')).forEach(function(tr) {
            const cells = Array.from(tr.querySelectorAll('td')).map(function(td) {
              return escapeCsvCell(td.textContent);
            });
            rows.push(cells.join(','));
          });
          return rows.join(String.fromCharCode(10));
        }
        return '';
      }

      var hasObjects = false;
      var allKeys = new Set();
      for (var checkIdx = 0; checkIdx < data.length; checkIdx++) {
        var checkItem = data[checkIdx];
        if (typeof checkItem === 'object' && checkItem !== null && !Array.isArray(checkItem)) {
          hasObjects = true;
          var itemKeys = Object.keys(checkItem);
          for (var keyIdx = 0; keyIdx < itemKeys.length; keyIdx++) {
            allKeys.add(itemKeys[keyIdx]);
          }
        }
      }

      var rows = [];
      if (hasObjects && allKeys.size > 0) {
        var keys = Array.from(allKeys);
        rows.push(keys.map(escapeCsvCell).join(','));
        for (var j = 0; j < data.length; j++) {
          var item = data[j];
          var row = [];
          for (var k = 0; k < keys.length; k++) {
            var val = item && typeof item === 'object' ? item[keys[k]] : '';
            row.push(escapeCsvCell(val));
          }
          rows.push(row.join(','));
        }
      } else {
        // Array of primitives
        rows.push('Value');
        for (var j = 0; j < data.length; j++) {
          rows.push(escapeCsvCell(data[j]));
        }
      }
      return rows.join(String.fromCharCode(10));
    }

    function escapeXml(str) {
      return str.replace(/[&<>"']/g, function(ch) {
        if (ch === '&') return '&amp;';
        if (ch === '<') return '&lt;';
        if (ch === '>') return '&gt;';
        if (ch === '"') return '&quot;';
        if (ch === "'") return '&apos;';
        return ch;
      });
    }

    function sanitizeXmlTagName(key) {
      if (!key || typeof key !== 'string') return 'item';
      var tag = key.trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (/^[0-9.-]/.test(tag)) {
        tag = '_' + tag;
      }
      return tag || 'item';
    }

    function generateXml(data, rootTag) {
      rootTag = rootTag || 'root';
      var safeRoot = sanitizeXmlTagName(rootTag);
      var visited = new WeakSet();

      function serializeNode(val, tag, depth) {
        var spaces = '  '.repeat(depth);
        var safeTag = sanitizeXmlTagName(tag);

        if (val === null || val === undefined) {
          return spaces + '<' + safeTag + ' />';
        }

        if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'bigint') {
          return spaces + '<' + safeTag + '>' + val + '</' + safeTag + '>';
        }

        if (typeof val === 'string') {
          return spaces + '<' + safeTag + '>' + escapeXml(val) + '</' + safeTag + '>';
        }

        if (typeof val === 'object') {
          if (visited.has(val)) {
            return spaces + '<' + safeTag + '>[Circular]</' + safeTag + '>';
          }
          visited.add(val);

          if (Array.isArray(val)) {
            if (val.length === 0) return spaces + '<' + safeTag + ' />';
            var arrLines = [];
            for (var i = 0; i < val.length; i++) {
              arrLines.push(serializeNode(val[i], 'item', depth));
            }
            return arrLines.join('\\n');
          }

          var entries = Object.entries(val);
          if (entries.length === 0) return spaces + '<' + safeTag + ' />';

          var innerLines = [];
          for (var e = 0; e < entries.length; e++) {
            var k = entries[e][0];
            var v = entries[e][1];
            if (Array.isArray(v)) {
              var itemTag = sanitizeXmlTagName(k);
              if (v.length === 0) {
                innerLines.push(spaces + '  <' + itemTag + ' />');
              } else {
                for (var j = 0; j < v.length; j++) {
                  innerLines.push(serializeNode(v[j], itemTag, depth + 1));
                }
              }
            } else {
              innerLines.push(serializeNode(v, k, depth + 1));
            }
          }
          return spaces + '<' + safeTag + '>\\n' + innerLines.join('\\n') + '\\n' + spaces + '</' + safeTag + '>';
        }

        return spaces + '<' + safeTag + '>' + escapeXml(String(val)) + '</' + safeTag + '>';
      }

      var body = '';
      if (Array.isArray(data)) {
        if (data.length === 0) {
          body = '<' + safeRoot + ' />';
        } else {
          var items = data.map(function(item) {
            return serializeNode(item, 'item', 1);
          }).join('\\n');
          body = '<' + safeRoot + '>\\n' + items + '\\n</' + safeRoot + '>';
        }
      } else if (typeof data === 'object' && data !== null) {
        body = serializeNode(data, safeRoot, 0);
      } else {
        body = '<' + safeRoot + '>' + (data !== null && data !== undefined ? escapeXml(String(data)) : '') + '</' + safeRoot + '>';
      }

      return '<?xml version="1.0" encoding="UTF-8"?>\\n' + body;
    }

    function generateNdjson(data) {
      function replacer(_k, v) {
        return typeof v === 'bigint' ? v.toString() : v;
      }
      if (Array.isArray(data)) {
        if (data.length === 0) return '';
        return data.map(function(item) {
          return JSON.stringify(item, replacer);
        }).join('\\n');
      }
      if (data === undefined || data === null) return '';
      return JSON.stringify(data, replacer);
    }

    function generateYaml(data, indent) {
      indent = indent || 2;
      var visited = new WeakSet();

      function formatString(str) {
        if (str === '') return '""';
        var needsQuotes =
          /[\\n\\r\\t:#@%&*?|>{}\\[\\],]/.test(str) ||
          /^[-?]/.test(str) ||
          /^\\s|\\s$/.test(str) ||
          /^(true|false|null|yes|no|on|off|\\.nan|\\.inf)$/i.test(str) ||
          !isNaN(Number(str));
        if (needsQuotes) {
          return JSON.stringify(str);
        }
        return str;
      }

      function formatKey(key) {
        if (/^[a-zA-Z0-9_.-]+$/.test(key) && !/^(true|false|null)$/i.test(key)) {
          return key;
        }
        return JSON.stringify(key);
      }

      function serialize(val, depth) {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (typeof val === 'number') {
          if (isNaN(val)) return '.nan';
          if (!isFinite(val)) return val > 0 ? '.inf' : '-.inf';
          return String(val);
        }
        if (typeof val === 'bigint') return val.toString();
        if (typeof val === 'string') return formatString(val);

        if (typeof val === 'object') {
          if (visited.has(val)) return '"[Circular]"';
          visited.add(val);

          var spaces = ' '.repeat(depth * indent);

          if (Array.isArray(val)) {
            if (val.length === 0) return '[]';
            var lines = [];
            for (var i = 0; i < val.length; i++) {
              var item = val[i];
              if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                var keys = Object.keys(item);
                if (keys.length === 0) {
                  lines.push(spaces + '- {}');
                } else {
                  var firstKey = keys[0];
                  var firstVal = serialize(item[firstKey], depth + 1);
                  var isFirstComplex = typeof item[firstKey] === 'object' && item[firstKey] !== null;

                  if (isFirstComplex && !firstVal.startsWith('[]') && !firstVal.startsWith('{}') && !firstVal.startsWith('"[Circular]"')) {
                    lines.push(spaces + '- ' + formatKey(firstKey) + ':\\n' + firstVal);
                  } else {
                    lines.push(spaces + '- ' + formatKey(firstKey) + ': ' + firstVal);
                  }

                  for (var k = 1; k < keys.length; k++) {
                    var subKey = keys[k];
                    var subVal = serialize(item[subKey], depth + 1);
                    var isSubComplex = typeof item[subKey] === 'object' && item[subKey] !== null;
                    var subIndent = ' '.repeat(depth * indent + 2);
                    if (isSubComplex && !subVal.startsWith('[]') && !subVal.startsWith('{}') && !subVal.startsWith('"[Circular]"')) {
                      lines.push(subIndent + formatKey(subKey) + ':\\n' + subVal);
                    } else {
                      lines.push(subIndent + formatKey(subKey) + ': ' + subVal);
                    }
                  }
                }
              } else {
                var itemVal = serialize(item, depth + 1);
                lines.push(spaces + '- ' + itemVal);
              }
            }
            return lines.join('\\n');
          }

          var entries = Object.entries(val);
          if (entries.length === 0) return '{}';

          var objLines = [];
          for (var eIdx = 0; eIdx < entries.length; eIdx++) {
            var entKey = entries[eIdx][0];
            var entVal = entries[eIdx][1];
            var formattedKey = formatKey(entKey);
            var serializedVal = serialize(entVal, depth + 1);
            var isComplex = typeof entVal === 'object' && entVal !== null;

            if (isComplex && !serializedVal.startsWith('[]') && !serializedVal.startsWith('{}') && !serializedVal.startsWith('"[Circular]"')) {
              objLines.push(spaces + formattedKey + ':\\n' + serializedVal);
            } else {
              objLines.push(spaces + formattedKey + ': ' + serializedVal);
            }
          }
          return objLines.join('\\n');
        }

        return String(val);
      }

      return serialize(data, 0);
    }

    function formatResultData(data, format) {
      var fmt = (format || 'json').toLowerCase();
      if (fmt === 'csv') return generateCsv(data);
      if (fmt === 'yaml' || fmt === 'yml') return generateYaml(data);
      if (fmt === 'ndjson' || fmt === 'jsonl') return generateNdjson(data);
      if (fmt === 'xml') return generateXml(data);
      try {
        return JSON.stringify(data, function(_k, v) {
          return typeof v === 'bigint' ? v.toString() : v;
        }, 2);
      } catch (e) {
        return String(data);
      }
    }

    copyResultBtn.onclick = () => {
      let text = '';
      const dataToUse = currentResultData !== null && currentResultData !== undefined 
        ? currentResultData 
        : (streamingData && streamingData.length > 0 ? streamingData : null);
      const fmt = resultFormat ? resultFormat.value : 'json';

      if (resultTable && resultTable.style.display === 'table') {
        text = generateCsv(dataToUse);
      } else if (fmt === 'yaml' && dataToUse !== null && dataToUse !== undefined) {
        text = generateYaml(dataToUse);
      } else if (fmt === 'ndjson' && dataToUse !== null && dataToUse !== undefined) {
        text = generateNdjson(dataToUse);
      } else if (fmt === 'xml' && dataToUse !== null && dataToUse !== undefined) {
        text = generateXml(dataToUse);
      } else if (resultJsonEditor && resultJsonEditorWrapper && resultJsonEditorWrapper.style.display !== 'none') {
        text = resultJsonEditor.getValue();
      } else if (currentResultData !== null && currentResultData !== undefined) {
        try {
          text = typeof currentResultData === 'string' ? currentResultData : JSON.stringify(currentResultData, null, 2);
        } catch (e) {
          text = String(currentResultData);
        }
      } else {
        text = resultPre ? (resultPre.textContent || '') : '';
      }
      
      if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
        vscode.postMessage({ type: 'copyToClipboard', text });
        const originalText = copyResultBtn.textContent;
        copyResultBtn.textContent = '✓ Copied';
        setTimeout(() => {
          copyResultBtn.textContent = originalText;
        }, 1500);
      }
    };

    const openResultInEditorBtn = document.getElementById('openResultInEditorBtn');
    if (openResultInEditorBtn) {
      openResultInEditorBtn.onclick = () => {
        let text = '';
        let language = 'json';
        const dataToUse = currentResultData !== null && currentResultData !== undefined 
          ? currentResultData 
          : (streamingData && streamingData.length > 0 ? streamingData : null);
        const fmt = resultFormat ? resultFormat.value : 'json';

        if (resultTable && resultTable.style.display === 'table') {
          text = generateCsv(dataToUse);
          language = 'csv';
        } else if (fmt === 'yaml' && dataToUse !== null && dataToUse !== undefined) {
          text = generateYaml(dataToUse);
          language = 'yaml';
        } else if (fmt === 'ndjson' && dataToUse !== null && dataToUse !== undefined) {
          text = generateNdjson(dataToUse);
          language = 'jsonl';
        } else if (fmt === 'xml' && dataToUse !== null && dataToUse !== undefined) {
          text = generateXml(dataToUse);
          language = 'xml';
        } else if (resultJsonEditor && resultJsonEditorWrapper && resultJsonEditorWrapper.style.display !== 'none') {
          text = resultJsonEditor.getValue();
          language = 'json';
        } else if (currentResultData !== null && currentResultData !== undefined) {
          try {
            text = typeof currentResultData === 'string' ? currentResultData : JSON.stringify(currentResultData, null, 2);
          } catch (e) {
            text = String(currentResultData);
          }
          language = 'json';
        } else {
          text = resultPre ? (resultPre.textContent || '') : '';
          language = 'json';
        }
        if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
          vscode.postMessage({ type: 'openInEditor', text, language });
        }
      };
    };

    // Setup keyboard shortcuts after editor is initialized
    function setupKeyboardShortcuts() {
      if (editor) {
        // Helper to wrap current selection(s) with given characters.
        // If nothing is selected, fall back to default CodeMirror behavior.
        function makeWrapHandler(openChar, closeChar) {
          return function(cm) {
            if (!cm.somethingSelected()) {
              // Let CodeMirror handle the key normally (insert character, etc.)
              // Use CodeMirror.Pass when available so the key falls through.
              if (typeof CodeMirror !== 'undefined' && CodeMirror.Pass) {
                return CodeMirror.Pass;
              }
              return undefined;
            }

            const selections = cm.getSelections();
            const wrapped = selections.map((sel) => openChar + sel + closeChar);
            cm.replaceSelections(wrapped, 'around');
            return false;
          };
        }

        // Ctrl+D / Cmd+D: Select next occurrence (like VS Code)
        function selectNextOccurrence(cm) {
          const doc = cm.getDoc();
          const Pos = CodeMirror.Pos || function(line, ch) { return { line: line, ch: ch }; };
          const cmpPos = CodeMirror.cmpPos || function(a, b) {
            if (a.line !== b.line) return a.line - b.line;
            return a.ch - b.ch;
          };
          
          // If nothing is selected, select the word at cursor
          if (!cm.somethingSelected()) {
            const cursor = cm.getCursor();
            const wordRange = cm.findWordAt(cursor);
            if (wordRange) {
              cm.setSelection(wordRange.anchor, wordRange.head);
            }
            return false;
          }

          const selections = cm.listSelections();
          if (selections.length === 0) {
            return false;
          }

          // Get the primary selection and normalize direction (anchor/head order depends on drag direction)
          const primarySel = selections[0];
          const primaryFrom = cmpPos(primarySel.anchor, primarySel.head) <= 0 ? primarySel.anchor : primarySel.head;
          const primaryTo = cmpPos(primarySel.anchor, primarySel.head) <= 0 ? primarySel.head : primarySel.anchor;

          // Always use normalized range so getRange works when user selected backwards (right-to-left)
          const searchText = doc.getRange(primaryFrom, primaryTo);
          
          if (!searchText || searchText.length === 0) {
            return false;
          }

          // Find all matches by searching line by line
          const allMatches = [];
          const lineCount = doc.lineCount();
          
          for (let lineNum = 0; lineNum < lineCount; lineNum++) {
            const lineText = doc.getLine(lineNum);
            let searchStart = 0;
            
            while (true) {
              const foundIndex = lineText.indexOf(searchText, searchStart);
              if (foundIndex === -1) break;
              
              const matchFrom = Pos(lineNum, foundIndex);
              const matchTo = Pos(lineNum, foundIndex + searchText.length);
              allMatches.push({ from: matchFrom, to: matchTo });
              
              searchStart = foundIndex + 1;
            }
          }

          if (allMatches.length === 0) {
            return false;
          }

          // Check if a match is already selected (exact match only)
          function isAlreadySelected(match) {
            for (let i = 0; i < selections.length; i++) {
              const sel = selections[i];
              const selFrom = cmpPos(sel.anchor, sel.head) <= 0 ? sel.anchor : sel.head;
              const selTo = cmpPos(sel.anchor, sel.head) <= 0 ? sel.head : sel.anchor;
              
              // Check if match exactly matches this selection
              if (cmpPos(match.from, selFrom) === 0 && cmpPos(match.to, selTo) === 0) {
                return true;
              }
            }
            return false;
          }

          // Filter out already-selected matches
          const availableMatches = [];
          for (let i = 0; i < allMatches.length; i++) {
            const match = allMatches[i];
            if (!isAlreadySelected(match)) {
              availableMatches.push(match);
            }
          }

          if (availableMatches.length === 0) {
            return false;
          }

          // Sort matches by position
          availableMatches.sort(function(a, b) {
            const cmp = cmpPos(a.from, b.from);
            if (cmp !== 0) return cmp;
            return cmpPos(a.to, b.to);
          });

          // Find the first match that starts after the primary selection ends
          let nextMatch = null;
          for (let i = 0; i < availableMatches.length; i++) {
            const match = availableMatches[i];
            if (cmpPos(match.from, primaryTo) > 0) {
              nextMatch = match;
              break;
            }
          }

          // If no match found after primary selection, wrap around to the first available match
          if (!nextMatch) {
            nextMatch = availableMatches[0];
          }

          // Add the new selection
          const newSelections = selections.slice();
          newSelections.push({
            anchor: nextMatch.from,
            head: nextMatch.to
          });

          cm.setSelections(newSelections);
          return false;
        }

        editor.setOption('extraKeys', {
          'Ctrl-Enter': () => { runExpression(); return false; },
          'Cmd-Enter': () => { runExpression(); return false; },
          'Ctrl-S': (cm) => { saveExpression(); return false; },
          'Cmd-S': (cm) => { saveExpression(); return false; },
          // Toggle line comments in the embedded CodeMirror editor
          'Ctrl-/': (cm) => { cm.execCommand('toggleComment'); return false; },
          'Cmd-/': (cm) => { cm.execCommand('toggleComment'); return false; },
          // Select next occurrence (like VS Code)
          'Ctrl-D': selectNextOccurrence,
          'Cmd-D': selectNextOccurrence,
          // Wrap selected text when typing open brackets / parens.
          // Note: some of these require Shift and thus use the underlying key names.
          '[': makeWrapHandler('[', ']'),        // '[' key
          'Shift-9': makeWrapHandler('(', ')'),  // '(' => Shift+9
          'Shift-[': makeWrapHandler('{', '}'),  // '{' => Shift+[
          'Shift-,': makeWrapHandler('<', '>')   // '<' => Shift+,
        });
      } else if (exprTextarea) {
        // Also add keyboard shortcuts for textarea fallback
        exprTextarea.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            runExpression();
          } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveExpression();
          }
        });
      }
    }
    
    // Focus editor on load
    setTimeout(() => {
      if (editor) {
        editor.focus();
      } else if (exprTextarea) {
        exprTextarea.focus();
        setupKeyboardShortcuts();
      }
    }, 400);

    // Security warning banner buttons (set up once)
    const securityBanner = document.getElementById('securityWarning');
    document.getElementById('runAnyway').addEventListener('click', () => {
      if (securityBanner) securityBanner.style.display = 'none';
      vscode.postMessage({ type: 'runConfirmed', expr: editor ? editor.getValue() : exprTextarea.value, save: false });
    });
    document.getElementById('dismissWarning').addEventListener('click', () => {
      if (securityBanner) securityBanner.style.display = 'none';
      setLoading(false);
      resultPre.textContent = 'Canceled by user';
      resultPre.className = '';
      resultPre.style.display = 'block';
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateTargets') {
        if (msg.sources) {
          renderSources(msg.sources);
        } else if (msg.boundFiles) {
          renderSources(msg.boundFiles.map(function(f) { return { type: 'file', alias: f.alias, label: f.label }; }));
        }
      } else if (msg.type === 'urlSourceSuccess') {
        closeUrlModal();
      } else if (msg.type === 'urlSourceError') {
        showUrlModalAlert(msg.error || 'Failed to fetch URL source.');
        setModalLoading(false);
      } else if (msg.type === 'urlPreviewResult') {
        renderUrlPreview(msg.details);
      } else if (msg.type === 'urlPreviewError') {
        renderUrlPreviewError(msg.error);
      } else if (msg.type === 'showSourceInspection') {
        openSourceInspectModal(msg.source, msg.data);
      } else if (msg.type === 'hydrate') {
        renderList(msg.history || []);
      } else if (msg.type === 'schema') {
        currentSchema = msg.schema || null;
        // Re-setup autocomplete if editor is already initialized
        if (editor) {
          setupSchemaAutocomplete();
        }
      } else if (msg.type === 'insert') {
        hideAiAlert();
        setEditorValue(msg.expr || '');
        const aiBtn = document.getElementById('aiGenerate');
        if (aiBtn) {
          aiBtn.disabled = false;
          aiBtn.textContent = 'Generate';
        }
      } else if (msg.type === 'aiError') {
        const aiBtn = document.getElementById('aiGenerate');
        if (aiBtn) {
          aiBtn.disabled = false;
          aiBtn.textContent = 'Generate';
        }
        if (msg.error) {
          showAiAlert('AI Generation Error: ' + msg.error);
        }
      } else if (msg.type === 'hydrateAiApiKey') {
        if (aiApiKey && msg.apiKey && !aiApiKey.value) {
          aiApiKey.value = msg.apiKey;
        }
      } else if (msg.type === 'securityWarning') {
        const banner = document.getElementById('securityWarning');
        const msgEl = document.getElementById('securityWarningMessage');
        if (banner && msgEl) {
          msgEl.textContent = msg.warning;
          banner.style.display = 'block';
        }
      } else if (msg.type === 'status') {
        // could show status text
      } else if (msg.type === 'result') {
        if (streamingRafId) {
          cancelAnimationFrame(streamingRafId);
          streamingRafId = null;
        }
        setLoading(false);
        streamingIsActive = false;
        tableCurrentPage = 1;
        if (msg.error) {
          resultPre.textContent = 'Error: ' + String(msg.error);
          resultPre.className = 'error';
          resultPre.style.display = 'block';
          hideTable();
          resultChartContainer.style.display = 'none';
          resultInfo.textContent = '';
          currentResultData = null;
        } else {
          currentResultData = msg.data || null;
          updateResultDisplay(msg.text ?? '', msg.data);
        }
      } else if (msg.type === 'resultStart') {
        // Initialize streaming
        if (streamingRafId) {
          cancelAnimationFrame(streamingRafId);
          streamingRafId = null;
        }
        setLoading(true);
        streamingIsActive = true;
        streamingData = [];
        streamingTotalItems = msg.totalItems || 0;
        streamingReceivedItems = 0;
        currentResultData = null;
        tableCurrentPage = 1;
        
        // Show initial loading state
        resultPre.textContent = 'Loading... (0/' + streamingTotalItems + ' items)';
        resultPre.className = '';
        resultPre.style.display = 'block';
        hideTable();
        resultChartContainer.style.display = 'none';
        resultInfo.textContent = 'Streaming ' + streamingTotalItems + ' items...';
      } else if (msg.type === 'resultChunk') {
        // Add chunk to streaming data
        if (!streamingData) streamingData = [];
        streamingData.push(...msg.chunk);
        streamingReceivedItems = msg.chunkEnd || streamingData.length;
        
        // Progressive UI rendering via requestAnimationFrame to avoid unnecessary reflows
        const renderProgress = () => {
          const progress = streamingTotalItems > 0
            ? Math.round((streamingReceivedItems / streamingTotalItems) * 100)
            : 100;
          resultInfo.textContent = 'Streaming... ' + streamingReceivedItems + '/' + streamingTotalItems + ' items (' + progress + '%)';
          
          if (resultFormat.value === 'table' && streamingData && streamingData.length > 0) {
            updateResultDisplay('', streamingData, true); // true = isStreaming
          } else if (resultFormat.value === 'json') {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items, ' + progress + '%)';
            resultPre.className = '';
            resultPre.style.display = 'block';
            if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
            hideTable();
            resultChartContainer.style.display = 'none';
          } else {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items)';
          }
        };

        if (typeof requestAnimationFrame === 'function') {
          if (!streamingRafId) {
            streamingRafId = requestAnimationFrame(() => {
              streamingRafId = null;
              if (streamingIsActive && streamingData) {
                renderProgress();
              }
            });
          }
        } else {
          renderProgress();
        }
      } else if (msg.type === 'resultComplete') {
        // Finalize streaming
        if (streamingRafId) {
          cancelAnimationFrame(streamingRafId);
          streamingRafId = null;
        }
        setLoading(false);
        streamingIsActive = false;
        currentResultData = msg.data || streamingData || null;
        streamingData = null;
        updateResultDisplay(msg.text ?? '', currentResultData);
      } else if (msg.type === 'updateModels') {
        aiModel.innerHTML = '<option value="" disabled selected>Select Model...</option>';
        if (msg.models && msg.models.length > 0) {
            hideAiAlert();
            msg.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                aiModel.appendChild(opt);
            });
            // Try to restore selection
            const savedModel = localStorage.getItem('jsonQueryTools.aiModel');
            if (savedModel && msg.models.includes(savedModel)) {
                aiModel.value = savedModel;
            } else {
                aiModel.value = msg.models[0];
            }
        }
        if (msg.error) {
            console.error('Failed to fetch models:', msg.error);
            showAiAlert('Failed to fetch models: ' + msg.error);
        }
      }
    });

    function renderTablePage() {
      if (!currentTableData || !Array.isArray(currentTableData)) {
        hideTable();
        return;
      }

      if (currentTableData.length === 0) {
        resultTableHead.innerHTML = '<tr><th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">Value</th></tr>';
        resultTableBody.innerHTML = '<tr><td style="padding: 8px 12px; color: var(--vscode-descriptionForeground, #858585);">(empty array)</td></tr>';
        if (tablePageInfo) tablePageInfo.textContent = 'Showing 0–0 of 0 rows';
        if (tableTotalPages) tableTotalPages.textContent = '1';
        if (tablePageInput) tablePageInput.value = 1;
        if (tableFirstPage) tableFirstPage.disabled = true;
        if (tablePrevPage) tablePrevPage.disabled = true;
        if (tableNextPage) tableNextPage.disabled = true;
        if (tableLastPage) tableLastPage.disabled = true;
        return;
      }

      const totalRows = currentTableData.length;
      const totalPages = Math.max(1, Math.ceil(totalRows / currentTablePageSize));

      if (tableCurrentPage > totalPages) {
        tableCurrentPage = totalPages;
      }
      if (tableCurrentPage < 1) {
        tableCurrentPage = 1;
      }

      const startIdx = (tableCurrentPage - 1) * currentTablePageSize;
      const endIdx = Math.min(startIdx + currentTablePageSize, totalRows);
      const pageRows = currentTableData.slice(startIdx, endIdx);

      if (tablePageInfo) {
        tablePageInfo.textContent = 'Showing ' + (startIdx + 1) + '–' + endIdx + ' of ' + totalRows.toLocaleString() + ' rows';
      }
      if (tablePageInput) {
        tablePageInput.value = tableCurrentPage;
        tablePageInput.max = totalPages;
      }
      if (tableTotalPages) {
        tableTotalPages.textContent = totalPages;
      }
      if (tableFirstPage) tableFirstPage.disabled = tableCurrentPage <= 1;
      if (tablePrevPage) tablePrevPage.disabled = tableCurrentPage <= 1;
      if (tableNextPage) tableNextPage.disabled = tableCurrentPage >= totalPages;
      if (tableLastPage) tableLastPage.disabled = tableCurrentPage >= totalPages;

      var hasObjects = false;
      var allKeys = new Set();
      var checkLimit = Math.min(500, currentTableData.length);
      for (var checkIdx = 0; checkIdx < checkLimit; checkIdx++) {
        var checkItem = currentTableData[checkIdx];
        if (typeof checkItem === 'object' && checkItem !== null && !Array.isArray(checkItem)) {
          hasObjects = true;
          var itemKeys = Object.keys(checkItem);
          for (var keyIdx = 0; keyIdx < itemKeys.length; keyIdx++) {
            allKeys.add(itemKeys[keyIdx]);
          }
        }
      }

      if (hasObjects && allKeys.size > 0) {
        var keys = Array.from(allKeys);
        var headerCells = [];
        for (var i = 0; i < keys.length; i++) {
          headerCells.push('<th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">' + escapeHtml(String(keys[i])) + '</th>');
        }
        resultTableHead.innerHTML = '<tr>' + headerCells.join('') + '</tr>';

        var bodyRows = [];
        for (var j = 0; j < pageRows.length; j++) {
          var item = pageRows[j];
          var cells = [];
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var value = item && typeof item === 'object' && item !== null ? item[key] : undefined;
            var displayValue = value === null ? 'null' : value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
            cells.push('<td style="padding: 8px 12px; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">' + escapeHtml(displayValue) + '</td>');
          }
          bodyRows.push('<tr>' + cells.join('') + '</tr>');
        }
        resultTableBody.innerHTML = bodyRows.join('');
      } else {
        resultTableHead.innerHTML = '<tr><th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">Value</th></tr>';
        var bodyRows = [];
        for (var j = 0; j < pageRows.length; j++) {
          var item = pageRows[j];
          var displayValue = item === null ? 'null' : item === undefined ? 'undefined' : typeof item === 'object' ? JSON.stringify(item) : String(item);
          bodyRows.push('<tr><td style="padding: 8px 12px; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">' + escapeHtml(displayValue) + '</td></tr>');
        }
        resultTableBody.innerHTML = bodyRows.join('');
      }
    }

    if (tableFirstPage) {
      tableFirstPage.onclick = () => {
        if (tableCurrentPage > 1) {
          tableCurrentPage = 1;
          renderTablePage();
          const rc = document.getElementById('resultContainer');
          if (rc) rc.scrollTop = 0;
        }
      };
    }

    if (tablePrevPage) {
      tablePrevPage.onclick = () => {
        if (tableCurrentPage > 1) {
          tableCurrentPage--;
          renderTablePage();
          const rc = document.getElementById('resultContainer');
          if (rc) rc.scrollTop = 0;
        }
      };
    }

    if (tableNextPage) {
      tableNextPage.onclick = () => {
        const totalPages = Math.max(1, Math.ceil((currentTableData ? currentTableData.length : 0) / currentTablePageSize));
        if (tableCurrentPage < totalPages) {
          tableCurrentPage++;
          renderTablePage();
          const rc = document.getElementById('resultContainer');
          if (rc) rc.scrollTop = 0;
        }
      };
    }

    if (tableLastPage) {
      tableLastPage.onclick = () => {
        const totalPages = Math.max(1, Math.ceil((currentTableData ? currentTableData.length : 0) / currentTablePageSize));
        if (tableCurrentPage < totalPages) {
          tableCurrentPage = totalPages;
          renderTablePage();
          const rc = document.getElementById('resultContainer');
          if (rc) rc.scrollTop = 0;
        }
      };
    }

    if (tablePageInput) {
      tablePageInput.addEventListener('change', () => {
        const totalPages = Math.max(1, Math.ceil((currentTableData ? currentTableData.length : 0) / currentTablePageSize));
        const val = parseInt(tablePageInput.value, 10);
        if (!isNaN(val)) {
          tableCurrentPage = Math.max(1, Math.min(val, totalPages));
          renderTablePage();
          const rc = document.getElementById('resultContainer');
          if (rc) rc.scrollTop = 0;
        } else {
          tablePageInput.value = tableCurrentPage;
        }
      });
      tablePageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          tablePageInput.blur();
        }
      });
    }

    if (tablePageSize) {
      tablePageSize.addEventListener('change', () => {
        const newSize = parseInt(tablePageSize.value, 10) || 50;
        const oldSize = currentTablePageSize;
        currentTablePageSize = newSize;
        try {
          localStorage.setItem('jsonQueryTools.tablePageSize', String(newSize));
        } catch (e) {}
        const firstVisibleIdx = (tableCurrentPage - 1) * oldSize;
        tableCurrentPage = Math.floor(firstVisibleIdx / newSize) + 1;
        renderTablePage();
      });
    }

    function updateResultDisplay(text, data, isStreaming = false) {
      const format = resultFormat.value;
      
      // Update result info
      if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
        const newlineChar = String.fromCharCode(10);
        const lines = text.split(newlineChar).length;
        const chars = text.length;
        const isArray = data && Array.isArray(data);
        const isObject = data && typeof data === 'object' && !Array.isArray(data);
        let info = lines + ' line' + (lines !== 1 ? 's' : '') + ', ' + chars + ' char' + (chars !== 1 ? 's' : '');
        if (isArray) info += ', ' + data.length + ' item' + (data.length !== 1 ? 's' : '');
        if (isObject) info += ', ' + Object.keys(data).length + ' key' + (Object.keys(data).length !== 1 ? 's' : '');
        resultInfo.textContent = info;
      } else if (data) {
        const isArray = Array.isArray(data);
        const isObject = typeof data === 'object' && !Array.isArray(data) && data !== null;
        let info = '';
        if (isArray) info = data.length.toLocaleString() + ' item' + (data.length !== 1 ? 's' : '');
        else if (isObject) info = Object.keys(data).length + ' key' + (Object.keys(data).length !== 1 ? 's' : '');
        resultInfo.textContent = info;
      } else {
        resultInfo.textContent = '';
      }
      
      function updateExportButtons(fmt, hasData) {
        if (saveJsonBtn) saveJsonBtn.style.display = hasData && fmt === 'json' ? 'inline-block' : 'none';
        if (saveCsvBtn) saveCsvBtn.style.display = hasData && (fmt === 'table' || fmt === 'csv') ? 'inline-block' : 'none';
        if (saveYamlBtn) saveYamlBtn.style.display = hasData && fmt === 'yaml' ? 'inline-block' : 'none';
        if (saveNdjsonBtn) saveNdjsonBtn.style.display = hasData && fmt === 'ndjson' ? 'inline-block' : 'none';
        if (saveXmlBtn) saveXmlBtn.style.display = hasData && fmt === 'xml' ? 'inline-block' : 'none';
        if (downloadChartBtn) downloadChartBtn.style.display = hasData && fmt === 'chart' ? 'inline-block' : 'none';
        if (exportDropdown) exportDropdown.style.display = hasData && fmt !== 'chart' ? 'inline-block' : 'none';
      }

      // Display based on format
      if (format === 'table') {
        // Table view
        resultPre.style.display = 'none';
        if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
        hideChart();

        if (!data || !Array.isArray(data)) {
          hideTable();
          if (resultTableWarning) {
            resultTableWarning.style.display = 'block';
            resultTableWarning.innerHTML = '<div style="padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a table.</div>';
          }
          copyResultBtn.style.display = 'none';
          updateExportButtons('table', false);
          return;
        }

        if (resultTableWarning) resultTableWarning.style.display = 'none';
        resultTable.style.display = 'table';
        if (tablePagination) tablePagination.style.display = 'flex';
        copyResultBtn.style.display = 'inline-block';
        updateExportButtons('table', true);
        
        currentTableData = data;
        renderTablePage();
      } else if (format === 'chart') {
        // Show chart view
        resultPre.style.display = 'none';
        if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
        hideTable();

        if (!data || !Array.isArray(data)) {
          hideChart();
          if (resultChartWarning) {
            resultChartWarning.style.display = 'block';
            resultChartWarning.innerHTML = '<div style="padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a chart.</div>';
          }
          copyResultBtn.style.display = 'none';
          updateExportButtons('chart', false);
          return;
        }

        if (resultChartWarning) resultChartWarning.style.display = 'none';
        resultChartContainer.style.display = 'block';
        chartType.style.display = 'inline-block';
        copyResultBtn.style.display = 'none';
        updateExportButtons('chart', true);
        renderChart(data);
      } else if (format === 'yaml') {
        // YAML view
        if (!resultJsonEditor && codeMirrorLoaded) {
          initResultJsonEditor();
        }
        let yamlText = '';
        if (data !== undefined && data !== null) {
          yamlText = generateYaml(data);
        } else if (text) {
          yamlText = text;
        }
        if (resultJsonEditor && resultJsonEditorWrapper) {
          resultJsonEditor.setValue(yamlText || '');
          resultJsonEditorWrapper.style.display = 'block';
          resultPre.style.display = 'none';
          resultPre.textContent = yamlText || '';
          setTimeout(() => {
            if (resultJsonEditor) resultJsonEditor.refresh();
          }, 50);
        } else {
          if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
          resultPre.style.display = 'block';
          resultPre.textContent = yamlText || '';
        }
        hideTable();
        hideChart();
        copyResultBtn.style.display = 'inline-block';
        updateExportButtons('yaml', Boolean(yamlText));
        resultPre.className = yamlText ? '' : 'empty';
      } else if (format === 'ndjson') {
        // NDJSON view
        if (!resultJsonEditor && codeMirrorLoaded) {
          initResultJsonEditor();
        }
        let ndjsonText = '';
        if (data !== undefined && data !== null) {
          ndjsonText = generateNdjson(data);
        } else if (text) {
          ndjsonText = text;
        }
        if (resultJsonEditor && resultJsonEditorWrapper) {
          resultJsonEditor.setValue(ndjsonText || '');
          resultJsonEditorWrapper.style.display = 'block';
          resultPre.style.display = 'none';
          resultPre.textContent = ndjsonText || '';
          setTimeout(() => {
            if (resultJsonEditor) resultJsonEditor.refresh();
          }, 50);
        } else {
          if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
          resultPre.style.display = 'block';
          resultPre.textContent = ndjsonText || '';
        }
        hideTable();
        hideChart();
        copyResultBtn.style.display = 'inline-block';
        updateExportButtons('ndjson', Boolean(ndjsonText));
        resultPre.className = ndjsonText ? '' : 'empty';
      } else if (format === 'xml') {
        // XML view
        if (!resultJsonEditor && codeMirrorLoaded) {
          initResultJsonEditor();
        }
        let xmlText = '';
        if (data !== undefined && data !== null) {
          xmlText = generateXml(data);
        } else if (text) {
          xmlText = text;
        }
        if (resultJsonEditor && resultJsonEditorWrapper) {
          resultJsonEditor.setValue(xmlText || '');
          resultJsonEditorWrapper.style.display = 'block';
          resultPre.style.display = 'none';
          resultPre.textContent = xmlText || '';
          setTimeout(() => {
            if (resultJsonEditor) resultJsonEditor.refresh();
          }, 50);
        } else {
          if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
          resultPre.style.display = 'block';
          resultPre.textContent = xmlText || '';
        }
        hideTable();
        hideChart();
        copyResultBtn.style.display = 'inline-block';
        updateExportButtons('xml', Boolean(xmlText));
        resultPre.className = xmlText ? '' : 'empty';
      } else if (format === 'json') {
        // JSON view with read-only CodeMirror + folding
        if (!resultJsonEditor && codeMirrorLoaded) {
          initResultJsonEditor();
        }
        let jsonText = text;
        if ((!jsonText || !jsonText.trim()) && data !== undefined) {
          try {
            jsonText = JSON.stringify(data, null, 2);
          } catch {
            jsonText = String(data);
          }
        }
        if (resultJsonEditor && resultJsonEditorWrapper) {
          resultJsonEditor.setValue(jsonText || '');
          resultJsonEditorWrapper.style.display = 'block';
          resultPre.style.display = 'none';
          resultPre.textContent = jsonText || '';
          setTimeout(() => {
            if (resultJsonEditor) {
              resultJsonEditor.refresh();
            }
          }, 50);
        } else {
          // Fallback to plain pre
          if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
          resultPre.style.display = 'block';
          resultPre.textContent = jsonText || '';
        }
        hideTable();
        hideChart();
        copyResultBtn.style.display = 'inline-block';
        updateExportButtons('json', Boolean(jsonText));
        resultPre.className = jsonText ? '' : 'empty';
      } else {
        // Default text view
        if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
        hideTable();
        hideChart();
        copyResultBtn.style.display = 'inline-block';
        resultPre.style.display = 'block';
        
        resultPre.textContent = text;
        updateExportButtons('json', Boolean(resultPre.textContent));
        resultPre.className = text ? '' : 'empty';
      }
    }

    function renderChart(data) {
      if (!data || !Array.isArray(data)) {
         hideChart();
         if (resultChartWarning) {
           resultChartWarning.style.display = 'block';
           resultChartWarning.innerHTML = '<div style="padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a chart.</div>';
         }
         return;
      }
      
      const canvas = document.getElementById('resultChart');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      
      if (currentChart) {
          currentChart.destroy();
          currentChart = null;
      }
      
      
      // Heuristics for labels and datasets
      let labels = [];
      let datasets = [];

      if (data.length > 0) {
          const first = data[0];
          if (typeof first === 'object' && first !== null) {
              const keys = Object.keys(first);
              const labelKey = keys.find(k => typeof first[k] === 'string') || keys[0];
              const valueKeys = keys.filter(k => typeof first[k] === 'number');
              
              labels = data.map(d => String(d[labelKey]));
              
              if (valueKeys.length > 0) {
                  datasets = valueKeys.map((key, i) => {
                      const color = 'hsl(' + (i * 360 / valueKeys.length) + ', 70%, 60%)';
                      return {
                          label: key,
                          data: data.map(d => Number(d[key]) || 0),
                          backgroundColor: color.replace('60%)', '50%)').replace('hsl', 'hsla').replace(')', ', 0.5)'),
                          borderColor: color,
                          borderWidth: 1
                      };
                  });
              } else {
                 // Fallback: use second key as value
                 const valueKey = keys[1] || keys[0];
                 datasets = [{
                     label: valueKey,
                     data: data.map(d => Number(d[valueKey]) || 0),
                     backgroundColor: 'rgba(54, 162, 235, 0.5)',
                     borderColor: 'rgba(54, 162, 235, 1)',
                     borderWidth: 1
                 }];
              }
          } else {
              // Primitive values
              labels = data.map((_, i) => String(i));
              datasets = [{
                  label: 'Value',
                  data: data.map(d => Number(d) || 0),
                  backgroundColor: 'rgba(54, 162, 235, 0.5)',
                  borderColor: 'rgba(54, 162, 235, 1)',
                  borderWidth: 1
              }];
          }
      }

      loadChartJs().then(() => {
          const type = chartType.value;
          
          // For Pie charts, we want colorful segments for specific labels, not dataset-based colors
          if (type === 'pie') {
             const sliceColors = labels.map((_, i) => 'hsl(' + (i * 360 / labels.length) + ', 70%, 60%)');
             datasets.forEach(ds => {
                 ds.backgroundColor = sliceColors;
                 ds.borderColor = '#ffffff';
             });
          }
          
          // Apply special handling for specific chart types if needed
          datasets.forEach(ds => {
              if (type === 'line') ds.fill = false;
          });
            
          currentChart = new Chart(ctx, {
            type: type,
            data: {
              labels: labels,
              datasets: datasets
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: type === 'pie' ? undefined : {
                y: {
                  beginAtZero: true,
                  grid: { color: 'rgba(255, 255, 255, 0.1)' },
                  ticks: { color: '#cccccc' }
                },
                x: {
                  grid: { color: 'rgba(255, 255, 255, 0.1)' },
                  ticks: { color: '#cccccc' }
                }
              },
              plugins: {
                legend: { labels: { color: '#cccccc' } }
              }
            }
          });
      }).catch(err => {
          resultChartContainer.textContent = 'Failed to load Chart.js: ' + err.message;
      });
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    chartType.addEventListener('change', () => {
       if (resultFormat.value === 'chart' && currentResultData) {
         renderChart(currentResultData);
       }
    });

    downloadChartBtn.addEventListener('click', () => {
      const canvas = document.getElementById('resultChart');
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.replace(/^data:image\\/png;base64,/, '');
        vscode.postMessage({ type: 'saveImage', data: base64 });
      }
    });

    if (saveJsonBtn) {
      saveJsonBtn.addEventListener('click', () => {
        if (currentResultData !== undefined) {
          vscode.postMessage({ type: 'saveData', fileType: 'json', data: currentResultData });
        }
      });
    }

    if (saveCsvBtn) {
      saveCsvBtn.addEventListener('click', () => {
        const dataToUse = currentResultData !== null && currentResultData !== undefined 
          ? currentResultData 
          : (streamingData && streamingData.length > 0 ? streamingData : null);
        if (dataToUse !== null && dataToUse !== undefined) {
          const csvContent = generateCsv(dataToUse);
          vscode.postMessage({ type: 'saveData', fileType: 'csv', text: csvContent, data: dataToUse });
        }
      });
    }

    if (saveYamlBtn) {
      saveYamlBtn.addEventListener('click', () => {
        const dataToUse = currentResultData !== null && currentResultData !== undefined 
          ? currentResultData 
          : (streamingData && streamingData.length > 0 ? streamingData : null);
        if (dataToUse !== null && dataToUse !== undefined) {
          const yamlContent = generateYaml(dataToUse);
          vscode.postMessage({ type: 'saveData', fileType: 'yaml', text: yamlContent, data: dataToUse });
        }
      });
    }

    if (saveNdjsonBtn) {
      saveNdjsonBtn.addEventListener('click', () => {
        const dataToUse = currentResultData !== null && currentResultData !== undefined 
          ? currentResultData 
          : (streamingData && streamingData.length > 0 ? streamingData : null);
        if (dataToUse !== null && dataToUse !== undefined) {
          const ndjsonContent = generateNdjson(dataToUse);
          vscode.postMessage({ type: 'saveData', fileType: 'ndjson', text: ndjsonContent, data: dataToUse });
        }
      });
    }

    if (saveXmlBtn) {
      saveXmlBtn.addEventListener('click', () => {
        const dataToUse = currentResultData !== null && currentResultData !== undefined 
          ? currentResultData 
          : (streamingData && streamingData.length > 0 ? streamingData : null);
        if (dataToUse !== null && dataToUse !== undefined) {
          const xmlContent = generateXml(dataToUse);
          vscode.postMessage({ type: 'saveData', fileType: 'xml', text: xmlContent, data: dataToUse });
        }
      });
    }

    if (exportDropdown) {
      exportDropdown.addEventListener('change', () => {
        const fmt = exportDropdown.value;
        if (!fmt) return;
        const dataToUse = currentResultData !== null && currentResultData !== undefined 
          ? currentResultData 
          : (streamingData && streamingData.length > 0 ? streamingData : null);
        if (dataToUse !== null && dataToUse !== undefined) {
          const formatted = formatResultData(dataToUse, fmt);
          vscode.postMessage({ type: 'saveData', fileType: fmt, text: formatted, data: dataToUse });
        }
        exportDropdown.selectedIndex = 0;
      });
    }

    resultFormat.addEventListener('change', () => {
      // Handle format change - support both completed and streaming data
      const dataToUse = currentResultData !== null && currentResultData !== undefined 
        ? currentResultData 
        : (streamingIsActive && streamingData && streamingData.length > 0 ? streamingData : null);
      
      if (dataToUse !== null && dataToUse !== undefined) {
        const format = resultFormat.value;
        const isCurrentlyStreaming = streamingIsActive && currentResultData === null;
        
        if (format === 'table') {
          if (isCurrentlyStreaming) {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items) - Table will render when complete';
            resultPre.className = '';
            resultPre.style.display = 'block';
            hideTable();
            hideChart();
          } else {
            updateResultDisplay('', dataToUse);
          }
        } else if (format === 'chart') {
          if (isCurrentlyStreaming) {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items) - Chart will render when complete';
            resultPre.className = '';
            resultPre.style.display = 'block';
            hideTable();
            hideChart();
          } else {
            updateResultDisplay('', dataToUse);
          }
        } else {
          // JSON, YAML, NDJSON, XML formats
          if (isCurrentlyStreaming) {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items)';
            resultPre.className = '';
            resultPre.style.display = 'block';
            if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
            hideTable();
            hideChart();
          } else {
            updateResultDisplay('', dataToUse);
          }
        }
      }
    });

    const historySearch = document.getElementById('historySearch');
    let currentHistoryItems = [];

    historySearch.addEventListener('input', () => {
      renderList(currentHistoryItems);
    });

    function renderList(items) {
      if (items) currentHistoryItems = items;
      else items = currentHistoryItems;

      listEl.innerHTML = '';
      
      const searchTerm = historySearch.value.toLowerCase().trim();
      
      const filteredItems = items.filter(item => {
        const expr = typeof item === 'object' ? item.expr : item;
        const name = typeof item === 'object' ? item.name : '';
        if (!searchTerm) return true;
        return expr.toLowerCase().includes(searchTerm) || (name && name.toLowerCase().includes(searchTerm));
      });

      if (filteredItems.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = searchTerm ? 'No matching history found.' : 'No history yet. Save expressions to see them here.';
        listEl.appendChild(emptyDiv);
        return;
      }
      const frag = document.createDocumentFragment();
      
      const favorites = [];
      const others = [];
      
      filteredItems.forEach(item => {
        const isFav = typeof item === 'object' && item.isFavorite;
        if (isFav) favorites.push(item);
        else others.push(item);
      });

      favorites.sort((a, b) => {
         const nameA = (a.name || '').trim();
         const nameB = (b.name || '').trim();
         
         if (nameA && nameB) return nameA.localeCompare(nameB);
         if (nameA) return -1; // Named first
         if (nameB) return 1;
         return 0;
      });

      // Others: maintain original order (Newest at bottom)

      [...favorites, ...others.reverse()].forEach((item, idx) => {
        const expr = typeof item === 'object' ? item.expr : item;
        const isFav = typeof item === 'object' ? !!item.isFavorite : false;
        const name = typeof item === 'object' ? item.name : undefined;
        
        const div = document.createElement('div');
        div.className = 'item' + (isFav ? ' favorite' : '');
        
        if (name) {
            const header = document.createElement('div');
            header.className = 'item-header';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'item-name';
            nameSpan.textContent = name;
            header.appendChild(nameSpan);
            div.appendChild(header);
        }
        
        const pre = document.createElement('pre');
        pre.textContent = expr;
        
        const actions = document.createElement('div');
        actions.className = 'actions';
        
        const favBtn = document.createElement('button');
        favBtn.className = 'secondary';
        favBtn.textContent = isFav ? '★' : '☆';
        favBtn.title = isFav ? 'Unfavorite' : 'Favorite';
        favBtn.style.color = isFav ? 'var(--vscode-charts-yellow, #D7BA7D)' : '';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'secondary';
        copyBtn.textContent = '📋';
        copyBtn.title = 'Copy to Clipboard';
        
        const useBtn = document.createElement('button');
        useBtn.className = 'secondary';
        useBtn.textContent = '📝 Use';
        
        const runBtn = document.createElement('button');
        runBtn.className = 'primary';
        runBtn.textContent = '▶ Run';
        
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '🗑️ Delete';
        
        const renameBtn = document.createElement('button');
        renameBtn.className = 'secondary';
        renameBtn.textContent = '✏️';
        renameBtn.title = 'Rename';


        favBtn.onclick = () => {
             vscode.postMessage({ type: 'toggleFavorite', expr: expr });
        };

        copyBtn.onclick = () => {
             vscode.postMessage({ type: 'copyToClipboard', text: expr });
             const originalText = copyBtn.textContent;
             copyBtn.textContent = '✓';
             setTimeout(() => copyBtn.textContent = originalText, 1500);
        };
        
        useBtn.onclick = () => {
          setEditorValue(expr);
          if (editor) editor.focus();
        };
        runBtn.onclick = () => {
          setLoading(true);
          resultPre.textContent = 'Running...';
          resultPre.className = '';
          vscode.postMessage({ type: 'run', expr, save: true });
        };
        delBtn.onclick = () => {
          vscode.postMessage({ type: 'confirmDelete', fullExpr: expr });
        };
        renameBtn.onclick = () => {
            vscode.postMessage({ type: 'renameHistoryItem', fullExpr: expr, currentName: name });
        };

        actions.append(favBtn, renameBtn, copyBtn, useBtn, runBtn, delBtn);
        div.append(pre, actions);
        frag.append(div);
      });
      listEl.append(frag);
    }

    vscode.postMessage({ type: 'ready' });

    refreshModelsBtn.onclick = () => {
        hideAiAlert();
        const provider = aiProvider.value;
        const ep = ollamaEndpoint.value || 'http://localhost:11434';
        const key = aiApiKey.value;
        
        localStorage.setItem('jsonQueryTools.ollamaEndpoint', ep);
        if (key) {
          vscode.postMessage({ type: 'setAiApiKey', apiKey: key.trim() });
        }

        vscode.postMessage({ type: 'getModels', provider, endpoint: ep, apiKey: key });
    };

    aiModel.onchange = () => {
        hideAiAlert();
        localStorage.setItem('jsonQueryTools.aiModel', aiModel.value);
    };

    aiGenerateBtn.onclick = () => {
        const provider = aiProvider.value;
        const ep = ollamaEndpoint.value;
        const model = aiModel.value;
        const prompt = aiPrompt.value;
        const key = aiApiKey.value;
        
        if (provider === 'ollama' && !ep) {
            showAiAlert('Please check the Ollama Endpoint.');
            return;
        }
        if (provider === 'gemini' && !key) {
            showAiAlert('Please enter a Gemini API Key.');
            return;
        }
        if (!model) {
            showAiAlert('Please select a model.');
            return;
        }
        if (!prompt || !prompt.trim()) {
            showAiAlert('Please enter a prompt.');
            return;
        }
        hideAiAlert();

        if (key) {
          vscode.postMessage({ type: 'setAiApiKey', apiKey: key.trim() });
        }

        aiGenerateBtn.disabled = true;
        aiGenerateBtn.textContent = 'Generating...';
        
        vscode.postMessage({ type: 'generateQuery', provider, endpoint: ep, apiKey: key, model, prompt });
    };
    // cURL Command Utilities (Parser & Generator)
    function toBase64(str) {
      if (typeof btoa === 'function') {
        try {
          return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
          return btoa(str);
        }
      }
      return '';
    }

    function tokenizeArgs(cmd) {
      if (!cmd) return [];
      var rawLines = cmd.split(String.fromCharCode(10));
      var combined = '';
      for (var li = 0; li < rawLines.length; li++) {
        var l = rawLines[li];
        if (l.charAt(l.length - 1) === String.fromCharCode(13)) {
          l = l.slice(0, -1);
        }
        var trimEnd = l.trimEnd ? l.trimEnd() : l.replace(/\s+$/, '');
        if (trimEnd.endsWith('\\\\') || trimEnd.endsWith('^') || trimEnd.endsWith(String.fromCharCode(96))) {
          combined += trimEnd.slice(0, -1) + ' ';
        } else {
          combined += l + String.fromCharCode(10);
        }
      }
      var clean = combined.trim();

      var tokens = [];
      var current = '';
      var inSingleQuote = false;
      var inDoubleQuote = false;
      var inAnsiCQuote = false;
      var isEscaped = false;
      var tokenStarted = false;

      for (var i = 0; i < clean.length; i++) {
        var char = clean[i];

        if (isEscaped) {
          current += char;
          tokenStarted = true;
          isEscaped = false;
          continue;
        }

        if (inSingleQuote) {
          if (char === "'") {
            inSingleQuote = false;
          } else {
            current += char;
          }
          tokenStarted = true;
          continue;
        }

        if (inAnsiCQuote) {
          if (char === '\\\\') {
            if (i + 1 < clean.length) {
              var next = clean[++i];
              if (next === 'n') current += String.fromCharCode(10);
              else if (next === 'r') current += String.fromCharCode(13);
              else if (next === 't') current += String.fromCharCode(9);
              else if (next === "'") current += "'";
              else if (next === '\\\\') current += '\\\\';
              else current += next;
            }
          } else if (char === "'") {
            inAnsiCQuote = false;
          } else {
            current += char;
          }
          tokenStarted = true;
          continue;
        }

        if (inDoubleQuote) {
          if (char === '\\\\') {
            if (i + 1 < clean.length) {
              var nextD = clean[++i];
              if (nextD === '"' || nextD === '\\\\' || nextD === '$' || nextD === String.fromCharCode(96)) {
                current += nextD;
              } else if (nextD === 'n') {
                current += String.fromCharCode(10);
              } else if (nextD === 'r') {
                current += String.fromCharCode(13);
              } else if (nextD === 't') {
                current += String.fromCharCode(9);
              } else {
                current += '\\\\' + nextD;
              }
            } else {
              current += '\\\\';
            }
          } else if (char === '"') {
            if (i + 1 < clean.length && clean[i + 1] === '"') {
              current += '"';
              i++;
            } else {
              inDoubleQuote = false;
            }
          } else {
            current += char;
          }
          tokenStarted = true;
          continue;
        }

        if (char === '\\\\') {
          if (i + 1 < clean.length) {
            current += clean[++i];
            tokenStarted = true;
          }
          continue;
        }

        if (char === '$' && i + 1 < clean.length && clean[i + 1] === "'") {
          inAnsiCQuote = true;
          tokenStarted = true;
          i++;
          continue;
        }

        if (char === "'") {
          inSingleQuote = true;
          tokenStarted = true;
          continue;
        }

        if (char === '"') {
          inDoubleQuote = true;
          tokenStarted = true;
          continue;
        }

        if (char === ' ' || char === String.fromCharCode(9) || char === String.fromCharCode(10) || char === String.fromCharCode(13)) {
          if (tokenStarted) {
            tokens.push(current);
            current = '';
            tokenStarted = false;
          }
          continue;
        }

        current += char;
        tokenStarted = true;
      }

      if (tokenStarted) {
        tokens.push(current);
      }

      return tokens;
    }

    function parseCurl(cmd) {
      var tokens = tokenizeArgs(cmd);
      var url = '';
      var method = '';
      var headers = {};
      var headerLines = [];
      var bodyChunks = [];

      var startIdx = 0;
      if (tokens.length > 0 && /^(curl|curl\.exe)$/i.test(tokens[0])) {
        startIdx = 1;
      }

      var argFlags = {
        '-X': true, '--request': true,
        '-H': true, '--header': true,
        '-d': true, '--data': true, '--data-raw': true, '--data-binary': true, '--data-ascii': true, '--data-urlencode': true,
        '-u': true, '--user': true,
        '-A': true, '--user-agent': true,
        '-b': true, '--cookie': true,
        '--url': true,
        '-m': true, '--max-time': true,
        '--connect-timeout': true,
        '-e': true, '--referer': true,
        '-o': true, '--output': true,
        '--retry': true
      };

      var boolFlags = {
        '-k': true, '--insecure': true,
        '-s': true, '--silent': true,
        '-S': true, '--show-error': true,
        '-v': true, '--verbose': true,
        '-L': true, '--location': true,
        '-i': true, '--include': true,
        '-I': true, '--head': true,
        '-G': true, '--get': true,
        '--compressed': true,
        '--no-buffer': true,
        '-N': true,
        '-f': true, '--fail': true,
        '-0': true, '--http1.0': true,
        '--http1.1': true,
        '--http2': true
      };

      function addHeader(headerStr) {
        if (!headerStr) return;
        var colonIdx = headerStr.indexOf(':');
        if (colonIdx > 0) {
          var key = headerStr.slice(0, colonIdx).trim();
          var val = headerStr.slice(colonIdx + 1).trim();
          headers[key] = val;
          headerLines.push(key + ': ' + val);
        } else {
          headerLines.push(headerStr.trim());
        }
      }

      function handleBasicAuth(userPass) {
        var b64 = toBase64(userPass);
        if (b64) {
          headers['Authorization'] = 'Basic ' + b64;
          headerLines.push('Authorization: Basic ' + b64);
        }
      }

      for (var i = startIdx; i < tokens.length; i++) {
        var token = tokens[i];

        if (token === '-I' || token === '--head') {
          method = 'HEAD';
          continue;
        }
        if (token === '-G' || token === '--get') {
          method = 'GET';
          continue;
        }

        if (token === '--url' && i + 1 < tokens.length) {
          url = tokens[++i];
          continue;
        }
        if (token.indexOf('--url=') === 0) {
          url = token.slice(6);
          continue;
        }

        if ((token === '-X' || token === '--request') && i + 1 < tokens.length) {
          method = tokens[++i].toUpperCase();
          continue;
        }
        if (token.indexOf('--request=') === 0) {
          method = token.slice(10).toUpperCase();
          continue;
        }
        if (token.indexOf('-X') === 0 && token.length > 2) {
          method = token.slice(2).toUpperCase();
          continue;
        }

        if ((token === '-H' || token === '--header') && i + 1 < tokens.length) {
          addHeader(tokens[++i]);
          continue;
        }
        if (token.indexOf('--header=') === 0) {
          addHeader(token.slice(9));
          continue;
        }
        if (token.indexOf('-H') === 0 && token.length > 2) {
          addHeader(token.slice(2));
          continue;
        }

        if ((token === '-A' || token === '--user-agent') && i + 1 < tokens.length) {
          addHeader('User-Agent: ' + tokens[++i]);
          continue;
        }
        if (token.indexOf('--user-agent=') === 0) {
          addHeader('User-Agent: ' + token.slice(14));
          continue;
        }

        if ((token === '-b' || token === '--cookie') && i + 1 < tokens.length) {
          addHeader('Cookie: ' + tokens[++i]);
          continue;
        }
        if (token.indexOf('--cookie=') === 0) {
          addHeader('Cookie: ' + token.slice(9));
          continue;
        }

        if ((token === '-u' || token === '--user') && i + 1 < tokens.length) {
          handleBasicAuth(tokens[++i]);
          continue;
        }
        if (token.indexOf('--user=') === 0) {
          handleBasicAuth(token.slice(7));
          continue;
        }
        if (token.indexOf('-u') === 0 && token.length > 2) {
          handleBasicAuth(token.slice(2));
          continue;
        }

        if ((token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-ascii' || token === '--data-urlencode') && i + 1 < tokens.length) {
          bodyChunks.push(tokens[++i]);
          continue;
        }
        if (token.indexOf('--data=') === 0 || token.indexOf('--data-raw=') === 0 || token.indexOf('--data-binary=') === 0 || token.indexOf('--data-ascii=') === 0 || token.indexOf('--data-urlencode=') === 0) {
          var eqIdx = token.indexOf('=');
          bodyChunks.push(token.slice(eqIdx + 1));
          continue;
        }
        if (token.indexOf('-d') === 0 && token.length > 2) {
          bodyChunks.push(token.slice(2));
          continue;
        }

        if (argFlags[token] && i + 1 < tokens.length) {
          i++;
          continue;
        }

        if (token.indexOf('-') === 0 && token.indexOf('=') !== -1) {
          continue;
        }

        if (boolFlags[token] || token.indexOf('-') === 0) {
          continue;
        }

        if (!url) {
          url = token;
        }
      }

      var finalBody = bodyChunks.join('&');
      if (!method) {
        method = bodyChunks.length > 0 ? 'POST' : 'GET';
      }

      return {
        url: url.trim(),
        method: method || 'GET',
        headers: headers,
        headersString: headerLines.join(String.fromCharCode(10)),
        body: finalBody
      };
    }

    function generateCurl(options) {
      var url = (options.url || '').trim();
      var method = (options.method || 'GET').toUpperCase();
      var body = options.body !== undefined && options.body !== null ? String(options.body).trim() : '';

      var headerList = [];

      function parseLines(str) {
        var lines = str.split(String.fromCharCode(10));
        for (var i = 0; i < lines.length; i++) {
          var trimmed = lines[i].trim();
          if (trimmed.charAt(trimmed.length - 1) === String.fromCharCode(13)) {
            trimmed = trimmed.slice(0, -1).trim();
          }
          if (!trimmed) continue;
          var idx = trimmed.indexOf(':');
          if (idx > 0) {
            headerList.push({
              key: trimmed.slice(0, idx).trim(),
              value: trimmed.slice(idx + 1).trim()
            });
          }
        }
      }

      if (typeof options.headers === 'string') {
        var raw = options.headers.trim();
        if (raw.indexOf('{') === 0 && raw.lastIndexOf('}') === raw.length - 1) {
          try {
            var obj = JSON.parse(raw);
            var keys = Object.keys(obj);
            for (var j = 0; j < keys.length; j++) {
              var k = keys[j];
              var v = obj[k];
              if (k && v !== undefined && v !== null) {
                headerList.push({ key: k.trim(), value: String(v).trim() });
              }
            }
          } catch (e) {
            parseLines(raw);
          }
        } else {
          parseLines(raw);
        }
      } else if (typeof options.headers === 'object' && options.headers !== null) {
        var objKeys = Object.keys(options.headers);
        for (var m = 0; m < objKeys.length; m++) {
          var hk = objKeys[m];
          var hv = options.headers[hk];
          if (hk && hv !== undefined && hv !== null) {
            headerList.push({ key: hk.trim(), value: String(hv).trim() });
          }
        }
      }

      var parts = ['curl'];

      if (method !== 'GET' || body) {
        parts.push('-X ' + method);
      }

      var escapedUrl = url.split('"').join('\\\\"');
      parts.push('"' + escapedUrl + '"');

      var lines = [];
      lines.push(parts.join(' '));

      for (var n = 0; n < headerList.length; n++) {
        var h = headerList[n];
        var escapedVal = (h.key + ': ' + h.value).split('"').join('\\\\"');
        lines.push('  -H "' + escapedVal + '"');
      }

      if (body && method !== 'GET' && method !== 'HEAD') {
        var safeBody = body.split("'").join("'\\\\''");
        lines.push("  -d '" + safeBody + "'");
      }

      return lines.join(' ' + '\\\\' + String.fromCharCode(10));
    }

    // URL Modal Controller
    const urlModal = document.getElementById('urlModal');
    const urlModalTitle = document.getElementById('urlModalTitle');
    const urlSourceId = document.getElementById('urlSourceId');
    const urlAlias = document.getElementById('urlAlias');
    const urlMethod = document.getElementById('urlMethod');
    const urlEndpoint = document.getElementById('urlEndpoint');
    const urlHeaders = document.getElementById('urlHeaders');
    const urlBody = document.getElementById('urlBody');
    const urlBodyGroup = document.getElementById('urlBodyGroup');
    const urlModalAlert = document.getElementById('urlModalAlert');
    const submitUrlModal = document.getElementById('submitUrlModal');
    const cancelUrlModal = document.getElementById('cancelUrlModal');
    const closeUrlModalBtn = document.getElementById('closeUrlModal');
    const submitUrlSpinner = document.getElementById('submitUrlSpinner');
    const submitUrlText = document.getElementById('submitUrlText');
    const importCurlBtn = document.getElementById('importCurlBtn');
    const copyCurlBtn = document.getElementById('copyCurlBtn');
    const curlImportPanel = document.getElementById('curlImportPanel');
    const curlImportInput = document.getElementById('curlImportInput');
    const closeCurlImportBtn = document.getElementById('closeCurlImportBtn');
    const cancelCurlImportBtn = document.getElementById('cancelCurlImportBtn');
    const applyCurlImportBtn = document.getElementById('applyCurlImportBtn');

    // URL Modal Tabs and Query Params Controller (Postman Style)
    const tabBtnParams = document.getElementById('tabBtnParams');
    const tabBtnHeaders = document.getElementById('tabBtnHeaders');
    const tabBtnBody = document.getElementById('tabBtnBody');
    const tabPaneParams = document.getElementById('tabPaneParams');
    const tabPaneHeaders = document.getElementById('tabPaneHeaders');
    const tabPaneBody = document.getElementById('tabPaneBody');
    const paramsCountBadge = document.getElementById('paramsCountBadge');
    const headersCountBadge = document.getElementById('headersCountBadge');
    const queryParamsBody = document.getElementById('queryParamsBody');
    const addParamRowBtn = document.getElementById('addParamRowBtn');

    let currentQueryParams = [];
    let isSyncingQueryParams = false;

    function switchUrlTab(tabName) {
      if (tabBtnParams) tabBtnParams.classList.toggle('active', tabName === 'params');
      if (tabBtnHeaders) tabBtnHeaders.classList.toggle('active', tabName === 'headers');
      if (tabBtnBody) tabBtnBody.classList.toggle('active', tabName === 'body');

      if (tabPaneParams) tabPaneParams.style.display = tabName === 'params' ? 'block' : 'none';
      if (tabPaneHeaders) tabPaneHeaders.style.display = tabName === 'headers' ? 'block' : 'none';
      if (tabPaneBody) tabPaneBody.style.display = tabName === 'body' ? 'block' : 'none';
    }

    if (tabBtnParams) tabBtnParams.onclick = () => switchUrlTab('params');
    if (tabBtnHeaders) tabBtnHeaders.onclick = () => switchUrlTab('headers');
    if (tabBtnBody) tabBtnBody.onclick = () => switchUrlTab('body');

    function updateHeadersBadge() {
      if (!headersCountBadge || !urlHeaders) return;
      const text = urlHeaders.value.trim();
      let count = 0;
      if (text.startsWith('{') && text.endsWith('}')) {
        try {
          count = Object.keys(JSON.parse(text)).length;
        } catch (e) {
          count = 0;
        }
      } else if (text) {
        count = text.split(String.fromCharCode(10)).filter(line => line.trim().indexOf(':') > 0).length;
      }
      if (count > 0) {
        headersCountBadge.textContent = String(count);
        headersCountBadge.style.display = 'inline-block';
      } else {
        headersCountBadge.style.display = 'none';
      }
    }

    if (urlHeaders) {
      urlHeaders.addEventListener('input', updateHeadersBadge);
    }

    function toggleBodyGroup() {
      if (!urlMethod) return;
      const method = urlMethod.value;
      const supportsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      if (tabBtnBody) {
        tabBtnBody.style.display = supportsBody ? 'inline-flex' : 'none';
      }
      if (!supportsBody && tabBtnBody && tabBtnBody.classList.contains('active')) {
        switchUrlTab('params');
      }
    }

    function safeDecodeQuery(str) {
      if (!str) return '';
      try {
        return decodeURIComponent(str.split('+').join(' '));
      } catch (e) {
        return str;
      }
    }

    function parseQueryParamsFromUrl(url) {
      if (!url) return [];
      const qIdx = url.indexOf('?');
      if (qIdx === -1) return [];
      let queryStr = url.slice(qIdx + 1);
      const hashIdx = queryStr.indexOf('#');
      if (hashIdx !== -1) {
        queryStr = queryStr.slice(0, hashIdx);
      }
      if (!queryStr) return [];

      const pairs = queryStr.split('&');
      const result = [];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        if (!pair) continue;
        const eqIdx = pair.indexOf('=');
        if (eqIdx !== -1) {
          result.push({
            enabled: true,
            key: safeDecodeQuery(pair.slice(0, eqIdx)),
            value: safeDecodeQuery(pair.slice(eqIdx + 1))
          });
        } else {
          result.push({
            enabled: true,
            key: safeDecodeQuery(pair),
            value: ''
          });
        }
      }
      return result;
    }

    function buildUrlWithQueryParams(rawUrl, params) {
      let base = rawUrl || '';
      let hash = '';
      const hashIdx = base.indexOf('#');
      if (hashIdx !== -1) {
        hash = base.slice(hashIdx);
        base = base.slice(0, hashIdx);
      }
      const qIdx = base.indexOf('?');
      if (qIdx !== -1) {
        base = base.slice(0, qIdx);
      }

      function safeEncodeParam(str) {
        return encodeURIComponent(str)
          .replace(/%7B%7B/gi, '{{')
          .replace(/%7D%7D/gi, '}}')
          .replace(/%24/g, '$');
      }

      const activePairs = [];
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p.enabled && (p.key.trim() || p.value.trim())) {
          const k = safeEncodeParam(p.key);
          const v = safeEncodeParam(p.value);
          if (p.value !== '') {
            activePairs.push(k + '=' + v);
          } else {
            activePairs.push(k);
          }
        }
      }

      if (activePairs.length > 0) {
        return base + '?' + activePairs.join('&') + hash;
      } else {
        return base + hash;
      }
    }

    function updateParamsBadge() {
      if (!paramsCountBadge) return;
      const count = currentQueryParams.filter(p => p.enabled && p.key.trim().length > 0).length;
      if (count > 0) {
        paramsCountBadge.textContent = String(count);
        paramsCountBadge.style.display = 'inline-block';
      } else {
        paramsCountBadge.style.display = 'none';
      }
    }

    let syncParamsDebounceTimer = null;
    let syncUrlDebounceTimer = null;

    function flushSyncParamsToUrl() {
      if (syncParamsDebounceTimer) {
        clearTimeout(syncParamsDebounceTimer);
        syncParamsDebounceTimer = null;
        performSyncParamsToUrl();
      }
    }

    function flushSyncUrlToTable() {
      if (syncUrlDebounceTimer) {
        clearTimeout(syncUrlDebounceTimer);
        syncUrlDebounceTimer = null;
        performSyncUrlToTable();
      }
    }

    function performSyncParamsToUrl() {
      if (isSyncingQueryParams || !urlEndpoint) return;
      isSyncingQueryParams = true;
      try {
        const newUrl = buildUrlWithQueryParams(urlEndpoint.value, currentQueryParams);
        urlEndpoint.value = newUrl;
        updateParamsBadge();
        if (urlModalPreview && urlModalPreview.style.display !== 'none') {
          urlModalPreview.style.opacity = '0.55';
          if (previewMeta && !previewMeta.textContent.includes('edited')) {
            previewMeta.textContent += ' (params edited)';
          }
        }
      } finally {
        isSyncingQueryParams = false;
      }
    }

    function syncParamsToUrl(immediate) {
      if (isSyncingQueryParams || !urlEndpoint) return;
      if (syncParamsDebounceTimer) {
        clearTimeout(syncParamsDebounceTimer);
        syncParamsDebounceTimer = null;
      }
      if (immediate) {
        performSyncParamsToUrl();
      } else {
        syncParamsDebounceTimer = setTimeout(() => {
          syncParamsDebounceTimer = null;
          performSyncParamsToUrl();
        }, 150);
      }
    }

    function performSyncUrlToTable() {
      if (isSyncingQueryParams) return;
      isSyncingQueryParams = true;
      try {
        const parsed = parseQueryParamsFromUrl(urlEndpoint ? urlEndpoint.value : '');
        const disabled = currentQueryParams.filter(p => !p.enabled && (p.key || p.value));
        currentQueryParams = parsed.concat(disabled);
        renderQueryParamsTable();
      } finally {
        isSyncingQueryParams = false;
      }
    }

    function syncUrlToTable(immediate) {
      if (isSyncingQueryParams) return;
      if (syncUrlDebounceTimer) {
        clearTimeout(syncUrlDebounceTimer);
        syncUrlDebounceTimer = null;
      }
      if (immediate) {
        performSyncUrlToTable();
      } else {
        syncUrlDebounceTimer = setTimeout(() => {
          syncUrlDebounceTimer = null;
          performSyncUrlToTable();
        }, 150);
      }
    }

    if (urlEndpoint) {
      urlEndpoint.addEventListener('input', () => syncUrlToTable(false));
    }

    function renderQueryParamsTable() {
      if (!queryParamsBody) return;

      if (currentQueryParams.length === 0 ||
          currentQueryParams[currentQueryParams.length - 1].key !== '' ||
          currentQueryParams[currentQueryParams.length - 1].value !== '') {
        currentQueryParams.push({ enabled: true, key: '', value: '' });
      }

      updateParamsBadge();

      let rowsHtml = '';
      for (let i = 0; i < currentQueryParams.length; i++) {
        const p = currentQueryParams[i];
        const isLast = (i === currentQueryParams.length - 1);
        const disabledClass = !p.enabled ? ' param-disabled' : '';
        const checkedAttr = p.enabled ? 'checked' : '';

        rowsHtml += '<tr class="param-row' + disabledClass + '" data-index="' + i + '">' +
          '<td style="text-align: center; vertical-align: middle; padding: 2px;">' +
            '<input type="checkbox" class="param-enabled" ' + checkedAttr + ' title="' + (p.enabled ? 'Disable parameter' : 'Enable parameter') + '">' +
          '</td>' +
          '<td style="padding: 2px 4px; border-right: 1px solid var(--vscode-input-border, #3e3e42);">' +
            '<input type="text" class="param-key" placeholder="Key" value="' + escapeHtml(p.key) + '">' +
          '</td>' +
          '<td style="padding: 2px 4px;">' +
            '<input type="text" class="param-value" placeholder="Value" value="' + escapeHtml(p.value) + '">' +
          '</td>' +
          '<td style="text-align: center; vertical-align: middle; padding: 2px;">' +
            (!isLast ? '<button type="button" class="remove-param-btn" title="Delete parameter">&times;</button>' : '') +
          '</td>' +
        '</tr>';
      }

      queryParamsBody.innerHTML = rowsHtml;
    }

    if (queryParamsBody) {
      queryParamsBody.addEventListener('change', (e) => {
        const target = e.target;
        if (target && target.classList.contains('param-enabled')) {
          const tr = target.closest('tr');
          const idx = parseInt(tr.getAttribute('data-index'), 10);
          if (currentQueryParams[idx]) {
            currentQueryParams[idx].enabled = target.checked;
            tr.classList.toggle('param-disabled', !target.checked);
            target.title = target.checked ? 'Disable parameter' : 'Enable parameter';
            syncParamsToUrl(true);
          }
        }
      });

      queryParamsBody.addEventListener('input', (e) => {
        const target = e.target;
        if (target && (target.classList.contains('param-key') || target.classList.contains('param-value'))) {
          const tr = target.closest('tr');
          const idx = parseInt(tr.getAttribute('data-index'), 10);
          if (currentQueryParams[idx]) {
            const keyInput = tr.querySelector('.param-key');
            const valInput = tr.querySelector('.param-value');
            currentQueryParams[idx].key = keyInput ? keyInput.value : '';
            currentQueryParams[idx].value = valInput ? valInput.value : '';

            if (idx === currentQueryParams.length - 1 && (currentQueryParams[idx].key || currentQueryParams[idx].value)) {
              currentQueryParams.push({ enabled: true, key: '', value: '' });
              const actionTd = tr.querySelector('td:last-child');
              if (actionTd && !actionTd.querySelector('.remove-param-btn')) {
                actionTd.innerHTML = '<button type="button" class="remove-param-btn" title="Delete parameter">&times;</button>';
              }
              const newIdx = currentQueryParams.length - 1;
              const newTr = document.createElement('tr');
              newTr.className = 'param-row';
              newTr.setAttribute('data-index', String(newIdx));
              newTr.innerHTML = '<td style="text-align: center; vertical-align: middle; padding: 2px;">' +
                '<input type="checkbox" class="param-enabled" checked title="Disable parameter">' +
              '</td>' +
              '<td style="padding: 2px 4px; border-right: 1px solid var(--vscode-input-border, #3e3e42);">' +
                '<input type="text" class="param-key" placeholder="Key" value="">' +
              '</td>' +
              '<td style="padding: 2px 4px;">' +
                '<input type="text" class="param-value" placeholder="Value" value="">' +
              '</td>' +
              '<td style="text-align: center; vertical-align: middle; padding: 2px;"></td>';
              queryParamsBody.appendChild(newTr);
            }

            syncParamsToUrl(false);
          }
        }
      });

      queryParamsBody.addEventListener('click', (e) => {
        const target = e.target;
        if (target && target.classList.contains('remove-param-btn')) {
          const tr = target.closest('tr');
          const idx = parseInt(tr.getAttribute('data-index'), 10);
          if (idx >= 0 && idx < currentQueryParams.length) {
            currentQueryParams.splice(idx, 1);
            renderQueryParamsTable();
            syncParamsToUrl(true);
          }
        }
      });
    }

    if (addParamRowBtn) {
      addParamRowBtn.onclick = () => {
        if (currentQueryParams.length === 0 ||
            currentQueryParams[currentQueryParams.length - 1].key !== '' ||
            currentQueryParams[currentQueryParams.length - 1].value !== '') {
          currentQueryParams.push({ enabled: true, key: '', value: '' });
          renderQueryParamsTable();
        }
        const rows = queryParamsBody ? queryParamsBody.querySelectorAll('.param-row') : [];
        if (rows.length > 0) {
          const lastRow = rows[rows.length - 1];
          const keyInput = lastRow.querySelector('.param-key');
          if (keyInput) keyInput.focus();
        }
      };
    }

    if (urlMethod) {
      urlMethod.addEventListener('change', toggleBodyGroup);
    }

    function showUrlModalAlert(text, isSuccess) {
      if (urlModalAlert) {
        urlModalAlert.textContent = text;
        urlModalAlert.style.display = 'block';
        if (isSuccess) {
          urlModalAlert.style.borderColor = 'var(--vscode-testing-iconPassed, #4ec9b0)';
          urlModalAlert.style.color = 'var(--vscode-testing-iconPassed, #4ec9b0)';
          urlModalAlert.style.backgroundColor = 'rgba(78, 201, 176, 0.1)';
        } else {
          urlModalAlert.style.borderColor = '';
          urlModalAlert.style.color = '';
          urlModalAlert.style.backgroundColor = '';
        }
      }
    }

    function clearUrlModalAlert() {
      if (urlModalAlert) {
        urlModalAlert.textContent = '';
        urlModalAlert.style.display = 'none';
        urlModalAlert.style.borderColor = '';
        urlModalAlert.style.color = '';
        urlModalAlert.style.backgroundColor = '';
      }
    }

    function setModalLoading(isLoading) {
      if (submitUrlModal) submitUrlModal.disabled = isLoading;
      if (cancelUrlModal) cancelUrlModal.disabled = isLoading;
      if (submitUrlSpinner) submitUrlSpinner.style.display = isLoading ? 'inline-block' : 'none';
      if (submitUrlText) submitUrlText.textContent = isLoading ? 'Fetching...' : 'Fetch & Bind';
    }

    function formatBytes(bytes) {
      if (bytes === 0 || !bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function renderHeadersTable(tbody, noHeadersEl, headers, filterText, sortAsc) {
      if (!tbody) return;
      tbody.innerHTML = '';

      const entries = Object.entries(headers || {});
      let filtered = filterText
        ? entries.filter(([k, v]) =>
            k.toLowerCase().includes(filterText.toLowerCase()) ||
            v.toLowerCase().includes(filterText.toLowerCase()))
        : entries;

      filtered.sort(([a], [b]) =>
        sortAsc ? a.localeCompare(b) : b.localeCompare(a)
      );

      if (filtered.length === 0) {
        if (noHeadersEl) noHeadersEl.style.display = 'block';
        const table = tbody.closest('table');
        if (table) table.style.display = 'none';
        return;
      }
      if (noHeadersEl) noHeadersEl.style.display = 'none';
      const table = tbody.closest('table');
      if (table) table.style.display = '';

      // Highlight important headers
      const important = new Set([
        'content-type', 'cache-control', 'content-length', 'authorization',
        'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
        'retry-after', 'set-cookie', 'etag', 'last-modified', 'expires',
        'access-control-allow-origin', 'strict-transport-security'
      ]);

      for (const [key, val] of filtered) {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom: 1px solid var(--vscode-input-border, #3e3e42);';
        const lowerKey = key.toLowerCase();
        const isImportant = important.has(lowerKey) || lowerKey.startsWith('x-ratelimit-') || lowerKey.startsWith('ratelimit-');

        const tdKey = document.createElement('td');
        tdKey.style.cssText = 'padding: 6px 10px; vertical-align: top; word-break: break-all; color: ' +
          (isImportant ? 'var(--vscode-textLink-foreground, #3794ff)' : 'var(--vscode-editor-foreground, #d4d4d4)') +
          '; font-weight: ' + (isImportant ? '600' : '400') + ';';
        tdKey.textContent = key;

        const tdVal = document.createElement('td');
        tdVal.style.cssText = 'padding: 6px 10px; vertical-align: top; word-break: break-all; color: var(--vscode-editor-foreground, #d4d4d4);';
        tdVal.textContent = val;

        tr.appendChild(tdKey);
        tr.appendChild(tdVal);
        tbody.appendChild(tr);
      }
    }

    const testUrlModal = document.getElementById('testUrlModal');
    const testUrlSpinner = document.getElementById('testUrlSpinner');
    const testUrlText = document.getElementById('testUrlText');
    const urlModalPreview = document.getElementById('urlModalPreview');
    const previewStatusBadge = document.getElementById('previewStatusBadge');
    const previewMeta = document.getElementById('previewMeta');
    const previewTabBar = document.getElementById('previewTabBar');
    const previewTabBody = document.getElementById('previewTabBody');
    const previewTabHeaders = document.getElementById('previewTabHeaders');
    const previewHeadersCount = document.getElementById('previewHeadersCount');
    const previewPaneBody = document.getElementById('previewPaneBody');
    const previewPaneHeaders = document.getElementById('previewPaneHeaders');
    const urlPreviewPre = document.getElementById('urlPreviewPre');
    const previewHeadersSearch = document.getElementById('previewHeadersSearch');
    const copyAllPreviewHeadersBtn = document.getElementById('copyAllPreviewHeadersBtn');
    const previewHeaderSortName = document.getElementById('previewHeaderSortName');
    const previewSortNameIcon = document.getElementById('previewSortNameIcon');
    const previewHeadersBody = document.getElementById('previewHeadersBody');
    const previewNoHeaders = document.getElementById('previewNoHeaders');

    let currentPreviewHeaders = null;
    let previewHeadersSortAsc = true;
    let previewHeadersFilterText = '';

    function switchPreviewTab(tab) {
      const isBody = tab === 'body';
      if (previewTabBody) previewTabBody.classList.toggle('active', isBody);
      if (previewTabHeaders) previewTabHeaders.classList.toggle('active', !isBody);
      if (previewPaneBody) previewPaneBody.style.display = isBody ? 'block' : 'none';
      if (previewPaneHeaders) previewPaneHeaders.style.display = isBody ? 'none' : 'block';
    }

    function setTestLoading(isLoading) {
      if (testUrlModal) testUrlModal.disabled = isLoading;
      if (testUrlSpinner) testUrlSpinner.style.display = isLoading ? 'inline-block' : 'none';
      if (testUrlText) testUrlText.textContent = isLoading ? 'Testing...' : 'Test Request';
    }

    function clearUrlPreview() {
      if (urlModalPreview) urlModalPreview.style.display = 'none';
      if (urlPreviewPre) urlPreviewPre.textContent = '';
      if (previewMeta) previewMeta.textContent = '';
      currentPreviewHeaders = null;
      previewHeadersSortAsc = true;
      previewHeadersFilterText = '';
      if (previewSortNameIcon) previewSortNameIcon.textContent = '\u2195';
      if (previewHeadersSearch) previewHeadersSearch.value = '';
      if (previewHeadersCount) previewHeadersCount.style.display = 'none';
      switchPreviewTab('body');
    }

    function renderUrlPreview(details) {
      setTestLoading(false);
      if (!urlModalPreview || !previewStatusBadge || !previewMeta || !urlPreviewPre) return;

      const status = details.status || 200;
      const statusText = details.statusText || 'OK';
      previewStatusBadge.textContent = status + ' ' + statusText;

      let badgeClass = 'status-badge status-2xx';
      if (status >= 300 && status < 400) badgeClass = 'status-badge status-3xx';
      else if (status >= 400 && status < 500) badgeClass = 'status-badge status-4xx';
      else if (status >= 500) badgeClass = 'status-badge status-5xx';
      previewStatusBadge.className = badgeClass;

      previewMeta.textContent = (details.timeMs !== undefined ? details.timeMs + 'ms' : '') +
        (details.sizeBytes !== undefined ? ' | ' + formatBytes(details.sizeBytes) : '');

      let bodyStr = '';
      if (details.data === null || details.data === undefined) {
        bodyStr = '(No response body)';
      } else if (typeof details.data === 'object') {
        try {
          bodyStr = JSON.stringify(details.data, null, 2);
        } catch (e) {
          bodyStr = String(details.data);
        }
      } else {
        bodyStr = String(details.data);
      }

      const MAX_PREVIEW_CHARS = 30000;
      if (bodyStr.length > MAX_PREVIEW_CHARS || details.isTruncated) {
        bodyStr = bodyStr.slice(0, MAX_PREVIEW_CHARS) + String.fromCharCode(10) + String.fromCharCode(10) +
          '... [Response preview truncated (' + formatBytes(details.sizeBytes) + ' total). Bind source or click 👁️ to view full data]';
      }

      urlPreviewPre.textContent = bodyStr;

      // Response headers setup
      currentPreviewHeaders = details.headers || null;
      const headerCount = currentPreviewHeaders ? Object.keys(currentPreviewHeaders).length : 0;
      if (previewHeadersCount) {
        if (headerCount > 0) {
          previewHeadersCount.textContent = String(headerCount);
          previewHeadersCount.style.display = 'inline-block';
        } else {
          previewHeadersCount.style.display = 'none';
        }
      }
      previewHeadersSortAsc = true;
      previewHeadersFilterText = '';
      if (previewSortNameIcon) previewSortNameIcon.textContent = '\u2195';
      if (previewHeadersSearch) previewHeadersSearch.value = '';
      switchPreviewTab('body');
      if (currentPreviewHeaders) {
        renderHeadersTable(previewHeadersBody, previewNoHeaders, currentPreviewHeaders, '', true);
      }

      urlModalPreview.style.opacity = '1';
      urlModalPreview.style.display = 'block';
    }

    function renderUrlPreviewError(error) {
      setTestLoading(false);
      showUrlModalAlert('Test failed: ' + (error || 'Unknown error'));
      clearUrlPreview();
    }

    if (previewTabBody) {
      previewTabBody.addEventListener('click', () => switchPreviewTab('body'));
    }
    if (previewTabHeaders) {
      previewTabHeaders.addEventListener('click', () => switchPreviewTab('headers'));
    }
    if (previewHeaderSortName) {
      previewHeaderSortName.addEventListener('click', () => {
        previewHeadersSortAsc = !previewHeadersSortAsc;
        if (previewSortNameIcon) previewSortNameIcon.textContent = previewHeadersSortAsc ? '\u2191' : '\u2193';
        if (currentPreviewHeaders) {
          renderHeadersTable(previewHeadersBody, previewNoHeaders, currentPreviewHeaders, previewHeadersFilterText, previewHeadersSortAsc);
        }
      });
    }
    if (previewHeadersSearch) {
      previewHeadersSearch.addEventListener('input', (e) => {
        previewHeadersFilterText = e.target.value;
        if (currentPreviewHeaders) {
          renderHeadersTable(previewHeadersBody, previewNoHeaders, currentPreviewHeaders, previewHeadersFilterText, previewHeadersSortAsc);
        }
      });
    }
    if (copyAllPreviewHeadersBtn) {
      copyAllPreviewHeadersBtn.addEventListener('click', () => {
        if (!currentPreviewHeaders) return;
        const text = Object.entries(currentPreviewHeaders)
          .map(([k, v]) => k + ': ' + v)
          .join(String.fromCharCode(10));
        vscode.postMessage({ type: 'copyToClipboard', text });
        const origText = copyAllPreviewHeadersBtn.textContent;
        copyAllPreviewHeadersBtn.textContent = '\u2713 Copied!';
        setTimeout(() => { copyAllPreviewHeadersBtn.textContent = origText; }, 1500);
      });
    }

    function openUrlModal(source) {
      clearUrlModalAlert();
      clearUrlPreview();
      setModalLoading(false);
      setTestLoading(false);
      if (source) {
        if (urlModalTitle) urlModalTitle.textContent = 'Edit URL Data Source (' + (source.alias || 'data') + ')';
        if (urlSourceId) urlSourceId.value = source.id || '';
        if (urlAlias) urlAlias.value = source.alias || 'data';
        if (urlMethod) urlMethod.value = source.method || 'GET';
        if (urlEndpoint) urlEndpoint.value = source.url || '';
        if (urlHeaders) {
          if (typeof source.headers === 'object' && source.headers !== null) {
            urlHeaders.value = Object.entries(source.headers).map(function(pair) { return pair[0] + ': ' + pair[1]; }).join(String.fromCharCode(10));
          } else {
            urlHeaders.value = source.headers || '';
          }
        }
        if (urlBody) urlBody.value = source.body || '';
      } else {
        if (urlModalTitle) urlModalTitle.textContent = 'Add URL Data Source';
        if (urlSourceId) urlSourceId.value = '';
        const hasData = (currentSources || []).some(s => s.alias === 'data');
        let suggestedAlias = hasData ? 'apiData' : 'data';
        let counter = 1;
        while ((currentSources || []).some(s => s.alias === suggestedAlias)) {
          counter++;
          suggestedAlias = 'apiData' + counter;
        }
        if (urlAlias) urlAlias.value = suggestedAlias;
        if (urlMethod) urlMethod.value = 'GET';
        if (urlEndpoint) urlEndpoint.value = '';
        if (urlHeaders) urlHeaders.value = '';
        if (urlBody) urlBody.value = '';
      }
      toggleBodyGroup();
      switchUrlTab('params');
      updateHeadersBadge();
      currentQueryParams = parseQueryParamsFromUrl(urlEndpoint ? urlEndpoint.value : '');
      renderQueryParamsTable();

      if (urlModal) urlModal.style.display = 'flex';
      setTimeout(() => {
        if (!source || !source.url) {
          if (urlEndpoint) urlEndpoint.focus();
        } else {
          if (urlAlias) urlAlias.focus();
        }
      }, 50);
    }

    function closeUrlModal() {
      if (urlModal) urlModal.style.display = 'none';
      if (curlImportPanel) curlImportPanel.style.display = 'none';
      if (curlImportInput) curlImportInput.value = '';
      if (syncParamsDebounceTimer) { clearTimeout(syncParamsDebounceTimer); syncParamsDebounceTimer = null; }
      if (syncUrlDebounceTimer) { clearTimeout(syncUrlDebounceTimer); syncUrlDebounceTimer = null; }
      clearUrlModalAlert();
      clearUrlPreview();
      setModalLoading(false);
      setTestLoading(false);
      currentQueryParams = [];
    }

    if (cancelUrlModal) cancelUrlModal.onclick = closeUrlModal;
    if (closeUrlModalBtn) closeUrlModalBtn.onclick = closeUrlModal;
    if (urlModal) {
      urlModal.addEventListener('click', (e) => {
        if (e.target === urlModal) {
          closeUrlModal();
        }
      });
    }

    if (testUrlModal) {
      testUrlModal.onclick = () => {
        flushSyncParamsToUrl();
        flushSyncUrlToTable();
        clearUrlModalAlert();
        clearUrlPreview();
        const url = (urlEndpoint?.value || '').trim();
        const method = urlMethod ? urlMethod.value : 'GET';
        const headers = urlHeaders ? urlHeaders.value : '';
        const body = urlBody ? urlBody.value : '';

        if (!url) {
          showUrlModalAlert('Please enter a URL to test.');
          if (urlEndpoint) urlEndpoint.focus();
          return;
        }
        const lowerUrl = url.toLowerCase();
        const hasTemplatePrefix = lowerUrl.startsWith('{{') || lowerUrl.startsWith('%7b%7b');
        if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !hasTemplatePrefix) {
          showUrlModalAlert('Invalid URL: must start with http://, https://, or a variable template like {{baseUrl}}');
          if (urlEndpoint) urlEndpoint.focus();
          return;
        }

        setTestLoading(true);
        vscode.postMessage({
          type: 'previewUrlSource',
          source: {
            url,
            method,
            headers,
            body
          }
        });
      };
    }

    if (submitUrlModal) {
      submitUrlModal.onclick = () => {
        flushSyncParamsToUrl();
        flushSyncUrlToTable();
        clearUrlModalAlert();
        const alias = (urlAlias?.value || '').trim();
        const url = (urlEndpoint?.value || '').trim();
        const method = urlMethod ? urlMethod.value : 'GET';
        const headers = urlHeaders ? urlHeaders.value : '';
        const body = urlBody ? urlBody.value : '';
        const id = urlSourceId?.value || undefined;

        if (!alias) {
          showUrlModalAlert('Please enter an alias for the source (e.g. data or api).');
          if (urlAlias) urlAlias.focus();
          return;
        }
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(alias)) {
          showUrlModalAlert('Invalid alias: must be a valid JavaScript identifier (letters, digits, _, $).');
          if (urlAlias) urlAlias.focus();
          return;
        }
        if (!url) {
          showUrlModalAlert('Please enter a URL (e.g. https://api.example.com/data).');
          if (urlEndpoint) urlEndpoint.focus();
          return;
        }
        const lowerUrl = url.toLowerCase();
        const hasTemplatePrefix = lowerUrl.startsWith('{{') || lowerUrl.startsWith('%7b%7b');
        if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !hasTemplatePrefix) {
          showUrlModalAlert('Invalid URL: must start with http://, https://, or a variable template like {{baseUrl}}');
          if (urlEndpoint) urlEndpoint.focus();
          return;
        }

        setModalLoading(true);
        vscode.postMessage({
          type: 'fetchUrlSource',
          source: {
            id,
            alias,
            url,
            method,
            headers,
            body
          }
        });
      };
    }

    if (importCurlBtn) {
      importCurlBtn.onclick = () => {
        if (!curlImportPanel) return;
        const isHidden = curlImportPanel.style.display === 'none' || !curlImportPanel.style.display;
        curlImportPanel.style.display = isHidden ? 'block' : 'none';
        if (isHidden && curlImportInput) {
          curlImportInput.focus();
          curlImportInput.select();
        }
      };
    }

    if (closeCurlImportBtn) {
      closeCurlImportBtn.onclick = () => {
        if (curlImportPanel) curlImportPanel.style.display = 'none';
      };
    }

    if (cancelCurlImportBtn) {
      cancelCurlImportBtn.onclick = () => {
        if (curlImportPanel) curlImportPanel.style.display = 'none';
      };
    }

    if (applyCurlImportBtn) {
      applyCurlImportBtn.onclick = () => {
        const raw = (curlImportInput ? curlImportInput.value : '').trim();
        if (!raw) {
          showUrlModalAlert('Please paste a cURL command first.');
          if (curlImportInput) curlImportInput.focus();
          return;
        }

        const parsed = parseCurl(raw);
        if (!parsed.url) {
          showUrlModalAlert('Could not find a valid URL in the pasted cURL command.');
          if (curlImportInput) curlImportInput.focus();
          return;
        }

        if (urlEndpoint) urlEndpoint.value = parsed.url;
        if (urlMethod) urlMethod.value = parsed.method || 'GET';
        if (urlHeaders) urlHeaders.value = parsed.headersString || '';
        if (urlBody) urlBody.value = parsed.body || '';

        // Auto-suggest alias if current alias is empty or default
        const currentAlias = (urlAlias ? urlAlias.value : '').trim();
        if (!currentAlias || currentAlias === 'data' || currentAlias === 'apiData' || currentAlias.indexOf('apiData') === 0) {
          try {
            const urlObj = new URL(parsed.url);
            const pathSegments = urlObj.pathname.split('/').filter(Boolean);
            let candidate = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : urlObj.hostname.replace(/[^a-zA-Z0-9_$]/g, '');
            candidate = candidate.replace(/[^a-zA-Z0-9_$]/g, '');
            if (/^[0-9]/.test(candidate)) candidate = 'api_' + candidate;
            if (candidate && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(candidate)) {
              if (urlAlias) urlAlias.value = candidate;
            }
          } catch (e) {}
        }

        toggleBodyGroup();
        if (parsed.method !== 'GET' && parsed.method !== 'HEAD' && parsed.body) {
          switchUrlTab('body');
        } else {
          switchUrlTab('params');
        }

        updateHeadersBadge();
        currentQueryParams = parseQueryParamsFromUrl(parsed.url);
        renderQueryParamsTable();

        if (curlImportPanel) curlImportPanel.style.display = 'none';
        if (curlImportInput) curlImportInput.value = '';
        showUrlModalAlert('✓ cURL command imported successfully.', true);
        setTimeout(clearUrlModalAlert, 3000);
      };
    }

    if (copyCurlBtn) {
      copyCurlBtn.onclick = () => {
        flushSyncParamsToUrl();
        flushSyncUrlToTable();
        clearUrlModalAlert();

        const url = (urlEndpoint ? urlEndpoint.value : '').trim();
        const method = urlMethod ? urlMethod.value : 'GET';
        const headers = urlHeaders ? urlHeaders.value : '';
        const body = urlBody ? urlBody.value : '';

        if (!url) {
          showUrlModalAlert('Please enter a URL first.');
          if (urlEndpoint) urlEndpoint.focus();
          return;
        }

        const curlCmd = generateCurl({ url, method, headers, body });
        vscode.postMessage({ type: 'copyToClipboard', text: curlCmd });

        const originalText = copyCurlBtn.textContent;
        copyCurlBtn.textContent = '✓ Copied cURL!';
        setTimeout(() => {
          copyCurlBtn.textContent = originalText;
        }, 1500);
      };
    }

    // Source Inspection Modal Controller (Option A)
    const sourceInspectModal = document.getElementById('sourceInspectModal');
    const inspectModalTitle = document.getElementById('inspectModalTitle');
    const inspectModalTypeBadge = document.getElementById('inspectModalTypeBadge');
    const inspectStatusBadge = document.getElementById('inspectStatusBadge');
    const closeInspectModalBtn = document.getElementById('closeInspectModal');
    const inspectSourceDetails = document.getElementById('inspectSourceDetails');
    const inspectDataPre = document.getElementById('inspectDataPre');
    const inspectDataMeta = document.getElementById('inspectDataMeta');
    const copyInspectBtn = document.getElementById('copyInspectBtn');
    const copyInspectCurlBtn = document.getElementById('copyInspectCurlBtn');
    const openInspectInEditorBtn = document.getElementById('openInspectInEditorBtn');
    const dismissInspectBtn = document.getElementById('dismissInspectBtn');
    const inspectTabBody = document.getElementById('inspectTabBody');
    const inspectTabHeaders = document.getElementById('inspectTabHeaders');
    const inspectPaneBody = document.getElementById('inspectPaneBody');
    const inspectPaneHeaders = document.getElementById('inspectPaneHeaders');
    const inspectHeadersBody = document.getElementById('inspectHeadersBody');
    const inspectHeadersCount = document.getElementById('inspectHeadersCount');
    const inspectHeadersSearch = document.getElementById('inspectHeadersSearch');
    const inspectNoHeaders = document.getElementById('inspectNoHeaders');
    const copyAllHeadersBtn = document.getElementById('copyAllHeadersBtn');
    const inspectHeaderSortName = document.getElementById('inspectHeaderSortName');
    const inspectSortNameIcon = document.getElementById('inspectSortNameIcon');

    let currentInspectDataText = '';
    let currentInspectSource = null;
    let currentInspectHeaders = null; // Record<string, string> | null
    let inspectHeadersSortAsc = true;
    let inspectHeadersFilterText = '';

    function switchInspectTab(tab) {
      const isBody = tab === 'body';
      if (inspectTabBody) inspectTabBody.classList.toggle('active', isBody);
      if (inspectTabHeaders) inspectTabHeaders.classList.toggle('active', !isBody);
      if (inspectPaneBody) inspectPaneBody.style.display = isBody ? 'block' : 'none';
      if (inspectPaneHeaders) inspectPaneHeaders.style.display = isBody ? 'none' : 'block';
      // Update Copy button label when tab changes
      if (copyInspectBtn) {
        var clipEmoji = String.fromCodePoint(0x1F4CB);
        copyInspectBtn.textContent = isBody ? clipEmoji + ' Copy' : clipEmoji + ' Copy Headers';
      }
      if (openInspectInEditorBtn) {
        openInspectInEditorBtn.title = isBody ? 'Open this data in a new VS Code editor tab' : 'Open response headers in a new VS Code editor tab';
      }
    }

    function renderInspectHeadersTable(headers, filterText, sortAsc) {
      renderHeadersTable(inspectHeadersBody, inspectNoHeaders, headers, filterText, sortAsc);
    }

    function openSourceInspectModal(source, data) {
      if (!sourceInspectModal) return;
      currentInspectSource = source;
      inspectHeadersSortAsc = true;
      inspectHeadersFilterText = '';
      if (inspectSortNameIcon) inspectSortNameIcon.textContent = '\u2195';
      if (inspectHeadersSearch) inspectHeadersSearch.value = '';

      // Always start on body tab
      switchInspectTab('body');

      const isUrl = source.type === 'url' || !!source.url;
      if (copyInspectCurlBtn) {
        copyInspectCurlBtn.style.display = isUrl ? 'inline-block' : 'none';
      }
      if (inspectModalTitle) {
        inspectModalTitle.textContent = 'Data Source: ' + (source.alias || 'data');
      }
      if (inspectModalTypeBadge) {
        inspectModalTypeBadge.style.display = 'inline-block';
        if (isUrl) {
          inspectModalTypeBadge.textContent = 'URL (' + (source.method || 'GET') + ')';
          inspectModalTypeBadge.className = 'status-badge status-3xx';
        } else {
          inspectModalTypeBadge.textContent = 'FILE';
          inspectModalTypeBadge.className = 'status-badge status-2xx';
        }
      }

      // HTTP status badge
      const status = source.lastStatus;
      if (inspectStatusBadge) {
        if (isUrl && status) {
          const statusText = source.lastStatusText || 'OK';
          inspectStatusBadge.textContent = status + ' ' + statusText;
          let cls = 'status-badge status-2xx';
          if (status >= 300 && status < 400) cls = 'status-badge status-3xx';
          else if (status >= 400 && status < 500) cls = 'status-badge status-4xx';
          else if (status >= 500) cls = 'status-badge status-5xx';
          inspectStatusBadge.className = cls;
          inspectStatusBadge.style.display = 'inline-block';
        } else {
          inspectStatusBadge.style.display = 'none';
        }
      }

      // Response headers tab visibility
      const responseHeaders = isUrl ? (source.lastResponseHeaders || null) : null;
      currentInspectHeaders = responseHeaders;
      const headerCount = responseHeaders ? Object.keys(responseHeaders).length : 0;
      if (inspectTabHeaders) {
        inspectTabHeaders.style.display = isUrl ? 'inline-flex' : 'none';
      }
      if (inspectHeadersCount) {
        if (headerCount > 0) {
          inspectHeadersCount.textContent = String(headerCount);
          inspectHeadersCount.style.display = 'inline-block';
        } else {
          inspectHeadersCount.style.display = 'none';
        }
      }
      if (responseHeaders) {
        renderInspectHeadersTable(responseHeaders, '', true);
      }

      if (inspectSourceDetails) {
        if (isUrl) {
          let detailsHtml = '<div><strong>URL:</strong> ' + escapeHtml(source.url || '') + '</div>';
          if (source.lastFetched) {
            detailsHtml += '<div><strong>Last Fetched:</strong> ' + new Date(source.lastFetched).toLocaleString() + '</div>';
          }
          inspectSourceDetails.innerHTML = detailsHtml;
        } else {
          inspectSourceDetails.innerHTML = '<div><strong>Path:</strong> ' + escapeHtml(source.label || '') + '</div>';
        }
      }

      let formatted = '';
      if (data === null || data === undefined) {
        formatted = '(empty / null)';
      } else if (typeof data === 'object') {
        try {
          formatted = JSON.stringify(data, null, 2);
        } catch (e) {
          formatted = String(data);
        }
      } else {
        formatted = String(data);
      }
      currentInspectDataText = formatted;

      const MAX_INSPECT_CHARS = 100000;
      let displayContent = formatted;
      if (formatted.length > MAX_INSPECT_CHARS) {
        displayContent = formatted.slice(0, MAX_INSPECT_CHARS) + String.fromCharCode(10) + String.fromCharCode(10) +
          '... [Display truncated for performance. Showing first 100KB of ' + formatBytes(formatted.length) + '. Click "\u2197 Open in VS Code Tab" to view all ' + formatted.split(String.fromCharCode(10)).length + ' lines in editor]';
      }

      if (inspectDataPre) {
        inspectDataPre.textContent = displayContent;
      }
      if (inspectDataMeta) {
        const lineCount = formatted.split(String.fromCharCode(10)).length;
        inspectDataMeta.textContent = lineCount + ' lines | ' + formatBytes(formatted.length);
      }

      sourceInspectModal.style.display = 'flex';
    }

    function closeSourceInspectModal() {
      if (sourceInspectModal) sourceInspectModal.style.display = 'none';
      currentInspectDataText = '';
      currentInspectSource = null;
      currentInspectHeaders = null;
    }


    if (closeInspectModalBtn) closeInspectModalBtn.onclick = closeSourceInspectModal;
    if (dismissInspectBtn) dismissInspectBtn.onclick = closeSourceInspectModal;
    if (sourceInspectModal) {
      sourceInspectModal.addEventListener('click', (e) => {
        if (e.target === sourceInspectModal) {
          closeSourceInspectModal();
        }
      });
    }

    // Tab switching
    if (inspectTabBody) {
      inspectTabBody.addEventListener('click', () => switchInspectTab('body'));
    }
    if (inspectTabHeaders) {
      inspectTabHeaders.addEventListener('click', () => switchInspectTab('headers'));
    }

    // Sort by name toggle
    if (inspectHeaderSortName) {
      inspectHeaderSortName.addEventListener('click', () => {
        inspectHeadersSortAsc = !inspectHeadersSortAsc;
        if (inspectSortNameIcon) inspectSortNameIcon.textContent = inspectHeadersSortAsc ? '\u2191' : '\u2193';
        if (currentInspectHeaders) {
          renderInspectHeadersTable(currentInspectHeaders, inspectHeadersFilterText, inspectHeadersSortAsc);
        }
      });
    }

    // Filter input
    if (inspectHeadersSearch) {
      inspectHeadersSearch.addEventListener('input', (e) => {
        inspectHeadersFilterText = e.target.value;
        if (currentInspectHeaders) {
          renderInspectHeadersTable(currentInspectHeaders, inspectHeadersFilterText, inspectHeadersSortAsc);
        }
      });
    }

    // Copy all headers as "Header-Name: value" lines
    if (copyAllHeadersBtn) {
      copyAllHeadersBtn.addEventListener('click', () => {
        if (!currentInspectHeaders) return;
        const text = Object.entries(currentInspectHeaders)
          .map(([k, v]) => k + ': ' + v)
          .join(String.fromCharCode(10));
        vscode.postMessage({ type: 'copyToClipboard', text });
        const origText = copyAllHeadersBtn.textContent;
        copyAllHeadersBtn.textContent = '\u2713 Copied!';
        setTimeout(() => { copyAllHeadersBtn.textContent = origText; }, 1500);
      });
    }

    if (copyInspectBtn) {
      copyInspectBtn.onclick = () => {
        // Determine active tab
        const isHeadersActive = inspectTabHeaders && inspectTabHeaders.classList.contains('active');
        if (isHeadersActive && currentInspectHeaders) {
          const text = Object.entries(currentInspectHeaders)
            .map(([k, v]) => k + ': ' + v)
            .join(String.fromCharCode(10));
          vscode.postMessage({ type: 'copyToClipboard', text });
        } else {
          if (!currentInspectDataText) return;
          vscode.postMessage({ type: 'copyToClipboard', text: currentInspectDataText });
        }
        const originalText = copyInspectBtn.textContent;
        copyInspectBtn.textContent = '\u2713 Copied!';
        setTimeout(() => {
          copyInspectBtn.textContent = originalText;
        }, 1500);
      };
    }

    if (copyInspectCurlBtn) {
      copyInspectCurlBtn.onclick = () => {
        if (!currentInspectSource || (!currentInspectSource.url && currentInspectSource.type !== 'url')) return;
        const curlCmd = generateCurl({
          url: currentInspectSource.url || '',
          method: currentInspectSource.method || 'GET',
          headers: currentInspectSource.headers,
          body: currentInspectSource.body
        });
        vscode.postMessage({ type: 'copyToClipboard', text: curlCmd });
        const originalText = copyInspectCurlBtn.textContent;
        copyInspectCurlBtn.textContent = '\u2713 Copied cURL!';
        setTimeout(() => {
          copyInspectCurlBtn.textContent = originalText;
        }, 1500);
      };
    }

    if (openInspectInEditorBtn) {
      openInspectInEditorBtn.onclick = () => {
        const isHeadersActive = inspectTabHeaders && inspectTabHeaders.classList.contains('active');
        if (isHeadersActive && currentInspectHeaders) {
          const text = Object.entries(currentInspectHeaders)
            .map(([k, v]) => k + ': ' + v)
            .join(String.fromCharCode(10));
          vscode.postMessage({
            type: 'openInEditor',
            text: text,
            language: 'http'
          });
          return;
        }
        if (!currentInspectDataText) return;
        vscode.postMessage({
          type: 'openInEditor',
          text: currentInspectDataText,
          language: 'json'
        });
      };
    }


  </script>
</body>

</html>`;

}
