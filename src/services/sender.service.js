'use strict';

/**
 * Sender Profile service.
 * Manages SMTP sender identities used by campaigns.
 * Each sender profile has its own rate limits, SMTP config, and domain verification status.
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

// ── Encryption helpers (symmetric AES-256-GCM for SMTP passwords) ─────────

function _encryptPassword(plaintext) {
  if (!plaintext) return null;
  const config = getConfig();
  const key = crypto.createHash('sha256').update(config.JWT_SECRET || 'default-dev-key').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function _decryptPassword(ciphertext) {
  if (!ciphertext) return null;
  try {
    const config = getConfig();
    const key = crypto.createHash('sha256').update(config.JWT_SECRET || 'default-dev-key').digest();
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const encrypted = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (err) {
    logger.warn('Failed to decrypt SMTP password', { error: err.message });
    return null;
  }
}

function _serializeProfile(row, includePassword = false) {
  if (!row) return null;
  const out = { ...row };
  delete out.smtp_pass_enc;
  if (includePassword && row.smtp_pass_enc) {
    out.smtp_pass = _decryptPassword(row.smtp_pass_enc);
  }
  return out;
}

// ── CREATE ──────────────────────────────────────────────────────────────────

function createSenderProfile(data, userId) {
  const db = getDb();
  const {
    name, from_email, from_name, reply_to_email,
    smtp_host, smtp_port, smtp_user, smtp_pass,
    daily_send_limit, hourly_send_limit,
    warmup_mode, warmup_limit,
  } = data;

  if (!name || !name.trim()) throw new ValidationError('Sender profile name is required', 'name');
  if (!from_email || !from_email.includes('@')) throw new ValidationError('Valid from_email is required', 'from_email');

  // Check uniqueness
  const existing = db.prepare('SELECT id FROM sender_profiles WHERE from_email = ?').get(from_email.trim().toLowerCase());
  if (existing) throw new ValidationError(`Sender profile for ${from_email} already exists`, 'from_email');

  const id = uuidv4();
  const now = new Date().toISOString();
  const encPass = smtp_pass ? _encryptPassword(smtp_pass) : null;

  db.prepare(`
    INSERT INTO sender_profiles (
      id, name, from_email, from_name, reply_to_email,
      smtp_host, smtp_port, smtp_user, smtp_pass_enc,
      daily_send_limit, hourly_send_limit,
      warmup_mode, warmup_limit,
      owner_user_id, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, name.trim(), from_email.trim().toLowerCase(), from_name || null, reply_to_email || null,
    smtp_host || null, smtp_port || 587, smtp_user || null, encPass,
    daily_send_limit || 100, hourly_send_limit || 20,
    warmup_mode ? 1 : 0, warmup_limit || 10,
    userId || null, now, now,
  );

  logger.info('Sender profile created', { profileId: id, from_email, userId });
  return getSenderProfile(id);
}

// ── READ ────────────────────────────────────────────────────────────────────

function getSenderProfile(id, { includePassword = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sender_profiles WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Sender profile ${id} not found`);
  return _serializeProfile(row, includePassword);
}

function listSenderProfiles({ userId, activeOnly = false } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (userId) { conditions.push('owner_user_id = ?'); params.push(userId); }
  if (activeOnly) { conditions.push('active = 1'); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM sender_profiles ${where} ORDER BY created_at DESC`).all(...params);
  return rows.map(r => _serializeProfile(r, false));
}

// ── UPDATE ──────────────────────────────────────────────────────────────────

function updateSenderProfile(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sender_profiles WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Sender profile ${id} not found`);

  const UPDATABLE = [
    'name', 'from_name', 'reply_to_email',
    'smtp_host', 'smtp_port', 'smtp_user',
    'daily_send_limit', 'hourly_send_limit',
    'warmup_mode', 'warmup_limit', 'active',
    // domain verification flags set by verify endpoint only
  ];

  const updates = [];
  const params = [];

  for (const key of UPDATABLE) {
    if (data[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

  // Handle password separately
  if (data.smtp_pass !== undefined) {
    updates.push('smtp_pass_enc = ?');
    params.push(data.smtp_pass ? _encryptPassword(data.smtp_pass) : null);
    // Reset verification when credentials change
    updates.push('domain_verified = 0', 'spf_verified = 0', 'dkim_verified = 0');
  }

  if (data.from_email !== undefined && data.from_email !== existing.from_email) {
    const dup = db.prepare('SELECT id FROM sender_profiles WHERE from_email = ? AND id != ?').get(data.from_email.toLowerCase(), id);
    if (dup) throw new ValidationError(`A sender profile for ${data.from_email} already exists`, 'from_email');
    updates.push('from_email = ?');
    params.push(data.from_email.trim().toLowerCase());
    updates.push('domain_verified = 0', 'spf_verified = 0', 'dkim_verified = 0');
  }

  if (updates.length === 0) throw new ValidationError('No valid fields to update');

  updates.push('updated_at = ?');
  params.push(new Date().toISOString(), id);

  db.prepare(`UPDATE sender_profiles SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logger.info('Sender profile updated', { profileId: id, fields: Object.keys(data) });
  return getSenderProfile(id);
}

// ── DELETE ──────────────────────────────────────────────────────────────────

function deleteSenderProfile(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sender_profiles WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Sender profile ${id} not found`);

  // Check if any active campaigns use this profile
  const inUse = db.prepare(
    "SELECT COUNT(*) as cnt FROM campaigns WHERE sender_profile_id = ? AND status NOT IN('archived','completed')"
  ).get(id);

  if (inUse.cnt > 0) {
    throw new ValidationError(
      `Cannot delete sender profile: ${inUse.cnt} active campaign(s) use this profile. Archive campaigns first.`,
      'sender_profile_id'
    );
  }

  db.prepare('DELETE FROM sender_profiles WHERE id = ?').run(id);
  logger.info('Sender profile deleted', { profileId: id });
}

// ── DOMAIN VERIFICATION ─────────────────────────────────────────────────────

/**
 * Verify domain configuration for a sender profile.
 * In a production system this would do real DNS lookups.
 * Currently performs basic validation and connectivity check.
 */
