'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

function parseCampaign(row) {
  if (!row) return null;
  return {
    ...row,
    icp_config: JSON.parse(row.icp_config || '{}'),
    sender_config: JSON.parse(row.sender_config || '{}'),
    schedule_config: JSON.parse(row.schedule_config || '{}'),
  };
}

function createCampaign(data, userId) {
  const db = getDb();
  const { name, description, icp_config, sender_config, schedule_config, daily_limit } = data;

  if (!name || !name.trim()) throw new ValidationError('Campaign name is required', 'name');

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO campaigns (id, name, status, description, icp_config, sender_config, schedule_config, daily_limit, created_by, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name.trim(),
    description || null,
    JSON.stringify(icp_config || {}),
    JSON.stringify(sender_config || {}),
    JSON.stringify(schedule_config || {}),
    daily_limit || 10,
    userId || null,
    now, now
  );

  logger.info('Campaign created', { campaignId: id, name: name.trim(), userId });
  return getCampaign(id);
}

function getCampaign(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Campaign ${id} not found`);

  const contactCount = db.prepare('SELECT COUNT(*) as cnt FROM contacts WHERE campaign_id = ?').get(id);
  const campaign = parseCampaign(row);
  campaign.contact_count = contactCount.cnt;
  return campaign;
}

function listCampaigns({ status, page = 1, limit = 20, search } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('c.status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(c.name LIKE ? OR c.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM campaigns c ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM contacts ct WHERE ct.campaign_id = c.id) as contact_count,
           (SELECT COUNT(*) FROM send_events se WHERE se.campaign_id = c.id) as sent_count
    FROM campaigns c ${where}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    data: rows.map(parseCampaign),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

function updateCampaign(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Campaign ${id} not found`);

  const allowed = ['name', 'description', 'status', 'icp_config', 'sender_config', 'schedule_config', 'daily_limit'];
  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates.push(`${key} = ?`);
      const val = ['icp_config', 'sender_config', 'schedule_config'].includes(key)
        ? JSON.stringify(data[key])
        : data[key];
      params.push(val);
    }
  }

  if (updates.length === 0) throw new ValidationError('No valid fields to update');

  updates.push('updated_at = ?');
  params.push(new Date().toISOString(), id);

  db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logger.info('Campaign updated', { campaignId: id });
  return getCampaign(id);
}

function deleteCampaign(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Campaign ${id} not found`);

  db.prepare(`UPDATE campaigns SET status = 'archived', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
  logger.info('Campaign archived', { campaignId: id });
}

function cloneCampaign(id, userId) {
  const db = getDb();
  const original = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!original) throw new NotFoundError(`Campaign ${id} not found`);

  const newId = uuidv4();
  const now = new Date().toISOString();
  const newName = `${original.name} (Copy)`;

  db.prepare(`
    INSERT INTO campaigns (id, name, status, description, icp_config, sender_config, schedule_config, daily_limit, created_by, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId, newName, original.description, original.icp_config, original.sender_config, original.schedule_config, original.daily_limit, userId, now, now);

  logger.info('Campaign cloned', { originalId: id, newId, userId });
  return getCampaign(newId);
}

module.exports = { createCampaign, getCampaign, listCampaigns, updateCampaign, deleteCampaign, cloneCampaign };
