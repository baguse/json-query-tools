
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; script-src 'nonce-${n}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com;"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>JSON Tools — Query Editor</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css" nonce="${n}">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css" nonce="${n}">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 0;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #cccccc);
      line-height: 1.5;
    }
    header {
      padding: 16px 20px;
      background: var(--vscode-titleBar-activeBackground, #2d2d30);
      border-bottom: 1px solid var(--vscode-panel-border, #3e3e42);
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    header strong {
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, #ffffff);
    }
    .muted {
      opacity: 0.7;
      font-size: 13px;
      color: var(--vscode-descriptionForeground, #cccccc);
    }
    .row {
      display: flex;
      gap: 10px;
      padding: 12px 20px;
      align-items: center;
      flex-wrap: wrap;
    }
    .row:has(#expr) {
      flex-direction: column;
      align-items: stretch;
      padding: 16px 20px;
      background: var(--vscode-editor-background, #1e1e1e);
    }
    .editor-container {
      position: relative;
      margin-bottom: 4px;
    }
    .editor-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-descriptionForeground, #858585);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .editor-label::before {
      content: '📝';
      font-size: 14px;
    }
    #expr {
      width: 100%;
      height: 200px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 13px;
      box-sizing: border-box;
      background: #272822;
      color: #f8f8f2;
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 6px;
      padding: 12px;
      resize: vertical;
      line-height: 1.5;
      tab-size: 2;
    }
    #expr:focus {
      outline: 1px solid var(--vscode-focusBorder, #007acc);
      outline-offset: -1px;
      border-color: var(--vscode-focusBorder, #007acc);
    }
    #expr::placeholder {
      color: #75715e;
      opacity: 0.7;
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
      height: 200px !important;
      width: 100% !important;
      border: 1px solid var(--vscode-input-border, #3e3e42) !important;
      border-radius: 6px !important;
      box-sizing: border-box !important;
      font-size: 13px !important;
    }
    .CodeMirror-wrapper {
      width: 100% !important;
    }
    .CodeMirror-scroll {
      width: 100% !important;
    }
    .button-group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      padding: 8px 16px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: inherit;
    }
    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    button:active {
      transform: translateY(0);
    }
    button.primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    button.primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3e3e42);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #4e4e52);
    }
    button.danger {
      background: var(--vscode-errorForeground, #f48771);
      color: #ffffff;
    }
    button.danger:hover {
      background: #ff6b5a;
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
    }
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .result-header h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground, #cccccc);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .result-header h4::before {
      content: '📊';
      font-size: 16px;
    }
    #resultPre {
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--vscode-textCodeBlock-background, #252526);
      color: var(--vscode-textPreformat-foreground, #d4d4d4);
      padding: 16px;
      border-radius: 6px;
      overflow: auto;
      max-height: 50vh;
      border: 1px solid var(--vscode-input-border, #3e3e42);
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.6;
      margin: 0;
    }
    #resultPre.empty {
      color: var(--vscode-descriptionForeground, #858585);
      font-style: italic;
    }
    #resultPre.error {
      color: var(--vscode-errorForeground, #f48771);
      background: rgba(244, 135, 113, 0.1);
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
    }
    #history h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground, #cccccc);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #history h4::before {
      content: '🕒';
      font-size: 16px;
    }
    #list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .item {
      border: 1px solid var(--vscode-input-border, #3e3e42);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-input-background, #3c3c3c);
      transition: all 0.2s ease;
    }
    .item:hover {
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .item pre {
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0 0 10px 0;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 12px;
      color: var(--vscode-foreground, #cccccc);
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .actions button {
      padding: 6px 12px;
      font-size: 12px;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--vscode-descriptionForeground, #858585);
      font-style: italic;
    }
    .empty-state::before {
      content: '📝';
      display: block;
      font-size: 32px;
      margin-bottom: 8px;
      opacity: 0.5;
    }
    .keyboard-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #858585);
      margin-top: 8px;
      font-style: italic;
    }
    .keyboard-hint kbd {
      background: var(--vscode-keybindingLabel-background, #3c3c3c);
      border: 1px solid var(--vscode-keybindingLabel-border, #555);
      border-radius: 3px;
      padding: 2px 6px;
      font-family: monospace;
      font-size: 11px;
      margin: 0 2px;
    }
  </style>
</head>
<body>
  <header>
    <strong>JSON Tools — Query Editor</strong>
    <span class="muted">Target: ${params.fileLabel}</span>
    <button id="rebind" class="secondary">🔄 Rebind to Current Editor</button>
  </header>

  <div class="row">
    <div class="editor-container">
      <div class="editor-label">JavaScript Expression</div>
      <textarea id="expr" placeholder="e.g. .filter(x=>x.active).sort((a,b)=>a.age-b.age).map(x=>x.name)"></textarea>
      <div class="keyboard-hint">Press <kbd>Ctrl+Enter</kbd> to run, <kbd>Ctrl+S</kbd> to save</div>
    </div>
  </div>
  <div class="row">
    <div class="button-group">
      <button id="run" class="primary">▶ Run</button>
      <button id="save" class="secondary">★ Save to History</button>
      <button id="clear" class="secondary">🗑️ Clear</button>
    </div>
  </div>

  <div id="result">
    <div class="result-header">
      <h4>Result</h4>
      <button id="copy-result-to-clipboard" class="secondary">📋 Copy</button>
    </div>
    <pre id="resultPre" class="empty">(no result yet)</pre>
  </div>

  <div id="history">
    <h4>History</h4>
    <div id="list"></div>
  </div>

  <script nonce="${n}">
    const vscode = acquireVsCodeApi();
    const exprTextarea = document.getElementById('expr');
    const listEl = document.getElementById('list');
    const resultPre = document.getElementById('resultPre');
    const rebindBtn = document.getElementById('rebind');
    const copyResultBtn = document.getElementById('copy-result-to-clipboard');
    let editor;
    let codeMirrorLoaded = false;
    
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
                console.log('CodeMirror JavaScript mode loaded from', cdn.base);
                codeMirrorLoaded = true;
                resolve();
              };
              jsModeScript.onerror = () => {
                console.warn('Failed to load JavaScript mode from', cdn.base);
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
    
    function initEditor() {
      if (codeMirrorLoaded && typeof CodeMirror !== 'undefined' && exprTextarea && !editor) {
        try {
          console.log('Initializing CodeMirror editor...');
          editor = CodeMirror.fromTextArea(exprTextarea, {
            lineNumbers: true,
            mode: 'javascript',
            theme: 'monokai',
            lineWrapping: true,
            indentUnit: 2,
            tabSize: 2,
            autofocus: true
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

    // Load CodeMirror and initialize editor
    loadCodeMirror()
      .then(() => {
        console.log('CodeMirror loaded successfully');
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initEditor, 100);
          });
        } else {
          setTimeout(initEditor, 100);
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

    function runExpression() {
      const expr = getEditorValue();
      if (!expr) {
        resultPre.textContent = 'Error: Expression is empty';
        resultPre.className = 'error';
        return;
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

    document.getElementById('run').onclick = runExpression;
    document.getElementById('save').onclick = saveExpression;
    document.getElementById('clear').onclick = () => {
      setEditorValue('');
      if (editor) editor.focus();
    };
    rebindBtn.onclick = () => vscode.postMessage({ type: 'rebind' });
    copyResultBtn.onclick = () => {
      const text = resultPre.textContent || '';
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
          'Cmd-S': (cm) => { saveExpression(); return false; }
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
        } else {
          resultPre.textContent = msg.text ?? '';
          resultPre.className = msg.text ? '' : 'empty';
        }
      }
    });

    function renderList(items) {
      listEl.innerHTML = '';
      if (items.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.textContent = 'No history yet. Save expressions to see them here.';
        listEl.appendChild(emptyDiv);
        return;
      }
      const frag = document.createDocumentFragment();
      items.slice().reverse().forEach((expr, idx) => {
        const div = document.createElement('div');
        div.className = 'item';
        const pre = document.createElement('pre');
        pre.textContent = expr;
        const actions = document.createElement('div');
        actions.className = 'actions';
        const useBtn = document.createElement('button');
        useBtn.className = 'secondary';
        useBtn.textContent = '📝 Use';
        const runBtn = document.createElement('button');
        runBtn.className = 'primary';
        runBtn.textContent = '▶ Run';
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = '🗑️ Delete';
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
          vscode.postMessage({ type: 'confirmDelete', indexFromEnd: idx, expr: expr.substring(0, 50) + (expr.length > 50 ? '...' : '') });
        };
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
      } else if (msg.type === 'confirmDelete') {
        const idxFromEnd: number = Number(msg.indexFromEnd || 0);
        const hist = getHistory(context);
        const idx = hist.length - 1 - idxFromEnd;
        if (idx >= 0 && idx < hist.length) {
          const expr = hist[idx];
          const confirm = await vscode.window.showWarningMessage(
            `Delete expression from history?\n\n${msg.expr || expr.substring(0, 50)}${expr.length > 50 ? '...' : ''}`,
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
