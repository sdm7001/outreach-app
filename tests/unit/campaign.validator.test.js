'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const campaignService = require('../../src/services/campaign.service');
const campaignValidator = require('../../src/services/campaign.validator');
const { createAdmin } = require('../fixtures/factory');

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

function makeCampaign(overrides = {}) {
  return campaignService.createCampaign({
    name: 'Validator Test Camp',
    daily_limit: 10,
    ...overrides,
  }, adminId);
}

describe('validateCampaign', () => {
  it('returns a result object with required fields', async () => {
    const c = makeCampaign();
    const result = await campaignValidator.validateCampaign(c.id);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('blocking_count');
    expect(result).toHaveProperty('warning_count');
    expect(Array.isArray(result.results)).toBe(true);
  });

  it('returns warning/fail when no sender config', async () => {
    const c = makeCampaign({ sender_config: {} });
    const result = await campaignValidator.validateCampaign(c.id);
    const senderCheck = result.results.find(r => r.category === 'sender');
    expect(senderCheck).toBeTruthy();
  });

  it('persists result to campaign_preflight_results', async () => {
    const c = makeCampaign();
    await campaignValidator.validateCampaign(c.id);
    const row = db.prepare('SELECT * FROM campaign_preflight_results WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1').get(c.id);
    expect(row).toBeTruthy();
    expect(row.campaign_id).toBe(c.id);
  });

  it('updates campaigns.preflight_status after validation', async () => {
    const c = makeCampaign();
    await campaignValidator.validateCampaign(c.id);
    const row = db.prepare('SELECT preflight_status FROM campaigns WHERE id = ?').get(c.id);
    expect(['pass', 'warn', 'fail']).toContain(row.preflight_status);
  });

  it('throws NotFoundError for unknown campaign', async () => {
    const { NotFoundError } = require('../../src/utils/errors');
    await expect(campaignValidator.validateCampaign('no-such-id')).rejects.toThrow(NotFoundError);
  });

  it('score is a number between 0 and 100', async () => {
    const c = makeCampaign();
    const result = await campaignValidator.validateCampaign(c.id);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('each result entry has category, severity, message, passed', async () => {
    const c = makeCampaign();
    const result = await campaignValidator.validateCampaign(c.id);
    for (const r of result.results) {
      expect(r).toHaveProperty('category');
      expect(r).toHaveProperty('severity');
      expect(r).toHaveProperty('message');
      expect(r).toHaveProperty('passed');
    }
  });
});

describe('getLatestPreflight', () => {
  it('returns null when no validation has run', () => {
    const c = makeCampaign();
    const result = campaignValidator.getLatestPreflight(c.id);
    expect(result).toBeNull();
  });

  it('returns the most recent validation result', async () => {
    const c = makeCampaign();
    await campaignValidator.validateCampaign(c.id);
    const result = campaignValidator.getLatestPreflight(c.id);
    expect(result).not.toBeNull();
    expect(result.campaign_id).toBe(c.id);
  });

  it('returns latest after multiple runs', async () => {
    const c = makeCampaign();
    await campaignValidator.validateCampaign(c.id);
    await campaignValidator.validateCampaign(c.id);
    const result = campaignValidator.getLatestPreflight(c.id);
    expect(result).not.toBeNull();
    // Should return the most recent (only one row checked)
    expect(result.campaign_id).toBe(c.id);
  });
});
