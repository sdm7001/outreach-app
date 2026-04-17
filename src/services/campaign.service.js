'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

// Valid campaign statuses and allowed transitions
const VALID_STATUSES = new Set([
  'draft', 'validation_failed', 'ready', 'scheduled', 'running',
  'active', 'paused', 'completed', 'archived', 'errored',
]);

const ALLOWED_TRANSITIONS = {
  draft:            ['ready', 'validation_failed', 'active', 'archived'],
  validation_failed:['draft', 'ready', 'archived'],
  ready:            ['scheduled', 'active', 'running', 'archived', 'draft'],
  scheduled:        ['running', 'active', 'paused', 'archived', 'ready'],
  active:           ['paused', 'completed', 'archived', 'running', 'errored'],
  running:          ['paused', 'completed', 'archived', 'errored', 'active'],
  paused:           ['active', 'running', 'scheduled', 'archived'],
  completed:        ['archived', 'draft'],
  errored:          ['draft', 'active', 'archived'],
  archived:         [], // terminal — can only be un-archived via explicit action
};

const JSON_FIELDS = ['icp_config', 'sender_config', 'schedule_config', 'auto_send_policy', 'compliance_config', 'tags'];

function parseCampaign(row) {
  if (!row) return null;
  const parsed = { ...row };
  for (const f of JSON_FIELDS) {
    try { parsed[f] = JSON.parse(row[f] || (f === 'tags' ? '[]' : '{}')); }
    catch (_) { parsed[f] = f === 'tags' ? [] : {}; }
  }
  return parsed;
}

function serializeForDb(data) {
  const out = { ...data };
  for (const f of JSON_FIELDS) {
    if (out[f] !== undefined) out[f] = JSON.stringify(out[f]);
  }
  return out;
}

// ── CREATE ─────────────────────────────────────────────────────────────────

function createCampaign(data, userId) {
  const db = getDb();
  const {
    name, description, objective, priority, channel_type,
    icp_config, sender_config, schedule_config, auto_send_policy, compliance_config,
    daily_limit, max_daily_sends, max_hourly_sends,
    timezone, start_at, end_at,
    allow_manual_runs, require_preflight, review_mode,
    schedule_mode, sender_profile_id, reply_to_email,
    sequence_id, tags, notes,
  } = data;

  if (!name || !name.trim()) throw new ValidationError('Campaign name is required', 'name');

  const id = uuidv4();
  const now = new Date().toISOString();
  const effectiveDailyLimit = max_daily_sends || daily_limit || 10;
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + id.slice(0, 8);

  db.prepare(`
    INSERT INTO campaigns (
      id, name, slug, status, description, objective, priority, channel_type,
      icp_config, sender_config, schedule_config, auto_send_policy, compliance_config,
      daily_limit, max_daily_sends, max_hourly_sends,
      timezone, start_at, end_at,
      allow_manual_runs, require_preflight, review_mode,
      schedule_mode, scheduled_at,
      sender_profile_id, reply_to_email,
      sequence_id, tags, notes,
      owner_user_id, created_by,
      preflight_status, preflight_score,
      created_at, updated_at
    ) VALUES (
      ?,?,?,?,?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,
      ?,?,
      ?,?,?,
      ?,?,
      ?,?,
      ?,?
    )
  `).run(
    id, name.trim(), slug, 'draft', description || null, objective || null,
    priority || 'normal', channel_type || 'email',
    JSON.stringify(icp_config || {}),
    JSON.stringify(sender_config || {}),
    JSON.stringify(schedule_config || {}),
    JSON.stringify(auto_send_policy || {}),
    JSON.stringify(compliance_config || {}),
    effectiveDailyLimit, effectiveDailyLimit,
    max_hourly_sends || 5,
    timezone || 'America/Chicago', start_at || null, end_at || null,
    allow_manual_runs !== false ? 1 : 0,
    require_preflight !== false ? 1 : 0,
    review_mode || 'manual',
    schedule_mode || 'manual', null,
    sender_profile_id || null, reply_to_email || null,
    sequence_id || null,
    JSON.stringify(tags || []), notes || null,
    userId || null, userId || null,
    'unchecked', 0,
    now, now,
  );

  logger.info('Campaign created', { campaignId: id, name: name.trim(), userId });
  return getCampaign(id);
}

// ── READ ──────────────────────────────────────────────────────────────────

