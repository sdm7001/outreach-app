# Implementation Plan

**Status:** IN PROGRESS  
**Last Updated:** 2026-04-17  

---

## Phases

### Phase 0 — Foundation (Sequential, blocking)
**Goal:** Safe, bootable codebase. Critical security fixes. New directory structure.

- [x] Audit existing code → CURRENT_STATE.md
- [x] Define target → TARGET_ARCHITECTURE.md
- [ ] Fix critical security issues in existing files
- [ ] Set up new directory structure under `src/`
- [ ] Update `package.json`: add deps, fix engine field, fix lockfile
- [ ] Create `src/config/index.js` with startup validation (no hardcoded secrets)
- [ ] Create `src/utils/logger.js` (pino structured logging)
- [ ] Create `src/utils/errors.js`
- [ ] Create `src/db/index.js` with migration runner
- [ ] Write all migrations (new enterprise schema)
- [ ] Create `scripts/setup.js` for first-run

### Phase 1 — Core Data + Auth (Can parallelize after Phase 0)
**Goal:** Working auth, user model, campaign model

- [ ] `src/db/migrations.js` — complete schema
- [ ] `src/services/auth.service.js` — bcrypt, JWT with persistent secret
- [ ] `src/api/auth.js` — login/logout/me/change-password
- [ ] `src/middleware/auth.js` + `src/middleware/rbac.js`
- [ ] `src/services/campaign.service.js`
- [ ] `src/api/campaigns.js`
- [ ] `src/services/account.service.js`
- [ ] `src/api/accounts.js`
- [ ] `src/services/contact.service.js`
- [ ] `src/api/contacts.js`

### Phase 2 — Pipeline + Workers (Parallel after Phase 1)
**Goal:** Reliable background processing replacing cron scripts

- [ ] `src/workers/queue.js` — SQLite-backed job queue
- [ ] `src/workers/pipeline.worker.js` — orchestrator
- [ ] `src/workers/enrichment.worker.js`
- [ ] `src/workers/messaging.worker.js` — AI generation with review flow
- [ ] `src/workers/delivery.worker.js` — safe email sending
- [ ] `src/workers/reporting.worker.js`
- [ ] Fix prospect-finder (Apollo v2 + Google Places)
- [ ] Fix contact-enricher (Hunter.io + email source tagging)
- [ ] Fix message-generator (valid model ID, higher max_tokens, prompt versioning)
- [ ] Fix email-sender (TLS enabled, rate limits, suppression check)

### Phase 3 — Compliance + Sequences (Parallel after Phase 1)
**Goal:** Suppression, multi-step sequences, compliance controls

- [ ] `src/services/compliance.service.js` — suppression engine
- [ ] `src/api/suppression.js`
- [ ] `src/services/sequence.service.js`
- [ ] `src/api/sequences.js`
- [ ] `src/api/messages.js` — review queue
- [ ] Unsubscribe enforcement in delivery worker
- [ ] Bounce handling via webhook
- [ ] Reply-stop word detection

### Phase 4 — Analytics + Audit (Parallel after Phase 2)
**Goal:** Visible analytics, complete audit trail

- [ ] `src/services/analytics.service.js`
- [ ] `src/api/analytics.js`
- [ ] `src/services/audit.service.js`
- [ ] `src/middleware/audit.js` — auto-log mutations
- [ ] `src/api/audit.js`

### Phase 5 — Admin UI (Parallel after Phase 1 API)
**Goal:** Production-quality admin interface replacing public/index.html

- [ ] Dashboard overview (stats, queue health, recent activity)
- [ ] Campaigns list + create/edit form
- [ ] Contacts list with search/filter/pagination
- [ ] Accounts list
- [ ] Message review queue
- [ ] Sequence builder
- [ ] Analytics pages
- [ ] Suppression management
- [ ] Audit log viewer
- [ ] Admin settings (users, config)

### Phase 6 — DevOps + Quality (Final wave)
**Goal:** Deployable, tested, documented

- [ ] `.env.example` with all required variables
- [ ] `Dockerfile` + `docker-compose.yml`
- [ ] `.github/workflows/ci.yml`
- [ ] `tests/unit/` — services and utilities
- [ ] `tests/integration/` — API routes
- [ ] Jest configuration
- [ ] `docs/` — SETUP.md, ADMIN_GUIDE.md, API.md, OPERATOR_RUNBOOK.md
- [ ] Updated `README.md`
- [ ] `AGENT_HANDOFFS.md` — coordination notes
- [ ] `FINAL_QC_REPORT.md`

---

## Dependency Graph (Critical Path)

```
Phase 0: Foundation
    └── Phase 1: Auth + Data Layer
            ├── Phase 2: Pipeline Workers
            │       └── Phase 4: Analytics
            ├── Phase 3: Compliance + Sequences
            └── Phase 5: Admin UI (after API routes exist)
                    └── Phase 6: DevOps + QC (final)
```

---

## Touched File Plan (for parallelization safety)

| Agent | Files (exclusive ownership) |
|-------|----------------------------|
| Security/Config Agent | `src/config/`, `src/middleware/auth.js`, `src/middleware/rbac.js`, `src/middleware/rateLimit.js` |
| DB/Schema Agent | `src/db/`, `scripts/` |
| Services Agent | `src/services/` |
| Workers Agent | `src/workers/`, `src/api/admin.js` (jobs view) |
| API Routes Agent | `src/api/` (except admin.js), `server.js` |
| UI Agent | `public/` |
| Tracking Agent | `tracking/` |
| Tests Agent | `tests/` |
| DevOps Agent | `Dockerfile`, `docker-compose.yml`, `.github/`, `.env.example` |
| Docs Agent | `docs/`, `README.md` |

---

## AGENT_HANDOFFS Reference

All agents write handoff notes to `AGENT_HANDOFFS.md` before starting and after completing. Format:

```
## [AgentName] — [Status: STARTING|COMPLETE|BLOCKED]
Date: YYYY-MM-DD
Files touched: ...
Interfaces introduced: ...
Migrations required: ...
Risks: ...
Next steps for downstream agents: ...
```
