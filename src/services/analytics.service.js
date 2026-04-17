'use strict';

const { getDb } = require('../db');

function getCampaignStats(campaignId, { startDate, endDate } = {}) {
  const db = getDb();
  const conditions = campaignId ? ['campaign_id = ?'] : [];
  const params = campaignId ? [campaignId] : [];

  if (startDate) { conditions.push('sent_at >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('sent_at <= ?'); params.push(endDate); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_sent,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounced
    FROM send_events ${where}
  `).get(...params);

  const unsubCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM contacts WHERE campaign_id = ? AND status = 'unsubscribed'
  `).get(campaignId || '');

  const total = stats.total_sent || 0;
  return {
    campaign_id: campaignId,
    total_sent: total,
    delivered: stats.delivered || 0,
    opened: stats.opened || 0,
    clicked: stats.clicked || 0,
    replied: stats.replied || 0,
    bounced: stats.bounced || 0,
    unsubscribed: unsubCount ? unsubCount.cnt : 0,
    open_rate: total > 0 ? Math.round((stats.opened / total) * 1000) / 10 : 0,
    click_rate: total > 0 ? Math.round((stats.clicked / total) * 1000) / 10 : 0,
    reply_rate: total > 0 ? Math.round((stats.replied / total) * 1000) / 10 : 0,
    bounce_rate: total > 0 ? Math.round((stats.bounced / total) * 1000) / 10 : 0,
  };
}

function getDashboardStats() {
  const db = getDb();

  const activeCampaigns = db.prepare(
    "SELECT COUNT(*) as cnt FROM campaigns WHERE status = 'active'"
  ).get().cnt;

  const contactsInPipeline = db.prepare(
    "SELECT COUNT(*) as cnt FROM contacts WHERE status NOT IN ('unsubscribed','bounced','suppressed')"
  ).get().cnt;

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const emailsSentWeek = db.prepare(
    "SELECT COUNT(*) as cnt FROM send_events WHERE status = 'sent' AND sent_at >= ?"
  ).get(weekStart).cnt;

  const allStats = getCampaignStats(null);

  const pendingDrafts = db.prepare(
    "SELECT COUNT(*) as cnt FROM message_drafts WHERE status = 'pending_review'"
  ).get().cnt;

  const failedJobs = db.prepare(
    "SELECT COUNT(*) as cnt FROM jobs WHERE status = 'dead'"
  ).get().cnt;

  return {
    active_campaigns: activeCampaigns,
    contacts_in_pipeline: contactsInPipeline,
    emails_sent_this_week: emailsSentWeek,
    overall_open_rate: allStats.open_rate,
    pending_review_count: pendingDrafts,
    failed_jobs: failedJobs,
  };
}

function getContactTimeline(contactId) {
  const db = getDb();
  const events = db.prepare(`
    SELECT 'email_event' as source, event_type, event_data, ip_address, created_at
    FROM email_events
    WHERE contact_id = ?
    UNION ALL
    SELECT 'send_event' as source, status, NULL, NULL, created_at
    FROM send_events
    WHERE contact_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(contactId, contactId);

  return events.map(e => ({
    ...e,
    event_data: e.event_data ? JSON.parse(e.event_data) : null,
  }));
}

function getSequenceStepStats(sequenceId) {
  const db = getDb();
  const steps = db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number').all(sequenceId);

  return steps.map(step => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as sent,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM send_events WHERE sequence_step_id = ?
    `).get(step.id);

    return { ...step, stats };
  });
}

function getDailyTrend(campaignId, days = 14) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, emails_sent, emails_opened, clicks, replies, bounces, unsubscribes
    FROM daily_stats
    WHERE campaign_id = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(campaignId || null, days);

  return rows.reverse();
}

function getQueueHealth() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status
  `).all();

  const result = { pending: 0, processing: 0, completed: 0, dead: 0, total: 0 };
  for (const row of stats) {
    result[row.status] = row.count;
    result.total += row.count;
  }
  return result;
}

module.exports = { getCampaignStats, getDashboardStats, getContactTimeline, getSequenceStepStats, getDailyTrend, getQueueHealth };
