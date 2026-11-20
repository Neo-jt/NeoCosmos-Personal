// ================================================================
//  浮动面板系统（v2.2.1）
// ================================================================
//  用户诉求原文：「客户端显示框无法拖动」「这些悬浮框可以最小化」
//  「右下角不要出现显示重叠」。
//
//  这套东西解决三件事：
//  ① 可拖动 —— 面板能拖到任意位置，不必和别的框挤在一起；
//  ② 可最小化 —— 面板能收成一条窄条，把画布让出来；
//  ③ 不重叠 —— 拖动时实时检测与其它浮动面板的碰撞并自动错开；
//     同时记住每个面板的位置，下次打开还在原处。
//
//  设计原则：**不破坏既有 DOM 结构**。面板仍是原来的元素，
//  只是被套进一个"浮动容器"里，由容器负责定位与拖拽。
//  这样视图层代码几乎不用改，行为集中在一处，好维护也好排查。
//
//  位置持久化走 localStorage，键名带面板 id ——
//  多台机器各存各的，互不干扰。
// ================================================================

const STORE_PREFIX = 'neolink-float-';
const Z_BASE = 20;          // 浮动面板的 z 基数（高于普通内容，低于弹窗 200）
const EDGE_PAD = 8;         // 距视口边缘的最小留白

// 记录所有浮动面板，用于碰撞检测
const registry = new Map();

function storeKey(id) { return STORE_PREFIX + id; }

function readState(id) {
  try {
    const raw = localStorage.getItem(storeKey(id));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s.x !== 'number' || typeof s.y !== 'number') return null;
    return s;
  } catch { return null; }
}

function writeState(id, state) {
  try { localStorage.setItem(storeKey(id), JSON.stringify(state)); } catch { /* ignore */ }
}

/**
 * 把位置夹回**作用域容器**内。
 * 换分辨率、缩放后旧坐标可能跑到屏幕外，或者跑到别的视图区域里。
 * scope 是面板的定位基准容器（视图的 host），坐标相对它的左上角。
 */
function clampInto(x, y, w, h, scope) {
  const sw = scope?.clientWidth || window.innerWidth;
  const sh = scope?.clientHeight || window.innerHeight;
  const mw = Math.min(w, sw - EDGE_PAD * 2);
  const mh = Math.min(h, sh - EDGE_PAD * 2);
  return {
    x: Math.max(EDGE_PAD, Math.min(x, sw - mw - EDGE_PAD)),
    y: Math.max(EDGE_PAD, Math.min(y, sh - mh - EDGE_PAD)),
  };
}

/**
 * 检测两个矩形是否重叠。返回 true 表示撞上了。
 * 面板之间默认留 6px 间隙，避免贴在一起看着像重叠。
 */
