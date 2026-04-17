'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

/** Wraps async Express route handlers to forward errors to next() */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Express error middleware — call app.use(errorHandler) last */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const logger = require('./logger');

  if (err.isOperational) {
    logger.warn('Operational error', { code: err.code, message: err.message, path: req.path });
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(err.field ? { field: err.field } : {}),
    });
  }

  // Unexpected / programmer error
  logger.error('Unexpected error', { message: err.message, stack: err.stack, path: req.path });
  return res.status(500).json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' });
}

module.exports = {
  AppError, NotFoundError, ValidationError, AuthError, ForbiddenError, ConflictError,
  asyncHandler, errorHandler,
};
