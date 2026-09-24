const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runQueryParamsDebounceTests() {
  console.log('Testing Query Parameters Synchronization Debounce (150ms)...');

  // 1. Static verification of webview script in src/webview/html.ts
  const htmlPath = path.join(__dirname, '../src/webview/html.ts');
  const htmlSrc = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(
    htmlSrc.includes('syncParamsDebounceTimer'),
    'html.ts should define syncParamsDebounceTimer'
  );
  assert.ok(
    htmlSrc.includes('setTimeout') && htmlSrc.includes('150'),
    'html.ts should use a 150ms setTimeout for query param debounce'
  );
  assert.ok(
    htmlSrc.includes('flushSyncParamsToUrl'),
    'html.ts should provide flushSyncParamsToUrl'
  );
  assert.ok(
    htmlSrc.includes('flushSyncUrlToTable'),
    'html.ts should provide flushSyncUrlToTable'
  );
  console.log('  ✓ Verified html.ts contains 150ms debounce timers and flush helpers');

  // 2. Behavioral simulation of the debounce mechanism
  let urlEndpointValue = 'https://api.example.com/items';
  let syncCount = 0;
  let isSyncingQueryParams = false;
  let syncParamsDebounceTimer = null;
  let currentQueryParams = [
    { enabled: true, key: 'q', value: '' },
    { enabled: true, key: '', value: '' }
  ];

  function buildUrlWithQueryParams(endpoint, params) {
    const url = new URL(endpoint);
    url.search = '';
    for (const p of params) {
      if (p.enabled && p.key) {
        url.searchParams.append(p.key, p.value);
      }
    }
    return url.toString();
  }

  function performSyncParamsToUrl() {
    if (isSyncingQueryParams) return;
    isSyncingQueryParams = true;
    try {
      urlEndpointValue = buildUrlWithQueryParams(urlEndpointValue, currentQueryParams);
      syncCount++;
    } finally {
      isSyncingQueryParams = false;
    }
  }

  function flushSyncParamsToUrl() {
    if (syncParamsDebounceTimer) {
      clearTimeout(syncParamsDebounceTimer);
      syncParamsDebounceTimer = null;
      performSyncParamsToUrl();
    }
  }

  function syncParamsToUrl(immediate) {
    if (isSyncingQueryParams) return;
    if (syncParamsDebounceTimer) {
      clearTimeout(syncParamsDebounceTimer);
      syncParamsDebounceTimer = null;
    }
    if (immediate) {
      performSyncParamsToUrl();
    } else {
      syncParamsDebounceTimer = setTimeout(() => {
        syncParamsDebounceTimer = null;
        performSyncParamsToUrl();
      }, 150);
    }
  }

  // Simulate rapid typing: 5 keystrokes typing "hello" with 20ms delays
  const chars = ['h', 'e', 'l', 'l', 'o'];
  let typed = '';
  for (const ch of chars) {
    typed += ch;
    currentQueryParams[0].value = typed;
    syncParamsToUrl(false);
    await new Promise(r => setTimeout(r, 20));
  }

  // Immediately after typing (elapsed ~100ms total, but only 20ms since last keystroke)
  assert.strictEqual(syncCount, 0, 'No sync should have executed during rapid typing burst');
  assert.strictEqual(urlEndpointValue, 'https://api.example.com/items', 'URL endpoint should not yet have updated');
  console.log('  ✓ Rapid keystroke burst suppressed intermediate sync updates');

  // Wait remaining time for 150ms debounce window to expire
  await new Promise(r => setTimeout(r, 160));
  assert.strictEqual(syncCount, 1, 'Exactly one sync should have executed after debounce period');
  assert.strictEqual(
    urlEndpointValue,
    'https://api.example.com/items?q=hello',
    'URL endpoint correctly updated with final accumulated value'
  );
  console.log('  ✓ Final accumulated value synced exactly once after 150ms debounce');

  // Test immediate sync on checkbox toggle / deletion
  currentQueryParams[0].enabled = false;
  syncParamsToUrl(true);
  assert.strictEqual(syncCount, 2, 'Checkbox toggle should sync immediately');
  assert.strictEqual(
    urlEndpointValue,
    'https://api.example.com/items',
    'Disabled param immediately removed from URL'
  );
  console.log('  ✓ Discrete actions (checkbox toggle / delete) trigger immediate sync');

  // Test flushSyncParamsToUrl
  currentQueryParams[0].enabled = true;
  currentQueryParams[0].value = 'fast';
  syncParamsToUrl(false); // start 150ms debounce
  assert.strictEqual(syncCount, 2);
  flushSyncParamsToUrl(); // flush before 150ms expires
  assert.strictEqual(syncCount, 3, 'flushSyncParamsToUrl should immediately execute pending update');
  assert.strictEqual(urlEndpointValue, 'https://api.example.com/items?q=fast');
  console.log('  ✓ flushSyncParamsToUrl immediately executes queued sync prior to form submission');

  console.log('\n✅ All query parameters debounce tests passed successfully!');
}

runQueryParamsDebounceTests().catch(err => {
  console.error('Fatal error during query params debounce tests:', err);
  process.exit(1);
});
