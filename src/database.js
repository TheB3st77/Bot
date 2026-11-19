const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/eskmc.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (guild_id, key)
  );
  CREATE TABLE IF NOT EXISTS points (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS rank_thresholds (
    guild_id TEXT NOT NULL,
    rank_index INTEGER NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, rank_index)
  );
  CREATE TABLE IF NOT EXISTS member_ranks (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rank_index INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS rank_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    from_rank INTEGER NOT NULL,
    to_rank INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guild_id, name)
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id TEXT,
    payload TEXT NOT NULL,
    reviewer_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS requests_pending ON requests (guild_id, user_id, kind, status);
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_request_per_kind
    ON requests (guild_id, user_id, kind) WHERE status IN ('pending', 'processing');
  CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    cost INTEGER NOT NULL CHECK (cost > 0),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reward_id INTEGER NOT NULL,
    cost INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.prepare(`UPDATE requests SET status = 'pending', reviewer_id = NULL, reviewed_at = NULL
  WHERE status = 'processing'`).run();

const rankNames = ['Mini Media', 'Media', 'Media +', 'Famoso', 'Partner', 'Owner Media'];

function ensureRankThresholds(guildId) {
  const defaults = [0, 100, 250, 500, 1000, 2000];
  const insert = db.prepare('INSERT OR IGNORE INTO rank_thresholds (guild_id, rank_index, points) VALUES (?, ?, ?)');
  defaults.forEach((value, index) => insert.run(guildId, index, value));
}

function getSetting(guildId, key) {
  return db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key)?.value ?? null;
}

function setSetting(guildId, key, value) {
  db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`).run(guildId, key, value);
}

function logAction(guildId, actorId, action, targetId, details) {
  db.prepare('INSERT INTO audit_log (guild_id, actor_id, action, target_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, actorId, action, targetId || null, details);
}

module.exports = { db, rankNames, ensureRankThresholds, getSetting, setSetting, logAction };
