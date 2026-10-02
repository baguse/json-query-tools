/**
 * Public Entry Point for JSON Tools SQL Engine.
 */

import { parseSql } from './parser';
import { executeSqlQuery } from './evaluator';
import { formatSql } from './formatter';
import { tokenizeSql } from './lexer';
import { SqlStatement } from './types';

export * from './types';
export { parseSql, tokenizeSql, formatSql };

export function executeSql(dataMap: Record<string, unknown>, queryOrAst: string | SqlStatement): any[] {
  const ast = typeof queryOrAst === 'string' ? parseSql(queryOrAst) : queryOrAst;
  return executeSqlQuery(dataMap, ast);
}
