'use strict';
/* Wordland - main app logic */

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs, children) => {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => n.append(c));
  return n;
};

const state = {
  view: 'home',
  shopOpen: false,     // 小商店 drawer (我的家)
  shopRoom: '',        // room tab currently shown in the drawer
  stats: null,
  pages: [],
  categories: [],
  test: null,          // current test session data
  testLimit: 0,        // words per batch (flexible, persisted server-side)
  testSel: null,       // { pageIds:Set, wordIds:Set } current test-list selection (survives tab switches)
  testMode: 'meaning',
  testQueue: [],       // word objects in the test list, shared by study + quiz
  studyMode: 'both',
};

// ---------------------------------------------------------------- api helper
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------- toast + confetti
let toastTimer = null;
function toast(msg, ms = 2000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function confettiBurst() {
  Sound.star();
  const box = $('#confetti');
  for (let i = 0; i < 24; i++) {
    const s = el('div', { class: 'confetti-piece' });
    s.style.left = Math.random() * 100 + '%';
    s.style.background = `hsl(${Math.random() * 360},85%,65%)`;
    s.style.animationDuration = (0.7 + Math.random() * 1.2) + 's';
    s.style.animationDelay = (Math.random() * 0.4) + 's';
    box.append(s);
    setTimeout(() => s.remove(), 2500);
  }
}

// ---------------------------------------------------------------- mascots
const MASCOTS = {
  capybara: ['🦫', '🐾', '🧡'],
  pony: ['🐴', '🦄', '🌸'],
  picachu: ['⚡', '🐭', '🎯'],
};
let mascotIdx = 0;
function mascotCycle() { mascotIdx++; }

// 首页河狸：左右散步，转向时整体翻转，走路时身体摆动+两脚交替迈步
let walkToken = 0;
function startMascotWalk(stage) {
  const walker = stage.querySelector('.mascot-walker');
  const flipEl = stage.querySelector('.mascot-flip');
  const token = ++walkToken;
  const W = () => Math.max(160, stage.clientWidth);
  const rand = (a, b) => a + Math.random() * (b - a);
  let x = W() * 0.18;
  let sx = 1, targetSx = 1, target = x, speed = 90, flipFrom = 1, flipStart = 0;
  let phase = 'idle', until = performance.now() + rand(900, 1800), last = performance.now();
  walker.style.left = x + 'px';
  const tick = (now) => {
    if (walkToken !== token || !document.body.contains(walker)) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase === 'idle') {
      if (now >= until) {
        const maxX = Math.max(12, W() - walker.offsetWidth - 12);
        target = rand(12, maxX);
        if (Math.abs(target - x) < 24) { until = now + 900; requestAnimationFrame(tick); return; }
        targetSx = target > x ? -1 : 1; // 🦫 原生朝左，向右走时翻转
        if (targetSx !== sx) { phase = 'flip'; flipFrom = sx; flipStart = now; }
        else { phase = 'walk'; walker.classList.add('walk'); speed = rand(72, 128); }
      }
    } else if (phase === 'flip') {
      const p = Math.min(1, (now - flipStart) / 300);
      sx = flipFrom * Math.cos(p * Math.PI); // 1 → 0 → -1，整个“转过来”
      if (p >= 1) { sx = targetSx; phase = 'walk'; walker.classList.add('walk'); speed = rand(72, 128); }
    } else if (phase === 'walk') {
      x += (targetSx === -1 ? speed : -speed) * dt;
      if ((targetSx === -1 && x >= target) || (targetSx === 1 && x <= target)) {
        x = target;
        phase = 'idle';
        walker.classList.remove('walk');
        until = now + rand(1500, 3600);
      }
    }
    flipEl.style.transform = `scaleX(${sx})`;
    walker.style.left = x + 'px';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- gamification
let xp = 0, level = 1, streak = 0;
function renderXp() {
  $('#topXp').textContent = `⭐${xp}`;
  $('#topStreak').textContent = `🔥${streak}`;
}
async function addXp(delta) {
  const r = await api('/api/xp', { method: 'POST', body: { delta } });
  const oldLv = level;
  xp = r.xp; level = r.level;
  if (level > oldLv) { toast(`🎉 升级啦！等级 ${level}！`, 3000); Sound.levelup(); confettiBurst(); }
  renderXp();
}

// ---------------------------------------------------------------- router
const VIEWS = {};
function show(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  const v = $('#view');
  v.innerHTML = '';
  const fn = VIEWS[view];
  if (fn) fn(v);
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => { Sound.tap(); show(t.dataset.view); }));

// ================================================================ HOME
VIEWS.home = async (root) => {
  const st = await api('/api/stats');
  state.stats = st; xp = st.xp; level = st.level; streak = st.streak; renderXp();
  const emoji = MASCOTS.capybara[mascotIdx % 3];
  const stage = el('div', { class: 'mascot-stage' }, [
    el('div', { class: 'mascot-walker' }, [
      el('div', { class: 'mascot-flip' }, [
        el('div', { class: 'mascot-body', text: emoji }),
      ]),
    ]),
  ]);
  root.append(el('div', { class: 'card mascot-card' }, [
    el('div', { class: 'mascot-speech', text: `你好呀${esc(state.stats?.nickname || '卡皮巴拉')}！今天也要加油背单词哦~ 💪` }),
    stage,
  ]));
  startMascotWalk(stage);

  const todayPlan = el('div', { class: 'card' }, [
    el('h2', { text: '🗓️ 今日计划' }),
    el('p', { class: 'sub', text: st.wordCount ? `词库已有 ${st.wordCount} 个单词，加油！` : '还没有单词，先去「导入」添加吧～' }),
  ]);
  root.append(todayPlan);

  const quick = el('div', { class: 'card' }, [
    el('h2', { text: '⚡ 快速开始' }),
    el('div', { class: 'quick-btns' }, [
      el('button', { class: 'btn big', onclick: () => show('test'), text: '🎮 开始测验' }),
      el('button', { class: 'btn big alt', onclick: () => show('import'), text: '📥 导入新单词' }),
      el('button', { class: 'btn big', onclick: () => show('myhome'), text: '🏡 装扮我的家' }),
    ]),
    el('div', { class: 'stats-mini' }, [
      el('div', { class: 'stat-chip', html: `⭐ <b>${xp}</b> 经验` }),
      el('div', { class: 'stat-chip', html: `🔥 <b>${streak}</b> 连胜` }),
      el('div', { class: 'stat-chip', html: `📚 <b>${st.wordCount}</b> 单词` }),
      el('div', { class: 'stat-chip', html: `🎯 <b>${st.accuracy}%</b> 正确率` }),
    ]),
  ]);
  root.append(quick);

  if (st.difficult && st.difficult.length) {
    const dcard = el('div', { class: 'card' }, [el('h2', { text: '🌶️ 需要重点复习' })]);
    const chips = el('div', { class: 'chips' });
    st.difficult.forEach((w) => chips.append(el('span', { class: 'chip hard', text: w.word })));
    dcard.append(chips);
    root.append(dcard);
  }
};

// ================================================================ MY HOME (我的家)
const HOME_COLORS = {
  orig:   { name: '原色', hex: '#e8e0ea', filter: '' },
  red:    { name: '红色', hex: '#ff8a8a', filter: 'hue-rotate(-35deg) saturate(1.35)' },
  orange: { name: '橙色', hex: '#ffb066', filter: 'hue-rotate(-15deg) saturate(1.25)' },
  yellow: { name: '黄色', hex: '#ffe066', filter: 'hue-rotate(35deg)' },
  green:  { name: '绿色', hex: '#8fd8a0', filter: 'hue-rotate(75deg)' },
  blue:   { name: '蓝色', hex: '#7fb8ff', filter: 'hue-rotate(160deg)' },
  purple: { name: '紫色', hex: '#c39bff', filter: 'hue-rotate(230deg)' },
  pink:   { name: '粉色', hex: '#ffa6d5', filter: 'hue-rotate(290deg) saturate(1.2)' },
};

VIEWS.myhome = async (root) => {
  try {
    state.home = await api('/api/home');
  } catch (e) { toast(e.message, 2500); return; }
  streak = state.home.fire;
  renderXp();
  renderMyHome();
};

function ownedEntry(roomId, itemId) {
  return (state.home?.owned || []).find((o) => o.room === roomId && o.item === itemId);
}

function renderMyHome() {
  const root = $('#view');
  root.innerHTML = '';
  if (!state.home) return;
  if (state.homeRoom) renderMyRoom(root); else renderRooms(root);
  if (state.shopOpen) renderShopOverlay(root);
}

function homeTopBar(title) {
  const kids = [];
  if (state.homeRoom) kids.push(el('button', { class: 'btn sm', text: '↩️ 房间', onclick: () => { Sound.tap(); state.homeRoom = null; renderMyHome(); } }));
  kids.push(el('h2', { class: 'page-title', style: 'margin:0;flex:1', text: title }));
  kids.push(el('span', { class: 'fire-chip', text: `🔥${state.home.fire}` }));
  kids.push(el('button', {
    class: 'btn sm ' + (state.shopOpen ? 'bad' : 'ok'), text: state.shopOpen ? '✕ 收起' : '🛒 小商店',
    onclick: () => { Sound.tap(); state.shopOpen = !state.shopOpen; renderMyHome(); },
  }));
  return el('div', { class: 'row home-top' }, kids);
}

function renderRooms(root) {
  root.append(homeTopBar('🏡 我的家'));
  root.append(el('p', { class: 'sub house-tip', text: '认真背单词攒 🔥 火力，点每个房间进去布置你的小窝吧～' }));
  const house = el('div', { class: 'dollhouse' });
  house.append(el('div', { class: 'roof' }));
  state.home.rooms.forEach((r) => house.append(houseRoomTile(r)));
  root.append(house);
}

function houseRoomTile(room) {
  const items = el('div', { class: 'tile-items' });
  const owned = room.items.filter((i) => ownedEntry(room.id, i.id));
  owned.forEach((i) => {
    const colr = HOME_COLORS[ownedEntry(room.id, i.id).color] || HOME_COLORS.orig;
    items.append(el('span', { class: 'tile-emoji', style: `filter:${colr.filter}`, text: i.emoji }));
  });
  if (!owned.length) items.append(el('span', { class: 'tile-empty', text: '空空如也' }));
  return el('button', {
    class: `room-tile area-${room.id} room-${room.id}`,
    onclick: () => { Sound.tap(); state.homeRoom = room.id; renderMyHome(); },
  }, [
    el('span', { class: 'tile-name', text: `${room.icon} ${room.name}` }),
    el('span', { class: 'tile-count', text: `${owned.length}/${room.items.length}` }),
    items,
  ]);
}

function renderMyRoom(root) {
  const room = state.home.rooms.find((r) => r.id === state.homeRoom) || state.home.rooms[0];
  state.homeRoom = room.id;
  root.append(homeTopBar(`${room.icon} ${room.name}`));
  const scene = el('div', { class: 'room-scene room-' + room.id });
  scene.append(el('div', { class: 'sc-wall' }), el('div', { class: 'sc-floor' }));
  room.items.slice().sort((a, b) => (a.pos[1] - b.pos[1]) || (a.wall ? 1 : 0) - (b.wall ? 1 : 0))
    .forEach((i) => scene.append(homeItemBtn(room, i)));
  root.append(scene);
  root.append(el('p', { class: 'sub', style: 'text-align:center', text: '💡 点一下换颜色；按住不放可以拖到任意位置；虚线🔒格子点一下用 🔥 买回家' }));
}

// 花 🔥 火力购买；买过的可以换颜色（不花钱）
function shopItemRow(room, item) {
  const ow = ownedEntry(room.id, item.id);
  const colr = HOME_COLORS[ow ? ow.color : 'orig'] || HOME_COLORS.orig;
  const row = el('div', { class: 'shop-row' }, [
    el('span', { class: 'shop-emoji', style: `filter:${colr.filter}`, text: item.emoji }),
    el('span', { class: 'shop-name', text: item.name }),
  ]);
  if (ow) {
    row.append(
      el('span', { class: 'owned-chip', text: '已拥有 ✔' }),
      el('button', { class: 'btn sm alt', text: '🎨 配色', onclick: () => openColorPop(room, item) }),
    );
  } else {
    const afford = state.home.fire >= item.cost;
    const btn = el('button', { class: 'btn sm' + (afford ? ' ok' : ' alt'), text: afford ? `买来 🔥${item.cost}` : '🔥 不够', onclick: () => buyHomeItem(room, item) });
    if (!afford) btn.disabled = true;
    row.append(el('span', { class: 'cost-chip', title: `需要 ${item.cost} 点火力`, text: `🔥${item.cost}` }), btn);
  }
  return row;
}

function renderShopOverlay(root) {
  if (!state.shopRoom || !state.home.rooms.some((r) => r.id === state.shopRoom)) {
    state.shopRoom = state.homeRoom || 'kitchen';
  }
  const room = state.home.rooms.find((r) => r.id === state.shopRoom) || state.home.rooms[0];
  const mask = el('div', { class: 'shop-mask', onclick: (e) => { if (e.target === mask) { Sound.tap(); state.shopOpen = false; renderMyHome(); } } });
  const tabs = el('div', { class: 'shop-tabs' });
  state.home.rooms.forEach((r) => tabs.append(el('button', {
    class: 'shop-tab' + (r.id === room.id ? ' on' : ''),
    text: `${r.icon} ${r.name}`,
    onclick: () => { Sound.tap(); state.shopRoom = r.id; renderMyHome(); },
  })));
  const list = el('div', {});
  room.items.forEach((item) => list.append(shopItemRow(room, item)));
  mask.append(el('div', { class: 'shop-panel' }, [
    el('div', { class: 'row', style: 'align-items:center' }, [
      el('h2', { style: 'margin:0;flex:1', text: '🛒 小商店' }),
      el('button', { class: 'btn sm', text: '✕ 收起', onclick: () => { Sound.tap(); state.shopOpen = false; renderMyHome(); } }),
    ]),
    el('p', { class: 'sub', text: '花 🔥 火力就能买；买过的点「🎨 配色」可以随时换颜色（不花钱）' }),
    tabs, list,
  ]));
  root.append(mask);
}

function homeItemBtn(room, item) {
  const ow = ownedEntry(room.id, item.id);
  const posOf = () => (ow && ow.x != null && ow.y != null) ? [ow.x, ow.y] : item.pos;
  const place = (x, y) => `left:${x}%; top:${y}%; z-index:${item.wall ? 40 : 10 + Math.round(y)}; transform:${item.wall ? 'translate(-50%,-50%)' : 'translate(-50%,-100%)'}`;
  const [dx, dy] = posOf();
  if (!ow) {
    return el('button', {
      class: 'home-item item-slot' + (item.big ? ' hi-big' : '') + (item.wall ? ' hi-wall' : ''),
      style: place(dx, dy), title: `还没买「${item.name}」— 点一下花 🔥${item.cost} 搬进来`,
      onclick: () => buyHomeItem(room, item),
    }, [
      el('span', { class: 'hi-emoji', text: item.emoji }),
      el('span', { class: 'hi-lock', text: `🔒🔥${item.cost}` }),
    ]);
  }
  const colr = HOME_COLORS[ow.color] || HOME_COLORS.orig;
  const glow = item.anim === 'glow' ? ' drop-shadow(0 0 10px rgba(255,205,80,0.95))' : '';
  const kids = [el('span', { class: 'hi-emoji' + (item.anim && item.anim !== 'glow' ? ' hi-' + item.anim : ''), style: `filter:${colr.filter}${glow}`, text: item.emoji })];
  if (!item.wall) kids.push(el('span', { class: 'hi-base', style: `background:${colr.hex}` }));
  const btn = el('button', {
    class: 'home-item hi-drag' + (item.big ? ' hi-big' : '') + (item.wall ? ' hi-wall' : ''),
    style: place(dx, dy), title: `${item.name}（点一下换颜色，按住可以拖动摆位置）`,
  }, kids);
  makeDraggable(btn, room, item, ow);
  return btn;
}

// 按住左键（或手指按住）拖动家具，松手保存位置；没移动就是普通点击（换颜色）
function makeDraggable(btn, room, item, ow) {
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const scene = btn.closest('.room-scene');
    if (!scene) return;
    const rect = scene.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const base = item.wall ? 'translate(-50%,-50%)' : 'translate(-50%,-100%)';
    let moved = false, cur = null;
    btn.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const px = (ev.clientX - rect.left) / rect.width * 100;
      const py = (ev.clientY - rect.top) / rect.height * 100;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
      if (!moved) { moved = true; Sound.pop(); }
      btn.classList.add('dragging');
      const x = Math.min(97, Math.max(3, px));
      const y = item.wall ? Math.min(30, Math.max(4, py)) : Math.min(99.5, Math.max(38, py));
      cur = [x, y];
      btn.style.left = x + '%';
      btn.style.top = y + '%';
      btn.style.transform = base + ' scale(1.08)';
    };
    const onUp = async (ev) => {
      btn.removeEventListener('pointermove', onMove);
      btn.removeEventListener('pointerup', onUp);
      btn.removeEventListener('pointercancel', onUp);
      btn.classList.remove('dragging');
      if (!moved) { Sound.tap(); openColorPop(room, item); return; }
      try {
        const r = await api('/api/home/move', { method: 'POST', body: { room: room.id, item: item.id, x: cur[0], y: cur[1] } });
        ow.x = r.x; ow.y = r.y;
        Sound.click();
      } catch (err) { toast(err.message, 2500); }
      renderMyHome();
    };
    btn.addEventListener('pointermove', onMove);
    btn.addEventListener('pointerup', onUp);
    btn.addEventListener('pointercancel', onUp);
  });
}

