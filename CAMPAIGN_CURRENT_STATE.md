# Campaign Current State Audit

**Repository:** https://github.com/sdm7001/outreach-app  
**Audit Date:** 2026-04-17  
**Auditor:** Senior Principal Engineer, Google Antigravity  

---

## What Campaign-Related Functionality Exists

The repository has been significantly upgraded from the original flat-script prototype into a structured Node.js + Express + SQLite enterprise platform. Campaign management is the core domain and is substantially implemented across the following layers:

### Implemented
- Campaign CRUD (create, read, update, delete/archive)
- Campaign lifecycle state machine (draft → ready → scheduled → running → active → paused → completed → archived → errored)
- Campaign cloning
- Per-campaign preflight validation engine with scoring
- Campaign run tracking (campaign_runs, campaign_run_steps)
- Campaign-scoped exclusion lists
- Campaign metrics snapshots (point-in-time analytics)
- Campaign stage-based execution: discovery → enrichment → generate → send
- Dry-run and test-send modes
- Bulk draft approval with spam score threshold
- Failed job requeue
- Preview endpoints (recipients, drafts)
- Schedule management (set scheduled_at, mode, timezone)
- Pause / resume / activate / unarchive transitions
- Audit logging on all campaign mutations
- Campaign analytics endpoint with sequence funnel
- JWT-authenticated REST API under /api/v1/campaigns
- Role-based access control (admin > operator > reviewer > analyst)
- Full single-page admin UI (vanilla JS, mobile-responsive)

### Not Yet Implemented
- Recurring schedule engine (cron.js only runs global pipeline, not per-campaign)
- Per-campaign scheduled execution hook into the enterprise scheduler
- Campaign builder multi-step form (UI has basic form but missing schedule/compliance/preflight tabs)
- Campaign runs retry endpoint (runs can be cancelled but not retried from the UI)
- Sender profile entity (sender_profile_id is stored but no profiles table or management UI)
- Campaign sequences management is partially in the sequences API but not fully linked in the builder
- AI-generated test email preview in the UI
- Campaign audit log viewer in the UI

---

## Current Data Model (Actual Field Names from Schema)

### campaigns (migration v2 + v6)
```
id TEXT PK
name TEXT NOT NULL
slug TEXT
status TEXT DEFAULT 'draft'
description TEXT
objective TEXT
priority TEXT DEFAULT 'normal'
channel_type TEXT DEFAULT 'email'
icp_config TEXT DEFAULT '{}'           -- JSON: ICP filter rules
sender_config TEXT DEFAULT '{}'        -- JSON: from_email, from_name, smtp overrides
schedule_config TEXT DEFAULT '{}'      -- JSON: windows, days_of_week, etc.
auto_send_policy TEXT DEFAULT '{}'     -- JSON: auto-send thresholds
compliance_config TEXT DEFAULT '{}'   -- JSON: unsubscribe settings, internal_test_recipients
daily_limit INTEGER DEFAULT 10
max_daily_sends INTEGER DEFAULT 10
max_hourly_sends INTEGER DEFAULT 5
timezone TEXT DEFAULT 'America/Chicago'
start_at TEXT
end_at TEXT
allow_manual_runs INTEGER DEFAULT 1
require_preflight INTEGER DEFAULT 1
review_mode TEXT DEFAULT 'manual'      -- 'manual' | 'auto'
schedule_mode TEXT DEFAULT 'manual'    -- 'manual' | 'once' | 'recurring'
scheduled_at TEXT
last_run_at TEXT
last_run_status TEXT
next_run_at TEXT
archived_at TEXT
sender_profile_id TEXT
reply_to_email TEXT
preflight_status TEXT DEFAULT 'unchecked'  -- 'unchecked' | 'pass' | 'warn' | 'fail'
preflight_score INTEGER DEFAULT 0
sequence_id TEXT
tags TEXT DEFAULT '[]'
notes TEXT
owner_user_id TEXT
created_by TEXT REFERENCES users(id)
created_at TEXT
updated_at TEXT
```

