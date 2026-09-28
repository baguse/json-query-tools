/**
 * Template variable resolution engine for JSON Tools.
 * Supports:
 * - Environment variables: {{$env.VAR_NAME}} and {{env.VAR_NAME}}
 * - Built-in file variables: {{fileName}}, {{filePath}}, {{fileDir}}, {{workspaceFolder}}
 * - Built-in URL context variables: {{url}}, {{host}}, {{hostname}}, {{origin}}, {{pathname}}, {{method}}, {{alias}}
 * - Custom variables configured in VS Code settings (jsonQueryTools.templateVariables)
 * - Safe whitespace tolerance inside braces (e.g. {{ $env.API_KEY }})
 * - Percent-encoded brace tolerance for URLs (%7B%7B...%7D%7D)
 * - Preservation of unmatched variables (e.g. {{unknown}})
 */

export interface UrlTemplateContext {
  url?: string;
  method?: string;
  alias?: string;
}

export interface TemplateResolutionOptions {
  workspaceFolder?: string;
  targetPath?: string;
  urlContext?: UrlTemplateContext;
  customVariables?: Record<string, string>;
  env?: Record<string, string | undefined>;
}

/**
 * Builds a dictionary of built-in and custom template variables.
 */
export function getBuiltinVariables(options?: TemplateResolutionOptions): Record<string, string> {
  const custom = options?.customVariables ?? {};
  const builtins: Record<string, string> = { ...custom };

  if (options?.targetPath) {
    const normalizedFsPath = options.targetPath.replace(/\\/g, '/');
    const parts = normalizedFsPath.split('/');
    builtins['fileName'] = parts[parts.length - 1] ?? '';
    builtins['filePath'] = normalizedFsPath;
    const dirParts = parts.slice(0, -1);
    builtins['fileDir'] = dirParts.length === 1 && dirParts[0] === '' ? '/' : dirParts.join('/');
  }

  if (options?.workspaceFolder) {
    builtins['workspaceFolder'] = options.workspaceFolder.replace(/\\/g, '/');
  }

  if (options?.urlContext) {
    const ctx = options.urlContext;
    if (ctx.url !== undefined) {
      builtins['url'] = ctx.url;
      try {
        const parsed = new URL(ctx.url);
        builtins['host'] = parsed.host;
        builtins['hostname'] = parsed.hostname;
        builtins['origin'] = parsed.origin;
        builtins['pathname'] = parsed.pathname;
        if (parsed.port) {
          builtins['port'] = parsed.port;
        }
        if (parsed.protocol) {
          builtins['protocol'] = parsed.protocol.replace(/:$/, '');
        }
      } catch {
        // If not a standard URL, don't fail; just provide what we can
      }
    }
    if (ctx.method !== undefined) {
      builtins['method'] = (ctx.method || 'GET').toUpperCase();
    }
    if (ctx.alias !== undefined) {
      builtins['alias'] = ctx.alias;
    }
  }

  return builtins;
}

/**
 * Substitutes variables in template string.
 * Supports:
 * - {{varName}} and {{ varName }}
 * - %7B%7BvarName%7D%7D and %7b%7bvarName%7d%7d (URL percent-encoded braces)
 * - Environment variables: {{$env.VAR_NAME}} and {{env.VAR_NAME}}
 * - Workspace / file / URL built-in variables
 * - Custom variables
 * - Unknown variables are preserved intact (e.g. {{unknown}} remains {{unknown}})
 */
function isTemplateResolutionOptions(obj: unknown): obj is TemplateResolutionOptions {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    'customVariables' in o ||
    'targetPath' in o ||
    'urlContext' in o ||
    ('env' in o && typeof o.env === 'object')
  );
}

