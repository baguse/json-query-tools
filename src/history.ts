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

export function pushHistory(context: vscode.ExtensionContext, expr: string) {
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

export function getHistory(context: vscode.ExtensionContext): History {
  return normalizeHistory(context.globalState.get<StoredHistory>(HISTORY_KEY) ?? []);
}
