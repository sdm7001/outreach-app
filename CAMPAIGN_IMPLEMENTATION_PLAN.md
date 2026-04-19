# Campaign Implementation Plan

**Version:** 1.0  
**Date:** 2026-04-17  
**Stack:** Node.js 18, Express 4, better-sqlite3, Vanilla JS SPA  

---

## Phase Overview

| Phase | Name | Priority | Est. Effort | Status |
|-------|------|----------|-------------|--------|
| 0 | Cleanup & Foundation | P0 | 1 day | DONE |
| 1 | Config & Security | P0 | 1 day | DONE |
| 2 | Database Foundation | P0 | 0.5 day | DONE |
| 3 | Campaign Domain Model | P0 | 1 day | DONE |
| 4 | Campaign Service Layer | P0 | 2 days | DONE |
| 5 | Campaign API Routes | P0 | 1 day | DONE |
| 6 | Preflight Validation | P0 | 1 day | DONE |
| 7 | Sender Profiles | P1 | 1.5 days | PENDING |
| 8 | Campaign Scheduler | P1 | 2 days | PENDING |
| 9 | Enhanced Analytics | P2 | 1.5 days | PARTIAL |
| 10 | Campaign Builder UI | P1 | 3 days | PARTIAL |
| 11 | Campaign Detail UI | P2 | 2 days | PARTIAL |
| 12 | Runs Management API | P2 | 1 day | PARTIAL |
| 13 | Compliance Hardening | P1 | 1.5 days | PARTIAL |
| 14 | Observability | P2 | 1 day | PENDING |
| 15 | Multi-tenant | P3 | 5 days | PENDING |

---

## Phase 7: Sender Profiles

### Backend Tasks
1. **Migration v7** — Add `sender_profiles` table
   - File: `src/db/migrations.js` (append new migration object)
   - Fields: id, name, from_email, from_name, reply_to_email, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, daily_send_limit, hourly_send_limit, warmup_mode, warmup_limit, domain_verified, spf_verified, dkim_verified, owner_user_id, created_at, updated_at

2. **Sender Service** — `src/services/sender.service.js`
   - createSenderProfile(data, userId)
   - getSenderProfile(id)
   - listSenderProfiles({ userId })
   - updateSenderProfile(id, data)
   - deleteSenderProfile(id)
   - verifySenderDomain(id) — check SPF/DKIM records
   - getEffectiveSenderConfig(campaignId) — returns merged sender profile + campaign overrides

3. **Sender API** — `src/api/sender-profiles.js`
   - GET /sender-profiles — list profiles
   - POST /sender-profiles — create profile
   - GET /sender-profiles/:id — get profile
   - PUT /sender-profiles/:id — update
   - DELETE /sender-profiles/:id — delete
   - POST /sender-profiles/:id/verify — trigger domain verification

4. **Preflight Update** — Update `campaign.validator.js` to call `getEffectiveSenderConfig()` and validate the linked profile's SMTP credentials and rate limits

### Frontend Tasks
1. Add "Sender Profiles" nav item to sidebar
2. Sender profiles list page with status badges (domain verified, SPF/DKIM)
3. Create/edit sender profile form
4. Campaign builder sender tab: dropdown to select profile, override fields
5. Preflight card: show sender profile verification status

### Migration Tasks
- Run migration v7 on next server start (auto-applied by runMigrations)
- Existing campaigns: sender_profile_id remains null until operator links one

### Testing Tasks
- Unit tests: sender.service.js CRUD
- Integration tests: GET/POST /sender-profiles endpoints
- Preflight tests: campaign with unverified sender profile shows WARNING

### Deployment Implications
- No breaking changes; sender_profile_id is optional for now
- Future: make sender_profile_id required for campaigns in 'ready' state

---

## Phase 8: Campaign Scheduler Worker

### Backend Tasks
1. **Migration v8** — Add `campaign_schedules` table and add `schedule_enabled` to campaigns
   - File: `src/db/migrations.js`

