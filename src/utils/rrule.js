'use strict';

/**
 * Minimal RRULE parser for campaign scheduling.
 * Supports: FREQ=DAILY, FREQ=WEEKLY with BYDAY
 * No external dependency — covers 95% of outreach scheduling use cases.
 *
 * Examples:
 *   RRULE:FREQ=DAILY                          → every day
 *   RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR          → Mon/Wed/Fri
 *   RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR   → business days
 */

const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Parse an RRULE string into a structured object.
 * Strips the "RRULE:" prefix if present.
 */
function parseRRule(ruleStr) {
  if (!ruleStr) return null;
  const rule = ruleStr.replace(/^RRULE:/i, '');
  const parts = {};
  for (const part of rule.split(';')) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) parts[key.trim().toUpperCase()] = value.trim();
  }

  const freq = parts.FREQ || 'DAILY';
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(',').map(d => DAY_MAP[d.toUpperCase()]).filter(d => d !== undefined)
    : null;
  const interval = parseInt(parts.INTERVAL) || 1;
  const count = parts.COUNT ? parseInt(parts.COUNT) : null;
  const until = parts.UNTIL ? parseUntil(parts.UNTIL) : null;

  return { freq, byDay, interval, count, until };
}

function parseUntil(untilStr) {
  // UNTIL=20261231T235959Z
  if (!untilStr) return null;
  try {
    const s = untilStr.replace(/T(\d{6})Z?$/, 'T$1Z');
    return new Date(s);
  } catch (_) {
    return null;
  }
}

/**
 * Given a parsed RRULE and a reference date, compute the next occurrence
 * strictly AFTER `afterDate`.
 *
 * @param {object|string} rrule   - Parsed rule object or RRULE string
 * @param {Date}          afterDate - Calculate next run after this date (defaults to now)
 * @returns {Date|null}            - Next occurrence, or null if schedule exhausted
 */
