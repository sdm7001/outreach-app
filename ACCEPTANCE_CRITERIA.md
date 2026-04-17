# Acceptance Criteria

## App Startup
- [x] App installs cleanly: `npm install` completes without errors
- [x] Config validation: exits with clear message if `JWT_SECRET` or `ADMIN_PASSWORD` missing
- [x] Database initializes: `node scripts/setup.js` creates DB and admin user
- [x] App starts: `npm start` serves on port 3848 without errors
- [x] Health check: `GET /health` returns `{"status":"ok"}`

## Auth & Users
- [x] Login: `POST /api/v1/auth/login` returns JWT token with valid credentials
- [x] Login fails: 401 on wrong password, 401 on unknown email
- [x] Me: `GET /api/v1/auth/me` returns current user
- [x] JWT validated: 401 on missing or invalid token
- [x] Password change: `PUT /api/v1/auth/me/password` updates password
- [x] RBAC: admin can create users; operator and analyst cannot
- [x] RBAC: analyst gets 403 on operator-only routes

## Campaign Management
- [x] Create: `POST /api/v1/campaigns` creates draft campaign
- [x] Create fails: 400 on missing name
- [x] List: `GET /api/v1/campaigns` returns paginated list
- [x] Filter: status and search params work
- [x] Update: `PUT /api/v1/campaigns/:id` updates fields including status
- [x] Clone: `POST /api/v1/campaigns/:id/clone` creates draft copy
- [x] Archive: `DELETE /api/v1/campaigns/:id` archives (not deletes)

## Contact & Account Management
- [x] Create contact with account link
- [x] List contacts with status and search filters
- [x] Contact lifecycle states enforced (unsubscribed, bounced are terminal)
- [x] Account domain uniqueness enforced

## Sequence Engine
- [x] Create sequence with steps: delay, tone, templates
- [x] Steps stored with correct step_number ordering
- [x] Next step auto-scheduled when pipeline worker runs

## AI Message Workflow
- [x] Draft generated with spam score
- [x] Draft status `pending_review` in manual mode
- [x] Approve: `POST /drafts/:id/approve` changes status and enqueues send job
- [x] Reject: `POST /drafts/:id/reject` records reason
- [x] Fallback: draft created even when Anthropic API key not set

## Delivery & Sending Safety
- [x] Suppression check in delivery worker — suppressed contacts skipped
- [x] Business hours check — emails deferred outside send window
- [x] Unverified guessed emails skipped when `SEND_GUESSED_EMAILS=false`
- [x] TLS enforced on SMTP connection
- [x] Email logs to console when SMTP not configured

## Tracking
- [x] Open pixel: `GET /t/o/:id` returns 1×1 GIF with no-cache headers
- [x] Click redirect: `GET /t/c/:id?url=...` validates URL scheme and redirects
- [x] Click redirect: rejects non-http URLs (no open redirect vulnerability)
- [x] Unsubscribe: token processed, contact marked unsubscribed, email suppressed

## Analytics
- [x] Dashboard: returns active campaigns, contacts, sent count, open rate, pending drafts, failed jobs
- [x] Campaign stats: total_sent, open_rate, click_rate, reply_rate, bounce_rate

## Compliance
- [x] Suppressed email cannot be sent (checked in multiple layers)
- [x] Unsubscribe marks contact and adds to suppression list
- [x] Hard bounce adds email to suppression permanently
- [x] Soft bounce marks contact but does not suppress

## Audit Logging
- [x] Login/logout logged
- [x] Campaign create/update/clone/archive logged
- [x] Draft approve/reject logged
- [x] Contact unsubscribe logged
- [x] Suppression add/remove logged

## Queue & Reliability
- [x] Jobs retry on failure (up to max_attempts)
- [x] Idempotency key prevents duplicate jobs
- [x] Dead-letter: jobs with exhausted retries marked `dead`
- [x] Worker recovers stale `processing` jobs on startup
- [x] Workers start automatically with server

## Admin UI
- [x] Login form with email + password
- [x] Dashboard KPIs load from API
- [x] Campaigns page: list, create, clone, status change
- [x] Contacts page: list with filter and search
- [x] Review Queue: pending drafts with approve/reject buttons
- [x] Suppression page: list, add, remove
- [x] Audit Log page
- [x] Jobs page: list by status, retry, delete

## Code Quality
- [x] ESLint passes with 0 errors
- [x] All 82 tests pass
- [x] No hardcoded secrets in source code
- [x] No plaintext passwords in logs or responses
- [x] `.env.example` documents all variables

## Deployment Readiness
- [x] `Dockerfile` builds a runnable image
- [x] `docker-compose.yml` for local stack
- [x] `.github/workflows/ci.yml` runs lint + tests on push
- [x] `scripts/health-check.js` for container health probe
- [x] `docs/SETUP.md` sufficient for a new operator
