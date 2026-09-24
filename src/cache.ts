export interface LruCacheOptions {
  /** Maximum number of entries the cache will store before evicting least-recently used items. Defaults to 20. */
  maxSize?: number;
  /** Default Time To Live in milliseconds. If undefined or <= 0, entries do not expire by default. */
  defaultTtlMs?: number;
}

export interface CacheEntry<V> {
  value: V;
  expiresAt?: number;
  lastAccessed: number;
}

/**
 * In-memory Least-Recently Used (LRU) Cache with Time-To-Live (TTL) support.
 *
 * Implements Map-compatible core methods (get, set, has, delete, clear, size)
 * while ensuring memory usage is bounded and stale entries are evicted.
 */
export class LruCache<K = string, V = unknown> {
  private readonly map: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly defaultTtlMs?: number;

  constructor(options?: LruCacheOptions | number) {
    if (typeof options === 'number') {
      this.maxSize = options > 0 ? options : 20;
      this.defaultTtlMs = undefined;
    } else {
      this.maxSize = options?.maxSize && options.maxSize > 0 ? options.maxSize : 20;
      this.defaultTtlMs = options?.defaultTtlMs && options.defaultTtlMs > 0 ? options.defaultTtlMs : undefined;
    }
    this.map = new Map<K, CacheEntry<V>>();
  }

  get size(): number {
    this.purgeExpired();
    return this.map.size;
  }

  get capacity(): number {
    return this.maxSize;
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh position to mark as most recently used (MRU)
    entry.lastAccessed = Date.now();
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): this {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else {
      // Evict expired first if we are at capacity
      if (this.map.size >= this.maxSize) {
        this.purgeExpired();
      }
      // If still at capacity, evict the least recently used item (the first item in insertion order)
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
    const entry: CacheEntry<V> = {
      value,
      expiresAt,
      lastAccessed: Date.now()
    };

    this.map.set(key, entry);
    return this;
  }

  peek(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  getEntry(key: K): CacheEntry<V> | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return { ...entry };
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  purgeExpired(): number {
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

  keys(): K[] {
    this.purgeExpired();
    return Array.from(this.map.keys());
  }

  values(): V[] {
    this.purgeExpired();
    return Array.from(this.map.values()).map(e => e.value);
  }

  entries(): [K, V][] {
    this.purgeExpired();
    return Array.from(this.map.entries()).map(([k, e]) => [k, e.value]);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries().values();
  }
}
