/**
 * Sharing tests.
 *
 * Confirms permission model: only owners can share/revoke; granted users
 * can access at the right role; share links resolve correctly.
 */

const { describe, it, expect, beforeAll, beforeEach } = require('vitest');
const { getDb } = require('../db');
const sharing = require('../utils/sharing');
const auth = require('../utils/authStore');
const sheetStore = require('../utils/sheetStore');

let alice, bob, carol, sheet;

beforeAll(() => { getDb(); });

beforeEach(async () => {
  const db = getDb();
  db.prepare('DELETE FROM share_links').run();
  db.prepare('DELETE FROM sheet_permissions').run();
  db.prepare('DELETE FROM dashboard_permissions').run();
  db.prepare('DELETE FROM sheets').run();
  db.prepare('DELETE FROM users').run();

  alice = await auth.createUser({ email: 'a@s.com', password: 'password123' });
  bob   = await auth.createUser({ email: 'b@s.com', password: 'password123' });
  carol = await auth.createUser({ email: 'c@s.com', password: 'password123' });

  sheet = sheetStore.createSheet({
    name: 'Alice Sheet', datasetId: 'ds_a', spec: {}, ownerId: alice.id,
  });
});

describe('grantPermission', () => {
  it('Alice can grant Bob view access to her sheet', () => {
    sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, role: 'view', grantedBy: alice.id,
    });
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: sheet.id, userId: bob.id })).toBe('view');
  });

  it('Bob cannot grant Carol access to a sheet he does not own', () => {
    expect(() => sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: carol.id, role: 'view', grantedBy: bob.id,
    })).toThrow(/only the owner/i);
  });

  it('upserts: granting twice updates the role', () => {
    sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, role: 'view', grantedBy: alice.id,
    });
    sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, role: 'edit', grantedBy: alice.id,
    });
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: sheet.id, userId: bob.id })).toBe('edit');
  });

  it('rejects invalid roles', () => {
    expect(() => sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, role: 'admin', grantedBy: alice.id,
    })).toThrow();
  });
});

describe('canAccess', () => {
  it('owner returns "owner"', () => {
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: sheet.id, userId: alice.id })).toBe('owner');
  });
  it('non-shared user returns null', () => {
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: sheet.id, userId: bob.id })).toBeNull();
  });
  it('non-existent resource returns null', () => {
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: 'fake', userId: alice.id })).toBeNull();
  });
});

describe('revokePermission', () => {
  beforeEach(() => {
    sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, role: 'view', grantedBy: alice.id,
    });
  });

  it('owner can revoke', () => {
    sharing.revokePermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, revokedBy: alice.id,
    });
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: sheet.id, userId: bob.id })).toBeNull();
  });

  it('user can self-revoke their own access', () => {
    sharing.revokePermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, revokedBy: bob.id,
    });
    expect(sharing.canAccess({ resourceType: 'sheet', resourceId: sheet.id, userId: bob.id })).toBeNull();
  });

  it('third party cannot revoke another user\'s access', () => {
    expect(() => sharing.revokePermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, revokedBy: carol.id,
    })).toThrow();
  });
});

describe('listSharedWithMe', () => {
  it('returns sheets shared with Bob (not own sheets)', () => {
    sharing.grantPermission({
      resourceType: 'sheet', resourceId: sheet.id,
      userId: bob.id, role: 'view', grantedBy: alice.id,
    });
    const r = sharing.listSharedWithMe(bob.id);
    expect(r.sheets.length).toBe(1);
    expect(r.sheets[0].id).toBe(sheet.id);
    expect(r.sheets[0].role).toBe('view');
    expect(r.sheets[0].ownerEmail).toBe('a@s.com');
  });
});

describe('public share links', () => {
  it('owner creates a link, anyone can resolve token', () => {
    const r = sharing.createShareLink({
      resourceType: 'sheet', resourceId: sheet.id, createdBy: alice.id,
    });
    expect(r.token).toBeTruthy();
    const found = sharing.findShareLink(r.token);
    expect(found.resource_id).toBe(sheet.id);
  });

  it('non-owner cannot create link', () => {
    expect(() => sharing.createShareLink({
      resourceType: 'sheet', resourceId: sheet.id, createdBy: bob.id,
    })).toThrow(/only the owner/i);
  });

  it('revoked link no longer resolves', () => {
    const r = sharing.createShareLink({
      resourceType: 'sheet', resourceId: sheet.id, createdBy: alice.id,
    });
    sharing.revokeShareLink(r.id, alice.id);
    expect(sharing.findShareLink(r.token)).toBeNull();
  });

  it('expired link no longer resolves', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const r = sharing.createShareLink({
      resourceType: 'sheet', resourceId: sheet.id, createdBy: alice.id,
      expiresAt: past,
    });
    expect(sharing.findShareLink(r.token)).toBeNull();
  });

  it('different tokens are independent', () => {
    const a = sharing.createShareLink({
      resourceType: 'sheet', resourceId: sheet.id, createdBy: alice.id,
    });
    const b = sharing.createShareLink({
      resourceType: 'sheet', resourceId: sheet.id, createdBy: alice.id,
    });
    sharing.revokeShareLink(a.id, alice.id);
    expect(sharing.findShareLink(a.token)).toBeNull();
    expect(sharing.findShareLink(b.token)).not.toBeNull();
  });
});
