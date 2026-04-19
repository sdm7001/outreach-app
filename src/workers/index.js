'use strict';

const { processLoop } = require('./queue');
const { pipelineHandler, campaignRunHandler } = require('./pipeline.worker');
const { deliveryHandler } = require('./delivery.worker');
const { enrichmentHandler } = require('./enrichment.worker');
const { discoverHandler } = require('./discovery.worker');
const { schedulerTick } = require('./campaign.scheduler');
const { autoProspectTick } = require('./auto-prospect.worker');
const logger = require('../utils/logger');

const HANDLERS = {
  run_sequence_step:              pipelineHandler,
  generate_drafts_for_campaign:   campaignRunHandler,
  send_email:                     deliveryHandler,
  enrich_contact:                 enrichmentHandler,
  discover_prospects:             discoverHandler,
};

// Auto-prospecting interval — default 6 hours, override via AUTO_PROSPECT_INTERVAL_HOURS
const AUTO_PROSPECT_INTERVAL_MS = (parseInt(process.env.AUTO_PROSPECT_INTERVAL_HOURS) || 6) * 60 * 60 * 1000;
const AUTO_PROSPECT_ICP = process.env.AUTO_PROSPECT_ICP || 'icp1';

let _worker = null;
let _schedulerTimer = null;
let _autoProspectTimer = null;
const SCHEDULER_INTERVAL_MS = 60_000; // 60 seconds

function startWorkers(pollIntervalMs = 30000) {
  if (_worker) return;
  logger.info('Starting campaign workers', { types: Object.keys(HANDLERS) });
  _worker = processLoop(HANDLERS, pollIntervalMs);

  // Start the per-campaign scheduler
  _startScheduler();

  // Start auto-prospecting loop
  _startAutoProspecting();
}

function _startAutoProspecting() {
  if (_autoProspectTimer) return;
  logger.info('[AutoProspect] Starting auto-prospecting loop', {
    intervalHours: AUTO_PROSPECT_INTERVAL_MS / 3600000,
    icp: AUTO_PROSPECT_ICP,
  });

  // Fire once on startup after a short delay
  const firstRun = setTimeout(() => {
    autoProspectTick(AUTO_PROSPECT_ICP).catch(err =>
      logger.error('[AutoProspect] Tick error', { error: err.message })
    );
  }, 15000);

  // Then fire on the configured interval
  _autoProspectTimer = setInterval(() => {
    autoProspectTick(AUTO_PROSPECT_ICP).catch(err =>
      logger.error('[AutoProspect] Tick error', { error: err.message })
    );
  }, AUTO_PROSPECT_INTERVAL_MS);

  _autoProspectTimer._firstRun = firstRun;
}

function _startScheduler() {
  if (_schedulerTimer) return;
  logger.info('[Scheduler] Campaign scheduler starting', { intervalMs: SCHEDULER_INTERVAL_MS });

  // Fire once immediately (after a short delay to let DB settle on startup)
  const firstTick = setTimeout(() => {
    schedulerTick().catch(err =>
      logger.error('[Scheduler] Tick error', { error: err.message })
    );
  }, 5000);

  // Then fire every 60 seconds
  _schedulerTimer = setInterval(() => {
    schedulerTick().catch(err =>
      logger.error('[Scheduler] Tick error', { error: err.message })
    );
  }, SCHEDULER_INTERVAL_MS);

  // Store the initial timeout ref so we can clear it on stop
  _schedulerTimer._firstTick = firstTick;
}

function stopWorkers() {
  if (_worker) {
    _worker.stop();
    _worker = null;
    logger.info('Campaign workers stopped');
  }
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    if (_schedulerTimer._firstTick) clearTimeout(_schedulerTimer._firstTick);
    _schedulerTimer = null;
    logger.info('[Scheduler] Campaign scheduler stopped');
  }
  if (_autoProspectTimer) {
    clearInterval(_autoProspectTimer);
    if (_autoProspectTimer._firstRun) clearTimeout(_autoProspectTimer._firstRun);
    _autoProspectTimer = null;
    logger.info('[AutoProspect] Auto-prospecting loop stopped');
  }
}

module.exports = { startWorkers, stopWorkers };
