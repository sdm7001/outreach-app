'use strict';

/**
 * Campaign stage-based execution engine.
 * Supports running individual pipeline stages manually or in sequence.
 *
 * Stages:
 *   discovery    — find and add prospects via Apollo/Places
 *   enrichment   — enrich contacts via Hunter.io
 *   generate     — generate AI drafts for pending contacts
 *   send         — queue approved drafts for delivery
 *   all          — run discovery → enrichment → generate (standard pipeline trigger)
 *
 * Run types:
 *   manual       — operator-triggered
 *   scheduled    — triggered by scheduler
 *   dry_run      — simulate without side effects
 *   test         — send to internal_test_recipients only
 *   stage        — run a specific stage only
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { enqueue } = require('../workers/queue');
const { isSuppress } = require('./compliance.service');
const {
  createRun, updateRun, logRunStep, getCampaignRaw,
  getSequenceForCampaign, isExcluded, updateCampaign,
} = require('./campaign.service');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

// ── PUBLIC ENTRY POINTS ───────────────────────────────────────────────────

/**
 * Run all stages for a campaign (the main "run now" action).
 */
async function runCampaign(campaignId, { triggeredBy, triggeredByEmail, runType = 'manual', dryRun = false, notes, force = false } = {}) {
  const campaign = getCampaignRaw(campaignId);

  // Block if campaign is not in a runnable state
  const runnableStatuses = ['active', 'running', 'ready', 'scheduled', 'draft'];
  if (!runnableStatuses.includes(campaign.status)) {
    throw new Error(`Campaign cannot be run in status '${campaign.status}'`);
  }

  // Guard: all drafts must be reviewed before running (bypassable with force:true for dry runs)
  if (!force && !dryRun) {
    const db = getDb();
    const pendingDrafts = db.prepare(
      "SELECT COUNT(*) as cnt FROM message_drafts WHERE campaign_id = ? AND status = 'pending_review'"
    ).get(campaignId).cnt;
    if (pendingDrafts > 0) {
      throw new ValidationError(
        'All drafts must be reviewed before running. Use the Content Review workflow to approve or reject pending drafts.'
      );
    }
  }

  const idempotencyKey = dryRun ? null : `run:all:${campaignId}:${new Date().toISOString().slice(0, 16)}`;
  const run = createRun(campaignId, {
    runType: dryRun ? 'dry_run' : runType,
    stage: 'all',
    triggeredBy,
    triggeredByEmail,
    idempotencyKey,
    notes,
  });

  if (!dryRun) {
    updateCampaign(campaignId, { status: 'running', last_run_at: new Date().toISOString() });
  }

  // Run async so the API returns immediately
  _executeAllStages(run.id, campaignId, campaign, { dryRun }).catch(err => {
    logger.error('Campaign run failed', { runId: run.id, campaignId, error: err.message });
    updateRun(run.id, { status: 'failed', error_message: err.message, finished_at: new Date().toISOString() });
    updateCampaign(campaignId, { status: 'errored', last_run_status: 'failed' });
  });

  return run;
}

/**
 * Run a specific stage only.
 */
async function runStage(campaignId, stage, { triggeredBy, triggeredByEmail, dryRun = false, limit } = {}) {
  const validStages = ['discovery', 'enrichment', 'generate', 'send'];
  if (!validStages.includes(stage)) throw new Error(`Invalid stage: ${stage}. Must be one of: ${validStages.join(', ')}`);

  const campaign = getCampaignRaw(campaignId);

  const run = createRun(campaignId, {
    runType: dryRun ? 'dry_run' : 'stage',
    stage,
    triggeredBy,
    triggeredByEmail,
  });

  // Run async
  _executeStage(run.id, campaignId, campaign, stage, { dryRun, limit }).catch(err => {
    logger.error('Campaign stage run failed', { runId: run.id, campaignId, stage, error: err.message });
    updateRun(run.id, { status: 'failed', error_message: err.message, finished_at: new Date().toISOString() });
  });

  return run;
}

