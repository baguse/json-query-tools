#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runPipelineTests() {
  console.log('⛓️ Testing Interactive Data Pipeline / Multi-Step Query Staging...');

  // 1. Bundle src/pipeline.ts in memory with mock vscode
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/pipeline.ts')],
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

  const { executePipeline, exportPipelineToSingleQuery, getItemCount, isValidStepAlias } = mod.exports;

  assert.strictEqual(typeof executePipeline, 'function', 'executePipeline must be exported');
  assert.strictEqual(typeof exportPipelineToSingleQuery, 'function', 'exportPipelineToSingleQuery must be exported');

  const sampleData = [
    { id: 1, name: 'Apple', category: 'fruit', price: 1.5, qty: 10, active: true },
    { id: 2, name: 'Banana', category: 'fruit', price: 0.8, qty: 25, active: true },
    { id: 3, name: 'Carrot', category: 'vegetable', price: 1.2, qty: 15, active: false },
    { id: 4, name: 'Donut', category: 'bakery', price: 2.5, qty: 5, active: true }
  ];

  const boundFiles = [
    {
      alias: 'data',
      label: 'inventory.json',
      uri: { fsPath: '/workspace/inventory.json' }
    }
  ];

  const dataMap = {
    data: sampleData
  };

  // Test Case 1: Sequential step chaining with input/prev and aliases
  {
    console.log('  ✓ Test Case 1: Sequential multi-step chaining (Filter -> Enrich -> Sort)');
    const steps = [
      {
        id: 's1',
        name: 'Filter Active',
        alias: 'activeItems',
        expr: 'data.filter(x => x.active)',
        enabled: true
      },
      {
        id: 's2',
        name: 'Compute Total',
        alias: 'enriched',
        expr: 'prev.map(x => ({ ...x, total: Math.round(x.price * x.qty * 100) / 100 }))',
        enabled: true
      },
      {
        id: 's3',
        name: 'Sort by Total Descending',
        alias: 'sorted',
        expr: 'input.slice().sort((a, b) => b.total - a.total)',
        enabled: true
      }
    ];

    const res = await executePipeline({ steps, boundFiles, dataMap });
    assert.strictEqual(res.success, true, 'Pipeline should succeed');
    assert.strictEqual(res.steps.length, 3, 'Should have 3 step results');
    assert.strictEqual(res.steps[0].itemCount, 3, 'Step 1 should produce 3 items');
    assert.strictEqual(res.steps[1].itemCount, 3, 'Step 2 should produce 3 items');
    assert.strictEqual(res.steps[2].itemCount, 3, 'Step 3 should produce 3 items');

    const final = res.finalResult;
    assert.strictEqual(Array.isArray(final), true);
    assert.strictEqual(final.length, 3);
    assert.strictEqual(final[0].name, 'Banana'); // 0.8 * 25 = 20
    assert.strictEqual(final[0].total, 20);
    assert.strictEqual(final[1].name, 'Apple'); // 1.5 * 10 = 15
    assert.strictEqual(final[1].total, 15);
    assert.strictEqual(final[2].name, 'Donut'); // 2.5 * 5 = 12.5
    assert.strictEqual(final[2].total, 12.5);
  }

  // Test Case 2: Cross-step variable scoping and alias access
  {
    console.log('  ✓ Test Case 2: Accessing preceding step aliases and raw data');
    const steps = [
      {
        id: 'step_agg',
        name: 'Calculate Fruit Total',
        alias: 'fruits',
        expr: 'data.filter(x => x.category === "fruit")',
        enabled: true
      },
      {
        id: 'step_summary',
        name: 'Summary with Reference to fruits and raw',
        alias: 'summary',
        expr: '({ totalAll: data.length, fruitCount: fruits.length, prevCount: prev.length })',
        enabled: true
      }
    ];

    const res = await executePipeline({ steps, boundFiles, dataMap });
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.finalResult, {
      totalAll: 4,
      fruitCount: 2,
      prevCount: 2
    });
  }

  // Test Case 3: Step bypass (enabled: false)
  {
    console.log('  ✓ Test Case 3: Step bypass forwarding input unchanged');
    const steps = [
      {
        id: 's1',
        name: 'Filter fruits',
        alias: 'fruits',
        expr: 'data.filter(x => x.category === "fruit")',
        enabled: true
      },
      {
        id: 's2',
        name: 'Disabled Mutation',
        alias: 'skipped',
        expr: 'prev.map(x => ({ ...x, touched: true }))',
        enabled: false // BYPASSED
      },
      {
        id: 's3',
        name: 'Check Downstream Input',
        alias: 'final',
        expr: 'prev.map(x => x.name)',
        enabled: true
      }
    ];

    const res = await executePipeline({ steps, boundFiles, dataMap });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.steps[1].enabled, false);
    assert.strictEqual(res.steps[1].itemCount, 2);
    // Downstream received fruits directly without touched property
    assert.deepStrictEqual(res.finalResult, ['Apple', 'Banana']);
  }

  // Test Case 4: Error localization and early exit
  {
    console.log('  ✓ Test Case 4: Error localization at failing step');
    const steps = [
      {
        id: 's1',
        name: 'Valid Step 1',
        alias: 's1',
        expr: 'data.map(x => x.id)',
        enabled: true
      },
      {
        id: 's2',
        name: 'Failing Step 2',
        alias: 's2',
        expr: 'prev.thisMethodDoesNotExist()',
        enabled: true
      },
      {
        id: 's3',
        name: 'Unreachable Step 3',
        alias: 's3',
        expr: 'prev.concat([999])',
        enabled: true
      }
    ];

    const res = await executePipeline({ steps, boundFiles, dataMap });
    assert.strictEqual(res.success, false, 'Should fail');
    assert.ok(res.error, 'Error should exist');
    assert.strictEqual(res.failedStepId, 's2', 'Error should be localized to Step 2 (id: s2)');
    assert.ok(typeof res.error === 'string' && res.error.includes('thisMethodDoesNotExist'), 'Error message should report missing method');
    assert.strictEqual(res.steps[2].enabled, false, 'Subsequent steps should be marked unexecuted/disabled');
  }

  // Test Case 5: exportPipelineToSingleQuery compilation
  {
    console.log('  ✓ Test Case 5: exportPipelineToSingleQuery compilation');
    const steps = [
      {
        id: 's1',
        name: 'Active Items',
        alias: 'actives',
        expr: 'data.filter(x => x.active)',
        enabled: true
      },
      {
        id: 's2',
        name: 'Bypassed Step',
        alias: 'bypassed',
        expr: 'prev.map(x => x.price)',
        enabled: false
      },
      {
        id: 's3',
        name: 'Names Only',
        alias: 'names',
        expr: 'return prev.map(x => x.name);',
        enabled: true
      }
    ];

    const compiledQuery = exportPipelineToSingleQuery(steps);
    assert.ok(typeof compiledQuery === 'string');
    assert.ok(compiledQuery.includes('Consolidated Multi-Step Data Pipeline Query'));
    assert.ok(compiledQuery.includes('Active Items'));

    // Execute compiled code inside an IIFE function with data
    const evalCompiled = new Function('data', 'raw', compiledQuery);
    const compiledResult = evalCompiled(sampleData, sampleData);
    assert.deepStrictEqual(compiledResult, ['Apple', 'Banana', 'Donut']);
  }

  // Test Case 6: Stdout tagging per step
  {
    console.log('  ✓ Test Case 6: Console stdout captured and tagged per step');
    const capturedStdout = [];
    const steps = [
      {
        id: 's1',
        name: 'Logging Step',
        alias: 'logStep',
        expr: 'console.log("Hello from step 1"); return data.length;',
        enabled: true
      }
    ];

    const res = await executePipeline({
      steps,
      boundFiles,
      dataMap,
      onStdout: (entry) => capturedStdout.push(entry)
    });

    assert.strictEqual(res.success, true);
    assert.ok(capturedStdout.length > 0);
    assert.ok(capturedStdout[0].message.includes('Logging Step') || capturedStdout[0].message.includes('Hello from step 1'));
  }

  // Test Case 7: Async promise steps
  {
    console.log('  ✓ Test Case 7: Asynchronous Promise resolution in steps');
    const steps = [
      {
        id: 'async_step',
        name: 'Async Calculation',
        alias: 'asyncStep',
        expr: 'Promise.resolve(data.map(x => x.qty * 2))',
        enabled: true
      }
    ];

    const res = await executePipeline({ steps, boundFiles, dataMap });
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.finalResult, [20, 50, 30, 10]);
  }

  // Test Case 8: Alias validator and item counter helpers
  {
    console.log('  ✓ Test Case 8: Helper utilities getItemCount and isValidStepAlias');
    assert.strictEqual(getItemCount([1, 2, 3]), 3);
    assert.strictEqual(getItemCount({ a: 1, b: 2 }), 2);
    assert.strictEqual(getItemCount('hello'), undefined);
    assert.strictEqual(getItemCount(123), undefined);
    assert.strictEqual(getItemCount(null), undefined);

    assert.strictEqual(isValidStepAlias('validAlias'), true);
    assert.strictEqual(isValidStepAlias('_step1'), true);
    assert.strictEqual(isValidStepAlias('$step'), true);
    assert.strictEqual(isValidStepAlias('123step'), false);
    assert.strictEqual(isValidStepAlias('invalid-alias'), false);
    assert.strictEqual(isValidStepAlias('has space'), false);
  }

  // Test Case 9: Referencing previous step using valid step name (as identifier)
  {
    console.log('  ✓ Test Case 9: Accessing previous step by valid identifier step name');
    const steps = [
      {
        id: 's1',
        name: 'filterActive',
        alias: '', // fallback to step1
        expr: 'data.filter(x => x.active)',
        enabled: true
      },
      {
        id: 's2',
        name: 'totalCount',
        alias: '',
        expr: 'filterActive.length',
        enabled: true
      }
    ];

    const res = await executePipeline({ steps, boundFiles, dataMap });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.finalResult, 3);

    const singleQuery = exportPipelineToSingleQuery(steps);
    assert.ok(singleQuery.includes('const filterActive = step1;'), 'Single query export should bind step name alias');
  }

  console.log('\n✅ All Interactive Data Pipeline tests passed successfully!\n');
}

runPipelineTests().catch(err => {
  console.error('\n❌ Pipeline test failed:', err);
  process.exit(1);
});
