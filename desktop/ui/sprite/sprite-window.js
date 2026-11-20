// Cosmos 精灵 · 星灵 Astra（v6.11）
// ---------------------------------------------------------------------------
// 职责：3D 实体 + 量子态脉动 + 对话 + **自主意识 HUD / 桌面漫游 / 意识流**。
// 一切数值来自主进程 ASTRA 内核与漫游引擎的真实运行时状态，界面无占位数字。
// 安全：所有外部文本（含用户输入、记忆、审计）一律 textContent，绝不 innerHTML。
import { createSpriteScene } from './sprite3d.js';

const C = window.cosmosSprite;
const $ = (id) => document.getElementById(id);
const root = $('root');
const stage = $('stage');
const panel = $('panel');
const msgs = $('msgs');
const mindView = $('mindView');
const inputRow = $('inputRow');
const spriteHint = $('spriteHint');
const tabs = $('spriteTabs');
const typing = $('typing');
const input = $('askInput');
const sendBtn = $('sendBtn');
const hideBtn = $('hideBtn');
const panelClose = $('panelClose');
const thinkBubble = $('thinkBubble');
const thinkText = $('thinkText');
const sizeBtn = $('sizeBtn');
const sizePop = $('sizePop');
const sizeRange = $('sizeRange');
const sizeVal = $('sizeVal');
const dock = $('astraDock');
const ahSigil = $('ahSigil');
const ahKey = $('ahKey');
const ahMood = $('ahMood');
const ahGen = $('ahGen');
const ahIntent = $('ahIntent');
const ahLib = $('ahLib');
const ahDrives = $('ahDrives');

const scene = createSpriteScene(stage);
scene.onSpriteClick(() => openPanel());

// 主进程推送的量子态 → 3D 五段通道弧
if (C?.onQuantum) C.onQuantum((trace) => scene.setQuantum(trace));

// ---------------- 思考气泡 ----------------
let thinkTimer = null;
function showThink(text) {
  if (!text) return;
  thinkText.textContent = String(text);
  thinkBubble.hidden = false;
  scene.pulse(1);
  clearTimeout(thinkTimer);
  thinkTimer = setTimeout(() => { thinkBubble.hidden = true; }, 3600);
}
if (C?.onThought) C.onThought((t) => {
  if (t && t.trace) scene.setQuantum(t.trace);
  showThink(t?.text || t?.peakLabel);
});

// ---------------- 对话 ----------------
function openPanel() {
  panel.hidden = false;
  document.body.classList.add('panel-open');
  try { C.astraHold(true); } catch (e) { /* 主进程桥不可用时不影响对话 */ }
  setTimeout(() => { try { input.focus(); } catch (e) {} }, 30);
}
function closePanel() {
  panel.hidden = true;
  document.body.classList.remove('panel-open');
  try { C.astraHold(false); } catch (e) { /* ignore */ }
}
function showTyping() { if (typing) { typing.hidden = false; msgs.scrollTop = msgs.scrollHeight; } }
function hideTyping() { if (typing) typing.hidden = true; }

