/**
 * Zero-dependency Smart Assertion and Test Suite Runner for JSON Query Tools.
 * Enables API testing and contract validation directly inside queries.
 */

export interface TestAssertionFailure {
  message: string;
  expected?: string;
  actual?: string;
  operator?: string;
  stack?: string;
}

export interface TestCaseResult {
  id: string;
  name: string;
  status: 'pass' | 'fail';
  durationMs: number;
  error?: TestAssertionFailure;
  assertionsCount: number;
}

export interface TestSuiteResult {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  tests: TestCaseResult[];
  hasTests: boolean;
}

export class TestAssertionError extends Error {
  public expected?: any;
  public actual?: any;
  public operator?: string;
  public showDiff: boolean;

  constructor(message: string, expected?: any, actual?: any, operator?: string) {
    super(message);
    this.name = 'AssertionError';
    this.expected = expected;
    this.actual = actual;
    this.operator = operator;
    this.showDiff = arguments.length >= 2;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TestAssertionError);
    }
  }
}

/** Format a value for error messages and assertion diffs */
export function formatAssertionValue(val: unknown): string {
  if (typeof val === 'undefined') return 'undefined';
  if (val === null) return 'null';
  if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
  if (typeof val === 'symbol') return val.toString();
  if (typeof val === 'bigint') return `${val}n`;
  if (val instanceof Error) return `${val.name}: ${val.message}`;
  if (val instanceof RegExp) return val.toString();
  if (val instanceof Date) return `Date(${val.toISOString()})`;

  try {
    const seen = new WeakSet();
    const str = JSON.stringify(
      val,
      (_k, v) => {
        if (typeof v === 'bigint') return `${v}n`;
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      },
      2
    );
    return str ?? String(val);
  } catch {
    return String(val);
  }
}

