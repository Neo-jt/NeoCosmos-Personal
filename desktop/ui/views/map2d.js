// 知识地图 · 个人版专属的二维关联图谱（v3.0 重新架构）
// ---------------------------------------------------------------------------
// 与「星图」（WebGL 3D 星系）是同一份真实数据的两种读法：二者共用 app.graphData()
// 取到的 nodes / edges / domains，绝不另造数据。
// v6.28.0 更正：个人版的主图谱恒为星图（graph.js）。本二维视图作为历史能力保留，
// 源码与路由表均不删，但不再是个人版的默认 / 导航入口（此前理解有误）。
//
// v3.0 相对 v2.0 的关键修复（用户实测"地图无法加载 / 卡在加载中"）：
//   · v2.0 漏声明 domainVisible，renderHud/draw 抛 ReferenceError，且 boot() 外层只有
//     try/finally 没有 catch —— 异常变成未捕获 rejection，状态永远停在"正在装载…"、
//     画面空白。v3.0 声明全部状态，boot() 包真正 try/catch，任何失败都显式显示
//     "加载失败"+ 重试按钮，绝不卡死在 loading。
//   · 数据字段全程防御式取值（domain/title/degree/member_count/aggregate/cross 等都给了
//     保底），避免某字段缺失导致整图不渲染。
//
// 设计（领域疆域地图隐喻）：
//   · 每个领域 = 一块"领地"：半透明填充圆盘 + 同色边界 + 居中的领域名称标注。
//   · 卡片   = 领地内的"聚落"：按领域着色的小圆点，大小随突触度数。
//   · 跨库卡 = 异域标记：青色外环。聚合（总览）节点 = 领地中心的首府，带成员数。
//   · 边     = 聚落之间 / 领地之间的"通路"，按突触类型着色。
// 沿用真实性纪律：画布为实色表面（跟随主题），不透明、不毛玻璃；交互与星图对齐
// （点卡片跳转、突触类型筛选、提问触发激活扩散、领域图例聚焦/切换、总览下钻）。

import { h, toast, status, escapeHtml } from '../ui-kit.js';
import { makeFloatPanel } from '../float-panel.js';
import { domainColorOf } from '../cosmos.js';
// v6.27.0：突触配色 / 主题兜底色统一从共享真源取，与星图 / 关联栏同源。
import { EDGE_COLORS, CANVAS_HEX, SEM } from '../semantic-palette.js';

