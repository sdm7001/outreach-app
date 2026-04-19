'use strict';

const express = require('express');
const router = express.Router();
const { auditWebsite, getAudit } = require('../services/website-audit.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler, ValidationError } = require('../utils/errors');
const { getDb } = require('../db');

router.use(requireAuth);

// POST /api/v1/website-audits — trigger audit for a domain
router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const { domain, companyName, industry, contactId, prospectId } = req.body;
  if (!domain) throw new ValidationError('domain is required');

  const audit = await auditWebsite({ domain, companyName, industry, contactId, prospectId });
  res.json(audit);
}));

// GET /api/v1/website-audits/:id — get audit by id
router.get('/:id', asyncHandler(async (req, res) => {
  const audit = getAudit(req.params.id);
  if (!audit) return res.status(404).json({ error: 'Audit not found' });
  res.json(audit);
}));

// GET /api/v1/website-audits/domain/:domain — latest audit for a domain
router.get('/domain/:domain', asyncHandler(async (req, res) => {
  const db = getDb();
  const domain = decodeURIComponent(req.params.domain).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const audit = db.prepare(`
    SELECT * FROM website_audits WHERE domain = ? ORDER BY created_at DESC LIMIT 1
  `).get(domain);
  if (!audit) return res.status(404).json({ error: 'No audit found for domain' });
  res.json(audit);
}));

module.exports = router;
