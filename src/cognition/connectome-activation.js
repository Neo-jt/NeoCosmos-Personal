// 连接组激活扩散（深加工版）
// ---------------------------------------------------------------------------
// 183 条长程轴突、30 个脑区集群由本项目自研认知规格定义
// connectome.json 单一真源编译。每条轴突自带 w（权重/符号）、latency_ms（真实
// 传导潜伏期）、myelin（髓鞘）、tract（解剖束名）、neuro（递质）。
//
// 本文件把这些「真数据」变成可播放的神经脉冲：
//   · spreadActivation() —— 沿轴突按权重带衰减扩散，抑制性连接削弱目标区，
//     有髓鞘衰减更慢；每个 pulse 带累计延迟，3D 视图按真实时序点亮；
//   · idleWander() —— 默认网络（DMN）在空闲时的**自发激活漫游**：
//     这是「自主思考循环」的可观测内核，确定性 PRNG，可回放、可关闭；
//   · stageActivation() —— 把八阶段真实结果折算成脑区激活值。
//
// 边界：这是图上的确定性数值传播，不是生物神经放电，也不产生意识。
import { CONNECTOME, ANATOMY } from './anatomy.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export const REGION_KEYS = ANATOMY.regions.map((r) => r.key);
export const REGION_META = CONNECTOME.regionMeta;
export const SYNAPSES = CONNECTOME.synapses;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 沿真实连接组扩散激活。
 * @param {object|Array} seeds  {regionKey: level} 或 ['regionKey', ...]
 * @param {object} opts { steps=3, threshold=0.02, decay=0.72 }
 * @returns {{levels: object, pulses: Array, totalMs: number, touched: number}}
 */
export function spreadActivation(seeds, opts = {}) {
  const steps = Math.max(1, Math.min(6, opts.steps ?? 3));
  const threshold = opts.threshold ?? 0.02;
  const baseDecay = opts.decay ?? 0.72;
  let levels = {};
  // 注意：必须显式加花括号。`if (A) for (...) if (B) ...; else ...` 里的 else
  // 会被 JS 绑定到内层 if，导致对象种子分支永远不执行（levels 恒为空）。
  if (Array.isArray(seeds)) {
    for (const k of seeds) if (REGION_KEYS.includes(k)) levels[k] = 1;
  } else {
    for (const [k, v] of Object.entries(seeds || {})) {
      if (REGION_KEYS.includes(k)) levels[k] = clamp01(v);
    }
  }

  const pulses = [];
  let elapsed = 0;
  for (let hop = 1; hop <= steps; hop++) {
    const next = { ...levels };
    for (const e of SYNAPSES) {
      const src = levels[e.from];
      if (!src || src < threshold) continue;
      const w = Number(e.w) || 0;
      // 有髓鞘传导衰减小；抑制性连接为负贡献
      const decay = baseDecay * (e.myelin ? 1.12 : 0.92);
      const contrib = src * w * decay * (1 / hop);
      if (Math.abs(contrib) < threshold) continue;
      const before = next[e.to] || 0;
      next[e.to] = clamp01(before + contrib);
      const latency = Math.max(1, Math.round(Number(e.latency_ms) || 8));
      pulses.push({
        from: e.from, to: e.to, w, type: e.type, tract: e.tract,
        latency_ms: latency, myelin: !!e.myelin,
        delayMs: elapsed + latency * hop,
        level: r4(Math.abs(contrib)), sign: contrib >= 0 ? 1 : -1,
      });
    }
    elapsed += 12;
    levels = next;
  }
  const touched = Object.values(levels).filter((v) => v >= threshold).length;
  return {
    levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, r4(v)])),
    pulses, totalMs: Math.max(...pulses.map((p) => p.delayMs), 0), touched,
  };
}

/** 把八阶段结果折算为脑区激活（供 3D 大脑点亮）。 */
export function stageActivation(brainActivation = []) {
  const out = {};
  for (const a of brainActivation) {
    if (!REGION_KEYS.includes(a.region)) continue;
    out[a.region] = r4(Math.max(out[a.region] || 0, clamp01(a.level)));
  }
  return out;
}

/**
 * 默认网络自发漫游 —— 「自主思考循环」的确定性内核。
 * 每次 tick 从 DMN 及其直连区中选一个种子，跑一次短程扩散，并产出一条
 * 可观测的思维事件（不是随机噪声：种子与扩散结果完全由 tick 决定，可回放）。
 */
export function idleWander(tick = 0, opts = {}) {
  const rnd = mulberry32((Number(tick) || 0) * 2654435761 + 12345);
  const dmnLinks = SYNAPSES.filter((e) => e.from === 'dmn' || e.to === 'dmn');
  const candidates = [...new Set(dmnLinks.flatMap((e) => [e.from, e.to]))].filter((k) => REGION_KEYS.includes(k));
  const seed = candidates.length ? candidates[Math.floor(rnd() * candidates.length)] : 'dmn';
  const spread = spreadActivation({ [seed]: 0.55 + rnd() * 0.3, dmn: 0.5 }, { steps: opts.steps ?? 2 });
  const top = Object.entries(spread.levels).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k);
  return {
    tick, seed, top,
    levels: spread.levels, pulses: spread.pulses,
    pulseCount: spread.pulses.length,
    thought: {
      kind: 'idle_association',
      seedRegion: seed,
      regions: top,
      note: '空闲期默认网络自发联想：沿真实连接组扩散，未调用任何外部模型；结果仅登记为待验证线索',
    },
  };
}

/** 结构自检：轴突端点、潜伏期、区域元数据闭合。 */
export function selfCheck() {
  const keys = new Set(REGION_KEYS);
  const dangling = SYNAPSES.filter((e) => !keys.has(e.from) || !keys.has(e.to));
  const badLatency = SYNAPSES.filter((e) => !(Number(e.latency_ms) > 0));
  const missingMeta = REGION_KEYS.filter((k) => !CONNECTOME.regionMeta[k]);
  return {
    ok: !dangling.length && !badLatency.length && !missingMeta.length,
    dangling: dangling.length, badLatency: badLatency.length, missingMeta,
    stats: {
      regions: REGION_KEYS.length,
      synapses: SYNAPSES.length,
      excitatory: SYNAPSES.filter((e) => e.type === 'excitatory').length,
      inhibitory: SYNAPSES.filter((e) => e.type === 'inhibitory').length,
      myelinated: SYNAPSES.filter((e) => e.myelin).length,
      assemblies: Object.keys(CONNECTOME.assemblies).length,
    },
  };
}
