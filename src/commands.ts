import * as vscode from 'vscode';
import { performance } from 'perf_hooks';
import { HISTORY_KEY, URL_SOURCES_KEY, URL_CACHE_MAX_SIZE, URL_CACHE_DEFAULT_TTL_MS, AI_API_KEY_SECRET } from './constants';
import { LruCache } from './cache';
import { BoundFile, BoundUrl, SerializedBoundSource } from './types';
import { getHistory, pushHistory, serializeHistoryJson, parseHistoryJson, saveImportedHistory } from './history';
import { evaluateExpression, pickInitialTargetUri, readJsonFromUri, stringify, checkForMaliciousExpression } from './evaluator';
export { evaluateExpression };
import { inferSchemaFromData } from './schema';
import { getQueryEditorHtml, nonce } from './webview/html';
import { callGemini, callOllama, fetchGeminiModels, fetchOllamaModels } from './ai';
import { fetchUrlWithDetails, parseHeaders } from './fetcher';
import { getTemplateVariables } from './config';
import { formatData, getFileExtension, getFormatFilters } from './export';
import { JsonDiffProvider, showJsonDiff } from './diff';

export function formatBytes(bytes: number): string {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDuration(ms: number): string {
  if (typeof ms !== 'number' || isNaN(ms)) return '0ms';
  if (ms < 1) return (Math.round(ms * 10) / 10) + 'ms';
  if (ms < 1000) return (Math.round(ms * 10) / 10) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

export const diffProvider = new JsonDiffProvider();

export async function commandDiffResult(): Promise<void> {
  if (!currentPanel) {
    vscode.window.showInformationMessage('Please open the JSON Tools Query Editor first.');
    return;
  }
  currentPanel.webview.postMessage({ type: 'triggerDiff' });
}

export async function exportHistoryAsJson(context: vscode.ExtensionContext): Promise<void> {
  const history = getHistory(context);
  if (history.length === 0) {
    vscode.window.showInformationMessage('No query history available to export.');
    return;
  }

  const favoriteCount = history.filter(h => h.isFavorite).length;
  let favoritesOnly = false;

  if (favoriteCount > 0 && favoriteCount < history.length) {
    interface ExportOption extends vscode.QuickPickItem {
      favoritesOnly: boolean;
    }
    const choices: ExportOption[] = [
      {
        label: '$(star-full) Export Favorites Only',
        description: `${favoriteCount} favorite queries`,
        favoritesOnly: true
      },
      {
        label: '$(history) Export All Queries',
        description: `All ${history.length} saved queries (including favorites)`,
        favoritesOnly: false
      }
    ];

    const pick = await vscode.window.showQuickPick(choices, {
      placeHolder: 'Select which queries to export'
    });
    if (!pick) return;
    favoritesOnly = pick.favoritesOnly;
  } else if (favoriteCount === history.length) {
    favoritesOnly = true;
  }

  const jsonText = serializeHistoryJson(history, { favoritesOnly });
  const count = favoritesOnly ? favoriteCount : history.length;
  const defaultFileName = favoritesOnly
    ? `json-query-favorites-${new Date().toISOString().split('T')[0]}.json`
    : `json-query-history-${new Date().toISOString().split('T')[0]}.json`;

  let defaultUri: vscode.Uri;
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    defaultUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultFileName);
  } else {
    defaultUri = vscode.Uri.file(defaultFileName);
  }

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Export History',
    filters: { 'JSON Files': ['json'], 'All Files': ['*'] }
  });

  if (saveUri) {
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(jsonText, 'utf-8'));
    vscode.window.showInformationMessage(
      `Successfully exported ${count} ${favoritesOnly ? 'favorite ' : ''}quer${count === 1 ? 'y' : 'ies'} to ${vscode.workspace.asRelativePath(saveUri)}.`
    );
  }
}

