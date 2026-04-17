# Current State Audit

**Repository:** https://github.com/sdm7001/outreach-app  
**Audit Date:** 2026-04-17  
**Auditor:** Orchestrator Agent  

---

## Summary

A flat, script-centric Node.js outbound email automation tool for TexMG / Talos Automation AI. It finds Houston-area B2B prospects, enriches contact info, generates cold emails via Claude, sends via Gmail SMTP, and tracks opens/clicks/unsubscribes. Functional but not production-ready, not multi-tenant, not enterprise-grade.

---

## Current File Map

| File | Purpose | Lines | Issues |
|------|---------|-------|--------|
| `index.js` | App entry, cron bootstrap, pipeline runner | ~70 | Monolithic bootstrap |
| `config.js` | Environment config with hardcoded fallback secrets | ~40 | CRITICAL: TG token hardcoded |
| `db.js` | SQLite DAL with schema init | ~130 | SQL injection in `updateProspect`/`incrementStat` |
| `prospect-finder.js` | Apollo.io + Google Places ICP search | ~? | Deprecated Apollo v1 endpoint |
| `contact-enricher.js` | Hunter.io email lookup + guessing | ~? | Sends to unverified guessed emails |
| `message-generator.js` | Anthropic API email drafting | ~110 | Invalid model ID, max_tokens too low |
| `email-sender.js` | Nodemailer SMTP with staggered sends | ~120 | TLS disabled, no bounce handling |
| `tracker.js` | Express: open pixel, click redirect, unsub | ~120 | IP spoofing risk (X-Forwarded-For) |
| `dashboard-server.js` | Express admin dashboard API | ~250 | Hardcoded password, JWT not persisted, arbitrary .env write, shell injection |
| `cron.js` | node-cron schedule for pipeline steps | ~60 | UTC comments wrong during DST |
| `telegram-report.js` | Telegram bot notifications | ~? | Token hardcoded in config.js |
| `public/index.html` | Single-page admin dashboard HTML | ~? | JWT in localStorage |

---

## Technology Stack

- **Runtime:** Node.js (requires 18+, but no engines field)
- **Database:** better-sqlite3 (SQLite WAL mode)
- **Web framework:** Express 4.x
- **Email:** Nodemailer via Gmail SMTP
- **AI:** @anthropic-ai/sdk 0.30.x (outdated)
- **Scheduler:** node-cron
- **Notifications:** Telegram Bot API
- **Prospect sources:** Apollo.io v1 API (deprecated), Google Places API
- **Enrichment:** Hunter.io domain search
- **IDs:** uuid v9

---

## Current Data Schema

Single monolithic `prospects` table tracks the full lifecycle from discovery to send. No normalization. Key issues:
- No campaign concept — all prospects share one global pipeline
- No sequence/multi-step model
- No user/auth table
- No suppression table (unsubscribes are status flags only)
- No audit log table
- Email events table exists but is append-only and read nowhere meaningful

---

## Architecture Assessment

| Dimension | Current State | Target |
|-----------|--------------|--------|
| Multi-tenancy | None | Single-org, multi-user/workspace |
| Campaign model | None (one global pipeline) | Full campaign CRUD with ICP config |
| Sequence model | None (single email only) | Multi-step sequences |
| Auth | Single password, no users table | JWT + bcrypt, RBAC roles |
| Queue/reliability | Cron-only, no retry | Bull-style queue with retry/backoff |
| Admin UI | Basic single-page HTML | Full React/modern SPA |
| Test coverage | Zero | 80%+ critical path coverage |
| Compliance | Unsubscribe status flag only | Suppression engine, global DNC, audit log |
| Observability | console.log + Telegram | Structured logging (pino), health endpoints |
| DevOps | pm2 + manual deploy | Docker, CI, health checks, env example |

---

## Critical Blockers (must fix before any production use)

1. Hardcoded Telegram bot token in `config.js` — publicly exposed
2. SQL injection in `db.js:updateProspect()` and `db.js:incrementStat()`
3. Hardcoded admin password fallback `'TexMG2026'`
4. JWT secret regenerated on every restart (all sessions invalidated on restart)
5. Arbitrary `.env` write + PM2 restart endpoint (one credential theft = full server compromise)
6. Invalid Claude model ID (`claude-haiku-4-5-20251001`) — AI generation silently fails
7. Uncontrolled concurrent pipeline spawning via `execSync` + `&`
8. Express version `4.22.1` in lockfile doesn't exist on npm (corrupt lockfile)
