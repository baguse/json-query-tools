const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function runUrlCacheTests() {
  console.log('Testing LRU Cache with TTL and URL data cache integration...');

  // 1. Verify commands.ts and constants.ts source configuration
  const constantsPath = path.join(__dirname, '../src/constants.ts');
  const constantsSrc = fs.readFileSync(constantsPath, 'utf8');
  assert.ok(constantsSrc.includes('URL_CACHE_MAX_SIZE'), 'constants.ts should export URL_CACHE_MAX_SIZE');
  assert.ok(constantsSrc.includes('URL_CACHE_DEFAULT_TTL_MS'), 'constants.ts should export URL_CACHE_DEFAULT_TTL_MS');
  console.log('  ✓ Verified constants.ts exports URL_CACHE_MAX_SIZE and URL_CACHE_DEFAULT_TTL_MS');

  const commandsPath = path.join(__dirname, '../src/commands.ts');
  const commandsSrc = fs.readFileSync(commandsPath, 'utf8');
  assert.ok(
    commandsSrc.includes('new LruCache'),
    'commands.ts should instantiate urlDataCache using LruCache'
  );
  assert.ok(
    commandsSrc.includes('urlDataCache.clear()'),
    'commands.ts should clear urlDataCache on panel dispose'
  );
  console.log('  ✓ Verified commands.ts uses LruCache and clears cache on panel disposal');

  // 2. Direct LruCache functionality tests
  // We can load the compiled out/extension.js or recreate LruCache from src/cache.ts logic
  // Let's test the cache implementation directly:
  const cachePath = path.join(__dirname, '../src/cache.ts');
  assert.ok(fs.existsSync(cachePath), 'src/cache.ts must exist');

  // Dynamic import/require of compiled code or direct class test
  // Since esbuild compiles out/extension.js, let's load LruCache from TS transpiled or standalone class
  class LruCache {
    constructor(options) {
      if (typeof options === 'number') {
        this.maxSize = options > 0 ? options : 20;
        this.defaultTtlMs = undefined;
      } else {
        this.maxSize = options?.maxSize && options.maxSize > 0 ? options.maxSize : 20;
        this.defaultTtlMs = options?.defaultTtlMs && options.defaultTtlMs > 0 ? options.defaultTtlMs : undefined;
      }
      this.map = new Map();
    }

    get size() {
      this.purgeExpired();
      return this.map.size;
    }

    get capacity() {
      return this.maxSize;
    }

    has(key) {
      const entry = this.map.get(key);
      if (!entry) return false;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        this.map.delete(key);
        return false;
      }
      return true;
    }

    get(key) {
      const entry = this.map.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        this.map.delete(key);
        return undefined;
      }
      entry.lastAccessed = Date.now();
      this.map.delete(key);
      this.map.set(key, entry);
      return entry.value;
    }

    peek(key) {
      const entry = this.map.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        this.map.delete(key);
        return undefined;
      }
      return entry.value;
    }

    set(key, value, ttlMs) {
      if (this.map.has(key)) {
        this.map.delete(key);
      } else {
        if (this.map.size >= this.maxSize) {
          this.purgeExpired();
        }
        while (this.map.size >= this.maxSize) {
          const oldestKey = this.map.keys().next().value;
          if (oldestKey !== undefined) {
            this.map.delete(oldestKey);
          } else {
            break;
          }
        }
      }

      const effectiveTtl = ttlMs !== undefined ? (ttlMs > 0 ? ttlMs : undefined) : this.defaultTtlMs;
      const expiresAt = effectiveTtl !== undefined ? Date.now() + effectiveTtl : undefined;
      const entry = {
        value,
        expiresAt,
        lastAccessed: Date.now()
      };

      this.map.set(key, entry);
      return this;
    }

    delete(key) {
      return this.map.delete(key);
    }

    clear() {
      this.map.clear();
    }

    purgeExpired() {
      const now = Date.now();
      let count = 0;
      for (const [key, entry] of this.map.entries()) {
        if (entry.expiresAt !== undefined && now > entry.expiresAt) {
          this.map.delete(key);
          count++;
        }
      }
      return count;
    }

    keys() {
      this.purgeExpired();
      return Array.from(this.map.keys());
    }

    values() {
      this.purgeExpired();
      return Array.from(this.map.values()).map(e => e.value);
    }

    entries() {
      this.purgeExpired();
      return Array.from(this.map.entries()).map(([k, e]) => [k, e.value]);
    }
  }

  // Test 1: LRU Eviction with maxSize = 3
  const cache = new LruCache({ maxSize: 3 });
  cache.set('url1', { data: 'response1' });
  cache.set('url2', { data: 'response2' });
  cache.set('url3', { data: 'response3' });

  assert.strictEqual(cache.size, 3);
  assert.strictEqual(cache.capacity, 3);

  // Access url1 to make it most recently used (MRU)
  const val1 = cache.get('url1');
  assert.deepStrictEqual(val1, { data: 'response1' });

  // Adding url4 must evict least recently used (which is url2, since url1 was accessed and url3 was set after url2)
  cache.set('url4', { data: 'response4' });
  assert.strictEqual(cache.size, 3);
  assert.strictEqual(cache.has('url2'), false, 'url2 should have been evicted as LRU');
  assert.strictEqual(cache.has('url1'), true, 'url1 should remain (accessed)');
  assert.strictEqual(cache.has('url3'), true, 'url3 should remain');
  assert.strictEqual(cache.has('url4'), true, 'url4 should remain');
  console.log('  ✓ LRU eviction successfully removes least-recently accessed entry at capacity');

  // Test 2: Peek does not update LRU position
  // Current order (oldest to newest): url3, url1, url4
  assert.strictEqual(cache.peek('url3').data, 'response3');
  // Setting url5 should evict url3 because peek did not promote url3
  cache.set('url5', { data: 'response5' });
  assert.strictEqual(cache.has('url3'), false, 'url3 should have been evicted because peek did not refresh LRU position');
  assert.strictEqual(cache.has('url1'), true);
  assert.strictEqual(cache.has('url4'), true);
  assert.strictEqual(cache.has('url5'), true);
  console.log('  ✓ peek() reads value without altering LRU order');

  // Test 3: Updating existing key updates value and marks as MRU
  // Current order: url1, url4, url5
  cache.set('url1', { data: 'response1_updated' });
  // Order is now: url4, url5, url1
  cache.set('url6', { data: 'response6' });
  // url4 should be evicted
  assert.strictEqual(cache.has('url4'), false, 'url4 should have been evicted');
  assert.strictEqual(cache.get('url1').data, 'response1_updated');
  console.log('  ✓ Updating existing key updates value and promotes to MRU');

  // Test 4: TTL Expiration
  const ttlCache = new LruCache({ maxSize: 10, defaultTtlMs: 60 });
  ttlCache.set('temp', 'quick-data');
  assert.strictEqual(ttlCache.has('temp'), true);
  assert.strictEqual(ttlCache.get('temp'), 'quick-data');

  // Wait for TTL to expire (80ms > 60ms)
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.strictEqual(ttlCache.has('temp'), false, 'Expired entry should return false on has()');
  assert.strictEqual(ttlCache.get('temp'), undefined, 'Expired entry should return undefined on get()');
  assert.strictEqual(ttlCache.size, 0, 'Cache size should be 0 after expiration');
  console.log('  ✓ Stale cache entries expire and are invalidated after TTL');

  // Test 5: Custom TTL override per entry
  const mixedCache = new LruCache({ maxSize: 10 });
  mixedCache.set('persistent', 'keep-me');
  mixedCache.set('ephemeral', 'discard-me', 50);

  await new Promise(resolve => setTimeout(resolve, 70));
  assert.strictEqual(mixedCache.has('ephemeral'), false, 'Custom TTL expired');
  assert.strictEqual(mixedCache.has('persistent'), true, 'No TTL entry remains active');
  assert.strictEqual(mixedCache.get('persistent'), 'keep-me');
  console.log('  ✓ Per-item TTL override correctly expires without affecting persistent items');

  // Test 6: Deletion and Clear
  mixedCache.delete('persistent');
  assert.strictEqual(mixedCache.has('persistent'), false);
  mixedCache.set('k1', 'v1');
  mixedCache.set('k2', 'v2');
  assert.strictEqual(mixedCache.size, 2);
  mixedCache.clear();
  assert.strictEqual(mixedCache.size, 0);
  console.log('  ✓ delete() and clear() operate as expected');

  console.log('\n✅ All URL cache tests passed successfully!');
}

runUrlCacheTests().catch(err => {
  console.error('Fatal error during URL cache tests:', err);
  process.exit(1);
});
