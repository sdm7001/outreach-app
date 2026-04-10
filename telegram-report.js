const axios = require('axios');
const config = require('./config');
const db = require('./db');

/**
 * Send daily digest report to Telegram
 */
async function sendDailyReport() {
  const stats = db.getStats();
  const today = stats.today || {};
  const totals = stats.totals || {};

  const totalSent = totals.total_sent || 0;
  const totalOpened = totals.total_opened || 0;
  const totalReplied = totals.total_replied || 0;
  const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0;
  const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  // Get today's sent prospects for the list
  const d = db.getDb();
  const todaySent = d.prepare(`
    SELECT company_name, industry, city, contact_email
    FROM prospects
    WHERE DATE(sent_at) = DATE('now')
    ORDER BY sent_at DESC
    LIMIT 10
  `).all();

  const prospectList = todaySent.length > 0
    ? todaySent.map(p => `  \u2022 ${p.company_name} (${p.industry}) - ${p.city}`).join('\n')
    : '  No emails sent today';

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const message = `\ud83d\udcca Daily Outreach Report - ${dateStr}

\ud83d\udd0d Prospects Found: ${today.prospects_found || 0}
\ud83d\udce7 Emails Sent: ${today.emails_sent || 0}
\ud83d\udc41 Opens Today: ${today.emails_opened || 0}
\ud83d\udcac Replies: ${today.replies || 0}

Top Prospects Contacted:
${prospectList}

\ud83d\udcc8 Running Totals:
Total Sent: ${totalSent} | Opens: ${openRate}% | Replies: ${replyRate}%
Bounces: ${totals.total_bounced || 0}

Next run: Tomorrow 6:00 AM CT`;

  return sendTelegramMessage(message);
}

/**
 * Send startup notification
 */
async function sendStartupMessage() {
  const message = `\u2705 Outreach app installed and running on lindsay.texmg.com

\ud83d\udee0 Status:
- Prospect finder: ${config.APOLLO_API_KEY ? '\u2705 Apollo configured' : (config.GOOGLE_PLACES_API_KEY ? '\u2705 Google Places configured' : '\u26a0\ufe0f No API key - add APOLLO_API_KEY or GOOGLE_PLACES_API_KEY')}
- Contact enricher: ${config.HUNTER_API_KEY ? '\u2705 Hunter.io configured' : '\u26a0\ufe0f No Hunter key - will use email guessing'}
- Message generator: ${config.ANTHROPIC_API_KEY ? '\u2705 Claude API configured' : '\u26a0\ufe0f No ANTHROPIC_API_KEY - add to .env'}
- Email sender: ${config.SMTP_USER ? '\u2705 SMTP configured' : '\u26a0\ufe0f No SMTP credentials - add SMTP_USER and SMTP_PASS'}
- Telegram reports: \u2705 Active
- Tracking server: \u2705 Port ${config.TRACKING_PORT}

\ud83d\udcc5 Schedule (CT):
- 6:00 AM: Find prospects
- 7:00 AM: Enrich contacts
- 8:00 AM: Generate messages
- 9:00 AM: Send emails (staggered 8-12 min apart)
- 5:00 PM: Daily report

\ud83d\udd11 Add API keys to /var/www/outreach-app/.env to activate all features.`;

  return sendTelegramMessage(message);
}

/**
 * Send an arbitrary message to Telegram
 */
async function sendTelegramMessage(text) {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/sendMessage`,
      {
        chat_id: config.TG_CHAT_ID,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 15000 }
    );

    if (response.data && response.data.ok) {
      console.log('[Telegram] Message sent successfully');
      return true;
    } else {
      console.error('[Telegram] Failed to send:', response.data);
      return false;
    }
  } catch (err) {
    console.error(`[Telegram] Error: ${err.message}`);
    // Don't crash - Telegram is non-critical
    return false;
  }
}

/**
 * Send alert for important events (reply, bounce, etc.)
 */
async function sendAlert(type, prospect) {
  let emoji, label;
  switch (type) {
    case 'reply':
      emoji = '\ud83d\udfe2';
      label = 'REPLY RECEIVED';
      break;
    case 'bounce':
      emoji = '\ud83d\udd34';
      label = 'EMAIL BOUNCED';
      break;
    case 'open':
      emoji = '\ud83d\udc41';
      label = 'EMAIL OPENED';
      break;
    default:
      emoji = '\u2139\ufe0f';
      label = type.toUpperCase();
  }

  const message = `${emoji} ${label}

Company: ${prospect.company_name}
Contact: ${prospect.contact_name} (${prospect.contact_title})
Email: ${prospect.contact_email}
Industry: ${prospect.industry}`;

  return sendTelegramMessage(message);
}

module.exports = { sendDailyReport, sendStartupMessage, sendTelegramMessage, sendAlert };
