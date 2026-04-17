'use strict';

require('../setup');

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const HASH_ROUNDS = 4; // Fast for tests

async function createUser(db, overrides = {}) {
  const id = uuidv4();
  const email = overrides.email || `user-${id.slice(0,8)}@test.com`;
  const password = overrides.password || 'TestPass1!';
  const hash = await bcrypt.hash(password, HASH_ROUNDS);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id,email,password_hash,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run(id, email, hash, overrides.name || 'Test User', overrides.role || 'operator', now, now);
  return { id, email, password, role: overrides.role || 'operator' };
}

async function createAdmin(db, overrides = {}) {
  return createUser(db, { ...overrides, role: 'admin', email: overrides.email || 'admin@test.com' });
}

function createCampaign(db, overrides = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO campaigns (id,name,status,description,icp_config,sender_config,schedule_config,daily_limit,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, overrides.name || 'Test Campaign', overrides.status || 'draft',
      overrides.description || null,
      JSON.stringify(overrides.icp_config || {}),
      JSON.stringify(overrides.sender_config || {}),
      JSON.stringify(overrides.schedule_config || {}),
      overrides.daily_limit || 10, now, now);
  return { id, name: overrides.name || 'Test Campaign', status: overrides.status || 'draft' };
}

function createAccount(db, overrides = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO accounts (id,company_name,domain,industry,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, overrides.company_name || 'Test Corp', overrides.domain || `testcorp-${id.slice(0,6)}.com`,
      overrides.industry || 'Healthcare', now, now);
  return { id, company_name: overrides.company_name || 'Test Corp' };
}

function createContact(db, overrides = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO contacts (id,account_id,campaign_id,first_name,last_name,email,title,email_source,score,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, overrides.account_id || null, overrides.campaign_id || null,
      overrides.first_name || 'Jane', overrides.last_name || 'Doe',
      overrides.email || `jane-${id.slice(0,6)}@testcorp.com`,
      overrides.title || 'Manager',
      overrides.email_source || 'manual',
      overrides.score || 75,
      overrides.status || 'pending', now, now);
  return { id, email: overrides.email || `jane-${id.slice(0,6)}@testcorp.com`, status: overrides.status || 'pending' };
}

function createDraft(db, overrides = {}) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO message_drafts (id,contact_id,campaign_id,subject,body,ai_model,spam_score,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, overrides.contact_id, overrides.campaign_id || null,
      overrides.subject || 'Test Subject',
      overrides.body || 'Test email body',
      overrides.ai_model || 'claude-haiku-4-5',
      overrides.spam_score || 0,
      overrides.status || 'pending_review', now);
  return { id, status: overrides.status || 'pending_review' };
}

module.exports = { createUser, createAdmin, createCampaign, createAccount, createContact, createDraft };
