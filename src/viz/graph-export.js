// 数据导出契约（For UI）：确保 props 变化 <100ms 内反映到界面
// 桌面端 / Web 原型 / CLI 共用同一份"图导出 + 3D 布局"实现（单同源纪律）。
//
// 契约：
//   exportGraphPayload(store, opts) -> { nodes, edges, edgeTypeLabels, domains, stats, generatedAt }
//   nodes: { id, neokb_id, title, path, domain, tags, memory_layer, degree, weight_sum, pos:[x,y,z], cluster }
//   edges: { id, src, dst, type, type_label, weight, origin, confirmed, bidirectional, reason }
//
// v1.1.0 增补：跨库关联以"幽灵节点 + cross_kb 边"进入图。
//   幽灵节点 = 其他知识库里的那张卡片（memory_layer='cross'，cluster='cross:<库名>'），
//   被钉在外层球壳上，与本地卡片以 cross_kb 边相连；可点击跳转（切库打开）。
//
// v2.1.0 规模扩展：分级载荷（LOD）
//   过去 exportGraphPayload 永远导出"全量节点 + 全量边"。10 万卡片时，IPC 结构化克隆
//   一次就是几百 MB，渲染层还要再稀疏化一遍——这是 1M 规模的第一道硬墙。
//   现在导出层提供四级载荷，渲染层**永远只拿到几千个对象**：
//     full     全量（≤ FULL_NODE_LIMIT 时默认）
//     overview 总览（按领域聚合成超节点，节点 ≤ 1200）—— 大库的默认视图
//     region   领域下钻（某一领域的完整子图，节点 ≤ 6000）
//     focus    焦点（某节点的 k 跳邻域，节点 ≤ 1200）
//   布局同样分级：全量力导向只在小子图上跑，超大库走 O(n) 的簇级布局。
//
// 全部计算本机完成，不联网、不外传（数据严格本地化红线）。

import { EDGE_TYPES, currentWeight } from '../engine/edges.js';
import { fnv1a64 } from '../storage/store.js';

// ---------------- 规模阈值（集中管理，便于调参与验证） ----------------
export const FULL_NODE_LIMIT = 20000;      // 超过则默认走总览层级
export const OVERVIEW_NODE_CAP = 1200;     // 总览层级最多渲染多少超节点
export const OVERVIEW_EDGE_CAP = 6000;     // 总览层级最多渲染多少超边
export const REGION_NODE_CAP = 6000;       // 领域下钻的节点上限
export const FOCUS_NODE_CAP = 1200;        // 焦点邻域的节点上限

// ---------------- 确定性伪随机（保证同一 vault 每次布局一致） ----------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- 领域口径：全链路唯一 ----------------
// 卡片没有 frontmatter.domain 时按一级目录归类，绝不能全部塌进一个簇。
export function domainOf(n) {
  if (n && n.domain) return n.domain;
  const parts = String((n && n.path) || '').split('/').filter(Boolean);
  return parts[0] || '_root';
}

/** 簇键：优先领域，其次一级目录 */
export function clusterKey(n) {
  if (n && n.domain) return `d:${n.domain}`;
  const parts = String((n && n.path) || '').split('/').filter(Boolean);
  return `p:${parts[0] || '_root'}`;
}

// ---------------- 簇锚点（总览与全量共用，保证两种层级空间一致） ----------------
function domainAnchors(domains, domainSize, totalNodes) {
  const anchors = new Map();
  const R = 92 * Math.max(1, Math.cbrt(totalNodes / 40));
  domains.forEach((d, i) => {
    const t = (i + 0.5) / domains.length;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    anchors.set(d, [
      R * Math.sin(phi) * Math.cos(theta),
      R * Math.sin(phi) * Math.sin(theta),
      R * Math.cos(phi),
    ]);
  });
  return anchors;
}