2. **Campaign Scheduler Worker** — `src/workers/campaign.scheduler.js`
   - Exported function: `schedulerTick()`
   - Logic:
     ```
     SELECT campaigns WHERE status IN('scheduled','active')
       AND schedule_mode != 'manual'
       AND next_run_at IS NOT NULL
       AND next_run_at <= datetime('now')
       AND (select count(*) from campaign_runs where campaign_id=c.id and status='running') = 0
     ```
   - For each: call `runCampaign(id, { runType: 'scheduled', ... })`
   - After run: calculate `next_run_at` using RRULE or schedule_config
   - Check `max_runs` limit; transition to `completed` if reached
   - Business-hours enforcement: if current time is outside `send_window_start`/`send_window_end` in campaign timezone, skip and set `next_run_at` to next valid window

3. **RRULE Helper** — `src/utils/rrule.js`
   - `getNextRun(recurrenceRule, timezone, afterDate)` — returns next ISO datetime
   - Simple implementation without external dependency: parse FREQ=DAILY|WEEKLY + BYDAY
   - Fallback: use `schedule_config.days_of_week` + `send_window_start`

4. **Register scheduler in workers/index.js**
   - Import and schedule `schedulerTick()` to run every 60 seconds via `setInterval`
   - Not using node-cron — the existing setInterval pattern in `processLoop` is sufficient

5. **Update `scheduleCampaign()` in campaign.service.js**
   - When `schedule_mode` is set to 'recurring', calculate and store initial `next_run_at`
   - After each scheduled run completes, call `updateNextRunAt(campaignId)` to advance the schedule

### Frontend Tasks
1. Campaign builder Schedule tab: full scheduler form
   - Mode selector: manual / once / recurring / hybrid
   - Once mode: datetime picker for `scheduled_at`
   - Recurring mode: day-of-week checkboxes, time window sliders, max runs input
   - Timezone selector (IANA timezone list)
2. Campaign detail header: show "Next run: X" when scheduled
3. Campaign list: show next_run_at column in table view

### Migration Tasks
- Migration v8 adds campaign_schedules table (optional extended schedule entity)
- Existing campaigns: schedule_config JSON blob is sufficient for basic scheduling

### Testing Tasks
- Unit tests: rrule.js getNextRun for daily, weekly, day-of-week combinations
- Unit tests: schedulerTick with mock DB — verify correct campaigns are selected
- Integration test: schedule a campaign, advance time, verify run is triggered
- Edge case tests: campaign in pause state should not be triggered

### Deployment Implications
- Scheduler runs in the same process as workers; no new process needed
- Must ensure only one instance runs (already handled by campaign run idempotency_key)
- In production: if running multiple Node instances, use a distributed lock or single-worker pattern

---

## Phase 9: Enhanced Analytics

### Backend Tasks
1. **Sequence step attribution** — Update `send_events` and analytics queries to properly attribute opens/clicks/replies to specific sequence steps
2. **Daily snapshot automation** — Add `campaign_metrics_snapshots` cron to workers scheduler (runs at midnight campaign-local time)
3. **Comparison endpoint** — `GET /api/v1/analytics/campaigns/compare?ids=a,b,c` — returns side-by-side stats
4. **CSV export** — `GET /api/v1/campaigns/:id/analytics/export` — returns CSV of send_events for campaign

### Frontend Tasks
1. Replace text-only trend display with canvas-based sparkline chart
2. Stage funnel visualization (horizontal bar chart or funnel SVG)
3. Comparison mode in analytics: side-by-side campaign stats

### Testing Tasks
- Verify snapshot idempotency (ON CONFLICT UPDATE)
- Verify export produces valid CSV with proper escaping

---

## Phase 10: Campaign Builder UI

### Frontend Tasks (all in `public/index.html`)

