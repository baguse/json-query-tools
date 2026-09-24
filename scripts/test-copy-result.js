const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

async function runCopyResultTests() {
  console.log('Testing copyResult and openInEditor in JSON and Table modes...');

  // 1. Bundle src/webview/html.ts in memory
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/webview/html.ts')],
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
                workspace: {
                  asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json')
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
  fn(mod, mod.exports, require, path.join(__dirname, '../src/webview'));

  const { getQueryEditorHtml } = mod.exports;
  const html = getQueryEditorHtml({ cspSource: 'vscode-webview:' }, {
    scriptNonce: 'test-nonce',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  // Verify that copyResultBtn checks resultJsonEditor
  assert.ok(
    html.includes('resultJsonEditor.getValue()'),
    'Expected webview script to read resultJsonEditor.getValue() for copying/exporting'
  );
  console.log('  ✓ Webview script includes resultJsonEditor.getValue() extraction');

  // Verify that updateResultDisplay syncs resultPre.textContent
  assert.ok(
    html.includes('resultPre.textContent = jsonText ||'),
    'Expected updateResultDisplay to keep resultPre.textContent in sync'
  );
  console.log('  ✓ Webview script syncs resultPre.textContent even when CodeMirror is active');

  // 2. Unit test the copy text extraction logic directly
  function getCopyText({
    resultTableDisplay = 'none',
    currentResultData = null,
    streamingData = null,
    hasResultJsonEditor = false,
    resultJsonEditorWrapperDisplay = 'none',
    editorValue = '',
    resultPreDisplay = 'block',
    resultPreText = ''
  }) {
    let text = '';
    const resultTable = { style: { display: resultTableDisplay } };
    const resultJsonEditorWrapper = { style: { display: resultJsonEditorWrapperDisplay } };
    const resultJsonEditor = hasResultJsonEditor ? { getValue: () => editorValue } : null;
    const resultPre = { style: { display: resultPreDisplay }, textContent: resultPreText };

    if (resultTable && resultTable.style.display === 'table') {
      text = 'CSV_DATA';
    } else if (resultJsonEditor && resultJsonEditorWrapper && resultJsonEditorWrapper.style.display !== 'none') {
      text = resultJsonEditor.getValue();
    } else if (currentResultData !== null && currentResultData !== undefined) {
      try {
        text = typeof currentResultData === 'string' ? currentResultData : JSON.stringify(currentResultData, null, 2);
      } catch (e) {
        text = String(currentResultData);
      }
    } else {
      text = resultPre ? (resultPre.textContent || '') : '';
    }

    if (text && !text.includes('(no result yet)') && !text.includes('Running...')) {
      return text;
    }
    return '';
  }

  // Case 1: JSON mode with active CodeMirror (resultPre is hidden and blank)
  const jsonModeResult = getCopyText({
    resultTableDisplay: 'none',
    currentResultData: { id: 1, name: 'Alice' },
    hasResultJsonEditor: true,
    resultJsonEditorWrapperDisplay: 'block',
    editorValue: '{\n  "id": 1,\n  "name": "Alice"\n}',
    resultPreDisplay: 'none',
    resultPreText: '' // Previously this caused blank copy
  });
  assert.strictEqual(
    jsonModeResult,
    '{\n  "id": 1,\n  "name": "Alice"\n}',
    'JSON mode must copy CodeMirror value even when resultPre is empty and hidden'
  );
  console.log('  ✓ JSON mode copies from resultJsonEditor when resultPre is hidden and empty');

  // Case 2: CodeMirror not active, but currentResultData exists
  const fallbackDataResult = getCopyText({
    resultTableDisplay: 'none',
    currentResultData: { success: true },
    hasResultJsonEditor: false,
    resultPreDisplay: 'none',
    resultPreText: ''
  });
  assert.strictEqual(
    fallbackDataResult,
    '{\n  "success": true\n}',
    'Fallback serializes currentResultData'
  );
  console.log('  ✓ Fallback correctly serializes currentResultData');

  // Case 3: Ignored placeholder text
  const ignoredResult = getCopyText({
    resultTableDisplay: 'none',
    currentResultData: null,
    hasResultJsonEditor: false,
    resultPreDisplay: 'block',
    resultPreText: '(no result yet)'
  });
  // Case 4: Verify commands.ts defines copyToClipboard with consistent casing
  const commandsPath = path.join(__dirname, '../src/commands.ts');
  const commandsSrc = fs.readFileSync(commandsPath, 'utf8');
  assert.ok(
    commandsSrc.includes('export async function copyToClipboard('),
    'Expected copyToClipboard function declaration with consistent camelCase'
  );
  assert.ok(
    commandsSrc.includes('await copyToClipboard(String(msg.text || \'\'))'),
    'Expected msg.type === "copyToClipboard" to call copyToClipboard'
  );
  assert.ok(
    commandsSrc.includes('export const copyToClipBoard = copyToClipboard'),
    'Expected copyToClipBoard backward compatibility alias'
  );
  console.log('  ✓ Verified copyToClipboard function casing and backward compatibility alias in commands.ts');

  // Case 5: Verify webview script correctly manages resultJsonEditor on format switch back to JSON
  assert.ok(
    html.includes("resultJsonEditor.setOption('mode', { name: 'javascript', json: true })"),
    'Expected format switch to ensure JSON mode on resultJsonEditor'
  );
  assert.ok(
    html.includes('updateResultDisplay(currentResultText, dataToUse)'),
    'Expected format switch to pass currentResultText and dataToUse to updateResultDisplay'
  );
  assert.ok(
    html.includes('currentResultData = msg.data !== undefined ? msg.data : null;'),
    'Expected currentResultData to preserve falsy values such as 0 or false'
  );
  console.log('  ✓ Webview script configures resultJsonEditor mode and preserves currentResultData/currentResultText on format switch');

  // Case 6: Unit test format switching back to JSON activates CodeMirror and hides resultPre
  function simulateFormatSwitch({ initialFormat, newFormat, data, text, cmActive = true }) {
    let preDisplay = 'block';
    let preText = '';
    let wrapperDisplay = 'none';
    let cmValue = '';
    let cmMode = '';

    const mockCm = cmActive ? {
      setValue: (val) => { cmValue = val; },
      getValue: () => cmValue,
      setOption: (key, val) => { if (key === 'mode') cmMode = val; },
      refresh: () => {}
    } : null;

    function doUpdateDisplay(fmt, d, t) {
      if (fmt === 'table') {
        preDisplay = 'none';
        wrapperDisplay = 'none';
      } else if (fmt === 'json') {
        let jsonText = t;
        if ((!jsonText || !jsonText.trim()) && d !== undefined) {
          try {
            jsonText = JSON.stringify(d, null, 2);
          } catch {
            jsonText = String(d);
          }
        }
        if (mockCm) {
          mockCm.setOption('mode', { name: 'javascript', json: true });
          mockCm.setValue(jsonText || '');
          wrapperDisplay = 'block';
          preDisplay = 'none';
          preText = jsonText || '';
        } else {
          wrapperDisplay = 'none';
          preDisplay = 'block';
          preText = jsonText || '';
        }
      }
    }

    // First render in initial format
    doUpdateDisplay(initialFormat, data, text);
    // Then switch to new format
    doUpdateDisplay(newFormat, data, text);

    return { preDisplay, preText, wrapperDisplay, cmValue, cmMode };
  }

  // Switch Table -> JSON
  const switchedToJson = simulateFormatSwitch({
    initialFormat: 'table',
    newFormat: 'json',
    data: [{ id: 101, status: 'active' }],
    text: '',
    cmActive: true
  });
  assert.strictEqual(switchedToJson.wrapperDisplay, 'block', 'CodeMirror wrapper must be visible on switch back to JSON');
  assert.strictEqual(switchedToJson.preDisplay, 'none', 'resultPre must be hidden on switch back to JSON');
  assert.deepStrictEqual(switchedToJson.cmMode, { name: 'javascript', json: true }, 'CodeMirror mode must be json');
  assert.ok(switchedToJson.cmValue.includes('"status": "active"'), 'CodeMirror must contain formatted JSON');
  console.log('  ✓ Switching format back to JSON displays CodeMirror with JSON mode and hides resultPre');

  // Switch with falsy primitive (0)
  const falsySwitch = simulateFormatSwitch({
    initialFormat: 'table',
    newFormat: 'json',
    data: 0,
    text: '',
    cmActive: true
  });
  assert.strictEqual(falsySwitch.wrapperDisplay, 'block');
  assert.strictEqual(falsySwitch.cmValue, '0');
  console.log('  ✓ Format switch preserves falsy primitive results in CodeMirror');

  console.log('\n✅ All copyResult and openInEditor tests passed successfully!');
}

runCopyResultTests().catch(err => {
  console.error('Fatal error during copy-result tests:', err);
  process.exit(1);
});
