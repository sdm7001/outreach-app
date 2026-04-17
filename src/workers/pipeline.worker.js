'use strict';

const { getDb } = require('../db');
const { getConfig } = require('../config');
const { generateWithRetry } = require('../services/message.service');
const { isSuppress } = require('../services/compliance.service');
const { enqueue } = require('./queue');
const logger = require('../utils/logger');

/**
 * Handler for 'run_sequence_step' jobs.
 * payload: { contactId, campaignId, sequenceId, stepId, stepNumber }
 */
async function pipelineHandler(payload) {
  const config = getConfig();
  const db = getDb();

  const { contactId, campaignId, sequenceId, stepId, stepNumber } = payload;

  // Get contact with full info
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
  if (!contact) {
    logger.warn('Pipeline: contact not found, skipping', { contactId });
    return;
  }

  // Terminal state checks
  if (['unsubscribed', 'bounced', 'suppressed'].includes(contact.status)) {
    logger.info('Pipeline: contact in terminal state, stopping sequence', { contactId, status: contact.status });
    return;
  }

  // Suppression check
  if (contact.email && isSuppress(contact.email)) {
    logger.warn('Pipeline: contact email suppressed, stopping', { contactId, email: contact.email });
    db.prepare("UPDATE contacts SET status = 'suppressed', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), contactId);
    return;
  }

  // Get step details
  const step = stepId
    ? db.prepare('SELECT * FROM sequence_steps WHERE id = ?').get(stepId)
    : db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_number = ?').get(sequenceId, stepNumber || 1);

  if (!step) {
    logger.info('Pipeline: no more steps in sequence', { contactId, sequenceId, stepNumber });
    return;
  }

  // Generate draft
  let draft;
  try {
    draft = await generateWithRetry({ contactId, campaignId, stepId: step.id }, 3);
  } catch (err) {
    logger.error('Pipeline: message generation failed', { contactId, error: err.message });
    throw err; // Will cause job retry
  }

  if (config.REVIEW_MODE === 'auto') {
    // Auto-approve and queue for sending
    db.prepare("UPDATE message_drafts SET status = 'approved', reviewed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), draft.id);

    enqueue('send_email', {
      draftId: draft.id,
      contactId,
      campaignId,
      stepId: step.id,
    }, {
      idempotencyKey: `send:${draft.id}`,
    });

    logger.info('Pipeline: auto-send queued', { contactId, draftId: draft.id });
  } else {
    // Manual review mode — leave as pending_review
    logger.info('Pipeline: draft awaiting review', { contactId, draftId: draft.id });
  }

  // Schedule next step if sequence has more steps
  const nextStep = db.prepare(`
    SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_number > ? ORDER BY step_number ASC LIMIT 1
  `).get(step.sequence_id, step.step_number);

  if (nextStep) {
    const delayMs = ((nextStep.delay_days || 0) * 24 * 60 + (nextStep.delay_hours || 0) * 60) * 60 * 1000;
    const scheduledAt = new Date(Date.now() + delayMs).toISOString();

    enqueue('run_sequence_step', {
      contactId,
      campaignId,
      sequenceId: step.sequence_id,
      stepId: nextStep.id,
      stepNumber: nextStep.step_number,
    }, {
      idempotencyKey: `step:${contactId}:${nextStep.id}`,
      scheduledAt,
    });

    logger.info('Pipeline: next step scheduled', {
      contactId,
      nextStepNumber: nextStep.step_number,
      scheduledAt,
    });
  }
}

/**
 * Handler for 'generate_drafts_for_campaign' jobs.
 * Finds all ready contacts in a campaign and queues pipeline steps.
 */
async function campaignRunHandler(payload) {
  const db = getDb();
  const { campaignId } = payload;

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign || !['active', 'running'].includes(campaign.status)) {
    logger.warn('Campaign run: campaign not active', { campaignId });
    return;
  }

  // Get the default sequence for this campaign
  const sequence = db.prepare("SELECT * FROM sequences WHERE campaign_id = ? AND status = 'active' LIMIT 1").get(campaignId);
  if (!sequence) {
    logger.warn('Campaign run: no active sequence', { campaignId });
    return;
  }

  const firstStep = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC LIMIT 1')
    .get(sequence.id);
  if (!firstStep) return;

  // Get ready contacts that haven't been contacted yet
  const limit = campaign.daily_limit || 10;
  const contacts = db.prepare(`
    SELECT id FROM contacts
    WHERE campaign_id = ? AND status = 'pending'
    AND email IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(campaignId, limit);

  let queued = 0;
  for (const contact of contacts) {
    enqueue('run_sequence_step', {
      contactId: contact.id,
      campaignId,
      sequenceId: sequence.id,
      stepId: firstStep.id,
      stepNumber: 1,
    }, {
      idempotencyKey: `step:${contact.id}:${firstStep.id}`,
    });
    queued++;
  }

  logger.info('Campaign run queued', { campaignId, queued });
}

module.exports = { pipelineHandler, campaignRunHandler };