async function buyHomeItem(room, item) {
  Sound.click();
  if (!confirm(`花 🔥${item.cost} 买「${item.name}」放进${room.name}吗？`)) return;
  try {
    const r = await api('/api/home/buy', { method: 'POST', body: { room: room.id, item: item.id } });
    state.home.fire = r.fire; streak = r.fire; renderXp();
    state.home.owned.push({ room: room.id, item: item.id, color: 'orig' });
    Sound.star(); confettiBurst();
    toast(`🎉 「${item.name}」搬进${room.name}啦！火力 -${item.cost}`, 2500);
    renderMyHome();
  } catch (e) {
    Sound.wrong(); toast(e.message, 3000);
    try {
      state.home = await api('/api/home');
      streak = state.home.fire; renderXp(); renderMyHome();
    } catch { /* ignore */ }
  }
}

function openColorPop(room, item) {
  Sound.tap();
  const ow = ownedEntry(room.id, item.id);
  if (!ow) return;
  const mask = el('div', { class: 'home-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
  const dots = el('div', { class: 'hp-dots' });
  Object.keys(HOME_COLORS).forEach((key) => {
    const c = HOME_COLORS[key];
    dots.append(el('button', {
      class: 'hp-dot' + (ow.color === key ? ' on' : ''), title: c.name, style: `background:${c.hex}`,
      onclick: async () => {
        Sound.pop();
        try {
          await api('/api/home/color', { method: 'POST', body: { room: room.id, item: item.id, color: key } });
          ow.color = key;
        } catch (e) { toast(e.message, 2500); }
        mask.remove();
        renderMyHome();
      },
    }));
  });
  const colr = HOME_COLORS[ow.color] || HOME_COLORS.orig;
  mask.append(el('div', { class: 'home-pop' }, [
    el('div', { class: 'hp-emoji', style: `filter:${colr.filter}`, text: item.emoji }),
    el('h2', { text: `给「${item.name}」换个颜色` }),
    dots,
    el('button', { class: 'btn sm', onclick: () => mask.remove(), text: '关闭' }),
  ]));
  document.body.append(mask);
}

// ================================================================ IMPORT
VIEWS.import = async (root) => {
  state.settings = await api('/api/settings');
  root.append(el('h2', { class: 'page-title', text: '📥 导入新单词' }));
  root.append(buildManualImport());
  root.append(buildImageImport());
  root.append(buildModelServiceCard());
};

function buildManualImport() {
  const card = el('div', { class: 'card' }, [
    el('h2', { text: '⌨️ 手动输入单词列表' }),
    el('p', { class: 'sub', text: '每行一个英文单词，会自动生成中文意思（可修改）' }),
    el('textarea', { id: 'manualWords', rows: 6, placeholder: 'apple\nbanana\nhappy\n...' }),
    el('div', { class: 'row' }, [
      el('input', { id: 'manualPageTitle', placeholder: '页面名称（可选，如：练习册 P12）' }),
      el('button', { class: 'btn', id: 'extractBtn', onclick: extractManual, text: '✨ 提取中文' }),
    ]),
  ]);
  return card;
}

async function extractManual() {
  Sound.click();
  const text = $('#manualWords').value;
  const words = text.split(/\n|,|;|、/).map((w) => w.trim()).filter(Boolean);
  if (!words.length) return toast('请先输入单词', 1500);
  const btn = $('#extractBtn');
  btn.disabled = true; btn.textContent = '⏳ 生成中...';
  try {
    const r = await api('/api/words/extract', { method: 'POST', body: { words } });
    Sound.star();
    renderManualResults(r.words || []);
  } catch (e) {
    toast(e.message, 3000);
    // fallback: let user fill manually
    renderManualResults(words.map((w) => ({ word: w, meaning_cn: '' })));
  } finally {
    btn.disabled = false; btn.textContent = '✨ 提取中文';
  }
}

function renderManualResults(entries) {
  const card = el('div', { class: 'card' }, [
    el('h2', { text: '✅ 确认并保存' }),
  ]);
  const list = el('div', { class: 'word-edit-list' });
  entries.forEach((e, i) => {
    const row = el('div', { class: 'word-edit-row' }, [
      el('span', { class: 'we-word', text: e.word }),
      el('input', { class: 'we-meaning', value: e.meaning_cn || '', placeholder: '中文意思' }),
      el('input', { class: 'we-cat', value: '', placeholder: '分类' }),
      el('input', { class: 'we-grade', type: 'number', value: state.settings?.default_grade || '3', min: '1', max: '6', title: '年级' }),
    ]);
    row.dataset.word = e.word;
    list.append(row);
  });
  card.append(list);
  card.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn', onclick: () => saveManual(list), text: '📥 加入词库' }),
  ]));
  $('#view').append(card);
}

