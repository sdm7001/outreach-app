'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

async function seed(db) {
  // Only seed if no users exist
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (existing.c > 0) {
    console.log('[Seed] Users already exist, skipping seed.');
    return;
  }

  console.log('[Seed] Seeding demo data...');

  const adminId = uuidv4();
  const operatorId = uuidv4();
  const campaign1Id = uuidv4();
  const campaign2Id = uuidv4();

  const adminHash = await bcrypt.hash('Admin1234!', 12);
  const operatorHash = await bcrypt.hash('Operator1!', 12);

  // Users
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
    .run(adminId, 'admin@example.com', adminHash, 'Admin User', 'admin');
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
    .run(operatorId, 'operator@example.com', operatorHash, 'Operator User', 'operator');

  // Campaigns
  const icpConfig = JSON.stringify({
    industries: ['Healthcare', 'Dental'],
    titles: ['Office Manager', 'Practice Administrator'],
    locations: ['Houston, TX'],
    employee_min: 25, employee_max: 200
  });
  db.prepare(`INSERT INTO campaigns (id,name,status,description,icp_config,daily_limit,created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(campaign1Id, 'Houston Healthcare Q1', 'active', 'Q1 outreach to Houston healthcare practices', icpConfig, 10, adminId);
  db.prepare(`INSERT INTO campaigns (id,name,status,description,icp_config,daily_limit,created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(campaign2Id, 'Houston Legal Q2', 'draft', 'Q2 outreach to Houston law firms', JSON.stringify({ industries: ['Law Practice', 'Legal Services'] }), 8, adminId);

  // Accounts
  const accounts = [
    { id: uuidv4(), company: 'Houston Family Medicine', domain: 'houstonfamilymedicine.com', industry: 'Healthcare', employees: 45 },
    { id: uuidv4(), company: 'Bayou Dental Group', domain: 'bayoudental.com', industry: 'Dental', employees: 30 },
    { id: uuidv4(), company: 'Gulf Coast Pediatrics', domain: 'gulfcoastpediatrics.com', industry: 'Healthcare', employees: 55 },
    { id: uuidv4(), company: 'Texas Law Partners', domain: 'texaslawpartners.com', industry: 'Law Practice', employees: 40 },
    { id: uuidv4(), company: 'Lone Star CPA Group', domain: 'lonestarcpa.com', industry: 'Accounting', employees: 35 },
  ];

  for (const a of accounts) {
    db.prepare(`INSERT INTO accounts (id,company_name,domain,industry,employee_count,city,state,source) VALUES (?,?,?,?,?,?,?,?)`)
      .run(a.id, a.company, a.domain, a.industry, a.employees, 'Houston', 'TX', 'demo');
  }

  // Contacts
  const contacts = [
    { accountIdx: 0, campaign: campaign1Id, first: 'Sarah', last: 'Johnson', email: 'sjohnson@houstonfamilymedicine.com', title: 'Office Manager', status: 'sent', score: 85, source: 'hunter' },
    { accountIdx: 0, campaign: campaign1Id, first: 'Mike', last: 'Chen', email: 'mchen@houstonfamilymedicine.com', title: 'IT Director', status: 'opened', score: 72, source: 'apollo' },
    { accountIdx: 1, campaign: campaign1Id, first: 'Jennifer', last: 'Park', email: 'jpark@bayoudental.com', title: 'Practice Administrator', status: 'enriched', score: 90, source: 'hunter' },
    { accountIdx: 2, campaign: campaign1Id, first: 'Robert', last: 'Williams', email: 'rwilliams@gulfcoastpediatrics.com', title: 'CEO', status: 'replied', score: 95, source: 'apollo' },
    { accountIdx: 2, campaign: campaign1Id, first: 'Lisa', last: 'Martinez', email: 'lmartinez@gulfcoastpediatrics.com', title: 'Office Manager', status: 'pending', score: 60, source: 'manual' },
    { accountIdx: 3, campaign: campaign2Id, first: 'David', last: 'Thompson', email: 'dthompson@texaslawpartners.com', title: 'Managing Partner', status: 'pending', score: 88, source: 'apollo' },
    { accountIdx: 3, campaign: campaign2Id, first: 'Emily', last: 'Davis', email: 'edavis@texaslawpartners.com', title: 'Operations Manager', status: 'enriched', score: 75, source: 'hunter' },
    { accountIdx: 4, campaign: campaign2Id, first: 'James', last: 'Wilson', email: 'jwilson@lonestarcpa.com', title: 'Owner', status: 'bounced', score: 70, source: 'apollo' },
    { accountIdx: 4, campaign: campaign2Id, first: 'Amanda', last: 'Brown', email: 'abrown@lonestarcpa.com', title: 'Practice Manager', status: 'pending', score: 65, source: 'manual' },
    { accountIdx: 1, campaign: campaign1Id, first: 'Carlos', last: 'Garcia', email: 'cgarcia@bayoudental.com', title: 'Office Manager', status: 'unsubscribed', score: 55, source: 'hunter' },
  ];

  for (const c of contacts) {
    const acc = accounts[c.accountIdx];
    db.prepare(`INSERT INTO contacts (id,account_id,campaign_id,first_name,last_name,email,title,score,status,email_source,email_verified,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), acc.id, c.campaign, c.first, c.last, c.email, c.title, c.score, c.status, c.source, c.source === 'hunter' ? 1 : 0, 'demo');
  }

  // Suppression entry
  db.prepare(`INSERT OR IGNORE INTO suppression (id,email,reason,source) VALUES (?,?,?,?)`)
    .run(uuidv4(), 'test-suppressed@example.com', 'manual', 'demo');

  // Demo daily stats
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`INSERT OR IGNORE INTO daily_stats (date,campaign_id,prospects_found,emails_sent,emails_opened,clicks,replies,bounces,unsubscribes) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(today, campaign1Id, 8, 5, 2, 1, 1, 0, 0);

  console.log('[Seed] Demo data seeded successfully.');
  console.log('[Seed]   admin@example.com / Admin1234!');
  console.log('[Seed]   operator@example.com / Operator1!');
}

module.exports = { seed };
