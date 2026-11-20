// 八阶段认知工作流引擎（深加工版）
// ---------------------------------------------------------------------------
// PHASES / 六大器官表由本项目自研认知规格定义
// 本文件新增（原 Python 侧只有静态 trace 校验，没有可执行的阶段引擎）：
//   · runWorkflow() —— 真正按八阶段顺序执行处理器，逐站记录**真实毫秒耗时**、
//     主导器官、解剖脑区、交付物与降级标记；支持 onStage 流式外吐给思维窗；
//   · PHASE_REGIONS / ORGAN_REGION —— 把每个认知器官挂回 本项目自研认知规格
//     anatomy3d 里的真实 Brodmann 坐标区（不是抽象球壳）；
//   · 阶段异常降级不中断全过程，且降级如实记录（不许假装成功）。
//
// 边界：确定性状态机，逐站耗时来自系统时钟；不是并行超越 CPU 的"超级计算"。
import { COGNITION, ANATOMY } from './anatomy.js';

export const PHASES = COGNITION.phases;
export const ORGANS = COGNITION.organs;

// 器官 → 解剖脑区（key 必须与 ANATOMY.regions 一致，由 selfCheck 钉死）
export const ORGAN_REGION = {
  '元认知': ['metacog', 'pfc'],
  '双轨推理': ['pfc', 'strategy'],
  '对抗辩论': ['ofc', 'acc'],
  '假设台账': ['limbic', 'plastic'],
  '概念图谱': ['atl', 'lexmind'],
  '置信校准': ['metacog', 'acc'],
};

// 阶段 → 主导解剖脑区（比器官更细，用于 3D 点亮的时序）
export const PHASE_REGIONS = {
  recall: ['thalamus', 'wernicke', 'dmn'],
  triage: ['metacog', 'pfc', 'acc'],
  research: ['wernicke', 'lexmind', 'atl'],
  reason: ['pfc', 'evidence', 'strategy'],
  adversarial: ['ofc', 'acc', 'tpj'],
  hypothesis: ['limbic', 'plastic', 'rsc'],
  synthesize: ['adjudication', 'workspace', 'cerebellum'],
  precipitate: ['plastic', 'express', 'sma'],
};

const now = () => (globalThis.performance?.now?.() ?? Date.now());
const r2 = (x) => Math.round(x * 100) / 100;

export function regionsForPhase(key) {
  const p = PHASES.find((x) => x.key === key);
  const byOrgan = p ? ORGAN_REGION[p.organ] || [] : [];
  return [...new Set([...(PHASE_REGIONS[key] || []), ...byOrgan])];
}

export function makeStep({ phase, organ, text, nodes = [], confidence = '', evidence = '' }) {
  const valid = ORGANS.some((o) => o.name === organ);
  const step = {
    phase, organ: valid ? organ : (PHASES.find((p) => p.key === phase)?.organ || '元认知'),
    text: String(text || ''), nodes: [...nodes],
  };
  if (confidence) step.confidence = confidence;
  if (evidence) step.evidence = evidence;
  return step;
}

export function validateTrace(trace) {
  const errs = [];
  if (!trace || !Array.isArray(trace.steps) || !trace.steps.length) return { ok: false, errs: ['推理链为空或 steps 缺失'] };
  const knownOrgans = new Set(ORGANS.map((o) => o.name));
  trace.steps.forEach((st, i) => {
    if (!String(st.phase || '').trim()) errs.push(`step[${i}] 缺少 phase`);
    if (st.organ && !knownOrgans.has(st.organ)) errs.push(`step[${i}] organ '${st.organ}' 不在六大器官中`);
  });
  return { ok: errs.length === 0, errs };
}

export function traceTimeline(trace) {
  return (trace?.steps || []).map((st, i) => ({
    i: i + 1, phase: st.phase, organ: st.organ, text: st.text,
    nodes: st.nodes || [], ms: st.ms, regions: st.regions || [],
  }));
}

/**
 * 顺序执行八阶段。
 * @param {object} handlers  { [phaseKey]: (ctx) => ({text, nodes, ...}) | Promise }
 * @param {object} opts      { seed, onStage, signal }
 * @returns {Promise<{trace, stages, brainActivation, totalMs, ok}>}
 */
