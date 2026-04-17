'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin } = require('../fixtures/factory');

let db, adminToken;

beforeAll(async () => {
  db = getDb();
  const admin = await createAdmin(db, { email: 'supp-admin@test.com', password: 'Admin1234!' });
  adminToken = (await supertest(app).post('/api/v1/auth/login').send({ email: admin.email, password: admin.password })).body.token;
});
afterAll(() => { closeDb(); });
beforeEach(() => { db.prepare('DELETE FROM suppression').run(); });

describe('GET /api/v1/suppression', () => {
  it('returns empty list initially', async () => {
    const res = await supertest(app).get('/api/v1/suppression').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('requires authentication', async () => {
    const res = await supertest(app).get('/api/v1/suppression');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/suppression', () => {
  it('adds email to suppression list', async () => {
    const res = await supertest(app)
      .post('/api/v1/suppression')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'banned@test.com', reason: 'manual' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('banned@test.com');
  });

  it('adds domain to suppression list', async () => {
    const res = await supertest(app)
      .post('/api/v1/suppression')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ domain: 'spammy.com', reason: 'complaint' });
    expect(res.status).toBe(201);
    expect(res.body.domain).toBe('spammy.com');
  });

  it('is idempotent for duplicate email', async () => {
    await supertest(app).post('/api/v1/suppression').set('Authorization', `Bearer ${adminToken}`).send({ email: 'idem@test.com', reason: 'manual' });
    const res = await supertest(app).post('/api/v1/suppression').set('Authorization', `Bearer ${adminToken}`).send({ email: 'idem@test.com', reason: 'manual' });
    expect(res.status).toBeLessThan(500);
  });
});

describe('DELETE /api/v1/suppression/:id', () => {
  it('removes suppression entry', async () => {
    const added = await supertest(app).post('/api/v1/suppression').set('Authorization', `Bearer ${adminToken}`).send({ email: 'remove@test.com', reason: 'manual' });
    const id = added.body.id;
    const del = await supertest(app).delete(`/api/v1/suppression/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    const list = await supertest(app).get('/api/v1/suppression').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.data.some(s => s.id === id)).toBe(false);
  });

  it('returns 404 for unknown id', async () => {
    const res = await supertest(app).delete('/api/v1/suppression/nonexistent').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
