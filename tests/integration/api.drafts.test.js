'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin, createUser, createCampaign, createContact, createDraft } = require('../fixtures/factory');

let db, opToken, campaign, contact;

beforeAll(async () => {
  db = getDb();
  const op = await createUser(db, { email: 'drafts-op@test.com', password: 'Op12345!', role: 'operator' });
  opToken = (await supertest(app).post('/api/v1/auth/login').send({ email: op.email, password: op.password })).body.token;
});

afterAll(() => { closeDb(); });

beforeEach(() => {
  db.prepare('DELETE FROM message_drafts').run();
  db.prepare('DELETE FROM contacts').run();
  db.prepare('DELETE FROM campaigns').run();
  campaign = createCampaign(db, { name: 'Draft Test Campaign' });
  contact = createContact(db, { campaign_id: campaign.id, email: 'recipient@test.com' });
});

// ── GET /campaign/:id ─────────────────────────────────────────────────────

describe('GET /api/v1/drafts/campaign/:campaignId', () => {
  it('returns drafts array for a campaign', async () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id });

    const res = await supertest(app)
      .get(`/api/v1/drafts/campaign/${campaign.id}`)
      .set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.total).toBe(2);
  });
});

// ── GET /campaign/:id/stats ───────────────────────────────────────────────

describe('GET /api/v1/drafts/campaign/:campaignId/stats', () => {
  it('returns counts object with correct totals', async () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'approved' });

    const res = await supertest(app)
      .get(`/api/v1/drafts/campaign/${campaign.id}/stats`)
      .set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.pending_review).toBe(1);
    expect(res.body.approved).toBe(1);
    expect(res.body.rejected).toBe(0);
  });
});

// ── POST /:id/approve ─────────────────────────────────────────────────────

describe('POST /api/v1/drafts/:id/approve', () => {
  it('approves a draft and returns updated status', async () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });

    const res = await supertest(app)
      .post(`/api/v1/drafts/${draft.id}/approve`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.reviewed_at).toBeTruthy();
  });
});

// ── POST /:id/reject ──────────────────────────────────────────────────────

describe('POST /api/v1/drafts/:id/reject', () => {
  it('rejects a draft', async () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });

    const res = await supertest(app)
      .post(`/api/v1/drafts/${draft.id}/reject`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({ reason: 'Too generic' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});

// ── PATCH /:id ────────────────────────────────────────────────────────────

describe('PATCH /api/v1/drafts/:id', () => {
  it('edits subject and body of a draft', async () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id });

    const res = await supertest(app)
      .patch(`/api/v1/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({ subject: 'Updated Subject', body: 'Updated body content.' });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Updated Subject');
    expect(res.body.body).toBe('Updated body content.');
  });
});

// ── POST /campaign/:id/approve-all ────────────────────────────────────────

describe('POST /api/v1/drafts/campaign/:campaignId/approve-all', () => {
  it('bulk approves drafts at or below spam threshold', async () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 1 });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 3 });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 9 });

    const res = await supertest(app)
      .post(`/api/v1/drafts/campaign/${campaign.id}/approve-all`)
      .set('Authorization', `Bearer ${opToken}`)
      .send({ spamThreshold: 5 });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(2);

    // High spam draft should still be pending
    const stats = await supertest(app)
      .get(`/api/v1/drafts/campaign/${campaign.id}/stats`)
      .set('Authorization', `Bearer ${opToken}`);
    expect(stats.body.pending_review).toBe(1);
    expect(stats.body.approved).toBe(2);
  });
});