1. **Multi-tab builder modal** — Replace current basic form with tabbed interface:
   ```
   Tab 1: Basics    — name*, objective, description, priority, channel_type, tags, notes
   Tab 2: Audience  — ICP filters (industry multi-select, employee count range, location, titles, tag filters)
                    — Live contact count preview (debounced API call to /contacts/count)
   Tab 3: Sender    — Profile selector dropdown (GET /sender-profiles)
                    — Override from_email, from_name, reply_to
                    — Rate limits: max_daily_sends, max_hourly_sends
   Tab 4: Sequence  — Linked sequence selector (GET /sequences?campaign_id=X)
                    — Step viewer (read-only list of steps with delays/subject)
                    — "Edit sequence" button opens sequences page
   Tab 5: Schedule  — Mode radio: manual / once / recurring
                    — Timezone selector
                    — Once: datetime picker
                    — Recurring: day-of-week checkboxes, hour range slider
                    — Business days toggle
   Tab 6: Compliance — require_unsubscribe_footer toggle
                    — internal_test_recipients input (comma-separated emails)
                    — opt_out_policy selector
                    — Domain exclusions textarea
   Tab 7: Preflight  — "Run Validation" button (POST /validate)
                    — Readiness score gauge (0-100)
                    — Blocking errors list (red)
                    — Warnings list (yellow)
                    — "Test Send" button
   ```

2. **Tab navigation** — Show tab completion indicators (checkmark if required fields filled)

3. **Autosave** — Debounced save on field changes for existing campaigns (PUT /campaigns/:id)

4. **Form validation** — Client-side checks before POST: name required, email format, number ranges

### Testing Tasks
- Manual testing of each tab in mobile view (320px) and desktop (1200px)
- Verify API calls use correct endpoints and payloads
- Verify error messages display correctly

---

## Phase 11: Campaign Detail UI Enhancement

### Frontend Tasks (all in `public/index.html`)

1. **Audit log tab** — Fetch `GET /api/v1/audit?entity_type=campaign&entity_id=:id` and render as timeline

2. **Run retry button** — Add retry action to failed runs in runs table (requires Phase 12 backend)

3. **Readiness score widget** — Replace text score with circular gauge SVG (0-100 with color coding: red < 60, yellow 60-79, green 80+)

4. **Stage funnel bars** — Horizontal bar visualization in Analytics tab showing discovery → enrichment → generate → send funnel

5. **Trend sparkline** — 14-day mini chart using `<canvas>` API showing sent, opened, replied trend lines

6. **Contacts list tab** — Add new tab showing paginated contacts for this campaign with status filters

### Testing Tasks
- Verify audit log renders correctly with HTML-escaped values
- Verify canvas chart renders in all supported browsers

---

## Phase 12: Runs Management API Enhancement

### Backend Tasks
1. **Retry endpoint** — `POST /api/v1/campaigns/:id/runs/:runId/retry`
   - Validates original run exists and is in `failed` or `cancelled` status
   - Creates a new `campaign_runs` record referencing the original
   - Fires `_executeAllStages()` with the same parameters as the original run
   - Implementation: Add `retryRun(runId, userId)` to campaign.runner.js

2. **Execution log endpoint** — `GET /api/v1/campaigns/:id/runs/:runId/log`
   - Returns full `campaign_run_steps` records for the run
   - Already partially implemented (steps included in `getRun()`)

3. **Runs export** — `GET /api/v1/campaigns/:id/runs/export`
   - Returns CSV of all runs for the campaign

### Frontend Tasks
1. Add "Retry" button to runs table for failed runs (calls POST /retry)
2. Expandable row in runs table showing step-level log
3. Run duration calculation and display

### Testing Tasks
- Verify retry creates new run (not modifying original)
- Verify idempotency key prevents duplicate runs on retry
- Test retry of dry_run — should still be dry_run

---

## Phase 13: Compliance Hardening

### Backend Tasks
1. **Bounce handler** — In delivery.worker.js, when a bounce is received:
   - Update send_event status to 'bounced'
   - Update contact status to 'bounced'
   - Insert into global suppression table
   - Log to audit_logs

2. **Unsubscribe HMAC tokens** — In email-sender.js / delivery.worker.js:
   - Generate HMAC token: `hmac(secret, contact_id + ':' + campaign_id)`
   - Embed in unsubscribe URL: `/unsubscribe/{token}`
   - Validate token on GET /unsubscribe/:token
   - tracker.js already handles the unsubscribe endpoint; needs token validation

3. **CAN-SPAM footer injection** — In message generation pipeline:
   - Append standard footer to all outbound email bodies
   - Footer includes: company name, address, unsubscribe link
   - Configurable per campaign via compliance_config.footer_text

