const express = require('express');
const config = require('./config');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1x1 transparent pixel (GIF)
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Tracking pixel - records email opens
 * GET /t/:prospectId
 */
app.get('/t/:prospectId', (req, res) => {
  const { prospectId } = req.params;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';

  try {
    const prospect = db.getProspectById(prospectId);
    if (prospect && !prospect.opened_at) {
      db.updateProspect(prospectId, { opened_at: new Date().toISOString(), status: 'opened' });
      db.incrementStat('emails_opened');
      console.log(`[Tracker] Email opened: ${prospect.company_name} (${prospect.contact_email})`);
    }
    db.logEvent(prospectId, 'open', '', ip, ua);
  } catch (err) {
    console.error(`[Tracker] Error recording open: ${err.message}`);
  }

  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(PIXEL);
});

/**
 * Link click tracking
 * GET /c/:prospectId?url=ENCODED_URL
 */
app.get('/c/:prospectId', (req, res) => {
  const { prospectId } = req.params;
  const targetUrl = req.query.url || config.COMPANY_WEBSITE;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';

  try {
    const prospect = db.getProspectById(prospectId);
    if (prospect) {
      db.updateProspect(prospectId, { clicked_at: new Date().toISOString() });
      db.incrementStat('clicks');
      console.log(`[Tracker] Link clicked: ${prospect.company_name} -> ${targetUrl}`);
    }
    db.logEvent(prospectId, 'click', targetUrl, ip, ua);
  } catch (err) {
    console.error(`[Tracker] Error recording click: ${err.message}`);
  }

  res.redirect(302, targetUrl);
});

/**
 * Unsubscribe handler
 * GET /unsub/:prospectId
 */
app.get('/unsub/:prospectId', (req, res) => {
  const { prospectId } = req.params;

  try {
    const prospect = db.getProspectById(prospectId);
    if (prospect) {
      db.updateProspect(prospectId, {
        status: 'unsubscribed',
        unsubscribed_at: new Date().toISOString()
      });
      db.incrementStat('unsubscribes');
      db.logEvent(prospectId, 'unsubscribe');
      console.log(`[Tracker] Unsubscribed: ${prospect.company_name} (${prospect.contact_email})`);
    }
  } catch (err) {
    console.error(`[Tracker] Error processing unsubscribe: ${err.message}`);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Unsubscribed</title></head>
    <body style="font-family:Arial,sans-serif;max-width:500px;margin:80px auto;text-align:center;">
      <h2>You've been unsubscribed</h2>
      <p>You won't receive any more emails from us. We're sorry to see you go.</p>
      <p style="color:#999;font-size:12px;">${config.COMPANY_NAME} | ${config.COMPANY_ADDRESS}</p>
    </body>
    </html>
  `);
});

/**
 * Health check + stats endpoint
 * GET /stats
 */
app.get('/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Webhook for bounce/reply notifications (future use)
 * POST /webhook
 */
app.post('/webhook', (req, res) => {
  const event = req.body;
  console.log('[Tracker] Webhook received:', JSON.stringify(event));

  try {
    if (event.type === 'bounce' && event.prospect_id) {
      db.updateProspect(event.prospect_id, { status: 'bounced', bounced_at: new Date().toISOString() });
      db.incrementStat('bounces');
      db.logEvent(event.prospect_id, 'bounce', JSON.stringify(event));
    } else if (event.type === 'reply' && event.prospect_id) {
      db.updateProspect(event.prospect_id, { status: 'replied', replied_at: new Date().toISOString() });
      db.incrementStat('replies');
      db.logEvent(event.prospect_id, 'reply', JSON.stringify(event));
    }
  } catch (err) {
    console.error(`[Tracker] Webhook error: ${err.message}`);
  }

  res.json({ status: 'ok' });
});

function startTracker() {
  const port = config.TRACKING_PORT;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Tracker] Tracking server running on port ${port}`);
    console.log(`[Tracker] Open pixel: ${config.TRACKING_DOMAIN}/t/{id}`);
    console.log(`[Tracker] Unsubscribe: ${config.TRACKING_DOMAIN}/unsub/{id}`);
    console.log(`[Tracker] Stats: http://localhost:${port}/stats`);
  });
}

module.exports = { startTracker, app };