async function saveManual(list) {
  Sound.click();
  let added = 0;
  for (const row of list.querySelectorAll('.word-edit-row')) {
    const word = row.dataset.word;
    const meaning = row.querySelector('.we-meaning').value.trim();
    const cat = row.querySelector('.we-cat').value.trim();
    const grade = Number(row.querySelector('.we-grade').value) || 3;
    try {
      await api('/api/words', { method: 'POST', body: { word, meaning_cn: meaning, category: cat, grade_level: grade } });
      added++;
    } catch (e) { /* duplicate or error */ }
  }
  Sound.levelup();
  toast(`✅ 已加入 ${added} 个单词！`, 2500);
  show('manage');
}

function buildImageImport() {
  const card = el('div', { class: 'card' }, [
    el('h2', { text: '📷 拍照识别整页题目' }),
    el('p', { class: 'sub', text: '上传练习册照片，自动识别每道题的 4 个选项单词' }),
    el('label', { class: 'file-btn', html: '📷 选择照片 <input type="file" id="photoInput" accept="image/*" hidden>' }),
    el('div', { id: 'ocrProgress', class: 'ocr-progress', text: '' }),
    el('div', { id: 'ocrResult' }),
  ]);
  const input = card.querySelector('#photoInput');
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) ocrPhoto(file, card);
  });
  return card;
}