// ---------------- 3D 力导向布局（Fruchterman-Reingold 三维版） ----------------
// 斥力按 k2/d，引力按 d2/k；簇内额外向心 attraction 形成"星系团"。
//
// v2.1.0：布局按规模自动降级。
//   n ≤ 2000      精确 O(n²) 斥力（视觉最好）
//   2000 < n      采样斥力，迭代数递减
//   n > 30000     簇级降级：域锚点 + 域内 Fibonacci 球面散布，O(n)，无迭代
//                 （10 万节点时精确布局需要 10^8×迭代量级，会把界面卡死数分钟）
export function layoutPoints(nodeList, edgeList, opts = {}) {
  const seed = opts.seed || 20261031;
  const rnd = mulberry32(seed);
  const ids = nodeList.map((n) => n.id);
  const n = ids.length;
  if (!n) return new Map();

  const byId = new Map(nodeList.map((x) => [x.id, x]));

  // 域 -> 簇锚点（球面上均匀撒点），让同域节点聚成星团
  const domains = [...new Set(nodeList.map(clusterKey))].sort();
  const domainSize = new Map();
  for (const x of nodeList) {
    const d = clusterKey(x);
    domainSize.set(d, (domainSize.get(d) || 0) + 1);
  }
  const anchors = domainAnchors(domains, domainSize, n);

  const pos = new Map();
  const domainOfId = new Map();
  for (const id of ids) {
    const node = byId.get(id) || {};
    const d = clusterKey(node);
    domainOfId.set(id, d);
    const a = anchors.get(d) || [0, 0, 0];
    // 簇内初始散布随簇大小放大：300 个节点的簇不能塞在 34 的立方里
    const spread = 34 * Math.cbrt(Math.max(1, domainSize.get(d) || 1) / 8);
    pos.set(id, [
      a[0] + (rnd() - 0.5) * spread,
      a[1] + (rnd() - 0.5) * spread,
      a[2] + (rnd() - 0.5) * spread,
    ]);
  }

  // ---- 簇级降级：超大库直接用 Fibonacci 球面散布（O(n)，无迭代） ----
  if (opts.tier === 'cluster' || n > 30000) {
    const perDomain = new Map();
    for (const id of ids) {
      const d = domainOfId.get(id);
      if (!perDomain.has(d)) perDomain.set(d, []);
      perDomain.get(d).push(id);
    }
    for (const [d, list] of perDomain) {
      const a = anchors.get(d) || [0, 0, 0];
      const spread = 34 * Math.cbrt(Math.max(1, list.length) / 8);
      const golden = Math.PI * (3 - Math.sqrt(5));
      list.forEach((id, i) => {
        const t = (i + 0.5) / list.length;
        const y = 1 - 2 * t;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = golden * i;
        pos.set(id, [
          a[0] + Math.cos(th) * r * spread,
          a[1] + y * spread,
          a[2] + Math.sin(th) * r * spread,
        ]);
      });
    }
    return pos;
  }

  // 规模自适应：节点越多，迭代越少、斥力走采样近似。
  const iterations = opts.iterations
    || (n > 900 ? 90 : n > 420 ? 150 : n > 200 ? 240 : 420);
  const repSample = n > 260 ? Math.min(n - 1, 96) : n - 1;

  const adj = new Map();
  for (const e of edgeList) {
    if (!adj.has(e.src)) adj.set(e.src, []);
    if (!adj.has(e.dst)) adj.set(e.dst, []);
    adj.get(e.src).push(e.dst);
    adj.get(e.dst).push(e.src);
  }

  const k = Math.cbrt((160 ** 3) / Math.max(n, 1)) * 0.82;
  let temp = 22;
  const cool = temp / iterations;

  // 采样用的随机偏移序列（大库时让斥力近似仍覆盖全图，而不是只看前若干个）
  const offsets = new Int32Array(repSample);
  for (let s = 0; s < repSample; s++) offsets[s] = 1 + Math.floor(rnd() * Math.max(1, n - 1));

  for (let it = 0; it < iterations; it++) {
    const disp = new Map();
    for (const id of ids) disp.set(id, [0, 0, 0]);

    // 斥力：小规模精确 O(n2)；大规模按随机偏移采样 O(n·K)
    for (let i = 0; i < n; i++) {
      const js = repSample >= n - 1 ? null : offsets;
      const from = js ? 0 : i + 1;
      const to = js ? repSample : n;
      for (let s = from; s < to; s++) {
        const j = js ? (i + offsets[s]) % n : s;
        if (j <= i) continue;
        const a = pos.get(ids[i]), b = pos.get(ids[j]);
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        const dist = Math.hypot(dx, dy, dz) || 0.01;
        const rep = (k * k) / dist;
        const da = disp.get(ids[i]), db = disp.get(ids[j]);
        da[0] += (dx / dist) * rep; da[1] += (dy / dist) * rep; da[2] += (dz / dist) * rep;
        db[0] -= (dx / dist) * rep; db[1] -= (dy / dist) * rep; db[2] -= (dz / dist) * rep;
      }
    }

    // 引力
    for (const e of edgeList) {
      if (!pos.has(e.src) || !pos.has(e.dst)) continue;
      const a = pos.get(e.src), b = pos.get(e.dst);
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      const dist = Math.hypot(dx, dy, dz) || 0.01;
      const att = (dist * dist) / k * 0.35;
      const da = disp.get(e.src), db = disp.get(e.dst);
      da[0] -= (dx / dist) * att; da[1] -= (dy / dist) * att; da[2] -= (dz / dist) * att;
      db[0] += (dx / dist) * att; db[1] += (dy / dist) * att; db[2] += (dz / dist) * att;
    }

    // 簇心引力（弱）：保证域聚团但不塌缩；簇越大引力越弱，避免大簇被压成一点
    for (const id of ids) {
      const a = anchors.get(domainOfId.get(id));
      if (!a) continue;
      const p = pos.get(id), d = disp.get(id);
      const pull = 0.012 / Math.max(1, Math.cbrt((domainSize.get(domainOfId.get(id)) || 1) / 8));
      d[0] += (a[0] - p[0]) * pull;
      d[1] += (a[1] - p[1]) * pull;
      d[2] += (a[2] - p[2]) * pull;
    }

    // 位移限制 + 降温
    for (const id of ids) {
      const d = disp.get(id), p = pos.get(id);
      const len = Math.hypot(d[0], d[1], d[2]) || 0.01;
      const limited = Math.min(len, temp);
      p[0] += (d[0] / len) * limited;
      p[1] += (d[1] / len) * limited;
      p[2] += (d[2] / len) * limited;
    }
    temp -= cool;
  }

  return pos;
}

