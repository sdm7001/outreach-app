'use strict';

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

// ── HELPERS ───────────────────────────────────────────────────────────────

function parseProspect(row) {
  if (!row) return null;
  const p = { ...row };
  try { p.tags = JSON.parse(row.tags || '[]'); } catch (_) { p.tags = []; }
  return p;
}

// ── SEARCH ────────────────────────────────────────────────────────────────

/**
 * Run a prospect search via Apollo.io / Google Places.
 * Saves a prospect_searches record. Returns array of prospect objects (does NOT save to pool).
 */
async function searchProspects(query, userId) {
  const db = getDb();
  const config = getConfig();
  const {
    industries = [],
    locations = [],
    titles = [],
    keywords = [],
    source = 'apollo',
  } = typeof query === 'string' ? {} : (query || {});

  const searchId = uuidv4();
  const now = new Date().toISOString();
  const queryJson = JSON.stringify({ industries, locations, titles, keywords, source });

  db.prepare(`
    INSERT INTO prospect_searches (id, user_id, query, source, status, result_count, created_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?)
  `).run(searchId, userId || null, queryJson, source, now);

  let results = [];
  const warnings = [];

  try {
    const apolloRequested = source === 'apollo' || source === 'both';
    const placesRequested = source === 'places' || source === 'both';

    if (apolloRequested && !config.APOLLO_API_KEY) {
      warnings.push('Apollo.io API key not configured — skipping Apollo search');
    }
    if (placesRequested && !config.GOOGLE_PLACES_API_KEY) {
      warnings.push('Google Places API key not configured — skipping Places search');
    }

    if (apolloRequested && config.APOLLO_API_KEY) {
      try {
        const apolloResults = await _searchViaApollo({ industries, locations, titles, keywords }, config);
        results = results.concat(apolloResults);
      } catch (apolloErr) {
        const msg = apolloErr.response?.data?.message || apolloErr.response?.data?.error || apolloErr.message;
        warnings.push(`Apollo search failed: ${msg}`);
        logger.warn('Apollo search error', { searchId, error: msg });
      }
    }

    if (placesRequested && config.GOOGLE_PLACES_API_KEY) {
      try {
        const placesResults = await _searchViaPlaces({ industries, locations, keywords }, config);
        results = results.concat(placesResults);
        const emailless = placesResults.filter(p => !p.email).length;
        if (emailless > 0) {
          warnings.push(`${emailless} Google Places result(s) have no email address — enrich manually before assigning to a campaign`);
        }
      } catch (placesErr) {
        const msg = placesErr.response?.data?.error_message || placesErr.message;
        warnings.push(`Google Places search failed: ${msg}`);
        logger.warn('Places search error', { searchId, error: msg });
      }
    }

    db.prepare('UPDATE prospect_searches SET status = ?, result_count = ? WHERE id = ?')
      .run('completed', results.length, searchId);

    logger.info('Prospect search completed', { searchId, count: results.length, source, warnings });
    return { searchId, results, warnings };

  } catch (err) {
    db.prepare('UPDATE prospect_searches SET status = ? WHERE id = ?').run('failed', searchId);
    logger.error('Prospect search failed', { searchId, error: err.message });
    throw new ValidationError(`Prospect search failed: ${err.message}`);
  }
}

async function _searchViaApollo({ industries, locations, titles, keywords }, config) {
  const body = {
    person_titles: (titles || []).slice(0, 5),
    q_organization_locations: (locations || []).slice(0, 3),
    q_organization_industries: (industries || []).slice(0, 5),
    q_keywords: (keywords || []).join(' ') || undefined,
    num_requested: 25,
    page: 1,
  };

  const res = await axios.post('https://api.apollo.io/v1/people/search', body, {
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': config.APOLLO_API_KEY,
    },
  });

  const people = res.data?.people || [];
  return people
    .filter(p => p.email && !p.email.includes('*'))
    .map(p => ({
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      email: p.email,
      title: p.title || null,
      company_name: p.organization?.name || null,
      industry: p.organization?.industry || null,
      city: p.city || null,
      state: p.state || null,
      country: p.country || null,
      source: 'apollo',
    }));
}

async function _searchViaPlaces({ industries, locations, keywords }, config) {
  const query = [...(keywords || []), ...(industries || []), ...(locations || [])].join(' ');
  if (!query.trim()) return [];

  const res = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
    params: { query, key: config.GOOGLE_PLACES_API_KEY },
    timeout: 10000,
  });

  const places = res.data?.results || [];
  return places.slice(0, 20).map(p => ({
    first_name: null,
    last_name: null,
    email: null,
    title: null,
    company_name: p.name || null,
    industry: (industries || [])[0] || null,
    city: null,
    state: null,
    country: null,
    source: 'google_places',
  }));
}

// ── SEARCH MANAGEMENT ─────────────────────────────────────────────────────