// 突触类型配色 —— 与星图 / 关联栏保持一致，切换版本形态时颜色语义不割裂。
const TYPE_COLOR = EDGE_COLORS;
const TYPE_LABEL = {
  explicit_link: '显式链接', hierarchical: '层级包含', co_occurrence: '共现',
  semantic_similar: '语义相似', causal: '因果支撑', temporal: '时间邻近',
  question_answer: '问答沉淀', cross_kb: '跨库关联',
};
const ALL_TYPES = Object.keys(TYPE_COLOR);
const FULL_LEVEL_LIMIT = 20000;
// 显示密度档位（与星图同一思路：大库稀疏化，避免糊成一团；小库全画）。
const DENSITY = {
  sparse: { label: '稀疏', maxEdgesPerNode: 3, maxEdges: 2500 },
  standard: { label: '标准', maxEdgesPerNode: 10, maxEdges: 9000 },
  full: { label: '完整', maxEdgesPerNode: 999, maxEdges: 999999 },
};
const MAX_DRAW_EDGES = 45000;

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(150,160,180,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function mountMap2d({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  let disposed = false;
  let rafId = 0;
  let dirty = false;

  // ---- DOM 骨架 ----
  const wrap = h('div', { class: 'map2d' });
  const canvas = h('canvas', { class: 'map-canvas' });
  const tip = h('div', { class: 'map-tip', style: { display: 'none' } });
  const fatalEl = h('div', { class: 'map-fatal', style: { display: 'none' } });
  wrap.append(canvas, tip, fatalEl);
  host.appendChild(wrap);
  const ctx = canvas.getContext('2d');

  // 三个浮动面板（可拖动 / 可最小化），与星图同源结构。
  const hud = h('div', { class: 'map-hud' });
  const cardBox = h('div', { class: 'map-card' });
  const plateEl = h('div', { class: 'cosmos-kb' });
  const floaters = [
    makeFloatPanel(hud, { id: 'map-hud', title: '视图与筛选', anchor: 'left', width: 244, parent: wrap }),
    makeFloatPanel(cardBox, { id: 'map-card', title: '卡片详情', anchor: 'right', width: 286, parent: wrap }),
    makeFloatPanel(plateEl, { id: 'map-plate', title: '当前知识库', anchor: 'bottom-right', width: 0, parent: wrap }),
  ];

  // ---- 状态（全部显式声明，杜绝 v2.0 的 ReferenceError）----
  let rawGraph = null;
  let nodeIdSet = new Set();
  let nodes = [];               // 布局后带 x/y 的节点
  let edges = [];               // 绘制用的边（含类型 / 权重）
  let domains = [];             // 领域列表
  let domainColors = {};        // domain -> color
  let domainGroups = new Map(); // domain -> { members, cx, cy, discR }
  let adj = new Map();          // id -> [neighborId...]
  let topLabelIds = new Set();  // 全局度数最高的若干节点（用于默认标注）
  let activeTypes = new Set(ALL_TYPES);
  let density = 'standard';
  let level = 'auto';           // auto | overview | full | region
  let drillDomain = null;       // region 下钻时的领域
  let levelInfo = null;
  let meta = null;
  let selected = null;
  let hovered = null;
  let focusDomain = null;       // 聚焦的领域
  let highlight = null;         // 激活扩散命中集合 Set<id>
  let diffuseQuery = '';
  let lastMouse = { x: 0, y: 0, over: false };
  let loadError = null;         // 任何装载异常都会写到这里，绝不卡在 loading
  const domainVisible = new Map(); // domain -> false 表示隐藏

  // 视图变换：screen = world * scale + pan
  const view = { scale: 1, panX: 0, panY: 0, minScale: 0.03, maxScale: 8 };

  const _byId = new Map();
  function nodeById(id) { return _byId.get(id); }
  function syncIndex() { _byId.clear(); for (const n of nodes) _byId.set(n.id, n); }
  function domainVisibleOff(d) { return domainVisible.get(d) === false; }

  // ====== 数据装载 ======
  let booting = false, bootAgain = false, bootTimer = null;
  function scheduleBoot(delay = 120) {
    if (disposed) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(() => { bootTimer = null; boot(); }, delay);
  }
  const offVault = app.on && app.on((kind) => {
    if (kind !== 'vault' || disposed) return;
    scheduleBoot(120);
  });

  async function boot() {
    if (disposed) return;
    if (booting) { bootAgain = true; return; }
    booting = true;
    try { await doBoot(); }
    catch (e) {
      // v3.0：真正捕获异常 —— 显示失败 + 重试，绝不卡在"正在装载…"
      loadError = String(e?.message || e || '未知错误');
      console.error('[map2d] 装载失败:', e);
      status('知识地图加载失败');
      toast('知识地图加载失败：' + loadError, 'err', 6000);
      showFatal(loadError);
    }
    finally {
      booting = false;
      if (bootAgain && !disposed) { bootAgain = false; scheduleBoot(0); }
    }
  }

  async function doBoot() {
    loadError = null;
    fatalEl.style.display = 'none';
    status('正在装载知识地图…');
    const total = (app.vault && app.vault.nodes) || 0;
    // 自动层级：大库或显式标记走总览（聚合），否则全量
    if (level === 'auto') {
      level = (total > FULL_LEVEL_LIMIT || (app.vault && app.vault.scale && app.vault.scale.default_level === 'overview')) ? 'overview' : 'full';
    }
    const opts = level === 'overview' ? { level: 'overview' }
      : level === 'region' ? { level: 'region', domain: drillDomain }
        : {};
    let g;
    try {
      g = await app.graphData(true, opts);
    } catch (e) {
      throw e; // 交给 boot 的 catch 统一处理
    }
    if (disposed) return;
    rawGraph = g || {};
    levelInfo = rawGraph.levelInfo || { level };
    // 领域列表：优先用载荷里的 domains 数组，缺失则回退到从节点推导
    const derived = [...new Set((rawGraph.nodes || []).map((n) => (n && (n.domain || '未分类'))))].sort();
    domains = Array.isArray(rawGraph.domains) && rawGraph.domains.length ? rawGraph.domains.slice() : derived;
    domainColors = domainColorOf(domains);
    try {
      buildNodes();
      buildEdges();
      layout();          // 每次重载都重新布局（确定性，稳定）
      fitView();
      renderHud();
      renderCard(null);
      attachPlate();
      syncStatus();
      requestDraw();
    } catch (e) {
      throw e; // 构建/布局/渲染任何一步出错都显式暴露，不静默卡死
    }
  }

  // 构建节点（防御式取值，字段缺失一律保底）
  function buildNodes() {
    const src = Array.isArray(rawGraph.nodes) ? rawGraph.nodes.slice() : [];
    const posCache = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    nodeIdSet = new Set(src.map((n) => n && n.id).filter(Boolean));
    nodes = src.map((n) => {
      const id = n && n.id;
      const p = posCache.get(id);
      const deg = Number((n && (n.degree != null ? n.degree : n.member_count != null ? n.member_count : n.weight)) || 0) || 0;
      const cross = (n && n.cross) || (n && n.memory_layer === 'cross' ? { vault_id: n.vault_id, vault_name: n.vault_name, vault_color: n.vault_color, path: n.path } : null);
      return {
        id,
        title: (n && (n.title || n.name)) || (id || '未命名'),
        domain: (n && n.domain) || '未分类',
        degree: deg,
        path: (n && n.path) || '',
        cross: cross || null,
        aggregate: !!(n && n.aggregate),
        memberCount: Number((n && n.member_count) || 0) || 0,
        x: p ? p.x : 0,
        y: p ? p.y : 0,
      };
    });
    syncIndex();
    // 预选全局度数最高的节点用于默认标注（避免大库标签糊成一片）
    const sorted = nodes.slice().sort((a, b) => b.degree - a.degree);
    const cap = Math.min(140, sorted.length);
    topLabelIds = new Set(sorted.slice(0, cap).map((n) => n.id));
  }

  // 构建边：两端都在图中、去重、按权重稀疏化（与星图同策略）
  function buildEdges() {
    const raw = Array.isArray(rawGraph.edges) ? rawGraph.edges.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0)) : [];
    const perNode = DENSITY[density].maxEdgesPerNode;
    const maxEdges = Math.max(DENSITY[density].maxEdges, raw.length);
    adj = new Map(nodes.map((n) => [n.id, []]));
    const seen = new Set();
    const kept = [];
    const deg = new Map();
    for (const e of raw) {
      if (kept.length >= maxEdges) break;
      const a = e && e.source, b = e && e.target;
      if (!a || !b || !nodeIdSet.has(a) || !nodeIdSet.has(b) || a === b) continue;
      const key = a < b ? a + '|' + b : b + '|' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ source: a, target: b, type: (e && e.type) || 'explicit_link', weight: Number((e && e.weight) || 1) || 1 });
      const ea = adj.get(a); if (ea) ea.push(b);
      const eb = adj.get(b); if (eb) eb.push(a);
      deg.set(a, (deg.get(a) || 0) + 1);
      deg.set(b, (deg.get(b) || 0) + 1);
    }
    edges = kept.slice(0, MAX_DRAW_EDGES);
    for (const n of nodes) n.degree = Math.max(n.degree, deg.get(n.id) || 0);
    meta = rawGraph.meta || {};
  }

  // ====== 布局：领域疆域地图 ======
  // 每个领域一个「领地中心」沿大圆排布；领地内卡片用黄金角螺旋打底，小簇再跑少量斥力
  // 松弛得到更有机的分布；相邻领地自然通过跨域边相连。聚合（overview）节点每域一个，落中心。
  function layout() {
    const groups = new Map();
    for (const n of nodes) {
      if (!groups.has(n.domain)) groups.set(n.domain, []);
      groups.get(n.domain).push(n);
    }
    const doms = [...groups.keys()];
    const nDom = doms.length || 1;
    const maxCnt = Math.max(1, ...doms.map((d) => groups.get(d).length));
    const ringR = 480 + Math.sqrt(maxCnt) * 22 + nDom * 12;
    doms.forEach((d, i) => {
      const ang = (i / nDom) * Math.PI * 2 - Math.PI / 2;
      const cx = Math.cos(ang) * ringR;
      const cy = Math.sin(ang) * ringR;
      const members = groups.get(d);
      if (members.length === 1) {
        const m = members[0];
        if (!isFinite(m.x) || !isFinite(m.y)) { m.x = cx; m.y = cy; }
        groups.set(d, { members, cx, cy, discR: 36 });
        return;
      }
      const discR = 70 + Math.sqrt(members.length) * 20;
      const GA = Math.PI * (3 - Math.sqrt(5));
      members.forEach((n, k) => {
        const r = discR * Math.sqrt((k + 0.5) / members.length);
        const a = k * GA;
        n.x = cx + Math.cos(a) * r;
        n.y = cy + Math.sin(a) * r;
      });
      // 小簇斥力松弛（仅簇内，O(k^2) 可控）；大簇用螺旋已足够清晰，跳过松弛省算力
      const lim = members.length <= 2000 ? 22 : 6;
      for (let it = 0; it < lim; it++) {
        for (let a = 0; a < members.length; a++) {
          const na = members[a];
          let fx = 0, fy = 0;
          for (let b = 0; b < members.length; b++) {
            if (a === b) continue;
            const nb = members[b];
            let dx = na.x - nb.x, dy = na.y - nb.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { d2 = 1; dx = (a - b) * 0.3 + 0.1; dy = (b - a) * 0.3; }
            const rep = 1500 / d2;
            fx += (dx / Math.sqrt(d2)) * rep;
            fy += (dy / Math.sqrt(d2)) * rep;
          }
          fx += (cx - na.x) * 0.01;
          fy += (cy - na.y) * 0.01;
          na.x += Math.max(-16, Math.min(16, fx * 0.02));
          na.y += Math.max(-16, Math.min(16, fy * 0.02));
        }
      }
      groups.set(d, { members, cx, cy, discR });
    });
    domainGroups = groups;
  }

  // ====== 坐标变换 ======
  function toScreen(wx, wy) {
    return { x: wx * view.scale + view.panX, y: wy * view.scale + view.panY };
  }
  function toWorld(sx, sy) {
    return { x: (sx - view.panX) / view.scale, y: (sy - view.panY) / view.scale };
  }
  function fitView() {
    if (!nodes.length) { view.scale = 1; view.panX = 0; view.panY = 0; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (!isFinite(n.x) || !isFinite(n.y)) continue;
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    if (!isFinite(minX)) { view.scale = 1; view.panX = 0; view.panY = 0; return; }
    const w = canvas.clientWidth || wrap.clientWidth || 800;
    const hgt = canvas.clientHeight || wrap.clientHeight || 600;
    const pad = 70;
    const sx = (w - pad * 2) / Math.max(1, maxX - minX);
    const sy = (hgt - pad * 2) / Math.max(1, maxY - minY);
    view.scale = Math.max(view.minScale, Math.min(view.maxScale, Math.min(sx, sy)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    view.panX = w / 2 - cx * view.scale;
    view.panY = hgt / 2 - cy * view.scale;
  }

  // ====== 绘制 ======
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || host.clientWidth || 800;
    const hgt = wrap.clientHeight || host.clientHeight || 600;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(hgt * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = hgt + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function requestDraw() {
    dirty = true;
    if (!rafId) rafId = requestAnimationFrame(draw);
  }
  function draw() {
    rafId = 0;
    dirty = false;
    if (disposed) return;
    const w = canvas.clientWidth || wrap.clientWidth || 800;
    const hgt = canvas.clientHeight || wrap.clientHeight || 600;
    const cs = getComputedStyle(document.body);
    const bg = (cs.getPropertyValue('--surface-1').trim() || cs.getPropertyValue('--canvas').trim() || CANVAS_HEX.themeCanvas);
    const accent = (cs.getPropertyValue('--accent').trim() || CANVAS_HEX.themeAccent);
    const text = (cs.getPropertyValue('--text').trim() || CANVAS_HEX.themeText);
    const muted = (cs.getPropertyValue('--muted').trim() || CANVAS_HEX.themeMuted);
    const line = (cs.getPropertyValue('--line').trim() || 'rgba(255,255,255,.14)');
    // 实色表面（跟随主题，绝不透明）
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, hgt);

    if (loadError) return; // 失败态由 DOM 覆盖层展示，画布只清底色

    if (!nodes.length) {
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rawGraph ? '本知识库暂无卡片或图谱为空' : '正在装载知识地图…', w / 2, hgt / 2);
      ctx.textAlign = 'left';
      return;
    }

    const dim = highlight != null;
    const showCardLabels = view.scale > 0.55;
    const showRegionLabels = view.scale < 1.05;

    // 1) 领地圆盘（领域疆域地图的核心视觉）
    for (const [d, g] of domainGroups) {
      if (domainVisibleOff(d)) continue;
      const col = domainColors[d] || muted;
      const R = g.discR + 44;
      const foc = focusDomain === d;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, R, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(col, foc ? 0.10 : 0.05);
      ctx.fill();
      ctx.lineWidth = foc ? 2 : 1;
      ctx.strokeStyle = hexToRgba(col, foc ? 0.85 : 0.4);
      ctx.stroke();
      // 领地名称标注（map 风格：圆盘上方一行标签）
      if (showRegionLabels) {
        const label = d;
        ctx.font = '600 12px system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = g.cx, ly = g.cy - R - 10;
        ctx.fillStyle = hexToRgba(bg, 0.8);
        ctx.fillRect(lx - tw / 2 - 6, ly - 9, tw + 12, 18);
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx, ly);
        ctx.textAlign = 'left';
      }
    }

    // 2) 边（通路）
    ctx.lineWidth = 1;
    for (const e of edges) {
      const a = nodeById(e.source), b = nodeById(e.target);
      if (!a || !b) continue;
      if (focusDomain && a.domain !== focusDomain && b.domain !== focusDomain) continue;
      if (domainVisibleOff(a.domain) || domainVisibleOff(b.domain)) continue;
      if (!activeTypes.has(e.type)) continue;
      const pa = toScreen(a.x, a.y), pb = toScreen(b.x, b.y);
      const hot = !dim || (highlight.has(e.source) && highlight.has(e.target));
      if (!hot) { ctx.globalAlpha = 0.04; ctx.strokeStyle = muted; ctx.lineWidth = 1; }
      else if (dim) { ctx.globalAlpha = 0.85; ctx.strokeStyle = accent; ctx.lineWidth = 1.5; }
      else { ctx.globalAlpha = 0.18; ctx.strokeStyle = TYPE_COLOR[e.type] || muted; ctx.lineWidth = 1; }
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;

    // 3) 节点（聚落）
    for (const n of nodes) {
      if (focusDomain && n.domain !== focusDomain) continue;
      if (domainVisibleOff(n.domain)) continue;
      const p = toScreen(n.x, n.y);
      if (!isFinite(p.x) || !isFinite(p.y)) continue;
      const r = nodeRadius(n) * Math.min(1.7, Math.max(0.7, view.scale));
      const on = !dim || highlight.has(n.id);
      const col = domainColors[n.domain] || muted;
      ctx.globalAlpha = on ? 1 : 0.14;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (n.cross) { // 跨库幽灵节点：外圈青环标记
        ctx.globalAlpha = on ? 1 : 0.3;
        ctx.lineWidth = 1.5; ctx.strokeStyle = TYPE_COLOR.cross_kb; ctx.stroke();
      }
      if (n === selected || n === hovered) {
        ctx.lineWidth = 2; ctx.strokeStyle = accent; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const labelOn = showCardLabels && (topLabelIds.has(n.id) || n.aggregate || n === hovered || n === selected || (dim && highlight.has(n.id)));
      if (labelOn) {
        ctx.font = (n.aggregate ? '600 ' : '') + '11px system-ui, sans-serif';
        ctx.fillStyle = text;
        ctx.textBaseline = 'middle';
        const label = n.aggregate ? (n.title + ' · ' + n.memberCount) : truncate(n.title, 18);
        ctx.fillText(label, p.x + r + 3, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function nodeRadius(n) {
    if (n.aggregate) return Math.max(8, Math.min(26, 8 + Math.sqrt(n.memberCount) * 1.1));
    return Math.max(2.4, Math.min(13, 2.4 + Math.sqrt(n.degree) * 0.9));
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // ====== 交互 ======
  let dragging = false, dragMoved = false, last = { x: 0, y: 0 };
  canvas.addEventListener('mousedown', (e) => {
    dragging = true; dragMoved = false; last.x = e.clientX; last.y = e.clientY;
  });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  function onMove(e) {
    lastMouse.x = e.clientX - wrap.getBoundingClientRect().left;
    lastMouse.y = e.clientY - wrap.getBoundingClientRect().top;
    if (dragging) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      view.panX += dx; view.panY += dy;
      last.x = e.clientX; last.y = e.clientY;
      requestDraw();
      hideTip();
      return;
    }
    const hit = hitTest(lastMouse.x, lastMouse.y);
    if (hit !== hovered) { hovered = hit; requestDraw(); }
    if (hit) showTip(hit, e.clientX, e.clientY); else hideTip();
  }
  function onUp(e) {
    if (dragging && !dragMoved) {
      const rect = wrap.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit) select(hit);
    }
    dragging = false;
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const before = toWorld(mx, my);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.scale = Math.max(view.minScale, Math.min(view.maxScale, view.scale * factor));
    const after = toWorld(mx, my);
    view.panX += (after.x - before.x) * view.scale;
    view.panY += (after.y - before.y) * view.scale;
    requestDraw();
  }, { passive: false });
  // 双击聚合节点下钻到该领域
  canvas.addEventListener('dblclick', (e) => {
    const rect = wrap.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit && hit.aggregate) drillTo(hit.domain);
  });

  function hitTest(sx, sy) {
    const w = toWorld(sx, sy);
    let best = null, bestD = 14 / Math.max(view.scale, 0.0001);
    for (const n of nodes) {
      if (focusDomain && n.domain !== focusDomain) continue;
      if (domainVisibleOff(n.domain)) continue;
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      const r = Math.max(4, nodeRadius(n));
      if (d < r + bestD) { best = n; bestD = d; }
    }
    return best;
  }
  function showTip(n, cx, cy) {
    tip.style.display = 'block';
    tip.style.left = (cx - wrap.getBoundingClientRect().left + 14) + 'px';
    tip.style.top = (cy - wrap.getBoundingClientRect().top + 14) + 'px';
    const sub = n.aggregate ? ('领域聚合 · ' + n.memberCount + ' 张卡片')
      : (n.cross ? '其他知识库卡片' : ('领域 ' + n.domain + ' · ' + n.degree + ' 条突触'));
    tip.innerHTML = '<b>' + escapeHtml(n.title) + '</b><br><span class="muted">' + escapeHtml(sub) + '</span>';
  }
  function hideTip() { tip.style.display = 'none'; }

  function select(n) {
    selected = n;
    renderCard(n);
    requestDraw();
  }

  // ====== HUD：筛选 / 层级 / 扩散 / 图例 ======
  function renderHud() {
    hud.innerHTML = '';
    const v = vaultInfo();
    const domainCount = domains.length || new Set(nodes.map((n) => n.domain)).size;

    // ① 当前知识库卡片
    hud.appendChild(h('div', { class: 'kb-card' },
      h('div', { class: 'kb-kicker' }, '当前知识库'),
      h('div', { class: 'kb-name' }, h('span', { class: 'kb-dot', style: { background: v.color, boxShadow: '0 0 8px ' + v.color } }), h('span', null, v.name)),
      h('div', { class: 'kb-path', title: v.path }, v.path || '—'),
      h('div', { class: 'kb-stats' },
        h('span', null, h('b', null, String(v.nodes)), ' 卡片'),
        h('span', null, h('b', null, String(v.edges)), ' 突触'),
        h('span', null, h('b', null, String(domainCount)), ' 领域'),
      ),
    ));

    // ② 视图层级
    hud.appendChild(h('div', { class: 'hud-title' }, '视图层级'));
    hud.appendChild(h('div', { class: 'view-modes' },
      h('button', { class: 'vm-btn' + (level === 'overview' ? ' is-on' : ''), onclick: () => setLevel('overview') }, '总览'),
      h('button', { class: 'vm-btn' + (level === 'full' ? ' is-on' : ''), onclick: () => setLevel('full') }, '全量'),
    ));
    const li = levelInfo || {};
    const lvNote = level === 'overview' ? '总览（按领域聚合）'
      : level === 'region' ? ('领域 · ' + (drillDomain || ''))
        : '全量';
    hud.appendChild(h('div', { class: 'level-note' }, h('span', null, '当前：' + lvNote)));
    if (level !== 'overview') {
      hud.appendChild(h('div', { class: 'hud-acts' },
        h('button', { class: 'btn ghost', onclick: () => setLevel('overview') }, '返回总览'),
      ));
    }

    // ③ 显示密度
    hud.appendChild(h('div', { class: 'hud-title' }, '显示密度'));
    hud.appendChild(h('div', { class: 'view-modes' },
      ...Object.entries(DENSITY).map(([k, d]) =>
        h('button', { class: 'vm-btn' + (density === k ? ' is-on' : ''), onclick: () => { density = k; rebuildEdges(); requestDraw(); } }, d.label)),
    ));

    // ④ 突触类型筛选
    hud.appendChild(h('div', { class: 'hud-title' }, '突触类型（点击筛选）'));
    const grid = h('div', { class: 'type-grid' });
    for (const t of ALL_TYPES) {
      const count = edgeTypeCount(t);
      if (!count) continue;
      const on = activeTypes.has(t);
      grid.appendChild(h('button', {
        class: 'type-chip' + (on ? ' is-on' : ''),
        style: { '--c': TYPE_COLOR[t] },
        onclick: () => { if (on) activeTypes.delete(t); else activeTypes.add(t); renderHud(); requestDraw(); },
      }, TYPE_LABEL[t]));
    }
    hud.appendChild(grid);

    // ⑤ 激活扩散（提问点亮联想）
    hud.appendChild(h('div', { class: 'hud-title' }, '激活扩散 · 输入问题点亮联想路径'));
    const box = h('div', { class: 'diffuse-box' });
    const input = h('input', { class: 'diffuse-input', type: 'text', placeholder: '问知识库一个问题…', value: diffuseQuery });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') activate(input.value); });
    const btn = h('button', { class: 'diffuse-go', onclick: () => activate(input.value) }, '点亮');
    const clear = h('button', { class: 'diffuse-clear', title: '清除高亮', onclick: () => { highlight = null; diffuseQuery = ''; renderHud(); requestDraw(); } }, '清除');
    box.append(input, btn, clear);
    hud.appendChild(box);

    // ⑥ 领域图例（点击聚焦该簇，双击切换显隐）
    hud.appendChild(h('div', { class: 'hud-title' }, '领域图例（点击聚焦该簇）'));
    const legWrap = h('div', { class: 'map-legend' });
    const sorted = domains.slice().sort((a, b) => (nodeCountOf(b) - nodeCountOf(a)));
    for (const d of sorted) {
      const col = domainColors[d] || CANVAS_HEX.themeMuted;
      const vis = domainVisible.get(d) !== false;
      legWrap.appendChild(h('button', {
        class: 'leg-row' + (focusDomain === d ? ' is-focus' : '') + (vis ? '' : ' is-off'),
        onclick: () => {
          if (focusDomain === d) { focusDomain = null; }
          else { focusDomain = d; focusDomainTo(d); }
          renderHud(); requestDraw();
        },
        ondblclick: () => { domainVisible.set(d, !vis); renderHud(); requestDraw(); },
        title: '单击聚焦该领域簇 · 双击切换显隐',
      },
        h('span', { class: 'leg-dot', style: { background: col } }),
        h('span', { class: 'leg-name' }, truncate(d, 14)),
        h('span', { class: 'leg-cnt' }, String(nodeCountOf(d))),
      ));
    }
    hud.appendChild(legWrap);
  }
  function nodeCountOf(d) { let c = 0; for (const n of nodes) if (n.domain === d) c++; return c; }
  function edgeTypeCount(t) {
    let c = 0;
    for (const e of (rawGraph && rawGraph.edges) || []) if (e && e.type === t) c++;
    return c;
  }

  function rebuildEdges() { buildEdges(); }

  function setLevel(next) {
    const total = (app.vault && app.vault.nodes) || 0;
    if (next === 'full' && total > FULL_LEVEL_LIMIT) {
      toast('本库 ' + total.toLocaleString('en-US') + ' 张卡片，超出全量上限（' + FULL_LEVEL_LIMIT.toLocaleString('en-US') + '）。请用「总览」按领域下钻。', 'err', 6000);
      return;
    }
    status('正在切换视图层级…');
    level = next;
    drillDomain = null;
    boot();
  }

  async function activate(q) {
    q = String(q || '').trim();
    if (!q) { toast('先输入一个要扩散的问题', 'err'); return; }
    diffuseQuery = q;
    status('激活扩散中…');
    try {
      const res = await api.search({ query: q, top_k: 24, hops: 2 });
      const hits = (res && res.data && res.data.results) || [];
      if (!hits.length) { toast('没有沿突触联想到的卡片', 'err'); return; }
      const ids = new Set(hits.map((x) => x.id).filter(Boolean));
      const top = hits[0];
      if (top && top.id && api.doc && api.doc.relations) {
        try {
          const rel = await api.doc.relations(top.id, { contextLimit: 0 });
          for (const g of Object.values((rel && rel.data && rel.data.groups) || {})) for (const it of (g || [])) if (it.id) ids.add(it.id);
        } catch (_) { /* 关联取数失败不阻断扩散 */ }
      }
      if (!ids.size) { toast('没有可点亮的卡片', 'warn', 2600); return; }
      highlight = ids;
      // 聚焦到命中里度数最高的卡片
      let center = null, best = -1;
      for (const n of nodes) if (ids.has(n.id) && n.degree > best) { best = n.degree; center = n; }
      if (center && center.x && isFinite(center.x)) {
        view.scale = Math.max(view.scale, 1.2);
        view.panX = (wrap.clientWidth || 800) / 2 - center.x * view.scale;
        view.panY = (wrap.clientHeight || 600) / 2 - center.y * view.scale;
      }
      syncStatus();
      requestDraw();
      renderCard(null, hits.slice(0, 12), q);
    } catch (e) {
      toast('激活扩散失败：' + String(e && e.message || e), 'err', 5000);
    }
  }

  function focusDomainTo(d) {
    const members = nodes.filter((n) => n.domain === d);
    if (!members.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of members) { if (!isFinite(n.x)) continue; minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); }
    const w = wrap.clientWidth || 800, hgt = wrap.clientHeight || 600, pad = 80;
    const sx = (w - pad * 2) / Math.max(1, maxX - minX), sy = (hgt - pad * 2) / Math.max(1, maxY - minY);
    view.scale = Math.max(view.minScale, Math.min(view.maxScale, Math.min(sx, sy)));
    view.panX = w / 2 - ((minX + maxX) / 2) * view.scale;
    view.panY = hgt / 2 - ((minY + maxY) / 2) * view.scale;
  }

  // ====== 卡片详情 ======
  function renderCard(n, diffHits, diffQuery) {
    cardBox.innerHTML = '';
    if (diffHits) {
      cardBox.appendChild(h('div', { class: 'gc-title' }, '激活扩散结果'));
      cardBox.appendChild(h('div', { class: 'gc-path' }, '查询：' + (diffQuery || '')));
      for (const hit of diffHits) {
        cardBox.appendChild(h('div', { class: 'gc-rel' },
          h('div', { class: 'rl', onclick: () => { app.openCard(hit.id); route('workspace'); } },
            h('span', { style: { color: 'var(--cyan)' } }, '◆'),
            h('span', { style: { flex: '1' } }, hit.title || '未命名'),
            h('span', { style: { color: 'var(--dim)' } }, hit.confidence == null ? '—' : (Math.round(hit.confidence * 100) + '%')),
          ),
        ));
      }
      return;
    }
    if (!n) {
      cardBox.appendChild(h('div', { class: 'empty-hint' }, '点击地图上的卡片查看详情并跳转文档。左侧可按突触类型筛选，提问可点亮联想路径。'));
      return;
    }
    if (n.aggregate) {
      cardBox.appendChild(h('div', { class: 'gc-title' }, n.title));
      cardBox.appendChild(h('div', { class: 'gc-path' }, '领域聚合球 · ' + n.memberCount + ' 张卡片'));
      cardBox.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--dim)', lineHeight: '1.75' } }, '总览视图里每一个球是一个领域。下钻后可以看到该领域里每一张卡片，以及它们之间的突触。'));
      cardBox.appendChild(h('div', { class: 'gc-acts' },
        h('button', { class: 'btn', onclick: () => drillTo(n.domain) }, '下钻到该领域'),
      ));
      return;
    }
    if (n.cross) {
      cardBox.appendChild(h('div', { class: 'gc-title' }, n.title || '未命名'));
      cardBox.appendChild(h('div', { class: 'gc-path' }, n.path || ''));
      if (n.cross) {
        cardBox.appendChild(h('div', { class: 'gc-kb', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: 'var(--muted)', border: '1px solid ' + (n.cross.vault_color || SEM.crossKb), borderRadius: '999px', padding: '2px 9px', marginBottom: '8px' } },
          h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: n.cross.vault_color || SEM.crossKb, display: 'inline-block' } }),
          n.cross.vault_name || '其他知识库'));
      }
      cardBox.appendChild(h('div', { style: { fontSize: '11px', color: 'var(--dim)', lineHeight: '1.7' } }, '这是另一个知识库里的卡片，通过跨库突触连到当前网络。'));
      cardBox.appendChild(h('div', { class: 'gc-acts' },
        h('button', { class: 'btn', onclick: async () => {
          const r = await api.crosskb.open({ vaultId: n.cross && n.cross.vault_id, path: n.path });
          if (r && r.ok) { await app.refreshVault(); app.history = []; app.hIndex = -1; app.currentId = null; if (r.openId) await app.openCard(r.openId); route('workspace'); toast('已切换到「' + (r.vault && r.vault.name) + '」', 'ok'); }
          else toast((r && r.error) || '跳转失败', 'err');
        } }, '切库打开'),
      ));
      return;
    }
    cardBox.appendChild(h('div', { class: 'card-title' }, truncate(n.title, 40)));
    cardBox.appendChild(h('div', { class: 'card-meta' }, '领域 ' + n.domain + ' · ' + n.degree + ' 条突触'));
    if (n.path) cardBox.appendChild(h('div', { class: 'card-path', title: n.path }, n.path));
    const bar = h('div', { class: 'card-actions' });
    bar.appendChild(h('button', { class: 'btn-primary', onclick: () => { if (n.id) app.openCard && app.openCard(n.id); } }, '打开文档'));
    bar.appendChild(h('button', { class: 'btn-ghost', onclick: () => { highlight = new Set([n.id, ...(adj.get(n.id) || [])]); requestDraw(); } }, '点亮邻域'));
    cardBox.appendChild(bar);
  }

  function drillTo(domain) {
    level = 'region'; drillDomain = domain; boot();
  }

  // ====== 库铭牌（右下角） ======
  function vaultInfo() {
    const v = app.vault || {};
    return {
      id: v.id || null, name: v.name || '未命名知识库', color: v.color || EDGE_COLORS.explicit_link,
      path: v.path || '', nodes: v.nodes != null ? v.nodes : 0, edges: v.edges != null ? v.edges : 0, cross_links: v.cross_links != null ? v.cross_links : 0,
    };
  }
  function attachPlate() {
    const v = vaultInfo();
    plateEl.innerHTML = '';
    plateEl.classList.toggle('is-empty', !v.id);
    const name = h('div', { class: 'kb-name' }, v.id ? v.name : '未打开知识库');
    const meta = h('div', { class: 'kb-meta' }, v.id ? (v.nodes + ' 张卡片 · ' + v.edges + ' 条突触 · ' + domains.length + ' 个领域') : '');
    plateEl.append(name, meta);
    const dot = h('span', { class: 'kb-dot', style: { background: v.color, boxShadow: '0 0 8px ' + v.color } });
    name.prepend(dot);
  }

  function syncStatus() {
    if (!rawGraph) return;
    const shownN = nodes.length;
    const totalN = (app.vault && app.vault.nodes) || shownN;
    const shownE = edges.length;
    const totalE = (rawGraph.edges && rawGraph.edges.length) || shownE;
    const nodePart = shownN === totalN ? (shownN + ' 张卡片') : (shownN + ' / ' + totalN + ' 张卡片');
    const edgePart = shownE === totalE ? (shownE + ' 条突触') : (shownE + ' / ' + totalE + ' 条突触');
    const lvLabel = level === 'overview' ? '总览' : (level === 'region' ? '领域' : '全量');
    status('知识地图就绪 · ' + nodePart + ' · ' + edgePart + ' · ' + lvLabel + '视图' + (highlight ? ' · 激活扩散已点亮' : ''));
  }

  // ====== 致命错误覆盖层（绝不卡在 loading）======
  function showFatal(msg) {
    fatalEl.innerHTML = '';
    fatalEl.appendChild(h('div', { class: 'map-fatal-box' },
      h('div', { class: 'map-fatal-title' }, '⚠ 知识地图加载失败'),
      h('div', { class: 'map-fatal-msg' }, String(msg || '未知错误')),
      h('button', { class: 'btn', onclick: () => { fatalEl.style.display = 'none'; boot(); } }, '重试'),
    ));
    fatalEl.style.display = 'flex';
  }

  // ====== 尺寸 / 启动 ======
  const ro = new ResizeObserver(() => { resizeCanvas(); requestDraw(); });
  ro.observe(wrap);
  resizeCanvas();
  // 首帧前再校正一次尺寸（避免宿主刚激活时 clientWidth 还为 0）
  requestAnimationFrame(() => { resizeCanvas(); requestDraw(); });
  syncIndex();
  boot();

  return {
    unmount() {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(bootTimer);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      ro.disconnect();
      if (offVault && typeof offVault === 'function') try { offVault(); } catch (_) { /* ignore */ }
      for (const f of floaters) try { if (f && f.destroy) f.destroy(); else if (f && f.dispose) f.dispose(); } catch (_) { /* ignore */ }
      host.innerHTML = '';
    },
  };
}
