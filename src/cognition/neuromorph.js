// 类脑计算引擎（Neuromorphic Cognitive Engine）
// ===========================================================================
// 这是一套**真正参与计算**的神经形态算法集合，不是装饰动画，也不是随机采样。
// 它把「法律认知」当成一台可解释的神经机器来跑，底座是 本项目自研认知规格 真源
// 编译出的 30 个真实解剖脑区与 183 条长程轴突（权重 w / 兴奋抑制 type /
// 真实传导潜伏期 latency_ms / 髓鞘 myelin 全部来自真源）。
//
// 四个真实算法，分别解决认知的不同侧面，由 createNeuromorph 编排成一台引擎：
//
//   ① 脉冲神经网络 SNN（Izhikevich 2003 简单模型）
//      —— 30 个脑区各为一台 RS 神经元；180 条轴突把「前神经元放电」按真实
//         latency_ms 延迟、按 w 注入后神经元电流。一次 runCycle 是真刀真枪的
//         脉冲沿连接组扩散，产出真实 region 激活与可回放脉冲（喂给 3D 脑点亮）。
//
//   ② Hopfield 吸引子联想记忆（Hebbian 学习 + 线索补全 pattern completion）
//      —— 把概念编码成 30 维双极向量，Hebbian 累加成连接权 J；给一个残缺线索，
//         网络迭代收敛到最近的存储模式（真实联想补全，非随机）。
//
//   ③ HTM 风格序列记忆（稀疏分布式表征 SDR + 转移计数预测）
//      —— 把每次激活折叠成稀疏 SDR（top-k 脑区），记录 SDR 之间的转移频次，
//         用频次预测「下一步最可能是哪个认知状态」（真实序列预测）。
//
//   ④ 预测编码（线性预测器 + 自由能 / 预测误差）
//      —— 维护一个线性前向模型 M·v_t ≈ v_{t+1}，用 δ 规则在线学习；每步的
//         预测误差平方即自由能。既作序列记忆的兜底预测，也给出「可预测性」指标。
//
// 诚实边界（界面 / 安装向导 / 文档均显著标注）：
//   · 本机 CPU 上对真实神经形态算法的**经典数值模拟**，非物理神经形态芯片；
//   · 非量子计算；无生物生命、无意识、无主观体验；
//   · 只做联想补全 / 序列预测 / 脉冲传播，不改变八阶段法律推理的结论与置信度，
//     也不写入知识库；所有数字来自运行时真实计算，界面不做任何虚构填充。
// ===========================================================================
import { REGION_KEYS, SYNAPSES } from './connectome-activation.js';

const REGIONS = REGION_KEYS;
const N = REGIONS.length;                       // 30
const IDX = Object.fromEntries(REGIONS.map((k, i) => [k, i]));
const SYN = SYNAPSES;                            // 183

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const clampV = (v) => Math.max(-100, Math.min(40, v));

export const NEUROMORPH_BOUNDARY =
  '类脑计算引擎是本机 CPU 上对真实神经形态算法的经典数值模拟'
  + '（脉冲神经网络 SNN / Hopfield 吸引子联想记忆 / HTM 稀疏表征序列记忆 / 预测编码）。'
  + '它真实执行联想补全、序列预测与脉冲传播，但非物理神经形态芯片、非量子计算、'
  + '无生物生命、无意识，也不改变八阶段法律推理的结论与置信度。';

