'use strict';

const express = require('express');
const router = express.Router();
const auditService = require('../services/audit.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');

router.use(requireAuth);
router.use(requireRole('analyst'));

router.get('/', asyncHandler(async (req, res) => {
  const { userId, entityType, entityId, action, startDate, endDate, page, limit } = req.query;
  res.json(await auditService.getLogs({
    userId, entityType, entityId, action, startDate, endDate,
    page: parseInt(page)||1, limit: parseInt(limit)||50,
  }));
}));

router.get('/entity/:type/:id', asyncHandler(async (req, res) => {
  res.json(await auditService.getEntityHistory(req.params.type, req.params.id));
}));

module.exports = router;
