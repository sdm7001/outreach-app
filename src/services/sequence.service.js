'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

function createSequence(data) {
  const db = getDb();
  const { campaign_id, name, steps = [] } = data;

  if (!name || !name.trim()) throw new ValidationError('Sequence name is required', 'name');
  if (!campaign_id) throw new ValidationError('Campaign ID is required', 'campaign_id');

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sequences (id, campaign_id, name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, ?)
  `).run(id, campaign_id, name.trim(), now, now);

  // Insert steps
  for (let i = 0; i < steps.length; i++) {
    insertStep(db, id, steps[i], i + 1);
  }

  logger.info('Sequence created', { sequenceId: id, name: name.trim(), stepCount: steps.length });
  return getSequence(id);
}

function insertStep(db, sequenceId, step, stepNumber) {
  const stepId = uuidv4();
  db.prepare(`
    INSERT INTO sequence_steps (id, sequence_id, step_number, delay_days, delay_hours, subject_template, body_template, tone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stepId,
    sequenceId,
    stepNumber,
    step.delay_days || 0,
    step.delay_hours || 0,
    step.subject_template || null,
    step.body_template || null,
    step.tone || 'professional',
    new Date().toISOString()
  );
}

function getSequence(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sequences WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`Sequence ${id} not found`);

  const steps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC').all(id);
  return { ...row, steps };
}

function listSequences(campaignId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.*, COUNT(ss.id) as step_count
    FROM sequences s
    LEFT JOIN sequence_steps ss ON ss.sequence_id = s.id
    WHERE s.campaign_id = ?
    GROUP BY s.id
    ORDER BY s.created_at ASC
  `).all(campaignId);

  return rows;
}

function updateSequence(id, data) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sequences WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Sequence ${id} not found`);

  const { name, status, steps } = data;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(new Date().toISOString(), id);
    db.prepare(`UPDATE sequences SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  // Replace steps if provided
  if (Array.isArray(steps)) {
    db.prepare('DELETE FROM sequence_steps WHERE sequence_id = ?').run(id);
    for (let i = 0; i < steps.length; i++) {
      insertStep(db, id, steps[i], i + 1);
    }
  }

  return getSequence(id);
}

function deleteSequence(id) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM sequences WHERE id = ?').get(id);
  if (!existing) throw new NotFoundError(`Sequence ${id} not found`);

  db.prepare('DELETE FROM sequence_steps WHERE sequence_id = ?').run(id);
  db.prepare('DELETE FROM sequences WHERE id = ?').run(id);
  logger.info('Sequence deleted', { sequenceId: id });
}

function getNextStep(sequenceId, currentStepNumber) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sequence_steps
    WHERE sequence_id = ? AND step_number > ?
    ORDER BY step_number ASC
    LIMIT 1
  `).get(sequenceId, currentStepNumber);
}

module.exports = { createSequence, getSequence, listSequences, updateSequence, deleteSequence, getNextStep };
