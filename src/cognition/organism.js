// 自主认知循环（ORGANISM）
// ---------------------------------------------------------------------------
// 「活体系统」是产品隐喻，其**真实工程内涵**只有下面四件事，全部可观测、可验证：
//   ① 持久状态：心跳、思维史、经验卡、开放假设、校准权重落盘；
//   ② 自主循环：开关打开后，空闲期默认网络（DMN）沿真实连接组自发激活扩散，
//      每次产生一条可回放的思维事件（确定性 PRNG，同 tick 结果恒定）；
//   ③ 反馈学习：用户对结论的对/错反馈真实改变来源等级权重（calibrate）；
//   ④ 生长：每次问答沉淀经验卡，假设池随使用累积，不覆盖任何用户正文。
//
// 明确边界：本模块是确定性状态机，不具备生物生命、意识、自我认知或主观体验；
// 所有计算在本机 CPU 上串行执行，不存在「超越 CPU 限制」。界面与文档必须如实标注。
import { idleWander } from './connectome-activation.js';
import { calibrate, GRADE_WEIGHT_DEFAULT } from './calibration.js';

export const ORGANISM_BOUNDARY = [
  '确定性状态机 · 无模型 / 无网络 / 无外部调用',
  '不具备生物生命、意识或主观体验；「活体」仅为可解释的产品隐喻',
  '受本机 CPU 算力约束，不宣称超越硬件或超越人类认知',
  '所有思维事件可回放、可审计、可一键关闭',
].join('；');

const SCHEMA = 1;
const MAX_THOUGHTS = 120;
const MAX_EXPERIENCES = 200;
const MAX_HYPOTHESES = 80;

function blank(nowIso) {
  return {
    schema: SCHEMA,
    bornAt: nowIso,
    lastActiveAt: nowIso,
    heartbeats: 0,
    thoughts: [],
    experiences: [],
    hypotheses: [],
    gradeTable: { ...GRADE_WEIGHT_DEFAULT },
    autonomous: false,
    feedback: { total: 0, positive: 0, negative: 0 },
  };
}

/**
 * @param {object} deps
 * @param {{read:()=>object|null, write:(s:object)=>void}} deps.storage 持久化注入
 * @param {()=>string} [deps.now] ISO 时间源（便于测试）
 */
export function createOrganism({ storage, now } = {}) {
  const clock = now || (() => new Date().toISOString());
  const store = storage || { read: () => null, write: () => {} };
  let state;
  try {
    const saved = store.read();
    state = saved && saved.schema === SCHEMA ? { ...blank(clock()), ...saved } : blank(clock());
  } catch (e) {
    state = blank(clock());
  }
  // 补齐可能被旧版本缺字段的状态（向前兼容，不丢历史）
  state.gradeTable = { ...GRADE_WEIGHT_DEFAULT, ...(state.gradeTable || {}) };
  state.thoughts = Array.isArray(state.thoughts) ? state.thoughts : [];
  state.experiences = Array.isArray(state.experiences) ? state.experiences : [];
  state.hypotheses = Array.isArray(state.hypotheses) ? state.hypotheses : [];
  state.feedback = { total: 0, positive: 0, negative: 0, ...(state.feedback || {}) };

  function persist() {
    state.lastActiveAt = clock();
    try { store.write(state); } catch (e) { /* 落盘失败不阻断思维，状态仍在内存 */ }
  }

  /** 一次自主心跳：DMN 自发联想 → 登记思维事件 → 可能生成一条开放线索。 */
  function tick(force = false) {
    if (!state.autonomous && !force) return { skipped: true, reason: 'autonomous_off' };
    state.heartbeats++;
    const wander = idleWander(state.heartbeats);
    const at = clock();
    const event = {
      id: `T${state.heartbeats}`,
      tick: state.heartbeats,
      at,
      kind: 'idle_association',
      seedRegion: wander.seed,
      regions: wander.top,
      pulseCount: wander.pulseCount,
      note: wander.thought.note,
      reproducible: true,
    };
    state.thoughts.push(event);
    if (state.thoughts.length > MAX_THOUGHTS) state.thoughts = state.thoughts.slice(-MAX_THOUGHTS);

    // 自发联想只在「有新区域组合」时登记为待验证线索，避免刷屏
    const sig = wander.top.join(',');
    if (!state.hypotheses.some((h) => h.sig === sig) && wander.top.length >= 2) {
      state.hypotheses.push({
        id: `AUTO-${state.heartbeats}`,
        sig,
        text: `默认网络自发关联：${wander.top.join(' → ')} 之间可能存在尚未显式建边的语义联系`,
        basis: ['connectome.idle_wander'],
        verify: '在知识库中检索这些脑区对应的概念卡，确认是否存在可建立的显式关联边',
        status: '开放',
        origin: 'autonomous',
        at,
      });
      if (state.hypotheses.length > MAX_HYPOTHESES) state.hypotheses = state.hypotheses.slice(-MAX_HYPOTHESES);
    }
    persist();
    return { skipped: false, event, pulses: wander.pulses, levels: wander.levels, newHypothesis: sig };
  }

  /** 反馈学习：真实修改来源等级权重，返回变更前后值供界面展示。 */
  function learn(grade, good) {
    const before = { ...state.gradeTable };
    state.gradeTable = calibrate(state.gradeTable, grade, !!good);
    state.feedback.total++;
    if (good) state.feedback.positive++; else state.feedback.negative++;
    const key = String(grade || 'C').toUpperCase();
    const delta = Math.round((state.gradeTable[key] - (before[key] ?? 0)) * 1e4) / 1e4;
    persist();
    return { grade: key, before: before[key], after: state.gradeTable[key], delta, feedback: { ...state.feedback } };
  }

  /** 经验卡沉淀：只追加，绝不写回或覆盖用户正文。 */
  function sediment({ question, answer, cited = [], confidence = 0, action = '' }) {
    const rec = {
      id: `E${state.experiences.length + 1}-${Date.now().toString(36)}`,
      at: clock(),
      question: String(question || '').slice(0, 300),
      answer: String(answer || '').slice(0, 800),
      citedCount: cited.length,
      cited: cited.slice(0, 8),
      confidence,
      action,
      origin: 'legal_mind_qa',
    };
    state.experiences.push(rec);
    if (state.experiences.length > MAX_EXPERIENCES) state.experiences = state.experiences.slice(-MAX_EXPERIENCES);
    persist();
    return rec;
  }

  function setAutonomous(on) {
    state.autonomous = !!on;
    persist();
    return state.autonomous;
  }

  function status() {
    return {
      schema: SCHEMA,
      bornAt: state.bornAt,
      lastActiveAt: state.lastActiveAt,
      heartbeats: state.heartbeats,
      autonomous: state.autonomous,
      thoughtCount: state.thoughts.length,
      experienceCount: state.experiences.length,
      openHypotheses: state.hypotheses.filter((h) => h.status === '开放').length,
      gradeTable: { ...state.gradeTable },
      feedback: { ...state.feedback },
      recentThoughts: state.thoughts.slice(-12).reverse(),
      recentExperiences: state.experiences.slice(-6).reverse(),
      boundary: ORGANISM_BOUNDARY,
    };
  }

  return {
    tick, learn, sediment, setAutonomous, status,
    get state() { return state; },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    restore: (s) => { if (s && s.schema === SCHEMA) { state = { ...blank(clock()), ...s }; persist(); return true; } return false; },
  };
}
