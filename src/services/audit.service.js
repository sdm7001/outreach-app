'use strict';

const { getDb } = require('../db');

function log(action, entityType, entityId, userId, userEmail, oldValues, newValues, ipAddress) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, old_values, new_values, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId || null,
      userEmail || null,
      action,
      entityType || null,
      entityId || null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress || null,
      new Date().toISOString()
    );
  } catch (err) {
    // Audit failures must never crash the app
    console.error('[Audit] Failed to write audit log:', err.message);
  }
}

function getLogs({ userId, entityType, entityId, action, startDate, endDate, page = 1, limit = 50 } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (userId) { conditions.push('user_id = ?'); params.push(userId); }
  if (entityType) { conditions.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { conditions.push('entity_id = ?'); params.push(entityId); }
  if (action) { conditions.push('action LIKE ?'); params.push(`%${action}%`); }
  if (startDate) { conditions.push('created_at >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('created_at <= ?'); params.push(endDate); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    data: rows.map(r => ({
      ...r,
      old_values: r.old_values ? JSON.parse(r.old_values) : null,
      new_values: r.new_values ? JSON.parse(r.new_values) : null,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

function getEntityHistory(entityType, entityId) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC'
  ).all(entityType, entityId);

  return rows.map(r => ({
    ...r,
    old_values: r.old_values ? JSON.parse(r.old_values) : null,
    new_values: r.new_values ? JSON.parse(r.new_values) : null,
  }));
}

module.exports = { log, getLogs, getEntityHistory };
