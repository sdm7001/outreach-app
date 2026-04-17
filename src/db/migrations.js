'use strict';

const MIGRATIONS = [
  {
    version: 1,
    description: 'Users table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          name TEXT,
          role TEXT NOT NULL DEFAULT 'analyst',
          active INTEGER NOT NULL DEFAULT 1,
          last_login TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
    }
  },
  {
    version: 2,
    description: 'Campaigns, accounts, contacts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          description TEXT,
          icp_config TEXT DEFAULT '{}',
          sender_config TEXT DEFAULT '{}',
          schedule_config TEXT DEFAULT '{}',
          daily_limit INTEGER DEFAULT 10,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          company_name TEXT NOT NULL,
          domain TEXT,
          industry TEXT,
          employee_count INTEGER,
          city TEXT,
          state TEXT,
          source TEXT DEFAULT 'manual',
          tags TEXT DEFAULT '[]',
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_domain ON accounts(domain) WHERE domain IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_accounts_industry ON accounts(industry);

        CREATE TABLE IF NOT EXISTS contacts (
          id TEXT PRIMARY KEY,
          account_id TEXT REFERENCES accounts(id),
          campaign_id TEXT REFERENCES campaigns(id),
          first_name TEXT,
          last_name TEXT,
          email TEXT,
          title TEXT,
          email_source TEXT DEFAULT 'unknown',
          email_verified INTEGER DEFAULT 0,
          score INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          lifecycle_state TEXT DEFAULT 'prospect',
          last_contacted_at TEXT,
          outreach_angle TEXT,
          tags TEXT DEFAULT '[]',
          notes TEXT,
          source TEXT DEFAULT 'manual',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
        CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
        CREATE INDEX IF NOT EXISTS idx_contacts_campaign ON contacts(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
      `);
    }
  },
  {
    version: 3,
    description: 'Sequences, message drafts, send events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sequences (
          id TEXT PRIMARY KEY,
          campaign_id TEXT REFERENCES campaigns(id),
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sequence_steps (
          id TEXT PRIMARY KEY,
          sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
          step_number INTEGER NOT NULL,
          delay_days INTEGER NOT NULL DEFAULT 0,
          delay_hours INTEGER NOT NULL DEFAULT 0,
          subject_template TEXT,
          body_template TEXT,
          tone TEXT DEFAULT 'professional',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_seq_steps_order ON sequence_steps(sequence_id, step_number);

        CREATE TABLE IF NOT EXISTS message_drafts (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL REFERENCES contacts(id),
          campaign_id TEXT REFERENCES campaigns(id),
          sequence_step_id TEXT REFERENCES sequence_steps(id),
          subject TEXT,
          body TEXT,
          ai_model TEXT,
          prompt_version TEXT DEFAULT 'v1',
          spam_score REAL DEFAULT 0,
          tone_score REAL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending_review',
          reviewed_by TEXT REFERENCES users(id),
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_drafts_contact ON message_drafts(contact_id);
        CREATE INDEX IF NOT EXISTS idx_drafts_status ON message_drafts(status);
        CREATE INDEX IF NOT EXISTS idx_drafts_campaign ON message_drafts(campaign_id);

        CREATE TABLE IF NOT EXISTS send_events (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL REFERENCES contacts(id),
          campaign_id TEXT REFERENCES campaigns(id),
          sequence_step_id TEXT REFERENCES sequence_steps(id),
          draft_id TEXT REFERENCES message_drafts(id),
          recipient_email TEXT NOT NULL,
          subject TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          sent_at TEXT,
          opened_at TEXT,
          clicked_at TEXT,
          replied_at TEXT,
          bounced_at TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_send_events_contact ON send_events(contact_id);
        CREATE INDEX IF NOT EXISTS idx_send_events_campaign ON send_events(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_send_events_status ON send_events(status);
      `);
    }
  },
  {
    version: 4,
    description: 'Email events, suppression, audit log, jobs queue',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT,
          send_event_id TEXT REFERENCES send_events(id),
          event_type TEXT NOT NULL,
          event_data TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_email_events_contact ON email_events(contact_id);
        CREATE INDEX IF NOT EXISTS idx_email_events_type ON email_events(event_type, created_at);

        CREATE TABLE IF NOT EXISTS suppression (
          id TEXT PRIMARY KEY,
          email TEXT,
          domain TEXT,
          reason TEXT NOT NULL DEFAULT 'manual',
          source TEXT DEFAULT 'manual',
          added_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_suppression_email ON suppression(email) WHERE email IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_suppression_domain ON suppression(domain) WHERE domain IS NOT NULL;

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT,
          user_email TEXT,
          action TEXT NOT NULL,
          entity_type TEXT,
          entity_id TEXT,
          old_values TEXT,
          new_values TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT,
          failed_at TEXT,
          error_message TEXT,
          idempotency_key TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
      `);
    }
  },
  {
    version: 5,
    description: 'Daily stats with campaign dimension',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          campaign_id TEXT,
          prospects_found INTEGER DEFAULT 0,
          emails_sent INTEGER DEFAULT 0,
          emails_opened INTEGER DEFAULT 0,
          clicks INTEGER DEFAULT 0,
          replies INTEGER DEFAULT 0,
          bounces INTEGER DEFAULT 0,
          unsubscribes INTEGER DEFAULT 0,
          UNIQUE(date, campaign_id)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
        CREATE INDEX IF NOT EXISTS idx_daily_stats_campaign ON daily_stats(campaign_id);
      `);
    }
  }
];

function runMigrations(db) {
  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  const pending = MIGRATIONS.filter(m => !applied.has(m.version));
  if (pending.length === 0) return;

  const applyMigration = db.transaction((migration) => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)').run(
      migration.version, migration.description
    );
  });

  for (const migration of pending) {
    console.log(`[DB] Applying migration ${migration.version}: ${migration.description}`);
    applyMigration(migration);
    console.log(`[DB] Migration ${migration.version} applied`);
  }
}

module.exports = { runMigrations, MIGRATIONS };
