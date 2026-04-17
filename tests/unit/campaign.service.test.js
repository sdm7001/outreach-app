'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const campaignService = require('../../src/services/campaign.service');
const { createAdmin, createCampaign } = require('../fixtures/factory');

let db, adminId;

beforeAll(async () => {
  db = getDb();
  const admin = await createAdmin(db);
  adminId = admin.id;
});
afterAll(() => { closeDb(); });
beforeEach(() => {
  db.prepare('DELETE FROM campaigns').run();
});

describe('createCampaign', () => {
  it('creates a campaign with defaults', () => {
    const c = campaignService.createCampaign({ name: 'My Campaign', daily_limit: 5 }, adminId);
    expect(c.id).toBeTruthy();
    expect(c.name).toBe('My Campaign');
    expect(c.status).toBe('draft');
    expect(c.daily_limit).toBe(5);
  });

  it('parses JSON config fields', () => {
    const icp = { industries: ['Healthcare'], locations: ['Houston, TX'] };
    const c = campaignService.createCampaign({ name: 'ICP Test', icp_config: icp }, adminId);
    expect(c.icp_config).toEqual(icp);
  });

  it('throws ValidationError for empty name', () => {
    const { ValidationError } = require('../../src/utils/errors');
    expect(() => campaignService.createCampaign({ name: '  ' }, adminId)).toThrow(ValidationError);
  });
});

describe('getCampaign', () => {
  it('returns campaign with contact count', () => {
    const created = campaignService.createCampaign({ name: 'Get Test' }, adminId);
    const c = campaignService.getCampaign(created.id);
    expect(c.id).toBe(created.id);
    expect(typeof c.contact_count).toBe('number');
  });

  it('throws NotFoundError for unknown id', () => {
    const { NotFoundError } = require('../../src/utils/errors');
    expect(() => campaignService.getCampaign('nonexistent')).toThrow(NotFoundError);
  });
});

describe('listCampaigns', () => {
  it('returns paginated campaigns', () => {
    campaignService.createCampaign({ name: 'Camp A' }, adminId);
    campaignService.createCampaign({ name: 'Camp B' }, adminId);
    const result = campaignService.listCampaigns({ page: 1, limit: 10 });
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('filters by status', () => {
    campaignService.createCampaign({ name: 'Draft Camp' }, adminId);
    const result = campaignService.listCampaigns({ status: 'draft' });
    expect(result.data.every(c => c.status === 'draft')).toBe(true);
  });

  it('filters by search term', () => {
    campaignService.createCampaign({ name: 'Houston Healthcare 2026' }, adminId);
    campaignService.createCampaign({ name: 'Legal Outreach' }, adminId);
    const result = campaignService.listCampaigns({ search: 'Houston' });
    expect(result.data.some(c => c.name.includes('Houston'))).toBe(true);
  });
});

describe('updateCampaign', () => {
  it('updates campaign fields', () => {
    const c = campaignService.createCampaign({ name: 'Update Me', daily_limit: 5 }, adminId);
    const updated = campaignService.updateCampaign(c.id, { name: 'Updated', daily_limit: 20 });
    expect(updated.name).toBe('Updated');
    expect(updated.daily_limit).toBe(20);
  });

  it('throws NotFoundError for unknown id', () => {
    const { NotFoundError } = require('../../src/utils/errors');
    expect(() => campaignService.updateCampaign('bad-id', { name: 'X' })).toThrow(NotFoundError);
  });
});

describe('cloneCampaign', () => {
  it('creates a copy with draft status', () => {
    const original = campaignService.createCampaign({ name: 'Original', description: 'desc' }, adminId);
    campaignService.updateCampaign(original.id, { status: 'active' });
    const clone = campaignService.cloneCampaign(original.id, adminId);
    expect(clone.id).not.toBe(original.id);
    expect(clone.name).toContain('Original');
    expect(clone.status).toBe('draft');
  });
});

describe('deleteCampaign (archive)', () => {
  it('archives campaign instead of deleting', () => {
    const c = campaignService.createCampaign({ name: 'Archive Me' }, adminId);
    campaignService.deleteCampaign(c.id);
    const row = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(c.id);
    expect(row.status).toBe('archived');
  });
});