/** 兼容旧签名：直接对整个 store 布局 */
export function layout3D(store, opts = {}) {
  return layoutPoints(store.allNodes(), [...store.edges.values()], opts);
}

// ---------------- 跨库幽灵节点：钉在外层球壳 ----------------
function ghostPosition(localPositions, idx, total) {
  let maxR = 0;
  for (const p of localPositions) {
    const r = Math.hypot(p[0], p[1], p[2]);
    if (r > maxR) maxR = r;
  }
  const R = Math.max(maxR * 1.22, 150);
  const phi = Math.acos(1 - 2 * ((idx + 0.5) / Math.max(1, total)));
  const theta = Math.PI * (1 + Math.sqrt(5)) * (idx + 0.7);
  return [
    Number((R * Math.sin(phi) * Math.cos(theta)).toFixed(2)),
    Number((R * Math.sin(phi) * Math.sin(theta)).toFixed(2)),
    Number((R * Math.cos(phi)).toFixed(2)),
  ];
}

// ---------------- 节点 / 边的公共投影 ----------------
function projectNode(n, pos, degree, weightSum) {
  return {
    id: n.id,
    neokb_id: n.neokb_id,
    title: n.title,
    path: n.path,
    domain: domainOf(n),
    tags: n.tags || [],
    memory_layer: n.memory_layer || 'semantic',
    degree: degree.get(n.id) || 0,
    weight_sum: Number((weightSum.get(n.id) || 0).toFixed(3)),
    created: n.created || null,
    updated: n.updated || null,
    pos: (pos || [0, 0, 0]).map((v) => Number(v.toFixed(2))),
    cluster: n.domain || '_root',
  };
}