async function ocrPhoto(file, card) {
  Sound.click();
  const prog = card.querySelector('#ocrProgress');
  prog.textContent = '⏳ 正在识别... 请稍候（可能需要半分钟）';
  try {
    const b64 = await fileToBase64(file);
    const r = await api('/api/pages/ocr', { method: 'POST', body: { image: b64 } });
    Sound.star();
    prog.textContent = '识别完成！勾选要加入的单词 ↓';
    renderOcrResult(card, r.questions || []);
  } catch (e) {
    prog.textContent = '';
    toast(e.message, 3500);
    Sound.wrong();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function renderOcrResult(card, questions) {
  const box = card.querySelector('#ocrResult');
  box.innerHTML = '';
  const checked = new Set();
  const wordsMap = {};
  questions.forEach((q, qi) => {
    const qdiv = el('div', { class: 'ocr-q' }, [el('div', { class: 'ocr-qno', text: `第${q.qno || qi + 1}题` })]);
    (q.options || []).forEach((opt) => {
      if (!opt || !opt.trim()) return;
      const key = opt.trim().toLowerCase();
      const wrow = el('label', { class: 'checkbox-row' }, [
        el('input', { type: 'checkbox', checked: true }),
        el('span', { text: opt.trim() }),
      ]);
      wrow.querySelector('input').addEventListener('change', (ev) => {
        Sound.tap();
        if (ev.target.checked) checked.add(key); else checked.delete(key);
      });
      if (!checked.has(key)) checked.add(key); // default all checked
      wordsMap[key] = opt.trim();
      qdiv.append(wrow);
    });
    box.append(qdiv);
  });
  const save = el('div', { class: 'row' }, [
    el('input', { id: 'ocrPageTitle', placeholder: '页面名称（可选，如：练习册 P13）' }),
    el('input', { id: 'ocrRefText', placeholder: '备注（可选）' }),
  ]);
  const btn = el('button', { class: 'btn big', onclick: () => saveOcrPage(wordsMap, Array.from(checked), card), text: '📥 加入本页单词' });
  box.append(save, btn);
}

async function saveOcrPage(wordsMap, checkedKeys, card) {
  Sound.click();
  const title = $('#ocrPageTitle').value.trim();
  const ref = $('#ocrRefText').value.trim();
  const words = checkedKeys.map((k) => ({ word: wordsMap[k], meaning_cn: '' }));
  if (!words.length) return toast('请至少勾选一个单词', 1500);
  try {
    // try to auto-fill meanings if model online
    let meanings = {};
    try {
      const r = await api('/api/words/extract', { method: 'POST', body: { words: words.map((w) => w.word) } });
      (r.words || []).forEach((m) => { if (m.word) meanings[m.word.toLowerCase()] = m.meaning_cn; });
    } catch {}
    const finalWords = words.map((w) => ({ ...w, meaning_cn: meanings[w.word.toLowerCase()] || '' }));
    await api('/api/pages', { method: 'POST', body: { title, ref_text: ref, words: finalWords } });
    Sound.levelup(); confettiBurst();
    toast('✅ 新页面已加入！', 2500);
    card.querySelector('#ocrResult').innerHTML = '';
    card.querySelector('#ocrProgress').textContent = '';
    show('manage');
  } catch (e) {
    toast(e.message, 3000);
  }
}

// ---------------------------------------------------------------- 模型服务状态/启停
function buildModelServiceCard() {
  const status = el('div', { class: 'sub', id: 'svcStatus', text: '⏳ 正在检查服务状态…' });
  const logBox = el('div', { class: 'svc-log', id: 'svcLog', style: 'display:none' });
  const startBtn = el('button', { class: 'btn', text: '🚀 启动模型服务' });
  const stopBtn = el('button', { class: 'btn danger', text: '⏹ 停止模型服务' });
  const card = el('div', { class: 'card' }, [
    el('h2', { text: '🧠 模型后台服务' }),
    el('p', { class: 'sub', text: '拍照识别、补全中文需要该模型；启动约需 5 分钟，启动中会每 10 秒自动刷新状态' }),
    status,
    logBox,
    el('div', { class: 'row svc-btns' }, [startBtn, stopBtn, el('button', { class: 'btn sm', onclick: () => { Sound.tap(); refresh(); }, text: '🔄 刷新' })]),
  ]);

  let timer = null;
  async function refresh() {
    let s;
    try { s = await api('/api/model/service'); }
    catch (e) { status.textContent = '⚠️ 获取状态失败：' + e.message; return; }
    if (s.online) {
      status.textContent = '✅ 服务在线，可以正常识别和补全中文';
      startBtn.disabled = true; stopBtn.disabled = false;
    } else if (s.starting) {
      status.textContent = '⏳ 服务启动中…通常需要约 5 分钟';
      startBtn.disabled = true; stopBtn.disabled = false;
    } else {
      status.textContent = '⛔ 服务未运行';
      startBtn.disabled = false; stopBtn.disabled = true;
    }
    if (s.logTail) { logBox.style.display = 'block'; logBox.textContent = s.logTail; logBox.scrollTop = logBox.scrollHeight; }
    else logBox.style.display = 'none';

    if (timer) { clearTimeout(timer); timer = null; }
    if (!s.online && s.starting) timer = setTimeout(refresh, 10000);
  }

  startBtn.addEventListener('click', async () => {
    Sound.click();
    if (!confirm('启动模型服务？加载模型可能需要几分钟。')) return;
    startBtn.disabled = true;
    try {
      const r = await api('/api/model/service/start', { method: 'POST' });
      toast(r.already ? '模型已在线 ✅' : '🚀 服务正在启动，约 5 分钟后可用', 3500);
      Sound.levelup();
    } catch (e) {
      toast(e.message, 3000); Sound.wrong();
      startBtn.disabled = false;
    }
    refresh();
  });
  stopBtn.addEventListener('click', async () => {
    Sound.click();
    if (!confirm('确定要停止模型后台服务吗？停止后拍照识别和补全中文会暂时不可用。')) return;
    stopBtn.disabled = true; status.textContent = '⏳ 正在停止服务…';
    try {
      const r = await api('/api/model/service/stop', { method: 'POST' });
      toast('⏹ 服务已停止', 2500);
    } catch (e) {
      toast(e.message, 3000); Sound.wrong();
    }
    refresh();
  });

  refresh();
  window.addEventListener('beforeunload', () => { if (timer) clearTimeout(timer); });
  return card;
}

// ================================================================ TEST SETUP
const TEST_LIMIT = 20;
const PAGE_LIMIT = 2;

VIEWS.test = async (root) => {
  const [pages, allWords, hardset, settings] = await Promise.all([api('/api/pages'), api('/api/words'), api('/api/hardset'), api('/api/settings')]);
  state.pages = pages;
  state.settings = settings;
  state.wordMap = {};
  allWords.forEach((w) => { state.wordMap[w.id] = w; });
  if (Number(settings?.test_limit) > 0) state.testLimit = Number(settings.test_limit);
  const limit = () => Number(state.testLimit) > 0 ? Number(state.testLimit) : TEST_LIMIT;
  if (!state.testSel || !(state.testSel.wordIds instanceof Set)) {
    state.testSel = { pageIds: new Set(), wordIds: new Set() };
  }
  if (state.testSel.untestedOnly === undefined) state.testSel.untestedOnly = true;
  const sel = state.testSel;

  root.append(el('h2', { class: 'page-title', text: '🎮 选择测试单词' }));

  const pageDetails = {};
  await Promise.all(pages.map(async (p) => {
    try { pageDetails[p.id] = await api('/api/pages/' + p.id); }
    catch (e) { pageDetails[p.id] = { words: [] }; }
  }));

  function pageWordIds(pageKey) {
    if (String(pageKey).startsWith('h:')) {
      const hp = hardset.pages.find((x) => 'h:' + x.index === pageKey);
      return (hp ? hp.words : []).map((w) => w.id);
    }
    return (pageDetails[Number(pageKey)]?.words || []).map((w) => w.id);
  }
  const isUntested = (w) => {
    const t = Number(w.times_tested || 0);
    return t === 0 || Number(w.times_failed || 0) >= t;
  };
  function poolWords() {
    let list;
    if (!sel.pageIds.size) list = allWords;
    else {
      const ids = new Set();
      sel.pageIds.forEach((pid) => pageWordIds(pid).forEach((id) => ids.add(id)));
      list = allWords.filter((w) => ids.has(w.id));
    }
    if (sel.untestedOnly) list = list.filter(isUntested);
    return list;
  }

  function addWordIds(ids) {
    let full = false;
    ids.forEach((id) => {
      if (sel.wordIds.has(id)) return;
      if (sel.wordIds.size >= limit()) { full = true; return; }
      sel.wordIds.add(id);
    });
    return full;
  }

  function trimToLimit() {
    const ids = [...sel.wordIds];
    while (sel.wordIds.size > limit()) sel.wordIds.delete(ids.pop());
  }

  function removeWordIds(ids) { ids.forEach((id) => sel.wordIds.delete(id)); }
  function queueWords() { return [...sel.wordIds].map((id) => state.wordMap[id]).filter(Boolean); }
  function randomPick() {
    Sound.click();
    let pool = poolWords();
    if (sel.untestedOnly) pool = pool.filter(isUntested);
    if (!pool.length) { toast(sel.untestedOnly ? '已经没有「未测词」可抽了，可取消勾选再抽全部' : '词库里没有单词', 2000); Sound.wrong(); return; }
    const picked = shuffleArr(pool).slice(0, limit());
    sel.wordIds.clear();
    picked.forEach((w) => sel.wordIds.add(w.id));
    Sound.pop();
    renderAll();
    toast(`🎲 已随机选 ${picked.length} 个单词（${sel.pageIds.size ? '来自所选页面' : '来自全部词库'}）`, 2200);
  }

  // --- Card 1: pick up to 2 pages (practice + hard, mixed) ---
  const pageCard = el('div', { class: 'card' }, [
    el('h2', { text: `📖 选页面（最多 ${PAGE_LIMIT} 页，可混合选）` }),
    el('p', { class: 'sub', text: '勾选练习页或难词页后，下方只显示这些页里的单词；答错的词会自动加入难词集（20词/页）' }),
  ]);
  root.append(pageCard);
  if (pages.length || hardset.pages.length) {
    const listEl = el('div', { class: 'page-pick-list' });
    function makePickRow(pageKey, htmlLabel, extraClass) {
      const label = el('label', { class: 'checkbox-row page-pick' + (extraClass ? ' ' + extraClass : '') }, [
        el('input', { type: 'checkbox', checked: sel.pageIds.has(pageKey) }),
        el('span', { html: htmlLabel }),
      ]);
      label.querySelector('input').addEventListener('change', (e) => {
        Sound.tap();
        if (e.target.checked) {
          if (sel.pageIds.size >= PAGE_LIMIT && !sel.pageIds.has(pageKey)) {
            e.target.checked = false;
            toast(`最多只能选 ${PAGE_LIMIT} 页`, 1500);
            return;
          }
          sel.pageIds.add(pageKey);
          const addIds = pageWordIds(pageKey).filter((id) =>
            !sel.untestedOnly || isUntested(state.wordMap[id] || {}));
          if (addIds.length && addWordIds(addIds)) toast(`测试清单最多 ${limit()} 个单词`, 2000);
        } else {
          sel.pageIds.delete(pageKey);
          removeWordIds(pageWordIds(pageKey));
          if (!sel.pageIds.size) sel.wordIds.clear();
        }
        renderAll();
      });
      return label;
    }
    if (pages.length) {
      if (hardset.pages.length) listEl.append(el('p', { class: 'sub', text: '— 练习页 —' }));
      pages.forEach((p) => {
        listEl.append(makePickRow(p.id, `<b>📖 ${esc(p.title || '未命名页面')}</b> <small>${p.date} · ${(pageDetails[p.id]?.words || []).length}词</small>`));
      });
    }
    hardset.pages.forEach((hp) => {
      const sample = hp.words.slice(0, 3).map((w) => esc(w.word)).join(', ') + (hp.words.length > 3 ? '…' : '');
      listEl.append(makePickRow('h:' + hp.index, `<b>🌶️ 难词页 ${hp.index}</b> <small>${hp.words.length}词 · ${sample}</small>`, 'hard'));
    });
    pageCard.append(listEl);
  } else {
    pageCard.append(el('p', { class: 'sub', text: '还没有练习页或难词，先去「导入」添加单词吧' }));
  }

  // --- Card 2: word pool (filtered by selected pages) ---
  const poolChips = el('div', { class: 'chips' });
  const limitInput = el('input', { type: 'number', min: '1', max: '100', value: String(limit()) });
  limitInput.addEventListener('change', async () => {
    const v = Math.min(100, Math.max(1, Number(limitInput.value) || 20));
    limitInput.value = String(v);
    if (v === limit()) return;
    Sound.click();
    state.testLimit = v;
    trimToLimit();
    renderAll();
    try { await api('/api/settings', { method: 'POST', body: { test_limit: v } }); toast(`每批单词数已设为 ${v}`, 1800); }
    catch (e) { toast(e.message, 2500); }
  });

  const untestedBox = el('input', { type: 'checkbox' });
  untestedBox.checked = sel.untestedOnly !== false;
  untestedBox.addEventListener('change', () => { Sound.tap(); sel.untestedOnly = untestedBox.checked; renderAll(); });

  const poolCard = el('div', { class: 'card' }, [
    el('div', { class: 'row', style: 'align-items:center' }, [
      el('h2', { style: 'flex:1; margin:0', text: '📚 选单词' }),
      el('label', { class: 'untested-toggle', title: '只显示还没测过、或一次都没答对的单词' }, [
        untestedBox, el('span', { text: '未测词' }),
      ]),
      el('span', { class: 'sub', text: '每批' }),
      limitInput,
      el('span', { class: 'sub', text: '个 · 或' }),
      el('button', { class: 'btn sm alt', onclick: randomPick, title: '从已勾选页面里随机抽一批单词', text: '🎲 随机选一批' }),
    ]),
    poolChips,
  ]);
  root.append(poolCard);



  // --- Card 4: test list ---
  const queueBody = el('div', { id: 'queueBody' });
  const queueCard = el('div', { class: 'card' }, [
    el('h2', { text: '📋 测试清单' }),
    el('div', { class: 'sub', text: '背诵和测试都用这批单词，测试结束会自动清空' }),
    el('div', { class: 'mode-btns' }, [
      el('button', { class: 'mode-btn', id: 'modeMeaning', onclick: () => pickMode('meaning'), html: `<span class="mbig">👀</span>看英文说中文` }),
      el('button', { class: 'mode-btn', id: 'modeSpelling', onclick: () => pickMode('spelling'), html: `<span class="mbig">✍️</span>看中文写英文` }),
    ]),
    queueBody,
  ]);
  root.append(queueCard);

  function renderPool() {
    poolChips.innerHTML = '';
    const pool = poolWords();
    poolChips.append(el('p', { class: 'sub', text: sel.pageIds.size
      ? `只显示已选 ${sel.pageIds.size} 个页面里的单词（共 ${pool.length} 个）${sel.untestedOnly ? ' · 只列未测词' : ''}`
      : `未勾选页面时显示全部单词（共 ${pool.length} 个，勾页面或随机选可从所选页抽词）${sel.untestedOnly ? ' · 只列未测词' : ''}` }));
    pool.forEach((w) => {
      const on = sel.wordIds.has(w.id);
      const c = el('button', { class: 'chip' + (on ? ' on' : ''), html: `${esc(w.word)}${w.meaning_cn ? `<small>·${esc(w.meaning_cn)}</small>` : ''}` });
      c.addEventListener('click', () => {
        Sound.tap();
        if (on) sel.wordIds.delete(w.id);
        else {
          if (sel.wordIds.size >= limit()) { toast(`测试清单最多 ${limit()} 个单词`, 1800); Sound.wrong(); return; }
          sel.wordIds.add(w.id);
        }
        renderAll();
      });
      poolChips.append(c);
    });
    if (!pool.length) poolChips.append(el('p', { class: 'sub', text: '没有可显示的单词' }));
  }

  function renderQueue() {
    const words = queueWords();
    queueBody.innerHTML = '';
    const head = el('div', { class: 'ws-head' }, [
      el('span', { text: `已选 ${words.length}/${limit()} 个单词` }),
      words.length ? el('button', { class: 'btn sm', onclick: clearList, text: '🧹 清空测试清单' }) : null,
    ]);
    queueBody.append(head);
    if (!words.length) {
      queueBody.append(el('p', { class: 'sub', text: '还没有选单词，勾选上方页面或点下面的单词' }));
      return;
    }
    const list = el('div', { class: 'word-list', style: 'margin:8px 0' });
    words.forEach((w) => {
      list.append(el('div', { class: 'word-row' }, [
        el('span', { class: 'ww-word', text: w.word }),
        el('span', { class: 'ww-meaning', text: w.meaning_cn || '…' }),
        el('button', { class: 'icon-btn', text: '✕', onclick: () => { Sound.tap(); sel.wordIds.delete(w.id); renderAll(); } }),
      ]));
    });
    queueBody.append(list);
    queueBody.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn', onclick: () => openStudy(), text: '📖 背诵模式' }),
      el('button', { class: 'btn ok', onclick: () => startQuiz(words, state.testMode || 'meaning'), text: '🚀 开始测试' }),
    ]));
  }

  function clearList() {
    Sound.click();
    sel.pageIds.clear();
    sel.wordIds.clear();
    document.querySelectorAll('.page-pick input').forEach((i) => { i.checked = false; });
    renderAll();
  }

  function pickMode(m) {
    Sound.click();
    state.testMode = m;
    setModeBtns();
  }

  function setModeBtns() {
    $('#modeMeaning')?.classList.toggle('active', state.testMode === 'meaning');
    $('#modeSpelling')?.classList.toggle('active', state.testMode === 'spelling');
  }

  function renderAll() { renderPool(); renderQueue(); setModeBtns(); }

  function openStudy() {
    Sound.click();
    const words = queueWords();
    if (!words.length) return toast('先勾选一些单词再加入测试清单', 1500);
    state.testQueue = words;
    if (!state.studyMode) state.studyMode = 'both';
    show('study');
  }

  renderAll();
};

