/**
 * Multi-format export serializer for JSON Tools.
 * Supports:
 * - JSON (.json)
 * - CSV (.csv)
 * - YAML (.yaml)
 * - NDJSON / JSON Lines (.ndjson, .jsonl)
 * - XML (.xml)
 */

export type ExportFormat = 'json' | 'csv' | 'yaml' | 'ndjson' | 'xml';

const XML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
};

export function escapeXml(str: string): string {
  return str.replace(/[&<>"']/g, ch => XML_ESCAPE_MAP[ch] || ch);
}

export function sanitizeXmlTagName(key: string): string {
  if (!key || typeof key !== 'string') return 'item';
  let tag = key.trim().replace(/[^a-zA-Z0-9_.-]/g, '_');
  // XML tag cannot start with a number, period, or hyphen
  if (/^[0-9.-]/.test(tag)) {
    tag = '_' + tag;
  }
  return tag || 'item';
}

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Serializes data into CSV format.
 */
export function toCsv(data: unknown): string {
  if (!Array.isArray(data)) {
    if (data !== null && typeof data === 'object') {
      const keys = Object.keys(data as Record<string, unknown>);
      const header = keys.map(escapeCsvCell).join(',');
      const row = keys.map(k => escapeCsvCell((data as Record<string, unknown>)[k])).join(',');
      return `${header}\n${row}`;
    }
    return data !== null && data !== undefined ? escapeCsvCell(data) : '';
  }

  if (data.length === 0) return '';

  let hasObjects = false;
  const allKeys = new Set<string>();

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      hasObjects = true;
      for (const k of Object.keys(item)) {
        allKeys.add(k);
      }
    }
  }

  const rows: string[] = [];

  if (hasObjects && allKeys.size > 0) {
    const keys = Array.from(allKeys);
    rows.push(keys.map(escapeCsvCell).join(','));
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const row: string[] = [];
      for (let j = 0; j < keys.length; j++) {
        const val = item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)[keys[j]]
          : '';
        row.push(escapeCsvCell(val));
      }
      rows.push(row.join(','));
    }
  } else {
    // Array of primitives
    rows.push('Value');
    for (let i = 0; i < data.length; i++) {
      rows.push(escapeCsvCell(data[i]));
    }
  }

  return rows.join('\n');
}

/**
 * Serializes data into Newline-Delimited JSON (NDJSON / JSON Lines).
 */
export function toNdjson(data: unknown): string {
  const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

  if (Array.isArray(data)) {
    if (data.length === 0) return '';
    return data
      .map(item => JSON.stringify(item, replacer))
      .join('\n');
  }

  if (data === undefined || data === null) {
    return '';
  }

  return JSON.stringify(data, replacer);
}

/**
 * Serializes data into clean, readable YAML format.
 */