function projectEdge(e, edgeTypeLabels) {
  return {
    id: e.id,
    src: e.src,
    dst: e.dst,
    type: e.type,
    type_label: edgeTypeLabels[e.type] || e.type,
    weight: Number(currentWeight(e).toFixed(4)),
    base_weight: Number((e.base_weight ?? e.weight).toFixed(4)),
    origin: e.origin || 'model',
    confirmed: !!e.confirmed,
    bidirectional: !!e.bidirectional,
    strength_hits: e.strength_hits || 0,
    reason: e.reason || null,
  };
}

function edgeTypeLabelMap() {
  const m = {};
  for (const key of Object.keys(EDGE_TYPES)) {
    const t = EDGE_TYPES[key];
    m[key] = t.label || key;
  }
  m.cross_kb = '跨库关联';
  return m;
}

// ---------------- 导出契约 ----------------
export function exportGraphPayload(store, opts = {}) {
  const totalNodes = store.nodes.size;
  const totalEdges = store.edges.size;
  const requested = opts.level || (totalNodes > FULL_NODE_LIMIT ? 'overview' : 'full');

  if (requested === 'overview') return exportOverview(store, opts, totalNodes, totalEdges);
  if (requested === 'region') return exportRegion(store, opts, totalNodes, totalEdges);
  if (requested === 'focus') return exportFocus(store, opts, totalNodes, totalEdges);
  return exportFull(store, opts, totalNodes, totalEdges);
}

function buildStats(nodes, edges, store, totalNodes, totalEdges) {
  const domains = [...new Set(nodes.map((n) => n.domain))].sort();
  const byType = {};
  for (const e of edges) byType[e.type] = (byType[e.type] || 0) + 1;
  const orphans = nodes.filter((n) => n.degree === 0).length;
  const crossLinks = Array.isArray(store.crossLinks) ? store.crossLinks : [];
  return {
    node_count: totalNodes,
    edge_count: totalEdges,
    shown_nodes: nodes.length,
    shown_edges: edges.length,
    cross_kb_count: edges.filter((e) => e.type === 'cross_kb').length,
    cross_vaults: [...new Set(crossLinks.map((c) => c.vault_name || c.vault_id))],
    avg_degree: nodes.length ? Number((edges.length * 2 / nodes.length).toFixed(2)) : 0,
    orphan_count: orphans,
    orphan_rate: nodes.length ? Number((orphans / nodes.length).toFixed(3)) : 0,
    domain_count: domains.length,
    by_type: byType,
  };
}

function vaultBlock(opts) {
  return opts.vault ? {
    id: opts.vault.id || null,
    name: opts.vault.name || null,
    color: opts.vault.color || null,
    path: opts.vault.path || null,
  } : null;
}

// ---- 全量层级 ----
function exportFull(store, opts, totalNodes, totalEdges) {
  const pos = layoutPoints(store.allNodes(), [...store.edges.values()], opts);
  const edgeTypeLabels = edgeTypeLabelMap();

  const degree = new Map();
  const weightSum = new Map();
  for (const e of store.edges.values()) {
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
    const w = currentWeight(e);
    weightSum.set(e.src, (weightSum.get(e.src) || 0) + w);
    weightSum.set(e.dst, (weightSum.get(e.dst) || 0) + w);
  }

  const nodes = store.allNodes().map((n) => projectNode(n, pos.get(n.id), degree, weightSum));
  const edges = [...store.edges.values()].map((e) => projectEdge(e, edgeTypeLabels));
  const { ghosts, crossEdges } = buildGhosts(store, nodes, edgeTypeLabels);
  const allNodes = nodes.concat(ghosts);
  const allEdges = edges.concat(crossEdges);

  return {
    schema: 'neokb-graph/2',
    generatedAt: new Date().toISOString(),
    vault: vaultBlock(opts),
    level: 'full',
    levelInfo: {
      level: 'full', total_nodes: totalNodes, shown_nodes: allNodes.length,
      total_edges: totalEdges, shown_edges: allEdges.length,
      can_drill: false, cap: FULL_NODE_LIMIT,
      note: '全量视图：渲染层将按权重稀疏化显示',
    },
    nodes: allNodes,
    edges: allEdges,
    edgeTypeLabels,
    domains: [...new Set(allNodes.map((n) => n.domain))].sort(),
    stats: buildStats(allNodes, allEdges, store, totalNodes, totalEdges),
  };
}

