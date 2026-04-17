'use strict';

// Set required env vars before config loads
process.env.JWT_SECRET = process.env.JWT_SECRET || 'seed-script-placeholder-not-used';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'seed-script-placeholder';

require('dotenv').config();

const { getDb, closeDb } = require('../src/db');
const { seed } = require('../src/db/seeds');

async function run() {
  console.log('[seed] Running seed...');
  const db = getDb();
  await seed(db);
  console.log('[seed] Done.');
  closeDb();
}

run().catch(err => {
  console.error('[seed] FATAL:', err.message);
  process.exit(1);
});
