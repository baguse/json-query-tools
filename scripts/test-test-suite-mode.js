#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runTestSuiteModeTests() {
  console.log('🧪 Testing Smart Assertion & Test Suite Mode...');

  // 1. Bundle src/testRunner.ts and src/evaluator.ts in memory with mock vscode
  const result = await esbuild.build({
    entryPoints: [
      path.join(__dirname, '../src/testRunner.ts'),
      path.join(__dirname, '../src/evaluator.ts')
    ],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
    outdir: 'out',
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({
            path: 'vscode',
            namespace: 'mock-vscode'
          }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            contents: `
              module.exports = {
                window: {
                  showWarningMessage: (msg) => { globalThis.__lastWarning = msg; },
                  showErrorMessage: () => {}
                },
                workspace: {
                  workspaceFolders: [{ uri: { fsPath: __dirname } }],
                  getWorkspaceFolder: () => ({ uri: { fsPath: __dirname } }),
                  getConfiguration: () => ({ get: () => ({}) })
                }
              };
            `,
            loader: 'js'
          }));
        }
      }
    ]
  });

  // Extract bundled outputs
  let testRunnerCode = '';
  let evaluatorCode = '';
  for (const file of result.outputFiles) {
    if (file.path.endsWith('testRunner.js')) {
      testRunnerCode = file.text;
    } else if (file.path.endsWith('evaluator.js')) {
      evaluatorCode = file.text;
    }
  }

  const trMod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', testRunnerCode)(
    trMod,
    trMod.exports,
    require,
    path.join(__dirname, '../src')
  );
  const { createTestEnvironment, isDeepEqual, formatAssertionValue, getNestedProperty } = trMod.exports;

  const evMod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', evaluatorCode)(
    evMod,
    evMod.exports,
    require,
    path.join(__dirname, '../src')
  );
  const { evaluateExpression, evaluateTestSuiteAgainstSources } = evMod.exports;

  // --- UNIT TESTS: isDeepEqual and formatAssertionValue ---
  console.log('  Testing deep equality and format helpers...');
  assert.strictEqual(isDeepEqual(1, 1), true);
  assert.strictEqual(isDeepEqual(1, 2), false);
  assert.strictEqual(isDeepEqual('abc', 'abc'), true);
  assert.strictEqual(isDeepEqual(null, null), true);
  assert.strictEqual(isDeepEqual(undefined, undefined), true);
  assert.strictEqual(isDeepEqual(null, undefined), false);
  assert.strictEqual(isDeepEqual([1, 2, 3], [1, 2, 3]), true);
  assert.strictEqual(isDeepEqual([1, 2, 3], [1, 2, 4]), false);
  assert.strictEqual(isDeepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] }), true);
  assert.strictEqual(isDeepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.strictEqual(isDeepEqual(new Date(1000), new Date(1000)), true);
  assert.strictEqual(isDeepEqual(new Date(1000), new Date(2000)), false);
  assert.strictEqual(isDeepEqual(/abc/g, /abc/g), true);
  assert.strictEqual(isDeepEqual(/abc/g, /abc/i), false);

  // Circular reference deep equality
  const circA = { val: 1 }; circA.self = circA;
  const circB = { val: 1 }; circB.self = circB;
  assert.strictEqual(isDeepEqual(circA, circB), true);

  // Property path retrieval
  const obj = { user: { profile: { name: 'Alice', tags: ['admin', 'dev'] } } };
  assert.strictEqual(getNestedProperty(obj, 'user.profile.name').value, 'Alice');
  assert.strictEqual(getNestedProperty(obj, 'user.profile.tags[0]').value, 'admin');
  assert.strictEqual(getNestedProperty(obj, 'user.profile.tags[1]').value, 'dev');
  assert.strictEqual(getNestedProperty(obj, 'user.missing.property').found, false);

  // --- UNIT TESTS: Expect Matchers ---
  console.log('  Testing fluent expect matchers...');
  {
    const ctx = createTestEnvironment();
    const { expect } = ctx;

    // toBe
    expect(42).toBe(42);
    expect('hello').toBe('hello');
    expect('hello').not.toBe('world');
    assert.throws(() => expect(42).toBe(43));
    assert.throws(() => expect(42).not.toBe(42));

    // toEqual
    expect({ x: 10, y: [1, 2] }).toEqual({ x: 10, y: [1, 2] });
    expect({ x: 10 }).not.toEqual({ x: 11 });
    assert.throws(() => expect({ x: 10 }).toEqual({ x: 11 }));

    // toBeNull, toBeUndefined, toBeDefined, toBeNaN
    expect(null).toBeNull();
    expect(undefined).not.toBeNull();
    expect(undefined).toBeUndefined();
    expect('val').toBeDefined();
    expect(null).toBeDefined();
    expect(NaN).toBeNaN();
    expect(42).not.toBeNaN();

    // toBeTruthy, toBeFalsy
    expect(true).toBeTruthy();
    expect('non-empty').toBeTruthy();
    expect(1).toBeTruthy();
    expect(false).toBeFalsy();
    expect('').toBeFalsy();
    expect(0).toBeFalsy();
    expect(null).toBeFalsy();

    // Comparisons
    expect(10).toBeGreaterThan(5);
    expect(10).toBeGreaterThanOrEqual(10);
    expect(5).toBeLessThan(10);
    expect(5).toBeLessThanOrEqual(5);
    expect(0.1 + 0.2).toBeCloseTo(0.3, 5);

    // toContain
    expect([1, 2, 3]).toContain(2);
    expect([1, 2, 3]).not.toContain(4);
    expect('hello world').toContain('world');
    expect({ a: 1, b: 2 }).toContain('a');

    // toHaveLength
    expect([1, 2, 3]).toHaveLength(3);
    expect('test').toHaveLength(4);
    expect(new Set([1, 2])).toHaveLength(2);

    // toHaveProperty
    expect({ a: { b: 42 } }).toHaveProperty('a.b');
    expect({ a: { b: 42 } }).toHaveProperty('a.b', 42);
    assert.throws(() => expect({ a: { b: 42 } }).toHaveProperty('a.b', 99));

    // toMatch
    expect('user-12345').toMatch(/^user-\d+$/);
    expect('hello world').toMatch('world');
    expect('user-abc').not.toMatch(/^user-\d+$/);

    // Type matchers
    expect([]).toBeArray();
    expect([1]).toBeArray();
    expect({}).toBeObject();
    expect('text').toBeString();
    expect(123).toBeNumber();
    expect(true).toBeBoolean();
    expect(123).toBeTypeOf('number');

    // toThrow
    expect(() => { throw new Error('Boom'); }).toThrow();
    expect(() => { throw new Error('Boom'); }).toThrow('Boom');
    expect(() => { throw new Error('Boom'); }).toThrow(/oom/);
    expect(() => { return 42; }).not.toThrow();
    assert.throws(() => expect(() => {}).toThrow());
  }

  // --- UNIT TESTS: Assert Interface ---
  console.log('  Testing Node-compatible assert interface...');
  {
    const ctx = createTestEnvironment();
    const { assert: a } = ctx;

    a(true);
    a(1 + 1 === 2, 'Math works');
    a.ok(true);
    a.strictEqual(5, 5);
    a.notStrictEqual(5, 6);
    a.deepStrictEqual({ a: 1 }, { a: 1 });
    a.notDeepStrictEqual({ a: 1 }, { a: 2 });
    a.match('test@example.com', /^.+@.+\..+$/);
    a.throws(() => { throw new Error('Fail'); });
    a.doesNotThrow(() => { return 1; });
    assert.throws(() => a(false, 'Should fail'));
    assert.throws(() => a.strictEqual(1, 2));
    assert.throws(() => a.fail('Custom failure'));
  }

  // --- UNIT TESTS: Synchronous & Async Test Blocks Execution ---
  console.log('  Testing test() / it() suite execution...');
  {
    const ctx = createTestEnvironment();
    const { test, it, expect } = ctx;

    test('Sync pass 1', () => {
      expect(10).toBe(10);
    });

    it('Sync pass 2', () => {
      expect('abc').toBe('abc');
    });

    test('Async pass 3', async () => {
      await new Promise(r => setTimeout(r, 10));
      expect(true).toBe(true);
    });

    test('Sync failure', () => {
      expect(5).toBe(99);
    });

    test('Async failure', async () => {
      await new Promise(r => setTimeout(r, 10));
      throw new Error('Async error occurred');
    });

    const suite = await ctx.getResults();
    assert.strictEqual(suite.total, 5);
    assert.strictEqual(suite.passed, 3);
    assert.strictEqual(suite.failed, 2);
    assert.strictEqual(suite.tests[0].status, 'pass');
    assert.strictEqual(suite.tests[1].status, 'pass');
    assert.strictEqual(suite.tests[2].status, 'pass');
    assert.strictEqual(suite.tests[3].status, 'fail');
    assert.strictEqual(suite.tests[3].error.actual, '5');
    assert.strictEqual(suite.tests[3].error.expected, '99');
    assert.strictEqual(suite.tests[4].status, 'fail');
    assert.strictEqual(suite.tests[4].error.message, 'Async error occurred');
  }

  // --- UNIT TESTS: Top-Level Assertion Capture ---
  console.log('  Testing top-level assertion capture...');
  {
    const ctx = createTestEnvironment();
    const { expect, assert: a } = ctx;

    // Top-level assertions without test() blocks
    expect('antigravity').toBeDefined();
    expect([1, 2, 3]).toHaveLength(3);
    a(100 > 50, '100 is greater than 50');

    const suite = await ctx.getResults();
    assert.strictEqual(suite.total, 3);
    assert.strictEqual(suite.passed, 3);
    assert.strictEqual(suite.failed, 0);
  }

  // --- INTEGRATION TESTS: evaluateExpression with Test Suite ---
  console.log('  Testing evaluateExpression integration...');
  {
    const boundFiles = [{ alias: 'data', uri: { fsPath: '/test/data.json' } }];
    const dataMap = {
      data: {
        status: 200,
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' }
        ]
      }
    };

    // 1. Pure test suite (expression returns undefined, but tests ran)
    let capturedSuite = null;
    const expr1 = `
      test('HTTP 200 status', () => {
        expect(data.status).toBe(200);
      });
      test('Users collection not empty', () => {
        expect(data.users).toBeArray();
        expect(data.users.length).toBeGreaterThan(0);
      });
    `;
    const res1 = await evaluateExpression(boundFiles, dataMap, expr1, undefined, undefined, (s) => {
      capturedSuite = s;
    });

    assert.ok(capturedSuite, 'Test suite must be captured in callback');
    assert.strictEqual(capturedSuite.total, 2);
    assert.strictEqual(capturedSuite.passed, 2);
    assert.strictEqual(capturedSuite.failed, 0);
    assert.ok(res1, 'Result must return test suite when expression returns undefined');
    assert.strictEqual(res1.passed, 2);

    // 2. Dual mode: returns data AND runs tests
    let dualSuite = null;
    const expr2 = `
      test('Validate contract', () => {
        expect(data.status).toBe(200);
      });
      return data.users.map(u => u.name);
    `;
    const res2 = await evaluateExpression(boundFiles, dataMap, expr2, undefined, undefined, (s) => {
      dualSuite = s;
    });

    assert.ok(dualSuite, 'Dual mode must capture test suite');
    assert.strictEqual(dualSuite.passed, 1);
    assert.deepStrictEqual(res2, ['Alice', 'Bob']);

    // 3. Top-level assertions in evaluateExpression
    let topLevelSuite = null;
    const expr3 = `
      expect(data.status).toBe(200);
      assert(data.users.length === 2, 'Must have 2 users');
    `;
    const res3 = await evaluateExpression(boundFiles, dataMap, expr3, undefined, undefined, (s) => {
      topLevelSuite = s;
    });
    assert.ok(topLevelSuite, 'Top level assertions must be captured');
    assert.strictEqual(topLevelSuite.total, 2);
    assert.strictEqual(topLevelSuite.passed, 2);

    // 4. Test failure reporting
    let failingSuite = null;
    const expr4 = `
      test('Should fail gracefully', () => {
        expect(data.status).toBe(500);
      });
    `;
    const res4 = await evaluateExpression(boundFiles, dataMap, expr4, undefined, undefined, (s) => {
      failingSuite = s;
    });
    assert.ok(failingSuite, 'Failing suite captured');
    assert.strictEqual(failingSuite.failed, 1);
    assert.strictEqual(failingSuite.tests[0].error.expected, '500');
    assert.strictEqual(failingSuite.tests[0].error.actual, '200');

    // 5. Test Target Data Selection (target = 'result' vs 'source')
    console.log('  Testing test suite evaluation against Query Result (target=result)...');
    const rawSource = { items: [{ id: 101, active: true, role: 'admin' }, { id: 102, active: false, role: 'guest' }] };
    const queryOutput = rawSource.items.filter(x => x.active).map(x => ({ id: x.id, role: x.role.toUpperCase() }));
    const targetResultDataMap = {
      data: queryOutput,
      result: queryOutput,
      raw: rawSource
    };
    let targetSuite = null;
    const exprTarget = `
      test('data is targeted query output', () => {
        expect(data).toBeArray();
        expect(data.length).toBe(1);
        expect(data[0].id).toBe(101);
        expect(data[0].role).toBe('ADMIN');
      });
      test('raw provides access to source data', () => {
        expect(raw.items.length).toBe(2);
      });
      test('result is identical to data in query result mode', () => {
        expect(result).toEqual(data);
      });
    `;
    const resTarget = await evaluateExpression(boundFiles, targetResultDataMap, exprTarget, undefined, undefined, (s) => {
      targetSuite = s;
    });
    assert.ok(targetSuite, 'Target suite captured');
    assert.strictEqual(targetSuite.total, 3);
    assert.strictEqual(targetSuite.passed, 3);
    assert.strictEqual(targetSuite.failed, 0);

    // 6. Test Node assert throws and doesNotThrow in runner
    console.log('  Testing assert.throws and assert.doesNotThrow...');
    let assertSuite = null;
    const exprAssert = `
      test('assert.throws catches expected error', () => {
        assert.throws(() => { throw new Error('Boom'); }, /Boom/);
      });
      test('assert.doesNotThrow passes clean function', () => {
        assert.doesNotThrow(() => { const x = 42; return x; });
      });
    `;
    const resAssert = await evaluateExpression(boundFiles, dataMap, exprAssert, undefined, undefined, (s) => {
      assertSuite = s;
    });
    assert.ok(assertSuite, 'Assert suite captured');
    assert.strictEqual(assertSuite.total, 2);
    assert.strictEqual(assertSuite.passed, 2);
    assert.strictEqual(assertSuite.failed, 0);

    // 7. Multi-Source Respective Test Suite Evaluation (target = 'all')
    console.log('  Testing multi-source respective test suite evaluation (target=all)...');
    const sourcesList = [
      { label: 'users.json', alias: 'users' },
      { label: 'orders.json', alias: 'orders' }
    ];
    const multiRawDataMap = {
      users: { type: 'dataset', items: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] },
      orders: { type: 'dataset', items: [{ id: 101, total: 50 }, { id: 102, total: 100 }] }
    };
    const exprMulti = `
      test('dataset has type and non-empty items', () => {
        expect(data.type).toBe('dataset');
        expect(data.items).toBeArray();
        expect(data.items.length).toBeGreaterThan(0);
      });
      test('cross-alias access is preserved', () => {
        expect(users).toBeDefined();
        expect(orders).toBeDefined();
      });
    `;
    const multiSuite = await evaluateTestSuiteAgainstSources(
      boundFiles,
      sourcesList,
      multiRawDataMap,
      undefined,
      exprMulti
    );

    assert.ok(multiSuite, 'Multi-source suite must return result');
    assert.strictEqual(multiSuite.total, 4, 'Should execute 2 tests per source = 4 total');
    assert.strictEqual(multiSuite.passed, 4, 'All tests should pass across both sources');
    assert.strictEqual(multiSuite.failed, 0);
    assert.strictEqual(multiSuite.tests[0].name, '[users.json] dataset has type and non-empty items');
    assert.strictEqual(multiSuite.tests[1].name, '[users.json] cross-alias access is preserved');
    assert.strictEqual(multiSuite.tests[2].name, '[orders.json] dataset has type and non-empty items');
    assert.strictEqual(multiSuite.tests[3].name, '[orders.json] cross-alias access is preserved');

    // 8. Multi-Source with a failing source (isolation & error prefixing)
    console.log('  Testing multi-source with per-source failure isolation...');
    const exprMultiFailing = `
      test('has user items with names', () => {
        expect(data.items[0].name).toBeDefined();
      });
    `;
    const failingMultiSuite = await evaluateTestSuiteAgainstSources(
      boundFiles,
      sourcesList,
      multiRawDataMap,
      undefined,
      exprMultiFailing
    );
    assert.strictEqual(failingMultiSuite.total, 2);
    assert.strictEqual(failingMultiSuite.passed, 1, 'users.json should pass');
    assert.strictEqual(failingMultiSuite.failed, 1, 'orders.json should fail because items lack name');
    assert.strictEqual(failingMultiSuite.tests[0].name, '[users.json] has user items with names');
    assert.strictEqual(failingMultiSuite.tests[0].status, 'pass');
    assert.strictEqual(failingMultiSuite.tests[1].name, '[orders.json] has user items with names');
    assert.strictEqual(failingMultiSuite.tests[1].status, 'fail');

    // 9. Source list label extraction from bound files and URLs
    console.log('  Testing source list label extraction from bound files and URLs...');
    const testBoundFiles = [
      { alias: 'users', uri: { fsPath: '/path/to/users.json' } },
      { alias: 'empty', uri: { fsPath: '' } }
    ];
    const testBoundUrls = [
      { alias: 'apiUsers', url: 'https://api.example.com/users', label: 'API Users' },
      { alias: 'apiRaw', url: 'https://api.example.com/raw' }
    ];
    const extractedSources = [
      ...testBoundFiles.map(f => ({ alias: f.alias, label: (f.uri && f.uri.fsPath && path.basename(f.uri.fsPath)) || f.alias })),
      ...testBoundUrls.map(u => ({ alias: u.alias, label: u.label || u.url }))
    ];
    assert.strictEqual(extractedSources[0].label, 'users.json');
    assert.strictEqual(extractedSources[1].label, 'empty');
    assert.strictEqual(extractedSources[2].label, 'API Users');
    assert.strictEqual(extractedSources[3].label, 'https://api.example.com/raw');

    // 10. Single-Pass Combined Test Execution for All Bound Sources
    console.log('  Testing single-pass combined test execution for all bound sources...');
    const combinedDataMap = {
      ...multiRawDataMap,
      data: multiRawDataMap,
      raw: multiRawDataMap
    };
    let combinedSuite = null;
    const exprCombined = `
      test('direct alias access for users and orders', () => {
        expect(users.type).toBe('dataset');
        expect(orders.type).toBe('dataset');
      });
      test('cross-source relational validation runs once', () => {
        expect(users.items.length).toBe(2);
        expect(orders.items.length).toBe(2);
        expect(data.users).toBeDefined();
        expect(raw.orders).toBeDefined();
      });
    `;
    await evaluateExpression(boundFiles, combinedDataMap, exprCombined, undefined, undefined, (s) => {
      combinedSuite = s;
    });
    assert.ok(combinedSuite, 'Combined suite must return result');
    assert.strictEqual(combinedSuite.total, 2, 'Should execute exactly 2 tests (run once)');
    assert.strictEqual(combinedSuite.passed, 2);
    assert.strictEqual(combinedSuite.failed, 0);
    assert.strictEqual(combinedSuite.tests[0].name, 'direct alias access for users and orders');
    assert.strictEqual(combinedSuite.tests[1].name, 'cross-source relational validation runs once');
  }

  console.log('\n✅ Smart Assertion & Test Suite Mode tests passed successfully!\n');
}

runTestSuiteModeTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
