import * as vscode from 'vscode';
import { HISTORY_KEY } from './constants';
import { BoundFile } from './types';
import { getHistory, pushHistory } from './history';
import { evaluateExpression, pickInitialTargetUri, readJsonFromUri, stringify, checkForMaliciousExpression } from './evaluator';
import { inferSchemaFromData } from './schema';
import { getQueryEditorHtml, nonce } from './webview/html';
import { callGemini, callOllama, fetchGeminiModels, fetchOllamaModels } from './ai';

export async function commandTransformWithExpression(context: vscode.ExtensionContext) {
  const target = pickInitialTargetUri();
  if (!target) {
    vscode.window.showErrorMessage('Open a JSON file first.');
    return;
  }
  const expr = await vscode.window.showInputBox({
    prompt: 'Enter JS expression. Use variable `data`; optional template vars: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}'
  });
  if (!expr) return;
  const data = await readJsonFromUri(target);
  const boundFiles: BoundFile[] = [{ alias: 'data', uri: target }];
  const dataMap = { 'data': data };
  const result = evaluateExpression(boundFiles, dataMap, expr);
  pushHistory(context, expr);
  // For this command we still open a new tab (handy for diffs)
  const doc = await vscode.workspace.openTextDocument({ content: stringify(result) + '\n', language: 'json' });
  await vscode.window.showTextDocument(doc, { preview: false });
}

