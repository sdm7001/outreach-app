'use strict';

const { verifyJwt } = require('../utils/crypto');
const { AuthError } = require('../utils/errors');
const { getConfig } = require('../config');

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new AuthError('Authorization header with Bearer token required'));
  }
  const token = auth.slice(7);
  const config = getConfig();
  const payload = verifyJwt(token, config.JWT_SECRET);
  if (!payload) {
    return next(new AuthError('Token is invalid or expired'));
  }
  req.user = { id: payload.id, email: payload.email, role: payload.role };
  next();
}

module.exports = { requireAuth };
