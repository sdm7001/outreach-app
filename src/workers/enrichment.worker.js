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
    SELECT c.*, a.domain FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?
  `).get(contactId);

  if (!contact) {
    logger.warn('Enrichment: contact not found', { contactId });
    return;
  }

  if (contact.email && contact.email_verified) {
    logger.debug('Enrichment: contact already has verified email', { contactId });
    return;
  }

  const domain = contact.domain;
  if (!domain) {
    logger.debug('Enrichment: no domain for contact', { contactId });
    return;
  }

  // Try Hunter.io first
  if (config.HUNTER_API_KEY && contact.first_name && contact.last_name) {
    try {
      const result = await hunterFindEmail(
        contact.first_name,
        contact.last_name,
        domain,
        config.HUNTER_API_KEY
      );

      if (result) {
        db.prepare(`
          UPDATE contacts SET email = ?, email_source = 'hunter', email_verified = ?, score = ?, updated_at = ? WHERE id = ?
        `).run(result.email, result.verified ? 1 : 0, result.score || 0, new Date().toISOString(), contactId);

        logger.info('Enrichment: email found via Hunter', { contactId, email: result.email, verified: result.verified });
        return;
      }
    } catch (err) {
      logger.warn('Hunter enrichment failed', { contactId, error: err.message });
    }
  }

  // Fallback: guess common patterns
  if (contact.first_name && contact.last_name && domain) {
    const firstName = contact.first_name.toLowerCase().trim();
    const lastName = contact.last_name.toLowerCase().trim();
    const guessed = `${firstName}.${lastName}@${domain}`;

    db.prepare(`
      UPDATE contacts SET email = ?, email_source = 'guess', email_verified = 0, updated_at = ? WHERE id = ?
    `).run(guessed, new Date().toISOString(), contactId);

    logger.info('Enrichment: email guessed', { contactId, email: guessed });
  }
}

async function hunterFindEmail(firstName, lastName, domain, apiKey) {
  const params = new URLSearchParams({
    domain,
    first_name: firstName,
    last_name: lastName,
    api_key: apiKey,
  });

  const res = await axios.get(`https://api.hunter.io/v2/email-finder?${params}`, {
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
