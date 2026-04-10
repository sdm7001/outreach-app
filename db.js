const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'outreach.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY,
      company_name TEXT,
      domain TEXT,
      industry TEXT,
      employee_count INTEGER,
      city TEXT,
      state TEXT,
      contact_name TEXT,
      contact_title TEXT,
      contact_email TEXT,
      score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      outreach_angle TEXT,
      email_subject TEXT,
      email_body TEXT,
      sent_at DATETIME,
      opened_at DATETIME,
      clicked_at DATETIME,
      replied_at DATETIME,
      bounced_at DATETIME,
      unsubscribed_at DATETIME,
      source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      prospects_found INTEGER DEFAULT 0,
      emails_sent INTEGER DEFAULT 0,
      emails_opened INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      bounces INTEGER DEFAULT 0,
      unsubscribes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS email_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id TEXT,
      event_type TEXT,
      event_data TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prospect_id) REFERENCES prospects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS idx_prospects_industry ON prospects(industry);
    CREATE INDEX IF NOT EXISTS idx_prospects_created ON prospects(created_at);
    CREATE INDEX IF NOT EXISTS idx_email_events_prospect ON email_events(prospect_id);
  `);
}

// Prospect operations
function addProspect(data) {
  const d = getDb();
  const id = data.id || uuidv4();
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO prospects (id, company_name, domain, industry, employee_count, city, state, contact_name, contact_title, contact_email, score, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.company_name, data.domain, data.industry, data.employee_count,
    data.city || 'Houston', data.state || 'TX', data.contact_name, data.contact_title,
    data.contact_email, data.score || 0, data.source || 'apollo');
  return id;
}

function getPendingProspects(limit = 10) {
  const d = getDb();
  return d.prepare('SELECT * FROM prospects WHERE status = ? ORDER BY score DESC, created_at ASC LIMIT ?').all('pending', limit);
}

function getProspectsReadyForEmail(limit = 10) {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM prospects
    WHERE status = 'enriched' AND contact_email IS NOT NULL AND email_body IS NOT NULL
    ORDER BY score DESC LIMIT ?
  `).all(limit);
}

function getProspectsNeedingMessages(limit = 10) {
  const d = getDb();
  return d.prepare(`
    SELECT * FROM prospects
    WHERE status = 'enriched' AND contact_email IS NOT NULL AND email_body IS NULL
    ORDER BY score DESC LIMIT ?
  `).all(limit);
}

function updateProspect(id, data) {
  const d = getDb();
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  d.prepare(`UPDATE prospects SET ${fields} WHERE id = ?`).run(...values, id);
}

function getProspectById(id) {
  const d = getDb();
  return d.prepare('SELECT * FROM prospects WHERE id = ?').get(id);
}

function prospectExists(companyName, domain) {
  const d = getDb();
  return d.prepare('SELECT id FROM prospects WHERE company_name = ? OR domain = ?').get(companyName, domain);
}

// Stats operations
function getTodayStats() {
  const d = getDb();
  const today = new Date().toISOString().split('T')[0];
  let stats = d.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today);
  if (!stats) {
    d.prepare('INSERT OR IGNORE INTO daily_stats (date) VALUES (?)').run(today);
    stats = d.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today);
  }
  return stats;
}

function incrementStat(field) {
  const d = getDb();
  const today = new Date().toISOString().split('T')[0];
  d.prepare('INSERT OR IGNORE INTO daily_stats (date) VALUES (?)').run(today);
  d.prepare(`UPDATE daily_stats SET ${field} = ${field} + 1 WHERE date = ?`).run(today);
}

function getStats() {
  const d = getDb();
  const today = new Date().toISOString().split('T')[0];
  const todayStats = d.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today) || {};
  const totals = d.prepare(`
    SELECT
      COUNT(*) as total_prospects,
      SUM(CASE WHEN status = 'sent' OR status = 'opened' OR status = 'replied' THEN 1 ELSE 0 END) as total_sent,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as total_opened,
      SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as total_replied,
      SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as total_bounced
    FROM prospects
  `).get();
  return { today: todayStats, totals };
}

// Event logging
function logEvent(prospectId, eventType, eventData = '', ip = '', userAgent = '') {
  const d = getDb();
  d.prepare(`
    INSERT INTO email_events (prospect_id, event_type, event_data, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(prospectId, eventType, eventData, ip, userAgent);
}

module.exports = {
  getDb,
  addProspect,
  getPendingProspects,
  getProspectsReadyForEmail,
  getProspectsNeedingMessages,
  updateProspect,
  getProspectById,
  prospectExists,
  getTodayStats,
  incrementStat,
  getStats,
  logEvent
};
