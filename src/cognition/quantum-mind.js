// 量子物理「启发式」认知引擎（QUANTUM-COGNITION）
// ---------------------------------------------------------------------------
// 「量子物理构架」的真实工程内涵（全部可观测、可验证）：
//   ① 态 |ψ⟩ = Σ αᵢ |i⟩，αᵢ 为复振幅，归一化 Σ|αᵢ|² = 1（Born 归一）；
//   ② 五条「色系通道」对应五脑议会的五类认知模态（金=支持 / 粉=质疑 /
//      蓝=规范检索 / 绿=实务推演 / 紫=裁判裁量）；
//   ③ 连接组（30 真实脑区 / 183 轴突）作为**纠缠耦合图**：相邻脑区振幅相干，
//      表现为沿轴突的振幅交换（量子游走式干涉）；
//   ④ 演化 = 酉式相位旋转 + 受连接组调制的干涉，每步重归一化（保 Born 归一）；
//   ⑤ 测量 = 按 Born 规则 |αᵢ|² 采样坍缩，输出最可能思维路径 + 冯·诺依曼式熵。
//
// 确定性：全部由「问题文本哈希」播种的 PRNG 驱动，同一问题 → 同一态 → 可复现。
// 边界：纯 CPU 经典模拟，**非真实量子计算**；不宣称超越硬件或超越人类认知。
//      界面与文档必须如实标注。这与 6.2.0 抗量子密码层（QS-Shield）同一纪律。
import { CONNECTOME, ANATOMY } from './anatomy.js';

export const QUANTUM_BOUNDARY = [
  '量子物理「启发式」构架：本机 CPU 经典模拟叠加态 / 纠缠 / 酉演化 / Born 规则坍缩，非真实量子计算',
  '全部计算在本机 CPU 串行执行，不宣称超越硬件或超越人类认知',
  '五条色系通道对应五脑议会的五类认知模态（金 / 粉 / 蓝 / 绿 / 紫）',
  '连接组（30 真实脑区 / 183 轴突）作为纠缠耦合图；测量按 Born 规则坍缩，可复现、可审计',
].join('；');

export const CHANNELS = [
  { key: 'gold',   label: '金 · 支持论证', color: 0xFFD66B, hex: '#FFD66B' },
  { key: 'pink',   label: '粉 · 质疑反驳', color: 0xFF9ED2, hex: '#FF9ED2' },
  { key: 'blue',   label: '蓝 · 规范检索', color: 0x6BD0FF, hex: '#6BD0FF' },
  { key: 'green',  label: '绿 · 实务推演', color: 0x8FF0B0, hex: '#8FF0B0' },
  { key: 'purple', label: '紫 · 裁判裁量', color: 0xC79BFF, hex: '#C79BFF' },
];

// ---------------- 确定性 PRNG（mulberry32） ----------------
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 复振幅：re / im 两个 Float64Array
function norm(re, im) {
  let s = 0;
  for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i];
  return Math.sqrt(s) || 1;
}
function renormalize(re, im) {
  const n = norm(re, im);
  for (let i = 0; i < re.length; i++) { re[i] /= n; im[i] /= n; }
}

