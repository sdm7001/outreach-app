# Target Architecture

**Version:** 1.0  
**Last Updated:** 2026-04-17  

---

## Overview

Transform the current script into a production-ready, multi-user outreach platform with campaign management, multi-step sequences, AI-assisted drafting with review workflow, deliverability protections, compliance controls, and enterprise admin UX.

**Primary constraint:** Keep Node.js + SQLite + Express. Avoid unnecessary rewrites. Migrate incrementally.

---

## Directory Structure

```
outreach-app-enterprise/
├── src/
│   ├── api/                    # Express route handlers
│   │   ├── auth.js
│   │   ├── campaigns.js
│   │   ├── contacts.js
│   │   ├── accounts.js
│   │   ├── sequences.js
│   │   ├── messages.js         # Draft review/approve
│   │   ├── analytics.js
│   │   ├── suppression.js
│   │   ├── audit.js
│   │   ├── admin.js            # Config, users, system
│   │   └── webhooks.js
│   ├── services/               # Business logic (no HTTP)
│   │   ├── campaign.service.js
│   │   ├── contact.service.js
│   │   ├── account.service.js
│   │   ├── sequence.service.js
│   │   ├── enrichment.service.js
│   │   ├── messaging.service.js  # AI generation
│   │   ├── delivery.service.js   # Email send
│   │   ├── compliance.service.js # Suppression, unsub
│   │   ├── analytics.service.js
│   │   └── audit.service.js
│   ├── workers/                # Background job processors
│   │   ├── queue.js            # SQLite-backed job queue
│   │   ├── pipeline.worker.js  # Orchestrates pipeline
│   │   ├── enrichment.worker.js
│   │   ├── messaging.worker.js
│   │   ├── delivery.worker.js
│   │   └── reporting.worker.js
│   ├── db/
│   │   ├── index.js            # DB connection singleton
│   │   ├── migrations.js       # Schema versioning
│   │   └── seeds.js            # Demo data
│   ├── config/
│   │   ├── index.js            # Validated config with startup check
│   │   └── validate.js         # Zod/manual schema validation
│   ├── middleware/
│   │   ├── auth.js             # JWT verify middleware
│   │   ├── rbac.js             # Role-based access control
│   │   ├── validate.js         # Request body validation
│   │   ├── rateLimit.js        # Login rate limiting
│   │   └── audit.js            # Auto audit log middleware
│   └── utils/
│       ├── logger.js           # Structured pino logger
│       ├── errors.js           # AppError base class
│       ├── crypto.js           # bcrypt, token gen
│       └── email.js            # HTML/text template helpers
├── public/                     # Admin SPA (Vanilla JS + modern CSS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── tracking/
│   └── server.js               # Tracking pixel/click/unsub server
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SETUP.md
│   ├── ADMIN_GUIDE.md
│   ├── OPERATOR_RUNBOOK.md
│   ├── API.md
│   └── TROUBLESHOOTING.md
├── scripts/
│   ├── setup.js                # First-run DB init + admin user creation
│   ├── seed.js                 # Demo data loader
│   └── migrate.js              # Run pending migrations
├── .env.example
├── .github/workflows/ci.yml
├── Dockerfile
├── docker-compose.yml
├── server.js                   # Main entry point (replaces index.js)
└── package.json
```

---

## Data Model

### Core Tables

```sql
-- Users with RBAC
users (id, email, password_hash, role, name, active, last_login, created_at, updated_at)
-- Roles: admin | operator | reviewer | analyst

-- Campaigns
campaigns (id, name, status, description, icp_config JSON, sender_config JSON, 
           schedule_config JSON, daily_limit, created_by, created_at, updated_at)
-- Status: draft | active | paused | archived

-- Accounts (company-level)
accounts (id, company_name, domain, industry, employee_count, city, state, 
          source, tags, notes, created_at, updated_at)

-- Contacts (person-level)
contacts (id, account_id, campaign_id, first_name, last_name, email, title, 
          email_source, email_verified, score, status, lifecycle_state,
          last_contacted_at, tags, notes, source, created_at, updated_at)
-- Status: pending | enriching | enriched | queued | sent | opened | clicked | replied | bounced | unsubscribed | suppressed | error

-- Sequences
sequences (id, campaign_id, name, status, created_at, updated_at)

-- Sequence Steps
sequence_steps (id, sequence_id, step_number, delay_days, delay_hours, 
                subject_template, body_template, tone, created_at)

-- Message Drafts (AI-generated, pending review)
message_drafts (id, contact_id, sequence_step_id, subject, body, 
                ai_model, prompt_version, spam_score, tone_score,
                status, reviewed_by, reviewed_at, created_at)
-- Status: pending_review | approved | rejected | sent

-- Send Events
send_events (id, contact_id, campaign_id, sequence_step_id, draft_id,
             recipient_email, subject, status, sent_at, opened_at, 
             clicked_at, replied_at, bounced_at, error_message, created_at)

-- Email Event Log (raw tracking)
email_events (id, contact_id, send_event_id, event_type, event_data, 
              ip_address, user_agent, created_at)

-- Suppression List
suppression (id, email, domain, reason, source, added_by, created_at)
-- Reason: unsubscribed | bounced | complaint | manual | imported

-- Jobs Queue
jobs (id, type, payload JSON, status, attempts, max_attempts, 
      scheduled_at, started_at, completed_at, failed_at, 
      error_message, idempotency_key, created_at)
-- Status: pending | running | completed | failed | dead

-- Audit Log
audit_logs (id, user_id, action, entity_type, entity_id, 
            old_values JSON, new_values JSON, ip_address, created_at)

-- Daily Stats (aggregated)
daily_stats (date, campaign_id, prospects_found, emails_sent, emails_opened,
             clicks, replies, bounces, unsubscribes)
```