function overlaps(a, b, gap = 6) {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x
        || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

/**
 * 找一个不与已有面板重叠的位置。
 * 策略：先试用户记住的原位；撞上就按"上下左右"四个方向推开，
 * 逐个候选位置试；全都不行才回到原位（总比叠在一起好）。
 */
function findFreeSpot(id, w, h, preferred, scope) {
  const others = [];
  const sr = scope?.getBoundingClientRect?.();
  for (const [oid, p] of registry) {
    if (oid === id) continue;
    const el = p.el;
    if (!el || !el.isConnected || el.classList.contains('is-minimized')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // 换算到作用域坐标系
    others.push({ x: r.left - (sr?.left || 0), y: r.top - (sr?.top || 0), w: r.width, h: r.height });
  }

  if (preferred) {
    const c = clampInto(preferred.x, preferred.y, w, h, scope);
    const box = { x: c.x, y: c.y, w, h };
    if (!others.some((o) => overlaps(box, o))) return c;
  }

  // 依次尝试：原位右侧、原位左侧、原位下方、原位上方
  const base = preferred ? clampInto(preferred.x, preferred.y, w, h, scope) : { x: EDGE_PAD, y: EDGE_PAD };
  const candidates = [
    { x: base.x + w + 8, y: base.y },
    { x: base.x - w - 8, y: base.y },
    { x: base.x, y: base.y + h + 8 },
    { x: base.x, y: base.y - h - 8 },
  ];
  for (const cand of candidates) {
    const c = clampInto(cand.x, cand.y, w, h, scope);
    const box = { x: c.x, y: c.y, w, h };
    if (!others.some((o) => overlaps(box, o))) return c;
  }
  return base;
}

/**
 * 让一个面板变成可拖动 / 可最小化的浮动面板。
 *
 * @param {HTMLElement} el       面板本体（会被放进一个定位容器里）
 * @param {object} opts
 *   - id:      唯一 id（用于记住位置）
 *   - title:   标题栏显示的文字
 *   - anchor:  'left' | 'right' | 'bottom-right' —— 初始停靠位置
 *   - width:   面板宽度（px）
 *   - dragHandle: 额外的可拖动区域选择器（默认整个标题栏）
 * @returns {object} 控制接口 { minimize, restore, destroy, isMinimized }
 */
export function makeFloatPanel(el, opts = {}) {
  const id = opts.id || ('fp' + Math.random().toString(36).slice(2, 8));
  const title = opts.title || '';
  const width = opts.width || 0;

  // v6.39.0：同一 id 只允许存在一个面板。
  // 旧实现把容器挂进视图 DOM，视图重渲染只清内部 host，不清 registry；
  // 于是切卡片 / 切密度后旧面板 DOM 还在（文档大纲就是两枚"正文大纲"叠在一起）。
  // 这里在建立新面板前先拆掉同 id 的旧面板；restore:false 防止旧内容被塞回正文流。
  const stale = registry.get(id);
  if (stale) { try { stale.destroy({ restore: false }); } catch (e) { /* ignore */ } registry.delete(id); }

  // ---- 1) 建立外层容器 ----
  const host = document.createElement('div');
  host.className = 'float-panel';
  host.dataset.fpid = id;
  host.style.zIndex = String(Z_BASE);

  // ---- 2) 标题栏（拖动把手 + 最小化按钮）----
  const bar = document.createElement('div');
  bar.className = 'fp-bar';
  const grip = document.createElement('span');
  grip.className = 'fp-grip';
  grip.title = '拖动可移动面板';
  const label = document.createElement('span');
  label.className = 'fp-title';
  label.textContent = title;
  const minBtn = document.createElement('button');
  minBtn.className = 'fp-min';
  minBtn.type = 'button';
  minBtn.title = '最小化（收成一条）';
  minBtn.setAttribute('aria-label', '最小化面板');
  minBtn.textContent = '—';
  bar.append(grip, label, minBtn);

  // ---- 3) 组装：容器 = 标题栏 + 面板本体 ----
  el.classList.add('fp-content');
  host.append(bar, el);
  // 原位置（父元素）先记下来，卸载时放回去
  const originParent = el.parentElement;
  const originNext = el.nextSibling;

  // ---- 4) 初始定位 ----
  // 作用域容器：面板相对它定位，而不是相对整个屏幕。
  // 这样面板不会跑到别的视图区域，也不会压到窗口顶栏上。
  const scope = opts.parent || document.body;
  const vw = scope.clientWidth || window.innerWidth;
  const vh = scope.clientHeight || window.innerHeight;
  const w = width || el.offsetWidth || 240;
  const h = el.offsetHeight || 200;
  const anchor = opts.anchor || 'left';
  let home;
  if (anchor === 'right') home = { x: vw - w - 14, y: 14 };
  else if (anchor === 'bottom-right') home = { x: vw - w - 14, y: vh - h - 14 };
  else if (anchor === 'top-center') home = { x: Math.round((vw - w) / 2), y: 14 };
  else home = { x: 14, y: 14 };

  const saved = readState(id);
  const start = findFreeSpot(id, w, h, saved || home, scope);
  host.style.left = `${start.x}px`;
  host.style.top = `${start.y}px`;
  if (width) { host.style.width = `${width}px`; host.classList.add('has-fixed-width'); }

  // ---- 5) 挂载 ----
  // 默认挂到 body —— 但那样面板会**脱离视图的 DOM 子树**，
  // 既会浮到别的视图上面（切走了还在屏幕上），
  // 也会让"只审计当前视图"的检查漏掉面板里的按钮。
  // 因此优先挂到调用方指定的容器（视图的 host）。
  scope.appendChild(host);
  registry.set(id, { el: host, host, scope });

  // ---- 6) 拖动 ----
  let dragging = false, moved = false;
  let sx = 0, sy = 0, ox = 0, oy = 0;

  const onPointerDown = (ev) => {
    // 只允许从标题栏（及其把手）发起拖动
    if (ev.button !== 0) return;
    dragging = true; moved = false;
    sx = ev.clientX; sy = ev.clientY;
    ox = parseFloat(host.style.left) || 0;
    oy = parseFloat(host.style.top) || 0;
    host.classList.add('is-dragging');
    bar.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  };
  const onPointerMove = (ev) => {
    if (!dragging) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;  // 区分"点击"与"拖动"
    moved = true;
    const r = host.getBoundingClientRect();
    const c = clampInto(ox + dx, oy + dy, r.width, r.height, scope);
    host.style.left = `${c.x}px`;
    host.style.top = `${c.y}px`;
  };
  const onPointerUp = (ev) => {
    if (!dragging) return;
    dragging = false;
    host.classList.remove('is-dragging');
    bar.releasePointerCapture?.(ev.pointerId);
    if (moved) {
      // 记住位置，下次还在这儿
      writeState(id, { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 });
      // 拖动之后顺手做一次防重叠检查
      resolveOverlaps(id);
    }
  };
  bar.addEventListener('pointerdown', onPointerDown);
  bar.addEventListener('pointermove', onPointerMove);
  bar.addEventListener('pointerup', onPointerUp);
  bar.addEventListener('pointercancel', onPointerUp);

  // ---- 7) 最小化 / 还原 ----
  let minimized = false;
  function applyMinimized() {
    host.classList.toggle('is-minimized', minimized);
    minBtn.textContent = minimized ? '▢' : '—';
    minBtn.title = minimized ? '还原面板' : '最小化（收成一条）';
    minBtn.setAttribute('aria-label', minimized ? '还原面板' : '最小化面板');
    // 最小化后体积变了，重新夹回视口内
    if (minimized) {
      const r = host.getBoundingClientRect();
      const c = clampInto(parseFloat(host.style.left) || 0, parseFloat(host.style.top) || 0, r.width, r.height, scope);
      host.style.left = `${c.x}px`;
      host.style.top = `${c.y}px`;
    }
  }
  minBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    minimized = !minimized;
    applyMinimized();
  });
  // 双击标题栏也切换最小化 —— 很多人习惯双击标题栏收起
  bar.addEventListener('dblclick', (ev) => {
    if (ev.target === minBtn) return;
    minimized = !minimized;
    applyMinimized();
  });

  // ---- 8) 视口尺寸变化时把面板拉回可见范围 ----
  const onResize = () => {
    const r = host.getBoundingClientRect();
    const c = clampInto(r.left - (scope.getBoundingClientRect?.().left || 0), r.top - (scope.getBoundingClientRect?.().top || 0), r.width, r.height, scope);
    host.style.left = `${c.x}px`;
    host.style.top = `${c.y}px`;
  };
  window.addEventListener('resize', onResize);

  return {
    id,
    host,
    get minimized() { return minimized; },
    minimize() { if (!minimized) { minimized = true; applyMinimized(); } },
    restore() { if (minimized) { minimized = false; applyMinimized(); } },
    toggle() { minimized = !minimized; applyMinimized(); },
    setTitle(t) { label.textContent = t; },
    destroy(opts = {}) {
      window.removeEventListener('resize', onResize);
      bar.removeEventListener('pointerdown', onPointerDown);
      bar.removeEventListener('pointermove', onPointerMove);
      bar.removeEventListener('pointerup', onPointerUp);
      bar.removeEventListener('pointercancel', onPointerUp);
      registry.delete(id);
      // 默认放回原处，避免破坏既有 DOM；replace 场景传 restore:false，
      // 因为旧内容马上会被新内容取代，塞回去只会造成重复正文大纲。
      if (opts.restore !== false && originParent) {
        if (originNext && originNext.parentNode === originParent) originParent.insertBefore(el, originNext);
        else originParent.appendChild(el);
      }
      host.remove();
    },
  };
}