export function resolveVariables(
  template: string,
  optionsOrVars?: TemplateResolutionOptions | Record<string, string>
): string {
  if (!template || typeof template !== 'string') {
    return template ?? '';
  }

  let vars: Record<string, string>;
  let envSource: Record<string, string | undefined> = process.env;

  if (isTemplateResolutionOptions(optionsOrVars)) {
    vars = getBuiltinVariables(optionsOrVars);
    if (optionsOrVars.env) {
      envSource = optionsOrVars.env;
    }
  } else {
    vars = (optionsOrVars as Record<string, string>) || {};
  }

  const regex = /(?:\{\{|%7B%7B)\s*([a-zA-Z0-9_$.-]+)\s*(?:\}\}|%7D%7D)/gi;

  return template.replace(regex, (fullMatch, rawKey: string) => {
    const key = rawKey.trim();

    // 1. Direct variable match in vars map
    if (Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined) {
      return vars[key];
    }

    // 2. Environment variable: {{$env.VAR_NAME}} or {{env.VAR_NAME}}
    if (key.startsWith('$env.') || key.startsWith('env.')) {
      const envKey = key.startsWith('$env.') ? key.slice(5) : key.slice(4);
      if (Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined) {
        return vars[key];
      }
      if (Object.prototype.hasOwnProperty.call(vars, envKey) && vars[envKey] !== undefined) {
        return vars[envKey];
      }
      const lowerEnvKey = envKey.toLowerCase();
      for (const [k, v] of Object.entries(vars)) {
        const lk = k.toLowerCase();
        if (lk === lowerEnvKey || lk === `env.${lowerEnvKey}` || lk === `$env.${lowerEnvKey}`) {
          return v;
        }
      }
      const envVal = envSource[envKey] ?? envSource[envKey.toUpperCase()] ?? envSource[envKey.toLowerCase()];
      return envVal !== undefined ? envVal : '';
    }

    // Case-insensitive fallback across vars
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(vars)) {
      if (k.toLowerCase() === lowerKey) {
        return v;
      }
    }

    // 3. Fallback: preserve unmatched placeholder
    return fullMatch;
  });
}

/**
 * Resolves template variables in URL, headers, and body for HTTP requests.
 */
export function resolveFetchOptions<
  T extends {
    url: string;
    method?: string;
    headers?: Record<string, string> | string;
    body?: string;
    templateVariables?: Record<string, string>;
    templateOptions?: TemplateResolutionOptions;
  }
>(options: T, additionalOptions?: TemplateResolutionOptions): T {
  const mergedCustomVars: Record<string, string> = {
    ...(additionalOptions?.customVariables ?? {}),
    ...(options.templateOptions?.customVariables ?? {}),
    ...(options.templateVariables ?? {})
  };

  const baseOptions: TemplateResolutionOptions = {
    ...additionalOptions,
    ...options.templateOptions,
    customVariables: mergedCustomVars,
    env: options.templateOptions?.env ?? additionalOptions?.env ?? process.env
  };

  // Step 1: Resolve the URL
  const resolvedUrl = resolveVariables(options.url || '', baseOptions);

  // Step 2: Extract URL context from resolved URL
  const urlContext: UrlTemplateContext = {
    url: resolvedUrl,
    method: options.method,
    alias: baseOptions.urlContext?.alias
  };

  const fullOptions: TemplateResolutionOptions = {
    ...baseOptions,
    urlContext
  };

  // Step 3: Resolve headers
  let resolvedHeaders: Record<string, string> | string | undefined = options.headers;
  if (typeof options.headers === 'string') {
    resolvedHeaders = resolveVariables(options.headers, fullOptions);
  } else if (typeof options.headers === 'object' && options.headers !== null) {
    const newHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(options.headers)) {
      const resolvedK = resolveVariables(k, fullOptions);
      const resolvedV = resolveVariables(String(v), fullOptions);
      newHeaders[resolvedK] = resolvedV;
    }
    resolvedHeaders = newHeaders;
  }

  // Step 4: Resolve body
  let resolvedBody: string | undefined = options.body;
  if (typeof options.body === 'string') {
    resolvedBody = resolveVariables(options.body, fullOptions);
  }

  return {
    ...options,
    url: resolvedUrl,
    headers: resolvedHeaders,
    body: resolvedBody
  };
}