export async function importHistoryFromJson(context: vscode.ExtensionContext): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Import History JSON',
    filters: { 'JSON Files': ['json'], 'All Files': ['*'] }
  });

  if (!uris || uris.length === 0) return;

  const fileUri = uris[0];
  let fileContent: string;
  try {
    const raw = await vscode.workspace.fs.readFile(fileUri);
    fileContent = Buffer.from(raw).toString('utf-8');
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to read file: ${err.message}`);
    return;
  }

  let parseResult: ReturnType<typeof parseHistoryJson>;
  try {
    parseResult = parseHistoryJson(fileContent);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to parse history JSON: ${err.message}`);
    return;
  }

  if (parseResult.validCount === 0) {
    vscode.window.showWarningMessage('No valid query expressions found in the selected JSON file.');
    return;
  }

  const existing = getHistory(context);
  let mode: 'merge' | 'replace' = 'merge';

  if (existing.length > 0) {
    interface ImportOption extends vscode.QuickPickItem {
      mode: 'merge' | 'replace';
    }
    const choices: ImportOption[] = [
      {
        label: '$(git-merge) Merge with existing history (Recommended)',
        description: `Preserve existing ${existing.length} queries and add new ones`,
        mode: 'merge'
      },
      {
        label: '$(replace) Replace existing history',
        description: `Overwrite all existing queries with the ${parseResult.validCount} imported queries`,
        mode: 'replace'
      }
    ];

    const pick = await vscode.window.showQuickPick(choices, {
      placeHolder: `Found ${parseResult.validCount} queries. How would you like to import them?`
    });
    if (!pick) return;
    mode = pick.mode;
  }

  const result = await saveImportedHistory(context, parseResult.items, mode);

  if (currentPanel) {
    currentPanel.webview.postMessage({ type: 'hydrate', history: result.history });
  }

  const summary = mode === 'replace'
    ? `Replaced history with ${result.addedCount} queries.`
    : `Imported ${parseResult.validCount} queries (${result.addedCount} added, ${result.updatedCount} updated).`;

  vscode.window.showInformationMessage(`Successfully imported queries from ${vscode.workspace.asRelativePath(fileUri)}! ${summary}`);
}

export async function commandExportHistory(context: vscode.ExtensionContext): Promise<void> {
  await exportHistoryAsJson(context);
}

export async function commandImportHistory(context: vscode.ExtensionContext): Promise<void> {
  await importHistoryFromJson(context);
}

