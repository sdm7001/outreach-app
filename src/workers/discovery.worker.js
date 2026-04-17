'use strict';

/**
 * Discovery worker — finds and adds prospects for a campaign.
 * Uses Apollo.io and/or Google Places API based on campaign ICP config.
 * Gracefully no-ops when API keys are not configured.
 */

const { getDb } = require('../db');
const { getConfig } = require('../config');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

async function discoverHandler(payload) {
  const { campaignId } = payload;
  const config = getConfig();
  const db = getDb();

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) {
    logger.warn('Discovery: campaign not found', { campaignId });
    return;
  }

  let icp = {};
  try { icp = JSON.parse(campaign.icp_config || '{}'); } catch (_) {}

  if (!config.APOLLO_API_KEY && !config.GOOGLE_PLACES_API_KEY) {
    logger.info('Discovery: no API keys configured, skipping', { campaignId });
    return;
  }

  let found = 0;

  // Apollo.io discovery
  if (config.APOLLO_API_KEY) {
    try {
      found += await _discoverViaApollo(db, campaignId, icp, config);
    } catch (err) {
      logger.error('Discovery: Apollo error', { campaignId, error: err.message });
    }
  }

  logger.info('Discovery complete', { campaignId, found });
}

async function _discoverViaApollo(db, campaignId, icp, config) {
  const axios = require('axios');
  const industries = icp.industries || config.TARGET_INDUSTRIES || [];
  const locations = icp.locations || config.TARGET_LOCATIONS || [];
  const titles = icp.titles || config.TARGET_TITLES || [];

  const body = {
    api_key: config.APOLLO_API_KEY,
    q_organization_industry_tag_ids: [],
    person_titles: titles.slice(0, 5),
    q_organization_locations: locations.slice(0, 3),
    num_requested: 10,
    page: 1,
  };

  const res = await axios.post('https://api.apollo.io/v1/mixed_people/search', body, {
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' },
  });

  const people = res.data?.people || [];
  const now = new Date().toISOString();
  let count = 0;

  for (const person of people) {
    const email = person.email;
    if (!email || email.includes('*')) continue;

    const existing = db.prepare('SELECT id FROM contacts WHERE email = ? AND campaign_id = ?').get(email, campaignId);
    if (existing) continue;

    const accountId = _upsertAccount(db, person.organization, now);
    const contactId = uuidv4();

    db.prepare(`
      INSERT INTO contacts (id, account_id, campaign_id, first_name, last_name, email, title,
        email_source, email_verified, source, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,'apollo',0,'apollo','pending',?,?)
    `).run(contactId, accountId, campaignId,
      person.first_name || null, person.last_name || null,
      email, person.title || null, now, now);

    count++;
  }

  return count;
}

function _upsertAccount(db, org, now) {
  if (!org) return null;
  const domain = org.primary_domain || null;
  if (domain) {
    const existing = db.prepare('SELECT id FROM accounts WHERE domain = ?').get(domain);
    if (existing) return existing.id;
  }
  const id = uuidv4();
  db.prepare(`
    INSERT INTO accounts (id, company_name, domain, industry, employee_count, source, created_at, updated_at)
    VALUES (?,?,?,?,?,'apollo',?,?)
  `).run(id, org.name || 'Unknown', domain,
    org.industry || null, org.estimated_num_employees || null, now, now);
  return id;
}

module.exports = { discoverHandler };
