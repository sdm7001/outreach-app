'use strict';

const express = require('express');
const router = express.Router();
const { recordDeliveryEvent } = require('../services/delivery.service');
const { processUnsubscribe } = require('../services/compliance.service');
const logger = require('../utils/logger');

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
);

// GET /t/o/:eventId — open pixel
router.get('/o/:eventId', (req, res) => {
  const { eventId } = req.params;
  // Use X-Forwarded-For with validation (only trust first IP)
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.headers['user-agent'] || '';

  // Ignore bot/crawler opens
  const isBot = /bot|crawler|spider|preview|prefetch/i.test(userAgent);
  if (!isBot) {
    setImmediate(() => {
      recordDeliveryEvent(eventId, 'open', { ip, userAgent: userAgent.slice(0, 200) });
    });
  }

  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.end(PIXEL);
});

// GET /t/c/:eventId — click redirect
router.get('/c/:eventId', (req, res) => {
  const { eventId } = req.params;
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing url parameter');

  // Validate URL to prevent open redirect abuse
  let decoded;
  try {
    decoded = decodeURIComponent(url);
    const parsed = new URL(decoded);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Invalid URL');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = req.headers['user-agent'] || '';

  setImmediate(() => {
    recordDeliveryEvent(eventId, 'click', { ip, userAgent: userAgent.slice(0, 200), url: decoded });
  });

  res.redirect(302, decoded);
});

// GET /unsubscribe/:token — unsubscribe handler
async function unsubscribeHandler(req, res) {
  const { token } = req.params;

  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [contactId, email] = decoded.split(':');

    if (!contactId || !email) throw new Error('Invalid token');

    await processUnsubscribe(contactId, email);
    logger.info('Unsubscribe processed via link', { contactId, email });

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed</title>
      <style>body{font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center;color:#333}
      h1{color:#2d7a2d}p{color:#666}</style></head>
      <body>
        <h1>You've been unsubscribed</h1>
        <p>Your email address has been removed from our mailing list. You will not receive further emails from us.</p>
        <p style="font-size:12px;margin-top:40px;">If this was a mistake, please contact us directly.</p>
      </body>
      </html>
    `);
  } catch (err) {
    logger.warn('Unsubscribe failed', { token, error: err.message });
    res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribe Error</title></head>
      <body>
        <h2>Unable to process unsubscribe request</h2>
        <p>The link may have expired or is invalid. Please contact us directly to be removed from our list.</p>
      </body>
      </html>
    `);
  }
}

router.get('/unsubscribe/:token', unsubscribeHandler);

module.exports = router;
module.exports.unsubscribeHandler = unsubscribeHandler;
