// 五脑议会 · 深加工版（COUNCIL）
// ---------------------------------------------------------------------------
// 算法与 本项目自研认知规格 council.py 的 deterministic 符号计算保持一致：
//   BRAINS / ACTIONS / FEAT_KEYS / DISSENT_EPS 四张表由本项目自研认知规格定义
//   本文件绝不手抄；打分、主持人 softmax 权重、裁决、共识度、行动投票、分歧记录
//   全部按同一套公式在 JS 侧重写，便于离线客户端零依赖执行。
//
// 深加工（相对原版新增，且全部可验证）：
//   featuresFromEvidence() —— 原版七维特征由调用方主观给定；这里改为**由真实检索
//   结果计算**：证据等级加权覆盖、激活路径连贯度、卡片术语重叠、文本冲突对、
//   风险/利害/共情/语言信号。每个特征同时返回计算依据（evidence），界面可逐项
//   展开「为什么这么判」，杜绝黑箱与凭空打分。
//
// 边界：确定性符号计算，无模型、无网络、无意识；受 CPU 算力约束。
import { COUNCIL, COGNITION } from './anatomy.js';

export const FEAT_KEYS = COUNCIL.featKeys;
export const DISSENT_EPS = COUNCIL.dissentEps;
export const ACTIONS = COUNCIL.actions;
export const BRAINS = COUNCIL.brains;

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const r4 = (x) => Math.floor(x * 1e4 + 0.5) / 1e4;

function sigmoid(x) {
  if (x >= 0) { const z = Math.exp(-x); return 1 / (1 + z); }
  const z = Math.exp(x); return z / (1 + z);
}

function featNorm(f) {
  const o = {};
  for (const k of FEAT_KEYS) {
    const v = f && f[k] !== undefined ? Number(f[k]) : 0.5;
    o[k] = v > 1 ? 1 : (v < 0 ? 0 : (Number.isFinite(v) ? v : 0.5));
  }
  return o;
}

function pickAction(score, act) {
  for (const [id, thr] of act) if (score >= Number(thr)) return id;
  return 'answer';
}

// 主持人权重：按本局面与各脑「专业眼」的匹配度 softmax 分配
function hostWeights(f) {
  const raw = BRAINS.map((b) => {
    let core = null, best = -1;
    for (const [k, w] of Object.entries(b.w)) {
      if (Math.abs(w) > best) { best = Math.abs(w); core = k; }
    }
    return 0.15 + 0.85 * (f[core] !== undefined ? f[core] : 0.5);
  });
  const m = Math.max(...raw);
  const ex = raw.map((v) => Math.exp(v - m));
  const z = ex.reduce((a, b) => a + b, 0);
  return ex.map((v) => v / z);
}

/** 五脑议会主计算：与 Python deliberate_council 同构同值。 */
export function deliberate(feat) {
  const f = featNorm(feat);
  const hw = hostWeights(f);
  const scores = [], ready = [];
  let verdict = 0;
  BRAINS.forEach((b, i) => {
    let s = b.b;
    for (const k of FEAT_KEYS) s += (b.w[k] || 0) * f[k];
    const sv = sigmoid(s);
    const rd = (b.pol < 0) ? (1 - sv) : sv;
    ready.push(rd);
    verdict += rd * r4(hw[i]);
    scores.push({
      id: b.id, name: b.name, eye: b.eye,
      score: r4(sv), hw: r4(hw[i]),
      act: pickAction(sv, b.act), voice: b.voice,
    });
  });
  const spread = Math.max(...ready) - Math.min(...ready);
  const mu = ready.reduce((a, b) => a + b, 0) / ready.length;
  const std = Math.sqrt(ready.reduce((a, v) => a + (v - mu) ** 2, 0) / ready.length);
  const consensus = clamp01(1 - 0.6 * spread - 1.2 * std);

  const tally = {};
  for (const s of scores) tally[s.act] = (tally[s.act] || 0) + s.hw;
  let actId = 'answer', best = -1;
  for (const [id, v] of Object.entries(tally)) if (v > best) { best = v; actId = id; }
  const action = ACTIONS.find((a) => a.id === actId) || ACTIONS[0];
  const votes = {};
  for (const a of ACTIONS) votes[a.id] = r4(tally[a.id] || 0);

  const dissent = scores
    .map((s, i) => ({ ...s, dev: r4(Math.abs(ready[i] - verdict)) }))
    .filter((s) => s.dev > DISSENT_EPS)
    .map(({ id, name, eye, score, dev }) => ({ id, name, eye, score, dev }));

  return { brains: scores, verdict: r4(verdict), consensus: r4(consensus), action, votes, dissent };
}

// ---------------------------------------------------------------- 深加工：证据驱动特征

const RISK_WORDS = ['败诉', '败', '风险', '损失', '赔偿', '违约', '解除', '处罚', '追责', '败诉风险', '不利', '驳回', '无效', '争议', '纠纷', '诉讼', '仲裁', '举证不能'];
const STAKE_WORDS = ['刑事', '刑责', '坐牢', '巨额', '全部', '重大', '破产', '清算', '吊销', '终身', '惩罚性', '千万', '亿元', '违约金', '竞业'];
const EMP_WORDS = ['我', '我们', '当事人', '怎么办', '要不要', '能否', '可以吗', '帮我', '请问', '我该', '如何是'];
const ASK_WORDS = ['吗', '？', '?', '如何', '是否', '为什么', '谁', '怎样', '能不能', '可否'];
const CONFLICT_PAIRS = [
  ['支持', '不予支持'], ['有效', '无效'], ['成立', '不成立'], ['应当承担', '不承担'],
  ['构成', '不构成'], ['应予', '不应'], ['可撤销', '不可撤销'], ['有责', '无责'],
];
const STOP = new Set(['的', '了', '和', '与', '及', '在', '是', '有', '为', '中', '对', '从', '到', '以', '及', '等', '这', '那', '该', '其', '之', '所', '或', '一个', '问题', '关于', '相关', '进行', '通过', '以及', '是否', '如何']);

