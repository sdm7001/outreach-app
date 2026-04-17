'use strict';

const express = require('express');
const router = express.Router();
const senderService = require('../services/sender.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

// GET /sender-profiles — list all profiles (visible to all authenticated users)
router.get('/', asyncHandler(async (req, res) => {
  const { active_only } = req.query;
  const profiles = senderService.listSenderProfiles({
    activeOnly: active_only === 'true',
  });
  res.json({ data: profiles, count: profiles.length });
}));

// POST /sender-profiles — create profile (operator+)
router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const profile = senderService.createSenderProfile(req.body, req.user.id);
  auditService.log('sender_profile.create', 'sender_profile', profile.id,
    req.user.id, req.user.email, null, { from_email: profile.from_email }, req.ip);
  res.status(201).json(profile);
}));

// GET /sender-profiles/:id — get single profile
router.get('/:id', asyncHandler(async (req, res) => {
  const profile = senderService.getSenderProfile(req.params.id);
  res.json(profile);
}));

// PUT /sender-profiles/:id — update (operator+)
router.put('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const profile = senderService.updateSenderProfile(req.params.id, req.body);
  auditService.log('sender_profile.update', 'sender_profile', profile.id,
    req.user.id, req.user.email, null, req.body, req.ip);
  res.json(profile);
}));

// DELETE /sender-profiles/:id — delete (operator+)
router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  senderService.deleteSenderProfile(req.params.id);
  auditService.log('sender_profile.delete', 'sender_profile', req.params.id,
    req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Sender profile deleted' });
}));

// POST /sender-profiles/:id/verify — trigger domain verification
router.post('/:id/verify', requireRole('operator'), asyncHandler(async (req, res) => {
  const result = await senderService.verifySenderDomain(req.params.id);
  auditService.log('sender_profile.verify', 'sender_profile', req.params.id,
    req.user.id, req.user.email, null, result, req.ip);
  res.json(result);
}));

module.exports = router;
