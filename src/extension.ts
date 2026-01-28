
import * as vscode from 'vscode';
import { createRequire } from 'module';

const HISTORY_KEY = 'jsonQueryTools.history';
const HISTORY_LIMIT = 200;

interface HistoryItem {
  expr: string;
  isFavorite: boolean;
  name?: string;
}

type StoredHistory = (string | HistoryItem)[];
type History = HistoryItem[];

function normalizeHistory(raw: StoredHistory): History {
  return raw.map(item => {
    if (typeof item === 'string') {
      return { expr: item, isFavorite: false };
    }
    return item;
  });
}

function pushHistory(context: vscode.ExtensionContext, expr: string) {
  let list = normalizeHistory(context.globalState.get<StoredHistory>(HISTORY_KEY) ?? []);

  const existingIdx = list.findIndex(e => e.expr === expr);
  let isFav = false;
  if (existingIdx !== -1) {
    isFav = list[existingIdx].isFavorite;
    list.splice(existingIdx, 1);
  }
  
  list.push({ expr, isFavorite: isFav });
  
  // Enforce limit
  if (list.length > HISTORY_LIMIT) {
    const toDelete = new Set<number>();
    let deleted = 0;
    const needed = list.length - HISTORY_LIMIT;
    
    // First pass: delete oldest non-favorites
    for (let i = 0; i < list.length && deleted < needed; i++) {
        if (!list[i].isFavorite) {
            toDelete.add(i);
            deleted++;
        }
    }
    // Second pass: delete oldest favorites if absolutely necessary
    for (let i = 0; i < list.length && deleted < needed; i++) {
        if (list[i].isFavorite) {
            toDelete.add(i);
            deleted++;
        }
    }
    list = list.filter((_, i) => !toDelete.has(i));
  }

  context.globalState.update(HISTORY_KEY, list);
}

function getHistory(context: vscode.ExtensionContext): History {
  return normalizeHistory(context.globalState.get<StoredHistory>(HISTORY_KEY) ?? []);
}

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function evaluateExpression(data: unknown, expr: string, targetUri?: vscode.Uri): unknown {
  const req = targetUri ? createRequire(targetUri.fsPath) : require;
  const fn = new Function('data', 'require', `${expr}`);

  // First evaluation: run the expression against (data, require)
  const firstResult = fn(data, req) as unknown;

  // If the expression itself evaluates to a function (e.g. (data) => { ... }),
  // treat that as the "query function" and invoke it with the same arguments.
  const finalResult =
    typeof firstResult === 'function'
      ? (firstResult as (data: unknown, requireFn: NodeRequire) => unknown)(data, req)
      : firstResult;

  if (typeof finalResult === 'undefined') {
    vscode.window.showWarningMessage(
      'Expression returned void (undefined). Ensure your expression or query function includes a `return` statement to provide a result.'
    );
  }

  return finalResult;
}