function getSearch(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM prospect_searches WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Prospect search ${id} not found`);
  try { row.query = JSON.parse(row.query || '{}'); } catch (_) { row.query = {}; }
  return row;
}

function listSearches({ page = 1, limit = 20 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) as cnt FROM prospect_searches').get().cnt;
  const rows = db.prepare('SELECT * FROM prospect_searches ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  rows.forEach(r => {
    try { r.query = JSON.parse(r.query || '{}'); } catch (_) { r.query = {}; }
  });
  return { data: rows, total, page, limit };
}

// ── POOL MANAGEMENT ───────────────────────────────────────────────────────

function addToPool(data, userId) {
  const db = getDb();
  const {
    first_name, last_name, email, title, company_name,
    industry, city, state, country, linkedin_url, phone,
    source = 'manual', tags = [], notes, search_id,
  } = data;

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO prospect_pool (
      id, search_id, user_id, first_name, last_name, email, title, company_name,
      industry, city, state, country, linkedin_url, phone,
      source, tags, notes, status, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
  `).run(
    id, search_id || null, userId || null,
    first_name || null, last_name || null, email || null, title || null, company_name || null,
    industry || null, city || null, state || null, country || null, linkedin_url || null, phone || null,
    source, JSON.stringify(tags), notes || null,
    now, now
  );

  logger.info('Prospect added to pool', { id, email, userId });
  return getProspect(id);
}

function bulkAddToPool(prospects, userId, searchId) {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO prospect_pool (
      id, search_id, user_id, first_name, last_name, email, title, company_name,
      industry, city, state, country, linkedin_url, phone,
      source, tags, notes, status, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
  `);

  const insertMany = db.transaction((items) => {
    let count = 0;
    for (const p of items) {
      insert.run(
        uuidv4(), searchId || null, userId || null,
        p.first_name || null, p.last_name || null, p.email || null,
        p.title || null, p.company_name || null,
        p.industry || null, p.city || null, p.state || null, p.country || null,
        p.linkedin_url || null, p.phone || null,
        p.source || 'apollo', JSON.stringify(p.tags || []), p.notes || null,
        now, now
      );
      count++;
    }
    return count;
  });

  const count = insertMany(prospects);
  logger.info('Bulk prospects added to pool', { count, searchId, userId });
  return count;
}

function listProspects({ status, search, tags, page = 1, limit = 20 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR company_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (tags) {
    conditions.push('tags LIKE ?');
    params.push(`%${tags}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM prospect_pool ${where}`).get(...params).cnt;
  const rows = db.prepare(`SELECT * FROM prospect_pool ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { data: rows.map(parseProspect), total, page, limit };
}

function getProspect(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM prospect_pool WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Prospect ${id} not found`);
  return parseProspect(row);
}

function updateProspect(id, updates) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM prospect_pool WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Prospect ${id} not found`);

  const allowed = ['first_name', 'last_name', 'email', 'title', 'company_name', 'tags', 'notes', 'status',
    'industry', 'city', 'state', 'country', 'linkedin_url', 'phone'];
  const fields = [];
  const params = [];

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === 'tags' ? JSON.stringify(updates[key]) : updates[key]);
    }
  }

  if (!fields.length) return getProspect(id);

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE prospect_pool SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getProspect(id);
}

function acceptProspect(id) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM prospect_pool WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Prospect ${id} not found`);
  db.prepare("UPDATE prospect_pool SET status = 'accepted', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return getProspect(id);
}

function rejectProspect(id) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM prospect_pool WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Prospect ${id} not found`);
  db.prepare("UPDATE prospect_pool SET status = 'rejected', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return getProspect(id);
}

function bulkAccept(ids) {
  const db = getDb();
  if (!ids || !ids.length) return 0;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`UPDATE prospect_pool SET status = 'accepted', updated_at = ? WHERE id IN (${placeholders})`)
    .run(now, ...ids);
  return result.changes;
}

function bulkReject(ids) {
  const db = getDb();
  if (!ids || !ids.length) return 0;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`UPDATE prospect_pool SET status = 'rejected', updated_at = ? WHERE id IN (${placeholders})`)
    .run(now, ...ids);
  return result.changes;
}

function assignToCampaign(prospectIds, campaignId, userId) {
  const db = getDb();
  if (!prospectIds || !prospectIds.length) throw new ValidationError('prospectIds is required');
  if (!campaignId) throw new ValidationError('campaignId is required');

  // Validate campaign exists
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new NotFoundError(`Campaign ${campaignId} not found`);

  const now = new Date().toISOString();
  const insertContact = db.prepare(`
    INSERT INTO contacts (id, campaign_id, prospect_pool_id, first_name, last_name, email, title,
      source, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,'prospect_pool','pending',?,?)
  `);
  const updatePool = db.prepare("UPDATE prospect_pool SET status = 'assigned', updated_at = ? WHERE id = ?");

  const assign = db.transaction((ids) => {
    let count = 0;
    for (const pid of ids) {
      const prospect = db.prepare('SELECT * FROM prospect_pool WHERE id = ?').get(pid);
      if (!prospect) continue;
      if (prospect.status === 'rejected') continue;
      if (prospect.status === 'assigned') continue; // already in a campaign, skip duplicate

      const contactId = uuidv4();
      insertContact.run(
        contactId, campaignId, pid,
        prospect.first_name, prospect.last_name, prospect.email, prospect.title,
        now, now
      );
      updatePool.run(now, pid);
      count++;
    }
    return count;
  });

  const count = assign(prospectIds);
  logger.info('Prospects assigned to campaign', { count, campaignId, userId });
  return count;
}

function deleteProspect(id) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM prospect_pool WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Prospect ${id} not found`);
  if (existing.status === 'assigned') {
    throw new ValidationError('Cannot delete an assigned prospect. Reject it first.');
  }
  db.prepare('DELETE FROM prospect_pool WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = {
  searchProspects,
  getSearch,
  listSearches,
  addToPool,
  bulkAddToPool,
  listProspects,
  getProspect,
  updateProspect,
  acceptProspect,
  rejectProspect,
  bulkAccept,
  bulkReject,
  assignToCampaign,
  deleteProspect,
};