// ---- 总览层级：按领域聚合成超节点 ----
function exportOverview(store, opts, totalNodes, totalEdges) {
  const edgeTypeLabels = edgeTypeLabelMap();
  const nodes = store.allNodes();

  // 1) 按领域分组
  const groups = new Map();
  for (const n of nodes) {
    const d = domainOf(n);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(n);
  }

  // 2) 超量领域合并进「其他」，把超节点数压到上限内
  let entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  let overflow = 0;
  if (entries.length > OVERVIEW_NODE_CAP) {
    const keep = entries.slice(0, OVERVIEW_NODE_CAP - 1);
    const rest = entries.slice(OVERVIEW_NODE_CAP - 1);
    const merged = [];
    for (const [, list] of rest) { merged.push(...list); overflow += list.length; }
    entries = keep;
    if (merged.length) entries.push(['其他', merged]);
  }

  // 3) 域锚点（与全量布局共用同一套锚点 → 两级视图空间一致）
  const clusterKeys = entries.map(([d]) => `d:${d}`);
  const domainSize = new Map(clusterKeys.map((k) => [k, 1]));
  const anchors = domainAnchors(clusterKeys, domainSize, totalNodes);

  const supNodes = [];
  const memberOf = new Map();   // nodeId -> superNodeId
  entries.forEach(([d, list], i) => {
    const sid = `agg:${d}`;
    const a = anchors.get(`d:${d}`) || [0, 0, 0];
    supNodes.push({
      id: sid,
      neokb_id: sid,
      title: d === '_root' ? '未分类' : d,
      path: '',
      domain: d,
      tags: [],
      memory_layer: 'semantic',
      degree: 0,
      weight_sum: 0,
      created: null,
      updated: null,
      pos: [Number(a[0].toFixed(2)), Number(a[1].toFixed(2)), Number(a[2].toFixed(2))],
      cluster: d,
      aggregate: true,
      member_count: list.length,
    });
    for (const n of list) memberOf.set(n.id, sid);
  });

  // 4) 边聚合：成员之间的边按「超节点对」合并
  const pairMap = new Map();
  const degree = new Map();
  const weightSum = new Map();
  for (const e of store.edges.values()) {
    const sa = memberOf.get(e.src), sb = memberOf.get(e.dst);
    if (!sa || !sb) continue;
    degree.set(sa, (degree.get(sa) || 0) + 1);
    degree.set(sb, (degree.get(sb) || 0) + 1);
    const w = currentWeight(e);
    weightSum.set(sa, (weightSum.get(sa) || 0) + w);
    weightSum.set(sb, (weightSum.get(sb) || 0) + w);
    if (sa === sb) continue;
    const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    let rec = pairMap.get(key);
    if (!rec) {
      rec = { id: `agge:${key}`, src: sa, dst: sb, type: 'explicit_link', weight: 0, base_weight: 0, origin: 'model', confirmed: false, bidirectional: false, strength_hits: 0, reason: null, count: 0, type_label: '结构聚合' };
      pairMap.set(key, rec);
    }
    rec.count++;
    rec.weight += w;
    rec.base_weight += (e.base_weight ?? e.weight);
  }
  let supEdges = [...pairMap.values()];
  if (supEdges.length > OVERVIEW_EDGE_CAP) {
    supEdges.sort((a, b) => b.count - a.count);
    supEdges = supEdges.slice(0, OVERVIEW_EDGE_CAP);
  }
  for (const e of supEdges) {
    e.weight = Number(Math.min(1, e.weight / Math.max(1, e.count)).toFixed(4));
    e.base_weight = Number((e.base_weight / Math.max(1, e.count)).toFixed(4));
  }
  for (const s of supNodes) {
    s.degree = degree.get(s.id) || 0;
    s.weight_sum = Number((weightSum.get(s.id) || 0).toFixed(3));
  }

  // 5) 跨库幽灵节点（保留：总览也要看得出"这张网连着别的库"）
  const { ghosts, crossEdges } = buildGhosts(store, supNodes, edgeTypeLabels);
  const allNodes = supNodes.concat(ghosts);
  const allEdges = supEdges.concat(crossEdges);

  return {
    schema: 'neokb-graph/2',
    generatedAt: new Date().toISOString(),
    vault: vaultBlock(opts),
    level: 'overview',
    levelInfo: {
      level: 'overview', total_nodes: totalNodes, shown_nodes: allNodes.length,
      total_edges: totalEdges, shown_edges: allEdges.length,
      can_drill: true, cap: OVERVIEW_NODE_CAP,
      overflow_nodes: overflow,
      note: '总览视图：每个球是一个领域，点击可下钻到该领域的完整子图',
    },
    nodes: allNodes,
    edges: allEdges,
    edgeTypeLabels,
    domains: [...new Set(allNodes.map((n) => n.domain))].sort(),
    stats: buildStats(allNodes, allEdges, store, totalNodes, totalEdges),
  };
}

