# Campaign Target Specification

**Version:** 1.0  
**Date:** 2026-04-17  
**Owner:** Engineering — Google Antigravity  

---

## Complete Campaign Object (All Fields)

```json
{
  "id": "uuid",
  "slug": "my-campaign-name-abc12345",

  // Identity
  "name": "string (required, max 200)",
  "objective": "string (recommended)",
  "description": "string",
  "priority": "normal | high | critical | low",
  "channel_type": "email | linkedin | multi",
  "tags": ["string"],
  "notes": "string",

  // Ownership
  "owner_user_id": "uuid → users.id",
  "created_by": "uuid → users.id",

  // Status
  "status": "draft | validation_failed | ready | scheduled | running | active | paused | completed | archived | errored",
  "preflight_status": "unchecked | pass | warn | fail",
  "preflight_score": "0–100",

  // Audience
  "icp_config": {
    "industries": ["string"],
    "employee_count_min": 10,
    "employee_count_max": 500,
    "locations": ["Houston, TX"],
    "titles": ["CEO", "Founder"],
    "tags_include": ["string"],
    "tags_exclude": ["string"],
    "domains_exclude": ["competitor.com"]
  },

  // Sender
  "sender_profile_id": "uuid → sender_profiles.id",
  "sender_config": {
    "from_email": "string",
    "from_name": "string",
    "reply_to_email": "string",
    "smtp_override": {}
  },
  "reply_to_email": "string",

  // Sequence
  "sequence_id": "uuid → sequences.id",

  // Rate limits
  "daily_limit": "integer (legacy alias)",
  "max_daily_sends": "integer",
  "max_hourly_sends": "integer",

  // Timezone & schedule
  "timezone": "IANA timezone string",
  "start_at": "ISO datetime",
  "end_at": "ISO datetime",
  "schedule_mode": "manual | once | recurring | hybrid",
  "scheduled_at": "ISO datetime",
  "next_run_at": "ISO datetime",
  "last_run_at": "ISO datetime",
  "last_run_status": "completed | failed | cancelled",

  // Behavior flags
  "allow_manual_runs": "boolean",
  "require_preflight": "boolean",
  "review_mode": "manual | auto",

  // Policy blobs
  "auto_send_policy": {
    "enabled": false,
    "spam_score_threshold": 3.0,
    "tone_score_threshold": 0.7
  },
  "compliance_config": {
    "require_unsubscribe_footer": true,
    "suppress_existing_customers": true,
    "internal_test_recipients": ["test@example.com"],
    "opt_out_policy": "global_suppression | campaign_only"
  },
  "schedule_config": {
    "days_of_week": [1,2,3,4,5],
    "send_window_start": 8,
    "send_window_end": 17,
    "recurrence_rule": "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
    "max_runs": null,
    "run_count": 0
  },

  // Timestamps
  "archived_at": "ISO datetime | null",
  "created_at": "ISO datetime",
  "updated_at": "ISO datetime",

  // Computed (read-only, not stored)
  "contact_count": 0,
  "contact_counts": { "total":0,"pending":0,"sent":0,"opened":0,"replied":0,"bounced":0,"unsubscribed":0,"suppressed":0 },
  "sent_count": 0,
  "pending_drafts": 0,
  "queued_jobs": 0,
  "last_run": {}
}
```

---

## Campaign Lifecycle States and Transitions

```
draft ──────────────────────────────────────────────────────► archived
  │                                                               ▲
  │ (validate passes)                                             │
  ▼                                                               │
validation_failed ──(fix issues)──► draft                         │
  │                                                               │
  │ (validate passes)                                             │
  ▼                                                               │
ready ──────────────────────────────────────────────────────────► archived
  │                                                               ▲
  │ (schedule set)                         ┌─────────────────────┤
  ▼                                        │                     │
scheduled ──(time arrives)──► running      │                     │
  │                              │         │                     │
  │ (pause)                      │         │                     │
  ▼                              │         │                     │
paused ◄─────────────────────────┘         │                     │
  │                                        │                     │
  │ (resume)                               │                     │
  ▼                                        │                     │
active ──────────────(run starts)──► running ──(complete)──► completed
  │                                        │
  │                              (error)   │
  └────────────────────────────────────────┘
                                        errored ──(fix)──► draft
```

### State Semantics
- **draft**: Just created, editing in progress, preflight not run
- **validation_failed**: Preflight ran and has blocking errors
- **ready**: Preflight passed (score ≥ threshold), awaiting activation
- **scheduled**: Has a future `scheduled_at`, will auto-run
- **active**: Enabled for manual and/or recurring runs, no run in progress
- **running**: A run is currently executing
- **paused**: Temporarily halted; can resume
- **completed**: `end_at` passed or max_runs reached; no further runs
- **archived**: Soft-deleted, terminal
- **errored**: Last run failed fatally; needs operator review

