'use strict';

const express = require('express');
const router = express.Router();
const campaignService = require('../services/campaign.service');
const campaignValidator = require('../services/campaign.validator');
const campaignRunner = require('../services/campaign.runner');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');
const analyticsService = require('../services/analytics.service');
const { initializeNextRun } = require('../workers/campaign.scheduler');

router.use(requireAuth);

// ── LIST / CREATE ──────────────────────────────────────────────────────────

// GET /campaigns
router.get('/', asyncHandler(async (req, res) => {
  const { status, page, limit, search, priority, owner_user_id, schedule_mode } = req.query;
  const result = campaignService.listCampaigns({
    status, search, priority, owner_user_id, schedule_mode,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json(result);
}));

// POST /campaigns
router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = campaignService.createCampaign(req.body, req.user.id);
  auditService.log('campaign.create', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { name: campaign.name, status: campaign.status }, req.ip);
  res.status(201).json(campaign);
}));

// ── SINGLE CAMPAIGN ────────────────────────────────────────────────────────

// GET /campaigns/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const campaign = campaignService.getCampaign(req.params.id);
  res.json(campaign);
}));

// PUT /campaigns/:id
router.put('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const before = campaignService.getCampaignRaw(req.params.id);
  const campaign = campaignService.updateCampaign(req.params.id, req.body);
  auditService.log('campaign.update', 'campaign', campaign.id, req.user.id, req.user.email,
    { status: before.status }, { status: campaign.status, ...req.body }, req.ip);
  res.json(campaign);
}));

// DELETE /campaigns/:id — archive
router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  campaignService.deleteCampaign(req.params.id);
  auditService.log('campaign.archive', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { status: 'archived' }, req.ip);
  res.json({ message: 'Campaign archived' });
}));

// ── LIFECYCLE TRANSITIONS ─────────────────────────────────────────────────

// POST /campaigns/:id/activate
router.post('/:id/activate', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = campaignService.activateCampaign(req.params.id, req.user.id);
  auditService.log('campaign.activate', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { status: campaign.status }, req.ip);
  res.json(campaign);
}));

// POST /campaigns/:id/pause
router.post('/:id/pause', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = campaignService.pauseCampaign(req.params.id);
  auditService.log('campaign.pause', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { status: 'paused' }, req.ip);
  res.json(campaign);
}));

// POST /campaigns/:id/resume
router.post('/:id/resume', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = campaignService.resumeCampaign(req.params.id);
  auditService.log('campaign.resume', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { status: campaign.status }, req.ip);
  res.json(campaign);
}));

// POST /campaigns/:id/schedule
router.post('/:id/schedule', requireRole('operator'), asyncHandler(async (req, res) => {
  const { scheduled_at, schedule_mode, timezone } = req.body;
  const campaign = campaignService.scheduleCampaign(req.params.id, { scheduled_at, schedule_mode, timezone });
  // Seed next_run_at so the scheduler worker picks it up on next tick
  initializeNextRun(req.params.id);
  auditService.log('campaign.schedule', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { scheduled_at, schedule_mode }, req.ip);
  res.json(campaign);
}));

// POST /campaigns/:id/unschedule
router.post('/:id/unschedule', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = campaignService.unscheduleCampaign(req.params.id);
  auditService.log('campaign.unschedule', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { status: campaign.status }, req.ip);
  res.json(campaign);
}));

// POST /campaigns/:id/unarchive
router.post('/:id/unarchive', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = campaignService.unarchiveCampaign(req.params.id);
  auditService.log('campaign.unarchive', 'campaign', campaign.id, req.user.id, req.user.email,
    null, { status: 'draft' }, req.ip);
  res.json(campaign);
}));

// ── CLONE / TEMPLATE ──────────────────────────────────────────────────────

// POST /campaigns/:id/clone
router.post('/:id/clone', requireRole('operator'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  const campaign = campaignService.cloneCampaign(req.params.id, req.user.id, { newName: name });
  auditService.log('campaign.clone', 'campaign', campaign.id, req.user.id, req.user.email,
    { source_id: req.params.id }, { name: campaign.name }, req.ip);
  res.status(201).json(campaign);
}));

// ── PREFLIGHT VALIDATION ──────────────────────────────────────────────────

// POST /campaigns/:id/validate
router.post('/:id/validate', requireRole('operator'), asyncHandler(async (req, res) => {
  const result = await campaignValidator.validateCampaign(req.params.id);
  auditService.log('campaign.validate', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { status: result.status, score: result.score, blocking: result.blocking_count }, req.ip);
  res.json(result);
}));

// GET /campaigns/:id/preflight
router.get('/:id/preflight', asyncHandler(async (req, res) => {
  const result = campaignValidator.getLatestPreflight(req.params.id);
  res.json(result || { status: 'unchecked', score: 0, results: [] });
}));