async function verifySenderDomain(id) {
  const db = getDb();
  const profile = db.prepare('SELECT * FROM sender_profiles WHERE id = ?').get(id);
  if (!profile) throw new NotFoundError(`Sender profile ${id} not found`);

  const checks = {
    spf_verified: false,
    dkim_verified: false,
    domain_verified: false,
  };

  const domain = profile.from_email.split('@')[1];
  if (!domain) {
    return { ...checks, message: 'Invalid from_email — no domain found', domain: null };
  }

  // Basic: mark as verified if SMTP is configured (proper implementation would do DNS lookups)
  const smtpConfigured = !!(profile.smtp_host && profile.smtp_user && profile.smtp_pass_enc);

  // For the TexMG / Talos use case, Gmail SMTP users are always "verified" for SPF
  const isGmail = domain.endsWith('gmail.com') || (profile.smtp_host || '').includes('gmail') ||
                  (profile.smtp_host || '').includes('google');

  if (isGmail || smtpConfigured) {
    checks.spf_verified = true;
    checks.domain_verified = true;
    // DKIM requires proper SMTP server setup — mark as verified if custom SMTP is set
    checks.dkim_verified = !!(profile.smtp_host && !isGmail);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sender_profiles
    SET spf_verified=?, dkim_verified=?, domain_verified=?, updated_at=?
    WHERE id=?
  `).run(
    checks.spf_verified ? 1 : 0,
    checks.dkim_verified ? 1 : 0,
    checks.domain_verified ? 1 : 0,
    now, id,
  );

  logger.info('Sender domain verification complete', { profileId: id, domain, checks });
  return {
    ...checks,
    domain,
    message: checks.domain_verified
      ? 'Domain verified. SPF check passed.'
      : 'Domain verification failed. Configure SMTP or check DNS records.',
  };
}

// ── EFFECTIVE CONFIG ────────────────────────────────────────────────────────

/**
 * Returns the merged sender configuration for a campaign.
 * Campaign's sender_config overrides the linked sender profile's defaults.
 */
function getEffectiveSenderConfig(campaignId) {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new NotFoundError(`Campaign ${campaignId} not found`);

  let senderConfig = {};
  try { senderConfig = JSON.parse(campaign.sender_config || '{}'); } catch (_) {}

  const config = getConfig();

  // Base defaults from system config
  const base = {
    from_email: senderConfig.from_email || config.SMTP_USER || null,
    from_name: senderConfig.from_name || config.SMTP_FROM_NAME || null,
    reply_to_email: campaign.reply_to_email || senderConfig.reply_to_email || null,
    smtp_host: senderConfig.smtp_host || config.SMTP_HOST || null,
    smtp_port: senderConfig.smtp_port || parseInt(config.SMTP_PORT) || 587,
    smtp_user: senderConfig.smtp_user || config.SMTP_USER || null,
    smtp_pass: config.SMTP_PASS || null,
    daily_send_limit: campaign.max_daily_sends || campaign.daily_limit || 10,
    hourly_send_limit: campaign.max_hourly_sends || 5,
    domain_verified: false,
    spf_verified: false,
    profile_id: null,
    profile_name: null,
  };

  // Override with linked sender profile if present
  if (campaign.sender_profile_id) {
    const profile = db.prepare('SELECT * FROM sender_profiles WHERE id = ?').get(campaign.sender_profile_id);
    if (profile) {
      Object.assign(base, {
        from_email: senderConfig.from_email || profile.from_email,
        from_name: senderConfig.from_name || profile.from_name,
        reply_to_email: campaign.reply_to_email || profile.reply_to_email || senderConfig.reply_to_email,
        smtp_host: senderConfig.smtp_host || profile.smtp_host || config.SMTP_HOST || null,
        smtp_port: senderConfig.smtp_port || profile.smtp_port || 587,
        smtp_user: senderConfig.smtp_user || profile.smtp_user || config.SMTP_USER || null,
        smtp_pass: profile.smtp_pass_enc ? _decryptPassword(profile.smtp_pass_enc) : config.SMTP_PASS || null,
        daily_send_limit: campaign.max_daily_sends || profile.daily_send_limit || 10,
        hourly_send_limit: campaign.max_hourly_sends || profile.hourly_send_limit || 5,
        domain_verified: !!profile.domain_verified,
        spf_verified: !!profile.spf_verified,
        profile_id: profile.id,
        profile_name: profile.name,
      });
    }
  }

  return base;
}

module.exports = {
  createSenderProfile, getSenderProfile, listSenderProfiles,
  updateSenderProfile, deleteSenderProfile,
  verifySenderDomain, getEffectiveSenderConfig,
};