function getCampaign(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Campaign ${id} not found`);
  return _enrichCampaign(db, parseCampaign(row));
}

function getCampaignBySlug(slug) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(slug);
  if (!row) throw new NotFoundError(`Campaign ${slug} not found`);
  return _enrichCampaign(db, parseCampaign(row));
}

function _enrichCampaign(db, campaign) {
  const id = campaign.id;
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status='opened' THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) as bounced,
      SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsubscribed,
      SUM(CASE WHEN status='suppressed' THEN 1 ELSE 0 END) as suppressed
    FROM contacts WHERE campaign_id = ?
  `).get(id);

  const sentCount = db.prepare('SELECT COUNT(*) as cnt FROM send_events WHERE campaign_id = ?').get(id);
  const pendingDrafts = db.prepare("SELECT COUNT(*) as cnt FROM message_drafts WHERE campaign_id = ? AND status='pending_review'").get(id);
  const queuedJobs = db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status='pending' AND payload LIKE ?").get(`%${id}%`);

  const lastRun = db.prepare('SELECT * FROM campaign_runs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1').get(id);

  campaign.contact_count = counts.total;
  campaign.contact_counts = {
    total: counts.total, pending: counts.pending, sent: counts.sent,
    opened: counts.opened, replied: counts.replied, bounced: counts.bounced,
    unsubscribed: counts.unsubscribed, suppressed: counts.suppressed,
  };
  campaign.sent_count = sentCount.cnt;
  campaign.pending_drafts = pendingDrafts.cnt;
  campaign.queued_jobs = queuedJobs.cnt;
  campaign.last_run = lastRun || null;
  return campaign;
}

