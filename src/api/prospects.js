'use strict';

const express = require('express');
const router = express.Router();
const prospectService = require('../services/prospect.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler, ValidationError } = require('../utils/errors');

router.use(requireAuth);

// ── SEARCH ────────────────────────────────────────────────────────────────

// POST /prospects/search — run a prospect search
router.post('/search', requireRole('operator'), asyncHandler(async (req, res) => {
  const { searchId, results } = await prospectService.searchProspects(req.body, req.user.id);
  res.json({ searchId, results, count: results.length });
}));

// POST /prospects/search/:id/save — save search results to pool
router.post('/search/:id/save', requireRole('operator'), asyncHandler(async (req, res) => {
  const search = prospectService.getSearch(req.params.id);
  const { results } = req.body;
  if (!Array.isArray(results) || !results.length) {
    throw new ValidationError('results array is required');
  }
  const count = prospectService.bulkAddToPool(results, req.user.id, search.id);
  res.json({ saved: count });
}));

// GET /prospects/searches — list saved searches
router.get('/searches', asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const result = prospectService.listSearches({
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json(result);
}));

// GET /prospects/searches/:id — get one search
router.get('/searches/:id', asyncHandler(async (req, res) => {
  const search = prospectService.getSearch(req.params.id);
  res.json(search);
}));

// ── POOL ──────────────────────────────────────────────────────────────────

// GET /prospects/ — list pool
router.get('/', asyncHandler(async (req, res) => {
  const { status, search, tags, page, limit } = req.query;
  const result = prospectService.listProspects({
    status, search, tags,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json(result);
}));

// POST /prospects/ — add one to pool manually
router.post('/', requireRole('operator'), asyncHandler(async (req, res) => {
  const prospect = prospectService.addToPool(req.body, req.user.id);
  res.status(201).json(prospect);
}));

// ── BULK ACTIONS ──────────────────────────────────────────────────────────

// POST /prospects/bulk/accept
router.post('/bulk/accept', requireRole('operator'), asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ValidationError('ids array is required');
  const count = prospectService.bulkAccept(ids);
  res.json({ updated: count });
}));

// POST /prospects/bulk/reject
router.post('/bulk/reject', requireRole('operator'), asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ValidationError('ids array is required');
  const count = prospectService.bulkReject(ids);
  res.json({ updated: count });
}));

// POST /prospects/bulk/assign
router.post('/bulk/assign', requireRole('operator'), asyncHandler(async (req, res) => {
  const { ids, campaignId } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ValidationError('ids array is required');
  if (!campaignId) throw new ValidationError('campaignId is required');
  const count = prospectService.assignToCampaign(ids, campaignId, req.user.id);
  res.json({ assigned: count });
}));

// ── SINGLE PROSPECT ───────────────────────────────────────────────────────

// GET /prospects/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const prospect = prospectService.getProspect(req.params.id);
  res.json(prospect);
}));

// PATCH /prospects/:id
router.patch('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const prospect = prospectService.updateProspect(req.params.id, req.body);
  res.json(prospect);
}));

// POST /prospects/:id/accept
router.post('/:id/accept', requireRole('operator'), asyncHandler(async (req, res) => {
  const prospect = prospectService.acceptProspect(req.params.id);
  res.json(prospect);
}));

// POST /prospects/:id/reject
router.post('/:id/reject', requireRole('operator'), asyncHandler(async (req, res) => {
  const prospect = prospectService.rejectProspect(req.params.id);
  res.json(prospect);
}));

// DELETE /prospects/:id
router.delete('/:id', requireRole('operator'), asyncHandler(async (req, res) => {
  const result = prospectService.deleteProspect(req.params.id);
  res.json(result);
}));

module.exports = router;