// ── RUN CONTROLS ──────────────────────────────────────────────────────────

// POST /campaigns/:id/run
router.post('/:id/run', requireRole('operator'), asyncHandler(async (req, res) => {
  const { dry_run, notes } = req.body;
  const run = await campaignRunner.runCampaign(req.params.id, {
    triggeredBy: req.user.id,
    triggeredByEmail: req.user.email,
    runType: 'manual',
    dryRun: !!dry_run,
    notes,
  });
  auditService.log('campaign.run', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { run_id: run.id, dry_run: !!dry_run }, req.ip);
  res.status(202).json(run);
}));

// POST /campaigns/:id/run/stage
router.post('/:id/run/stage', requireRole('operator'), asyncHandler(async (req, res) => {
  const { stage, dry_run, limit } = req.body;
  if (!stage) return res.status(400).json({ error: 'stage is required', code: 'VALIDATION_ERROR' });

  const run = await campaignRunner.runStage(req.params.id, stage, {
    triggeredBy: req.user.id,
    triggeredByEmail: req.user.email,
    dryRun: !!dry_run,
    limit: parseInt(limit) || undefined,
  });
  auditService.log('campaign.run.stage', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { stage, run_id: run.id, dry_run: !!dry_run }, req.ip);
  res.status(202).json(run);
}));

// POST /campaigns/:id/dry-run
router.post('/:id/dry-run', requireRole('operator'), asyncHandler(async (req, res) => {
  const run = await campaignRunner.dryRunCampaign(req.params.id, {
    triggeredBy: req.user.id,
    triggeredByEmail: req.user.email,
  });
  res.status(202).json(run);
}));

// POST /campaigns/:id/test-send
router.post('/:id/test-send', requireRole('operator'), asyncHandler(async (req, res) => {
  const { recipients } = req.body;
  const run = await campaignRunner.testSendCampaign(req.params.id, {
    triggeredBy: req.user.id,
    triggeredByEmail: req.user.email,
    testRecipients: recipients,
  });
  auditService.log('campaign.test_send', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { recipients, run_id: run.id }, req.ip);
  res.status(202).json(run);
}));

// POST /campaigns/:id/approve-all-drafts
router.post('/:id/approve-all-drafts', requireRole('operator'), asyncHandler(async (req, res) => {
  const { spam_threshold } = req.body;
  const count = campaignRunner.approveAllSafeDrafts(req.params.id, {
    spamThreshold: spam_threshold || 5,
    approvedBy: req.user.id,
  });
  auditService.log('campaign.bulk_approve_drafts', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { count, spam_threshold }, req.ip);
  res.json({ message: `${count} draft(s) approved and queued for sending`, count });
}));

// POST /campaigns/:id/requeue-failed
router.post('/:id/requeue-failed', requireRole('operator'), asyncHandler(async (req, res) => {
  const count = await campaignRunner.requeueFailedJobs(req.params.id, null);
  auditService.log('campaign.requeue_failed', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { count }, req.ip);
  res.json({ message: `${count} failed job(s) requeued`, count });
}));

// ── PREVIEW ───────────────────────────────────────────────────────────────

// GET /campaigns/:id/preview/recipients
router.get('/:id/preview/recipients', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const recipients = campaignRunner.previewRecipients(req.params.id, { limit });
  res.json({ data: recipients, count: recipients.length });
}));

// GET /campaigns/:id/preview/drafts
router.get('/:id/preview/drafts', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  const drafts = campaignRunner.previewDrafts(req.params.id, { limit });
  res.json({ data: drafts, count: drafts.length });
}));

// ── RUNS ──────────────────────────────────────────────────────────────────

// GET /campaigns/:id/runs
router.get('/:id/runs', asyncHandler(async (req, res) => {
  const { limit, status } = req.query;
  const runs = campaignService.listRuns(req.params.id, {
    limit: Math.min(parseInt(limit) || 20, 100),
    status,
  });
  res.json({ data: runs, count: runs.length });
}));

// GET /campaigns/:id/runs/:runId
router.get('/:id/runs/:runId', asyncHandler(async (req, res) => {
  const run = campaignService.getRun(req.params.runId);
  if (run.campaign_id !== req.params.id) {
    return res.status(404).json({ error: 'Run not found for this campaign', code: 'NOT_FOUND' });
  }
  res.json(run);
}));

