'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const express = require('express');
const sharp = require('sharp');
const { db, setSetting, getSetting } = require('./lib/db');
const diff = require('./lib/difficulty');
const sglang = require('./lib/sglang');
const home = require('./lib/home');
const cfg = require('./lib/config');

const app = express();
app.use(express.json({ limit: '50mb' }));
const PORT = cfg.port;
const HOST = '0.0.0.0';
const LAN_IP = cfg.lanIp;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// SGLang backend service control (configured in config.json -> sglang.dir)
const SGLANG_DIR = cfg.sglang.dir;
const SGLANG_PID_FILE = path.join(__dirname, '.sglang-svc.pid');
const SGLANG_LOG = path.join(__dirname, '.sglang-svc.log');
const SVC_ENV = { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
const svc = { startingAt: 0 };

// ---------------------------------------------------------------- helpers
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cleanWord = (w) => String(w || '').trim();

// Ensure a word exists, return its id.
function ensureWord(row) {
  const w = row.word;
  const existing = db.prepare('SELECT id FROM words WHERE word = ? COLLATE NOCASE').get(w);
  if (existing) return existing.id;
  const grade = Number(row.grade_level) || Number(getSetting('default_grade', 3));
  const info = db.prepare(`
    INSERT INTO words (word, meaning_cn, category, grade_level, base_diff)
    VALUES (?, ?, ?, ?, ?)
  `).run(w, row.meaning_cn || '', row.category || '未完', grade, row.base_diff ?? 2.0);
  return info.lastInsertRowid;
}

// ---------------------------------------------------------------- model status
app.get('/api/model', async (_req, res) => {
  const online = await sglang.isModelOnline();
  res.json({ online });
});

// ------------------------------------------------------- sglang service control
function svcPidAlive() {
  try {
    const pid = Number(fs.readFileSync(SGLANG_PID_FILE, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

app.get('/api/model/service', async (_req, res) => {
  const online = await sglang.isModelOnline();
  let logTail = '';
  try { logTail = fs.readFileSync(SGLANG_LOG, 'utf8').slice(-400).trim(); } catch { /* no log yet */ }
  const freshStart = svc.startingAt && Date.now() - svc.startingAt < 15 * 60 * 1000;
  const starting = !online && (svcPidAlive() || freshStart);
  res.json({ online, starting, logTail });
});

app.post('/api/model/service/start', (_req, res) => {
  (async () => {
    if (await sglang.isModelOnline()) return { ok: true, already: true };
    if (svcPidAlive() || (svc.startingAt && Date.now() - svc.startingAt < 15 * 60 * 1000)) {
      throw new Error('ALREADY_STARTING');
    }
    if (!SGLANG_DIR) throw new Error('未配置 sglang.dir（在 config.json 中设置模型启动脚本所在目录）');
    const out = fs.openSync(SGLANG_LOG, 'a');
    const proc = spawn('bash', [cfg.sglang.startScript], { cwd: SGLANG_DIR, env: SVC_ENV, detached: true, stdio: ['ignore', out, out] });
    fs.closeSync(out);
    proc.on('exit', () => { try { fs.unlinkSync(SGLANG_PID_FILE); } catch { /* ignore */ } });
    proc.unref();
    svc.startingAt = Date.now();
    fs.writeFileSync(SGLANG_PID_FILE, String(proc.pid));
    return { ok: true, pid: proc.pid };
  })()
    .then((r) => res.json(r))
    .catch((e) => res.status(409).json({ error: e.message === 'ALREADY_STARTING' ? '已经在启动了，耐心等一会儿～' : `启动失败: ${e.message}` }));
});

app.post('/api/model/service/stop', (_req, res) => {
  if (!SGLANG_DIR) return res.status(400).json({ error: '未配置 sglang.dir' });
  execFile('bash', [cfg.sglang.stopScript], { cwd: SGLANG_DIR, env: SVC_ENV, timeout: 90000 }, (err, out, errOut) => {
    try { fs.unlinkSync(SGLANG_PID_FILE); } catch { /* ignore */ }
    svc.startingAt = 0;
    if (err) return res.status(500).json({ error: String(errOut || out || err.message).slice(0, 300) });
    res.json({ ok: true, message: String(out).slice(0, 300) });
  });
});

// ---------------------------------------------------------------- OCR a photo
app.post('/api/pages/ocr', async (req, res) => {
  try {
    if (!req.body || !req.body.image) {
      return res.status(400).json({ error: 'missing image' });
    }
    const buf = Buffer.from(req.body.image, 'base64');
    // compress: resize to max 1600px wide, JPEG q~80
    const jpeg = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const result = await sglang.ocrImage(jpeg, sglang.OCR_PROMPT);
    res.json(result);
  } catch (e) {
    res.status(e.message === 'MODEL_OFFLINE' ? 503 : 500)
      .json({ error: e.message === 'MODEL_OFFLINE' ? 'Model offline. Start your SGLang server and try again.' : `OCR failed: ${e.message}` });
  }
});

// ---------------------------------------------------------------- meanings
app.post('/api/words/extract', async (req, res) => {
  try {
    const words = (req.body?.words || []).map(cleanWord).filter(Boolean);
    if (!words.length) return res.status(400).json({ error: 'no words' });
    const meanings = await sglang.extractMeanings(words);
    res.json({ words: meanings });
  } catch (e) {
    res.status(e.message === 'MODEL_OFFLINE' ? 503 : 500)
      .json({ error: e.message === 'MODEL_OFFLINE' ? 'Model offline. Start your SGLang server and try again.' : `Extract failed: ${e.message}` });
  }
});

// ---------------------------------------------------------------- words CRUD
// GET /api/words?category=&grade=&q=&pool=1&diff=1
app.get('/api/words', (req, res) => {
  const { category, grade, q, pool, diffOnly } = req.query;
  const conds = [];
  const params = {};
  if (category) { conds.push('w.category = @category'); params.category = category; }
  if (grade) { conds.push('w.grade_level = @grade'); params.grade = Number(grade); }
  if (q) { conds.push('w.word LIKE @q'); params.q = `%${q}%`; }
  if (pool === '1') conds.push('w.id IN (SELECT word_id FROM page_words)');
  if (diffOnly === '1') conds.push('(ws.difficulty >= 3 OR ws.times_failed > 0)');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT w.id, w.word, w.meaning_cn, w.category, w.grade_level, w.base_diff,
           COALESCE(ws.difficulty, w.base_diff) AS difficulty,
           COALESCE(ws.times_tested,0) AS times_tested,
           COALESCE(ws.times_failed,0) AS times_failed,
           COALESCE(ws.consecutive_pass,0) AS consecutive_pass
    FROM words w
    LEFT JOIN word_stats ws ON ws.word_id = w.id
    ${where}
    ORDER BY w.word COLLATE NOCASE
  `).all(params);
  res.json(rows);
});

// POST /api/words  -- add a word directly
app.post('/api/words', (req, res) => {
  const { word, meaning_cn, category, grade_level } = req.body || {};
  if (!word || !String(word).trim()) return res.status(400).json({ error: 'word required' });
  try {
    const id = ensureWord({
      word: String(word).trim(),
      meaning_cn: String(meaning_cn || '').trim(),
      category: String(category || '未完').trim() || '未完',
      grade_level: Number(grade_level) || 3,
    });
    res.json({ id });
  } catch (e) {
    res.status(409).json({ error: e.message.includes('UNIQUE') ? 'Word already exists' : e.message });
  }
});

app.put('/api/words/:id', (req, res) => {
  const { meaning_cn, category, grade_level } = req.body || {};
  const cat = String(category || '').trim();
  db.prepare('UPDATE words SET meaning_cn=?, category=?, grade_level=? WHERE id=?')
    .run(String(meaning_cn || ''), cat, Number(grade_level) || 3, req.params.id);
  if (cat === '完成') db.prepare('UPDATE word_stats SET in_hardset = 0 WHERE word_id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/words/:id', (req, res) => {
  db.prepare('DELETE FROM words WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- categories
app.get('/api/categories', (_req, res) => {
  const rows = db.prepare("SELECT DISTINCT category FROM words WHERE category <> '' ORDER BY category").all();
  res.json(rows.map((r) => r.category));
});

// ---------------------------------------------------------------- pages
// POST /api/pages  { title, ref_text, date, words: [{word, meaning_cn}] }
app.post('/api/pages', (req, res) => {
  const { title, ref_text, date, words, image_path } = req.body || {};
  const d = date || new Date().toISOString().slice(0, 10);
  const info = db.prepare('INSERT INTO pages (title, ref_text, date, image_path) VALUES (?,?,?,?)')
    .run(String(title || '').trim(), String(ref_text || '').trim(), d, String(image_path || ''));
  const pageId = info.lastInsertRowid;
  const addWords = db.prepare('INSERT OR IGNORE INTO page_words (page_id, word_id) VALUES (?,?)');
  for (const w of words || []) {
    if (!w || !String(w.word).trim()) continue;
    const wid = ensureWord(w);
    addWords.run(pageId, wid);
  }
  res.json({ id: pageId });
});

// GET /api/pages  -- recent first
app.get('/api/pages', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, COUNT(pw.word_id) AS word_count
    FROM pages p
    LEFT JOIN page_words pw ON pw.page_id = p.id
    GROUP BY p.id
    ORDER BY p.date DESC, p.id DESC
  `).all();
  res.json(rows);
});

// GET /api/pages/:id  -- page with its words
app.get('/api/pages/:id', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'not found' });
  const words = db.prepare(`
    SELECT w.id, w.word, w.meaning_cn, w.category, w.grade_level,
           COALESCE(ws.difficulty, w.base_diff) AS difficulty,
           COALESCE(ws.times_tested,0) AS times_tested,
           COALESCE(ws.times_failed,0) AS times_failed
    FROM page_words pw
    JOIN words w ON w.id = pw.word_id
    LEFT JOIN word_stats ws ON ws.word_id = w.id
    WHERE pw.page_id = ?
    ORDER BY w.word COLLATE NOCASE
  `).all(req.params.id);
  res.json({ ...page, words });
});

app.delete('/api/pages/:id', (req, res) => {
  db.prepare('DELETE FROM pages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// PUT /api/pages/:id  { title, ref_text, date }
app.put('/api/pages/:id', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare('UPDATE pages SET title=?, ref_text=?, date=? WHERE id=?')
    .run(
      b.title !== undefined ? String(b.title).trim() : page.title,
      b.ref_text !== undefined ? String(b.ref_text).trim() : page.ref_text,
      b.date !== undefined ? String(b.date) : page.date,
      req.params.id,
    );
  res.json({ ok: true });
});

// POST /api/pages/:id/words  { word_id } or { word, meaning_cn, category, grade_level }
app.post('/api/pages/:id/words', (req, res) => {
  const page = db.prepare('SELECT id FROM pages WHERE id=?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  let wordId = b.word_id;
  if (!wordId) {
    const w = String(b.word || '').trim();
    if (!w) return res.status(400).json({ error: 'word required' });
    wordId = ensureWord({ word: w, meaning_cn: b.meaning_cn, category: b.category, grade_level: b.grade_level });
  }
  db.prepare('INSERT OR IGNORE INTO page_words (page_id, word_id) VALUES (?,?)').run(req.params.id, wordId);
  res.json({ ok: true, word_id: wordId });
});

// DELETE /api/pages/:id/words/:wordId
app.delete('/api/pages/:id/words/:wordId', (req, res) => {
  db.prepare('DELETE FROM page_words WHERE page_id=? AND word_id=?').run(req.params.id, req.params.wordId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- hard word set
// Hard words (in_hardset=1) chunked into "hard pages" of up to 20 each,
// ordered so the most-recently-struggled words come first.
app.get('/api/hardset', (_req, res) => {
  const hard = diff.hardWords(db);
  const PAGE_SIZE = 20;
  const pages = [];
  for (let i = 0; i < hard.length; i += PAGE_SIZE) {
    pages.push({ index: pages.length + 1, words: hard.slice(i, i + PAGE_SIZE) });
  }
  res.json({ total: hard.length, pages });
});

// ---------------------------------------------------------------- settings
app.get('/api/settings', (_req, res) => {
  res.json({
    default_grade: Number(getSetting('default_grade', 3)),
    test_limit: Number(getSetting('test_limit', 20)),
    xp: Number(getSetting('xp', 0)),
    level: Number(getSetting('level', 1)),
  });
});
app.post('/api/settings', (req, res) => {
  const b = req.body || {};
  if (b.default_grade !== undefined) setSetting('default_grade', Number(b.default_grade) || 3);
  if (b.test_limit !== undefined) setSetting('test_limit', Math.min(100, Math.max(1, Number(b.test_limit) || 20)));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- difficult pool
app.get('/api/words/difficult', (req, res) => {
  const limit = Number(req.query.limit) || 40;
  res.json(diff.difficultWords(db, limit));
});

// ---------------------------------------------------------------- tests
// POST /api/tests  { test_type, word_ids:[], mode }
app.post('/api/tests', (req, res) => {
  const { test_type, word_ids, mode } = req.body || {};
  if (!Array.isArray(word_ids) || !word_ids.length) return res.status(400).json({ error: 'no words' });
  const info = db.prepare('INSERT INTO test_sessions (test_type, mode, word_count) VALUES (?,?,?)')
    .run(String(test_type), String(mode || 'pick'), word_ids.length);
  const sessionId = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO test_answers (session_id, word_id) VALUES (?,?)');
  for (const wid of word_ids) ins.run(sessionId, wid);
  res.json({ id: sessionId });
});

// POST /api/tests/:id/answer  { word_id, correct }
app.post('/api/tests/:id/answer', (req, res) => {
  const { word_id, correct } = req.body || {};
  const ok = correct ? 1 : 0;
  db.prepare('UPDATE test_answers SET correct=? WHERE session_id=? AND word_id=?')
    .run(ok, req.params.id, word_id);
  diff.recordResult(db, word_id, ok);
  res.json({ ok: true });
});

// POST /api/tests/:id/finish  { passed }
app.post('/api/tests/:id/finish', (req, res) => {
  const { passed, correct_count } = req.body || {};
  const c = Number(correct_count) || 0;
  db.prepare('UPDATE test_sessions SET passed=?, correct_count=? WHERE id=?')
    .run(passed ? 1 : 0, c, req.params.id);
  const sess = db.prepare('SELECT word_count, mode FROM test_sessions WHERE id=?').get(req.params.id);
  let streak = Number(getSetting('streak', 0));
  let gained = 0;
  const today = new Date().toISOString().slice(0, 10);
  let day = getSetting('streak_day', '');
  let dayCount = Number(getSetting('streak_day_count', 0));
  if (String(day) !== today) { day = today; dayCount = 0; }
  if (passed && sess.mode !== 'redo' && dayCount < 2) {
    streak += 1; dayCount += 1; gained = 1;
  }
  setSetting('streak', streak);
  setSetting('streak_day', String(day));
  setSetting('streak_day_count', dayCount);
  res.json({ ok: true, streak, gained, dayCount });
});

// GET /api/tests  -- recent sessions
app.get('/api/tests', (_req, res) => {
  res.json(db.prepare('SELECT * FROM test_sessions ORDER BY id DESC LIMIT 50').all());
});

// GET /api/tests/:id  -- one session with per-word results
app.get('/api/tests/:id', (req, res) => {
  const sess = db.prepare('SELECT * FROM test_sessions WHERE id=?').get(req.params.id);
  if (!sess) return res.status(404).json({ error: 'not found' });
  const answers = db.prepare(`
    SELECT w.id, w.word, w.meaning_cn, ta.correct
    FROM test_answers ta JOIN words w ON w.id = ta.word_id
    WHERE ta.session_id = ?
    ORDER BY ta.id
  `).all(req.params.id);
  res.json({ ...sess, answers });
});

// ---------------------------------------------------------------- dashboard
app.get('/api/stats', (_req, res) => {
  const wordCount = db.prepare('SELECT COUNT(*) c FROM words').get().c;
  const hardCount = db.prepare('SELECT COUNT(*) c FROM word_stats WHERE difficulty >= 3 OR times_failed > 0').get().c;
  const testedCount = db.prepare('SELECT COUNT(*) c FROM word_stats WHERE times_tested > 0').get().c;
  const sessions = db.prepare('SELECT COUNT(*) c FROM test_sessions').get().c;
  const totalCorrect = db.prepare('SELECT COALESCE(SUM(correct),0) c FROM test_answers').get().c;
  const totalAns = db.prepare('SELECT COUNT(*) c FROM test_answers').get().c;
  const accuracy = totalAns ? Math.round((totalCorrect / totalAns) * 100) : 0;
  res.json({
    wordCount, hardCount, testedCount, sessions, totalCorrect, totalAns, accuracy,
    recentPages: db.prepare('SELECT id,title,date FROM pages ORDER BY date DESC LIMIT 3').all(),
    difficult: diff.difficultWords(db, 10),
    recentSessions: db.prepare('SELECT * FROM test_sessions ORDER BY id DESC LIMIT 6').all(),
    xp: Number(getSetting('xp', 0)), level: Number(getSetting('level', 1)),
    streak: Number(getSetting('streak', 0)),
    nickname: cfg.nickname,
  });
});

// XP reward hooks
app.post('/api/xp', (req, res) => {
  const { delta } = req.body || {};
  const xp = Number(getSetting('xp', 0)) + (Number(delta) || 0);
  let level = Number(getSetting('level', 1));
  const levelXp = (l) => l * 100;
  while (xp >= levelXp(level)) level++;
  setSetting('xp', xp);
  setSetting('level', level);
  res.json({ xp, level });
});

// ---------------------------------------------------------------- my home (我的家)
app.get('/api/home', (_req, res) => {
  const owned = db.prepare('SELECT room, item, color FROM home_items').all();
  res.json({ fire: Number(getSetting('streak', 0)), rooms: home.ROOMS, owned });
});

// POST /api/home/buy  { room, item }  -- spend 火力 (streak) to buy an item
app.post('/api/home/buy', (req, res) => {
  const { room, item } = req.body || {};
  const found = home.findItem(String(room || ''), String(item || ''));
  if (!found) return res.status(404).json({ error: '没有这个东西' });
  if (db.prepare('SELECT 1 FROM home_items WHERE room=? AND item=?').get(room, item)) {
    return res.status(409).json({ error: '已经买过啦' });
  }
  const fire = Number(getSetting('streak', 0));
  if (fire < found.item.cost) {
    return res.status(400).json({ error: `🔥 火力不够（需要 ${found.item.cost}，现在有 ${fire}），去做测验攒火力吧！` });
  }
  db.transaction(() => {
    setSetting('streak', fire - found.item.cost);
    db.prepare('INSERT INTO home_items (room, item) VALUES (?,?)').run(found.room.id, found.item.id);
  })();
  res.json({ ok: true, fire: fire - found.item.cost });
});

// POST /api/home/color  { room, item, color }
app.post('/api/home/color', (req, res) => {
  const { room, item, color } = req.body || {};
  const found = home.findItem(String(room || ''), String(item || ''));
  if (!found) return res.status(404).json({ error: '没有这个东西' });
  if (!home.COLORS.includes(String(color))) return res.status(400).json({ error: '颜色无效' });
  const info = db.prepare('UPDATE home_items SET color=? WHERE room=? AND item=?')
    .run(String(color), room, item);
  if (!info.changes) return res.status(404).json({ error: '还没有买过这个东西' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- static + serve
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Start with graceful startup message.
app.listen(PORT, HOST, () => {
  console.log(`Wordland (单词乐园) running at http://127.0.0.1:${PORT}`);
  console.log(`On your home network, open http://${LAN_IP}:${PORT} (fixed IP, override with LAN_IP env var)`);
  console.log(`DB: ${db.name}`);
});
