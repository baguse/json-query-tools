import * as vscode from 'vscode';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface BoundFile {
  type?: 'file';
  alias: string;
  uri: vscode.Uri;
  label?: string;
}

export type StreamMode = 'none' | 'poll' | 'sse' | 'ws';

export interface StreamEvent {
  event?: string;
  data: unknown;
  id?: string;
  timestamp: number;
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
  lastResponseHeaders?: Record<string, string>;
  lastStatus?: number;
  lastStatusText?: string;
  streamMode?: StreamMode;
  pollIntervalMs?: number;
  isStreaming?: boolean;
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
  lastResponseHeaders?: Record<string, string>;
  lastStatus?: number;
  lastStatusText?: string;
  streamMode?: StreamMode;
  pollIntervalMs?: number;
  isStreaming?: boolean;
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

// Environment & Config types
export interface EnvironmentDefinition {
  name?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  variables?: Record<string, string>;
  [key: string]: unknown;
}

export interface EnvironmentsConfigFile {
  activeEnvironment?: string;
  environments: Record<string, EnvironmentDefinition>;
  globalVariables?: Record<string, string>;
}

export interface ResolvedEnvironment {
  name: string;
  variables: Record<string, string>;
  defaultHeaders: Record<string, string>;
}
