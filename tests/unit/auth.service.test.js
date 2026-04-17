'use strict';

require('../setup');

const { getDb, closeDb } = require('../../src/db');
const authService = require('../../src/services/auth.service');
const { createAdmin, createUser } = require('../fixtures/factory');

let db;

beforeAll(() => { db = getDb(); });
afterAll(() => { closeDb(); });
beforeEach(() => {
  db.prepare('DELETE FROM users').run();
});

describe('login', () => {
  it('returns token and user on valid credentials', async () => {
    const user = await createAdmin(db, { email: 'login@test.com', password: 'TestPass1!' });
    const result = await authService.login('login@test.com', 'TestPass1!');
    expect(result.token).toBeTruthy();
    expect(result.user.email).toBe('login@test.com');
    expect(result.user.role).toBe('admin');
    expect(result.user.password_hash).toBeUndefined();
  });

  it('throws AuthError on wrong password', async () => {
    await createAdmin(db, { email: 'wp@test.com', password: 'Correct1!' });
    const { AuthError } = require('../../src/utils/errors');
    await expect(authService.login('wp@test.com', 'WrongPass!')).rejects.toThrow(AuthError);
  });

  it('throws AuthError for unknown email', async () => {
    const { AuthError } = require('../../src/utils/errors');
    await expect(authService.login('nobody@test.com', 'any')).rejects.toThrow(AuthError);
  });

  it('is case-insensitive for email', async () => {
    await createAdmin(db, { email: 'case@test.com', password: 'Pass1!' });
    const result = await authService.login('CASE@TEST.COM', 'Pass1!');
    expect(result.user.email).toBe('case@test.com');
  });
});

describe('createUser', () => {
  it('creates a user with hashed password', async () => {
    const user = await authService.createUser({ email: 'new@test.com', password: 'NewPass1!', name: 'New User', role: 'analyst' });
    expect(user.id).toBeTruthy();
    expect(user.email).toBe('new@test.com');
    expect(user.role).toBe('analyst');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    expect(row.password_hash).not.toBe('NewPass1!');
  });

  it('throws ConflictError for duplicate email', async () => {
    await authService.createUser({ email: 'dup@test.com', password: 'DupPass1!', role: 'analyst' });
    const { ConflictError } = require('../../src/utils/errors');
    await expect(authService.createUser({ email: 'DUP@TEST.COM', password: 'DupPass1!', role: 'analyst' })).rejects.toThrow(ConflictError);
  });

  it('throws ValidationError for short password', async () => {
    const { ValidationError } = require('../../src/utils/errors');
    await expect(authService.createUser({ email: 'short@test.com', password: '123', role: 'analyst' })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for missing email', async () => {
    const { ValidationError } = require('../../src/utils/errors');
    await expect(authService.createUser({ password: 'Pass1!', role: 'analyst' })).rejects.toThrow(ValidationError);
  });
});

describe('changePassword', () => {
  it('updates password successfully', async () => {
    const user = await createUser(db, { email: 'chpw@test.com', password: 'OldPass1!' });
    await authService.changePassword(user.id, 'OldPass1!', 'NewPass99!');
    const result = await authService.login('chpw@test.com', 'NewPass99!');
    expect(result.token).toBeTruthy();
  });

  it('throws AuthError on wrong current password', async () => {
    const user = await createUser(db, { email: 'chpw2@test.com', password: 'RealPass1!' });
    const { AuthError } = require('../../src/utils/errors');
    await expect(authService.changePassword(user.id, 'WrongPass!', 'NewPass12!')).rejects.toThrow(AuthError);
  });
});

describe('listUsers', () => {
  it('returns all active users', async () => {
    await createUser(db, { email: 'u1@test.com' });
    await createUser(db, { email: 'u2@test.com' });
    const users = authService.listUsers();
    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(users[0].password_hash).toBeUndefined();
  });
});
