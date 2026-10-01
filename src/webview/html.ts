import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BoundFile, SerializedBoundSource } from '../types';
import { tokenizeArgs, parseCurl, generateCurl } from '../curl';

export { tokenizeArgs, parseCurl, generateCurl };

export function nonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

import { escapeHtml } from '../helpers';
const escapeHtmlStr = escapeHtml;

export function getQueryEditorHtml(
  webview: vscode.Webview,
  params: {
    boundFiles?: BoundFile[];
    sources?: SerializedBoundSource[];
    scriptNonce: string;
    environments?: string[];
    activeEnvironment?: string;
    environmentVariables?: Record<string, string>;
  }
) {
  const n = params.scriptNonce;
  const sources: SerializedBoundSource[] = params.sources ?? (params.boundFiles || []).map(f => ({
    type: 'file' as const,
    alias: f.alias,
    label: vscode.workspace.asRelativePath(f.uri)
  }));

  const initialSourcesJson = JSON.stringify(sources).replace(/</g, '\\u003c');
  const envList = params.environments || [];
  const currentActiveEnv = params.activeEnvironment || '';
  const envOptionsHtml = envList.map(env =>
    `<option value="${escapeHtmlStr(env)}"${env === currentActiveEnv ? ' selected' : ''}>${escapeHtmlStr(env)}</option>`
  ).join('');
  const initialEnvsJson = JSON.stringify(envList).replace(/</g, '\\u003c');
  const initialActiveEnvJson = JSON.stringify(currentActiveEnv).replace(/</g, '\\u003c');
  const initialEnvVarsJson = JSON.stringify(params.environmentVariables || {}).replace(/</g, '\\u003c');

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
        <button class="remove-source" data-alias="${escapeHtmlStr(s.alias)}" data-id="${escapeHtmlStr(s.id || '')}" title="Remove source" aria-label="Remove source">×</button>
      </span>`;
    }
    return `<span class="bound-file" data-alias="${escapeHtmlStr(s.alias)}" title="${escapeHtmlStr(s.label)}">
      <span class="file-icon">📁</span>
      <span class="file-alias">${escapeHtmlStr(s.alias)}</span>: ${escapeHtmlStr(s.label.split('/').pop() || s.label)}
      <button class="inspect-source-btn" data-alias="${escapeHtmlStr(s.alias)}" title="View JSON data">👁️</button>
      <button class="remove-source" data-alias="${escapeHtmlStr(s.alias)}" title="Remove source" aria-label="Remove source">×</button>
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
      min-height: 100vh;
      overflow-y: auto;
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
    .benchmark-meter {
      display: none;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--vscode-badge-background, rgba(128, 128, 128, 0.15));
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
      color: var(--vscode-badge-foreground, var(--vscode-foreground, #cccccc));
      font-family: var(--vscode-editor-font-family, monospace);
      user-select: none;
      line-height: 1.3;
    }
    .test-suite-badge {
      display: none;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      user-select: none;
      line-height: 1.3;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .test-suite-badge.badge-passed {
      background: rgba(46, 160, 67, 0.15);
      border: 1px solid rgba(46, 160, 67, 0.4);
      color: var(--vscode-testing-iconPassed, #73c991);
    }
    .test-suite-badge.badge-failed {
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid rgba(248, 81, 73, 0.4);
      color: var(--vscode-testing-iconFailed, #f14c4c);
    }
    .tests-summary-banner {
      background: var(--vscode-textCodeBlock-background, #252526);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 12px;
    }
    .tests-summary-banner.tests-passed-banner {
      border-left: 4px solid var(--vscode-testing-iconPassed, #73c991);
    }
    .tests-summary-banner.tests-failed-banner {
      border-left: 4px solid var(--vscode-testing-iconFailed, #f14c4c);
    }
    .tests-progress-bar {
      height: 4px;
      background: rgba(128, 128, 128, 0.2);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 10px;
    }
    .tests-progress-fill {
      height: 100%;
      transition: width 0.3s ease;
    }
    .tests-progress-fill.fill-passed {
      background: var(--vscode-testing-iconPassed, #73c991);
    }
    .tests-progress-fill.fill-failed {
      background: var(--vscode-testing-iconFailed, #f14c4c);
    }
    .test-filter-btn {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 3px;
      padding: 3px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .test-filter-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .test-filter-btn.active {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border-color: var(--vscode-focusBorder, #007acc);
      font-weight: 600;
    }
    .test-card {
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      overflow: hidden;
      transition: border-color 0.2s ease;
    }
    .test-card:hover {
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .test-card-passed {
      border-left: 3px solid var(--vscode-testing-iconPassed, #73c991);
    }
    .test-card-failed {
      border-left: 3px solid var(--vscode-testing-iconFailed, #f14c4c);
    }
    .test-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      user-select: none;
    }
    .test-status-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      font-size: 11px;
      font-weight: bold;
    }
    .test-status-icon.icon-pass {
      color: var(--vscode-testing-iconPassed, #73c991);
    }
    .test-status-icon.icon-fail {
      color: var(--vscode-testing-iconFailed, #f14c4c);
    }
    .test-duration-pill {
      font-size: 10px;
      color: var(--vscode-descriptionForeground, #858585);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .test-card-toggle {
      font-size: 9px;
      color: var(--vscode-descriptionForeground, #858585);
      margin-left: 4px;
    }
    .test-card-body {
      padding: 8px 12px 10px 36px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.15));
      background: rgba(0, 0, 0, 0.12);
    }
    .test-error-message {
      color: var(--vscode-testing-iconFailed, #f14c4c);
      font-weight: 500;
      font-size: 11px;
      margin-bottom: 6px;
      word-break: break-word;
    }
    .test-diff-box {
      background: var(--vscode-textCodeBlock-background, #252526);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 3px;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-x: auto;
    }
    .test-diff-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }
    .test-diff-row .diff-label {
      font-weight: bold;
      min-width: 65px;
      color: var(--vscode-descriptionForeground, #858585);
    }
    .test-diff-row.expected .diff-val {
      color: var(--vscode-testing-iconPassed, #73c991);
    }
    .test-diff-row.actual .diff-val {
      color: var(--vscode-testing-iconFailed, #f14c4c);
    }

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
    @keyframes livePulse {
      0% { transform: scale(0.9); opacity: 0.7; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.7; }
    }
    .live-dot {
      animation: livePulse 1.4s infinite ease-in-out;
    }
    .toggle-stream-btn {
      background: none;
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 3px;
      color: var(--vscode-foreground, #cccccc);
      font-size: 10px;
      cursor: pointer;
      padding: 1px 5px;
      margin-left: 3px;
      line-height: 1.2;
    }
    .toggle-stream-btn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .toggle-stream-btn.active-stream {
      background: rgba(78, 201, 176, 0.15);
      border-color: #4ec9b0;
      color: #4ec9b0;
      font-weight: 600;
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
    .editor-mode-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--vscode-input-border, #3e3e42);
      padding-bottom: 4px;
    }
    .editor-mode-tab {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px 4px 0 0;
      color: var(--vscode-descriptionForeground, #858585);
      font-size: 12px;
      font-weight: 600;
      padding: 5px 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      user-select: none;
    }
    .editor-mode-tab:hover {
      color: var(--vscode-foreground, #cccccc);
      background: rgba(255, 255, 255, 0.04);
    }
    .editor-mode-tab.active {
      color: var(--vscode-foreground, #ffffff);
      background: var(--vscode-editor-background, #1e1e1e);
      border-color: var(--vscode-input-border, #3e3e42);
      border-bottom-color: transparent;
      margin-bottom: -5px;
      padding-bottom: 6px;
      border-top: 2px solid var(--vscode-textLink-foreground, #3794ff);
    }
    .tests-count-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--vscode-badge-background, #007acc);
      color: var(--vscode-badge-foreground, #ffffff);
      line-height: 1.2;
    }
    .pipeline-stage-ribbon {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .pipeline-step-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: var(--vscode-input-background, #3c3c3c);
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .pipeline-step-pill:hover {
      border-color: var(--vscode-focusBorder, #007acc);
      background: rgba(255, 255, 255, 0.06);
    }
    .pipeline-step-pill.active {
      border-color: var(--vscode-textLink-foreground, #3794ff);
      box-shadow: 0 0 0 1px var(--vscode-textLink-foreground, #3794ff);
      background: rgba(55, 148, 255, 0.12);
      font-weight: 600;
    }
    .pipeline-step-pill.previewing {
      border-left: 3px solid #4ec9b0;
    }
    .pipeline-step-pill.disabled-step {
      opacity: 0.55;
      text-decoration: line-through;
    }
    .pipeline-step-pill.error-step {
      border-color: var(--vscode-errorForeground, #f48771);
      color: var(--vscode-errorForeground, #f48771);
    }
    .pipeline-step-arrow {
      color: var(--vscode-descriptionForeground, #858585);
      font-size: 11px;
      user-select: none;
    }
    .pipeline-step-badge {
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.1);
      font-weight: normal;
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
    body.layout-split {
      overflow: hidden;
      height: 100vh;
    }
    .workspace-layout {
      display: flex;
      flex: 1;
      width: 100%;
      min-height: 0;
    }
    .workspace-layout.stacked {
      flex-direction: column;
    }
    .workspace-layout.split {
      flex-direction: row;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .workspace-pane {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .workspace-layout.stacked .workspace-pane {
      width: 100%;
    }
    .workspace-layout.split .editor-pane {
      flex: 1 1 50%;
      min-width: 320px;
      border-right: 1px solid var(--vscode-panel-border, #3e3e42);
      overflow-y: auto;
      height: 100%;
    }
    .workspace-layout.split .result-pane {
      flex: 1 1 50%;
      min-width: 320px;
      overflow-y: auto;
      height: 100%;
    }
    .workspace-layout.split #result {
      border-top: none;
      height: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .workspace-layout.split #resultContainer {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .workspace-layout.split #resultContainer .CodeMirror {
      flex: 1;
      height: 100% !important;
      min-height: 350px;
    }
    .workspace-layout.split #resultPre {
      flex: 1;
      min-height: 350px;
    }
    .workspace-layout.split #editorRow .CodeMirror {
      height: 240px !important;
    }
    .workspace-layout.split #history {
      border-top: 1px solid var(--vscode-panel-border, #3e3e42);
      max-height: 320px;
    }
    #toggleAiDrawerBtn.active, #layoutToggleBtn.active {
      background: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.15));
      border-color: var(--vscode-focusBorder, #007acc);
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .ai-drawer {
      transition: all 0.2s ease;
    }

    @media (max-width: 768px) {
      body.layout-split {
        overflow: auto !important;
        height: auto !important;
      }
      .workspace-layout.split {
        flex-direction: column !important;
        height: auto !important;
        overflow: visible !important;
      }
      .workspace-layout.split .editor-pane,
      .workspace-layout.split .result-pane {
        width: 100% !important;
        flex: 1 1 100% !important;
        border-right: none !important;
        height: auto !important;
      }
      .workspace-layout.split #resultContainer .CodeMirror {
        height: 200px !important;
        min-height: 150px;
      }
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
    #visualLensBar {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      margin-bottom: 10px;
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(58, 61, 65, 0.4));
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 4px;
      font-size: 11px;
      flex-wrap: wrap;
      gap: 8px;
    }
    #resultTable th, #resultTable td {
      cursor: pointer;
    }
    #resultTable th:hover {
      background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.08)) !important;
    }
    #resultTable td:hover {
      background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
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
      <button id="toggleAiDrawerBtn" class="secondary" title="Toggle AI Query Assistant Panel">🤖 AI Assistant</button>
      <button id="layoutToggleBtn" class="secondary" title="Toggle Side-by-Side (Split) / Stacked Layout Mode"><span id="layoutToggleIcon">◫</span> <span id="layoutToggleLabel">Split View</span></button>
      <div class="env-selector-container" style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #252526);" title="Active Environment for Request Fetcher and Template Variables">
        <span style="font-size: 11px; opacity: 0.85; display: inline-flex; align-items: center; gap: 3px;">🌐</span>
        <select id="envSelect" style="padding: 2px 4px; font-size: 11px; border: none; background: transparent; color: var(--vscode-input-foreground, #cccccc); cursor: pointer; outline: none;" title="Select active environment (local, staging, production, etc.)">
          <option value="">(No Environment)</option>
          ${envOptionsHtml}
        </select>
        <button id="manageEnvBtn" class="secondary" style="padding: 2px 5px; font-size: 10px; border: none; background: transparent; cursor: pointer;" title="Manage environments (.json-tools/environments.json)">⚙️</button>
      </div>
      <button id="scratchpadBtn" class="secondary" title="Switch to Standalone Scratchpad Mode (generate mocks, test expressions without bound sources)">⚡ Scratchpad</button>
      <button id="rebind" class="secondary" title="Rebind 'data' to currently focused editor">🔄 Rebind</button>
    </div>
  </header>


  <div id="aiDrawer" class="row ai-drawer" style="display: none; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 14px 20px; flex-direction: column; gap: 10px;">
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

  <div id="workspaceLayout" class="workspace-layout stacked">
    <div id="editorPane" class="workspace-pane editor-pane">
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

      <div id="editorRow" class="row editor-row">
    <div id="editorModeBar" class="editor-mode-bar">
      <button id="modeQueryBtn" class="editor-mode-tab active" type="button" title="Query Transformation Editor (JavaScript expression)">
        <span>⚡</span> Query
      </button>
      <button id="modePipelineBtn" class="editor-mode-tab" type="button" title="Interactive Data Pipeline (Chain multi-step transformations)">
        <span>⛓️</span> Pipeline <span id="pipelineStepCountBadge" class="tests-count-badge" style="display: none;">0</span>
      </button>
      <button id="modeTestsBtn" class="editor-mode-tab" type="button" title="Test Suite Editor (Write unit assertions &amp; contract tests)">
        <span>🧪</span> Test Suite <span id="testsCountBadge" class="tests-count-badge" style="display: none;">0</span>
      </button>
      <div class="editor-mode-bar-right" style="margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: var(--vscode-descriptionForeground, #858585);">
        <span>Toggle: <kbd style="background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.15); font-size: 10px;">Ctrl+Shift+E</kbd></span>
      </div>
    </div>
    <!-- Visual Stage Ribbon for Pipeline Mode -->
    <div id="pipelineStageRibbon" class="pipeline-stage-ribbon" style="display: none;">
      <div id="pipelineStepsList" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;"></div>
      <button id="addPipelineStepBtn" class="secondary" style="padding: 3px 8px; font-size: 11px; white-space: nowrap;" title="Append a new transformation step to the pipeline">+ Add Step</button>
    </div>
    <!-- Step Configuration Bar for Active Step in Pipeline Mode -->
    <div id="pipelineStepConfigBar" class="pipeline-step-config-bar" style="display: none; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; font-size: 11px; padding: 4px 8px; background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px;">
      <div style="display: inline-flex; align-items: center; gap: 6px;">
        <label for="stepNameInput" style="color: var(--vscode-descriptionForeground, #858585); font-weight: 500;">Step:</label>
        <input id="stepNameInput" type="text" placeholder="e.g. Filter Active" style="padding: 2px 6px; font-size: 11px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-input-foreground, #cccccc); width: 130px;" />
      </div>
      <div style="display: inline-flex; align-items: center; gap: 6px;">
        <label for="stepAliasInput" style="color: var(--vscode-descriptionForeground, #858585); font-weight: 500;">Alias:</label>
        <input id="stepAliasInput" type="text" placeholder="e.g. step1" style="padding: 2px 6px; font-size: 11px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-input-foreground, #cccccc); width: 75px; font-family: monospace;" />
      </div>
      <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
        <input id="stepEnabledCheckbox" type="checkbox" checked style="cursor: pointer;" />
        <span>Enabled</span>
      </label>
      <span style="color: var(--vscode-descriptionForeground, #858585); font-size: 10px;">Scope: <code>input</code>, <code>prev</code>, <code>data</code>, step aliases</span>
      <div style="margin-left: auto; display: inline-flex; align-items: center; gap: 6px;">
        <button id="moveStepUpBtn" class="secondary" style="padding: 2px 6px; font-size: 11px;" title="Move this step earlier">⬆</button>
        <button id="moveStepDownBtn" class="secondary" style="padding: 2px 6px; font-size: 11px;" title="Move this step later">⬇</button>
        <button id="duplicateStepBtn" class="secondary" style="padding: 2px 6px; font-size: 11px;" title="Duplicate this step">📋</button>
        <button id="removeStepBtn" class="secondary" style="padding: 2px 6px; font-size: 11px; color: var(--vscode-errorForeground, #f48771);" title="Delete this step">🗑</button>
      </div>
    </div>
    <textarea id="expr" placeholder=".filter(x=>x.active).map(x=>({name:x.name})) — Template vars: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}"></textarea>
    <div id="editorKeyboardHint" class="keyboard-hint">Press <kbd>Ctrl+Enter</kbd> to run | <kbd>Ctrl+Shift+T</kbd> to run tests | <kbd>Ctrl+S</kbd> to save</div>
  </div>
  <div id="queryToolbar" class="row" style="gap: 10px; flex-wrap: wrap; align-items: center;">
    <button id="run" class="primary">▶ Run</button>
    <button id="runTestsBtn" class="secondary" style="display: inline-flex; align-items: center; gap: 5px;" title="Run Contract / Assertion Tests (Ctrl+Shift+T)">🧪 Run Tests</button>
    <button id="save" class="secondary">★ Save</button>
    <button id="beautify" class="secondary">✨ Beautify</button>
    <button id="clear" class="secondary">🗑 Clear</button>
    <button id="toggleConsoleBtn" class="secondary" style="display: inline-flex; align-items: center; gap: 5px;" title="Toggle Console Output Drawer">📟 Console <span id="consoleBadge" style="display: none; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #ffffff); border-radius: 10px; padding: 1px 6px; font-size: 10px; font-weight: bold;">0</span></button>
    <select id="snippetSelect" style="padding: 6px 10px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; font-family: inherit;" title="Insert common JavaScript transformation snippet">
      <option value="" disabled selected>💡 Snippets...</option>
      <optgroup label="Assertions &amp; API Tests">
        <option value="test_contract">API Contract Test Suite (test &amp; expect)</option>
        <option value="test_status_schema">Status &amp; Property Validation</option>
        <option value="test_array_items">Array Items Deep Assertions</option>
      </optgroup>
      <optgroup label="Grouping &amp; Counting">
        <option value="group_by">Group by Property (Object.groupBy)</option>
        <option value="group_by_reduce">Group by Property (reduce)</option>
        <option value="group_count">Group and Count Occurrences</option>
      </optgroup>
      <optgroup label="Aggregation &amp; Stats">
        <option value="sum">Sum Property</option>
        <option value="average">Average Property</option>
        <option value="min_max">Min &amp; Max Values</option>
        <option value="stats_summary">Stats Summary (Count, Sum, Avg, Min, Max)</option>
      </optgroup>
      <optgroup label="Flattening &amp; Unwinding">
        <option value="flatten_flatmap">Flatten Nested Arrays (flatMap)</option>
        <option value="flatten_deep">Flatten Deeply (flat Infinity)</option>
        <option value="unwind_tags">Unwind Array Property</option>
      </optgroup>
      <optgroup label="Filtering &amp; Slicing">
        <option value="filter_date">Filter by Date Range</option>
        <option value="filter_recent">Filter Recent (Last 7 Days)</option>
        <option value="top_n">Top 10 by Property</option>
      </optgroup>
      <optgroup label="Pick, Omit &amp; Rename">
        <option value="pick_keys">Pick Specific Keys</option>
        <option value="omit_keys">Omit Sensitive Keys</option>
        <option value="rename_keys">Rename Keys</option>
      </optgroup>
      <optgroup label="Deduplication">
        <option value="unique_by_id">Unique by Key / ID</option>
        <option value="unique_primitives">Unique Primitive Values (Set)</option>
      </optgroup>
      <optgroup label="Objects &amp; Multi-Source">
        <option value="entries_to_obj">Key-Value Array to Object</option>
        <option value="obj_to_entries">Object Dictionary to Array</option>
        <option value="multi_join">Join Two Sources (users + orders)</option>
      </optgroup>
      <optgroup label="Environment &amp; Config">
        <option value="env_base_url">Use Environment ({{env.baseURL}} / env.baseURL)</option>
      </optgroup>
      <optgroup label="Privacy &amp; Compliance">
        <option value="anonymize_pii">🛡️ Anonymize &amp; Mask PII (anonymize / maskPII)</option>
      </optgroup>
      <option value="open_cheatsheet">📖 Open Cheatsheet...</option>
    </select>
    <button id="openCheatsheetBtn" class="secondary" title="Open JS transformation snippet library &amp; cheatsheet">📖 Cheatsheet</button>
    <div id="livePollContainer" class="live-poll-container" style="display: inline-flex; align-items: center; gap: 6px; background: var(--vscode-input-background, #3c3c3c); padding: 3px 8px; border-radius: 3px; border: 1px solid var(--vscode-input-border, #3e3e42);">
      <span id="livePollBadge" class="live-poll-badge" style="display: none; color: #4ec9b0; font-size: 10px; font-weight: bold; align-items: center; gap: 4px;"><span class="live-dot" style="display: inline-block; width: 6px; height: 6px; background: #4ec9b0; border-radius: 50%; box-shadow: 0 0 6px #4ec9b0;"></span> LIVE</span>
      <label for="livePollIntervalSelect" style="color: var(--vscode-descriptionForeground, #858585); font-size: 11px; font-weight: 500;">⏱ Live Poll:</label>
      <select id="livePollIntervalSelect" style="background: transparent; border: none; color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; outline: none; font-family: inherit;" title="Auto-refresh query execution on interval">
        <option value="0">Off</option>
        <option value="1000">1s</option>
        <option value="2000">2s</option>
        <option value="5000" selected>5s</option>
        <option value="10000">10s</option>
        <option value="30000">30s</option>
        <option value="60000">60s</option>
      </select>
      <button id="livePollToggleBtn" class="secondary" style="padding: 2px 6px; font-size: 10px; min-width: 44px;" title="Start/Stop live auto-refresh polling">Start</button>
    </div>
    <button id="importQuery" class="secondary" title="Import a .js, .ts, or .txt file as the query expression" style="margin-left: auto;">📤 Import File</button>
    <button id="exportQuery" class="secondary" title="Export current query to a file" style="margin-left: 8px;">📥 Export File</button>
  </div>

  <!-- Dedicated Pipeline Toolbar -->
  <div id="pipelineToolbar" class="row" style="gap: 10px; flex-wrap: wrap; align-items: center; display: none;">
    <button id="runPipelineBtn" class="primary" style="display: inline-flex; align-items: center; gap: 5px;" title="Run All Pipeline Stages (Ctrl+Enter)">▶ Run Pipeline</button>
    <div id="pipelinePreviewSelectContainer" style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; background: var(--vscode-input-background, #3c3c3c); padding: 4px 8px; border-radius: 3px; border: 1px solid var(--vscode-input-border, #3e3e42);">
      <label for="pipelinePreviewSelect" style="color: var(--vscode-descriptionForeground, #858585); font-weight: 500;">👁️ Preview:</label>
      <select id="pipelinePreviewSelect" style="background: transparent; border: none; color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; outline: none; font-family: inherit;" title="Select which pipeline stage output to display in the result area">
        <option value="final">Final Output</option>
      </select>
    </div>
    <button id="savePipelineBtn" class="secondary" title="Save pipeline to local storage">★ Save Pipeline</button>
    <button id="beautifyPipelineBtn" class="secondary" title="Format current step expression">✨ Beautify</button>
    <button id="exportPipelineToQueryBtn" class="secondary" title="Convert pipeline into a single consolidated JavaScript query">⚡ Convert to Single Query</button>
    <button id="importPipelineJsonBtn" class="secondary" title="Import pipeline definition (.pipeline.json)" style="margin-left: auto;">📤 Import Pipeline</button>
    <button id="exportPipelineJsonBtn" class="secondary" title="Export pipeline definition (.pipeline.json)" style="margin-left: 8px;">📥 Export Pipeline</button>
  </div>

  <!-- Dedicated Test Suite Toolbar -->
  <div id="testsToolbar" class="row" style="gap: 10px; flex-wrap: wrap; align-items: center; display: none;">
    <button id="runTestsModeBtn" class="primary" style="display: inline-flex; align-items: center; gap: 5px;" title="Run Test Suite (Ctrl+Enter or Ctrl+Shift+T)">▶ Run Tests</button>
    <div id="testTargetContainer" style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; background: var(--vscode-input-background, #3c3c3c); padding: 4px 8px; border-radius: 3px; border: 1px solid var(--vscode-input-border, #3e3e42);">
      <label for="testTargetSelect" style="color: var(--vscode-descriptionForeground, #858585); font-weight: 500;">Target:</label>
      <select id="testTargetSelect" style="background: transparent; border: none; color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; outline: none; font-family: inherit;" title="Select data target to assert against">
        <option value="all">All Bound Sources (Combined)</option>
        <option value="source">Raw Source Data (data)</option>
        <option value="result">Query Result (result)</option>
      </select>
    </div>
    <button id="saveTestsBtn" class="secondary" title="Save test suite to local storage">★ Save Tests</button>
    <button id="beautifyTestsBtn" class="secondary" title="Format test suite code">✨ Beautify</button>
    <button id="clearTestsBtn" class="secondary" title="Clear test suite buffer">🗑 Clear</button>
    <select id="testSnippetSelect" style="padding: 6px 10px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; font-family: inherit;" title="Insert test assertions or contract suite templates">
      <option value="" disabled selected>💡 Test Snippets...</option>
      <option value="contract_full">Comprehensive Contract Suite (test &amp; expect)</option>
      <option value="schema_validation">Schema &amp; Types Validation</option>
      <option value="status_codes">Status, Success &amp; Timestamp Checks</option>
      <option value="array_items_deep">Array Elements &amp; Sub-properties</option>
      <option value="node_assert">Node Assert Interface (assert.ok, equal, deepStrictEqual)</option>
      <option value="multi_source_contract">Multi-Source / All Files Contract</option>
      <option value="query_result_contract">Validate Query Result (target=result)</option>
    </select>
    <button id="importTestFileBtn" class="secondary" title="Import test suite from a file (.test.js, .js, .ts)" style="margin-left: auto;">📤 Import Tests</button>
    <button id="exportTestFileBtn" class="secondary" title="Export test suite to a file (.test.js)" style="margin-left: 8px;">📥 Export Tests</button>
  </div>

  <!-- Console Output Drawer (Positioned between Editor Toolbar and Result for immediate visibility) -->
  <div id="consoleDrawer" style="display: none; margin: 0 20px 14px 20px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; background: var(--vscode-editor-background, #1e1e1e); overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.25);">
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--vscode-titleBar-activeBackground, #2d2d30); border-bottom: 1px solid var(--vscode-input-border, #3e3e42); flex-wrap: wrap; gap: 6px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-weight: 600; font-size: 11px; color: var(--vscode-foreground, #cccccc);">📟 Console Output</span>
        <span id="consoleCount" style="font-size: 10px; color: var(--vscode-descriptionForeground, #858585);">(0 entries)</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <button id="clearConsoleBtn" class="secondary" style="padding: 2px 8px; font-size: 10px;" title="Clear console output">Clear</button>
        <button id="copyConsoleBtn" class="secondary" style="padding: 2px 8px; font-size: 10px;" title="Copy all console output">📋 Copy</button>
        <button id="expandConsoleBtn" class="secondary" style="padding: 2px 8px; font-size: 10px;" title="Toggle expanded height">⤢ Expand</button>
        <button id="closeConsoleBtn" class="secondary" style="padding: 2px 8px; font-size: 10px;" title="Hide console drawer">✕</button>
      </div>
    </div>
    <div id="consoleOutput" style="max-height: 180px; overflow-y: auto; padding: 8px 10px; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace; font-size: 11px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; color: var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc));"></div>
  </div>
  </div>

  <div id="resultPane" class="workspace-pane result-pane">
    <div id="result">
    <div class="result-header">
      <div style="display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap;">
        <h4 style="margin: 0;">Result</h4>
        <div id="benchmarkMeter" class="benchmark-meter" title="Execution Benchmark">
          <span id="benchmarkDuration" title="Query execution time">⏱️ 0ms</span>
          <span style="opacity: 0.4;">•</span>
          <span id="benchmarkByteSize" title="Data byte size">💾 0 B</span>
        </div>
        <div id="testSuiteBadge" class="test-suite-badge" style="display: none; cursor: pointer;" title="Click to view test breakdown">
          <span id="testSuiteIcon">🧪</span>
          <span id="testSuiteSummary">0 Passed</span>
        </div>
        <span id="resultInfo" style="font-size: 10px; color: var(--vscode-descriptionForeground, #858585);"></span>
        <span id="livePollStatusText" style="display: none; font-size: 10px; color: #4ec9b0; font-weight: 500;"></span>
        <span id="pipelineResultBadge" style="display: none; font-size: 10px; color: #3794ff; font-weight: 500; background: rgba(55, 148, 255, 0.1); border: 1px solid rgba(55, 148, 255, 0.3); padding: 1px 6px; border-radius: 3px;"></span>
      </div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        <select id="resultFormat" style="padding: 6px 10px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); font-size: 11px; cursor: pointer; font-family: inherit;">
          <option value="json">JSON</option>
          <option value="yaml">YAML</option>
          <option value="ndjson">NDJSON</option>
          <option value="xml">XML</option>
          <option value="table">Table</option>
          <option value="chart">Chart</option>
          <option value="tests">🧪 Test Suite</option>
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
          <option value="typescript">TypeScript (.ts)</option>
          <option value="zod">Zod Schema (.ts)</option>
          <option value="json-schema">JSON Schema (.json)</option>
          <option value="pydantic">Pydantic Models (.py)</option>
          <option value="dataclass">Python Dataclass (.py)</option>
        </select>
        <button id="copy-result-to-clipboard" class="secondary" style="padding: 6px 10px;">📋 Copy</button>
        <button id="openResultInEditorBtn" class="secondary" style="padding: 6px 10px;" title="Open result in a new VS Code editor tab">↗ In Editor</button>
        <button id="generateTypesBtn" class="secondary" style="padding: 6px 10px; display: inline-flex; align-items: center; gap: 5px;" title="Generate TypeScript, Zod, JSON Schema, Pydantic, or Dataclass types from result">{ } Types</button>
        <button id="anonymizeBtn" class="secondary" style="padding: 6px 10px; display: inline-flex; align-items: center; gap: 5px;" title="Sanitize &amp; Anonymize Sensitive Data / PII (credentials, tokens, emails, phone numbers, credit cards)">🛡️ Anonymize</button>
        <button id="diffResultBtn" class="secondary" style="padding: 6px 10px;" title="Compare Original JSON with Transformed Result in Side-by-Side Diff (vscode.diff)">⚖️ Diff</button>
        <button id="toggleVisualLensBtn" class="secondary" style="padding: 6px 10px; display: inline-flex; align-items: center; gap: 5px;" title="Toggle Visual Lens (JSON Path &amp; Expression Picker)">🔍 Lens</button>
        <button id="toggleConsoleResultBtn" class="secondary" style="padding: 6px 10px; display: inline-flex; align-items: center; gap: 5px;" title="Toggle Console Output Drawer">📟 Console <span id="consoleBadgeResult" style="display: none; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #ffffff); border-radius: 10px; padding: 1px 6px; font-size: 10px; font-weight: bold;">0</span></button>
        <button id="toggleMockServerBtn" class="secondary" style="padding: 6px 10px; display: inline-flex; align-items: center; gap: 5px;" title="Serve query result as local mock REST API (http://localhost:3000/api)">📡 Mock API <span id="mockServerStatusDot" style="display: none; width: 7px; height: 7px; border-radius: 50%; background: #4ec9b0; box-shadow: 0 0 5px #4ec9b0;"></span></button>
      </div>
    </div>

    <!-- Visual Lens Bar (JSON Path & Expression Picker) -->
    <div id="visualLensBar" style="display: none; align-items: center; justify-content: space-between; padding: 6px 12px; margin-bottom: 10px; background: var(--vscode-editor-inactiveSelectionBackground, rgba(58, 61, 65, 0.4)); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; font-size: 11px; flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; min-width: 220px;">
        <span style="font-weight: 600; color: var(--vscode-editorInfo-foreground, #75beff); display: inline-flex; align-items: center; gap: 4px;">
          🔍 Lens:
        </span>
        <code id="lensPathDisplay" style="font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 2px 7px; border-radius: 3px; color: var(--vscode-editor-foreground, #d4d4d4); font-size: 11px; user-select: all; cursor: pointer; border: 1px solid var(--vscode-input-border, #3e3e42);" title="Click to copy path">data</code>
        <span id="lensValueBadge" style="font-size: 10px; color: var(--vscode-descriptionForeground, #858585); padding: 1px 6px; background: rgba(128,128,128,0.15); border-radius: 3px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
        <label style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; color: var(--vscode-descriptionForeground, #858585); margin-left: 4px;" title="Use optional chaining (?.) for safe property access">
          <input type="checkbox" id="lensOptionalChainingToggle" style="margin: 0; cursor: pointer;">
          <span>?. (safe)</span>
        </label>
      </div>
      <div id="lensActions" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        <button id="lensCopyPathBtn" class="secondary" style="padding: 3px 8px; font-size: 10px;" title="Copy JSON Path to clipboard">📋 Copy Path</button>
        <button id="lensInsertPathBtn" class="secondary" style="padding: 3px 8px; font-size: 10px;" title="Insert path at cursor in Query Editor">✍️ Insert</button>
        <button id="lensFilterBtn" class="secondary" style="padding: 3px 8px; font-size: 10px; display: none;" title="Filter query by this value">🔎 Filter</button>
        <button id="lensExtractBtn" class="secondary" style="padding: 3px 8px; font-size: 10px; display: none;" title="Extract field using .map()">🎯 Extract</button>
        <button id="lensGroupByBtn" class="secondary" style="padding: 3px 8px; font-size: 10px; display: none;" title="Group data by this key">📊 Group By</button>
        <button id="lensCloseBtn" class="secondary" style="padding: 3px 6px; font-size: 10px; opacity: 0.7;" title="Hide Visual Lens bar">✕</button>
      </div>
    </div>

    <!-- Instant Local Mock Server Panel -->
    <div id="mockServerPanel" style="display: none; flex-direction: column; gap: 10px; padding: 10px 14px; margin-bottom: 12px; background: var(--vscode-editor-inactiveSelectionBackground, rgba(58, 61, 65, 0.3)); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 6px; font-size: 11px;">
      <!-- Header / Status Bar -->
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;">
            📡 Local Mock REST API Server
          </span>
          <span id="mockServerStatusBadge" style="padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; background: rgba(128,128,128,0.2); color: var(--vscode-descriptionForeground, #858585);">
            ⚪ Offline
          </span>
          <code id="mockServerUrlDisplay" style="display: none; font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 2px 8px; border-radius: 3px; color: #4ec9b0; border: 1px solid var(--vscode-input-border, #3e3e42); user-select: all;" title="Active Mock Endpoint URL">http://localhost:3000/api</code>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <button id="startMockServerBtn" class="primary" style="padding: 4px 10px; font-size: 11px;">▶ Start Server</button>
          <button id="stopMockServerBtn" class="danger" style="display: none; padding: 4px 10px; font-size: 11px;">■ Stop Server</button>
          <button id="copyMockUrlBtn" class="secondary" style="display: none; padding: 4px 8px; font-size: 11px;" title="Copy mock endpoint URL to clipboard">📋 Copy URL</button>
          <button id="openMockBrowserBtn" class="secondary" style="display: none; padding: 4px 8px; font-size: 11px;" title="Open endpoint in browser">↗ Open</button>
          <button id="copyMockCurlBtn" class="secondary" style="display: none; padding: 4px 8px; font-size: 11px;" title="Copy cURL snippet">📋 cURL</button>
          <button id="closeMockPanelBtn" class="secondary" style="padding: 3px 7px; font-size: 10px; margin-left: 4px;" title="Close mock panel">✕</button>
        </div>
      </div>

      <!-- Settings Row -->
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: rgba(0,0,0,0.15); padding: 8px 10px; border-radius: 4px;">
        <label style="display: inline-flex; align-items: center; gap: 4px;">
          <span>Port:</span>
          <input type="number" id="mockPortInput" value="3000" min="1024" max="65535" style="width: 60px; padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px;">
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px;">
          <span>Endpoint:</span>
          <input type="text" id="mockEndpointInput" value="/api" style="width: 90px; padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px;">
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px;">
          <span>Method:</span>
          <select id="mockMethodSelect" style="padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px;">
            <option value="ALL">ALL (Any)</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
            <option value="CUSTOM">Custom...</option>
          </select>
          <input type="text" id="mockCustomMethodInput" placeholder="METHOD" style="display: none; width: 65px; padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px; text-transform: uppercase;">
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px;" title="Static Snapshot serves current data; Live Evaluation re-evaluates active expression with req and res on each request">
          <span>Mode:</span>
          <select id="mockModeSelect" style="padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px;">
            <option value="static">Static Snapshot</option>
            <option value="dynamic">Live Evaluation</option>
          </select>
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="Automatically filter array results by query parameters (e.g. ?category=fruit&limit=5)">
          <input type="checkbox" id="mockAutoFilterToggle" checked style="margin: 0; cursor: pointer;">
          <span>Auto-filter (?key=val)</span>
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px;">
          <span>Latency:</span>
          <select id="mockLatencySelect" style="padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px;">
            <option value="0">0ms</option>
            <option value="50">50ms</option>
            <option value="150">150ms</option>
            <option value="300">300ms</option>
            <option value="500">500ms</option>
            <option value="1000">1000ms</option>
          </select>
        </label>
        <label style="display: inline-flex; align-items: center; gap: 4px;">
          <span>Status:</span>
          <input type="number" id="mockStatusInput" value="200" min="100" max="599" style="width: 48px; padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px;">
        </label>
      </div>

      <!-- Request Activity Feed -->
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-weight: 600; font-size: 11px; color: var(--vscode-descriptionForeground, #858585);">
            Incoming Requests Feed (<span id="mockRequestCountBadge">0</span>)
          </span>
          <button id="clearMockLogsBtn" class="secondary" style="padding: 2px 6px; font-size: 10px;">Clear Feed</button>
        </div>
        <div id="mockLogsContainer" style="max-height: 120px; overflow-y: auto; background: var(--vscode-textCodeBlock-background, #1e1e1e); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; padding: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 10px;">
          <div id="mockLogsEmptyMsg" style="color: var(--vscode-descriptionForeground, #858585); text-align: center; padding: 8px;">No incoming HTTP requests yet. Run <code>curl http://localhost:3000/api</code> or test with frontend apps.</div>
          <table id="mockLogsTable" style="display: none; width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(128,128,128,0.2); color: var(--vscode-descriptionForeground, #858585);">
                <th style="padding: 2px 4px;">Time</th>
                <th style="padding: 2px 4px;">Method</th>
                <th style="padding: 2px 4px;">Path</th>
                <th style="padding: 2px 4px;">Status</th>
                <th style="padding: 2px 4px;">Latency</th>
              </tr>
            </thead>
            <tbody id="mockLogsTbody"></tbody>
          </table>
        </div>
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
      <div id="resultTestsContainer" style="display: none; height: 100%; overflow-y: auto; padding: 12px 16px; box-sizing: border-box;">
        <div id="testsSummaryBanner" class="tests-summary-banner">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span id="testsStatusIcon" style="font-size: 22px;">✅</span>
              <div>
                <div id="testsTitle" style="font-size: 14px; font-weight: bold;">All Tests Passed</div>
                <div id="testsSubtitle" style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585); margin-top: 2px;">0 passed of 0 tests • 0ms</div>
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="rerunTestsBtn" class="secondary" style="padding: 4px 8px; font-size: 11px;" title="Re-run Test Suite">🔄 Re-run</button>
              <button id="copyTestReportBtn" class="secondary" style="padding: 4px 8px; font-size: 11px;" title="Copy Test Report as Markdown">📋 Copy Report</button>
            </div>
          </div>
          <div id="testsProgressBar" class="tests-progress-bar">
            <div id="testsProgressFill" class="tests-progress-fill" style="width: 100%;"></div>
          </div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin: 12px 0 8px 0; gap: 10px; flex-wrap: wrap;">
          <div style="display: flex; gap: 6px;">
            <button id="testFilterAll" class="test-filter-btn active">All (<span id="countAll">0</span>)</button>
            <button id="testFilterPassed" class="test-filter-btn">Passed (<span id="countPassed">0</span>)</button>
            <button id="testFilterFailed" class="test-filter-btn">Failed (<span id="countFailed">0</span>)</button>
          </div>
          <input id="testSearchInput" type="text" placeholder="Filter tests..." style="padding: 4px 8px; font-size: 11px; border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); width: 160px;" />
        </div>
        <div id="testsListContainer" style="display: flex; flex-direction: column; gap: 8px;"></div>
      </div>
    </div>
  </div>
  </div>

  <div id="history">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
      <h4 style="margin: 0;">History</h4>
      <div style="display: flex; gap: 6px;">
        <button id="importHistoryJsonBtn" type="button" class="secondary" style="padding: 3px 8px; font-size: 11px;" title="Import query history or favorites from a .json file">📥 Import</button>
        <button id="exportHistoryJsonBtn" type="button" class="secondary" style="padding: 3px 8px; font-size: 11px;" title="Export query history or favorites as a .json file">📤 Export</button>
      </div>
    </div>
    <div class="search-box">
      <span class="search-icon">&#128269;</span>
      <input type="text" id="historySearch" class="search-input" placeholder="Search saved queries..." />
    </div>
    <div id="list"></div>
  </div>
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

        <div id="urlModalEnvBanner" style="display: none; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; padding: 6px 10px; margin-bottom: 12px; background: rgba(78, 201, 176, 0.08); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px;">
          <span id="urlModalEnvText" style="color: var(--vscode-foreground, #ccc);"></span>
          <button type="button" id="urlModalManageEnvBtn" class="secondary" style="font-size: 10px; padding: 2px 6px;" title="Open .json-tools/environments.json">Manage Envs</button>
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
              <option value="CUSTOM">Custom...</option>
            </select>
            <input type="text" id="urlCustomMethod" placeholder="METHOD" style="display: none; width: 100%; margin-top: 4px; padding: 3px 6px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 3px; font-size: 11px; text-transform: uppercase;">
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
          <button id="diffInspectWithResultBtn" class="secondary" style="display: none;" title="Compare this source with Transformed Result in Side-by-Side Diff">⚖️ Diff with Result</button>
          <button id="dismissInspectBtn" class="primary">Close</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Snippet Library & Cheatsheet Modal -->
  <div id="cheatsheetModal" class="modal-backdrop" style="display: none;">
    <div class="modal-dialog" style="max-width: 780px; width: 92%; max-height: 85vh;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 14px; font-weight: 600;">💡 JS Query Snippet Library &amp; Cheatsheet</h3>
        </div>
        <button id="closeCheatsheetModal" class="modal-close-btn" title="Close dialog">&times;</button>
      </div>
      <div class="modal-body" style="gap: 12px; padding: 16px;">
        <!-- Search & Filter Controls -->
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
          <input id="cheatsheetSearch" type="text" placeholder="Search patterns (e.g. group, sum, flatten, date, omit, unique)…" style="padding: 6px 10px; font-size: 11px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; flex: 1; min-width: 220px;" />
          <div id="cheatsheetCategories" style="display: flex; gap: 4px; flex-wrap: wrap;">
            <button type="button" class="request-tab-btn active" data-cat="all" style="padding: 3px 8px; font-size: 10px;">All</button>
            <button type="button" class="request-tab-btn" data-cat="grouping" style="padding: 3px 8px; font-size: 10px;">Grouping</button>
            <button type="button" class="request-tab-btn" data-cat="aggregation" style="padding: 3px 8px; font-size: 10px;">Aggregation</button>
            <button type="button" class="request-tab-btn" data-cat="flatten" style="padding: 3px 8px; font-size: 10px;">Flatten</button>
            <button type="button" class="request-tab-btn" data-cat="filtering" style="padding: 3px 8px; font-size: 10px;">Filtering</button>
            <button type="button" class="request-tab-btn" data-cat="shaping" style="padding: 3px 8px; font-size: 10px;">Pick / Omit</button>
            <button type="button" class="request-tab-btn" data-cat="dedup" style="padding: 3px 8px; font-size: 10px;">Unique</button>
            <button type="button" class="request-tab-btn" data-cat="multisource" style="padding: 3px 8px; font-size: 10px;">Multi-Source</button>
            <button type="button" class="request-tab-btn" data-cat="testing" style="padding: 3px 8px; font-size: 10px;">Tests</button>
          </div>
        </div>

        <!-- Snippets List Container -->
        <div id="cheatsheetList" style="overflow-y: auto; max-height: 52vh; display: flex; flex-direction: column; gap: 10px; padding-right: 2px;">
        </div>
        <div id="cheatsheetEmpty" style="display: none; text-align: center; padding: 24px; color: var(--vscode-descriptionForeground, #858585); font-style: italic; font-size: 12px;">No matching snippets found</div>
      </div>
      <div class="modal-footer" style="justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585);">Tip: Click "📥 Insert" to replace or insert into your query</span>
        <button id="dismissCheatsheetBtn" class="primary">Close</button>
      </div>
    </div>
  </div>

  <!-- Multi-Language Type & Contract Generator Modal -->
  <div id="typeGenModal" class="modal-backdrop" style="display: none;">
    <div class="modal-dialog" style="max-width: 820px; width: 92%; max-height: 88vh; display: flex; flex-direction: column;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 14px; font-weight: 600;">{ } Multi-Language Type &amp; Contract Generator</h3>
        </div>
        <button id="closeTypeGenModal" class="modal-close-btn" title="Close dialog">&times;</button>
      </div>
      <div class="modal-body" style="gap: 12px; padding: 16px; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <!-- Language / Target Selector Tabs -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
          <div id="typeGenTabs" style="display: flex; gap: 4px; flex-wrap: wrap;">
            <button type="button" class="request-tab-btn active" data-target="typescript" style="padding: 4px 10px; font-size: 11px;">TypeScript</button>
            <button type="button" class="request-tab-btn" data-target="zod" style="padding: 4px 10px; font-size: 11px;">Zod Schema</button>
            <button type="button" class="request-tab-btn" data-target="json-schema" style="padding: 4px 10px; font-size: 11px;">JSON Schema</button>
            <button type="button" class="request-tab-btn" data-target="pydantic" style="padding: 4px 10px; font-size: 11px;">Pydantic (v2)</button>
            <button type="button" class="request-tab-btn" data-target="dataclass" style="padding: 4px 10px; font-size: 11px;">Python Dataclass</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585); display: inline-flex; align-items: center; gap: 4px;">
              Root Name:
              <input id="typeGenRootName" type="text" value="Root" placeholder="Root" style="padding: 3px 8px; font-size: 11px; width: 110px; border-radius: 3px; border: 1px solid var(--vscode-input-border, #3e3e42); background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); font-family: var(--vscode-editor-font-family, monospace);">
            </label>
          </div>
        </div>

        <!-- Target Options Bar -->
        <div id="typeGenOptionsBar" style="display: flex; gap: 12px; align-items: center; font-size: 11px; padding: 4px 8px; background: rgba(128,128,128,0.1); border-radius: 4px; color: var(--vscode-descriptionForeground, #858585);">
          <div id="typeGenTsOptions" style="display: flex; gap: 12px; align-items: center;">
            <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" id="typeGenTsExport" checked style="margin: 0; cursor: pointer;">
              <span>Export Types</span>
            </label>
            <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" id="typeGenTsInterface" checked style="margin: 0; cursor: pointer;">
              <span>Interface (vs Type Alias)</span>
            </label>
          </div>
          <div id="typeGenPyOptions" style="display: none; gap: 12px; align-items: center;">
            <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
              <input type="checkbox" id="typeGenPySnake" checked style="margin: 0; cursor: pointer;">
              <span>Convert camelCase to snake_case (with Field aliases)</span>
            </label>
          </div>
        </div>

        <!-- Code Preview Box -->
        <div style="flex: 1; min-height: 240px; display: flex; flex-direction: column; position: relative;">
          <textarea id="typeGenCodePreview" readonly style="width: 100%; flex: 1; min-height: 240px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; line-height: 1.45; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #d4d4d4); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; padding: 10px; resize: none; white-space: pre; tab-size: 2; overflow: auto; box-sizing: border-box;"></textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between; align-items: center;">
        <span id="typeGenStats" style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585);">TypeScript</span>
        <div style="display: flex; gap: 8px;">
          <button id="copyTypeGenBtn" class="secondary">📋 Copy Code</button>
          <button id="openTypeGenInEditorBtn" class="secondary">↗ In Editor</button>
          <button id="saveTypeGenFileBtn" class="secondary">📥 Save File</button>
          <button id="dismissTypeGenBtn" class="primary">Close</button>
        </div>
      </div>
    </div>
  </div>

  <!-- PII Anonymizer & Sanitizer Modal -->
  <div id="anonymizerModal" class="modal-backdrop" style="display: none;">
    <div class="modal-dialog" style="max-width: 860px; width: 92%; max-height: 88vh; display: flex; flex-direction: column;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h3 style="margin: 0; font-size: 14px; font-weight: 600;">🛡️ Privacy &amp; Compliance — PII Anonymizer &amp; Sanitizer</h3>
        </div>
        <button id="closeAnonymizerModal" class="modal-close-btn" title="Close dialog">&times;</button>
      </div>
      <div class="modal-body" style="gap: 12px; padding: 16px; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <!-- Strategy Selector Tabs -->
        <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="font-size: 11px; font-weight: 600; color: var(--vscode-foreground, #ccc);">Strategy:</span>
            <div id="anonStrategyTabs" style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button type="button" class="request-tab-btn active" data-strategy="mask" style="padding: 4px 10px; font-size: 11px;" title="Preserve format shape: j***e@domain.com, **** 1234">Format Masking</button>
              <button type="button" class="request-tab-btn" data-strategy="redact" style="padding: 4px 10px; font-size: 11px;" title="Semantic replacement tags: [REDACTED_EMAIL]">Semantic Redaction</button>
              <button type="button" class="request-tab-btn" data-strategy="synthetic" style="padding: 4px 10px; font-size: 11px;" title="Deterministic pseudonyms: user_8f12@example.com (preserves relational joins)">Consistent Synthetic</button>
              <button type="button" class="request-tab-btn" data-strategy="hash" style="padding: 4px 10px; font-size: 11px;" title="Hashed values: email_8f92a1">Hashed Values</button>
            </div>
          </div>
          <span id="anonymizeBadge" style="font-size: 11px; font-weight: 600; color: #4ec9b0; background: rgba(78, 201, 176, 0.12); border: 1px solid rgba(78, 201, 176, 0.3); border-radius: 12px; padding: 2px 8px;">🛡️ 0 items sanitized</span>
        </div>

        <!-- Rule Categories Bar -->
        <div id="anonRulesBar" style="display: flex; gap: 12px; align-items: center; font-size: 11px; padding: 6px 10px; background: rgba(128,128,128,0.1); border-radius: 4px; color: var(--vscode-descriptionForeground, #858585); flex-wrap: wrap;">
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="JWT, Bearer tokens, private keys, passwords">
            <input type="checkbox" id="anonRuleCredentials" checked style="margin: 0; cursor: pointer;">
            <span>Credentials &amp; Tokens</span>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="RFC email addresses">
            <input type="checkbox" id="anonRuleEmails" checked style="margin: 0; cursor: pointer;">
            <span>Emails</span>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="US &amp; International phone numbers">
            <input type="checkbox" id="anonRulePhones" checked style="margin: 0; cursor: pointer;">
            <span>Phone Numbers</span>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="Credit card numbers with Luhn check">
            <input type="checkbox" id="anonRuleCreditCards" checked style="margin: 0; cursor: pointer;">
            <span>Credit Cards</span>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="Social Security Numbers (###-##-####)">
            <input type="checkbox" id="anonRuleNationalIds" checked style="margin: 0; cursor: pointer;">
            <span>National IDs (SSN)</span>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="IPv4 &amp; IPv6 addresses">
            <input type="checkbox" id="anonRuleIpAddresses" checked style="margin: 0; cursor: pointer;">
            <span>IP Addresses</span>
          </label>
          <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="Sensitive field keys: password, secret, token, apiKey">
            <input type="checkbox" id="anonRuleKeyNames" checked style="margin: 0; cursor: pointer;">
            <span>Sensitive Keys</span>
          </label>
        </div>

        <!-- Sanitized Code Preview Box -->
        <div style="flex: 1; min-height: 240px; display: flex; flex-direction: column; position: relative;">
          <textarea id="anonymizePreview" readonly style="width: 100%; flex: 1; min-height: 240px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11.5px; line-height: 1.45; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #d4d4d4); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; padding: 10px; resize: none; white-space: pre; tab-size: 2; overflow: auto; box-sizing: border-box;"></textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between; align-items: center;">
        <span id="anonymizeStats" style="font-size: 11px; color: var(--vscode-descriptionForeground, #858585);">Strategy: Format Masking</span>
        <div style="display: flex; gap: 8px;">
          <button id="applyAnonymizedBtn" class="primary" title="Apply sanitized data to current query result">Apply to Result</button>
          <button id="copyAnonymizedBtn" class="secondary" title="Copy sanitized JSON to clipboard">📋 Copy Sanitized</button>
          <button id="openAnonymizedInEditorBtn" class="secondary" title="Open sanitized JSON in a new VS Code editor tab">↗ In Editor</button>
          <button id="sendToAiAnonymizedBtn" class="secondary" title="Safely populate AI Query Assistant with sanitized data sample">🤖 Send to AI</button>
          <button id="dismissAnonymizerBtn" class="secondary">Close</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${n}">
    let beautifyReady = false;
    const vscode = acquireVsCodeApi();

    let currentEnvironments = ${initialEnvsJson};
    let currentActiveEnv = ${initialActiveEnvJson};
    let currentEnvVariables = ${initialEnvVarsJson};

    function updateUrlModalEnvBanner() {
      const banner = document.getElementById('urlModalEnvBanner');
      const text = document.getElementById('urlModalEnvText');
      if (!banner || !text) return;

      if (currentActiveEnv) {
        const keys = Object.keys(currentEnvVariables || {}).filter(function(k) { return k !== 'activeEnv' && k !== 'activeEnvironment'; });
        const sampleKeys = keys.slice(0, 3).map(function(k) { return '{{' + k + '}}'; }).join(', ');
        const sampleSuffix = sampleKeys ? ' — e.g. ' + escapeHtml(sampleKeys) : '';
        text.innerHTML = '🌐 Active Env: <strong>' + escapeHtml(currentActiveEnv) + '</strong>' + sampleSuffix;
        banner.style.display = 'flex';
      } else {
        text.innerHTML = '🌐 <em>No Environment selected</em> (variables like {{baseUrl}} will not be resolved unless in settings or env)';
        banner.style.display = 'flex';
      }
    }

    function renderEnvironments(envs, activeEnv, variables) {
      currentEnvironments = Array.isArray(envs) ? envs : [];
      currentActiveEnv = activeEnv || '';
      if (variables) currentEnvVariables = variables;

      const envSelect = document.getElementById('envSelect');
      if (envSelect) {
        let opts = '<option value="">(No Environment)</option>';
        for (let i = 0; i < currentEnvironments.length; i++) {
          const env = currentEnvironments[i];
          const isSelected = env === currentActiveEnv ? ' selected' : '';
          opts += '<option value="' + escapeHtml(env) + '"' + isSelected + '>' + escapeHtml(env) + '</option>';
        }
        envSelect.innerHTML = opts;
      }

      updateUrlModalEnvBanner();
    }
    const exprTextarea = document.getElementById('expr');
    const listEl = document.getElementById('list');
    const resultPre = document.getElementById('resultPre');
    const rebindBtn = document.getElementById('rebind');
    const copyResultBtn = document.getElementById('copy-result-to-clipboard');
    const openResultInEditorBtn = document.getElementById('openResultInEditorBtn');
    const diffResultBtn = document.getElementById('diffResultBtn');
    const toggleConsoleBtn = document.getElementById('toggleConsoleBtn');
    const toggleConsoleResultBtn = document.getElementById('toggleConsoleResultBtn');
    const consoleBadge = document.getElementById('consoleBadge');
    const consoleBadgeResult = document.getElementById('consoleBadgeResult');
    const consoleDrawer = document.getElementById('consoleDrawer');
    const consoleCount = document.getElementById('consoleCount');
    const clearConsoleBtn = document.getElementById('clearConsoleBtn');
    const copyConsoleBtn = document.getElementById('copyConsoleBtn');
    const expandConsoleBtn = document.getElementById('expandConsoleBtn');
    const closeConsoleBtn = document.getElementById('closeConsoleBtn');
    const consoleOutput = document.getElementById('consoleOutput');
    let consoleEntriesCount = 0;
    let isConsoleExpanded = false;
    const resultFormat = document.getElementById('resultFormat');
    const chartType = document.getElementById('chartType');
    const downloadChartBtn = document.getElementById('downloadChart');
    const saveJsonBtn = document.getElementById('saveJson');
    const saveCsvBtn = document.getElementById('saveCsv');
    const saveYamlBtn = document.getElementById('saveYaml');
    const saveNdjsonBtn = document.getElementById('saveNdjson');
    const saveXmlBtn = document.getElementById('saveXml');
    const exportDropdown = document.getElementById('exportDropdown');
    const generateTypesBtn = document.getElementById('generateTypesBtn');
    const typeGenModal = document.getElementById('typeGenModal');
    const closeTypeGenModalBtn = document.getElementById('closeTypeGenModal');
    const dismissTypeGenBtn = document.getElementById('dismissTypeGenBtn');
    const typeGenTabs = document.getElementById('typeGenTabs');
    const typeGenRootName = document.getElementById('typeGenRootName');
    const typeGenTsExport = document.getElementById('typeGenTsExport');
    const typeGenTsInterface = document.getElementById('typeGenTsInterface');
    const typeGenPySnake = document.getElementById('typeGenPySnake');
    const typeGenTsOptions = document.getElementById('typeGenTsOptions');
    const typeGenPyOptions = document.getElementById('typeGenPyOptions');
    const typeGenCodePreview = document.getElementById('typeGenCodePreview');
    const typeGenStats = document.getElementById('typeGenStats');
    const copyTypeGenBtn = document.getElementById('copyTypeGenBtn');
    const openTypeGenInEditorBtn = document.getElementById('openTypeGenInEditorBtn');
    const saveTypeGenFileBtn = document.getElementById('saveTypeGenFileBtn');
    const resultInfo = document.getElementById('resultInfo');
    const benchmarkMeter = document.getElementById('benchmarkMeter');
    const benchmarkDuration = document.getElementById('benchmarkDuration');
    const benchmarkByteSize = document.getElementById('benchmarkByteSize');
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
    const toggleVisualLensBtn = document.getElementById('toggleVisualLensBtn');
    const visualLensBar = document.getElementById('visualLensBar');
    const lensPathDisplay = document.getElementById('lensPathDisplay');
    const lensValueBadge = document.getElementById('lensValueBadge');
    const lensOptionalChainingToggle = document.getElementById('lensOptionalChainingToggle');
    const lensCopyPathBtn = document.getElementById('lensCopyPathBtn');
    const lensInsertPathBtn = document.getElementById('lensInsertPathBtn');
    const lensFilterBtn = document.getElementById('lensFilterBtn');
    const lensExtractBtn = document.getElementById('lensExtractBtn');
    const lensGroupByBtn = document.getElementById('lensGroupByBtn');
    const lensCloseBtn = document.getElementById('lensCloseBtn');
    let currentLensInfo = null;
    let lensDismissed = false;

    const editorModeBar = document.getElementById('editorModeBar');
    const modeQueryBtn = document.getElementById('modeQueryBtn');
    const modeTestsBtn = document.getElementById('modeTestsBtn');
    const testsCountBadge = document.getElementById('testsCountBadge');
    const queryToolbar = document.getElementById('queryToolbar');
    const testsToolbar = document.getElementById('testsToolbar');
    const runTestsModeBtn = document.getElementById('runTestsModeBtn');
    const testTargetContainer = document.getElementById('testTargetContainer');
    const testTargetSelect = document.getElementById('testTargetSelect');
    const saveTestsBtn = document.getElementById('saveTestsBtn');
    const beautifyTestsBtn = document.getElementById('beautifyTestsBtn');
    const clearTestsBtn = document.getElementById('clearTestsBtn');
    const testSnippetSelect = document.getElementById('testSnippetSelect');
    const importTestFileBtn = document.getElementById('importTestFileBtn');
    const exportTestFileBtn = document.getElementById('exportTestFileBtn');
    const modePipelineBtn = document.getElementById('modePipelineBtn');
    const pipelineStepCountBadge = document.getElementById('pipelineStepCountBadge');
    const pipelineStageRibbon = document.getElementById('pipelineStageRibbon');
    const pipelineStepsList = document.getElementById('pipelineStepsList');
    const addPipelineStepBtn = document.getElementById('addPipelineStepBtn');
    const pipelineStepConfigBar = document.getElementById('pipelineStepConfigBar');
    const stepNameInput = document.getElementById('stepNameInput');
    const stepAliasInput = document.getElementById('stepAliasInput');
    const stepEnabledCheckbox = document.getElementById('stepEnabledCheckbox');
    const moveStepUpBtn = document.getElementById('moveStepUpBtn');
    const moveStepDownBtn = document.getElementById('moveStepDownBtn');
    const duplicateStepBtn = document.getElementById('duplicateStepBtn');
    const removeStepBtn = document.getElementById('removeStepBtn');
    const pipelineToolbar = document.getElementById('pipelineToolbar');
    const runPipelineBtn = document.getElementById('runPipelineBtn');
    const pipelinePreviewSelectContainer = document.getElementById('pipelinePreviewSelectContainer');
    const pipelinePreviewSelect = document.getElementById('pipelinePreviewSelect');
    const savePipelineBtn = document.getElementById('savePipelineBtn');
    const beautifyPipelineBtn = document.getElementById('beautifyPipelineBtn');
    const exportPipelineToQueryBtn = document.getElementById('exportPipelineToQueryBtn');
    const importPipelineJsonBtn = document.getElementById('importPipelineJsonBtn');
    const exportPipelineJsonBtn = document.getElementById('exportPipelineJsonBtn');
    const pipelineResultBadge = document.getElementById('pipelineResultBadge');

    const toggleMockServerBtn = document.getElementById('toggleMockServerBtn');
    const mockServerStatusDot = document.getElementById('mockServerStatusDot');
    const mockServerPanel = document.getElementById('mockServerPanel');
    const mockServerStatusBadge = document.getElementById('mockServerStatusBadge');
    const mockServerUrlDisplay = document.getElementById('mockServerUrlDisplay');
    const startMockServerBtn = document.getElementById('startMockServerBtn');
    const stopMockServerBtn = document.getElementById('stopMockServerBtn');
    const copyMockUrlBtn = document.getElementById('copyMockUrlBtn');
    const openMockBrowserBtn = document.getElementById('openMockBrowserBtn');
    const copyMockCurlBtn = document.getElementById('copyMockCurlBtn');
    const closeMockPanelBtn = document.getElementById('closeMockPanelBtn');
    const mockPortInput = document.getElementById('mockPortInput');
    const mockEndpointInput = document.getElementById('mockEndpointInput');
    const mockMethodSelect = document.getElementById('mockMethodSelect');
    const mockCustomMethodInput = document.getElementById('mockCustomMethodInput');
    const mockModeSelect = document.getElementById('mockModeSelect');
    const mockAutoFilterToggle = document.getElementById('mockAutoFilterToggle');
    const mockLatencySelect = document.getElementById('mockLatencySelect');
    const mockStatusInput = document.getElementById('mockStatusInput');
    const mockRequestCountBadge = document.getElementById('mockRequestCountBadge');
    const clearMockLogsBtn = document.getElementById('clearMockLogsBtn');
    const mockLogsContainer = document.getElementById('mockLogsContainer');
    const mockLogsEmptyMsg = document.getElementById('mockLogsEmptyMsg');
    const mockLogsTable = document.getElementById('mockLogsTable');
    const mockLogsTbody = document.getElementById('mockLogsTbody');
    let activeMockServerState = null;

    let pipelineSteps = [
      { id: 'step_1', name: 'Filter / Clean', alias: 'step1', expr: '// Step 1: Filter / Clean data\\nreturn Array.isArray(data) ? data.filter(item => item != null) : data;', enabled: true },
      { id: 'step_2', name: 'Transform / Enrich', alias: 'step2', expr: '// Step 2: Transform / Enrich\\nreturn Array.isArray(prev) ? prev.map(item => ({ ...item })) : prev;', enabled: true },
      { id: 'step_3', name: 'Format / Sort', alias: 'step3', expr: '// Step 3: Format / Sort\\nreturn prev;', enabled: true }
    ];
    let activeStepIndex = 0;
    let previewStepId = 'final';
    let lastPipelineResult = null;

    try {
      const savedStepsJson = localStorage.getItem('jsonQueryTools.pipelineSteps');
      if (savedStepsJson) {
        const parsed = JSON.parse(savedStepsJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          pipelineSteps = parsed;
        }
      }
    } catch (e) {}

    function savePipelineToStorage() {
      try {
        localStorage.setItem('jsonQueryTools.pipelineSteps', JSON.stringify(pipelineSteps));
      } catch (e) {}
      if (pipelineStepCountBadge) {
        pipelineStepCountBadge.textContent = String(pipelineSteps.length);
        pipelineStepCountBadge.style.display = pipelineSteps.length > 0 ? 'inline-block' : 'none';
      }
    }

    function updateActiveStepConfigUI() {
      const step = pipelineSteps[activeStepIndex];
      if (!step) return;
      if (stepNameInput) stepNameInput.value = step.name || '';
      if (stepAliasInput) stepAliasInput.value = step.alias || '';
      if (stepEnabledCheckbox) stepEnabledCheckbox.checked = Boolean(step.enabled);
    }

    function updatePipelinePreviewOptions() {
      if (!pipelinePreviewSelect) return;
      const currentVal = previewStepId || 'final';
      pipelinePreviewSelect.innerHTML = '<option value="final">Final Output</option>';
      pipelineSteps.forEach((s, idx) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = 'Step ' + (idx + 1) + ': ' + (s.name || s.alias || ('Step ' + (idx + 1)));
        pipelinePreviewSelect.appendChild(opt);
      });
      pipelinePreviewSelect.value = currentVal;
    }

    function showStepPreview(targetStepId) {
      if (!lastPipelineResult) return;
      if (targetStepId === 'final' || !targetStepId) {
        if (pipelineResultBadge) {
          pipelineResultBadge.style.display = 'inline-block';
          pipelineResultBadge.textContent = '⛓️ Pipeline Result (' + formatDuration(lastPipelineResult.durationMs) + ')';
        }
        updateResultDisplay('', lastPipelineResult.finalResult);
        return;
      }
      const stepRes = lastPipelineResult.steps ? lastPipelineResult.steps.find(s => s.id === targetStepId) : null;
      if (stepRes) {
        if (pipelineResultBadge) {
          pipelineResultBadge.style.display = 'inline-block';
          const countInfo = stepRes.itemCount !== undefined ? stepRes.itemCount + ' items • ' : '';
          pipelineResultBadge.textContent = '👁️ Preview: ' + (stepRes.name || stepRes.alias) + ' (' + countInfo + formatDuration(stepRes.durationMs) + ')';
        }
        updateResultDisplay(stepRes.text || '', stepRes.output);
      }
    }

    function selectPipelineStep(index, andPreview) {
      if (index < 0 || index >= pipelineSteps.length) return;
      if (activeEditorMode === 'pipeline' && pipelineSteps[activeStepIndex]) {
        pipelineSteps[activeStepIndex].expr = getRawEditorValue();
      }
      activeStepIndex = index;
      const step = pipelineSteps[index];
      if (andPreview || previewStepId === step.id) {
        previewStepId = step.id;
        if (pipelinePreviewSelect) pipelinePreviewSelect.value = step.id;
        showStepPreview(step.id);
      }
      if (step) {
        setEditorValue(step.expr || '');
        if (editor && editor.clearHistory) editor.clearHistory();
      }
      renderPipelineRibbon();
    }

    function renderPipelineRibbon() {
      if (!pipelineStepsList) return;
      pipelineStepsList.innerHTML = '';
      if (pipelineStepCountBadge) {
        pipelineStepCountBadge.textContent = String(pipelineSteps.length);
        pipelineStepCountBadge.style.display = pipelineSteps.length > 0 ? 'inline-block' : 'none';
      }

      pipelineSteps.forEach((step, idx) => {
        const pill = document.createElement('div');
        const isActive = idx === activeStepIndex;
        const isPreviewing = previewStepId === step.id;
        const stepResult = lastPipelineResult && lastPipelineResult.steps ? lastPipelineResult.steps.find(s => s.id === step.id) : null;

        let classes = 'pipeline-step-pill';
        if (isActive) classes += ' active';
        if (isPreviewing) classes += ' previewing';
        if (!step.enabled) classes += ' disabled-step';
        if (stepResult && stepResult.error) classes += ' error-step';
        pill.className = classes;
        pill.setAttribute('data-index', String(idx));
        pill.setAttribute('data-id', step.id);
        pill.title = 'Step ' + (idx + 1) + ': ' + (step.name || step.alias || '') + (step.enabled ? '' : ' (Bypassed)');

        let statusBadge = '';
        if (stepResult) {
          if (stepResult.error) {
            statusBadge = '<span class="pipeline-step-badge" style="background: rgba(244,135,113,0.2); color: #f48771;">❌ Error</span>';
          } else if (stepResult.enabled === false) {
            statusBadge = '<span class="pipeline-step-badge" style="opacity: 0.6;">Bypassed</span>';
          } else {
            const countStr = stepResult.itemCount !== undefined ? stepResult.itemCount + ' items • ' : '';
            statusBadge = '<span class="pipeline-step-badge" style="color: #4ec9b0;">' + countStr + formatDuration(stepResult.durationMs) + '</span>';
          }
        }

        const eyeIndicator = isPreviewing ? '<span title="Currently previewing output in result viewer" style="color: #4ec9b0;">👁️</span> ' : '';

        pill.innerHTML = eyeIndicator +
          '<strong>' + (idx + 1) + '.</strong> ' +
          '<span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(step.name || step.alias || ('Step ' + (idx + 1))) + '</span>' +
          statusBadge;

        pill.addEventListener('click', (e) => {
          selectPipelineStep(idx, true);
        });

        pipelineStepsList.appendChild(pill);

        if (idx < pipelineSteps.length - 1) {
          const arrow = document.createElement('span');
          arrow.className = 'pipeline-step-arrow';
          arrow.textContent = '→';
          pipelineStepsList.appendChild(arrow);
        }
      });

      updatePipelinePreviewOptions();
      updateActiveStepConfigUI();
    }

    function addPipelineStep() {
      if (pipelineSteps[activeStepIndex]) {
        pipelineSteps[activeStepIndex].expr = getRawEditorValue();
      }
      const newNum = pipelineSteps.length + 1;
      const newStep = {
        id: 'step_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'Step ' + newNum,
        alias: 'step' + newNum,
        expr: '// Step ' + newNum + '\\nreturn prev;',
        enabled: true
      };
      pipelineSteps.push(newStep);
      savePipelineToStorage();
      selectPipelineStep(pipelineSteps.length - 1, true);
    }

    function removeCurrentPipelineStep() {
      if (pipelineSteps.length <= 1) {
        pipelineSteps[0] = {
          id: 'step_1',
          name: 'Step 1',
          alias: 'step1',
          expr: '// Step 1\\nreturn data;',
          enabled: true
        };
        selectPipelineStep(0);
        savePipelineToStorage();
        return;
      }
      pipelineSteps.splice(activeStepIndex, 1);
      if (activeStepIndex >= pipelineSteps.length) {
        activeStepIndex = pipelineSteps.length - 1;
      }
      savePipelineToStorage();
      selectPipelineStep(activeStepIndex);
    }

    function moveCurrentStep(dir) {
      const newIdx = activeStepIndex + dir;
      if (newIdx < 0 || newIdx >= pipelineSteps.length) return;
      if (pipelineSteps[activeStepIndex]) {
        pipelineSteps[activeStepIndex].expr = getRawEditorValue();
      }
      const temp = pipelineSteps[activeStepIndex];
      pipelineSteps[activeStepIndex] = pipelineSteps[newIdx];
      pipelineSteps[newIdx] = temp;
      activeStepIndex = newIdx;
      savePipelineToStorage();
      selectPipelineStep(newIdx);
    }

    function duplicateCurrentStep() {
      if (!pipelineSteps[activeStepIndex]) return;
      pipelineSteps[activeStepIndex].expr = getRawEditorValue();
      const source = pipelineSteps[activeStepIndex];
      const copy = {
        id: 'step_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: (source.name || 'Step') + ' (Copy)',
        alias: (source.alias || 'step') + '_copy',
        expr: source.expr,
        enabled: source.enabled
      };
      pipelineSteps.splice(activeStepIndex + 1, 0, copy);
      savePipelineToStorage();
      selectPipelineStep(activeStepIndex + 1);
    }

    function runPipeline() {
      if (pipelineSteps[activeStepIndex]) {
        pipelineSteps[activeStepIndex].expr = getRawEditorValue();
      }
      savePipelineToStorage();
      setLoading(true);
      clearConsoleOutput();
      vscode.postMessage({
        type: 'runPipeline',
        steps: pipelineSteps,
        previewStepId: previewStepId
      });
    }

    function savePipeline() {
      if (pipelineSteps[activeStepIndex]) {
        pipelineSteps[activeStepIndex].expr = getRawEditorValue();
      }
      savePipelineToStorage();
      if (savePipelineBtn) {
        const orig = savePipelineBtn.textContent;
        savePipelineBtn.textContent = '✓ Saved';
        setTimeout(() => { savePipelineBtn.textContent = orig; }, 1500);
      }
    }

    try {
      renderPipelineRibbon();
    } catch (e) {}

    const runTestsBtn = document.getElementById('runTestsBtn');
    const testSuiteBadge = document.getElementById('testSuiteBadge');
    const testSuiteIcon = document.getElementById('testSuiteIcon');
    const testSuiteSummary = document.getElementById('testSuiteSummary');
    const resultTestsContainer = document.getElementById('resultTestsContainer');
    const testsSummaryBanner = document.getElementById('testsSummaryBanner');
    const testsStatusIcon = document.getElementById('testsStatusIcon');
    const testsTitle = document.getElementById('testsTitle');
    const testsSubtitle = document.getElementById('testsSubtitle');
    const testsProgressBar = document.getElementById('testsProgressBar');
    const testsProgressFill = document.getElementById('testsProgressFill');
    const rerunTestsBtn = document.getElementById('rerunTestsBtn');
    const copyTestReportBtn = document.getElementById('copyTestReportBtn');
    const testFilterAll = document.getElementById('testFilterAll');
    const testFilterPassed = document.getElementById('testFilterPassed');
    const testFilterFailed = document.getElementById('testFilterFailed');
    const countAll = document.getElementById('countAll');
    const countPassed = document.getElementById('countPassed');
    const countFailed = document.getElementById('countFailed');
    const testSearchInput = document.getElementById('testSearchInput');
    const testsListContainer = document.getElementById('testsListContainer');
    let currentTestSuite = null;
    let activeTestFilter = 'all';
    let testSearchQuery = '';

    const livePollContainer = document.getElementById('livePollContainer');
    const livePollBadge = document.getElementById('livePollBadge');
    const livePollIntervalSelect = document.getElementById('livePollIntervalSelect');
    const livePollToggleBtn = document.getElementById('livePollToggleBtn');
    const livePollStatusText = document.getElementById('livePollStatusText');
    let isLivePollingActive = false;
    let livePollCount = 0;
    let livePollUpdateTimeout = null;

    function scheduleLivePollUpdate() {
      if (!isLivePollingActive) return;
      if (livePollUpdateTimeout) clearTimeout(livePollUpdateTimeout);
      livePollUpdateTimeout = setTimeout(() => {
        if (activeEditorMode === 'pipeline') {
          if (pipelineSteps[activeStepIndex]) {
            pipelineSteps[activeStepIndex].expr = getRawEditorValue();
          }
          savePipelineToStorage();
          vscode.postMessage({
            type: 'updateLivePollExpr',
            expr: getRawEditorValue(),
            isPipeline: true,
            steps: pipelineSteps,
            previewStepId: previewStepId
          });
        } else {
          vscode.postMessage({
            type: 'updateLivePollExpr',
            expr: getRawEditorValue(),
            isTestMode: activeEditorMode === 'tests',
            target: testTargetSelect ? testTargetSelect.value : 'source',
            queryExpr: (activeEditorMode === 'tests' && testTargetSelect && testTargetSelect.value === 'query') ? (localStorage.getItem('jsonQueryTools.queryExpr') || '') : undefined
          });
        }
      }, 250);
    }

    function updateLivePollUI(active, count, durationMs) {
      isLivePollingActive = Boolean(active);
      if (livePollToggleBtn) {
        livePollToggleBtn.textContent = isLivePollingActive ? 'Stop' : 'Start';
        if (isLivePollingActive) {
          if (livePollToggleBtn.classList) livePollToggleBtn.classList.add('active-poll');
          livePollToggleBtn.style.background = '#e51400';
          livePollToggleBtn.style.color = '#ffffff';
        } else {
          if (livePollToggleBtn.classList) livePollToggleBtn.classList.remove('active-poll');
          livePollToggleBtn.style.background = '';
          livePollToggleBtn.style.color = '';
        }
      }
      if (livePollBadge) {
        livePollBadge.style.display = isLivePollingActive ? 'inline-flex' : 'none';
      }
      if (livePollStatusText) {
        if (isLivePollingActive) {
          livePollStatusText.style.display = 'inline';
          const countText = count !== undefined ? '#' + count : '';
          const durText = durationMs !== undefined ? ' (' + formatDuration(durationMs) + ')' : '';
          livePollStatusText.textContent = '● Poll ' + countText + durText;
        } else {
          livePollStatusText.style.display = 'none';
          livePollStatusText.textContent = '';
        }
      }
    }

    function hideTests() {
      if (resultTestsContainer) resultTestsContainer.style.display = 'none';
    }

    function updateTestSuiteBadge(suite) {
      if (!testSuiteBadge) return;
      if (!suite || !suite.tests || suite.tests.length === 0) {
        testSuiteBadge.style.display = 'none';
        return;
      }
      testSuiteBadge.style.display = 'inline-flex';
      if (suite.failed === 0) {
        testSuiteBadge.className = 'test-suite-badge badge-passed';
        if (testSuiteIcon) testSuiteIcon.textContent = '✅';
        if (testSuiteSummary) testSuiteSummary.textContent = suite.passed + ' Passed';
      } else {
        testSuiteBadge.className = 'test-suite-badge badge-failed';
        if (testSuiteIcon) testSuiteIcon.textContent = '❌';
        if (testSuiteSummary) {
          testSuiteSummary.textContent = suite.failed + ' Failed' + (suite.passed > 0 ? ', ' + suite.passed + ' Passed' : '');
        }
      }
    }

    function setTestFilter(filter) {
      activeTestFilter = filter;
      if (testFilterAll) testFilterAll.classList.toggle('active', filter === 'all');
      if (testFilterPassed) testFilterPassed.classList.toggle('active', filter === 'passed');
      if (testFilterFailed) testFilterFailed.classList.toggle('active', filter === 'failed');
      renderTestCards();
    }

    function renderTestResults() {
      if (!currentTestSuite) {
        if (testsStatusIcon) testsStatusIcon.textContent = '🧪';
        if (testsTitle) testsTitle.textContent = 'No Tests Executed';
        if (testsSubtitle) testsSubtitle.textContent = 'Click "Run Tests" or use test() / expect() in your query';
        if (testsSummaryBanner) testsSummaryBanner.className = 'tests-summary-banner';
        if (testsProgressFill) testsProgressFill.style.width = '0%';
        if (countAll) countAll.textContent = '0';
        if (countPassed) countPassed.textContent = '0';
        if (countFailed) countFailed.textContent = '0';
        if (testsListContainer) {
          testsListContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">No tests have been executed yet.<br/><span style="opacity: 0.8; font-size: 11px; margin-top: 4px; display: inline-block;">Write <code>test(&quot;name&quot;, () =&gt; { expect(data)... })</code> or <code>assert(...)</code> in your query.</span></div>';
        }
        return;
      }

      const suite = currentTestSuite;
      if (countAll) countAll.textContent = String(suite.total);
      if (countPassed) countPassed.textContent = String(suite.passed);
      if (countFailed) countFailed.textContent = String(suite.failed);

      if (testsSummaryBanner) {
        if (suite.failed === 0) {
          testsSummaryBanner.className = 'tests-summary-banner tests-passed-banner';
          if (testsStatusIcon) testsStatusIcon.textContent = '✅';
          if (testsTitle) testsTitle.textContent = 'All ' + suite.passed + ' Tests Passed';
          if (testsSubtitle) {
            testsSubtitle.textContent = suite.passed + ' passed of ' + suite.total + ' tests • ' + suite.durationMs.toFixed(1) + 'ms';
          }
          if (testsProgressFill) {
            testsProgressFill.className = 'tests-progress-fill fill-passed';
            testsProgressFill.style.width = '100%';
          }
        } else {
          testsSummaryBanner.className = 'tests-summary-banner tests-failed-banner';
          if (testsStatusIcon) testsStatusIcon.textContent = '❌';
          if (testsTitle) testsTitle.textContent = suite.failed + ' of ' + suite.total + ' Tests Failed';
          if (testsSubtitle) {
            testsSubtitle.textContent = suite.passed + ' passed, ' + suite.failed + ' failed • ' + suite.durationMs.toFixed(1) + 'ms';
          }
          if (testsProgressFill) {
            testsProgressFill.className = 'tests-progress-fill fill-failed';
            const pct = suite.total > 0 ? Math.round((suite.passed / suite.total) * 100) : 0;
            testsProgressFill.style.width = pct + '%';
          }
        }
      }

      renderTestCards();
    }

    function renderTestCards() {
      if (!testsListContainer) return;
      if (!currentTestSuite || !currentTestSuite.tests || currentTestSuite.tests.length === 0) {
        testsListContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--vscode-descriptionForeground, #858585); font-size: 12px;">No tests have been executed yet.</div>';
        return;
      }

      const suite = currentTestSuite;
      const filtered = suite.tests.filter(t => {
        const isP = t.status === 'passed' || t.status === 'pass';
        const isF = t.status === 'failed' || t.status === 'fail';
        if (activeTestFilter === 'passed' && !isP) return false;
        if (activeTestFilter === 'failed' && !isF) return false;
        if (testSearchQuery) {
          const matchName = t.name && t.name.toLowerCase().includes(testSearchQuery);
          const matchErr = t.error && t.error.message && t.error.message.toLowerCase().includes(testSearchQuery);
          return Boolean(matchName || matchErr);
        }
        return true;
      });

      if (filtered.length === 0) {
        testsListContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground, #858585); font-size: 11px;">No tests match the current filter or search criteria.</div>';
        return;
      }

      testsListContainer.innerHTML = '';
      for (const t of filtered) {
        const card = document.createElement('div');
        const isPassed = t.status === 'passed' || t.status === 'pass';
        card.className = 'test-card ' + (isPassed ? 'test-card-passed' : 'test-card-failed');

        const header = document.createElement('div');
        header.className = 'test-card-header';
        header.style.cursor = isPassed ? 'default' : 'pointer';

        const leftGroup = document.createElement('div');
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '8px';

        const icon = document.createElement('span');
        icon.className = 'test-status-icon ' + (isPassed ? 'icon-pass' : 'icon-fail');
        icon.textContent = isPassed ? '✓' : '✕';
        leftGroup.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = '500';
        nameSpan.style.fontSize = '12px';
        nameSpan.textContent = t.name;
        leftGroup.appendChild(nameSpan);

        header.appendChild(leftGroup);

        const rightGroup = document.createElement('div');
        rightGroup.style.display = 'flex';
        rightGroup.style.alignItems = 'center';
        rightGroup.style.gap = '8px';

        const durPill = document.createElement('span');
        durPill.className = 'test-duration-pill';
        durPill.textContent = t.durationMs.toFixed(1) + 'ms';
        rightGroup.appendChild(durPill);

        if (!isPassed) {
          const toggleSpan = document.createElement('span');
          toggleSpan.className = 'test-card-toggle';
          toggleSpan.textContent = '▼';
          rightGroup.appendChild(toggleSpan);
        }

        header.appendChild(rightGroup);
        card.appendChild(header);

        if (!isPassed && t.error) {
          const body = document.createElement('div');
          body.className = 'test-card-body';

          const errMsg = document.createElement('div');
          errMsg.className = 'test-error-message';
          errMsg.textContent = t.error.message;
          body.appendChild(errMsg);

          if (t.error.expected !== undefined || t.error.actual !== undefined) {
            const diffBox = document.createElement('div');
            diffBox.className = 'test-diff-box';

            if (t.error.expected !== undefined) {
              const rowExp = document.createElement('div');
              rowExp.className = 'test-diff-row expected';
              rowExp.innerHTML = '<span class="diff-label">Expected:</span><span class="diff-val"></span>';
              rowExp.querySelector('.diff-val').textContent = String(t.error.expected);
              diffBox.appendChild(rowExp);
            }

            if (t.error.actual !== undefined) {
              const rowAct = document.createElement('div');
              rowAct.className = 'test-diff-row actual';
              rowAct.innerHTML = '<span class="diff-label">Actual:</span><span class="diff-val"></span>';
              rowAct.querySelector('.diff-val').textContent = String(t.error.actual);
              diffBox.appendChild(rowAct);
            }

            body.appendChild(diffBox);
          }

          if (t.error.stack) {
            const stackLines = t.error.stack.split(String.fromCharCode(10)).slice(1, 4).join(String.fromCharCode(10));
            if (stackLines && stackLines.trim()) {
              const stackPre = document.createElement('pre');
              stackPre.style.margin = '6px 0 0 0';
              stackPre.style.fontSize = '10px';
              stackPre.style.color = 'var(--vscode-descriptionForeground, #858585)';
              stackPre.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
              stackPre.textContent = stackLines;
              body.appendChild(stackPre);
            }
          }

          card.appendChild(body);

          header.onclick = () => {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            const toggle = header.querySelector('.test-card-toggle');
            if (toggle) toggle.textContent = isOpen ? '▶' : '▼';
          };
        }

        testsListContainer.appendChild(card);
      }
    }

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

    let lastBenchmark = null;

    function formatDuration(ms) {
      if (typeof ms !== 'number' || isNaN(ms)) return '0ms';
      if (ms < 1) return (Math.round(ms * 10) / 10) + 'ms';
      if (ms < 1000) return (Math.round(ms * 10) / 10) + 'ms';
      return (ms / 1000).toFixed(2) + 's';
    }

    function formatBytes(bytes) {
      if (bytes === 0 || !bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function updateBenchmarkMeter(durationMs, byteSize, text) {
      if (durationMs !== undefined && durationMs !== null) {
        if (!lastBenchmark) lastBenchmark = {};
        lastBenchmark.durationMs = durationMs;
      }
      if (byteSize !== undefined && byteSize !== null) {
        if (!lastBenchmark) lastBenchmark = {};
        lastBenchmark.byteSize = byteSize;
      } else if (text && text.length > 0) {
        if (!lastBenchmark) lastBenchmark = {};
        try {
          lastBenchmark.byteSize = (typeof TextEncoder !== 'undefined')
            ? new TextEncoder().encode(text).length
            : text.length;
        } catch (e) {
          lastBenchmark.byteSize = text.length;
        }
      }

      if (!lastBenchmark || (lastBenchmark.durationMs === undefined && lastBenchmark.byteSize === undefined)) {
        if (benchmarkMeter) benchmarkMeter.style.display = 'none';
        return;
      }

      const durText = lastBenchmark.durationMs !== undefined ? formatDuration(lastBenchmark.durationMs) : '0ms';
      const sizeText = lastBenchmark.byteSize !== undefined ? formatBytes(lastBenchmark.byteSize) : '0 B';

      if (benchmarkDuration) benchmarkDuration.textContent = '⏱️ ' + durText;
      if (benchmarkByteSize) benchmarkByteSize.textContent = '💾 ' + sizeText;
      if (benchmarkMeter) {
        benchmarkMeter.style.display = 'inline-flex';
        benchmarkMeter.title = 'Execution time: ' + durText + ' | Size: ' + sizeText + 
          (lastBenchmark.byteSize !== undefined ? ' (' + lastBenchmark.byteSize.toLocaleString() + ' bytes)' : '');
      }

      if (resultInfo) {
        resultInfo.setAttribute('data-duration', durText);
        resultInfo.setAttribute('data-bytes', String(lastBenchmark.byteSize ?? 0));
        resultInfo.title = 'Query execution: ' + durText + ' | Size: ' + sizeText;
      }
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
          let streamBtn = '';
          if (s.streamMode === 'sse') {
            const isStreaming = Boolean(s.isStreaming);
            streamBtn = '<button class="toggle-stream-btn sse-btn' + (isStreaming ? ' active-stream' : '') + '" data-id="' + escapeHtml(s.id || '') + '" data-mode="sse" title="' + (isStreaming ? 'Disconnect SSE stream' : 'Connect SSE stream') + '">' + (isStreaming ? '📡 Live' : '📡 SSE') + '</button>';
          } else if (s.streamMode === 'ws' || (s.url && (s.url.startsWith('ws://') || s.url.startsWith('wss://')))) {
            const isStreaming = Boolean(s.isStreaming);
            streamBtn = '<button class="toggle-stream-btn ws-btn' + (isStreaming ? ' active-stream' : '') + '" data-id="' + escapeHtml(s.id || '') + '" data-mode="ws" title="' + (isStreaming ? 'Disconnect WebSocket' : 'Connect WebSocket') + '">' + (isStreaming ? '⚡ Connected' : '⚡ WS') + '</button>';
          }
          return '<span class="bound-file bound-url" data-alias="' + escapeHtml(s.alias) + '" data-id="' + escapeHtml(s.id || '') + '" title="' + escapeHtml(method) + ' ' + escapeHtml(s.url || '') + '">' +
            '<span class="url-badge-method ' + methodClass + '">' + escapeHtml(method) + '</span>' +
            '<span class="file-alias">' + escapeHtml(s.alias) + '</span>: ' + escapeHtml(s.label || s.url || '') +
            streamBtn +
            '<button class="inspect-source-btn" data-id="' + escapeHtml(s.id || '') + '" title="View cached API response">👁️</button>' +
            '<button class="copy-url-curl-btn" data-id="' + escapeHtml(s.id || '') + '" title="Copy as cURL command">📋</button>' +
            '<button class="refresh-url-btn" data-id="' + escapeHtml(s.id || '') + '" title="Re-fetch data from URL">🔄</button>' +
            '<button class="edit-url-btn" data-id="' + escapeHtml(s.id || '') + '" title="Edit URL, headers, or method">✏️</button>' +
            '<button class="remove-source" data-alias="' + escapeHtml(s.alias) + '" data-id="' + escapeHtml(s.id || '') + '" title="Remove source" aria-label="Remove source">×</button>' +
          '</span>';
        }
        return '<span class="bound-file" data-alias="' + escapeHtml(s.alias) + '" title="' + escapeHtml(s.label) + '">' +
          '<span class="file-icon">📁</span> ' +
          '<span class="file-alias">' + escapeHtml(s.alias) + '</span>: ' + escapeHtml(s.label.split('/').pop() || s.label) +
          '<button class="inspect-source-btn" data-alias="' + escapeHtml(s.alias) + '" title="View JSON data">👁️</button>' +
          '<button class="remove-source" data-alias="' + escapeHtml(s.alias) + '" title="Remove source" aria-label="Remove source">×</button>' +
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

      updateTestTargetSelectOptions();
    }

    function updateTestTargetSelectOptions() {
      const select = document.getElementById('testTargetSelect');
      if (!select || typeof select.appendChild !== 'function') return;
      const currentSelected = select.value || (window.localStorage && localStorage.getItem('jsonQueryTools.testTarget')) || 'source';
      select.innerHTML = '';

      if (currentSources && currentSources.length >= 2) {
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All Bound Sources (Combined)';
        select.appendChild(allOpt);

        currentSources.forEach(s => {
          const opt = document.createElement('option');
          opt.value = 'source:' + s.alias;
          const displayLabel = s.label.split('/').pop() || s.label || s.alias;
          opt.textContent = displayLabel + ' (' + s.alias + ')';
          select.appendChild(opt);
        });

        const resOpt = document.createElement('option');
        resOpt.value = 'result';
        resOpt.textContent = 'Query Result (result)';
        select.appendChild(resOpt);
      } else if (currentSources && currentSources.length === 1) {
        const s = currentSources[0];
        const opt = document.createElement('option');
        opt.value = 'source:' + s.alias;
        const displayLabel = s.label.split('/').pop() || s.label || s.alias;
        opt.textContent = displayLabel + ' (' + s.alias + ')';
        select.appendChild(opt);

        const resOpt = document.createElement('option');
        resOpt.value = 'result';
        resOpt.textContent = 'Query Result (result)';
        select.appendChild(resOpt);
      } else {
        const srcOpt = document.createElement('option');
        srcOpt.value = 'source';
        srcOpt.textContent = 'Raw Source Data (data)';
        select.appendChild(srcOpt);

        const resOpt = document.createElement('option');
        resOpt.value = 'result';
        resOpt.textContent = 'Query Result (result)';
        select.appendChild(resOpt);
      }

      // Check if currentSelected matches any option
      const optionsArr = select.options ? Array.from(select.options) : [];
      const exists = optionsArr.some(o => o.value === currentSelected);
      if (exists) {
        select.value = currentSelected;
      } else {
        if (currentSources && currentSources.length >= 2) {
          select.value = 'all';
        } else if (currentSources && currentSources.length === 1) {
          select.value = 'source:' + currentSources[0].alias;
        } else {
          select.value = 'source';
        }
      }
      if (window.localStorage && localStorage.setItem) {
        localStorage.setItem('jsonQueryTools.testTarget', select.value);
      }
    }

    let currentResultData = null;
    let currentResultText = '';
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

    // Workspace Layout & AI Drawer Controls
    const aiDrawer = document.getElementById('aiDrawer');
    const toggleAiDrawerBtn = document.getElementById('toggleAiDrawerBtn');
    const layoutToggleBtn = document.getElementById('layoutToggleBtn');
    const layoutToggleIcon = document.getElementById('layoutToggleIcon');
    const layoutToggleLabel = document.getElementById('layoutToggleLabel');
    const workspaceLayout = document.getElementById('workspaceLayout');
    const editorPane = document.getElementById('editorPane');
    const resultPane = document.getElementById('resultPane');

    function refreshEditors() {
      setTimeout(function() {
        if (typeof editor !== 'undefined' && editor && typeof editor.refresh === 'function') {
          editor.refresh();
        }
        if (typeof resultJsonEditor !== 'undefined' && resultJsonEditor && typeof resultJsonEditor.refresh === 'function') {
          resultJsonEditor.refresh();
        }
      }, 50);
      setTimeout(function() {
        if (typeof editor !== 'undefined' && editor && typeof editor.refresh === 'function') {
          editor.refresh();
        }
        if (typeof resultJsonEditor !== 'undefined' && resultJsonEditor && typeof resultJsonEditor.refresh === 'function') {
          resultJsonEditor.refresh();
        }
      }, 150);
    }

    function toggleAiDrawer(forceState) {
      if (!aiDrawer) return;
      const isOpen = typeof forceState === 'boolean'
        ? forceState
        : (aiDrawer.style && aiDrawer.style.display === 'none');
      if (aiDrawer.style) {
        aiDrawer.style.display = isOpen ? 'flex' : 'none';
      }
      if (toggleAiDrawerBtn) {
        if (toggleAiDrawerBtn.classList) toggleAiDrawerBtn.classList.toggle('active', isOpen);
        toggleAiDrawerBtn.title = isOpen ? 'Hide AI Query Assistant Panel' : 'Show AI Query Assistant Panel';
      }
      try {
        if (window.localStorage && localStorage.setItem) {
          localStorage.setItem('jsonQueryTools.aiDrawerOpen', isOpen ? 'true' : 'false');
        }
      } catch (e) {}
      refreshEditors();
    }

    if (toggleAiDrawerBtn) {
      toggleAiDrawerBtn.onclick = function() {
        toggleAiDrawer();
      };
    }

    function updateHistoryPlacement(mode) {
      if (typeof document === 'undefined') return;
      const historyEl = document.getElementById('history');
      if (!historyEl || !editorPane || !workspaceLayout) return;
      if (mode === 'split') {
        if (historyEl.parentElement !== editorPane && typeof editorPane.appendChild === 'function') {
          editorPane.appendChild(historyEl);
        }
      } else {
        if (historyEl.parentElement !== workspaceLayout && typeof workspaceLayout.appendChild === 'function') {
          workspaceLayout.appendChild(historyEl);
        }
      }
    }

    function setLayoutMode(mode) {
      const isSplit = mode === 'split';
      if (workspaceLayout && workspaceLayout.classList) {
        workspaceLayout.classList.toggle('split', isSplit);
        workspaceLayout.classList.toggle('stacked', !isSplit);
      }
      if (typeof document !== 'undefined' && document.body && document.body.classList) {
        document.body.classList.toggle('layout-split', isSplit);
      }

      if (layoutToggleBtn) {
        if (layoutToggleBtn.classList) layoutToggleBtn.classList.toggle('active', isSplit);
        if (layoutToggleIcon) layoutToggleIcon.textContent = isSplit ? '☰' : '◫';
        if (layoutToggleLabel) layoutToggleLabel.textContent = isSplit ? 'Stacked View' : 'Split View';
        layoutToggleBtn.title = isSplit
          ? 'Switch to Stacked (Vertical) Layout Mode'
          : 'Switch to Side-by-Side (Split) Layout Mode';
      }

      updateHistoryPlacement(mode);

      try {
        if (window.localStorage && localStorage.setItem) {
          localStorage.setItem('jsonQueryTools.layoutMode', mode);
        }
      } catch (e) {}

      refreshEditors();
    }

    if (layoutToggleBtn) {
      layoutToggleBtn.onclick = function() {
        const currentMode = workspaceLayout && workspaceLayout.classList && workspaceLayout.classList.contains('split') ? 'split' : 'stacked';
        const nextMode = currentMode === 'split' ? 'stacked' : 'split';
        setLayoutMode(nextMode);
      };
    }

    // Restore saved layout and drawer preferences
    let savedLayout = 'stacked';
    try {
      if (window.localStorage && localStorage.getItem) {
        savedLayout = localStorage.getItem('jsonQueryTools.layoutMode') || 'stacked';
      }
    } catch (e) {}
    setLayoutMode(savedLayout);

    let savedAiDrawerOpen = false;
    try {
      if (window.localStorage && localStorage.getItem) {
        savedAiDrawerOpen = localStorage.getItem('jsonQueryTools.aiDrawerOpen') === 'true';
      }
    } catch (e) {}
    toggleAiDrawer(savedAiDrawerOpen);

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
                scheduleLivePollUpdate();
                if (typeof activeEditorMode !== 'undefined' && activeEditorMode === 'tests') {
                  updateTestCountBadge();
                }
              });
              editor.on('blur', () => {
                scheduleSyntaxValidation(0); // immediate check on blur
              });
              
              // Setup schema autocomplete
              setupSchemaAutocomplete();
              if (typeof updateTestCountBadge === 'function') {
                updateTestCountBadge(testCode);
              }
              
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

    // ==========================================
    // Visual Lens (JSON Path & Expression Picker)
    // ==========================================
    function parseJsonWithPositions(text) {
      if (!text || typeof text !== 'string') return null;
      let i = 0;
      const len = text.length;

      function skipWhitespace() {
        while (i < len) {
          const ch = text.charCodeAt(i);
          if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
            i++;
          } else {
            break;
          }
        }
      }

      function parseString() {
        const start = i;
        i++; // skip opening quote
        let str = '';
        while (i < len) {
          const ch = text[i];
          if (ch === '\\\\') {
            i++;
            if (i < len) {
              const esc = text[i];
              if (esc === '"' || esc === '\\\\' || esc === '/') str += esc;
              else if (esc === 'b') str += '\\b';
              else if (esc === 'f') str += '\\f';
              else if (esc === 'n') str += '\\n';
              else if (esc === 'r') str += '\\r';
              else if (esc === 't') str += '\\t';
              else if (esc === 'u') {
                const hex = text.slice(i + 1, i + 5);
                str += String.fromCharCode(parseInt(hex, 16) || 0);
                i += 4;
              } else {
                str += esc;
              }
              i++;
            }
          } else if (ch === '"') {
            i++; // skip closing quote
            return { type: 'string', value: str, start: start, end: i };
          } else {
            str += ch;
            i++;
          }
        }
        return { type: 'string', value: str, start: start, end: i };
      }

      function parseNumber() {
        const start = i;
        if (text[i] === '-') i++;
        while (i < len && text[i] >= '0' && text[i] <= '9') i++;
        if (i < len && text[i] === '.') {
          i++;
          while (i < len && text[i] >= '0' && text[i] <= '9') i++;
        }
        if (i < len && (text[i] === 'e' || text[i] === 'E')) {
          i++;
          if (i < len && (text[i] === '+' || text[i] === '-')) i++;
          while (i < len && text[i] >= '0' && text[i] <= '9') i++;
        }
        const raw = text.slice(start, i);
        return { type: 'number', value: Number(raw), raw: raw, start: start, end: i };
      }

      function parseValue(parent, keyOrIndex) {
        skipWhitespace();
        if (i >= len) return null;

        const start = i;
        const ch = text[i];

        if (ch === '{') {
          return parseObject(parent, keyOrIndex);
        } else if (ch === '[') {
          return parseArray(parent, keyOrIndex);
        } else if (ch === '"') {
          const s = parseString();
          return { type: 'string', value: s.value, start: s.start, end: s.end, parent: parent, keyOrIndex: keyOrIndex };
        } else if (ch === 't' && text.startsWith('true', i)) {
          i += 4;
          return { type: 'boolean', value: true, start: start, end: i, parent: parent, keyOrIndex: keyOrIndex };
        } else if (ch === 'f' && text.startsWith('false', i)) {
          i += 5;
          return { type: 'boolean', value: false, start: start, end: i, parent: parent, keyOrIndex: keyOrIndex };
        } else if (ch === 'n' && text.startsWith('null', i)) {
          i += 4;
          return { type: 'null', value: null, start: start, end: i, parent: parent, keyOrIndex: keyOrIndex };
        } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
          const n = parseNumber();
          return { type: 'number', value: n.value, raw: n.raw, start: n.start, end: n.end, parent: parent, keyOrIndex: keyOrIndex };
        } else {
          i++;
          return null;
        }
      }

      function parseObject(parent, keyOrIndex) {
        const start = i;
        i++; // skip '{'
        const properties = [];
        const node = { type: 'object', start: start, end: start + 1, parent: parent, keyOrIndex: keyOrIndex, properties: properties };

        while (i < len) {
          skipWhitespace();
          if (i < len && text[i] === '}') {
            i++;
            node.end = i;
            return node;
          }
          if (i < len && text[i] === ',') {
            i++;
            continue;
          }
          if (i >= len) break;

          if (text[i] !== '"') {
            i++;
            continue;
          }
          const keyToken = parseString();
          skipWhitespace();
          if (i < len && text[i] === ':') {
            i++; // skip ':'
          }
          const valNode = parseValue(node, keyToken.value);
          const propNode = {
            type: 'property',
            key: keyToken.value,
            keyStart: keyToken.start,
            keyEnd: keyToken.end,
            start: keyToken.start,
            end: valNode ? valNode.end : keyToken.end,
            valueNode: valNode,
            parent: node
          };
          if (valNode) valNode.parent = propNode;
          properties.push(propNode);
        }
        node.end = i;
        return node;
      }

      function parseArray(parent, keyOrIndex) {
        const start = i;
        i++; // skip '['
        const elements = [];
        const node = { type: 'array', start: start, end: start + 1, parent: parent, keyOrIndex: keyOrIndex, elements: elements };
        let index = 0;

        while (i < len) {
          skipWhitespace();
          if (i < len && text[i] === ']') {
            i++;
            node.end = i;
            return node;
          }
          if (i < len && text[i] === ',') {
            i++;
            continue;
          }
          if (i >= len) break;

          const elemNode = parseValue(node, index);
          if (elemNode) {
            elements.push(elemNode);
            index++;
          }
        }
        node.end = i;
        return node;
      }

      skipWhitespace();
      return parseValue(null, null);
    }

    function findJsonNodeAtOffset(ast, offset) {
      if (!ast) return null;

      function findDeepest(node) {
        if (!node) return null;
        if (offset < node.start || offset > node.end) return null;

        if (node.type === 'object' && node.properties) {
          for (let pIdx = 0; pIdx < node.properties.length; pIdx++) {
            const p = node.properties[pIdx];
            if (offset >= p.keyStart && offset <= p.keyEnd) {
              return { node: p, isKey: true };
            }
            if (p.valueNode && offset >= p.valueNode.start && offset <= p.valueNode.end) {
              const deeper = findDeepest(p.valueNode);
              return deeper || { node: p.valueNode, isKey: false };
            }
          }
        } else if (node.type === 'array' && node.elements) {
          for (let eIdx = 0; eIdx < node.elements.length; eIdx++) {
            const el = node.elements[eIdx];
            if (offset >= el.start && offset <= el.end) {
              const deeper = findDeepest(el);
              return deeper || { node: el, isKey: false };
            }
          }
        } else if (node.type === 'property') {
          if (offset >= node.keyStart && offset <= node.keyEnd) {
            return { node: node, isKey: true };
          }
          if (node.valueNode && offset >= node.valueNode.start && offset <= node.valueNode.end) {
            const deeper = findDeepest(node.valueNode);
            return deeper || { node: node.valueNode, isKey: false };
          }
        }

        return { node: node, isKey: false };
      }

      return findDeepest(ast);
    }

    function resolveLensPath(hit, rootAlias) {
      if (!hit || !hit.node) return null;
      rootAlias = rootAlias || 'data';
      const isKey = Boolean(hit.isKey);
      let curr = hit.node;

      const segments = [];
      let targetValue = curr.value;
      let targetType = curr.type;

      if (curr.type === 'property') {
        targetValue = curr.key;
        targetType = 'string';
        segments.unshift({ type: 'prop', val: curr.key });
        curr = curr.parent;
      }

      while (curr) {
        if (curr.type === 'property') {
          segments.unshift({ type: 'prop', val: curr.key });
        } else if (curr.parent && curr.parent.type === 'array') {
          segments.unshift({ type: 'index', val: curr.keyOrIndex });
        }
        curr = curr.parent;
      }

      let standardPath = rootAlias;
      let optionalPath = rootAlias;

      for (let sIdx = 0; sIdx < segments.length; sIdx++) {
        const seg = segments[sIdx];
        if (seg.type === 'index') {
          standardPath += '[' + seg.val + ']';
          optionalPath += '?.[' + seg.val + ']';
        } else {
          const isValidIdent = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg.val);
          if (isValidIdent) {
            standardPath += '.' + seg.val;
            optionalPath += '?.' + seg.val;
          } else {
            standardPath += '[' + JSON.stringify(seg.val) + ']';
            optionalPath += '?.[' + JSON.stringify(seg.val) + ']';
          }
        }
      }

      let ancestorArrayPath = null;
      let relativeProp = null;

      let lastIndexPos = -1;
      for (let s = segments.length - 1; s >= 0; s--) {
        if (segments[s].type === 'index') {
          lastIndexPos = s;
          break;
        }
      }

      if (lastIndexPos !== -1) {
        ancestorArrayPath = rootAlias;
        for (let s = 0; s < lastIndexPos; s++) {
          const seg = segments[s];
          if (seg.type === 'index') {
            ancestorArrayPath += '[' + seg.val + ']';
          } else {
            ancestorArrayPath += /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg.val)
              ? '.' + seg.val
              : '[' + JSON.stringify(seg.val) + ']';
          }
        }

        const relSegs = segments.slice(lastIndexPos + 1);
        if (relSegs.length > 0) {
          relativeProp = '';
          for (let r = 0; r < relSegs.length; r++) {
            const seg = relSegs[r];
            if (seg.type === 'index') relativeProp += '[' + seg.val + ']';
            else {
              if (r === 0) relativeProp += seg.val;
              else relativeProp += '.' + seg.val;
            }
          }
        }
      } else if (segments.length > 0) {
        relativeProp = segments.map(function(s) { return s.val; }).join('.');
      }

      return {
        standardPath: standardPath,
        optionalPath: optionalPath,
        segments: segments,
        targetValue: targetValue,
        targetType: targetType,
        isKey: isKey,
        ancestorArrayPath: ancestorArrayPath,
        relativeProp: relativeProp
      };
    }

    function displayLensInfo(info) {
      if (!info || !visualLensBar) return;
      currentLensInfo = info;

      if (!lensDismissed) {
        visualLensBar.style.display = 'flex';
      }

      const useOptional = lensOptionalChainingToggle && lensOptionalChainingToggle.checked;
      const activePath = useOptional ? (info.optionalPath || info.standardPath) : info.standardPath;
      if (lensPathDisplay) {
        lensPathDisplay.textContent = activePath || 'data';
        lensPathDisplay.title = 'Click to copy: ' + activePath;
      }

      if (lensValueBadge) {
        if (info.targetType === 'column') {
          lensValueBadge.textContent = 'column: ' + String(info.targetValue);
          lensValueBadge.style.display = 'inline-block';
        } else if (info.targetValue !== undefined) {
          let valStr = '';
          try {
            valStr = typeof info.targetValue === 'object' && info.targetValue !== null
              ? JSON.stringify(info.targetValue)
              : String(info.targetValue);
          } catch {
            valStr = String(info.targetValue);
          }
          if (valStr.length > 32) valStr = valStr.slice(0, 29) + '...';
          lensValueBadge.textContent = '= ' + valStr + ' (' + info.targetType + ')';
          lensValueBadge.style.display = 'inline-block';
        } else {
          lensValueBadge.style.display = 'none';
        }
      }

      if (lensFilterBtn) {
        lensFilterBtn.style.display = info.filterExpr ? 'inline-block' : 'none';
      }
      if (lensExtractBtn) {
        lensExtractBtn.style.display = info.extractExpr ? 'inline-block' : 'none';
      }
      if (lensGroupByBtn) {
        lensGroupByBtn.style.display = info.groupByExpr ? 'inline-block' : 'none';
      }
    }

    function updateVisualLensFromOffset(jsonText, offset) {
      if (!jsonText || typeof jsonText !== 'string' || !jsonText.trim()) return;
      try {
        const ast = parseJsonWithPositions(jsonText);
        if (!ast) return;
        const hit = findJsonNodeAtOffset(ast, offset);
        if (!hit) return;
        const resolved = resolveLensPath(hit, 'data');
        if (!resolved) return;

        let filterExpr = null;
        let extractExpr = null;
        let groupByExpr = null;

        if (resolved.ancestorArrayPath) {
          const arrPath = resolved.ancestorArrayPath;
          const valLiteral = JSON.stringify(resolved.targetValue);
          if (resolved.relativeProp) {
            const prop = resolved.relativeProp;
            filterExpr = arrPath + '.filter(item => item.' + prop + ' === ' + valLiteral + ')';
            extractExpr = arrPath + '.map(item => item.' + prop + ')';
            groupByExpr = 'Object.groupBy(' + arrPath + ', item => item.' + prop + ')';
          } else if (resolved.targetValue !== undefined && resolved.targetType !== 'object' && resolved.targetType !== 'array') {
            filterExpr = arrPath + '.filter(item => item === ' + valLiteral + ')';
            groupByExpr = 'Object.groupBy(' + arrPath + ', item => item)';
          }
        }

        displayLensInfo({
          standardPath: resolved.standardPath,
          optionalPath: resolved.optionalPath,
          targetValue: resolved.targetValue,
          targetType: resolved.targetType,
          filterExpr: filterExpr,
          extractExpr: extractExpr,
          groupByExpr: groupByExpr
        });
      } catch (e) {
        // Gracefully ignore parse errors
      }
    }

    function updateVisualLensFromTableCell(pageRowIndex, colIndex) {
      if (!currentTableData || !Array.isArray(currentTableData)) return;
      const actualRowIndex = (tableCurrentPage - 1) * currentTablePageSize + pageRowIndex;
      const rowItem = currentTableData[actualRowIndex];
      if (rowItem === undefined) return;

      const ths = resultTableHead ? resultTableHead.querySelectorAll('th') : [];
      const colName = ths[colIndex] ? ths[colIndex].textContent.trim() : null;

      let val = undefined;
      if (colName && typeof rowItem === 'object' && rowItem !== null) {
        val = rowItem[colName];
      } else {
        val = rowItem;
      }

      const standardPath = colName ? 'data[' + actualRowIndex + '].' + colName : 'data[' + actualRowIndex + ']';
      const optionalPath = colName ? 'data?.[' + actualRowIndex + ']?.' + colName : 'data?.[' + actualRowIndex + ']';
      const filterExpr = colName ? 'data.filter(item => item.' + colName + ' === ' + JSON.stringify(val) + ')' : null;
      const extractExpr = colName ? 'data.map(item => item.' + colName + ')' : null;
      const groupByExpr = colName ? 'Object.groupBy(data, item => item.' + colName + ')' : null;

      displayLensInfo({
        standardPath: standardPath,
        optionalPath: optionalPath,
        targetValue: val,
        targetType: typeof val,
        filterExpr: filterExpr,
        extractExpr: extractExpr,
        groupByExpr: groupByExpr
      });
    }

    function updateVisualLensFromTableHeader(colName) {
      if (!colName) return;
      const standardPath = 'item.' + colName;
      const optionalPath = 'item?.' + colName;
      const extractExpr = 'data.map(item => item.' + colName + ')';
      const groupByExpr = 'Object.groupBy(data, item => item.' + colName + ')';

      displayLensInfo({
        standardPath: standardPath,
        optionalPath: optionalPath,
        targetValue: colName,
        targetType: 'column',
        filterExpr: null,
        extractExpr: extractExpr,
        groupByExpr: groupByExpr
      });
    }

    function setupVisualLensUI() {
      if (toggleVisualLensBtn) {
        toggleVisualLensBtn.onclick = function() {
          if (!visualLensBar) return;
          if (visualLensBar.style.display === 'none') {
            lensDismissed = false;
            visualLensBar.style.display = 'flex';
            if (!currentLensInfo && currentResultText) {
              updateVisualLensFromOffset(currentResultText, 0);
            }
          } else {
            visualLensBar.style.display = 'none';
          }
        };
      }

      if (lensCloseBtn) {
        lensCloseBtn.onclick = function() {
          lensDismissed = true;
          if (visualLensBar) visualLensBar.style.display = 'none';
        };
      }

      function copyActiveLensPath() {
        if (!currentLensInfo) return;
        const useOptional = lensOptionalChainingToggle && lensOptionalChainingToggle.checked;
        const path = useOptional ? (currentLensInfo.optionalPath || currentLensInfo.standardPath) : currentLensInfo.standardPath;
        if (!path) return;
        navigator.clipboard.writeText(path).then(() => {
          if (lensCopyPathBtn) {
            lensCopyPathBtn.textContent = '✓ Copied';
            setTimeout(() => { lensCopyPathBtn.textContent = '📋 Copy Path'; }, 1200);
          }
        });
      }

      if (lensCopyPathBtn) {
        lensCopyPathBtn.onclick = copyActiveLensPath;
      }
      if (lensPathDisplay) {
        lensPathDisplay.onclick = copyActiveLensPath;
      }

      if (lensInsertPathBtn) {
        lensInsertPathBtn.onclick = function() {
          if (!currentLensInfo) return;
          const useOptional = lensOptionalChainingToggle && lensOptionalChainingToggle.checked;
          const path = useOptional ? (currentLensInfo.optionalPath || currentLensInfo.standardPath) : currentLensInfo.standardPath;
          if (!path) return;
          if (editor) {
            editor.replaceSelection(path);
            editor.focus();
          } else if (exprTextarea) {
            exprTextarea.setRangeText(path);
            exprTextarea.focus();
          }
          lensInsertPathBtn.textContent = '✓ Inserted';
          setTimeout(() => { lensInsertPathBtn.textContent = '✍️ Insert'; }, 1200);
        };
      }

      if (lensFilterBtn) {
        lensFilterBtn.onclick = function() {
          if (!currentLensInfo || !currentLensInfo.filterExpr) return;
          setEditorValue(currentLensInfo.filterExpr);
          runExpression();
        };
      }

      if (lensExtractBtn) {
        lensExtractBtn.onclick = function() {
          if (!currentLensInfo || !currentLensInfo.extractExpr) return;
          setEditorValue(currentLensInfo.extractExpr);
          runExpression();
        };
      }

      if (lensGroupByBtn) {
        lensGroupByBtn.onclick = function() {
          if (!currentLensInfo || !currentLensInfo.groupByExpr) return;
          setEditorValue(currentLensInfo.groupByExpr);
          runExpression();
        };
      }

      if (lensOptionalChainingToggle) {
        lensOptionalChainingToggle.onchange = function() {
          if (currentLensInfo) {
            displayLensInfo(currentLensInfo);
          }
        };
      }

      if (resultPre) {
        resultPre.addEventListener('click', function(e) {
          if (resultPre.classList.contains('empty') || resultPre.classList.contains('error')) return;
          const text = resultPre.textContent || '';
          if (!text.trim()) return;
          let offset = 0;
          try {
            const sel = window.getSelection();
            if (sel && sel.anchorNode && resultPre.contains(sel.anchorNode)) {
              offset = sel.anchorOffset;
            }
          } catch(err) {}
          updateVisualLensFromOffset(text, offset);
        });
      }

      if (resultTable) {
        resultTable.addEventListener('click', function(e) {
          const th = e.target.closest('th');
          if (th) {
            updateVisualLensFromTableHeader(th.textContent.trim());
            return;
          }
          const td = e.target.closest('td');
          if (td) {
            const tr = td.closest('tr');
            if (tr) {
              const rowIndex = tr.sectionRowIndex;
              const colIndex = td.cellIndex;
              updateVisualLensFromTableCell(rowIndex, colIndex);
            }
          }
        });
      }
    }

    // Initialize Visual Lens UI handlers
    setupVisualLensUI();

    // ==========================================
    // Multi-Language Type & Contract Generator
    // ==========================================

    const PYTHON_RESERVED_WORDS = new Set([
      'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
      'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
      'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
      'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
      'id', 'type', 'object', 'dict', 'list', 'str', 'int', 'float', 'bool', 'set'
    ]);

    function typeGenToPascalCase(str) {
      if (!str) return 'Model';
      const cleaned = str.replace(/[^a-zA-Z0-9_]/g, '_');
      const parts = cleaned.split(/[_\\-\\s]+/).filter(Boolean);
      if (parts.length === 0) return 'Model';
      let res = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
      if (/^[0-9]/.test(res)) res = 'Model' + res;
      return res || 'Model';
    }

    function typeGenToSnakeCase(str) {
      if (!str) return 'field';
      let s = str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();
      s = s.replace(/__+/g, '_').replace(/^_+|_+$/g, '');
      if (!s || /^[0-9]/.test(s)) s = '_' + (s || 'field');
      return s;
    }

    function typeGenSingularize(name) {
      if (name.endsWith('ies') && name.length > 3) return name.slice(0, -3) + 'y';
      if (name.endsWith('ses') && name.length > 3) return name.slice(0, -2);
      if ((name.endsWith('us') || name.endsWith('is')) && name.length > 2) return name;
      if (name.endsWith('s') && !name.endsWith('ss') && name.length > 3) return name.slice(0, -1);
      return name;
    }

    function typeGenIsValidJsId(name) {
      return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
    }

    function analyzeDataForTypes(data, rootName) {
      const registeredModels = new Map();
      let modelCounter = 0;

      function areTypesEqual(a, b) {
        if (a.kind !== b.kind) return false;
        if (a.kind === 'primitive' && b.kind === 'primitive') return a.primitive === b.primitive;
        if (a.kind === 'object' && b.kind === 'object') return a.modelName === b.modelName;
        if (a.kind === 'array' && b.kind === 'array') return areTypesEqual(a.itemType, b.itemType);
        if (a.kind === 'union' && b.kind === 'union') {
          if (a.types.length !== b.types.length) return false;
          return a.types.every(at => b.types.some(bt => areTypesEqual(at, bt)));
        }
        return false;
      }

      function areModelsEquivalent(modelA, fieldsB) {
        if (modelA.fields.length !== fieldsB.length) return false;
        const mapA = new Map(modelA.fields.map(f => [f.key, f]));
        for (const fb of fieldsB) {
          const fa = mapA.get(fb.key);
          if (!fa) return false;
          if (fa.optional !== fb.optional || fa.nullable !== fb.nullable) return false;
          if (!areTypesEqual(fa.type, fb.type)) return false;
        }
        return true;
      }

      function findEquivalentModel(fields) {
        for (const model of registeredModels.values()) {
          if (areModelsEquivalent(model, fields)) return model;
        }
        return undefined;
      }

      function inferNode(value, suggestedName) {
        if (value === null) return { kind: 'primitive', primitive: 'null' };
        if (value === undefined) return { kind: 'any' };

        if (Array.isArray(value)) {
          if (value.length === 0) return { kind: 'array', itemType: { kind: 'any' } };
          const sample = value.slice(0, 50);
          const isAllObjects = sample.every(item => item && typeof item === 'object' && !Array.isArray(item));

          if (isAllObjects) {
            const itemModelName = typeGenToPascalCase(typeGenSingularize(suggestedName)) + 'Item';
            const mergedObj = mergeObjectSample(sample, itemModelName);
            return { kind: 'array', itemType: mergedObj };
          }

          const elementTypes = [];
          for (const item of sample) {
            const t = inferNode(item, typeGenSingularize(suggestedName));
            if (!elementTypes.some(existing => areTypesEqual(existing, t))) {
              elementTypes.push(t);
            }
          }
          if (elementTypes.length === 1) return { kind: 'array', itemType: elementTypes[0] };
          return { kind: 'array', itemType: { kind: 'union', types: elementTypes } };
        }

        if (typeof value === 'object') {
          return extractObjectModel(value, suggestedName);
        }

        if (typeof value === 'boolean') return { kind: 'primitive', primitive: 'boolean' };
        if (typeof value === 'number') {
          return { kind: 'primitive', primitive: Number.isInteger(value) ? 'integer' : 'number' };
        }
        if (typeof value === 'string') return { kind: 'primitive', primitive: 'string' };

        return { kind: 'any' };
      }

      function extractObjectModel(obj, modelName) {
        const fields = [];
        const dependencies = [];

        const keys = Object.keys(obj);
        for (const key of keys) {
          const val = obj[key];
          const childName = typeGenToPascalCase(key);
          const childType = inferNode(val, childName);

          if (childType.kind === 'object') {
            dependencies.push(childType.modelName);
          } else if (childType.kind === 'array' && childType.itemType.kind === 'object') {
            dependencies.push(childType.itemType.modelName);
          }

          fields.push({
            key,
            originalKey: key,
            type: childType,
            optional: val === undefined,
            nullable: val === null
          });
        }

        const candidate = typeGenToPascalCase(modelName);
        const sameNameModel = registeredModels.get(candidate);
        if (sameNameModel && areModelsEquivalent(sameNameModel, fields)) {
          return { kind: 'object', modelName: candidate, fields: sameNameModel.fields };
        }

        const equivalentModel = findEquivalentModel(fields);
        if (equivalentModel) {
          return { kind: 'object', modelName: equivalentModel.name, fields: equivalentModel.fields };
        }

        let finalName = candidate;
        while (registeredModels.has(finalName)) {
          modelCounter++;
          finalName = candidate + modelCounter;
        }

        const model = { name: finalName, fields, dependencies };
        registeredModels.set(finalName, model);
        return { kind: 'object', modelName: finalName, fields };
      }

      function mergeObjectSample(sample, baseName) {
        const propertyCounts = {};
        const propertyValues = {};
        const totalCount = sample.length;

        for (const item of sample) {
          for (const [k, v] of Object.entries(item)) {
            propertyCounts[k] = (propertyCounts[k] || 0) + 1;
            if (!propertyValues[k]) propertyValues[k] = [];
            propertyValues[k].push(v);
          }
        }

        const fields = [];
        const dependencies = [];

        for (const key of Object.keys(propertyCounts)) {
          const vals = propertyValues[key];
          const isOptional = propertyCounts[key] < totalCount || vals.includes(undefined);
          const isNullable = vals.includes(null);
          const nonNullVals = vals.filter(v => v !== null && v !== undefined);

          let fieldType;
          const childName = typeGenToPascalCase(key);

          if (nonNullVals.length === 0) {
            fieldType = { kind: 'primitive', primitive: 'null' };
          } else {
            const isAllObjects = nonNullVals.every(v => v && typeof v === 'object' && !Array.isArray(v));
            const isAllArrays = nonNullVals.every(v => Array.isArray(v));

            if (isAllObjects) {
              fieldType = mergeObjectSample(nonNullVals, childName);
            } else if (isAllArrays) {
              const flatItems = [].concat.apply([], nonNullVals);
              fieldType = {
                kind: 'array',
                itemType: inferNode(flatItems, typeGenSingularize(childName))
              };
            } else {
              const objVals = nonNullVals.filter(v => v && typeof v === 'object' && !Array.isArray(v));
              const arrVals = nonNullVals.filter(v => Array.isArray(v));
              const primVals = nonNullVals.filter(v => typeof v !== 'object' || v === null);

              const types = [];
              if (objVals.length > 0) {
                types.push(mergeObjectSample(objVals, childName));
              }
              if (arrVals.length > 0) {
                const flatArr = [].concat.apply([], arrVals);
                types.push({
                  kind: 'array',
                  itemType: inferNode(flatArr, typeGenSingularize(childName))
                });
              }
              for (const v of primVals) {
                const t = inferNode(v, childName);
                if (!types.some(existing => areTypesEqual(existing, t))) {
                  types.push(t);
                }
              }

              if (types.length === 1) {
                fieldType = types[0];
              } else {
                const hasInt = types.some(t => t.kind === 'primitive' && t.primitive === 'integer');
                const hasNum = types.some(t => t.kind === 'primitive' && t.primitive === 'number');
                if (hasInt && hasNum && types.length === 2) {
                  fieldType = { kind: 'primitive', primitive: 'number' };
                } else {
                  fieldType = { kind: 'union', types };
                }
              }
            }
          }

          if (fieldType.kind === 'object') {
            dependencies.push(fieldType.modelName);
          } else if (fieldType.kind === 'array' && fieldType.itemType.kind === 'object') {
            dependencies.push(fieldType.itemType.modelName);
          }

          fields.push({
            key,
            originalKey: key,
            type: fieldType,
            optional: isOptional,
            nullable: isNullable
          });
        }

        const candidate = typeGenToPascalCase(baseName);
        const sameNameModel = registeredModels.get(candidate);
        if (sameNameModel && areModelsEquivalent(sameNameModel, fields)) {
          return { kind: 'object', modelName: candidate, fields: sameNameModel.fields };
        }

        const equivalentModel = findEquivalentModel(fields);
        if (equivalentModel) {
          return { kind: 'object', modelName: equivalentModel.name, fields: equivalentModel.fields };
        }

        let finalName = candidate;
        while (registeredModels.has(finalName)) {
          modelCounter++;
          finalName = candidate + modelCounter;
        }

        const model = { name: finalName, fields, dependencies };
        registeredModels.set(finalName, model);
        return { kind: 'object', modelName: finalName, fields };
      }

      function topologicalSort(models) {
        const result = [];
        const visited = new Set();
        const visiting = new Set();
        const modelMap = new Map(models.map(m => [m.name, m]));

        function visit(m) {
          if (visited.has(m.name)) return;
          if (visiting.has(m.name)) return;
          visiting.add(m.name);
          for (const dep of m.dependencies) {
            const depModel = modelMap.get(dep);
            if (depModel) visit(depModel);
          }
          visiting.delete(m.name);
          visited.add(m.name);
          result.push(m);
        }

        for (const m of models) visit(m);
        return result;
      }

      const rootType = inferNode(data, rootName);
      const models = topologicalSort(Array.from(registeredModels.values()));
      return { rootType, models };
    }

    function generateClientTypescript(data, options) {
      const NL = String.fromCharCode(10);
      const rootName = typeGenToPascalCase(options.rootName || 'Root');
      const exportKeyword = options.exportKeyword !== false ? 'export ' : '';
      const useInterface = options.useInterface !== false;
      const { rootType, models } = analyzeDataForTypes(data, rootName);

      function formatType(t) {
        if (t.kind === 'primitive') {
          if (t.primitive === 'integer' || t.primitive === 'number') return 'number';
          if (t.primitive === 'boolean') return 'boolean';
          if (t.primitive === 'string') return 'string';
          if (t.primitive === 'null') return 'null';
          return 'any';
        }
        if (t.kind === 'object') return t.modelName;
        if (t.kind === 'array') {
          const inner = formatType(t.itemType);
          return inner.includes('|') ? '(' + inner + ')[]' : inner + '[]';
        }
        if (t.kind === 'union') return t.types.map(formatType).join(' | ') || 'any';
        return 'any';
      }

      const lines = [];

      for (const m of models) {
        if (m.name === rootName && rootType.kind === 'object') continue;
        if (useInterface) {
          lines.push(exportKeyword + 'interface ' + m.name + ' {');
          for (const f of m.fields) {
            const safeKey = typeGenIsValidJsId(f.key) ? f.key : JSON.stringify(f.key);
            const optMark = f.optional ? '?' : '';
            let typeStr = formatType(f.type);
            if (f.nullable && !typeStr.includes('null')) typeStr += ' | null';
            lines.push('  ' + safeKey + optMark + ': ' + typeStr + ';');
          }
          lines.push('}' + NL);
        } else {
          lines.push(exportKeyword + 'type ' + m.name + ' = {');
          for (const f of m.fields) {
            const safeKey = typeGenIsValidJsId(f.key) ? f.key : JSON.stringify(f.key);
            const optMark = f.optional ? '?' : '';
            let typeStr = formatType(f.type);
            if (f.nullable && !typeStr.includes('null')) typeStr += ' | null';
            lines.push('  ' + safeKey + optMark + ': ' + typeStr + ';');
          }
          lines.push('};' + NL);
        }
      }

      if (rootType.kind === 'object') {
        const rootModel = models.find(m => m.name === rootName);
        const fields = rootModel ? rootModel.fields : (rootType.fields || []);
        if (useInterface) {
          lines.push(exportKeyword + 'interface ' + rootName + ' {');
          for (const f of fields) {
            const safeKey = typeGenIsValidJsId(f.key) ? f.key : JSON.stringify(f.key);
            const optMark = f.optional ? '?' : '';
            let typeStr = formatType(f.type);
            if (f.nullable && !typeStr.includes('null')) typeStr += ' | null';
            lines.push('  ' + safeKey + optMark + ': ' + typeStr + ';');
          }
          lines.push('}');
        } else {
          lines.push(exportKeyword + 'type ' + rootName + ' = {');
          for (const f of fields) {
            const safeKey = typeGenIsValidJsId(f.key) ? f.key : JSON.stringify(f.key);
            const optMark = f.optional ? '?' : '';
            let typeStr = formatType(f.type);
            if (f.nullable && !typeStr.includes('null')) typeStr += ' | null';
            lines.push('  ' + safeKey + optMark + ': ' + typeStr + ';');
          }
          lines.push('};');
        }
      } else {
        lines.push(exportKeyword + 'type ' + rootName + ' = ' + formatType(rootType) + ';');
      }

      return lines.join(NL).trim() + NL;
    }

    function generateClientZod(data, options) {
      const NL = String.fromCharCode(10);
      const rootName = typeGenToPascalCase(options.rootName || 'Root');
      const exportKeyword = options.exportKeyword !== false ? 'export ' : '';
      const { rootType, models } = analyzeDataForTypes(data, rootName);

      const lines = ['import { z } from "zod";' + NL];

      function formatZod(t) {
        if (t.kind === 'primitive') {
          if (t.primitive === 'integer') return 'z.number().int()';
          if (t.primitive === 'number') return 'z.number()';
          if (t.primitive === 'boolean') return 'z.boolean()';
          if (t.primitive === 'string') return 'z.string()';
          if (t.primitive === 'null') return 'z.null()';
          return 'z.any()';
        }
        if (t.kind === 'object') return t.modelName + 'Schema';
        if (t.kind === 'array') return 'z.array(' + formatZod(t.itemType) + ')';
        if (t.kind === 'union') return 'z.union([' + t.types.map(formatZod).join(', ') + '])';
        return 'z.any()';
      }

      for (const m of models) {
        if (m.name === rootName && rootType.kind === 'object') continue;
        lines.push(exportKeyword + 'const ' + m.name + 'Schema = z.object({');
        for (const f of m.fields) {
          const safeKey = typeGenIsValidJsId(f.key) ? f.key : JSON.stringify(f.key);
          let zodRule = formatZod(f.type);
          if (f.nullable) zodRule += '.nullable()';
          if (f.optional) zodRule += '.optional()';
          lines.push('  ' + safeKey + ': ' + zodRule + ',');
        }
        lines.push('});');
        lines.push(exportKeyword + 'type ' + m.name + ' = z.infer<typeof ' + m.name + 'Schema>;' + NL);
      }

      if (rootType.kind === 'object') {
        const rootModel = models.find(m => m.name === rootName);
        const fields = rootModel ? rootModel.fields : (rootType.fields || []);
        lines.push(exportKeyword + 'const ' + rootName + 'Schema = z.object({');
        for (const f of fields) {
          const safeKey = typeGenIsValidJsId(f.key) ? f.key : JSON.stringify(f.key);
          let zodRule = formatZod(f.type);
          if (f.nullable) zodRule += '.nullable()';
          if (f.optional) zodRule += '.optional()';
          lines.push('  ' + safeKey + ': ' + zodRule + ',');
        }
        lines.push('});');
      } else {
        lines.push(exportKeyword + 'const ' + rootName + 'Schema = ' + formatZod(rootType) + ';');
      }
      lines.push(exportKeyword + 'type ' + rootName + ' = z.infer<typeof ' + rootName + 'Schema>;');

      return lines.join(NL).trim() + NL;
    }

    function generateClientJsonSchema(data, options) {
      const rootName = typeGenToPascalCase(options.rootName || 'Root');
      const { rootType } = analyzeDataForTypes(data, rootName);

      function toJsonSchemaNode(t) {
        if (t.kind === 'primitive') {
          if (t.primitive === 'integer') return { type: 'integer' };
          if (t.primitive === 'number') return { type: 'number' };
          if (t.primitive === 'boolean') return { type: 'boolean' };
          if (t.primitive === 'string') return { type: 'string' };
          if (t.primitive === 'null') return { type: 'null' };
          return {};
        }
        if (t.kind === 'object') {
          const properties = {};
          const required = [];
          for (const f of t.fields) {
            const propSchema = toJsonSchemaNode(f.type);
            if (f.nullable) {
              if (propSchema.type) {
                propSchema.type = Array.isArray(propSchema.type)
                  ? propSchema.type.concat(['null'])
                  : [propSchema.type, 'null'];
              }
            }
            properties[f.originalKey] = propSchema;
            if (!f.optional) required.push(f.originalKey);
          }
          const res = { type: 'object', properties: properties };
          if (required.length > 0) res.required = required;
          return res;
        }
        if (t.kind === 'array') {
          return { type: 'array', items: toJsonSchemaNode(t.itemType) };
        }
        if (t.kind === 'union') {
          return { anyOf: t.types.map(toJsonSchemaNode) };
        }
        return {};
      }

      const rootNode = toJsonSchemaNode(rootType);
      const schema = Object.assign({
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: rootName
      }, rootNode);

      return JSON.stringify(schema, null, 2) + String.fromCharCode(10);
    }

    function generateClientPydantic(data, options) {
      const NL = String.fromCharCode(10);
      const rootName = typeGenToPascalCase(options.rootName || 'Root');
      const useSnakeCase = options.useSnakeCase !== false;
      const { rootType, models } = analyzeDataForTypes(data, rootName);

      const lines = [
        'from __future__ import annotations',
        'from typing import Any, Dict, List, Optional, Union',
        'from pydantic import BaseModel, Field' + NL
      ];

      function formatPythonType(t) {
        if (t.kind === 'primitive') {
          if (t.primitive === 'integer') return 'int';
          if (t.primitive === 'number') return 'float';
          if (t.primitive === 'boolean') return 'bool';
          if (t.primitive === 'string') return 'str';
          if (t.primitive === 'null') return 'None';
          return 'Any';
        }
        if (t.kind === 'object') return t.modelName;
        if (t.kind === 'array') return 'List[' + formatPythonType(t.itemType) + ']';
        if (t.kind === 'union') return 'Union[' + t.types.map(formatPythonType).join(', ') + ']';
        return 'Any';
      }

      function renderPydanticModel(name, fields) {
        const classLines = ['class ' + name + '(BaseModel):'];
        if (fields.length === 0) {
          classLines.push('    pass');
          return classLines.join(NL);
        }

        for (const f of fields) {
          let pyName = useSnakeCase ? typeGenToSnakeCase(f.key) : f.key;
          let needsAlias = false;

          if (PYTHON_RESERVED_WORDS.has(pyName)) {
            pyName = pyName + '_';
            needsAlias = true;
          }
          if (pyName !== f.originalKey) {
            needsAlias = true;
          }

          const rawType = formatPythonType(f.type);
          const isNullableOrOptional = f.optional || f.nullable;
          const typeStr = isNullableOrOptional ? 'Optional[' + rawType + ']' : rawType;

          let fieldDecl = '    ' + pyName + ': ' + typeStr;
          if (needsAlias && isNullableOrOptional) {
            fieldDecl += ' = Field(default=None, alias="' + f.originalKey + '")';
          } else if (needsAlias) {
            fieldDecl += ' = Field(alias="' + f.originalKey + '")';
          } else if (isNullableOrOptional) {
            fieldDecl += ' = None';
          }

          classLines.push(fieldDecl);
        }

        return classLines.join(NL);
      }

      for (const m of models) {
        if (m.name === rootName && rootType.kind === 'object') continue;
        lines.push(renderPydanticModel(m.name, m.fields));
        lines.push('');
      }

      if (rootType.kind === 'object') {
        const rootModel = models.find(m => m.name === rootName);
        const fields = rootModel ? rootModel.fields : (rootType.fields || []);
        lines.push(renderPydanticModel(rootName, fields));
      } else {
        lines.push(rootName + ' = ' + formatPythonType(rootType));
      }

      return lines.join(NL).trim() + NL;
    }

    function generateClientDataclass(data, options) {
      const NL = String.fromCharCode(10);
      const rootName = typeGenToPascalCase(options.rootName || 'Root');
      const useSnakeCase = options.useSnakeCase !== false;
      const { rootType, models } = analyzeDataForTypes(data, rootName);

      const lines = [
        'from __future__ import annotations',
        'from dataclasses import dataclass, field',
        'from typing import Any, Dict, List, Optional, Union' + NL
      ];

      function formatPythonType(t) {
        if (t.kind === 'primitive') {
          if (t.primitive === 'integer') return 'int';
          if (t.primitive === 'number') return 'float';
          if (t.primitive === 'boolean') return 'bool';
          if (t.primitive === 'string') return 'str';
          if (t.primitive === 'null') return 'None';
          return 'Any';
        }
        if (t.kind === 'object') return t.modelName;
        if (t.kind === 'array') return 'List[' + formatPythonType(t.itemType) + ']';
        if (t.kind === 'union') return 'Union[' + t.types.map(formatPythonType).join(', ') + ']';
        return 'Any';
      }

      function renderDataclassModel(name, fields) {
        const classLines = ['@dataclass', 'class ' + name + ':'];
        if (fields.length === 0) {
          classLines.push('    pass');
          return classLines.join(NL);
        }

        const requiredFields = fields.filter(f => !f.optional && !f.nullable);
        const defaultFields = fields.filter(f => f.optional || f.nullable);
        const sortedFields = requiredFields.concat(defaultFields);

        for (const f of sortedFields) {
          let pyName = useSnakeCase ? typeGenToSnakeCase(f.key) : f.key;
          if (PYTHON_RESERVED_WORDS.has(pyName)) {
            pyName = pyName + '_';
          }

          const rawType = formatPythonType(f.type);
          const isNullableOrOptional = f.optional || f.nullable;
          const typeStr = isNullableOrOptional ? 'Optional[' + rawType + ']' : rawType;

          let fieldDecl = '    ' + pyName + ': ' + typeStr;
          if (isNullableOrOptional) {
            fieldDecl += ' = None';
          }

          classLines.push(fieldDecl);
        }

        return classLines.join(NL);
      }

      for (const m of models) {
        if (m.name === rootName && rootType.kind === 'object') continue;
        lines.push(renderDataclassModel(m.name, m.fields));
        lines.push('');
      }

      if (rootType.kind === 'object') {
        const rootModel = models.find(m => m.name === rootName);
        const fields = rootModel ? rootModel.fields : (rootType.fields || []);
        lines.push(renderDataclassModel(rootName, fields));
      } else {
        lines.push(rootName + ' = ' + formatPythonType(rootType));
      }

      return lines.join(NL).trim() + NL;
    }

    function generateClientContract(data, target, options) {
      const norm = (target || 'typescript').toLowerCase();
      const opts = options || {};
      if (norm === 'zod') return generateClientZod(data, opts);
      if (norm === 'json-schema') return generateClientJsonSchema(data, opts);
      if (norm === 'pydantic') return generateClientPydantic(data, opts);
      if (norm === 'dataclass') return generateClientDataclass(data, opts);
      return generateClientTypescript(data, opts);
    }

    function getEffectiveData() {
      if (currentResultData !== null && currentResultData !== undefined) {
        return currentResultData;
      }
      if (streamingData && streamingData.length > 0) {
        return streamingData;
      }
      if (currentResultText && currentResultText.trim()) {
        try {
          return JSON.parse(currentResultText);
        } catch(e) {}
      }
      if (typeof resultJsonEditor !== 'undefined' && resultJsonEditor && typeof resultJsonEditor.getValue === 'function') {
        const val = resultJsonEditor.getValue();
        if (val && val.trim()) {
          try {
            return JSON.parse(val);
          } catch(e) {}
        }
      }
      return null;
    }

    function setupTypeGeneratorUI() {
      let activeTarget = 'typescript';

      function renderPreview() {
        if (!typeGenCodePreview) return;
        const data = getEffectiveData();
        if (data === null || data === undefined) {
          typeGenCodePreview.value = '// No query result data available.\\n// Run a query or bind a JSON file to generate types.';
          if (typeGenStats) typeGenStats.textContent = 'No data available';
          return;
        }

        const rootName = (typeGenRootName && typeGenRootName.value.trim()) || 'Root';
        const exportKeyword = typeGenTsExport ? typeGenTsExport.checked : true;
        const useInterface = typeGenTsInterface ? typeGenTsInterface.checked : true;
        const useSnakeCase = typeGenPySnake ? typeGenPySnake.checked : true;

        const code = generateClientContract(data, activeTarget, {
          rootName,
          exportKeyword,
          useInterface,
          useSnakeCase
        });

        typeGenCodePreview.value = code;

        const lineCount = code.split(String.fromCharCode(10)).length;
        const targetNames = {
          'typescript': 'TypeScript',
          'zod': 'Zod Schema',
          'json-schema': 'JSON Schema (Draft-07)',
          'pydantic': 'Python Pydantic v2',
          'dataclass': 'Python Dataclass'
        };
        if (typeGenStats) {
          typeGenStats.textContent = (targetNames[activeTarget] || activeTarget) + ' • ' + lineCount + ' lines • ' + formatBytes(code.length);
        }

        // Toggle options visibility
        if (typeGenTsOptions) {
          typeGenTsOptions.style.display = (activeTarget === 'typescript') ? 'flex' : 'none';
        }
        if (typeGenPyOptions) {
          typeGenPyOptions.style.display = (activeTarget === 'pydantic' || activeTarget === 'dataclass') ? 'flex' : 'none';
        }
      }

      function openTypeGenModal() {
        if (typeGenModal) {
          typeGenModal.style.display = 'flex';
          renderPreview();
        }
      }

      function closeTypeGenModal() {
        if (typeGenModal) {
          typeGenModal.style.display = 'none';
        }
      }

      if (generateTypesBtn) {
        generateTypesBtn.onclick = function() {
          const data = getEffectiveData();
          if (data === null || data === undefined) {
            vscode.postMessage({
              type: 'openInEditor',
              text: '// No query result data available to generate types.\\n// Run a query first.',
              language: 'typescript'
            });
            return;
          }
          openTypeGenModal();
        };
      }

      if (closeTypeGenModalBtn) closeTypeGenModalBtn.onclick = closeTypeGenModal;
      if (dismissTypeGenBtn) dismissTypeGenBtn.onclick = closeTypeGenModal;

      if (typeGenModal) {
        typeGenModal.addEventListener('click', function(e) {
          if (e.target === typeGenModal) closeTypeGenModal();
        });
      }

      if (typeGenTabs) {
        typeGenTabs.addEventListener('click', function(e) {
          const btn = e.target.closest('button');
          if (!btn) return;
          const target = btn.getAttribute('data-target');
          if (!target) return;
          activeTarget = target;
          const allBtns = typeGenTabs.querySelectorAll('button');
          allBtns.forEach(b => b.classList.toggle('active', b === btn));
          renderPreview();
        });
      }

      if (typeGenRootName) {
        typeGenRootName.addEventListener('input', renderPreview);
      }
      if (typeGenTsExport) {
        typeGenTsExport.addEventListener('change', renderPreview);
      }
      if (typeGenTsInterface) {
        typeGenTsInterface.addEventListener('change', renderPreview);
      }
      if (typeGenPySnake) {
        typeGenPySnake.addEventListener('change', renderPreview);
      }

      if (copyTypeGenBtn) {
        copyTypeGenBtn.onclick = function() {
          if (!typeGenCodePreview || !typeGenCodePreview.value) return;
          navigator.clipboard.writeText(typeGenCodePreview.value).then(function() {
            copyTypeGenBtn.textContent = '✓ Copied';
            setTimeout(function() { copyTypeGenBtn.textContent = '📋 Copy Code'; }, 1200);
          });
        };
      }

      if (openTypeGenInEditorBtn) {
        openTypeGenInEditorBtn.onclick = function() {
          if (!typeGenCodePreview || !typeGenCodePreview.value) return;
          let lang = 'typescript';
          if (activeTarget === 'json-schema') lang = 'json';
          else if (activeTarget === 'pydantic' || activeTarget === 'dataclass') lang = 'python';

          vscode.postMessage({
            type: 'openInEditor',
            text: typeGenCodePreview.value,
            language: lang
          });
        };
      }

      if (saveTypeGenFileBtn) {
        saveTypeGenFileBtn.onclick = function() {
          if (!typeGenCodePreview || !typeGenCodePreview.value) return;
          vscode.postMessage({
            type: 'saveData',
            fileType: activeTarget,
            text: typeGenCodePreview.value
          });
        };
      }

      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && typeGenModal && typeGenModal.style.display !== 'none') {
          closeTypeGenModal();
        }
      });

      return {
        open: openTypeGenModal,
        close: closeTypeGenModal,
        render: renderPreview
      };
    }

    const typeGenController = setupTypeGeneratorUI();

    // ==========================================
    // PII Anonymizer & Sanitizer Controller
    // ==========================================
    function setupAnonymizerUI() {
      const anonymizeBtn = document.getElementById('anonymizeBtn');
      const anonymizerModal = document.getElementById('anonymizerModal');
      const closeAnonymizerModalBtn = document.getElementById('closeAnonymizerModal');
      const dismissAnonymizerBtn = document.getElementById('dismissAnonymizerBtn');
      const anonymizePreview = document.getElementById('anonymizePreview');
      const anonymizeBadge = document.getElementById('anonymizeBadge');
      const anonymizeStats = document.getElementById('anonymizeStats');
      const applyAnonymizedBtn = document.getElementById('applyAnonymizedBtn');
      const copyAnonymizedBtn = document.getElementById('copyAnonymizedBtn');
      const openAnonymizedInEditorBtn = document.getElementById('openAnonymizedInEditorBtn');
      const sendToAiAnonymizedBtn = document.getElementById('sendToAiAnonymizedBtn');
      const anonStrategyTabs = document.getElementById('anonStrategyTabs');

      const anonRuleCredentials = document.getElementById('anonRuleCredentials');
      const anonRuleEmails = document.getElementById('anonRuleEmails');
      const anonRulePhones = document.getElementById('anonRulePhones');
      const anonRuleCreditCards = document.getElementById('anonRuleCreditCards');
      const anonRuleNationalIds = document.getElementById('anonRuleNationalIds');
      const anonRuleIpAddresses = document.getElementById('anonRuleIpAddresses');
      const anonRuleKeyNames = document.getElementById('anonRuleKeyNames');

      let activeStrategy = 'mask';
      let currentAnonymizeResult = null;

      // 32-bit FNV-1a hash algorithm for deterministic pseudonymization
      function fnv1a(str) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
          hash ^= str.charCodeAt(i);
          hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
      }

      function isLuhnValid(numStr) {
        const clean = numStr.replace(/\\D/g, '');
        if (clean.length < 13 || clean.length > 19) return false;
        let sum = 0;
        let shouldDouble = false;
        for (let i = clean.length - 1; i >= 0; i--) {
          let digit = parseInt(clean.charAt(i), 10);
          if (shouldDouble) {
            digit *= 2;
            if (digit > 9) digit -= 9;
          }
          sum += digit;
          shouldDouble = !shouldDouble;
        }
        return sum % 10 === 0;
      }

      const CREDENTIAL_KEY_REGEX = /^(?:pass(?:word)?|passwd|secret|api_?key|auth(?:_?token)?|access_?token|refresh_?token|client_?secret|private_?key)$/i;
      const SENSITIVE_KEY_REGEX = /^(?:pass(?:word)?|passwd|secret|api_?key|auth(?:_?token)?|access_?token|refresh_?token|client_?secret|private_?key|ssn|social_?security|credit_?card|cvv|cvc)$/i;
      const EMAIL_REGEX = /\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b/g;
      const SSN_REGEX = /\\b\\d{3}-\\d{2}-\\d{4}\\b/g;
      const IPV4_REGEX = /\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b/g;
      const IPV6_REGEX = /\\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\\b/g;
      const PHONE_REGEX = /(?:\\b|\\+)(?:\\d{1,3}[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}\\b/g;
      const JWT_REGEX = /\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b/g;
      const BEARER_REGEX = /\\bBearer\\s+[A-Za-z0-9_.\\-~+/]+=*\\b/gi;
      const PRIVATE_KEY_REGEX = /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY[^-]*-----[\\s\\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi;
      const CARD_CANDIDATE_REGEX = /\\b(?:\\d[ -]*?){13,19}\\b/g;

      function sanitizeEmail(email, strat) {
        if (strat === 'redact') return '[REDACTED_EMAIL]';
        if (strat === 'hash') return 'email_' + fnv1a(email).substring(0, 8);
        if (strat === 'synthetic') {
          return 'user_' + fnv1a(email).substring(0, 6) + '@example.com';
        }
        const atIdx = email.indexOf('@');
        if (atIdx <= 1) return '*@' + email.slice(atIdx + 1);
        const user = email.slice(0, atIdx);
        const domain = email.slice(atIdx + 1);
        const masked = user.length <= 2 
          ? (user[0] + '*') 
          : (user[0] + '*'.repeat(Math.min(user.length - 2, 4)) + user[user.length - 1]);
        return masked + '@' + domain;
      }

      function sanitizePhone(phone, strat) {
        if (strat === 'redact') return '[REDACTED_PHONE]';
        if (strat === 'hash') return 'phone_' + fnv1a(phone).substring(0, 8);
        if (strat === 'synthetic') {
          const num = parseInt(fnv1a(phone).substring(0, 4), 16) % 10000;
          return '+1-555-01' + ('000' + num).slice(-2);
        }
        const digits = phone.replace(/\\D/g, '');
        const last4 = digits.slice(-4);
        return '***-***-' + (last4 || '0000');
      }

      function sanitizeCreditCard(card, strat) {
        if (strat === 'redact') return '[REDACTED_CARD]';
        if (strat === 'hash') return 'card_' + fnv1a(card).substring(0, 8);
        if (strat === 'synthetic') return '4111-1111-1111-1111';
        const digits = card.replace(/\\D/g, '');
        const last4 = digits.slice(-4);
        return '****-****-****-' + (last4 || '0000');
      }

      function sanitizeSsn(ssn, strat) {
        if (strat === 'redact') return '[REDACTED_SSN]';
        if (strat === 'hash') return 'ssn_' + fnv1a(ssn).substring(0, 8);
        if (strat === 'synthetic') return '999-00-0000';
        const last4 = ssn.slice(-4);
        return '***-**-' + last4;
      }

      function sanitizeIp(ip, strat) {
        if (strat === 'redact') return '[REDACTED_IP]';
        if (strat === 'hash') return 'ip_' + fnv1a(ip).substring(0, 8);
        if (strat === 'synthetic') {
          const byteVal = (parseInt(fnv1a(ip).substring(0, 2), 16) % 250) + 1;
          return '10.0.0.' + byteVal;
        }
        if (ip.includes('.')) {
          const parts = ip.split('.');
          return parts[0] + '.' + parts[1] + '.*.*';
        }
        return '2001:db8::*';
      }

      function sanitizeSecret(secret, strat, label) {
        const lbl = label || 'SECRET';
        if (strat === 'redact') return '[REDACTED_' + lbl + ']';
        if (strat === 'hash') return lbl.toLowerCase() + '_' + fnv1a(secret).substring(0, 8);
        if (strat === 'synthetic') return 'synth_' + lbl.toLowerCase() + '_' + fnv1a(secret).substring(0, 6);
        if (secret.length <= 8) return '********';
        return secret.slice(0, 3) + '...[REDACTED]';
      }

      function anonymizeCore(input, strat, rules) {
        const report = {
          totalFieldsScanned: 0,
          totalSanitized: 0,
          countsByCategory: {},
          categoriesDetected: []
        };

        function recordDetection(category) {
          report.totalSanitized++;
          report.countsByCategory[category] = (report.countsByCategory[category] || 0) + 1;
          if (!report.categoriesDetected.includes(category)) {
            report.categoriesDetected.push(category);
          }
        }

        function sanitizeString(val, keyName) {
          report.totalFieldsScanned++;
          let result = val;

          if (rules.keyNames && keyName && CREDENTIAL_KEY_REGEX.test(keyName)) {
            if (typeof val === 'string' && val.length > 0) {
              recordDetection('Credentials & Key Names');
              return sanitizeSecret(val, strat, 'SECRET');
            }
          }

          if (rules.credentials && PRIVATE_KEY_REGEX.test(result)) {
            result = result.replace(PRIVATE_KEY_REGEX, function() {
              recordDetection('Private Keys');
              return sanitizeSecret('key', strat, 'PRIVATE_KEY');
            });
          }

          if (rules.credentials && JWT_REGEX.test(result)) {
            result = result.replace(JWT_REGEX, function(jwt) {
              recordDetection('JWT Tokens');
              if (strat === 'mask') {
                return jwt.slice(0, 8) + '...[REDACTED_JWT]';
              }
              return sanitizeSecret(jwt, strat, 'JWT');
            });
          }

          if (rules.credentials && BEARER_REGEX.test(result)) {
            result = result.replace(BEARER_REGEX, function(bearer) {
              recordDetection('Bearer Tokens');
              if (strat === 'mask') {
                return 'Bearer ' + bearer.slice(7, 11) + '...[REDACTED]';
              }
              return sanitizeSecret(bearer, strat, 'TOKEN');
            });
          }

          if (rules.creditCards) {
            result = result.replace(CARD_CANDIDATE_REGEX, function(match) {
              if (isLuhnValid(match)) {
                recordDetection('Credit Cards');
                return sanitizeCreditCard(match, strat);
              }
              return match;
            });
          }

          if (rules.nationalIds && SSN_REGEX.test(result)) {
            result = result.replace(SSN_REGEX, function(ssn) {
              recordDetection('National IDs (SSN)');
              return sanitizeSsn(ssn, strat);
            });
          }

          if (rules.emails && EMAIL_REGEX.test(result)) {
            result = result.replace(EMAIL_REGEX, function(email) {
              recordDetection('Email Addresses');
              return sanitizeEmail(email, strat);
            });
          }

          if (rules.phones && PHONE_REGEX.test(result)) {
            result = result.replace(PHONE_REGEX, function(phone) {
              if (/^\\d{4}-\\d{2}-\\d{2}$/.test(phone.trim())) return phone;
              recordDetection('Phone Numbers');
              return sanitizePhone(phone, strat);
            });
          }

          if (rules.ipAddresses) {
            if (IPV4_REGEX.test(result)) {
              result = result.replace(IPV4_REGEX, function(ip) {
                recordDetection('IP Addresses');
                return sanitizeIp(ip, strat);
              });
            }
            if (IPV6_REGEX.test(result)) {
              result = result.replace(IPV6_REGEX, function(ip) {
                recordDetection('IP Addresses');
                return sanitizeIp(ip, strat);
              });
            }
          }

          if (rules.keyNames && keyName && SENSITIVE_KEY_REGEX.test(keyName) && result === val) {
            if (typeof val === 'string' && val.length > 0) {
              recordDetection('Credentials & Key Names');
              return sanitizeSecret(val, strat, 'SECRET');
            }
          }

          return result;
        }

        function walk(node, parentKey) {
          if (node === null || node === undefined) return node;
          if (typeof node === 'string') return sanitizeString(node, parentKey);
          if (typeof node === 'number' || typeof node === 'boolean') {
            report.totalFieldsScanned++;
            if (rules.keyNames && parentKey && SENSITIVE_KEY_REGEX.test(parentKey)) {
              recordDetection('Credentials & Key Names');
              return strat === 'redact' ? 0 : (strat === 'synthetic' ? 9999 : 0);
            }
            return node;
          }
          if (Array.isArray(node)) {
            return node.map(function(item) { return walk(item, parentKey); });
          }
          if (typeof node === 'object') {
            const copy = {};
            for (const k of Object.keys(node)) {
              copy[k] = walk(node[k], k);
            }
            return copy;
          }
          return node;
        }

        return {
          data: walk(input),
          report: report
        };
      }

      function getRulesFromUI() {
        return {
          credentials: anonRuleCredentials ? anonRuleCredentials.checked : true,
          emails: anonRuleEmails ? anonRuleEmails.checked : true,
          phones: anonRulePhones ? anonRulePhones.checked : true,
          creditCards: anonRuleCreditCards ? anonRuleCreditCards.checked : true,
          nationalIds: anonRuleNationalIds ? anonRuleNationalIds.checked : true,
          ipAddresses: anonRuleIpAddresses ? anonRuleIpAddresses.checked : true,
          keyNames: anonRuleKeyNames ? anonRuleKeyNames.checked : true
        };
      }

      function renderAnonymizePreview() {
        if (!anonymizePreview) return;
        const sourceData = getEffectiveData();
        if (sourceData === null || sourceData === undefined) {
          anonymizePreview.value = JSON.stringify({ notice: 'No active data available to anonymize. Run a query first or load a source.' }, null, 2);
          if (anonymizeBadge) anonymizeBadge.textContent = '🛡️ 0 items sanitized';
          if (anonymizeStats) anonymizeStats.textContent = 'Strategy: ' + activeStrategy;
          return;
        }

        const rules = getRulesFromUI();
        currentAnonymizeResult = anonymizeCore(sourceData, activeStrategy, rules);

        let previewText = '';
        try {
          previewText = JSON.stringify(currentAnonymizeResult.data, null, 2);
        } catch (e) {
          previewText = String(currentAnonymizeResult.data);
        }
        anonymizePreview.value = previewText;

        const count = currentAnonymizeResult.report.totalSanitized;
        if (anonymizeBadge) {
          anonymizeBadge.textContent = '🛡️ ' + count + ' item' + (count === 1 ? '' : 's') + ' sanitized';
        }
        if (anonymizeStats) {
          const stratNames = {
            mask: 'Format Masking',
            redact: 'Semantic Redaction',
            synthetic: 'Consistent Synthetic',
            hash: 'Hashed Values'
          };
          const cats = currentAnonymizeResult.report.categoriesDetected.join(', ');
          anonymizeStats.textContent = (stratNames[activeStrategy] || activeStrategy) + ' • ' + count + ' sanitized' + (cats ? (' (' + cats + ')') : '');
        }
      }

      function openAnonymizerModal() {
        if (anonymizerModal) {
          anonymizerModal.style.display = 'flex';
          renderAnonymizePreview();
        }
      }

      function closeAnonymizerModal() {
        if (anonymizerModal) {
          anonymizerModal.style.display = 'none';
        }
      }

      if (anonymizeBtn) {
        anonymizeBtn.onclick = function() {
          openAnonymizerModal();
        };
      }

      if (closeAnonymizerModalBtn) closeAnonymizerModalBtn.onclick = closeAnonymizerModal;
      if (dismissAnonymizerBtn) dismissAnonymizerBtn.onclick = closeAnonymizerModal;

      if (anonymizerModal) {
        anonymizerModal.addEventListener('click', function(e) {
          if (e.target === anonymizerModal) closeAnonymizerModal();
        });
      }

      if (anonStrategyTabs) {
        anonStrategyTabs.addEventListener('click', function(e) {
          const btn = e.target.closest('button');
          if (!btn) return;
          const strat = btn.getAttribute('data-strategy');
          if (!strat) return;
          activeStrategy = strat;
          const allBtns = anonStrategyTabs.querySelectorAll('button');
          allBtns.forEach(function(b) {
            if (b.classList) b.classList.toggle('active', b === btn);
          });
          renderAnonymizePreview();
        });
      }

      const ruleCheckboxes = [
        anonRuleCredentials,
        anonRuleEmails,
        anonRulePhones,
        anonRuleCreditCards,
        anonRuleNationalIds,
        anonRuleIpAddresses,
        anonRuleKeyNames
      ];
      for (let rIdx = 0; rIdx < ruleCheckboxes.length; rIdx++) {
        const cb = ruleCheckboxes[rIdx];
        if (cb) {
          cb.addEventListener('change', renderAnonymizePreview);
        }
      }

      if (applyAnonymizedBtn) {
        applyAnonymizedBtn.onclick = function() {
          if (!currentAnonymizeResult || currentAnonymizeResult.data === undefined) return;
          currentResultData = currentAnonymizeResult.data;
          let formattedJson = '';
          try {
            formattedJson = JSON.stringify(currentResultData, null, 2);
          } catch (e) {
            formattedJson = String(currentResultData);
          }
          currentResultText = formattedJson;
          if (resultJsonEditor) {
            resultJsonEditor.setValue(formattedJson);
            if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'block';
            if (resultPre) resultPre.style.display = 'none';
          } else if (resultPre) {
            resultPre.textContent = formattedJson;
            resultPre.classList.remove('empty', 'error');
          }
          closeAnonymizerModal();
        };
      }

      if (copyAnonymizedBtn) {
        copyAnonymizedBtn.onclick = function() {
          if (!anonymizePreview || !anonymizePreview.value) return;
          navigator.clipboard.writeText(anonymizePreview.value).then(function() {
            copyAnonymizedBtn.textContent = '✓ Copied';
            setTimeout(function() { copyAnonymizedBtn.textContent = '📋 Copy Sanitized'; }, 1200);
          });
        };
      }

      if (openAnonymizedInEditorBtn) {
        openAnonymizedInEditorBtn.onclick = function() {
          if (!anonymizePreview || !anonymizePreview.value) return;
          vscode.postMessage({
            type: 'openInEditor',
            text: anonymizePreview.value,
            language: 'json'
          });
        };
      }

      if (sendToAiAnonymizedBtn) {
        sendToAiAnonymizedBtn.onclick = function() {
          if (!anonymizePreview || !anonymizePreview.value) return;
          if (typeof toggleAiDrawer === 'function') {
            toggleAiDrawer(true);
          }
          if (aiPrompt) {
            const snippet = anonymizePreview.value.slice(0, 1000);
            aiPrompt.value = aiPrompt.value 
              ? (aiPrompt.value + '\\n\\n' + snippet)
              : ('Sanitized data structure:\\n' + snippet + '\\n\\nFilter or transform this data:');
            aiPrompt.focus();
          }
          closeAnonymizerModal();
        };
      }

      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && anonymizerModal && anonymizerModal.style.display !== 'none') {
          closeAnonymizerModal();
        }
      });

      return {
        open: openAnonymizerModal,
        close: closeAnonymizerModal,
        render: renderAnonymizePreview,
        anonymizeCore: anonymizeCore
      };
    }

    const anonymizerController = setupAnonymizerUI();

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

        // Connect Visual Lens to resultJsonEditor cursor activity
        resultJsonEditor.on('cursorActivity', function(cm) {
          if (resultFormat && resultFormat.value === 'json') {
            const cursor = cm.getCursor();
            const offset = cm.indexFromPos(cursor);
            updateVisualLensFromOffset(cm.getValue(), offset);
          }
        });
        if (resultFormat && ['json', 'yaml', 'ndjson', 'xml'].includes(resultFormat.value) && resultPre && resultPre.style.display !== 'none' && !resultPre.classList.contains('empty') && !resultPre.classList.contains('error')) {
          resultJsonEditor.setValue(resultPre.textContent || '');
          resultJsonEditorWrapper.style.display = 'block';
          resultPre.style.display = 'none';
          setTimeout(() => {
            if (resultJsonEditor) resultJsonEditor.refresh();
          }, 50);
        }
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
      if (prop.valueType) return normalizeType(prop.valueType);
      return normalizeType(prop.type);
    }

    function schemaForProp(prop) {
      if (!prop) return null;
      if (prop.type === 'array' || prop.items) {
        let itemsSchema = null;
        if (prop.items) {
          itemsSchema = prop.items.type ? (prop.items.type === 'array' && prop.items.items ? prop.items.items : prop.items) : schemaForProp(prop.items);
        }
        return {
          type: 'array',
          items: itemsSchema
        };
      }
      if (prop.type === 'object' || prop.properties) {
        return { type: 'object', properties: prop.properties || {} };
      }
      return { type: 'primitive', valueType: normalizeType(prop.valueType || prop.type) };
    }

    function isValidStepAlias(alias) {
      if (!alias || typeof alias !== 'string') return false;
      const trimmed = alias.trim();
      return /^[a-zA-Z_\\$][a-zA-Z0-9_\\$]*$/.test(trimmed);
    }

    function extractSchemaFromValue(val, depth) {
      if (depth === undefined) depth = 0;
      if (val === null || val === undefined) return { type: 'primitive', valueType: 'null' };
      if (typeof val !== 'object') return { type: 'primitive', valueType: typeof val };
      if (depth >= 3) {
        if (Array.isArray(val)) return { type: 'array', items: { type: 'primitive', valueType: 'any' } };
        return { type: 'object', properties: {} };
      }
      if (Array.isArray(val)) {
        if (val.length === 0) return { type: 'array', items: { type: 'primitive', valueType: 'any' } };
        const sample = val.slice(0, 10);
        let itemsSchema = null;
        for (let i = 0; i < sample.length; i++) {
          const item = sample[i];
          if (item !== null && item !== undefined) {
            const s = extractSchemaFromValue(item, depth + 1);
            if (!itemsSchema) {
              itemsSchema = s;
            } else if (itemsSchema.type === 'object' && s.type === 'object') {
              itemsSchema.properties = Object.assign({}, itemsSchema.properties, s.properties);
            }
          }
        }
        return { type: 'array', items: itemsSchema || { type: 'primitive', valueType: 'any' } };
      }
      const props = {};
      const keys = Object.keys(val).slice(0, 50);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        props[k] = extractSchemaFromValue(val[k], depth + 1);
      }
      return { type: 'object', properties: props };
    }

    function getInitialDataSchema() {
      if (typeof currentSchema !== 'object' || !currentSchema) return null;
      if (currentSchema.type === 'object' && currentSchema.properties) {
        if (currentSchema.properties['data']) {
          return schemaForProp(currentSchema.properties['data']);
        }
        if (typeof currentSources === 'object' && Array.isArray(currentSources) && currentSources.length > 0) {
          const firstAlias = currentSources[0] && currentSources[0].alias;
          if (firstAlias && currentSchema.properties[firstAlias]) {
            return schemaForProp(currentSchema.properties[firstAlias]);
          }
        }
      }
      return currentSchema;
    }

    function getPipelineVariablesMap() {
      const vars = {};
      const steps = (typeof pipelineSteps !== 'undefined' && Array.isArray(pipelineSteps)) ? pipelineSteps : null;
      if (!steps || steps.length === 0) return vars;
      if (typeof activeEditorMode !== 'undefined' && activeEditorMode !== 'pipeline') return vars;

      const curIdx = (typeof activeStepIndex === 'number' && activeStepIndex >= 0) ? activeStepIndex : 0;
      const initialSchema = getInitialDataSchema();
      const pipelineRes = (typeof lastPipelineResult !== 'undefined' && lastPipelineResult) ? lastPipelineResult : null;

      // Find schema for previous step output
      let prevSchema = null;
      if (curIdx === 0) {
        prevSchema = initialSchema;
      } else {
        // Look backwards for the most recent enabled step before curIdx
        let prevStep = null;
        let prevStepIdx = -1;
        for (let i = curIdx - 1; i >= 0; i--) {
          if (steps[i] && steps[i].enabled !== false) {
            prevStep = steps[i];
            prevStepIdx = i;
            break;
          }
        }
        if (!prevStep && curIdx - 1 >= 0) {
          prevStep = steps[curIdx - 1];
          prevStepIdx = curIdx - 1;
        }

        if (prevStep && pipelineRes && Array.isArray(pipelineRes.steps)) {
          const stepRes = pipelineRes.steps.find(function(s) { return s.id === prevStep.id; }) || pipelineRes.steps[prevStepIdx];
          if (stepRes && stepRes.output !== undefined && stepRes.output !== null) {
            prevSchema = extractSchemaFromValue(stepRes.output);
          }
        }
        if (!prevSchema) {
          prevSchema = initialSchema;
        }
      }

      vars['prev'] = {
        schemaPart: prevSchema,
        displayText: curIdx === 0 ? 'prev : input data (step 1)' : 'prev : previous step output'
      };
      vars['input'] = {
        schemaPart: prevSchema,
        displayText: 'input : alias for prev'
      };
      vars['raw'] = {
        schemaPart: initialSchema,
        displayText: 'raw : initial input data'
      };

      // Add step variables from step 1 up to current step
      for (let i = 0; i <= curIdx && i < steps.length; i++) {
        const s = steps[i];
        if (!s) continue;
        const stepNum = i + 1;
        const defaultAlias = 'step' + stepNum;
        const customAlias = (isValidStepAlias(s.alias) && s.alias.trim() !== defaultAlias) ? s.alias.trim() : null;
        const validName = (isValidStepAlias(s.name) && s.name.trim() !== defaultAlias && (!customAlias || s.name.trim() !== customAlias)) ? s.name.trim() : null;

        let sSchema = null;
        if (i === curIdx) {
          sSchema = prevSchema;
        } else {
          if (pipelineRes && Array.isArray(pipelineRes.steps)) {
            const stepRes = pipelineRes.steps.find(function(r) { return r.id === s.id; }) || pipelineRes.steps[i];
            if (stepRes && stepRes.output !== undefined && stepRes.output !== null) {
              sSchema = extractSchemaFromValue(stepRes.output);
            }
          }
          if (!sSchema) {
            sSchema = initialSchema;
          }
        }

        vars[defaultAlias] = {
          schemaPart: sSchema,
          displayText: defaultAlias + ' : Step ' + stepNum + (i === curIdx ? ' (current input)' : ' output')
        };
        if (customAlias) {
          vars[customAlias] = {
            schemaPart: sSchema,
            displayText: customAlias + ' : Step ' + stepNum + ' output (alias)'
          };
        }
        if (validName) {
          vars[validName] = {
            schemaPart: sSchema,
            displayText: validName + ' : Step ' + stepNum + ' output (name)'
          };
        }
      }

      return vars;
    }

    function buildTopLevelCompletions(callbackBindings) {
      const completions = [
        { kind: 'keyword', text: 'data', displayText: 'data : input JSON data' },
        { kind: 'keyword', text: 'env', displayText: 'env : active environment' },
        { kind: 'keyword', text: 'require', displayText: 'require(module)' },
        { kind: 'keyword', text: 'Math', displayText: 'Math : built-in' },
        { kind: 'keyword', text: 'JSON', displayText: 'JSON : built-in' },
        { kind: 'keyword', text: 'Object', displayText: 'Object : built-in' },
        { kind: 'keyword', text: 'Array', displayText: 'Array : built-in' },
        { kind: 'keyword', text: 'console', displayText: 'console : built-in' },
        { kind: 'keyword', text: 'req', displayText: 'req : HTTP request (query, body, headers, method)' },
        { kind: 'keyword', text: 'res', displayText: 'res : HTTP response controller (status, setHeader, json)' },
        { kind: 'keyword', text: 'anonymize', displayText: 'anonymize(data, options?) : sanitize sensitive data / PII' },
        { kind: 'keyword', text: 'maskPII', displayText: 'maskPII(data) : mask credentials, emails, phones, cards' },
        { kind: 'keyword', text: 'test', displayText: 'test(name, fn) : declare test case' },
        { kind: 'keyword', text: 'it', displayText: 'it(name, fn) : declare test case' },
        { kind: 'keyword', text: 'expect', displayText: 'expect(actual) : test assertion matcher' },
        { kind: 'keyword', text: 'assert', displayText: 'assert(condition, msg) : assertion' }
      ];

      // Pipeline scoped variables (prev, input, raw, step1, aliases, names)
      const pVars = getPipelineVariablesMap();
      for (const varName of Object.keys(pVars)) {
        if (varName === 'data') continue;
        completions.push({
          kind: 'keyword',
          text: varName,
          displayText: pVars[varName].displayText
        });
      }

      if (typeof currentSources === 'object' && Array.isArray(currentSources)) {
        for (let sIdx = 0; sIdx < currentSources.length; sIdx++) {
          const s = currentSources[sIdx];
          if (s && s.alias && s.alias !== 'data' && !pVars[s.alias]) {
            completions.push({ kind: 'keyword', text: s.alias, displayText: s.alias + ' : bound source' });
          }
        }
      }

      if (callbackBindings) {
        for (const p of Object.keys(callbackBindings)) {
          completions.unshift({ kind: 'variable', text: p, displayText: p + ' : callback param' });
        }
      }

      return completions;
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
    function buildEnvCompletions() {
      const list = [
        { kind: 'property', text: 'baseURL', displayText: 'baseURL : string (env)' },
        { kind: 'property', text: 'baseUrl', displayText: 'baseUrl : string (env)' },
        { kind: 'property', text: 'BASE_URL', displayText: 'BASE_URL : string (env)' },
        { kind: 'property', text: 'name', displayText: 'name : string (env)' },
        { kind: 'property', text: 'activeEnv', displayText: 'activeEnv : string (env)' },
        { kind: 'property', text: 'variables', displayText: 'variables : object (env)' }
      ];
      if (typeof currentEnvVariables === 'object' && currentEnvVariables) {
        for (const [k, v] of Object.entries(currentEnvVariables)) {
          if (!list.some(function(item) { return item.text === k; })) {
            list.push({
              kind: 'property',
              text: k,
              displayText: k + ' : ' + (typeof v) + ' (env)'
            });
          }
        }
      }
      list.push(...buildMethodCompletions(TYPE_OBJECT));
      return list;
    }

    function buildMathCompletions() {
      const methods = ['abs', 'round', 'floor', 'ceil', 'min', 'max', 'random', 'sqrt', 'pow', 'trunc', 'sign', 'sin', 'cos', 'tan', 'log', 'log10', 'log2', 'exp'];
      const props = ['PI', 'E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'SQRT1_2', 'SQRT2'];
      const list = [];
      for (const p of props) {
        list.push({ kind: 'property', text: p, displayText: p + ' : number (Math)' });
      }
      for (const m of methods) {
        list.push({ kind: 'method', text: m, displayText: m + '() : number (Math)' });
      }
      return list;
    }

    function buildJsonCompletions() {
      return [
        { kind: 'method', text: 'stringify', displayText: 'stringify(value, replacer?, space?) : string' },
        { kind: 'method', text: 'parse', displayText: 'parse(text, reviver?) : any' }
      ];
    }

    function buildObjectConstructorCompletions() {
      const methods = ['keys', 'values', 'entries', 'assign', 'groupBy', 'fromEntries', 'freeze', 'seal', 'hasOwn'];
      return methods.map(function(m) {
        return { kind: 'method', text: m, displayText: m + '() : Object' };
      });
    }

    function buildArrayConstructorCompletions() {
      return [
        { kind: 'method', text: 'isArray', displayText: 'isArray(arg) : boolean' },
        { kind: 'method', text: 'from', displayText: 'from(arrayLike, mapFn?) : array' },
        { kind: 'method', text: 'of', displayText: 'of(...items) : array' }
      ];
    }

    function buildConsoleCompletions() {
      const methods = [
        'debug',
        'log',
        'info',
        'warn',
        'error',
        'table',
        'time',
        'timeEnd',
        'timeLog',
        'trace',
        'dir',
        'dirxml',
        'clear',
        'count',
        'countReset',
        'assert',
        'group',
        'groupCollapsed',
        'groupEnd'
      ];
      return methods.map(function(m) {
        return { kind: 'method', text: m, displayText: m + '() : void (console)' };
      });
    }

    function buildAssertCompletions() {
      const methods = [
        { text: 'strictEqual', display: 'strictEqual(actual, expected, msg?) : strict equal ===' },
        { text: 'notStrictEqual', display: 'notStrictEqual(actual, expected, msg?) : !==' },
        { text: 'deepStrictEqual', display: 'deepStrictEqual(actual, expected, msg?) : deep equal' },
        { text: 'notDeepStrictEqual', display: 'notDeepStrictEqual(actual, expected, msg?) : not deep equal' },
        { text: 'ok', display: 'ok(value, msg?) : assert truthy' },
        { text: 'match', display: 'match(string, regexp, msg?) : regex match' },
        { text: 'doesNotMatch', display: 'doesNotMatch(string, regexp, msg?) : regex does not match' },
        { text: 'throws', display: 'throws(fn, expected?, msg?) : assert throws' },
        { text: 'doesNotThrow', display: 'doesNotThrow(fn, msg?) : assert does not throw' },
        { text: 'fail', display: 'fail(msg?) : trigger failure' }
      ];
      return methods.map(function(m) {
        return { kind: 'method', text: m.text, displayText: m.text + ' : ' + m.display };
      });
    }

    function buildExpectCompletions() {
      const matchers = [
        { text: 'toBe', display: 'toBe(expected) : strict === equality' },
        { text: 'toEqual', display: 'toEqual(expected) : deep structural equality' },
        { text: 'toBeTruthy', display: 'toBeTruthy() : assert truthy' },
        { text: 'toBeFalsy', display: 'toBeFalsy() : assert falsy' },
        { text: 'toBeNull', display: 'toBeNull() : assert === null' },
        { text: 'toBeUndefined', display: 'toBeUndefined() : assert === undefined' },
        { text: 'toBeDefined', display: 'toBeDefined() : assert !== undefined' },
        { text: 'toBeNaN', display: 'toBeNaN() : assert is NaN' },
        { text: 'toBeGreaterThan', display: 'toBeGreaterThan(n) : > comparison' },
        { text: 'toBeGreaterThanOrEqual', display: 'toBeGreaterThanOrEqual(n) : >= comparison' },
        { text: 'toBeLessThan', display: 'toBeLessThan(n) : < comparison' },
        { text: 'toBeLessThanOrEqual', display: 'toBeLessThanOrEqual(n) : <= comparison' },
        { text: 'toBeCloseTo', display: 'toBeCloseTo(expected, digits?) : close float' },
        { text: 'toContain', display: 'toContain(item) : array/string/object contains' },
        { text: 'toHaveLength', display: 'toHaveLength(len) : length or size check' },
        { text: 'toHaveProperty', display: 'toHaveProperty(path, value?) : nested property check' },
        { text: 'toMatch', display: 'toMatch(regexp) : regex pattern match' },
        { text: 'toBeTypeOf', display: 'toBeTypeOf(type) : typeof check' },
        { text: 'toBeArray', display: 'toBeArray() : assert Array.isArray' },
        { text: 'toBeObject', display: 'toBeObject() : assert object' },
        { text: 'toBeString', display: 'toBeString() : assert string' },
        { text: 'toBeNumber', display: 'toBeNumber() : assert number' },
        { text: 'toBeBoolean', display: 'toBeBoolean() : assert boolean' },
        { text: 'toThrow', display: 'toThrow(expected?) : assert function throws' },
        { text: 'not', display: 'not : invert matcher' }
      ];
      return matchers.map(function(m) {
        return { kind: 'method', text: m.text, displayText: m.text + ' : ' + m.display };
      });
    }

    function buildReqCompletions() {
      return [
        { kind: 'property', text: 'query', displayText: 'query : Record<string, string> (URL query params)' },
        { kind: 'property', text: 'body', displayText: 'body : any (parsed JSON request body)' },
        { kind: 'property', text: 'headers', displayText: 'headers : Record<string, string> (request headers)' },
        { kind: 'property', text: 'method', displayText: 'method : string (HTTP verb: GET, POST, etc.)' },
        { kind: 'property', text: 'url', displayText: 'url : string (full request URL path)' },
        { kind: 'property', text: 'path', displayText: 'path : string (pathname without query params)' }
      ];
    }

    function buildResCompletions() {
      return [
        { kind: 'method', text: 'status', displayText: 'status(code) : res (set HTTP status code)' },
        { kind: 'property', text: 'statusCode', displayText: 'statusCode : number (current status code)' },
        { kind: 'method', text: 'setHeader', displayText: 'setHeader(name, value) : res (set response header)' },
        { kind: 'method', text: 'header', displayText: 'header(name, value) : res (alias for setHeader)' },
        { kind: 'property', text: 'headers', displayText: 'headers : Record<string, string> (response headers)' },
        { kind: 'method', text: 'json', displayText: 'json(payload) : any (send JSON payload)' },
        { kind: 'method', text: 'send', displayText: 'send(payload) : any (send response payload)' }
      ];
    }

    function buildAnyFallbackCompletions(receiverName, fullDocText) {
      const list = [];
      const seen = new Set();

      function add(item) {
        if (item && item.text && !seen.has(item.text)) {
          seen.add(item.text);
          list.push(item);
        }
      }

      if (receiverName && fullDocText) {
        try {
          const escaped = receiverName.split('.').join('\\\\.');
          const propRegex = new RegExp('(?:^|[^a-zA-Z0-9_\\$])' + escaped + '(?:[?][.]|[!][.]|[.])([a-zA-Z_\\$][a-zA-Z0-9_\\$]*)', 'g');
          let pm;
          while ((pm = propRegex.exec(fullDocText)) !== null) {
            add({
              kind: 'field',
              text: pm[1],
              displayText: pm[1] + ' (inferred)'
            });
          }
        } catch {
          // Safeguard against invalid regex
        }
      }

      const allMethods = [
        ...buildMethodCompletions(TYPE_ARRAY),
        ...buildMethodCompletions(TYPE_STRING),
        ...buildMethodCompletions(TYPE_OBJECT),
        ...buildMethodCompletions(TYPE_NUMBER)
      ];
      for (let i = 0; i < allMethods.length; i++) {
        add(allMethods[i]);
      }

      return list;
    }

    // Clean optional chaining (?.) and non-null assertion (!.) from member access chain
    function cleanChain(chain) {
      if (!chain) return '';
      return chain
        .replace(/[?!]\\.\\[/g, '[')
        .replace(/[?!]\\[/g, '[')
        .replace(/\\?\\./g, '.')
        .replace(/!\\./g, '.')
        .replace(/[?!]+$/, '')
        .replace(/[?!]+(?=\\.|$)/g, '');
    }

    // Infer type of an expression fragment like:
    // data
    // data[0]
    // data[0].name
    // data[0].name.toUpperCase()
    // a (callback parameter)
    // a.name (callback parameter with property access)
    // Returns { typeName, schemaPart }
    function inferTypeFromChain(chain, callbackBindings, fullDocText) {
      if (!chain) return { typeName: TYPE_ANY, schemaPart: null };
      chain = cleanChain(chain).replace(/\\.$/, '');
      if (!chain) return { typeName: TYPE_ANY, schemaPart: null };

      // 1. Special global objects
      if (chain === 'Math') return { typeName: 'Math', schemaPart: null };
      if (chain === 'JSON') return { typeName: 'JSON', schemaPart: null };
      if (chain === 'Object') return { typeName: 'Object', schemaPart: null };
      if (chain === 'Array') return { typeName: 'Array', schemaPart: null };
      if (chain === 'console') return { typeName: 'console', schemaPart: null };
      if (chain === 'assert') return { typeName: 'assert', schemaPart: null };
      if (chain === 'expect' || chain.startsWith('expect(') || chain.endsWith('.not')) return { typeName: 'expect', schemaPart: null };

      // 2. HTTP Request and Response objects
      if (chain === 'req') return { typeName: 'req', schemaPart: null };
      if (chain === 'req.query' || chain.startsWith('req.query.')) return { typeName: TYPE_OBJECT, schemaPart: null };
      if (chain === 'req.body' || chain.startsWith('req.body.')) return { typeName: TYPE_OBJECT, schemaPart: null };
      if (chain === 'req.headers' || chain.startsWith('req.headers.')) return { typeName: TYPE_OBJECT, schemaPart: null };
      if (chain === 'req.method' || chain === 'req.url' || chain === 'req.path') return { typeName: TYPE_STRING, schemaPart: null };

      if (chain === 'res' || chain.startsWith('res.status(') || chain.startsWith('res.setHeader(') || chain.startsWith('res.header(')) {
        return { typeName: 'res', schemaPart: null };
      }
      if (chain === 'res.headers' || chain.startsWith('res.headers.')) return { typeName: TYPE_OBJECT, schemaPart: null };
      if (chain === 'res.statusCode') return { typeName: TYPE_NUMBER, schemaPart: null };

      // 3. Environment object
      if (chain === 'env' || chain.startsWith('env.')) {
        return { typeName: 'environment', schemaPart: null };
      }

      let schemaPart = null;
      let typeName = TYPE_ANY;

      // 3. Check callback parameter bindings
      if (callbackBindings) {
        for (const [paramName, binding] of Object.entries(callbackBindings)) {
          if (chain === paramName || chain.startsWith(paramName + '.') || chain.startsWith(paramName + '[')) {
            schemaPart = binding.schemaPart;
            typeName = binding.inferredType;
            let rest = chain.slice(paramName.length);
            while (rest.length > 0 && (rest.startsWith('.') || rest.startsWith('['))) {
              if (rest.startsWith('[')) {
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
              }

              if (rest.startsWith('.')) {
                rest = rest.slice(1);
                const propMatch = rest.match(/^([a-zA-Z_\\$][a-zA-Z0-9_\\$]*)/);
                if (propMatch) {
                  const propName = propMatch[1];
                  rest = rest.slice(propMatch[0].length);

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
            }
            return { typeName: normalizeType(typeName), schemaPart };
          }
        }
      }

      // 4. Pipeline scoped variables (prev, input, raw, step1, aliases, names) or bound sources
      let matchedSource = null;
      let matchedSourceSchema = undefined;

      const pVars = getPipelineVariablesMap();
      const pVarKeys = Object.keys(pVars).sort(function(a, b) { return b.length - a.length; });
      for (let i = 0; i < pVarKeys.length; i++) {
        const vk = pVarKeys[i];
        if (chain === vk || chain.startsWith(vk + '.') || chain.startsWith(vk + '[')) {
          matchedSource = vk;
          matchedSourceSchema = pVars[vk].schemaPart;
          break;
        }
      }

      if (!matchedSource) {
        if (chain === 'data' || chain.startsWith('data.') || chain.startsWith('data[')) {
          matchedSource = 'data';
        } else if (typeof currentSources === 'object' && Array.isArray(currentSources)) {
          for (let sIdx = 0; sIdx < currentSources.length; sIdx++) {
            const s = currentSources[sIdx];
            if (s && s.alias && (chain === s.alias || chain.startsWith(s.alias + '.') || chain.startsWith(s.alias + '['))) {
              matchedSource = s.alias;
              break;
            }
          }
        }
      }

      if (matchedSource) {
        if (matchedSourceSchema !== undefined) {
          schemaPart = matchedSourceSchema;
        } else if (currentSchema && currentSchema.type === 'object' && currentSchema.properties && currentSchema.properties[matchedSource]) {
          schemaPart = schemaForProp(currentSchema.properties[matchedSource]);
        } else {
          schemaPart = currentSchema;
        }
        typeName = schemaTypeOf(schemaPart);

        let rest = chain.slice(matchedSource.length);
        while (rest.length > 0) {
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

          const memNameMatch = rest.match(/^\\.([a-zA-Z_\\$][a-zA-Z0-9_\\$]*)/);
          if (memNameMatch) {
            const name = memNameMatch[1];
            rest = rest.slice(memNameMatch[0].length);

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
              const table = METHOD_RET[t];
              const retSpec = table ? table[name] : undefined;
              if (retSpec) {
                const resolved = resolveReturnType(t, name, retSpec, schemaPart);
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
                schemaPart = null;
                typeName = TYPE_ANY;
              }
            }
            continue;
          }

          break;
        }

        return { typeName: normalizeType(typeName), schemaPart };
      }

      // 5. Try inspecting code for variable declaration (e.g. const blabla = { foo: 1, bar: 'test' })
      if (fullDocText) {
        const id = chain.split('.')[0].replace(/\[.*\]/, '');
        try {
          const declRegex = new RegExp('(?:const|let|var)\\\\s+' + id + '\\\\s*=\\\\s*([^;\\\\n]+)');
          const declMatch = fullDocText.match(declRegex);
          if (declMatch && declMatch[1]) {
            const rhs = declMatch[1].trim();
            if (rhs.startsWith('{')) {
              const props = {};
              const pRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g;
              let pm;
              while ((pm = pRegex.exec(rhs)) !== null) {
                props[pm[1]] = { type: TYPE_ANY };
              }
              if (Object.keys(props).length > 0) {
                return { typeName: TYPE_OBJECT, schemaPart: { type: 'object', properties: props } };
              }
            } else if (rhs.startsWith('[')) {
              return { typeName: TYPE_ARRAY, schemaPart: { type: 'array', items: null } };
            } else if (rhs.startsWith('"') || rhs.startsWith("'") || rhs.startsWith(String.fromCharCode(96))) {
              return { typeName: TYPE_STRING, schemaPart: { type: 'primitive', valueType: TYPE_STRING } };
            } else if (rhs.startsWith('true') || rhs.startsWith('false')) {
              return { typeName: TYPE_BOOLEAN, schemaPart: { type: 'primitive', valueType: TYPE_BOOLEAN } };
            } else if (/^-?\\d/.test(rhs)) {
              return { typeName: TYPE_NUMBER, schemaPart: { type: 'primitive', valueType: TYPE_NUMBER } };
            } else if (rhs !== id && /^[a-zA-Z_$][a-zA-Z0-9_$.[\]]*$/.test(rhs)) {
              const rhsInferred = inferTypeFromChain(rhs, callbackBindings, null);
              if (rhsInferred && rhsInferred.typeName !== TYPE_ANY) {
                return rhsInferred;
              }
            }
          }
        } catch {
          // Regex error safeguard
        }
      }

      return { typeName: TYPE_ANY, schemaPart: null };
    }

    // Detect callback parameter bindings (e.g., "data.map(x =>" binds x to array items)
    function findCallbackBindings(line, cursorCh, cm, cursorLine) {
      const bindings = {};

      function checkArrow(text, maxCh) {
        const limit = typeof maxCh === 'number' ? maxCh : text.length;
        const arrowPos = text.lastIndexOf('=>', limit);
        if (arrowPos === -1) return;

        let paramEnd = arrowPos;
        let paramStart = paramEnd;
        while (paramStart > 0 && /[\\s]/.test(text[paramStart - 1])) {
          paramStart--;
        }
        while (paramStart > 0 && /[^\\s]/.test(text[paramStart - 1]) && text[paramStart - 1] !== '(') {
          paramStart--;
        }
        let rawParam = text.slice(paramStart, paramEnd).trim();
        if (rawParam.startsWith('(') && rawParam.endsWith(')')) {
          rawParam = rawParam.slice(1, -1).trim();
        }
        const paramNames = rawParam.split(',').map(function(p) { return p.trim(); }).filter(Boolean);
        const paramName = paramNames.length > 0 ? (paramNames[0].match(/[a-zA-Z_\\$][a-zA-Z0-9_\\$]*/) || [])[0] : '';
        if (!paramName) return;

        const prefix = text.slice(0, arrowPos);
        const arrayMethods = ['map', 'filter', 'find', 'findIndex', 'some', 'every', 'forEach', 'reduce', 'reduceRight', 'flatMap'];
        let bestIdx = -1;
        for (const m of arrayMethods) {
          const idx = prefix.lastIndexOf('.' + m);
          if (idx !== -1 && idx > bestIdx) {
            bestIdx = idx;
          }
        }
        if (bestIdx === -1) {
          bindings[paramName] = { receiverChain: '', inferredType: TYPE_ANY, schemaPart: null };
          return;
        }

        const beforeMethod = prefix.slice(0, bestIdx);
        const rcMatch = beforeMethod.match(/([a-zA-Z0-9_\\$\\.\\[\\]?!]+)\\s*$/);
        const rawReceiverChain = rcMatch ? rcMatch[1] : beforeMethod.trim();
        const receiverChain = cleanChain(rawReceiverChain).replace(/\\.$/, '');

        const receiverInferred = inferTypeFromChain(receiverChain, bindings);
        if (receiverInferred.typeName === TYPE_ARRAY && receiverInferred.schemaPart && receiverInferred.schemaPart.items) {
          bindings[paramName] = {
            receiverChain: receiverChain,
            inferredType: schemaTypeOf(receiverInferred.schemaPart.items),
            schemaPart: receiverInferred.schemaPart.items
          };
        } else {
          bindings[paramName] = { receiverChain: receiverChain, inferredType: TYPE_ANY, schemaPart: null };
        }
      }

      checkArrow(line, cursorCh);

      if (cm && typeof cursorLine === 'number' && cursorLine > 0) {
        const minLine = Math.max(0, cursorLine - 25);
        for (let l = cursorLine - 1; l >= minLine; l--) {
          const prevLine = cm.getLine(l);
          if (prevLine && prevLine.includes('=>')) {
            checkArrow(prevLine);
          }
        }
      }

      return bindings;
    }

    // Determine if an offset is inside a string literal, template literal text, or comment
    function isInsideStringOrComment(text, targetOffset) {
      if (!text || targetOffset <= 0) return false;
      let inSingleQuote = false;
      let inDoubleQuote = false;
      const templateStack = [];
      let inLineComment = false;
      let inBlockComment = false;
      const SQ = String.fromCharCode(39);
      const DQ = String.fromCharCode(34);
      const BT = String.fromCharCode(96);
      const BS = String.fromCharCode(92);
      const LF = String.fromCharCode(10);

      const len = Math.min(targetOffset, text.length);
      for (let i = 0; i < len; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';

        if (inLineComment) {
          if (ch === LF) inLineComment = false;
          continue;
        }

        if (inBlockComment) {
          if (ch === '*' && next === '/') {
            inBlockComment = false;
            i++;
          }
          continue;
        }

        if (inSingleQuote) {
          if (ch === BS) {
            i++;
          } else if (ch === SQ) {
            inSingleQuote = false;
          }
          continue;
        }

        if (inDoubleQuote) {
          if (ch === BS) {
            i++;
          } else if (ch === DQ) {
            inDoubleQuote = false;
          }
          continue;
        }

        if (templateStack.length > 0) {
          const top = templateStack[templateStack.length - 1];
          if (top.braceDepth === 0) {
            if (ch === BS) {
              i++;
              continue;
            }
            if (ch === '$' && next === '{') {
              top.braceDepth = 1;
              i++;
              continue;
            }
            if (ch === BT) {
              templateStack.pop();
              continue;
            }
            continue;
          } else {
            if (ch === '{') {
              top.braceDepth++;
              continue;
            }
            if (ch === '}') {
              top.braceDepth--;
              continue;
            }
          }
        }

        if (ch === '/' && next === '/') {
          inLineComment = true;
          i++;
          continue;
        }
        if (ch === '/' && next === '*') {
          inBlockComment = true;
          i++;
          continue;
        }
        if (ch === SQ) {
          inSingleQuote = true;
          continue;
        }
        if (ch === DQ) {
          inDoubleQuote = true;
          continue;
        }
        if (ch === BT) {
          templateStack.push({ braceDepth: 0 });
          continue;
        }
      }

      const inTemplateText = templateStack.length > 0 && templateStack[templateStack.length - 1].braceDepth === 0;
      return inSingleQuote || inDoubleQuote || inTemplateText || inLineComment || inBlockComment;
    }

    function isPositionInStringOrComment(cm, cursor, line, cursorCh) {
      if (cm && typeof cm.getTokenAt === 'function' && cursor) {
        try {
          const token = cm.getTokenAt(cursor);
          if (token && token.type) {
            if (/\\b(?:string|string-2|comment)\\b/.test(token.type)) {
              return true;
            }
          }
        } catch {
          // Fall through to text analysis
        }
      }

      let textToAnalyze = line || '';
      let targetOffset = typeof cursorCh === 'number' ? cursorCh : textToAnalyze.length;

      if (cm && typeof cm.getValue === 'function' && cursor && typeof cursor.line === 'number') {
        try {
          const doc = cm.getValue();
          if (typeof cm.indexFromPos === 'function') {
            targetOffset = cm.indexFromPos(cursor);
          } else {
            let offset = 0;
            for (let l = 0; l < cursor.line; l++) {
              const lText = cm.getLine ? cm.getLine(l) : '';
              offset += (lText !== undefined ? lText.length : 0) + 1;
            }
            offset += (typeof cursor.ch === 'number' ? cursor.ch : 0);
            targetOffset = offset;
          }
          textToAnalyze = doc;
        } catch {
          // Fall back to line
        }
      }

      return isInsideStringOrComment(textToAnalyze, targetOffset);
    }

    function extractChainForAutocomplete(line, cursorCh, cm, cursorLine) {
      if (isPositionInStringOrComment(cm, typeof cursorLine === 'number' ? { line: cursorLine, ch: cursorCh } : null, line, cursorCh)) {
        return null;
      }
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
          break;
        }
        if (parenDepth > 0) {
          start--;
          continue;
        }
        if (/[a-zA-Z0-9_\\$\\.\\[\\]?!]/.test(ch)) {
          start--;
          continue;
        }
        break;
      }
      const fragment = line.slice(start, cursorCh);
      if (!fragment) return null;

      const callbackBindings = findCallbackBindings(line, cursorCh, cm, cursorLine);

      let chain = null;
      let chainStartInLine = start;

      // 1. Check callback parameters
      for (const [paramName, binding] of Object.entries(callbackBindings)) {
        if (fragment === paramName || fragment.startsWith(paramName + '.') || fragment.startsWith(paramName + '[')
            || fragment.startsWith(paramName + '?.') || fragment.startsWith(paramName + '!.')
            || fragment.startsWith(paramName + '?.[') || fragment.startsWith(paramName + '![')) {
          chain = fragment;
          chainStartInLine = start;
          break;
        }
        const paramPatterns = [paramName + '?.', paramName + '!.', paramName + '.', paramName + '?.[', paramName + '!['];
        let foundIdx = -1;
        for (const pPat of paramPatterns) {
          const idx = fragment.indexOf(pPat);
          if (idx !== -1 && (foundIdx === -1 || idx < foundIdx)) {
            foundIdx = idx;
          }
        }
        if (foundIdx !== -1) {
          chain = fragment.slice(foundIdx);
          chainStartInLine = start + foundIdx;
          break;
        }
      }

      // 2. Any identifier chain (e.g. blabla., data., env., Math., users.)
      if (!chain) {
        const match = fragment.match(/([a-zA-Z_\\$][a-zA-Z0-9_\\$\\.\\[\\]?!]*)$/);
        if (match) {
          chain = match[1];
          chainStartInLine = start + match.index;
        }
      }

      if (!chain) return null;

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
      if (typeof editor.showHint !== 'function' && !(CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function')) {
        return;
      }

      // Trigger autocomplete on typing '.' or '['
      editor.on('inputRead', function(cm, change) {
        if (change && change.text) {
          const t = change.text[0] || '';
          if (t === '.' || t === '[') {
            const cursor = cm.getCursor();
            const line = cm.getLine(cursor.line);
            if (isPositionInStringOrComment(cm, cursor, line, cursor.ch)) {
              return;
            }
            if (typeof cm.showHint === 'function') {
              cm.showHint({ completeSingle: false });
            } else if (CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function') {
              CodeMirror.commands.autocomplete(cm);
            }
          }
        }
      });

      editor.on('keyup', function(cm, e) {
        if (e.key === '.' || e.key === '[' || e.keyCode === 190 || e.keyCode === 219) {
          const cursor = cm.getCursor();
          const line = cm.getLine(cursor.line);
          if (isPositionInStringOrComment(cm, cursor, line, cursor.ch)) {
            return;
          }
          if (typeof cm.showHint === 'function') {
            cm.showHint({ completeSingle: false });
          } else if (CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function') {
            CodeMirror.commands.autocomplete(cm);
          }
        }
      });

      editor.setOption('hintOptions', {
        hint: function(cm, options) {
          const cursor = cm.getCursor();
          const line = cm.getLine(cursor.line);
          const pos = cursor.ch;
          if (isPositionInStringOrComment(cm, cursor, line, pos)) {
            return null;
          }
          const fullDocText = cm.getValue ? cm.getValue() : '';

          const extracted = extractChainForAutocomplete(line, pos, cm, cursor.line);
          if (!extracted) return null;

          const chain = extracted.chain;
          const callbackBindings = extracted.callbackBindings || {};
          const endsWithDot = chain.endsWith('.');

          // Determine if typing a member access (has a dot) or top-level keyword
          let receiverChain = chain;
          if (chain.includes('.')) {
            if (!endsWithDot) {
              receiverChain = chain.replace(/\\.[a-zA-Z_\\$][a-zA-Z0-9_\\$]*$/, '');
            }
            receiverChain = cleanChain(receiverChain).replace(/\\.$/, '');
          }

          let completions = [];

          if (chain.includes('.')) {
            const inferred = inferTypeFromChain(receiverChain, callbackBindings, fullDocText);
            const receiverType = normalizeType(inferred.typeName);

            if (receiverType === 'environment') {
              completions = buildEnvCompletions();
            } else if (receiverType === 'req') {
              completions = buildReqCompletions();
            } else if (receiverType === 'res') {
              completions = buildResCompletions();
            } else if (receiverType === 'Math') {
              completions = buildMathCompletions();
            } else if (receiverType === 'JSON') {
              completions = buildJsonCompletions();
            } else if (receiverType === 'Object') {
              completions = buildObjectConstructorCompletions();
            } else if (receiverType === 'Array') {
              completions = buildArrayConstructorCompletions();
            } else if (receiverType === 'console') {
              completions = buildConsoleCompletions();
            } else if (receiverType === 'assert') {
              completions = buildAssertCompletions();
            } else if (receiverType === 'expect') {
              completions = buildExpectCompletions();
            } else if (receiverType === TYPE_OBJECT) {
              completions = buildObjectFieldCompletions(inferred.schemaPart);
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
              // unknown / any (e.g. blabla.)
              completions = buildAnyFallbackCompletions(receiverChain, fullDocText);
            }
          } else {
            // Top-level identifiers
            completions = buildTopLevelCompletions(callbackBindings);
          }

          // Deduplicate completions
          const seen = new Set();
          const uniqueCompletions = [];
          for (let cIdx = 0; cIdx < completions.length; cIdx++) {
            const c = completions[cIdx];
            if (c && typeof c.text === 'string' && !seen.has(c.text)) {
              seen.add(c.text);
              uniqueCompletions.push({
                text: c.text,
                displayText: c.displayText || c.text,
                className: c.className
              });
            }
          }

          if (uniqueCompletions.length === 0) return null;

          // Replace only the current identifier being typed (not the dot)
          let wordStart = pos;
          while (wordStart > 0 && /[a-zA-Z0-9_\\$]/.test(line[wordStart - 1])) {
            wordStart--;
          }
          const fromPos = endsWithDot ? pos : wordStart;
          const prefix = endsWithDot ? '' : line.slice(wordStart, pos);

          let filtered = uniqueCompletions;
          if (prefix) {
            filtered = uniqueCompletions.filter(function(c) {
              return typeof c.text === 'string' && c.text.toLowerCase().startsWith(prefix.toLowerCase());
            });
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

      // Enable autocomplete with Ctrl+Space and Cmd+Space
      editor.setOption('extraKeys', {
        ...editor.getOption('extraKeys'),
        'Ctrl-Space': function(cm) {
          if (typeof cm.showHint === 'function') cm.showHint({ completeSingle: false });
          else if (CodeMirror.commands && typeof CodeMirror.commands.autocomplete === 'function') CodeMirror.commands.autocomplete(cm);
        },
        'Cmd-Space': function(cm) {
          if (typeof cm.showHint === 'function') cm.showHint({ completeSingle: false });
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

    let activeEditorMode = 'query'; // 'query' | 'tests'
    let queryCode = '';
    const DEFAULT_TEST_SUITE = [
      "// Test Suite for JSON Data",
      "// Available Globals: test, it, expect, assert, data, result, raw",
      "// Run tests: Ctrl+Enter or Ctrl+Shift+T",
      "",
      "test('validates data exists and is defined', () => {",
      "  expect(data).toBeDefined();",
      "});",
      "",
      "test('validates data structure', () => {",
      "  if (Array.isArray(data)) {",
      "    expect(data.length).toBeGreaterThan(0);",
      "  } else {",
      "    expect(typeof data).toBe('object');",
      "  }",
      "});",
      ""
    ].join(String.fromCharCode(10));
    let testCode = localStorage.getItem('jsonQueryTools.testSuiteCode') || DEFAULT_TEST_SUITE;

    const getEditorValue = () => editor ? editor.getValue().trim() : (exprTextarea ? exprTextarea.value.trim() : '');
    const getRawEditorValue = () => editor ? editor.getValue() : (exprTextarea ? exprTextarea.value : '');
    const setEditorValue = (value) => {
      if (editor) {
        editor.setValue(value || '');
        editor.focus();
      } else if (exprTextarea) {
        exprTextarea.value = value || '';
        exprTextarea.focus();
      }
    };

    function updateTestCountBadge(code) {
      if (!testsCountBadge) return;
      const content = typeof code === 'string' ? code : (activeEditorMode === 'tests' ? getRawEditorValue() : testCode);
      const matches = content.match(new RegExp('(?:test|it)\\\\s*\\\\(', 'g'));
      const count = matches ? matches.length : 0;
      if (count > 0) {
        testsCountBadge.textContent = count + (count === 1 ? ' test' : ' tests');
        testsCountBadge.style.display = 'inline-block';
      } else {
        testsCountBadge.style.display = 'none';
      }
    }

    function switchEditorMode(newMode) {
      if (newMode === activeEditorMode) return;
      clearSyntaxError();

      // 1. Save state of the mode we are leaving
      if (activeEditorMode === 'query') {
        queryCode = getRawEditorValue();
      } else if (activeEditorMode === 'tests') {
        testCode = getRawEditorValue();
        localStorage.setItem('jsonQueryTools.testSuiteCode', testCode);
        updateTestCountBadge(testCode);
      } else if (activeEditorMode === 'pipeline') {
        if (pipelineSteps[activeStepIndex]) {
          pipelineSteps[activeStepIndex].expr = getRawEditorValue();
        }
        savePipelineToStorage();
      }

      // 2. Set new mode
      activeEditorMode = newMode;

      // 3. Update Mode Buttons
      if (modeQueryBtn) modeQueryBtn.classList.toggle('active', newMode === 'query');
      if (modePipelineBtn) modePipelineBtn.classList.toggle('active', newMode === 'pipeline');
      if (modeTestsBtn) modeTestsBtn.classList.toggle('active', newMode === 'tests');

      // 4. Update Toolbars & Pipeline Ribbons
      if (queryToolbar) queryToolbar.style.display = newMode === 'query' ? 'flex' : 'none';
      if (pipelineToolbar) pipelineToolbar.style.display = newMode === 'pipeline' ? 'flex' : 'none';
      if (testsToolbar) testsToolbar.style.display = newMode === 'tests' ? 'flex' : 'none';

      if (pipelineStageRibbon) pipelineStageRibbon.style.display = newMode === 'pipeline' ? 'flex' : 'none';
      if (pipelineStepConfigBar) pipelineStepConfigBar.style.display = newMode === 'pipeline' ? 'flex' : 'none';

      // 5. Reposition Live Poll Container
      const lp = document.getElementById('livePollContainer');
      if (lp) {
        if (newMode === 'query' && queryToolbar) {
          const importQBtn = document.getElementById('importQuery');
          if (importQBtn) queryToolbar.insertBefore(lp, importQBtn);
        } else if (newMode === 'pipeline' && pipelineToolbar) {
          const exportPQBtn = document.getElementById('exportPipelineToQueryBtn');
          if (exportPQBtn) pipelineToolbar.insertBefore(lp, exportPQBtn);
        } else if (newMode === 'tests' && testsToolbar) {
          const importTestBtn = document.getElementById('importTestFileBtn');
          if (importTestBtn) testsToolbar.insertBefore(lp, importTestBtn);
        }
      }
      scheduleLivePollUpdate();

      // 6. Set editor content and hints for the new mode
      if (newMode === 'pipeline') {
        renderPipelineRibbon();
        updateActiveStepConfigUI();
        updatePipelinePreviewOptions();
        const curStep = pipelineSteps[activeStepIndex] || { expr: '' };
        setEditorValue(curStep.expr || '');
        if (editor && editor.clearHistory) editor.clearHistory();
        if (exprTextarea) exprTextarea.placeholder = 'input.map(x => ... ) // or prev / data';
        if (editorKeyboardHint) {
          editorKeyboardHint.innerHTML = 'Press <kbd>Ctrl+Enter</kbd> to run pipeline | <kbd>Ctrl+S</kbd> to save | Click stage pills above to inspect/edit';
        }
      } else if (newMode === 'tests') {
        setEditorValue(testCode);
        if (editor && editor.clearHistory) editor.clearHistory();
        if (exprTextarea) exprTextarea.placeholder = "test('validates data', () => { expect(data).toBeDefined(); });";
        if (editorKeyboardHint) {
          editorKeyboardHint.innerHTML = 'Press <kbd>Ctrl+Enter</kbd> to run tests | <kbd>Ctrl+Shift+E</kbd> to switch mode | <kbd>Ctrl+S</kbd> to save tests';
        }
        updateTestCountBadge(testCode);
      } else {
        // 'query'
        setEditorValue(queryCode);
        if (editor && editor.clearHistory) editor.clearHistory();
        if (exprTextarea) exprTextarea.placeholder = ".filter(x=>x.active).map(x=>({name:x.name})) — Template vars: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}";
        if (editorKeyboardHint) {
          editorKeyboardHint.innerHTML = 'Press <kbd>Ctrl+Enter</kbd> to run | <kbd>Ctrl+Shift+E</kbd> to switch mode | <kbd>Ctrl+S</kbd> to save';
        }
      }

      if (editor) {
        editor.refresh();
        editor.focus();
      }
    }

    function toggleEditorMode() {
      if (activeEditorMode === 'query') {
        switchEditorMode('pipeline');
      } else if (activeEditorMode === 'pipeline') {
        switchEditorMode('tests');
      } else {
        switchEditorMode('query');
      }
    }

    function saveTestSuite() {
      testCode = getRawEditorValue();
      localStorage.setItem('jsonQueryTools.testSuiteCode', testCode);
      updateTestCountBadge(testCode);
      if (saveTestsBtn) {
        const orig = saveTestsBtn.textContent;
        saveTestsBtn.textContent = '✓ Saved';
        setTimeout(() => {
          saveTestsBtn.textContent = orig;
        }, 1500);
      }
    }

    function setLoading(isLoading) {
      const runBtn = document.getElementById('run');
      const runBtnMode = document.getElementById('runTestsModeBtn');
      if (isLoading) {
        if (runBtn) { runBtn.classList.add('loading'); runBtn.disabled = true; }
        if (runBtnMode) { runBtnMode.classList.add('loading'); runBtnMode.disabled = true; }
        if (runTestsBtn) { runTestsBtn.disabled = true; }
      } else {
        if (runBtn) { runBtn.classList.remove('loading'); runBtn.disabled = false; }
        if (runBtnMode) { runBtnMode.classList.remove('loading'); runBtnMode.disabled = false; }
        if (runTestsBtn) { runTestsBtn.disabled = false; }
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
        if (benchmarkMeter) benchmarkMeter.style.display = 'none';
        if (resultInfo) resultInfo.textContent = '';
        lastBenchmark = null;
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
          if (benchmarkMeter) benchmarkMeter.style.display = 'none';
          if (resultInfo) resultInfo.textContent = '';
          lastBenchmark = null;
          return;
        }
      }
      
      clearConsoleOutput();
      setLoading(true);
      resultPre.textContent = 'Running...';
      resultPre.className = '';
      if (benchmarkMeter) benchmarkMeter.style.display = 'none';
      if (resultInfo) resultInfo.textContent = '';
      lastBenchmark = null;
      vscode.postMessage({ type: 'run', expr, save: true });
    }

    function runTests() {
      const expr = getEditorValue();
      if (!expr) {
        resultPre.textContent = 'Error: Expression is empty';
        resultPre.className = 'error';
        if (benchmarkMeter) benchmarkMeter.style.display = 'none';
        if (resultInfo) resultInfo.textContent = '';
        lastBenchmark = null;
        return;
      }
      
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
          if (benchmarkMeter) benchmarkMeter.style.display = 'none';
          if (resultInfo) resultInfo.textContent = '';
          lastBenchmark = null;
          return;
        }
      }
      
      clearConsoleOutput();
      setLoading(true);
      resultPre.textContent = 'Running tests...';
      resultPre.className = '';
      if (benchmarkMeter) benchmarkMeter.style.display = 'none';
      if (resultInfo) resultInfo.textContent = '';
      lastBenchmark = null;

      const testTarget = (activeEditorMode === 'tests' && testTargetSelect) ? testTargetSelect.value : 'source';
      const queryExpr = activeEditorMode === 'tests' ? queryCode : '';
      vscode.postMessage({ type: 'runTests', expr, target: testTarget, queryExpr, save: true, isTestMode: true });
    }

    function saveExpression() {
      if (activeEditorMode === 'tests') {
        saveTestSuite();
        return;
      }
      if (activeEditorMode === 'pipeline') {
        savePipeline();
        return;
      }
      const expr = getEditorValue();
      if (!expr) {
        return;
      }
      vscode.postMessage({ type: 'save', expr });
      // Visual feedback
      const saveBtn = document.getElementById('save');
      if (saveBtn) {
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => {
          saveBtn.textContent = originalText;
        }, 1500);
      }
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
        
        const targetBtn = activeEditorMode === 'tests' ? beautifyTestsBtn : document.getElementById('beautify');
        if (targetBtn) {
          const originalText = targetBtn.textContent;
          targetBtn.textContent = '✓ Beautified';
          setTimeout(() => {
            targetBtn.textContent = originalText;
          }, 1500);
        }
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
        const alias = target.getAttribute('data-alias') || span?.getAttribute('data-alias');
        const id = target.getAttribute('data-id') || span?.getAttribute('data-id');
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
      } else if (target.classList && target.classList.contains('toggle-stream-btn')) {
        const id = target.getAttribute('data-id');
        const mode = target.getAttribute('data-mode');
        const isStreaming = target.classList.contains('active-stream');
        if (mode === 'sse') {
          if (isStreaming) {
            vscode.postMessage({ type: 'stopSseStream', sourceId: id });
          } else {
            vscode.postMessage({ type: 'startSseStream', sourceId: id, autoRun: true });
          }
        } else if (mode === 'ws') {
          if (isStreaming) {
            vscode.postMessage({ type: 'stopWsStream', sourceId: id });
          } else {
            vscode.postMessage({ type: 'startWsStream', sourceId: id, autoRun: true });
          }
        }
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

    if (modeQueryBtn) {
      modeQueryBtn.onclick = () => switchEditorMode('query');
    }
    if (modePipelineBtn) {
      modePipelineBtn.onclick = () => switchEditorMode('pipeline');
    }
    if (modeTestsBtn) {
      modeTestsBtn.onclick = () => switchEditorMode('tests');
    }
    if (addPipelineStepBtn) {
      addPipelineStepBtn.onclick = () => addPipelineStep();
    }
    if (removeStepBtn) {
      removeStepBtn.onclick = () => removeCurrentPipelineStep();
    }
    if (moveStepUpBtn) {
      moveStepUpBtn.onclick = () => moveCurrentStep(-1);
    }
    if (moveStepDownBtn) {
      moveStepDownBtn.onclick = () => moveCurrentStep(1);
    }
    if (duplicateStepBtn) {
      duplicateStepBtn.onclick = () => duplicateCurrentStep();
    }
    if (runPipelineBtn) {
      runPipelineBtn.onclick = () => runPipeline();
    }
    if (savePipelineBtn) {
      savePipelineBtn.onclick = () => savePipeline();
    }
    if (beautifyPipelineBtn) {
      beautifyPipelineBtn.onclick = () => beautifyExpression();
    }
    if (exportPipelineToQueryBtn) {
      exportPipelineToQueryBtn.onclick = () => {
        if (pipelineSteps[activeStepIndex]) {
          pipelineSteps[activeStepIndex].expr = getRawEditorValue();
        }
        savePipelineToStorage();
        vscode.postMessage({ type: 'exportPipelineQuery', steps: pipelineSteps });
      };
    }
    if (exportPipelineJsonBtn) {
      exportPipelineJsonBtn.onclick = () => {
        if (pipelineSteps[activeStepIndex]) {
          pipelineSteps[activeStepIndex].expr = getRawEditorValue();
        }
        savePipelineToStorage();
        vscode.postMessage({ type: 'exportPipelineJson', steps: pipelineSteps });
      };
    }
    if (importPipelineJsonBtn) {
      importPipelineJsonBtn.onclick = () => {
        vscode.postMessage({ type: 'importPipelineJson' });
      };
    }
    if (pipelinePreviewSelect) {
      pipelinePreviewSelect.onchange = () => {
        const val = pipelinePreviewSelect.value;
        showStepPreview(val === 'final' ? null : val);
        if (isLivePollingActive) {
          scheduleLivePollUpdate();
        }
      };
    }
    if (stepNameInput) {
      stepNameInput.oninput = () => {
        const step = pipelineSteps[activeStepIndex];
        if (step) {
          step.name = stepNameInput.value.trim() || ('Step ' + (activeStepIndex + 1));
          savePipelineToStorage();
          renderPipelineRibbon();
          updatePipelinePreviewOptions();
        }
      };
    }
    if (stepAliasInput) {
      stepAliasInput.oninput = () => {
        const step = pipelineSteps[activeStepIndex];
        if (step) {
          const clean = stepAliasInput.value.trim().replace(/[^a-zA-Z0-9_$]/g, '');
          step.alias = clean || undefined;
          savePipelineToStorage();
          renderPipelineRibbon();
          updatePipelinePreviewOptions();
        }
      };
    }
    if (stepEnabledCheckbox) {
      stepEnabledCheckbox.onchange = () => {
        const step = pipelineSteps[activeStepIndex];
        if (step) {
          step.enabled = stepEnabledCheckbox.checked;
          savePipelineToStorage();
          renderPipelineRibbon();
          updatePipelinePreviewOptions();
          if (isLivePollingActive) {
            scheduleLivePollUpdate();
          }
        }
      };
    }
    if (runTestsModeBtn) {
      runTestsModeBtn.onclick = runTests;
    }
    if (saveTestsBtn) {
      saveTestsBtn.onclick = saveTestSuite;
    }
    if (beautifyTestsBtn) {
      beautifyTestsBtn.onclick = () => beautifyExpression();
    }
    if (clearTestsBtn) {
      clearTestsBtn.onclick = () => {
        setEditorValue('');
        testCode = '';
        localStorage.removeItem('jsonQueryTools.testSuiteCode');
        updateTestCountBadge('');
        if (editor) editor.focus();
      };
    }
    if (importTestFileBtn) {
      importTestFileBtn.onclick = () => {
        vscode.postMessage({ type: 'importTestSuite' });
      };
    }
    if (exportTestFileBtn) {
      exportTestFileBtn.onclick = () => {
        vscode.postMessage({ type: 'exportTestSuite', expr: getRawEditorValue() });
      };
    }
    if (testTargetSelect) {
      updateTestTargetSelectOptions();
      if (typeof testTargetSelect.addEventListener === 'function') {
        testTargetSelect.addEventListener('change', () => {
          if (window.localStorage && localStorage.setItem) {
            localStorage.setItem('jsonQueryTools.testTarget', testTargetSelect.value);
          }
          scheduleLivePollUpdate();
        });
      }
    }

    function getLivePollPayload(intervalMs) {
      if (activeEditorMode === 'pipeline') {
        if (pipelineSteps[activeStepIndex]) {
          pipelineSteps[activeStepIndex].expr = getRawEditorValue();
        }
        savePipelineToStorage();
        return {
          type: 'startLivePoll',
          intervalMs: intervalMs,
          isPipeline: true,
          steps: pipelineSteps,
          previewStepId: previewStepId
        };
      }
      return {
        type: 'startLivePoll',
        intervalMs: intervalMs,
        expr: getRawEditorValue(),
        isTestMode: activeEditorMode === 'tests',
        target: testTargetSelect ? testTargetSelect.value : 'source',
        queryExpr: (activeEditorMode === 'tests' && testTargetSelect && testTargetSelect.value === 'query') ? (localStorage.getItem('jsonQueryTools.queryExpr') || '') : undefined
      };
    }

    if (livePollToggleBtn && typeof livePollToggleBtn.addEventListener === 'function') {
      livePollToggleBtn.addEventListener('click', () => {
        if (isLivePollingActive) {
          vscode.postMessage({ type: 'stopLivePoll' });
        } else {
          const intervalMs = parseInt(livePollIntervalSelect ? livePollIntervalSelect.value : '5000', 10) || 5000;
          vscode.postMessage(getLivePollPayload(intervalMs));
        }
      });
    }

    if (livePollIntervalSelect && typeof livePollIntervalSelect.addEventListener === 'function') {
      try {
        const savedInterval = localStorage.getItem('jsonQueryTools.pollInterval');
        if (savedInterval) {
          livePollIntervalSelect.value = savedInterval;
        }
      } catch (e) {}

      livePollIntervalSelect.addEventListener('change', () => {
        try {
          localStorage.setItem('jsonQueryTools.pollInterval', livePollIntervalSelect.value);
        } catch (e) {}
        if (isLivePollingActive) {
          const intervalMs = parseInt(livePollIntervalSelect.value, 10) || 5000;
          vscode.postMessage(getLivePollPayload(intervalMs));
        }
      });
    }

    const TEST_SNIPPETS = {
      contract_full: [
        "// Comprehensive API Contract Suite",
        "test('status is ok and data exists', () => {",
        "  expect(data).toBeDefined();",
        "  expect(data).not.toBeNull();",
        "});",
        "",
        "test('data contains expected fields', () => {",
        "  if (Array.isArray(data)) {",
        "    expect(data.length).toBeGreaterThan(0);",
        "    expect(data[0]).toHaveProperty('id');",
        "  } else {",
        "    expect(typeof data).toBe('object');",
        "  }",
        "});"
      ].join(String.fromCharCode(10)),
      schema_validation: [
        "// Schema & Types Validation",
        "test('validates types of core fields', () => {",
        "  const item = Array.isArray(data) ? data[0] : data;",
        "  expect(typeof item).toBe('object');",
        "  expect(item).toHaveProperty('id');",
        "  expect(typeof item.id).toMatch(/^(string|number)$/);",
        "});"
      ].join(String.fromCharCode(10)),
      status_codes: [
        "// Status & Timestamp Validation",
        "test('response status and timestamps', () => {",
        "  if (data.status) {",
        "    expect(data.status).toMatch(/^(success|ok|200)$/i);",
        "  }",
        "  if (data.timestamp || data.createdAt) {",
        "    const ts = new Date(data.timestamp || data.createdAt).getTime();",
        "    expect(Number.isNaN(ts)).toBe(false);",
        "  }",
        "});"
      ].join(String.fromCharCode(10)),
      array_items_deep: [
        "// Array Elements & Sub-properties",
        "test('every item in array satisfies schema constraints', () => {",
        "  const items = Array.isArray(data) ? data : (data.items || data.results || []);",
        "  expect(items.length).toBeGreaterThan(0);",
        "  items.forEach((item, index) => {",
        "    expect(item).toBeDefined();",
        "    expect(typeof item).toBe('object');",
        "  });",
        "});"
      ].join(String.fromCharCode(10)),
      node_assert: [
        "// Node.js Assert Interface",
        "test('Node assert contract verification', () => {",
        "  assert.ok(data, 'data must be truthy');",
        "  if (Array.isArray(data)) {",
        "    assert.ok(data.length > 0, 'array must not be empty');",
        "  } else {",
        "    assert.strictEqual(typeof data, 'object', 'data must be an object');",
        "  }",
        "});"
      ].join(String.fromCharCode(10)),
      multi_source_contract: [
        "// Cross-Source Contract (when multiple files or endpoints are bound)",
        "// Each bound source is accessible directly by its alias identifier (e.g. users, orders).",
        "// 'data' and 'raw' provide the composite dictionary of all sources.",
        "test('all bound sources are accessible by alias', () => {",
        "  expect(data).toBeDefined();",
        "  expect(raw).toBeDefined();",
        "});",
        "test('cross-source relational integrity', () => {",
        "  // Example: expect(users).toBeArray();",
        "  // Example: expect(orders).toBeArray();",
        "});"
      ].join(String.fromCharCode(10)),
      query_result_contract: [
        "// Validate Query Result (Target: Query Result)",
        "// 'data' points to the transformed query result.",
        "// 'raw' holds the original un-queried input.",
        "test('query output contains transformed items', () => {",
        "  expect(data).toBeDefined();",
        "  if (Array.isArray(data)) {",
        "    expect(data.length).toBeGreaterThan(0);",
        "  }",
        "  expect(raw).toBeDefined();",
        "});"
      ].join(String.fromCharCode(10))
    };

    if (testSnippetSelect) {
      testSnippetSelect.addEventListener('change', () => {
        const val = testSnippetSelect.value;
        if (!val) return;
        const code = TEST_SNIPPETS[val];
        if (code) {
          insertSnippetCode(code);
          updateTestCountBadge();
        }
        testSnippetSelect.value = '';
      });
    }

    if (runTestsBtn) {
      runTestsBtn.onclick = runTests;
    }
    if (rerunTestsBtn) {
      rerunTestsBtn.onclick = runTests;
    }
    if (testSuiteBadge) {
      testSuiteBadge.onclick = () => {
        if (resultFormat) {
          resultFormat.value = 'tests';
          updateResultDisplay('', currentResultData);
        }
      };
    }
    if (testFilterAll) testFilterAll.onclick = () => setTestFilter('all');
    if (testFilterPassed) testFilterPassed.onclick = () => setTestFilter('passed');
    if (testFilterFailed) testFilterFailed.onclick = () => setTestFilter('failed');
    if (testSearchInput) {
      testSearchInput.oninput = (e) => {
        testSearchQuery = (e.target.value || '').toLowerCase().trim();
        renderTestCards();
      };
    }
    if (copyTestReportBtn) {
      copyTestReportBtn.onclick = () => {
        if (!currentTestSuite) return;
        const s = currentTestSuite;
        const status = s.failed === 0 ? 'PASSED' : 'FAILED';
        const lines = [
          '# Test Suite Results (' + status + ')',
          '',
          '- **Total:** ' + s.total,
          '- **Passed:** ' + s.passed,
          '- **Failed:** ' + s.failed,
          '- **Duration:** ' + s.durationMs.toFixed(1) + 'ms',
          '',
          '## Test Cases'
        ];
        for (const t of s.tests) {
          const icon = (t.status === 'passed' || t.status === 'pass') ? '[x]' : '[ ]';
          lines.push('- ' + icon + ' **' + t.name + '** (' + t.durationMs.toFixed(1) + 'ms)');
          if (t.error) {
            lines.push('  - *Error:* ' + t.error.message);
            if (t.error.expected !== undefined) {
              lines.push('  - *Expected:* ' + JSON.stringify(t.error.expected));
            }
            if (t.error.actual !== undefined) {
              lines.push('  - *Actual:* ' + JSON.stringify(t.error.actual));
            }
          }
        }
        vscode.postMessage({ type: 'copyToClipboard', text: lines.join(String.fromCharCode(10)) });
      };
    }

    // Snippet Library & Cheatsheet System
    function insertSnippetCode(code) {
      if (!code) return;
      if (editor) {
        const val = editor.getValue();
        if (!val.trim()) {
          editor.setValue(code);
        } else {
          editor.replaceSelection(code);
        }
        editor.focus();
      } else if (exprTextarea) {
        const start = exprTextarea.selectionStart;
        const end = exprTextarea.selectionEnd;
        const val = exprTextarea.value;
        if (!val.trim()) {
          exprTextarea.value = code;
        } else {
          exprTextarea.value = val.substring(0, start) + code + val.substring(end);
        }
        exprTextarea.focus();
      }
    }

    const SNIPPET_LIBRARY = [
      {
        id: 'anonymize_pii',
        title: 'Anonymize & Mask Sensitive Data (PII)',
        category: 'privacy',
        categoryLabel: 'Privacy & Security',
        description: 'Sanitize emails, credentials, tokens, phone numbers, and cards with format-preserving masking',
        code: [
          '// Anonymize sensitive fields with format-preserving masking',
          'anonymize(data, { strategy: "mask" })'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'test_contract',
        title: 'API Contract Test Suite (test & expect)',
        category: 'testing',
        categoryLabel: 'Tests & Assertions',
        description: 'Complete API contract test suite validating structure, data types, and properties',
        code: [
          'test("Response is defined and valid", () => {',
          '  expect(data).toBeDefined();',
          '  expect(data).not.toBeNull();',
          '});',
          '',
          'test("Root object has expected fields", () => {',
          '  if (Array.isArray(data)) {',
          '    expect(data.length).toBeGreaterThan(0);',
          '  } else {',
          '    expect(data).toBeObject();',
          '  }',
          '});'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'test_status_schema',
        title: 'Status & Property Validation',
        category: 'testing',
        categoryLabel: 'Tests & Assertions',
        description: 'Validate HTTP status, headers, and top-level response schema using expect()',
        code: [
          'test("Status code and payload schema", () => {',
          '  expect(data).toHaveProperty("id");',
          '  expect(data.id).toBeNumber();',
          '});'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'test_array_items',
        title: 'Array Items Deep Assertions',
        category: 'testing',
        categoryLabel: 'Tests & Assertions',
        description: 'Validate each item in an array conforms to contract requirements',
        code: [
          'test("Validate array collection contract", () => {',
          '  expect(data).toBeArray();',
          '  expect(data.length).toBeGreaterThan(0);',
          '  for (const item of data) {',
          '    expect(item).toHaveProperty("id");',
          '    expect(item.id).toBeNumber();',
          '  }',
          '});'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'group_by',
        title: 'Group by Property (Object.groupBy)',
        category: 'grouping',
        categoryLabel: 'Grouping',
        description: 'Group array items by a property key using native Object.groupBy (returns dictionary of arrays)',
        code: 'Object.groupBy(data, item => item.category)'
      },
      {
        id: 'group_by_reduce',
        title: 'Group by Property (reduce)',
        category: 'grouping',
        categoryLabel: 'Grouping',
        description: 'Classic reduce pattern to group objects by category into a dictionary',
        code: [
          'data.reduce((acc, item) => {',
          '  const key = item.category || "other";',
          '  (acc[key] = acc[key] || []).push(item);',
          '  return acc;',
          '}, {})'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'group_count',
        title: 'Group and Count Occurrences',
        category: 'grouping',
        categoryLabel: 'Grouping',
        description: 'Count items per category, returning an array of { category, count } objects',
        code: [
          'Object.entries(Object.groupBy(data, item => item.status))',
          '  .map(([status, items]) => ({ status, count: items.length }))'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'sum',
        title: 'Sum Property',
        category: 'aggregation',
        categoryLabel: 'Aggregation',
        description: 'Calculate the total sum of a numeric property across all items',
        code: 'data.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)'
      },
      {
        id: 'average',
        title: 'Average / Mean Property',
        category: 'aggregation',
        categoryLabel: 'Aggregation',
        description: 'Compute the arithmetic mean of a numeric field',
        code: 'data.length ? data.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / data.length : 0'
      },
      {
        id: 'min_max',
        title: 'Min & Max Values',
        category: 'aggregation',
        categoryLabel: 'Aggregation',
        description: 'Extract minimum and maximum values of a property in a single pass',
        code: [
          'data.reduce((acc, item) => ({',
          '  min: Math.min(acc.min, Number(item.price) || 0),',
          '  max: Math.max(acc.max, Number(item.price) || 0)',
          '}), { min: Infinity, max: -Infinity })'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'stats_summary',
        title: 'Stats Summary (Count, Sum, Avg, Min, Max)',
        category: 'aggregation',
        categoryLabel: 'Aggregation',
        description: 'Compute full descriptive statistics for a numeric field',
        code: [
          '(() => {',
          '  const vals = data.map(x => Number(x.value) || 0);',
          '  const sum = vals.reduce((a, b) => a + b, 0);',
          '  return {',
          '    count: vals.length,',
          '    sum,',
          '    avg: vals.length ? sum / vals.length : 0,',
          '    min: vals.length ? Math.min(...vals) : 0,',
          '    max: vals.length ? Math.max(...vals) : 0',
          '  };',
          '})()'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'flatten_flatmap',
        title: 'Flatten Nested Arrays (flatMap)',
        category: 'flatten',
        categoryLabel: 'Flatten',
        description: 'Extract and flatten a child array property from each item (e.g. order items)',
        code: 'data.flatMap(item => item.items || [])'
      },
      {
        id: 'flatten_deep',
        title: 'Flatten Deeply Nested Array',
        category: 'flatten',
        categoryLabel: 'Flatten',
        description: 'Recursively flatten arbitrarily deep nested arrays using flat(Infinity)',
        code: 'data.flat(Infinity)'
      },
      {
        id: 'unwind_tags',
        title: 'Unwind / Explode Array Property',
        category: 'flatten',
        categoryLabel: 'Flatten',
        description: 'Duplicate parent object for each element in an array property (like MongoDB $unwind)',
        code: 'data.flatMap(item => (item.tags || []).map(tag => ({ ...item, tag })))'
      },
      {
        id: 'filter_date',
        title: 'Filter by Date Range',
        category: 'filtering',
        categoryLabel: 'Filtering',
        description: 'Filter items where date property falls within start and end timestamps',
        code: [
          'data.filter(item => {',
          '  const d = new Date(item.createdAt || item.date);',
          '  return d >= new Date("2026-01-01") && d <= new Date("2026-12-31");',
          '})'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'filter_recent',
        title: 'Filter Recent (Last 7 Days)',
        category: 'filtering',
        categoryLabel: 'Filtering',
        description: 'Filter items created within the past 7 days relative to now',
        code: [
          'const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);',
          'data.filter(item => new Date(item.timestamp || item.date) >= cutoff)'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'top_n',
        title: 'Top 10 Items by Property',
        category: 'filtering',
        categoryLabel: 'Filtering',
        description: 'Sort descending and take top 10 items without mutating the original array',
        code: 'data.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10)'
      },
      {
        id: 'pick_keys',
        title: 'Pick Specific Keys',
        category: 'shaping',
        categoryLabel: 'Pick / Omit',
        description: 'Keep only desired properties on each object using object destructuring',
        code: 'data.map(({ id, name, email }) => ({ id, name, email }))'
      },
      {
        id: 'omit_keys',
        title: 'Omit Sensitive Keys',
        category: 'shaping',
        categoryLabel: 'Pick / Omit',
        description: 'Exclude unwanted keys (passwords, secrets) using rest parameter syntax',
        code: 'data.map(({ password, secret, token, ...rest }) => rest)'
      },
      {
        id: 'rename_keys',
        title: 'Rename Object Keys',
        category: 'shaping',
        categoryLabel: 'Pick / Omit',
        description: 'Transform each item into an object with renamed property keys',
        code: 'data.map(item => ({ id: item.user_id, name: item.full_name }))'
      },
      {
        id: 'unique_by_id',
        title: 'Deduplicate by Key / ID',
        category: 'dedup',
        categoryLabel: 'Unique',
        description: 'Remove duplicates by retaining the unique occurrence of each ID using Map',
        code: 'Array.from(new Map(data.map(item => [item.id, item])).values())'
      },
      {
        id: 'unique_primitives',
        title: 'Unique Primitive Values',
        category: 'dedup',
        categoryLabel: 'Unique',
        description: 'Extract unique non-duplicate values from an array or property using Set',
        code: '[...new Set(data.map(item => item.category))]'
      },
      {
        id: 'entries_to_obj',
        title: 'Key-Value Array to Object',
        category: 'multisource',
        categoryLabel: 'Objects',
        description: 'Convert an array of items into an object dictionary keyed by ID',
        code: 'Object.fromEntries(data.map(item => [item.id, item]))'
      },
      {
        id: 'obj_to_entries',
        title: 'Object Dictionary to Array',
        category: 'multisource',
        categoryLabel: 'Objects',
        description: 'Convert a dictionary/map object into an array of entries with keys preserved',
        code: 'Object.entries(data).map(([key, value]) => ({ key, ...value }))'
      },
      {
        id: 'multi_join',
        title: 'Join Two Sources (users + orders)',
        category: 'multisource',
        categoryLabel: 'Multi-Source',
        description: 'Relational join between two bound data sources (e.g. users and orders)',
        code: [
          '(users, orders) => users.map(u => ({',
          '  ...u,',
          '  orders: orders.filter(o => o.userId === u.id)',
          '}))'
        ].join(String.fromCharCode(10))
      },
      {
        id: 'env_base_url',
        title: 'Use Environment ({{env.baseURL}} / env.baseURL)',
        category: 'environment',
        categoryLabel: 'Environment',
        description: 'Reference active environment base URL, name, or custom variables via env or {{env.baseURL}}',
        code: [
          '// Access active environment via env runtime object or {{env.baseURL}} template syntax',
          '({',
          '  activeEnvironment: env.name,',
          '  fullEndpoint: env.baseURL + "/api/v1/data"',
          '  templateSyntax: "{{env.baseURL}}/api/v1/data"',
          '})'
        ].join(String.fromCharCode(10))
      }
    ];

    const snippetSelect = document.getElementById('snippetSelect');
    const openCheatsheetBtn = document.getElementById('openCheatsheetBtn');
    const cheatsheetModal = document.getElementById('cheatsheetModal');
    const closeCheatsheetModalBtn = document.getElementById('closeCheatsheetModal');
    const dismissCheatsheetBtn = document.getElementById('dismissCheatsheetBtn');
    const cheatsheetSearch = document.getElementById('cheatsheetSearch');
    const cheatsheetCategories = document.getElementById('cheatsheetCategories');
    const cheatsheetList = document.getElementById('cheatsheetList');
    const cheatsheetEmpty = document.getElementById('cheatsheetEmpty');

    let activeCheatsheetCategory = 'all';
    let cheatsheetSearchText = '';

    function renderCheatsheetItems() {
      if (!cheatsheetList) return;
      cheatsheetList.innerHTML = '';

      const query = (cheatsheetSearchText || '').trim().toLowerCase();
      const filtered = SNIPPET_LIBRARY.filter(item => {
        const matchesCategory = activeCheatsheetCategory === 'all' || item.category === activeCheatsheetCategory;
        if (!matchesCategory) return false;
        if (!query) return true;
        return item.title.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.categoryLabel.toLowerCase().includes(query) ||
          item.code.toLowerCase().includes(query);
      });

      if (filtered.length === 0) {
        if (cheatsheetEmpty) cheatsheetEmpty.style.display = 'block';
        return;
      }
      if (cheatsheetEmpty) cheatsheetEmpty.style.display = 'none';

      for (const item of filtered) {
        const card = document.createElement('div');
        card.style.cssText = 'background: var(--vscode-textCodeBlock-background, #252526); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const titleEl = document.createElement('strong');
        titleEl.style.cssText = 'font-size: 12px; color: var(--vscode-foreground, #fff);';
        titleEl.textContent = item.title;

        const catBadge = document.createElement('span');
        catBadge.className = 'tab-badge';
        catBadge.style.cssText = 'font-size: 9px; padding: 1px 6px;';
        catBadge.textContent = item.categoryLabel;

        titleDiv.appendChild(titleEl);
        titleDiv.appendChild(catBadge);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.cssText = 'display: flex; gap: 6px;';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'secondary';
        copyBtn.style.cssText = 'padding: 2px 8px; font-size: 11px;';
        copyBtn.textContent = String.fromCodePoint(0x1F4CB) + ' Copy';
        copyBtn.onclick = () => {
          vscode.postMessage({ type: 'copyToClipboard', text: item.code });
          const orig = copyBtn.textContent;
          copyBtn.textContent = '\u2713 Copied!';
          setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        };

        const insertBtn = document.createElement('button');
        insertBtn.className = 'primary';
        insertBtn.style.cssText = 'padding: 2px 8px; font-size: 11px;';
        insertBtn.textContent = '📥 Insert';
        insertBtn.onclick = () => {
          insertSnippetCode(item.code);
          closeCheatsheetModal();
        };

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(insertBtn);

        topRow.appendChild(titleDiv);
        topRow.appendChild(actionsDiv);

        const desc = document.createElement('div');
        desc.style.cssText = 'font-size: 11px; color: var(--vscode-descriptionForeground, #858585); line-height: 1.3;';
        desc.textContent = item.description;

        const codePre = document.createElement('pre');
        codePre.style.cssText = 'margin: 0; padding: 8px 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 3px; font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace; font-size: 11px; line-height: 1.4; color: var(--vscode-textPreformat-foreground, #dcdcaa); overflow-x: auto; white-space: pre-wrap;';
        codePre.textContent = item.code;

        card.appendChild(topRow);
        card.appendChild(desc);
        card.appendChild(codePre);

        cheatsheetList.appendChild(card);
      }
    }

    function openCheatsheetModal() {
      activeCheatsheetCategory = 'all';
      cheatsheetSearchText = '';
      if (cheatsheetSearch) cheatsheetSearch.value = '';
      if (cheatsheetCategories) {
        const btns = cheatsheetCategories.querySelectorAll('button');
        btns.forEach(b => b.classList.toggle('active', b.getAttribute('data-cat') === 'all'));
      }
      renderCheatsheetItems();
      if (cheatsheetModal) cheatsheetModal.style.display = 'flex';
      setTimeout(() => { if (cheatsheetSearch) cheatsheetSearch.focus(); }, 50);
    }

    function closeCheatsheetModal() {
      if (cheatsheetModal) cheatsheetModal.style.display = 'none';
      if (snippetSelect) snippetSelect.value = '';
    }

    if (snippetSelect) {
      snippetSelect.addEventListener('change', () => {
        const val = snippetSelect.value;
        if (!val) return;
        if (val === 'open_cheatsheet') {
          openCheatsheetModal();
        } else {
          const found = SNIPPET_LIBRARY.find(s => s.id === val);
          if (found) {
            insertSnippetCode(found.code);
          }
          snippetSelect.value = '';
        }
      });
    }

    if (openCheatsheetBtn) {
      openCheatsheetBtn.onclick = openCheatsheetModal;
    }
    if (closeCheatsheetModalBtn) {
      closeCheatsheetModalBtn.onclick = closeCheatsheetModal;
    }
    if (dismissCheatsheetBtn) {
      dismissCheatsheetBtn.onclick = closeCheatsheetModal;
    }
    if (cheatsheetModal) {
      cheatsheetModal.addEventListener('click', (e) => {
        if (e.target === cheatsheetModal) {
          closeCheatsheetModal();
        }
      });
    }
    if (cheatsheetSearch) {
      cheatsheetSearch.addEventListener('input', (e) => {
        cheatsheetSearchText = e.target.value;
        renderCheatsheetItems();
      });
    }
    if (cheatsheetCategories) {
      cheatsheetCategories.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const cat = btn.getAttribute('data-cat');
        if (!cat) return;
        activeCheatsheetCategory = cat;
        const btns = cheatsheetCategories.querySelectorAll('button');
        btns.forEach(b => b.classList.toggle('active', b === btn));
        renderCheatsheetItems();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (cheatsheetModal && cheatsheetModal.style.display !== 'none') {
          closeCheatsheetModal();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        toggleEditorMode();
      }
    });
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
      if (fmt === 'typescript' || fmt === 'ts' || fmt === 'zod' || fmt === 'json-schema' || fmt === 'pydantic' || fmt === 'dataclass') {
        return generateClientContract(data, fmt);
      }
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
    }

    function getFormattedResultText() {
      let text = '';
      const dataToUse = currentResultData !== null && currentResultData !== undefined 
        ? currentResultData 
        : (streamingData && streamingData.length > 0 ? streamingData : null);

      if (resultJsonEditor && resultJsonEditorWrapper && resultJsonEditorWrapper.style.display !== 'none') {
        text = resultJsonEditor.getValue();
      } else if (dataToUse !== null && dataToUse !== undefined) {
        try {
          text = typeof dataToUse === 'string' ? dataToUse : JSON.stringify(dataToUse, null, 2);
        } catch (e) {
          text = String(dataToUse);
        }
      } else {
        text = resultPre ? (resultPre.textContent || '') : '';
      }
      return text;
    }

    if (diffResultBtn) {
      diffResultBtn.onclick = () => {
        const text = getFormattedResultText();
        if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
          vscode.postMessage({ type: 'diffResult', resultText: text });
        } else {
          vscode.postMessage({ type: 'diffResultNoResult' });
        }
      };
    }

    function updateConsoleBadge(count) {
      const badge1 = document.getElementById('consoleBadge');
      const badge2 = document.getElementById('consoleBadgeResult');
      const str = String(count);
      const display = count > 0 ? 'inline-block' : 'none';
      if (badge1) { badge1.textContent = str; badge1.style.display = display; }
      if (badge2) { badge2.textContent = str; badge2.style.display = display; }
      const countEl = document.getElementById('consoleCount');
      if (countEl) { countEl.textContent = '(' + count + ' ' + (count === 1 ? 'entry' : 'entries') + ')'; }
    }

    function clearConsoleOutput() {
      consoleEntriesCount = 0;
      if (consoleOutput) consoleOutput.innerHTML = '';
      updateConsoleBadge(0);
    }

    function appendConsoleEntry(entry) {
      if (!entry || !consoleOutput) return;
      if (entry.level === 'clear') {
        clearConsoleOutput();
        return;
      }
      consoleEntriesCount++;
      updateConsoleBadge(consoleEntriesCount);

      if (consoleDrawer && consoleDrawer.style.display === 'none') {
        consoleDrawer.style.display = 'block';
        try {
          consoleDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch(e) {}
      }

      const row = document.createElement('div');
      row.className = 'console-entry-row';
      row.style.marginBottom = '4px';
      row.style.padding = '4px 6px';
      row.style.borderRadius = '3px';
      row.style.background = 'rgba(255, 255, 255, 0.02)';
      row.style.border = '1px solid transparent';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '3px';

      // Header row: timestamp, level, and quick copy button
      const headerRow = document.createElement('div');
      headerRow.style.display = 'flex';
      headerRow.style.alignItems = 'center';
      headerRow.style.gap = '6px';
      headerRow.style.fontSize = '10px';

      const d = new Date(entry.timestamp || Date.now());
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const msec = String(d.getMilliseconds()).padStart(3, '0');
      const tsSpan = document.createElement('span');
      tsSpan.style.color = 'var(--vscode-descriptionForeground, #858585)';
      tsSpan.style.flexShrink = '0';
      tsSpan.textContent = '[' + hh + ':' + mm + ':' + ss + '.' + msec + ']';

      const lvlSpan = document.createElement('span');
      lvlSpan.style.fontWeight = 'bold';
      lvlSpan.style.flexShrink = '0';
      lvlSpan.style.padding = '0 4px';
      lvlSpan.style.borderRadius = '2px';
      lvlSpan.style.fontSize = '9px';
      const lvl = (entry.level || 'log').toLowerCase();
      if (lvl === 'error') {
        lvlSpan.style.color = '#ffffff';
        lvlSpan.style.background = 'var(--vscode-errorForeground, #f48771)';
        lvlSpan.textContent = 'ERR';
        row.style.borderLeft = '3px solid var(--vscode-errorForeground, #f48771)';
      } else if (lvl === 'warn') {
        lvlSpan.style.color = '#1e1e1e';
        lvlSpan.style.background = '#cca700';
        lvlSpan.textContent = 'WARN';
        row.style.borderLeft = '3px solid #cca700';
      } else if (lvl === 'info') {
        lvlSpan.style.color = '#ffffff';
        lvlSpan.style.background = '#0e639c';
        lvlSpan.textContent = 'INFO';
        row.style.borderLeft = '3px solid #75beff';
      } else if (lvl === 'debug') {
        lvlSpan.style.color = '#ffffff';
        lvlSpan.style.background = '#388a34';
        lvlSpan.textContent = 'DBG';
        row.style.borderLeft = '3px solid #b5cea8';
      } else if (lvl === 'table') {
        lvlSpan.style.color = '#ffffff';
        lvlSpan.style.background = '#8957e5';
        lvlSpan.textContent = 'TABLE';
        row.style.borderLeft = '3px solid #8957e5';
      } else if (lvl === 'time') {
        lvlSpan.style.color = '#ffffff';
        lvlSpan.style.background = '#007acc';
        lvlSpan.textContent = 'TIME';
        row.style.borderLeft = '3px solid #007acc';
      } else {
        lvlSpan.style.color = 'var(--vscode-foreground, #cccccc)';
        lvlSpan.style.background = 'rgba(128, 128, 128, 0.2)';
        lvlSpan.textContent = 'LOG';
        row.style.borderLeft = '3px solid var(--vscode-descriptionForeground, #858585)';
      }

      const copyRowBtn = document.createElement('button');
      copyRowBtn.textContent = '📋';
      copyRowBtn.title = 'Copy this entry';
      copyRowBtn.style.marginLeft = 'auto';
      copyRowBtn.style.padding = '0 4px';
      copyRowBtn.style.fontSize = '9px';
      copyRowBtn.style.background = 'transparent';
      copyRowBtn.style.border = 'none';
      copyRowBtn.style.cursor = 'pointer';
      copyRowBtn.style.opacity = '0.6';

      headerRow.appendChild(tsSpan);
      headerRow.appendChild(lvlSpan);
      headerRow.appendChild(copyRowBtn);

      // Detail Text Content
      const textSpan = document.createElement('div');
      textSpan.style.whiteSpace = 'pre-wrap';
      textSpan.style.wordBreak = 'break-word';
      textSpan.style.fontFamily = "var(--vscode-editor-font-family, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace)";
      textSpan.style.fontSize = '11px';
      textSpan.style.lineHeight = '1.45';
      textSpan.style.paddingLeft = '4px';

      let detailText = '';
      if (entry.text !== undefined && entry.text !== null && String(entry.text).trim() !== '') {
        detailText = String(entry.text);
      } else if (entry.message !== undefined && entry.message !== null && String(entry.message).trim() !== '') {
        detailText = String(entry.message);
      } else if (Array.isArray(entry.args) && entry.args.length > 0) {
        detailText = entry.args.map(function(a) {
          try {
            return typeof a === 'object' && a !== null ? JSON.stringify(a, null, 2) : String(a);
          } catch(e) {
            return String(a);
          }
        }).join(' ');
      } else if (entry.text === '' || entry.message === '') {
        detailText = '""';
      } else {
        detailText = '(empty)';
      }

      textSpan.textContent = detailText;
      if (lvl === 'error') {
        textSpan.style.color = 'var(--vscode-errorForeground, #f48771)';
      } else if (lvl === 'warn') {
        textSpan.style.color = '#cca700';
      } else {
        textSpan.style.color = 'var(--vscode-editor-foreground, var(--vscode-foreground, #d4d4d4))';
      }

      copyRowBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(detailText).then(() => {
          copyRowBtn.textContent = '✓';
          setTimeout(() => { copyRowBtn.textContent = '📋'; }, 1200);
        });
      };

      row.appendChild(headerRow);
      row.appendChild(textSpan);
      consoleOutput.appendChild(row);

      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    function toggleConsoleDrawer() {
      if (!consoleDrawer) return;
      if (consoleDrawer.style.display === 'none') {
        consoleDrawer.style.display = 'block';
        try {
          consoleDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch(e) {}
      } else {
        consoleDrawer.style.display = 'none';
      }
    }

    if (toggleConsoleBtn) {
      toggleConsoleBtn.onclick = toggleConsoleDrawer;
    }
    if (toggleConsoleResultBtn) {
      toggleConsoleResultBtn.onclick = toggleConsoleDrawer;
    }
    if (closeConsoleBtn) {
      closeConsoleBtn.onclick = () => {
        if (consoleDrawer) consoleDrawer.style.display = 'none';
      };
    }
    if (clearConsoleBtn) {
      clearConsoleBtn.onclick = () => {
        clearConsoleOutput();
      };
    }
    if (expandConsoleBtn) {
      expandConsoleBtn.onclick = () => {
        isConsoleExpanded = !isConsoleExpanded;
        if (consoleOutput) {
          consoleOutput.style.maxHeight = isConsoleExpanded ? '380px' : '180px';
        }
        expandConsoleBtn.textContent = isConsoleExpanded ? '⤡ Collapse' : '⤢ Expand';
        expandConsoleBtn.title = isConsoleExpanded ? 'Collapse console height' : 'Expand console height';
      };
    }
    if (copyConsoleBtn) {
      copyConsoleBtn.onclick = () => {
        if (!consoleOutput) return;
        const lines = [];
        const rows = consoleOutput.children;
        for (let i = 0; i < rows.length; i++) {
          lines.push(rows[i].innerText || rows[i].textContent || '');
        }
        const fullText = lines.join(String.fromCharCode(10));
        navigator.clipboard.writeText(fullText).then(() => {
          const origText = copyConsoleBtn.textContent;
          copyConsoleBtn.textContent = '✓ Copied';
          setTimeout(() => { copyConsoleBtn.textContent = origText; }, 1500);
        });
      };
    }

    // ==========================================
    // Instant Local Mock REST API Server UI
    // ==========================================

    function appendMockLogRow(log, prepend) {
      if (!mockLogsTbody || !log) return;
      if (mockLogsEmptyMsg) mockLogsEmptyMsg.style.display = 'none';
      if (mockLogsTable) mockLogsTable.style.display = 'table';

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(128,128,128,0.15)';

      const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
      let methodColor = '#9cdcfe';
      if (log.method === 'GET') methodColor = '#4ec9b0';
      else if (log.method === 'POST') methodColor = '#dcdcaa';
      else if (log.method === 'DELETE') methodColor = '#f44747';
      else if (log.method === 'PUT' || log.method === 'PATCH') methodColor = '#ce9178';

      let statusColor = '#4ec9b0';
      const sc = Number(log.statusCode || 200);
      if (sc >= 400 && sc < 500) statusColor = '#ce9178';
      else if (sc >= 500) statusColor = '#f44747';

      let displayPath = log.path || '/';
      if (log.query && typeof log.query === 'object' && Object.keys(log.query).length > 0) {
        const qParts = [];
        for (const k of Object.keys(log.query)) {
          qParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(log.query[k]));
        }
        if (!displayPath.includes('?')) {
          displayPath += '?' + qParts.join('&');
        }
      }

      tr.innerHTML =
        '<td style="padding: 2px 4px; color: var(--vscode-descriptionForeground, #858585); white-space: nowrap;">' + escapeHtml(timeStr) + '</td>' +
        '<td style="padding: 2px 4px; font-weight: bold; color: ' + methodColor + '; white-space: nowrap;">' + escapeHtml(log.method || 'GET') + '</td>' +
        '<td style="padding: 2px 4px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + escapeHtml(displayPath) + '">' + escapeHtml(displayPath) + '</td>' +
        '<td style="padding: 2px 4px; font-weight: bold; color: ' + statusColor + '; white-space: nowrap;">' + escapeHtml(String(sc)) + '</td>' +
        '<td style="padding: 2px 4px; color: var(--vscode-descriptionForeground, #858585); white-space: nowrap;">' + escapeHtml(String(log.durationMs || 0)) + 'ms</td>';

      if (prepend && mockLogsTbody.firstChild) {
        mockLogsTbody.insertBefore(tr, mockLogsTbody.firstChild);
        while (mockLogsTbody.children.length > 50) {
          mockLogsTbody.removeChild(mockLogsTbody.lastChild);
        }
      } else {
        mockLogsTbody.appendChild(tr);
      }
    }

    function renderMockLogs(requests) {
      if (!mockLogsTbody) return;
      mockLogsTbody.innerHTML = '';
      const list = requests || [];
      if (mockRequestCountBadge) mockRequestCountBadge.textContent = String(list.length);

      if (list.length === 0) {
        if (mockLogsEmptyMsg) mockLogsEmptyMsg.style.display = 'block';
        if (mockLogsTable) mockLogsTable.style.display = 'none';
        return;
      }

      if (mockLogsEmptyMsg) mockLogsEmptyMsg.style.display = 'none';
      if (mockLogsTable) mockLogsTable.style.display = 'table';

      for (let i = 0; i < list.length; i++) {
        appendMockLogRow(list[i], false);
      }
    }

    function renderMockServerState(state) {
      activeMockServerState = state;
      const isRunning = Boolean(state && state.isRunning);

      if (mockServerStatusDot) {
        mockServerStatusDot.style.display = isRunning ? 'inline-block' : 'none';
      }

      if (mockServerStatusBadge) {
        if (isRunning) {
          mockServerStatusBadge.textContent = '🟢 Online (:' + state.port + ')';
          mockServerStatusBadge.style.background = 'rgba(78, 201, 176, 0.2)';
          mockServerStatusBadge.style.color = '#4ec9b0';
        } else {
          mockServerStatusBadge.textContent = '⚪ Offline';
          mockServerStatusBadge.style.background = 'rgba(128, 128, 128, 0.2)';
          mockServerStatusBadge.style.color = 'var(--vscode-descriptionForeground, #858585)';
        }
      }

      if (mockServerUrlDisplay) {
        if (isRunning && state && state.url) {
          mockServerUrlDisplay.textContent = state.url;
          mockServerUrlDisplay.style.display = 'inline-block';
        } else {
          mockServerUrlDisplay.style.display = 'none';
        }
      }

      if (startMockServerBtn) {
        startMockServerBtn.style.display = isRunning ? 'none' : 'inline-flex';
        startMockServerBtn.disabled = false;
        startMockServerBtn.textContent = '▶ Start Server';
      }
      if (stopMockServerBtn) {
        stopMockServerBtn.style.display = isRunning ? 'inline-flex' : 'none';
        stopMockServerBtn.disabled = false;
        stopMockServerBtn.textContent = '■ Stop Server';
      }
      if (copyMockUrlBtn) {
        copyMockUrlBtn.style.display = isRunning ? 'inline-flex' : 'none';
      }
      if (openMockBrowserBtn) {
        openMockBrowserBtn.style.display = isRunning ? 'inline-flex' : 'none';
      }
      if (copyMockCurlBtn) {
        copyMockCurlBtn.style.display = isRunning ? 'inline-flex' : 'none';
      }

      if (mockPortInput) mockPortInput.disabled = isRunning;
      if (mockEndpointInput) mockEndpointInput.disabled = isRunning;
      if (mockMethodSelect) mockMethodSelect.disabled = isRunning;
      if (mockCustomMethodInput) mockCustomMethodInput.disabled = isRunning;

      if (state && isRunning) {
        if (state.port && mockPortInput) mockPortInput.value = state.port;
        if (state.endpoint && mockEndpointInput) mockEndpointInput.value = state.endpoint;
        if (state.method && mockMethodSelect) {
          const m = state.method.toUpperCase();
          if (['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) {
            mockMethodSelect.value = m;
            if (mockCustomMethodInput) mockCustomMethodInput.style.display = 'none';
          } else {
            mockMethodSelect.value = 'CUSTOM';
            if (mockCustomMethodInput) {
              mockCustomMethodInput.value = m;
              mockCustomMethodInput.style.display = 'inline-block';
            }
          }
        }
        if (state.mode && mockModeSelect) mockModeSelect.value = state.mode;
        if (state.autoFilter !== undefined && mockAutoFilterToggle) mockAutoFilterToggle.checked = Boolean(state.autoFilter);
        if (state.latencyMs !== undefined && mockLatencySelect) mockLatencySelect.value = String(state.latencyMs);
        if (state.statusCode !== undefined && mockStatusInput) mockStatusInput.value = state.statusCode;
      }
      if (state && Array.isArray(state.requests)) {
        renderMockLogs(state.requests);
      }
    }

    function setupMockServerUI() {
      try {
        const savedPort = localStorage.getItem('jsonQueryTools.mockPort');
        if (savedPort && mockPortInput) mockPortInput.value = savedPort;
        const savedEndpoint = localStorage.getItem('jsonQueryTools.mockEndpoint');
        if (savedEndpoint && mockEndpointInput) mockEndpointInput.value = savedEndpoint;
        const savedMethod = localStorage.getItem('jsonQueryTools.mockMethod') || 'ALL';
        const savedCustomMethod = localStorage.getItem('jsonQueryTools.mockCustomMethod') || '';
        if (mockMethodSelect) {
          if (['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(savedMethod)) {
            mockMethodSelect.value = savedMethod;
            if (mockCustomMethodInput) mockCustomMethodInput.style.display = 'none';
          } else {
            mockMethodSelect.value = 'CUSTOM';
            if (mockCustomMethodInput) {
              mockCustomMethodInput.value = savedCustomMethod || savedMethod;
              mockCustomMethodInput.style.display = 'inline-block';
            }
          }
        }
        const savedMode = localStorage.getItem('jsonQueryTools.mockMode');
        if (savedMode && mockModeSelect) mockModeSelect.value = savedMode;
        const savedAutoFilter = localStorage.getItem('jsonQueryTools.mockAutoFilter');
        if (savedAutoFilter !== null && mockAutoFilterToggle) mockAutoFilterToggle.checked = savedAutoFilter === 'true';
        const savedLatency = localStorage.getItem('jsonQueryTools.mockLatency');
        if (savedLatency && mockLatencySelect) mockLatencySelect.value = savedLatency;
        const savedStatus = localStorage.getItem('jsonQueryTools.mockStatus');
        if (savedStatus && mockStatusInput) mockStatusInput.value = savedStatus;
      } catch (e) {
        console.error('Failed to load mock server settings from localStorage:', e);
      }

      if (mockPortInput) {
        mockPortInput.addEventListener('change', function() {
          localStorage.setItem('jsonQueryTools.mockPort', mockPortInput.value);
        });
      }
      if (mockEndpointInput) {
        mockEndpointInput.addEventListener('change', function() {
          let ep = mockEndpointInput.value.trim();
          if (ep && !ep.startsWith('/')) ep = '/' + ep;
          mockEndpointInput.value = ep || '/api';
          localStorage.setItem('jsonQueryTools.mockEndpoint', mockEndpointInput.value);
        });
      }
      if (mockMethodSelect) {
        mockMethodSelect.addEventListener('change', function() {
          const isCustom = mockMethodSelect.value === 'CUSTOM';
          if (mockCustomMethodInput) {
            mockCustomMethodInput.style.display = isCustom ? 'inline-block' : 'none';
            if (isCustom) mockCustomMethodInput.focus();
          }
          localStorage.setItem('jsonQueryTools.mockMethod', mockMethodSelect.value);
        });
      }
      if (mockCustomMethodInput) {
        mockCustomMethodInput.addEventListener('input', function() {
          mockCustomMethodInput.value = mockCustomMethodInput.value.toUpperCase();
          localStorage.setItem('jsonQueryTools.mockCustomMethod', mockCustomMethodInput.value);
        });
      }
      if (mockModeSelect) {
        mockModeSelect.addEventListener('change', function() {
          localStorage.setItem('jsonQueryTools.mockMode', mockModeSelect.value);
        });
      }
      if (mockAutoFilterToggle) {
        mockAutoFilterToggle.addEventListener('change', function() {
          localStorage.setItem('jsonQueryTools.mockAutoFilter', String(mockAutoFilterToggle.checked));
        });
      }
      if (mockLatencySelect) {
        mockLatencySelect.addEventListener('change', function() {
          localStorage.setItem('jsonQueryTools.mockLatency', mockLatencySelect.value);
        });
      }
      if (mockStatusInput) {
        mockStatusInput.addEventListener('change', function() {
          localStorage.setItem('jsonQueryTools.mockStatus', mockStatusInput.value);
        });
      }

      if (toggleMockServerBtn) {
        toggleMockServerBtn.onclick = function() {
          if (!mockServerPanel) return;
          const isHidden = mockServerPanel.style.display === 'none';
          mockServerPanel.style.display = isHidden ? 'flex' : 'none';
          if (isHidden) {
            vscode.postMessage({ type: 'getMockServerState' });
          }
        };
      }

      if (closeMockPanelBtn) {
        closeMockPanelBtn.onclick = function() {
          if (mockServerPanel) mockServerPanel.style.display = 'none';
        };
      }

      if (startMockServerBtn) {
        startMockServerBtn.onclick = function() {
          const port = parseInt(mockPortInput ? mockPortInput.value : '3000', 10) || 3000;
          let endpoint = (mockEndpointInput ? mockEndpointInput.value : '/api').trim();
          if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;
          const selectedMethod = mockMethodSelect ? mockMethodSelect.value : 'ALL';
          const method = selectedMethod === 'CUSTOM'
            ? ((mockCustomMethodInput ? mockCustomMethodInput.value.trim().toUpperCase() : '') || 'CUSTOM')
            : selectedMethod;
          const mode = mockModeSelect ? mockModeSelect.value : 'static';
          const autoFilter = mockAutoFilterToggle ? mockAutoFilterToggle.checked : true;
          const latencyMs = parseInt(mockLatencySelect ? mockLatencySelect.value : '0', 10) || 0;
          const statusCode = parseInt(mockStatusInput ? mockStatusInput.value : '200', 10) || 200;

          startMockServerBtn.disabled = true;
          startMockServerBtn.textContent = '⏳ Starting...';

          vscode.postMessage({
            type: 'startMockServer',
            config: {
              port: port,
              endpoint: endpoint,
              method: method,
              mode: mode,
              autoFilter: autoFilter,
              latencyMs: latencyMs,
              statusCode: statusCode
            },
            expr: typeof getEditorValue === 'function' ? getEditorValue() : undefined
          });
        };
      }

      if (stopMockServerBtn) {
        stopMockServerBtn.onclick = function() {
          stopMockServerBtn.disabled = true;
          stopMockServerBtn.textContent = '⏳ Stopping...';
          vscode.postMessage({ type: 'stopMockServer' });
        };
      }

      if (copyMockUrlBtn) {
        copyMockUrlBtn.onclick = function() {
          const url = (activeMockServerState && activeMockServerState.url)
            ? activeMockServerState.url
            : ('http://localhost:' + (mockPortInput ? mockPortInput.value : '3000') + (mockEndpointInput ? mockEndpointInput.value : '/api'));
          navigator.clipboard.writeText(url).then(function() {
            copyMockUrlBtn.textContent = '✓ Copied';
            setTimeout(function() { copyMockUrlBtn.textContent = '📋 Copy URL'; }, 1200);
          });
        };
      }

      if (openMockBrowserBtn) {
        openMockBrowserBtn.onclick = function() {
          const url = (activeMockServerState && activeMockServerState.url) ? activeMockServerState.url : undefined;
          vscode.postMessage({ type: 'openMockServerBrowser', url: url });
        };
      }

      if (copyMockCurlBtn) {
        copyMockCurlBtn.onclick = function() {
          const url = (activeMockServerState && activeMockServerState.url)
            ? activeMockServerState.url
            : ('http://localhost:' + (mockPortInput ? mockPortInput.value : '3000') + (mockEndpointInput ? mockEndpointInput.value : '/api'));
          const selectedMethod = mockMethodSelect ? mockMethodSelect.value : 'ALL';
          const effectiveMethod = (activeMockServerState && activeMockServerState.method)
            ? activeMockServerState.method
            : (selectedMethod === 'CUSTOM' ? ((mockCustomMethodInput ? mockCustomMethodInput.value.trim().toUpperCase() : '') || 'CUSTOM') : selectedMethod);
          
          let curlCmd = 'curl -i';
          if (effectiveMethod && effectiveMethod !== 'ALL' && effectiveMethod !== 'GET') {
            curlCmd += ' -X ' + effectiveMethod;
          }
          curlCmd += ' "' + url + '"';
          if (['POST', 'PUT', 'PATCH'].includes(effectiveMethod)) {
            curlCmd += ' -H "Content-Type: application/json" -d "{}"';
          }
          navigator.clipboard.writeText(curlCmd).then(function() {
            copyMockCurlBtn.textContent = '✓ Copied';
            setTimeout(function() { copyMockCurlBtn.textContent = '📋 cURL'; }, 1200);
          });
        };
      }

      if (clearMockLogsBtn) {
        clearMockLogsBtn.onclick = function() {
          vscode.postMessage({ type: 'clearMockServerLogs' });
          if (mockLogsTbody) mockLogsTbody.innerHTML = '';
          if (mockRequestCountBadge) mockRequestCountBadge.textContent = '0';
          if (mockLogsTable) mockLogsTable.style.display = 'none';
          if (mockLogsEmptyMsg) mockLogsEmptyMsg.style.display = 'block';
        };
      }
    }

    setupMockServerUI();

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
          ...editor.getOption('extraKeys'),
          'Ctrl-Enter': () => {
            if (activeEditorMode === 'tests') {
              runTests();
            } else if (activeEditorMode === 'pipeline') {
              runPipeline();
            } else {
              runExpression();
            }
            return false;
          },
          'Cmd-Enter': () => {
            if (activeEditorMode === 'tests') {
              runTests();
            } else if (activeEditorMode === 'pipeline') {
              runPipeline();
            } else {
              runExpression();
            }
            return false;
          },
          'Ctrl-Shift-T': () => { runTests(); return false; },
          'Cmd-Shift-T': () => { runTests(); return false; },
          'Ctrl-Shift-E': () => { toggleEditorMode(); return false; },
          'Cmd-Shift-E': () => { toggleEditorMode(); return false; },
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
          if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
            e.preventDefault();
            runTests();
          } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
            e.preventDefault();
            toggleEditorMode();
          } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (activeEditorMode === 'tests') {
              runTests();
            } else if (activeEditorMode === 'pipeline') {
              runPipeline();
            } else {
              runExpression();
            }
          } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveExpression();
          }
        });
        exprTextarea.addEventListener('input', () => {
          if (isLivePollingActive) {
            scheduleLivePollUpdate();
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
      clearConsoleOutput();
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
      if (msg.type === 'openTypeGenerator') {
        typeGenController.open();
      } else if (msg.type === 'updateTargets') {
        if (msg.sources) {
          renderSources(msg.sources);
        } else if (msg.boundFiles) {
          renderSources(msg.boundFiles.map(function(f) { return { type: 'file', alias: f.alias, label: f.label }; }));
        }
      } else if (msg.type === 'updateEnvironments') {
        renderEnvironments(msg.environments, msg.activeEnvironment, msg.variables);
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
        if (activeEditorMode === 'tests') {
          switchEditorMode('query');
        }
        setEditorValue(msg.expr || '');
        const aiBtn = document.getElementById('aiGenerate');
        if (aiBtn) {
          aiBtn.disabled = false;
          aiBtn.textContent = 'Generate';
        }
      } else if (msg.type === 'insertTest') {
        const code = String(msg.testExpr || '');
        testCode = code;
        localStorage.setItem('jsonQueryTools.testSuiteCode', code);
        updateTestCountBadge(code);
        if (activeEditorMode !== 'tests') {
          switchEditorMode('tests');
        } else {
          setEditorValue(code);
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
      } else if (msg.type === 'stdout') {
        if (msg.entry) {
          appendConsoleEntry(msg.entry);
        }
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
          currentResultText = '';
          if (benchmarkMeter) benchmarkMeter.style.display = 'none';
          lastBenchmark = null;
          if (pipelineResultBadge && activeEditorMode !== 'pipeline') pipelineResultBadge.style.display = 'none';
        } else {
          currentResultData = msg.data !== undefined ? msg.data : null;
          currentResultText = msg.text ?? '';
          updateBenchmarkMeter(msg.durationMs, msg.byteSize, msg.text);
          updateResultDisplay(msg.text ?? '', currentResultData);
          if (pipelineResultBadge && activeEditorMode !== 'pipeline') pipelineResultBadge.style.display = 'none';
        }
        if (msg.testSuite) {
          currentTestSuite = msg.testSuite;
          updateTestSuiteBadge(msg.testSuite);
          if (msg.isTestMode || (resultFormat && resultFormat.value === 'tests')) {
            if (resultFormat) resultFormat.value = 'tests';
            updateResultDisplay(msg.text ?? '', currentResultData);
          }
        } else if (!msg.error) {
          currentTestSuite = null;
          updateTestSuiteBadge(null);
        }
        if (msg.pollCount !== undefined && isLivePollingActive) {
          updateLivePollUI(true, msg.pollCount, msg.durationMs);
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
        currentResultText = '';
        tableCurrentPage = 1;
        if (benchmarkMeter) benchmarkMeter.style.display = 'none';
        lastBenchmark = null;
        
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
        currentResultData = (msg.data !== undefined && msg.data !== null) ? msg.data : (streamingData || null);
        currentResultText = msg.text ?? '';
        streamingData = null;
        updateBenchmarkMeter(msg.durationMs, msg.byteSize, msg.text);
        updateResultDisplay(msg.text ?? '', currentResultData);
        if (msg.testSuite) {
          currentTestSuite = msg.testSuite;
          updateTestSuiteBadge(msg.testSuite);
          if (msg.isTestMode || (resultFormat && resultFormat.value === 'tests')) {
            if (resultFormat) resultFormat.value = 'tests';
            updateResultDisplay(msg.text ?? '', currentResultData);
          }
        } else {
          currentTestSuite = null;
          updateTestSuiteBadge(null);
        }
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
      } else if (msg.type === 'triggerDiff') {
        if (diffResultBtn) diffResultBtn.click();
      } else if (msg.type === 'triggerRunTests') {
        runTests();
      } else if (msg.type === 'triggerRunPipeline') {
        runPipeline();
      } else if (msg.type === 'pipelineResult') {
        lastPipelineResult = msg.pipeline || msg.result;
        renderPipelineRibbon();
        if (msg.previewStepId) {
          showStepPreview(msg.previewStepId);
        } else {
          showStepPreview('final');
        }
      } else if (msg.type === 'loadPipeline') {
        if (Array.isArray(msg.steps) && msg.steps.length > 0) {
          pipelineSteps = msg.steps;
          activeStepIndex = 0;
          previewStepId = null;
          savePipelineToStorage();
          if (activeEditorMode !== 'pipeline') {
            switchEditorMode('pipeline');
          } else {
            renderPipelineRibbon();
            updateActiveStepConfigUI();
            updatePipelinePreviewOptions();
            setEditorValue(pipelineSteps[0].expr || '');
          }
        }
      } else if (msg.type === 'pollTick') {
        livePollCount = msg.pollCount || (livePollCount + 1);
        updateLivePollUI(true, livePollCount, msg.durationMs);
      } else if (msg.type === 'streamStatus') {
        if (msg.streamType === 'poll') {
          updateLivePollUI(msg.active, msg.pollCount);
        } else if (msg.streamType === 'sse' || msg.streamType === 'ws') {
          const src = (currentSources || []).find(s => s.id === msg.sourceId);
          if (src) {
            src.isStreaming = Boolean(msg.active);
            renderSources(currentSources);
          }
          appendConsoleEntry({
            level: 'info',
            message: '[' + msg.streamType.toUpperCase() + '] ' + (src?.alias || msg.sourceId || '') + ' ' + (msg.status || (msg.active ? 'connected' : 'disconnected'))
          });
        }
      } else if (msg.type === 'streamEvent') {
        let preview = '';
        try {
          preview = typeof msg.event?.data === 'object' ? JSON.stringify(msg.event.data) : String(msg.event?.data ?? '');
        } catch (e) {
          preview = String(msg.event?.data ?? '');
        }
        if (preview.length > 120) preview = preview.slice(0, 120) + '...';
        appendConsoleEntry({
          level: 'info',
          message: '[' + (msg.streamType || 'STREAM').toUpperCase() + (msg.event?.event ? ' ' + msg.event.event : '') + '] (Buffer: ' + (msg.bufferCount || 1) + ') ' + preview
        });
      } else if (msg.type === 'streamError') {
        appendConsoleEntry({
          level: 'error',
          message: '[' + (msg.streamType || 'Stream').toUpperCase() + ' ERROR] ' + (msg.error || 'Unknown error')
        });
        if (msg.streamType === 'poll' && livePollStatusText) {
          livePollStatusText.style.display = 'inline';
          livePollStatusText.textContent = '⚠️ Poll Error: ' + (msg.error || '');
        }
      } else if (msg.type === 'streamBufferCleared') {
        appendConsoleEntry({
          level: 'info',
          message: '[Stream] Buffer cleared for ' + (msg.sourceId || 'all')
        });
      } else if (msg.type === 'mockServerState') {
        renderMockServerState(msg.state);
      } else if (msg.type === 'mockServerRequest') {
        appendMockLogRow(msg.log, true);
        if (mockRequestCountBadge) {
          const cur = parseInt(mockRequestCountBadge.textContent || '0', 10) || 0;
          mockRequestCountBadge.textContent = String(cur + 1);
        }
      } else if (msg.type === 'mockServerError') {
        if (startMockServerBtn) {
          startMockServerBtn.disabled = false;
          startMockServerBtn.textContent = '▶ Start Server';
        }
        appendConsoleEntry({
          level: 'error',
          message: '[Mock Server] ' + (msg.error || 'Server error')
        });
      } else if (msg.type === 'triggerStartMockServer') {
        if (mockServerPanel) mockServerPanel.style.display = 'flex';
        if (startMockServerBtn && (!activeMockServerState || !activeMockServerState.isRunning)) {
          startMockServerBtn.click();
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

      if (lastBenchmark) {
        if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
          try {
            const currentBytes = (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(text).length : text.length;
            if (benchmarkByteSize) benchmarkByteSize.textContent = '💾 ' + formatBytes(currentBytes);
          } catch {}
        } else if (lastBenchmark.byteSize !== undefined) {
          if (benchmarkByteSize) benchmarkByteSize.textContent = '💾 ' + formatBytes(lastBenchmark.byteSize);
        }
      }

      if (activeMockServerState && activeMockServerState.isRunning && data !== undefined && !isStreaming) {
        vscode.postMessage({ type: 'updateMockServerPayload', payload: data });
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
      if (format === 'tests') {
        resultPre.style.display = 'none';
        if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
        hideTable();
        hideChart();
        if (resultTestsContainer) {
          resultTestsContainer.style.display = 'block';
        }
        copyResultBtn.style.display = 'none';
        updateExportButtons('tests', false);
        renderTestResults();
        return;
      }

      hideTests();

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
          try {
            resultJsonEditor.setOption('mode', { name: 'javascript', json: true });
          } catch (e) {}
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
      const format = resultFormat.value;
      if (format === 'tests') {
        updateResultDisplay('', currentResultData);
        return;
      }
      // Handle format change - support both completed and streaming data
      const dataToUse = currentResultData !== null && currentResultData !== undefined 
        ? currentResultData 
        : (streamingIsActive && streamingData && streamingData.length > 0 ? streamingData : null);
      
      const hasData = (dataToUse !== null && dataToUse !== undefined) || (Boolean(currentResultText) && currentResultText !== '');

      if (hasData) {
        const format = resultFormat.value;
        const isCurrentlyStreaming = streamingIsActive && currentResultData === null;
        
        if (format === 'table') {
          if (isCurrentlyStreaming) {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items) - Table will render when complete';
            resultPre.className = '';
            resultPre.style.display = 'block';
            if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
            hideTable();
            hideChart();
          } else {
            updateResultDisplay(currentResultText, dataToUse);
          }
        } else if (format === 'chart') {
          if (isCurrentlyStreaming) {
            resultPre.textContent = 'Loading... (' + streamingReceivedItems + '/' + streamingTotalItems + ' items) - Chart will render when complete';
            resultPre.className = '';
            resultPre.style.display = 'block';
            if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
            hideTable();
            hideChart();
          } else {
            updateResultDisplay(currentResultText, dataToUse);
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
            updateResultDisplay(currentResultText, dataToUse);
          }
        }
      }
    });

    const historySearch = document.getElementById('historySearch');
    const importHistoryJsonBtn = document.getElementById('importHistoryJsonBtn');
    const exportHistoryJsonBtn = document.getElementById('exportHistoryJsonBtn');
    let currentHistoryItems = [];

    if (importHistoryJsonBtn) {
      importHistoryJsonBtn.onclick = () => {
        vscode.postMessage({ type: 'importHistoryJson' });
      };
    }

    if (exportHistoryJsonBtn) {
      exportHistoryJsonBtn.onclick = () => {
        vscode.postMessage({ type: 'exportHistoryJson' });
      };
    }

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

      // Non-favorites: display in reverse chronological order (newest at top)

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
          clearConsoleOutput();
          setLoading(true);
          resultPre.textContent = 'Running...';
          resultPre.className = '';
          if (benchmarkMeter) benchmarkMeter.style.display = 'none';
          if (resultInfo) resultInfo.textContent = '';
          lastBenchmark = null;
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
    const urlCustomMethod = document.getElementById('urlCustomMethod');
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

    function getEffectiveUrlMethod() {
      if (!urlMethod) return 'GET';
      if (urlMethod.value === 'CUSTOM') {
        return (urlCustomMethod ? urlCustomMethod.value.trim().toUpperCase() : '') || 'GET';
      }
      return urlMethod.value;
    }

    function setUrlModalMethod(method) {
      const m = (method || 'GET').toUpperCase();
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(m)) {
        if (urlMethod) urlMethod.value = m;
        if (urlCustomMethod) {
          urlCustomMethod.value = '';
          urlCustomMethod.style.display = 'none';
        }
      } else {
        if (urlMethod) urlMethod.value = 'CUSTOM';
        if (urlCustomMethod) {
          urlCustomMethod.value = m;
          urlCustomMethod.style.display = 'block';
        }
      }
      toggleBodyGroup();
    }

    function toggleBodyGroup() {
      if (!urlMethod) return;
      const methodVal = urlMethod.value;
      const effective = methodVal === 'CUSTOM' ? (urlCustomMethod ? urlCustomMethod.value.trim().toUpperCase() : '') : methodVal;
      const supportsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(effective) || (methodVal === 'CUSTOM' && !['GET', 'HEAD', 'OPTIONS'].includes(effective));
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
      urlMethod.addEventListener('change', function() {
        const isCustom = urlMethod.value === 'CUSTOM';
        if (urlCustomMethod) {
          urlCustomMethod.style.display = isCustom ? 'block' : 'none';
          if (isCustom) urlCustomMethod.focus();
        }
        toggleBodyGroup();
      });
    }

    if (urlCustomMethod) {
      urlCustomMethod.addEventListener('input', function() {
        urlCustomMethod.value = urlCustomMethod.value.toUpperCase();
        toggleBodyGroup();
      });
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
      updateUrlModalEnvBanner();
      if (source) {
        if (urlModalTitle) urlModalTitle.textContent = 'Edit URL Data Source (' + (source.alias || 'data') + ')';
        if (urlSourceId) urlSourceId.value = source.id || '';
        if (urlAlias) urlAlias.value = source.alias || 'data';
        setUrlModalMethod(source.method || 'GET');
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
        setUrlModalMethod('GET');
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
        const method = getEffectiveUrlMethod();
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
        const method = getEffectiveUrlMethod();
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
        setUrlModalMethod(parsed.method || 'GET');
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
        const method = getEffectiveUrlMethod();
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

    const envSelect = document.getElementById('envSelect');
    if (envSelect) {
      envSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'switchEnvironment', environment: envSelect.value });
      });
    }

    const manageEnvBtn = document.getElementById('manageEnvBtn');
    if (manageEnvBtn) {
      manageEnvBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openEnvironmentsConfig' });
      });
    }

    const urlModalManageEnvBtn = document.getElementById('urlModalManageEnvBtn');
    if (urlModalManageEnvBtn) {
      urlModalManageEnvBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openEnvironmentsConfig' });
      });
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
    const diffInspectWithResultBtn = document.getElementById('diffInspectWithResultBtn');
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

      if (diffInspectWithResultBtn) {
        const hasResult = (currentResultData !== null && currentResultData !== undefined) || (streamingData && streamingData.length > 0);
        diffInspectWithResultBtn.style.display = hasResult ? 'inline-block' : 'none';
      }

      sourceInspectModal.style.display = 'flex';
    }

    function closeSourceInspectModal() {
      if (sourceInspectModal) sourceInspectModal.style.display = 'none';
      if (diffInspectWithResultBtn) diffInspectWithResultBtn.style.display = 'none';
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

    if (diffInspectWithResultBtn) {
      diffInspectWithResultBtn.onclick = () => {
        const text = getFormattedResultText();
        if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
          vscode.postMessage({
            type: 'diffResult',
            resultText: text,
            alias: currentInspectSource ? currentInspectSource.alias : undefined,
            id: currentInspectSource ? currentInspectSource.id : undefined
          });
        } else {
          vscode.postMessage({ type: 'diffResultNoResult' });
        }
      };
    }


  </script>
</body>

</html>`;

}