// --- Helpers to read JSON document by URI (works even when webview focused)
async function readJsonFromUri(uri: vscode.Uri): Promise<unknown> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Target document is not valid JSON: ${uri.fsPath}`);
  }
}

function pickInitialTargetUri(): vscode.Uri | null {
  const active = vscode.window.activeTextEditor?.document;
  if (active && (active.languageId === 'json' || active.languageId === 'jsonc')) return active.uri;
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document.languageId === 'json' || ed.document.languageId === 'jsonc') return ed.document.uri;
  }
  return null;
}

// ---- Command: one-off input box (also writes history)
async function commandTransformWithExpression(context: vscode.ExtensionContext) {
  const target = pickInitialTargetUri();
  if (!target) {
    vscode.window.showErrorMessage('Open a JSON file first.');
    return;
  }
  const expr = await vscode.window.showInputBox({
    prompt: 'Enter JS expression. Use variable `data`, or start with a dot to chain: .filter(...).map(...)'
  });
  if (!expr) return;
  const data = await readJsonFromUri(target);
  const result = evaluateExpression(data, expr, target);
  pushHistory(context, expr);
  // For this command we still open a new tab (handy for diffs)
  const doc = await vscode.workspace.openTextDocument({ content: stringify(result) + '\n', language: 'json' });
  await vscode.window.showTextDocument(doc, { preview: false });
}

// ---- Webview Query Editor with persistent History + in-panel results
function nonce() { return String(Math.random()).slice(2); }

function getQueryEditorHtml(webview: vscode.Webview, params: { fileLabel: string, scriptNonce: string }) {
  const n = params.scriptNonce;
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

  </style>
</head>
<body>
  <header>
    <strong>JSON Tools — Query Editor</strong>
    <span class="muted">Target: ${params.fileLabel}</span>
    <button id="rebind" class="secondary" style="margin-left: auto;">🔄 Rebind</button>
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
    <div style="display: flex; gap: 8px; width: 100%;">
      <textarea id="aiPrompt" placeholder="e.g. Filter active users older than 25, return just their names" style="flex: 1; height: 128px; padding: 6px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; resize: none; font-family: inherit; font-size: 14px;"></textarea>
      <div style="display: flex; align-items: center;">
        <button id="aiGenerate" class="primary" style="padding: 6px 12px; height: fit-content;">Generate</button>
      </div>
    </div>
  </div>

  <div class="row">
    <div class="editor-container">
      <div class="editor-label">JavaScript Expression</div>
      <textarea id="expr" placeholder=".filter(x=>x.active).map(x=>({name:x.name, age:x.age}))"></textarea>
      <div class="keyboard-hint">Press <kbd>Ctrl+Enter</kbd> to run | <kbd>Ctrl+S</kbd> to save</div>
    </div>
  </div>
  <div class="row" style="gap: 12px;">
    <button id="run" class="primary">▶ Run</button>
    <button id="save" class="secondary">★ Save</button>
    <button id="beautify" class="secondary">✨ Beautify</button>
    <button id="clear" class="secondary">🗑 Clear</button>
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
          <option value="raw">Raw</option>
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
        <button id="copy-result-to-clipboard" class="secondary" style="padding: 6px 10px;">📋 Copy</button>
      </div>
    </div>
    <div id="resultContainer">
      <textarea id="resultJsonEditor" style="display: none;"></textarea>
      <pre id="resultPre" class="empty">(no result yet)</pre>
      <table id="resultTable" style="display: none; width: 100%; border-collapse: collapse; background: var(--vscode-textCodeBlock-background, #252526); border: 1px solid var(--vscode-input-border, #3e3e42); border-radius: 4px; overflow: hidden; font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace; font-size: 11px;">
        <thead id="resultTableHead" style="background: var(--vscode-titleBar-activeBackground, #2d2d30); color: var(--vscode-titleBar-activeForeground, #ffffff);">
        </thead>
        <tbody id="resultTableBody" style="color: var(--vscode-textPreformat-foreground, #d4d4d4);">
        </tbody>
      </table>
      <div id="resultChartContainer">
        <canvas id="resultChart"></canvas>
      </div>
    </div>
  </div>

  <div id="history">
    <h4>History</h4>
    <div class="search-box">
      <span class="search-icon">�</span>
      <input type="text" id="historySearch" class="search-input" placeholder="Search saved queries..." />
    </div>
    <div id="list"></div>
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
    const resultInfo = document.getElementById('resultInfo');
    const resultTable = document.getElementById('resultTable');
    const resultTableHead = document.getElementById('resultTableHead');
    const resultTableBody = document.getElementById('resultTableBody');
    const resultChartContainer = document.getElementById('resultChartContainer');
    const chartCanvas = document.getElementById('resultChart');
    const resultJsonEditorTextarea = document.getElementById('resultJsonEditor');
    
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

    // Initialize Config
    const savedProvider = localStorage.getItem('jsonQueryTools.aiProvider') || 'ollama';
    aiProvider.value = savedProvider;
    updateProviderUI();

    const savedEndpoint = localStorage.getItem('jsonQueryTools.ollamaEndpoint');
    if (savedEndpoint) ollamaEndpoint.value = savedEndpoint;
    
    // Attempt to load API key from stash if possible, but usually we don't store secrets in localstorage for security if extension host handles it better.
    // However, for webview convenience:
    const savedApiKey = localStorage.getItem('jsonQueryTools.aiApiKey');
    if (savedApiKey) aiApiKey.value = savedApiKey;

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
                  const foldScripts = [
                    cdn.base + '/addon/fold/foldcode.js',
                    cdn.base + '/addon/fold/brace-fold.js',
                    cdn.base + '/addon/fold/foldgutter.js'
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
                      console.warn('Failed to load folding addon:', foldScripts[foldIndex]);
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
          allowReturnOutsideFunction: true
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
            allowReturnOutsideFunction: true
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

    document.getElementById('run').onclick = runExpression;
    document.getElementById('save').onclick = saveExpression;
    document.getElementById('clear').onclick = () => {
      setEditorValue('');
      if (editor) editor.focus();
    };
    document.getElementById('beautify').onclick = () => {
      beautifyExpression();
    };
    rebindBtn.onclick = () => vscode.postMessage({ type: 'rebind' });
    copyResultBtn.onclick = () => {
      let text = '';
      if (resultTable.style.display === 'table') {
        // Copy table as CSV
        const rows = [];
        const headerRow = Array.from(resultTableHead.querySelectorAll('th')).map(th => th.textContent);
        rows.push(headerRow.join(','));
        Array.from(resultTableBody.querySelectorAll('tr')).forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent);
          rows.push(cells.join(','));
        });
        const newlineChar = String.fromCharCode(10);
        text = rows.join(newlineChar);
      } else {
        text = resultPre.textContent || '';
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

    // Setup keyboard shortcuts after editor is initialized
    function setupKeyboardShortcuts() {
      if (editor) {
        editor.setOption('extraKeys', {
          'Ctrl-Enter': () => { runExpression(); return false; },
          'Cmd-Enter': () => { runExpression(); return false; },
          'Ctrl-S': (cm) => { saveExpression(); return false; },
          'Cmd-S': (cm) => { saveExpression(); return false; },
          // Toggle line comments in the embedded CodeMirror editor
          'Ctrl-/': (cm) => { cm.execCommand('toggleComment'); return false; },
          'Cmd-/': (cm) => { cm.execCommand('toggleComment'); return false; }
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

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'hydrate') {
        renderList(msg.history || []);
      } else if (msg.type === 'insert') {
        setEditorValue(msg.expr || '');
      } else if (msg.type === 'status') {
        // could show status text
      } else if (msg.type === 'result') {
        setLoading(false);
        if (msg.error) {
          resultPre.textContent = 'Error: ' + String(msg.error);
          resultPre.className = 'error';
          resultPre.style.display = 'block';
          resultTable.style.display = 'none';
          resultChartContainer.style.display = 'none';
          resultInfo.textContent = '';
          currentResultData = null;
        } else {
          currentResultData = msg.data || null;
          updateResultDisplay(msg.text ?? '', msg.data);
        }
      } else if (msg.type === 'updateModels') {
        aiModel.innerHTML = '<option value="" disabled selected>Select Model...</option>';
        if (msg.models && msg.models.length > 0) {
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
            console.error(msg.error);
            throw new Error('Failed to fetch models: ' + msg.error);
        }
      }
    });

    function updateResultDisplay(text, data) {
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
      } else {
        resultInfo.textContent = '';
      }
      
      // Display based on format
      if (format === 'table' && data && Array.isArray(data) && data.length > 0) {
        // Show table view
        resultPre.style.display = 'none';
        if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
        resultTable.style.display = 'table';
        resultChartContainer.style.display = 'none';
        saveJsonBtn.style.display = 'none';
        saveCsvBtn.style.display = 'inline-block';
        
        // Check if array contains objects or primitives
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
        
        if (hasObjects && allKeys.size > 0) {
          // Array of objects - use object keys as columns
          var keys = Array.from(allKeys);
          
          // Build table header
          var headerCells = [];
          for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            headerCells.push('<th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">' + escapeHtml(String(key)) + '</th>');
          }
          resultTableHead.innerHTML = '<tr>' + headerCells.join('') + '</tr>';
          
          // Build table body
          var bodyRows = [];
          for (var j = 0; j < data.length; j++) {
            var item = data[j];
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
          // Array of primitives - single column table
          resultTableHead.innerHTML = '<tr><th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">Value</th></tr>';
          
          // Build table body
          var bodyRows = [];
          for (var j = 0; j < data.length; j++) {
            var item = data[j];
            var displayValue = item === null ? 'null' : item === undefined ? 'undefined' : typeof item === 'object' ? JSON.stringify(item) : String(item);
            bodyRows.push('<tr><td style="padding: 8px 12px; border-bottom: 1px solid var(--vscode-input-border, #3e3e42);">' + escapeHtml(displayValue) + '</td></tr>');
          }
          resultTableBody.innerHTML = bodyRows.join('');
        }
      } else if (format === 'chart') {
         // Show chart view
         resultPre.style.display = 'none';
         if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
         resultTable.style.display = 'none';
         resultChartContainer.style.display = 'block';
         chartType.style.display = 'inline-block';
         downloadChartBtn.style.display = 'inline-block';
         saveJsonBtn.style.display = 'none';
         saveCsvBtn.style.display = 'none';
         copyResultBtn.style.display = 'none';
         renderChart(data);
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
        resultTable.style.display = 'none';
        resultChartContainer.style.display = 'none';
        chartType.style.display = 'none';
        downloadChartBtn.style.display = 'none';
        saveJsonBtn.style.display = 'inline-block';
        saveCsvBtn.style.display = 'none';
        copyResultBtn.style.display = 'inline-block';
        resultPre.className = jsonText ? '' : 'empty';
      } else {
        // Raw / default text view
        if (resultJsonEditorWrapper) resultJsonEditorWrapper.style.display = 'none';
        resultTable.style.display = 'none';
        resultChartContainer.style.display = 'none';
        chartType.style.display = 'none';
        downloadChartBtn.style.display = 'none';
        saveJsonBtn.style.display = 'inline-block';
        saveCsvBtn.style.display = 'none';
        copyResultBtn.style.display = 'inline-block';
        resultPre.style.display = 'block';
        
        if (format === 'raw' && data !== null && data !== undefined) {
          resultPre.textContent = String(data);
        } else {
          resultPre.textContent = text;
        }
        resultPre.className = text ? '' : 'empty';
      }
    }

    function renderChart(data) {
      if (!data || !Array.isArray(data)) {
         resultChartContainer.innerHTML = '<div style="padding: 20px; color: var(--vscode-descriptionForeground, #858585);">Data must be an array to render a chart.</div>';
         return;
      }
      
      // Ensure canvas exists (might have been overwritten by error message)
      if (!resultChartContainer.querySelector('canvas')) {
          resultChartContainer.innerHTML = '<canvas id="resultChart"></canvas>';
      }
      const ctx = document.getElementById('resultChart').getContext('2d');
      
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

    saveJsonBtn.addEventListener('click', () => {
      if (currentResultData !== undefined) {
        vscode.postMessage({ type: 'saveData', fileType: 'json', data: currentResultData });
      }
    });

    saveCsvBtn.addEventListener('click', () => {
      if (currentResultData !== undefined && Array.isArray(currentResultData)) {
         // Reuse table generation logic or similar for CSV
         // For simplicity, let's regenerate the CSV content here
         // This logic is duplicated from copy functionality, ideally refuted
         const data = currentResultData;
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
         
         let csvContent = '';
         if (hasObjects && allKeys.size > 0) {
            const keys = Array.from(allKeys);
            csvContent += keys.join(',') + '\\n';
            for (var j = 0; j < data.length; j++) {
               var item = data[j];
               var row = [];
               for (var k = 0; k < keys.length; k++) {
                  var val = item && typeof item === 'object' ? item[keys[k]] : '';
                  // Basic CSV escaping
                  val = val === null ? 'null' : val === undefined ? '' : String(val);
                  if (val.includes(',') || val.includes('\\n') || val.includes('"')) {
                      val = '"' + val.replace(/"/g, '""') + '"';
                  }
                  row.push(val);
               }
               csvContent += row.join(',') + '\\n';
            }
         } else {
             // Array of primitives
             csvContent += 'Value\\n';
             for (var j = 0; j < data.length; j++) {
                 let val = String(data[j]);
                 if (val.includes(',') || val.includes('\\n') || val.includes('"')) {
                      val = '"' + val.replace(/"/g, '""') + '"';
                  }
                 csvContent += val + '\\n';
             }
         }
         vscode.postMessage({ type: 'saveData', fileType: 'csv', text: csvContent });
      }
    });

    resultFormat.addEventListener('change', () => {
      if (currentResultData !== null && currentResultData !== undefined) {
        const format = resultFormat.value;
        if (format === 'table' && Array.isArray(currentResultData) && currentResultData.length > 0) {
          updateResultDisplay('', currentResultData);
          saveJsonBtn.style.display = 'none'; 
          saveCsvBtn.style.display = 'inline-block';
        } else if (format === 'raw') {
          const text = String(currentResultData);
          updateResultDisplay(text, currentResultData);
        } else if (format === 'chart') {
           updateResultDisplay('', currentResultData);
           saveJsonBtn.style.display = 'none';
           saveCsvBtn.style.display = 'none';
        } else {
          try {
            resultPre.textContent = JSON.stringify(currentResultData, null, 2);
            resultPre.style.display = 'block';
            resultTable.style.display = 'none';
            resultChartContainer.style.display = 'none';
            chartType.style.display = 'none';
            downloadChartBtn.style.display = 'none';
            saveJsonBtn.style.display = 'inline-block';
            saveCsvBtn.style.display = 'none';
            copyResultBtn.style.display = 'inline-block';
          } catch {
            resultPre.textContent = String(currentResultData);
            resultPre.style.display = 'block';
            resultTable.style.display = 'none';
            resultChartContainer.style.display = 'none';
            chartType.style.display = 'none';
            downloadChartBtn.style.display = 'none';
            saveJsonBtn.style.display = 'inline-block';
            saveCsvBtn.style.display = 'none';
            copyResultBtn.style.display = 'inline-block';
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

    // AI Event Listeners
    refreshModelsBtn.onclick = () => {
        const provider = aiProvider.value;
        const ep = ollamaEndpoint.value || 'http://localhost:11434';
        const key = aiApiKey.value;
        
        localStorage.setItem('jsonQueryTools.ollamaEndpoint', ep);
        if (key) localStorage.setItem('jsonQueryTools.aiApiKey', key);

        vscode.postMessage({ type: 'getModels', provider, endpoint: ep, apiKey: key });
    };

    aiModel.onchange = () => {
        localStorage.setItem('jsonQueryTools.aiModel', aiModel.value);
    };

    aiGenerateBtn.onclick = () => {
        const provider = aiProvider.value;
        const ep = ollamaEndpoint.value;
        const model = aiModel.value;
        const prompt = aiPrompt.value;
        const key = aiApiKey.value;
        
        if (provider === 'ollama' && !ep) {
            throw new Error('Please check the Ollama Endpoint.');
        }
        if (provider === 'gemini' && !key) {
             throw new Error('Please enter a Gemini API Key.');
             return;
        }
        if (!model) {
            throw new Error('Please select a model.');
        }
        if (!prompt) return;

        aiGenerateBtn.disabled = true;
        aiGenerateBtn.textContent = 'Generating...';
        
        vscode.postMessage({ type: 'generateQuery', provider, endpoint: ep, apiKey: key, model, prompt });
        

    };
    // Also re-enable on message receive (could interpret 'insert' as 'generation success')

    window.addEventListener('message', e => {
        const msg = e.data;
        if (msg.type === 'insert') {
            aiGenerateBtn.disabled = false;
            aiGenerateBtn.textContent = 'Generate';
        } else if (msg.type === 'aiError') {
             aiGenerateBtn.disabled = false;
             aiGenerateBtn.textContent = 'Generate';
             throw new Error('Generation failed: ' + msg.error);
        }
    });

  </script>
</body>
</html>`;

}

