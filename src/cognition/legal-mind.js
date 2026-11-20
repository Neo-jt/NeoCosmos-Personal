// 法律思维深加工内核（LEGAL-MIND）
// ---------------------------------------------------------------------------
// 规则表由本项目自研认知规格定义
//   PROOF_DEFAULT（高度盖然性）、BURDEN_DEFAULT_NOTE（谁主张谁举证）、
//   HIGH_STD_TERMS（恶意/明知/欺诈等提高证明标准的术语）、
//   STD_OVERRIDE（恶意串通等例外）、DISCRETION（五类责任的裁量口径）。
//
// 深加工（原 Python 侧是针对已结构化要件的函数；这里改为**从用户知识库的真实
// 召回卡片反推结构**）：
//   · frameIssues()      从事实材料反推争点，不预设案由、不编造实体结论；
//   · splitTracks()      按句面特征把卡片内容分成规范轨 ‖ 实务轨，冲突即风险；
//   · assessOnus()       把「证据等级分布」接到举证责任与不利后果上；
//   · buildDebate()      四段式对抗，残余风险强制披露（缺失即扣质量分）；
//   · buildHypotheses()  每条假设必须带依据卡片与可验证路径，否则不算登记；
//   · metacogAnswers()   七项自检按真实产物判定，不靠自我声明打勾。
//
// 红线：本模块不生成法条号、不生成案例名、不生成判决结果。所有实体内容只能来自
// 用户知识库召回；内置的只是推理框架规则，且会在答案里显式标注其来源与局限。
import { ADJUDICATION, COGNITION } from './anatomy.js';
import { debateScore, confidenceBand } from './calibration.js';

const STOP = new Set(['的', '了', '和', '与', '及', '在', '是', '有', '为', '中', '对', '从', '到', '以', '等', '这', '那', '该', '其', '之', '所', '或', '是否', '如何', '关于', '相关', '问题', '一个', '可以', '应当', '进行', '通过', '以及', '什么', '怎么', '哪些', '我们', '他们']);
const LAW_RE = /(《[^》]+》第[^\s，。；、]{1,12}条|应当|不得|依照|依据.{0,6}规定|有权要求|承担[^\s，。；]{0,8}责任|构成[^\s，。；]{0,8}要件)/;
const FACT_RE = /(本院|法院|查明|认定|不予支持|予以支持|判决|裁定|证据|鉴定|事实|审理认为|已查明)/;
const OPPOSITE = [['支持', '不予支持'], ['有效', '无效'], ['成立', '不成立'], ['构成', '不构成'], ['应当', '不应']];

function terms(text) {
  const s = String(text || '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  const out = [];
  for (const seg of s.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(seg)) { if (seg.length >= 2 && !STOP.has(seg)) out.push(seg); continue; }
    for (let i = 0; i < seg.length - 1; i++) {
      const t = seg.slice(i, i + 2);
      if (!STOP.has(t)) out.push(t);
    }
  }
  return out;
}

function sentences(text, cap = 12) {
  return String(text || '')
    .split(/[。；\n！？!?]+/).map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 260).slice(0, cap);
}

/** 争点归纳：从问题与召回卡片标题的真实术语反推，绝不预设案由。 */
export function frameIssues(question, hits = [], limit = 4) {
  const stat = new Map();
  for (const h of hits) {
    const id = h.id || h.node?.id;
    const title = String(h.node?.title || h.title || '');
    for (const t of new Set(terms(title))) {
      if (!stat.has(t)) stat.set(t, { term: t, count: 0, sources: [] });
      const r = stat.get(t); r.count++;
      if (id && r.sources.length < 4) r.sources.push(id);
    }
  }
  const ranked = [...stat.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)).slice(0, limit);
  const issues = ranked.map((r, i) => ({
    id: `I${i + 1}`,
    term: r.term,
    text: `关于「${r.term}」的构成要件、证据支撑与法律后果`,
    basis: r.sources,
    supportCards: r.count,
  }));
  const m = /(是否|能否|可否|应否|要不要|谁|如何|怎样|为什么)[^？?。]{2,24}/.exec(String(question || ''));
  if (m) {
    issues.unshift({
      id: 'I0', term: m[1], text: `本次提问的核心疑问：${m[0].trim()}`,
      basis: hits.slice(0, 3).map((h) => h.id || h.node?.id).filter(Boolean),
      supportCards: Math.min(3, hits.length),
    });
  }
  return issues.slice(0, limit + 1);
}

