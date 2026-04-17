# Operations Runbook

## Starting and Stopping

```bash
# Start
npm start

# Start with pm2 (production)
pm2 start server.js --name outreach --env production

# Stop
Ctrl+C  (sends SIGINT → graceful shutdown)
# or
pm2 stop outreach
```

## Health Check

```bash
node scripts/health-check.js
# Exits 0 if healthy, 1 if unreachable or degraded

# Or via curl:
curl http://localhost:3848/health
```

## Checking Queue Health

```bash
# Via API (admin token required):
curl http://localhost:3848/api/v1/admin/system \
  -H "Authorization: Bearer <token>"

# Directly in SQLite:
sqlite3 data/outreach.db "SELECT status, COUNT(*) FROM jobs GROUP BY status;"
```

Expected: `pending` near 0 when idle, `dead` should stay 0.

## Resetting Stuck Jobs

If the server crashed mid-processing, jobs may be stuck in `processing`:

```bash
sqlite3 data/outreach.db \
  "UPDATE jobs SET status='pending', started_at=NULL \
   WHERE status='processing' AND started_at < datetime('now','-30 minutes');"
```

The worker also does this automatically on startup.

## Retrying Failed Jobs

Via the Admin UI → Jobs tab → click "Retry" on any dead job.

Via API:
```bash
curl -X POST http://localhost:3848/api/v1/admin/jobs/<jobId>/retry \
  -H "Authorization: Bearer <token>"
```

## Changing Admin Password

```bash
# Via the API (must know current password):
curl -X PUT http://localhost:3848/api/v1/auth/me/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"old","newPassword":"NewPass123!"}'
```

## Viewing Audit Logs

Via Admin UI → Audit Log tab.

Via API:
```bash
curl http://localhost:3848/api/v1/audit?limit=50 \
  -H "Authorization: Bearer <token>"
```

Via SQLite:
```bash
sqlite3 data/outreach.db \
  "SELECT user_email, action, entity_type, entity_id, created_at \
   FROM audit_logs ORDER BY created_at DESC LIMIT 50;"
```

## Managing Suppression

Add an email:
```bash
curl -X POST http://localhost:3848/api/v1/suppression \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"optout@example.com","reason":"manual"}'
```

Check if email is suppressed (SQLite):
```bash
sqlite3 data/outreach.db \
  "SELECT * FROM suppression WHERE email='user@example.com';"
```

## Database Backup

```bash
# While server is running (WAL mode makes this safe):
cp data/outreach.db backups/outreach-$(date +%Y%m%d-%H%M).db

# Verify backup:
sqlite3 backups/outreach-*.db "PRAGMA integrity_check;"
```

## What to Do When Email Sending Stops

1. Check `SMTP_USER` and `SMTP_PASS` are still set in `.env`
2. Check Gmail hasn't revoked the App Password (regenerate if so)
3. Check send window: `SEND_WINDOW_START` to `SEND_WINDOW_END` (default 8am–5pm server time)
4. Check for dead jobs: `GET /api/v1/admin/jobs?status=dead`
5. Check recent audit log for `delivery.error` events
6. Test manually: `node -e "require('nodemailer').createTransport({...}).verify(console.log)"`

## Log Levels

The app uses Pino structured JSON logging.

In development (`NODE_ENV=development`), logs are pretty-printed. In production, they're JSON.

```bash
# Stream logs through pino-pretty:
npm start | npx pino-pretty

# Filter for errors only:
npm start | npx pino-pretty | grep '"level":50'
```

Key log fields: `level`, `msg`, `time`, `userId`, `campaignId`, `contactId`, `error`.

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `FATAL: Missing required environment variables` | `.env` not configured | Run `cp .env.example .env` and set `JWT_SECRET` and `ADMIN_PASSWORD` |
| `listen EADDRINUSE :::3848` | Port in use | Change `PORT` in `.env` or kill other process |
| `AUTH_ERROR: Token is invalid or expired` | JWT expired (8h default) | Re-login; increase `JWT_EXPIRY_HOURS` |
| `Delivery skipped: email suppressed` | Contact in suppression list | Check via `/api/v1/suppression` |
| `Outside send window` | Job deferred to next business day | Normal behavior; job will be retried tomorrow |
| `Job handler failed` + Anthropic error | API key issue or rate limit | Check `ANTHROPIC_API_KEY`; check Anthropic console |