/**
 * Dry run — simulate execution and return what would happen.
 */
async function dryRunCampaign(campaignId, { triggeredBy, triggeredByEmail } = {}) {
  return runCampaign(campaignId, { triggeredBy, triggeredByEmail, runType: 'dry_run', dryRun: true });
}

/**
 * Send a test batch to internal recipients only.
 */
async function testSendCampaign(campaignId, { triggeredBy, triggeredByEmail, testRecipients } = {}) {
  const campaign = getCampaignRaw(campaignId);
  const complianceCfg = JSON.parse(campaign.compliance_config || '{}');
  const recipients = testRecipients || complianceCfg.internal_test_recipients || [];

  if (!recipients.length) {
    throw new Error('No test recipients configured. Set compliance_config.internal_test_recipients or pass testRecipients.');
  }

  const run = createRun(campaignId, {
    runType: 'test',
    stage: 'send',
    triggeredBy,
    triggeredByEmail,
    notes: `Test send to: ${recipients.join(', ')}`,
  });

  logger.info('Test send run created', { runId: run.id, campaignId, recipients });
  // In a real implementation, this would enqueue test emails to the given recipients
  updateRun(run.id, {
    status: 'completed',
    finished_at: new Date().toISOString(),
    notes: `Test send to: ${recipients.join(', ')}`,
  });

  return run;
}

// ── INTERNAL EXECUTION ────────────────────────────────────────────────────

async function _executeAllStages(runId, campaignId, campaign, { dryRun }) {
  const now = new Date().toISOString();
  updateRun(runId, { status: 'running', started_at: now });

  try {
    // Stage 1: Generate drafts for pending contacts
    const generated = await _stageGenerate(runId, campaignId, campaign, { dryRun });

    // Stage 2: Queue approved drafts for sending
    const queued = await _stageSend(runId, campaignId, campaign, { dryRun });

    const finished = new Date().toISOString();
    updateRun(runId, {
      status: 'completed',
      finished_at: finished,
      drafts_generated: generated,
      emails_queued: queued,
    });

    if (!dryRun) {
      updateCampaign(campaignId, {
        last_run_status: 'completed',
        last_run_at: finished,
      });
    }

    logger.info('Campaign run completed', { runId, campaignId, generated, queued });
  } catch (err) {
    updateRun(runId, { status: 'failed', error_message: err.message, finished_at: new Date().toISOString() });
    if (!dryRun) {
      updateCampaign(campaignId, { status: 'errored', last_run_status: 'failed' });
    }
    throw err;
  }
}

async function _executeStage(runId, campaignId, campaign, stage, { dryRun, limit }) {
  updateRun(runId, { status: 'running', started_at: new Date().toISOString() });
  let count = 0;
  try {
    if (stage === 'enrichment') count = await _stageEnrichment(runId, campaignId, { dryRun, limit });
    else if (stage === 'generate') count = await _stageGenerate(runId, campaignId, campaign, { dryRun, limit });
    else if (stage === 'send') count = await _stageSend(runId, campaignId, campaign, { dryRun, limit });
    else if (stage === 'discovery') count = await _stageDiscovery(runId, campaignId, campaign, { dryRun });

    updateRun(runId, { status: 'completed', finished_at: new Date().toISOString(), contacts_processed: count });
  } catch (err) {
    updateRun(runId, { status: 'failed', error_message: err.message, finished_at: new Date().toISOString() });
    throw err;
  }
}

async function _stageDiscovery(runId, campaignId, campaign, { dryRun }) {
  logRunStep(runId, 'discovery', 'running');
  logger.info('Stage: discovery', { runId, campaignId, dryRun });

  // Enqueue a discovery job (Apollo/Places) for this campaign
  if (!dryRun) {
    enqueue('discover_prospects', { campaignId }, {
      idempotencyKey: `discover:${campaignId}:${new Date().toISOString().slice(0, 13)}`,
    });
  }

  logRunStep(runId, 'discovery', 'completed', { itemsProcessed: dryRun ? 0 : 1 });
  return 1;
}

