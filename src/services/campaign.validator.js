'use strict';

/**
 * Campaign preflight validation engine.
 * Runs a suite of checks before a campaign is allowed to launch.
 * Returns a scored result with blocking errors, warnings, and a readiness score.
 */

const { getDb } = require('../db');
const { getConfig } = require('../config');
const { NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
let senderService;
try { senderService = require('./sender.service'); } catch (_) { senderService = null; }

// Check severity levels
const BLOCKING = 'blocking';  // Campaign cannot run
const WARNING  = 'warning';   // Campaign can run but operator should review
const INFO     = 'info';      // Informational

/**
 * Run all preflight checks for a campaign.
 * Returns { status, score, blocking_count, warning_count, results }
 */
async function validateCampaign(campaignId) {
  const db = getDb();
  const config = getConfig();

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new NotFoundError(`Campaign ${campaignId} not found`);

  let senderCfg;
  try { senderCfg = JSON.parse(campaign.sender_config || '{}'); } catch (_) { senderCfg = {}; }
  try { JSON.parse(campaign.schedule_config || '{}'); } catch (_) { /* ignore */ }

  // Resolve effective sender config (merges sender profile + campaign overrides)
  let effectiveSender = null;
  if (senderService) {
    try { effectiveSender = senderService.getEffectiveSenderConfig(campaignId); } catch (_) { /* ignore */ }
  }

  const results = [];

  // ── BASICS ──────────────────────────────────────────────────────────────

  check(results, 'basics.name', 'Campaign name present',
    campaign.name && campaign.name.trim().length > 0,
    BLOCKING, 'Campaign must have a name');

  check(results, 'basics.name_length', 'Campaign name length',
    !campaign.name || campaign.name.length <= 200,
    WARNING, 'Campaign name is very long (>200 chars)');

  check(results, 'basics.objective', 'Campaign objective defined',
    !!(campaign.objective && campaign.objective.trim()),
    WARNING, 'No objective defined — recommended for tracking campaign purpose');

  // ── SENDER / DELIVERY ────────────────────────────────────────────────────

  const smtpUser = (effectiveSender && effectiveSender.smtp_user) || config.SMTP_USER;
  const smtpPass = (effectiveSender && effectiveSender.smtp_pass) || config.SMTP_PASS;
  const smtpConfigured = !!(smtpUser && smtpPass);

  check(results, 'sender.smtp', 'SMTP configured',
    smtpConfigured, BLOCKING, 'SMTP credentials are not set — emails cannot be sent. Configure via sender profile or SMTP_USER/SMTP_PASS env vars.');

  const fromEmail = (effectiveSender && effectiveSender.from_email) || senderCfg.from_email || config.SMTP_USER;
  check(results, 'sender.from_email', 'Sender email present',
    !!(fromEmail && fromEmail.includes('@')),
    BLOCKING, 'No sender email configured. Set sender_config.from_email, link a sender profile, or set SMTP_USER.');

  // Sender profile checks
  if (campaign.sender_profile_id) {
    check(results, 'sender.profile_exists', 'Linked sender profile exists',
      !!(effectiveSender && effectiveSender.profile_id),
      BLOCKING, `Sender profile ${campaign.sender_profile_id} not found — the linked profile may have been deleted`);

    if (effectiveSender && effectiveSender.profile_id) {
      check(results, 'sender.profile_domain_verified', 'Sender domain verified',
        !!effectiveSender.domain_verified,
        WARNING, `Sender profile "${effectiveSender.profile_name}" domain is not verified — run domain verification`);

      check(results, 'sender.profile_spf', 'Sender profile SPF record verified',
        !!effectiveSender.spf_verified,
        WARNING, `SPF record not verified for sender profile "${effectiveSender.profile_name}"`);
    }
  }

  const replyTo = campaign.reply_to_email || (effectiveSender && effectiveSender.reply_to_email);
  if (replyTo) {
    check(results, 'sender.reply_to_valid', 'Reply-to email format valid',
      replyTo.includes('@'),
      WARNING, `reply_to_email "${replyTo}" does not appear to be a valid email`);
  }

  check(results, 'sender.daily_limit', 'Daily send limit set',
    (campaign.max_daily_sends || campaign.daily_limit || 0) > 0,
    BLOCKING, 'Daily send limit must be > 0');

  check(results, 'sender.daily_limit_safe', 'Daily send limit not excessive',
    (campaign.max_daily_sends || campaign.daily_limit || 0) <= 500,
    WARNING, 'Daily send limit >500 may trigger spam filters or provider rate limits');

  // ── AUDIENCE ─────────────────────────────────────────────────────────────

  const contactCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM contacts WHERE campaign_id = ? AND email IS NOT NULL AND status NOT IN('unsubscribed','bounced','suppressed')"
  ).get(campaignId).cnt;

  check(results, 'audience.contacts_exist', 'Campaign has sendable contacts',
    contactCount > 0,
    BLOCKING, `No eligible contacts found for this campaign (unsubscribed/bounced/suppressed contacts are excluded)`);

  check(results, 'audience.contacts_minimum', 'Minimum audience size',
    contactCount >= 1,
    INFO, `Audience has ${contactCount} eligible contact(s)`);

  const pendingContacts = db.prepare(
    "SELECT COUNT(*) as cnt FROM contacts WHERE campaign_id = ? AND status='pending' AND email IS NOT NULL"
  ).get(campaignId).cnt;

  check(results, 'audience.pending_contacts', 'Pending contacts available',
    pendingContacts > 0,
    WARNING, `No pending contacts found — all contacts may already be in progress or complete`);

  // Check for contacts without email
  const noEmail = db.prepare("SELECT COUNT(*) as cnt FROM contacts WHERE campaign_id = ? AND (email IS NULL OR email = '')").get(campaignId).cnt;
  if (noEmail > 0) {
    check(results, 'audience.contacts_no_email', 'All contacts have email',
      false, WARNING, `${noEmail} contact(s) have no email address and will be skipped`);
  }

  // ── SEQUENCE ─────────────────────────────────────────────────────────────

  let sequence = null;
  if (campaign.sequence_id) {
    sequence = db.prepare('SELECT * FROM sequences WHERE id = ?').get(campaign.sequence_id);
  }
  if (!sequence) {
    sequence = db.prepare("SELECT * FROM sequences WHERE campaign_id = ? AND status='active' ORDER BY created_at LIMIT 1").get(campaignId);
  }

  check(results, 'sequence.exists', 'Active sequence configured',
    !!sequence, BLOCKING, 'No active sequence found for this campaign — create and activate a sequence first');

  if (sequence) {
    const steps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC').all(sequence.id);

    check(results, 'sequence.has_steps', 'Sequence has at least one step',
      steps.length > 0, BLOCKING, 'Sequence has no steps — add at least one email step');

    const stepsWithContent = steps.filter(s =>
      (s.body_template && s.body_template.trim()) || (s.subject_template && s.subject_template.trim())
    );
    check(results, 'sequence.steps_have_content', 'All steps have content or templates',
      stepsWithContent.length === steps.length,
      WARNING, `${steps.length - stepsWithContent.length} step(s) have no subject or body template`);

    // Check for zero-delay first step
    if (steps.length > 0) {
      const firstStep = steps[0];
      check(results, 'sequence.first_step_delay', 'First step delay is zero or minimal',
        (firstStep.delay_days || 0) === 0,
        INFO, `First step has ${firstStep.delay_days || 0}d delay — most campaigns start day 0`);
    }

    // Check send windows
    for (const step of steps) {
      const winStart = step.send_window_start ?? 8;
      const winEnd = step.send_window_end ?? 17;
      if (winStart >= winEnd) {
        check(results, `sequence.step_${step.step_number}_window`, `Step ${step.step_number} send window valid`,
          false, WARNING, `Step ${step.step_number} has invalid send window: start (${winStart}) >= end (${winEnd})`);
      }
    }
  }

  // ── AI GENERATION ─────────────────────────────────────────────────────────

  const aiConfigured = !!config.ANTHROPIC_API_KEY;
  check(results, 'ai.configured', 'AI (Anthropic) API configured',
    aiConfigured, WARNING, 'ANTHROPIC_API_KEY not set — drafts will use fallback placeholder text');

  // ── SUPPRESSION / COMPLIANCE ─────────────────────────────────────────────

  const suppressedInCampaign = db.prepare(`
    SELECT COUNT(*) as cnt FROM contacts c
    JOIN suppression s ON s.email = c.email
    WHERE c.campaign_id = ? AND c.status NOT IN('unsubscribed','bounced','suppressed')
  `).get(campaignId).cnt;

  if (suppressedInCampaign > 0) {
    check(results, 'compliance.suppressed_contacts', 'No suppressed emails in active audience',
      false, WARNING, `${suppressedInCampaign} contact(s) in your audience are in the global suppression list and will be skipped`);
  }

  const complianceCfg = JSON.parse(campaign.compliance_config || '{}');
  check(results, 'compliance.unsubscribe_footer', 'Unsubscribe footer enforced',
    complianceCfg.require_unsubscribe_footer !== false,
    WARNING, 'Unsubscribe footer is not enforced — this may violate CAN-SPAM/GDPR requirements');

  // ── SCHEDULING ───────────────────────────────────────────────────────────

  if (campaign.schedule_mode !== 'manual') {
    check(results, 'schedule.scheduled_at', 'Schedule datetime set',
      !!(campaign.scheduled_at), BLOCKING, 'Campaign is set to scheduled mode but no scheduled_at datetime is configured');

    if (campaign.scheduled_at) {
      check(results, 'schedule.future', 'Scheduled datetime is in the future',
        new Date(campaign.scheduled_at) > new Date(),
        WARNING, 'Scheduled start time is in the past');
    }
  }

  if (campaign.end_at && campaign.start_at) {
    check(results, 'schedule.date_range', 'Start date before end date',
      new Date(campaign.start_at) < new Date(campaign.end_at),
      WARNING, 'Campaign start_at is after end_at');
  }

  // ── REVIEW MODE ─────────────────────────────────────────────────────────

  check(results, 'review.mode_valid', 'Review mode is valid',
    ['manual', 'auto'].includes(campaign.review_mode || 'manual'),
    BLOCKING, `Invalid review_mode: "${campaign.review_mode}"`);

  if ((campaign.review_mode || 'manual') === 'auto') {
    check(results, 'review.auto_warning', 'Auto-send mode acknowledged',
      true, INFO, 'Campaign is in AUTO-SEND mode — drafts will be sent without human review');
  }

  // ── PROVIDER HEALTH ──────────────────────────────────────────────────────

  check(results, 'provider.smtp_host', 'SMTP host configured',
    !!(config.SMTP_HOST), WARNING, 'SMTP_HOST not set, defaulting to smtp.gmail.com');

  // ── CALCULATE SCORE ──────────────────────────────────────────────────────

  const blockingCount = results.filter(r => r.severity === BLOCKING && !r.passed).length;
  const warningCount = results.filter(r => r.severity === WARNING && !r.passed).length;
  const totalChecks = results.length;
  const passedChecks = results.filter(r => r.passed).length;
  const score = Math.round((passedChecks / totalChecks) * 100);
  const status = blockingCount > 0 ? 'fail' : warningCount > 0 ? 'warn' : 'pass';

  // Persist to DB
  db.prepare(`
    INSERT INTO campaign_preflight_results (campaign_id, score, status, results, blocking_count, warning_count)
    VALUES (?,?,?,?,?,?)
  `).run(campaignId, score, status, JSON.stringify(results), blockingCount, warningCount);

  // Update campaign preflight_status
  db.prepare('UPDATE campaigns SET preflight_status=?, preflight_score=?, updated_at=? WHERE id=?')
    .run(status, score, new Date().toISOString(), campaignId);

  logger.info('Campaign preflight complete', { campaignId, status, score, blockingCount, warningCount });

  return { status, score, blocking_count: blockingCount, warning_count: warningCount, results, contact_count: contactCount };
}

function check(results, key, label, passed, severity, failMessage) {
  results.push({
    key,
    category: key.split('.')[0],
    label,
    passed: !!passed,
    severity,
    message: passed ? null : failMessage,
  });
}

/**
 * Get the latest preflight result for a campaign (without re-running).
 */
function getLatestPreflight(campaignId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM campaign_preflight_results WHERE campaign_id = ? ORDER BY checked_at DESC LIMIT 1'
  ).get(campaignId);
  if (!row) return null;
  try { row.results = JSON.parse(row.results || '[]'); } catch (_) { row.results = []; }
  return row;
}

module.exports = { validateCampaign, getLatestPreflight };