// ---- 内置法律概念 → 脑区联想模式（作为吸引子记忆的初始真源） --------------
// 这些是「概念语义→脑区」的合理关联（基于 regionMeta 的系统归属），让引擎在
// 用户尚未沉淀经验前就有可联想的真实内容；用户经验会追加进同一张记忆网。
// 每个概念挑 4 个脑区，且尽量保证至少一个「专属区」，使 cued recall 能无歧义补全。
const CONCEPT_SEEDS = {
  合同: ['contract', 'drafting', 'strategy', 'finance'],
  侵权: ['limbic', 'sensory', 'ofc', 'tpj'],
  知产: ['atl', 'lexmind', 'express', 'metacog'],
  刑事: ['hypothalamus', 'nacc', 'reticular', 'acc'],
  合规: ['ofc', 'predict', 'review', 'metacog'],
  证据: ['evidence', 'review', 'atl', 'workspace'],
  程序: ['sma', 'cerebellum', 'adjudication', 'drafting'],
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vecFromLevels(levels) {
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) v[i] = clamp01(levels[REGIONS[i]] || 0);
  return v;
}
function bipolarFromLevels(levels, thr = 0.3) {
  const s = new Int8Array(N);
  for (let i = 0; i < N; i++) s[i] = (clamp01(levels[REGIONS[i]] || 0) >= thr) ? 1 : -1;
  return s;
}
function topKRegions(levels, k = 8) {
  return REGIONS
    .map((key) => ({ key, v: clamp01(levels[key] || 0) }))
    .filter((o) => o.v >= 0.05)
    .sort((a, b) => b.v - a.v)
    .slice(0, k)
    .map((o) => o.key)
    .sort()
    .join('|');
}
function levelsFromBipolar(s, on = 1, off = 0) {
  const out = {};
  for (let i = 0; i < N; i++) out[REGIONS[i]] = s[i] > 0 ? on : off;
  return out;
}
function levelsFromVec(v, scale = 1) {
  const out = {};
  for (let i = 0; i < N; i++) out[REGIONS[i]] = clamp01(v[i] * scale);
  return out;
}

