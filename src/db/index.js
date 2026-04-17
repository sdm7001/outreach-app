'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrations');

let _db = null;

function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/outreach.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('synchronous = NORMAL');

  runMigrations(_db);

  process.on('SIGTERM', () => { if (_db) { _db.close(); _db = null; } });
  process.on('SIGINT',  () => { if (_db) { _db.close(); _db = null; } });

  return _db;
}

function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

module.exports = { getDb, closeDb };
