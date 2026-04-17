'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { requireEnv, warnEnv, parseIntEnv, parseBoolEnv, parseListEnv } = require('./validate');

let _config = null;

function loadConfig() {
  const errors = [];

  // Required secrets — fail fast if missing
  const required = {};
  const optional = {};

  for (const key of ['JWT_SECRET', 'ADMIN_PASSWORD']) {
    try {
      required[key] = requireEnv(key);
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (errors.length > 0) {
    console.error('[Config] FATAL: Missing required environment variables:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('[Config] Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  // Optional — warn but continue
  optional.ANTHROPIC_API_KEY = warnEnv('ANTHROPIC_API_KEY');
  optional.APOLLO_API_KEY = warnEnv('APOLLO_API_KEY');
  optional.GOOGLE_PLACES_API_KEY = warnEnv('GOOGLE_PLACES_API_KEY');
  optional.HUNTER_API_KEY = warnEnv('HUNTER_API_KEY');
  optional.SMTP_USER = warnEnv('SMTP_USER');
  optional.SMTP_PASS = warnEnv('SMTP_PASS');
  optional.TG_BOT_TOKEN = warnEnv('TG_BOT_TOKEN');
  optional.TG_CHAT_ID = warnEnv('TG_CHAT_ID');

  return Object.freeze({
    // Auth
    JWT_SECRET: required.JWT_SECRET,
    JWT_EXPIRY_HOURS: parseIntEnv('JWT_EXPIRY_HOURS', 8),
    ADMIN_PASSWORD: required.ADMIN_PASSWORD,
    BCRYPT_ROUNDS: parseIntEnv('BCRYPT_ROUNDS', 12),
    MAX_LOGIN_ATTEMPTS_PER_MIN: parseIntEnv('MAX_LOGIN_ATTEMPTS_PER_MIN', 10),

    // App behavior
    REVIEW_MODE: process.env.REVIEW_MODE || 'manual',  // 'manual' | 'auto'
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseIntEnv('PORT', 3848),
    TRACKING_PORT: parseIntEnv('TRACKING_PORT', 3847),

    // Database
    DB_PATH: process.env.DB_PATH || require('path').join(__dirname, '../../data/outreach.db'),

    // AI
    ANTHROPIC_API_KEY: optional.ANTHROPIC_API_KEY,
    AI_MODEL: process.env.AI_MODEL || 'claude-haiku-4-5',
    AI_MAX_TOKENS: parseIntEnv('AI_MAX_TOKENS', 600),
    AI_PROMPT_VERSION: process.env.AI_PROMPT_VERSION || 'v1',

    // Prospecting
    APOLLO_API_KEY: optional.APOLLO_API_KEY,
    GOOGLE_PLACES_API_KEY: optional.GOOGLE_PLACES_API_KEY,
    HUNTER_API_KEY: optional.HUNTER_API_KEY,

    // Email
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: parseIntEnv('SMTP_PORT', 587),
    SMTP_USER: optional.SMTP_USER,
    SMTP_PASS: optional.SMTP_PASS,
    FROM_NAME: process.env.FROM_NAME || 'Lindsay Thompson',
    FROM_EMAIL: process.env.FROM_EMAIL || optional.SMTP_USER,
    TRACKING_DOMAIN: process.env.TRACKING_DOMAIN || 'http://localhost:3847',

    // Sending controls
    DAILY_PROSPECT_LIMIT: parseIntEnv('DAILY_PROSPECT_LIMIT', 10),
    EMAILS_PER_DAY: parseIntEnv('EMAILS_PER_DAY', 10),
    EMAIL_STAGGER_MIN_MS: parseIntEnv('EMAIL_STAGGER_MIN_MS', 480000),
    EMAIL_STAGGER_MAX_MS: parseIntEnv('EMAIL_STAGGER_MAX_MS', 720000),
    SEND_WINDOW_START: parseIntEnv('SEND_WINDOW_START', 8),
    SEND_WINDOW_END: parseIntEnv('SEND_WINDOW_END', 17),
    SEND_GUESSED_EMAILS: parseBoolEnv('SEND_GUESSED_EMAILS', false),

    // Notifications
    TG_BOT_TOKEN: optional.TG_BOT_TOKEN,
    TG_CHAT_ID: optional.TG_CHAT_ID,

    // Company identity
    COMPANY_NAME: process.env.COMPANY_NAME || 'TexMG',
    COMPANY_ADDRESS: process.env.COMPANY_ADDRESS || '21175 Tomball Parkway, Houston TX 77070',
    COMPANY_WEBSITE: process.env.COMPANY_WEBSITE || 'https://texmg.com',
    TALOS_WEBSITE: process.env.TALOS_WEBSITE || 'https://talosautomation.ai',

    // ICP defaults (can be overridden per-campaign)
    TARGET_INDUSTRIES: parseListEnv('TARGET_INDUSTRIES', [
      'Healthcare', 'Law Practice', 'Accounting', 'Medical Practice',
      'Dental', 'Legal Services', 'CPA', 'Financial Services'
    ]),
    TARGET_TITLES: parseListEnv('TARGET_TITLES', [
      'Office Manager', 'Practice Administrator', 'Managing Partner',
      'CEO', 'Owner', 'Practice Manager', 'Operations Manager', 'IT Director'
    ]),
    TARGET_LOCATIONS: parseListEnv('TARGET_LOCATIONS', ['Houston, Texas', 'Houston, TX']),
    TARGET_EMPLOYEE_MIN: parseIntEnv('TARGET_EMPLOYEE_MIN', 25),
    TARGET_EMPLOYEE_MAX: parseIntEnv('TARGET_EMPLOYEE_MAX', 200),

    PAIN_ANGLES: [
      { angle: 'it-downtime', desc: 'IT downtime costs and unreliable support' },
      { angle: 'hipaa-compliance', desc: 'HIPAA/compliance anxiety and audit risk' },
      { angle: 'ai-automation', desc: 'AI automation for repetitive tasks and patient/client communication' },
      { angle: 'cybersecurity', desc: 'Ransomware and cybersecurity threats targeting small practices' },
      { angle: 'cost-savings', desc: 'Overpaying for IT while getting poor response times' },
      { angle: 'growth', desc: 'Scaling operations without adding headcount using AI' }
    ],
  });
}

function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

module.exports = { getConfig };
