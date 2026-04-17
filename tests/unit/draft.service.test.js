'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const draftService = require('../../src/services/draft.service');
const { createAdmin, createCampaign, createContact, createDraft } = require('../fixtures/factory');
const { NotFoundError } = require('../../src/utils/errors');

let db, adminId, campaign, contact;

beforeAll(async () => {
  db = getDb();
  const admin = await createAdmin(db);
  adminId = admin.id;
});

afterAll(() => { closeDb(); });

beforeEach(() => {
  db.prepare('DELETE FROM message_drafts').run();
  db.prepare('DELETE FROM contacts').run();
  db.prepare('DELETE FROM campaigns').run();
  campaign = createCampaign(db);
  contact = createContact(db, { campaign_id: campaign.id });
});

// ── getDraftStats ─────────────────────────────────────────────────────────

describe('getDraftStats', () => {
  it('returns counts by status', () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'approved' });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'rejected' });

    const stats = draftService.getDraftStats(campaign.id);
    expect(stats.total).toBe(3);
    expect(stats.pending_review).toBe(1);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
  });

  it('returns zeros for campaign with no drafts', () => {
    const stats = draftService.getDraftStats(campaign.id);
    expect(stats.total).toBe(0);
    expect(stats.pending_review).toBe(0);
  });
});

// ── approveDraft ──────────────────────────────────────────────────────────

describe('approveDraft', () => {
  it('sets status to approved and records reviewer', () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });
    const result = draftService.approveDraft(draft.id, adminId);
    expect(result.status).toBe('approved');
    expect(result.reviewed_by).toBe(adminId);
    expect(result.reviewed_at).toBeTruthy();
  });

  it('throws NotFoundError for unknown draft id', () => {
    expect(() => draftService.approveDraft('bad-id', adminId)).toThrow(NotFoundError);
  });
});

// ── rejectDraft ───────────────────────────────────────────────────────────

describe('rejectDraft', () => {
  it('sets status to rejected and records reviewer', () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });
    const result = draftService.rejectDraft(draft.id, adminId, 'Too generic');
    expect(result.status).toBe('rejected');
    expect(result.reviewed_by).toBe(adminId);
  });
});

// ── editDraft ─────────────────────────────────────────────────────────────

describe('editDraft', () => {
  it('updates subject and body', () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id });
    const result = draftService.editDraft(draft.id, { subject: 'New Subject', body: 'New Body' }, adminId);
    expect(result.subject).toBe('New Subject');
    expect(result.body).toBe('New Body');
    expect(result.reviewed_by).toBe(adminId);
  });

  it('recomputes spam_score after edit', () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, spam_score: 0 });
    const result = draftService.editDraft(draft.id, { body: 'FREE cash! Act now! Click here! Guaranteed winner!' }, adminId);
    expect(result.spam_score).toBeGreaterThan(0);
  });
});

// ── bulkApproveSafe ───────────────────────────────────────────────────────

describe('bulkApproveSafe', () => {
  it('approves drafts with spam_score at or below threshold', () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 2 });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 4 });

    const count = draftService.bulkApproveSafe(campaign.id, { spamThreshold: 5, userId: adminId });
    expect(count).toBe(2);
  });

  it('does not approve drafts with spam_score above threshold', () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 8 });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review', spam_score: 2 });

    const count = draftService.bulkApproveSafe(campaign.id, { spamThreshold: 5, userId: adminId });
    expect(count).toBe(1);

    const stats = draftService.getDraftStats(campaign.id);
    expect(stats.approved).toBe(1);
    expect(stats.pending_review).toBe(1);
  });
});

// ── regenerateDraft ───────────────────────────────────────────────────────

describe('regenerateDraft', () => {
  it('resets status to pending_review', async () => {
    const draft = createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'rejected' });
    await draftService.regenerateDraft(draft.id, adminId);
    const updated = draftService.getDraft(draft.id);
    expect(updated.status).toBe('pending_review');
  });
});

// ── listDrafts ────────────────────────────────────────────────────────────

describe('listDrafts', () => {
  it('filters by status', () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'pending_review' });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'approved' });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id, status: 'rejected' });

    const pendingList = draftService.listDrafts(campaign.id, { status: 'pending_review' });
    expect(pendingList.data.every(d => d.status === 'pending_review')).toBe(true);

    const approvedList = draftService.listDrafts(campaign.id, { status: 'approved' });
    expect(approvedList.data.every(d => d.status === 'approved')).toBe(true);
  });

  it('returns paginated results for a campaign', () => {
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id });
    createDraft(db, { contact_id: contact.id, campaign_id: campaign.id });

    const result = draftService.listDrafts(campaign.id, { page: 1, limit: 10 });
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });
});
