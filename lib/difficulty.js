'use strict';
// Dynamic difficulty engine.
// A word's difficulty drifts up when she fails and drifts down (with a bonus
// after a string of straight passes) when she keeps passing.

const INC_ON_FAIL = 0.5;      // difficulty increase per failure
const DEC_ON_PASS = 0.1;      // difficulty decrease per pass
const STREAK_BONUS = 0.25;    // extra decrease after >=3 straight passes
const MIN_DIFF = 1.0;
const MAX_DIFF = 5.0;
const NET_PASS_NEEDED = 3;    // 测试次数 - 失败次数 >= 3 即视为"学完"

// Difficulty label used in UI + "difficult pool".
function label(d) {
  if (d >= 4) return 'hard';
  if (d >= 3) return 'medium';
  if (d >= 2) return 'easy';
  return 'easy';
}

// Given a word_id, return current stats (creating the row if missing).
function ensureStats(db, wordId) {
  const w = db.prepare('SELECT base_diff FROM words WHERE id = ?').get(wordId);
  if (!w) return null;
  db.prepare(
    'INSERT OR IGNORE INTO word_stats (word_id, difficulty) VALUES (?, ?)'
  ).run(wordId, w.base_diff);
  return db.prepare('SELECT * FROM word_stats WHERE word_id = ?').get(wordId);
}

function recordResult(db, wordId, correct) {
  const st = ensureStats(db, wordId);
  if (!st) return null;

  db.prepare('UPDATE words SET base_diff = difficulty FROM word_stats ws WHERE words.id = ws.word_id AND words.id = ?')
    .run(wordId);

  const newTimesTested = st.times_tested + 1;
  const newTimesFailed = st.times_failed + (correct ? 0 : 1);
  const newStreak = correct ? st.consecutive_pass + 1 : 0;

  let newDiff = st.difficulty;
  if (!correct) {
    newDiff = Math.min(MAX_DIFF, newDiff + INC_ON_FAIL);
  } else {
    const dec = DEC_ON_PASS + (newStreak >= 3 ? STREAK_BONUS : 0);
    newDiff = Math.max(MIN_DIFF, newDiff - dec);
  }

  // Hard-set bookkeeping: any failure -> into the hard set;
  // 测试次数 - 失败次数 >= 3 ("通过") -> graduate out of the hard set.
  const netPasses = newTimesTested - newTimesFailed;
  let inHardset = st.in_hardset || 0;
  if (!correct) inHardset = 1;
  else if (netPasses >= NET_PASS_NEEDED) inHardset = 0;

  db.prepare(`
    UPDATE word_stats SET
      difficulty = ?, times_tested = ?, times_failed = ?,
      consecutive_pass = ?, last_tested_at = datetime('now'),
      in_hardset = ?
    WHERE word_id = ?
  `).run(Math.round(newDiff * 10) / 10, newTimesTested, newTimesFailed, newStreak, inHardset, wordId);

  // persist drift into words.base_diff so "hard" words stay tagged
  db.prepare('UPDATE words SET base_diff = ? WHERE id = ?').run(Math.round(newDiff * 10) / 10, wordId);

  // 通过 (测试次数-失败次数>=3): 分类 未完/空 -> 完成
  if (netPasses >= NET_PASS_NEEDED) {
    db.prepare(`UPDATE words SET category = '完成' WHERE id = ? AND category IN ('', '未完')`).run(wordId);
  }

  return { difficulty: Math.round(newDiff * 10) / 10, label: label(newDiff), in_hardset: inHardset };
}

function getStats(db, wordId) {
  const st = ensureStats(db, wordId);
  return st ? { ...st, label: label(st.difficulty) } : null;
}

// Words she finds hardest: highest dynamic difficulty / fail rate.
function difficultWords(db, limit = 40) {
  return db.prepare(`
    SELECT w.id, w.word, w.meaning_cn, w.category, w.grade_level,
           ws.difficulty, ws.times_tested, ws.times_failed, ws.consecutive_pass
    FROM word_stats ws JOIN words w ON w.id = ws.word_id
    WHERE ws.times_tested > 0
    ORDER BY ws.difficulty DESC, ws.times_failed DESC, ws.last_tested_at ASC
    LIMIT ?
  `).all(limit);
}

// Words currently in the "hard set" (in_hardset = 1).
// Ordered by most-recently-failed / highest difficulty so the most-relevant
// hard words come first (used to build 难词页 of 20).
function hardWords(db, limit = 0) {
  const sql = `
    SELECT w.id, w.word, w.meaning_cn, w.category, w.grade_level,
           ws.difficulty, ws.times_tested, ws.times_failed,
           ws.consecutive_pass, ws.last_tested_at
    FROM word_stats ws JOIN words w ON w.id = ws.word_id
    WHERE ws.in_hardset = 1
    ORDER BY ws.last_tested_at DESC, ws.difficulty DESC
    ${limit ? 'LIMIT ?' : ''}
  `;
  return limit ? db.prepare(sql).all(limit) : db.prepare(sql).all();
}

module.exports = { label, recordResult, getStats, difficultWords, hardWords };
