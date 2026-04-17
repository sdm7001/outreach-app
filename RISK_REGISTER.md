# Risk Register

| ID | Risk | Severity | Status | Mitigation |
|----|------|----------|--------|------------|
| R01 | Telegram bot token hardcoded in config.js | CRITICAL | OPEN | Remove fallback; require env var |
| R02 | SQL injection in updateProspect/incrementStat | CRITICAL | OPEN | Whitelist columns; use parameterized queries |
| R03 | Hardcoded admin password 'TexMG2026' | CRITICAL | OPEN | Remove fallback; require ADMIN_PASSWORD env var |
| R04 | JWT secret regenerated on restart | CRITICAL | OPEN | Persist JWT_SECRET in env var |
| R05 | Arbitrary .env write endpoint | CRITICAL | OPEN | Whitelist allowed keys; validate values |
| R06 | Uncontrolled concurrent pipeline spawning | CRITICAL | OPEN | Replace with queue-based job system |
| R07 | Invalid Claude model ID | HIGH | OPEN | Update to valid model ID (claude-haiku-4-5-20251001 → claude-haiku-4-5) |
| R08 | Deprecated Apollo API v1 | HIGH | OPEN | Migrate to Apollo v2 with x-api-key header |
| R09 | TLS verification disabled in SMTP | HIGH | OPEN | Remove rejectUnauthorized:false |
| R10 | max_tokens:300 too low for email generation | HIGH | OPEN | Increase to 600 |
| R11 | No .env.example file | HIGH | OPEN | Create with all 15+ required vars |
| R12 | Guessed emails sent without verification flag | MEDIUM | OPEN | Tag email_source, skip guessed by default |
| R13 | Race condition in prospect deduplication | MEDIUM | OPEN | Use INSERT OR IGNORE with unique constraint |
| R14 | @anthropic-ai/sdk 0.30.x outdated | MEDIUM | OPEN | Upgrade to latest |
| R15 | Express 4.22.1 doesn't exist on npm | MEDIUM | OPEN | Delete lockfile, npm install fresh |
| R16 | JWT stored in localStorage | MEDIUM | OPEN | Move to HttpOnly cookie or note as acceptable for internal tool |
| R17 | X-Forwarded-For spoofable | LOW | OPEN | Accept as known limitation, note in docs |
| R18 | No brute force protection on login | LOW | OPEN | Add rate limiting middleware |
| R19 | SQLite on ephemeral disk | LOW | OPEN | Document backup strategy; mount volume in Docker |
| R20 | Raw errors exposed in test endpoint | LOW | OPEN | Normalize error responses |
