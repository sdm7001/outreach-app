# Security

## Authentication

JWT Bearer tokens signed with `JWT_SECRET`. Default expiry: 8 hours (configurable via `JWT_EXPIRY_HOURS`).

**Known limitation:** The admin UI stores tokens in `localStorage`. This is acceptable for an internal operator tool but should be upgraded to `httpOnly` cookies for a public-facing deployment.

## Secret Management

- All secrets are loaded from environment variables (`.env` file)
- The app validates required secrets on startup and exits if missing
- `.env` is in `.gitignore` — never commit it
- No secrets are logged or returned in API responses

To generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## RBAC

Three roles with escalating permissions:
- `analyst` — read-only
- `operator` — CRUD on campaigns, contacts, sequences; draft approve/reject
- `admin` — all operations including user management and job control

Role is verified server-side on every request via `src/middleware/rbac.js`. The role claim in the JWT is trusted because the JWT is signed with `JWT_SECRET`.

## Input Validation

- JSON body size limited to 2MB
- Required fields validated in service layer with typed error responses
- SQL injection prevented by exclusive use of parameterized queries (better-sqlite3 prepared statements)
- URL parameters in click tracking validated via `new URL()` — only `http:` and `https:` schemes allowed

## Rate Limiting

Login endpoint: `MAX_LOGIN_ATTEMPTS_PER_MIN` (default 10) per IP via `express-rate-limit`.

## Transport Security

- SMTP enforces `requireTLS: true` and `rejectUnauthorized: true` — no plaintext or self-signed certs
- HTTP security headers set by `helmet` (X-Frame-Options, X-Content-Type-Options, etc.)
- CORS configured via `CORS_ORIGIN` env var

## Suppression and Compliance

- Hard bounces automatically suppress the email address permanently
- Unsubscribe links use a tamper-evident `base64url(contactId:email)` token
- Processing an unsubscribe adds the email to the global suppression list
- Suppression is checked in three independent locations: compliance service, delivery worker, and pipeline worker

## Tracking Privacy

- Open pixel tracking filters known bots and crawlers by User-Agent
- Click tracking only redirects to `http:` and `https:` URLs (prevents protocol-injection attacks)
- IP address collected for tracking is the first IP from `X-Forwarded-For` only

## Webhook Verification

Inbound webhook endpoints (if added) should verify HMAC signatures. This is scaffolded but not yet fully implemented for third-party integrations.

## Audit Logging

The following actions are logged to `audit_logs` with user identity, entity, and IP:
- `auth.login`, `auth.logout`, `auth.password_change`
- `user.create`, `user.update`
- `campaign.create`, `campaign.update`, `campaign.archive`, `campaign.clone`
- `sequence.create`, `sequence.update`, `sequence.delete`
- `draft.approve`, `draft.reject`
- `contact.unsubscribe`
- All suppression add/remove events

## Known Limitations

1. **localStorage tokens** — should be `httpOnly` cookies for production web use
2. **No CSRF protection** — acceptable for API-only with Bearer auth, but needed if cookie auth is added
3. **SQLite file permissions** — the `data/` directory should be mode 700 in production
4. **No TLS termination** — deploy behind nginx/caddy/ALB for HTTPS in production
5. **No IP allowlisting** — consider restricting admin API to trusted IPs in production

## Reporting Security Issues

Report vulnerabilities to: smcauley@texmg.com

Please do not open public GitHub issues for security vulnerabilities.
