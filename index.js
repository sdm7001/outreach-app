#!/usr/bin/env node

/**
 * Outreach App - Automated Marketing for TexMG + Talos Automation AI
 *
 * Daily automated pipeline:
 * 1. Find ICP prospects (healthcare, law, accounting in Houston)
 * 2. Enrich contacts (find decision-maker emails)
 * 3. Generate personalized emails via Claude API
 * 4. Send with tracking pixels and staggered timing
 * 5. Report results to Telegram
 */

const config = require('./config');
const db = require('./db');
const { startTracker } = require('./tracker');
const { setupCronJobs } = require('./cron');
const { sendStartupMessage, sendTelegramMessage } = require('./telegram-report');
const { findProspects } = require('./prospect-finder');
const { enrichProspects } = require('./contact-enricher');
const { generateMessages } = require('./message-generator');
const { sendEmails } = require('./email-sender');
const { sendDailyReport } = require('./telegram-report');

// Initialize database
console.log('=== Outreach App Starting ===');
console.log(`Time: ${new Date().toISOString()}`);
console.log(`Node: ${process.version}`);
console.log(`Working dir: ${__dirname}`);

// Ensure DB is initialized
db.getDb();
console.log('[DB] SQLite database initialized');

// Start tracking server
startTracker();

// Setup cron jobs
setupCronJobs();

// Send startup notification
sendStartupMessage().catch(err => {
  console.error('[Startup] Telegram notification failed:', err.message);
});

console.log('\n=== Outreach App Running ===');
console.log('Tracking server: active');
console.log('Cron jobs: scheduled');
console.log('Waiting for scheduled runs...\n');

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Shutdown] Received SIGTERM');
  sendTelegramMessage('\u26a0\ufe0f Outreach app shutting down (SIGTERM)').finally(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Shutdown] Received SIGINT');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  sendTelegramMessage(`\u274c Outreach app error: ${err.message}`).finally(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled rejection:', reason);
  // Don't crash on unhandled promise rejections
});

/**
 * Run the full pipeline manually (for testing or one-off runs)
 * Usage: node -e "require('./index').runFullPipeline()"
 */
async function runFullPipeline() {
  console.log('\n=== Running Full Pipeline ===\n');

  console.log('Step 1: Finding prospects...');
  const prospects = await findProspects();
  console.log(`Found ${prospects.length} prospects\n`);

  console.log('Step 2: Enriching contacts...');
  const enriched = await enrichProspects();
  console.log(`Enriched ${enriched.length} contacts\n`);

  console.log('Step 3: Generating messages...');
  const messages = await generateMessages();
  console.log(`Generated ${messages.length} messages\n`);

  console.log('Step 4: Sending emails...');
  const sent = await sendEmails();
  console.log(`Sent ${sent.length} emails\n`);

  console.log('Step 5: Sending report...');
  await sendDailyReport();

  console.log('\n=== Pipeline Complete ===');
  return { prospects: prospects.length, enriched: enriched.length, messages: messages.length, sent: sent.length };
}

module.exports = { runFullPipeline };