### Allowed Transitions Matrix
| From | Allowed To |
|------|------------|
| draft | ready, validation_failed, active, archived |
| validation_failed | draft, ready, archived |
| ready | scheduled, active, running, archived, draft |
| scheduled | running, active, paused, archived, ready |
| active | paused, completed, archived, running, errored |
| running | paused, completed, archived, errored, active |
| paused | active, running, scheduled, archived |
| completed | archived, draft |
| errored | draft, active, archived |
| archived | (none — use /unarchive endpoint → draft) |

---

## Related Entities Needed

### sender_profiles (NEW — to be created)
```
id TEXT PK
name TEXT NOT NULL
from_email TEXT NOT NULL
from_name TEXT
reply_to_email TEXT
smtp_host TEXT
smtp_port INTEGER
smtp_user TEXT
smtp_pass TEXT (encrypted)
daily_send_limit INTEGER DEFAULT 100
hourly_send_limit INTEGER DEFAULT 20
warmup_mode INTEGER DEFAULT 0
warmup_limit INTEGER DEFAULT 10
domain_verified INTEGER DEFAULT 0
spf_verified INTEGER DEFAULT 0
dkim_verified INTEGER DEFAULT 0
owner_user_id TEXT
created_at TEXT
updated_at TEXT
```

### campaign_schedules (NEW — to be created)
```
id TEXT PK
campaign_id TEXT NOT NULL REFERENCES campaigns(id)
mode TEXT NOT NULL              -- 'once' | 'recurring' | 'hybrid'
timezone TEXT NOT NULL
scheduled_at TEXT               -- for 'once' mode
recurrence_rule TEXT            -- RRULE string for recurring
days_of_week TEXT DEFAULT '[1,2,3,4,5]'  -- JSON array
send_window_start INTEGER DEFAULT 8
send_window_end INTEGER DEFAULT 17
max_runs INTEGER                -- null = unlimited
run_count INTEGER DEFAULT 0
next_run_at TEXT
last_run_at TEXT
enabled INTEGER DEFAULT 1
created_at TEXT
updated_at TEXT
```

### campaign_audit_logs (NEW — campaign-scoped view of audit_logs)
Already exists in global `audit_logs` table with `entity_type='campaign'` and `entity_id=campaign_id`. No new table needed; need a filtered view/API endpoint.

---

## User Roles and Permissions

| Action | analyst | reviewer | operator | admin |
|--------|---------|---------|---------|-------|
| List campaigns | ✓ | ✓ | ✓ | ✓ |
| View campaign detail | ✓ | ✓ | ✓ | ✓ |
| Create campaign | ✗ | ✗ | ✓ | ✓ |
| Edit campaign | ✗ | ✗ | ✓ | ✓ |
| Archive campaign | ✗ | ✗ | ✓ | ✓ |
| Clone campaign | ✗ | ✗ | ✓ | ✓ |
| Run preflight | ✗ | ✗ | ✓ | ✓ |
| Manual run / dry run | ✗ | ✗ | ✓ | ✓ |
| Approve drafts | ✗ | ✓ | ✓ | ✓ |
| Schedule campaign | ✗ | ✗ | ✓ | ✓ |
| View analytics | ✓ | ✓ | ✓ | ✓ |
| Manage exclusions | ✗ | ✗ | ✓ | ✓ |
| Delete/purge | ✗ | ✗ | ✗ | ✓ |

---

## Operator Workflows

### Workflow 1: New Campaign from Scratch
1. POST /campaigns → status=draft
2. Add contacts (via discovery run or manual import)
3. Create/link sequence with steps
4. Select sender profile
5. POST /campaigns/:id/validate → get preflight report
6. Fix blocking issues, re-validate until score ≥ 80
7. POST /campaigns/:id/activate → status=active
8. Optional: POST /campaigns/:id/schedule
9. POST /campaigns/:id/run or wait for scheduled trigger

### Workflow 2: Clone and Modify
1. POST /campaigns/:id/clone → new draft
2. Modify audience ICP, sender, or sequence
3. Validate, activate, run

### Workflow 3: Manual Review Mode
1. Run generates drafts → status=pending_review
2. Reviewer sees pending drafts list (GET /api/v1/messages?campaign_id=X&status=pending_review)
3. Reviewer approves or rejects each draft
4. POST /campaigns/:id/approve-all-drafts (bulk) or individual approval
5. Approved drafts are enqueued for delivery

### Workflow 4: Auto-Send Mode
1. Set review_mode=auto and auto_send_policy thresholds
2. Pipeline worker auto-approves drafts meeting spam/tone thresholds
3. Drafts failing thresholds fall back to manual review