export async function runWorkflow(handlers = {}, opts = {}) {
  const t0 = now();
  const ctx = { ...(opts.seed || {}) };
  const stages = [], steps = [], brainActivation = [];

  for (const phase of PHASES) {
    if (opts.signal?.aborted) break;
    const ts = now();
    const regions = regionsForPhase(phase.key);
    const fn = handlers[phase.key];
    let out = {}, degraded = false, error = '';
    try {
      out = fn ? await fn(ctx) : {};
      if (out && typeof out === 'object') ctx[phase.key] = out;
    } catch (e) {
      degraded = true;
      error = String(e?.message || e);
      out = { text: `本阶段未能完成：${error}（已降级继续，不伪造结果）` };
    }
    const ms = r2(now() - ts);
    const organ = phase.organ;
    const text = String(out?.text || phase.deliver);
    const nodes = Array.isArray(out?.nodes) ? out.nodes : [];
    steps.push({ ...makeStep({ phase: phase.key, organ, text, nodes, confidence: out?.confidence, evidence: out?.evidence }), ms, regions, degraded, error });
    const stage = {
      key: phase.key, name: phase.name, organ, deliver: phase.deliver,
      regions, ms, degraded, error, text, nodes,
      data: out?.data ?? null,
    };
    stages.push(stage);
    // 激活强度：由该阶段**真实涉及的知识节点数**与产物决定，而非代码耗时。
    // 用耗时当激活度会把「机器慢」误显示成「脑区活跃」，且破坏确定性。
    const level = degraded ? 0.25
      : Math.min(1, 0.45 + Math.min(0.4, nodes.length * 0.12) + (stage.data ? 0.1 : 0));
    for (const r of regions) brainActivation.push({ region: r, phase: phase.key, organ, level, ms });
    if (typeof opts.onStage === 'function') {
      try { opts.onStage(stage); } catch (e) { /* 展示层异常不影响内核 */ }
    }
  }

  const totalMs = r2(now() - t0);
  const trace = { steps, totalMs, phaseCount: PHASES.length };
  return { trace, stages, steps, brainActivation, totalMs, ok: stages.every((s) => !s.degraded) };
}

/**
 * 同步版执行器 —— 引擎工具 callTool() 是同步契约（CLI / MCP / 桌面壳共用），
 * 不能整体改成 async；这里复用同一套 PHASES / regionsForPhase / makeStep，
 * 只把「等待」去掉，保证思维链的阶段、耗时、脑区映射与异步版完全一致。
 */
export function runWorkflowSync(handlers = {}, opts = {}) {
  const t0 = now();
  const ctx = { ...(opts.seed || {}) };
  const stages = [], steps = [], brainActivation = [];
  for (const phase of PHASES) {
    if (opts.signal?.aborted) break;
    const ts = now();
    const regions = regionsForPhase(phase.key);
    const fn = handlers[phase.key];
    let out = {}, degraded = false, error = '';
    try {
      out = fn ? fn(ctx) : {};
      if (out && typeof out === 'object') ctx[phase.key] = out;
    } catch (e) {
      degraded = true; error = String(e?.message || e);
      out = { text: `本阶段未能完成：${error}（已降级继续，不伪造结果）` };
    }
    const ms = r2(now() - ts);
    const text = String(out?.text || phase.deliver);
    const nodes = Array.isArray(out?.nodes) ? out.nodes : [];
    steps.push({ ...makeStep({ phase: phase.key, organ: phase.organ, text, nodes, confidence: out?.confidence, evidence: out?.evidence }), ms, regions, degraded, error });
    const stage = {
      key: phase.key, name: phase.name, organ: phase.organ, deliver: phase.deliver,
      regions, ms, degraded, error, text, nodes, data: out?.data ?? null,
    };
    stages.push(stage);
    // 与异步版一致：激活度由真实涉及的节点数与产物决定，绝不使用耗时
    const level = degraded ? 0.25
      : Math.min(1, 0.45 + Math.min(0.4, nodes.length * 0.12) + (stage.data ? 0.1 : 0));
    for (const r of regions) brainActivation.push({ region: r, phase: phase.key, organ: phase.organ, level, ms });
    if (typeof opts.onStage === 'function') { try { opts.onStage(stage); } catch (e) { /* ignore */ } }
  }
  const totalMs = r2(now() - t0);
  const trace = { steps, totalMs, phaseCount: PHASES.length };
  return { trace, stages, steps, brainActivation, totalMs, ok: stages.every((s) => !s.degraded) };
}

/** 结构自检：所有映射的脑区都必须在解剖真源里存在。 */
export function selfCheck() {
  const keys = new Set(ANATOMY.regions.map((r) => r.key));
  const mapped = new Set([...Object.values(ORGAN_REGION).flat(), ...Object.values(PHASE_REGIONS).flat()]);
  const unknown = [...mapped].filter((k) => !keys.has(k));
  const missingPhases = PHASES.map((p) => p.key).filter((k) => !PHASE_REGIONS[k]);
  const missingOrgans = PHASES.map((p) => p.organ).filter((o) => !ORGAN_REGION[o]);
  return {
    ok: !unknown.length && !missingPhases.length && !missingOrgans.length,
    unknownRegions: unknown, missingPhases, missingOrgans,
    stats: { phases: PHASES.length, mappedRegions: mapped.size, anatomyRegions: keys.size },
  };
}
