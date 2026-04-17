'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * Request body validator.
 * Usage: router.post('/login', validate({ email: { required: true, type: 'email' }, password: { required: true, minLength: 8 } }), handler)
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    const body = req.body || {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];
      const isEmpty = value === undefined || value === null || String(value).trim() === '';

      if (rules.required && isEmpty) {
        errors.push(`${field} is required`);
        continue;
      }
      if (isEmpty) continue;

      const val = String(value).trim();

      if (rules.type === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          errors.push(`${field} must be a valid email address`);
        }
      }
      if (rules.minLength && val.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength && val.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
      }
      if (rules.enum && !rules.enum.includes(val)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
      if (rules.pattern && !rules.pattern.test(val)) {
        errors.push(`${field} format is invalid`);
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError(errors.join('; ')));
    }
    next();
  };
}

module.exports = { validate };
