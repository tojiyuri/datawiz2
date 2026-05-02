/**
 * Multi-tenancy tests.
 *
 * Verifies that ownership is correctly enforced — users can only see/modify
 * their own sheets and dashboards. This is the core promise of the auth system.
 */

const { describe, it, expect, beforeAll, beforeEach } = require('vitest');
const { getDb } = require('../db');
const sheetStore = require('../utils/sheetStore');
const auth = require('../utils/authStore');

let alice, bob;

beforeAll(async () => {
  getDb();
});

beforeEach(async () => {
  const db = getDb();
  db.prepare('DELETE FROM sheets').run();
  db.prepare('DELETE FROM dashboards').run();
  db.prepare('DELETE FROM users').run();

  alice = await auth.createUser({ email: 'alice@test.com', password: 'password123' });
  bob = await auth.createUser({ email: 'bob@test.com', password: 'password123' });
});

describe('multi-tenancy: sheets', () => {
  it('Alice can list her own sheet', () => {
    const s = sheetStore.createSheet({
      name: 'Alice Sheet', datasetId: 'ds_a', spec: { chartType: 'bar' }, ownerId: alice.id,
    });
    const list = sheetStore.listSheets('ds_a', alice.id);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(s.id);
  });

  it("Bob does NOT see Alice's sheet", () => {
    sheetStore.createSheet({
      name: 'Alice Sheet', datasetId: 'ds_a', spec: {}, ownerId: alice.id,
    });
    const list = sheetStore.listSheets('ds_a', bob.id);
    expect(list.length).toBe(0);
  });

  it('Bob cannot get Alice\'s sheet by ID', () => {
    const s = sheetStore.createSheet({
      name: 'Alice Sheet', datasetId: 'ds_a', spec: {}, ownerId: alice.id,
    });
    expect(sheetStore.getSheet(s.id, bob.id)).toBeNull();
    // Alice still can
    expect(sheetStore.getSheet(s.id, alice.id)).not.toBeNull();
  });

  it('Bob cannot update Alice\'s sheet', () => {
    const s = sheetStore.createSheet({
      name: 'Alice Sheet', datasetId: 'ds_a', spec: {}, ownerId: alice.id,
    });
    const result = sheetStore.updateSheet(s.id, { name: 'HACKED' }, bob.id);
    expect(result).toBeNull();

    // Verify the sheet still has the original name
    const fresh = sheetStore.getSheet(s.id, alice.id);
    expect(fresh.name).toBe('Alice Sheet');
  });

  it('Bob cannot delete Alice\'s sheet', () => {
    const s = sheetStore.createSheet({
      name: 'Alice Sheet', datasetId: 'ds_a', spec: {}, ownerId: alice.id,
    });
    expect(sheetStore.deleteSheet(s.id, bob.id)).toBe(false);
    // Sheet still exists
    expect(sheetStore.getSheet(s.id, alice.id)).not.toBeNull();
  });

  it('legacy sheets (NULL owner_id) are visible to any user', () => {
    // Simulate a sheet from before auth was wired
    const db = getDb();
    db.prepare(`
      INSERT INTO sheets (id, dataset_id, name, spec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('sh_legacy', 'ds_legacy', 'Legacy Sheet', '{}', new Date().toISOString(), new Date().toISOString());

    expect(sheetStore.getSheet('sh_legacy', alice.id)).not.toBeNull();
    expect(sheetStore.getSheet('sh_legacy', bob.id)).not.toBeNull();
  });

  it('list with no ownerId filter returns everything (admin/test use)', () => {
    sheetStore.createSheet({ name: 'A', datasetId: 'ds_a', spec: {}, ownerId: alice.id });
    sheetStore.createSheet({ name: 'B', datasetId: 'ds_a', spec: {}, ownerId: bob.id });
    expect(sheetStore.listSheets('ds_a').length).toBe(2);
  });
});

describe('multi-tenancy: dashboards', () => {
  it('Alice creates and lists; Bob does not see', () => {
    sheetStore.createDashboard({
      name: 'Alice Dash', datasetId: 'ds_a', tiles: [], ownerId: alice.id,
    });
    expect(sheetStore.listDashboards('ds_a', alice.id).length).toBe(1);
    expect(sheetStore.listDashboards('ds_a', bob.id).length).toBe(0);
  });

  it('Bob cannot delete Alice\'s dashboard', () => {
    const d = sheetStore.createDashboard({
      name: 'Alice Dash', datasetId: 'ds_a', tiles: [], ownerId: alice.id,
    });
    expect(sheetStore.deleteDashboard(d.id, bob.id)).toBe(false);
    expect(sheetStore.getDashboard(d.id, alice.id)).not.toBeNull();
  });
});

describe('cascade behavior', () => {
  it('deleting a sheet removes it from all dashboards', () => {
    const s = sheetStore.createSheet({
      name: 'S', datasetId: 'ds_a', spec: {}, ownerId: alice.id,
    });
    const d = sheetStore.createDashboard({
      name: 'D', datasetId: 'ds_a',
      tiles: [{ sheetId: s.id, x: 0, y: 0 }, { sheetId: 'other', x: 1, y: 0 }],
      ownerId: alice.id,
    });

    sheetStore.deleteSheet(s.id, alice.id);

    const fresh = sheetStore.getDashboard(d.id, alice.id);
    expect(fresh.tiles.length).toBe(1);
    expect(fresh.tiles[0].sheetId).toBe('other');
  });
});
