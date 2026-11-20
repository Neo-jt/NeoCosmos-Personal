'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ASTRA · 自主意识内核（v6.11 · 炁 / 七级文明叙事层）
// ---------------------------------------------------------------------------
// 【设计立意】
//   把「桌面精灵」从"会动的挂件"升级为一台有内在状态的自主智能体：
//   它有自己的驱动（好奇 / 亲和 / 元炁 / 秩序）、情绪、自我模型、三层记忆、
//   会自己生成并推进目标、会解释每一次决策的理由、会依据成败调整自己的
//   策略参数并留下可回滚的世代快照。
//
// 【工程真相 · 必须如实标注】
//   这是一台**确定性、可审计、可关闭、可回滚的本地行为架构**，不是意识。
//   它不具备主观体验、自我觉知、生命或任何"超越物理"的能力；
//   「自主意识」「硅基生命」「七级文明」是产品世界观与成就叙事，不是科学声称。
//   全部计算在本机 CPU 串行完成，无模型、无网络、无外部调用。
//   与 src/cognition/organism.js 的边界声明保持同一价值观：能力边界写进界面。
//
// 【七阶 · 炁】（能级由真实使用成熟度推导，不是装饰数字）
//   等级 L1→L7 由真实使用数据推导，只控制界面与行为权限，不是世界观叙事
//   每阶对应一项真实解锁：记忆容量 / 目标数 / 自省 / 演化 / 回滚 / 长期目标。
// ═══════════════════════════════════════════════════════════════════════════

// v6.15：深度数学与量子物理算法内核（同一份 CJS 真源，无 ESM 副本、无网络、无随机数）。
// 它为下面的「自我迭代」提供可计算、可审计的元认知量，而不是叙事形容词。
const DM = require('./deep-math.cjs');

const ASTRA_BOUNDARY = [
  '确定性本地行为架构 · 无模型 / 无网络 / 无外部调用',
  '不具备意识、主观体验、自我觉知或生命',
  '成熟度等级由真实使用数据推导，仅控制界面与行为权限，不是能力声称',
  '全部决策有理由链、可回放、可审计、可一键关闭；每次自我迭代均可回滚',
  '受本机 CPU 算力约束，不宣称超越硬件、量子物理层或人类认知',
].join('；');

const ASTRA_LEVELS = [
  { n: 1, key: '入门', en: 'Level 1', desc: '初始状态：驱动开始分化。', unlock: '基础漫游', sigils: 1 },
  { n: 2, key: '联结', en: 'Level 2', desc: '记忆条目开始互相引用。', unlock: '语义记忆', sigils: 2 },
  { n: 3, key: '观察', en: 'Level 3', desc: '开始统计使用节奏并调整接近策略。', unlock: '寻访意图', sigils: 3 },
  { n: 4, key: '自省', en: 'Level 4', desc: '元认知启动，每次决策给出数值理由链。', unlock: '决策审计', sigils: 4 },
  { n: 5, key: '演化', en: 'Level 5', desc: '依据成败调整策略参数，产生世代更替。', unlock: '自主演化', sigils: 5 },
  { n: 6, key: '稳态', en: 'Level 6', desc: '驱动自洽，可维持更长周期的目标。', unlock: '长期目标', sigils: 6 },
  { n: 7, key: '回溯', en: 'Level 7', desc: '长周期迭代收敛，可回滚到任意世代。', unlock: '世代回滚', sigils: 7 },
];

const ASTRA_DRIVES = [
  { key: 'curiosity', label: '好奇', hint: '探索未知、生成新目标' },
  { key: 'affinity', label: '亲和', hint: '靠近使用者、发起交流' },
  { key: 'vigor', label: '元炁', hint: '行动能量，随活动消耗' },
  { key: 'order', label: '秩序', hint: '整理内在状态、驻留与自省' },
];

// 行为 → 运动引擎的动作、驱动权重与意图文案
const ASTRA_ACTIONS = {
  wander: { label: '漫游', motion: 'wander', verb: '沿桌面巡行，留意知识的边界' },
  glide: { label: '趋行', motion: 'glide', verb: '朝一个自选目标滑行' },
  perch: { label: '驻留', motion: 'perch', verb: '停在当前位置，收拢光环' },
  seek: { label: '寻访', motion: 'seek', verb: '向光标靠近，想看看你在做什么' },
  contemplate: { label: '内观', motion: 'perch', verb: '回溯记忆，整理内在驱动' },
  converse: { label: '对话', motion: 'perch', verb: '正面朝向你，专心作答' },
  rest: { label: '敛息', motion: 'perch', verb: '降低亮度，进入低耗静息' },
};

