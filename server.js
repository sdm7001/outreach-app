'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { getConfig } = require('./src/config');
const { getDb } = require('./src/db');
const logger = require('./src/utils/logger');
const { errorHandler } = require('./src/utils/errors');

// Validate config on startup — exits if required env vars are missing
const config = getConfig();

// Initialize database (runs migrations)
const db = getDb();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow admin UI to load
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

// Health check (no auth)
app.get('/health', (req, res) => {
  let dbOk = false;
  try { db.prepare('SELECT 1').get(); dbOk = true; } catch (_err) {}

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
    db: dbOk ? 'ok' : 'error',
  });
});

// API routes
const authRouter = require('./src/api/auth');
const campaignsRouter = require('./src/api/campaigns');
const accountsRouter = require('./src/api/accounts');
const contactsRouter = require('./src/api/contacts');
const sequencesRouter = require('./src/api/sequences');
const messagesRouter = require('./src/api/messages');
const analyticsRouter = require('./src/api/analytics');
const suppressionRouter = require('./src/api/suppression');
const auditRouter = require('./src/api/audit');
const trackingRouter = require('./src/api/tracking');
const adminRouter = require('./src/api/admin');

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/campaigns', campaignsRouter);
app.use('/api/v1/accounts', accountsRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/sequences', sequencesRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/suppression', suppressionRouter);
app.use('/api/v1/audit', auditRouter);
app.use('/api/v1/admin', adminRouter);

// Tracking endpoints (public, no auth required)
app.use('/t', trackingRouter);
app.get('/unsubscribe/:token', require('./src/api/tracking').unsubscribeHandler);

// Serve admin UI from public/ directory
const path = require('path');
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/t/') && !req.path.startsWith('/unsubscribe')) {
      res.sendFile(path.join(publicDir, 'index.html'));
    }
  });
}

// Global error handler (must be last)
app.use(errorHandler);

// Only start the HTTP server when this file is the entry point (not when required by tests)
if (require.main === module) {
  const server = app.listen(config.PORT, () => {
    logger.info(`Outreach Enterprise API started`, {
      port: config.PORT,
      env: config.NODE_ENV,
      reviewMode: config.REVIEW_MODE,
    });

    const { startWorkers } = require('./src/workers');
    startWorkers();
  });

  function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      try { db.close(); } catch (_err) {}
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