async function _stageEnrichment(runId, campaignId, { dryRun, limit }) {
  const db = getDb();
  logRunStep(runId, 'enrichment', 'running');

  const contacts = db.prepare(`
    SELECT id FROM contacts
    WHERE campaign_id = ? AND email_verified = 0 AND email IS NOT NULL
    LIMIT ?
  `).all(campaignId, limit || 50);

  let count = 0;
  for (const c of contacts) {
    if (!dryRun) {
      enqueue('enrich_contact', { contactId: c.id, campaignId }, {
        idempotencyKey: `enrich:${c.id}`,
      });
    }
    count++;
  }

  logRunStep(runId, 'enrichment', 'completed', { itemsProcessed: count });
  return count;
}

async function _stageGenerate(runId, campaignId, campaign, { dryRun, limit }) {
  const db = getDb();
  logRunStep(runId, 'generate', 'running');

  const sequence = getSequenceForCampaign(campaignId);
  if (!sequence || !sequence.steps.length) {
    logRunStep(runId, 'generate', 'completed', { itemsProcessed: 0 });
    logger.warn('Stage generate: no sequence steps found', { runId, campaignId });
    return 0;
  }

  const firstStep = sequence.steps[0];
  const batchLimit = limit || campaign.max_daily_sends || campaign.daily_limit || 10;

  const contacts = db.prepare(`
    SELECT id, email FROM contacts
    WHERE campaign_id = ? AND status = 'pending'
    AND email IS NOT NULL AND email != ''
    ORDER BY created_at ASC
    LIMIT ?
  `).all(campaignId, batchLimit);

  let count = 0;
  for (const contact of contacts) {
    // Skip suppressed / campaign-excluded contacts
    if (isSuppress(contact.email)) continue;
    if (isExcluded(campaignId, contact.email)) continue;

    if (!dryRun) {
      enqueue('run_sequence_step', {
        contactId: contact.id,
        campaignId,
        sequenceId: sequence.id,
        stepId: firstStep.id,
        stepNumber: 1,
      }, {
        idempotencyKey: `step:${contact.id}:${firstStep.id}`,
      });
    }
    count++;
  }

  logRunStep(runId, 'generate', 'completed', { itemsProcessed: count });
  return count;
}

async function _stageSend(runId, campaignId, campaign, { dryRun, limit }) {
  const db = getDb();
  logRunStep(runId, 'send', 'running');

  const batchLimit = limit || campaign.max_daily_sends || campaign.daily_limit || 10;
  const approvedDrafts = db.prepare(`
    SELECT md.id, md.contact_id, md.sequence_step_id
    FROM message_drafts md
    JOIN contacts c ON c.id = md.contact_id
    WHERE md.campaign_id = ? AND md.status = 'approved'
    AND c.status NOT IN('unsubscribed','bounced','suppressed')
    ORDER BY md.created_at ASC
    LIMIT ?
  `).all(campaignId, batchLimit);

  let count = 0;
  for (const draft of approvedDrafts) {
    if (!dryRun) {
      enqueue('send_email', {
        draftId: draft.id,
        contactId: draft.contact_id,
        campaignId,
        stepId: draft.sequence_step_id,
      }, {
        idempotencyKey: `send:${draft.id}`,
      });
    }
    count++;
  }

  logRunStep(runId, 'send', 'completed', { itemsProcessed: count });
  return count;
}

/**
 * Requeue failed jobs associated with a campaign run.
 */
async function requeueFailedJobs(campaignId, runId) {
  const db = getDb();
  const deadJobs = db.prepare(`
    SELECT id FROM jobs
    WHERE status = 'dead' AND payload LIKE ?
    LIMIT 50
  `).all(`%${campaignId}%`);

  let count = 0;
  for (const job of deadJobs) {
    db.prepare("UPDATE jobs SET status='pending', attempts=0, scheduled_at=datetime('now'), error_message=NULL WHERE id=?")
      .run(job.id);
    count++;
  }

  logger.info('Requeued failed jobs', { campaignId, runId, count });
  return count;
}

