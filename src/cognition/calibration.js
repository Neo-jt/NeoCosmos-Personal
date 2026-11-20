// 置信校准 / 证据分级 / 元认知自检（深加工版）
// ---------------------------------------------------------------------------
// 规则表（A-D 来源等级、高中低文本置信度、七项元认知检查）由本项目自研认知规格定义（见 docs/spec/02-mechanisms.md）
//
// 深加工：
//   · gradeOfHit() 把「来源等级」从人工标注改为**按真实检索信号判定**：
//     种子直接命中 / 激活强度 / 置信度 / 扩散跳数，并附可读理由；
//   · calibrate() 实现反馈驱动的在线学习（权重随对错演化），可持久化、可回放；
//   · confidenceBand() 与 metacogReport() 让「不确定」显式暴露而不被平均掉。
//
// 边界：这是可验证的符号规则与在线参数调整，不是神经网络训练，不代表模型能力。
import { COGNITION } from './anatomy.js';

export const GRADE_WEIGHT_DEFAULT = { ...COGNITION.gradeWeight };
export const CONF_WEIGHT = { ...COGNITION.confidenceWeight };
export const METACOG_CHECKS = COGNITION.metacogChecks;

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * 按真实检索信号判定一条命中的来源等级。
 * A 种子直接命中且激活/置信双高 · B 一跳内且置信尚可 · C 两跳扩散 · D 边缘命中
 */
export function gradeOfHit(hit) {
  const path = Array.isArray(hit?.activation_path) ? hit.activation_path.length : 1;
  const act = clamp01(hit?.activation);
  const conf = clamp01(hit?.confidence);
  let grade, reason;
  if (path === 1 && act >= 0.9 && conf >= 0.6) {
    grade = 'A'; reason = '种子直接命中（无扩散跳数），激活强度与检索置信度双高';
  } else if (path <= 2 && conf >= 0.4) {
    grade = 'B'; reason = '一跳内关联命中，且检索置信度达标';
  } else if (path <= 3 || conf >= 0.25) {
    grade = 'C'; reason = '经多跳扩散联想命中，属间接证据';
  } else {
    grade = 'D'; reason = '边缘命中：激活与置信度均偏低，仅作线索';
  }
  return {
    grade, reason,
    weight: GRADE_WEIGHT_DEFAULT[grade],
    activation: r4(act), confidence: r4(conf), pathLength: path,
  };
}

/** 最终置信 = 文本置信权重 × 来源等级权重（等级权重可被在线学习更新）。 */
export function calibratedConfidence(grade, base, table = GRADE_WEIGHT_DEFAULT) {
  const g = table[String(grade || 'C').toUpperCase()] ?? 0.62;
  const b = CONF_WEIGHT[base] ?? 0.6;
  return Math.round(b * g * 1e4) / 1e4;
}

/**
 * 在线学习：一次反馈后微调该等级权重，夹在 [0.2, 0.98] 防极端化。
 * outcomeGood=true 上调（这类来源更可靠），false 下调（曾误导）。
 */
export function calibrate(current, grade, outcomeGood, lr = 0.04) {
  const out = { ...(current || GRADE_WEIGHT_DEFAULT) };
  const key = String(grade || 'C').toUpperCase();
  if (!(key in out)) out[key] = GRADE_WEIGHT_DEFAULT[key] ?? 0.62;
  const delta = outcomeGood ? lr : -lr;
  out[key] = Math.round(Math.min(0.98, Math.max(0.2, out[key] + delta)) * 1e4) / 1e4;
  return out;
}

export function confidenceBand(v) {
  const x = clamp01(v);
  if (x >= 0.75) return { key: '高', label: '高置信', tone: 'ok' };
  if (x >= 0.45) return { key: '中', label: '中置信', tone: 'warn' };
  return { key: '低', label: '低置信', tone: 'err' };
}

/** 元认知七项自检：缺口如实列出，不因"想给个漂亮结论"而略过。 */
export function metacogReport(answers = {}) {
  const missing = METACOG_CHECKS.filter((c) => !answers[c.key]);
  const passed = METACOG_CHECKS.length - missing.length;
  return {
    total: METACOG_CHECKS.length,
    passed,
    missing: missing.map(({ key, q }) => ({ key, q })),
    ratio: Math.round((passed / METACOG_CHECKS.length) * 1000) / 1000,
  };
}

/** 辩论质量分：必须有反方、有反驳、有残余风险才算完整（同 cognition.debate_score）。 */
export function debateScore(d) {
  let s = 0;
  if (String(d?.claim || '').trim()) s += 0.25;
  if (String(d?.counter || '').trim()) s += 0.30;
  if (String(d?.rebuttal || '').trim()) s += 0.25;
  if (String(d?.residual || '').trim() && !String(d.residual).includes('未标注')) s += 0.20;
  return Math.round(s * 100) / 100;
}