async function fetchOllamaModels(endpoint: string): Promise<string[]> {
  try {
    // Basic timeout implementation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error(`Ollama API Error: ${res.status} ${res.statusText}`);
    const json = await res.json() as any;
    return (json.models || []).map((m: any) => m.name);
  } catch (e) {
    console.error('Failed to fetch models:', e);
    return [];
  }
}

async function callOllama(endpoint: string, model: string, prompt: string, dataSample: string): Promise<string> {
  const systemPrompt = `You are a JavaScript expert. Write JavaScript expression to filter/map the \`data\` variable based on the user request.
Input data structure sample: ${dataSample}

Rules:
1. Return ONLY the JavaScript code. NO markdown, NO explanations.
2. The input \`data\` variable contains the JSON context.
3. INTELLIGENTLY DETECT THE ARRAY: If \`data\` is an object wrapping the target array (e.g. \`data.rows\`, \`data.items\`, \`data.data\`), your code MUST access that property. If \`data\` is the array, use it directly.
4. Ensure the expression returns the result (e.g. \`return data.items.filter(...)\`).
`;

  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `Request: ${prompt}`,
      system: systemPrompt,
      stream: false,
      options: { temperature: 0.2 }
    })
  });

  if (!res.ok) throw new Error(`Ollama API Error: ${res.status} ${res.statusText}`);
  const json = await res.json() as any;
  let code = json.response.trim();
  // Strip markdown code blocks if present
  code = code.replace(/^```(javascript|js)?\s*/i, '').replace(/\s*```$/, '');
  return code;
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!res.ok) throw new Error(`Gemini API Error: ${res.status}`);
        const data = await res.json() as any;
        // Filter for generateContent supported models
        return (data.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
    } catch (e: any) {
        console.error('Failed to fetch Gemini models:', e);
        throw e;
    }
}

