import * as vscode from 'vscode';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface BoundFile {
  type?: 'file';
  alias: string;
  uri: vscode.Uri;
  label?: string;
}

export interface BoundUrl {
  type: 'url';
  id: string;
  alias: string;
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  lastFetched?: number;
}

export type BoundSource = BoundFile | BoundUrl;

export interface SerializedBoundSource {
  type: 'file' | 'url';
  id?: string;
  alias: string;
  label: string;
  url?: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string;
  lastFetched?: number;
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