export async function commandTransformWithExpression(context: vscode.ExtensionContext) {
  try {
    const target = pickInitialTargetUri();
    if (!target) {
      vscode.window.showErrorMessage('Open a JSON file first.');
      return;
    }
    const expr = await vscode.window.showInputBox({
      prompt: 'Enter JS expression. Use variable `data`; optional template vars: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}, {{$env.VAR}}'
    });
    if (!expr) return;

    const warning = checkForMaliciousExpression(expr);
    if (warning) {
      const choice = await vscode.window.showWarningMessage(
        `Security Warning: ${warning}. Are you sure you want to run this expression?`,
        { modal: true },
        'Run Anyway'
      );
      if (choice !== 'Run Anyway') {
        return;
      }
    }

    const data = await readJsonFromUri(target);
    const boundFiles: BoundFile[] = [{ alias: 'data', uri: target }];
    const dataMap = { 'data': data };
    const result = await evaluateExpression(boundFiles, dataMap, expr);
    await pushHistory(context, expr);
    // For this command we still open a new tab (handy for diffs)
    const doc = await vscode.workspace.openTextDocument({ content: stringify(result) + '\n', language: 'json' });
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to transform with expression: ${err.message || err}`);
  }
}

export let currentPanel: vscode.WebviewPanel | undefined;
let panelSwitchToScratchpad: (() => void) | undefined;

export function getCurrentPanel(): vscode.WebviewPanel | undefined {
  return currentPanel;
}

export function setCurrentPanel(panel: vscode.WebviewPanel | undefined): void {
  currentPanel = panel;
}

export interface QueryEditorOptions {
  standalone?: boolean;
}

export async function commandOpenQueryEditor(
  context: vscode.ExtensionContext,
  options?: QueryEditorOptions
) {
  const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

  if (currentPanel) {
    currentPanel.reveal(currentPanel.viewColumn ?? column);
    if (options?.standalone) {
      panelSwitchToScratchpad?.();
      vscode.window.showInformationMessage('Switched to Standalone Scratchpad Mode.');
    }
    return;
  }

  const isStandalone = !!options?.standalone;
  let targetUri: vscode.Uri | null = isStandalone ? null : pickInitialTargetUri();
  const label = (u: vscode.Uri | null) => u ? vscode.workspace.asRelativePath(u) : '(none)';

  const panel = vscode.window.createWebviewPanel(
    'jsonQueryTools.queryEditor',
    isStandalone ? 'JSON Tools — JS Scratchpad' : 'JSON Tools — Query Editor',
    column,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel = panel;

  const benchmarkStatusBar = (typeof vscode?.window?.createStatusBarItem === 'function')
    ? vscode.window.createStatusBarItem(vscode?.StatusBarAlignment?.Right ?? 2, 100)
    : undefined;
  if (benchmarkStatusBar) {
    benchmarkStatusBar.name = 'JSON Tools Query Benchmark';
  }

  let lastBenchmark: { durationMs: number; byteSize: number } | undefined;

  function updateBenchmarkStatus(durationMs: number, byteSize: number) {
    lastBenchmark = { durationMs, byteSize };
    if (!benchmarkStatusBar) return;
    const formattedBytes = formatBytes(byteSize);
    const formattedDuration = formatDuration(durationMs);
    benchmarkStatusBar.text = `$(watch) ${formattedDuration} | $(database) ${formattedBytes}`;
    benchmarkStatusBar.tooltip = `Query Execution: ${formattedDuration}\nResult Size: ${formattedBytes} (${byteSize.toLocaleString()} bytes)`;
    benchmarkStatusBar.show();
  }

  panel.onDidChangeViewState?.((e) => {
    if (e.webviewPanel.visible && lastBenchmark) {
      benchmarkStatusBar?.show();
    } else {
      benchmarkStatusBar?.hide();
    }
  });

  let activeAiController: AbortController | null = null;
  let lastResultData: unknown = undefined;
  let hasEvaluatedResult = false;

  panel.onDidDispose(() => {
    benchmarkStatusBar?.dispose();
    activeAiController?.abort();
    activeAiController = null;
    urlDataCache.clear();
    lastResultData = undefined;
    hasEvaluatedResult = false;
    currentPanel = undefined;
    panelSwitchToScratchpad = undefined;
  });

  let boundFiles: BoundFile[] = [];
  if (targetUri) {
    boundFiles.push({ type: 'file', alias: 'data', uri: targetUri, label: label(targetUri) });
  }

  function getPersistedUrls(): BoundUrl[] {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const fromWorkspace = context.workspaceState.get<BoundUrl[]>(URL_SOURCES_KEY);
      if (fromWorkspace !== undefined) return fromWorkspace;
    }
    return context.globalState.get<BoundUrl[]>(URL_SOURCES_KEY) ?? [];
  }

  async function savePersistedUrls(urls: BoundUrl[]) {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      await context.workspaceState.update(URL_SOURCES_KEY, urls);
    } else {
      await context.globalState.update(URL_SOURCES_KEY, urls);
    }
  }

  let boundUrls: BoundUrl[] = isStandalone ? [] : getPersistedUrls();
  const urlDataCache = new LruCache<string, unknown>({
    maxSize: URL_CACHE_MAX_SIZE,
    defaultTtlMs: URL_CACHE_DEFAULT_TTL_MS
  });

  function getSerializedSources(): SerializedBoundSource[] {
    const list: SerializedBoundSource[] = [];
    for (const f of boundFiles) {
      list.push({
        type: 'file',
        alias: f.alias,
        label: label(f.uri)
      });
    }
    for (const u of boundUrls) {
      let host = u.url;
      try {
        const parsed = new URL(u.url);
        host = parsed.host + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '');
      } catch {}
      list.push({
        type: 'url',
        id: u.id,
        alias: u.alias,
        label: host,
        url: u.url,
        method: u.method,
        headers: u.headers,
        body: u.body,
        lastFetched: u.lastFetched,
        lastResponseHeaders: u.lastResponseHeaders,
        lastStatus: u.lastStatus,
        lastStatusText: u.lastStatusText
      });
    }
    return list;
  }

  const scriptNonce = nonce();
  panel.webview.html = getQueryEditorHtml(panel.webview, { sources: getSerializedSources(), scriptNonce });

  const sendHistory = () => panel.webview.postMessage({ type: 'hydrate', history: getHistory(context) });
  const sendResult = (text: string, data?: unknown, benchmark?: { durationMs: number; byteSize: number }) => {
    if (benchmark && benchmark.durationMs !== undefined && benchmark.byteSize !== undefined) {
      updateBenchmarkStatus(benchmark.durationMs, benchmark.byteSize);
    }
    panel.webview.postMessage({
      type: 'result',
      text,
      data,
      durationMs: benchmark?.durationMs,
      byteSize: benchmark?.byteSize
    });
  };
  const sendSources = () => panel.webview.postMessage({
    type: 'updateTargets',
    sources: getSerializedSources(),
    boundFiles: boundFiles.map(f => ({ alias: f.alias, label: label(f.uri) }))
  });

  panelSwitchToScratchpad = () => {
    boundFiles = [];
    boundUrls = [];
    urlDataCache.clear();
    sendSources();
    sendSchema();
    panel.title = 'JSON Tools — JS Scratchpad';
  };

  async function getOrFetchUrlData(source: BoundUrl, forceRefresh = false): Promise<unknown> {
    if (!forceRefresh && urlDataCache.has(source.id)) {
      return urlDataCache.get(source.id);
    }
    const templateVariables = getTemplateVariables(undefined, {
      url: source.url,
      method: source.method,
      alias: source.alias
    });
    const result = await fetchUrlWithDetails({
      url: source.url,
      method: source.method,
      headers: source.headers,
      body: source.body,
      templateVariables
    });
    source.lastFetched = Date.now();
    source.lastResponseHeaders = result.headers;
    source.lastStatus = result.status;
    source.lastStatusText = result.statusText;
    if (!result.ok) {
      let errSnippet = '';
      if (result.data !== null && result.data !== undefined) {
        const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        if (s) errSnippet = `: ${s.slice(0, 300)}${s.length > 300 ? '...' : ''}`;
      }
      throw new Error(`HTTP ${result.status} ${result.statusText}${errSnippet}`);
    }
    urlDataCache.set(source.id, result.data);
    return result.data;
  }


  async function buildDataMap(): Promise<Record<string, unknown>> {
    const dataMap: Record<string, unknown> = {};
    for (const file of boundFiles) {
      dataMap[file.alias] = await readJsonFromUri(file.uri);
    }
    for (const u of boundUrls) {
      dataMap[u.alias] = await getOrFetchUrlData(u, false);
    }
    return dataMap;
  }
  
  // Send schema information to webview
  async function sendSchema() {
    if (boundFiles.length === 0 && boundUrls.length === 0) return;
    try {
      const dataMap = await buildDataMap();
      const compositeSchema = inferSchemaFromData(dataMap);
      panel.webview.postMessage({ type: 'schema', schema: compositeSchema });
    } catch (e) {
      // Silently fail - schema inference is optional
    }
  }
  
  // Streaming result support - send large arrays in chunks
  const STREAMING_THRESHOLD = 1000; // Start streaming for arrays with 1000+ items
  const CHUNK_SIZE = 500; // Send 500 items per chunk
  
  async function sendResultStreaming(text: string, data?: unknown, durationMs?: number, byteSize?: number) {
    // Check if we should stream (large array)
    if (data && Array.isArray(data) && data.length >= STREAMING_THRESHOLD) {
      // Send initial metadata
      panel.webview.postMessage({ 
        type: 'resultStart', 
        totalItems: data.length,
        text: '', // Will be built progressively
        data: null // Full data not sent yet
      });
      
      let totalStreamBytes = 2; // For outer brackets [ ]
      // Send chunks progressively without artificial delay
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, i + CHUNK_SIZE);
        const chunkEnd = Math.min(i + CHUNK_SIZE, data.length);
        const isLast = chunkEnd >= data.length;
        
        const chunkJson = JSON.stringify(chunk);
        totalStreamBytes += Buffer.byteLength(chunkJson, 'utf-8') - 2 + (i > 0 ? 1 : 0);

        panel.webview.postMessage({
          type: 'resultChunk',
          chunk: chunk,
          chunkIndex: i,
          chunkEnd: chunkEnd,
          isLast: isLast,
          totalItems: data.length
        });

        // Yield to event loop to allow IPC processing without artificial delay
        await new Promise(resolve => typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0));
      }
      
      const finalByteSize = byteSize !== undefined && byteSize > 0 ? byteSize : Math.max(0, totalStreamBytes);
      if (durationMs !== undefined) {
        updateBenchmarkStatus(durationMs, finalByteSize);
      }

      // Send final completion message with metadata only (avoid re-transmitting entire dataset)
      panel.webview.postMessage({
        type: 'resultComplete',
        isComplete: true,
        totalItems: data.length,
        durationMs,
        byteSize: finalByteSize
      });
    } else {
      const finalByteSize = byteSize !== undefined ? byteSize : (text ? Buffer.byteLength(text, 'utf-8') : 0);
      // Small results - send normally
      sendResult(text, data, durationMs !== undefined ? { durationMs, byteSize: finalByteSize } : undefined);
    }
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.type === 'ready') {
        sendHistory();
        sendSources();
        const storedApiKey = await context.secrets.get(AI_API_KEY_SECRET);
        if (storedApiKey) {
          panel.webview.postMessage({ type: 'hydrateAiApiKey', apiKey: storedApiKey });
        }
        // Background fetch for URL sources to enable schema autocomplete
        (async () => {
          try {
            for (const u of boundUrls) {
              if (!urlDataCache.has(u.id)) {
                await getOrFetchUrlData(u, false);
              }
            }
            await sendSchema();
          } catch {
            // Ignore background fetch failure on init
          }
        })();
      } else if (msg.type === 'switchToScratchpad') {
        boundFiles = [];
        boundUrls = [];
        urlDataCache.clear();
        sendSources();
        sendSchema();
        panel.title = 'JSON Tools — JS Scratchpad';
        vscode.window.showInformationMessage('Switched to Standalone Scratchpad Mode.');
      } else if (msg.type === 'rebind') {
        const initialUri = pickInitialTargetUri();
        if (initialUri) {
          const dataIdx = boundFiles.findIndex(f => f.alias === 'data');
          if (dataIdx !== -1) {
            boundFiles[dataIdx].uri = initialUri;
            boundFiles[dataIdx].label = label(initialUri);
          } else {
            boundFiles.unshift({ type: 'file', alias: 'data', uri: initialUri, label: label(initialUri) });
          }
          panel.title = 'JSON Tools — Query Editor';
          sendSources();
          sendSchema();
        } else {
          vscode.window.showInformationMessage('No active JSON editor found to rebind.');
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
                 if (boundFiles.some(f => f.alias === alias) || boundUrls.some(u => u.alias === alias)) {
                     vscode.window.showErrorMessage(`Alias '${alias}' is already in use.`);
                 } else {
                     boundFiles.push({ type: 'file', alias, uri: selectedUri, label: label(selectedUri) });
                     sendSources();
                     sendSchema();
                 }
             }
         }
      } else if (msg.type === 'removeFile') {
          boundFiles = boundFiles.filter(f => f.alias !== msg.alias);
          sendSources();
          sendSchema();
      } else if (msg.type === 'removeSource') {
          if (msg.id) {
            boundUrls = boundUrls.filter(u => u.id !== msg.id);
            urlDataCache.delete(msg.id);
            await savePersistedUrls(boundUrls);
          } else if (msg.alias) {
            boundFiles = boundFiles.filter(f => f.alias !== msg.alias);
            const urlIdx = boundUrls.findIndex(u => u.alias === msg.alias);
            if (urlIdx !== -1) {
              const u = boundUrls[urlIdx];
              urlDataCache.delete(u.id);
              boundUrls.splice(urlIdx, 1);
              await savePersistedUrls(boundUrls);
            }
          }
          sendSources();
          sendSchema();
      } else if (msg.type === 'fetchUrlSource') {
          const src = msg.source;
          if (!src || !src.url) {
            panel.webview.postMessage({ type: 'urlSourceError', error: 'URL is required.' });
            return;
          }
          const alias = (src.alias || 'data').trim();
          if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(alias)) {
            panel.webview.postMessage({ type: 'urlSourceError', error: `Invalid alias "${alias}". Must be a valid JavaScript identifier (e.g. data, api).` });
            return;
          }

          const sourceId = src.id || ('url_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
          if (boundFiles.some(f => f.alias === alias)) {
            panel.webview.postMessage({ type: 'urlSourceError', error: `Alias "${alias}" is already used by a bound file.` });
            return;
          }
          if (boundUrls.some(u => u.alias === alias && u.id !== sourceId)) {
            panel.webview.postMessage({ type: 'urlSourceError', error: `Alias "${alias}" is already used by another URL source.` });
            return;
          }

          try {
            const parsedHeaders = parseHeaders(src.headers);
            const templateVariables = getTemplateVariables(undefined, {
              url: src.url,
              method: src.method || 'GET',
              alias
            });
            const result = await fetchUrlWithDetails({
              url: src.url,
              method: src.method || 'GET',
              headers: parsedHeaders,
              body: src.body,
              templateVariables
            });
            if (!result.ok) {
              let errSnippet = '';
              if (result.data !== null && result.data !== undefined) {
                const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                if (s) errSnippet = `: ${s.slice(0, 300)}${s.length > 300 ? '...' : ''}`;
              }
              throw new Error(`HTTP ${result.status} ${result.statusText}${errSnippet}`);
            }

            const boundUrl: BoundUrl = {
              type: 'url',
              id: sourceId,
              alias,
              url: src.url.trim(),
              method: (src.method || 'GET').toUpperCase() as any,
              headers: parsedHeaders,
              body: src.body,
              lastFetched: Date.now(),
              lastResponseHeaders: result.headers,
              lastStatus: result.status,
              lastStatusText: result.statusText
            };

            urlDataCache.set(sourceId, result.data);
            const existingIdx = boundUrls.findIndex(u => u.id === sourceId);
            if (existingIdx !== -1) {
              boundUrls[existingIdx] = boundUrl;
            } else {
              boundUrls.push(boundUrl);
            }

            await savePersistedUrls(boundUrls);
            panel.webview.postMessage({ type: 'urlSourceSuccess', source: boundUrl });
            sendSources();
            await sendSchema();
            vscode.window.showInformationMessage(`URL source '${boundUrl.alias}' loaded successfully.`);
          } catch (err: any) {
            panel.webview.postMessage({ type: 'urlSourceError', error: err.message || String(err) });
          }
      } else if (msg.type === 'refreshUrlSource') {
          const u = boundUrls.find(item => item.id === msg.id);
          if (u) {
            try {
              await getOrFetchUrlData(u, true);
              sendSources();
              await sendSchema();
              vscode.window.showInformationMessage(`Refreshed URL source '${u.alias}'.`);
            } catch (err: any) {
              vscode.window.showErrorMessage(`Failed to refresh '${u.alias}': ${err.message}`);
            }
          }
      } else if (msg.type === 'previewUrlSource') {
          const src = msg.source;
          if (!src || !src.url) {
            panel.webview.postMessage({ type: 'urlPreviewError', error: 'URL is required.' });
            return;
          }
          try {
            const parsedHeaders = parseHeaders(src.headers);
            const templateVariables = getTemplateVariables(undefined, {
              url: src.url,
              method: src.method || 'GET',
              alias: src.alias || 'data'
            });
            const details = await fetchUrlWithDetails({
              url: src.url,
              method: src.method || 'GET',
              headers: parsedHeaders,
              body: src.body,
              templateVariables
            });

            // Avoid transferring massive payloads across IPC for a small preview pane
            let previewData = details.data;
            let isTruncated = false;
            if (Array.isArray(details.data) && details.data.length > 50) {
              previewData = details.data.slice(0, 50);
              isTruncated = true;
            } else if (typeof details.data === 'string' && details.data.length > 50000) {
              previewData = details.data.slice(0, 50000);
              isTruncated = true;
            }

            panel.webview.postMessage({
              type: 'urlPreviewResult',
              details: {
                ...details,
                data: previewData,
                isTruncated
              }
            });
          } catch (err: any) {
            panel.webview.postMessage({ type: 'urlPreviewError', error: err.message || String(err) });
          }
      } else if (msg.type === 'inspectSource') {
          try {
            if (msg.id) {
              const u = boundUrls.find(item => item.id === msg.id);
              if (u) {
                let data: unknown;
                try {
                  data = await getOrFetchUrlData(u, false);
                } catch (fetchErr: any) {
                  data = { error: fetchErr.message };
                }
                panel.webview.postMessage({
                  type: 'showSourceInspection',
                  source: {
                    type: 'url',
                    id: u.id,
                    alias: u.alias,
                    url: u.url,
                    method: u.method,
                    headers: u.headers,
                    lastFetched: u.lastFetched,
                    lastResponseHeaders: u.lastResponseHeaders,
                    lastStatus: u.lastStatus,
                    lastStatusText: u.lastStatusText
                  },
                  data
                });
              }
            } else if (msg.alias) {
              const f = boundFiles.find(item => item.alias === msg.alias);
              if (f) {
                const data = await readJsonFromUri(f.uri);
                panel.webview.postMessage({
                  type: 'showSourceInspection',
                  source: {
                    type: 'file',
                    alias: f.alias,
                    label: label(f.uri)
                  },
                  data
                });
              }
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load source data: ${err.message}`);
          }
      } else if (msg.type === 'openInEditor') {
          try {
            const content = String(msg.text || '');
            const doc = await vscode.workspace.openTextDocument({
              content: content.endsWith('\n') ? content : content + '\n',
              language: msg.language || 'json'
            });
            await vscode.window.showTextDocument(doc, { preview: false });
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open in editor: ${err.message}`);
          }
      } else if (msg.type === 'diffResultNoResult') {
        vscode.window.showWarningMessage('No query result to compare. Please run an expression first.');
      } else if (msg.type === 'diffResult') {
        try {
          if (boundFiles.length === 0 && boundUrls.length === 0) {
            vscode.window.showInformationMessage('Diff View requires at least one bound data source to compare with.');
            return;
          }

          let effectiveResultText = typeof msg.resultText === 'string' ? msg.resultText.trim() : '';
          if (!effectiveResultText || effectiveResultText.includes('(no result yet)') || effectiveResultText.includes('Running...')) {
            if (hasEvaluatedResult && lastResultData !== undefined) {
              effectiveResultText = stringify(lastResultData);
            } else {
              vscode.window.showWarningMessage('No query result to compare. Please run an expression first.');
              return;
            }
          }

          let selectedSource: { title: string; data: unknown } | null = null;

          if (msg.alias) {
            const f = boundFiles.find(item => item.alias === msg.alias);
            if (f) {
              const data = await readJsonFromUri(f.uri);
              selectedSource = { title: f.label || f.alias, data };
            } else {
              const u = boundUrls.find(item => item.alias === msg.alias);
              if (u) {
                const data = await getOrFetchUrlData(u, false);
                selectedSource = { title: u.alias, data };
              }
            }
          } else if (msg.id) {
            const u = boundUrls.find(item => item.id === msg.id);
            if (u) {
              const data = await getOrFetchUrlData(u, false);
              selectedSource = { title: u.alias, data };
            }
          }

          if (!selectedSource) {
            const totalSources = boundFiles.length + boundUrls.length;
            if (totalSources === 1) {
              if (boundFiles.length === 1) {
                const f = boundFiles[0];
                const data = await readJsonFromUri(f.uri);
                selectedSource = { title: f.label || f.alias, data };
              } else {
                const u = boundUrls[0];
                const data = await getOrFetchUrlData(u, false);
                selectedSource = { title: u.alias, data };
              }
            } else {
              interface SourcePickItem extends vscode.QuickPickItem {
                file?: BoundFile;
                url?: BoundUrl;
                isAll?: boolean;
              }
              const pickItems: SourcePickItem[] = [];
              for (const f of boundFiles) {
                pickItems.push({
                  label: `$(file) ${f.alias}`,
                  description: f.label || vscode.workspace.asRelativePath(f.uri),
                  detail: 'Bound JSON file source',
                  file: f
                });
              }
              for (const u of boundUrls) {
                pickItems.push({
                  label: `$(globe) ${u.alias}`,
                  description: u.url,
                  detail: 'Bound URL endpoint',
                  url: u
                });
              }
              pickItems.push({
                label: `$(layers) All Sources`,
                description: 'Composite map of all bound sources',
                detail: '{ ' + [...boundFiles.map(f => f.alias), ...boundUrls.map(u => u.alias)].join(', ') + ' }',
                isAll: true
              });

              const picked = await vscode.window.showQuickPick(pickItems, {
                placeHolder: 'Select a data source to compare with the transformed result'
              });
              if (!picked) return;

              if (picked.isAll) {
                const dataMap = await buildDataMap();
                selectedSource = { title: 'All Sources', data: dataMap };
              } else if (picked.file) {
                const data = await readJsonFromUri(picked.file.uri);
                selectedSource = { title: picked.file.label || picked.file.alias, data };
              } else if (picked.url) {
                const data = await getOrFetchUrlData(picked.url, false);
                selectedSource = { title: picked.url.alias, data };
              }
            }
          }

          if (!selectedSource) return;

          await showJsonDiff(diffProvider, {
            sourceName: selectedSource.title,
            originalData: selectedSource.data,
            resultText: effectiveResultText
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to open diff view: ${err.message}`);
        }
      } else if (msg.type === 'use') {

        panel.webview.postMessage({ type: 'insert', expr: String(msg.expr || '') });
      } else if (msg.type === 'run' || msg.type === 'runConfirmed') {
        const dataMap = await buildDataMap();
        const expr = String(msg.expr || '');

        if (msg.type === 'run') {
          const warning = checkForMaliciousExpression(expr);
          if (warning) {
            panel.webview.postMessage({ type: 'securityWarning', warning, expr });
            return;
          }
        }

        const startTime = performance.now();
        const result = await evaluateExpression(boundFiles, dataMap, expr);
        const durationMs = Math.round((performance.now() - startTime) * 10) / 10;
        lastResultData = result;
        hasEvaluatedResult = true;
        if (msg.save) { await pushHistory(context, expr); sendHistory(); }
        // Use streaming for large results (skip expensive full stringify in host)
        const isStreaming = Array.isArray(result) && result.length >= STREAMING_THRESHOLD;
        const text = isStreaming ? '' : stringify(result);
        const byteSize = isStreaming ? 0 : Buffer.byteLength(text, 'utf-8');
        await sendResultStreaming(text, result, durationMs, byteSize);
      } else if (msg.type === 'save') {
        await pushHistory(context, String(msg.expr || ''));
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
      } else if (msg.type === 'exportHistoryJson') {
        await exportHistoryAsJson(context);
      } else if (msg.type === 'importHistoryJson') {
        await importHistoryFromJson(context);
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
        await copyToClipboard(String(msg.text || ''));
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
        const fileType = (msg.fileType || 'json').toLowerCase();
        const ext = getFileExtension(fileType);
        const defaultName = new Date().toISOString().replace(/[:.]/g, '-') + ext;
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
            filters: getFormatFilters(fileType)
        });
        if (uri) {
            let content = '';
            if (msg.text !== undefined && typeof msg.text === 'string') {
                content = msg.text;
            } else if (msg.data !== undefined) {
                content = formatData(msg.data, fileType);
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
            vscode.window.showInformationMessage('File saved: ' + uri.fsPath);
        }
      } else if (msg.type === 'setAiApiKey') {
        const key = typeof msg.apiKey === 'string' ? msg.apiKey.trim() : '';
        if (key) {
          await context.secrets.store(AI_API_KEY_SECRET, key);
        } else {
          await context.secrets.delete(AI_API_KEY_SECRET);
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
                 const storedKey = await context.secrets.get(AI_API_KEY_SECRET);
                 const apiKey = msg.apiKey || storedKey || config.get<string>('aiApiKey') || config.get<string>('geminiApiKey');
                 if (!apiKey) throw new Error('API Key required for Gemini');
                 if (msg.apiKey) {
                   await context.secrets.store(AI_API_KEY_SECRET, msg.apiKey.trim());
                 }
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
        const storedKey = await context.secrets.get(AI_API_KEY_SECRET);
        const apiKey = msg.apiKey || storedKey || config.get<string>('aiApiKey') || config.get<string>('geminiApiKey');
        if (msg.apiKey && provider === 'gemini') {
          await context.secrets.store(AI_API_KEY_SECRET, msg.apiKey.trim());
        }
        const model = msg.model || (provider === 'ollama' ? 'llama3' : 'gemini-1.5-flash');
        
        let dataSample = 'unknown';
        try {
          const dataMap = await buildDataMap();
          const primaryData = dataMap['data'] ?? Object.values(dataMap)[0];
          if (primaryData !== undefined) {
            let sample: any = primaryData;
            if (Array.isArray(primaryData)) {
              sample = primaryData.slice(0, 2);
            }
            dataSample = JSON.stringify(sample).substring(0, 1000);
          }
        } catch (e) { /* ignore */ }


        activeAiController?.abort();
        activeAiController = new AbortController();
        const currentController = activeAiController;

        try {
            let code = '';
            if (provider === 'gemini') {
                if (!apiKey) throw new Error('API Key required for Gemini');
                code = await callGemini(apiKey, model, msg.prompt, dataSample, 30000, currentController.signal);
            } else {
                code = await callOllama(endpoint, model, msg.prompt, dataSample, 30000, currentController.signal);
            }
            panel.webview.postMessage({ type: 'insert', expr: code });
        } catch (err: any) {
            vscode.window.showErrorMessage('AI generation failed: ' + err.message);
            panel.webview.postMessage({ type: 'aiError', error: err.message });
        } finally {
            if (activeAiController === currentController) {
                activeAiController = null;
            }
        }
      }
    } catch (err: any) {
      panel.webview.postMessage({ type: 'result', error: err?.message ?? String(err) });
      vscode.window.showErrorMessage(err?.message ?? String(err));
    }
  });
}

export async function copyToClipboard(text: string) {
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage('Copied to clipboard');
}

/**
 * Backward compatibility alias for copyToClipboard.
 */
export const copyToClipBoard = copyToClipboard;

export async function commandOpenScratchpad(context: vscode.ExtensionContext) {
  return commandOpenQueryEditor(context, { standalone: true });
}
