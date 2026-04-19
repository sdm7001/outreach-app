'use strict';

const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { getConfig } = require('../config');
const { isSuppress } = require('./compliance.service');
const logger = require('../utils/logger');

let _transporter = null;

function buildTransporter() {
  if (_transporter) return _transporter;

  const config = getConfig();
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    logger.warn('SMTP credentials not configured — email sending disabled');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: config.SMTP_HOST || 'smtp.gmail.com',
    port: config.SMTP_PORT || 587,
    secure: false, // STARTTLS
    requireTLS: true,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: true, // Enforce TLS cert validation
    },
  });

  return _transporter;
}

function injectTracking(body, sendEventId, trackingDomain) {
  if (!body) return body;

  // Open tracking pixel
  const pixel = `<img src="${trackingDomain}/t/o/${sendEventId}" width="1" height="1" style="display:none" alt="" />`;

  // Wrap links with click tracking
  let tracked = body.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (match, url) => {
      // Don't double-track tracking URLs or unsubscribe links
      if (url.includes('/t/') || url.includes('/unsubscribe')) return match;
      const encoded = encodeURIComponent(url);
      return `href="${trackingDomain}/t/c/${sendEventId}?url=${encoded}"`;
    }
  );

  // Inject pixel before closing body tag
  if (tracked.includes('</body>')) {
    tracked = tracked.replace('</body>', `${pixel}</body>`);
  } else {
    tracked += pixel;
  }

  return tracked;
}

function injectUnsubscribeLink(body, unsubscribeUrl, companyAddress) {
  const footer = `
<br/><br/>
<p style="font-size:11px;color:#999;margin-top:20px;">
  You are receiving this email because of your professional role.<br/>
  To unsubscribe, <a href="${unsubscribeUrl}">click here</a>.<br/>
  ${companyAddress || ''}
</p>`;

  return body.replace('{{UNSUBSCRIBE_URL}}', `<a href="${unsubscribeUrl}">Unsubscribe</a>`) + footer;
}

async function sendEmail({ contactId, campaignId, stepId, draftId, recipientEmail, subject, body, fromName, fromEmail, attachments = [] }) {
  const config = getConfig();
  const db = getDb();

  // SUPPRESSION CHECK — must happen before anything else
  if (isSuppress(recipientEmail)) {
    logger.warn('Send blocked: suppressed email', { recipientEmail, contactId });
    return { skipped: true, reason: 'suppressed' };
  }

  // Create send event record
  const sendEventId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO send_events (id, contact_id, campaign_id, sequence_step_id, draft_id, recipient_email, subject, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?)
  `).run(sendEventId, contactId, campaignId || null, stepId || null, draftId || null, recipientEmail, subject, now);

  // Build unsubscribe URL using contact ID as token
  const unsubToken = Buffer.from(`${contactId}:${recipientEmail}`).toString('base64url');
  const unsubUrl = `${config.TRACKING_DOMAIN}/unsubscribe/${unsubToken}`;

  // Inject tracking
  let trackedBody = injectTracking(body, sendEventId, config.TRACKING_DOMAIN);
  trackedBody = injectUnsubscribeLink(trackedBody, unsubUrl, config.COMPANY_ADDRESS);

  const transporter = buildTransporter();

  if (!transporter) {
    // Simulate send in dev/no-SMTP mode
    logger.info('[DEV] Simulated email send', { to: recipientEmail, subject });
    db.prepare(`UPDATE send_events SET status = 'sent', sent_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), sendEventId);
    updateContactLastContacted(db, contactId);
    return { sendEventId, simulated: true };
  }

  try {
    await transporter.sendMail({
      from: `"${fromName || config.FROM_NAME}" <${fromEmail || config.FROM_EMAIL}>`,
      to: recipientEmail,
      subject,
      html: trackedBody,
      attachments: attachments.length ? attachments : undefined,
    });

    db.prepare(`UPDATE send_events SET status = 'sent', sent_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), sendEventId);

    updateContactLastContacted(db, contactId);
    updateDailyStats(db, campaignId, 'emails_sent');

    logger.info('Email sent', { to: recipientEmail, subject, sendEventId });
    return { sendEventId };

  } catch (err) {
    db.prepare(`UPDATE send_events SET status = 'failed', error_message = ? WHERE id = ?`)
      .run(err.message, sendEventId);
    logger.error('Email send failed', { to: recipientEmail, error: err.message });
    throw err;
  }
}

function updateContactLastContacted(db, contactId) {
  db.prepare(`UPDATE contacts SET last_contacted_at = ?, status = 'contacted', updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), new Date().toISOString(), contactId);
}

function updateDailyStats(db, campaignId, field) {
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO daily_stats (date, campaign_id, ${field})
    VALUES (?, ?, 1)
    ON CONFLICT(date, campaign_id) DO UPDATE SET ${field} = ${field} + 1
  `).run(date, campaignId || null);
}

function recordDeliveryEvent(sendEventId, eventType, data = {}) {
  const db = getDb();
  const sendEvent = db.prepare('SELECT * FROM send_events WHERE id = ?').get(sendEventId);
  if (!sendEvent) return;

  const now = new Date().toISOString();

  // Update send_events timestamp
  if (eventType === 'open' && !sendEvent.opened_at) {
    db.prepare('UPDATE send_events SET opened_at = ? WHERE id = ?').run(now, sendEventId);
    updateDailyStats(db, sendEvent.campaign_id, 'emails_opened');
  } else if (eventType === 'click' && !sendEvent.clicked_at) {
    db.prepare('UPDATE send_events SET clicked_at = ? WHERE id = ?').run(now, sendEventId);
    updateDailyStats(db, sendEvent.campaign_id, 'clicks');
  } else if (eventType === 'reply' && !sendEvent.replied_at) {
    db.prepare('UPDATE send_events SET replied_at = ? WHERE id = ?').run(now, sendEventId);
    updateDailyStats(db, sendEvent.campaign_id, 'replies');
  } else if (eventType === 'bounce') {
    db.prepare('UPDATE send_events SET bounced_at = ?, status = ? WHERE id = ?')
      .run(now, 'bounced', sendEventId);
    updateDailyStats(db, sendEvent.campaign_id, 'bounces');
  }

  // Insert email event
  db.prepare(`
    INSERT INTO email_events (contact_id, send_event_id, event_type, event_data, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sendEvent.contact_id,
    sendEventId,
    eventType,
    Object.keys(data).length ? JSON.stringify(data) : null,
    data.ip || null,
    data.userAgent || null,
    now
  );
}

module.exports = { sendEmail, buildTransporter, injectTracking, recordDeliveryEvent };
