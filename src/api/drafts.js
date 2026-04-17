'use strict';

const express = require('express');
const router = express.Router();
const draftService = require('../services/draft.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');

router.use(requireAuth);

// ── CAMPAIGN-SCOPED ───────────────────────────────────────────────────────

// GET /drafts/campaign/:campaignId — list drafts for a campaign
router.get('/campaign/:campaignId', asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const result = draftService.listDrafts(req.params.campaignId, {
    status,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json(result);
}));

// GET /drafts/campaign/:campaignId/stats — draft statistics
router.get('/campaign/:campaignId/stats', asyncHandler(async (req, res) => {
  const stats = draftService.getDraftStats(req.params.campaignId);
  res.json(stats);
}));

// POST /drafts/campaign/:campaignId/generate — trigger AI draft generation
router.post('/campaign/:campaignId/generate', requireRole('operator'), asyncHandler(async (req, res) => {
  const { contactIds } = req.body;
  const count = await draftService.generateDraftsForCampaign(req.params.campaignId, {
    contactIds: contactIds || null,
    triggeredBy: req.user.id,
  });
  res.json({ enqueued: count });
}));

// POST /drafts/campaign/:campaignId/approve-all — bulk approve safe drafts
router.post('/campaign/:campaignId/approve-all', requireRole('operator'), asyncHandler(async (req, res) => {
  const { spamThreshold } = req.body;
  const count = draftService.bulkApproveSafe(req.params.campaignId, {
    spamThreshold: spamThreshold !== undefined ? Number(spamThreshold) : 5,
    userId: req.user.id,
  });
  res.json({ approved: count });
}));

// ── SINGLE DRAFT ──────────────────────────────────────────────────────────

// GET /drafts/:id — get single draft
router.get('/:id', asyncHandler(async (req, res) => {
  const draft = draftService.getDraft(req.params.id);
  res.json(draft);
}));

// PATCH /drafts/:id — edit subject/body
router.patch('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const { subject, body } = req.body;
  const draft = draftService.editDraft(req.params.id, { subject, body }, req.user.id);
  res.json(draft);
}));

// POST /drafts/:id/approve — approve a draft
router.post('/:id/approve', requireRole('operator'), asyncHandler(async (req, res) => {
  const draft = draftService.approveDraft(req.params.id, req.user.id);
  res.json(draft);
}));

// POST /drafts/:id/reject — reject a draft
router.post('/:id/reject', requireRole('operator'), asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  const draft = draftService.rejectDraft(req.params.id, req.user.id, reason);
  res.json(draft);
}));

// POST /drafts/:id/regenerate — re-queue generation
router.post('/:id/regenerate', requireRole('operator'), asyncHandler(async (req, res) => {
  const draft = await draftService.regenerateDraft(req.params.id, req.user.id);
  res.json(draft);
}));

module.exports = router;