function listCampaigns({ status, page = 1, limit = 20, search, priority, owner_user_id, schedule_mode } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    if (status === 'active') {
      conditions.push("c.status IN ('active','running','scheduled')");
    } else {
      conditions.push('c.status = ?');
      params.push(status);
    }
  }
  if (search) {
    conditions.push('(c.name LIKE ? OR c.description LIKE ? OR c.objective LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (priority) { conditions.push('c.priority = ?'); params.push(priority); }
  if (owner_user_id) { conditions.push('c.owner_user_id = ?'); params.push(owner_user_id); }
  if (schedule_mode) { conditions.push('c.schedule_mode = ?'); params.push(schedule_mode); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM campaigns c ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM contacts ct WHERE ct.campaign_id = c.id) as contact_count,
      (SELECT COUNT(*) FROM send_events se WHERE se.campaign_id = c.id) as sent_count,
      (SELECT COUNT(*) FROM message_drafts md WHERE md.campaign_id = c.id AND md.status='pending_review') as pending_drafts,
      (SELECT status FROM campaign_runs WHERE campaign_id = c.id ORDER BY created_at DESC LIMIT 1) as last_run_status_detail,
      (SELECT created_at FROM campaign_runs WHERE campaign_id = c.id ORDER BY created_at DESC LIMIT 1) as last_run_at_detail
    FROM campaigns c ${where}
    ORDER BY c.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    data: rows.map(parseCampaign),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

// ── UPDATE ────────────────────────────────────────────────────────────────

function updateCampaign(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Campaign ${id} not found`);

  // Status transition validation
  if (data.status && data.status !== existing.status) {
    _validateStatusTransition(existing.status, data.status, id);
    if (data.status === 'archived') {
      data.archived_at = new Date().toISOString();
    }
  }

  const UPDATABLE = [
    'name', 'description', 'objective', 'priority', 'channel_type',
    'icp_config', 'sender_config', 'schedule_config', 'auto_send_policy', 'compliance_config',
    'daily_limit', 'max_daily_sends', 'max_hourly_sends',
    'timezone', 'start_at', 'end_at', 'scheduled_at',
    'allow_manual_runs', 'require_preflight', 'review_mode',
    'schedule_mode', 'sender_profile_id', 'reply_to_email',
    'sequence_id', 'tags', 'notes', 'owner_user_id',
    'status', 'last_run_at', 'last_run_status', 'next_run_at',
    'preflight_status', 'preflight_score', 'archived_at',
  ];

  const updates = [];
  const params = [];
  const serialized = serializeForDb(data);

  for (const key of UPDATABLE) {
    if (serialized[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(serialized[key]);
    }
  }

  if (updates.length === 0) throw new ValidationError('No valid fields to update');

  updates.push('updated_at = ?');
  params.push(new Date().toISOString(), id);

  db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logger.info('Campaign updated', { campaignId: id, fields: Object.keys(data) });
  return getCampaign(id);
}

function _validateStatusTransition(from, to, id) {
  if (!VALID_STATUSES.has(to)) {
    throw new ValidationError(`Invalid campaign status: ${to}`, 'status');
  }
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ValidationError(
      `Cannot transition campaign from '${from}' to '${to}'. Allowed: ${allowed.join(', ') || 'none'}`,
      'status'
    );
  }
}

// ── DELETE / ARCHIVE ──────────────────────────────────────────────────────

function deleteCampaign(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id, status FROM campaigns WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Campaign ${id} not found`);

  const now = new Date().toISOString();
  db.prepare("UPDATE campaigns SET status='archived', archived_at=?, updated_at=? WHERE id=?")
    .run(now, now, id);
  logger.info('Campaign archived', { campaignId: id });
}

function unarchiveCampaign(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id, status FROM campaigns WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Campaign ${id} not found`);
  if (existing.status !== 'archived') throw new ValidationError('Campaign is not archived');

  const now = new Date().toISOString();
  db.prepare("UPDATE campaigns SET status='draft', archived_at=NULL, updated_at=? WHERE id=?")
    .run(now, id);
  logger.info('Campaign unarchived', { campaignId: id });
  return getCampaign(id);
}

// ── CLONE ─────────────────────────────────────────────────────────────────

function cloneCampaign(id, userId, { newName } = {}) {
  const db = getDb();
  const original = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!original) throw new NotFoundError(`Campaign ${id} not found`);

  const newId = uuidv4();
  const now = new Date().toISOString();
  const clonedName = newName || `${original.name} (Copy)`;
  const newSlug = clonedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + newId.slice(0, 8);

  db.prepare(`
    INSERT INTO campaigns (
      id, name, slug, status, description, objective, priority, channel_type,
      icp_config, sender_config, schedule_config, auto_send_policy, compliance_config,
      daily_limit, max_daily_sends, max_hourly_sends,
      timezone, start_at, end_at,
      allow_manual_runs, require_preflight, review_mode,
      schedule_mode, sender_profile_id, reply_to_email,
      sequence_id, tags, notes,
      owner_user_id, created_by,
      preflight_status, preflight_score,
      created_at, updated_at
    ) VALUES (
      ?,?,?,'draft',?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,
      ?,NULL,NULL,
      ?,?,?,
      'manual',?,?,
      ?,?,?,
      ?,?,
      'unchecked',0,
      ?,?
    )
  `).run(
    newId, clonedName, newSlug,
    original.description, original.objective, original.priority, original.channel_type,
    original.icp_config, original.sender_config, original.schedule_config,
    original.auto_send_policy, original.compliance_config,
    original.daily_limit, original.max_daily_sends || original.daily_limit,
    original.max_hourly_sends || 5,
    original.timezone || 'America/Chicago',
    original.allow_manual_runs !== undefined ? original.allow_manual_runs : 1,
    original.require_preflight !== undefined ? original.require_preflight : 1,
    original.review_mode || 'manual',
    original.sender_profile_id, original.reply_to_email,
    original.sequence_id,
    original.tags || '[]', original.notes,
    userId || null, userId || null,
    now, now,
  );

  logger.info('Campaign cloned', { originalId: id, newId, userId });
  return getCampaign(newId);
}

// ── STATUS TRANSITIONS ────────────────────────────────────────────────────

function activateCampaign(id, _userId) {
  const campaign = getCampaignRaw(id);
  if (campaign.require_preflight && campaign.preflight_status !== 'pass') {
    throw new ValidationError(
      'Campaign must pass preflight validation before activation. Run /validate first.',
      'preflight'
    );
  }
  return updateCampaign(id, { status: 'active' });
}

function pauseCampaign(id) {
  return updateCampaign(id, { status: 'paused' });
}

function resumeCampaign(id) {
  const campaign = getCampaignRaw(id);
  const newStatus = campaign.scheduled_at ? 'scheduled' : 'active';
  return updateCampaign(id, { status: newStatus });
}

function scheduleCampaign(id, { scheduled_at, schedule_mode, timezone } = {}) {
  if (!scheduled_at) throw new ValidationError('scheduled_at is required', 'scheduled_at');
  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime())) throw new ValidationError('scheduled_at must be a valid ISO datetime', 'scheduled_at');
  if (scheduledDate < new Date()) throw new ValidationError('scheduled_at must be in the future', 'scheduled_at');

  return updateCampaign(id, {
    status: 'scheduled',
    scheduled_at,
    schedule_mode: schedule_mode || 'once',
    timezone: timezone || undefined,
  });
}

function unscheduleCampaign(id) {
  return updateCampaign(id, {
    status: 'ready',
    scheduled_at: null,
    schedule_mode: 'manual',
    next_run_at: null,
  });
}

// ── CAMPAIGN RUNS ─────────────────────────────────────────────────────────

function createRun(campaignId, { runType = 'manual', stage = 'all', triggeredBy, triggeredByEmail, notes, idempotencyKey } = {}) {
  const db = getDb();
  const campaign = db.prepare('SELECT id, status, allow_manual_runs FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new NotFoundError(`Campaign ${campaignId} not found`);

  if (runType === 'manual' && !campaign.allow_manual_runs) {
    throw new ValidationError('Manual runs are disabled for this campaign');
  }

  if (idempotencyKey) {
    const existing = db.prepare('SELECT id FROM campaign_runs WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) return getRun(existing.id);
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO campaign_runs (
      id, campaign_id, run_type, triggered_by, triggered_by_email,
      stage, status, idempotency_key, notes, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, campaignId, runType, triggeredBy || null, triggeredByEmail || null,
    stage, 'pending', idempotencyKey || null, notes || null, now);

  logger.info('Campaign run created', { runId: id, campaignId, runType, stage });
  return getRun(id);
}

function getRun(runId) {
  const db = getDb();
  const run = db.prepare('SELECT * FROM campaign_runs WHERE id = ?').get(runId);
  if (!run) throw new NotFoundError(`Run ${runId} not found`);
  const steps = db.prepare('SELECT * FROM campaign_run_steps WHERE run_id = ? ORDER BY id ASC').all(runId);
  return { ...run, steps };
}

function listRuns(campaignId, { limit = 20, status } = {}) {
  const db = getDb();
  const conditions = ['campaign_id = ?'];
  const params = [campaignId];
  if (status) { conditions.push('status = ?'); params.push(status); }

  const rows = db.prepare(`
    SELECT * FROM campaign_runs WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params, limit);

  return rows;
}