async function callGemini(apiKey: string, model: string, prompt: string, dataSample: string): Promise<string> {
    const systemInstruction = `You are a JavaScript expert. Write JavaScript expression to filter/map the \`data\` variable based on the user request.
Input data structure sample: ${dataSample}
Rules:
1. Return ONLY the JavaScript code. NO markdown, NO explanations.
2. The input \`data\` variable contains the JSON context.
3. INTELLIGENTLY DETECT THE ARRAY: If \`data\` is an object wrapping the target array (e.g. \`data.rows\`, \`data.items\`, \`data.data\`), your code MUST access that property. If \`data\` is the array, use it directly.
4. Ensure the expression returns the result (e.g. \`return data.items.filter(...)\`).
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const body = {
        contents: [{
            parts: [{ text: `Request: ${prompt}` }]
        }],
        systemInstruction: {
            parts: [{ text: systemInstruction }]
        },
        generationConfig: {
            temperature: 0.2
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API Error: ${res.status} ${errText}`);
    }

    const json = await res.json() as any;
    const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) throw new Error('No content generated');
    
    let code = candidate.trim();
    code = code.replace(/^```(javascript|js)?\s*/i, '').replace(/\s*```$/, '');
    return code;
}


export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('jsonQueryTools.transformWithExpression', () => commandTransformWithExpression(context)),
    vscode.commands.registerCommand('jsonQueryTools.openHistory', () => commandOpenQueryEditor(context))
  );
}