function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function speakWord(text, lang) {
  if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音朗读', 2000); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

function studyWords(words) {
  if (!words || !words.length) return toast('没有可背诵的单词', 1500);
  state.testQueue = words;
  state.studyMode = 'both';
  show('study');
}

async function startQuiz(words, mode, retry) {
  Sound.click();
  if (!words || !words.length) return toast('请先选择单词', 1500);
  try {
    const sess = await api('/api/tests', { method: 'POST', body: { test_type: mode, word_ids: words.map((w) => w.id), mode: retry ? 'redo' : 'pick' } });
    state.test = {
      sessionId: sess.id,
      mode: mode || 'meaning',
      words: shuffleArr(words.map((w) => ({ ...w }))),
      idx: 0, correct: 0, total: words.length, failed: [],
    };
    showTest($('#view'));
  } catch (e) { toast(e.message, 3000); }
}

// ================================================================ STUDY (背诵模式)
VIEWS.study = (root) => {
  const words = (state.testQueue && state.testQueue.length) ? state.testQueue : [];
  root.append(el('h2', { class: 'page-title', text: '📖 背诵模式' }));
  if (!words.length) {
    root.append(el('div', { class: 'card' }, [
      el('p', { class: 'sub', text: '测试清单是空的，先去「测验」里勾选单词吧〜' }),
      el('button', { class: 'btn big', onclick: () => show('test'), text: '去选单词' }),
    ]));
    return;
  }
  if (!['both', 'en', 'cn'].includes(state.studyMode)) state.studyMode = 'both';

  const modeIdOf = { both: 'sdBoth', en: 'sdEn', cn: 'sdCn' };
  const ctrl = el('div', { class: 'card' }, [
    el('div', { class: 'mode-btns' }, [
      el('button', { class: 'mode-btn', id: 'sdBoth', onclick: () => setStudyMode('both'), html: `<span class="mbig">🔀</span>中英对照` }),
      el('button', { class: 'mode-btn', id: 'sdEn',   onclick: () => setStudyMode('en'),   html: `<span class="mbig">🔤</span>只看英文` }),
      el('button', { class: 'mode-btn', id: 'sdCn',   onclick: () => setStudyMode('cn'),   html: `<span class="mbig">🀄</span>只看中文` }),
    ]),
    el('p', { class: 'sub', text: '看着词卡小声念几遍（点单词可朗读），记熟后随时可开始测试！共 ' + words.length + ' 词' }),
  ]);
  const grid = el('div', { class: 'study-grid' });
  const actions = el('div', { class: 'row' }, [
    el('button', { class: 'btn', onclick: () => show('test'), text: '↩️ 返回选词' }),
    el('button', { class: 'btn ok', onclick: () => startQuiz(words, state.testMode || 'meaning'), text: '🎯 开始测试' }),
    el('button', { class: 'btn danger sm', onclick: clearTestListGlobal, text: '🧹 清空测试清单' }),
  ]);
  root.append(ctrl, grid, actions);

  function setStudyMode(m) { Sound.click(); state.studyMode = m; render(); }
  function render() {
    const activeId = modeIdOf[state.studyMode] || 'sdBoth';
    [document.getElementById('sdBoth'), document.getElementById('sdEn'), document.getElementById('sdCn')]
      .forEach((b) => b && b.classList.toggle('active', b.id === activeId));
    grid.innerHTML = '';
    words.forEach((w) => {
      const card = el('div', { class: 'study-card' });
      const enEl = el('div', { class: 'sc-en', text: state.studyMode === 'cn' ? '？？？' : w.word });
      const cnEl = el('div', { class: 'sc-cn', text: state.studyMode === 'en' ? '🤔' : (w.meaning_cn || '（暂无中文）') });
      if (state.studyMode !== 'cn') {
        enEl.classList.add('speakable');
        enEl.title = '点击朗读';
        enEl.addEventListener('click', () => speakWord(w.word, 'en-US'));
      }
      if (state.studyMode !== 'en' && w.meaning_cn) {
        cnEl.classList.add('speakable');
        cnEl.title = '点击朗读（普通话）';
        cnEl.addEventListener('click', () => speakWord(w.meaning_cn, 'zh-CN'));
      }
      card.append(enEl, cnEl);
      grid.append(card);
    });
  }
  render();
};

function clearTestListGlobal() {
  Sound.click();
  if (state.testSel) {
    state.testSel.pageIds = new Set();
    state.testSel.wordIds = new Set();
  }
  state.testQueue = [];
  toast('测试清单已清空', 1500);
  show('test');
}

function shuffleArr(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

// ================================================================ TEST RUNNER
async function showTest(root) {
  Sound.whoosh();
  const t = state.test;
  const wordsById = state.wordMap || {};
  t.words = t.words.map((x) => ({ ...x, ...(wordsById[x.id] || {}) }));
  renderQuestion(root);
}

function renderQuestion(root) {
  const t = state.test;
  const w = t.words[t.idx];
  if (!w) return finishTest(root);
  root.innerHTML = '';
  const prog = el('div', { class: 'test-progress' }, [el('div', { class: 'prog-fill', style: `width:${(t.idx / t.total) * 100}%` }), el('span', { text: `${t.idx + 1} / ${t.total}` })]);
  const mascot = el('div', { class: 'mascot-big mid', text: t.mode === 'meaning' ? '👀' : '🦫' });
  root.append(prog, mascot);
  root.append(el('button', { class: 'abort-btn', onclick: abortTest, text: '✋ 提前结束测试' }));
  if (t.mode === 'meaning') {
    root.append(el('div', { class: 'prompt', text: '这个英文单词是什么意思呢？' }));
    root.append(el('div', { class: 'big-word', text: w.word }));
    root.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn ok', onclick: () => answer(1), text: '✅ 答对了' }),
      el('button', { class: 'btn bad', onclick: () => answer(0), text: '❌ 不对' }),
    ]));
    root.append(el('div', { class: 'hint-answer', text: '💡 答案：' + (w.meaning_cn || '（无中文）') }));
  } else {
    root.append(el('div', { class: 'prompt', text: '看到中文，把英文单词拼出来吧！' }));
    if (w.meaning_cn) {
      const cnWord = el('div', { class: 'big-word speakable', text: w.meaning_cn, title: '点击朗读（普通话）' });
      cnWord.addEventListener('click', (e) => { e.stopPropagation(); speakWord(w.meaning_cn, 'zh-CN'); });
      root.append(cnWord);
      root.append(el('input', { id: 'spellInput', class: 'spell-input', placeholder: '输入英文单词', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') submitSpelling(); } }));
      root.append(el('button', { class: 'btn big', onclick: () => submitSpelling(), text: '✔️ 确认' }));
    } else {
      root.append(el('div', { class: 'big-word', text: '🤔' }));
      root.append(el('p', { class: 'sub', text: '这个单词还没有中文意思，先去「词库」点「✨ 补全中文」吧' }));
      root.append(el('button', { class: 'btn big alt', onclick: () => skipWord(), text: '⏭ 跳过' }));
    }
  }
}

function skipWord() {
  Sound.tap();
  const t = state.test;
  t.idx++;
  if (t.idx < t.total) renderQuestion($('#view'));
  else finishTest($('#view'));
}

async function answer(correct) {
  Sound.tap();
  const t = state.test;
  const w = t.words[t.idx];
  await api(`/api/tests/${t.sessionId}/answer`, { method: 'POST', body: { word_id: w.id, correct } });
  if (correct) { t.correct++; Sound.correct(); } else { t.failed.push(w); Sound.wrong(); }
  t.idx++;
  if (t.idx < t.total) renderQuestion($('#view'));
  else finishTest($('#view'));
}

async function submitSpelling() {
  const t = state.test;
  const w = t.words[t.idx];
  const guess = ($('#spellInput').value || '').trim().toLowerCase();
  if (!guess) return toast('先输入单词哦', 1200);
  const correct = guess === w.word.toLowerCase();
  await answer(correct);
}

function abortTest() {
  const t = state.test;
  if (!confirm('要提前结束这次测试吗？已答的会保留记录，未答的不计分。')) return;
  Sound.click();
  t.aborted = true;
  finishTest($('#view'));
}

function finishTest(root) {
  const t = state.test;
  const redoWords = t.words.map((w) => ({ ...w }));
  const answered = Math.min(t.idx, t.total);
  const aborted = !!t.aborted;
  const passed = !aborted && (t.failed.length === 0 || (t.mode === 'spelling' ? t.failed.length <= 2 : t.failed.length <= 1));
  if (!aborted) { Sound.levelup(); confettiBurst(); }
  api('/api/tests/' + t.sessionId + '/finish', { method: 'POST', body: { passed, correct_count: t.correct } })
    .then((r) => {
      if (!r || typeof r.streak !== 'number') return;
      streak = r.streak; renderXp();
      if (r.gained) { Sound.star(); toast(`🔥 一次通过，火力 +1！今天已加 ${r.dayCount}/2`, 3000); }
      else if (passed && !aborted) toast('🔥 今天火力值已加满（最多+2），明天继续！', 3000);
    })
    .catch(() => {});
  // 测试结束：清空测试清单
  if (!aborted) {
    if (state.testSel) { state.testSel.pageIds = new Set(); state.testSel.wordIds = new Set(); }
    state.testQueue = [];
  }
  root.innerHTML = '';
  const stars = aborted ? '❌' : (t.correct / Math.max(1, t.total) >= 0.9 ? '⭐⭐⭐' : t.correct / Math.max(1, t.total) >= 0.7 ? '⭐⭐' : '⭐');
  root.append(el('h2', { class: 'page-title', text: aborted ? '🛑 测试提前结束' : '🎉 测验完成！' }));
  root.append(el('div', { class: 'card result-card' }, [
    el('div', { class: 'result-stars', text: stars }),
    el('p', { class: 'result-score', text: aborted ? `答对 ${t.correct} / 已答 ${answered}` : `答对 ${t.correct} / ${t.total}` }),
    el('div', { class: 'mascot-big', text: aborted ? '🦫💤' : (passed ? '🦫🎉' : '🦫💪') }),
    el('p', { class: 'result-msg', text: aborted ? '提前结束了，休息一下，待会再战也行！错单词已加入难词集～' : (passed ? '太棒啦！你真是单词小达人！' : '别灰心，我们再练练就能记住啦！') }),
  ]));
  if (t.failed.length) {
    const f = el('div', { class: 'card' }, [el('h2', { text: '🌶️ 错词已加入难词集' }), el('div', { class: 'chips' })]);
    t.failed.forEach((w) => f.querySelector('.chips').append(el('span', { class: 'chip hard', text: `${w.word}${w.meaning_cn ? ' - ' + w.meaning_cn : ''}` })));
    root.append(f);
  }
  root.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn', onclick: () => show('home'), text: '🏠 回主页' }),
    el('button', { class: 'btn alt', onclick: () => startQuiz(redoWords, t.mode, true), text: '🔁 同批单词再测' }),
    el('button', { class: 'btn', onclick: () => studyWords(redoWords), text: '📖 同批单词再背' }),
    el('button', { class: 'btn', onclick: () => show('test'), text: '🎮 重新选词' }),
  ]));
  if (!passed) {
    const redo = el('div', { class: 'card redo-card' }, [
      el('h2', { text: '⏰ 稍后重测（2分钟）' }),
      el('div', { class: 'countdown', id: 'countdown', text: '02:00' }),
    ]);
    root.append(redo);
    startCountdown(120, $('#countdown'), () => toast('⏰ 时间到，可以再测啦！', 3000));
  }
  addXp(t.correct);
}