### campaign_runs (migration v6)
```
id TEXT PK
campaign_id TEXT NOT NULL REFERENCES campaigns(id)
run_type TEXT DEFAULT 'manual'        -- 'manual' | 'scheduled' | 'dry_run' | 'test' | 'stage'
triggered_by TEXT
triggered_by_email TEXT
stage TEXT DEFAULT 'all'              -- 'all' | 'discovery' | 'enrichment' | 'generate' | 'send'
status TEXT DEFAULT 'pending'        -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
started_at TEXT
finished_at TEXT
idempotency_key TEXT UNIQUE
contacts_processed INTEGER DEFAULT 0
contacts_skipped INTEGER DEFAULT 0
emails_queued INTEGER DEFAULT 0
emails_sent INTEGER DEFAULT 0
emails_failed INTEGER DEFAULT 0
drafts_generated INTEGER DEFAULT 0
error_message TEXT
notes TEXT
created_at TEXT
```

### campaign_run_steps (migration v6)
```
id INTEGER PK AUTOINCREMENT
run_id TEXT NOT NULL REFERENCES campaign_runs(id)
step_name TEXT NOT NULL
status TEXT DEFAULT 'pending'
started_at TEXT
finished_at TEXT
items_processed INTEGER DEFAULT 0
error_message TEXT
created_at TEXT
```

### campaign_preflight_results (migration v6)
```
id INTEGER PK AUTOINCREMENT
campaign_id TEXT NOT NULL REFERENCES campaigns(id)
checked_at TEXT
score INTEGER DEFAULT 0
status TEXT DEFAULT 'unchecked'       -- 'unchecked' | 'pass' | 'warn' | 'fail'
results TEXT DEFAULT '[]'             -- JSON array of check results
blocking_count INTEGER DEFAULT 0
warning_count INTEGER DEFAULT 0
```

### campaign_exclusions (migration v6)
```
id TEXT PK
campaign_id TEXT NOT NULL REFERENCES campaigns(id)
email TEXT
domain TEXT
reason TEXT DEFAULT 'manual'
added_by TEXT
created_at TEXT
```

### campaign_metrics_snapshots (migration v6)
```
id INTEGER PK AUTOINCREMENT
campaign_id TEXT NOT NULL REFERENCES campaigns(id)
snapshot_date TEXT NOT NULL
contacts_total INTEGER DEFAULT 0
contacts_pending INTEGER DEFAULT 0
contacts_sent INTEGER DEFAULT 0
contacts_opened INTEGER DEFAULT 0
contacts_clicked INTEGER DEFAULT 0
contacts_replied INTEGER DEFAULT 0
contacts_bounced INTEGER DEFAULT 0
contacts_unsubscribed INTEGER DEFAULT 0
contacts_suppressed INTEGER DEFAULT 0
drafts_pending INTEGER DEFAULT 0
drafts_approved INTEGER DEFAULT 0
drafts_rejected INTEGER DEFAULT 0
jobs_queued INTEGER DEFAULT 0
UNIQUE(campaign_id, snapshot_date)
```

### sequences + sequence_steps (migration v3 + v6 extensions)
```
-- sequences
id TEXT PK, campaign_id TEXT, name TEXT, status TEXT, created_at, updated_at

-- sequence_steps (extended fields added in v6)
id TEXT PK, sequence_id TEXT, step_number INTEGER, delay_days INTEGER, delay_hours INTEGER,
subject_template TEXT, body_template TEXT, tone TEXT,
step_type TEXT DEFAULT 'email',
send_window_start INTEGER DEFAULT 8, send_window_end INTEGER DEFAULT 17,
business_days_only INTEGER DEFAULT 1, stop_on_reply INTEGER DEFAULT 1,
stop_on_unsubscribe INTEGER DEFAULT 1, stop_on_bounce INTEGER DEFAULT 1,
skip_condition TEXT, fallback_body TEXT, updated_at TEXT
```

---

## Current API Routes

All routes are prefixed `/api/v1/` and require `Authorization: Bearer <jwt>`.

### Campaign Core
| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | /campaigns | analyst+ | List with filters: status, search, priority, owner_user_id, schedule_mode, page, limit |
| POST | /campaigns | operator+ | Create campaign |
| GET | /campaigns/:id | analyst+ | Get campaign with enriched stats |
| PUT | /campaigns/:id | operator+ | Update campaign fields |
| DELETE | /campaigns/:id | operator+ | Archive campaign |

