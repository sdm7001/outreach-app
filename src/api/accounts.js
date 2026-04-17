'use strict';

const express = require('express');
const router = express.Router();
const accountService = require('../services/account.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { search, industry, page, limit } = req.query;
  res.json(await accountService.listAccounts({ search, industry, page: parseInt(page)||1, limit: parseInt(limit)||20 }));
}));

router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const account = await accountService.createAccount(req.body);
  auditService.log('account.create', 'account', account.id, req.user.id, req.user.email, null, { company_name: account.company_name }, req.ip);
  res.status(201).json(account);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await accountService.getAccount(req.params.id));
}));

router.put('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const account = await accountService.updateAccount(req.params.id, req.body);
  auditService.log('account.update', 'account', account.id, req.user.id, req.user.email, null, req.body, req.ip);
  res.json(account);
}));

router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  await accountService.deleteAccount(req.params.id);
  auditService.log('account.delete', 'account', req.params.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Account deleted' });
}));

module.exports = router;