export function toYaml(data: unknown, indent = 2): string {
  const visited = new WeakSet<object>();

  function formatString(str: string): string {
    if (str === '') return '""';
    // Check if string contains special YAML characters or looks like a keyword/number
    const needsQuotes =
      /[\n\r\t:#@%&*?|>{}\[\],]/.test(str) ||
      /^[-?]/.test(str) ||
      /^\s|\s$/.test(str) ||
      /^(true|false|null|yes|no|on|off|\.nan|\.inf)$/i.test(str) ||
      !isNaN(Number(str));

    if (needsQuotes) {
      return JSON.stringify(str);
    }
    return str;
  }

  function serialize(val: unknown, depth: number, inArray = false): string {
    if (val === null || val === undefined) {
      return 'null';
    }
    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }
    if (typeof val === 'number') {
      if (isNaN(val)) return '.nan';
      if (!isFinite(val)) return val > 0 ? '.inf' : '-.inf';
      return String(val);
    }
    if (typeof val === 'bigint') {
      return val.toString();
    }
    if (typeof val === 'string') {
      return formatString(val);
    }

    if (typeof val === 'object') {
      if (visited.has(val as object)) {
        return '"[Circular]"';
      }
      visited.add(val as object);

      const spaces = ' '.repeat(depth * indent);

      if (Array.isArray(val)) {
        if (val.length === 0) return '[]';
        const lines: string[] = [];
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const keys = Object.keys(item);
            if (keys.length === 0) {
              lines.push(`${spaces}- {}`);
            } else {
              const firstKey = keys[0];
              const firstVal = serialize((item as Record<string, unknown>)[firstKey], depth + 1);
              const isFirstComplex = typeof (item as Record<string, unknown>)[firstKey] === 'object' && (item as Record<string, unknown>)[firstKey] !== null;
              
              if (isFirstComplex && !firstVal.startsWith('[]') && !firstVal.startsWith('{}') && !firstVal.startsWith('"[Circular]"')) {
                lines.push(`${spaces}- ${formatKey(firstKey)}:\n${firstVal}`);
              } else {
                lines.push(`${spaces}- ${formatKey(firstKey)}: ${firstVal}`);
              }

              for (let k = 1; k < keys.length; k++) {
                const subKey = keys[k];
                const subVal = serialize((item as Record<string, unknown>)[subKey], depth + 1);
                const isSubComplex = typeof (item as Record<string, unknown>)[subKey] === 'object' && (item as Record<string, unknown>)[subKey] !== null;
                const subIndent = ' '.repeat(depth * indent + 2);
                if (isSubComplex && !subVal.startsWith('[]') && !subVal.startsWith('{}') && !subVal.startsWith('"[Circular]"')) {
                  lines.push(`${subIndent}${formatKey(subKey)}:\n${subVal}`);
                } else {
                  lines.push(`${subIndent}${formatKey(subKey)}: ${subVal}`);
                }
              }
            }
          } else {
            const subVal = serialize(item, depth + 1, true);
            lines.push(`${spaces}- ${subVal}`);
          }
        }
        return lines.join('\n');
      }

      // Plain Object
      const entries = Object.entries(val as Record<string, unknown>);
      if (entries.length === 0) return '{}';

      const lines: string[] = [];
      for (const [k, v] of entries) {
        const formattedKey = formatKey(k);
        const serializedVal = serialize(v, depth + 1);
        const isComplex = typeof v === 'object' && v !== null;

        if (isComplex && !serializedVal.startsWith('[]') && !serializedVal.startsWith('{}') && !serializedVal.startsWith('"[Circular]"')) {
          lines.push(`${spaces}${formattedKey}:\n${serializedVal}`);
        } else {
          lines.push(`${spaces}${formattedKey}: ${serializedVal}`);
        }
      }
      return lines.join('\n');
    }

    return String(val);
  }

  function formatKey(key: string): string {
    if (/^[a-zA-Z0-9_.-]+$/.test(key) && !/^(true|false|null)$/i.test(key)) {
      return key;
    }
    return JSON.stringify(key);
  }

  const result = serialize(data, 0);
  return result;
}

/**
 * Serializes data into standard XML format.
 */
