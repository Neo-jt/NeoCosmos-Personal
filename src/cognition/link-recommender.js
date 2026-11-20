// 关联推荐器（v6.29.0 功能②）
// ---------------------------------------------------------------------------
// 问题：用户往知识库里加了卡片，但没建任何 [[双链]]，星图就是一盘散沙，
//       扩散检索也无从发力。不少人知道"该连一连"，却不知道连谁、为什么连。
//
// 解决：当用户尚未（或尚未充分）建立关联时，基于【用户自己库里的真实信号】
//       主动推荐候选关联，每条都给出"凭什么推荐"的可核查证据，由用户一键确认
//       才真正建边。机器只建议、不擅自连，人工始终主导。
//
// 真实信号（全部来自当前 store 的实时计算，零内置数据、零编造）：
//   · shared_tag     两张卡共享 frontmatter/正文标签
//   · shared_term    正文共享有意义术语（交集达到阈值）
//   · co_cited       在同一轮问答沉淀里被一起引用过（qaPairs[].cited_node_ids 共现）
//   · broken_link    本卡 [[X]] 指向的 X 实际存在，却还没建立显式边（待生长）
//
// 纪律：
//   1. 只返回建议对象，绝不调用 store.addEdge —— 建边权永远在人手里；
//   2. 已经存在任意方向的边（任意类型）就不再推荐，避免噪音；
//   3. 不读、不改、不写任何卡片正文；
//   4. 相似度/共现都是可复核的确定性算法，不用随机、不喂虚构权重。
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from '../storage/store.js';
import { loadModel as loadRamModel, infer as ramInfer } from './relational-runtime.js';