// ---- 领域下钻 ----
function exportRegion(store, opts, totalNodes, totalEdges) {
  const edgeTypeLabels = edgeTypeLabelMap();
  const want = opts.domain;
  if (!want) return exportOverview(store, opts, totalNodes, totalEdges);
  let list = store.allNodes().filter((n) => domainOf(n) === want);
  let truncated = false;
  if (list.length > REGION_NODE_CAP) {
    // 超限时按突触度数取前 N（枢纽优先），保结构不保全量
    list = list.slice().sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, REGION_NODE_CAP);
    truncated = true;
  }
  const ids = new Set(list.map((n) => n.id));
  const pos = layoutPoints(list, [...store.edges.values()].filter((e) => ids.has(e.src) && ids.has(e.dst)), opts);
  const degree = new Map();
  const weightSum = new Map();
  for (const e of store.edges.values()) {
    if (!ids.has(e.src) || !ids.has(e.dst)) continue;
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
    const w = currentWeight(e);
    weightSum.set(e.src, (weightSum.get(e.src) || 0) + w);
    weightSum.set(e.dst, (weightSum.get(e.dst) || 0) + w);
  }
  const nodes = list.map((n) => projectNode(n, pos.get(n.id), degree, weightSum));
  const edges = [...store.edges.values()].filter((e) => ids.has(e.src) && ids.has(e.dst)).map((e) => projectEdge(e, edgeTypeLabels));
  const { ghosts, crossEdges } = buildGhosts(store, nodes, edgeTypeLabels);
  const allNodes = nodes.concat(ghosts);
  const allEdges = edges.concat(crossEdges);
  return {
    schema: 'neokb-graph/2',
    generatedAt: new Date().toISOString(),
    vault: vaultBlock(opts),
    level: 'region',
    levelInfo: {
      level: 'region', domain: want, total_nodes: totalNodes, shown_nodes: allNodes.length,
      total_edges: totalEdges, shown_edges: allEdges.length,
      can_drill: false, cap: REGION_NODE_CAP, truncated,
      note: truncated ? `领域「${want}」卡片过多，已按突触度数取前 ${REGION_NODE_CAP} 张` : `领域「${want}」的完整子图`,
    },
    nodes: allNodes,
    edges: allEdges,
    edgeTypeLabels,
    domains: [...new Set(allNodes.map((n) => n.domain))].sort(),
    stats: buildStats(allNodes, allEdges, store, totalNodes, totalEdges),
  };
}

