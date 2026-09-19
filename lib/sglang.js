'use strict';
// Client for a local SGLang / OpenAI-compatible endpoint (see config.json).
// Used for (1) OCR of practice-page photos and (2) short Chinese meanings.
// The model is OPTIONAL — callers must handle 'offline' gracefully.

const cfg = require('./config');

const BASE_URL = cfg.sglang.baseUrl;
const DEFAULT_MODEL = 'qwen3.8-27b-sglang';
const REQUEST_TIMEOUT_MS = 120000;

let _model = cfg.sglang.model || null;

async function isModelOnline() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${BASE_URL}/models`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

// Discover the served model id so we work with whatever is actually running
// (your Qwen3.8-27B via start-dflash.sh, or a fallback text model).
async function resolveModel() {
  if (_model) return _model;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${BASE_URL}/models`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      const id = data?.data?.[0]?.id;
      if (id) { _model = id; return id; }
    }
  } catch { /* fall through */ }
  _model = DEFAULT_MODEL;
  return _model;
}

// Core chat completion call. thinking disabled for speed/latency.
async function chat(messages, { maxTokens = 4096, temperature = 0 } = {}) {
  const model = await resolveModel();
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (/qwen/i.test(model)) {
    body.chat_template_kwargs = { enable_thinking: false };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SGLang HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return content;
  } finally {
    clearTimeout(t);
  }
}

// Strip ```json ... ``` fences if present, then JSON.parse.
// Robustly extracts the first balanced JSON array/object from the text
// (models often wrap the answer in prose or extra punctuation).
function parseJsonLoose(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  // direct parse first
  try { return JSON.parse(t); } catch { /* fall through */ }

  // balanced-bracket extraction: find outermost [ or { and its match
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '[' || ch === '{') {
      const open = ch, close = ch === '[' ? ']' : '}';
      let depth = 0, inStr = false, esc = false;
      for (let j = i; j < t.length; j++) {
        const c = t[j];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === open) depth++;
        else if (c === close) { depth--; if (depth === 0) return JSON.parse(t.slice(i, j + 1)); }
      }
      // unbalanced: fall out and try next opener
    }
  }
  throw new Error('could not extract JSON from model output');
}

// ---------------------------------------------------------------------------
// OCR: send an image (buffer) + prompt, get structured JSON.
// ---------------------------------------------------------------------------
async function ocrImage(imageBuffer, prompt) {
  const online = await isModelOnline();
  if (!online) throw new Error('MODEL_OFFLINE');
  const b64 = imageBuffer.toString('base64');
  const content = await chat([
    { role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
    ]},
  ], { maxTokens: 8192 });
  return parseJsonLoose(content);
}

const OCR_PROMPT = `You are an OCR helper for a primary-school English practice-book page photo.
The page contains multiple-choice vocabulary questions. Each question has 4 options (A/B/C/D) that are single English words.

Extract EVERY English option word from ALL visible questions. Return ONLY JSON:
{"questions": [{"qno": int, "stem": "<short stem or empty>", "options": ["w1","w2","w3","w4"]}]}

Rules:
- Transcribe words exactly as printed (lowercase them).
- If an option is a phrase, keep it as-is.
- Do not invent words. If unreadable, skip it.
- Return an empty "questions": [] if the page has no such questions.`;

// ---------------------------------------------------------------------------
// Short Chinese meaning (<= 20 chars) for a list of English words.
// ---------------------------------------------------------------------------
async function extractMeanings(words) {
  const online = await isModelOnline();
  if (!online) throw new Error('MODEL_OFFLINE');
  const list = JSON.stringify(words);
  const prompt = `For each English word below, give ONE very short Chinese meaning (2 to 20 Chinese characters), capturing the primary meaning used in primary school. Return ONLY JSON, an array of objects aligned with the input order:
[{"word":"...","meaning_cn":"..."}]

Words: ${list}

Rules:
- meaning_cn must be concise (<=20 Chinese chars), e.g. "苹果", "高兴的", "图书馆".
- One entry per input word, same order.`;
  const content = await chat([
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ], { maxTokens: 2000 });
  const parsed = parseJsonLoose(content);
  const arr = Array.isArray(parsed) ? parsed : [];
  // clean: trim and drop entries with no Chinese characters (model echoes)
  const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s || '');
  return arr.map((e) => ({
    word: String(e.word || '').trim(),
    meaning_cn: hasCJK(e.meaning_cn) ? String(e.meaning_cn).trim() : '',
  })).filter((e) => e.word);
}

module.exports = { isModelOnline, chat, ocrImage, extractMeanings, OCR_PROMPT };
