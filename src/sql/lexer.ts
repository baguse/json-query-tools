/**
 * SQL Lexer / Tokenizer for JSON Tools.
 */

import { Token, TokenType } from './types';

const KEYWORDS: Record<string, TokenType> = {
  SELECT: 'SELECT',
  DISTINCT: 'DISTINCT',
  FROM: 'FROM',
  WHERE: 'WHERE',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  GROUP: 'GROUP',
  BY: 'BY',
  HAVING: 'HAVING',
  ORDER: 'ORDER',
  ASC: 'ASC',
  DESC: 'DESC',
  LIMIT: 'LIMIT',
  OFFSET: 'OFFSET',
  JOIN: 'JOIN',
  INNER: 'INNER',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  FULL: 'FULL',
  CROSS: 'CROSS',
  ON: 'ON',
  AS: 'AS',
  LIKE: 'LIKE',
  ILIKE: 'ILIKE',
  IN: 'IN',
  BETWEEN: 'BETWEEN',
  IS: 'IS',
  NULL: 'NULL',
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  CASE: 'CASE',
  WHEN: 'WHEN',
  THEN: 'THEN',
  ELSE: 'ELSE',
  END: 'END'
};

export class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private len: number;

  constructor(private input: string) {
    this.len = input.length;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.len) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.len) break;

      const ch = this.input[this.pos];
      const startLine = this.line;
      const startCol = this.col;

      // Numbers (digits or dot followed by digit)
      if (this.isDigit(ch) || (ch === '.' && this.pos + 1 < this.len && this.isDigit(this.input[this.pos + 1]))) {
        tokens.push(this.readNumber(startLine, startCol));
        continue;
      }

      // Strings (single or double quotes)
      if (ch === "'" || ch === '"') {
        tokens.push(this.readString(ch, startLine, startCol));
        continue;
      }

      // Quoted identifier: `ident` or [ident]
      if (ch === '`') {
        tokens.push(this.readBacktickIdentifier(startLine, startCol));
        continue;
      }

      // Operators and punctuation
      if (ch === ',') {
        this.advance();
        tokens.push({ type: 'COMMA', value: ',', line: startLine, col: startCol, raw: ',' });
        continue;
      }
      if (ch === ';') {
        this.advance();
        tokens.push({ type: 'SEMICOLON', value: ';', line: startLine, col: startCol, raw: ';' });
        continue;
      }
      if (ch === '(') {
        this.advance();
        tokens.push({ type: 'LPAREN', value: '(', line: startLine, col: startCol, raw: '(' });
        continue;
      }
      if (ch === ')') {
        this.advance();
        tokens.push({ type: 'RPAREN', value: ')', line: startLine, col: startCol, raw: ')' });
        continue;
      }
      if (ch === '[') {
        this.advance();
        tokens.push({ type: 'LBRACKET', value: '[', line: startLine, col: startCol, raw: '[' });
        continue;
      }
      if (ch === ']') {
        this.advance();
        tokens.push({ type: 'RBRACKET', value: ']', line: startLine, col: startCol, raw: ']' });
        continue;
      }
      if (ch === '.') {
        this.advance();
        tokens.push({ type: 'DOT', value: '.', line: startLine, col: startCol, raw: '.' });
        continue;
      }
      if (ch === '+') {
        this.advance();
        tokens.push({ type: 'PLUS', value: '+', line: startLine, col: startCol, raw: '+' });
        continue;
      }
      if (ch === '-') {
        this.advance();
        tokens.push({ type: 'MINUS', value: '-', line: startLine, col: startCol, raw: '-' });
        continue;
      }
      if (ch === '*') {
        this.advance();
        tokens.push({ type: 'STAR', value: '*', line: startLine, col: startCol, raw: '*' });
        continue;
      }
      if (ch === '/') {
        this.advance();
        tokens.push({ type: 'SLASH', value: '/', line: startLine, col: startCol, raw: '/' });
        continue;
      }
      if (ch === '%') {
        this.advance();
        tokens.push({ type: 'PERCENT', value: '%', line: startLine, col: startCol, raw: '%' });
        continue;
      }
      if (ch === '=') {
        this.advance();
        if (this.pos < this.len && this.input[this.pos] === '=') {
          this.advance();
        }
        tokens.push({ type: 'EQ', value: '=', line: startLine, col: startCol, raw: '=' });
        continue;
      }
      if (ch === '!' && this.pos + 1 < this.len && this.input[this.pos + 1] === '=') {
        this.advance();
        this.advance();
        tokens.push({ type: 'NEQ', value: '!=', line: startLine, col: startCol, raw: '!=' });
        continue;
      }
      if (ch === '<') {
        this.advance();
        if (this.pos < this.len && this.input[this.pos] === '>') {
          this.advance();
          tokens.push({ type: 'NEQ', value: '<>', line: startLine, col: startCol, raw: '<>' });
        } else if (this.pos < this.len && this.input[this.pos] === '=') {
          this.advance();
          tokens.push({ type: 'LTE', value: '<=', line: startLine, col: startCol, raw: '<=' });
        } else {
          tokens.push({ type: 'LT', value: '<', line: startLine, col: startCol, raw: '<' });
        }
        continue;
      }
      if (ch === '>') {
        this.advance();
        if (this.pos < this.len && this.input[this.pos] === '=') {
          this.advance();
          tokens.push({ type: 'GTE', value: '>=', line: startLine, col: startCol, raw: '>=' });
        } else {
          tokens.push({ type: 'GT', value: '>', line: startLine, col: startCol, raw: '>' });
        }
        continue;
      }

      // Identifiers & Keywords
      if (this.isIdentStart(ch)) {
        tokens.push(this.readIdentifierOrKeyword(startLine, startCol));
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at line ${startLine}, column ${startCol}`);
    }

    tokens.push({
      type: 'EOF',
      value: '',
      line: this.line,
      col: this.col,
      raw: ''
    });

    return tokens;
  }

  private advance(): string {
    const ch = this.input[this.pos++];
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.len) {
      const ch = this.input[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }

      // Single line comment: -- comment
      if (ch === '-' && this.pos + 1 < this.len && this.input[this.pos + 1] === '-') {
        this.pos += 2;
        this.col += 2;
        while (this.pos < this.len && this.input[this.pos] !== '\n') {
          this.advance();
        }
        continue;
      }

      // Multi line comment: /* comment */
      if (ch === '/' && this.pos + 1 < this.len && this.input[this.pos + 1] === '*') {
        this.pos += 2;
        this.col += 2;
        while (this.pos < this.len) {
          if (this.input[this.pos] === '*' && this.pos + 1 < this.len && this.input[this.pos + 1] === '/') {
            this.pos += 2;
            this.col += 2;
            break;
          }
          this.advance();
        }
        continue;
      }

      break;
    }
  }

  private readNumber(startLine: number, startCol: number): Token {
    let str = '';
    let hasDot = false;
    let hasExp = false;

    while (this.pos < this.len) {
      const ch = this.input[this.pos];
      if (this.isDigit(ch)) {
        str += this.advance();
      } else if (ch === '.' && !hasDot && !hasExp) {
        hasDot = true;
        str += this.advance();
      } else if ((ch === 'e' || ch === 'E') && !hasExp) {
        hasExp = true;
        str += this.advance();
        if (this.pos < this.len && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
          str += this.advance();
        }
      } else {
        break;
      }
    }

    const num = Number(str);
    return {
      type: 'NUMBER',
      value: num,
      line: startLine,
      col: startCol,
      raw: str
    };
  }

  private readString(quote: string, startLine: number, startCol: number): Token {
    this.advance(); // consume opening quote
    let str = '';
    let raw = quote;

    while (this.pos < this.len) {
      const ch = this.input[this.pos];
      if (ch === quote) {
        // SQL escape: '' represents a literal '
        if (quote === "'" && this.pos + 1 < this.len && this.input[this.pos + 1] === "'") {
          str += "'";
          raw += "''";
          this.advance();
          this.advance();
          continue;
        }
        raw += this.advance();
        return {
          type: 'STRING',
          value: str,
          line: startLine,
          col: startCol,
          raw
        };
      }

      if (ch === '\\' && this.pos + 1 < this.len) {
        raw += this.advance();
        const esc = this.advance();
        raw += esc;
        switch (esc) {
          case 'n': str += '\n'; break;
          case 'r': str += '\r'; break;
          case 't': str += '\t'; break;
          case '\\': str += '\\'; break;
          case '\'': str += '\''; break;
          case '"': str += '"'; break;
          default: str += esc; break;
        }
        continue;
      }

      str += ch;
      raw += this.advance();
    }

    throw new Error(`Unterminated string literal starting at line ${startLine}, column ${startCol}`);
  }

  private readBacktickIdentifier(startLine: number, startCol: number): Token {
    this.advance(); // consume `
    let name = '';
    let raw = '`';
    while (this.pos < this.len) {
      const ch = this.input[this.pos];
      if (ch === '`') {
        raw += this.advance();
        return {
          type: 'IDENTIFIER',
          value: name,
          line: startLine,
          col: startCol,
          raw
        };
      }
      name += ch;
      raw += this.advance();
    }
    throw new Error(`Unterminated backtick identifier starting at line ${startLine}, column ${startCol}`);
  }

  private readIdentifierOrKeyword(startLine: number, startCol: number): Token {
    let str = '';
    while (this.pos < this.len && this.isIdentPart(this.input[this.pos])) {
      str += this.advance();
    }

    const upper = str.toUpperCase();
    if (KEYWORDS[upper]) {
      const kwType = KEYWORDS[upper];
      let val: any = upper;
      if (kwType === 'TRUE') val = true;
      else if (kwType === 'FALSE') val = false;
      else if (kwType === 'NULL') val = null;

      return {
        type: kwType,
        value: val,
        line: startLine,
        col: startCol,
        raw: str
      };
    }

    return {
      type: 'IDENTIFIER',
      value: str,
      line: startLine,
      col: startCol,
      raw: str
    };
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
}

export function tokenizeSql(input: string): Token[] {
  const lexer = new Lexer(input);
  return lexer.tokenize();
}
