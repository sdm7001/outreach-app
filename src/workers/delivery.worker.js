'use strict';

const { getDb } = require('../db');
const { getConfig } = require('../config');
const { sendEmail } = require('../services/delivery.service');
const { isSuppress } = require('../services/compliance.service');
const logger = require('../utils/logger');

/**
 * Handler for 'send_email' jobs.
 * payload: { draftId, contactId, campaignId, stepId }
 */
async function deliveryHandler(payload) {
  const config = getConfig();
  const db = getDb();

  const { draftId, contactId, campaignId, stepId } = payload;

  // Get contact
  const contact = db.prepare(`
    SELECT c.*, a.domain FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?
  `).get(contactId);

  if (!contact) {
    logger.warn('Delivery: contact not found, skipping', { contactId });
    return;
  }

  // Skip if contact is in a terminal state
  if (['unsubscribed', 'bounced', 'suppressed'].includes(contact.status)) {
    logger.info('Delivery skipped: contact terminal state', { contactId, status: contact.status });
    return;
  }

  // Suppression check (belt-and-suspenders)
  if (!contact.email) {
    logger.warn('Delivery skipped: no email for contact', { contactId });
    return;
  }

  if (isSuppress(contact.email)) {
    logger.warn('Delivery skipped: email suppressed', { email: contact.email, contactId });
    return;
  }

  // Business hours check
  const hour = new Date().getHours();
  if (hour < config.SEND_WINDOW_START || hour >= config.SEND_WINDOW_END) {
    logger.info('Delivery deferred: outside send window', { hour, window: [config.SEND_WINDOW_START, config.SEND_WINDOW_END] });
    // Re-schedule for next business day window start
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(config.SEND_WINDOW_START, Math.floor(Math.random() * 60), 0, 0);
    throw new Error(`Outside send window — retry at ${tomorrow.toISOString()}`);
  }

  // Skip guessed unverified emails unless configured to allow
  if (!contact.email_verified && contact.email_source === 'guess' && !config.SEND_GUESSED_EMAILS) {
    logger.info('Delivery skipped: unverified guessed email', { email: contact.email, contactId });
    return;
  }

  // Get draft
  const draft = draftId
    ? db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(draftId)
    : db.prepare("SELECT * FROM message_drafts WHERE contact_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1").get(contactId);

  if (!draft) {
    logger.warn('Delivery skipped: no approved draft found', { contactId, draftId });
    return;
  }

  await sendEmail({
    contactId,
    campaignId,
    stepId,
    draftId: draft.id,
    recipientEmail: contact.email,
    subject: draft.subject,
    body: draft.body,
  });
}

module.exports = { deliveryHandler };
