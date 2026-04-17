'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin, createUser, createCampaign } = require('../fixtures/factory');

let db, opToken, campaign;

beforeAll(async () => {
  db = getDb();
  const op = await createUser(db, { email: 'prosp-op@test.com', password: 'Op12345!', role: 'operator' });
  opToken = (await supertest(app).post('/api/v1/auth/login').send({ email: op.email, password: op.password })).body.token;
  campaign = createCampaign(db, { name: 'Prospect Test Campaign' });
});

afterAll(() => { closeDb(); });

beforeEach(() => {
  db.prepare('DELETE FROM contacts').run();
  db.prepare('DELETE FROM prospect_pool').run();
  db.prepare('DELETE FROM prospect_searches').run();
});

// ── POST /search ──────────────────────────────────────────────────────────

describe('POST /api/v1/prospects/search', () => {
  it('returns results object with searchId', async () => {
    const res = await supertest(app)
      .post('/api/v1/prospects/search')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ industries: ['Healthcare'], locations: ['Houston TX'], source: 'apollo' });
    expect(res.status).toBe(200);
    expect(res.body.searchId).toBeTruthy();
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.count).toBe('number');
  });
});

// ── POST / (add one to pool) ──────────────────────────────────────────────

describe('POST /api/v1/prospects', () => {
  it('adds a prospect to the pool', async () => {
    const res = await supertest(app)
      .post('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ first_name: 'Jane', last_name: 'Doe', email: 'jane@corp.com', title: 'CEO', company_name: 'Corp' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.email).toBe('jane@corp.com');
    expect(res.body.status).toBe('pending');
  });
});

// ── GET / (list pool) ─────────────────────────────────────────────────────

describe('GET /api/v1/prospects', () => {
  it('lists the prospect pool', async () => {
    // Add one first
    await supertest(app)
      .post('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ email: 'list@test.com' });

    const res = await supertest(app)
      .get('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});

// ── PATCH /:id ────────────────────────────────────────────────────────────

describe('PATCH /api/v1/prospects/:id', () => {
  it('updates a prospect', async () => {
    const created = (await supertest(app)
      .post('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ email: 'patch@test.com', first_name: 'Old' })).body;

    const res = await supertest(app)
      .patch(`/api/v1/prospects/${created.id}`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({ first_name: 'New', title: 'VP' });
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('New');
    expect(res.body.title).toBe('VP');
  });
});

// ── POST /:id/accept ──────────────────────────────────────────────────────

describe('POST /api/v1/prospects/:id/accept', () => {
  it('accepts a prospect', async () => {
    const created = (await supertest(app)
      .post('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ email: 'accept@test.com' })).body;

    const res = await supertest(app)
      .post(`/api/v1/prospects/${created.id}/accept`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
  });
});

// ── POST /:id/reject ──────────────────────────────────────────────────────

describe('POST /api/v1/prospects/:id/reject', () => {
  it('rejects a prospect', async () => {
    const created = (await supertest(app)
      .post('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ email: 'reject@test.com' })).body;

    const res = await supertest(app)
      .post(`/api/v1/prospects/${created.id}/reject`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});

// ── POST /bulk/assign ─────────────────────────────────────────────────────

describe('POST /api/v1/prospects/bulk/assign', () => {
  it('assigns prospects to a campaign', async () => {
    const p1 = (await supertest(app).post('/api/v1/prospects').set('Authorization', `Bearer ${opToken}`).send({ email: 'a1@test.com' })).body;
    const p2 = (await supertest(app).post('/api/v1/prospects').set('Authorization', `Bearer ${opToken}`).send({ email: 'a2@test.com' })).body;

    const res = await supertest(app)
      .post('/api/v1/prospects/bulk/assign')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ ids: [p1.id, p2.id], campaignId: campaign.id });
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(2);

    // Verify contacts were created
    const contacts = db.prepare('SELECT * FROM contacts WHERE campaign_id = ?').all(campaign.id);
    expect(contacts.length).toBe(2);
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────

describe('DELETE /api/v1/prospects/:id', () => {
  it('deletes a pending prospect', async () => {
    const created = (await supertest(app)
      .post('/api/v1/prospects')
      .set('Authorization', `Bearer ${opToken}`)
      .send({ email: 'todel@test.com' })).body;

    const res = await supertest(app)
      .delete(`/api/v1/prospects/${created.id}`)
      .set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Verify gone
    const check = await supertest(app).get(`/api/v1/prospects/${created.id}`).set('Authorization', `Bearer ${opToken}`);
    expect(check.status).toBe(404);
  });
});