function startCountdown(total, elm, onDone) {
  let left = total;
  const iv = setInterval(() => {
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    elm.textContent = `${m}:${s}`;
    if (left <= 10) Sound.tick();
    if (left <= 0) { clearInterval(iv); onDone(); }
    left--;
  }, 1000);
}

// ================================================================ MANAGE
VIEWS.manage = async (root) => {
  const [words, categories, pages, settings] = await Promise.all([api('/api/words'), api('/api/categories'), api('/api/pages'), api('/api/settings')]);
  state.categories = categories;
  root.append(el('h2', { class: 'page-title', text: '📚 单词库' }));
  const filt = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('input', { id: 'mgSearch', placeholder: '🔍 搜索单词', oninput: () => renderList() }),
      el('select', { id: 'mgCat', onchange: () => renderList() }, [el('option', { value: '', text: '全部分类' }), ...categories.map((c) => el('option', { value: c, text: c }))]),
      el('select', { id: 'mgGrade', onchange: () => renderList() }, [el('option', { value: '', text: '年级' }), ...[1,2,3,4,5,6].map((g) => el('option', { value: g, text: '年级' + g }))]),
    ]),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn sm', onclick: () => { Sound.click(); show('import'); }, text: '📥 导入' }),
      el('button', { class: 'btn sm alt', onclick: () => fillMeanings(), text: '✨ 补全中文' }),
      el('label', { class: 'grade-ctl', html: `默认年级 <select id="mgDefGrade">${[1,2,3,4,5,6].map((g) => `<option value="${g}">年级${g}</option>`).join('')}</select>` }),
      el('span', { id: 'mgCount', class: 'sub' }),
    ]),
  ]);
  const list = el('div', { class: 'word-list', id: 'mgList' });
  root.append(filt, list);
  state.mgWords = words;

  // default grade persistence
  const defSel = $('#mgDefGrade');
  defSel.value = String(settings.default_grade || 3);
  defSel.addEventListener('change', async () => {
    Sound.click();
    await api('/api/settings', { method: 'POST', body: { default_grade: Number(defSel.value) } });
    toast('默认年级已设为 年级' + defSel.value, 1500);
  });

  // 单词页 section after the grade filter
  const pcards = buildPageList(pages);
  root.append(pcards);

  window.renderList = function () {
    const q = ($('#mgSearch').value || '').toLowerCase();
    const cat = $('#mgCat').value;
    const grade = $('#mgGrade').value;
    const filtered = state.mgWords.filter((w) =>
      (!q || w.word.toLowerCase().includes(q) || w.meaning_cn.includes(q)) &&
      (!cat || w.category === cat) &&
      (!grade || String(w.grade_level) === grade));
    $('#mgCount').textContent = `${filtered.length} 个单词`;
    const l = $('#mgList'); l.innerHTML = '';
    filtered.forEach((w) => l.append(buildWordRow(w)));
  };
  renderList();
};

