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

let historyWriteQueue: Promise<void> = Promise.resolve();

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

    await context.globalState.update(HISTORY_KEY, list);
  };

  historyWriteQueue = historyWriteQueue.then(op, op);
  return historyWriteQueue;
}

export function getHistory(context: vscode.ExtensionContext): History {
  return normalizeHistory(context.globalState.get<StoredHistory>(HISTORY_KEY) ?? []);
}
