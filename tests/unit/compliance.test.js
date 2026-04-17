'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const { addSuppression, addDomainSuppression, isSuppress, removeSuppression, listSuppression, processUnsubscribe, processBounce } = require('../../src/services/compliance.service');
const { createContact } = require('../fixtures/factory');

let db;

beforeAll(() => { db = getDb(); });
afterAll(() => { closeDb(); });
beforeEach(() => {
  db.prepare('DELETE FROM suppression').run();
  db.prepare('DELETE FROM email_events').run();
  db.prepare('DELETE FROM audit_logs').run();
  db.prepare('DELETE FROM contacts').run();
  db.prepare('DELETE FROM accounts').run();
});

describe('isSuppress', () => {
  it('returns false for non-suppressed email', () => {
    expect(isSuppress('clean@example.com')).toBe(false);
  });

  it('returns true for suppressed email', () => {
    addSuppression('bad@example.com', 'manual', 'test', null);
    expect(isSuppress('bad@example.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    addSuppression('BAD@EXAMPLE.COM', 'manual', 'test', null);
    expect(isSuppress('bad@example.com')).toBe(true);
  });

  it('matches domain suppression', () => {
    addDomainSuppression('spammy.com', 'complaint', 'test', null);
    expect(isSuppress('user@spammy.com')).toBe(true);
    expect(isSuppress('other@spammy.com')).toBe(true);
    expect(isSuppress('user@clean.com')).toBe(false);
  });

  it('returns false for empty/null input', () => {
    expect(isSuppress('')).toBe(false);
    expect(isSuppress(null)).toBe(false);
  });
});

describe('addSuppression', () => {
  it('adds email to suppression', () => {
    addSuppression('new@test.com', 'manual', 'admin', null);
    expect(isSuppress('new@test.com')).toBe(true);
  });

  it('is idempotent — duplicate add does not throw', () => {
    addSuppression('dup@test.com', 'manual', 'admin', null);
    expect(() => addSuppression('dup@test.com', 'manual', 'admin', null)).not.toThrow();
  });

  it('is listed in listSuppression', () => {
    addSuppression('listed@test.com', 'complaint', 'system', null);
    const result = listSuppression();
    expect(result.data.some(s => s.email === 'listed@test.com')).toBe(true);
  });
});

describe('removeSuppression', () => {
  it('removes an existing suppression', () => {
    const s = addSuppression('remove-me@test.com', 'manual', 'test', null);
    expect(isSuppress('remove-me@test.com')).toBe(true);
    removeSuppression(s.id);
    expect(isSuppress('remove-me@test.com')).toBe(false);
  });

  it('throws NotFoundError for unknown id', () => {
    const { NotFoundError } = require('../../src/utils/errors');
    expect(() => removeSuppression('nonexistent-id')).toThrow(NotFoundError);
  });
});

describe('processUnsubscribe', () => {
  it('marks contact unsubscribed and adds to suppression', () => {
    const contact = createContact(db, { email: 'unsub@test.com' });
    processUnsubscribe(contact.id, contact.email);
    const updated = db.prepare('SELECT status FROM contacts WHERE id = ?').get(contact.id);
    expect(updated.status).toBe('unsubscribed');
    expect(isSuppress('unsub@test.com')).toBe(true);
  });
});

describe('processBounce', () => {
  it('marks contact bounced and suppresses on hard bounce', () => {
    const contact = createContact(db, { email: 'hard-bounce@test.com' });
    processBounce(contact.id, contact.email, 'hard');
    const updated = db.prepare('SELECT status FROM contacts WHERE id = ?').get(contact.id);
    expect(updated.status).toBe('bounced');
    expect(isSuppress('hard-bounce@test.com')).toBe(true);
  });

  it('marks soft_bounce but does not suppress', () => {
    const contact = createContact(db, { email: 'soft-bounce@test.com' });
    processBounce(contact.id, contact.email, 'soft');
    const updated = db.prepare('SELECT status FROM contacts WHERE id = ?').get(contact.id);
    expect(updated.status).toBe('soft_bounce');
    expect(isSuppress('soft-bounce@test.com')).toBe(false);
  });
});
