/**
 * SQL Evaluator / Execution Engine for JSON Tools.
 * Evaluates SqlStatement AST against in-memory dataMap.
 */

import {
  SqlStatement,
  Expression,
  SelectItem,
  OrderByItem,
  FunctionCallExpr,
  LiteralExpr,
  IdentifierExpr,
  WildcardExpr,
  BinaryExpr,
  UnaryExpr,
  InExpr,
  BetweenExpr,
  IsNullExpr,
  CaseExpr
} from './types';

export interface SqlEvaluationOptions {
  dataMap: Record<string, unknown>;
  defaultSource?: string;
}

export class Evaluator {
  private dataMap: Record<string, unknown>;

  constructor(private stmt: SqlStatement, options: SqlEvaluationOptions) {
    this.dataMap = options.dataMap || {};
  }

  public evaluate(): any[] {
    // 1. Resolve FROM source
    const baseSource = this.stmt.from ? this.stmt.from.source : 'data';
    const baseAlias = this.stmt.from?.alias || baseSource;
    const rawBaseData = this.resolveSourceData(baseSource);

    let rows: Record<string, any>[] = [];
    if (Array.isArray(rawBaseData)) {
      rows = rawBaseData.map((item) => ({ [baseAlias]: item }));
    } else if (rawBaseData !== undefined && rawBaseData !== null) {
      rows = [{ [baseAlias]: rawBaseData }];
    } else {
      rows = [];
    }

    // 2. Perform JOINs
    for (const join of this.stmt.joins) {
      const joinSource = join.source;
      const joinAlias = join.alias || joinSource;
      const rawJoinData = this.resolveSourceData(joinSource);
      const joinList = Array.isArray(rawJoinData)
        ? rawJoinData
        : rawJoinData !== undefined && rawJoinData !== null
        ? [rawJoinData]
        : [];

      const newRows: Record<string, any>[] = [];

      if (join.joinType === 'INNER' || join.joinType === 'CROSS') {
        for (const leftRow of rows) {
          for (const rightVal of joinList) {
            const candidate = { ...leftRow, [joinAlias]: rightVal };
            if (join.joinType === 'CROSS' || !join.on || this.isTruthy(this.evalExpr(join.on, candidate))) {
              newRows.push(candidate);
            }
          }
        }
      } else if (join.joinType === 'LEFT') {
        for (const leftRow of rows) {
          let matched = false;
          for (const rightVal of joinList) {
            const candidate = { ...leftRow, [joinAlias]: rightVal };
            if (!join.on || this.isTruthy(this.evalExpr(join.on, candidate))) {
              newRows.push(candidate);
              matched = true;
            }
          }
          if (!matched) {
            newRows.push({ ...leftRow, [joinAlias]: null });
          }
        }
      } else if (join.joinType === 'RIGHT') {
        for (const rightVal of joinList) {
          let matched = false;
          for (const leftRow of rows) {
            const candidate = { ...leftRow, [joinAlias]: rightVal };
            if (!join.on || this.isTruthy(this.evalExpr(join.on, candidate))) {
              newRows.push(candidate);
              matched = true;
            }
          }
          if (!matched) {
            const nullLeft: Record<string, any> = {};
            if (rows.length > 0) {
              for (const k of Object.keys(rows[0])) {
                nullLeft[k] = null;
              }
            } else {
              nullLeft[baseAlias] = null;
            }
            newRows.push({ ...nullLeft, [joinAlias]: rightVal });
          }
        }
      } else if (join.joinType === 'FULL') {
        const matchedRightIndices = new Set<number>();
        for (const leftRow of rows) {
          let leftMatched = false;
          for (let rIdx = 0; rIdx < joinList.length; rIdx++) {
            const rightVal = joinList[rIdx];
            const candidate = { ...leftRow, [joinAlias]: rightVal };
            if (!join.on || this.isTruthy(this.evalExpr(join.on, candidate))) {
              newRows.push(candidate);
              leftMatched = true;
              matchedRightIndices.add(rIdx);
            }
          }
          if (!leftMatched) {
            newRows.push({ ...leftRow, [joinAlias]: null });
          }
        }
        for (let rIdx = 0; rIdx < joinList.length; rIdx++) {
          if (!matchedRightIndices.has(rIdx)) {
            const nullLeft: Record<string, any> = {};
            if (rows.length > 0) {
              for (const k of Object.keys(rows[0])) {
                nullLeft[k] = null;
              }
            } else {
              nullLeft[baseAlias] = null;
            }
            newRows.push({ ...nullLeft, [joinAlias]: joinList[rIdx] });
          }
        }
      }

      rows = newRows;
    }

    // 3. Filter WHERE
    if (this.stmt.where) {
      const whereExpr = this.stmt.where;
      rows = rows.filter((row) => this.isTruthy(this.evalExpr(whereExpr, row)));
    }

    // 4. Aggregations & GROUP BY
    const hasAggregates = this.detectAggregates();
    const hasGroupBy = Boolean(this.stmt.groupBy && this.stmt.groupBy.length > 0);

    let projected: any[] = [];

    if (hasGroupBy || hasAggregates) {
      const groups = new Map<string, { keyValues: any[]; rows: Record<string, any>[] }>();

      if (hasGroupBy && this.stmt.groupBy) {
        for (const row of rows) {
          const keyVals = this.stmt.groupBy.map((gExpr) => this.evalExpr(gExpr, row));
          const key = JSON.stringify(keyVals);
          if (!groups.has(key)) {
            groups.set(key, { keyValues: keyVals, rows: [] });
          }
          groups.get(key)!.rows.push(row);
        }
      } else {
        // No GROUP BY, but aggregate functions exist: treat all rows as single group
        groups.set('__all__', { keyValues: [], rows });
      }

      for (const group of groups.values()) {
        // Check HAVING
        if (this.stmt.having) {
          const havingPassed = this.isTruthy(this.evalGroupExpr(this.stmt.having, group.rows));
          if (!havingPassed) continue;
        }

        // Project group
        const projectedRow: Record<string, any> = {};
        for (const item of this.stmt.select.items) {
          if (item.isWildcard) {
            // Wildcard in aggregate query: take from first row of group
            if (group.rows.length > 0) {
              const repRow = this.flattenRow(group.rows[0]);
              Object.assign(projectedRow, repRow);
            }
          } else {
            const val = this.evalGroupExpr(item.expr, group.rows);
            const alias = item.alias || this.inferAlias(item.expr);
            projectedRow[alias] = val;
          }
        }
        projected.push(projectedRow);
      }
    } else {
      // 5. Standard non-aggregate projection
      for (const row of rows) {
        let projectedRow: Record<string, any> = {};

        for (const item of this.stmt.select.items) {
          if (item.isWildcard) {
            if (item.wildcardTable) {
              const tblData = row[item.wildcardTable];
              if (tblData && typeof tblData === 'object') {
                Object.assign(projectedRow, tblData);
              }
            } else {
              // Flatten all tables
              Object.assign(projectedRow, this.flattenRow(row));
            }
          } else {
            const val = this.evalExpr(item.expr, row);
            const alias = item.alias || this.inferAlias(item.expr);
            projectedRow[alias] = val;
          }
        }
        projected.push(projectedRow);
      }
    }

    // 6. DISTINCT
    if (this.stmt.select.distinct) {
      const seen = new Set<string>();
      projected = projected.filter((row) => {
        const key = JSON.stringify(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // 7. ORDER BY
    if (this.stmt.orderBy && this.stmt.orderBy.length > 0) {
      const orderItems = this.stmt.orderBy;
      projected.sort((a, b) => {
        for (const item of orderItems) {
          const valA = this.evalSortVal(item.expr, a);
          const valB = this.evalSortVal(item.expr, b);

          const cmp = this.compareValues(valA, valB);
          if (cmp !== 0) {
            return item.direction === 'DESC' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    // 8. OFFSET & LIMIT
    const offset = this.stmt.offset !== undefined ? Math.max(0, this.stmt.offset) : 0;
    if (offset > 0) {
      projected = projected.slice(offset);
    }
    if (this.stmt.limit !== undefined && this.stmt.limit >= 0) {
      projected = projected.slice(0, this.stmt.limit);
    }

    return projected;
  }

  // --- Source Resolution ---

  private resolveSourceData(sourceName: string): any {
    const parts = sourceName.split('.');
    let cur: any = this.dataMap;

    // Check direct key in dataMap
    if (cur[sourceName] !== undefined) {
      return cur[sourceName];
    }

    // Direct path traversal in dataMap (e.g. data.users, data.response.items)
    let val: any = cur;
    let found = true;
    for (const part of parts) {
      if (val == null || typeof val !== 'object') {
        found = false;
        break;
      }
      val = val[part];
    }
    if (found && val !== undefined) {
      return val;
    }

    // Fallback: check within default 'data' or 'raw' object
    // e.g. when JSON file has root object { users: [...] } and query is FROM users or FROM response.items
    const rootData = this.dataMap['data'] !== undefined ? this.dataMap['data'] : this.dataMap['raw'];
    if (rootData && typeof rootData === 'object') {
      let subVal: any = rootData;
      let subFound = true;
      for (const part of parts) {
        if (subVal == null || typeof subVal !== 'object') {
          subFound = false;
          break;
        }
        subVal = subVal[part];
      }
      if (subFound && subVal !== undefined) {
        return subVal;
      }
    }

    return undefined;
  }

  private flattenRow(row: Record<string, any>): Record<string, any> {
    const flat: Record<string, any> = {};
    const tableKeys = Object.keys(row);
    if (tableKeys.length === 1) {
      const val = row[tableKeys[0]];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        return { ...val };
      }
      return { value: val };
    }

    for (const tbl of tableKeys) {
      const val = row[tbl];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        for (const [k, v] of Object.entries(val)) {
          if (flat[k] === undefined) {
            flat[k] = v;
          } else {
            flat[`${tbl}_${k}`] = v;
          }
        }
      } else {
        flat[tbl] = val;
      }
    }
    return flat;
  }

  // --- Expression Evaluation for single Row ---

  public evalExpr(expr: Expression, row: Record<string, any>): any {
    switch (expr.type) {
      case 'literal':
        return expr.value;

      case 'identifier':
        return this.resolveIdentifier(expr, row);

      case 'wildcard':
        return this.flattenRow(row);

      case 'unary': {
        const val = this.evalExpr(expr.expr, row);
        if (expr.op === 'NOT') return !this.isTruthy(val);
        if (expr.op === '-') return -Number(val);
        if (expr.op === '+') return +Number(val);
        return val;
      }

      case 'binary': {
        if (expr.op === 'AND') {
          return this.isTruthy(this.evalExpr(expr.left, row)) && this.isTruthy(this.evalExpr(expr.right, row));
        }
        if (expr.op === 'OR') {
          return this.isTruthy(this.evalExpr(expr.left, row)) || this.isTruthy(this.evalExpr(expr.right, row));
        }

        const left = this.evalExpr(expr.left, row);
        const right = this.evalExpr(expr.right, row);

        switch (expr.op) {
          case '=':
          case '==':
            return left == right;
          case '!=':
          case '<>':
            return left != right;
          case '<':
            return left < right;
          case '<=':
            return left <= right;
          case '>':
            return left > right;
          case '>=':
            return left >= right;
          case '+':
            return typeof left === 'string' || typeof right === 'string'
              ? String(left ?? '') + String(right ?? '')
              : Number(left) + Number(right);
          case '-':
            return Number(left) - Number(right);
          case '*':
            return Number(left) * Number(right);
          case '/':
            return Number(right) !== 0 ? Number(left) / Number(right) : null;
          case '%':
            return Number(right) !== 0 ? Number(left) % Number(right) : null;
          case 'LIKE':
            return this.evalLike(left, right, false);
          case 'ILIKE':
            return this.evalLike(left, right, true);
          case 'NOT LIKE':
            return !this.evalLike(left, right, false);
          case 'NOT ILIKE':
            return !this.evalLike(left, right, true);
          default:
            return null;
        }
      }

      case 'in': {
        const val = this.evalExpr(expr.expr, row);
        const listVals = expr.list.map((item) => this.evalExpr(item, row));
        const matched = listVals.some((item) => item == val);
        return expr.not ? !matched : matched;
      }

      case 'between': {
        const val = this.evalExpr(expr.expr, row);
        const low = this.evalExpr(expr.low, row);
        const high = this.evalExpr(expr.high, row);
        const inRange = val >= low && val <= high;
        return expr.not ? !inRange : inRange;
      }

      case 'isNull': {
        const val = this.evalExpr(expr.expr, row);
        const isNull = val === null || val === undefined;
        return expr.not ? !isNull : isNull;
      }

      case 'case': {
        for (const cond of expr.conditions) {
          if (this.isTruthy(this.evalExpr(cond.when, row))) {
            return this.evalExpr(cond.then, row);
          }
        }
        if (expr.else) {
          return this.evalExpr(expr.else, row);
        }
        return null;
      }

      case 'call':
        return this.evalScalarFunction(expr, row);

      default:
        return null;
    }
  }

  private resolveIdentifier(expr: IdentifierExpr, row: Record<string, any>): any {
    const path = expr.path;
    if (path.length === 0) return null;

    // Check if path[0] matches a table in row
    const first = String(path[0]);
    if (row[first] !== undefined) {
      if (path.length === 1) return row[first];
      return this.traversePath(row[first], path.slice(1));
    }

    // Try checking inside each table in row
    for (const tbl of Object.keys(row)) {
      const tblData = row[tbl];
      if (tblData && typeof tblData === 'object') {
        const val = this.traversePath(tblData, path);
        if (val !== undefined) return val;
      }
    }

    // Direct lookup on row
    return this.traversePath(row, path);
  }

  private traversePath(obj: any, path: (string | number)[]): any {
    let cur = obj;
    for (const segment of path) {
      if (cur == null || typeof cur !== 'object') return null;
      cur = cur[segment];
    }
    return cur !== undefined ? cur : null;
  }

  // --- Aggregate / Group Expression Evaluation ---

  public evalGroupExpr(expr: Expression, groupRows: Record<string, any>[]): any {
    if (expr.type === 'call' && this.isAggregateFunction(expr.name)) {
      return this.evalAggregateFunction(expr, groupRows);
    }

    if (expr.type === 'binary') {
      const left = this.evalGroupExpr(expr.left, groupRows);
      const right = this.evalGroupExpr(expr.right, groupRows);
      if (expr.op === '+') return Number(left) + Number(right);
      if (expr.op === '-') return Number(left) - Number(right);
      if (expr.op === '*') return Number(left) * Number(right);
      if (expr.op === '/') return Number(right) !== 0 ? Number(left) / Number(right) : null;
      if (expr.op === '=') return left == right;
      if (expr.op === '!=') return left != right;
      if (expr.op === '>') return left > right;
      if (expr.op === '>=') return left >= right;
      if (expr.op === '<') return left < right;
      if (expr.op === '<=') return left <= right;
      if (expr.op === 'AND') return this.isTruthy(left) && this.isTruthy(right);
      if (expr.op === 'OR') return this.isTruthy(left) || this.isTruthy(right);
      return null;
    }

    // If not aggregate, evaluate on first row of group
    if (groupRows.length > 0) {
      return this.evalExpr(expr, groupRows[0]);
    }
    return null;
  }

  private evalAggregateFunction(call: FunctionCallExpr, groupRows: Record<string, any>[]): any {
    const fnName = call.name.toUpperCase();

    if (fnName === 'COUNT') {
      if (call.args.length === 0 || (call.args[0] && call.args[0].type === 'wildcard')) {
        return groupRows.length;
      }
      let count = 0;
      const seen = new Set<string>();
      for (const row of groupRows) {
        const val = this.evalExpr(call.args[0], row);
        if (val !== null && val !== undefined) {
          if (call.isDistinct) {
            const key = JSON.stringify(val);
            if (!seen.has(key)) {
              seen.add(key);
              count++;
            }
          } else {
            count++;
          }
        }
      }
      return count;
    }

    const values: number[] = [];
    const seen = new Set<string>();

    for (const row of groupRows) {
      if (call.args.length > 0) {
        const val = this.evalExpr(call.args[0], row);
        if (val !== null && val !== undefined) {
          if (call.isDistinct) {
            const key = JSON.stringify(val);
            if (!seen.has(key)) {
              seen.add(key);
              const num = Number(val);
              if (!isNaN(num)) values.push(num);
            }
          } else {
            const num = Number(val);
            if (!isNaN(num)) values.push(num);
          }
        }
      }
    }

    if (fnName === 'SUM') {
      return values.reduce((sum, n) => sum + n, 0);
    }
    if (fnName === 'AVG') {
      return values.length > 0 ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
    }
    if (fnName === 'MIN') {
      return values.length > 0 ? Math.min(...values) : null;
    }
    if (fnName === 'MAX') {
      return values.length > 0 ? Math.max(...values) : null;
    }
    if (fnName === 'GROUP_CONCAT') {
      const sep = call.args.length > 1 ? String(this.evalExpr(call.args[1], groupRows[0] || {})) : ',';
      const items: string[] = [];
      for (const row of groupRows) {
        const val = this.evalExpr(call.args[0], row);
        if (val !== null && val !== undefined) items.push(String(val));
      }
      return items.join(sep);
    }

    return null;
  }

  // --- Scalar Built-In Functions ---

  private evalScalarFunction(call: FunctionCallExpr, row: Record<string, any>): any {
    const fn = call.name.toUpperCase();
    const args = call.args.map((a) => this.evalExpr(a, row));

    switch (fn) {
      case 'UPPER':
        return args[0] != null ? String(args[0]).toUpperCase() : null;
      case 'LOWER':
        return args[0] != null ? String(args[0]).toLowerCase() : null;
      case 'TRIM':
        return args[0] != null ? String(args[0]).trim() : null;
      case 'LTRIM':
        return args[0] != null ? String(args[0]).replace(/^\s+/, '') : null;
      case 'RTRIM':
        return args[0] != null ? String(args[0]).replace(/\s+$/, '') : null;
      case 'LENGTH':
      case 'LEN':
        return args[0] != null ? String(args[0]).length : null;
      case 'CONCAT':
        return args.map((a) => (a != null ? String(a) : '')).join('');
      case 'SUBSTR':
      case 'SUBSTRING': {
        const str = String(args[0] ?? '');
        const start = Number(args[1]) || 1;
        const len = args[2] !== undefined ? Number(args[2]) : undefined;
        // Standard SQL SUBSTR is 1-indexed
        const idx = start > 0 ? start - 1 : 0;
        return len !== undefined ? str.substr(idx, len) : str.substr(idx);
      }
      case 'ROUND': {
        const n = Number(args[0]);
        const dec = Number(args[1]) || 0;
        if (isNaN(n)) return null;
        const factor = Math.pow(10, dec);
        return Math.round(n * factor) / factor;
      }
      case 'FLOOR':
        return args[0] != null ? Math.floor(Number(args[0])) : null;
      case 'CEIL':
      case 'CEILING':
        return args[0] != null ? Math.ceil(Number(args[0])) : null;
      case 'ABS':
        return args[0] != null ? Math.abs(Number(args[0])) : null;
      case 'COALESCE':
        for (const a of args) {
          if (a !== null && a !== undefined) return a;
        }
        return null;
      case 'IFNULL':
        return args[0] !== null && args[0] !== undefined ? args[0] : args[1];
      case 'NULLIF':
        return args[0] === args[1] ? null : args[0];
      case 'NOW':
        return new Date().toISOString();
      case 'DATE': {
        if (!args[0]) return null;
        try {
          return new Date(args[0]).toISOString().split('T')[0];
        } catch {
          return null;
        }
      }
      case 'TYPEOF':
        if (args[0] === null) return 'null';
        if (Array.isArray(args[0])) return 'array';
        return typeof args[0];
      case 'JSON_EXTRACT': {
        const target = args[0];
        const pathStr = String(args[1] || '').replace(/^\$\.?/, '');
        if (!target || !pathStr) return target;
        const segs = pathStr.split('.');
        return this.traversePath(target, segs);
      }
      default:
        // Pass-through or unknown function
        return args[0] ?? null;
    }
  }

  // --- Sort Helper ---

  private evalSortVal(expr: Expression, projectedRow: Record<string, any>): any {
    // If expr is identifier matching an alias in projected row
    if (expr.type === 'identifier') {
      const aliasName = expr.name;
      if (projectedRow[aliasName] !== undefined) {
        return projectedRow[aliasName];
      }
    }
    return this.evalExpr(expr, { [Object.keys(projectedRow)[0] || 'data']: projectedRow, ...projectedRow });
  }

  private compareValues(a: any, b: any): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return 1; // nulls last
    if (b === null || b === undefined) return -1;

    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return (a ? 1 : 0) - (b ? 1 : 0);
    }
    return String(a).localeCompare(String(b));
  }

  // --- Helpers ---

  private isAggregateFunction(name: string): boolean {
    const upper = name.toUpperCase();
    return (
      upper === 'COUNT' ||
      upper === 'SUM' ||
      upper === 'AVG' ||
      upper === 'MIN' ||
      upper === 'MAX' ||
      upper === 'GROUP_CONCAT'
    );
  }

  private detectAggregates(): boolean {
    for (const item of this.stmt.select.items) {
      if (this.containsAggregate(item.expr)) return true;
    }
    if (this.stmt.having && this.containsAggregate(this.stmt.having)) return true;
    return false;
  }

  private containsAggregate(expr: Expression): boolean {
    if (expr.type === 'call' && this.isAggregateFunction(expr.name)) return true;
    if (expr.type === 'binary') {
      return this.containsAggregate(expr.left) || this.containsAggregate(expr.right);
    }
    if (expr.type === 'unary') {
      return this.containsAggregate(expr.expr);
    }
    return false;
  }

  private evalLike(val: any, pattern: any, caseInsensitive: boolean): boolean {
    if (val == null || pattern == null) return false;
    const str = String(val);
    const pat = String(pattern);

    // Escape regex special chars except % and _
    let regexStr = '^';
    for (let i = 0; i < pat.length; i++) {
      const ch = pat[i];
      if (ch === '%') {
        regexStr += '.*';
      } else if (ch === '_') {
        regexStr += '.';
      } else if ('[\\](){}+?.,^$|#\\'.includes(ch)) {
        regexStr += '\\' + ch;
      } else {
        regexStr += ch;
      }
    }
    regexStr += '$';

    try {
      const regex = new RegExp(regexStr, caseInsensitive ? 'i' : '');
      return regex.test(str);
    } catch {
      return false;
    }
  }

  private isTruthy(val: any): boolean {
    if (val === false || val === 0 || val === '' || val === null || val === undefined) {
      return false;
    }
    return true;
  }

  private inferAlias(expr: Expression): string {
    if (expr.type === 'identifier') {
      return expr.name.replace(/\[\d+\]/g, '').split('.').pop() || expr.name;
    }
    if (expr.type === 'call') {
      return `${expr.name.toLowerCase()}_result`;
    }
    if (expr.type === 'binary') {
      return 'expr';
    }
    if (expr.type === 'literal') {
      return 'val';
    }
    return 'col';
  }
}

export function executeSqlQuery(dataMap: Record<string, unknown>, stmt: SqlStatement): any[] {
  const evaluator = new Evaluator(stmt, { dataMap });
  return evaluator.evaluate();
}
