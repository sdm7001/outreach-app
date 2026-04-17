'use strict';

/**
 * Campaign Scheduler Worker
 *
 * Runs every 60 seconds. Finds campaigns that are due for a scheduled run and
 * fires them via campaign.runner.js. After each run:
 *   - Advances next_run_at based on schedule_config / recurrence_rule
 *   - Enforces max_runs (transitions to 'completed' when exhausted)
 *   - Enforces send_window (skips tick if outside business hours for that campaign)
 *   - Prevents duplicate runs via idempotency key in campaign_runs
 */

const { getDb } = require('../db');
const { getNextCampaignRun, isInSendWindow } = require('../utils/rrule');
const logger = require('../utils/logger');

// Lazy require to avoid circular dependency at module load time
function getCampaignRunner() { return require('./campaign.runner'); }
function getCampaignService() { return require('../services/campaign.service'); }

/**
 * Main scheduler tick — called every 60 seconds.
 * Finds all campaigns due for a scheduled run and fires them.
 */
async function schedulerTick() {
  const db = getDb();
  const now = new Date().toISOString();

  // Find campaigns that are due
  const dueCampaigns = db.prepare(`
    SELECT c.*
    FROM campaigns c
    WHERE c.status IN ('scheduled', 'active')
      AND c.schedule_mode IN ('once', 'recurring', 'hybrid')
      AND c.schedule_enabled != 0
      AND c.next_run_at IS NOT NULL
      AND c.next_run_at <= ?
      AND (
        -- No run currently in progress for this campaign
        SELECT COUNT(*) FROM campaign_runs cr
        WHERE cr.campaign_id = c.id AND cr.status = 'running'
      ) = 0
  `).all(now);

  if (dueCampaigns.length === 0) return;

  logger.info('[Scheduler] Found due campaigns', { count: dueCampaigns.length, tick: now });

  for (const campaign of dueCampaigns) {
    await _triggerScheduledRun(campaign);
  }
}

async function _triggerScheduledRun(campaign) {
  const db = getDb();
  const runner = getCampaignRunner();
  const service = getCampaignService();

  const campaignId = campaign.id;

  // Check send window — skip tick if outside business hours
  if (!isInSendWindow(campaign)) {
    logger.debug('[Scheduler] Campaign outside send window, skipping', {
      campaignId,
      timezone: campaign.timezone,
    });
    // Advance next_run_at to next valid window
    const nextRun = _calculateNextRun(campaign);
    if (nextRun) {
      db.prepare('UPDATE campaigns SET next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextRun.toISOString(), new Date().toISOString(), campaignId);
    }
    return;
  }

  // Check end_at boundary
  if (campaign.end_at && new Date() > new Date(campaign.end_at)) {
    logger.info('[Scheduler] Campaign past end_at, transitioning to completed', { campaignId });
    service.updateCampaign(campaignId, { status: 'completed', next_run_at: null });
    return;
  }

  // Check max_runs via schedule_config
  let scheduleCfg = {};
  try { scheduleCfg = JSON.parse(campaign.schedule_config || '{}'); } catch (_) {}

  const maxRuns = scheduleCfg.max_runs || null;
  const runCount = scheduleCfg.run_count || 0;

  if (maxRuns !== null && runCount >= maxRuns) {
    logger.info('[Scheduler] Campaign reached max_runs, transitioning to completed', {
      campaignId, maxRuns, runCount,
    });
    service.updateCampaign(campaignId, { status: 'completed', next_run_at: null });
    return;
  }

  logger.info('[Scheduler] Triggering scheduled run', { campaignId, name: campaign.name });

  try {
    await runner.runCampaign(campaignId, {
      runType: 'scheduled',
      triggeredBy: 'scheduler',
      triggeredByEmail: 'scheduler@system',
      notes: `Scheduled run — tick at ${new Date().toISOString()}`,
    });

    // Advance run_count in schedule_config
    scheduleCfg.run_count = runCount + 1;

    // For 'once' mode: no next run; transition to completed
    if (campaign.schedule_mode === 'once') {
      service.updateCampaign(campaignId, {
        status: 'completed',
        next_run_at: null,
        schedule_config: JSON.stringify(scheduleCfg),
        last_run_at: new Date().toISOString(),
        last_run_status: 'triggered',
      });
      logger.info('[Scheduler] One-time campaign triggered, transitioning to completed', { campaignId });
      return;
    }

    // For recurring/hybrid: calculate next run
    const nextRun = _calculateNextRun(campaign);
    service.updateCampaign(campaignId, {
      next_run_at: nextRun ? nextRun.toISOString() : null,
      schedule_config: JSON.stringify(scheduleCfg),
      last_run_at: new Date().toISOString(),
      last_run_status: 'triggered',
    });

    logger.info('[Scheduler] Next run scheduled', {
      campaignId,
      nextRun: nextRun ? nextRun.toISOString() : 'none',
    });

  } catch (err) {
    logger.error('[Scheduler] Failed to trigger campaign run', {
      campaignId,
      error: err.message,
    });
    // Don't crash the scheduler; mark the campaign as errored
    try {
      service.updateCampaign(campaignId, {
        status: 'errored',
        last_run_status: 'scheduler_error',
        last_run_at: new Date().toISOString(),
      });
    } catch (_) {}
  }
}

/**
 * Calculate the next run datetime for a campaign.
 * Uses recurrence_rule if set, otherwise builds one from schedule_config.
 */
function _calculateNextRun(campaign) {
  let scheduleCfg = {};
  try { scheduleCfg = JSON.parse(campaign.schedule_config || '{}'); } catch (_) {}

  return getNextCampaignRun(scheduleCfg, campaign.timezone || 'America/Chicago', new Date());
}

/**
 * Called after a campaign is scheduled via the API.
 * Sets the initial next_run_at value.
 */
function initializeNextRun(campaignId) {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return;

  if (campaign.schedule_mode === 'once' && campaign.scheduled_at) {
    db.prepare('UPDATE campaigns SET next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(campaign.scheduled_at, new Date().toISOString(), campaignId);
    return;
  }

  const nextRun = _calculateNextRun(campaign);
  if (nextRun) {
    db.prepare('UPDATE campaigns SET next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRun.toISOString(), new Date().toISOString(), campaignId);
  }
}

/**
 * Returns summary of scheduler state for health check / admin UI.
 */
function getSchedulerStatus() {
  const db = getDb();
  const now = new Date().toISOString();

  const scheduled = db.prepare(`
    SELECT COUNT(*) as cnt FROM campaigns
    WHERE status IN('scheduled','active')
    AND schedule_mode != 'manual'
    AND next_run_at IS NOT NULL
  `).get().cnt;

  const overdue = db.prepare(`
    SELECT COUNT(*) as cnt FROM campaigns
    WHERE status IN('scheduled','active')
    AND schedule_mode != 'manual'
    AND next_run_at IS NOT NULL
    AND next_run_at < ?
  `).get(now).cnt;

  const upcoming = db.prepare(`
    SELECT id, name, next_run_at, timezone, schedule_mode
    FROM campaigns
    WHERE status IN('scheduled','active')
    AND schedule_mode != 'manual'
    AND next_run_at IS NOT NULL
    AND next_run_at >= ?
    ORDER BY next_run_at ASC
    LIMIT 5
  `).all(now);

  return { scheduled, overdue, upcoming };
}

module.exports = { schedulerTick, initializeNextRun, getSchedulerStatus };