// ---- 焦点：某节点的 k 跳邻域 ----
function exportFocus(store, opts, totalNodes, totalEdges) {
  const edgeTypeLabels = edgeTypeLabelMap();
  const centerId = opts.id;
  if (!centerId || !store.nodes.has(centerId)) return exportOverview(store, opts, totalNodes, totalEdges);
  const hops = Math.max(1, Math.min(3, opts.hops || 1));
  const adj = store.adjacency();
  const keep = new Set([centerId]);
  let frontier = [centerId];
  for (let d = 0; d < hops; d++) {
    const next = [];
    for (const u of frontier) {
      for (const e of adj.get(u) || []) {
        for (const v of [e.src, e.dst]) {
          if (v && !keep.has(v)) { keep.add(v); next.push(v); }
        }
      }
    }
    frontier = next;
    if (keep.size >= FOCUS_NODE_CAP) break;
  }
  const list = [...keep].map((id) => store.getNode(id)).filter(Boolean);
  const pos = layoutPoints(list, [...store.edges.values()].filter((e) => keep.has(e.src) && keep.has(e.dst)), opts);
  const degree = new Map();
  const weightSum = new Map();
  for (const e of store.edges.values()) {
    if (!keep.has(e.src) || !keep.has(e.dst)) continue;
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
    const w = currentWeight(e);
    weightSum.set(e.src, (weightSum.get(e.src) || 0) + w);
    weightSum.set(e.dst, (weightSum.get(e.dst) || 0) + w);
  }
  const nodes = list.map((n) => projectNode(n, pos.get(n.id), degree, weightSum));
  const edges = [...store.edges.values()].filter((e) => keep.has(e.src) && keep.has(e.dst)).map((e) => projectEdge(e, edgeTypeLabels));
  const { ghosts, crossEdges } = buildGhosts(store, nodes, edgeTypeLabels);
  const allNodes = nodes.concat(ghosts);
  const allEdges = edges.concat(crossEdges);
  return {
    schema: 'neokb-graph/2',
    generatedAt: new Date().toISOString(),
    vault: vaultBlock(opts),
    level: 'focus',
    levelInfo: {
      level: 'focus', id: centerId, hops, total_nodes: totalNodes, shown_nodes: allNodes.length,
      total_edges: totalEdges, shown_edges: allEdges.length,
      can_drill: false, cap: FOCUS_NODE_CAP,
      note: `以「${(store.getNode(centerId) || {}).title || centerId}」为中心 ${hops} 跳邻域`,
    },
    nodes: allNodes,
    edges: allEdges,
    edgeTypeLabels,
    domains: [...new Set(allNodes.map((n) => n.domain))].sort(),
    stats: buildStats(allNodes, allEdges, store, totalNodes, totalEdges),
  };
}

// ---- 跨库幽灵节点（各层级共用） ----
function buildGhosts(store, baseNodes, edgeTypeLabels) {
  const crossLinks = Array.isArray(store.crossLinks) ? store.crossLinks : [];
  const localPositions = baseNodes.map((n) => n.pos);
  const ghosts = [];
  const crossEdges = [];
  crossLinks.forEach((c, i) => {
    if (!c || !c.path) return;
    // v2.1.0：兜底 id 与 addCrossLink 的 64 位口径保持一致
    const gid = `x_${String(c.id).replace(/^x_/, '') || fnv1a64(c.vault_id + '|' + c.path)}`;
    const local = store.getNode(c.local_id);
    const weight = Number((c.weight ?? 0.9).toFixed(4));
    const meta = {
      link_id: c.id,
      vault_id: c.vault_id,
      vault_name: c.vault_name || c.vault_id,
      vault_color: c.vault_color || '#64C8FF',
      path: c.path,
    };
    ghosts.push({
      id: gid,
      neokb_id: gid,
      title: c.title || c.path,
      path: c.path,
      domain: meta.vault_name,
      tags: [],
      memory_layer: 'cross',
      degree: 1,
      weight_sum: weight,
      created: c.created_at || null,
      updated: null,
      pos: ghostPosition(localPositions, i, crossLinks.length),
      cluster: `cross:${meta.vault_name}`,
      cross: meta,
    });
    if (local) {
      crossEdges.push({
        id: `xe_${String(c.id).replace(/^x_/, '')}`,
        src: local.id,
        dst: gid,
        type: 'cross_kb',
        type_label: '跨库关联',
        weight,
        base_weight: weight,
        origin: c.origin || 'human',
        confirmed: true,
        bidirectional: true,
        strength_hits: 0,
        reason: c.reason || null,
        cross: meta,
      });
    }
  });
  return { ghosts, crossEdges };
}

export default { layout3D, layoutPoints, exportGraphPayload, domainOf, clusterKey };
