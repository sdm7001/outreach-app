'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkSuppression(email) {
  if (!email) return { suppressed: false };
  const db = getDb();
  const norm = email.toLowerCase().trim();
  const domain = norm.split('@')[1];

  const byEmail = db.prepare('SELECT reason FROM suppression WHERE email = ?').get(norm);
  if (byEmail) return { suppressed: true, reason: byEmail.reason };

  if (domain) {
    const byDomain = db.prepare('SELECT reason FROM suppression WHERE domain = ?').get(domain);
    if (byDomain) return { suppressed: true, reason: `domain: ${byDomain.reason}` };
  }

  return { suppressed: false };
}

function createContact(data) {
  const db = getDb();
  const {
    account_id, campaign_id, first_name, last_name, email, title,
    email_source, email_verified, score, status, lifecycle_state,
    outreach_angle, tags, notes, source
  } = data;

  if (email) {
    if (!isEmailValid(email)) throw new ValidationError('Invalid email format', 'email');
    const sup = checkSuppression(email);
    if (sup.suppressed) throw new ValidationError(`Email is suppressed: ${sup.reason}`, 'email');

    // Dedup by email + campaign
    if (campaign_id) {
      const existing = db.prepare('SELECT id FROM contacts WHERE email = ? AND campaign_id = ?')
        .get(email.toLowerCase().trim(), campaign_id);
      if (existing) return getContact(existing.id);
    }
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contacts (id, account_id, campaign_id, first_name, last_name, email, title,
      email_source, email_verified, score, status, lifecycle_state, outreach_angle, tags, notes, source,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    account_id || null,
    campaign_id || null,
    first_name || null,
    last_name || null,
    email ? email.toLowerCase().trim() : null,
    title || null,
    email_source || 'manual',
    email_verified ? 1 : 0,
    score || 0,
    status || 'pending',
    lifecycle_state || 'prospect',
    outreach_angle || null,
    JSON.stringify(tags || []),
    notes || null,
    source || 'manual',
    now, now
  );

  logger.info('Contact created', { contactId: id, email });
  return getContact(id);
}

function getContact(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT c.*, a.company_name, a.domain, a.industry
    FROM contacts c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.id = ?
  `).get(id);

  if (!row) throw new NotFoundError(`Contact ${id} not found`);
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

function listContacts({ campaign_id, account_id, status, lifecycle_state, search, page = 1, limit = 20 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (campaign_id) { conditions.push('c.campaign_id = ?'); params.push(campaign_id); }
  if (account_id) { conditions.push('c.account_id = ?'); params.push(account_id); }
  if (status) { conditions.push('c.status = ?'); params.push(status); }
  if (lifecycle_state) { conditions.push('c.lifecycle_state = ?'); params.push(lifecycle_state); }
  if (search) {
    conditions.push('(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR a.company_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`
    SELECT COUNT(*) as cnt FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id ${where}
  `).get(...params).cnt;

  const rows = db.prepare(`
    SELECT c.*, a.company_name, a.industry
    FROM contacts c
    LEFT JOIN accounts a ON a.id = c.account_id
    ${where}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    data: rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

function updateContact(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Contact ${id} not found`);

  const allowed = [
    'first_name', 'last_name', 'email', 'title', 'email_source', 'email_verified',
    'score', 'status', 'lifecycle_state', 'outreach_angle', 'tags', 'notes',
    'last_contacted_at', 'account_id', 'campaign_id'
  ];
  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates.push(`${key} = ?`);
      params.push(key === 'tags' ? JSON.stringify(data[key]) : data[key]);
    }
  }

  if (updates.length === 0) throw new ValidationError('No valid fields to update');

  updates.push('updated_at = ?');
  params.push(new Date().toISOString(), id);
  db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getContact(id);
}

function deleteContact(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Contact ${id} not found`);
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  logger.info('Contact deleted', { contactId: id });
}

function bulkImportContacts(contacts, campaignId) {
  const db = getDb();
  const results = { created: 0, skipped: 0, errors: [] };

  const insertContact = db.transaction((c) => {
    try {
      createContact({ ...c, campaign_id: campaignId });
      results.created++;
    } catch (err) {
      results.skipped++;
      results.errors.push({ email: c.email, error: err.message });
    }
  });

  for (const c of contacts) {
    insertContact(c);
  }

  logger.info('Bulk import complete', { created: results.created, skipped: results.skipped, campaignId });
  return results;
}

module.exports = { createContact, getContact, listContacts, updateContact, deleteContact, checkSuppression, bulkImportContacts };
