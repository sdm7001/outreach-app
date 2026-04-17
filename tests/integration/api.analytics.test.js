'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin, createCampaign } = require('../fixtures/factory');

let db, adminToken;

beforeAll(async () => {
  db = getDb();
  const admin = await createAdmin(db, { email: 'analytics-admin@test.com', password: 'Admin1234!' });
  adminToken = (await supertest(app).post('/api/v1/auth/login').send({ email: admin.email, password: admin.password })).body.token;
});
afterAll(() => { closeDb(); });

describe('GET /api/v1/analytics/dashboard', () => {
  it('returns dashboard stats structure', async () => {
    const res = await supertest(app).get('/api/v1/analytics/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.active_campaigns).toBe('number');
    expect(typeof res.body.contacts_in_pipeline).toBe('number');
    expect(typeof res.body.emails_sent_this_week).toBe('number');
    expect(typeof res.body.overall_open_rate).toBe('number');
    expect(typeof res.body.pending_review_count).toBe('number');
    expect(typeof res.body.failed_jobs).toBe('number');
  });

  it('requires authentication', async () => {
    const res = await supertest(app).get('/api/v1/analytics/dashboard');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/analytics/campaigns/:id', () => {
  it('returns campaign stats', async () => {
    const campaign = createCampaign(db);
    const res = await supertest(app).get(`/api/v1/analytics/campaigns/${campaign.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.campaign_id).toBe(campaign.id);
    expect(typeof res.body.total_sent).toBe('number');
    expect(typeof res.body.open_rate).toBe('number');
  });
});
