'use strict';

const express = require('express');
const router = express.Router();
const authService = require('../services/auth.service');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { asyncHandler } = require('../utils/errors');
const auditService = require('../services/audit.service');

// POST /auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' });
  }

  const result = await authService.login(email, password);
  auditService.log('auth.login', 'user', result.user.id, result.user.id, result.user.email, null, null, req.ip);
  res.json(result);
}));

// POST /auth/logout
router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  auditService.log('auth.logout', 'user', req.user.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Logged out' });
}));

// GET /auth/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);
  res.json(user);
}));

// PUT /auth/me/password
router.put('/me/password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required', code: 'VALIDATION_ERROR' });
  }
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  auditService.log('auth.password_change', 'user', req.user.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'Password updated' });
}));

// GET /auth/users — admin only
router.get('/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const users = await authService.listUsers();
  res.json(users);
}));

// POST /auth/users — admin only
router.post('/users', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const user = await authService.createUser(req.body);
  auditService.log('user.create', 'user', user.id, req.user.id, req.user.email, null, { email: user.email, role: user.role }, req.ip);
  res.status(201).json(user);
}));

// PUT /auth/users/:id — admin only
router.put('/users/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const user = await authService.updateUser(req.params.id, req.body);
  auditService.log('user.update', 'user', req.params.id, req.user.id, req.user.email, null, req.body, req.ip);
  res.json(user);
}));

// DELETE /auth/users/:id — admin only
router.delete('/users/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await authService.deleteUser(req.params.id);
  auditService.log('user.deactivate', 'user', req.params.id, req.user.id, req.user.email, null, null, req.ip);
  res.json({ message: 'User deactivated' });
}));

module.exports = router;
