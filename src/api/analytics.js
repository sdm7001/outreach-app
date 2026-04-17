'use strict';

const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analytics.service');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');

router.use(requireAuth);

router.get('/dashboard', asyncHandler(async (req, res) => {
  res.json(await analyticsService.getDashboardStats());
}));

router.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  res.json(await analyticsService.getCampaignStats(req.params.id, { startDate, endDate }));
}));

router.get('/contacts/:id/timeline', asyncHandler(async (req, res) => {
  res.json(await analyticsService.getContactTimeline(req.params.id));
}));

router.get('/sequences/:id/steps', asyncHandler(async (req, res) => {
  res.json(await analyticsService.getSequenceStepStats(req.params.id));
}));

router.get('/trends', asyncHandler(async (req, res) => {
  const { campaignId, days } = req.query;
  res.json(await analyticsService.getDailyTrend(campaignId, parseInt(days)||14));
}));

router.get('/queue-health', asyncHandler(async (req, res) => {
  res.json(await analyticsService.getQueueHealth());
}));

module.exports = router;
