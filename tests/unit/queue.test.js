'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const { enqueue, dequeue, complete, fail, getStats } = require('../../src/workers/queue');

let db;

beforeAll(() => { db = getDb(); });
afterAll(() => { closeDb(); });
beforeEach(() => { db.prepare('DELETE FROM jobs').run(); });

describe('enqueue', () => {
  it('creates a pending job', () => {
    const id = enqueue('test_job', { foo: 'bar' });
    expect(typeof id).toBe('string');
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    expect(job.status).toBe('pending');
    expect(job.type).toBe('test_job');
    expect(JSON.parse(job.payload)).toEqual({ foo: 'bar' });
  });

  it('respects idempotency key — duplicate skipped', () => {
    const id1 = enqueue('test_job', { x: 1 }, { idempotencyKey: 'idem-1' });
    const id2 = enqueue('test_job', { x: 2 }, { idempotencyKey: 'idem-1' });
    expect(id1).toBe(id2);
    const count = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE idempotency_key = ?').get('idem-1').c;
    expect(count).toBe(1);
  });

  it('schedules job in the future with delayMs', () => {
    enqueue('future_job', {}, { delayMs: 60000 });
    const jobs = dequeue(['future_job'], 10);
    expect(jobs.length).toBe(0); // Not yet scheduled
  });
});

describe('dequeue', () => {
  it('returns pending jobs and marks them processing', () => {
    enqueue('work_job', { task: 'a' });
    const jobs = dequeue(['work_job'], 10);
    expect(jobs.length).toBe(1);
    expect(jobs[0].payload).toEqual({ task: 'a' });
    const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobs[0].id);
    expect(job.status).toBe('processing');
  });

  it('filters by type', () => {
    enqueue('type_a', {});
    enqueue('type_b', {});
    const jobs = dequeue(['type_a'], 10);
    expect(jobs.length).toBe(1);
    expect(jobs[0].type).toBe('type_a');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) enqueue('bulk_job', { i });
    const jobs = dequeue(['bulk_job'], 3);
    expect(jobs.length).toBe(3);
  });
});

describe('complete', () => {
  it('marks job completed', () => {
    const id = enqueue('complete_job', {});
    dequeue(['complete_job']);
    complete(id);
    const job = db.prepare('SELECT status, completed_at FROM jobs WHERE id = ?').get(id);
    expect(job.status).toBe('completed');
    expect(job.completed_at).toBeTruthy();
  });
});

describe('fail', () => {
  it('retries job if attempts < max_attempts', () => {
    const id = enqueue('retry_job', {}, { maxAttempts: 3 });
    dequeue(['retry_job']);
    fail(id, new Error('transient error'));
    const job = db.prepare('SELECT status, attempts FROM jobs WHERE id = ?').get(id);
    expect(job.status).toBe('pending'); // Re-queued for retry
    expect(job.attempts).toBe(1);
  });

  it('marks job dead after max attempts', () => {
    const id = enqueue('dead_job', {}, { maxAttempts: 1 });
    dequeue(['dead_job']);
    fail(id, new Error('fatal'));
    const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id);
    expect(job.status).toBe('dead');
  });
});

describe('getStats', () => {
  it('returns counts by status', () => {
    enqueue('stats_job', {});
    const stats = getStats();
    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('dead');
    expect(stats.pending).toBeGreaterThanOrEqual(1);
  });
});