// POST /campaigns/:id/runs/:runId/cancel
router.post('/:id/runs/:runId/cancel', requireRole('operator'), asyncHandler(async (req, res) => {
  const run = campaignService.getRun(req.params.runId);
  if (run.campaign_id !== req.params.id) {
    return res.status(404).json({ error: 'Run not found for this campaign', code: 'NOT_FOUND' });
  }
  campaignService.updateRun(req.params.runId, { status: 'cancelled', finished_at: new Date().toISOString() });
  res.json({ message: 'Run cancelled' });
}));

// POST /campaigns/:id/runs/:runId/retry
router.post('/:id/runs/:runId/retry', requireRole('operator'), asyncHandler(async (req, res) => {
  const existing = campaignService.getRun(req.params.runId);
  if (existing.campaign_id !== req.params.id) {
    return res.status(404).json({ error: 'Run not found for this campaign', code: 'NOT_FOUND' });
  }
  const newRun = await campaignRunner.retryRun(req.params.runId, {
    triggeredBy: req.user.id,
    triggeredByEmail: req.user.email,
  });
  auditService.log('campaign.run.retry', 'campaign', req.params.id, req.user.id, req.user.email,
    { original_run_id: req.params.runId }, { new_run_id: newRun.id }, req.ip);
  res.status(202).json(newRun);
}));

// ── ANALYTICS ─────────────────────────────────────────────────────────────

// GET /campaigns/:id/analytics
router.get('/:id/analytics', asyncHandler(async (req, res) => {
  const { start_date, end_date } = req.query;
  const [stats, sequence, trend] = await Promise.all([
    analyticsService.getCampaignStats(req.params.id, { startDate: start_date, endDate: end_date }),
    Promise.resolve().then(() => analyticsService.getSequenceStepStats(req.params.id)).catch(() => []),
    campaignService.getMetricsTrend(req.params.id, 14),
  ]);
  res.json({ ...stats, sequence_funnel: sequence, trend });
}));

// POST /campaigns/:id/analytics/snapshot
router.post('/:id/analytics/snapshot', requireRole('operator'), asyncHandler(async (req, res) => {
  campaignService.takeMetricsSnapshot(req.params.id);
  res.json({ message: 'Metrics snapshot taken' });
}));

// GET /campaigns/:id/analytics/trend
router.get('/:id/analytics/trend', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 90);
  const trend = campaignService.getMetricsTrend(req.params.id, days);
  res.json({ data: trend });
}));

// ── EXCLUSIONS ────────────────────────────────────────────────────────────

// GET /campaigns/:id/exclusions
router.get('/:id/exclusions', asyncHandler(async (req, res) => {
  const exclusions = campaignService.listExclusions(req.params.id);
  res.json({ data: exclusions });
}));

// POST /campaigns/:id/exclusions
router.post('/:id/exclusions', requireRole('operator'), asyncHandler(async (req, res) => {
  const { email, domain, reason } = req.body;
  const exclusion = campaignService.addExclusion(req.params.id, {
    email, domain, reason, addedBy: req.user.id,
  });
  auditService.log('campaign.exclusion.add', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { email, domain, reason }, req.ip);
  res.status(201).json(exclusion);
}));

// DELETE /campaigns/:id/exclusions/:exclusionId
router.delete('/:id/exclusions/:exclusionId', requireRole('operator'), asyncHandler(async (req, res) => {
  campaignService.removeExclusion(req.params.exclusionId);
  auditService.log('campaign.exclusion.remove', 'campaign', req.params.id, req.user.id, req.user.email,
    null, { exclusion_id: req.params.exclusionId }, req.ip);
  res.json({ message: 'Exclusion removed' });
}));

// ── SEQUENCE HELPERS ──────────────────────────────────────────────────────

// GET /campaigns/:id/sequence
router.get('/:id/sequence', asyncHandler(async (req, res) => {
  const sequence = campaignService.getSequenceForCampaign(req.params.id);
  res.json(sequence || null);
}));

// ── READINESS ─────────────────────────────────────────────────────────────

// GET /campaigns/:id/readiness
router.get('/:id/readiness', asyncHandler(async (req, res) => {
  const db = require('../db').getDb();
  const draftService = require('../services/draft.service');
  const campaignId = req.params.id;

  campaignService.getCampaignRaw(campaignId);

  const contactCount = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE campaign_id = ?').get(campaignId).cnt;
  const draftStats = draftService.getDraftStats(campaignId);

  const reasons = [];
  if (contactCount === 0) reasons.push('No contacts assigned to this campaign');
  if (draftStats.total === 0) reasons.push('No drafts have been generated');
  if (draftStats.pending_review > 0) reasons.push(`${draftStats.pending_review} draft(s) still pending review`);
  if (draftStats.total > 0 && draftStats.approved === 0) reasons.push('No drafts have been approved');

  const can_run = reasons.length === 0;

  res.json({ can_run, reasons, draft_stats: draftStats, contact_count: contactCount });
}));

module.exports = router;
