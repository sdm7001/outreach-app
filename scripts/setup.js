'use strict';

require('dotenv').config();

// Placeholders let getConfig() pass validation during setup; real values come from .env above
process.env.JWT_SECRET = process.env.JWT_SECRET || 'setup-script-placeholder-not-used';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'setup-script-placeholder';

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, closeDb } = require('../src/db');

async function setup() {
  console.log('[setup] Initializing Outreach Enterprise Platform...');

  const db = getDb();
  console.log('[setup] Database initialized and migrations applied.');

  // Create admin user
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || adminPassword === 'setup-script-placeholder') {
    console.error('[setup] ERROR: ADMIN_PASSWORD environment variable is required.');
    console.error('[setup] Copy .env.example to .env and set a strong ADMIN_PASSWORD.');
    process.exit(1);
  }

  if (adminPassword.length < 8) {
    console.error('[setup] ERROR: ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (existing) {
    console.log(`[setup] Admin user already exists: ${adminEmail}`);
  } else {
    const hash = await bcrypt.hash(adminPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (id,email,password_hash,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
      .run(id, adminEmail, hash, 'Admin User', 'admin', now, now);
    console.log(`[setup] Admin user created: ${adminEmail}`);
  }

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const campaignCount = db.prepare('SELECT COUNT(*) as c FROM campaigns').get().c;
  console.log(`[setup] Setup complete. Users: ${userCount}, Campaigns: ${campaignCount}`);
  console.log('[setup] Start the app with: npm start');
  console.log(`[setup] Login at http://localhost:${process.env.PORT || 3848} with: ${adminEmail}`);

  closeDb();
}

setup().catch(err => {
  console.error('[setup] FATAL:', err.message);
  process.exit(1);
});
