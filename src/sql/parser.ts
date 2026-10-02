/**
 * SQL Parser for JSON Tools.
 * Recursive-descent parser producing SqlStatement AST.
 */

import { Lexer } from './lexer';
import {
  Token,
  TokenType,
  SqlStatement,
  SelectItem,
  FromClause,
  JoinClause,
  JoinType,
  OrderByItem,
  Expression,
  BinaryExpr,
  UnaryExpr,
  LiteralExpr,
  IdentifierExpr,
  WildcardExpr,
  FunctionCallExpr,
  InExpr,
  BetweenExpr,
  IsNullExpr,
  CaseExpr,
  CaseCondition
} from './types';

export class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(input: string | Token[]) {
    if (typeof input === 'string') {
      const lexer = new Lexer(input);
      this.tokens = lexer.tokenize();
    } else {
      this.tokens = input;
    }
  }

  public parse(): SqlStatement {
    if (this.match('SEMICOLON')) {
      // allow leading semicolons
    }

    if (!this.check('SELECT')) {
      this.error(this.peek(), "Query must begin with 'SELECT'");
    }

    const select = this.parseSelectClause();
    let from: FromClause | undefined;
    const joins: JoinClause[] = [];
    let where: Expression | undefined;
    let groupBy: Expression[] | undefined;
    let having: Expression | undefined;
    let orderBy: OrderByItem[] | undefined;
    let limit: number | undefined;
    let offset: number | undefined;

    if (this.match('FROM')) {
      from = this.parseFromClause();
    }

    // Zero or more JOIN clauses
    while (this.isJoinStart()) {
      joins.push(this.parseJoinClause());
    }

    // WHERE clause
    if (this.match('WHERE')) {
      where = this.parseExpression();
    }

    // GROUP BY clause
    if (this.match('GROUP')) {
      this.consume('BY', "Expected 'BY' after 'GROUP'");
      groupBy = [];
      do {
        groupBy.push(this.parseExpression());
      } while (this.match('COMMA'));
    }

    // HAVING clause
    if (this.match('HAVING')) {
      having = this.parseExpression();
    }

    // ORDER BY clause
    if (this.match('ORDER')) {
      this.consume('BY', "Expected 'BY' after 'ORDER'");
      orderBy = [];
      do {
        const expr = this.parseExpression();
        let direction: 'ASC' | 'DESC' = 'ASC';
        if (this.match('DESC')) {
          direction = 'DESC';
        } else if (this.match('ASC')) {
          direction = 'ASC';
        }
        orderBy.push({ expr, direction });
      } while (this.match('COMMA'));
    }

    // LIMIT / OFFSET
    if (this.match('LIMIT')) {
      const limitToken = this.consume('NUMBER', "Expected number after 'LIMIT'");
      let firstNum = Number(limitToken.value);

      if (this.match('COMMA')) {
        // LIMIT offset, count
        const secondToken = this.consume('NUMBER', 'Expected number after comma in LIMIT');
        offset = firstNum;
        limit = Number(secondToken.value);
      } else {
        limit = firstNum;
        if (this.match('OFFSET')) {
          const offsetToken = this.consume('NUMBER', "Expected number after 'OFFSET'");
          offset = Number(offsetToken.value);
        }
      }
    } else if (this.match('OFFSET')) {
      const offsetToken = this.consume('NUMBER', "Expected number after 'OFFSET'");
      offset = Number(offsetToken.value);
      if (this.match('LIMIT')) {
        const limitToken = this.consume('NUMBER', "Expected number after 'LIMIT'");
        limit = Number(limitToken.value);
      }
    }

    if (this.match('SEMICOLON')) {
      // trailing semicolon is optional
    }

    if (!this.isAtEnd()) {
      this.error(this.peek(), `Unexpected token '${this.peek().raw}' after query`);
    }

    return {
      select,
      from,
      joins,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset
    };
  }

  // --- Clauses ---

  private parseSelectClause(): { distinct: boolean; items: SelectItem[] } {
    this.consume('SELECT', "Expected 'SELECT'");
    let distinct = false;
    if (this.match('DISTINCT')) {
      distinct = true;
    }

    const items: SelectItem[] = [];
    do {
      items.push(this.parseSelectItem());
    } while (this.match('COMMA'));

    return { distinct, items };
  }

  private parseSelectItem(): SelectItem {
    // Wildcard: SELECT *
    if (this.check('STAR')) {
      this.advance();
      return {
        expr: { type: 'wildcard' },
        isWildcard: true
      };
    }

    // Wildcard on table: SELECT u.*
    if (this.check('IDENTIFIER') && this.checkAhead(1, 'DOT') && this.checkAhead(2, 'STAR')) {
      const tableToken = this.advance(); // table
      this.advance(); // dot
      this.advance(); // star
      return {
        expr: { type: 'wildcard', table: String(tableToken.value) },
        isWildcard: true,
        wildcardTable: String(tableToken.value)
      };
    }

    const expr = this.parseExpression();
    let alias: string | undefined;

    if (this.match('AS')) {
      const aliasToken = this.consumeIdentifierOrString("Expected alias name after 'AS'");
      alias = String(aliasToken.value);
    } else if (this.check('IDENTIFIER') && !this.isClauseKeyword(this.peek().type)) {
      // Implicit alias: SELECT id userId
      const aliasToken = this.advance();
      alias = String(aliasToken.value);
    }

    return { expr, alias };
  }

  private parseFromClause(): FromClause {
    const sourceToken = this.consumeIdentifierOrString("Expected table or source name after 'FROM'");
    let source = String(sourceToken.value);

    // Support dotted source path: e.g. FROM data.users
    while (this.match('DOT')) {
      const part = this.consumeIdentifierOrString('Expected property name after dot in FROM clause');
      source += '.' + String(part.value);
    }

    let alias: string | undefined;
    if (this.match('AS')) {
      const aliasToken = this.consumeIdentifierOrString("Expected alias name after 'AS'");
      alias = String(aliasToken.value);
    } else if (this.check('IDENTIFIER') && !this.isClauseKeyword(this.peek().type) && !this.isJoinStart()) {
      const aliasToken = this.advance();
      alias = String(aliasToken.value);
    }

    return { source, alias };
  }

  private isJoinStart(): boolean {
    if (this.check('JOIN')) return true;
    if (this.check('INNER') && this.checkAhead(1, 'JOIN')) return true;
    if (this.check('LEFT') && (this.checkAhead(1, 'JOIN') || (this.checkAhead(1, 'IDENTIFIER') && String(this.peekAhead(1).value).toUpperCase() === 'OUTER' && this.checkAhead(2, 'JOIN')))) return true;
    if (this.check('RIGHT') && (this.checkAhead(1, 'JOIN') || (this.checkAhead(1, 'IDENTIFIER') && String(this.peekAhead(1).value).toUpperCase() === 'OUTER' && this.checkAhead(2, 'JOIN')))) return true;
    if (this.check('FULL') && (this.checkAhead(1, 'JOIN') || (this.checkAhead(1, 'IDENTIFIER') && String(this.peekAhead(1).value).toUpperCase() === 'OUTER' && this.checkAhead(2, 'JOIN')))) return true;
    if (this.check('CROSS') && this.checkAhead(1, 'JOIN')) return true;
    return false;
  }

  private parseJoinClause(): JoinClause {
    let joinType: JoinType = 'INNER';

    if (this.match('INNER')) {
      this.consume('JOIN', "Expected 'JOIN' after 'INNER'");
      joinType = 'INNER';
    } else if (this.match('LEFT')) {
      if (this.check('IDENTIFIER') && String(this.peek().value).toUpperCase() === 'OUTER') {
        this.advance();
      }
      this.consume('JOIN', "Expected 'JOIN' after 'LEFT'");
      joinType = 'LEFT';
    } else if (this.match('RIGHT')) {
      if (this.check('IDENTIFIER') && String(this.peek().value).toUpperCase() === 'OUTER') {
        this.advance();
      }
      this.consume('JOIN', "Expected 'JOIN' after 'RIGHT'");
      joinType = 'RIGHT';
    } else if (this.match('FULL')) {
      if (this.check('IDENTIFIER') && String(this.peek().value).toUpperCase() === 'OUTER') {
        this.advance();
      }
      this.consume('JOIN', "Expected 'JOIN' after 'FULL'");
      joinType = 'FULL';
    } else if (this.match('CROSS')) {
      this.consume('JOIN', "Expected 'JOIN' after 'CROSS'");
      joinType = 'CROSS';
    } else {
      this.consume('JOIN', "Expected 'JOIN'");
      joinType = 'INNER';
    }

    const sourceToken = this.consumeIdentifierOrString("Expected table/source name after 'JOIN'");
    let source = String(sourceToken.value);
    while (this.match('DOT')) {
      const part = this.consumeIdentifierOrString('Expected property name after dot in JOIN source');
      source += '.' + String(part.value);
    }

    let alias: string | undefined;
    if (this.match('AS')) {
      const aliasToken = this.consumeIdentifierOrString("Expected alias name after 'AS'");
      alias = String(aliasToken.value);
    } else if (this.check('IDENTIFIER') && !this.check('ON') && !this.isClauseKeyword(this.peek().type)) {
      const aliasToken = this.advance();
      alias = String(aliasToken.value);
    }

    let on: Expression | undefined;
    if (this.match('ON')) {
      on = this.parseExpression();
    } else if (joinType !== 'CROSS') {
      this.error(this.peek(), `Expected 'ON' condition for ${joinType} JOIN`);
    }

    return { joinType, source, alias, on };
  }

  // --- Expressions ---

  public parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let expr = this.parseAnd();

    while (this.match('OR')) {
      const right = this.parseAnd();
      expr = {
        type: 'binary',
        left: expr,
        op: 'OR',
        right
      };
    }

    return expr;
  }

  private parseAnd(): Expression {
    let expr = this.parseNot();

    while (this.match('AND')) {
      const right = this.parseNot();
      expr = {
        type: 'binary',
        left: expr,
        op: 'AND',
        right
      };
    }

    return expr;
  }

  private parseNot(): Expression {
    if (this.match('NOT')) {
      const expr = this.parseNot();
      return {
        type: 'unary',
        op: 'NOT',
        expr
      };
    }

    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let expr = this.parseAdditive();

    while (true) {
      if (this.match('IS')) {
        let not = false;
        if (this.match('NOT')) {
          not = true;
        }
        this.consume('NULL', "Expected 'NULL' after 'IS' or 'IS NOT'");
        expr = { type: 'isNull', expr, not };
        continue;
      }

      if (this.match('BETWEEN')) {
        const low = this.parseAdditive();
        this.consume('AND', "Expected 'AND' in 'BETWEEN ... AND ...'");
        const high = this.parseAdditive();
        expr = { type: 'between', expr, low, high, not: false };
        continue;
      }

      if (this.match('NOT')) {
        if (this.match('BETWEEN')) {
          const low = this.parseAdditive();
          this.consume('AND', "Expected 'AND' in 'NOT BETWEEN ... AND ...'");
          const high = this.parseAdditive();
          expr = { type: 'between', expr, low, high, not: true };
          continue;
        }
        if (this.match('IN')) {
          this.consume('LPAREN', "Expected '(' after 'NOT IN'");
          const list: Expression[] = [];
          if (!this.check('RPAREN')) {
            do {
              list.push(this.parseExpression());
            } while (this.match('COMMA'));
          }
          this.consume('RPAREN', "Expected ')' after list in 'NOT IN'");
          expr = { type: 'in', expr, list, not: true };
          continue;
        }
        if (this.match('LIKE')) {
          const pattern = this.parseAdditive();
          expr = { type: 'binary', left: expr, op: 'NOT LIKE', right: pattern };
          continue;
        }
        if (this.match('ILIKE')) {
          const pattern = this.parseAdditive();
          expr = { type: 'binary', left: expr, op: 'NOT ILIKE', right: pattern };
          continue;
        }
        this.error(this.peek(), "Expected 'BETWEEN', 'IN', or 'LIKE' after 'NOT'");
      }

      if (this.match('IN')) {
        this.consume('LPAREN', "Expected '(' after 'IN'");
        const list: Expression[] = [];
        if (!this.check('RPAREN')) {
          do {
            list.push(this.parseExpression());
          } while (this.match('COMMA'));
        }
        this.consume('RPAREN', "Expected ')' after list in 'IN'");
        expr = { type: 'in', expr, list, not: false };
        continue;
      }

      if (this.match('LIKE')) {
        const pattern = this.parseAdditive();
        expr = { type: 'binary', left: expr, op: 'LIKE', right: pattern };
        continue;
      }

      if (this.match('ILIKE')) {
        const pattern = this.parseAdditive();
        expr = { type: 'binary', left: expr, op: 'ILIKE', right: pattern };
        continue;
      }

      if (this.match('EQ') || this.match('NEQ') || this.match('LT') || this.match('LTE') || this.match('GT') || this.match('GTE')) {
        const op = this.previous().raw;
        const right = this.parseAdditive();
        expr = { type: 'binary', left: expr, op, right };
        continue;
      }

      break;
    }

    return expr;
  }

  private parseAdditive(): Expression {
    let expr = this.parseMultiplicative();

    while (this.match('PLUS') || this.match('MINUS')) {
      const op = this.previous().raw;
      const right = this.parseMultiplicative();
      expr = { type: 'binary', left: expr, op, right };
    }

    return expr;
  }

  private parseMultiplicative(): Expression {
    let expr = this.parseUnary();

    while (this.match('STAR') || this.match('SLASH') || this.match('PERCENT')) {
      const op = this.previous().raw;
      const right = this.parseUnary();
      expr = { type: 'binary', left: expr, op, right };
    }

    return expr;
  }

  private parseUnary(): Expression {
    if (this.match('MINUS') || this.match('PLUS')) {
      const op = this.previous().raw;
      const expr = this.parseUnary();
      return { type: 'unary', op, expr };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    // Parenthesized expression
    if (this.match('LPAREN')) {
      const expr = this.parseExpression();
      this.consume('RPAREN', "Expected ')' after expression");
      return expr;
    }

    // Literals
    if (this.match('NUMBER')) {
      return { type: 'literal', value: Number(this.previous().value) };
    }
    if (this.match('STRING')) {
      return { type: 'literal', value: String(this.previous().value) };
    }
    if (this.match('TRUE')) {
      return { type: 'literal', value: true };
    }
    if (this.match('FALSE')) {
      return { type: 'literal', value: false };
    }
    if (this.match('NULL')) {
      return { type: 'literal', value: null };
    }

    // CASE expression: CASE WHEN ... THEN ... [ELSE ...] END
    if (this.match('CASE')) {
      return this.parseCaseExpression();
    }

    // Identifier / Function call / Member path
    if (this.check('IDENTIFIER')) {
      return this.parseIdentifierOrCall();
    }

    // Star standalone (e.g. inside COUNT(*))
    if (this.match('STAR')) {
      return { type: 'wildcard' };
    }

    throw this.error(this.peek(), `Unexpected token '${this.peek().raw || this.peek().type}' in expression`);
  }

  private parseCaseExpression(): CaseExpr {
    const conditions: CaseCondition[] = [];
    while (this.match('WHEN')) {
      const when = this.parseExpression();
      this.consume('THEN', "Expected 'THEN' after 'WHEN'");
      const then = this.parseExpression();
      conditions.push({ when, then });
    }

    let elseExpr: Expression | undefined;
    if (this.match('ELSE')) {
      elseExpr = this.parseExpression();
    }

    this.consume('END', "Expected 'END' to close 'CASE'");
    return { type: 'case', conditions, else: elseExpr };
  }

  private parseIdentifierOrCall(): Expression {
    const token = this.advance();
    const name = String(token.value);

    // Function call: func(...)
    if (this.match('LPAREN')) {
      let isDistinct = false;
      if (this.match('DISTINCT')) {
        isDistinct = true;
      }

      const args: Expression[] = [];
      if (!this.check('RPAREN')) {
        do {
          if (this.match('STAR')) {
            args.push({ type: 'wildcard' });
          } else {
            args.push(this.parseExpression());
          }
        } while (this.match('COMMA'));
      }
      this.consume('RPAREN', `Expected ')' after arguments in '${name}(...)'`);
      return {
        type: 'call',
        name,
        args,
        isDistinct
      };
    }

    // Dotted or bracketed property access: user.address.city, items[0].id
    const path: (string | number)[] = [name];
    let table: string | undefined;

    while (this.check('DOT') || this.check('LBRACKET')) {
      if (this.match('DOT')) {
        if (this.match('STAR')) {
          // table.* as an expression
          table = path.join('.');
          return { type: 'wildcard', table };
        }
        const propToken = this.consumeIdentifierOrString("Expected property name after '.'");
        path.push(String(propToken.value));
      } else if (this.match('LBRACKET')) {
        const idxToken = this.consume('NUMBER', "Expected numeric index inside '['");
        path.push(Number(idxToken.value));
        this.consume('RBRACKET', "Expected ']' after index");
      }
    }

    // Check if the first segment was an explicit table alias:
    // e.g. u.name -> table: 'u', path: ['name']
    // If path length > 1, the first element might be table alias. We store table as first segment if path > 1.
    return {
      type: 'identifier',
      name: path.join('.'),
      path,
      table: path.length > 1 ? String(path[0]) : undefined
    };
  }

  // --- Helper Methods ---

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return type === 'EOF';
    return this.peek().type === type;
  }

  private checkAhead(offset: number, type: TokenType): boolean {
    const idx = this.current + offset;
    if (idx >= this.tokens.length) return type === 'EOF';
    return this.tokens[idx].type === type;
  }

  private peekAhead(offset: number): Token {
    const idx = this.current + offset;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1];
    return this.tokens[idx];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  private consumeIdentifierOrString(message: string): Token {
    if (this.check('IDENTIFIER') || this.check('STRING')) {
      return this.advance();
    }
    throw this.error(this.peek(), message);
  }

  private isClauseKeyword(type: TokenType): boolean {
    return (
      type === 'FROM' ||
      type === 'WHERE' ||
      type === 'GROUP' ||
      type === 'HAVING' ||
      type === 'ORDER' ||
      type === 'LIMIT' ||
      type === 'OFFSET' ||
      type === 'JOIN' ||
      type === 'INNER' ||
      type === 'LEFT' ||
      type === 'RIGHT' ||
      type === 'FULL' ||
      type === 'CROSS' ||
      type === 'UNION' ||
      type === 'EOF'
    );
  }

  private error(token: Token, message: string): Error {
    const loc = `line ${token.line}, column ${token.col}`;
    const near = token.raw ? ` near '${token.raw}'` : '';
    return new Error(`SQL syntax error${near} at ${loc}: ${message}`);
  }
}

export function parseSql(input: string): SqlStatement {
  const parser = new Parser(input);
  return parser.parse();
}
