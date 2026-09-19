'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');

const DB_PATH = cfg.dbPath;
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS words (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  word          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  meaning_cn    TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  grade_level   INTEGER NOT NULL DEFAULT 3,
  base_diff     REAL NOT NULL DEFAULT 2.0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL DEFAULT '',
  ref_text      TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL DEFAULT (date('now')),
  image_path    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_words (
  page_id       INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, word_id)
);

CREATE TABLE IF NOT EXISTS test_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  test_type     TEXT NOT NULL,            -- 'meaning' | 'spelling'
  mode          TEXT NOT NULL DEFAULT 'pick', -- 'pick' | 'redo'
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  word_count    INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  passed        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  word_id       INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  correct       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS word_stats (
  word_id         INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
  difficulty      REAL NOT NULL DEFAULT 2.0,
  times_tested    INTEGER NOT NULL DEFAULT 0,
  times_failed    INTEGER NOT NULL DEFAULT 0,
  consecutive_pass INTEGER NOT NULL DEFAULT 0,
  last_tested_at  TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// Seed default settings
const getSetting = (key, def) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
};
const setSetting = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
};

// Migration: add in_hardset column to word_stats if missing (guarded).
{
  const cols = db.prepare('PRAGMA table_info(word_stats)').all().map((c) => c.name);
  if (!cols.includes('in_hardset')) {
    db.exec('ALTER TABLE word_stats ADD COLUMN in_hardset INTEGER NOT NULL DEFAULT 0');
  }
}
// Migration: backfill category for legacy words with no category -> 未完 (idempotent).
db.prepare(`UPDATE words SET category = '未完' WHERE category = '' OR category IS NULL`).run();

// Migration: backfill legacy empty categories to 未完 (idempotent, cheap).
db.prepare(`UPDATE words SET category = '未完' WHERE category = '' OR category IS NULL`).run();

// Default grade (child's year) used when importing words.
setSetting('default_grade', getSetting('default_grade', '3'));

// Migration: rebuild the fire (streak) from historical sessions (once).
// Approx rule: within one day, per test (identical word set), the FIRST attempt passing => +1, capped +2 per day.
if (!db.prepare("SELECT value FROM settings WHERE key = 'streak_rebuilt'").get()) {
  const sessions = db.prepare('SELECT id, date, passed FROM test_sessions ORDER BY id').all();
  const sigStmt = db.prepare('SELECT GROUP_CONCAT(word_id) AS sig FROM test_answers WHERE session_id = ? ORDER BY word_id');
  const firstByDayTest = new Map();
  for (const s of sessions) {
    const day = String(s.date).slice(0, 10);
    const sig = sigStmt.get(s.id).sig || ('session:' + s.id);
    const key = day + '|' + sig;
    if (!firstByDayTest.has(key)) firstByDayTest.set(key, { day, passed: !!s.passed });
  }
  const perDay = new Map();
  for (const g of firstByDayTest.values()) if (g.passed) perDay.set(g.day, (perDay.get(g.day) || 0) + 1);
  let total = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const [day, n] of perDay) {
    total += Math.min(n, 2);
    if (day === today) setSetting('streak_day_count', Math.min(n, 2));
  }
  setSetting('streak', String(Math.max(total, Number(getSetting('streak', '0')) || 0)));
  setSetting('streak_rebuilt', String(total));
}

module.exports = { db, getSetting, setSetting, DB_PATH };
