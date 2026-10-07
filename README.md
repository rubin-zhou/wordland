# Wordland · 单词乐园

A vocabulary recitation web app for primary-school kids: import words from workbook photos or by typing → pick words by page → study & quiz. Wrong answers go into a hard-word set automatically, with XP, streaks and sound effects along the way. Works in any phone / tablet / desktop browser on your LAN. All data stays on your machine.

> Note: the app UI is in Chinese; button/tab names below are kept in Chinese as shown on screen.

## Features

- 📥 **Import** («导入»): snap a photo of a workbook page and every option word is OCR'd (needs a local LLM), or type a word list and Chinese meanings are auto-filled
- 🎮 **Word picking** («测验»): select up to 2 pages (practice pages + 🌶️ hard-word pages, mixable); tick «未测词» to show only never-quizzed words; tap chips or «🎲 随机选一批» to pick a random batch; batch size is adjustable
- 📖 **Study mode** («背诵»): three card styles — 中英对照 / 只看英文 / 只看中文; tap a word to hear it pronounced
- ✏️ **Quiz**: «看英文说中文» (EN → CN recognition) or «看中文写英文» (CN → EN spelling); after each run: retry same batch / re-study / re-pick
- 🌶️ **Hard-word set**: mistakes accumulate automatically (20 words per page) for targeted review
- 📊 **Stats** («统计»): accuracy, hard words, and a recent-quiz list — tap any entry to review every word ✅/❌
- ⭐ **Gamification**: XP, levels, streaks, confetti and sounds

## Requirements

- Node.js ≥ 20 (required by `better-sqlite3`)
- Linux (the optional systemd installer); the LLM backend is optional — see below

## Install

```bash
git clone <this-repo-url> && cd wordland
npm install
```

## Configuration (all machine-specific values live in one file)

```bash
cp config.example.json config.json   # then edit for your machine
```

| Key | Description |
| --- | --- |
| `port` | Web server port, default `3006` |
| `lanIp` | LAN address printed at startup (just a hint line) |
| `dbPath` | SQLite database location, default `.db/vocab.db` |
| `nickname` | Name the mascot greets you with on the home page, default `卡皮巴拉` |
| `sglang.baseUrl` | Model API base URL (OpenAI-compatible), default `http://127.0.0.1:8000/v1` |
| `sglang.model` | Model name; leave empty to auto-detect via `/models` |
| `sglang.dir` | Directory containing your model start/stop scripts (for one-click control in the UI); leave empty to disable |
| `sglang.startScript` / `stopScript` | Script file names inside `sglang.dir` |

Env vars `PORT`, `LAN_IP`, `VOCAB_DB`, `SGLANG_URL`, `SGLANG_MODEL`, `SGLANG_DIR` override `config.json` on the fly.

## Running

### Option 1: systemd service, auto-start on boot (Linux, recommended)

```bash
bash deploy/install-service.sh     # generates the unit from your config.json + current user/node path; asks for sudo
```

Management:

```bash
sudo systemctl stop|start|restart wordland
journalctl -u wordland -f      # logs
```

### Option 2: run manually

```bash
npm start
```

> If the systemd service is running, a manual `npm start` will fail with the port in use — use one or the other.

## Access

- From devices on your LAN: **http://<lanIp in config.json>:<port>** (phones/tablets on the same WiFi)
- Local: http://127.0.0.1:`port`

## LLM backend (optional but recommended)

Photo OCR and auto Chinese-meaning fill use a local OpenAI-compatible model service (SGLang / vLLM / Ollama — any model works, just point `sglang.baseUrl` at it). **Everything else works without a model**; only OCR and auto-fill are unavailable.

- Manually: `bash <sglang.dir>/<startScript>` / `bash <sglang.dir>/<stopScript>`
- From the UI: the **🧠 模型后台服务** card at the bottom of «导入» shows status (online / starting / stopped + log tail) and lets you start/stop with one click

## Workflow

1. **Import** («导入»): photograph a workbook page, or paste a word list (meanings auto-filled, editable)
2. **Pick words** («测验»): tick 1–2 pages, optionally turn on «未测词» to only see never-tested words; tap chips to add or use «🎲 随机选一批»; batch size defaults to 20
3. **Study** («背诵»): flip between card modes, tap words to listen, then start the quiz when ready
4. **Quiz**: after finishing, retry the same batch, re-study it, or pick fresh words; mistakes flow into the hard-word set
5. **Review hard words**: pick the 🌶️ pages in «测验»
6. **Manage** («词库» for search/edit/delete and page editing; «统计» for stats and per-quiz details)

## Data & privacy

All personal data lives on your machine and is `.gitignore`d:

- `.db/vocab.db` — word bank, quiz history, settings (SQLite)
- `uploads/` — original photos
- `config.json` — your local config (copied from the example)

Moving to a new computer = copying the `.db/` folder.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Port already in use at startup | Service is running: `sudo systemctl stop wordland`, or change `port` |
| OCR fails with 503 | Model is offline — start it and wait a few minutes |
| Words show no Chinese meaning | No model configured/running, or fill it manually in «词库» |
| LAN IP changed | Update `lanIp` in `config.json` (only affects the hint message) |
| `better-sqlite3` install fails | Use Node ≥ 20, then `npm rebuild better-sqlite3` |
