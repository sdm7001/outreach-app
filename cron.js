const cron = require('node-cron');
const { findProspects } = require('./prospect-finder');
const { enrichProspects } = require('./contact-enricher');
const { generateMessages } = require('./message-generator');
const { sendEmails } = require('./email-sender');
const { sendDailyReport } = require('./telegram-report');

function setupCronJobs() {
  // 6:00 AM CT (11:00 UTC) - Find new prospects
  cron.schedule('0 11 * * 1-5', async () => {
    console.log('\n=== [CRON] 6:00 AM CT - Finding prospects ===');
    try {
      await findProspects();
    } catch (err) {
      console.error('[CRON] Prospect finder error:', err.message);
    }
  }, { timezone: 'America/Chicago' });

  // 7:00 AM CT (12:00 UTC) - Enrich contacts
  cron.schedule('0 12 * * 1-5', async () => {
    console.log('\n=== [CRON] 7:00 AM CT - Enriching contacts ===');
    try {
      await enrichProspects();
    } catch (err) {
      console.error('[CRON] Contact enricher error:', err.message);
    }
  }, { timezone: 'America/Chicago' });

  // 8:00 AM CT (13:00 UTC) - Generate messages
  cron.schedule('0 13 * * 1-5', async () => {
    console.log('\n=== [CRON] 8:00 AM CT - Generating messages ===');
    try {
      await generateMessages();
    } catch (err) {
      console.error('[CRON] Message generator error:', err.message);
    }
  }, { timezone: 'America/Chicago' });

  // 9:00 AM CT (14:00 UTC) - Send emails
  cron.schedule('0 14 * * 1-5', async () => {
    console.log('\n=== [CRON] 9:00 AM CT - Sending emails ===');
    try {
      await sendEmails();
    } catch (err) {
      console.error('[CRON] Email sender error:', err.message);
    }
  }, { timezone: 'America/Chicago' });

  // 5:00 PM CT (22:00 UTC) - Daily report
  cron.schedule('0 22 * * 1-5', async () => {
    console.log('\n=== [CRON] 5:00 PM CT - Sending daily report ===');
    try {
      await sendDailyReport();
    } catch (err) {
      console.error('[CRON] Daily report error:', err.message);
    }
  }, { timezone: 'America/Chicago' });

  console.log('[Cron] Scheduled jobs (Mon-Fri CT):');
  console.log('  6:00 AM - Find prospects');
  console.log('  7:00 AM - Enrich contacts');
  console.log('  8:00 AM - Generate messages');
  console.log('  9:00 AM - Send emails');
  console.log('  5:00 PM - Daily report');
}

module.exports = { setupCronJobs };
