# Outreach Enterprise Platform

A production-grade B2B outbound email automation platform for **TexMG / Talos Automation AI**. Manages multi-campaign outreach with AI-assisted drafting, human review workflow, deliverability protections, suppression enforcement, and full audit logging.

## Features

- **Multi-campaign management** — create, clone, pause, and archive campaigns with per-campaign ICP and rate limits
- **Contact & account management** — normalized records with lifecycle state, deduplication, and search
- **Multi-step sequences** — configurable delay between steps; auto-schedules next step after send
- **AI message generation** — Claude-powered cold email drafts with spam scoring and tone controls
- **Review workflow** — manual review queue (approve/reject) or configurable auto-send mode
- **Deliverability protections** — suppression list, bounce handling, business-hours send window, rate limiting
- **Compliance** — unsubscribe token enforcement, hard-bounce suppression, per-contact terminal states
- **Tracking** — open pixel, click redirect, unsubscribe link injection with bot filtering
- **Analytics** — dashboard KPIs, per-campaign stats (send/open/click/reply/bounce rates)
- **Audit log** — every significant action logged with user, entity, and timestamp
- **Queue-based workers** — SQLite-backed job queue with retry, backoff, idempotency, and dead-letter handling
- **RBAC** — admin, operator, analyst roles enforced on all API routes
- **Admin UI** — responsive single-page app served at `/`

## Prerequisites

- **Node.js 18+** (tested on 18, 20)
- npm 9+
- Optional: Anthropic API key, Gmail App Password, Apollo.io key, Hunter.io key

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/sdm7001/outreach-app.git
cd outreach-app-enterprise
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and ADMIN_PASSWORD

# 3. Initialize database and create admin user
node scripts/setup.js

# 4. (Optional) Load demo data
node scripts/seed.js

# 5. Start
npm start
# → Server running at http://localhost:3848
```

Open [http://localhost:3848](http://localhost:3848) and log in with `admin@example.com` and your `ADMIN_PASSWORD`.

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **Yes** | Random string ≥ 32 chars for JWT signing |
| `ADMIN_PASSWORD` | **Yes** | Password for the initial admin account |
| `ANTHROPIC_API_KEY` | No | Enables AI email generation |
| `SMTP_USER` / `SMTP_PASS` | No | Gmail credentials for sending (App Password) |
| `APOLLO_API_KEY` | No | Apollo.io for prospect discovery |
| `HUNTER_API_KEY` | No | Hunter.io for email enrichment |
| `REVIEW_MODE` | No | `manual` (default) or `auto` |

See `.env.example` for the full list with descriptions.

## API

Base URL: `/api/v1` — all endpoints require `Authorization: Bearer <token>` except auth and tracking.

```
POST   /api/v1/auth/login
GET    /api/v1/campaigns
POST   /api/v1/campaigns
GET    /api/v1/contacts
GET    /api/v1/messages/drafts
POST   /api/v1/messages/drafts/:id/approve
POST   /api/v1/messages/drafts/:id/reject
GET    /api/v1/analytics/dashboard
GET    /api/v1/suppression
POST   /api/v1/suppression
GET    /api/v1/audit
GET    /api/v1/admin/system      (admin only)
GET    /api/v1/admin/jobs        (admin only)
```

See [docs/API.md](docs/API.md) for the full reference.

## Running Tests

```bash
npm test
# or with coverage:
npm run test:coverage
```

82 tests covering auth, campaigns, compliance, queue, tracking, analytics, and suppression.

## Docker

```bash
# Build and run
docker-compose up

# Or build manually
docker build -t outreach-enterprise .
docker run -p 3848:3848 --env-file .env outreach-enterprise
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start production server |
| `node scripts/setup.js` | Initialize DB + create admin user |
| `node scripts/seed.js` | Load demo campaigns and contacts |
| `node scripts/migrate.js` | Run pending DB migrations only |
| `node scripts/health-check.js` | Check if server is healthy |
| `npm run lint` | ESLint check |
| `npm test` | Run test suite |

## Architecture

Node.js + Express API → SQLite (better-sqlite3) + queue-backed workers

```
Browser → Express (/api/v1/*, /t/*, /)
              ↓
         Services (auth, campaign, contact, message, compliance, analytics)
              ↓
         SQLite DB  ←→  Job Queue → Workers (pipeline, delivery, enrichment)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Setup Guide](docs/SETUP.md)
- [API Reference](docs/API.md)
- [Operations Runbook](docs/RUNBOOK.md)
- [Security](docs/SECURITY.md)
