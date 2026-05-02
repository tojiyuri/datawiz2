/**
 * Hardening tests — verify each security fix actually does what it claims.
 *
 * The discipline here is "tests for the bugs we fixed, not just for the
 * features we added." Every fix in this pass needs a test that would have
 * failed before the fix.
 */

const { describe, it, expect } = require('vitest');
const ssrfGuard = require('../utils/ssrfGuard');

// ─── SSRF GUARD ──────────────────────────────────────────────────────────────

describe('ssrfGuard.assertPublicHost', () => {
  it('blocks localhost', async () => {
    await expect(ssrfGuard.assertPublicHost('localhost')).rejects.toThrow(/SSRF/);
  });

  it('blocks 127.0.0.1', async () => {
    await expect(ssrfGuard.assertPublicHost('127.0.0.1')).rejects.toThrow(/SSRF/);
  });

  it('blocks 0.0.0.0', async () => {
    await expect(ssrfGuard.assertPublicHost('0.0.0.0')).rejects.toThrow(/SSRF/);
  });

  it('blocks private 10.x.x.x', async () => {
    await expect(ssrfGuard.assertPublicHost('10.0.0.5')).rejects.toThrow(/SSRF/);
  });

  it('blocks private 192.168.x.x', async () => {
    await expect(ssrfGuard.assertPublicHost('192.168.1.1')).rejects.toThrow(/SSRF/);
  });

  it('blocks private 172.16-31.x.x', async () => {
    await expect(ssrfGuard.assertPublicHost('172.16.0.1')).rejects.toThrow(/SSRF/);
    await expect(ssrfGuard.assertPublicHost('172.20.0.1')).rejects.toThrow(/SSRF/);
    await expect(ssrfGuard.assertPublicHost('172.31.255.1')).rejects.toThrow(/SSRF/);
  });

  it('does NOT block public 172.32.x.x (outside private range)', async () => {
    // Some implementations get the boundary wrong — verify we don't
    expect(ssrfGuard.isPrivateIPv4('172.32.0.1')).toBe(false);
    expect(ssrfGuard.isPrivateIPv4('172.15.0.1')).toBe(false);
  });

  it('blocks AWS metadata IP', async () => {
    await expect(ssrfGuard.assertPublicHost('169.254.169.254')).rejects.toThrow(/SSRF/);
  });

  it('blocks GCP metadata hostname', async () => {
    await expect(ssrfGuard.assertPublicHost('metadata.google.internal')).rejects.toThrow(/SSRF/);
  });

  it('blocks reserved suffixes', async () => {
    await expect(ssrfGuard.assertPublicHost('db.local')).rejects.toThrow(/SSRF/);
    await expect(ssrfGuard.assertPublicHost('thing.localhost')).rejects.toThrow(/SSRF/);
    await expect(ssrfGuard.assertPublicHost('vault.internal')).rejects.toThrow(/SSRF/);
  });

  it('blocks IPv6 loopback', async () => {
    await expect(ssrfGuard.assertPublicHost('::1')).rejects.toThrow(/SSRF/);
  });

  it('blocks IPv6 link-local', async () => {
    await expect(ssrfGuard.assertPublicHost('fe80::1')).rejects.toThrow(/SSRF/);
  });

  it('respects ALLOWED_PRIVATE_HOSTS allow-list', async () => {
    const original = process.env.ALLOWED_PRIVATE_HOSTS;
    process.env.ALLOWED_PRIVATE_HOSTS = '10.0.0.5,my-internal-db';
    try {
      // Allowed
      await expect(ssrfGuard.assertPublicHost('10.0.0.5')).resolves.toBeUndefined();
      await expect(ssrfGuard.assertPublicHost('my-internal-db')).resolves.toBeUndefined();
      // Still blocked even with allow-list — different host
      await expect(ssrfGuard.assertPublicHost('10.0.0.6')).rejects.toThrow(/SSRF/);
    } finally {
      if (original === undefined) delete process.env.ALLOWED_PRIVATE_HOSTS;
      else process.env.ALLOWED_PRIVATE_HOSTS = original;
    }
  });
});

// ─── SQL CONNECTOR HARDENING ────────────────────────────────────────────────

