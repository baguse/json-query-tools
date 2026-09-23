const assert = require('assert');

async function runPersistedUrlsTests() {
  console.log('Testing URL sources persistence and workspace vs global state fallback...');

  const URL_SOURCES_KEY = 'jsonQueryTools.boundUrls';

  // Simulate VS Code extension context and storage
  function createMockEnvironment({ hasWorkspace = true, initialWorkspaceState = undefined, initialGlobalState = [] }) {
    const workspaceStorage = new Map();
    const globalStorage = new Map();

    if (initialWorkspaceState !== undefined) {
      workspaceStorage.set(URL_SOURCES_KEY, initialWorkspaceState);
    }
    if (initialGlobalState !== undefined) {
      globalStorage.set(URL_SOURCES_KEY, initialGlobalState);
    }

    const mockContext = {
      workspaceState: {
        get: (key) => workspaceStorage.get(key),
        update: async (key, val) => {
          if (val === undefined) {
            workspaceStorage.delete(key);
          } else {
            workspaceStorage.set(key, val);
          }
        }
      },
      globalState: {
        get: (key) => globalStorage.get(key),
        update: async (key, val) => {
          if (val === undefined) {
            globalStorage.delete(key);
          } else {
            globalStorage.set(key, val);
          }
        }
      }
    };

    const mockVscode = {
      workspace: {
        workspaceFolders: hasWorkspace ? [{ uri: { fsPath: '/workspace' } }] : []
      }
    };

    // Evaluator / Commands implementation under test
    function getPersistedUrls() {
      if (mockVscode.workspace.workspaceFolders && mockVscode.workspace.workspaceFolders.length > 0) {
        const fromWorkspace = mockContext.workspaceState.get(URL_SOURCES_KEY);
        if (fromWorkspace !== undefined) return fromWorkspace;
      }
      return mockContext.globalState.get(URL_SOURCES_KEY) ?? [];
    }

    async function savePersistedUrls(urls) {
      if (mockVscode.workspace.workspaceFolders && mockVscode.workspace.workspaceFolders.length > 0) {
        await mockContext.workspaceState.update(URL_SOURCES_KEY, urls);
      } else {
        await mockContext.globalState.update(URL_SOURCES_KEY, urls);
      }
    }

    return {
      mockContext,
      mockVscode,
      getPersistedUrls,
      savePersistedUrls
    };
  }

  const globalUrl1 = { id: 'g1', alias: 'globalApi', url: 'https://global.example.com' };
  const globalUrl2 = { id: 'g2', alias: 'globalAuth', url: 'https://auth.example.com' };

  // 1. Initial workspace load (workspaceState has never set URLs) falls back to globalState
  const env1 = createMockEnvironment({
    hasWorkspace: true,
    initialWorkspaceState: undefined,
    initialGlobalState: [globalUrl1, globalUrl2]
  });
  assert.deepStrictEqual(
    env1.getPersistedUrls(),
    [globalUrl1, globalUrl2],
    'Unset workspaceState should fall back to globalState'
  );
  console.log('  ✓ Unset workspaceState safely falls back to globalState');

  // 2. Clearing all URLs in a workspace (Bug #1.10)
  // Previously: saving `[]` caused `fromWorkspace.length > 0` to be false, resurrecting globalState
  await env1.savePersistedUrls([]);
  assert.deepStrictEqual(
    env1.getPersistedUrls(),
    [],
    'Cleared workspace URLs must remain empty and not restore globalState'
  );
  console.log('  ✓ Clearing all URLs in workspace keeps empty array and does NOT resurrect globalState');

  // 3. Workspace with specific URLs overrides globalState
  const workspaceUrl1 = { id: 'w1', alias: 'localApi', url: 'http://localhost:3000' };
  await env1.savePersistedUrls([workspaceUrl1]);
  assert.deepStrictEqual(
    env1.getPersistedUrls(),
    [workspaceUrl1],
    'Workspace URLs should override globalState'
  );
  console.log('  ✓ Workspace-specific URLs properly override globalState');

  // 4. Standalone window (no workspace folders open)
  const env2 = createMockEnvironment({
    hasWorkspace: false,
    initialWorkspaceState: undefined,
    initialGlobalState: [globalUrl1]
  });
  assert.deepStrictEqual(env2.getPersistedUrls(), [globalUrl1]);

  await env2.savePersistedUrls([]);
  assert.deepStrictEqual(env2.getPersistedUrls(), [], 'Global URLs cleared when no workspace open');
  console.log('  ✓ Standalone window (no workspace folders) reads and writes directly to globalState');

  console.log('\n✅ All URL persistence tests passed successfully!');
}

runPersistedUrlsTests().catch(err => {
  console.error('Fatal error during persisted URLs tests:', err);
  process.exit(1);
});
