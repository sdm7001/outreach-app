'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin, createCampaign, createContact } = require('../fixtures/factory');
const { v4: uuidv4 } = require('uuid');

let db;

beforeAll(() => { db = getDb(); });
afterAll(() => { closeDb(); });

describe('GET /t/o/:eventId — open tracking pixel', () => {
  it('returns 1x1 GIF and responds 200', async () => {
    const eventId = uuidv4();
    const res = await supertest(app).get(`/t/o/${eventId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('GET /t/c/:eventId — click tracking redirect', () => {
  it('redirects to the target URL', async () => {
    const eventId = uuidv4();
    const url = encodeURIComponent('https://texmg.com');
    const res = await supertest(app).get(`/t/c/${eventId}?url=${url}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://texmg.com');
  });

  it('returns 400 for missing url', async () => {
    const eventId = uuidv4();
    const res = await supertest(app).get(`/t/c/${eventId}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-http URL (security: no open redirect to arbitrary schemes)', async () => {
    const eventId = uuidv4();
    const url = encodeURIComponent('javascript:alert(1)');
    const res = await supertest(app).get(`/t/c/${eventId}?url=${url}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /unsubscribe/:token', () => {
  it('processes valid unsubscribe token and shows confirmation page', async () => {
    const contact = createContact(db, { email: 'unsub-track@test.com' });
    const token = Buffer.from(`${contact.id}:unsub-track@test.com`).toString('base64url');
    const res = await supertest(app).get(`/unsubscribe/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Unsubscribed');
    const updated = db.prepare('SELECT status FROM contacts WHERE id = ?').get(contact.id);
    expect(updated.status).toBe('unsubscribed');
  });

  it('shows error for invalid token', async () => {
    const res = await supertest(app).get('/unsubscribe/invalidbase64token');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