async function commandOpenQueryEditor(context: vscode.ExtensionContext) {
  let targetUri: vscode.Uri | null = pickInitialTargetUri();
  const label = (u: vscode.Uri | null) => u ? vscode.workspace.asRelativePath(u) : '(none)';

  if (!targetUri) {
    vscode.window.showWarningMessage('Open a JSON file and then run the command again.');
  }

  const panel = vscode.window.createWebviewPanel(
    'jsonQueryTools.queryEditor',
    'JSON Tools — Query Editor',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const scriptNonce = nonce();
  panel.webview.html = getQueryEditorHtml(panel.webview, { fileLabel: label(targetUri), scriptNonce });

  const sendHistory = () => panel.webview.postMessage({ type: 'hydrate', history: getHistory(context) });
  const sendResult = (text: string, data?: unknown) => panel.webview.postMessage({ type: 'result', text, data });

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        sendHistory();
      } else if (msg.type === 'rebind') {
        targetUri = pickInitialTargetUri();
        panel.webview.html = getQueryEditorHtml(panel.webview, { fileLabel: label(targetUri), scriptNonce: nonce() });
        sendHistory();
      } else if (msg.type === 'use') {
        panel.webview.postMessage({ type: 'insert', expr: String(msg.expr || '') });
      } else if (msg.type === 'run') {
        if (!targetUri) throw new Error('No target JSON file is bound. Click "Rebind to Current Editor".');
        const data = await readJsonFromUri(targetUri);
        const expr = String(msg.expr || '');
        const result = evaluateExpression(data, expr, targetUri);
        if (msg.save) { pushHistory(context, expr); sendHistory(); }
        sendResult(stringify(result), result);
      } else if (msg.type === 'save') {
        pushHistory(context, String(msg.expr || ''));
        sendHistory();
      } else if (msg.type === 'toggleFavorite') {
        const history = getHistory(context);
        const targetExpr = msg.expr;
        const item = history.find(h => h.expr === targetExpr);
        if (item) {
          item.isFavorite = !item.isFavorite;
          await context.globalState.update(HISTORY_KEY, history);
          sendHistory();
        }
      } else if (msg.type === 'confirmDelete') {
        // Use fullExpr to identify the item accurately irrespective of sort order
        const targetExpr = msg.fullExpr;
        const hist = getHistory(context);
        const idx = hist.findIndex(h => h.expr === targetExpr);
        
        if (idx !== -1) {
          const expr = hist[idx].expr;
          const confirm = await vscode.window.showWarningMessage(
            `Delete expression from history?\n\n${expr.substring(0, 100)}${expr.length > 100 ? '...' : ''}`,
            { modal: true },
            'Delete'
          );
          if (confirm === 'Delete') {
            hist.splice(idx, 1);
            await context.globalState.update(HISTORY_KEY, hist);
            sendHistory();
          }
        }
      } else if (msg.type === 'copyToClipboard') {
        await copyToClipBoard(String(msg.text || ''));
      } else if (msg.type === 'saveImage') {
        const base64 = msg.data;
        const buf = Buffer.from(base64, 'base64');
        const defaultName = new Date().toISOString().replace(/[:.]/g, '-') + '.png';
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(defaultName),
          filters: { 'Images': ['png'] }
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, buf);
          vscode.window.showInformationMessage('Chart saved: ' + uri.fsPath);
        }
      } else if (msg.type === 'renameHistoryItem') {
        const targetExpr = msg.fullExpr;
        const currentName = msg.currentName;
        const hist = getHistory(context);
        const itemIdx = hist.findIndex(h => h.expr === targetExpr);
        
        if (itemIdx !== -1) {
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter a name for this history item',
                value: currentName || '',
                placeHolder: 'e.g. Filter Active Users'
            });
            
            if (newName !== undefined) {
                hist[itemIdx].name = newName;
                if (newName.trim() !== '') {
                    hist[itemIdx].isFavorite = true;
                }
                
                await context.globalState.update(HISTORY_KEY, hist);
                sendHistory();
            }
        }
      } else if (msg.type === 'saveData') {
        const isJson = msg.fileType === 'json';
        const defaultName = new Date().toISOString().replace(/[:.]/g, '-') + (isJson ? '.json' : '.csv');
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultName),
            filters: isJson ? { 'JSON': ['json'] } : { 'CSV': ['csv'] }
        });
        if (uri) {
            let content = '';
            if (isJson) {
                try {
                    content = JSON.stringify(msg.data, null, 2);
                } catch {
                    content = String(msg.data);
                }
            } else {
                content = String(msg.text || '');
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage('File saved: ' + uri.fsPath);
        }
      } else if (msg.type === 'getModels') {
        const provider = msg.provider;
        try {
            let models: string[] = [];
            if (provider === 'ollama') {
                 const config = vscode.workspace.getConfiguration('jsonQueryTools');
                 const endpoint = msg.endpoint || config.get<string>('ollamaEndpoint') || 'http://localhost:11434';
                 models = await fetchOllamaModels(endpoint);
            } else if (provider === 'gemini') {
                 const config = vscode.workspace.getConfiguration('jsonQueryTools');
                 const apiKey = msg.apiKey || config.get<string>('aiApiKey') || config.get<string>('geminiApiKey'); // Fallback
                 if (!apiKey) throw new Error('API Key required for Gemini');
                 models = await fetchGeminiModels(apiKey);
            }
            panel.webview.postMessage({ type: 'updateModels', models });
        } catch (err: any) {
           vscode.window.showErrorMessage('Failed to fetch models: ' + err.message);
           panel.webview.postMessage({ type: 'updateModels', models: [], error: err.message });
        }
      } else if (msg.type === 'generateQuery') {
        const config = vscode.workspace.getConfiguration('jsonQueryTools');
        const provider = msg.provider || config.get<string>('aiProvider') || 'ollama';
        
        const endpoint = msg.endpoint || config.get<string>('ollamaEndpoint') || 'http://localhost:11434';
        const apiKey = msg.apiKey || config.get<string>('aiApiKey') || config.get<string>('geminiApiKey');
        const model = msg.model || (provider === 'ollama' ? 'llama3' : 'gemini-1.5-flash');
        
        let dataSample = 'unknown';
        if (targetUri) {
            try {
                const fullData = await readJsonFromUri(targetUri);
                // Create a small sample
                let sample: any = fullData;
                if (Array.isArray(fullData)) {
                    sample = fullData.slice(0, 2);
                }
                dataSample = JSON.stringify(sample).substring(0, 1000); // Limit size
            } catch (e) { /* ignore */ }
        }

        try {
            let code = '';
            if (provider === 'gemini') {
                if (!apiKey) throw new Error('API Key required for Gemini');
                code = await callGemini(apiKey, model, msg.prompt, dataSample);
            } else {
                code = await callOllama(endpoint, model, msg.prompt, dataSample);
            }
            panel.webview.postMessage({ type: 'insert', expr: code });
        } catch (err: any) {
            vscode.window.showErrorMessage('AI generation failed: ' + err.message);
            panel.webview.postMessage({ type: 'aiError', error: err.message });
        }
      }
    } catch (err: any) {
      panel.webview.postMessage({ type: 'result', error: err?.message ?? String(err) });
      vscode.window.showErrorMessage(err?.message ?? String(err));
    }
  });
}

async function copyToClipBoard(text: string) {
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage('Copied to clipboard');
}

export function deactivate() {}
