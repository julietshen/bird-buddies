'use strict';

// SQLite data layer for Bird Buddies.
// A single file database keeps the demo dependency-light and easy to reset
// (just delete bird-buddies.db).

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'bird-buddies.db'));
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
`);

module.exports = db;