/**
 * Approve all safe pending drafts for a campaign (spam_score below threshold).
 */
function approveAllSafeDrafts(campaignId, { spamThreshold = 5, approvedBy } = {}) {
  const db = getDb();
  const now = new Date().toISOString();

  const drafts = db.prepare(`
    SELECT id FROM message_drafts
    WHERE campaign_id = ? AND status = 'pending_review' AND spam_score <= ?
  `).all(campaignId, spamThreshold);

  let count = 0;
  for (const draft of drafts) {
    db.prepare("UPDATE message_drafts SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=?")
      .run(approvedBy || null, now, draft.id);

    enqueue('send_email', {
      draftId: draft.id,
      campaignId,
    }, {
      idempotencyKey: `send:${draft.id}`,
    });
    count++;
  }

  logger.info('Bulk approved safe drafts', { campaignId, count, spamThreshold });
  return count;
}

/**
 * Preview the contacts that would be included in the next run.
 */
function previewRecipients(campaignId, { limit = 20 } = {}) {
  const db = getDb();
  return db.prepare(`
    SELECT c.id, c.first_name, c.last_name, c.email, c.title, c.status,
           a.company_name, a.industry
    FROM contacts c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.campaign_id = ? AND c.status = 'pending'
    AND c.email IS NOT NULL AND c.email != ''
    ORDER BY c.created_at ASC
    LIMIT ?
  `).all(campaignId, limit);
}

/**
 * Get a sample of pending drafts for preview.
 */
function previewDrafts(campaignId, { limit = 5 } = {}) {
  const db = getDb();
  return db.prepare(`
    SELECT md.*, c.first_name, c.last_name, c.email
    FROM message_drafts md
    JOIN contacts c ON c.id = md.contact_id
    WHERE md.campaign_id = ? AND md.status = 'pending_review'
    ORDER BY md.created_at DESC
    LIMIT ?
  `).all(campaignId, limit);
}

/**
 * Retry a failed or cancelled run.
 * Creates a new run record and re-executes the same stage as the original.
 */
async function retryRun(runId, { triggeredBy, triggeredByEmail } = {}) {
  const db = getDb();
  const original = db.prepare('SELECT * FROM campaign_runs WHERE id = ?').get(runId);
  if (!original) throw new Error(`Run ${runId} not found`);

  const retryableStatuses = ['failed', 'cancelled'];
  if (!retryableStatuses.includes(original.status)) {
    throw new Error(
      `Run ${runId} cannot be retried — status is '${original.status}'. Only failed or cancelled runs can be retried.`
    );
  }

  const campaign = getCampaignRaw(original.campaign_id);
  const runnableStatuses = ['active', 'running', 'ready', 'scheduled', 'draft', 'errored', 'paused'];
  if (!runnableStatuses.includes(campaign.status)) {
    throw new Error(`Campaign cannot be run in status '${campaign.status}'`);
  }

  const stage = original.stage || 'all';
  const runType = original.run_type === 'dry_run' ? 'dry_run' : 'manual';
  const dryRun = original.run_type === 'dry_run';

  logger.info('Retrying campaign run', { originalRunId: runId, campaignId: original.campaign_id, stage });

  if (stage === 'all') {
    return runCampaign(original.campaign_id, {
      triggeredBy: triggeredBy || original.triggered_by,
      triggeredByEmail: triggeredByEmail || original.triggered_by_email,
      runType,
      dryRun,
      notes: `Retry of run ${runId}`,
    });
  }

  return runStage(original.campaign_id, stage, {
    triggeredBy: triggeredBy || original.triggered_by,
    triggeredByEmail: triggeredByEmail || original.triggered_by_email,
    dryRun,
  });
}

module.exports = {
  runCampaign, runStage, dryRunCampaign, testSendCampaign,
  requeueFailedJobs, approveAllSafeDrafts,
  previewRecipients, previewDrafts,
  retryRun,
};
