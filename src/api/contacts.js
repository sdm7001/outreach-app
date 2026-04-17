'use strict';

const express = require('express');
const router = express.Router();
const contactService = require('../services/contact.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { campaign_id, account_id, status, lifecycle_state, search, page, limit } = req.query;
  res.json(await contactService.listContacts({
    campaign_id, account_id, status, lifecycle_state, search,
    page: parseInt(page)||1, limit: parseInt(limit)||20,
  }));
}));

router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const contact = await contactService.createContact(req.body);
  auditService.log('contact.create', 'contact', contact.id, req.user.id, req.user.email, null, { email: contact.email }, req.ip);
  res.status(201).json(contact);
}));

router.post('/bulk-import', requireRole('operator'), asyncHandler(async (req, res) => {
  const { contacts, campaign_id } = req.body;
  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: 'contacts must be an array', code: 'VALIDATION_ERROR' });
  }
  const result = await contactService.bulkImportContacts(contacts, campaign_id);
  auditService.log('contact.bulk_import', 'contact', null, req.user.id, req.user.email, null,
    { count: contacts.length, created: result.created, skipped: result.skipped }, req.ip);
  res.json(result);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await contactService.getContact(req.params.id));
}));

router.put('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const contact = await contactService.updateContact(req.params.id, req.body);
  auditService.log('contact.update', 'contact', contact.id, req.user.id, req.user.email, null, req.body, req.ip);
  res.json(contact);
}));

router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  await contactService.deleteContact(req.params.id);
  auditService.log('contact.delete', 'contact', req.params.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Contact deleted' });
}));

// POST /contacts/:id/check-suppression
router.post('/:id/check-suppression', asyncHandler(async (req, res) => {
  const contact = await contactService.getContact(req.params.id);
  const result = contactService.checkSuppression(contact.email);
  res.json(result);
}));

module.exports = router;