function buildWordRow(w) {
  const d = Math.round(w.difficulty * 10) / 10;
  const lv = d >= 3.5 ? 'hard' : d >= 2.5 ? 'mid' : 'easy';
  const row = el('div', { class: 'word-row' }, [
    el('span', { class: 'ww-word', text: w.word }),
    el('span', { class: 'ww-meaning', text: w.meaning_cn || '…' }),
    el('span', { class: `lv lv-${lv}`, text: lv }),
    el('span', { class: 'ww-stats', text: `测${w.times_tested}次 败${w.times_failed}次` }),
    el('button', {
      class: 'icon-btn' + (w.category === '完成' ? ' done' : ''),
      text: w.category === '完成' ? '✅' : '⬜',
      title: w.category === '完成' ? '点一下改回「未完」' : '标记为「完成」（同时移出难词集）',
      onclick: () => toggleWordDone(w),
    }),
    el('button', { class: 'icon-btn', text: '✏️', onclick: (e) => editWord(w, row) }),
    el('button', { class: 'icon-btn', text: '🗑️', onclick: async () => { if (confirm('删除 ' + w.word + '？')) { await api('/api/words/' + w.id, { method: 'DELETE' }); show('manage'); } } }),
  ]);
  return row;
}

function editWord(w, row) {
  Sound.tap();
  const newM = prompt('中文意思', w.meaning_cn);
  if (newM === null) return;
  const newC = prompt('分类', w.category);
  if (newC === null) return;
  let g = Number(prompt('年级', w.grade_level || 3));
  if (!(g >= 1 && g <= 6)) g = w.grade_level || 3;
  api('/api/words/' + w.id, { method: 'PUT', body: { meaning_cn: newM, category: newC, grade_level: g } })
    .then(() => show('manage'));
}

async function toggleWordDone(w) {
  Sound.tap();
  const next = w.category === '完成' ? '未完' : '完成';
  try {
    await api('/api/words/' + w.id, { method: 'PUT', body: { meaning_cn: w.meaning_cn || '', category: next, grade_level: w.grade_level || 3 } });
    if (next === '完成') Sound.star();
    toast(next === '完成' ? `✅ ${w.word} 已标记为完成` : `⬜ ${w.word} 已改回未完`, 1800);
    show('manage');
  } catch (e) { toast(e.message, 2500); }
}

// ---- 单词页 (word page) list + inline editing ----
function buildPageList(pages) {
  const card = el('div', { class: 'card page-cards' }, [
    el('h2', { text: '📋 单词页（练习页）' }),
    el('p', { class: 'sub', text: '点「编辑」可直接改标题/备注/单词，增删单词' }),
  ]);
  if (!pages.length) {
    card.append(el('p', { class: 'sub', text: '还没有练习页。导入或拍照识别后会出现这里，可直接编辑。' }));
    return card;
  }
  pages.forEach((p) => card.append(buildPageRow(p)));
  return card;
}