### Workflow 5: Scheduled Recurring
1. Configure schedule_config with recurrence_rule
2. POST /campaigns/:id/schedule
3. Campaign scheduler fires at next_run_at, runs pipeline, updates run_count
4. Schedule calculates next_run_at after each run
5. Pause stops scheduling without losing config; Resume restores it

---

## Scheduling Model

### Modes
- **manual**: Runs only when operator triggers POST /run
- **once**: Runs once at `scheduled_at`, then moves to `completed`
- **recurring**: Runs on `recurrence_rule` schedule (RRULE) within `start_at` / `end_at` window
- **hybrid**: Supports both manual triggers AND automatic schedule

### Schedule Enforcement
- All times evaluated in `campaign.timezone` (IANA string)
- Send window enforced: `send_window_start` to `send_window_end` (hours, local time)
- Business days enforcement: `days_of_week` array
- Daily limit: `max_daily_sends` — enforced per calendar day in campaign timezone
- Hourly limit: `max_hourly_sends` — enforced per clock hour
- Duplicate prevention: idempotency key per run = `run:all:{campaign_id}:{YYYY-MM-DDTHH:MM}`

### Scheduler Worker (to be built)
A new `campaign.scheduler.js` worker runs every 60 seconds and:
1. Queries campaigns WHERE `status IN('scheduled','active') AND schedule_mode != 'manual' AND next_run_at <= now()`
2. For each matching campaign, fires `runCampaign()` with `runType='scheduled'`
3. Updates `next_run_at` based on recurrence rule
4. Handles `max_runs` enforcement and auto-transition to `completed`

---

## Manual Run Model

### Full Run
`POST /api/v1/campaigns/:id/run`
- Body: `{ dry_run: boolean, notes: string }`
- Immediately returns the `campaign_runs` record (status=pending)
- Execution is async via workers
- Stages run in order: generate → send (discovery/enrichment are separate)

### Stage Run
`POST /api/v1/campaigns/:id/run/stage`
- Body: `{ stage: "discovery"|"enrichment"|"generate"|"send", dry_run: boolean, limit: number }`
- Runs only the specified stage
- Useful for debugging or targeted operations

### Dry Run
`POST /api/v1/campaigns/:id/dry-run`
- Simulates the run without writing any send_events or changing contact statuses
- Returns projected counts: would-generate, would-send
- Marks run as `run_type=dry_run`

### Test Send
`POST /api/v1/campaigns/:id/test-send`
- Body: `{ recipients: ["email@example.com"] }`
- Sends actual emails to internal test recipients only
- Contacts are NOT progressed; real audience is not touched

---

## Validation Rules

### Blocking (campaign cannot run)
- Name must be present
- SMTP must be configured (SMTP_USER, SMTP_PASS)
- Sender email must be present and contain @
- Daily send limit must be > 0
- At least one eligible contact (not bounced/unsubscribed/suppressed)
- Active sequence must exist and have at least one step
- review_mode must be 'manual' or 'auto'
- If schedule_mode != 'manual': scheduled_at must be set

### Warning (run allowed but operator should review)
- No objective defined
- Campaign name > 200 chars
- Daily limit > 500
- Scheduled datetime is in the past
- Sequence steps missing content/templates
- Contacts in audience are in global suppression list
- SMTP host not explicitly configured
- Unsubscribe footer enforcement disabled
- No pending contacts (all already processed)
- start_at after end_at

### Scoring
- score = (passed_checks / total_checks) × 100
- status = 'fail' if any blocking failures, 'warn' if warnings only, 'pass' if all clear
- Threshold for activation: score ≥ 60 with no blocking errors

---

## Analytics Model

### Per-Campaign Stats (from send_events)
- total_sent, delivered, opened, clicked, replied, bounced, unsubscribed
- Rates: open_rate, click_rate, reply_rate, bounce_rate (as percentages)

### Sequence Funnel (per step)
- step_number, step_name, sent_count, open_count, click_count, reply_count, bounce_count

### Metrics Trend (from campaign_metrics_snapshots)
- Daily point-in-time snapshots of contact pipeline health
- contacts_total, pending, sent, opened, clicked, replied, bounced, unsubscribed, suppressed
- drafts_pending, approved, rejected
- jobs_queued

### Run Metrics (from campaign_runs)
- Per-run: contacts_processed, emails_queued, emails_sent, emails_failed, drafts_generated
- Run timeline: started_at, finished_at, duration
- Step breakdown via campaign_run_steps

---

## All 15 Phases Mapped to Concrete Deliverables

### Phase 0: Repository Cleanup and Foundation
**Deliverables:**
- Remove hardcoded secrets from config.js
- Add `.env.example` with all required variables
- Standardize package.json engines field
- Fix SQL injection in legacy db.js (if still present)

### Phase 1: Configuration and Security Hardening
**Deliverables:**
- `src/config/index.js` — validated config with clear error messages
- JWT secret rotation support
- Encrypted SMTP password storage for sender profiles
- CSP headers re-enabled

