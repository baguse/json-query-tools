
import * as vscode from 'vscode';

const HISTORY_KEY = 'jsonQueryTools.history';
const HISTORY_LIMIT = 200;

type History = string[];

function pushHistory(context: vscode.ExtensionContext, expr: string) {
  const arr = (context.globalState.get<History>(HISTORY_KEY) ?? []);

  const existingIdx = arr.findIndex(e => e === expr);
  if (existingIdx !== -1) {
    arr.splice(existingIdx, 1);
  }
  arr.push(expr);
  context.globalState.update(HISTORY_KEY, arr.slice(-HISTORY_LIMIT));
}
function getHistory(context: vscode.ExtensionContext): History {
  return (context.globalState.get<History>(HISTORY_KEY) ?? []);
}

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function evaluateExpression(data: unknown, expr: string): unknown {
  const source = expr.trim().startsWith('.') ? `(data${expr})` : `(${expr})`;
  // eslint-disable-next-line no-new-func
  const fn = new Function('data', 'Array', 'Object', 'Number', 'String', 'Boolean', `return ${source};`);
  return fn(data, Array, Object, Number, String, Boolean);
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
  const result = evaluateExpression(data, expr);
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource} https://cdnjs.cloudflare.com; script-src 'nonce-${n}' https://cdnjs.cloudflare.com;"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>JSON Tools — Query Editor</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css">
  <style>
    body{font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0;}
    header{padding:10px 12px; border-bottom:1px solid #ddd; display:flex; gap:12px; align-items:center; flex-wrap:wrap;}
    .muted{opacity:.7}
    .row{display:flex; gap:8px; padding:8px 12px; align-items:center; flex-wrap:wrap;}
    .row:has(#expr){flex-direction:column; align-items:stretch;}
    #expr{width:100%; height:180px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px; box-sizing:border-box;}
    .CodeMirror{height:180px; width:100% !important; border:1px solid #ddd; border-radius:4px; box-sizing:border-box;}
    .CodeMirror-wrapper{width:100% !important;}
    .CodeMirror-scroll{width:100% !important;}
    button{padding:6px 10px; cursor:pointer}
    #history{border-top:1px solid #eee; padding:8px 12px;}
    .item{border:1px solid #e5e7eb; border-radius:6px; padding:8px; margin:8px 0; background:#fafafa}
    .item pre{white-space:pre-wrap; word-break:break-word; margin:4px 0 8px}
    .actions{display:flex; gap:6px; flex-wrap:wrap;}
    #result{border-top:1px solid #ddd; margin-top:8px; padding:8px 12px;}
    #result pre{white-space:pre-wrap; word-break:break-word; background:#0b1020; color:#e6edf3; padding:10px; border-radius:6px; overflow:auto; max-height:40vh;}
    .flex{display:flex;}
    .justify-between{justify-content:space-between;}
  </style>
</head>
<body>
  <header>
    <strong>JSON Tools — Query Editor</strong>
    <span class="muted">Target: ${params.fileLabel}</span>
    <button id="rebind">Rebind to Current Editor</button>
  </header>

  <div class="row">
    <textarea id="expr" placeholder="e.g. .filter(x=>x.active).sort((a,b)=>a.age-b.age).map(x=>x.name)"></textarea>
  </div>
  <div class="row">
    <button id="run">Run ▶</button>
    <button id="save">Save to History ★</button>
    <button id="clear">Clear Editor</button>
  </div>

  <div id="result">
    <div class="flex justify-between row">
      <h4>Result</h4>
      <button id="copy-result-to-clipboard">Copy Result to Clipboard</button>
    </div>
    <pre id="resultPre">(no result yet)</pre>
  </div>

  <div id="history">
    <h4>History</h4>
    <div id="list"></div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js" nonce="${n}"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js" nonce="${n}"></script>
  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const exprTextarea = document.getElementById('expr');
    const listEl = document.getElementById('list');
    const resultPre = document.getElementById('resultPre');
    const rebindBtn = document.getElementById('rebind');
    const copyResultBtn = document.getElementById('copy-result-to-clipboard');

    let editor;
    
    function initEditor() {
      if (typeof CodeMirror !== 'undefined' && exprTextarea && !editor) {
        editor = CodeMirror.fromTextArea(exprTextarea, {
          lineNumbers: true,
          mode: 'javascript',
          theme: 'monokai',
          lineWrapping: true,
          indentUnit: 2,
          tabSize: 2
        });
        // Force refresh to ensure proper sizing
        setTimeout(() => {
          if (editor) {
            editor.refresh();
            editor.setSize('100%', '180px');
          }
        }, 50);
      } else if (!editor) {
        setTimeout(initEditor, 100);
      }
    }

    // Initialize editor after scripts load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initEditor);
    } else {
      setTimeout(initEditor, 100);
    }

    const getEditorValue = () => editor ? editor.getValue().trim() : (exprTextarea ? exprTextarea.value.trim() : '');
    const setEditorValue = (value) => {
      if (editor) {
        editor.setValue(value || '');
      } else if (exprTextarea) {
        exprTextarea.value = value || '';
      }
    };

    document.getElementById('run').onclick = () => {
      const expr = getEditorValue();
      if (!expr) { return; }
      vscode.postMessage({ type: 'run', expr, save: true }); // save on run
    };
    document.getElementById('save').onclick = () => {
      const expr = getEditorValue();
      if (!expr) { return; }
      vscode.postMessage({ type: 'save', expr });
    };
    document.getElementById('clear').onclick = () => { setEditorValue(''); };
    rebindBtn.onclick = () => vscode.postMessage({ type: 'rebind' });
    copyResultBtn.onclick = () => {
      const text = resultPre.textContent || '';
      vscode.postMessage({ type: 'copyToClipboard', text });
    };

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'hydrate') {
        renderList(msg.history || []);
      } else if (msg.type === 'insert') {
        setEditorValue(msg.expr || '');
      } else if (msg.type === 'status') {
        // could show status text
      } else if (msg.type === 'result') {
        resultPre.textContent = msg.text ?? String(msg.error ?? '');
      }
    });

    function renderList(items) {
      listEl.innerHTML = '';
      const frag = document.createDocumentFragment();
      items.slice().reverse().forEach((expr, idx) => {
        const div = document.createElement('div');
        div.className = 'item';
        const pre = document.createElement('pre'); pre.textContent = expr;
        const actions = document.createElement('div'); actions.className = 'actions';
        const useBtn = document.createElement('button'); useBtn.textContent = 'Use';
        const runBtn = document.createElement('button'); runBtn.textContent = 'Run';
        const delBtn = document.createElement('button'); delBtn.textContent = 'Delete';
        useBtn.onclick = () => vscode.postMessage({ type: 'use', expr });
        runBtn.onclick = () => vscode.postMessage({ type: 'run', expr, save: true });
        delBtn.onclick = () => vscode.postMessage({ type: 'delete', indexFromEnd: idx });
        actions.append(useBtn, runBtn, delBtn);
        div.append(pre, actions);
        frag.append(div);
      });
      listEl.append(frag);
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
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
  const sendResult = (text: string) => panel.webview.postMessage({ type: 'result', text });

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
        const result = evaluateExpression(data, expr);
        if (msg.save) { pushHistory(context, expr); sendHistory(); }
        sendResult(stringify(result));
      } else if (msg.type === 'save') {
        pushHistory(context, String(msg.expr || ''));
        sendHistory();
      } else if (msg.type === 'delete') {
        const hist = getHistory(context);
        const idxFromEnd: number = Number(msg.indexFromEnd || 0);
        const idx = hist.length - 1 - idxFromEnd;
        if (idx >= 0 && idx < hist.length) {
          hist.splice(idx, 1);
          await context.globalState.update(HISTORY_KEY, hist);
          sendHistory();
        }
      } else if (msg.type === 'copyToClipboard') {
        await copyToClipBoard(String(msg.text || ''));
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