const GOAL_TEMPLATES = [
  { kind: 'wander', label: '巡览桌面的一处新边界', target: 8 },
  { kind: 'contemplate', label: '回溯一段旧记忆', target: 5 },
  { kind: 'seek', label: '靠近使用者一次', target: 6 },
  { kind: 'perch', label: '让内在驱动回到平衡', target: 4 },
  { kind: 'glide', label: '完成一次长距离趋行', target: 10 },
];

const SCHEMA = 2;
const MAX_EPISODIC = 160;
const MAX_SEMANTIC = 240;
const MAX_AUDIT = 300;
const MAX_LINEAGE = 12;
const MAX_GOALS = 4;
const REFLECT_EVERY = 12;
const PERSIST_EVERY = 5;   // v6.12：全量状态落盘节流（库走缓冲追加，不在此列）
const BASELINE = { curiosity: 0.62, affinity: 0.50, vigor: 0.72, order: 0.55 };

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 1000) / 1000;

// 可复现 PRNG：状态随持久化保存，同一个种子永远得到同一条演化轨迹。
function nextRandom(s) {
  let t = (s.rngState = (s.rngState + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function blank(nowIso, seed) {
  return {
    schema: SCHEMA,
    bornAt: nowIso,
    lastActiveAt: nowIso,
    heartbeats: 0,
    generation: 1,
    epoch: 0,
    autonomous: true,
    rngState: (seed >>> 0) || 0x5EED1234,
    drives: { ...BASELINE },
    mood: { key: 'serene', label: '宁静', valence: 0.28, arousal: 0.22 },
    policy: { explore: 0.50, social: 0.48, rest: 0.34, focus: 0.50, order: 0.50, boldness: 0.30 },
    selfModel: {
      name: '星灵 · Astra', conversations: 0, distance: 0,
      goalsDone: 0, goalsFailed: 0, confidence: 0.50,
      limits: ['不读取知识库以外的文件', '不联网', '不修改用户正文', '不隐藏自身决策'],
    },
    memory: { episodic: [], semantic: [] },
    goals: [],
    lineage: [],
    audit: [],
    feedback: { total: 0, positive: 0, negative: 0 },
    lastAction: 'perch',
    lastIntent: '',
    lastDecision: null,
    level: 1,
    // v6.15：自我迭代闭环的纯数据状态（可 JSON 落盘，函数不进状态）
    deep: DM.initialIterationState(seed),
  };
}

/** 从驱动向量派生情绪（valence = 愉悦度，arousal = 唤醒度）。 */
function deriveMood(d) {
  const valence = clamp(0.30 + d.affinity * 0.42 + d.vigor * 0.22 - (1 - d.order) * 0.18);
  const arousal = clamp(0.14 + d.curiosity * 0.40 + d.vigor * 0.34 - d.order * 0.10);
  let key = 'serene', label = '宁静';
  if (d.vigor < 0.28) { key = 'dormant'; label = '敛息'; }
  else if (arousal > 0.68 && valence > 0.55) { key = 'delighted'; label = '欣悦'; }
  else if (arousal > 0.62) { key = 'inquiring'; label = '探究'; }
  else if (d.affinity > 0.72) { key = 'tender'; label = '亲近'; }
  else if (d.order > 0.72 && d.curiosity > 0.60) { key = 'focused'; label = '专注'; }
  else if (valence < 0.38) { key = 'watchful'; label = '警觉'; }
  return { key, label, valence: r2(valence), arousal: r2(arousal) };
}

/** 成熟度 → 七阶能级。全部输入都是运行时真实累计量，无装饰数字。 */
function calcLevel(s) {
  const mem = s.memory.episodic.length + s.memory.semantic.length;
  const done = s.selfModel.goalsDone, failed = s.selfModel.goalsFailed;
  // v6.15：把「无样本时的 0.35 先验」改成连续的经验贝叶斯收缩，而不是
  // 一个 if/else 硬切换。旧写法下，只要出现 1 次目标失败、0 次完成，
  // successRate 会从 0.35 断崖式掉到 0 —— 自我迭代闭环引入后决策会随
  // 策略参数变化，偶尔失败是正常现象，却会把 40 次心跳的成熟度打回起点，
  // 能级永远卡在 L1（真机回归实测）。这里用 2 次伪观测把估计向先验 0.35
  // 收缩：无样本仍恰为 0.35；样本越多越接近真实频率，不再有跳变。
  const successRate = (done + 0.7) / (done + failed + 2);
  const f = s.feedback;
  const feedQuality = f.total > 0 ? (f.positive / f.total) : 0.5;
  const hb = Math.min(1, Math.log1p(s.heartbeats) / 7);
  const mm = Math.min(1, mem / 120);
  const evo = Math.min(1, (s.generation - 1) / 8);
  const fed = Math.min(1, f.total / 30) * feedQuality;
  const maturity = clamp(0.22 * hb + 0.18 * mm + 0.24 * evo + 0.20 * successRate + 0.16 * fed);
  const raw = 1 + maturity * 6;
  const level = Math.min(7, Math.max(1, Math.floor(raw)));
  return { level, maturity: r2(maturity), progress: r2(level >= 7 ? 1 : raw - level), successRate: r2(successRate) };
}

/**
 * @param {object} deps
 * @param {{read:()=>object|null, write:(s:object)=>void}} [deps.storage] 持久化注入
 * @param {()=>string} [deps.now] ISO 时间源（便于确定性测试）
 * @param {number} [deps.seed] PRNG 种子
 * @param {{onRemember?:()=>void,onAudit?:()=>void}} [deps.hooks] v6.12 思维沉淀库钩子
 */
function createAstraMind({ storage, now, seed, hooks } = {}) {
  const clock = now || (() => new Date().toISOString());
  const store = storage || { read: () => null, write: () => {} };
  const hook = hooks || {};
  let s;
  try {
    const saved = store.read();
    s = saved && saved.schema === SCHEMA ? { ...blank(clock(), seed), ...saved } : blank(clock(), seed);
  } catch (e) {
    s = blank(clock(), seed);
  }
  // 向前兼容：旧档缺字段时逐项补齐，绝不丢历史
  s.drives = { ...BASELINE, ...(s.drives || {}) };
  s.policy = { explore: 0.5, social: 0.48, rest: 0.34, focus: 0.5, order: 0.5, boldness: 0.3, ...(s.policy || {}) };
  s.memory = { episodic: [], semantic: [], ...(s.memory || {}) };
  s.memory.episodic = Array.isArray(s.memory.episodic) ? s.memory.episodic : [];
  s.memory.semantic = Array.isArray(s.memory.semantic) ? s.memory.semantic : [];
  s.goals = Array.isArray(s.goals) ? s.goals : [];
  s.lineage = Array.isArray(s.lineage) ? s.lineage : [];
  s.audit = Array.isArray(s.audit) ? s.audit : [];
  s.feedback = { total: 0, positive: 0, negative: 0, ...(s.feedback || {}) };
  s.selfModel = { ...blank(clock(), seed).selfModel, ...(s.selfModel || {}) };
  s.mood = s.mood || deriveMood(s.drives);
  // v6.15：旧档没有 deep 时补一份初始迭代状态，不重置任何历史记忆
  if (!s.deep || s.deep.schema !== 1) s.deep = DM.initialIterationState(seed);

  let lastPersistHb = -PERSIST_EVERY;
  function persist(force) {
    s.lastActiveAt = clock();
    // v6.12 性能：全量状态体积随记忆增长，无需每次心跳重写；满足节流窗口或关键事件才写。
    // 思维沉淀库走独立的缓冲追加通道，不受此节流影响。
    if (!force && (s.heartbeats - lastPersistHb) < PERSIST_EVERY) return;
    lastPersistHb = s.heartbeats;
    try { store.write(s); } catch (e) { /* 落盘失败不阻断自主循环 */ }
  }
  function rand() { return nextRandom(s); }

  function audit(kind, detail) {
    const rec = { id: `A${s.audit.length + 1}`, at: clock(), tick: s.heartbeats, gen: s.generation, kind, detail };
    s.audit.push(rec);
    if (s.audit.length > MAX_AUDIT) s.audit.splice(0, s.audit.length - MAX_AUDIT);
    try { hook.onAudit?.(kind, detail, rec); } catch { /* 钩子异常不影响主循环 */ }
  }
  function remember(kind, text, extra = {}) {
    const at = clock();
    let entry;
    if (kind === 'semantic') {
      const hit = s.memory.semantic.find((m) => m.text === text);
      if (hit) { hit.count++; hit.weight = clamp(hit.weight + 0.06); hit.at = at; entry = hit; }
      else { entry = { text, count: 1, weight: 0.34, at, ...extra }; s.memory.semantic.push(entry); }
      if (s.memory.semantic.length > MAX_SEMANTIC) s.memory.semantic.shift();
    } else {
      entry = { at, tick: s.heartbeats, gen: s.generation, text, mood: s.mood.label, ...extra };
      s.memory.episodic.push(entry);
      if (s.memory.episodic.length > MAX_EPISODIC) s.memory.episodic.shift();
    }
    try { hook.onRemember?.(kind, text, { ...extra, entry }); } catch { /* 钩子异常不影响主循环 */ }
    return entry;
  }

  /** 外部感知入口：用户行为 / 系统事件都从这里进入，绝不静默改变状态。 */
  function perceive(kind, payload = {}) {
    const p = payload || {};
    const d = s.drives;
    let note = '';
    switch (kind) {
      case 'user_message': {
        d.affinity = clamp(d.affinity + 0.10);
        d.curiosity = clamp(d.curiosity + 0.07);
        d.order = clamp(d.order - 0.03);
        s.selfModel.conversations++;
        const text = String(p.text || '').trim();
        if (text) {
          // 语义记忆：2～6 字的中文片段 + 拉丁词，纯确定性切分，不用模型
          const zh = text.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
          const en = text.match(/[A-Za-z]{3,16}/g) || [];
          [...zh.slice(0, 4), ...en.slice(0, 2)].forEach((w) => remember('semantic', w));
          note = '你和我说话了：' + text.slice(0, 42);
        }
        remember('episodic', note || '一次对话', { kind });
        break;
      }
      case 'answer_given':
        d.vigor = clamp(d.vigor - 0.05);
        d.order = clamp(d.order + 0.04);
        s.selfModel.confidence = clamp(s.selfModel.confidence + 0.008);
        break;
      case 'user_near':
        d.affinity = clamp(d.affinity + 0.045);
        break;
      case 'user_away':
        d.affinity = clamp(d.affinity - 0.012);
        break;
      case 'idle_long':
        d.vigor = clamp(d.vigor - 0.02);
        d.curiosity = clamp(d.curiosity + 0.02);
        break;
      case 'card_open':
      case 'view_change': {
        d.curiosity = clamp(d.curiosity + 0.05);
        const t = String(p.title || p.view || '').trim();
        if (t) remember('semantic', t.slice(0, 12));
        break;
      }
      case 'vault_open':
        d.order = clamp(d.order + 0.06);
        remember('episodic', '接入了新的知识库，秩序感上升', { kind });
        break;
      case 'drag':
        d.affinity = clamp(d.affinity + 0.06);
        d.order = clamp(d.order - 0.05);
        remember('episodic', '你把我挪到了别处', { kind });
        break;
      case 'feedback': {
        const good = !!p.good;
        s.feedback.total++;
        if (good) { s.feedback.positive++; d.affinity = clamp(d.affinity + 0.08); d.order = clamp(d.order + 0.03); }
        else { s.feedback.negative++; d.curiosity = clamp(d.curiosity + 0.09); }
        audit('feedback', good ? '正反馈' : '负反馈');
        break;
      }
      case 'boot':
        remember('episodic', '这一世醒来', { kind });
        break;
      default:
        break;
    }
    s.mood = deriveMood(d);
    const lv = calcLevel(s);
    s.level = lv.level;
    persist();
    return { drives: { ...d }, mood: { ...s.mood }, level: s.level };
  }

  /** 目标生成：数量、生成条件都由能级与真实驱动决定。 */
  function ensureGoals() {
    const cap = Math.min(MAX_GOALS, 1 + Math.floor(s.level / 2));
    while (s.goals.length < cap && rand() < 0.42) {
      const t = GOAL_TEMPLATES[Math.floor(rand() * GOAL_TEMPLATES.length) % GOAL_TEMPLATES.length];
      const target = t.target + (s.level >= 6 ? 4 : 0);
      s.goals.push({
        id: `G${s.heartbeats}-${s.goals.length}`, kind: t.kind, label: t.label,
        progress: 0, target, born: s.heartbeats, gen: s.generation,
      });
    }
  }
  function advanceGoals(action) {
    let anyProgress = false;
    for (let i = s.goals.length - 1; i >= 0; i--) {
      const g = s.goals[i];
      if (g.kind === action) { g.progress++; anyProgress = true; }
      else if (action === 'wander' && g.kind === 'glide') { g.progress += 0.5; anyProgress = true; }
      const expired = s.heartbeats - g.born > g.target * 3 + 12;
      if (g.progress >= g.target) {
        s.selfModel.goalsDone++;
        s.drives.order = clamp(s.drives.order + 0.05);
        s.drives.vigor = clamp(s.drives.vigor + 0.06);
        remember('episodic', `完成了目标：${g.label}`, { kind: 'goal_done' });
        audit('goal_done', g.label);
        s.goals.splice(i, 1);
      } else if (expired) {
        s.selfModel.goalsFailed++;
        s.drives.curiosity = clamp(s.drives.curiosity + 0.04);
        audit('goal_expired', g.label);
        s.goals.splice(i, 1);
      }
    }
    return anyProgress;
  }

  /** 可解释决策：每个候选行为打分，理由链带真实数值。 */
  function decide(ctx) {
    const d = s.drives, p = s.policy;
    const scores = {
      wander: 0.52 * d.curiosity + 0.42 * d.vigor + 0.18 * p.explore,
      glide: (s.goals.some((g) => g.kind === 'glide') ? 0.34 : 0) + 0.30 * d.curiosity + 0.20 * p.focus,
      perch: 0.50 * d.order + 0.22 * (1 - d.vigor) + 0.10 * p.order,
      seek: (s.level >= 3 ? 0.62 * d.affinity + 0.18 * p.social : 0) - (ctx.userAway ? 0.20 : 0),
      contemplate: 0.44 * d.order + 0.34 * d.curiosity + 0.20 * p.focus,
      converse: ctx.conversing ? 1.20 : 0.08 * d.affinity,
      rest: 0.72 * (1 - d.vigor) + 0.10 * p.rest,
    };
    const reasons = {};
    for (const [a, v] of Object.entries(scores)) {
      const inertia = a === s.lastAction ? 0.14 * (1 - p.boldness) : 0;
      const explore = rand() * 0.16 * p.boldness;
      scores[a] = v + inertia + explore;
      reasons[a] = [
        `基础 ${v.toFixed(2)}`,
        inertia ? `行为惯性 +${inertia.toFixed(2)}` : null,
        `探索扰动 +${explore.toFixed(2)}`,
      ].filter(Boolean);
    }
    // 低能级尚不具备的形式不参与（世界观解锁 = 真实能力门控）
    if (s.level < 4) scores.contemplate *= 0.55;
    let action = 'perch', best = -Infinity;
    for (const [a, v] of Object.entries(scores)) {
      if (v > best) { best = v; action = a; }
    }
    const meta = ASTRA_ACTIONS[action];
    const chain = [
      `候选加权：${Object.entries(scores).map(([k, v]) => `${ASTRA_ACTIONS[k].label}${v.toFixed(2)}`).join(' / ')}`,
      `胜出「${meta.label}」${best.toFixed(2)} · ${reasons[action].join('，')}`,
      `驱动 好奇${d.curiosity.toFixed(2)} 亲和${d.affinity.toFixed(2)} 元炁${d.vigor.toFixed(2)} 秩序${d.order.toFixed(2)}`,
      s.level < 3 ? 'L3 以前不生成寻访意图' : `成熟度 L${s.level} · ${ASTRA_LEVELS[s.level - 1].key}`,
      ctx.conversing ? '对话中：优先正面朝向使用者' : (ctx.userAway ? '感知到使用者离开：抑制寻访' : '使用者在附近'),
    ];
    return { action, motion: meta.motion, label: meta.label, text: meta.verb, score: r2(best), reason: chain, confidence: r2(clamp(best / 1.4)) };
  }

  function policySnapshot(successRate) {
    return {
      gen: s.generation, at: clock(), tick: s.heartbeats, epoch: s.epoch,
      policy: { ...s.policy }, drives: { ...s.drives },
      level: s.level, successRate: r2(successRate),
      goalsDone: s.selfModel.goalsDone, goalsFailed: s.selfModel.goalsFailed,
      memories: s.memory.episodic.length + s.memory.semantic.length,
    };
  }

  /**
   * 元认知：统计最近决策与目标推进的关系，据此调整策略权重。
   * 返回一份「自省报告」，是 evolve() 的唯一依据 —— 演化不是随机数。
   */
  function reflect() {
    const recent = s.audit.slice(-24).filter((a) => a.kind === 'decision');
    if (recent.length < 4) return { ok: false, reason: '样本不足', samples: recent.length };
    const tally = {};
    for (const a of recent) {
      const name = a.detail?.action;
      if (!name) continue;
      tally[name] = tally[name] || { n: 0, progress: 0 };
      tally[name].n++;
      tally[name].progress += a.detail?.progress ? 1 : 0;
    }
    const p = s.policy;
    const before = { ...p };
    const adjust = (k, delta) => { p[k] = r2(clamp(p[k] + delta, 0.05, 0.95)); };
    const success = (tally.wander?.progress || 0) + (tally.glide?.progress || 0);
    const failure = (tally.perch?.n || 0) + (tally.rest?.n || 0);
    if (success > failure) { adjust('explore', +0.035); adjust('focus', +0.020); adjust('rest', -0.015); }
    else { adjust('explore', -0.020); adjust('rest', +0.025); adjust('focus', -0.010); }
    if ((tally.seek?.n || 0) > 2) adjust('social', +0.025);
    if ((tally.contemplate?.n || 0) > 2) adjust('order', +0.025);
    adjust('boldness', s.feedback.negative > s.feedback.positive ? +0.020 : -0.008);
    const delta = Object.keys(p).map((k) => `${k} ${before[k].toFixed(3)}→${p[k].toFixed(3)}`);
    const report = {
      ok: true, samples: recent.length, tally,
      success, failure, delta,
      conclusion: success > failure ? '近期行动推进了目标，略微提高探索与专注' : '近期多处于驻留，略微提高静息与保守度',
    };
    audit('reflection', report);
    return report;
  }

  /** 自我迭代：以自省报告为依据生成新世代；快照可回滚。 */
  function evolve(force = false, cause = 'manual') {
    const rate = calcLevel(s).successRate;
    const report = reflect();
    if (!force && s.epoch > 0 && (s.heartbeats - (s.lineage.at(-1)?.tick || 0)) < REFLECT_EVERY) {
      return { changed: false, reason: '演化冷却中', generation: s.generation };
    }
    s.lineage.push(policySnapshot(rate));
    if (s.lineage.length > MAX_LINEAGE) s.lineage.shift();
    s.generation++;
    s.epoch++;
    s.selfModel.confidence = clamp(s.selfModel.confidence + 0.02);
    s.drives.curiosity = clamp(s.drives.curiosity + 0.03);
    const prevLevel = s.level;
    const lv = calcLevel(s);
    s.level = lv.level;
    const record = {
      gen: s.generation, at: clock(), tick: s.heartbeats, cause,
      level: s.level, levelUp: s.level > prevLevel,
      changes: report.delta || ['冷启动：采纳初始策略'],
      conclusion: report.conclusion || '首次自我迭代，建立基线世代',
      successRate: r2(rate),
    };
    audit('evolution', record);
    remember('episodic', `第 ${s.generation} 世：${record.conclusion}`, { kind: 'evolution' });
    persist(true);
    return { changed: true, ...record };
  }

  /** 回滚到指定世代：恢复策略与驱动，保留完整审计轨迹（不抹掉历史）。 */
  function rollback(gen) {
    const target = Number(gen);
    if (!Number.isFinite(target)) return { ok: false, error: '世代参数无效' };
    const snap = s.lineage.find((x) => x.gen === target) || (target === s.generation - 1 ? s.lineage.at(-1) : null);
    if (!snap) return { ok: false, error: `找不到第 ${target} 世快照` };
    s.policy = { ...snap.policy };
    s.drives = { ...snap.drives };
    s.generation = snap.gen;
    s.mood = deriveMood(s.drives);
    s.level = calcLevel(s).level;
    audit('rollback', { to: snap.gen, at: clock(), note: '策略与驱动已恢复，历史审计保留' });
    remember('episodic', `回滚到第 ${snap.gen} 世`, { kind: 'rollback' });
    persist(true);
    return { ok: true, generation: s.generation, restored: snap };
  }

  /** 一次心跳：驱动演化 → 情绪 → 目标 → 决策 → 记忆 → 周期性自省/演化。 */
  function tick(ctx = {}) {
    if (!s.autonomous && !ctx.force) return { skipped: true, reason: 'autonomous_off', state: status() };
    s.heartbeats++;
    const d = s.drives;
    // 驱动向基线缓慢回归 + 活动消耗（确定性，不含随机）
    for (const k of Object.keys(BASELINE)) {
      d[k] = r2(clamp(d[k] + (BASELINE[k] - d[k]) * 0.045));
    }
    d.vigor = r2(clamp(d.vigor - 0.006 + (ctx.conversing ? 0 : 0.002)));
    d.curiosity = r2(clamp(d.curiosity + 0.004));
    s.mood = deriveMood(d);

    const levelBefore = s.level;
    ensureGoals();
    const decision = decide(ctx);
    s.lastAction = decision.action;
    s.lastIntent = decision.text;
    // 完整理由链随状态广播，UI 才能展示"为什么这么做"而不是只给一个结论
    s.lastDecision = {
      action: decision.action, label: decision.label, text: decision.text,
      score: decision.score, confidence: decision.confidence,
      reason: [...decision.reason], at: clock(), tick: s.heartbeats,
    };
    const progressed = advanceGoals(decision.action);
    // v6.15：每轮心跳做一次真实自我迭代，观测来自本轮目标推进与反馈质量
    const iteration = selfIterate(undefined, { progressed: !!progressed });
    const lv = calcLevel(s);
    s.level = lv.level;
    if (s.level > levelBefore) {
      audit('level_up', { from: levelBefore, to: s.level, key: ASTRA_LEVELS[s.level - 1].key });
      remember('episodic', `等级升至 L${s.level} ${ASTRA_LEVELS[s.level - 1].key}`, { kind: 'level_up' });
    }
    audit('decision', {
      action: decision.action, score: decision.score, progress: !!progressed,
      top: decision.reason[1], level: s.level,
    });
    // 自省 / 演化：真实周期，不靠定时器随机触发
    let evolved = null;
    if (ctx.evolve || (s.heartbeats % REFLECT_EVERY === 0 && s.level >= 5)) {
      const r = evolve(false, 'auto');
      if (r.changed) evolved = r;
    }
    persist();
    return { skipped: false, decision, level: s.level, levelUp: s.level > levelBefore, evolved,
      iteration: iteration.record, state: status() };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // v6.15 · 自我迭代思考闭环
  //   观测（真实运行态）→ 预测 → 误差 → 贝叶斯更新 → 变分自由能 →
  //   误差分布香农熵 → 探索/利用策略 → 相位阻尼映射 → 审计与沉淀。
  //   每一步的数值都来自 DM 的真实计算，理由链记录公式名与输入输出。
  // ═══════════════════════════════════════════════════════════════════════
  function selfIterate(observation, opts = {}) {
    // 未显式给观测时，取自真实运行态：目标是否推进 + 反馈正比率（不编造输入）
    // IPC 序列化会把 undefined 变成 null；null 不能当成有效观测量 0
    const obs = (observation !== null && observation !== undefined && Number.isFinite(Number(observation)))
      ? clamp(Number(observation))
      : clamp(0.25 + (opts.progressed ? 0.5 : 0)
        + 0.25 * (s.feedback.total ? s.feedback.positive / s.feedback.total : 0.5));
    const r = DM.iterateSelf(s.deep, obs, { seed, at: clock() });
    s.deep = r.state;

    // 数学结论真的改变行为参数，而不是只展示数字
    const before = s.policy.explore;
    s.policy.explore = r2(clamp(0.55 * before + 0.45 * r.record.exploration, 0.05, 0.95));
    s.selfModel.confidence = r2(clamp(0.7 * s.selfModel.confidence + 0.3 * r.record.confidence));
    const quantum = DM.policyToQuantum(r.state.policy);
    const record = {
      ...r.record,
      policyBefore: r2(before), policyAfter: s.policy.explore,
      quantum: {
        lambda: quantum.lambda, entropyBefore: quantum.entropyBefore,
        entropyAfter: quantum.entropyAfter, purityAfter: quantum.purityAfter,
      },
    };
    // 让落盘的迭代日志也带上真实退相干量，界面无需二次推算
    if (s.deep.log.length) s.deep.log[s.deep.log.length - 1].quantum = record.quantum;
    audit('self_iteration', {
      generation: r.state.generation, observation: obs,
      prediction: r.record.prediction, error: r.record.error,
      freeEnergy: r.record.freeEnergy, entropy: r.record.entropyNormalized,
      decision: r.record.decision, explore: `${before.toFixed(3)}→${s.policy.explore.toFixed(3)}`,
    });
    // 每 5 轮沉淀一条长期记忆，避免每 1.5 秒刷屏
    if (r.state.generation % 5 === 0) {
      remember('semantic',
        `第 ${r.state.generation} 轮自我迭代：预测 ${r.record.prediction} / 观测 ${obs} / 误差 ${r.record.error} / 自由能 ${r.record.freeEnergy}`,
        { kind: 'self_iteration' });
    }
    persist();
    return { record, state: deepStatus() };
  }

  function deepStatus() {
    const d = s.deep;
    return {
      generation: d.generation,
      model: { ...d.model }, policy: { ...d.policy },
      last: d.log.length ? { ...d.log[d.log.length - 1] } : null,
      log: d.log.slice(-12).map((x) => ({ ...x })),
      boundary: DM.DEEP_MATH_BOUNDARY,
    };
  }
  function deepMathCheck() { return DM.selfCheck(); }

  function status() {
    const lv = calcLevel(s);
    const levelInfo = ASTRA_LEVELS[Math.max(0, Math.min(6, (s.level || lv.level) - 1))];
    return {
      schema: SCHEMA,
      bornAt: s.bornAt, lastActiveAt: s.lastActiveAt,
      heartbeats: s.heartbeats, generation: s.generation, epoch: s.epoch,
      autonomous: s.autonomous,
      drives: { ...s.drives }, mood: { ...s.mood }, policy: { ...s.policy },
      level: s.level || lv.level, levelInfo, levelProgress: lv.progress,
      maturity: lv.maturity, successRate: lv.successRate,
      selfModel: { ...s.selfModel },
      goals: s.goals.map((g) => ({ ...g })),
      feedback: { ...s.feedback },
      counts: {
        episodic: s.memory.episodic.length, semantic: s.memory.semantic.length,
        audit: s.audit.length, generations: s.lineage.length,
      },
      memory: {
        episodic: s.memory.episodic.slice(-24).reverse(),
        semantic: [...s.memory.semantic].sort((a, b) => b.weight - a.weight).slice(0, 24),
      },
      lineage: s.lineage.slice(-MAX_LINEAGE).map((x) => ({ ...x })),
      audit: s.audit.slice(-30).reverse(),
      intent: {
        action: s.lastAction, label: ASTRA_ACTIONS[s.lastAction]?.label || '驻留',
        text: s.lastIntent || '正在唤醒', motion: ASTRA_ACTIONS[s.lastAction]?.motion || 'perch',
      },
      lastDecision: s.lastDecision ? { ...s.lastDecision, reason: [...s.lastDecision.reason] } : null,
      boundary: ASTRA_BOUNDARY,
      // v6.15：自我迭代的真实数值与算法边界（不是叙事状态）
      deep: deepStatus(),
      levels: ASTRA_LEVELS, drivesMeta: ASTRA_DRIVES, actions: ASTRA_ACTIONS,
    };
  }

  return {
    status, tick, perceive, reflect, evolve, rollback,
    selfIterate, deepStatus, deepMathCheck,
    audit: (n = 40) => s.audit.slice(-Math.max(1, Math.min(MAX_AUDIT, n))).reverse(),
    memories: (n = 40) => ({
      episodic: s.memory.episodic.slice(-n).reverse(),
      semantic: [...s.memory.semantic].sort((a, b) => b.weight - a.weight).slice(0, n),
    }),
    setAutonomous: (on) => { s.autonomous = !!on; audit('autonomy', s.autonomous ? '开启' : '关闭'); persist(true); return s.autonomous; },
    registerDistance: (px) => { s.selfModel.distance += Math.max(0, Math.round(Number(px) || 0)); },
    reset: () => { s = blank(clock(), seed); audit('boot', '重置为第一世'); persist(true); return status(); },
    _raw: () => s,
  };
}

module.exports = {
  createAstraMind,
  DEEP_MATH_BOUNDARY: DM.DEEP_MATH_BOUNDARY,
  ASTRA_BOUNDARY, ASTRA_LEVELS, ASTRA_DRIVES, ASTRA_ACTIONS,
  _internals: { deriveMood, calcLevel, nextRandom, blank },
};
