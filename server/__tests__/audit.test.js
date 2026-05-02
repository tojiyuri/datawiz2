/**
 * Audit log tests.
 */

const { describe, it, expect, beforeAll, beforeEach } = require('vitest');
const { getDb } = require('../db');
const audit = require('../utils/audit');

beforeAll(() => { getDb(); });

beforeEach(() => {
  getDb().prepare('DELETE FROM audit_log').run();
});

describe('audit.log', () => {
  it('records an event with all fields', () => {
    audit.log({
      userId: 'u1', userEmail: 'a@b.com',
      action: 'sheet.create', resourceId: 's1', resourceType: 'sheet',
      ip: '1.2.3.4', userAgent: 'test', metadata: { name: 'foo' },
    });
    const events = audit.query();
    expect(events.length).toBe(1);
    expect(events[0].action).toBe('sheet.create');
    expect(events[0].userEmail).toBe('a@b.com');
    expect(events[0].metadata).toEqual({ name: 'foo' });
  });

  it('does not throw when called without action (silently no-ops)', () => {
    expect(() => audit.log({ userId: 'u1' })).not.toThrow();
    expect(audit.query().length).toBe(0);
  });

  it('survives bad metadata gracefully', () => {
    // Circular reference would crash JSON.stringify
    const obj = {};
    obj.self = obj;
    // The audit log catches errors internally — should not throw to caller
    expect(() => audit.log({ action: 'test', metadata: obj })).not.toThrow();
  });
});

describe('audit.query', () => {
  beforeEach(() => {
    audit.log({ userId: 'u1', action: 'auth.login' });
    audit.log({ userId: 'u1', action: 'sheet.create', resourceId: 's1' });
    audit.log({ userId: 'u2', action: 'auth.login' });
  });

  it('filters by userId', () => {
    expect(audit.query({ userId: 'u1' }).length).toBe(2);
    expect(audit.query({ userId: 'u2' }).length).toBe(1);
  });

  it('filters by action prefix', () => {
    expect(audit.query({ action: 'auth' }).length).toBe(2);
    expect(audit.query({ action: 'sheet' }).length).toBe(1);
  });

  it('respects limit', () => {
    expect(audit.query({ limit: 1 }).length).toBe(1);
  });

  it('orders newest first', () => {
    const events = audit.query();
    expect(events[0].ts >= events[events.length - 1].ts).toBe(true);
  });
});