function updateRun(runId, data) {
  const db = getDb();
  const fields = ['status', 'started_at', 'finished_at', 'contacts_processed', 'contacts_skipped',
    'emails_queued', 'emails_sent', 'emails_failed', 'drafts_generated', 'error_message'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (data[f] !== undefined) { updates.push(`${f} = ?`); params.push(data[f]); }
  }
  if (updates.length === 0) return;
  params.push(runId);
  db.prepare(`UPDATE campaign_runs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

function logRunStep(runId, stepName, status, { itemsProcessed = 0, errorMessage } = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM campaign_run_steps WHERE run_id = ? AND step_name = ?').get(runId, stepName);
  if (existing) {
    db.prepare('UPDATE campaign_run_steps SET status=?, finished_at=?, items_processed=?, error_message=? WHERE id=?')
      .run(status, now, itemsProcessed, errorMessage || null, existing.id);
  } else {
    db.prepare('INSERT INTO campaign_run_steps (run_id, step_name, status, started_at, finished_at, items_processed, error_message) VALUES (?,?,?,?,?,?,?)')
      .run(runId, stepName, status, now, status !== 'running' ? now : null, itemsProcessed, errorMessage || null);
  }
}

// ── EXCLUSIONS ────────────────────────────────────────────────────────────

function addExclusion(campaignId, { email, domain, reason, addedBy }) {
  const db = getDb();
  if (!email && !domain) throw new ValidationError('email or domain is required');
  const id = uuidv4();
  db.prepare('INSERT INTO campaign_exclusions (id, campaign_id, email, domain, reason, added_by) VALUES (?,?,?,?,?,?)')
    .run(id, campaignId, email || null, domain || null, reason || 'manual', addedBy || null);
  return { id, campaign_id: campaignId, email, domain, reason };
}

function removeExclusion(exclusionId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM campaign_exclusions WHERE id = ?').run(exclusionId);
  if (result.changes === 0) throw new NotFoundError(`Exclusion ${exclusionId} not found`);
}

function listExclusions(campaignId) {
  const db = getDb();
  return db.prepare('SELECT * FROM campaign_exclusions WHERE campaign_id = ? ORDER BY created_at DESC').all(campaignId);
}

function isExcluded(campaignId, email) {
  const db = getDb();
  if (!email) return false;
  const domain = email.split('@')[1];
  const hit = db.prepare(`
    SELECT id FROM campaign_exclusions
    WHERE campaign_id = ? AND (email = ? OR domain = ?)
    LIMIT 1
  `).get(campaignId, email, domain);
  return !!hit;
}

// ── SEQUENCE HELPERS ──────────────────────────────────────────────────────

function getSequenceForCampaign(campaignId) {
  const db = getDb();
  const campaign = db.prepare('SELECT sequence_id FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new NotFoundError(`Campaign ${campaignId} not found`);

  if (campaign.sequence_id) {
    const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(campaign.sequence_id);
    if (seq) {
      const steps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC').all(seq.id);
      return { ...seq, steps };
    }
  }

  // Fall back to first active sequence for this campaign
  const seq = db.prepare("SELECT * FROM sequences WHERE campaign_id = ? AND status='active' ORDER BY created_at ASC LIMIT 1").get(campaignId);
  if (!seq) return null;
  const steps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC').all(seq.id);
  return { ...seq, steps };
}

// ── METRICS SNAPSHOT ──────────────────────────────────────────────────────

function takeMetricsSnapshot(campaignId) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const contacts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status IN('sent','delivered') THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status='opened' THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN status='clicked' THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) as bounced,
      SUM(CASE WHEN status='unsubscribed' THEN 1 ELSE 0 END) as unsubscribed,
      SUM(CASE WHEN status='suppressed' THEN 1 ELSE 0 END) as suppressed
    FROM contacts WHERE campaign_id = ?
  `).get(campaignId);

  const drafts = db.prepare(`
    SELECT
      SUM(CASE WHEN status='pending_review' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected
    FROM message_drafts WHERE campaign_id = ?
  `).get(campaignId);

  const jobsQueued = db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status='pending' AND payload LIKE ?")
    .get(`%${campaignId}%`).cnt;

  db.prepare(`
    INSERT INTO campaign_metrics_snapshots (
      campaign_id, snapshot_date,
      contacts_total, contacts_pending, contacts_sent, contacts_opened, contacts_clicked,
      contacts_replied, contacts_bounced, contacts_unsubscribed, contacts_suppressed,
      drafts_pending, drafts_approved, drafts_rejected, jobs_queued
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(campaign_id, snapshot_date) DO UPDATE SET
      contacts_total=excluded.contacts_total, contacts_pending=excluded.contacts_pending,
      contacts_sent=excluded.contacts_sent, contacts_opened=excluded.contacts_opened,
      contacts_clicked=excluded.contacts_clicked, contacts_replied=excluded.contacts_replied,
      contacts_bounced=excluded.contacts_bounced, contacts_unsubscribed=excluded.contacts_unsubscribed,
      contacts_suppressed=excluded.contacts_suppressed,
      drafts_pending=excluded.drafts_pending, drafts_approved=excluded.drafts_approved,
      drafts_rejected=excluded.drafts_rejected, jobs_queued=excluded.jobs_queued
  `).run(
    campaignId, today,
    contacts.total, contacts.pending, contacts.sent, contacts.opened, contacts.clicked,
    contacts.replied, contacts.bounced, contacts.unsubscribed, contacts.suppressed,
    drafts.pending, drafts.approved, drafts.rejected, jobsQueued,
  );
}

function getMetricsTrend(campaignId, days = 14) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM campaign_metrics_snapshots
    WHERE campaign_id = ?
    ORDER BY snapshot_date DESC LIMIT ?
  `).all(campaignId, days).reverse();
}

// ── HELPERS ───────────────────────────────────────────────────────────────

function getCampaignRaw(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Campaign ${id} not found`);
  return row;
}

module.exports = {
  createCampaign, getCampaign, getCampaignBySlug, listCampaigns,
  updateCampaign, deleteCampaign, unarchiveCampaign, cloneCampaign,
  activateCampaign, pauseCampaign, resumeCampaign,
  scheduleCampaign, unscheduleCampaign,
  createRun, getRun, listRuns, updateRun, logRunStep,
  addExclusion, removeExclusion, listExclusions, isExcluded,
  getSequenceForCampaign, takeMetricsSnapshot, getMetricsTrend,
  getCampaignRaw, parseCampaign, VALID_STATUSES, ALLOWED_TRANSITIONS,
};
