/**
 * SQL Query Engine Types and AST Definitions for JSON Tools.
 */

export type TokenType =
  // Keywords
  | 'SELECT'
  | 'DISTINCT'
  | 'FROM'
  | 'WHERE'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'GROUP'
  | 'BY'
  | 'HAVING'
  | 'ORDER'
  | 'ASC'
  | 'DESC'
  | 'LIMIT'
  | 'OFFSET'
  | 'JOIN'
  | 'INNER'
  | 'LEFT'
  | 'RIGHT'
  | 'FULL'
  | 'CROSS'
  | 'ON'
  | 'AS'
  | 'LIKE'
  | 'ILIKE'
  | 'IN'
  | 'BETWEEN'
  | 'IS'
  | 'NULL'
  | 'TRUE'
  | 'FALSE'
  | 'CASE'
  | 'WHEN'
  | 'THEN'
  | 'ELSE'
  | 'END'
  // Operators
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  // Punctuation
  | 'COMMA'
  | 'DOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'SEMICOLON'
  // Literals & Identifiers
  | 'NUMBER'
  | 'STRING'
  | 'IDENTIFIER'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: any;
  line: number;
  col: number;
  raw: string;
}

export type Expression =
  | LiteralExpr
  | IdentifierExpr
  | WildcardExpr
  | BinaryExpr
  | UnaryExpr
  | FunctionCallExpr
  | InExpr
  | BetweenExpr
  | IsNullExpr
  | CaseExpr;

export interface LiteralExpr {
  type: 'literal';
  value: string | number | boolean | null;
}

export interface IdentifierExpr {
  type: 'identifier';
  name: string;
  path: (string | number)[];
  table?: string;
}

export interface WildcardExpr {
  type: 'wildcard';
  table?: string;
}

export interface BinaryExpr {
  type: 'binary';
  left: Expression;
  op: string; // '=', '!=', '<>', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', 'AND', 'OR', 'LIKE', 'ILIKE', 'NOT LIKE'
  right: Expression;
}

export interface UnaryExpr {
  type: 'unary';
  op: string; // 'NOT', '-', '+'
  expr: Expression;
}

export interface FunctionCallExpr {
  type: 'call';
  name: string;
  args: Expression[];
  isDistinct?: boolean;
}

export interface InExpr {
  type: 'in';
  expr: Expression;
  list: Expression[];
  not: boolean;
}

export interface BetweenExpr {
  type: 'between';
  expr: Expression;
  low: Expression;
  high: Expression;
  not: boolean;
}

export interface IsNullExpr {
  type: 'isNull';
  expr: Expression;
  not: boolean;
}

export interface CaseCondition {
  when: Expression;
  then: Expression;
}

export interface CaseExpr {
  type: 'case';
  conditions: CaseCondition[];
  else?: Expression;
}

export interface SelectItem {
  expr: Expression;
  alias?: string;
  isWildcard?: boolean;
  wildcardTable?: string;
}

export interface FromClause {
  source: string;
  alias?: string;
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';

export interface JoinClause {
  joinType: JoinType;
  source: string;
  alias?: string;
  on?: Expression;
}

export interface OrderByItem {
  expr: Expression;
  direction: 'ASC' | 'DESC';
}

export interface SqlStatement {
  select: {
    distinct: boolean;
    items: SelectItem[];
  };
  from?: FromClause;
  joins: JoinClause[];
  where?: Expression;
  groupBy?: Expression[];
  having?: Expression;
  orderBy?: OrderByItem[];
  limit?: number;
  offset?: number;
}
