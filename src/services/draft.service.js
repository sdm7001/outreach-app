'use strict';

const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

// Simple spam word list for heuristic scoring
const SPAM_WORDS = [
  'free', 'guarantee', 'winner', 'cash', 'prize', 'urgent', 'act now',
  'click here', 'limited time', 'no risk', '100%', 'make money', 'earn money',
  'buy now', 'order now', "don't delete", 'you have been selected',
];

function computeSpamScore(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase();
  let score = 0;
  for (const word of SPAM_WORDS) {
    if (text.includes(word)) score += 1;
  }
  const capsWords = (text.match(/\b[A-Z]{4,}\b/g) || []).length;
  score += capsWords;
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations > 3) score += 1;
  return Math.min(score, 10);
}

// ── READ ──────────────────────────────────────────────────────────────────

function getDraft(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT md.*, c.first_name, c.last_name, c.email as contact_email, c.title as contact_title
    FROM message_drafts md
    LEFT JOIN contacts c ON c.id = md.contact_id
    WHERE md.id = ?
  `).get(id);
  if (!row) throw new NotFoundError(`Draft ${id} not found`);
  return row;
}

function listDrafts(campaignId, { status, page = 1, limit = 20 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = ['md.campaign_id = ?'];
  const params = [campaignId];

  if (status && status !== 'all') {
    conditions.push('md.status = ?');
    params.push(status);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM message_drafts md ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT md.*, c.first_name, c.last_name, c.email as contact_email, c.title as contact_title
    FROM message_drafts md
    LEFT JOIN contacts c ON c.id = md.contact_id
    ${where}
    ORDER BY md.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { data: rows, total, page, limit };
}

function getDraftStats(campaignId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending_review,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM message_drafts
    WHERE campaign_id = ?
  `).get(campaignId);
  return {
    total: row.total || 0,
    pending_review: row.pending_review || 0,
    approved: row.approved || 0,
    rejected: row.rejected || 0,
  };
}

// ── GENERATE ──────────────────────────────────────────────────────────────

/**
 * Enqueue draft generation jobs for contacts in a campaign.
 * Uses the existing 'run_sequence_step' job type that the queue worker already handles.
 */
async function generateDraftsForCampaign(campaignId, { contactIds, triggeredBy } = {}) {
  const db = getDb();
  const { enqueue } = require('../workers/queue');

  let contacts;
  if (contactIds && contactIds.length) {
    const placeholders = contactIds.map(() => '?').join(',');
    contacts = db.prepare(`SELECT * FROM contacts WHERE id IN (${placeholders}) AND campaign_id = ?`)
      .all(...contactIds, campaignId);
  } else {
    contacts = db.prepare("SELECT * FROM contacts WHERE campaign_id = ? AND status = 'pending'").all(campaignId);
  }

  if (!contacts.length) return 0;

  // Get the first sequence step for this campaign (if any)
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  let stepId = null;
  if (campaign && campaign.sequence_id) {
    const step = db.prepare('SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number LIMIT 1')
      .get(campaign.sequence_id);
    stepId = step ? step.id : null;
  }

  let count = 0;
  for (const contact of contacts) {
    try {
      await enqueue('run_sequence_step', {
        contactId: contact.id,
        campaignId,
        stepId,
        triggeredBy: triggeredBy || null,
      }, { idempotencyKey: `draft:${contact.id}:${campaignId}` });
      count++;
    } catch (_) { /* ignore duplicate jobs */ }
  }

  logger.info('Draft generation enqueued', { campaignId, count });
  return count;
}

// ── REVIEW ────────────────────────────────────────────────────────────────

function approveDraft(id, userId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Draft ${id} not found`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE message_drafts SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?
  `).run(userId || null, now, id);

  logger.info('Draft approved', { id, userId });
  return getDraft(id);
}

function rejectDraft(id, userId, reason) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Draft ${id} not found`);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE message_drafts SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ? WHERE id = ?
  `).run(userId || null, now, reason || null, id);

  logger.info('Draft rejected', { id, userId, reason });
  return getDraft(id);
}

function editDraft(id, { subject, body }, userId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Draft ${id} not found`);

  if (subject === undefined && body === undefined) {
    throw new ValidationError('At least one of subject or body must be provided');
  }

  const newSubject = subject !== undefined ? subject : existing.subject;
  const newBody = body !== undefined ? body : existing.body;
  const spamScore = computeSpamScore(newSubject, newBody);
  const now = new Date().toISOString();

  // Editing an approved draft resets it to pending_review — content changed, must re-approve
  const newStatus = existing.status === 'approved' ? 'pending_review' : existing.status;

  db.prepare(`
    UPDATE message_drafts
    SET subject = ?, body = ?, spam_score = ?, status = ?, reviewed_by = ?, reviewed_at = ?
    WHERE id = ?
  `).run(newSubject, newBody, spamScore, newStatus, userId || null, now, id);

  return getDraft(id);
}

async function regenerateDraft(id, userId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Draft ${id} not found`);

  const { enqueue } = require('../workers/queue');

  db.prepare("UPDATE message_drafts SET status = 'pending_review' WHERE id = ?").run(id);

  try {
    await enqueue('run_sequence_step', {
      contactId: existing.contact_id,
      campaignId: existing.campaign_id,
      stepId: existing.sequence_step_id,
      triggeredBy: userId || null,
      regenerate: true,
    }, { idempotencyKey: `regen:${id}:${Date.now()}` });
  } catch (_) { /* ignore */ }

  logger.info('Draft regeneration queued', { id, userId });
  return getDraft(id);
}

function bulkApproveSafe(campaignId, { spamThreshold = 5, userId } = {}) {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db.prepare(`
    UPDATE message_drafts
    SET status = 'approved', reviewed_by = ?, reviewed_at = ?
    WHERE campaign_id = ? AND status = 'pending_review' AND spam_score <= ?
  `).run(userId || null, now, campaignId, spamThreshold);

  logger.info('Bulk approve safe', { campaignId, count: result.changes, spamThreshold });
  return result.changes;
}

module.exports = {
  getDraft,
  listDrafts,
  getDraftStats,
  generateDraftsForCampaign,
  approveDraft,
  rejectDraft,
  editDraft,
  regenerateDraft,
  bulkApproveSafe,
  computeSpamScore,
};
