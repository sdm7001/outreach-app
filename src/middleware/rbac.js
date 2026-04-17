'use strict';

const { ForbiddenError } = require('../utils/errors');

const ROLES = Object.freeze({ ADMIN: 'admin', OPERATOR: 'operator', REVIEWER: 'reviewer', ANALYST: 'analyst' });
const ROLE_RANK = { admin: 4, operator: 3, reviewer: 2, analyst: 1 };

/**
 * requireRole('operator') — allows the named role AND any higher-ranked role.
 * admin > operator > reviewer > analyst
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return next(new ForbiddenError('Not authenticated'));
    const userRank = ROLE_RANK[req.user.role] || 0;
    const requiredRank = ROLE_RANK[minRole] || 0;
    if (userRank < requiredRank) {
      return next(new ForbiddenError(`Requires at least '${minRole}' role`));
    }
    next();
  };
}

/** requireMinRole('operator') — allows operator and above */
function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return next(new ForbiddenError('Not authenticated'));
    const userRank = ROLE_RANK[req.user.role] || 0;
    const minRank = ROLE_RANK[minRole] || 0;
    if (userRank < minRank) {
      return next(new ForbiddenError(`Requires at least '${minRole}' role`));
    }
    next();
  };
}

module.exports = { ROLES, requireRole, requireMinRole };