export function toXml(data: unknown, rootTag = 'root'): string {
  const visited = new WeakSet<object>();

  function serializeNode(val: unknown, tag: string, depth: number): string {
    const spaces = '  '.repeat(depth);
    const safeTag = sanitizeXmlTagName(tag);

    if (val === null || val === undefined) {
      return `${spaces}<${safeTag} />`;
    }

    if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'bigint') {
      return `${spaces}<${safeTag}>${val}</${safeTag}>`;
    }

    if (typeof val === 'string') {
      return `${spaces}<${safeTag}>${escapeXml(val)}</${safeTag}>`;
    }

    if (typeof val === 'object') {
      if (visited.has(val as object)) {
        return `${spaces}<${safeTag}>[Circular]</${safeTag}>`;
      }
      visited.add(val as object);

      if (Array.isArray(val)) {
        if (val.length === 0) {
          return `${spaces}<${safeTag} />`;
        }
        const lines: string[] = [];
        for (let i = 0; i < val.length; i++) {
          lines.push(serializeNode(val[i], 'item', depth));
        }
        return lines.join('\n');
      }

      // Plain Object
      const entries = Object.entries(val as Record<string, unknown>);
      if (entries.length === 0) {
        return `${spaces}<${safeTag} />`;
      }

      const innerLines: string[] = [];
      for (const [k, v] of entries) {
        if (Array.isArray(v)) {
          const itemTag = sanitizeXmlTagName(k);
          if (v.length === 0) {
            innerLines.push(`${spaces}  <${itemTag} />`);
          } else {
            for (let i = 0; i < v.length; i++) {
              innerLines.push(serializeNode(v[i], itemTag, depth + 1));
            }
          }
        } else {
          innerLines.push(serializeNode(v, k, depth + 1));
        }
      }

      return `${spaces}<${safeTag}>\n${innerLines.join('\n')}\n${spaces}</${safeTag}>`;
    }

    return `${spaces}<${safeTag}>${escapeXml(String(val))}</${safeTag}>`;
  }

  const safeRoot = sanitizeXmlTagName(rootTag);
  let body = '';

  if (Array.isArray(data)) {
    if (data.length === 0) {
      body = `<${safeRoot} />`;
    } else {
      const items = data.map(item => serializeNode(item, 'item', 1)).join('\n');
      body = `<${safeRoot}>\n${items}\n</${safeRoot}>`;
    }
  } else if (typeof data === 'object' && data !== null) {
    body = serializeNode(data, safeRoot, 0);
  } else {
    body = `<${safeRoot}>${data !== null && data !== undefined ? escapeXml(String(data)) : ''}</${safeRoot}>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

/**
 * Serializes data into formatted JSON string.
 */
export function toJson(data: unknown, indent = 2): string {
  try {
    return JSON.stringify(
      data,
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
      indent
    ) ?? (data !== undefined ? String(data) : 'undefined');
  } catch {
    return String(data);
  }
}

/**
 * Universal formatter that converts arbitrary data to the specified export format.
 */
export function formatData(data: unknown, format: ExportFormat | string): string {
  const norm = (format || 'json').toLowerCase();
  switch (norm) {
    case 'csv':
      return toCsv(data);
    case 'yaml':
    case 'yml':
      return toYaml(data);
    case 'ndjson':
    case 'jsonl':
      return toNdjson(data);
    case 'xml':
      return toXml(data);
    case 'json':
    default:
      return toJson(data, 2);
  }
}

export function getFileExtension(format: ExportFormat | string): string {
  const norm = (format || 'json').toLowerCase();
  switch (norm) {
    case 'csv': return '.csv';
    case 'yaml':
    case 'yml': return '.yaml';
    case 'ndjson':
    case 'jsonl': return '.ndjson';
    case 'xml': return '.xml';
    case 'json':
    default: return '.json';
  }
}

export function getLanguageId(format: ExportFormat | string): string {
  const norm = (format || 'json').toLowerCase();
  switch (norm) {
    case 'csv': return 'csv';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'ndjson':
    case 'jsonl': return 'jsonl';
    case 'xml': return 'xml';
    case 'json':
    default: return 'json';
  }
}

export function getMimeType(format: ExportFormat | string): string {
  const norm = (format || 'json').toLowerCase();
  switch (norm) {
    case 'csv': return 'text/csv';
    case 'yaml':
    case 'yml': return 'text/yaml';
    case 'ndjson':
    case 'jsonl': return 'application/x-ndjson';
    case 'xml': return 'application/xml';
    case 'json':
    default: return 'application/json';
  }
}

export function getFormatFilters(format: ExportFormat | string): Record<string, string[]> {
  const norm = (format || 'json').toLowerCase();
  switch (norm) {
    case 'csv': return { 'CSV': ['csv'] };
    case 'yaml':
    case 'yml': return { 'YAML': ['yaml', 'yml'] };
    case 'ndjson':
    case 'jsonl': return { 'NDJSON': ['ndjson', 'jsonl'] };
    case 'xml': return { 'XML': ['xml'] };
    case 'json':
    default: return { 'JSON': ['json'] };
  }
}
