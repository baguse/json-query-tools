const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runStdoutStreamTests() {
  console.log('Testing Real-Time Stdout / Console.log Streaming and Single Execution...');

  // 1. Bundle src/evaluator.ts in memory with mock vscode
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/evaluator.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
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
                  showWarningMessage: () => {},
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

  const bundledCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { evaluateExpression, createExecutionConsole } = mod.exports;

  // Test 1: createExecutionConsole direct capture of various levels
  {
    const entries = [];
    const executionConsole = createExecutionConsole((entry) => {
      entries.push(entry);
    });

    executionConsole.log('Hello', 'World');
    executionConsole.info('User info', 42);
    executionConsole.warn('Warning test');
    executionConsole.error('Error test');
    executionConsole.debug('Debug test');

    assert.strictEqual(entries.length, 5);
    assert.strictEqual(entries[0].level, 'log');
    assert.strictEqual(entries[0].text, 'Hello World');
    assert.strictEqual(entries[1].level, 'info');
    assert.strictEqual(entries[1].text, 'User info 42');
    assert.strictEqual(entries[2].level, 'warn');
    assert.strictEqual(entries[2].text, 'Warning test');
    assert.strictEqual(entries[3].level, 'error');
    assert.strictEqual(entries[3].text, 'Error test');
    assert.strictEqual(entries[4].level, 'debug');
    assert.strictEqual(entries[4].text, 'Debug test');
    console.log('  ✓ [Direct Console] Captures log, info, warn, error, and debug levels');
  }

  // Test 2: console.table formatting
  {
    const entries = [];
    const executionConsole = createExecutionConsole((entry) => {
      entries.push(entry);
    });

    executionConsole.table([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].level, 'table');
    assert.ok(entries[0].text.includes('Alice'));
    assert.ok(entries[0].text.includes('Bob'));
    console.log('  ✓ [Direct Console] console.table formatted representation');
  }

  // Test 3: console.time and console.timeEnd
  {
    const entries = [];
    const executionConsole = createExecutionConsole((entry) => {
      entries.push(entry);
    });

    executionConsole.time('myTimer');
    executionConsole.timeEnd('myTimer');

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].level, 'time');
    assert.ok(entries[0].text.includes('myTimer:'));
    assert.ok(entries[0].text.includes('ms'));
    console.log('  ✓ [Direct Console] console.time and console.timeEnd measures duration');
  }

  // Test 4: console.clear
  {
    const entries = [];
    const executionConsole = createExecutionConsole((entry) => {
      entries.push(entry);
    });

    executionConsole.clear();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].level, 'clear');
    assert.strictEqual(entries[0].text, 'Console was cleared');
    console.log('  ✓ [Direct Console] console.clear outputs clear entry');
  }

  // Test 4b: console.count, console.countReset, console.trace, console.assert, console.timeLog
  {
    const entries = [];
    const executionConsole = createExecutionConsole((entry) => {
      entries.push(entry);
    });

    executionConsole.count('myCounter');
    executionConsole.count('myCounter');
    executionConsole.countReset('myCounter');
    executionConsole.count('myCounter');

    assert.strictEqual(entries[0].text, 'myCounter: 1');
    assert.strictEqual(entries[1].text, 'myCounter: 2');
    assert.strictEqual(entries[2].text, 'myCounter: 1');

    executionConsole.assert(true, 'Should not emit');
    assert.strictEqual(entries.length, 3);

    executionConsole.assert(false, 'Expected failure');
    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[3].level, 'error');
    assert.ok(entries[3].text.includes('Assertion failed: Expected failure'));

    executionConsole.time('t1');
    executionConsole.timeLog('t1', 'checkpoint');
    executionConsole.timeEnd('t1');
    assert.strictEqual(entries.length, 6);
    assert.strictEqual(entries[4].level, 'time');
    assert.ok(entries[4].text.includes('checkpoint'));

    executionConsole.trace('Trace check');
    assert.strictEqual(entries.length, 7);
    assert.strictEqual(entries[6].level, 'debug');
    assert.ok(entries[6].text.includes('Trace check'));

    console.log('  ✓ [Direct Console] console.count, assert, timeLog, and trace functions work properly');
  }

  // Test 5: evaluateExpression single execution & stdout streaming
  {
    const boundFiles = [{ alias: 'data', uri: { fsPath: '/test/data.json' } }];
    const dataMap = { data: [1, 2, 3, 4] };
    const streamedLogs = [];

    let count = 0;
    const expr = `
      console.log('Starting query execution');
      const doubled = data.map(x => {
        console.log('Processing item', x);
        return x * 2;
      });
      console.log('Completed query');
      return doubled;
    `;

    const res = await evaluateExpression(boundFiles, dataMap, expr, undefined, (entry) => {
      streamedLogs.push(entry);
    });

    assert.deepStrictEqual(res, [2, 4, 6, 8]);
    assert.strictEqual(streamedLogs.length, 6);
    assert.strictEqual(streamedLogs[0].text, 'Starting query execution');
    assert.strictEqual(streamedLogs[1].text, 'Processing item 1');
    assert.strictEqual(streamedLogs[2].text, 'Processing item 2');
    assert.strictEqual(streamedLogs[3].text, 'Processing item 3');
    assert.strictEqual(streamedLogs[4].text, 'Processing item 4');
    assert.strictEqual(streamedLogs[5].text, 'Completed query');
    console.log('  ✓ [evaluateExpression] Intercepts and streams logs in real-time during statement execution');
  }

  // Test 6: Verify EXACTLY ONCE execution (no duplicate console.log calls)
  {
    const boundFiles = [{ alias: 'data', uri: { fsPath: '/test/data.json' } }];
    const dataMap = { data: { items: [1, 2], count: 10 } };
    const logs = [];

    // Case 1: Single expression (which in older evaluator ran twice)
    const singleExpr = `data.items.map(x => { console.log('mapped-' + x); return x * 10; })`;
    const resSingle = await evaluateExpression(boundFiles, dataMap, singleExpr, undefined, (entry) => {
      logs.push(entry.text);
    });

    assert.deepStrictEqual(resSingle, [10, 20]);
    assert.strictEqual(logs.length, 2); // exactly 1 log per item, NOT 4 logs
    assert.strictEqual(logs[0], 'mapped-1');
    assert.strictEqual(logs[1], 'mapped-2');

    // Case 2: Multi-statement with return
    const multiLogs = [];
    const multiExpr = `console.log('executing-once-check'); return data.count * 5;`;
    const resMulti = await evaluateExpression(boundFiles, dataMap, multiExpr, undefined, (entry) => {
      multiLogs.push(entry.text);
    });

    assert.strictEqual(resMulti, 50);
    assert.strictEqual(multiLogs.length, 1);
    assert.strictEqual(multiLogs[0], 'executing-once-check');

    console.log('  ✓ [Single Execution] Expressions and statements execute exactly once without duplicate logs');
  }

  // Test 7: Async queries with console.log streaming
  {
    const boundFiles = [{ alias: 'data', uri: { fsPath: '/test/data.json' } }];
    const dataMap = { data: ['apple', 'banana'] };
    const logs = [];

    const expr = `
      console.info('Before async wait');
      await new Promise(r => setTimeout(r, 10));
      console.info('After async wait');
      return data.map(s => s.toUpperCase());
    `;

    const res = await evaluateExpression(boundFiles, dataMap, expr, undefined, (entry) => {
      logs.push(entry);
    });

    assert.deepStrictEqual(res, ['APPLE', 'BANANA']);
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0].text, 'Before async wait');
    assert.strictEqual(logs[1].text, 'After async wait');
    console.log('  ✓ [Async Execution] Streams stdout logs across async/await boundaries');
  }

  // Test 8: User alias named 'console' does not crash evaluator
  {
    const boundFiles = [{ alias: 'console', uri: { fsPath: '/test/console.json' } }];
    const dataMap = { console: { custom: 'custom-data' } };
    const logs = [];

    const expr = `console.custom`;

    const res = await evaluateExpression(boundFiles, dataMap, expr, undefined, (entry) => {
      logs.push(entry);
    });

    assert.strictEqual(res, 'custom-data');
    console.log('  ✓ [Alias Conflict] User data alias named "console" safely takes precedence');
  }

  console.log('\n✅ All stdout stream and single-execution tests passed successfully!\n');
}

runStdoutStreamTests().catch((err) => {
  console.error('\n❌ Stdout streaming tests failed:', err);
  process.exit(1);
});