function addMsg(role, text, meta, sources, astra) {
  const el = document.createElement('div');
  el.className = 'sprite-msg ' + role;
  if (role === 'sprite') {
    const av = document.createElement('span'); av.className = 'sprite-msg-av'; av.textContent = '✶'; el.appendChild(av);
  }
  const body = document.createElement('div'); body.className = 'sprite-msg-body';
  const span = document.createElement('span'); span.textContent = String(text ?? ''); body.appendChild(span);
  if (meta) { const m = document.createElement('span'); m.className = 'qmeta'; m.textContent = String(meta); body.appendChild(m); }
  if (astra && astra.level != null) {
    const a = document.createElement('span'); a.className = 'qmeta';
    a.textContent = `L${astra.level} ${astra.levelInfo?.key || ''} · ${astra.mood?.label || ''} · ${astra.intent?.label || ''} · 第 ${astra.generation} 世`;
    body.appendChild(a);
  }
  if (Array.isArray(sources) && sources.length) {
    const chips = document.createElement('div'); chips.className = 'sprite-srcs';
    sources.slice(0, 5).forEach((s) => {
      const c = document.createElement('span'); c.className = 'sprite-src';
      c.textContent = s?.title || s?.name || '来源'; chips.appendChild(c);
    });
    body.appendChild(chips);
  }
  el.appendChild(body);
  if (typing && typing.parentNode === msgs) msgs.insertBefore(el, typing);
  else msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

let busy = false;
async function send() {
  const text = input.value.trim(); if (!text || busy) return;
  input.value = '';
  addMsg('user', text);
  showTyping();
  busy = true;
  try {
    const res = await C.ask(text);
    hideTyping();
    addMsg('sprite', res.answer || '（无内容）', res.meta || '', res.sources || [], res.astra || null);
    if (res.quantum) scene.setQuantum(res.quantum);
  } catch (e) {
    hideTyping();
    addMsg('sprite', '思考暂时中断：' + (e?.message || e));
  } finally { busy = false; }
}
sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
panelClose.addEventListener('click', closePanel);
hideBtn.addEventListener('click', () => { try { C.close(); } catch (e) { window.close(); } });

// ---------------- 面板标签：对话 / 意识流 ----------------
let mindVisible = false;
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('.st-tab'); if (!b) return;
  const tab = b.dataset.tab;
  for (const x of tabs.querySelectorAll('.st-tab')) {
    const on = x === b;
    x.classList.toggle('is-on', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  msgs.hidden = tab !== 'chat';
  mindView.hidden = tab !== 'mind';
  inputRow.hidden = tab !== 'chat';
  // v6.13：边界声明只在对话页出现；意识流页自带完整的「能力边界」段，
  // 旧版这里挂着一句对话说明文字，白占两行还和内容对不上。
  if (spriteHint) spriteHint.hidden = tab !== 'chat';
  mindVisible = tab === 'mind';
  if (mindVisible && latest) renderMind(latest.mind, latest);
});

// ---------------- v6.5.0：尺寸调节 ----------------
function syncScale(v) {
  const pct = Math.round(Math.min(1.5, Math.max(0.6, Number(v) || 0.9)) * 100);
  sizeRange.value = String(pct);
  sizeVal.textContent = pct + '%';
}
sizeBtn.addEventListener('click', (e) => { e.stopPropagation(); sizePop.hidden = !sizePop.hidden; });
sizeRange.addEventListener('input', async () => {
  const pct = Number(sizeRange.value);
  sizeVal.textContent = pct + '%';
  try {
    const r = await C.setScale(pct / 100);
    if (r && r.scale) syncScale(r.scale);
    try { await C.astraStatus(); } catch (e) { /* ignore */ }
  } catch (e) { /* 尺寸失败不打断对话 */ }
});
document.addEventListener('click', (e) => {
  if (!sizePop.hidden && !sizePop.contains(e.target) && e.target !== sizeBtn) sizePop.hidden = true;
});
if (C?.onScale) C.onScale((v) => syncScale(v));

// ═══════════════════════════════════════════════════════════════════════
// v6.11 · ASTRA 意识 HUD / 漫游控制 / 拖拽 / 鼠标穿透 / 意识流
// ═══════════════════════════════════════════════════════════════════════
const DRIVE_META = [
  ['curiosity', '好奇'], ['affinity', '亲和'], ['vigor', '活力'], ['order', '秩序'],
];
const driveBars = new Map();
for (const [key, label] of DRIVE_META) {
  const wrap = document.createElement('div'); wrap.className = 'ah-drive';
  const track = document.createElement('i');
  const bar = document.createElement('b');
  track.appendChild(bar);
  const cap = document.createElement('span'); cap.textContent = label;
  wrap.append(track, cap);
  ahDrives.appendChild(wrap);
  driveBars.set(key, bar);
}

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
let latest = null;

function syncMode(mode) {
  for (const b of dock.querySelectorAll('.ad-btn[data-mode]')) {
    b.classList.toggle('is-on', b.dataset.mode === mode);
  }
}

function renderAstra(p) {
  if (!p || !p.mind) return;
  latest = p;
  const m = p.mind;
  ahSigil.textContent = 'L' + (m.level || 1);
  ahKey.textContent = m.levelInfo?.key || '';
  ahMood.textContent = m.mood?.label || '';
  ahGen.textContent = ROMAN[(m.generation || 1) - 1] || String(m.generation || 1);
  ahGen.title = `第 ${m.generation} 世 · ${m.epoch || 0} 次迭代`;
  ahIntent.textContent = m.intent?.text || '正在唤醒…';
  if (ahLib) ahLib.textContent = p.libraryRoot ? '沉淀库 · ' + p.libraryRoot : '';
  for (const [k] of DRIVE_META) {
    const bar = driveBars.get(k);
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, Number(m.drives?.[k]) || 0)) * 100) + '%';
  }
  // 3D：能级道纹冠 / 情绪 / 漫游姿态
  try {
    scene.setLevel(m.level || 1);
    scene.setMood(m.mood);
    if (p.motion) scene.setBehavior({ facing: p.motion.facing, speed: p.motion.speed, behavior: p.motion.behavior });
    else scene.setBehavior({ speed: 0, behavior: m.intent?.motion || 'perch' });
  } catch (e) { /* 3D 尚未就绪 */ }
  if (p.mode) syncMode(p.mode);

  if (p.event === 'level_up') showThink(`等级提升 · L${p.level} ${m.levelInfo?.key || ''}`);
  else if (p.event === 'evolution' && p.evolution?.changed) showThink(`第 ${p.evolution.gen} 世 · 完成一次自我迭代`);
  else if (p.event === 'wake') showThink('行为内核已就绪 · 点我可以聊天');
  else if (p.event === 'rollback') showThink('已回滚到上一世');

  if (mindVisible) renderMind(m, p);
}
if (C?.onAstraState) C.onAstraState(renderAstra);

