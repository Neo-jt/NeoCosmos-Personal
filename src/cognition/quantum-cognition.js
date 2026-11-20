// 量子认知层（QUANTUM-COGNITION BRIDGE）· v6.6.0
// ---------------------------------------------------------------------------
// 把「量子物理启发式算法」从桌面精灵的装饰动画，升级为 3D 智脑里一层**真实参与
// 计算**的认知算子。它不是量子硬件，也不是玄学；它是可复现、可审计的确定性算法：
//
//   ① 态制备：以 30 个真实解剖脑区为基 |i⟩，复振幅 αᵢ 由「演化序号 + 自主心跳数」
//      哈希播种（同一状态 → 同一态 → 完全可复现）；五条通道是五类认知模态。
//   ② 纠缠：沿 本项目自研认知规格 编译出的 183 条真实轴突做振幅交换（量子游走式干涉）。
//      v6.6.0 修复了 quantum-mind.js 的字段名错配，这一步才真的用上连接组。
//   ③ 酉式演化：相位旋转 + 连接组调制耦合，每步重归一化，保 Σ|αᵢ|² = 1。
//   ④ 测量：按 Born 规则 |αᵢ|² 确定性采样坍缩到某个脑区。
//   ⑤ 回灌智脑：坍缩脑区与其一跳轴突邻居得到激活 levels，沿真实 latency_ms
//      生成轴突脉冲 pulses，交给 3D 脑回放；未坍缩的高概率分量保留微弱激活，
//      直观呈现「叠加态的其余分量」。
//
// 边界（必须在界面显著位置如实标注）：
//   · 全程为本机 CPU 上的经典符号模拟，非真实量子计算，不宣称加速或超越人类认知；
//   · 量子层只决定「联想路径如何被采样与点亮」，**不改变**法律思维八阶段的结论、
//     证据分级、置信度或任何写入知识库的内容；
//   · 所有数字（概率 / 熵 / 归一化 / 耦合边数 / 脉冲延迟）均来自运行时真实计算。
import { ANATOMY, CONNECTOME } from './anatomy.js';
import { QUANTUM_BOUNDARY, CHANNELS } from './quantum-mind.js';

export const QUANTUM_COGNITION_BOUNDARY = [
  '这是运行在本机 CPU 上的确定性算法：叠加态 / 纠缠 / 酉演化 / Born 规则坍缩均为经典符号模拟，非真实量子计算',
  '基态来自 30 个真实解剖脑区，纠缠耦合来自 183 条真实轴突，脉冲时序来自连接组 latency_ms',
  '量子层只采样「联想路径」并点亮脑区，不改变法律思维八阶段的证据分级、结论或置信度，也不写入知识库',
  '无模型、无网络、无意识；同一心跳状态可复现，可审计',
].join('；');

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const r3 = (x) => Math.round(Number(x) * 1e3) / 1e3;

/** 从解剖依据里取一个简短中文名，避免界面显示一长串说明文字。 */
function shortName(r) {
  const head = String(r.basis || r.key).split(/[：:]/)[0];
  return head.replace(/（.*$/, '').slice(0, 12) || r.key;
}