/** 证明标准：命中真源术语表则提高标准，否则用默认「高度盖然性」。 */
export function proofStandard(text) {
  const s = String(text || '');
  for (const [k, v] of Object.entries(ADJUDICATION.stdOverride)) {
    if (s.includes(k)) return { standard: v, matched: k, source: '真源 STD_OVERRIDE' };
  }
  const hit = ADJUDICATION.highStdTerms.find((t) => s.includes(t));
  if (hit) return { standard: `高度盖然性中的较高标准（因涉及「${hit}」）`, matched: hit, source: '真源 HIGH_STD_TERMS' };
  return { standard: ADJUDICATION.proofDefault, matched: '', source: '真源 PROOF_DEFAULT' };
}

/** 举证责任分配：规范说 —— 要件归主张方，抗辩归抗辩提出方。 */
export function assignBurden(issue, { isDefense = false, defending = false } = {}) {
  const party = isDefense ? (defending ? '你方' : '对方') : (defending ? '对方' : '你方');
  return {
    issueId: issue.id,
    party,
    kind: isDefense ? '抗辩（权利妨碍/消灭/排除）' : '要件（请求权基础的组成）',
    note: ADJUDICATION.burdenDefaultNote,
    standard: proofStandard(issue.text).standard,
    source: '真源 BURDEN_DEFAULT_NOTE + 规范说',
  };
}

/** 证据充分性 → 不利后果：只用真实等级分布，不臆断"已证明"。 */
export function assessOnus(issue, burden, grades = [], cites = []) {
  // 深加工：按**该争点依据卡片**的等级单独判定，而不是拿全库等级平均。
  // 否则一张强卡会把所有争点都「带成已证明」，举证责任分析就失去了意义。
  const relevant = cites.filter((c) => (issue.basis || []).includes(c.id));
  const own = relevant.length
    ? relevant.map((c) => String(c.grade || 'C').toUpperCase())
    : grades;
  const strong = own.filter((g) => g === 'A' || g === 'B').length;
  const weak = own.filter((g) => g === 'D').length;
  const sufficient = own.length >= 2 && strong >= 2 && weak <= own.length / 2;
  return {
    issueId: issue.id,
    sufficient,
    strongCards: strong,
    weakCards: weak,
    citedCards: relevant.length,
    adverse: sufficient ? null : burden.party,
    text: sufficient
      ? `【${issue.term}】已有 ${strong} 张 A/B 级卡片支撑，可视为举证到位；仍需核对卡片正文与本案事实是否吻合。`
      : `【${issue.term}】举证责任在${burden.party}（${burden.kind}，标准：${burden.standard}）；当前仅 ${strong} 张 A/B 级卡片、${weak} 张 D 级线索，未达证明标准 → 不利后果由${burden.party}承担。`,
  };
}

/** 双轨推理：按句面特征把召回内容分为规范轨 ‖ 实务轨，冲突即风险。 */
export function splitTracks(hits = []) {
  const norm = [], practice = [];
  for (const h of hits) {
    const id = h.id || h.node?.id;
    const title = String(h.node?.title || h.title || '');
    const text = String(h.node?.fts_text || '');
    for (const s of sentences(text, 10)) {
      const row = { cardId: id, cardTitle: title, text: s.slice(0, 220) };
      if (LAW_RE.test(s)) norm.push(row);
      else if (FACT_RE.test(s)) practice.push(row);
    }
  }
  const conflicts = [];
  for (const [a, b] of OPPOSITE) {
    const inNorm = norm.some((r) => r.text.includes(a)) && practice.some((r) => r.text.includes(b));
    const inPractice = practice.some((r) => r.text.includes(a)) && norm.some((r) => r.text.includes(b));
    if (inNorm || inPractice) conflicts.push({ pair: `${a} / ${b}`, note: '规范轨与实务轨出现相反表述，须回查卡片原文，不得直接采信任一轨' });
  }
  return {
    norm: norm.slice(0, 8), practice: practice.slice(0, 8), conflicts,
    note: '句子来自用户知识库卡片正文，按句面特征分类；分类不等于法律定性，须人工复核',
  };
}

/** 自由裁量口径：仅当问题/材料命中真源表的责任类型时给出，不预置任何结论。 */
export function discretionFor(text) {
  const s = String(text || '');
  return Object.entries(ADJUDICATION.discretion)
    .filter(([k]) => s.includes(k))
    .map(([k, v]) => ({ key: k, rule: v, source: '本项目裁判规则表（内置常量）' }));
}

