# API Reference

Base URL: `/api/v1`

All endpoints except `/auth/login` and tracking endpoints (`/t/*`, `/unsubscribe/*`) require:
```
Authorization: Bearer <token>
```

Tokens are obtained via `POST /api/v1/auth/login`.

## Error Format

All errors return JSON:
```json
{ "error": "Human readable message", "code": "ERROR_CODE" }
```

Codes: `AUTH_ERROR` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400), `CONFLICT` (409), `INTERNAL_ERROR` (500)

## RBAC Roles

| Role | Permissions |
|---|---|
| `admin` | All operations + user management + job control |
| `operator` | CRUD on campaigns/contacts/sequences, draft approve/reject |
| `analyst` | Read-only on campaigns, contacts, analytics |

---

## Auth

### POST /api/v1/auth/login
```json
// Request
{ "email": "admin@example.com", "password": "YourPassword" }

// Response 200
{ "token": "eyJ...", "user": { "id": "...", "email": "...", "role": "admin" } }
```

### GET /api/v1/auth/me
Returns the authenticated user object.

### PUT /api/v1/auth/me/password
```json
{ "currentPassword": "...", "newPassword": "..." }
```

### GET /api/v1/auth/users _(admin only)_
Returns array of all users (no password hashes).

### POST /api/v1/auth/users _(admin only)_
```json
{ "email": "user@co.com", "password": "Pass123!", "name": "Jane", "role": "operator" }
```

### PUT /api/v1/auth/users/:id _(admin only)_
```json
{ "name": "Jane Smith", "role": "analyst", "active": 0 }
```

---

## Campaigns

### GET /api/v1/campaigns
Query: `status`, `search`, `page`, `limit`

### POST /api/v1/campaigns _(operator+)_
```json
{
  "name": "Houston Healthcare Q2",
  "description": "...",
  "daily_limit": 10,
  "icp_config": { "industries": ["Healthcare"], "locations": ["Houston, TX"] },
  "sender_config": {},
  "schedule_config": {}
}
```

### GET /api/v1/campaigns/:id
Includes `contact_count`.

### PUT /api/v1/campaigns/:id _(operator+)_
Any subset of the create fields, plus `status` (`draft`, `active`, `paused`, `archived`).

### DELETE /api/v1/campaigns/:id _(operator+)_
Archives the campaign (sets `status=archived`). Contacts are preserved.

### POST /api/v1/campaigns/:id/clone _(operator+)_
Creates a draft copy of the campaign.

---

## Accounts

### GET /api/v1/accounts
Query: `search`, `industry`, `page`, `limit`

### POST /api/v1/accounts _(operator+)_
```json
{ "company_name": "Acme Dental", "domain": "acmedental.com", "industry": "Dental", "city": "Houston", "state": "TX" }
```

### GET /api/v1/accounts/:id
### PUT /api/v1/accounts/:id _(operator+)_

---

## Contacts

### GET /api/v1/contacts
Query: `campaign_id`, `status`, `search`, `page`, `limit`

### POST /api/v1/contacts _(operator+)_
```json
{
  "account_id": "...",
  "campaign_id": "...",
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@acmedental.com",
  "title": "Office Manager",
  "email_source": "hunter",
  "email_verified": true,
  "score": 80,
  "outreach_angle": "hipaa-compliance"
}
```

### GET /api/v1/contacts/:id
### PUT /api/v1/contacts/:id _(operator+)_
### POST /api/v1/contacts/bulk _(operator+)_
```json
{ "ids": ["id1", "id2"], "status": "suppressed" }
```

---

## Sequences

### GET /api/v1/sequences?campaign_id=:id
Returns sequences with their steps.

### POST /api/v1/sequences _(operator+)_
```json
{
  "campaign_id": "...",
  "name": "3-step intro",
  "steps": [
    { "step_number": 1, "delay_days": 0, "delay_hours": 0, "tone": "professional" },
    { "step_number": 2, "delay_days": 3, "delay_hours": 0, "tone": "friendly" },
    { "step_number": 3, "delay_days": 7, "delay_hours": 0, "tone": "direct" }
  ]
}
```

### GET /api/v1/sequences/:id
### PUT /api/v1/sequences/:id _(operator+)_
### DELETE /api/v1/sequences/:id _(operator+)_

---

## Messages / Review Queue

### GET /api/v1/messages/drafts
Query: `status` (`pending_review`, `approved`, `rejected`), `campaign_id`, `page`, `limit`

### GET /api/v1/messages/drafts/:id

### POST /api/v1/messages/drafts/:id/approve _(operator+)_
Approves draft and enqueues it for sending. Returns updated draft.

### POST /api/v1/messages/drafts/:id/reject _(operator+)_
```json
{ "reason": "Off-brand tone" }
```

### POST /api/v1/messages/generate _(operator+)_
Manually trigger AI generation for a contact:
```json
{ "contactId": "...", "campaignId": "...", "stepId": "..." }
```

---

## Analytics

### GET /api/v1/analytics/dashboard
Returns:
```json
{
  "active_campaigns": 2,
  "contacts_in_pipeline": 48,
  "emails_sent_this_week": 12,
  "overall_open_rate": 28.5,
  "overall_reply_rate": 4.2,
  "pending_review_count": 3,
  "failed_jobs": 0
}
```

### GET /api/v1/analytics/campaigns/:id
Returns per-campaign send/open/click/reply/bounce stats with rates.

---

## Suppression

### GET /api/v1/suppression
Query: `search`, `page`, `limit`

### POST /api/v1/suppression _(operator+)_
```json
{ "email": "optout@co.com", "reason": "manual" }
// or
{ "domain": "competitor.com", "reason": "do_not_contact" }
```
Reasons: `manual`, `unsubscribe`, `hard_bounce`, `complaint`, `do_not_contact`

### DELETE /api/v1/suppression/:id _(operator+)_

---

## Audit Log

### GET /api/v1/audit
Query: `page`, `limit`

Returns paginated list of audit events with `action`, `entity_type`, `entity_id`, `user_email`, `created_at`.

---

## Admin _(admin role required)_

### GET /api/v1/admin/system
Returns uptime, Node version, queue stats, entity counts, feature flags.

### GET /api/v1/admin/jobs
Query: `status` (`pending`, `processing`, `completed`, `dead`), `type`, `page`, `limit`

### POST /api/v1/admin/jobs/:id/retry
Resets attempts to 0 and re-queues a failed/dead job.

### DELETE /api/v1/admin/jobs/:id
Permanently deletes a job record.

### POST /api/v1/admin/pipeline/run
Manually trigger a sequence step job:
```json
{ "contactId": "...", "campaignId": "..." }
```

---

## Tracking (Public — no auth required)

### GET /t/o/:eventId
Returns a 1×1 transparent GIF. Records an open event (bot-filtered by User-Agent).

### GET /t/c/:eventId?url=:encoded
Redirects to `url` and records a click event. Only `http:` and `https:` URLs allowed.

### GET /unsubscribe/:token
Processes unsubscribe. Token is `base64url(contactId:email)`. Marks contact unsubscribed and adds email to suppression. Returns HTML confirmation page.

### GET /health
```json
{ "status": "ok", "uptime": 42.3, "db": "ok", "version": "1.0.0" }
```
No auth required. `status` is `ok` or `degraded`.