/**
 * 防重叠：若某面板与别的面板重叠，把它沿最小位移方向推开。
 * 触发时机：拖动结束、窗口尺寸变化、面板创建时。
 */
export function resolveOverlaps(excludeId) {
  for (const [id, p] of registry) {
    if (id === excludeId) continue;
    const host = p.host;
    if (!host || !host.isConnected || host.classList.contains('is-minimized')) continue;
    const scope = p.scope || document.body;
    const sr = scope.getBoundingClientRect?.() || { left: 0, top: 0 };
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    for (const [oid, q] of registry) {
      if (oid === id) continue;
      const qh = q.host;
      if (!qh || !qh.isConnected || qh.classList.contains('is-minimized')) continue;
      const qr = qh.getBoundingClientRect();
      if (qr.width < 2 || qr.height < 2) continue;
      // 同一个作用域内才需要错开
      if ((q.scope || document.body) !== scope) continue;
      if (!overlaps({ x: r.left, y: r.top, w: r.width, h: r.height },
                    { x: qr.left, y: qr.top, w: qr.width, h: qr.height }, 0)) continue;
      // 沿垂直方向推开（水平方向推开容易顶出容器）
      const push = (r.bottom > qr.top) ? (qr.bottom - r.top + 8) : -(r.height + 8);
      const nx = r.left - sr.left, ny = (r.top - sr.top) + push;
      const c = clampInto(nx, ny, r.width, r.height, scope);
      host.style.left = `${c.x}px`;
      host.style.top = `${c.y}px`;
      writeState(id, { x: c.x, y: c.y });
      break;
    }
  }
}

/** 清掉所有记住的位置（"恢复默认布局"用）。 */
export function resetFloatPositions() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(STORE_PREFIX)) localStorage.removeItem(key);
  }
}
