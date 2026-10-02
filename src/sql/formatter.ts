/**
 * SQL Formatter / Beautifier for JSON Tools.
 * Nicely formats SQL queries with uppercase keywords and clause indentations.
 */

const MAJOR_CLAUSES = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'JOIN'
];

const SQL_KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'ON', 'AS',
  'LIKE', 'ILIKE', 'IN', 'BETWEEN', 'IS', 'NULL', 'TRUE', 'FALSE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'ROUND', 'UPPER', 'LOWER', 'CONCAT'
]);

export function formatSql(sql: string): string {
  if (!sql || !sql.trim()) return sql;

  // 1. Normalize whitespace, preserving string literals
  const tokens: { type: 'str' | 'code'; text: string }[] = [];
  let pos = 0;
  const len = sql.length;

  while (pos < len) {
    const ch = sql[pos];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let str = ch;
      pos++;
      while (pos < len && sql[pos] !== quote) {
        if (sql[pos] === '\\' && pos + 1 < len) {
          str += sql[pos++];
        }
        str += sql[pos++];
      }
      if (pos < len) str += sql[pos++];
      tokens.push({ type: 'str', text: str });
      continue;
    }

    let code = '';
    while (pos < len && sql[pos] !== "'" && sql[pos] !== '"' && sql[pos] !== '`') {
      code += sql[pos++];
    }
    tokens.push({ type: 'code', text: code });
  }

  // 2. Uppercase keywords in code segments
  let normalized = '';
  for (const tok of tokens) {
    if (tok.type === 'str') {
      normalized += tok.text;
    } else {
      const words = tok.text.replace(/\b([a-zA-Z_]+)\b/g, (match) => {
        const u = match.toUpperCase();
        return SQL_KEYWORDS.has(u) ? u : match;
      });
      normalized += words;
    }
  }

  // 3. Format clauses onto new lines
  // Standardize multi-word clauses first
  normalized = normalized
    .replace(/\bGROUP\s+BY\b/gi, 'GROUP BY')
    .replace(/\bORDER\s+BY\b/gi, 'ORDER BY')
    .replace(/\bINNER\s+JOIN\b/gi, 'INNER JOIN')
    .replace(/\bLEFT\s+(?:OUTER\s+)?JOIN\b/gi, 'LEFT JOIN')
    .replace(/\bRIGHT\s+(?:OUTER\s+)?JOIN\b/gi, 'RIGHT JOIN')
    .replace(/\bFULL\s+(?:OUTER\s+)?JOIN\b/gi, 'FULL JOIN')
    .replace(/\bCROSS\s+JOIN\b/gi, 'CROSS JOIN');

  // Insert line breaks before major clauses
  for (const clause of MAJOR_CLAUSES) {
    const regex = new RegExp(`\\s*\\b(${clause})\\b\\s*`, 'gi');
    normalized = normalized.replace(regex, '\n$1 ');
  }

  // Indent AND / OR under WHERE / HAVING
  normalized = normalized.replace(/\n(WHERE|HAVING)\s+([\s\S]*?)(?=\n[A-Z]+|\s*$)/g, (match, clause, body) => {
    const indented = body
      .replace(/\s*\b(AND|OR)\b\s*/g, '\n  $1 ');
    return `\n${clause} ${indented.trim()}`;
  });

  // Clean up extra blank lines and trim
  return normalized
    .split('\n')
    .map(line => line.trimEnd())
    .filter((line, i, arr) => line.trim() !== '' || (i > 0 && arr[i - 1].trim() !== ''))
    .join('\n')
    .trim();
}
