'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const campaignService = require('../../src/services/campaign.service');
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

// ── LIFECYCLE TRANSITIONS ─────────────────────────────────────────────────

describe('activateCampaign', () => {
  it('transitions draft → active', () => {
    const c = campaignService.createCampaign({ name: 'Activate Me' }, adminId);
    expect(c.status).toBe('draft');
    const activated = campaignService.activateCampaign(c.id, adminId);
    expect(activated.status).toBe('active');
  });

  it('throws for invalid transition (archived → active)', () => {
    const c = campaignService.createCampaign({ name: 'Archived' }, adminId);
    db.prepare("UPDATE campaigns SET status='archived' WHERE id=?").run(c.id);
    expect(() => campaignService.activateCampaign(c.id, adminId)).toThrow();
  });
});

describe('pauseCampaign', () => {
  it('transitions active → paused', () => {
    const c = campaignService.createCampaign({ name: 'Pause Me' }, adminId);
    campaignService.activateCampaign(c.id, adminId);
    const paused = campaignService.pauseCampaign(c.id);
    expect(paused.status).toBe('paused');
  });
});

describe('resumeCampaign', () => {
  it('transitions paused → active', () => {
    const c = campaignService.createCampaign({ name: 'Resume Me' }, adminId);
    campaignService.activateCampaign(c.id, adminId);
    campaignService.pauseCampaign(c.id);
    const resumed = campaignService.resumeCampaign(c.id);
    expect(resumed.status).toBe('active');
  });
});

describe('scheduleCampaign / unscheduleCampaign', () => {
  it('schedules a draft campaign', () => {
    const c = campaignService.createCampaign({ name: 'Schedule Me' }, adminId);
    const future = new Date(Date.now() + 86400000).toISOString();
    const scheduled = campaignService.scheduleCampaign(c.id, { scheduled_at: future, schedule_mode: 'once', timezone: 'America/Chicago' });
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.scheduled_at).toBe(future);
  });

  it('unschedules back to draft', () => {
    const c = campaignService.createCampaign({ name: 'Unschedule Me' }, adminId);
    const future = new Date(Date.now() + 86400000).toISOString();
    campaignService.scheduleCampaign(c.id, { scheduled_at: future, schedule_mode: 'once' });
    const back = campaignService.unscheduleCampaign(c.id);
    expect(back.status).toBe('draft');
  });

  it('throws for missing scheduled_at', () => {
    const c = campaignService.createCampaign({ name: 'Bad Schedule' }, adminId);
    expect(() => campaignService.scheduleCampaign(c.id, {})).toThrow();
  });
});

describe('unarchiveCampaign', () => {
  it('transitions archived → draft', () => {
    const c = campaignService.createCampaign({ name: 'Unarchive Me' }, adminId);
    campaignService.deleteCampaign(c.id); // archives it
    const unarchived = campaignService.unarchiveCampaign(c.id);
    expect(unarchived.status).toBe('draft');
  });
});

// ── CAMPAIGN RUNS ─────────────────────────────────────────────────────────

