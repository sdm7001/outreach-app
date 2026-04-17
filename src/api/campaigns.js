'use strict';

const express = require('express');
const router = express.Router();
const campaignService = require('../services/campaign.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

router.use(requireAuth);

// GET /campaigns
router.get('/', asyncHandler(async (req, res) => {
  const { status, page, limit, search } = req.query;
  const result = await campaignService.listCampaigns({
    status,
    search,
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
  });
  res.json(result);
}));

// POST /campaigns
router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = await campaignService.createCampaign(req.body, req.user.id);
  auditService.log('campaign.create', 'campaign', campaign.id, req.user.id, req.user.email, null, { name: campaign.name }, req.ip);
  res.status(201).json(campaign);
}));

// GET /campaigns/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const campaign = await campaignService.getCampaign(req.params.id);
  res.json(campaign);
}));

// PUT /campaigns/:id
router.put('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const before = await campaignService.getCampaign(req.params.id);
  const campaign = await campaignService.updateCampaign(req.params.id, req.body);
  auditService.log('campaign.update', 'campaign', campaign.id, req.user.id, req.user.email,
    { status: before.status }, { status: campaign.status, ...req.body }, req.ip);
  res.json(campaign);
}));

// DELETE /campaigns/:id — archive
router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  await campaignService.deleteCampaign(req.params.id);
  auditService.log('campaign.archive', 'campaign', req.params.id, req.user.id, req.user.email, null, { status: 'archived' }, req.ip);
  res.json({ message: 'Campaign archived' });
}));

// POST /campaigns/:id/clone
router.post('/:id/clone', requireRole('operator'), asyncHandler(async (req, res) => {
  const campaign = await campaignService.cloneCampaign(req.params.id, req.user.id);
  auditService.log('campaign.clone', 'campaign', campaign.id, req.user.id, req.user.email, { source_id: req.params.id }, null, req.ip);
  res.status(201).json(campaign);
}));

module.exports = router;