export function createQuantumMind(opts = {}) {
  // 连接组：优先用真源编译的连接组（30 区 / 183 轴突）；缺省则用合成环图。
  const conn = opts.connectome || CONNECTOME || null;
  // v6.6.0 真实缺陷修复：本项目自研认知规格 编译出的连接组字段是 {from,to,w,latency_ms}，
  // 旧代码只读 {src,dst,weight}，结果 a/b 全为 "undefined" → ids.has() 恒 false
  // → 183 条真实轴突**从未参与纠缠**，每次都退化成「合成近邻环」。
  // 现在兼容两套命名，量子游走才真的跑在解剖连接组上。
  const edges = Array.isArray(conn?.synapses)
    ? conn.synapses.map((e) => ({
      a: String(e.src ?? e.from ?? ''),
      b: String(e.dst ?? e.to ?? ''),
      w: Number(e.weight ?? e.w ?? 1),
    }))
    : null;

  let basis = [];          // [{ id, text, channel }]
  let re = new Float64Array(0), im = new Float64Array(0);
  let adjacency = new Map(); // id -> [{ to, w }]
  let indexById = new Map(); // v6.6.0：step 里 O(1) 查基，替代逐次 findIndex
  let coupledEdges = 0;      // 真正落在基底上的连接组边数（可审计）
  let rng = mulberry32(1);
  let lastText = '';
  let lastTrace = null;

  function buildAdjacency() {
    adjacency = new Map();
    coupledEdges = 0;
    const add = (a, b, w) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a).push({ to: b, w });
    };
    indexById = new Map(basis.map((b, i) => [b.id, i]));
    if (edges && basis.length) {
      for (const e of edges) {
        if (indexById.has(e.a) && indexById.has(e.b)) {
          add(e.a, e.b, e.w); add(e.b, e.a, e.w); coupledEdges++;
        }
      }
    }
    // 若连接组没覆盖到，则补一条合成近邻环，保证每个基都有耦合
    for (let i = 0; i < basis.length; i++) {
      const id = basis[i].id;
      if (!adjacency.has(id) || !adjacency.get(id).length) {
        const j = (i + 1) % basis.length;
        add(id, basis[j].id, 1); add(basis[j].id, id, 1);
      }
    }
  }

  function ensureBasis(text, items) {
    const t = String(text || '');
    if (t === lastText && basis.length && (!items || items.length === basis.length)) return;
    lastText = t;
    rng = mulberry32(hashStr(t || 'idle') ^ 0x9e3779b9);
    if (items && items.length) {
      basis = items.map((it, i) => ({
        id: String(it.id != null ? it.id : `L${i}`),
        text: String(it.text || it.title || `潜态 ${i}`),
        channel: Math.max(0, Math.min(4, it.channel != null ? it.channel : Math.floor(rng() * 5))),
      }));
    } else {
      // 无知识库时：合成 8 个漫游潜态，保证精灵也能「量子漫游」
      const labels = ['静思', '联想', '回溯', '推演', '对照', '凝练', '悬置', '涌现'];
      basis = labels.map((lab, i) => ({
        id: `idle-${i}`,
        text: `${lab}·漫游`,
        channel: i % 5,
      }));
    }
    const N = basis.length || 1;
    re = new Float64Array(N); im = new Float64Array(N);
    const mag = Math.sqrt(1 / N);
    for (let i = 0; i < N; i++) {
      const ph = rng() * Math.PI * 2;
      re[i] = mag * Math.cos(ph);
      im[i] = mag * Math.sin(ph);
    }
    buildAdjacency();
  }

  /** 准备叠加态（不演化）。 */
  function prepare(text, items) {
    ensureBasis(text, items);
    return trace(false);
  }

  /** 纠缠：沿连接组做量子游走式干涉（相位无关的振幅交换）。 */
  function entangle(steps = 6) {
    for (let s = 0; s < steps; s++) step(0.0);
    return trace(false);
  }

  /** 酉式演化：相位旋转 + 纠缠，每步重归一化。 */
  function evolve(steps = 8) {
    for (let s = 0; s < steps; s++) step(0.18);
    return trace(false);
  }

  // 单步：相位旋转（phaseRate 由 rng 决定，确定性）+ 沿连接组耦合
  function step(rot) {
    const N = re.length;
    if (!N) return;
    // 1) 相位旋转（酉操作，保范）
    for (let i = 0; i < N; i++) {
      const ang = (rot || 0) * (0.6 + rng() * 0.8);
      const c = Math.cos(ang), s = Math.sin(ang);
      const r = re[i], m = im[i];
      re[i] = r * c - m * s;
      im[i] = r * s + m * c;
    }
    // 2) 沿连接组的纠缠耦合（对称振幅交换，近似保范，随后重归一化）
    const dre = new Float64Array(N), dim = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const id = basis[i].id;
      const ns = adjacency.get(id);
      if (!ns) continue;
      for (const { to, w } of ns) {
        const j = indexById.has(to) ? indexById.get(to) : -1;
        if (j < 0) continue;
        const k = Math.min(0.16, 0.08 * Math.abs(w));
        dre[i] += k * (re[j] - re[i]); dim[i] += k * (im[j] - im[i]);
        // 对方在另一循环里处理，避免同一步双重加分（这里只动 i，j 由 j 的循环处理）
      }
    }
    for (let i = 0; i < N; i++) { re[i] += dre[i]; im[i] += dim[i]; }
    renormalize(re, im);
  }

  /** 测量（坍缩）：按 Born 规则 |αᵢ|² 采样。返回坍缩结果与全概率分布。 */
  function measure() {
    const N = re.length;
    const p = probabilitiesRaw();
    // 确定性采样：用 rng 抽一个 0..1，按累积概率落点（可复现）
    const r = rng();
    let acc = 0, idx = N - 1;
    for (let i = 0; i < N; i++) { acc += p[i]; if (r <= acc) { idx = i; break; } }
    const top = [...p.keys()].sort((a, b) => p[b] - p[a]).slice(0, 3)
      .map((i) => ({ index: i, id: basis[i].id, text: basis[i].text, channel: basis[i].channel, prob: p[i] }));
    const tr = trace(true, idx);
    return {
      index: idx, id: basis[idx].id, text: basis[idx].text,
      channel: basis[idx].channel, probability: p[idx],
      probabilities: p, top, entropy: entropyRaw(p), trace: tr,
    };
  }

  /** 自主漂移：演进一步、不坍缩，返回当前最可能潜态（精灵「思考中」用）。 */
  function idleDrift() {
    ensureBasis(lastText || 'idle', null);
    step(0.12);
    return trace(true);
  }

  function probabilitiesRaw() {
    const N = re.length;
    const p = new Array(N);
    let s = 0;
    for (let i = 0; i < N; i++) { p[i] = re[i] * re[i] + im[i] * im[i]; s += p[i]; }
    if (s > 0) for (let i = 0; i < N; i++) p[i] /= s;
    return p;
  }

  function entropyRaw(p) {
    let h = 0;
    for (const x of p) if (x > 1e-12) h -= x * Math.log2(x);
    const max = Math.log2(p.length || 1);
    return { bits: Math.round(h * 1e4) / 1e4, normalized: max > 0 ? Math.round((h / max) * 1e4) / 1e4 : 0 };
  }

  /** 导出可视化轨迹：五通道概率 + 熵 + 峰值 +（可选）坍缩点。 */
  function trace(withPeak, collapsedIndex = -1) {
    const p = probabilitiesRaw();
    const N = p.length;
    const chProb = [0, 0, 0, 0, 0];
    let peakI = 0;
    for (let i = 0; i < N; i++) {
      chProb[basis[i].channel] += p[i];
      if (p[i] > p[peakI]) peakI = i;
    }
    const channels = CHANNELS.map((c, i) => ({
      key: c.key, label: c.label, color: c.color, hex: c.hex, prob: Math.round(chProb[i] * 1e4) / 1e4,
    }));
    const ent = entropyRaw(p);
    const out = {
      channels,
      entropy: ent,
      peakIndex: peakI,
      peakLabel: basis[peakI]?.text || '',
      peakProb: Math.round(p[peakI] * 1e4) / 1e4,
      basisCount: N,
      thinking: true,
      collapsedIndex: collapsedIndex < 0 ? null : collapsedIndex,
      collapsedLabel: collapsedIndex >= 0 ? (basis[collapsedIndex]?.text || '') : null,
      amplitudes: Array.from({ length: N }, (_, i) => Math.round(Math.hypot(re[i], im[i]) * 1e4) / 1e4),
      boundary: QUANTUM_BOUNDARY,
    };
    lastTrace = out;
    return out;
  }

  /** 便捷：思考链（准备→纠缠→演化），用于「思考中」动画；返回 trace。 */
  function think(text, items) {
    prepare(text, items);
    entangle(5);
    return evolve(8);
  }

  function status() {
    return {
      basisCount: basis.length,
      coupledEdges,               // v6.6.0：真实连接组参与纠缠的边数（0 = 退化成合成环）
      connectomeEdges: edges ? edges.length : 0,
      boundary: QUANTUM_BOUNDARY,
      channels: CHANNELS.map((c) => ({ key: c.key, label: c.label, hex: c.hex })),
      lastTrace,
    };
  }

  /** 当前态的真实 Σ|αᵢ|²（未四舍五入），用于保真性自检。 */
  function normValue() { return norm(re, im); }

  return {
    prepare, entangle, evolve, measure, idleDrift, think, trace, status, normValue,
    get basis() { return basis; },
  };
}