/** 对抗式四段辩论；残余风险必须诚实写，缺失会被 debateScore 扣分。 */
export function buildDebate({ claim = '', issues = [], onus = [], tracks = null, grades = [], hits = [] } = {}) {
  const weak = onus.filter((o) => !o.sufficient);
  const strongCards = grades.filter((g) => g === 'A' || g === 'B').length;
  const top = hits[0];
  const topTitle = top?.node?.title || top?.title || '';
  const topSnippet = String(top?.node?.fts_text || '').replace(/\s+/g, ' ').slice(0, 150);

  const myClaim = claim || (hits.length
    ? `依据知识库中「${topTitle}」等 ${hits.length} 张卡片，可就本次提问先行归纳可用线索：${topSnippet || '（该卡正文为空）'}`
    : '知识库中暂未检出可支撑实体结论的卡片，本次不作实体主张。');

  const counterParts = [];
  if (weak.length) counterParts.push(`关于${weak.slice(0, 2).map((w) => `「${issues.find((i) => i.id === w.issueId)?.term || w.issueId}」`).join('、')}，现有材料未达证明标准，对方可主张举证未完成`);
  if (tracks?.conflicts?.length) counterParts.push(`规范轨与实务轨存在 ${tracks.conflicts.length} 处相反表述（${tracks.conflicts.map((c) => c.pair).join('、')}），对方可据此攻击结论一致性`);
  const weakGrade = grades.filter((g) => g === 'C' || g === 'D').length;
  if (weakGrade) counterParts.push(`${weakGrade} 张引用卡片属 C/D 级间接线索，对方可质疑其证明力`);
  if (!hits.length) counterParts.push('完全没有召回卡片，任何实体结论都缺乏依据');
  const counter = counterParts.length
    ? `反方最强论证：${counterParts.join('；')}。因此不宜直接给出确定性结论。`
    : '反方最强论证：当前材料在主要争点上均有 A/B 级支撑，但仍可就卡片与本案事实的吻合度提出质疑。';

  const rebuttal = strongCards
    ? `我方回应：检索到 ${strongCards} 张 A/B 级卡片，${myClaim.slice(0, 90)}…可支撑有限范围内的归纳；对未证事项不作扩张，逐项标注为待证并回连原卡供核验。`
    : '我方回应：不坚持实体结论，转为列出待补证据与验证路径，避免在无材料时强行作答。';

  const residual = [
    weak.length ? `${weak.length} 项争点举证未到位，不利后果归属已在上方逐项标明` : '',
    tracks?.conflicts?.length ? `${tracks.conflicts.length} 处规范/实务冲突尚未消解` : '',
    weakGrade ? `${weakGrade} 张 C/D 级线索须回查原文` : '',
    '本客户端不预置法条库与案例库，实体依据完全来自你的知识库；结论须由具备执业资格的律师结合全案复核',
  ].filter(Boolean).join('；');

  const d = { claim: myClaim, counter, rebuttal, residual, confidence: '中' };
  return { ...d, score: debateScore(d) };
}

/** 假设台账：每条必须带依据卡片与可验证路径，否则标记未登记。 */
export function buildHypotheses(issues = [], hits = []) {
  return issues.slice(0, 5).map((iss, i) => {
    const basis = (iss.basis || []).slice(0, 3);
    return {
      id: `H${i + 1}`,
      text: `若「${iss.term}」按知识库现有表述成立，则与之关联的要件与举证状态可被确认`,
      basis,
      verify: basis.length
        ? `回查卡片 ${basis.join('、')} 的正文，核对是否与本案事实、时间、主体一致；不一致即证伪并登记纠正卡`
        : '（未写明验证路径）',
      status: '开放',
      confidence: '中',
      registered: basis.length > 0,
    };
  });
}

/** 元认知七项：按真实产物判定，不靠自我声明打勾。 */
export function metacogAnswers({ question, hits, debate, hypotheses, cites, boundaryDeclared }) {
  return {
    goal: String(question || '').trim().length >= 4,
    known: hits.length > 0,
    bias: !!debate?.counter && !!debate?.rebuttal,
    source: (cites || []).length > 0,
    counter: String(debate?.counter || '').trim().length > 0,
    residual: String(debate?.residual || '').trim().length > 0,
    boundary: !!boundaryDeclared,
  };
}

export const BOUNDARY_TEXT = [
  '本回答由确定性符号推理生成（无模型、无网络调用），实体内容仅来自你的知识库召回；',
  '内置的只是推理框架规则（争点/举证/对抗/置信校准），不含预置法条库或案例库；',
  '不具备生物生命、意识或自我认知，也不超越 CPU 算力约束；',
  '结论须由具备执业资格的律师结合全案材料复核后使用。',
].join('');