### Phase 2: Database Foundation
**Deliverables:**
- Migration v6 (COMPLETE — already in migrations.js)
- `sender_profiles` table (NEW)
- `campaign_schedules` table (NEW)
- Indexes on all FK and filter columns (COMPLETE)

### Phase 3: Campaign Domain Model (COMPLETE)
**Deliverables:**
- campaigns table with all enterprise fields (COMPLETE)
- campaign_runs table (COMPLETE)
- campaign_run_steps table (COMPLETE)
- campaign_preflight_results table (COMPLETE)
- campaign_exclusions table (COMPLETE)
- campaign_metrics_snapshots table (COMPLETE)
- sequence_steps extended fields (COMPLETE)

### Phase 4: Campaign Service Layer (COMPLETE)
**Deliverables:**
- campaign.service.js (COMPLETE)
- campaign.validator.js (COMPLETE)
- campaign.runner.js (COMPLETE)
- All CRUD, clone, lifecycle transitions (COMPLETE)
- Exclusions management (COMPLETE)
- Metrics snapshots (COMPLETE)

### Phase 5: Campaign API Routes (COMPLETE)
**Deliverables:**
- All 25+ REST endpoints under /api/v1/campaigns (COMPLETE)
- Audit logging on all mutations (COMPLETE)
- Role-based access control (COMPLETE)

### Phase 6: Preflight Validation Engine (COMPLETE)
**Deliverables:**
- 20+ preflight checks covering basics, sender, audience, sequence, compliance, scheduling (COMPLETE)
- Scoring and status calculation (COMPLETE)
- Persistence to campaign_preflight_results (COMPLETE)

### Phase 7: Sender Profiles
**Deliverables:**
- `sender_profiles` migration
- `src/services/sender.service.js` — CRUD + domain verification checks
- `src/api/sender-profiles.js` — REST API
- UI: sender profile management page
- Link sender profiles to campaigns in preflight

### Phase 8: Campaign Scheduler Worker
**Deliverables:**
- `src/workers/campaign.scheduler.js` — per-campaign schedule evaluation loop
- `campaign_schedules` table migration
- RRULE parsing for recurring schedules
- `next_run_at` calculation
- `max_runs` enforcement and auto-completion
- Integration with existing `startWorkers()`

### Phase 9: Enhanced Analytics
**Deliverables:**
- `analytics.service.js` enhanced with per-sequence-step funnels (PARTIAL — needs step attribution)
- Campaign comparison endpoint: GET /analytics/campaigns/compare
- Automated daily snapshot cron at midnight
- Export endpoint: GET /campaigns/:id/analytics/export (CSV)

### Phase 10: Campaign Builder UI
**Deliverables:**
- Multi-tab campaign builder in `public/index.html`:
  - Tab 1: Basics (name, objective, owner, priority, tags, notes)
  - Tab 2: Audience (ICP filters, size preview with live count)
  - Tab 3: Sender (profile selector, limits, reply-to)
  - Tab 4: Sequence (step editor, delays, stop conditions)
  - Tab 5: Schedule (mode selector, timezone, windows, RRULE)
  - Tab 6: Compliance (suppression, unsubscribe, test recipients)
  - Tab 7: Preflight (readiness score widget, validation results, test send)

### Phase 11: Campaign Detail UI Enhancement
**Deliverables:**
- Full audit log tab in campaign detail
- Run retry button (requires Phase 12)
- Trend chart (replace text with canvas sparkline)
- Stage funnel visualization
- Readiness score donut chart

### Phase 12: Runs Management API Enhancement
**Deliverables:**
- `POST /campaigns/:id/runs/:runId/retry` — retry a failed run
- `GET /campaigns/:id/runs/:runId/log` — full step-by-step execution log
- Run comparison endpoint
- Runs export (CSV)

### Phase 13: Compliance and Suppression Hardening
**Deliverables:**
- Per-campaign exclusion list UI (PARTIAL — exists, needs UI polish)
- Global suppression sync on every run (PARTIAL — compliance.service.js exists)
- Unsubscribe link generation with HMAC tokens (tracker.js handles basic case)
- Bounce handling: auto-add to suppression
- CAN-SPAM footer injection in all outbound emails

### Phase 14: Observability and Operations
**Deliverables:**
- Health check endpoint enhanced with worker status
- Telegram/webhook alerts on campaign errors
- Failed jobs dashboard in admin UI
- Per-campaign error rate monitoring
- Structured logging with campaign_id and run_id in all log events

### Phase 15: Multi-tenant / Workspace Foundation
**Deliverables:**
- `workspaces` table
- `workspace_id` foreign key on all entity tables
- Data isolation middleware
- Workspace admin role
- Cross-workspace campaign template sharing
