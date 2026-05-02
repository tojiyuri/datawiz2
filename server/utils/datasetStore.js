/**
 * DatasetStore (v6.5 — SQLite-backed metadata + on-disk row data)
 *
 * Design:
 *   - Metadata (id, fileName, analysis, owner_id, source) → SQLite `datasets` table
 *   - Row data → data/datasets/{id}.json on disk
 *   - In-memory LRU cache holds the row data of recently-accessed datasets
 *
 * Why this split:
 *   - Datasets can be 200K rows. Storing rows in SQLite as a BLOB or JSON
 *     column hurts query speed for everything else. Files on disk are simpler.
 *   - We get the win: dataset metadata persists across restarts. The user's
 *     uploaded data is no longer evaporated by a deploy or `nodemon` reload.
 *   - The cache makes hot datasets fast (no JSON parse on every request).
 *
 * Public API is identical to the old in-memory version, so routes don't change.
 */

const fs = require('fs');
const path = require('path');
const { getDb, tx } = require('../db');

const STORE_DIR = process.env.DATAWIZ_TEST_DIR
  ? path.join(process.env.DATAWIZ_TEST_DIR, 'datasets')
  : process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'datasets')
  : path.join(__dirname, '../data/datasets');

// Cache is bounded by BOTH entry count and total bytes. Whichever bound
// hits first triggers eviction. The byte bound is what prevents an OOM
// when a few large datasets get cached.
const MAX_CACHE_ENTRIES = parseInt(process.env.MAX_CACHE_ENTRIES || '30');
const MAX_CACHE_BYTES = parseInt(process.env.MAX_CACHE_BYTES || String(256 * 1024 * 1024));   // 256MB default
const MAX_AGE_HOURS = 24 * 30; // 30 days — purge old datasets at startup

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function dataFilePath(id) {
  return path.join(STORE_DIR, `${id}.json`);
}

// Quick byte estimator for an array of row objects. Real serialization would
// be exact but expensive — this approximation catches the order-of-magnitude
// case (10MB vs 200MB) which is what matters for cache decisions.
function estimateBytes(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const sample = JSON.stringify(rows[0] || {});
  return sample.length * rows.length;
}

class DatasetStore {
  constructor() {
    this.cache = new Map();      // id -> { rows, cachedAt, bytes }
    this.accessLog = new Map();  // id -> last access ms
    this.cacheBytes = 0;
    ensureDir();
  }

  // ─── persistence helpers ───────────────────────────────────────────────────

  _writeRowsToDisk(id, rows) {
    try {
      fs.writeFileSync(dataFilePath(id), JSON.stringify(rows));
    } catch (err) {
      console.error(`[DatasetStore] persist rows failed for ${id}:`, err.message);
    }
  }

  _readRowsFromDisk(id) {
    try {
      const fp = dataFilePath(id);
      if (!fs.existsSync(fp)) return null;
      const t0 = Date.now();
      const rows = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const elapsed = Date.now() - t0;
      // Warn when a sync disk read blocks the event loop for too long.
      // 100ms is the threshold above which other users start noticing latency.
      if (elapsed > 100) {
        console.warn(`[DatasetStore] SLOW SYNC READ: ${id} took ${elapsed}ms (${rows.length} rows). Cache miss is blocking the event loop.`);
      }
      return rows;
    } catch (err) {
      console.error(`[DatasetStore] read rows failed for ${id}:`, err.message);
      return null;
    }
  }

  _addToCache(id, rows) {
    const bytes = estimateBytes(rows);
    // If a single dataset is bigger than the whole cache budget, don't
    // cache it at all — better to re-read from disk than evict everything
    // else for one giant entry.
    if (bytes > MAX_CACHE_BYTES) return;
    // Remove old entry's byte count if present
    const old = this.cache.get(id);
    if (old) this.cacheBytes -= old.bytes;
    this.cache.set(id, { rows, cachedAt: Date.now(), bytes });
    this.cacheBytes += bytes;
    this.accessLog.set(id, Date.now());
    this._evict();
  }

  _evict() {
    // Evict by LRU until we're under both bounds
    if (this.cache.size <= MAX_CACHE_ENTRIES && this.cacheBytes <= MAX_CACHE_BYTES) return;
    const sorted = [...this.accessLog.entries()]
      .filter(([id]) => this.cache.has(id))
      .sort((a, b) => a[1] - b[1]);
    while ((this.cache.size > MAX_CACHE_ENTRIES || this.cacheBytes > MAX_CACHE_BYTES) && sorted.length) {
      const [id] = sorted.shift();
      const entry = this.cache.get(id);
      if (entry) this.cacheBytes -= entry.bytes;
      this.cache.delete(id);
    }
  }

  // ─── public API ────────────────────────────────────────────────────────────

