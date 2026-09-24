import * as vscode from 'vscode';
import { HISTORY_KEY, HISTORY_LIMIT } from './constants';
import { History, HistoryItem, StoredHistory } from './types';

export function normalizeHistory(raw: StoredHistory): History {
  return raw.map(item => {
    if (typeof item === 'string') {
      return { expr: item, isFavorite: false };
    }
    return item;
  });
}

/**
 * Enforces history limit by pruning oldest non-favorites first,
 * and oldest favorites only if non-favorites are exhausted.
 */
export function enforceHistoryLimit(list: HistoryItem[], limit: number = HISTORY_LIMIT): HistoryItem[] {
  if (list.length <= limit) return list;
  const toDelete = new Set<number>();
  let deleted = 0;
  const needed = list.length - limit;

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
  return list.filter((_, i) => !toDelete.has(i));
}

let historyWriteQueue: Promise<unknown> = Promise.resolve();

export function pushHistory(context: vscode.ExtensionContext, expr: string): Promise<void> {
  const op = async () => {
    let list = normalizeHistory(context.globalState.get<StoredHistory>(HISTORY_KEY) ?? []);

    const existingIdx = list.findIndex(e => e.expr === expr);
    let isFav = false;
    let existingName: string | undefined;
    if (existingIdx !== -1) {
      isFav = list[existingIdx].isFavorite;
      existingName = list[existingIdx].name;
      list.splice(existingIdx, 1);
    }

    const newItem: HistoryItem = { expr, isFavorite: isFav };
    if (existingName !== undefined) {
      newItem.name = existingName;
    }
    list.push(newItem);

    list = enforceHistoryLimit(list);

    await context.globalState.update(HISTORY_KEY, list);
  };

  historyWriteQueue = historyWriteQueue.then(op, op);
  return historyWriteQueue as Promise<void>;
}

export function getHistory(context: vscode.ExtensionContext): History {
  return normalizeHistory(context.globalState.get<StoredHistory>(HISTORY_KEY) ?? []);
}

export interface ExportHistoryOptions {
  favoritesOnly?: boolean;
}

/**
 * Serializes query history or favorites into a standard JSON string.
 */
export function serializeHistoryJson(history: History, options?: ExportHistoryOptions): string {
  const items = options?.favoritesOnly ? history.filter(h => h.isFavorite) : history;
  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: items.length,
    queries: items.map(item => {
      const q: HistoryItem = {
        expr: item.expr,
        isFavorite: !!item.isFavorite
      };
      if (item.name) q.name = item.name;
      return q;
    })
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

export interface ParseHistoryResult {
  items: HistoryItem[];
  validCount: number;
  invalidCount: number;
}

/**
 * Parses and validates an imported JSON string containing query history or favorites.
 * Accepts objects with `queries`, `history`, or `favorites` arrays, direct arrays of items/strings,
 * or a single query object.
 */
export function parseHistoryJson(jsonStr: string): ParseHistoryResult {
  if (!jsonStr || typeof jsonStr !== 'string') {
    throw new Error('Input must be a valid JSON string.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    throw new Error(`Invalid JSON syntax: ${err.message}`);
  }

  let rawList: unknown[] = [];

  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.queries)) {
      rawList = obj.queries;
    } else if (Array.isArray(obj.history)) {
      rawList = obj.history;
    } else if (Array.isArray(obj.favorites)) {
      rawList = obj.favorites;
    } else if (typeof obj.expr === 'string' && obj.expr.trim()) {
      rawList = [obj];
    } else {
      throw new Error('JSON object does not contain a "queries", "history", or "favorites" array.');
    }
  } else {
    throw new Error('JSON content must be an array or object containing queries.');
  }

  const items: HistoryItem[] = [];
  let invalidCount = 0;

  for (const entry of rawList) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) {
        items.push({ expr: trimmed, isFavorite: false });
      } else {
        invalidCount++;
      }
    } else if (entry && typeof entry === 'object') {
      const itemObj = entry as Record<string, unknown>;
      const expr = typeof itemObj.expr === 'string' ? itemObj.expr.trim() : '';
      if (!expr) {
        invalidCount++;
        continue;
      }
      const item: HistoryItem = {
        expr,
        isFavorite: Boolean(itemObj.isFavorite)
      };
      if (typeof itemObj.name === 'string' && itemObj.name.trim()) {
        item.name = itemObj.name.trim();
      }
      items.push(item);
    } else {
      invalidCount++;
    }
  }

  return {
    items,
    validCount: items.length,
    invalidCount
  };
}

export interface MergeHistoryResult {
  history: History;
  addedCount: number;
  updatedCount: number;
}

/**
 * Merges incoming query items into existing history.
 * Existing items with matching expression preserve or upgrade their favorite status and name.
 */
export function mergeHistory(existing: History, incoming: HistoryItem[]): MergeHistoryResult {
  const result: HistoryItem[] = [...existing];
  let addedCount = 0;
  let updatedCount = 0;

  for (const item of incoming) {
    const existingIdx = result.findIndex(h => h.expr === item.expr);
    if (existingIdx !== -1) {
      const current = result[existingIdx];
      let updated = false;
      if (item.isFavorite && !current.isFavorite) {
        current.isFavorite = true;
        updated = true;
      }
      if (item.name && item.name !== current.name) {
        current.name = item.name;
        updated = true;
      }
      if (updated) {
        updatedCount++;
      }
    } else {
      result.push({
        expr: item.expr,
        isFavorite: Boolean(item.isFavorite),
        ...(item.name ? { name: item.name } : {})
      });
      addedCount++;
    }
  }

  const pruned = enforceHistoryLimit(result);
  return {
    history: pruned,
    addedCount,
    updatedCount
  };
}

/**
 * Persists imported query items to globalState with either 'merge' or 'replace' mode.
 */
export async function saveImportedHistory(
  context: vscode.ExtensionContext,
  incoming: HistoryItem[],
  mode: 'merge' | 'replace'
): Promise<MergeHistoryResult> {
  const op = async () => {
    const current = getHistory(context);
    let finalHistory: HistoryItem[];
    let addedCount = 0;
    let updatedCount = 0;

    if (mode === 'replace') {
      const map = new Map<string, HistoryItem>();
      for (const item of incoming) {
        const existing = map.get(item.expr);
        if (existing) {
          if (item.isFavorite) existing.isFavorite = true;
          if (item.name) existing.name = item.name;
        } else {
          map.set(item.expr, { ...item });
        }
      }
      finalHistory = enforceHistoryLimit(Array.from(map.values()));
      addedCount = finalHistory.length;
    } else {
      const merged = mergeHistory(current, incoming);
      finalHistory = merged.history;
      addedCount = merged.addedCount;
      updatedCount = merged.updatedCount;
    }

    await context.globalState.update(HISTORY_KEY, finalHistory);
    return {
      history: finalHistory,
      addedCount,
      updatedCount
    };
  };

  historyWriteQueue = historyWriteQueue.then(op, op);
  return historyWriteQueue as Promise<MergeHistoryResult>;
}
