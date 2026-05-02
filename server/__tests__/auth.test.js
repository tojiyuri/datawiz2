/**
 * Auth tests.
 *
 * Covers:
 *   - Signup creates a user
 *   - First user becomes admin
 *   - Email is normalized (lowercase)
 *   - Duplicate signup rejected
 *   - Password hashing works (verify + reject)
 *   - Brute-force lockout after 5 failed attempts
 *   - Profile update
 *   - Password change requires correct current password
 */

const { describe, it, expect, beforeAll, beforeEach } = require('vitest');
const { getDb, close } = require('../db');
const auth = require('../utils/authStore');

beforeAll(() => {
  // Force DB initialization
  getDb();
});

beforeEach(() => {
  // Clear users + login_attempts between tests for isolation
  const db = getDb();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM login_attempts').run();
});

describe('authStore.createUser', () => {
  it('creates a user with bcrypt-hashed password', async () => {
    const u = await auth.createUser({ email: 'alice@test.com', password: 'password123', name: 'Alice' });
    expect(u.id).toMatch(/^usr_/);
    expect(u.email).toBe('alice@test.com');
    expect(u.name).toBe('Alice');
    // password_hash should NEVER be returned
    expect(u.password_hash).toBeUndefined();
    expect(u.passwordHash).toBeUndefined();
  });

  it('makes the first user an admin', async () => {
    const u1 = await auth.createUser({ email: 'first@test.com', password: 'password123' });
    expect(u1.role).toBe('admin');

    const u2 = await auth.createUser({ email: 'second@test.com', password: 'password123' });
    expect(u2.role).toBe('user');
  });

  it('normalizes email to lowercase', async () => {
    const u = await auth.createUser({ email: 'ALICE@Test.COM', password: 'password123' });
    expect(u.email).toBe('alice@test.com');
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    await auth.createUser({ email: 'dup@test.com', password: 'password123' });
    await expect(
      auth.createUser({ email: 'DUP@TEST.COM', password: 'otherpassword' })
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects passwords shorter than 8 chars', async () => {
    await expect(
      auth.createUser({ email: 'shortpass@test.com', password: 'abc' })
    ).rejects.toThrow(/at least 8/);
  });

  it('rejects malformed emails', async () => {
    await expect(
      auth.createUser({ email: 'not-an-email', password: 'password123' })
    ).rejects.toThrow(/invalid email/i);
  });
});

describe('authStore.verifyCredentials', () => {
  beforeEach(async () => {
    await auth.createUser({ email: 'verify@test.com', password: 'correct-password' });
  });

  it('returns user on correct password', async () => {
    const u = await auth.verifyCredentials('verify@test.com', 'correct-password');
    expect(u.email).toBe('verify@test.com');
  });

  it('rejects wrong password', async () => {
    await expect(
      auth.verifyCredentials('verify@test.com', 'wrong-password')
    ).rejects.toThrow(/invalid email or password/i);
  });

  it('rejects unknown email with same error (no enumeration)', async () => {
    await expect(
      auth.verifyCredentials('nobody@test.com', 'whatever')
    ).rejects.toThrow(/invalid email or password/i);
  });

  it('locks out after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        auth.verifyCredentials('verify@test.com', 'wrong-password')
      ).rejects.toThrow();
    }
    // 6th attempt should be locked out — even with the CORRECT password
    await expect(
      auth.verifyCredentials('verify@test.com', 'correct-password')
    ).rejects.toThrow(/too many failed/i);
  });

  it('updates last_login_at on success', async () => {
    const before = new Date().toISOString();
    const u = await auth.verifyCredentials('verify@test.com', 'correct-password');
    expect(u.lastLoginAt).toBeDefined();
    expect(u.lastLoginAt >= before).toBe(true);
  });
});

describe('authStore.changePassword', () => {
  let userId;
  beforeEach(async () => {
    const u = await auth.createUser({ email: 'cp@test.com', password: 'old-password' });
    userId = u.id;
  });

  it('changes password when current is correct', async () => {
    await auth.changePassword(userId, 'old-password', 'new-password');
    // Old fails
    await expect(
      auth.verifyCredentials('cp@test.com', 'old-password')
    ).rejects.toThrow();
    // New works
    const u = await auth.verifyCredentials('cp@test.com', 'new-password');
    expect(u.email).toBe('cp@test.com');
  });

  it('rejects when current password is wrong', async () => {
    await expect(
      auth.changePassword(userId, 'wrong-current', 'new-password')
    ).rejects.toThrow(/current password is incorrect/i);
  });

  it('rejects new password shorter than 8 chars', async () => {
    await expect(
      auth.changePassword(userId, 'old-password', 'abc')
    ).rejects.toThrow(/at least 8/);
  });
});

describe('authStore.updateProfile', () => {
  it('updates the name', async () => {
    const u = await auth.createUser({ email: 'p@test.com', password: 'password123' });
    const updated = auth.updateProfile(u.id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(updated.email).toBe('p@test.com');
  });
});
