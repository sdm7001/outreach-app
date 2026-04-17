'use strict';

const express = require('express');
const router = express.Router();
const complianceService = require('../services/compliance.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, search } = req.query;
  res.json(await complianceService.listSuppression({ page: parseInt(page)||1, limit: parseInt(limit)||50, search }));
}));

router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const { email, domain, reason, source } = req.body;
  if (!email && !domain) {
    return res.status(400).json({ error: 'email or domain is required', code: 'VALIDATION_ERROR' });
  }

  let entry;
  if (email) {
    entry = await complianceService.addSuppression(email, reason, source, req.user.id);
  } else {
    entry = await complianceService.addDomainSuppression(domain, reason, source, req.user.id);
  }

  auditService.log('suppression.add', 'suppression', entry.id, req.user.id, req.user.email, null,
    { email, domain, reason }, req.ip);
  res.status(201).json(entry);
}));

router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  await complianceService.removeSuppression(req.params.id);
  auditService.log('suppression.remove', 'suppression', req.params.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Suppression entry removed' });
}));

router.post('/check', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required', code: 'VALIDATION_ERROR' });
  const suppressed = complianceService.isSuppress(email);
  res.json({ email, suppressed });
}));

module.exports = router;
