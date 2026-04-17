'use strict';

/**
 * Structured logger. Uses pino if available, falls back to console.
 * Redacts sensitive fields from log output.
 */

const REDACTED_FIELDS = new Set([
  'password', 'password_hash', 'api_key', 'smtp_pass', 'jwt_secret',
  'tg_bot_token', 'authorization', 'token', 'secret', 'ADMIN_PASSWORD',
  'ANTHROPIC_API_KEY', 'APOLLO_API_KEY', 'HUNTER_API_KEY', 'SMTP_PASS', 'JWT_SECRET'
]);

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACTED_FIELDS.has(k) ? '[REDACTED]' : (typeof v === 'object' ? redact(v) : v);
  }
  return out;
}

let _pino = null;
function getPino() {
  if (_pino !== null) return _pino;
  try {
    const pino = require('pino');
    const isDev = process.env.NODE_ENV !== 'production';
    _pino = pino({
      level: process.env.LOG_LEVEL || 'info',
      redact: { paths: [...REDACTED_FIELDS], censor: '[REDACTED]' },
      transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    });
  } catch {
    _pino = false;
  }
  return _pino;
}

function makeLogger(context = {}) {
  const base = getPino();

  function log(level, msg, data = {}) {
    const safe = redact({ ...context, ...data });
    if (base) {
      base[level](safe, msg);
    } else {
      const ts = new Date().toISOString();
      const extra = Object.keys(safe).length ? ' ' + JSON.stringify(safe) : '';
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        `[${ts}] ${level.toUpperCase()} ${msg}${extra}`
      );
    }
  }

  return {
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
    debug: (msg, data) => log('debug', msg, data),
    child: (childContext) => makeLogger({ ...context, ...childContext }),
  };
}

const logger = makeLogger();
module.exports = logger;
