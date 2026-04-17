# Setup Guide

## Requirements

- Node.js 18 or 20 (check: `node --version`)
- npm 9+ (check: `npm --version`)

## Installation

```bash
git clone https://github.com/sdm7001/outreach-app.git
cd outreach-app-enterprise
npm install
```

## Configuration

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
JWT_SECRET=<random 32+ character string>
ADMIN_PASSWORD=<strong password>
```

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## First-Time Setup

```bash
node scripts/setup.js
```

This creates the SQLite database, runs all migrations, and creates the admin user at `ADMIN_EMAIL` (default: `admin@example.com`) with `ADMIN_PASSWORD`.

## Load Demo Data (Optional)

```bash
node scripts/seed.js
```

Creates two sample campaigns, accounts, contacts, and a suppression entry.

## Start

```bash
npm start
```

Open [http://localhost:3848](http://localhost:3848).

## Configuring Email Sending

The app logs emails to console when SMTP is not configured. To actually send:

1. Enable Gmail 2-Step Verification
2. Generate an App Password: Google Account → Security → App Passwords
3. Set in `.env`:
   ```env
   SMTP_USER=youraddress@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   FROM_NAME=Your Name
   FROM_EMAIL=youraddress@gmail.com
   ```

## Configuring AI Generation

Get an API key from [console.anthropic.com](https://console.anthropic.com):

```env
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-haiku-4-5
```

When not set, the app generates a placeholder draft so the review queue still functions.

## Configuring Prospect Discovery

Apollo.io (company/contact search):
```env
APOLLO_API_KEY=your_key
```

Google Places API (local business search):
```env
GOOGLE_PLACES_API_KEY=your_key
```

Hunter.io (email enrichment):
```env
HUNTER_API_KEY=your_key
```

## Review Mode

`REVIEW_MODE=manual` (default) — all AI drafts require human approval before sending.
`REVIEW_MODE=auto` — drafts are auto-approved and queued immediately.

Change in `.env`:
```env
REVIEW_MODE=manual
```

## Tracking Domain

For open/click tracking to work in production, set this to your public domain:
```env
TRACKING_DOMAIN=https://outreach.yourdomain.com
```

## Production Checklist

- [ ] `JWT_SECRET` is at least 32 random characters, not committed to git
- [ ] `ADMIN_PASSWORD` is strong (12+ chars, mixed case, numbers)
- [ ] `NODE_ENV=production`
- [ ] `REVIEW_MODE=manual` for new deployments
- [ ] `TRACKING_DOMAIN` points to your public URL
- [ ] `SEND_GUESSED_EMAILS=false` (default)
- [ ] Regular backups of `data/outreach.db`

## Database Backup

The database is a single file. Back it up while the app is running:
```bash
cp data/outreach.db data/outreach.db.bak
# SQLite WAL mode makes this safe even under load
```

## Troubleshooting

**"Missing required environment variables"**
→ Copy `.env.example` to `.env` and set `JWT_SECRET` and `ADMIN_PASSWORD`.

**"address already in use :::3848"**
→ Something else is using port 3848. Change `PORT=3849` in `.env` or kill the other process.

**Email not sending**
→ Check `SMTP_USER` / `SMTP_PASS` are set. Verify App Password (not account password). Check send window (`SEND_WINDOW_START` / `SEND_WINDOW_END`).

**AI drafts not generating**
→ Check `ANTHROPIC_API_KEY` is valid. Check logs for API errors. Drafts fall back to placeholder text if the API fails.

**Login fails**
→ Run `node scripts/setup.js` to ensure the admin user was created. Check `ADMIN_EMAIL` matches what you're logging in with.
