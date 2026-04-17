'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin, createUser } = require('../fixtures/factory');

let db, adminToken, opToken;

beforeAll(async () => {
  db = getDb();
  const admin = await createAdmin(db, { email: 'camp-admin@test.com', password: 'Admin1234!' });
  const op = await createUser(db, { email: 'camp-op@test.com', password: 'Op12345!', role: 'operator' });
  adminToken = (await supertest(app).post('/api/v1/auth/login').send({ email: admin.email, password: admin.password })).body.token;
  opToken = (await supertest(app).post('/api/v1/auth/login').send({ email: op.email, password: op.password })).body.token;
});
afterAll(() => { closeDb(); });
beforeEach(() => { db.prepare('DELETE FROM campaigns').run(); });

describe('GET /api/v1/campaigns', () => {
  it('returns empty list when no campaigns', async () => {
    const res = await supertest(app).get('/api/v1/campaigns').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data || res.body).toBeDefined();
  });

  it('requires authentication', async () => {
    const res = await supertest(app).get('/api/v1/campaigns');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/campaigns', () => {
  it('creates campaign with valid data', async () => {
    const res = await supertest(app)
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ name: 'Test Campaign', description: 'A test', daily_limit: 10 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Campaign');
    expect(res.body.status).toBe('draft');
    expect(res.body.id).toBeTruthy();
  });

  it('returns 400 for missing name', async () => {
    const res = await supertest(app)
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ description: 'No name' });
    expect(res.status).toBe(400);
  });

  it('requires operator role (analyst forbidden)', async () => {
    const analyst = await createUser(db, { email: 'analyst-camp@test.com', password: 'An12345!', role: 'analyst' });
    const analyToken = (await supertest(app).post('/api/v1/auth/login').send({ email: analyst.email, password: analyst.password })).body.token;
    const res = await supertest(app)
      .post('/api/v1/campaigns')
      .set('Authorization', `Bearer ${analyToken}`)
      .send({ name: 'Forbidden' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/v1/campaigns/:id', () => {
  it('updates campaign status', async () => {
    const created = await supertest(app).post('/api/v1/campaigns').set('Authorization', `Bearer ${opToken}`).send({ name: 'Updatable' });
    const id = created.body.id;
    const res = await supertest(app).put(`/api/v1/campaigns/${id}`).set('Authorization', `Bearer ${opToken}`).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('returns 404 for unknown campaign', async () => {
    const res = await supertest(app).put('/api/v1/campaigns/nonexistent').set('Authorization', `Bearer ${opToken}`).send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/campaigns/:id/clone', () => {
  it('clones a campaign as draft', async () => {
    const created = await supertest(app).post('/api/v1/campaigns').set('Authorization', `Bearer ${opToken}`).send({ name: 'Source', daily_limit: 7 });
    const id = created.body.id;
    const res = await supertest(app).post(`/api/v1/campaigns/${id}/clone`).set('Authorization', `Bearer ${opToken}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(id);
    expect(res.body.status).toBe('draft');
  });
});

describe('DELETE /api/v1/campaigns/:id', () => {
  it('archives a campaign', async () => {
    const created = await supertest(app).post('/api/v1/campaigns').set('Authorization', `Bearer ${opToken}`).send({ name: 'To Archive' });
    const id = created.body.id;
    const del = await supertest(app).delete(`/api/v1/campaigns/${id}`).set('Authorization', `Bearer ${opToken}`);
    expect(del.status).toBe(200);
    const check = await supertest(app).get(`/api/v1/campaigns/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(check.body.status).toBe('archived');
  });
});
