/**
 * Refresh token rotation + theft detection tests.
 */

const { describe, it, expect, beforeAll, beforeEach } = require('vitest');
const { getDb } = require('../db');
const refresh = require('../utils/refreshTokens');
const auth = require('../utils/authStore');

let alice;

beforeAll(() => { getDb(); });

beforeEach(async () => {
  const db = getDb();
  db.prepare('DELETE FROM refresh_tokens').run();
  db.prepare('DELETE FROM users').run();
  alice = await auth.createUser({ email: 'rt@test.com', password: 'password123' });
});

describe('refreshTokens.issue + verify', () => {
  it('issues a token that verify() accepts', () => {
    const { token } = refresh.issue(alice.id);
    expect(token).toBeTruthy();
    const row = refresh.verify(token);
    expect(row).not.toBeNull();
    expect(row.user_id).toBe(alice.id);
  });

  it('verify() returns null for unknown token', () => {
    expect(refresh.verify('not-a-real-token')).toBeNull();
  });

  it('verify() returns null for revoked token', () => {
    const { token } = refresh.issue(alice.id);
    refresh.revoke(token);
    expect(refresh.verify(token)).toBeNull();
  });
});

describe('refreshTokens.rotate', () => {
  it('rotates: revokes old, issues new', () => {
    const first = refresh.issue(alice.id);
    const second = refresh.rotate(first.token);
    expect(second.token).toBeTruthy();
    expect(second.token).not.toBe(first.token);
    // Old token no longer verifies
    expect(refresh.verify(first.token)).toBeNull();
    // New token does
    expect(refresh.verify(second.token)).not.toBeNull();
  });

  it('detects theft: reusing a revoked token revokes ALL user tokens', () => {
    const first = refresh.issue(alice.id);
    const second = refresh.issue(alice.id);
    refresh.rotate(first.token); // revokes first

    // Attacker tries to use first.token again — should trigger theft response
    const result = refresh.rotate(first.token);
    expect(result.stolen).toBe(true);

    // ALL tokens for this user should now be revoked
    expect(refresh.verify(second.token)).toBeNull();
  });
});

describe('refreshTokens.revokeAllForUser', () => {
  it('revokes all active tokens for a user', () => {
    const t1 = refresh.issue(alice.id);
    const t2 = refresh.issue(alice.id);
    const n = refresh.revokeAllForUser(alice.id);
    expect(n).toBe(2);
    expect(refresh.verify(t1.token)).toBeNull();
    expect(refresh.verify(t2.token)).toBeNull();
  });
});
