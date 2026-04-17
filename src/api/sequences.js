'use strict';

const express = require('express');
const router = express.Router();
const sequenceService = require('../services/sequence.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { campaign_id } = req.query;
  if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required', code: 'VALIDATION_ERROR' });
  res.json(await sequenceService.listSequences(campaign_id));
}));

router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const sequence = await sequenceService.createSequence(req.body);
  auditService.log('sequence.create', 'sequence', sequence.id, req.user.id, req.user.email, null, { name: sequence.name }, req.ip);
  res.status(201).json(sequence);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await sequenceService.getSequence(req.params.id));
}));

router.put('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const sequence = await sequenceService.updateSequence(req.params.id, req.body);
  auditService.log('sequence.update', 'sequence', sequence.id, req.user.id, req.user.email, null, req.body, req.ip);
  res.json(sequence);
}));

router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  await sequenceService.deleteSequence(req.params.id);
  auditService.log('sequence.delete', 'sequence', req.params.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Sequence deleted' });
}));

module.exports = router;
