const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');

/**
 * Send emails to enriched prospects with staggered timing
 */
async function sendEmails() {
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.log('[Email Sender] WARNING: No SMTP credentials set. Skipping email sending.');
    console.log('[Email Sender] Set SMTP_USER and SMTP_PASS in .env to enable.');
    return [];
  }

  const prospects = db.getProspectsReadyForEmail(config.DAILY_PROSPECT_LIMIT);
  console.log(`[Email Sender] Sending emails to ${prospects.length} prospects...`);

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  // Verify SMTP connection
  try {
    await transporter.verify();
    console.log('[Email Sender] SMTP connection verified');
  } catch (err) {
    console.error(`[Email Sender] SMTP connection failed: ${err.message}`);
    return [];
  }

  const sent = [];

  for (let i = 0; i < prospects.length; i++) {
    const prospect = prospects[i];

    try {
      const trackingPixel = `<img src="${config.TRACKING_DOMAIN}/t/${prospect.id}" width="1" height="1" style="display:none" alt="">`;
      const unsubscribeUrl = `${config.TRACKING_DOMAIN}/unsub/${prospect.id}`;

      const htmlBody = buildHtmlEmail(prospect, trackingPixel, unsubscribeUrl);
      const textBody = buildTextEmail(prospect, unsubscribeUrl);

      const mailOptions = {
        from: `"${config.FROM_NAME}" <${config.FROM_EMAIL || config.SMTP_USER}>`,
        to: prospect.contact_email,
        subject: prospect.email_subject,
        text: textBody,
        html: htmlBody,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'X-Outreach-ID': prospect.id
        }
      };

      await transporter.sendMail(mailOptions);

      db.updateProspect(prospect.id, {
        status: 'sent',
        sent_at: new Date().toISOString()
      });
      db.incrementStat('emails_sent');
      db.logEvent(prospect.id, 'sent', `To: ${prospect.contact_email}`);

      sent.push({
        id: prospect.id,
        company: prospect.company_name,
        email: prospect.contact_email,
        subject: prospect.email_subject
      });

      console.log(`[Email Sender] Sent to ${prospect.contact_email} (${prospect.company_name})`);

      // Stagger: 8-12 minutes between emails (except for last one)
      if (i < prospects.length - 1) {
        const delay = config.EMAIL_STAGGER_MIN_MS +
          Math.random() * (config.EMAIL_STAGGER_MAX_MS - config.EMAIL_STAGGER_MIN_MS);
        console.log(`[Email Sender] Waiting ${Math.round(delay / 60000)} minutes before next send...`);
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (err) {
      console.error(`[Email Sender] Failed to send to ${prospect.contact_email}: ${err.message}`);
      db.updateProspect(prospect.id, { status: 'error' });
      db.logEvent(prospect.id, 'error', err.message);
    }
  }

  console.log(`[Email Sender] Sent ${sent.length}/${prospects.length} emails`);
  return sent;
}

function buildHtmlEmail(prospect, trackingPixel, unsubscribeUrl) {
  const bodyHtml = prospect.email_body
    .split('\n')
    .map(line => `<p style="margin:0 0 12px 0;color:#333;font-size:14px;line-height:1.6;">${line}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${bodyHtml}

  <p style="margin-top: 24px; color: #333; font-size: 14px; line-height: 1.6;">
    Best,<br>
    <strong>Lindsay Thompson</strong><br>
    Business Development<br>
    TexMG | Talos Automation AI<br>
    <a href="https://texmg.com" style="color:#0066cc;">texmg.com</a> | <a href="https://talosautomation.ai" style="color:#0066cc;">talosautomation.ai</a>
  </p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px 0;">
  <p style="font-size:11px;color:#999;line-height:1.4;">
    ${config.COMPANY_NAME} | ${config.COMPANY_ADDRESS}<br>
    <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a>
  </p>
  ${trackingPixel}
</body>
</html>`;
}

function buildTextEmail(prospect, unsubscribeUrl) {
  return `${prospect.email_body}

Best,
Lindsay Thompson
Business Development
TexMG | Talos Automation AI
texmg.com | talosautomation.ai

---
${config.COMPANY_NAME} | ${config.COMPANY_ADDRESS}
Unsubscribe: ${unsubscribeUrl}`;
}

module.exports = { sendEmails };
