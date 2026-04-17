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
  },
  {
    version: 6,
    description: 'Enterprise campaign system — extended fields, runs, preflight, exclusions, metrics snapshots',
    up(db) {
      // Extend campaigns table (SQLite only supports ADD COLUMN)
      const campCols = db.prepare("PRAGMA table_info(campaigns)").all().map(c => c.name);
      const addCampaignCol = (col, def) => {
        if (!campCols.includes(col)) db.exec(`ALTER TABLE campaigns ADD COLUMN ${col} ${def}`);
      };
      addCampaignCol('objective', 'TEXT');
      addCampaignCol('priority', "TEXT DEFAULT 'normal'");
      addCampaignCol('channel_type', "TEXT DEFAULT 'email'");
      addCampaignCol('tags', "TEXT DEFAULT '[]'");
      addCampaignCol('notes', 'TEXT');
      addCampaignCol('owner_user_id', 'TEXT');
      addCampaignCol('sequence_id', 'TEXT');
      addCampaignCol('timezone', "TEXT DEFAULT 'America/Chicago'");
      addCampaignCol('start_at', 'TEXT');
      addCampaignCol('end_at', 'TEXT');
      addCampaignCol('max_daily_sends', 'INTEGER DEFAULT 10');
      addCampaignCol('max_hourly_sends', 'INTEGER DEFAULT 5');
      addCampaignCol('allow_manual_runs', 'INTEGER DEFAULT 1');
      addCampaignCol('require_preflight', 'INTEGER DEFAULT 1');
      addCampaignCol('review_mode', "TEXT DEFAULT 'manual'");
      addCampaignCol('auto_send_policy', "TEXT DEFAULT '{}'");
      addCampaignCol('compliance_config', "TEXT DEFAULT '{}'");
      addCampaignCol('schedule_mode', "TEXT DEFAULT 'manual'");
      addCampaignCol('scheduled_at', 'TEXT');
      addCampaignCol('last_run_at', 'TEXT');
      addCampaignCol('last_run_status', 'TEXT');
      addCampaignCol('next_run_at', 'TEXT');
      addCampaignCol('archived_at', 'TEXT');
      addCampaignCol('sender_profile_id', 'TEXT');
      addCampaignCol('reply_to_email', 'TEXT');
      addCampaignCol('preflight_status', "TEXT DEFAULT 'unchecked'");
      addCampaignCol('preflight_score', 'INTEGER DEFAULT 0');
      addCampaignCol('slug', 'TEXT');

      // Extend sequence_steps table
      const stepCols = db.prepare("PRAGMA table_info(sequence_steps)").all().map(c => c.name);
      const addStepCol = (col, def) => {
        if (!stepCols.includes(col)) db.exec(`ALTER TABLE sequence_steps ADD COLUMN ${col} ${def}`);
      };
      addStepCol('step_type', "TEXT DEFAULT 'email'");
      addStepCol('send_window_start', 'INTEGER DEFAULT 8');
      addStepCol('send_window_end', 'INTEGER DEFAULT 17');
      addStepCol('business_days_only', 'INTEGER DEFAULT 1');
      addStepCol('stop_on_reply', 'INTEGER DEFAULT 1');
      addStepCol('stop_on_unsubscribe', 'INTEGER DEFAULT 1');
      addStepCol('stop_on_bounce', 'INTEGER DEFAULT 1');
      addStepCol('skip_condition', 'TEXT');
      addStepCol('fallback_body', 'TEXT');
      addStepCol('updated_at', 'TEXT');

      db.exec(`
        -- Campaign runs: track every execution event
        CREATE TABLE IF NOT EXISTS campaign_runs (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id),
          run_type TEXT NOT NULL DEFAULT 'manual',
          triggered_by TEXT,
          triggered_by_email TEXT,
          stage TEXT DEFAULT 'all',
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT,
          finished_at TEXT,
          idempotency_key TEXT UNIQUE,
          contacts_processed INTEGER DEFAULT 0,
          contacts_skipped INTEGER DEFAULT 0,
          emails_queued INTEGER DEFAULT 0,
          emails_sent INTEGER DEFAULT 0,
          emails_failed INTEGER DEFAULT 0,
          drafts_generated INTEGER DEFAULT 0,
          error_message TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_campaign_runs_campaign ON campaign_runs(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_campaign_runs_status ON campaign_runs(status, created_at);

        -- Step-level log within a run
        CREATE TABLE IF NOT EXISTS campaign_run_steps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES campaign_runs(id),
          step_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT,
          finished_at TEXT,
          items_processed INTEGER DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_run_steps_run ON campaign_run_steps(run_id);

        -- Preflight validation results
        CREATE TABLE IF NOT EXISTS campaign_preflight_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id),
          checked_at TEXT NOT NULL DEFAULT (datetime('now')),
          score INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'unchecked',
          results TEXT DEFAULT '[]',
          blocking_count INTEGER DEFAULT 0,
          warning_count INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_preflight_campaign ON campaign_preflight_results(campaign_id, checked_at);

        -- Campaign-specific exclusion lists (beyond global suppression)
        CREATE TABLE IF NOT EXISTS campaign_exclusions (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id),
          email TEXT,
          domain TEXT,
          reason TEXT DEFAULT 'manual',
          added_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_exclusions_campaign ON campaign_exclusions(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_exclusions_email ON campaign_exclusions(email) WHERE email IS NOT NULL;

        -- Point-in-time metrics snapshots for trend analysis
        CREATE TABLE IF NOT EXISTS campaign_metrics_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id),
          snapshot_date TEXT NOT NULL,
          contacts_total INTEGER DEFAULT 0,
          contacts_pending INTEGER DEFAULT 0,
          contacts_sent INTEGER DEFAULT 0,
          contacts_opened INTEGER DEFAULT 0,
          contacts_clicked INTEGER DEFAULT 0,
          contacts_replied INTEGER DEFAULT 0,
          contacts_bounced INTEGER DEFAULT 0,
          contacts_unsubscribed INTEGER DEFAULT 0,
          contacts_suppressed INTEGER DEFAULT 0,
          drafts_pending INTEGER DEFAULT 0,
          drafts_approved INTEGER DEFAULT 0,
          drafts_rejected INTEGER DEFAULT 0,
          jobs_queued INTEGER DEFAULT 0,
          UNIQUE(campaign_id, snapshot_date)
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_snap_campaign ON campaign_metrics_snapshots(campaign_id, snapshot_date);
      `);
    }
  },
  {
    version: 7,
    description: 'Sender profiles, campaign schedule_enabled flag',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sender_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          from_email TEXT NOT NULL,
          from_name TEXT,
          reply_to_email TEXT,
          smtp_host TEXT,
          smtp_port INTEGER DEFAULT 587,
          smtp_user TEXT,
          smtp_pass_enc TEXT,
          daily_send_limit INTEGER DEFAULT 100,
          hourly_send_limit INTEGER DEFAULT 20,
          warmup_mode INTEGER DEFAULT 0,
          warmup_limit INTEGER DEFAULT 10,
          domain_verified INTEGER DEFAULT 0,
          spf_verified INTEGER DEFAULT 0,
          dkim_verified INTEGER DEFAULT 0,
          active INTEGER DEFAULT 1,
          owner_user_id TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sender_profiles_owner ON sender_profiles(owner_user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_profiles_email ON sender_profiles(from_email);
      `);

      // Add schedule_enabled to campaigns if missing
      const campCols = db.prepare('PRAGMA table_info(campaigns)').all().map(c => c.name);
      if (!campCols.includes('schedule_enabled')) {
        db.exec("ALTER TABLE campaigns ADD COLUMN schedule_enabled INTEGER DEFAULT 1");
      }
    }
  },
  {
    version: 8,
    description: 'Prospect searches and prospect pool',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prospect_searches (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id),
          query TEXT NOT NULL DEFAULT '{}',
          source TEXT NOT NULL DEFAULT 'apollo',
          status TEXT NOT NULL DEFAULT 'completed',
          result_count INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prospect_searches_user ON prospect_searches(user_id);
        CREATE INDEX IF NOT EXISTS idx_prospect_searches_created ON prospect_searches(created_at);

        CREATE TABLE IF NOT EXISTS prospect_pool (
          id TEXT PRIMARY KEY,
          search_id TEXT REFERENCES prospect_searches(id),
          user_id TEXT REFERENCES users(id),
          first_name TEXT,
          last_name TEXT,
          email TEXT,
          title TEXT,
          company_name TEXT,
          industry TEXT,
          city TEXT,
          state TEXT,
          country TEXT,
          linkedin_url TEXT,
          phone TEXT,
          source TEXT DEFAULT 'manual',
          tags TEXT DEFAULT '[]',
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_prospect_pool_status ON prospect_pool(status);
        CREATE INDEX IF NOT EXISTS idx_prospect_pool_user ON prospect_pool(user_id);
        CREATE INDEX IF NOT EXISTS idx_prospect_pool_email ON prospect_pool(email);
      `);

      // Add prospect_pool_id to contacts if missing
      const contactCols = db.prepare('PRAGMA table_info(contacts)').all().map(c => c.name);
      if (!contactCols.includes('prospect_pool_id')) {
        db.exec('ALTER TABLE contacts ADD COLUMN prospect_pool_id TEXT');
      }
    }
  },
  {
    version: 9,
    description: 'Prospect pool email uniqueness, draft rejection reason',
    up(db) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_pool_email_unique
          ON prospect_pool(email) WHERE email IS NOT NULL;
      `);

      const draftCols = db.prepare('PRAGMA table_info(message_drafts)').all().map(c => c.name);
      if (!draftCols.includes('rejection_reason')) {
        db.exec('ALTER TABLE message_drafts ADD COLUMN rejection_reason TEXT');
      }
    }
  },
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
