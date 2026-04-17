'use strict';

require('../setup');

const supertest = require('supertest');
const app = require('../../server');
const { getDb, closeDb } = require('../../src/db');
const { createAdmin, createUser } = require('../fixtures/factory');

let db, adminToken, adminUser;

beforeAll(async () => {
  db = getDb();
  adminUser = await createAdmin(db, { email: 'admin-auth@test.com', password: 'Admin1234!' });
  const res = await supertest(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin-auth@test.com', password: 'Admin1234!' });
  adminToken = res.body.token;
});
afterAll(() => { closeDb(); });

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with token on valid credentials', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-auth@test.com', password: 'Admin1234!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('admin-auth@test.com');
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('returns 401 on wrong password', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-auth@test.com', password: 'WrongPass!' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_ERROR');
  });

  it('returns 400 when fields missing', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin-auth@test.com' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for unknown email', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.com', password: 'Pass!' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns current user when authenticated', async () => {
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin-auth@test.com');
    expect(res.body.role).toBe('admin');
  });

  it('returns 401 without token', async () => {
    const res = await supertest(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/users', () => {
  it('admin can list users', async () => {
    const res = await supertest(app)
      .get('/api/v1/auth/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('non-admin cannot list users', async () => {
    const op = await createUser(db, { email: 'op-listuser@test.com', password: 'Op12345!', role: 'operator' });
    const opLogin = await supertest(app).post('/api/v1/auth/login').send({ email: op.email, password: op.password });
    const opToken = opLogin.body.token;
    const res = await supertest(app)
      .get('/api/v1/auth/users')
      .set('Authorization', `Bearer ${opToken}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/auth/users', () => {
  it('admin can create a user', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newuser@test.com', password: 'NewPass123!', name: 'New', role: 'analyst' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newuser@test.com');
  });

  it('returns 409 for duplicate email', async () => {
    await supertest(app)
      .post('/api/v1/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dup-api@test.com', password: 'Pass123!', role: 'analyst' });
    const res = await supertest(app)
      .post('/api/v1/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'dup-api@test.com', password: 'Pass123!', role: 'analyst' });
    expect(res.status).toBe(409);
  });
});
