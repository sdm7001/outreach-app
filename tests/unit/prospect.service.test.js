'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const prospectService = require('../../src/services/prospect.service');
const { createAdmin, createCampaign } = require('../fixtures/factory');
const { NotFoundError, ValidationError } = require('../../src/utils/errors');

let db, adminId, campaignId;

beforeAll(async () => {
  db = getDb();
  const admin = await createAdmin(db);
  adminId = admin.id;
  const camp = createCampaign(db);
  campaignId = camp.id;
});

afterAll(() => { closeDb(); });

beforeEach(() => {
  db.prepare('DELETE FROM contacts').run();
  db.prepare('DELETE FROM prospect_pool').run();
  db.prepare('DELETE FROM prospect_searches').run();
});

// ── addToPool ─────────────────────────────────────────────────────────────

describe('addToPool', () => {
  it('creates a record in the pool', () => {
    const p = prospectService.addToPool({
      first_name: 'Jane', last_name: 'Doe',
      email: 'jane@example.com', title: 'CEO', company_name: 'Acme',
    }, adminId);
    expect(p.id).toBeTruthy();
    expect(p.email).toBe('jane@example.com');
    expect(p.status).toBe('pending');
  });

  it('stores tags as parsed array', () => {
    const p = prospectService.addToPool({ first_name: 'Bob', tags: ['a', 'b'] }, adminId);
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.tags).toEqual(['a', 'b']);
  });
});

// ── listProspects ─────────────────────────────────────────────────────────

describe('listProspects', () => {
  beforeEach(() => {
    prospectService.addToPool({ email: 'p1@x.com', first_name: 'A', status: undefined }, adminId);
    prospectService.addToPool({ email: 'p2@x.com', first_name: 'B' }, adminId);
  });

  it('returns paginated results', () => {
    const result = prospectService.listProspects({ page: 1, limit: 10 });
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.page).toBe(1);
  });

  it('filters by status', () => {
    // Accept one
    const list = prospectService.listProspects({});
    prospectService.acceptProspect(list.data[0].id);

    const accepted = prospectService.listProspects({ status: 'accepted' });
    expect(accepted.data.every(p => p.status === 'accepted')).toBe(true);

    const pending = prospectService.listProspects({ status: 'pending' });
    expect(pending.data.every(p => p.status === 'pending')).toBe(true);
  });
});

// ── getProspect ───────────────────────────────────────────────────────────

describe('getProspect', () => {
  it('returns a single record by id', () => {
    const created = prospectService.addToPool({ email: 'get@test.com' }, adminId);
    const found = prospectService.getProspect(created.id);
    expect(found.id).toBe(created.id);
    expect(found.email).toBe('get@test.com');
  });

  it('throws NotFoundError for unknown id', () => {
    expect(() => prospectService.getProspect('nonexistent-id')).toThrow(NotFoundError);
  });
});

// ── updateProspect ────────────────────────────────────────────────────────

describe('updateProspect', () => {
  it('modifies allowed fields', () => {
    const p = prospectService.addToPool({ email: 'upd@test.com', first_name: 'Old' }, adminId);
    const updated = prospectService.updateProspect(p.id, { first_name: 'New', title: 'VP' });
    expect(updated.first_name).toBe('New');
    expect(updated.title).toBe('VP');
  });
});

// ── acceptProspect / rejectProspect ───────────────────────────────────────

describe('acceptProspect', () => {
  it('sets status to accepted', () => {
    const p = prospectService.addToPool({ email: 'acc@test.com' }, adminId);
    const result = prospectService.acceptProspect(p.id);
    expect(result.status).toBe('accepted');
  });
});

describe('rejectProspect', () => {
  it('sets status to rejected', () => {
    const p = prospectService.addToPool({ email: 'rej@test.com' }, adminId);
    const result = prospectService.rejectProspect(p.id);
    expect(result.status).toBe('rejected');
  });
});

// ── bulkAccept / bulkReject ───────────────────────────────────────────────

describe('bulkAccept', () => {
  it('updates multiple records to accepted', () => {
    const p1 = prospectService.addToPool({ email: 'ba1@test.com' }, adminId);
    const p2 = prospectService.addToPool({ email: 'ba2@test.com' }, adminId);
    const count = prospectService.bulkAccept([p1.id, p2.id]);
    expect(count).toBe(2);
    expect(prospectService.getProspect(p1.id).status).toBe('accepted');
    expect(prospectService.getProspect(p2.id).status).toBe('accepted');
  });
});

describe('bulkReject', () => {
  it('updates multiple records to rejected', () => {
    const p1 = prospectService.addToPool({ email: 'br1@test.com' }, adminId);
    const p2 = prospectService.addToPool({ email: 'br2@test.com' }, adminId);
    const count = prospectService.bulkReject([p1.id, p2.id]);
    expect(count).toBe(2);
    expect(prospectService.getProspect(p1.id).status).toBe('rejected');
    expect(prospectService.getProspect(p2.id).status).toBe('rejected');
  });
});

// ── assignToCampaign ──────────────────────────────────────────────────────

describe('assignToCampaign', () => {
  it('creates contacts and sets prospect status to assigned', () => {
    const p = prospectService.addToPool({ email: 'assign@test.com', first_name: 'X' }, adminId);
    const count = prospectService.assignToCampaign([p.id], campaignId, adminId);
    expect(count).toBe(1);
    expect(prospectService.getProspect(p.id).status).toBe('assigned');
    const contact = db.prepare('SELECT * FROM contacts WHERE prospect_pool_id = ?').get(p.id);
    expect(contact).toBeTruthy();
    expect(contact.campaign_id).toBe(campaignId);
  });

  it('skips rejected prospects during assignment', () => {
    const p = prospectService.addToPool({ email: 'skip@test.com' }, adminId);
    prospectService.rejectProspect(p.id);
    const count = prospectService.assignToCampaign([p.id], campaignId, adminId);
    expect(count).toBe(0);
  });
});

// ── deleteProspect ────────────────────────────────────────────────────────

describe('deleteProspect', () => {
  it('hard deletes a pending prospect', () => {
    const p = prospectService.addToPool({ email: 'del@test.com' }, adminId);
    prospectService.deleteProspect(p.id);
    expect(() => prospectService.getProspect(p.id)).toThrow(NotFoundError);
  });

  it('throws ValidationError when trying to delete an assigned prospect', () => {
    const p = prospectService.addToPool({ email: 'del2@test.com' }, adminId);
    prospectService.assignToCampaign([p.id], campaignId, adminId);
    expect(() => prospectService.deleteProspect(p.id)).toThrow(ValidationError);
  });
});