export function createQuantumCognition({ quantum, organism, connectome, anatomy } = {}) {
  if (!quantum) throw new Error('量子认知层需要 createQuantumMind 实例');
  const regions = (anatomy || ANATOMY).regions;
  const synapses = (connectome || CONNECTOME).synapses;
  // 五个认知模态均匀铺在 30 个脑区上，保证通道概率图始终有五个非零分量
  const items = regions.map((r, i) => ({
    id: r.key,
    text: `${shortName(r)} · ${r.key}`,
    channel: i % CHANNELS.length,
  }));
  const nameOf = new Map(items.map((x) => [x.id, x.text]));
  let org = organism || null;   // 自主内核可能晚于量子层初始化，允许运行时补挂
  let bound = false;
  let steps = 0;
  let lastResult = null;

  function setOrganism(o) { org = o || null; }

  /** 一次完整量子认知步：制备 → 纠缠 → 酉演化 → Born 测量 → 回灌脑区与脉冲。 */
  function run() {
    const heartbeat = Number(org?.status?.()?.heartbeats ?? 0);
    const seed = `brain|${steps}|hb${heartbeat}`;
    quantum.prepare(seed, items);
    quantum.entangle(6);
    quantum.evolve(8);
    const m = quantum.measure();
    steps++;

    const collapsedId = m.id;
    const probs = m.probabilities || [];
    const levels = {};
    // 坍缩脑区：最强激活；未坍缩的高概率分量保留微弱激活（叠加态的其余分量）
    levels[collapsedId] = clamp01(0.42 + (m.probability || 0) * 2.2);
    for (const t of (m.top || [])) {
      levels[t.id] = Math.max(levels[t.id] || 0, clamp01(0.14 + t.prob * 1.6));
    }
    // 沿真连接组一跳扩散：权重、抑制性符号都来自真源
    const pulses = [];
    for (const e of synapses) {
      const touches = e.from === collapsedId || e.to === collapsedId;
      if (!touches) continue;
      const w = Number(e.w) || 0;
      const latency = Math.max(1, Math.round(Number(e.latency_ms) || 8));
      const level = r3(clamp01(Math.abs(w) * (0.32 + (m.probability || 0) * 1.4)));
      const nb = e.from === collapsedId ? e.to : e.from;
      levels[nb] = Math.max(levels[nb] || 0, clamp01(level * 0.9));
      pulses.push({
        from: e.from, to: e.to, w, type: e.type, tract: e.tract,
        latency_ms: latency, myelin: !!e.myelin,
        delayMs: latency, level, sign: w >= 0 ? 1 : -1,
      });
    }
    // top-3 分量之间若存在真实轴突，也点亮一条，呈现纠缠耦合
    const topIds = new Set((m.top || []).map((t) => t.id));
    for (const e of synapses) {
      if (!topIds.has(e.from) || !topIds.has(e.to)) continue;
      if (e.from === collapsedId || e.to === collapsedId) continue;
      const latency = Math.max(1, Math.round(Number(e.latency_ms) || 8));
      pulses.push({
        from: e.from, to: e.to, w: Number(e.w) || 0, type: e.type, tract: e.tract,
        latency_ms: latency, myelin: !!e.myelin,
        delayMs: latency + 12, level: 0.16, sign: 1,
      });
    }

    const qs = quantum.status();
    const payload = {
      seed,
      step: steps,
      heartbeat,
      trace: m.trace,                 // 五通道概率 / 熵 / 振幅 / 峰值 / 坍缩点 / 边界
      collapsed: {
        id: collapsedId,
        name: nameOf.get(collapsedId) || collapsedId,
        probability: r3(m.probability || 0),
        channel: m.channel,
        channelLabel: CHANNELS[m.channel]?.label || '—',
        channelHex: CHANNELS[m.channel]?.hex || '#6BD0FF',
      },
      top: (m.top || []).map((t) => ({
        id: t.id, name: nameOf.get(t.id) || t.id, prob: r3(t.prob), channel: t.channel,
      })),
      levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, r3(v)])),
      pulses,
      audit: {
        basisCount: qs.basisCount,
        coupledEdges: qs.coupledEdges,
        connectomeEdges: qs.connectomeEdges,
        norm: r3(quantum.normValue()),
        entropyBits: m.entropy?.bits ?? m.trace?.entropy?.bits ?? null,
        reproducible: true,
      },
      boundary: QUANTUM_COGNITION_BOUNDARY,
      quantumBoundary: QUANTUM_BOUNDARY,
    };
    lastResult = payload;
    return payload;
  }

  function setBound(on) { bound = !!on; return bound; }
  function status() {
    const qs = quantum.status();
    return {
      bound,
      steps,
      basisCount: items.length,
      coupledEdges: qs.coupledEdges,
      connectomeEdges: qs.connectomeEdges,
      channels: CHANNELS.map((c) => ({ key: c.key, label: c.label, hex: c.hex })),
      boundary: QUANTUM_COGNITION_BOUNDARY,
      lastTrace: lastResult?.trace || qs.lastTrace || null,
      lastCollapsed: lastResult?.collapsed || null,
      lastAudit: lastResult?.audit || null,
    };
  }

  return { run, status, setBound, setOrganism, get bound() { return bound; }, get items() { return items; } };
}
