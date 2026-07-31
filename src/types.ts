import * as vscode from 'vscode';

export interface BoundFile {
  alias: string;
  uri: vscode.Uri;
}

// Schema inference types
export interface SchemaInfo {
  type: 'object' | 'array' | 'primitive';
  properties?: Record<string, PropertyInfo>;
  items?: SchemaInfo;
  valueType?: string | string[];
}

export interface PropertyInfo {
  name: string;
  type: string | string[];
  properties?: Record<string, PropertyInfo>;
  items?: SchemaInfo;
  optional?: boolean;
}

export interface HistoryItem {
  expr: string;
  isFavorite: boolean;
  name?: string;
}

export type StoredHistory = (string | HistoryItem)[];
export type History = HistoryItem[];
