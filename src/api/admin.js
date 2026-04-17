'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const { getDb } = require('../db');
const { getStats, enqueue } = require('../workers/queue');
const { getConfig } = require('../config');
const logger = require('../utils/logger');

router.use(requireAuth);
router.use(requireRole('admin'));

// GET /admin/system — system health and stats
router.get('/system', asyncHandler(async (req, res) => {
  const db = getDb();
  const config = getConfig();
  const queueStats = getStats();

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE active = 1').get().c;
  const campaignCount = db.prepare('SELECT COUNT(*) as c FROM campaigns WHERE status != \'archived\'').get().c;
  const contactCount = db.prepare('SELECT COUNT(*) as c FROM contacts').get().c;
  const pendingDrafts = db.prepare('SELECT COUNT(*) as c FROM message_drafts WHERE status = \'pending_review\'').get().c;

  res.json({
    uptime: process.uptime(),
    node_version: process.version,
    env: config.NODE_ENV,
    review_mode: config.REVIEW_MODE,
    queue: queueStats,
    counts: { users: userCount, campaigns: campaignCount, contacts: contactCount, pending_drafts: pendingDrafts },
    features: {
      ai: !!config.ANTHROPIC_API_KEY,
      smtp: !!config.SMTP_USER,
      apollo: !!config.APOLLO_API_KEY,
      hunter: !!config.HUNTER_API_KEY,
      google_places: !!config.GOOGLE_PLACES_API_KEY,
      telegram: !!config.TG_BOT_TOKEN,
    },
  });
}));

// GET /admin/jobs — list jobs with filters
router.get('/jobs', asyncHandler(async (req, res) => {
  const db = getDb();
  const { status, type, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = [];
  const params = [];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (type) { conditions.push('type = ?'); params.push(type); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as c FROM jobs ${where}`).get(...params).c;
  const jobs = db.prepare(`
    SELECT id, type, status, attempts, max_attempts, scheduled_at, started_at, completed_at, failed_at, error_message, created_at
    FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  res.json({ data: jobs, total, page: parseInt(page), limit: parseInt(limit) });
}));

// POST /admin/jobs/:id/retry — retry a failed/dead job
router.post('/jobs/:id/retry', asyncHandler(async (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });

  db.prepare(`UPDATE jobs SET status = 'pending', attempts = 0, error_message = NULL, scheduled_at = ?, failed_at = NULL WHERE id = ?`)
    .run(new Date().toISOString(), job.id);

  logger.info('Job retried by admin', { jobId: job.id, adminId: req.user.id });
  res.json({ message: 'Job queued for retry', id: job.id });
}));

// DELETE /admin/jobs/:id — delete a dead/failed job
router.delete('/jobs/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found', code: 'NOT_FOUND' });

  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  logger.info('Job deleted by admin', { jobId: req.params.id, adminId: req.user.id });
  res.json({ message: 'Job deleted' });
}));

// POST /admin/pipeline/run — manually trigger a pipeline tick
router.post('/pipeline/run', asyncHandler(async (req, res) => {
  const { campaignId, contactId } = req.body;

  if (contactId && campaignId) {
    const id = enqueue('run_sequence_step', { contactId, campaignId }, {
      idempotencyKey: null,
    });
    logger.info('Manual pipeline run triggered', { contactId, campaignId, adminId: req.user.id });
    return res.json({ message: 'Sequence step job enqueued', jobId: id });
  }

  res.json({ message: 'No action taken — provide contactId and campaignId to trigger a specific contact' });
}));

module.exports = router;
