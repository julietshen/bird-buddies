'use strict';

// SQLite data layer for Bird Buddies.
// A single file database keeps the demo dependency-light and easy to reset
// (just delete bird-buddies.db).

const Database = require('better-sqlite3');
const { dbPath } = require('./config');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    display    TEXT NOT NULL,
    bird       TEXT NOT NULL DEFAULT '🐦',
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    caption    TEXT NOT NULL DEFAULT '',
    -- Moderation state, driven by Coop enforcement webhooks:
    --   'active'  = normal, 'flagged' = soft action, 'removed' = taken down.
    status     TEXT NOT NULL DEFAULT 'active',
    mod_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id   INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Friendships are stored as directed rows. A pending request is one row;
  -- acceptance adds the reciprocal row. "Friends" = both directions exist.
  CREATE TABLE IF NOT EXISTS friendships (
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted'
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (requester_id, addressee_id)
  );

  -- Reports filed by users. Bird Buddies' own record so the report count sent
  -- to Coop is accurate (one row per report). Deduped per (reporter, target).
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,            -- 'photo' | 'comment'
    target_id   INTEGER NOT NULL,
    reason_id   TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (reporter_id, target_type, target_id)
  );
`);

// Lightweight migration for databases created before the Coop integration
// added moderation columns to `photos`.
const photoCols = db.prepare('PRAGMA table_info(photos)').all().map((c) => c.name);
if (!photoCols.includes('status')) db.exec("ALTER TABLE photos ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
if (!photoCols.includes('mod_reason')) db.exec('ALTER TABLE photos ADD COLUMN mod_reason TEXT');

module.exports = db;
