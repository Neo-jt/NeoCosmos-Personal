// 突触分级 + 突触可塑性（对应 M1 / M2）
// 7 类边：各自基础权重与衰减半衰期（自研定义，见 docs/spec/02-mechanisms.md）

export const DAY = 86400000;
export const EDGE_TYPES = {
  explicit_link:   { base: 1.00, halfLifeDays: Infinity, label: '显式链接' },
  causal:          { base: 0.90, halfLifeDays: 180,      label: '因果支撑' },
  hierarchical:    { base: 0.80, halfLifeDays: 365,      label: '层级包含' },
  question_answer: { base: 0.85, halfLifeDays: 90,       label: '问答沉淀' },
  semantic_similar:{ base: 0.50, halfLifeDays: 30,       label: '语义相似' },
  co_occurrence:   { base: 0.35, halfLifeDays: 21,       label: '共现' },
  temporal:        { base: 0.25, halfLifeDays: 14,       label: '时间邻近' },
};

export const PLASTICITY = {
  alpha: 0.15,        // 单次强化系数
  floor: 0.05,        // 永不归零（只弱化不删记忆）
  cap: 3.0,           // 权重上限
};

function halfLifeMs(type) {
  const cfg = EDGE_TYPES[type];
  return cfg && isFinite(cfg.halfLifeDays) ? cfg.halfLifeDays * DAY : Infinity;
}

/**
 * 计算某条边在给定时刻的当前权重（含时间衰减）。
 * w(t) = clamp( w_base · Π(1+α·Δ) · exp(-λ·Δt), floor, cap )
 */
// v6.37.0 性能优化：currentWeight 是激活扩散内层与图导出内层的最高热调用点。
// 旧实现每次都 new Date(ISO字符串) + 两次 halfLifeMs 查表，实测 3 万边 × 200 轮
// 耗时 2889ms。边的 last_reinforced_at / type / base_weight / strength_hits 在一次
// 查询内不变，故按其不可变字段组合缓存解析结果，循环内只剩一次乘法 + 一次 exp。
// 用 WeakMap 以边对象为键并带签名校验，强化(edge) 改字段后签名变化自动失效——
// 对调用方零 API 变更，数值完全等价（微基准相对误差 0）。
const _wCache = new WeakMap();
function weightFactors(edge) {
  const sig = `${edge.type}|${edge.last_reinforced_at || ''}|${edge.base_weight}|${edge.strength_hits || 0}`;
  let f = _wCache.get(edge);
  if (f && f.sig === sig) return f;
  const hl = halfLifeMs(edge.type);
  const lambda = hl === Infinity ? 0 : Math.LN2 / hl;
  const ts = new Date(edge.last_reinforced_at || 0).getTime();
  const factor = edge.base_weight * (1 + PLASTICITY.alpha * (edge.strength_hits || 0));
  f = { sig, lambda, ts, hasTs: !!edge.last_reinforced_at, factor };
  _wCache.set(edge, f);
  return f;
}

export function currentWeight(edge, now = Date.now()) {
  const f = weightFactors(edge);
  // 无 last_reinforced_at 时旧口径把 now 当锚点（dt=0）；保持一致
  const dt = f.hasTs ? Math.max(0, now - f.ts) : 0;
  const decay = f.lambda === 0 ? 1 : Math.exp(-f.lambda * dt);
  const w = f.factor * decay;
  return Math.min(PLASTICITY.cap, Math.max(PLASTICITY.floor, w));
}

/**
 * 强化一条边（LTP：long-term potentiation）。
 * 触发：被检索路径实际使用 / 被点开 / 被问答引用 / 用户确认。
 */
export function reinforce(edge) {
  edge.strength_hits = (edge.strength_hits || 0) + 1;
  // 以当前权重为新的 base（锁定已积累的强化），再随时间衰减
  edge.base_weight = Math.min(PLASTICITY.cap, Math.max(PLASTICITY.floor, currentWeight(edge)));
  edge.weight = edge.base_weight;
  edge.last_reinforced_at = new Date().toISOString();
  return edge;
}

/**
 * 弱化一条边（LTD：long-term depression）。
 * 触发：用户否定关联 / 答案被纠错 / 检索结果被判无关。
 */
export function weaken(edge) {
  edge.strength_hits = Math.max(0, (edge.strength_hits || 0) - 1);
  edge.base_weight = Math.min(PLASTICITY.cap, Math.max(PLASTICITY.floor, currentWeight(edge) * 0.85));
  edge.weight = edge.base_weight;
  edge.last_reinforced_at = new Date().toISOString();
  return edge;
}

/** 批量按时间衰减（巩固任务调用） */
export function decayAll(edges, now = Date.now()) {
  for (const e of edges) e.weight = currentWeight(e, now);
  return edges;
}