  /**
   * Save a dataset. Metadata → SQLite, rows → disk file.
   * `dataset` shape: { id, fileName, fileSize, data, analysis, source?, ownerId? }
   */
  set(id, dataset) {
    if (!id || !dataset) throw new Error('id and dataset are required');

    const now = new Date().toISOString();
    const uploadedAt = dataset.uploadedAt || now;
    const filePath = dataFilePath(id);
    const data = dataset.data || [];

    // 1. Write rows to disk
    this._writeRowsToDisk(id, data);

    // 2. Upsert metadata in SQLite
    const db = getDb();
    db.prepare(`
      INSERT INTO datasets (id, owner_id, file_name, file_size, row_count, column_count,
                            source_type, source_metadata, analysis, data_path,
                            uploaded_at, updated_at)
      VALUES (@id, @ownerId, @fileName, @fileSize, @rowCount, @columnCount,
              @sourceType, @sourceMetadata, @analysis, @dataPath,
              @uploadedAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        file_name       = excluded.file_name,
        file_size       = excluded.file_size,
        row_count       = excluded.row_count,
        column_count    = excluded.column_count,
        source_type     = excluded.source_type,
        source_metadata = excluded.source_metadata,
        analysis        = excluded.analysis,
        data_path       = excluded.data_path,
        updated_at      = excluded.updated_at
    `).run({
      id,
      ownerId: dataset.ownerId || null,
      fileName: dataset.fileName || 'unknown',
      fileSize: dataset.fileSize || 0,
      rowCount: data.length,
      columnCount: dataset.analysis?.columns?.length || 0,
      sourceType: dataset.source?.type || 'upload',
      sourceMetadata: dataset.source ? JSON.stringify(dataset.source) : null,
      analysis: JSON.stringify(dataset.analysis || {}),
      dataPath: filePath,
      uploadedAt,
      updatedAt: now,
    });

    // 3. Update memory cache
    this._addToCache(id, data);
  }

  /**
   * Get a dataset by id. Returns the same shape callers used to get from the
   * in-memory store: { id, fileName, data, analysis, ... }.
   * Returns undefined if not found OR not owned by the requesting user.
   *
   * SECURITY: Strict tenant isolation. A null-owner dataset is treated as
   * private (not legacy-shared). The only way to access it is to pass
   * ownerId=undefined, which only the special "no auth" test path does.
   * Calling code in the routes always passes req.user.id.
   */
  get(id, ownerId) {
    if (!id) return undefined;

    const db = getDb();
    const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    if (!row) return undefined;

    // Strict ownership: when ownerId is provided, it must match exactly.
    // null-owner rows are NOT visible to authenticated users (was a leak).
    if (ownerId !== undefined) {
      if (row.owner_id !== ownerId) return undefined;
    }

    // Get rows: from cache if hot, else load from disk
    let rows;
    const cached = this.cache.get(id);
    if (cached) {
      rows = cached.rows;
      this.accessLog.set(id, Date.now());      // refresh LRU on hit
    } else {
      rows = this._readRowsFromDisk(id);
      if (rows) {
        this._addToCache(id, rows);
      } else {
        // Metadata in SQLite but rows file missing — orphan. Clean up.
        console.warn(`[DatasetStore] orphan: ${id} has metadata but no rows file. Deleting.`);
        this.delete(id);
        return undefined;
      }
    }

    this.accessLog.set(id, Date.now());

    return {
      id: row.id,
      fileName: row.file_name,
      fileSize: row.file_size,
      ownerId: row.owner_id,
      data: rows,
      analysis: row.analysis ? JSON.parse(row.analysis) : null,
      source: row.source_metadata ? JSON.parse(row.source_metadata) : null,
      uploadedAt: row.uploaded_at,
      updatedAt: row.updated_at,
    };
  }

  /** Delete dataset metadata + rows file + cache entry. Returns true if existed. */
  delete(id, ownerId) {
    const db = getDb();
    return tx(() => {
      // Strict ownership check before delete
      if (ownerId !== undefined) {
        const existing = db.prepare('SELECT owner_id FROM datasets WHERE id = ?').get(id);
        if (!existing) return false;
        if (existing.owner_id !== ownerId) return false;
      }
      const result = db.prepare('DELETE FROM datasets WHERE id = ?').run(id);
      const cached = this.cache.get(id);
      if (cached) this.cacheBytes -= cached.bytes;
      this.cache.delete(id);
      this.accessLog.delete(id);
      try {
        const fp = dataFilePath(id);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (_) { /* ignore */ }
      return result.changes > 0;
    });
  }

  has(id, ownerId) {
    if (!id) return false;
    const db = getDb();
    if (ownerId !== undefined) {
      const row = db.prepare(
        'SELECT 1 FROM datasets WHERE id = ? AND owner_id = ?'
      ).get(id, ownerId);
      return !!row;
    }
    const row = db.prepare('SELECT 1 FROM datasets WHERE id = ?').get(id);
    return !!row;
  }

  size(ownerId) {
    const db = getDb();
    if (ownerId !== undefined) {
      return db.prepare(
        'SELECT COUNT(*) as n FROM datasets WHERE owner_id = ?'
      ).get(ownerId).n;
    }
    return db.prepare('SELECT COUNT(*) as n FROM datasets').get().n;
  }

  /** List all datasets with metadata (no row data — that would be expensive). */
  list(ownerId) {
    const db = getDb();
    // Strict ownership: no null-owner-leaks-to-everyone behavior.
    const rows = ownerId !== undefined
      ? db.prepare('SELECT * FROM datasets WHERE owner_id = ? ORDER BY uploaded_at DESC').all(ownerId)
      : db.prepare('SELECT * FROM datasets ORDER BY uploaded_at DESC').all();
    return rows.map(r => ({
      id: r.id,
      fileName: r.file_name,
      fileSize: r.file_size,
      rowCount: r.row_count,
      columnCount: r.column_count,
      uploadedAt: r.uploaded_at,
      ownerId: r.owner_id,
      sourceType: r.source_type,
      analysis: r.analysis ? { columns: JSON.parse(r.analysis).columns } : null,
    }));
  }

  /** One-time cleanup: remove datasets older than MAX_AGE_HOURS. Called at startup. */
  pruneStale() {
    const db = getDb();
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
    const stale = db.prepare('SELECT id FROM datasets WHERE uploaded_at < ?').all(cutoff);
    for (const r of stale) this.delete(r.id);
    if (stale.length) console.log(`[DatasetStore] Pruned ${stale.length} stale datasets.`);
    return stale.length;
  }
}

module.exports = new DatasetStore();