const __here = path.dirname(fileURLToPath(import.meta.url));
function resolveModelTextNode() {
  try {
    const candidates = [
      path.join(__here, '..', '..', 'assets', '_model', 'relational-model.json'), // staged: app/src/cognition -> app/assets
      path.join(process.cwd(), 'desktop', 'assets', '_model', 'relational-model.json'), // 仓库直接跑
    ];
    for (const p of candidates) if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch { /* 无 fs 权限或路径不存在：如实降级为人工权重 */ }
  return null;
}

/**
 * v6.30.0：真实训练出的 RAM 关联模型接入。
 * 模型只做信号微调，不改变"无真实证据不推荐"的纪律；加载/校验失败如实降级，
 * modelActive=false，不假装在用。modelText 可由调用方/测试显式注入；
 * 否则在 Node 侧按候选路径读取随包 assets/_model/relational-model.json。
 */
function resolveModelText(opts) {
  if (opts.model === 'off') return null;          // 显式关闭（baseline 对比 / 测试）
  if (typeof opts.modelText === 'string') return opts.modelText; // 测试/宿主注入
  if (opts.modelLoader) { // 宿主可注入同步读取器（便于打包/沙箱环境）
    try { return opts.modelLoader(); } catch { return null; }
  }
  return resolveModelTextNode(); // 见文件末尾注入的 Node 读取器（ESM 用 createRequire）
}

/**
 * 把本条候选的【真实信号】映射为模型的 6 维特征（顺序严格对齐 RAM_FEATURES）：
 *   path_overlap     ← 同目录信号（co_location）
 *   name_similarity  ← 标题字符 bigram 余弦（真实标题计算）
 *   shared_imports   ← 本场景无"共享依赖"，恒 0（保持特征语义，不编造）
 *   content_overlap  ← 正文共享术语 Jaccard（真实术语集）
 *   depth_proximity  ← 标签重合度（结构邻近代理，真实计算）
 *   boundary_cross   ← 不同形态/类型跨度（此处同库恒 0，不编造跨边界）
 * 每维都来自真实可复核数据；无对应真实信号处如实给 0，不虚构。
 */
function signalFeatures(target, n, ctx) {
  const bigrams = (s) => { const t = String(s || '').toLowerCase(); const o = new Set();
    for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
  const cos = (a, b) => { if (!a.size || !b.size) return 0; let k = 0;
    for (const x of a) if (b.has(x)) k++; return k / Math.sqrt(a.size * b.size); };
  const jac = (a, b) => { const u = new Set([...a, ...b]); if (!u.size) return 0;
    let k = 0; for (const x of a) if (b.has(x)) k++; return k / u.size; };
  const tTags = new Set(target.tags || []);
  const nTags = new Set(n.tags || []);
  return [
    ctx.sameDir ? 1 : 0,                                   // path_overlap
    cos(bigrams(target.title), bigrams(n.title)),          // name_similarity
    0,                                                      // shared_imports（知识卡场景无此信号，如实 0）
    jac(ctx.targetTerms, ctx.nTerms),                       // content_overlap
    jac(tTags, nTags),                                      // depth_proximity（标签重合代理）
    0,                                                      // boundary_cross（同库无跨顶层边界，如实 0）
  ];
}

const STOP = new Set([
  '的', '了', '和', '与', '在', '是', '有', '为', '对', '中', '本案', '法院', '认定',
  '一个', '我们', '可以', '需要', '通过', '进行', '以及', '或者', '这个', '那种',
  '什么', '怎么', '为什么', '如果', '因为', '所以', '但是', '而且', '这些', '那些',
]);

/** 正文术语集合（去停用词、去单字、限长，控制成本） */
function termSet(text, limit = 48) {
  const out = new Set();
  for (const w of tokenize(String(text || ''))) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(w);
    if (out.size >= limit) break;
  }
  return out;
}

const dirOf = (rel) => { const i = String(rel || '').lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };

/**
 * 为某张卡推荐候选关联。
 * @param {import('../storage/store.js').KbStore} store
 * @param {string} targetId 目标卡片 node id（为它找可连的邻居）
 * @param {{topK?:number, minSharedTerms?:number, maxCandidates?:number}} opts
 * @returns {{targetId:string, targetTitle:string, currentDegree:number, suggestions:Array}}
 *          suggestions 每项形如 { kind:'link', payload:{src,dst,type,weight,reason,signals}, score }
 */
export function recommendLinks(store, targetId, opts = {}) {
  // v6.30.0：加载真实训练出的 RAM 关联模型（校验失败/缺文件即如实降级）。
  // model='off' 为显式关闭（A/B 对比/测试）：直接给降级对象，不复用模块级缓存，
  // 避免"先前加载过 active 模型后，off 调用仍误用缓存"的跨调用污染。
  const model = opts.model === 'off'
    ? { active: false, reason: '显式关闭（baseline/对比）', meta: null, weights: null }
    : loadRamModel(() => resolveModelText(opts));
  const topK = Math.max(1, Math.min(opts.topK || 8, 30));
  const minSharedTerms = Math.max(2, opts.minSharedTerms || 3);
  const maxCandidates = Math.max(20, opts.maxCandidates || 200);
  const target = store.getNode(targetId);
  if (!target) return { targetId, targetTitle: null, currentDegree: 0, suggestions: [] };

  // 现有边（任意方向/类型）——已连的不再推荐
  const connected = new Set();
  for (const e of store.edges.values()) {
    if (e.src === targetId) connected.add(e.dst);
    if (e.dst === targetId) connected.add(e.src);
  }
  const currentDegree = connected.size;

  const targetTags = new Set(target.tags || []);
  const targetTerms = termSet(target.fts_text || `${target.title} ${(target.tags || []).join(' ')}`);
  const targetDir = dirOf(target.path);

  // 共引索引：同一轮问答沉淀里一起被引用的卡片对（真实 qa 账本）
  const coCite = new Map(); // otherId -> count
  for (const q of store.qaPairs || []) {
    const cited = q.cited_node_ids || q.cited_nodes || [];
    if (!cited.includes(targetId)) continue;
    for (const c of cited) if (c !== targetId) coCite.set(c, (coCite.get(c) || 0) + 1);
  }

  // [[双链]] 待连：索引器会给「指向已存在卡」的 [[双链]] 自动建 explicit_link，
  // 所以那种情况已在 connected 里、不再推荐。这里只处理真正需要辅助的一种：
  // 本卡写了 [[X]]，X 在库里没有同名卡（断链），但存在标题与 X 近似（子串包含）
  // 的真实卡、且尚未连接 —— 把断链引导到最可能的真实目标上，避免用户白写双链。
  const all = store.allNodes().filter((n) => !n.archived && n.id !== targetId);
  const brokenHint = new Map(); // candidateId -> 命中的断链标题
  for (const l of (target.links || [])) {
    const lt = String(l).replace(/^#/, '').trim();
    if (!lt) continue;
    // 精确同名已由索引器处理；这里找"包含关系"的近似标题
    for (const n of all) {
      const nt = String(n.title || '');
      if (!nt || connected.has(n.id)) continue;
      if (nt.includes(lt) || lt.includes(nt)) {
        if (!brokenHint.has(n.id)) brokenHint.set(n.id, lt);
      }
    }
  }

  const scored = [];
  let compared = 0;
  for (const n of store.allNodes()) {
    if (n.id === targetId || n.archived || connected.has(n.id)) continue;
    if (compared++ >= maxCandidates) break;

    const signals = [];
    let score = 0;
    const sameDir = !!(targetDir && dirOf(n.path) === targetDir);

    // 1) 共享标签
    const sharedTags = (n.tags || []).filter((t) => targetTags.has(t) && t && t.length > 1);
    if (sharedTags.length) {
      signals.push({ kind: 'shared_tag', evidence: `共享标签 #${sharedTags.slice(0, 3).join(' / #')}` });
      score += Math.min(3, sharedTags.length) * 0.9;
    }

    // 2) 正文共享术语
    const nTerms = termSet(n.fts_text || `${n.title} ${(n.tags || []).join(' ')}`);
    let shared = 0; const words = [];
    for (const w of targetTerms) {
      if (nTerms.has(w)) { shared++; if (words.length < 4) words.push(w); }
    }
    if (shared >= minSharedTerms) {
      signals.push({ kind: 'shared_term', evidence: `共享术语：${words.join('、')}（共 ${shared} 个）` });
      score += Math.min(4, shared) * 0.35;
    }

    // 3) 共同引用（同一轮问答被一起召回/引用）
    const cc = coCite.get(n.id) || 0;
    if (cc > 0) {
      signals.push({ kind: 'co_cited', evidence: `在同一轮问答里被一起引用 ${cc} 次` });
      score += Math.min(3, cc) * 0.8;
    }

    // 4) 双链待连：本卡写了 [[近似标题]] 但库里无同名卡，指向这张真实候选
    if (brokenHint.has(n.id)) {
      signals.push({ kind: 'broken_link', evidence: `本卡正文 [[${brokenHint.get(n.id)}]] 未精确命中卡片，与这张「${n.title}」标题相近，建议确认是否关联` });
      score += 2.5;
    }

    // 5) 同目录弱加权（结构邻近，仅作为并列信号，不单独成建议）
    if (sameDir) {
      signals.push({ kind: 'co_location', evidence: '位于同一主题目录' });
      score += 0.15;
    }

    if (!signals.length) continue; // 没有任何真实证据，绝不推荐

    // 6) v6.30.0 RAM 模型微调：把上面全部【真实信号】映射为 6 维特征，
    //    用真实训练出的权重给一个关联概率 modelProb，对 score 做温和缩放。
    //    纪律：模型不改变"有无证据"的判定，只在已成立的真实建议上重排。
    let modelProb = null;
    if (model.active) {
      const feats = signalFeatures(target, n, { targetTerms, nTerms, sameDir });
      modelProb = ramInfer(model, feats);
      if (typeof modelProb === 'number' && Number.isFinite(modelProb)) {
        // 模型概率 ∈[0,1] 映射到 [0.85,1.15] 的温和系数，避免单一模型主导人工可核查信号
        score *= 0.85 + 0.30 * modelProb;
      }
    }

    // 7) v6.31.0 NeoLM：真实词向量 cosine，只做温和重排。
    //    纪律同 RAM：绝不制造建议（上面"无真实证据即不推荐"仍是硬规则），
    //    也不改变边类型；模型不可用时 semanticSim 如实为 null。
    let semanticSim = null;
    const lm = opts.neolm;
    if (lm && lm.active && typeof lm.similarity === 'function') {
      try {
        const a = `${target.title || ''} ${(target.tags || []).join(' ')}`.slice(0, 180);
        const b = `${n.title || ''} ${(n.tags || []).join(' ')}`.slice(0, 180);
        const sim = lm.similarity(a, b);
        if (Number.isFinite(sim)) {
          semanticSim = Number(sim.toFixed(5));
          score *= 0.92 + 0.16 * Math.max(0, Math.min(1, sim));
        }
      } catch { semanticSim = null; }
    }

    // 依据最强信号决定边类型（真实语义，不虚构）
    const kinds = new Set(signals.map((s) => s.kind));
    let type = 'semantic_similar';
    if (kinds.has('broken_link')) type = 'explicit_link';   // 正文已双链 → 人写显式链接
    else if (kinds.has('co_cited')) type = 'co_occurrence'; // 同轮共引 → 共现
    const weight = type === 'explicit_link' ? 1.0
      : type === 'co_occurrence' ? 0.35
        : Math.min(0.7, 0.4 + 0.05 * signals.length);

    const reason = signals.map((s) => s.evidence).join('；');
    scored.push({
      kind: 'link',
      payload: { src: targetId, dst: n.id, dstTitle: n.title, type, weight: Number(weight.toFixed(2)),
        reason: `关联建议（基于真实信号，人工确认后建立）：${reason}`, signals,
        modelProb: modelProb == null ? null : Number(modelProb.toFixed(4)),
        semanticSim },
      score: Number(score.toFixed(3)),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    targetId, targetTitle: target.title, currentDegree,
    signalLegend: {
      shared_tag: '共享标签', shared_term: '正文共享术语', co_cited: '同轮共引',
      broken_link: '正文双链未连', co_location: '同主题目录',
    },
    // v6.30.0 模型状态：如实标注是否启用，绝不假装模型在跑
    model: {
      active: model.active,
      reason: model.reason,
      schema: model.meta?.schema || null,
      modelHash: model.meta?.provenance?.modelHash || null,
      aucOnHoldout: model.meta?.evaluation?.aucRam ?? null,
      features: model.meta?.features || null,
    },
    suggestions: scored.slice(0, topK),
  };
}

/**
 * 全库视角：统计"尚未建立任何关联"的卡片数，用于向用户说明"为什么需要辅助建关联"。
 * 纯只读、真实计数。
 */
export function orphanStats(store, opts = {}) {
  const degree = new Map();
  for (const e of store.edges.values()) {
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
  }
  const nodes = store.allNodes().filter((n) => !n.archived);
  let orphans = 0;
  for (const n of nodes) if (!degree.get(n.id)) orphans++;
  return {
    total: nodes.length,
    orphans,
    connected: nodes.length - orphans,
    ratio: nodes.length ? Number((orphans / nodes.length).toFixed(4)) : 0,
    sampled: opts.sampled || false,
  };
}
