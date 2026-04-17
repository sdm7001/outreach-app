'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function signJwt(payload, secret, expiresIn = '8h') {
  return jwt.sign(payload, secret, { expiresIn, algorithm: 'HS256' });
}

function verifyJwt(token, secret) {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, generateToken, signJwt, verifyJwt };
