'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

function createAccount(data) {
  const db = getDb();
  const { company_name, domain, industry, employee_count, city, state, source, tags, notes } = data;

  if (!company_name || !company_name.trim()) throw new ValidationError('Company name is required', 'company_name');

  // Deduplicate by domain
  if (domain) {
    const existing = db.prepare('SELECT id FROM accounts WHERE domain = ?').get(domain.toLowerCase().trim());
    if (existing) return getAccount(existing.id);
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO accounts (id, company_name, domain, industry, employee_count, city, state, source, tags, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    company_name.trim(),
    domain ? domain.toLowerCase().trim() : null,
    industry || null,
    employee_count || null,
    city || null,
    state || null,
    source || 'manual',
    JSON.stringify(tags || []),
    notes || null,
    now, now
  );

  logger.info('Account created', { accountId: id, company_name: company_name.trim() });
  return getAccount(id);
}

function getAccount(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Account ${id} not found`);

  const stats = getAccountStats(id);
  return { ...row, tags: JSON.parse(row.tags || '[]'), ...stats };
}

function listAccounts({ search, industry, page = 1, limit = 20 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(a.company_name LIKE ? OR a.domain LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (industry) {
    conditions.push('a.industry = ?');
    params.push(industry);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM accounts a ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT a.*,
           (SELECT COUNT(*) FROM contacts c WHERE c.account_id = a.id) as contact_count,
           (SELECT MAX(c.last_contacted_at) FROM contacts c WHERE c.account_id = a.id) as last_activity
    FROM accounts a ${where}
    ORDER BY a.company_name ASC
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

function updateAccount(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Account ${id} not found`);

  const allowed = ['company_name', 'domain', 'industry', 'employee_count', 'city', 'state', 'tags', 'notes'];
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
  db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getAccount(id);
}

function deleteAccount(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Account ${id} not found`);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  logger.info('Account deleted', { accountId: id });
}

function getAccountStats(id) {
  const db = getDb();
  const contacts = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE account_id = ?').get(id);
  const lastActivity = db.prepare('SELECT MAX(last_contacted_at) as ts FROM contacts WHERE account_id = ?').get(id);
  return {
    contact_count: contacts.cnt,
    last_activity: lastActivity.ts,
  };
}

module.exports = { createAccount, getAccount, listAccounts, updateAccount, deleteAccount, getAccountStats };