/** Deep equality comparator with circular reference protection */
export function isDeepEqual(a: any, b: any, visited?: WeakMap<object, WeakSet<object>>): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }

  // Handle Dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle RegExps
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags;
  }

  // Circular reference handling
  if (!visited) visited = new WeakMap();
  const setA = visited.get(a);
  if (setA && setA.has(b)) return true;
  if (!setA) {
    visited.set(a, new WeakSet([b]));
  } else {
    setA.add(b);
  }

  // Handle Arrays
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i], visited)) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;

  // Handle Sets
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const itemA of a) {
      let found = false;
      for (const itemB of b) {
        if (isDeepEqual(itemA, itemB, visited)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  // Handle Maps
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [keyA, valA] of a) {
      let found = false;
      for (const [keyB, valB] of b) {
        if (isDeepEqual(keyA, keyB, visited) && isDeepEqual(valA, valB, visited)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  // Handle plain objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepEqual(a[key], b[key], visited)) return false;
  }

  return true;
}

/** Retrieve property value by path e.g. 'user.address.city' or 'items[0].id' */
export function getNestedProperty(obj: any, path: string): { found: boolean; value: any } {
  if (obj === null || typeof obj === 'undefined') {
    return { found: false, value: undefined };
  }
  if (Object.prototype.hasOwnProperty.call(obj, path)) {
    return { found: true, value: obj[path] };
  }

  // Parse path tokens e.g. user.roles[0].name -> ['user', 'roles', '0', 'name']
  const tokens = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current = obj;
  for (const token of tokens) {
    if (current === null || typeof current === 'undefined') {
      return { found: false, value: undefined };
    }
    if (typeof current !== 'object' && typeof current !== 'function') {
      return { found: false, value: undefined };
    }
    if (!(token in current)) {
      return { found: false, value: undefined };
    }
    current = current[token];
  }

  return { found: true, value: current };
}

export interface Matchers<T> {
  toBe(expected: T): void;
  toEqual(expected: any): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNaN(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeCloseTo(expected: number, numDigits?: number): void;
  toContain(item: any): void;
  toHaveLength(length: number): void;
  toHaveProperty(path: string, expectedValue?: any): void;
  toMatch(pattern: RegExp | string): void;
  toBeTypeOf(expectedType: string): void;
  toBeType(expectedType: string): void;
  toBeArray(): void;
  toBeObject(): void;
  toBeString(): void;
  toBeNumber(): void;
  toBeBoolean(): void;
  toThrow(expectedError?: RegExp | string): void;
  not: Matchers<T>;
}

export interface TestEnvironment {
  test: (name: string, fn: () => void | Promise<void>) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: <T = any>(actual: T) => Matchers<T>;
  assert: Record<string, any> & ((condition: any, message?: string) => void);
  getResults: () => Promise<TestSuiteResult>;
  hasTests: () => boolean;
}

export function createTestEnvironment(): TestEnvironment {
  const registeredTests: Array<{ id: string; name: string; fn: () => void | Promise<void> }> = [];
  const topLevelAssertions: TestCaseResult[] = [];
  let currentRunningTest: { id: string; name: string; assertionsCount: number } | null = null;
  let topLevelCounter = 0;

  function recordAssertion(name: string, passed: boolean, failure?: TestAssertionFailure) {
    if (currentRunningTest) {
      currentRunningTest.assertionsCount++;
      if (!passed && failure) {
        throw new TestAssertionError(
          failure.message,
          failure.expected,
          failure.actual,
          failure.operator
        );
      }
      return;
    }

    // Top-level assertion outside of a test() block
    topLevelCounter++;
    topLevelAssertions.push({
      id: `top-level-${topLevelCounter}`,
      name: name || `Assertion #${topLevelCounter}`,
      status: passed ? 'pass' : 'fail',
      durationMs: 0,
      assertionsCount: 1,
      error: passed ? undefined : failure
    });
    if (!passed && failure) {
      throw new TestAssertionError(
        failure.message,
        failure.expected,
        failure.actual,
        failure.operator
      );
    }
  }

  function createMatchers<T>(actual: T, isNot = false): Matchers<T> {
    function check(
      pass: boolean,
      message: string,
      expectedVal?: any,
      operator?: string,
      customName?: string
    ) {
      const condition = isNot ? !pass : pass;
      const formattedActual = formatAssertionValue(actual);
      const formattedExpected = arguments.length >= 3 ? formatAssertionValue(expectedVal) : undefined;
      const effectiveMessage = isNot ? `not ${message}` : message;

      if (!condition) {
        const failure: TestAssertionFailure = {
          message: effectiveMessage,
          actual: formattedActual,
          expected: formattedExpected,
          operator: operator || (isNot ? 'not' : 'expect')
        };
        recordAssertion(customName || effectiveMessage, false, failure);
      } else {
        recordAssertion(customName || effectiveMessage, true);
      }
    };

    const matchers: Matchers<T> = {
      get not() {
        return createMatchers(actual, !isNot);
      },

      toBe(expected: T) {
        const pass = Object.is(actual, expected);
        check(
          pass,
          `Expected ${formatAssertionValue(actual)} to be ${formatAssertionValue(expected)}`,
          expected,
          '==='
        );
      },

      toEqual(expected: any) {
        const pass = isDeepEqual(actual, expected);
        check(
          pass,
          `Expected deep equality with ${formatAssertionValue(expected)}`,
          expected,
          'deepEqual'
        );
      },

      toBeTruthy() {
        check(Boolean(actual), `Expected ${formatAssertionValue(actual)} to be truthy`, true, 'truthy');
      },

      toBeFalsy() {
        check(!actual, `Expected ${formatAssertionValue(actual)} to be falsy`, false, 'falsy');
      },

      toBeNull() {
        check(actual === null, `Expected ${formatAssertionValue(actual)} to be null`, null, '===');
      },

      toBeUndefined() {
        check(
          typeof actual === 'undefined',
          `Expected ${formatAssertionValue(actual)} to be undefined`,
          undefined,
          '==='
        );
      },

      toBeDefined() {
        check(
          typeof actual !== 'undefined',
          `Expected value to be defined`,
          undefined,
          '!=='
        );
      },

      toBeNaN() {
        check(Number.isNaN(actual as any), `Expected ${formatAssertionValue(actual)} to be NaN`, NaN, 'isNaN');
      },

      toBeGreaterThan(expected: number) {
        check(
          (actual as any) > expected,
          `Expected ${formatAssertionValue(actual)} > ${expected}`,
          expected,
          '>'
        );
      },

      toBeGreaterThanOrEqual(expected: number) {
        check(
          (actual as any) >= expected,
          `Expected ${formatAssertionValue(actual)} >= ${expected}`,
          expected,
          '>='
        );
      },

      toBeLessThan(expected: number) {
        check(
          (actual as any) < expected,
          `Expected ${formatAssertionValue(actual)} < ${expected}`,
          expected,
          '<'
        );
      },

      toBeLessThanOrEqual(expected: number) {
        check(
          (actual as any) <= expected,
          `Expected ${formatAssertionValue(actual)} <= ${expected}`,
          expected,
          '<='
        );
      },

      toBeCloseTo(expected: number, numDigits = 2) {
        if (typeof actual !== 'number') {
          check(false, `Expected actual to be a number, got ${typeof actual}`, expected);
          return;
        }
        const diff = Math.abs(actual - expected);
        const pass = diff < Math.pow(10, -numDigits) / 2;
        check(
          pass,
          `Expected ${actual} to be close to ${expected} (within ${numDigits} digits)`,
          expected,
          'closeTo'
        );
      },

      toContain(item: any) {
        let pass = false;
        if (typeof actual === 'string') {
          pass = actual.includes(String(item));
        } else if (Array.isArray(actual)) {
          pass = actual.some(x => isDeepEqual(x, item));
        } else if (actual instanceof Set) {
          pass = actual.has(item);
          if (!pass) {
            for (const val of actual) {
              if (isDeepEqual(val, item)) {
                pass = true;
                break;
              }
            }
          }
        } else if (actual instanceof Map) {
          pass = actual.has(item);
        } else if (actual && typeof actual === 'object') {
          pass = Object.prototype.hasOwnProperty.call(actual, item);
        }
        check(
          pass,
          `Expected ${formatAssertionValue(actual)} to contain ${formatAssertionValue(item)}`,
          item,
          'toContain'
        );
      },

      toHaveLength(expectedLen: number) {
        const len = (actual as any)?.length ?? (actual as any)?.size;
        const pass = len === expectedLen;
        check(
          pass,
          `Expected length ${expectedLen}, got ${len}`,
          expectedLen,
          'toHaveLength'
        );
      },

      toHaveProperty(path: string, expectedVal?: any) {
        const prop = getNestedProperty(actual, path);
        if (arguments.length >= 2) {
          const pass = prop.found && isDeepEqual(prop.value, expectedVal);
          check(
            pass,
            `Expected property '${path}' to equal ${formatAssertionValue(expectedVal)}, got ${formatAssertionValue(prop.value)}`,
            expectedVal,
            'toHaveProperty'
          );
        } else {
          check(
            prop.found,
            `Expected object to have property '${path}'`,
            true,
            'toHaveProperty'
          );
        }
      },

      toMatch(pattern: RegExp | string) {
        const str = String(actual);
        const reg = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const pass = reg.test(str);
        check(
          pass,
          `Expected ${formatAssertionValue(str)} to match ${reg}`,
          pattern,
          'toMatch'
        );
      },

      toBeTypeOf(expectedType: string) {
        const actualType = Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual;
        const pass = actualType === expectedType;
        check(
          pass,
          `Expected type '${expectedType}', got '${actualType}'`,
          expectedType,
          'typeof'
        );
      },

      toBeType(expectedType: string) {
        this.toBeTypeOf(expectedType);
      },

      toBeArray() {
        check(Array.isArray(actual), `Expected ${formatAssertionValue(actual)} to be an array`, 'array', 'isArray');
      },

      toBeObject() {
        const pass = typeof actual === 'object' && actual !== null && !Array.isArray(actual);
        check(pass, `Expected ${formatAssertionValue(actual)} to be an object`, 'object', 'isObject');
      },

      toBeString() {
        check(typeof actual === 'string', `Expected ${formatAssertionValue(actual)} to be a string`, 'string', 'isString');
      },

      toBeNumber() {
        const pass = typeof actual === 'number' && !Number.isNaN(actual);
        check(pass, `Expected ${formatAssertionValue(actual)} to be a number`, 'number', 'isNumber');
      },

      toBeBoolean() {
        check(typeof actual === 'boolean', `Expected ${formatAssertionValue(actual)} to be a boolean`, 'boolean', 'isBoolean');
      },

      toThrow(expectedError?: RegExp | string) {
        if (typeof actual !== 'function') {
          check(false, `Expected a function to test for throwing, got ${typeof actual}`);
          return;
        }
        let threw = false;
        let thrownError: any = null;
        try {
          (actual as any)();
        } catch (err: any) {
          threw = true;
          thrownError = err;
        }

        if (!threw) {
          check(false, `Expected function to throw an error, but it did not throw`, expectedError, 'toThrow');
          return;
        }

        if (expectedError) {
          const errMsg = thrownError instanceof Error ? thrownError.message : String(thrownError);
          const pass = typeof expectedError === 'string'
            ? errMsg.includes(expectedError)
            : expectedError.test(errMsg);
          check(
            pass,
            `Expected thrown error matching ${expectedError}, got '${errMsg}'`,
            expectedError,
            'toThrow'
          );
        } else {
          check(true, `Function threw as expected`);
        }
      }
    };

    return matchers;
  }

  // Node-style assert interface
  const assertFn: any = (condition: any, message?: string) => {
    const pass = Boolean(condition);
    const msg = message || 'Assertion failed: expected value to be truthy';
    if (!pass) {
      const failure: TestAssertionFailure = {
        message: msg,
        actual: formatAssertionValue(condition),
        expected: 'truthy',
        operator: 'assert'
      };
      recordAssertion(msg, false, failure);
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.ok = (val: any, msg?: string) => assertFn(val, msg);

  assertFn.strictEqual = (actual: any, expected: any, message?: string) => {
    const pass = Object.is(actual, expected);
    const msg = message || `Expected ${formatAssertionValue(actual)} === ${formatAssertionValue(expected)}`;
    if (!pass) {
      recordAssertion(msg, false, {
        message: msg,
        actual: formatAssertionValue(actual),
        expected: formatAssertionValue(expected),
        operator: 'strictEqual'
      });
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.notStrictEqual = (actual: any, expected: any, message?: string) => {
    const pass = !Object.is(actual, expected);
    const msg = message || `Expected ${formatAssertionValue(actual)} !== ${formatAssertionValue(expected)}`;
    if (!pass) {
      recordAssertion(msg, false, {
        message: msg,
        actual: formatAssertionValue(actual),
        expected: `not ${formatAssertionValue(expected)}`,
        operator: 'notStrictEqual'
      });
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.deepStrictEqual = (actual: any, expected: any, message?: string) => {
    const pass = isDeepEqual(actual, expected);
    const msg = message || `Expected deep equality with ${formatAssertionValue(expected)}`;
    if (!pass) {
      recordAssertion(msg, false, {
        message: msg,
        actual: formatAssertionValue(actual),
        expected: formatAssertionValue(expected),
        operator: 'deepStrictEqual'
      });
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.notDeepStrictEqual = (actual: any, expected: any, message?: string) => {
    const pass = !isDeepEqual(actual, expected);
    const msg = message || `Expected not deep equal to ${formatAssertionValue(expected)}`;
    if (!pass) {
      recordAssertion(msg, false, {
        message: msg,
        actual: formatAssertionValue(actual),
        expected: `not ${formatAssertionValue(expected)}`,
        operator: 'notDeepStrictEqual'
      });
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.match = (string: string, regexp: RegExp, message?: string) => {
    const pass = regexp.test(String(string));
    const msg = message || `Expected ${formatAssertionValue(string)} to match ${regexp}`;
    if (!pass) {
      recordAssertion(msg, false, {
        message: msg,
        actual: formatAssertionValue(string),
        expected: String(regexp),
        operator: 'match'
      });
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.doesNotMatch = (string: string, regexp: RegExp, message?: string) => {
    const pass = !regexp.test(String(string));
    const msg = message || `Expected ${formatAssertionValue(string)} not to match ${regexp}`;
    if (!pass) {
      recordAssertion(msg, false, {
        message: msg,
        actual: formatAssertionValue(string),
        expected: `not ${regexp}`,
        operator: 'doesNotMatch'
      });
    } else {
      recordAssertion(msg, true);
    }
  };

  assertFn.throws = (fn: Function, expected?: RegExp | string | Function, message?: string) => {
    let threw = false;
    let thrownError: any = null;
    try {
      fn();
    } catch (err) {
      threw = true;
      thrownError = err;
    }
    const msg = message || 'Expected function to throw';
    if (!threw) {
      recordAssertion(msg, false, {
        message: msg,
        actual: 'did not throw',
        expected: 'throws',
        operator: 'throws'
      });
      return;
    }
    if (expected) {
      const errMsg = thrownError instanceof Error ? thrownError.message : String(thrownError);
      let pass = true;
      if (typeof expected === 'string') pass = errMsg.includes(expected);
      else if (expected instanceof RegExp) pass = expected.test(errMsg);
      else if (typeof expected === 'function') pass = thrownError instanceof expected;

      if (!pass) {
        recordAssertion(msg, false, {
          message: `${msg}: error did not match expectation`,
          actual: errMsg,
          expected: String(expected),
          operator: 'throws'
        });
        return;
      }
    }
    recordAssertion(msg, true);
  };

  assertFn.doesNotThrow = (fn: Function, message?: string) => {
    let threw = false;
    let thrownError: any = null;
    try {
      fn();
    } catch (err) {
      threw = true;
      thrownError = err;
    }
    const msg = message || `Expected function not to throw, but got ${thrownError}`;
    if (threw) {
      recordAssertion(msg, false, {
        message: msg,
        actual: thrownError instanceof Error ? thrownError.message : String(thrownError),
        expected: 'doesNotThrow',
        operator: 'doesNotThrow'
      });
      return;
    }
    recordAssertion(msg, true);
  };

  assertFn.fail = (message = 'Assertion failed') => {
    recordAssertion(message, false, {
      message,
      operator: 'fail'
    });
  };

  function registerTest(name: string, fn: () => void | Promise<void>) {
    const id = `test-${registeredTests.length + 1}`;
    registeredTests.push({ id, name, fn });
  }

  async function runAllTests(): Promise<TestSuiteResult> {
    const suiteStartTime = performance.now();
    const testResults: TestCaseResult[] = [...topLevelAssertions];

    for (const t of registeredTests) {
      currentRunningTest = { id: t.id, name: t.name, assertionsCount: 0 };
      const testStart = performance.now();
      let status: 'pass' | 'fail' = 'pass';
      let failure: TestAssertionFailure | undefined;

      try {
        const res = t.fn();
        if (res && typeof (res as any).then === 'function') {
          await res;
        }
      } catch (err: any) {
        status = 'fail';
        if (err instanceof TestAssertionError) {
          failure = {
            message: err.message,
            actual: err.actual !== undefined ? (typeof err.actual === 'string' ? err.actual : formatAssertionValue(err.actual)) : undefined,
            expected: err.expected !== undefined ? (typeof err.expected === 'string' ? err.expected : formatAssertionValue(err.expected)) : undefined,
            operator: err.operator,
            stack: err.stack
          };
        } else {
          failure = {
            message: err?.message || String(err),
            stack: err?.stack
          };
        }
      }

      const durationMs = Math.round((performance.now() - testStart) * 10) / 10;
      testResults.push({
        id: t.id,
        name: t.name,
        status,
        durationMs,
        error: failure,
        assertionsCount: Math.max(1, currentRunningTest.assertionsCount)
      });
      currentRunningTest = null;
    }

    const suiteDuration = Math.round((performance.now() - suiteStartTime) * 10) / 10;
    const passedCount = testResults.filter(t => t.status === 'pass').length;
    const failedCount = testResults.filter(t => t.status === 'fail').length;

    return {
      total: testResults.length,
      passed: passedCount,
      failed: failedCount,
      durationMs: suiteDuration,
      tests: testResults,
      hasTests: testResults.length > 0
    };
  }

  return {
    test: registerTest,
    it: registerTest,
    expect: createMatchers,
    assert: assertFn,
    getResults: runAllTests,
    hasTests: () => registeredTests.length > 0 || topLevelAssertions.length > 0
  };
}
