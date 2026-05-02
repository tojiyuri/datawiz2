/**
 * Tests for the v6.16 load-test fixes:
 *   - Per-user token bucket rate limiter
 *   - Byte-bounded LRU cache in datasetStore
 *
 * The discipline: each fix gets a test that would have failed before the fix.
 */

const { describe, it, expect, beforeEach } = require('vitest');
const { TokenBucket } = require('../middleware/perUserRateLimit');

describe('TokenBucket', () => {
  it('starts full and lets capacity-many requests through', () => {
    const b = new TokenBucket(5, 1);
    for (let i = 0; i < 5; i++) {
      expect(b.tryConsume()).toBe(true);
    }
    expect(b.tryConsume()).toBe(false);
  });

  it('reports retry-after time when empty', () => {
    const b = new TokenBucket(1, 0.5);  // 0.5/sec refill = 2s per token
    b.tryConsume();
    expect(b.tryConsume()).toBe(false);
    const retry = b.retryAfter();
    expect(retry).toBeGreaterThan(1.5);
    expect(retry).toBeLessThanOrEqual(2.0);
  });

  it('refills tokens over time', async () => {
    const b = new TokenBucket(2, 100);  // 100/sec refill — instant
    b.tryConsume();
    b.tryConsume();
    expect(b.tryConsume()).toBe(false);
    // Wait 50ms — should refill ~5 tokens worth, plenty
    await new Promise(r => setTimeout(r, 50));
    expect(b.tryConsume()).toBe(true);
  });

  it('does not exceed capacity even after long idle', async () => {
    const b = new TokenBucket(3, 10);
    await new Promise(r => setTimeout(r, 100));
    // Don't refill until we call refill or tryConsume — but when we do,
    // it should cap at capacity, not fill to 1+ second worth
    b.refill();
    expect(b.tokens).toBe(3);     // not 13
  });
});

describe('datasetStore byte-bounded cache', () => {
  // The cache should evict by bytes, not just by count. A 30-entry cache
  // with no byte cap is the most likely OOM cause under load.

  beforeEach(() => {
    // Force fresh module load with low byte limit for testing
    process.env.MAX_CACHE_BYTES = '500';
    process.env.MAX_CACHE_ENTRIES = '10';
    process.env.DATAWIZ_TEST_DIR = '/tmp/dwtest-' + Date.now() + '-' + Math.random();
    delete require.cache[require.resolve('../utils/datasetStore')];
    delete require.cache[require.resolve('../db')];
    require('fs').mkdirSync(process.env.DATAWIZ_TEST_DIR + '/datasets', { recursive: true });
  });

  it('evicts when total cached bytes would exceed budget', () => {
    // Mock the DB minimally — we only care about the cache here
    require.cache[require.resolve('../db')] = {
      exports: {
        getDb: () => ({
          prepare: () => ({ run: () => ({ changes: 1 }), get: () => null, all: () => [] }),
        }),
        tx: (fn) => fn(),
      },
    };
    const ds = require('../utils/datasetStore');

    // Each row is ~50 bytes when stringified. 10 rows ≈ 500 bytes.
    // Budget is 500 bytes — only one dataset should fit.
    for (let i = 0; i < 5; i++) {
      const rows = Array.from({ length: 10 }, (_, j) => ({
        a: i * 10 + j,
        b: 'xxxxxxxxxxxxxxxxxxx',
      }));
      ds.set(`id${i}`, {
        id: `id${i}`,
        fileName: 'f.csv',
        data: rows,
        analysis: { columns: [] },
      });
    }

    expect(ds.cacheBytes).toBeLessThanOrEqual(500);
    expect(ds.cache.size).toBeLessThanOrEqual(10);
  });

  it('does NOT cache datasets larger than the entire budget', () => {
    require.cache[require.resolve('../db')] = {
      exports: {
        getDb: () => ({
          prepare: () => ({ run: () => ({ changes: 1 }), get: () => null, all: () => [] }),
        }),
        tx: (fn) => fn(),
      },
    };
    const ds = require('../utils/datasetStore');

    // 100 rows each ~50 bytes = 5000 bytes, way over 500-byte budget
    const hugeRows = Array.from({ length: 100 }, (_, j) => ({
      a: j,
      b: 'yyyyyyyyyyyyyyyyyyyy',
    }));
    ds.set('huge', {
      id: 'huge',
      fileName: 'huge.csv',
      data: hugeRows,
      analysis: { columns: [] },
    });

    // Should not be cached (too big), but the metadata should still exist.
    // Cache should have skipped it entirely.
    expect(ds.cache.has('huge')).toBe(false);
    expect(ds.cacheBytes).toBe(0);
  });
});