4. **Pre-run compliance gate** — In campaign.runner.js `runCampaign()`:
   - Before executing, re-check suppression for all eligible contacts
   - Skip contacts that have been added to suppression since last run

### Testing Tasks
- Test unsubscribe token validation (valid token, invalid token, expired token)
- Test bounce → suppression flow
- Verify suppressed contacts are skipped in run

### Deployment Implications
- Unsubscribe tokens require consistent JWT_SECRET across instances
- Footer must not break HTML email formatting

---

## Phase 14: Observability

### Backend Tasks
1. **Health check enhancement** — `GET /health`
   - Add worker status (running/stopped)
   - Add pending jobs count
   - Add last successful run timestamp
   - Add db file size

2. **Telegram/webhook alerts** — In campaign.runner.js:
   - Send alert when campaign run fails
   - Send alert when campaign completes with abnormally high bounce rate
   - Reuse existing telegram-report.js infrastructure

3. **Structured log correlation** — Ensure all log events in campaign pipeline include:
   - `campaign_id`
   - `run_id` (when in run context)
   - `contact_id` (when processing individual contacts)
   - `job_id` (when in worker context)

### Testing Tasks
- Verify health check returns 200 with correct worker status

---

## Phase 15: Multi-tenant / Workspace Foundation

### Backend Tasks
1. **Migration v15** — Add `workspaces` table and `workspace_id` FK to all entity tables
2. **Workspace middleware** — Extract workspace from JWT or subdomain
3. **Data isolation** — All queries must include `workspace_id = ?` filter
4. **Workspace admin role** — New role level above admin

### Frontend Tasks
1. Workspace selector in header
2. Workspace settings page
3. Workspace user management

### Migration Tasks
- Massive: all existing data gets assigned to a default workspace
- All queries must be updated — estimate 40+ locations
- Requires careful testing to prevent data leaks

### Deployment Implications
- Breaking change to JWT payload (adds workspace_id claim)
- Requires all clients to re-authenticate
- Consider feature flag to enable/disable multi-tenant mode

---

## Dependencies Between Phases

```
Phase 7 (Sender Profiles) → Phase 6 (Preflight) must be updated to use profiles
Phase 8 (Scheduler) → Phase 3-5 must be complete (DONE)
Phase 9 (Analytics) → Phase 3-5 must be complete (DONE)
Phase 10 (Builder UI) → Phase 7 and Phase 8 should be done first for full form
Phase 11 (Detail UI) → Phase 12 (retry) for retry button
Phase 12 (Runs API) → Phase 4 (campaign service) must be complete (DONE)
Phase 13 (Compliance) → Phase 5 (API routes) must be complete (DONE)
Phase 15 (Multi-tenant) → All other phases must be stable
```

---

## Testing Strategy

### Unit Tests (Jest, in `tests/` directory)
- Each service function with mock DB
- Preflight validation rules in isolation
- RRULE helper parsing logic
- Status transition validation logic

### Integration Tests (supertest)
- All API endpoints with real SQLite in-memory DB
- Auth middleware (valid/invalid/expired tokens)
- RBAC enforcement (role boundary tests)
- Campaign lifecycle end-to-end (create → validate → activate → run)

### Manual QA Checklist (per release)
- [ ] Create campaign via UI builder
- [ ] Run preflight, verify score
- [ ] Manual run (dry-run first, then real)
- [ ] Check run appears in runs list with correct step counts
- [ ] Verify analytics numbers match send_events
- [ ] Test pause/resume cycle
- [ ] Test clone
- [ ] Test archive/unarchive
- [ ] Verify exclusions are respected in run

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Old cron.js conflicts with new campaign scheduler | HIGH | HIGH | Deprecate cron.js; move to campaign-scoped workers |
| SQLite scalability ceiling | MEDIUM | HIGH | Fine for <10k contacts; plan Postgres migration for Phase 15 |
| Campaign scheduler race condition (multiple runs) | MEDIUM | MEDIUM | Idempotency key per-minute already implemented |
| Email deliverability degraded by high send volume | MEDIUM | HIGH | Sender warmup mode in sender profiles |
| Frontend single-file becomes unmaintainable | HIGH | MEDIUM | Plan migration to React/Vite in post-Phase 15 |
