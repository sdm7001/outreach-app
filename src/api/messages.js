'use strict';

const express = require('express');
const router = express.Router();
const messageService = require('../services/message.service');
const { enqueue } = require('../workers/queue');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

// GET /messages/drafts
router.get('/drafts', asyncHandler(async (req, res) => {
  const { status, campaign_id, page, limit } = req.query;
  res.json(await messageService.listDrafts({
    status,
    campaign_id,
    page: parseInt(page)||1,
    limit: parseInt(limit)||20,
  }));
}));

// GET /messages/drafts/:id
router.get('/drafts/:id', asyncHandler(async (req, res) => {
  res.json(await messageService.getDraft(req.params.id));
}));

// POST /messages/drafts/:id/approve
router.post('/drafts/:id/approve', requireRole('operator'), asyncHandler(async (req, res) => {
  const draft = await messageService.approveDraft(req.params.id, req.user.id);

  // Enqueue send job
  enqueue('send_email', {
    draftId: draft.id,
    contactId: draft.contact_id,
    campaignId: draft.campaign_id,
  }, {
    idempotencyKey: `send:${draft.id}`,
  });

  auditService.log('draft.approve', 'message_draft', draft.id, req.user.id, req.user.email, { status: 'pending_review' }, { status: 'approved' }, req.ip);
  res.json(draft);
}));

// POST /messages/drafts/:id/reject
router.post('/drafts/:id/reject', requireRole('operator'), asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const draft = await messageService.rejectDraft(req.params.id, req.user.id, reason);
  auditService.log('draft.reject', 'message_draft', draft.id, req.user.id, req.user.email,
    { status: 'pending_review' }, { status: 'rejected', reason }, req.ip);
  res.json(draft);
}));

// POST /messages/generate — manually trigger generation
router.post('/generate', requireRole('operator'), asyncHandler(async (req, res) => {
  const { contactId, campaignId, stepId, promptVersion } = req.body;
  if (!contactId) return res.status(400).json({ error: 'contactId is required', code: 'VALIDATION_ERROR' });

  const draft = await messageService.generateDraft(contactId, campaignId, stepId, promptVersion);
  auditService.log('draft.generate', 'message_draft', draft.id, req.user.id, req.user.email, null, { contactId, campaignId }, req.ip);
  res.status(201).json(draft);
}));

module.exports = router;