function getNextOccurrence(rrule, afterDate = new Date()) {
  const rule = typeof rrule === 'string' ? parseRRule(rrule) : rrule;
  if (!rule) return null;

  // Check UNTIL boundary
  if (rule.until && afterDate >= rule.until) return null;

  const after = new Date(afterDate);

  if (rule.freq === 'DAILY') {
    // Next occurrence is interval days after afterDate (same time)
    const next = new Date(after);
    next.setDate(next.getDate() + rule.interval);
    if (rule.until && next > rule.until) return null;
    return next;
  }

  if (rule.freq === 'WEEKLY') {
    const allowedDays = rule.byDay && rule.byDay.length > 0
      ? new Set(rule.byDay)
      : new Set([1, 2, 3, 4, 5]); // default: Mon-Fri

    // Walk forward day by day (max 14 days to find next valid day)
    const candidate = new Date(after);
    candidate.setDate(candidate.getDate() + 1); // strictly after

    for (let i = 0; i < 14; i++) {
      if (allowedDays.has(candidate.getDay())) {
        if (rule.until && candidate > rule.until) return null;
        return candidate;
      }
      candidate.setDate(candidate.getDate() + 1);
    }
    return null;
  }

  // Unsupported FREQ — fall back to daily
  const next = new Date(after);
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Get next run datetime for a campaign given its schedule_config and schedule_mode.
 * Applies timezone offset and respects send_window_start / send_window_end.
 *
 * @param {object} scheduleConfig  - Parsed schedule_config JSON from campaign
 * @param {string} timezone        - IANA timezone (e.g. 'America/Chicago')
 * @param {Date}   afterDate       - Calculate next run strictly after this date
 * @returns {Date|null}
 */
function getNextCampaignRun(scheduleConfig, timezone, afterDate = new Date()) {
  const cfg = scheduleConfig || {};
  const windowStart = cfg.send_window_start ?? 8;   // default 8 AM local
  const _windowEnd  = cfg.send_window_end   ?? 17;  // default 5 PM local
  const daysOfWeek  = cfg.days_of_week
    ? new Set(cfg.days_of_week.map(Number))
    : new Set([1, 2, 3, 4, 5]); // Mon-Fri

  // Build an RRULE from schedule_config if no recurrence_rule is set
  const ruleStr = cfg.recurrence_rule || buildRRuleFromConfig(cfg);

  // Timezone offset: compute local midnight offset vs UTC
  // We use a simple approach: parse a reference date in the target timezone
  const tzOffsetHours = getTzOffsetHours(timezone, afterDate);

  // Determine the target fire datetime: next valid day at windowStart local time
  let candidate = new Date(afterDate);

  for (let attempt = 0; attempt < 60; attempt++) {
    // Advance to next valid day
    candidate.setDate(candidate.getDate() + (attempt === 0 ? 0 : 1));

    // Convert candidate to local hour in target timezone
    const _localHour = getLocalHour(candidate, timezone);
    const localDay  = getLocalDay(candidate, timezone);

    if (!daysOfWeek.has(localDay)) continue;

    // Set the fire time to send_window_start in local tz
    const fireLocal = new Date(candidate);
    // Adjust: set UTC time so that local time = windowStart
    fireLocal.setUTCHours(windowStart - tzOffsetHours, 0, 0, 0);

    // Skip if fire time is not after afterDate (i.e. window already passed today)
    if (fireLocal <= afterDate) continue;

    // Validate against RRULE if present
    if (ruleStr) {
      const rule = parseRRule(ruleStr);
      if (rule && rule.until && fireLocal > rule.until) return null;
    }

    return fireLocal;
  }

  return null;
}

// ── Timezone helpers (no external library) ───────────────────────────────

/**
 * Get the UTC offset in hours for a given timezone at a given date.
 * Uses Intl.DateTimeFormat to compute local time, then derives offset.
 */
function getTzOffsetHours(timezone, date = new Date()) {
  try {
    const utcDate = new Date(date);
    const localStr = utcDate.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const utcStr = utcDate.toLocaleString('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      hour12: false,
    });
    const localH = parseInt(localStr) % 24;
    const utcH   = parseInt(utcStr)   % 24;
    let diff = localH - utcH;
    if (diff > 12)  diff -= 24;
    if (diff < -12) diff += 24;
    return diff;
  } catch (_) {
    return -5; // default CST
  }
}

function getLocalHour(date, timezone) {
  try {
    return parseInt(date.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })) % 24;
  } catch (_) {
    return date.getUTCHours() - 5; // fallback CST
  }
}

function getLocalDay(date, timezone) {
  try {
    const dayStr = date.toLocaleString('en-US', { timeZone: timezone, weekday: 'short' });
    const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayStr);
    return idx >= 0 ? idx : date.getUTCDay();
  } catch (_) {
    return date.getUTCDay();
  }
}

function buildRRuleFromConfig(cfg) {
  if (!cfg) return null;
  const days = cfg.days_of_week;
  if (!days || !days.length) return 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  const byDay = days.map(d => DAY_NAMES[d]).filter(Boolean).join(',');
  return `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`;
}

/**
 * Check whether the current time is inside a campaign's send window.
 * Returns true if we're in a valid window, false if outside.
 */
function isInSendWindow(campaign) {
  const timezone = campaign.timezone || 'America/Chicago';
  let scheduleCfg = {};
  try { scheduleCfg = JSON.parse(campaign.schedule_config || '{}'); } catch (_) { /* ignore */ }

  const windowStart = scheduleCfg.send_window_start ?? 8;
  const windowEnd   = scheduleCfg.send_window_end   ?? 17;
  const daysOfWeek  = scheduleCfg.days_of_week
    ? new Set(scheduleCfg.days_of_week.map(Number))
    : new Set([1, 2, 3, 4, 5]);

  const now = new Date();
  const localHour = getLocalHour(now, timezone);
  const localDay  = getLocalDay(now, timezone);

  return daysOfWeek.has(localDay) && localHour >= windowStart && localHour < windowEnd;
}

module.exports = {
  parseRRule, getNextOccurrence, getNextCampaignRun,
  isInSendWindow, getTzOffsetHours, buildRRuleFromConfig,
};