export async function commandOpenQueryEditor(context: vscode.ExtensionContext) {
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

  let boundFiles: BoundFile[] = [];
  if (targetUri) {
    boundFiles.push({ alias: 'data', uri: targetUri });
  }

  const scriptNonce = nonce();
  panel.webview.html = getQueryEditorHtml(panel.webview, { boundFiles, scriptNonce });

  const sendHistory = () => panel.webview.postMessage({ type: 'hydrate', history: getHistory(context) });
  const sendResult = (text: string, data?: unknown) => panel.webview.postMessage({ type: 'result', text, data });
  
  // Send schema information to webview
  async function sendSchema() {
    if (boundFiles.length === 0) return;
    try {
      const dataMap: Record<string, unknown> = {};
      for (const file of boundFiles) {
          dataMap[file.alias] = await readJsonFromUri(file.uri);
      }
      const compositeSchema = inferSchemaFromData(dataMap);
      panel.webview.postMessage({ type: 'schema', schema: compositeSchema });
    } catch (e) {
      // Silently fail - schema inference is optional
    }
  }
  
  // Streaming result support - send large arrays in chunks
  const STREAMING_THRESHOLD = 1000; // Start streaming for arrays with 1000+ items
  const CHUNK_SIZE = 500; // Send 500 items per chunk
  
  async function sendResultStreaming(text: string, data?: unknown) {
    // Check if we should stream (large array)
    if (data && Array.isArray(data) && data.length >= STREAMING_THRESHOLD) {
      // Send initial metadata
      panel.webview.postMessage({ 
        type: 'resultStart', 
        totalItems: data.length,
        text: '', // Will be built progressively
        data: null // Full data not sent yet
      });
      
      // Send chunks progressively
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        const chunkEnd = Math.min(i + CHUNK_SIZE, data.length);
        const isLast = chunkEnd >= data.length;
        
        // Small delay to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 10));
        
        panel.webview.postMessage({
          type: 'resultChunk',
          chunk: chunk,
          chunkIndex: i,
          chunkEnd: chunkEnd,
          isLast: isLast,
          totalItems: data.length
        });
      }
      
      // Send final complete result for operations that need full data
      panel.webview.postMessage({
        type: 'resultComplete',
        text: text,
        data: data
      });
    } else {
      // Small results - send normally
      sendResult(text, data);
    }
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        sendHistory();
        sendSchema();
      } else if (msg.type === 'rebind') {
        const initialUri = pickInitialTargetUri();
        if (initialUri) {
          const dataIdx = boundFiles.findIndex(f => f.alias === 'data');
          if (dataIdx !== -1) {
            boundFiles[dataIdx].uri = initialUri;
          } else {
            boundFiles.unshift({ alias: 'data', uri: initialUri });
          }
          panel.webview.postMessage({ type: 'updateTargets', boundFiles: boundFiles.map(f => ({ alias: f.alias, label: label(f.uri) })) });
          sendSchema();
        }
      } else if (msg.type === 'addFile') {
         const pickResult = await vscode.window.showQuickPick([
             { label: '$(file-directory) Choose from disk', id: 'disk' },
             ...vscode.window.visibleTextEditors
                .filter(ed => ed.document.languageId === 'json' || ed.document.languageId === 'jsonc')
                .map(ed => ({ label: `$(file-code) ${label(ed.document.uri)}`, id: 'editor', uri: ed.document.uri }))
         ], { placeHolder: 'Select a JSON file to bind' });

         if (!pickResult) return;
         
         let selectedUri: vscode.Uri | undefined;
         if (pickResult.id === 'disk') {
             const uris = await vscode.window.showOpenDialog({
                 canSelectMany: false,
                 filters: { 'JSON': ['json', 'jsonc'] }
             });
             selectedUri = uris?.[0];
         } else {
             // @ts-ignore
             selectedUri = pickResult.uri;
         }

         if (selectedUri) {
             const alias = await vscode.window.showInputBox({ 
                 prompt: 'Enter an alias for this file (must be a valid JS identifier, e.g. data1)',
                 validateInput: (text) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(text) ? null : 'Invalid identifier'
             });
             if (alias) {
                 if (boundFiles.some(f => f.alias === alias)) {
                     vscode.window.showErrorMessage(`Alias '${alias}' is already in use.`);
                 } else {
                     boundFiles.push({ alias, uri: selectedUri });
                     panel.webview.postMessage({ type: 'updateTargets', boundFiles: boundFiles.map(f => ({ alias: f.alias, label: label(f.uri) })) });
                     sendSchema();
                 }
             }
         }
      } else if (msg.type === 'removeFile') {
          boundFiles = boundFiles.filter(f => f.alias !== msg.alias);
          panel.webview.postMessage({ type: 'updateTargets', boundFiles: boundFiles.map(f => ({ alias: f.alias, label: label(f.uri) })) });
          sendSchema();
      } else if (msg.type === 'use') {
        panel.webview.postMessage({ type: 'insert', expr: String(msg.expr || '') });
      } else if (msg.type === 'run' || msg.type === 'runConfirmed') {
        if (boundFiles.length === 0) throw new Error('No target JSON files are bound. Click "Rebind to Current Editor" or "+ Add File".');
        
        const dataMap: Record<string, unknown> = {};
        for (const file of boundFiles) {
            dataMap[file.alias] = await readJsonFromUri(file.uri);
        }
        
        const expr = String(msg.expr || '');

        if (msg.type === 'run') {
          const warning = checkForMaliciousExpression(expr);
          if (warning) {
            panel.webview.postMessage({ type: 'securityWarning', warning, expr });
            return;
          }
        }

        const result = evaluateExpression(boundFiles, dataMap, expr);
        if (msg.save) { pushHistory(context, expr); sendHistory(); }
        // Use streaming for large results
        await sendResultStreaming(stringify(result), result);
      } else if (msg.type === 'save') {
        pushHistory(context, String(msg.expr || ''));
        sendHistory();
      } else if (msg.type === 'importQuery') {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Import Query',
          filters: { 'Text/Code Files': ['js', 'ts', 'txt'], 'All Files': ['*'] }
        });
        if (uris && uris[0]) {
          const content = await vscode.workspace.fs.readFile(uris[0]);
          const textContent = Buffer.from(content).toString('utf-8');
          panel.webview.postMessage({ type: 'insert', expr: textContent });
        }
      } else if (msg.type === 'exportQuery') {
        const defaultName = new Date().toISOString().replace(/[:.]/g, '-') + '-query.js';
        let defaultUri: vscode.Uri;
        const primaryUri = boundFiles.find(f => f.alias === 'data')?.uri ?? boundFiles[0]?.uri;
        if (primaryUri) {
          defaultUri = vscode.Uri.joinPath(primaryUri, '..', defaultName);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
          defaultUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultName);
        } else {
          defaultUri = vscode.Uri.file(defaultName);
        }
        
        const uri = await vscode.window.showSaveDialog({
          defaultUri,
          saveLabel: 'Export Query',
          filters: { 'Text/Code Files': ['js', 'ts', 'txt'], 'All Files': ['*'] }
        });
        
        if (uri) {
          const content = Buffer.from(String(msg.expr || ''), 'utf-8');
          await vscode.workspace.fs.writeFile(uri, content);
          vscode.window.showInformationMessage('Query exported to: ' + uri.fsPath);
        }
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
        let defaultUri: vscode.Uri;
        const primaryUri = boundFiles.find(f => f.alias === 'data')?.uri ?? boundFiles[0]?.uri;
        if (primaryUri) {
          defaultUri = vscode.Uri.joinPath(primaryUri, '..', defaultName);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
          defaultUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultName);
        } else {
          defaultUri = vscode.Uri.file(defaultName);
        }
        const uri = await vscode.window.showSaveDialog({
          defaultUri,
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
        let defaultUri: vscode.Uri;
        const primaryUri = boundFiles.find(f => f.alias === 'data')?.uri ?? boundFiles[0]?.uri;
        if (primaryUri) {
            defaultUri = vscode.Uri.joinPath(primaryUri, '..', defaultName);
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            defaultUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultName);
        } else {
            defaultUri = vscode.Uri.file(defaultName);
        }
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
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

export async function copyToClipBoard(text: string) {
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage('Copied to clipboard');
}
