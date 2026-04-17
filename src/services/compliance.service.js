'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
const auditService = require('./audit.service');

function addSuppression(email, reason, source, addedBy) {
  const db = getDb();
  const id = uuidv4();
  const norm = email.toLowerCase().trim();

  // Upsert — if already exists, just return
  const existing = db.prepare('SELECT id FROM suppression WHERE email = ?').get(norm);
  if (existing) return existing;

  db.prepare(`
    INSERT INTO suppression (id, email, reason, source, added_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, norm, reason || 'manual', source || 'manual', addedBy || null, new Date().toISOString());

  logger.info('Suppression added', { email: norm, reason, source });
  return { id, email: norm, reason, source, added_by: addedBy };
}

function addDomainSuppression(domain, reason, source, addedBy) {
  const db = getDb();
  const id = uuidv4();
  const norm = domain.toLowerCase().trim().replace(/^@/, '');

  const existing = db.prepare('SELECT id FROM suppression WHERE domain = ?').get(norm);
  if (existing) return existing;

  db.prepare(`
    INSERT INTO suppression (id, domain, reason, source, added_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, norm, reason || 'manual', source || 'manual', addedBy || null, new Date().toISOString());

  logger.info('Domain suppression added', { domain: norm, reason });
  return { id, domain: norm, reason };
}

function listSuppression({ page = 1, limit = 50, search } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(email LIKE ? OR domain LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM suppression ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT * FROM suppression ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { data: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

function removeSuppression(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM suppression WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Suppression entry ${id} not found`);
  db.prepare('DELETE FROM suppression WHERE id = ?').run(id);
  logger.info('Suppression removed', { id });
}

function isSuppress(email) {
  if (!email) return false;
  const db = getDb();
  const norm = email.toLowerCase().trim();
  const domain = norm.split('@')[1];

  const byEmail = db.prepare('SELECT 1 FROM suppression WHERE email = ?').get(norm);
  if (byEmail) return true;

  if (domain) {
    const byDomain = db.prepare('SELECT 1 FROM suppression WHERE domain = ?').get(domain);
    if (byDomain) return true;
  }

  return false;
}

function processUnsubscribe(contactId, email) {
  const db = getDb();

  // Mark contact unsubscribed
  db.prepare(`UPDATE contacts SET status = 'unsubscribed', lifecycle_state = 'unsubscribed', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), contactId);

  // Add to suppression
  if (email) addSuppression(email, 'unsubscribe', 'self-service', null);

  // Log email event
  db.prepare(`INSERT INTO email_events (contact_id, event_type, created_at) VALUES (?, 'unsubscribe', ?)`)
    .run(contactId, new Date().toISOString());

  logger.info('Unsubscribe processed', { contactId, email });
  auditService.log('contact.unsubscribe', 'contact', contactId, null, null, null, { status: 'unsubscribed' }, null);
}

function processBounce(contactId, email, bounceType) {
  const db = getDb();
  const isHard = bounceType === 'hard';

  db.prepare(`UPDATE contacts SET status = ?, lifecycle_state = ?, updated_at = ? WHERE id = ?`)
    .run(
      isHard ? 'bounced' : 'soft_bounce',
      isHard ? 'bounced' : 'prospect',
      new Date().toISOString(),
      contactId
    );

  // Hard bounce → permanent suppression
  if (isHard && email) {
    addSuppression(email, 'hard_bounce', 'system', null);
  }

  db.prepare(`INSERT INTO email_events (contact_id, event_type, event_data, created_at) VALUES (?, 'bounce', ?, ?)`)
    .run(contactId, JSON.stringify({ type: bounceType }), new Date().toISOString());

  logger.info('Bounce processed', { contactId, email, bounceType });
}

module.exports = {
  addSuppression, addDomainSuppression, listSuppression, removeSuppression,
  isSuppress, processUnsubscribe, processBounce
};
