'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { hashPassword, verifyPassword, signJwt } = require('../utils/crypto');
const { getConfig } = require('../config');
const { AuthError, NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

function findUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email.toLowerCase().trim());
}

function getUserById(id) {
  const db = getDb();
  const user = db.prepare('SELECT id,email,name,role,active,last_login,created_at FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('User not found');
  return user;
}

async function login(email, password) {
  const user = findUserByEmail(email);
  if (!user) throw new AuthError('Invalid email or password');

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AuthError('Invalid email or password');

  const config = getConfig();
  const token = signJwt(
    { id: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    `${config.JWT_EXPIRY_HOURS}h`
  );

  getDb().prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  logger.info('User logged in', { userId: user.id, email: user.email, role: user.role });

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  };
}

async function changePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new NotFoundError('User not found');

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw new AuthError('Current password is incorrect');

  if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');

  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, new Date().toISOString(), userId);

  logger.info('Password changed', { userId });
}

async function createUser(data) {
  const db = getDb();
  const { email, password, name, role = 'analyst' } = data;

  if (!email || !email.trim()) throw new ValidationError('Email is required', 'email');
  if (!password || password.length < 8) throw new ValidationError('Password must be at least 8 characters', 'password');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) throw new ConflictError('A user with this email already exists');

  const hash = await hashPassword(password);
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare('INSERT INTO users (id,email,password_hash,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run(id, email.toLowerCase().trim(), hash, name || null, role, now, now);

  logger.info('User created', { userId: id, email: email.toLowerCase().trim(), role });
  return { id, email: email.toLowerCase().trim(), name: name || null, role, active: 1 };
}

function listUsers() {
  return getDb()
    .prepare('SELECT id,email,name,role,active,last_login,created_at FROM users ORDER BY created_at DESC')
    .all();
}

function updateUser(id, data) {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('User not found');

  const allowed = ['name', 'role', 'active'];
  const fields = Object.keys(data).filter(k => allowed.includes(k));
  if (fields.length === 0) throw new ValidationError('No valid fields to update');

  const setClause = fields.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${setClause}, updated_at = ? WHERE id = ?`)
    .run(...fields.map(k => data[k]), new Date().toISOString(), id);

  return getUserById(id);
}

function deleteUser(id) {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) throw new NotFoundError('User not found');
  db.prepare('UPDATE users SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  logger.info('User deactivated', { userId: id });
}

module.exports = { login, changePassword, createUser, listUsers, updateUser, deleteUser, getUserById, findUserByEmail };
