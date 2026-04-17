'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const logger = require('../utils/logger');

/**
 * SQLite-backed job queue with retry, backoff, and idempotency.
 */

function enqueue(type, payload = {}, options = {}) {
  const db = getDb();
  const {
    idempotencyKey,
    scheduledAt,
    maxAttempts = 3,
    delayMs = 0,
  } = options;

  const id = uuidv4();
  const scheduledTime = scheduledAt || new Date(Date.now() + delayMs).toISOString();

  // Skip if idempotency key already exists
  if (idempotencyKey) {
    const existing = db.prepare('SELECT id FROM jobs WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) {
      logger.debug('Job skipped (idempotency)', { type, idempotencyKey });
      return existing.id;
    }
  }

  db.prepare(`
    INSERT INTO jobs (id, type, payload, status, max_attempts, scheduled_at, idempotency_key, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(id, type, JSON.stringify(payload), maxAttempts, scheduledTime, idempotencyKey || null, new Date().toISOString());

  logger.debug('Job enqueued', { id, type });
  return id;
}

function dequeue(types = [], limit = 5) {
  const db = getDb();
  const now = new Date().toISOString();
  const typeList = types.length ? types : null;

  const typePlaceholders = typeList ? typeList.map(() => '?').join(',') : null;
  const typeFilter = typeList ? `AND type IN (${typePlaceholders})` : '';

  // Claim jobs atomically using a transaction
  const claimJobs = db.transaction(() => {
    const rows = db.prepare(`
      SELECT id FROM jobs
      WHERE status = 'pending'
        AND scheduled_at <= ?
        AND attempts < max_attempts
        ${typeFilter}
      ORDER BY scheduled_at ASC
      LIMIT ?
    `).all(...(typeList ? [now, ...typeList, limit] : [now, limit]));

    if (rows.length === 0) return [];

    const ids = rows.map(r => r.id);
    for (const id of ids) {
      db.prepare(`UPDATE jobs SET status = 'processing', started_at = ?, attempts = attempts + 1 WHERE id = ?`)
        .run(now, id);
    }

    return db.prepare(`SELECT * FROM jobs WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids);
  });

  const jobs = claimJobs();
  return jobs.map(j => ({ ...j, payload: JSON.parse(j.payload || '{}') }));
}

function complete(jobId) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), jobId);
}

function fail(jobId, error) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return;

  const attempts = job.attempts;
  const maxAttempts = job.max_attempts;

  if (attempts >= maxAttempts) {
    // Dead-letter
    db.prepare(`UPDATE jobs SET status = 'dead', failed_at = ?, error_message = ? WHERE id = ?`)
      .run(new Date().toISOString(), error.message || String(error), jobId);
    logger.error('Job dead-lettered', { jobId, type: job.type, attempts, error: error.message });
  } else {
    // Retry with exponential backoff: attempt * 5 minutes
    const backoffMs = attempts * 5 * 60 * 1000;
    const retryAt = new Date(Date.now() + backoffMs).toISOString();
    db.prepare(`UPDATE jobs SET status = 'pending', scheduled_at = ?, error_message = ? WHERE id = ?`)
      .run(retryAt, error.message || String(error), jobId);
    logger.warn('Job failed, will retry', { jobId, type: job.type, attempts, retryAt });
  }
}

function getStats() {
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status').all();
  const result = { pending: 0, processing: 0, completed: 0, dead: 0 };
  for (const row of rows) result[row.status] = (result[row.status] || 0) + row.count;
  return result;
}

/**
 * Main processing loop. Handlers is a map of job type → async handler function.
 * Each handler receives (payload, job) and should return on success or throw on failure.
 */
async function processLoop(handlers, pollIntervalMs = 5000) {
  const types = Object.keys(handlers);
  logger.info('Queue worker started', { types, pollIntervalMs });

  async function tick() {
    try {
      const jobs = dequeue(types, 10);
      for (const job of jobs) {
        const handler = handlers[job.type];
        if (!handler) {
          logger.warn('No handler for job type', { type: job.type });
          complete(job.id);
          continue;
        }

        try {
          await handler(job.payload, job);
          complete(job.id);
          logger.debug('Job completed', { id: job.id, type: job.type });
        } catch (err) {
          fail(job.id, err);
          logger.error('Job handler failed', { id: job.id, type: job.type, error: err.message });
        }
      }
    } catch (err) {
      logger.error('Queue tick error', { error: err.message });
    }
  }

  // Recover any stale 'processing' jobs from crashed runs
  try {
    const db = getDb();
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min
    const stale = db.prepare(`
      UPDATE jobs SET status = 'pending', started_at = NULL
      WHERE status = 'processing' AND started_at < ?
    `).run(staleThreshold);
    if (stale.changes > 0) {
      logger.warn('Recovered stale processing jobs', { count: stale.changes });
    }
  } catch (_err) { /* ignore stale recovery errors */ }

  // Poll loop
  const interval = setInterval(tick, pollIntervalMs);
  tick(); // Run immediately

  return {
    stop: () => clearInterval(interval),
    tick,
  };
}

module.exports = { enqueue, dequeue, complete, fail, getStats, processLoop };