### Campaign Lifecycle
| POST | /campaigns/:id/activate | operator+ | Activate (requires preflight pass if require_preflight=1) |
| POST | /campaigns/:id/pause | operator+ | Pause |
| POST | /campaigns/:id/resume | operator+ | Resume to active or scheduled |
| POST | /campaigns/:id/schedule | operator+ | Set scheduled_at + schedule_mode |
| POST | /campaigns/:id/unschedule | operator+ | Remove schedule, reset to ready |
| POST | /campaigns/:id/unarchive | operator+ | Restore archived campaign to draft |
| POST | /campaigns/:id/clone | operator+ | Clone to new draft |

### Preflight Validation
| POST | /campaigns/:id/validate | operator+ | Run preflight, store result, update score |
| GET | /campaigns/:id/preflight | analyst+ | Get latest preflight result |

### Run Controls
| POST | /campaigns/:id/run | operator+ | Full pipeline run (supports dry_run flag) |
| POST | /campaigns/:id/run/stage | operator+ | Single-stage run (discovery/enrichment/generate/send) |
| POST | /campaigns/:id/dry-run | operator+ | Dry run alias |
| POST | /campaigns/:id/test-send | operator+ | Send to internal test recipients |
| POST | /campaigns/:id/approve-all-drafts | operator+ | Bulk approve safe drafts (spam_threshold param) |
| POST | /campaigns/:id/requeue-failed | operator+ | Requeue dead jobs |

### Preview
| GET | /campaigns/:id/preview/recipients | analyst+ | Preview eligible contacts |
| GET | /campaigns/:id/preview/drafts | analyst+ | Preview pending drafts |

### Runs
| GET | /campaigns/:id/runs | analyst+ | List runs (limit, status filters) |
| GET | /campaigns/:id/runs/:runId | analyst+ | Get run with step log |
| POST | /campaigns/:id/runs/:runId/cancel | operator+ | Cancel a running/pending run |

### Analytics
| GET | /campaigns/:id/analytics | analyst+ | Stats + sequence funnel + trend |
| GET | /campaigns/:id/analytics/trend | analyst+ | Metrics trend (days param, max 90) |
| POST | /campaigns/:id/analytics/snapshot | operator+ | Manually take metrics snapshot |

### Exclusions
| GET | /campaigns/:id/exclusions | analyst+ | List exclusions |
| POST | /campaigns/:id/exclusions | operator+ | Add email/domain exclusion |
| DELETE | /campaigns/:id/exclusions/:exclusionId | operator+ | Remove exclusion |

### Sequence Helper
| GET | /campaigns/:id/sequence | analyst+ | Get linked sequence with steps |

---

## Current Scheduler Behavior

The scheduler is a **hybrid split** — the old `cron.js` at repo root handles global pipeline scheduling, while the new enterprise system has campaign-aware infrastructure but has not yet connected them:

### Old cron.js (legacy, still active on app startup)
Runs Monday-Friday CT on a fixed global schedule:
- 6:00 AM: `findProspects()` — Apollo/Places discovery (global, no campaign context)
- 7:00 AM: `enrichProspects()` — Hunter.io enrichment (global)
- 8:00 AM: `generateMessages()` — Claude AI draft generation (global)
- 9:00 AM: `sendEmails()` — nodemailer delivery (global)
- 5:00 PM: `sendDailyReport()` — Telegram report

### New worker infrastructure (enterprise, partial)
- `src/workers/queue.js` — SQLite job queue with retry, backoff, idempotency
- `src/workers/pipeline.worker.js` — sequence step execution per contact
- `src/workers/delivery.worker.js` — email delivery
- `src/workers/enrichment.worker.js` — contact enrichment
- `src/workers/discovery.worker.js` — prospect discovery
- `src/workers/index.js` — startWorkers() polls queue every 30 seconds

### Gap
There is no per-campaign scheduled runner. `campaign.service.js` has `scheduleCampaign()` and stores `scheduled_at` / `next_run_at`, but nothing fires when that time arrives. A campaign scheduler worker is needed.

---

## Current Manual-Run Behavior