describe('sqlConnector.runQuery (hardening)', () => {
  // We can't actually connect to a DB in tests, but we CAN verify the
  // query validation logic runs before any connection attempt — by checking
  // that obviously bad queries throw the right validation error rather than
  // a connection error.
  const sqlConnector = require('../utils/sqlConnector');

  it('rejects DDL hidden behind a comment', async () => {
    await expect(
      sqlConnector.runQuery({ type: 'sqlite', file: 'irrelevant' }, '/* benign */ DROP TABLE users')
    ).rejects.toThrow(/SELECT queries/);
  });

  it('rejects DML hidden behind line comment', async () => {
    await expect(
      sqlConnector.runQuery({ type: 'sqlite', file: 'irrelevant' }, '-- comment\nDELETE FROM users')
    ).rejects.toThrow(/SELECT queries/);
  });

  it('rejects multi-statement queries', async () => {
    await expect(
      sqlConnector.runQuery(
        { type: 'sqlite', file: 'irrelevant' },
        'SELECT 1; DROP TABLE users'
      )
    ).rejects.toThrow(/Multi-statement/);
  });

  it('rejects EXEC, CALL, MERGE (additional DML)', async () => {
    for (const cmd of ['EXEC sp_who', 'CALL myproc()', 'MERGE INTO target USING source ON 1=1']) {
      await expect(
        sqlConnector.runQuery({ type: 'sqlite', file: 'irrelevant' }, cmd)
      ).rejects.toThrow(/SELECT queries/);
    }
  });

  it('rejects PRAGMA and ATTACH on sqlite', async () => {
    await expect(
      sqlConnector.runQuery({ type: 'sqlite', file: 'irrelevant' }, 'PRAGMA database_list')
    ).rejects.toThrow(/SELECT queries/);
    await expect(
      sqlConnector.runQuery({ type: 'sqlite', file: 'irrelevant' }, "ATTACH '/tmp/evil.db' AS evil")
    ).rejects.toThrow(/SELECT queries/);
  });
});

// ─── DATASET STORE TENANT ISOLATION ─────────────────────────────────────────

describe('datasetStore tenant isolation', () => {
  const datasetStore = require('../utils/datasetStore');

  // Create two datasets, one per tenant, and verify they cannot see each other.
  const a = 'tenant-a-' + Date.now();
  const b = 'tenant-b-' + Date.now();
  const dsA = 'ds-a-' + Date.now();
  const dsB = 'ds-b-' + Date.now();

  it('tenant A cannot see tenant B datasets', () => {
    datasetStore.set(dsA, {
      id: dsA, fileName: 'a.csv',
      data: [{ x: 1 }],
      analysis: { columns: [{ name: 'x', type: 'numeric' }] },
      ownerId: a,
    });
    datasetStore.set(dsB, {
      id: dsB, fileName: 'b.csv',
      data: [{ x: 2 }],
      analysis: { columns: [{ name: 'x', type: 'numeric' }] },
      ownerId: b,
    });

    // Each tenant sees only their own
    const aList = datasetStore.list(a);
    const bList = datasetStore.list(b);
    expect(aList.find(d => d.id === dsA)).toBeDefined();
    expect(aList.find(d => d.id === dsB)).toBeUndefined();
    expect(bList.find(d => d.id === dsB)).toBeDefined();
    expect(bList.find(d => d.id === dsA)).toBeUndefined();

    // Direct get with wrong owner returns undefined
    expect(datasetStore.get(dsA, b)).toBeUndefined();
    expect(datasetStore.get(dsB, a)).toBeUndefined();

    // Direct get with right owner works
    expect(datasetStore.get(dsA, a)).toBeDefined();
    expect(datasetStore.get(dsB, b)).toBeDefined();

    // Cleanup
    datasetStore.delete(dsA, a);
    datasetStore.delete(dsB, b);
  });

  it('null-owner datasets are NOT visible to authenticated users (was leak)', () => {
    const id = 'orphan-' + Date.now();
    datasetStore.set(id, {
      id, fileName: 'orphan.csv',
      data: [{ x: 1 }],
      analysis: { columns: [{ name: 'x', type: 'numeric' }] },
      ownerId: null,                          // explicitly null
    });

    // This used to leak — orphan dataset visible to any authenticated user
    const list = datasetStore.list('some-random-user');
    expect(list.find(d => d.id === id)).toBeUndefined();
    expect(datasetStore.get(id, 'some-random-user')).toBeUndefined();

    // But it's still gettable without an ownerId (unauth context)
    expect(datasetStore.get(id, undefined)).toBeDefined();

    datasetStore.delete(id, undefined);   // cleanup
  });
});