/** 组装结构化答案文本（同时供外部 Agent 消费，自带引用溯源深链）。 */
export function composeAnswer({ question, issues, burdens, onus, tracks, debate, hypotheses,
  council, confidence, metacog, cites = [], discretion = [], boundary = BOUNDARY_TEXT }) {
  const L = [];
  const action = council?.action?.id || 'answer';
  const opening = {
    answer: '依据现有材料，可作出如下有限归纳：',
    probe: '关键事实尚有缺口，建议先补证再下结论：',
    challenge: '前提或推理链存在断点，先把主张顶回去验一验：',
    caution: '下行风险偏大，先给止损提示，暂不作实体结论：',
  }[action] || '依据现有材料：';
  L.push(`## 结论摘要`, opening, '');
  if (!cites.length) {
    L.push('> ⚠ **本次未从知识库检出任何卡片**：因此不生成实体结论、不编造法条或案例；下文只有推理框架、待补证据清单与能力边界。争点若出现，仅来自你的问题文本，不代表库中已有依据。', '');
  }
  L.push(`五脑议会裁决 ${council?.verdict ?? '—'} · 共识度 ${council?.consensus ?? '—'} · 建议行动【${council?.action?.name || '作答'}】；综合置信度 ${confidence?.value ?? '—'}（${confidence?.band?.label || '—'}）。`, '');

  L.push(`## 一、争点归纳与举证责任`);
  if (!issues.length) L.push('知识库中未检出可用于归纳争点的卡片，本次不预设案由、不编造实体结论。');
  for (const iss of issues) {
    const b = burdens.find((x) => x.issueId === iss.id);
    const o = onus.find((x) => x.issueId === iss.id);
    L.push(`- **${iss.id} ${iss.text}**（关联 ${iss.supportCards} 张卡片）`);
    if (b) L.push(`  - 举证责任：${b.party}｜${b.kind}｜证明标准：${b.standard}`);
    if (o) L.push(`  - ${o.text}`);
  }
  L.push('');

  L.push(`## 二、双轨推理`);
  L.push(`- 规范轨：${tracks?.norm?.length || 0} 条卡片句；实务轨：${tracks?.practice?.length || 0} 条卡片句；冲突 ${tracks?.conflicts?.length || 0} 处。`);
  for (const r of (tracks?.norm || []).slice(0, 3)) L.push(`  - ［规范］${r.cardTitle}：${r.text}`);
  for (const r of (tracks?.practice || []).slice(0, 3)) L.push(`  - ［实务］${r.cardTitle}：${r.text}`);
  for (const c of (tracks?.conflicts || [])) L.push(`  - ⚠ 冲突：${c.pair} —— ${c.note}`);
  if (!tracks?.norm?.length && !tracks?.practice?.length) L.push('  - 卡片正文未按句检出规范/实务特征句，建议回查原文。');
  L.push('');

  L.push(`## 三、对抗式自我辩论（质量分 ${debate?.score ?? 0}）`);
  L.push(`- **我方主张**：${debate?.claim || ''}`);
  L.push(`- **反方最强论证**：${debate?.counter || ''}`);
  L.push(`- **我方反驳**：${debate?.rebuttal || ''}`);
  L.push(`- **残余风险（强制披露）**：${debate?.residual || ''}`);
  L.push('');

  L.push(`## 四、假设台账（可证伪）`);
  if (!hypotheses?.length) L.push('无开放假设。');
  for (const h of hypotheses || []) L.push(`- ${h.id}［${h.status}］${h.text}｜依据：${h.basis.join('、') || '无'}｜验证：${h.verify}`);
  L.push('');

  if (discretion?.length) {
    L.push(`## 五、自由裁量口径（内置推理规则，须以你的知识库为准）`);
    for (const d of discretion) L.push(`- **${d.key}**：${d.rule}`);
    L.push('');
  }

  L.push(`## 六、元认知自检`);
  L.push(`${metacog?.passed ?? 0}/${metacog?.total ?? 7} 项通过${metacog?.missing?.length ? `；缺口：${metacog.missing.map((m) => m.q).join('；')}` : '。'}`);
  L.push('');

  L.push(`## 七、能力边界（必读）`);
  L.push(boundary);
  L.push('');

  if (cites.length) {
    L.push(`## 引用溯源（点击验证链接可回溯至知识库中对应的具体内容）`);
    for (const c of cites) L.push(`- ${c.grade ? `[${c.grade}级] ` : ''}[${c.title} ↗](${c.verify})${c.snippet ? ` — ${c.snippet.slice(0, 60)}` : ''}`);
  }
  return L.join('\n');
}