function terms(text) {
  const s = String(text || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  const out = new Set();
  for (const seg of s.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(seg)) { if (seg.length >= 2) out.add(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) {
      const t = seg.slice(i, i + 2);
      if (!STOP.has(t)) out.add(t);
    }
  }
  return out;
}

function countHits(text, words) {
  const s = String(text || '');
  return words.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0);
}

/**
 * 由真实召回结果计算七维特征。
 * @param {object} p
 * @param {Array}  p.hits     retrieveForAsk() 的命中（含 activation_path / confidence / node）
 * @param {string} p.question 用户问题
 * @param {Array}  p.grades   与 hits 等长的证据等级 ['A'..'D']（来自 calibration.gradeOfHit）
 * @returns {{feat: object, evidence: object}}
 */
export function featuresFromEvidence({ hits = [], question = '', grades = [] } = {}) {
  const q = String(question || '');
  const n = hits.length;
  const gTable = COGNITION.gradeWeight;
  const gList = hits.map((_, i) => String(grades[i] || 'C').toUpperCase());
  const avgGrade = n ? gList.reduce((a, g) => a + (gTable[g] ?? 0.62), 0) / n : 0;
  const avgConf = n ? hits.reduce((a, h) => a + clamp01(h.confidence), 0) / n : 0;
  const avgPath = n ? hits.reduce((a, h) => a + (Array.isArray(h.activation_path) ? h.activation_path.length : 1), 0) / n : 0;

  const titles = hits.map((h) => h.node?.title || h.title || '');
  const allText = [q, ...titles, ...hits.map((h) => String(h.node?.fts_text || '').slice(0, 400))].join(' ');

  // 术语重叠：相邻卡片标题二元组交集 / 并集，衡量概念链是否连贯
  let overlap = 0;
  if (titles.length >= 2) {
    const sets = titles.map(terms);
    let inter = 0, union = 0;
    for (let i = 1; i < sets.length; i++) {
      const a = sets[i - 1], b = sets[i];
      let hit = 0; for (const t of a) if (b.has(t)) hit++;
      inter += hit; union += new Set([...a, ...b]).size || 1;
    }
    overlap = union ? inter / union : 0;
  }

  const riskWords = RISK_WORDS.filter((w) => q.includes(w) || allText.includes(w));
  const stakeWords = STAKE_WORDS.filter((w) => q.includes(w) || allText.includes(w));
  const conflictPairs = CONFLICT_PAIRS.filter(([a, b]) => allText.includes(a) && allText.includes(b));
  const layerSet = new Set(hits.map((h) => h.node?.memory_layer).filter(Boolean));
  const layerSpread = layerSet.size > 1 ? (layerSet.size - 1) / 4 : 0;

  const coverage = Math.min(1, n / 5);
  const evid = n ? clamp01(avgGrade * (0.45 + 0.55 * coverage) * (0.6 + 0.4 * avgConf)) : 0.05;
  const pathCoherence = n ? clamp01(1 - (avgPath - 1) / 4) : 0.1;
  const logic = clamp01(0.55 * pathCoherence + 0.45 * Math.min(1, overlap * 3));
  const conflict = clamp01(0.12 + conflictPairs.length * 0.22 + layerSpread * 0.4 + (n === 0 ? 0.35 : 0));
  const risk = clamp01(0.1 + Math.min(0.72, riskWords.length * 0.11) + (n === 0 ? 0.25 : 0));
  const stakes = clamp01(0.08 + Math.min(0.8, stakeWords.length * 0.2) + (riskWords.length ? 0.12 : 0));
  const emp = clamp01(0.15 + EMP_WORDS.reduce((a, w) => a + (q.includes(w) ? 0.16 : 0), 0));
  const hasAsk = ASK_WORDS.some((w) => q.includes(w));
  const lang = clamp01((q.length >= 6 && q.length <= 120 ? 0.6 : 0.3) + (hasAsk ? 0.25 : 0) + (q.length > 20 ? 0.1 : 0));

  const feat = {
    logic: r4(logic), evid: r4(evid), risk: r4(risk), emp: r4(emp),
    lang: r4(lang), conflict: r4(conflict), stakes: r4(stakes),
  };
  const evidence = {
    hitCount: n,
    avgConfidence: r4(avgConf),
    avgActivationPath: r4(avgPath),
    avgGradeWeight: r4(avgGrade),
    gradeDistribution: gList.reduce((o, g) => { o[g] = (o[g] || 0) + 1; return o; }, {}),
    termOverlap: r4(overlap),
    riskWords: riskWords.slice(0, 8),
    stakeWords: stakeWords.slice(0, 8),
    conflictPairs: conflictPairs.map((p) => p.join(' / ')),
    memoryLayerSpread: layerSet.size,
    questionLength: q.length,
    basis: '全部由召回命中数、激活路径长度、置信度、证据等级、标题术语重叠与问题文本信号计算',
  };
  return { feat, evidence };
}

export function councilReport(c) {
  const lines = [`裁决 ${c.verdict} · 共识 ${c.consensus} · 行动【${c.action?.name || '作答'}】`];
  for (const s of c.brains) lines.push(`  ${s.name}(${s.id}) ${s.eye} → 分 ${s.score} 权 ${s.hw} 投 ${s.act}`);
  if (c.dissent?.length) lines.push(`  分歧：${c.dissent.map((d) => d.name).join('、')}`);
  return lines.join('\n');
}
