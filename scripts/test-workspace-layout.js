const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');
const vm = require('vm');

async function runWorkspaceLayoutTests() {
  console.log('Testing Workspace Layout (Split/Stacked View) & AI Assistant Drawer...');

  // 1. Bundle src/webview/html.ts in memory with mock vscode
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
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            contents: 'module.exports = { workspace: { asRelativePath: (u) => (typeof u === "string" ? u : (u && u.fsPath) || "file.json") } };',
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
    scriptNonce: 'test-nonce-layout',
    boundFiles: [{ alias: 'data', uri: { fsPath: '/workspace/test.json' } }]
  });

  // 2. Verify HTML Structure and Elements
  assert.ok(html.includes('id="workspaceLayout"'), 'HTML must contain #workspaceLayout');
  assert.ok(html.includes('id="editorPane"'), 'HTML must contain #editorPane');
  assert.ok(html.includes('id="resultPane"'), 'HTML must contain #resultPane');
  assert.ok(html.includes('id="layoutToggleBtn"'), 'HTML must contain #layoutToggleBtn');
  assert.ok(html.includes('id="layoutToggleIcon"'), 'HTML must contain #layoutToggleIcon');
  assert.ok(html.includes('id="layoutToggleLabel"'), 'HTML must contain #layoutToggleLabel');
  assert.ok(html.includes('id="toggleAiDrawerBtn"'), 'HTML must contain #toggleAiDrawerBtn');
  assert.ok(html.includes('id="aiDrawer"'), 'HTML must contain #aiDrawer');
  assert.ok(html.includes('.workspace-layout.split'), 'CSS must define .workspace-layout.split');
  assert.ok(html.includes('.workspace-layout.stacked'), 'CSS must define .workspace-layout.stacked');
  assert.ok(html.includes('body.layout-split'), 'CSS must define body.layout-split');
  console.log('  ✓ Workspace layout & AI drawer HTML markup and CSS rules verified');

  // Verify default collapsed state of AI Drawer in HTML
  assert.ok(
    html.includes('id="aiDrawer"') && html.includes('display: none'),
    'AI drawer must be collapsed (display: none) by default to save vertical workspace'
  );
  console.log('  ✓ AI Assistant Drawer defaults to collapsed (display: none)');

  // 3. Test functional behavior in DOM sandbox
  const scriptMatch = html.match(/<script nonce="test-nonce-layout">([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Generated HTML must contain a script tag with nonce');
  const webviewScript = scriptMatch[1];

  function createMockElement(id) {
    const classListSet = new Set();
    const children = [];
    return {
      id: id,
      style: { display: '' },
      textContent: '',
      title: '',
      parentElement: null,
      children: children,
      appendChild(child) {
        if (child.parentElement && child.parentElement.children) {
          const idx = child.parentElement.children.indexOf(child);
          if (idx !== -1) child.parentElement.children.splice(idx, 1);
        }
        child.parentElement = this;
        children.push(child);
        return child;
      },
      classList: {
        add: (c) => classListSet.add(c),
        remove: (c) => classListSet.delete(c),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classListSet.has(c)) { classListSet.delete(c); return false; }
            else { classListSet.add(c); return true; }
          }
          if (force) classListSet.add(c);
          else classListSet.delete(c);
          return force;
        },
        contains: (c) => classListSet.has(c)
      }
    };
  }

  const elements = {
    workspaceLayout: createMockElement('workspaceLayout'),
    editorPane: createMockElement('editorPane'),
    resultPane: createMockElement('resultPane'),
    history: createMockElement('history'),
    layoutToggleBtn: createMockElement('layoutToggleBtn'),
    layoutToggleIcon: createMockElement('layoutToggleIcon'),
    layoutToggleLabel: createMockElement('layoutToggleLabel'),
    aiDrawer: createMockElement('aiDrawer'),
    toggleAiDrawerBtn: createMockElement('toggleAiDrawerBtn')
  };

  elements.workspaceLayout.appendChild(elements.editorPane);
  elements.workspaceLayout.appendChild(elements.resultPane);
  elements.workspaceLayout.appendChild(elements.history);
  elements.aiDrawer.style.display = 'none';

  const store = {};
  const mockLocalStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };

  const mockBody = createMockElement('body');

  const sandbox = {
    document: {
      getElementById: (id) => elements[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => createMockElement(tag),
      addEventListener: () => {},
      body: mockBody
    },
    window: {
      localStorage: mockLocalStorage,
      addEventListener: () => {}
    },
    localStorage: mockLocalStorage,
    acquireVsCodeApi: () => ({ postMessage: () => {}, setState: () => {}, getState: () => null }),
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
    console
  };

  vm.createContext(sandbox);

  // Extract layout controller code from script
  const startMarker = '// Workspace Layout & AI Drawer Controls';
  const endMarker = '// Initialize Config';
  const startIdx = webviewScript.indexOf(startMarker);
  const endIdx = webviewScript.indexOf(endMarker);
  assert.ok(startIdx !== -1, 'Must find start marker for layout controls');
  assert.ok(endIdx !== -1, 'Must find end marker for layout controls');

  const layoutScript = webviewScript.substring(startIdx, endIdx);
  vm.runInContext(layoutScript, sandbox);

  const { setLayoutMode, toggleAiDrawer } = sandbox;
  assert.strictEqual(typeof setLayoutMode, 'function', 'setLayoutMode must be a function');
  assert.strictEqual(typeof toggleAiDrawer, 'function', 'toggleAiDrawer must be a function');

  // Test 1: Split layout activation
  setLayoutMode('split');
  assert.ok(elements.workspaceLayout.classList.contains('split'), 'workspaceLayout must have split class');
  assert.ok(!elements.workspaceLayout.classList.contains('stacked'), 'workspaceLayout must not have stacked class');
  assert.ok(mockBody.classList.contains('layout-split'), 'document.body must have layout-split class');
  assert.ok(elements.layoutToggleBtn.classList.contains('active'), 'layoutToggleBtn must have active class');
  assert.strictEqual(elements.layoutToggleIcon.textContent, '☰', 'Icon must show stacked glyph when in split view');
  assert.strictEqual(elements.layoutToggleLabel.textContent, 'Stacked View', 'Label must offer switch to Stacked View');
  assert.strictEqual(elements.history.parentElement, elements.editorPane, 'history must be reparented inside editorPane in split mode');
  assert.strictEqual(mockLocalStorage.getItem('jsonQueryTools.layoutMode'), 'split', 'layoutMode must persist to localStorage');
  console.log('  ✓ Split mode activates classes, icons, localStorage, and reparents history to editorPane');

  // Test 2: Stacked layout restoration
  setLayoutMode('stacked');
  assert.ok(!elements.workspaceLayout.classList.contains('split'), 'workspaceLayout must not have split class');
  assert.ok(elements.workspaceLayout.classList.contains('stacked'), 'workspaceLayout must have stacked class');
  assert.ok(!mockBody.classList.contains('layout-split'), 'document.body must not have layout-split class');
  assert.ok(!elements.layoutToggleBtn.classList.contains('active'), 'layoutToggleBtn must not have active class');
  assert.strictEqual(elements.layoutToggleIcon.textContent, '◫', 'Icon must show split glyph when in stacked view');
  assert.strictEqual(elements.layoutToggleLabel.textContent, 'Split View', 'Label must offer switch to Split View');
  assert.strictEqual(elements.history.parentElement, elements.workspaceLayout, 'history must be reparented back to workspaceLayout in stacked mode');
  assert.strictEqual(mockLocalStorage.getItem('jsonQueryTools.layoutMode'), 'stacked', 'layoutMode stacked must persist to localStorage');
  console.log('  ✓ Stacked mode restores classes, icons, localStorage, and reparents history to workspaceLayout');

  // Test 3: AI Drawer Toggle
  toggleAiDrawer(true);
  assert.strictEqual(elements.aiDrawer.style.display, 'flex', 'aiDrawer style.display must be flex when open');
  assert.ok(elements.toggleAiDrawerBtn.classList.contains('active'), 'toggleAiDrawerBtn must have active class when open');
  assert.strictEqual(mockLocalStorage.getItem('jsonQueryTools.aiDrawerOpen'), 'true', 'aiDrawerOpen true must persist');

  toggleAiDrawer(false);
  assert.strictEqual(elements.aiDrawer.style.display, 'none', 'aiDrawer style.display must be none when closed');
  assert.ok(!elements.toggleAiDrawerBtn.classList.contains('active'), 'toggleAiDrawerBtn must not have active class when closed');
  assert.strictEqual(mockLocalStorage.getItem('jsonQueryTools.aiDrawerOpen'), 'false', 'aiDrawerOpen false must persist');
  console.log('  ✓ AI drawer toggle open/close and persistence verified');

  console.log('✅ Workspace Layout & AI Assistant Drawer tests completed successfully!');
}

runWorkspaceLayoutTests().catch(err => {
  console.error('❌ Workspace Layout test failed:', err);
  process.exit(1);
});
