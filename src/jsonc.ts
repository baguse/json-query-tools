/**
 * Strips single-line (`//`) and multi-line (`/* ... *\/`) comments
 * and trailing commas before `}` or `]` from JSONC text while preserving string literals.
 */
export function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      // Skip string literals
      const quote = ch;
      result += ch;
      i++;
      while (i < text.length) {
        const c = text[i];
        result += c;
        if (c === '\\') { result += text[i + 1] ?? ''; i += 2; continue; }
        if (c === quote) break;
        i++;
      }
      i++;
    } else if (ch === '/' && text[i + 1] === '/') {
      // Single-line comment — skip to end of line
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      // Block comment — skip to closing */
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      result += ch;
      i++;
    }
  }
  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}