// ---- 漫游坞 ----
dock.addEventListener('click', (e) => {
  const b = e.target.closest('.ad-btn[data-mode]');
  if (!b) return;
  const mode = b.dataset.mode;
  syncMode(mode);
  try { C.astraMode(mode); } catch (err) { /* ignore */ }
});
$('adHome').addEventListener('click', () => {
  syncMode('auto');
  try { C.astraHome(); C.astraMode('auto'); } catch (e) { /* ignore */ }
  showThink('回到你身边');
});

// ---- 拖拽：按住角色本体或抓手，即可在桌面自由挪动 ----
let dragState = null;
let lastHit = true;
root.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const t = ev.target;
  if (t.closest('#sizePop, #panel, #hideBtn, #sizeBtn')) return;  // 面板 / 尺寸滑块 / 关闭 / 缩放按钮不触发拖窗
  const grip = t.closest('#adGrip');
  if (t.closest('#astraDock') && !grip) return;          // 其它坞按钮是点击，不是拖拽
  dragState = { x: ev.clientX, y: ev.clientY, ox: ev.clientX, oy: ev.clientY, started: false };
});
window.addEventListener('pointermove', (ev) => {
  // 鼠标穿透命中判定：面板 / 控件 / 中心角色椭圆内可交互，其余区域穿透到桌面
  try {
    let interactive = !panel.hidden;
    if (!interactive) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (el && el.closest('[data-hit]')) interactive = true;
      else {
        const r = root.getBoundingClientRect();
        const nx = (ev.clientX - r.left - r.width / 2) / (r.width * 0.40);
        const ny = (ev.clientY - r.top - r.height * 0.50) / (r.height * 0.38);
        interactive = nx * nx + ny * ny < 1;
      }
    }
    lastHit = interactive;
    C.astraHit(interactive);
  } catch (e) { /* 桥不可用：不影响拖拽 */ }
  if (!dragState) return;
  if (!dragState.started && Math.hypot(ev.clientX - dragState.x, ev.clientY - dragState.y) > 6) {
    dragState.started = true;
    document.body.classList.add('is-dragging');
    try { C.astraDragStart({ offsetX: dragState.ox, offsetY: dragState.oy }); } catch (e) { /* ignore */ }
  }
});
function endDrag() {
  if (dragState?.started) { try { C.astraDragEnd(); } catch (e) { /* ignore */ } }
  dragState = null;
  document.body.classList.remove('is-dragging');
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
// 看门狗心跳：即便鼠标静止，主进程也能确认 forward 事件仍然可达
setInterval(() => { try { C.astraHit(!panel.hidden || lastHit); } catch (e) { /* ignore */ } }, 1200);

// ---- 意识流面板 ----
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const section = (title) => {
  const s = el('div', 'am-sec');
  s.appendChild(el('div', 'am-h', title));
  return s;
};
const rowBar = (label, value, ratio) => {
  const r = el('div', 'am-row');
  r.appendChild(el('span', null, label));
  const bar = el('div', 'am-bar');
  const fill = el('i');
  fill.style.width = Math.round(Math.max(0, Math.min(1, Number(ratio) || 0)) * 100) + '%';
  bar.appendChild(fill);
  r.appendChild(bar);
  r.appendChild(el('b', null, value));
  return r;
};
const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

function renderMind(m, p) {
  const keepScroll = mindView.scrollTop;
  mindView.textContent = '';

  // ① 此刻的决策（完整理由链）
  const s1 = section('此刻的决策 · 可解释');
  const d = m.lastDecision;
  const box = el('div', 'am-reason');
  if (d && Array.isArray(d.reason) && d.reason.length) {
    d.reason.forEach((line, i) => {
      if (i) box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode((i === 0 ? '① ' : '· ') + line));
    });
  } else box.textContent = '尚未产生第一次决策，等待下一次心跳。';
  s1.appendChild(box);
  s1.appendChild(rowBar('决策置信', d ? (d.confidence ?? 0).toFixed(2) : '—', d?.confidence || 0));
  mindView.appendChild(s1);

  // ② 内在驱动
  const s2 = section('内在驱动 · DRIVES');
  for (const [k, label] of DRIVE_META) {
    const v = Number(m.drives?.[k]) || 0;
    s2.appendChild(rowBar(label, v.toFixed(2), v));
  }
  s2.appendChild(rowBar('情绪唤醒', (m.mood?.arousal ?? 0).toFixed(2), m.mood?.arousal || 0));
  mindView.appendChild(s2);

  // ③ 自主目标
  const s3 = section('自主目标 · GOALS');
  if (m.goals?.length) {
    for (const g of m.goals) {
      s3.appendChild(rowBar(g.label, `${Math.round(g.progress)}/${g.target}`, (g.progress || 0) / (g.target || 1)));
    }
  } else s3.appendChild(el('div', 'am-mem', '此刻没有待办目标，正在观察环境。'));
  s3.appendChild(el('div', 'am-mem', `已完成 ${m.selfModel?.goalsDone || 0} · 过期 ${m.selfModel?.goalsFailed || 0} · 成功率 ${(m.successRate || 0).toFixed(2)}`));
  mindView.appendChild(s3);

  // ④ 记忆
  const s4 = section('记忆 · MEMORY');
  const eps = m.memory?.episodic || [];
  eps.slice(0, 7).forEach((e) => {
    const line = el('div', 'am-mem');
    line.appendChild(el('time', null, fmtTime(e.at)));
    line.appendChild(document.createTextNode(e.text || ''));
    s4.appendChild(line);
  });
  const sem = m.memory?.semantic || [];
  if (sem.length) {
    const line = el('div', 'am-mem');
    line.appendChild(el('time', null, '语义'));
    line.appendChild(document.createTextNode(sem.slice(0, 8).map((x) => `${x.text}×${x.count}`).join(' · ')));
    s4.appendChild(line);
  }
  if (!eps.length && !sem.length) s4.appendChild(el('div', 'am-mem', '记忆尚空，和我说句话就会留下第一条。'));
  mindView.appendChild(s4);

  // ⑤ 世代与自我迭代
  const s5 = section('世代 · EVOLUTION');
  s5.appendChild(el('div', 'am-gen', `第 ${m.generation} 世 · ${m.epoch || 0} 次迭代 · 快照 ${m.counts?.generations || 0} 份`));
  (m.lineage || []).slice(-4).reverse().forEach((g) => {
    s5.appendChild(el('div', 'am-mem', `第 ${g.gen} 世 · L${g.level} · 成功率 ${g.successRate} · 记忆 ${g.memories}`));
  });
  const acts = el('div', 'am-actions');
  const bTick = el('button', 'am-btn', '心跳一次');
  bTick.addEventListener('click', async () => { try { await C.astraTick(); showThink('一次自主心跳'); } catch (e) {} });
  const bEvolve = el('button', 'am-btn gold', '自主演化');
  bEvolve.addEventListener('click', async () => {
    try { const r = await C.astraEvolve(); showThink(r?.changed ? `第 ${r.gen} 世 · 策略已更新` : '演化冷却中'); }
    catch (e) { /* ignore */ }
  });
  const bRoll = el('button', 'am-btn', '回滚上一世');
  bRoll.disabled = (m.generation || 1) <= 1 || !(m.counts?.generations);
  bRoll.addEventListener('click', async () => { try { await C.astraRollback((m.generation || 2) - 1); } catch (e) {} });
  acts.append(bTick, bEvolve, bRoll);
  s5.appendChild(acts);
  mindView.appendChild(s5);

  // ⑥ 能力边界（如实标注，不做意识声称）
  const s6 = section('能力边界 · BOUNDARY');
  s6.appendChild(el('div', 'am-boundary', m.boundary || p?.boundary || ''));
  mindView.appendChild(s6);

  mindView.scrollTop = keepScroll;
}

// ---------------- 启动 ----------------
try { C.astraHit(true); } catch (e) { /* 握手失败：主进程看门狗会保持窗口可交互 */ }
try {
  C.astraStatus().then((p) => { if (p) renderAstra(p); }).catch(() => {});
} catch (e) { /* ignore */ }
try {
  C.status().then((s) => {
    if (s && s.scale) syncScale(s.scale);
    if (s && s.astra) renderAstra({ mind: s.astra, event: 'wake' });
    else if (s && !s.hasVault) showThink('尚未接入知识库 · 我先做空闲巡行');
    // v6.20：在线灯原本永远是绿灯「在线」，从未由内核状态驱动。
    const dot = $('spriteStatus');
    if (dot) {
      const online = !!(s && (s.astra || s.ok !== false));
      dot.textContent = online ? '●' : '○';
      dot.title = online ? '已取得本机内核状态' : '内核状态未确认';
    }
  }).catch(() => {
    const dot = $('spriteStatus');
    if (dot) { dot.textContent = '○'; dot.title = '内核状态读取失败'; }
  });
} catch (e) { /* 忽略 */ }

window.addEventListener('beforeunload', () => { try { scene.dispose(); } catch (e) {} });
