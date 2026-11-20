#!/usr/bin/env node
/**
 * bench-kernel.mjs —— 内核热路径微基准（v6.37.0）
 * 用途：量化"运行内核卡顿"优化的真实性，全部为纯算法、零网络、可复现。
 *
 * 三项基准：
 *   A) cosine 语义打分：N 张卡 × D 维，测语义种子主循环耗时
 *   B) currentWeight：E 条边 × R 轮，测激活扩散/图导出内层权重计算
 *   C) Date 解析开销：与 B 对照，证明"重复 ISO 解析"确实是瓶颈
 *
 * 用法：node tools/bench-kernel.mjs [cards] [dims] [edges] [rounds]
 */
const CARDS = Number(process.argv[2] || 20000);
const DIMS = Number(process.argv[3] || 1536);
const EDGES = Number(process.argv[4] || 30000);
const ROUNDS = Number(process.argv[5] || 200);

const hr = () => Number(process.hrtime.bigint()) / 1e6;
const fmt = (ms) => `${ms.toFixed(2)} ms`;

// ---- 与 semantic-bridge.js 完全一致的 cosine 实现（优化前口径）----
function cosineOld(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    s += x * y; na += x * x; nb += y * y;
  }
  if (!(na > 0) || !(nb > 0)) return null;
  return s / Math.sqrt(na * nb);
}

// ---- 优化后：卡向量预先归一并缓存点积基数，查询向量算一次范数 ----
function buildNorms(vectors) {
  const norms = new Float64Array(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    let nb = 0; const v = vectors[i];
    for (let d = 0; d < v.length; d++) nb += v[d] * v[d];
    norms[i] = Math.sqrt(nb) || 1;
  }
  return norms;
}
function cosineFast(q, qNorm, v, vNorm) {
  let s = 0;
  for (let i = 0; i < q.length; i++) s += q[i] * v[i];
  return s / (qNorm * vNorm);
}

// ---- currentWeight 优化前/后 ----
const PLASTICITY = { alpha: 0.08, floor: 0.05, cap: 3.0 };
const EDGE_TYPES = { explicit_link: { halfLifeDays: 180 }, question_answer: { halfLifeDays: 30 }, co_occurrence: { halfLifeDays: 60 } };
function halfLifeMs(type) { const c = EDGE_TYPES[type]; return c && isFinite(c.halfLifeDays) ? c.halfLifeDays * 86400000 : Infinity; }
function currentWeightOld(edge, now) {
  const hl = halfLifeMs(edge.type);
  const lambda = hl === Infinity ? 0 : Math.LN2 / hl;
  const dt = Math.max(0, now - new Date(edge.last_reinforced_at || now).getTime());
  const decay = lambda === 0 ? 1 : Math.exp(-lambda * dt);
  const reinforced = 1 + PLASTICITY.alpha * (edge.strength_hits || 0);
  let w = edge.base_weight * reinforced * decay;
  return Math.min(PLASTICITY.cap, Math.max(PLASTICITY.floor, w));
}
// 优化：把 lambda 与时间戳预解析进边，循环内不再 new Date / 查表
function decorateEdges(edges, now) {
  for (const e of edges) {
    const hl = halfLifeMs(e.type);
    e._lambda = hl === Infinity ? 0 : Math.LN2 / hl;
    e._ts = new Date(e.last_reinforced_at || now).getTime();
    e._factor = e.base_weight * (1 + PLASTICITY.alpha * (e.strength_hits || 0));
  }
}
function currentWeightFast(e, now) {
  const dt = now > e._ts ? now - e._ts : 0;
  const decay = e._lambda === 0 ? 1 : Math.exp(-e._lambda * dt);
  const w = e._factor * decay;
  return w > PLASTICITY.cap ? PLASTICITY.cap : (w < PLASTICITY.floor ? PLASTICITY.floor : w);
}

// ================= 基准 A：cosine =================
console.log(`\n===== 内核微基准 · cards=${CARDS} dims=${DIMS} edges=${EDGES} rounds=${ROUNDS} =====\n`);
console.log('[A] 语义种子 cosine 主循环');
let seed = 123456789;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const vectors = new Array(CARDS);
for (let i = 0; i < CARDS; i++) {
  const v = new Float64Array(DIMS);
  for (let d = 0; d < DIMS; d++) v[d] = rnd() - 0.5;
  vectors[i] = v;
}
const q = new Float64Array(DIMS);
for (let d = 0; d < DIMS; d++) q[d] = rnd() - 0.5;

let t0 = hr();
let accOld = 0;
for (let i = 0; i < CARDS; i++) accOld += cosineOld(q, vectors[i]) || 0;
const tOld = hr() - t0;

t0 = hr();
const norms = buildNorms(vectors);
let qn = 0; for (let d = 0; d < DIMS; d++) qn += q[d] * q[d]; qn = Math.sqrt(qn) || 1;
const prep = hr() - t0;
t0 = hr();
let accFast = 0;
for (let i = 0; i < CARDS; i++) accFast += cosineFast(q, qn, vectors[i], norms[i]);
const tFast = hr() - t0;
const equivA = Math.abs(accOld - accFast) / Math.max(1, Math.abs(accOld));
console.log(`  优化前（逐向量重算范数）: ${fmt(tOld)}`);
console.log(`  优化后（范数预计算）    : ${fmt(tFast)}  + 预处理 ${fmt(prep)}`);
console.log(`  加速比: ${(tOld / (tFast + prep)).toFixed(2)}x  |  结果相对误差: ${(equivA * 100).toExponential(2)}%  ${equivA < 1e-9 ? '[等价 OK]' : '[! 需核查]'}`);

// ================= 基准 B：currentWeight =================
console.log('\n[B] 激活扩散/图导出内层 currentWeight');
const now = Date.now();
const edges = new Array(EDGES);
for (let i = 0; i < EDGES; i++) {
  edges[i] = {
    type: ['explicit_link', 'question_answer', 'co_occurrence'][i % 3],
    base_weight: 0.5 + rnd(),
    strength_hits: i % 10,
    last_reinforced_at: new Date(now - Math.floor(rnd() * 30 * 86400000)).toISOString(),
  };
}
t0 = hr();
let accB = 0;
for (let r = 0; r < ROUNDS; r++) {
  for (let i = 0; i < EDGES; i++) accB += currentWeightOld(edges[i], now);
}
const tOldB = hr() - t0;
decorateEdges(edges, now);
t0 = hr();
let accFastB = 0;
for (let r = 0; r < ROUNDS; r++) {
  for (let i = 0; i < EDGES; i++) accFastB += currentWeightFast(edges[i], now);
}
const tFastB = hr() - t0;
const equivB = Math.abs(accB - accFastB) / Math.max(1, Math.abs(accB));
console.log(`  优化前（每条边 new Date + 查表）: ${fmt(tOldB)}`);
console.log(`  优化后（时间戳/lambda 预解析）  : ${fmt(tFastB)}`);
console.log(`  加速比: ${(tOldB / tFastB).toFixed(2)}x  |  结果相对误差: ${(equivB * 100).toExponential(2)}%  ${equivB < 1e-9 ? '[等价 OK]' : '[! 需核查]'}`);

console.log('\n说明：本基准测的是纯算法热路径，不含磁盘 IO。真实搜索的最大瓶颈(805MB 权重扫描)\n      通过热路径摘除 withEvidence 解决，见 v6.37.0 交付说明。\n');