---

## API Surface

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET  /api/auth/me`
- `POST /api/auth/change-password`

### Campaigns
- `GET    /api/campaigns`
- `POST   /api/campaigns`
- `GET    /api/campaigns/:id`
- `PUT    /api/campaigns/:id`
- `DELETE /api/campaigns/:id`
- `POST   /api/campaigns/:id/pause`
- `POST   /api/campaigns/:id/activate`
- `POST   /api/campaigns/:id/clone`
- `GET    /api/campaigns/:id/stats`

### Contacts
- `GET    /api/contacts`          (filterable, paginated)
- `POST   /api/contacts`
- `GET    /api/contacts/:id`
- `PUT    /api/contacts/:id`
- `DELETE /api/contacts/:id`
- `GET    /api/contacts/:id/timeline`
- `POST   /api/contacts/import`   (CSV)

### Accounts
- `GET    /api/accounts`
- `POST   /api/accounts`
- `GET    /api/accounts/:id`
- `PUT    /api/accounts/:id`
- `GET    /api/accounts/:id/contacts`

### Sequences
- `GET    /api/sequences`
- `POST   /api/sequences`
- `GET    /api/sequences/:id`
- `PUT    /api/sequences/:id`
- `POST   /api/sequences/:id/steps`
- `PUT    /api/sequences/:id/steps/:stepId`
- `DELETE /api/sequences/:id/steps/:stepId`

### Message Review
- `GET    /api/messages/review-queue`
- `POST   /api/messages/:id/approve`
- `POST   /api/messages/:id/reject`
- `PUT    /api/messages/:id`      (edit draft)

### Analytics
- `GET    /api/analytics/overview`
- `GET    /api/analytics/campaigns/:id`
- `GET    /api/analytics/daily`

### Suppression
- `GET    /api/suppression`
- `POST   /api/suppression`
- `DELETE /api/suppression/:id`
- `POST   /api/suppression/import`

### Audit
- `GET    /api/audit`

### Admin
- `GET    /api/admin/config`
- `PUT    /api/admin/config`
- `GET    /api/admin/users`
- `POST   /api/admin/users`
- `PUT    /api/admin/users/:id`
- `GET    /api/admin/jobs`
- `POST   /api/admin/jobs/:id/retry`
- `GET    /api/admin/health`

### Tracking (separate server on port 3847)
- `GET  /t/:contactId`           open pixel
- `GET  /c/:contactId`           click redirect
- `GET  /unsub/:contactId`       unsubscribe

---

## Worker Architecture

SQLite-backed job queue with polling worker loop. No Redis required.

```
Job types:
- ENRICH_CONTACT        - Hunt for email, score
- GENERATE_DRAFT        - AI message generation
- SEND_EMAIL            - Deliver one email
- RUN_DAILY_REPORT      - Telegram/log report
- FIND_PROSPECTS        - Apollo/Google Places discovery
- PROCESS_BOUNCE        - Handle bounce webhook
- PROCESS_REPLY         - Handle reply webhook
```

Worker loop: poll `jobs` every 5s for `pending` jobs past `scheduled_at`, claim with UPDATE ... WHERE status='pending', process, update to `completed` or `failed`. After `max_attempts`, move to `dead` status and alert.

---

## Security Model

- Passwords: bcrypt cost 12
- JWT: HS256, 8h expiry, secret loaded from env (never random)
- RBAC: `admin` > `operator` > `reviewer` > `analyst`
- Rate limiting: 10 req/min on login endpoint
- Config updates: whitelist of allowed env keys only
- Input validation: whitelist-based on all mutation endpoints
- Secrets: never logged, never returned in API responses
- SQL: parameterized queries only (no string interpolation for user data)
- Headers: helmet.js for security headers

---

## Compliance Model

- Suppression list checked before every send
- Global DNC list enforced
- Unsubscribe link in every email (CAN-SPAM)
- One-click unsubscribe header (`List-Unsubscribe-Post`)
- Bounce → auto-suppress email
- Reply stop words → auto-suppress ("unsubscribe", "remove me", "stop", etc.)
- Audit log for all suppression additions
- `email_source` field distinguishes verified vs. guessed emails
- Policy flag: skip sending to `email_source = 'guessed'` unless explicitly enabled

---

## Observability

- Structured JSON logging via pino
- `GET /api/admin/health` returns DB state, queue depth, worker status
- Job queue health visible in admin UI
- Daily Telegram report retained
- Error tracking via uncaughtException → log + Telegram alert