function buildPageRow(p) {
  const head = el('div', { class: 'page-row-head' }, [
    el('div', { class: 'page-row-title' }, [
      el('b', { text: p.title || '未命名页面' }),
      el('span', { class: 'sub', text: `${p.date} · ${p.word_count} 词` }),
    ]),
    el('button', { class: 'btn sm', 'data-pid': String(p.id), text: '📝 编辑' }),
  ]);
  const editor = el('div', { class: 'page-editor', style: 'display:none' });
  const row = el('div', { class: 'page-row' }, [head, editor]);

  const btn = head.querySelector('button');
  btn.addEventListener('click', async () => {
    Sound.tap();
    if (editor.style.display === 'block') { editor.style.display = 'none'; btn.textContent = '📝 编辑'; return; }
    editor.innerHTML = '<p class="sub">加载中…</p>';
    editor.style.display = 'block';
    btn.textContent = '🔼 收起';
    let detail;
    try { detail = await api('/api/pages/' + p.id); } catch (e) { editor.innerHTML = `<p class="sub">${e.message}</p>`; return; }
    renderPageEditor(editor, detail);
  });
  return row;
}

function renderPageEditor(editor, p) {
  editor.innerHTML = '';
  editor.append(
    el('div', { class: 'row' }, [
      el('input', { id: 'pgTitle', value: p.title || '', placeholder: '页面标题，如 练习册 P12' }),
      el('input', { id: 'pgRef', value: p.ref_text || '', placeholder: '备注（可选）' }),
      el('input', { id: 'pgDate', type: 'date', value: p.date || '', title: '页面日期' }),
    ]),
  );
  editor.append(el('div', { class: 'row' }, [
    el('button', { class: 'btn sm', onclick: savePage, html: '💾 保存页面信息' }),
    el('button', { class: 'btn sm danger', onclick: deletePage, text: `🗑️ 删除页面「${p.title || '未命名'}」` }),
  ]));
  editor.append(el('div', { class: 'sub', text: '页面单词（点 ✕ 移除）' }));
  const chips = el('div', { class: 'chips pg-chips' });
  editor.append(chips);
  editor.append(el('div', { class: 'row' }, [
    el('input', { id: 'pgAddWord', placeholder: '输入单词加入此页' }),
    el('button', { class: 'btn sm alt', onclick: addWordToPage, text: '＋ 加入本页' }),
  ]));
  (p.words || []).forEach((w) => chips.append(
    el('button', { class: 'chip', onclick: async () => {
      if (!confirm('把 ' + w.word + ' 从本页移除？')) return;
      await api(`/api/pages/${p.id}/words/${w.id}`, { method: 'DELETE' });
      show('manage');
    }, html: `${w.word}<span class="x">×</span>` })
  ));

  async function savePage() {
    Sound.click();
    await api('/api/pages/' + p.id, { method: 'PUT', body: {
      title: $('#pgTitle').value, ref_text: $('#pgRef').value, date: $('#pgDate').value,
    } });
    toast('页面已保存', 1200); show('manage');
  }
  async function deletePage() {
    if (!confirm('删除整个页面？（单词仍保留在词库）')) return;
    await api('/api/pages/' + p.id, { method: 'DELETE' });
    toast('页面已删除', 1200); show('manage');
  }
  async function addWordToPage() {
    const text = ($('#pgAddWord').value || '').trim();
    if (!text) return toast('先输入一个单词', 1200);
    Sound.click();
    await api(`/api/pages/${p.id}/words`, { method: 'POST', body: { word: text } });
    show('manage');
  }
}

// Auto-fill Chinese meanings for words that don't have one yet.
async function fillMeanings() {
  Sound.click();
  const missing = state.mgWords.filter((w) => !w.meaning_cn);
  if (!missing.length) return toast('所有单词都有中文意思啦', 1500);
  toast(`正在为 ${missing.length} 个单词补全中文...`, 4000);
  try {
    const r = await api('/api/words/extract', { method: 'POST', body: { words: missing.map((w) => w.word) } });
    let updated = 0;
    for (const m of r.words || []) {
      if (!m.meaning_cn) continue;
      const w = missing.find((x) => x.word.toLowerCase() === m.word.toLowerCase());
      if (w) { await api('/api/words/' + w.id, { method: 'PUT', body: { meaning_cn: m.meaning_cn, category: w.category, grade_level: w.grade_level } }); updated++; }
    }
    Sound.star();
    toast(`✅ 已补全 ${updated} 个单词的中文`, 2500);
    show('manage');
  } catch (e) {
    toast(e.message, 3000);
  }
}

// ================================================================ STATS
VIEWS.stats = async (root) => {
  const st = await api('/api/stats');
  root.append(el('h2', { class: 'page-title', text: '📊 学习统计' }));
  const cards = el('div', { class: 'stat-grid' }, [
    el('div', { class: 'stat-box', html: `<span>⭐ 经验</span><b>${st.xp}</b>` }),
    el('div', { class: 'stat-box', html: `<span>🔥 连胜</span><b>${st.streak}</b>` }),
    el('div', { class: 'stat-box', html: `<span>📚 单词</span><b>${st.wordCount}</b>` }),
    el('div', { class: 'stat-box', html: `<span>🎯 正确率</span><b>${st.accuracy}%</b>` }),
    el('div', { class: 'stat-box', html: `<span>🎮 测验</span><b>${st.sessions}</b>` }),
    el('div', { class: 'stat-box', html: `<span>🌶️ 难点</span><b>${st.hardCount}</b>` }),
  ]);
  root.append(cards);
  if (st.difficult && st.difficult.length) {
    const d = el('div', { class: 'card' }, [el('h2', { text: '🌶️ 最需要复习的单词' }), el('div', { class: 'word-list' })]);
    st.difficult.forEach((w) => d.querySelector('.word-list').append(buildWordRow(w)));
    root.append(d);
  }
  if (st.recentSessions && st.recentSessions.length) {
    const s = el('div', { class: 'card' }, [el('h2', { text: '🕐 最近测验' }), el('div', { class: 'session-list' })]);
    const listEl = s.querySelector('.session-list');
    st.recentSessions.forEach((x) => {
      const detail = el('div', { class: 'session-detail', style: 'display:none' });
      const row = el('div', { class: 'session-row', style: 'cursor:pointer', html: `<span class="sub">${esc(String(x.date || '').slice(0, 10))}</span><span>${x.test_type === 'meaning' ? '👀 看英文' : '✍️ 写英文'}</span><span>${x.correct_count}/${x.word_count} ▼</span><span>${x.passed ? '✅' : '❌'}</span>` });
      row.addEventListener('click', async () => {
        Sound.tap();
        if (detail.style.display !== 'none') {
          detail.style.display = 'none';
          row.querySelectorAll('span')[2].textContent = `${x.correct_count}/${x.word_count} ▼`;
          return;
        }
        row.querySelectorAll('span')[2].textContent = `${x.correct_count}/${x.word_count} ▲`;
        if (!detail.dataset.loaded) {
          detail.innerHTML = '<p class="sub">加载中…</p>';
          try {
            const d = await api('/api/tests/' + x.id);
            detail.innerHTML = '';
            (d.answers || []).forEach((a) => detail.append(
              el('span', { class: 'chip ' + (a.correct ? 'on' : 'hard'), text: `${a.word}${a.meaning_cn ? ' · ' + a.meaning_cn : ''}${a.correct ? ' ✅' : ' ❌'}` })));
            if (!(d.answers || []).length) detail.append(el('p', { class: 'sub', text: '没有答题记录' }));
            detail.dataset.loaded = '1';
          } catch (e) {
            detail.innerHTML = `<p class="sub">${e.message}</p>`;
            return;
          }
        }
        detail.style.display = 'block';
      });
      listEl.append(row, detail);
    });
    root.append(s);
  }
};

// ---------------------------------------------------------------- boot
async function boot() {
  Sound.unlock();
  $('#soundToggle').addEventListener('click', () => {
    Sound.enabled = !Sound.enabled;
    $('#soundToggle').textContent = Sound.enabled ? '🔊' : '🔇';
    Sound.click();
  });
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  const st = await api('/api/stats');
  xp = st.xp; level = st.level; streak = st.streak; renderXp();
  show('home');
}
boot();