describe('createRun / getRun / listRuns / updateRun', () => {
  let campId;

  beforeEach(() => {
    const c = campaignService.createCampaign({ name: 'Run Test Camp' }, adminId);
    campId = c.id;
  });

  it('creates a run record', () => {
    const run = campaignService.createRun(campId, { runType: 'manual', stage: 'all', triggeredBy: adminId });
    expect(run.id).toBeTruthy();
    expect(run.campaign_id).toBe(campId);
    expect(run.run_type).toBe('manual');
    expect(run.status).toBe('queued');
  });

  it('getRun retrieves the run', () => {
    const run = campaignService.createRun(campId, { runType: 'manual', stage: 'generate', triggeredBy: adminId });
    const fetched = campaignService.getRun(run.id);
    expect(fetched.id).toBe(run.id);
  });

  it('listRuns returns runs for campaign', () => {
    campaignService.createRun(campId, { runType: 'manual', stage: 'all', triggeredBy: adminId });
    campaignService.createRun(campId, { runType: 'dry_run', stage: 'all', triggeredBy: adminId });
    const runs = campaignService.listRuns(campId, { limit: 10 });
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it('updateRun changes status', () => {
    const run = campaignService.createRun(campId, { runType: 'manual', stage: 'all', triggeredBy: adminId });
    campaignService.updateRun(run.id, { status: 'completed', finished_at: new Date().toISOString() });
    const updated = campaignService.getRun(run.id);
    expect(updated.status).toBe('completed');
  });

  it('logRunStep records a step entry', () => {
    const run = campaignService.createRun(campId, { runType: 'manual', stage: 'generate', triggeredBy: adminId });
    expect(() => campaignService.logRunStep(run.id, 'generate', 'completed', { itemsProcessed: 5 })).not.toThrow();
  });

  it('enforces idempotency — duplicate key returns existing run', () => {
    const key = `run:idem:${campId}:${Date.now()}`;
    const run1 = campaignService.createRun(campId, { runType: 'manual', stage: 'all', triggeredBy: adminId, idempotencyKey: key });
    const run2 = campaignService.createRun(campId, { runType: 'manual', stage: 'all', triggeredBy: adminId, idempotencyKey: key });
    expect(run1.id).toBe(run2.id);
  });
});

// ── EXCLUSIONS ────────────────────────────────────────────────────────────

describe('exclusions', () => {
  let campId;

  beforeEach(() => {
    const c = campaignService.createCampaign({ name: 'Exclusion Camp' }, adminId);
    campId = c.id;
  });

  it('adds an email exclusion', () => {
    const ex = campaignService.addExclusion(campId, { email: 'bad@example.com', reason: 'test', addedBy: adminId });
    expect(ex.id).toBeTruthy();
    expect(ex.email).toBe('bad@example.com');
  });

  it('adds a domain exclusion', () => {
    const ex = campaignService.addExclusion(campId, { domain: 'spam.com', reason: 'domain block', addedBy: adminId });
    expect(ex.domain).toBe('spam.com');
  });

  it('isExcluded returns true for excluded email', () => {
    campaignService.addExclusion(campId, { email: 'blocked@example.com', addedBy: adminId });
    expect(campaignService.isExcluded(campId, 'blocked@example.com')).toBe(true);
  });

  it('isExcluded returns true for excluded domain', () => {
    campaignService.addExclusion(campId, { domain: 'blocked.com', addedBy: adminId });
    expect(campaignService.isExcluded(campId, 'anyone@blocked.com')).toBe(true);
  });

  it('isExcluded returns false for non-excluded email', () => {
    expect(campaignService.isExcluded(campId, 'allowed@example.com')).toBe(false);
  });

  it('listExclusions returns all exclusions for campaign', () => {
    campaignService.addExclusion(campId, { email: 'a@ex.com', addedBy: adminId });
    campaignService.addExclusion(campId, { email: 'b@ex.com', addedBy: adminId });
    const list = campaignService.listExclusions(campId);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('removeExclusion deletes it', () => {
    const ex = campaignService.addExclusion(campId, { email: 'remove@ex.com', addedBy: adminId });
    campaignService.removeExclusion(ex.id);
    const list = campaignService.listExclusions(campId);
    expect(list.find(e => e.id === ex.id)).toBeUndefined();
  });

  it('throws ValidationError when neither email nor domain provided', () => {
    const { ValidationError } = require('../../src/utils/errors');
    expect(() => campaignService.addExclusion(campId, { reason: 'no target' })).toThrow(ValidationError);
  });
});

// ── METRICS SNAPSHOT ──────────────────────────────────────────────────────

describe('takeMetricsSnapshot / getMetricsTrend', () => {
  it('takes a snapshot without error', () => {
    const c = campaignService.createCampaign({ name: 'Snapshot Camp' }, adminId);
    expect(() => campaignService.takeMetricsSnapshot(c.id)).not.toThrow();
  });

  it('getMetricsTrend returns an array', () => {
    const c = campaignService.createCampaign({ name: 'Trend Camp' }, adminId);
    campaignService.takeMetricsSnapshot(c.id);
    const trend = campaignService.getMetricsTrend(c.id, 7);
    expect(Array.isArray(trend)).toBe(true);
  });
});
