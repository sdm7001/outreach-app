'use strict';

/**
 * Config validation helpers.
 * Used by src/config/index.js to validate environment variables on startup.
 */

function requireEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(`Required environment variable ${key} is not set. See .env.example.`);
  }
  return val.trim();
}

function warnEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    console.warn(`[Config] WARNING: Optional env var ${key} is not set — related feature will be disabled.`);
    return '';
  }
  return val.trim();
}

function parseIntEnv(key, defaultValue) {
  const val = process.env[key];
  if (!val) return defaultValue;
  const n = parseInt(val, 10);
  if (isNaN(n)) {
    console.warn(`[Config] WARNING: ${key} value "${val}" is not a valid integer, using default ${defaultValue}`);
    return defaultValue;
  }
  return n;
}

function parseBoolEnv(key, defaultValue) {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

function parseListEnv(key, defaultValue) {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { requireEnv, warnEnv, parseIntEnv, parseBoolEnv, parseListEnv };
