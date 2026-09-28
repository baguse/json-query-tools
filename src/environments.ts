import type * as vscode from 'vscode';
import * as path from 'path';
import { EnvironmentDefinition, EnvironmentsConfigFile, ResolvedEnvironment } from './types';
import { stripJsoncComments } from './jsonc';

export const ENVIRONMENTS_FILE_PATH = '.json-tools/environments.json';

function getVsCode(): typeof vscode | undefined {
  try {
    return typeof require === 'function' ? require('vscode') : undefined;
  } catch {
    return undefined;
  }
}

function joinPathUri(v: any, baseUri: vscode.Uri, ...pathSegments: string[]): vscode.Uri {
  if (v?.Uri && typeof v.Uri.joinPath === 'function') {
    return v.Uri.joinPath(baseUri, ...pathSegments);
  }
  const baseFsPath = baseUri?.fsPath || baseUri?.path || '';
  const joined = path.join(baseFsPath, ...pathSegments);
  return (v?.Uri?.file ? v.Uri.file(joined) : { fsPath: joined, path: joined, scheme: 'file' }) as vscode.Uri;
}

/**
 * Returns a starter environments template with local, staging, and production sample environments.
 */
export function getStarterEnvironmentsTemplate(): EnvironmentsConfigFile {
  return {
    activeEnvironment: 'staging',
    environments: {
      local: {
        name: 'Local',
        baseUrl: 'http://localhost:3000',
        headers: {
          'X-Debug': 'true'
        },
        variables: {
          apiKey: 'local-dev-key',
          tenantId: 'dev-tenant'
        }
      },
      staging: {
        name: 'Staging',
        baseUrl: 'https://staging-api.example.com',
        headers: {
          'X-Environment': 'staging'
        },
        variables: {
          apiKey: 'staging-secret-key-123',
          tenantId: 'staging-tenant'
        }
      },
      production: {
        name: 'Production',
        baseUrl: 'https://api.example.com',
        headers: {
          'X-Environment': 'production'
        },
        variables: {
          apiKey: '{{$env.PROD_API_KEY}}',
          tenantId: 'prod-tenant'
        }
      }
    },
    globalVariables: {
      apiVersion: 'v1'
    }
  };
}

/**
 * Parses simple or complex .env file content into key-value pairs.
 * Supports:
 * - Comments starting with #
 * - Quoted values (single or double) with escaped quotes
 * - Variable expansion within .env ($VAR or ${VAR})
 * - Trimming and empty line skipping
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!content || typeof content !== 'string') return result;

  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key) continue;

    let val = line.slice(eqIdx + 1).trim();

    // Handle double quotes
    if (val.startsWith('"')) {
      let endIdx = -1;
      let escaped = false;
      for (let i = 1; i < val.length; i++) {
        if (escaped) {
          escaped = false;
        } else if (val[i] === '\\') {
          escaped = true;
        } else if (val[i] === '"') {
          endIdx = i;
          break;
        }
      }
      if (endIdx !== -1) {
        val = val.slice(1, endIdx)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"');
      }
    } else if (val.startsWith("'")) {
      const endIdx = val.indexOf("'", 1);
      if (endIdx !== -1) {
        val = val.slice(1, endIdx);
      }
    } else {
      // Unquoted: strip trailing inline comments
      const commentIdx = val.indexOf(' #');
      if (commentIdx !== -1) {
        val = val.slice(0, commentIdx).trim();
      }
    }

    result[key] = val;
  }

  return result;
}

/**
 * Extracts all variables and default headers from an environment definition.
 */
export function extractEnvironmentVariables(envDef?: EnvironmentDefinition): {
  variables: Record<string, string>;
  defaultHeaders: Record<string, string>;
} {
  const variables: Record<string, string> = {};
  const defaultHeaders: Record<string, string> = {};

  if (!envDef || typeof envDef !== 'object') {
    return { variables, defaultHeaders };
  }

  // 1. Base URL
  if (typeof envDef.baseUrl === 'string' && envDef.baseUrl) {
    variables['baseUrl'] = envDef.baseUrl;
    variables['baseURL'] = envDef.baseUrl;
    variables['BASE_URL'] = envDef.baseUrl;
    variables['env.baseUrl'] = envDef.baseUrl;
    variables['env.baseURL'] = envDef.baseUrl;
    variables['env.BASE_URL'] = envDef.baseUrl;
  }

  // 2. Default headers
  if (envDef.headers && typeof envDef.headers === 'object') {
    for (const [k, v] of Object.entries(envDef.headers)) {
      if (typeof v === 'string') {
        defaultHeaders[k] = v;
      }
    }
  }

  // 3. Nested variables dictionary
  if (envDef.variables && typeof envDef.variables === 'object') {
    for (const [k, v] of Object.entries(envDef.variables)) {
      if (v !== null && v !== undefined) {
        variables[k] = String(v);
      }
    }
  }

  // 4. Any top-level primitive properties (excluding reserved keys)
  const reserved = new Set(['name', 'headers', 'variables', 'baseUrl']);
  for (const [k, v] of Object.entries(envDef)) {
    if (!reserved.has(k) && v !== null && v !== undefined && typeof v !== 'object') {
      variables[k] = String(v);
    }
  }

  // Provide env. prefixed aliases for all custom variables
  for (const [k, v] of Object.entries(variables)) {
    if (!k.startsWith('env.')) {
      variables[`env.${k}`] = v;
    }
  }

  return { variables, defaultHeaders };
}

/**
 * Resolves active environment variables and default headers by merging:
 * 1. Global variables
 * 2. .env files
 * 3. Active environment variables
 */
