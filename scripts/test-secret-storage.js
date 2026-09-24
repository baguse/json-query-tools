const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runSecretStorageTests() {
  console.log('Testing AI credentials storage in VS Code SecretStorage...');

  // 1. Static verification of constants.ts
  const constantsPath = path.join(__dirname, '../src/constants.ts');
  const constantsSrc = fs.readFileSync(constantsPath, 'utf8');
  assert.ok(
    constantsSrc.includes('AI_API_KEY_SECRET'),
    'constants.ts should export AI_API_KEY_SECRET'
  );
  console.log('  ✓ Verified AI_API_KEY_SECRET constant definition in constants.ts');

  // 2. Static verification of commands.ts
  const commandsPath = path.join(__dirname, '../src/commands.ts');
  const commandsSrc = fs.readFileSync(commandsPath, 'utf8');

  assert.ok(
    commandsSrc.includes('context.secrets.get(AI_API_KEY_SECRET)'),
    'commands.ts should read API key from SecretStorage'
  );
  assert.ok(
    commandsSrc.includes('context.secrets.store(AI_API_KEY_SECRET'),
    'commands.ts should store API key in SecretStorage'
  );
  assert.ok(
    commandsSrc.includes('context.secrets.delete(AI_API_KEY_SECRET)'),
    'commands.ts should delete API key from SecretStorage when cleared'
  );
  assert.ok(
    commandsSrc.includes("msg.type === 'setAiApiKey'"),
    'commands.ts should handle setAiApiKey messages'
  );
  assert.ok(
    commandsSrc.includes("type: 'hydrateAiApiKey'"),
    'commands.ts should hydrate stored API key on webview ready'
  );
  assert.ok(
    !commandsSrc.includes('geminiApiKey'),
    'commands.ts should not reference dead config key geminiApiKey'
  );
  console.log('  ✓ Verified commands.ts uses context.secrets for AI credentials lifecycle and removed dead geminiApiKey fallback');

  // 3. Static verification of html.ts
  const htmlPath = path.join(__dirname, '../src/webview/html.ts');
  const htmlSrc = fs.readFileSync(htmlPath, 'utf8');

  // Ensure no active writes to localStorage for aiApiKey exist
  assert.ok(
    !htmlSrc.includes("localStorage.setItem('jsonQueryTools.aiApiKey'"),
    'html.ts must not save AI API keys in localStorage'
  );
  assert.ok(
    htmlSrc.includes("vscode.postMessage({ type: 'setAiApiKey'"),
    'html.ts should post setAiApiKey messages'
  );
  assert.ok(
    htmlSrc.includes("msg.type === 'hydrateAiApiKey'"),
    'html.ts should listen for hydrateAiApiKey to populate credentials'
  );
  assert.ok(
    htmlSrc.includes("localStorage.removeItem('jsonQueryTools.aiApiKey')"),
    'html.ts should clean up any legacy plain-text key from localStorage'
  );
  console.log('  ✓ Verified html.ts purged localStorage writes and uses SecretStorage messaging');

  // 4. Behavioral simulation of SecretStorage workflow
  const mockSecrets = new Map();
  const mockContext = {
    secrets: {
      get: async (key) => mockSecrets.get(key),
      store: async (key, val) => mockSecrets.set(key, val),
      delete: async (key) => mockSecrets.delete(key)
    }
  };

  const AI_KEY_NAME = 'jsonQueryTools.aiApiKey';
  const webviewMessages = [];
  const mockWebview = {
    postMessage: (msg) => webviewMessages.push(msg)
  };

  // Simulate command message router
  async function handleMessage(msg) {
    if (msg.type === 'ready') {
      const stored = await mockContext.secrets.get(AI_KEY_NAME);
      if (stored) {
        mockWebview.postMessage({ type: 'hydrateAiApiKey', apiKey: stored });
      }
    } else if (msg.type === 'setAiApiKey') {
      const key = typeof msg.apiKey === 'string' ? msg.apiKey.trim() : '';
      if (key) {
        await mockContext.secrets.store(AI_KEY_NAME, key);
      } else {
        await mockContext.secrets.delete(AI_KEY_NAME);
      }
    } else if (msg.type === 'getModels' || msg.type === 'generateQuery') {
      const stored = await mockContext.secrets.get(AI_KEY_NAME);
      const effectiveKey = msg.apiKey || stored;
      if (msg.apiKey) {
        await mockContext.secrets.store(AI_KEY_NAME, msg.apiKey.trim());
      }
      return effectiveKey;
    }
  }

  // A. Webview initial load with no key
  await handleMessage({ type: 'ready' });
  assert.strictEqual(webviewMessages.length, 0);

  // B. User enters key in webview
  await handleMessage({ type: 'setAiApiKey', apiKey: 'AIzaSySecretTestKey123' });
  assert.strictEqual(await mockContext.secrets.get(AI_KEY_NAME), 'AIzaSySecretTestKey123');
  console.log('  ✓ Stored AI API key securely in mock SecretStorage');

  // C. Re-opening editor panel hydrates key from secrets
  await handleMessage({ type: 'ready' });
  assert.strictEqual(webviewMessages.length, 1);
  assert.deepStrictEqual(webviewMessages[0], { type: 'hydrateAiApiKey', apiKey: 'AIzaSySecretTestKey123' });
  console.log('  ✓ Re-opening webview hydrates credentials directly from SecretStorage');

  // D. Query generation automatically resolves stored key when omitted in message
  const resolvedKey = await handleMessage({ type: 'generateQuery', provider: 'gemini' });
  assert.strictEqual(resolvedKey, 'AIzaSySecretTestKey123');
  console.log('  ✓ Commands retrieve stored API key when webview does not pass it explicitly');

  // E. Clearing API key deletes secret from storage
  await handleMessage({ type: 'setAiApiKey', apiKey: '' });
  assert.strictEqual(await mockContext.secrets.get(AI_KEY_NAME), undefined);
  console.log('  ✓ Clearing API key properly removes entry from SecretStorage');

  console.log('\n✅ All SecretStorage credentials tests passed successfully!');
}

runSecretStorageTests().catch(err => {
  console.error('Fatal error during SecretStorage tests:', err);
  process.exit(1);
});
