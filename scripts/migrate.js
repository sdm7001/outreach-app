'use strict';

// Standalone migration runner — sets dummy env vars so config doesn't exit
process.env.JWT_SECRET = process.env.JWT_SECRET || 'migrate-script-placeholder';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'migrate-script-placeholder';

require('dotenv').config();

const { getDb, closeDb } = require('../src/db');

console.log('[migrate] Initializing database and running migrations...');
try {
  const db = getDb();
  const applied = db.prepare('SELECT version, description, applied_at FROM schema_migrations ORDER BY version').all();
  console.log(`[migrate] Applied migrations: ${applied.length}`);
  applied.forEach(m => console.log(`  v${m.version}: ${m.description} (${m.applied_at})`));
  console.log('[migrate] All migrations up to date.');
  closeDb();
  process.exit(0);
} catch (err) {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
}
