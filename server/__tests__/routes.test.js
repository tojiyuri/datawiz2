/**
 * Route integration tests via supertest.
 *
 * These hit the real Express app — middleware, auth, stores, all the way
 * down. This is where multi-tenancy bugs would actually surface, because
 * unit tests of the stores might pass while the routes silently leak data.
 */

const { describe, it, expect, beforeAll, beforeEach } = require('vitest');
const request = require('supertest');
const app = require('../index');
const { getDb } = require('../db');

beforeAll(() => {
  // Make sure DB exists
  getDb();
});

beforeEach(() => {
  // Wipe all user data between tests
  const db = getDb();
  db.prepare('DELETE FROM sheets').run();
  db.prepare('DELETE FROM dashboards').run();
  db.prepare('DELETE FROM datasets').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM login_attempts').run();
});

// Helper: signup a user, return the auth cookie string
async function signupAndGetCookie(email, password = 'password123', name = null) {
  const r = await request(app)
    .post('/api/auth/signup')
    .send({ email, password, name });
  expect(r.status).toBe(200);
  // supertest preserves Set-Cookie headers — extract the auth cookie
  const cookies = r.headers['set-cookie'] || [];
  const authCookie = cookies.find(c => c.startsWith('datawiz_auth='));
  expect(authCookie).toBeDefined();
  return { cookie: authCookie.split(';')[0], user: r.body.user, token: r.body.token };
}

// ─── /api/auth ─────────────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  it('creates a user and returns a token', async () => {
    const r = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@test.com', password: 'password123', name: 'New User' });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('new@test.com');
    expect(r.body.token).toBeDefined();
    // Cookie should be set
    expect(r.headers['set-cookie'][0]).toMatch(/datawiz_auth=/);
  });

  it('rejects short passwords', async () => {
    const r = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'x@test.com', password: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least 8/);
  });

  it('rejects duplicate emails', async () => {
    await request(app).post('/api/auth/signup').send({ email: 'dup@test.com', password: 'password123' });
    const r = await request(app).post('/api/auth/signup').send({ email: 'dup@test.com', password: 'otherpass' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already exists/i);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send({ email: 'login@test.com', password: 'correct-password' });
  });

  it('returns user + token on correct credentials', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'login@test.com', password: 'correct-password' });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('login@test.com');
  });

  it('rejects wrong password with 401', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'login@test.com', password: 'wrong' });
    expect(r.status).toBe(401);
  });

  it('rejects unknown email with 401 (no enumeration)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'whatever' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/invalid email or password/i);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without auth', async () => {
    const r = await request(app).get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  it('returns the user when authenticated', async () => {
    const { cookie } = await signupAndGetCookie('me@test.com');
    const r = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('me@test.com');
  });

  it('accepts Bearer token in Authorization header', async () => {
    const { token } = await signupAndGetCookie('bearer@test.com');
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('bearer@test.com');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie', async () => {
    const { cookie } = await signupAndGetCookie('logout@test.com');
    const r = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(r.status).toBe(200);
    // Set-Cookie should clear datawiz_auth
    const setCookie = r.headers['set-cookie'][0];
    expect(setCookie).toMatch(/datawiz_auth=/);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
  });
});

describe('GET /api/auth/status', () => {
  it('reports needsSetup=true initially', async () => {
    const r = await request(app).get('/api/auth/status');
    expect(r.body.needsSetup).toBe(true);
    expect(r.body.userCount).toBe(0);
  });

  it('reports needsSetup=false after first signup', async () => {
    await request(app).post('/api/auth/signup').send({ email: 'first@test.com', password: 'password123' });
    const r = await request(app).get('/api/auth/status');
    expect(r.body.needsSetup).toBe(false);
    expect(r.body.userCount).toBe(1);
  });
});

// ─── Protected routes ──────────────────────────────────────────────────────

describe('protected routes', () => {
  it('returns 401 on /api/sheets without auth', async () => {
    const r = await request(app).get('/api/sheets');
    expect(r.status).toBe(401);
  });

  it('returns 401 on /api/upload without auth', async () => {
    const r = await request(app).post('/api/upload');
    expect(r.status).toBe(401);
  });

  it('returns 401 on /api/dashboards without auth', async () => {
    const r = await request(app).get('/api/dashboards');
    expect(r.status).toBe(401);
  });
});

// ─── Multi-tenancy E2E ─────────────────────────────────────────────────────

describe('multi-tenancy via routes', () => {
  it("Bob does not see Alice's sheet through the API", async () => {
    const alice = await signupAndGetCookie('alice@e2e.com');
    const bob = await signupAndGetCookie('bob@e2e.com');

    // Need a dataset first since createSheet validates it. We create one
    // directly via the store (upload would need a real file).
    const datasetStore = require('../utils/datasetStore');
    datasetStore.set('ds_alice', {
      fileName: 'alice.csv', fileSize: 100,
      data: [{ x: 1 }],
      analysis: { columns: [{ name: 'x', type: 'numeric' }] },
      ownerId: alice.user.id,
    });

    // Alice creates a sheet
    const create = await request(app)
      .post('/api/sheets')
      .set('Cookie', alice.cookie)
      .send({ name: 'Alice Sheet', datasetId: 'ds_alice', spec: { chartType: 'bar' } });
    expect(create.status).toBe(200);
    const sheetId = create.body.sheet.id;

    // Bob can't see it in the list
    const bobList = await request(app)
      .get('/api/sheets?datasetId=ds_alice')
      .set('Cookie', bob.cookie);
    expect(bobList.status).toBe(200);
    expect(bobList.body.sheets.length).toBe(0);

    // Bob can't fetch it directly either
    const bobGet = await request(app).get(`/api/sheets/${sheetId}`).set('Cookie', bob.cookie);
    expect(bobGet.status).toBe(404);

    // Bob can't update it
    const bobPut = await request(app)
      .put(`/api/sheets/${sheetId}`)
      .set('Cookie', bob.cookie)
      .send({ name: 'HACKED' });
    expect(bobPut.status).toBe(404);

    // Verify Alice's sheet name unchanged
    const aliceGet = await request(app).get(`/api/sheets/${sheetId}`).set('Cookie', alice.cookie);
    expect(aliceGet.status).toBe(200);
    expect(aliceGet.body.sheet.name).toBe('Alice Sheet');
  });
});
