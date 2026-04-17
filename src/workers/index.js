'use strict';

const { processLoop } = require('./queue');
const { pipelineHandler } = require('./pipeline.worker');
const { deliveryHandler } = require('./delivery.worker');
const { enrichmentHandler } = require('./enrichment.worker');
const logger = require('../utils/logger');

const HANDLERS = {
  run_sequence_step: pipelineHandler,
  send_email: deliveryHandler,
  enrich_contact: enrichmentHandler,
};

let _worker = null;

function startWorkers(pollIntervalMs = 30000) {
  if (_worker) return;
  logger.info('Starting background workers');
  _worker = processLoop(HANDLERS, pollIntervalMs);
}

function stopWorkers() {
  if (_worker) {
    _worker.stop();
    _worker = null;
    logger.info('Background workers stopped');
  }
}

module.exports = { startWorkers, stopWorkers };
