# Architecture

## System Overview

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│            Admin UI (public/index.html)          │
└─────────────────────┬───────────────────────────┘
                      │ HTTP / REST
┌─────────────────────▼───────────────────────────┐
│              Express API (server.js)             │
│  /api/v1/*  — authenticated JSON endpoints      │
│  /t/*       — tracking pixel & click redirect   │
│  /unsubscribe/:token — compliance               │
│  /health    — health check                      │
│  /          — static admin UI                   │
└──────────┬───────────────────────────┬──────────┘
           │                           │
┌──────────▼──────────┐   ┌───────────▼──────────┐
│     Services         │   │   Job Queue (SQLite)  │
│  auth.service        │   │   jobs table          │
│  campaign.service    │   │   enqueue/dequeue     │
│  contact.service     │   │   retry/backoff       │
│  sequence.service    │   │   idempotency keys    │
│  message.service     │   │   dead-letter         │
│  compliance.service  │   └───────────┬──────────┘
│  delivery.service    │               │
│  analytics.service   │   ┌───────────▼──────────┐
│  audit.service       │   │     Workers           │
└──────────┬──────────┘   │  pipeline.worker      │
           │               │  delivery.worker      │
┌──────────▼──────────────▼──────────────────────┐
│              SQLite Database                    │
│         (data/outreach.db, WAL mode)            │
└─────────────────────────────────────────────────┘
```

## Directory Structure

```
outreach-app-enterprise/
├── server.js              # Express app + router wiring
├── public/
│   └── index.html         # Single-file admin SPA
├── src/
│   ├── api/               # Express route handlers (HTTP layer only)
│   │   ├── auth.js
│   │   ├── campaigns.js
│   │   ├── accounts.js
│   │   ├── contacts.js
│   │   ├── sequences.js
│   │   ├── messages.js    # Draft review/approve/reject
│   │   ├── analytics.js
│   │   ├── suppression.js
│   │   ├── audit.js
│   │   ├── tracking.js    # Public: open pixel, click, unsubscribe
│   │   └── admin.js       # Admin-only: system, jobs, pipeline trigger
│   ├── services/          # Business logic — no HTTP knowledge
│   │   ├── auth.service.js
│   │   ├── campaign.service.js
│   │   ├── account.service.js
│   │   ├── contact.service.js
│   │   ├── sequence.service.js
│   │   ├── message.service.js     # AI generation + draft lifecycle
│   │   ├── compliance.service.js  # Suppression, unsubscribe, bounce
│   │   ├── delivery.service.js    # Email send + tracking injection
│   │   ├── analytics.service.js
│   │   └── audit.service.js
│   ├── workers/
│   │   ├── index.js           # startWorkers() — wires handlers to queue
│   │   ├── queue.js           # SQLite-backed job queue
│   │   ├── pipeline.worker.js # Orchestrates sequence steps
│   │   ├── delivery.worker.js # Sends approved drafts
│   │   └── enrichment.worker.js # Hunter.io email lookup
│   ├── middleware/
│   │   ├── auth.js       # JWT Bearer verification
│   │   ├── rbac.js       # Role-based access control
│   │   ├── rateLimit.js  # express-rate-limit configuration
│   │   └── validate.js   # Input validation helpers
│   ├── config/
│   │   ├── index.js      # Config loader with startup validation
│   │   └── validate.js   # requireEnv / warnEnv helpers
│   ├── db/
│   │   ├── index.js      # DB singleton (getDb / closeDb)
│   │   ├── migrations.js # 5 versioned migrations
│   │   └── seeds.js      # Demo data seeder
│   └── utils/
│       ├── errors.js     # AppError hierarchy + asyncHandler
│       ├── logger.js     # Pino structured logger
│       └── crypto.js     # bcrypt + JWT helpers
├── scripts/
│   ├── setup.js          # First-run: DB init + admin user
│   ├── seed.js           # Load demo data
│   ├── migrate.js        # Run migrations only
│   └── health-check.js   # HTTP health probe
├── tests/
│   ├── setup.js          # Jest env vars (sets DB_PATH=:memory:)
│   ├── fixtures/factory.js
│   ├── unit/             # Service and utility tests
│   └── integration/      # Supertest API tests
└── docs/
```

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Operator accounts with role |
| `campaigns` | Campaign config, ICP, schedule, status |
| `accounts` | Company records (deduplicated by domain) |
| `contacts` | Individual contacts with lifecycle state |
| `sequences` | Outreach sequences linked to campaigns |
| `sequence_steps` | Steps with delay, tone, templates |
| `message_drafts` | AI-generated drafts with review status |
| `send_events` | Per-email send record with tracking timestamps |
| `email_events` | Open/click/bounce/unsubscribe events |
| `suppression` | Email and domain suppression list |
| `audit_logs` | Immutable action log |
| `jobs` | Background job queue with retry state |
| `daily_stats` | Aggregated send/engagement per campaign per day |
| `schema_migrations` | Applied migration versions |

## Core Data Flows

### Outreach Pipeline
```
Campaign created
  → Contact added (manual or enrichment worker)
  → Sequence enrolled (run_sequence_step job enqueued)
  → Pipeline worker generates AI draft
  → REVIEW_MODE=manual: draft sits in pending_review queue
    → Operator approves → send_email job enqueued
  → REVIEW_MODE=auto: draft auto-approved → send_email job enqueued
  → Delivery worker checks suppression + business hours + TLS enforcement
  → Email sent via SMTP → send_event recorded
  → Next sequence step scheduled (if any)
```

### Tracking Flow
```
Email contains:
  - Open pixel: <img src="/t/o/{sendEventId}">
  - Click links: href="/t/c/{sendEventId}?url={encoded}"
  - Unsubscribe: /unsubscribe/{base64url(contactId:email)}

On open: bot-filtered, send_event.opened_at updated, email_event recorded
On click: validated URL (https only), redirect, send_event.clicked_at updated
On unsubscribe: contact marked unsubscribed, email added to suppression
```

## Queue System

Jobs are stored in SQLite's `jobs` table. The worker polls every 30 seconds:
- Claims up to 10 jobs atomically (transaction)
- Dispatches to the appropriate handler
- On success: marks `completed`
- On failure: if `attempts < max_attempts`, schedules retry with exponential backoff; else marks `dead`
- On startup: recovers any jobs stuck in `processing` for >30 minutes

## Authentication & Authorization

- JWT Bearer tokens, signed with `JWT_SECRET`, default 8-hour expiry
- Roles: `admin` > `operator` > `analyst`
  - `admin`: all operations including user management and job control
  - `operator`: campaign/contact/sequence CRUD, draft approve/reject
  - `analyst`: read-only access to campaigns, contacts, analytics

## Key Design Decisions

- **SQLite over Postgres**: Appropriate for single-operator scale, zero external dependencies, easy backup (copy file). Upgrade path is straightforward via better-sqlite3 → postgres adapter.
- **In-process workers over separate processes**: Avoids deployment complexity. Workers run every 30s in the same Node.js process.
- **Review mode**: `REVIEW_MODE=manual` is the safe default. Operators see all AI drafts before they're sent.
- **Suppression enforcement**: Belt-and-suspenders — checked in compliance.service, delivery.service, and pipeline.worker independently.