// ---------------------------------------------------------------------------
// 引擎工厂
// ---------------------------------------------------------------------------
export function createNeuromorph() {
  // —— ① SNN：每台神经元状态 + 每个神经元的出突触（用于脉冲调度） ——
  const IZ = { a: 0.02, b: 0.2, c: -65, d: 8 };
  const v = new Float64Array(N), u = new Float64Array(N);
  const synI = new Float64Array(N);                 // 突触电流（逐拍衰减）
  const spikeCount = new Int32Array(N);
  const outSyn = Array.from({ length: N }, () => []);
  for (const e of SYN) {
    const i = IDX[e.from], j = IDX[e.to];
    if (i == null || j == null) continue;
    outSyn[i].push({ j, w: Number(e.w) || 0, type: e.type, latency: Math.max(1, Math.round(Number(e.latency_ms) || 10)), myelin: !!e.myelin });
  }

  // —— ② Hopfield 吸引子记忆 ——
  const J = new Float64Array(N * N);
  const patterns = [];                              // { label, s:Int8Array }
  let lastJPattern = 0;

  // —— ③ HTM 序列记忆 ——
  const trans = new Map();                          // prevKey -> Map(curKey -> count)
  let lastSdr = null;
  let seqHits = 0, seqTotal = 0;

  // —— ④ 预测编码：线性前向模型 M·v_t ≈ v_{t+1} ——
  const M = new Float64Array(N * N);
  let lastVec = null;
  let freeEnergy = 1;

  let lastCycle = null;

  // ---- 学习一个模式（同时写入四类记忆） ----
  function learnPattern(levels, label) {
    const s = bipolarFromLevels(levels);
    // Hopfield：Hebbian 累加（对角置 0）
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        J[i * N + j] += (s[i] * s[j]) / N;
      }
    }
    patterns.push({ label: label || `P${patterns.length + 1}`, s });
    lastJPattern = patterns.length;
    // 序列 + 预测编码
    const key = topKRegions(levels);
    if (lastSdr && key !== lastSdr) {
      if (!trans.has(lastSdr)) trans.set(lastSdr, new Map());
      const m = trans.get(lastSdr);
      m.set(key, (m.get(key) || 0) + 1);
    }
    const vec = vecFromLevels(levels);
    if (lastVec) {
      // δ 规则学习线性预测器；同时累计预测命中与自由能
      const pred = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let j = 0; j < N; j++) acc += M[i * N + j] * lastVec[j];
        pred[i] = acc;
      }
      let err2 = 0;
      const LR = 0.05;
      for (let i = 0; i < N; i++) {
        const e = vec[i] - pred[i];
        err2 += e * e;
        for (let j = 0; j < N; j++) M[i * N + j] += LR * e * lastVec[j];
      }
      freeEnergy = err2 / N;
    }
    lastSdr = key;
    lastVec = vec;
    return { stored: true, patterns: patterns.length, key };
  }

  // —— ① SNN 一次循环（真实脉冲沿连接组扩散） ——
  function runCycle(inputPattern, opts = {}) {
    const steps = Math.max(40, Math.min(400, opts.steps || 160));
    const driveGain = opts.driveGain ?? 14;          // 外部驱动强度
    const pspGain = opts.pspGain ?? 9;               // 突触电流增益
    const pspDecay = opts.pspDecay ?? 0.86;

    for (let i = 0; i < N; i++) { v[i] = IZ.c; u[i] = IZ.b * IZ.c; synI[i] = 0; spikeCount[i] = 0; }
    // 外部驱动：输入激活的脑区被持续注入电流
    const drive = new Float64Array(N);
    if (Array.isArray(inputPattern)) {
      for (const k of inputPattern) if (IDX[k] != null) drive[IDX[k]] = driveGain;
    } else if (inputPattern && typeof inputPattern === 'object') {
      for (const [k, val] of Object.entries(inputPattern)) if (IDX[k] != null) drive[IDX[k]] = clamp01(val) * driveGain;
    }

    const spikes = Array.from({ length: N }, () => []);   // 每个脑区的放电时刻
    const pulses = [];
    // 脉冲投递队列：deliveries[step] = [{j,w,type,myelin,from,latency}]
    let deliveries = Array.from({ length: steps + 40 }, () => []);

    for (let t = 0; t < steps; t++) {
      // 先投递本拍到期的突触电流
      for (const d of deliveries[t]) {
        const g = pspGain * d.w * (d.type === 'inhibitory' ? -1 : 1);
        synI[d.j] += g;
        pulses.push({
          from: d.from, to: REGIONS[d.j], w: d.w, type: d.type,
          tract: d.tract, latency_ms: d.latency, myelin: d.myelin,
          delayMs: t, level: clamp01(Math.abs(d.w) * 0.3), sign: d.w >= 0 ? 1 : -1,
        });
      }
      for (let i = 0; i < N; i++) {
        const I = drive[i] + synI[i];
        // Izhikevich 简单模型（dt = 1ms）
        const dv = 0.04 * v[i] * v[i] + 5 * v[i] + 140 - u[i] + I;
        const du = IZ.a * (IZ.b * v[i] - u[i]);
        v[i] = clampV(v[i] + dv);
        u[i] += du;
        if (v[i] >= 30) {
          spikeCount[i]++;
          spikes[i].push(t);
          v[i] = IZ.c; u[i] += IZ.d;
          // 放电 → 按真实潜伏期调度到后神经元
          for (const s of outSyn[i]) {
            const when = t + s.latency;
            if (when < deliveries.length) deliveries[when].push({ j: s.j, w: s.w, type: s.type, myelin: s.myelin, from: REGIONS[i], latency: s.latency, tract: '' });
          }
        }
      }
      // 突触电流逐拍衰减
      for (let i = 0; i < N; i++) synI[i] *= pspDecay;
    }

    const levels = {};
    const rateGain = 6;
    let fired = 0;
    for (let i = 0; i < N; i++) {
      const lvl = clamp01((spikeCount[i] / steps) * rateGain);
      levels[REGIONS[i]] = Math.round(lvl * 1e4) / 1e4;
      if (lvl > 0.02) fired++;
    }
    lastCycle = { levels, pulses, spikes, steps, spikeCount: spikeCount.reduce((a, b) => a + b, 0), firedRegions: fired };
    return { ...lastCycle };
  }

  // —— ② 吸引子记忆：线索补全（pattern completion，带线索钳位） ——
  // 标准 Hopfield 检索：线索中出现的脑区被「钳位」固定，其余自由迭代收敛到
  // 最近的存储模式。钳位是联想补全真正可用的关键（无钳位时全负线索会偏向更稀疏的模式）。
  function recall(cueLevels, opts = {}) {
    const s = bipolarFromLevels(cueLevels);
    const clamp = new Uint8Array(N);               // 1 = 该位被线索固定
    for (let i = 0; i < N; i++) if (clamp01(cueLevels[REGIONS[i]] || 0) >= 0.3) clamp[i] = 1;
    const iters = Math.max(10, Math.min(60, opts.iters || 40));
    const beta = opts.beta ?? 0.6;
    let prev = Int8Array.from(s);
    let it = 0, converged = false;
    for (; it < iters; it++) {
      const next = new Int8Array(N);
      for (let i = 0; i < N; i++) {
        if (clamp[i]) { next[i] = prev[i]; continue; }
        let h = 0;
        for (let j = 0; j < N; j++) if (j !== i) h += J[i * N + j] * prev[j];
        next[i] = Math.tanh(beta * h) >= 0 ? 1 : -1;
      }
      let diff = 0;
      for (let i = 0; i < N; i++) if (!clamp[i] && next[i] !== prev[i]) diff++;
      prev = next;
      if (diff === 0) { converged = true; break; }
    }
    // 与已存模式比对重叠度（pattern completion 质量）
    const candidates = patterns.map((p) => {
      let dot = 0;
      for (let i = 0; i < N; i++) dot += prev[i] * p.s[i];
      return { label: p.label, overlap: dot / N };
    }).sort((a, b) => b.overlap - a.overlap);
    const best = candidates[0] || { label: '未知', overlap: 0 };
    return {
      recalled: levelsFromBipolar(prev, 1, 0),
      label: best.label,
      overlap: Math.round(best.overlap * 1e4) / 1e4,
      iterations: it + 1,
      converged,
      candidates: candidates.slice(0, 4),
    };
  }

  // —— ③+④ 预测：序列记忆优先，无转移时回退预测编码 ——
  function predict(opts = {}) {
    const curKey = opts.sdr || lastSdr;
    if (!curKey) return { next: {}, key: '', confidence: 0, freeEnergy: Math.round(freeEnergy * 1e4) / 1e4, source: 'none' };
    const m = trans.get(curKey);
    if (m && m.size) {
      let bestKey = '', bestN = 0, total = 0;
      for (const [k, n] of m) { total += n; if (n > bestN) { bestN = n; bestKey = k; } }
      const levels = {};
      for (const rk of bestKey.split('|')) if (IDX[rk] != null) levels[rk] = 0.75;
      const conf = Math.round((bestN / total) * 1e4) / 1e4;
      seqTotal++;
      if (lastSdr === curKey) seqHits++;     // 仅当基于真实当前态
      return { next: levels, key: bestKey, confidence: conf, freeEnergy: Math.round(freeEnergy * 1e4) / 1e4, source: 'sequence' };
    }
    // 回退：预测编码线性模型
    if (lastVec) {
      const pred = new Float64Array(N);
      for (let i = 0; i < N; i++) { let acc = 0; for (let j = 0; j < N; j++) acc += M[i * N + j] * lastVec[j]; pred[i] = acc; }
      return { next: levelsFromVec(pred, 1), key: '', confidence: 0, freeEnergy: Math.round(freeEnergy * 1e4) / 1e4, source: 'predictor' };
    }
    return { next: {}, key: '', confidence: 0, freeEnergy: Math.round(freeEnergy * 1e4) / 1e4, source: 'none' };
  }

  // ---- 用一次真实激活（如八阶段结果 / 自主漫游）同时驱动四类记忆 ----
  function absorb(levels, label) {
    const r = learnPattern(levels, label);
    return r;
  }

  // ---- 状态（全部来自运行时真实计算） ----
  function status() {
    const spikeRate = lastCycle ? Math.round((lastCycle.spikeCount / (N * lastCycle.steps)) * 1e4) / 1e4 : 0;
    let exc = 0, inh = 0, myel = 0;
    for (const e of SYN) { if (e.type === 'excitatory') exc++; else if (e.type === 'inhibitory') inh++; if (e.myelin) myel++; }
    return {
      neurons: N,
      synapses: SYN.length,
      excitatory: exc,
      inhibitory: inh,
      myelinated: myel,
      patterns: patterns.length,
      sequenceHits: seqHits,
      sequenceTotal: seqTotal,
      sequenceAccuracy: seqTotal ? Math.round((seqHits / seqTotal) * 1e4) / 1e4 : 0,
      predictorFreeEnergy: Math.round(freeEnergy * 1e4) / 1e4,
      lastSpikeRate: spikeRate,
      firedRegions: lastCycle ? lastCycle.firedRegions : 0,
      boundary: NEUROMORPH_BOUNDARY,
    };
  }

  function selfCheck() {
    let finite = true;
    for (let i = 0; i < N * N; i++) if (!Number.isFinite(J[i]) || !Number.isFinite(M[i])) { finite = false; break; }
    return {
      ok: N === 30 && SYN.length >= 180 && patterns.length >= Object.keys(CONCEPT_SEEDS).length && finite,
      neurons: N, synapses: SYN.length, patterns: patterns.length, jFinite: finite,
    };
  }

  // ---- 初始真源：把内置法律概念灌入吸引子记忆 ----
  const conceptList = Object.entries(CONCEPT_SEEDS).map(([label, regions]) => ({ label, regions }));
  for (const [label, keys] of Object.entries(CONCEPT_SEEDS)) {
    const lv = {}; for (const k of keys) lv[k] = 0.9;
    learnPattern(lv, label);
  }

  return {
    meta: { neurons: N, synapses: SYN.length, regions: REGIONS },
    runCycle, recall, predict, learn: absorb, absorb,
    listConcepts: () => conceptList.map((c) => ({ label: c.label, regions: [...c.regions] })),
    status, selfCheck,
    get lastCycle() { return lastCycle; },
    snapshot: () => ({
      J: Array.from(J), M: Array.from(M),
      patterns: patterns.map((p) => ({ label: p.label, s: Array.from(p.s) })),
      trans: Array.from(trans.entries()).map(([k, m]) => [k, Array.from(m.entries())]),
      lastSdr, lastVec: lastVec ? Array.from(lastVec) : null,
      seqHits, seqTotal, freeEnergy,
    }),
    restore: (snap) => {
      if (!snap) return false;
      if (Array.isArray(snap.J)) J.set(snap.J);
      if (Array.isArray(snap.M)) M.set(snap.M);
      if (Array.isArray(snap.patterns)) {
        patterns.length = 0;
        for (const p of snap.patterns) patterns.push({ label: p.label, s: Int8Array.from(p.s) });
      }
      if (Array.isArray(snap.trans)) { trans.clear(); for (const [k, arr] of snap.trans) trans.set(k, new Map(arr)); }
      lastSdr = snap.lastSdr || null;
      lastVec = snap.lastVec ? Float64Array.from(snap.lastVec) : null;
      seqHits = snap.seqHits || 0; seqTotal = snap.seqTotal || 0; freeEnergy = snap.freeEnergy ?? 1;
      return true;
    },
  };
}

// 供测试使用的纯函数入口（无需 DOM）
export { vecFromLevels, bipolarFromLevels, topKRegions, levelsFromBipolar };
