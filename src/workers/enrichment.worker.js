'use strict';

const axios = require('axios');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const logger = require('../utils/logger');

/**
 * Handler for 'enrich_contact' jobs.
 * payload: { contactId }
 */
async function enrichmentHandler(payload) {
  const config = getConfig();
  const db = getDb();
  const { contactId } = payload;

  const contact = db.prepare(`
    SELECT c.*, a.domain as account_domain FROM contacts c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.id = ?
  `).get(contactId);

  if (!contact) {
    logger.warn('Enrichment: contact not found', { contactId });
    return;
  }

  if (contact.email && contact.email_verified) {
    logger.debug('Enrichment: contact already has verified email', { contactId });
    return;
  }

  // Resolve domain: prefer account domain, fall back to existing email domain, then company_name
  const domain = _resolveDomain(contact);
  if (!domain) {
    logger.info('Enrichment: cannot resolve domain for contact', {
      contactId,
      company: contact.company_name,
      email: contact.email,
    });
    return;
  }

  // Try Hunter.io first — rethrow on failure so the queue can retry the job
  if (config.HUNTER_API_KEY && contact.first_name && contact.last_name) {
    const result = await hunterFindEmail(
      contact.first_name,
      contact.last_name,
      domain,
      config.HUNTER_API_KEY
    );

    if (result) {
      db.prepare(`
        UPDATE contacts
        SET email = ?, email_source = 'hunter', email_verified = ?, score = ?, updated_at = ?
        WHERE id = ?
      `).run(result.email, result.verified ? 1 : 0, result.score || 0, new Date().toISOString(), contactId);

      logger.info('Enrichment: email found via Hunter', {
        contactId,
        email: result.email,
        verified: result.verified,
        score: result.score,
      });
      return;
    }

    logger.info('Enrichment: Hunter found no match', { contactId, domain });
  }

  // Fallback: guess first.last@domain pattern (only if no email exists yet)
  if (!contact.email && contact.first_name && contact.last_name) {
    const firstName = contact.first_name.toLowerCase().trim();
    const lastName = contact.last_name.toLowerCase().trim();
    const guessed = `${firstName}.${lastName}@${domain}`;

    db.prepare(`
      UPDATE contacts SET email = ?, email_source = 'guess', email_verified = 0, updated_at = ? WHERE id = ?
    `).run(guessed, new Date().toISOString(), contactId);

    logger.info('Enrichment: email guessed', { contactId, email: guessed });
  }
}

function _resolveDomain(contact) {
  // 1. Account domain (most reliable)
  if (contact.account_domain && contact.account_domain.trim()) {
    return contact.account_domain.trim().toLowerCase();
  }

  // 2. Extract from existing (unverified) email
  if (contact.email && contact.email.includes('@')) {
    const parts = contact.email.split('@');
    if (parts[1] && parts[1].includes('.')) return parts[1].toLowerCase();
  }

  // 3. Derive from company_name — strip common words and add .com heuristic
  if (contact.company_name) {
    const name = contact.company_name
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co|company|group|the)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (name.length > 2) return `${name}.com`;
  }

  return null;
}

async function hunterFindEmail(firstName, lastName, domain, apiKey) {
  const res = await axios.get('https://api.hunter.io/v2/email-finder', {
    params: { domain, first_name: firstName, last_name: lastName, api_key: apiKey },
    timeout: 10000,
  });

  const data = res.data?.data;
  if (!data || !data.email) return null;

  return {
    email: data.email,
    score: data.score,
    verified: data.verification?.status === 'valid',
  };
}

module.exports = { enrichmentHandler };