export function resolveActiveEnvironment(
  config: EnvironmentsConfigFile,
  activeEnvName?: string,
  dotEnvVars?: Record<string, string>
): ResolvedEnvironment {
  const envName = (activeEnvName !== undefined ? activeEnvName : config.activeEnvironment) || '';
  const mergedVars: Record<string, string> = {
    ...(config.globalVariables || {}),
    ...(dotEnvVars || {})
  };
  let defaultHeaders: Record<string, string> = {};

  if (envName && config.environments && config.environments[envName]) {
    const envDef = config.environments[envName];
    const extracted = extractEnvironmentVariables(envDef);
    Object.assign(mergedVars, extracted.variables);
    defaultHeaders = extracted.defaultHeaders;
  }

  if (envName) {
    mergedVars['activeEnv'] = envName;
    mergedVars['activeEnvironment'] = envName;
    mergedVars['env.name'] = envName;
    mergedVars['env.activeEnv'] = envName;
    mergedVars['env.activeEnvironment'] = envName;
  }

  // Ensure env. prefix aliases for all merged variables
  for (const [k, v] of Object.entries(mergedVars)) {
    if (!k.startsWith('env.')) {
      mergedVars[`env.${k}`] = v;
    }
  }

  // Ensure baseUrl / baseURL aliases if either exists
  const base = mergedVars['baseUrl'] || mergedVars['baseURL'] || mergedVars['BASE_URL'];
  if (base) {
    mergedVars['baseUrl'] = base;
    mergedVars['baseURL'] = base;
    mergedVars['BASE_URL'] = base;
    mergedVars['env.baseUrl'] = base;
    mergedVars['env.baseURL'] = base;
    mergedVars['env.BASE_URL'] = base;
  }

  return {
    name: envName,
    variables: mergedVars,
    defaultHeaders
  };
}

/**
 * Loads .json-tools/environments.json from the workspace.
 */
export async function loadEnvironmentsConfig(workspaceUri?: vscode.Uri): Promise<EnvironmentsConfigFile> {
  const v = getVsCode();
  const baseUri = workspaceUri ?? v?.workspace?.workspaceFolders?.[0]?.uri;
  if (!v || !baseUri) {
    return { environments: {} };
  }

  const targetFileUri = joinPathUri(v, baseUri, ENVIRONMENTS_FILE_PATH);
  try {
    const bytes = await v.workspace.fs.readFile(targetFileUri);
    const content = Buffer.from(bytes).toString('utf-8');
    const parsed = JSON.parse(stripJsoncComments(content));
    if (parsed && typeof parsed === 'object') {
      return {
        activeEnvironment: typeof parsed.activeEnvironment === 'string' ? parsed.activeEnvironment : undefined,
        environments: (parsed.environments && typeof parsed.environments === 'object') ? parsed.environments : {},
        globalVariables: (parsed.globalVariables && typeof parsed.globalVariables === 'object') ? parsed.globalVariables : {}
      };
    }
  } catch {
    // File doesn't exist or is invalid JSON
  }

  return { environments: {} };
}

/**
 * Saves .json-tools/environments.json to the workspace.
 */
export async function saveEnvironmentsConfig(config: EnvironmentsConfigFile, workspaceUri?: vscode.Uri): Promise<void> {
  const v = getVsCode();
  const baseUri = workspaceUri ?? v?.workspace?.workspaceFolders?.[0]?.uri;
  if (!v || !baseUri) return;

  const targetFileUri = joinPathUri(v, baseUri, ENVIRONMENTS_FILE_PATH);
  const jsonText = JSON.stringify(config, null, 2) + '\n';
  await v.workspace.fs.writeFile(targetFileUri, Buffer.from(jsonText, 'utf-8'));
}

/**
 * Creates default .json-tools/environments.json starter file if it does not already exist.
 * Returns the Uri to the file.
 */
export async function createDefaultEnvironmentsFile(workspaceUri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const v = getVsCode();
  const baseUri = workspaceUri ?? v?.workspace?.workspaceFolders?.[0]?.uri;
  if (!v || !baseUri) return undefined;

  const targetFileUri = joinPathUri(v, baseUri, ENVIRONMENTS_FILE_PATH);
  let exists = false;
  try {
    await v.workspace.fs.stat(targetFileUri);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists) {
    const template = getStarterEnvironmentsTemplate();
    const jsonText = JSON.stringify(template, null, 2) + '\n';
    await v.workspace.fs.writeFile(targetFileUri, Buffer.from(jsonText, 'utf-8'));
  }

  return targetFileUri;
}

/**
 * Loads .env and .env.<activeEnv> files from the workspace root.
 */
export async function loadDotEnvFiles(workspaceUri?: vscode.Uri, activeEnv?: string): Promise<Record<string, string>> {
  const v = getVsCode();
  const baseUri = workspaceUri ?? v?.workspace?.workspaceFolders?.[0]?.uri;
  if (!v || !baseUri) return {};

  const merged: Record<string, string> = {};

  // 1. Read base .env
  try {
    const dotEnvUri = joinPathUri(v, baseUri, '.env');
    const bytes = await v.workspace.fs.readFile(dotEnvUri);
    const content = Buffer.from(bytes).toString('utf-8');
    Object.assign(merged, parseDotEnv(content));
  } catch {
    // .env not present
  }

  // 2. Read .env.<activeEnv> (e.g. .env.staging or .env.local)
  if (activeEnv) {
    try {
      const specificDotEnvUri = joinPathUri(v, baseUri, `.env.${activeEnv}`);
      const bytes = await v.workspace.fs.readFile(specificDotEnvUri);
      const content = Buffer.from(bytes).toString('utf-8');
      Object.assign(merged, parseDotEnv(content));
    } catch {
      // Specific .env.<activeEnv> not present
    }
  }

  return merged;
}