1. Operator clicks "Run Now" in UI → calls `POST /api/v1/campaigns/:id/run`
2. API creates a `campaign_runs` record with status=`pending`
3. `campaign.runner.js` `runCampaign()` fires asynchronously
4. Stages execute: generate → send (discovery/enrichment are optional stage-specific runs)
5. Each stage enqueues jobs into the `jobs` table
6. Workers poll the jobs table every 30 seconds and process them
7. Run record is updated to `completed` or `failed` with metrics

---

## Current UI Components

The entire frontend is a single `public/index.html` file (1,779 lines) using vanilla JS with no framework:

### Campaign List Page
- Filter tabs: All / Active / Draft / Paused / Completed / Archived
- Search input with debounce
- Campaign cards: name, status badge, owner, channel type, contact counts, pending drafts, run button
- Clone button per card
- Create New Campaign button → opens builder modal

### Campaign Detail Page (slide-in overlay within Campaigns page)
- Header: name, status badge, schedule info, action buttons (Run, Pause, Resume, Schedule, Validate, Archive)
- Tabs: Overview | Analytics | Sequence | Runs | Exclusions | Settings

#### Overview Tab
- KPI cards: contacts, pending, sent, replied
- Preflight result card
- Recipient preview list

#### Analytics Tab
- KPI cards: sent, opened, clicked, replied
- Rate stats: open rate, click rate, reply rate, bounce rate
- Sequence funnel table
- 14-day trend sparkline (text-only currently)

#### Sequence Tab
- Linked sequence info
- Step list: delay, subject, tone

#### Runs Tab
- Run history table: type, stage, status, contacts processed, drafts, sent, errors, timestamp
- Cancel button per run

#### Exclusions Tab
- List of email/domain exclusions
- Add exclusion form

#### Settings Tab
- Edit form: name, description, objective, priority, timezone, daily limit, review mode
- Danger zone: archive, clone

### Campaign Builder (modal)
- Basic form: name, objective, description, priority, channel type
- ICP JSON textarea
- Sender JSON textarea
- Schedule config section (basic)
- Missing: full multi-tab builder, compliance tab, preflight tab

---

## Gaps and Risks

### Critical Gaps
1. **No per-campaign scheduler** — `next_run_at` is stored but never evaluated
2. **No sender profiles entity** — `sender_profile_id` stored but no profiles table
3. **Old cron.js still fires global pipeline** — conflicts with enterprise campaign-scoped runs
4. **Campaign builder UI is incomplete** — no sequence builder, no schedule wizard, no compliance config
5. **No runs retry** — API has `/cancel` but no `/retry` endpoint
6. **Missing campaign_schedules table** — schedule_config is a JSON blob, not a proper entity
7. **No campaign_audit_logs table** — audit goes to global `audit_logs`, not campaign-scoped

### Security Risks
- JWT stored in localStorage (XSS risk)
- Old `config.js` at repo root may have hardcoded secrets

### Data Integrity Risks
- `icp_config`, `sender_config`, `schedule_config` are unvalidated JSON blobs
- No enforcement of sequence_id FK at DB level (SQLite without foreign key enforcement)
- campaign_run idempotency key is per-minute — two runs in same minute would collide

### Performance Risks
- `_enrichCampaign()` runs 4 separate queries per campaign on every GET
- `listCampaigns()` uses correlated subqueries per row — will degrade at scale
- No pagination on runs, exclusions, or audit logs in most list endpoints

---

## Legacy Assumptions to Remove

1. **Global pipeline assumption** — `cron.js` assumes one global campaign pipeline. Must be removed or converted to per-campaign dispatch.
2. **Single-tenant assumption** — no workspace/tenant concept; all data is global.
3. **`prospect_finder.js` / `contact-enricher.js` at root** — old flat-file scripts; enterprise uses workers.
4. **Hardcoded timezone** — multiple places default `America/Chicago` but campaign has `timezone` field; must always use campaign's timezone.
5. **`daily_limit` vs `max_daily_sends`** — two columns mean the same thing; should consolidate to `max_daily_sends`.
6. **`campaign_id` on contacts table** — contacts are campaign-scoped 1:1, but enterprise campaigns need contacts to be reusable. This is a schema design debt.
7. **Status `active` vs `running`** — the distinction is inconsistent; `active` means "in the queue" while `running` means "a run is in progress." This needs clearer documentation and enforcement.
