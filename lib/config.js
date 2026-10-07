'use strict';
// Central configuration. Copy config.example.json -> config.json and edit.
// Env vars (PORT, LAN_IP, VOCAB_DB, SGLANG_URL, SGLANG_MODEL, SGLANG_DIR)
// override config.json values.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(base[k] || {}, v)
      : v;
  }
  return out;
}

const defaults = {
  port: 3006,
  lanIp: '127.0.0.1',
  dbPath: '.db/vocab.db',
  nickname: '卡皮巴拉',
  sglang: {
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: '',
    dir: '',
    startScript: 'serve.sh -d',
    stopScript: 'stop.sh',
  },
};

const cfg = deepMerge(deepMerge(defaults, readJson(path.join(ROOT, 'config.example.json'))), readJson(path.join(ROOT, 'config.json')));

const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const pick = (envVal, cfgVal, def) => {
  if (envVal !== undefined && envVal !== '') return envVal;
  if (cfgVal !== undefined && cfgVal !== '') return cfgVal;
  return def;
};

module.exports = {
  ROOT,
  port: num(process.env.PORT, num(cfg.port, defaults.port)),
  lanIp: pick(process.env.LAN_IP, cfg.lanIp, defaults.lanIp),
  nickname: pick(process.env.NICKNAME, cfg.nickname, defaults.nickname),
  dbPath: path.resolve(ROOT, pick(process.env.VOCAB_DB, cfg.dbPath, defaults.dbPath)),
  sglang: {
    baseUrl: pick(process.env.SGLANG_URL, cfg.sglang.baseUrl, defaults.sglang.baseUrl),
    model: pick(process.env.SGLANG_MODEL, cfg.sglang.model, ''),
    dir: (() => {
      const d = pick(process.env.SGLANG_DIR, cfg.sglang.dir, '');
      return d ? path.resolve(ROOT, d) : '';
    })(),
    startScript: pick(cfg.sglang.startScript, '', defaults.sglang.startScript),
    stopScript: pick(cfg.sglang.stopScript, '', defaults.sglang.stopScript),
  },
};
