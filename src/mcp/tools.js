// NeoCosmos MCP 工具契约实现（12 个工具）
// 所有写操作记 caller 与 journal；外部 Agent 默认无写正文权限（对应 R7）。
//
// v1.1.0 修复：
//  · kb_write_back  强化对象改为"本次新建的 question_answer 边"（原先误强化随机旧边）
//  · qaPairs 字段对齐（cited_node_ids / created_at / confidence / tags / origin），
//    修复 UI 沉淀引用与来源时间永远为空的问题
//  · kb_apply_review 支持按待整理项 id 分派，返回真实执行结果（applied + note）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHostConfig, HOST_IDS } from './hosts.js';
import { activate, retrieveForAsk } from '../engine/diffusion.js';
import { reinforce } from '../engine/edges.js';
import { appendToSedimentZone } from '../storage/markdown.js';
import { ConsolidationScheduler } from '../consolidation/consolidate.js';
// v6.29.0 功能②：辅助建立知识关联（真实信号推荐，只建议不建边）
import { recommendLinks, orphanStats } from '../cognition/link-recommender.js';
// v6.32.0 语义回流层：调取 / 沉淀回写 / 库关联共用同一份真实模型向量索引
import {
  resolveSemantic, semanticSeeds, cardText, sharedTerms, cosine,
} from '../cognition/semantic-bridge.js';
// v6.3.0：类脑法律思维内核（数据常量由 本项目自研认知规格 真源编译，算法本地深加工）
import {
  featuresFromEvidence, deliberate, gradeOfHit, calibratedConfidence,
  confidenceBand, metacogReport, GRADE_WEIGHT_DEFAULT,
  frameIssues, assignBurden, assessOnus, splitTracks, discretionFor,
  buildDebate, buildHypotheses, metacogAnswers, composeAnswer, BOUNDARY_TEXT,
  runWorkflowSync, stageActivation, spreadActivation, SOURCE,
} from '../cognition/index.js';

function relFromAbs(store, abs) {
  return path.relative(store.root, abs).replace(/\\/g, '/');
}

/**
 * v6.32.0：调取链路的语义种子。模型不可用时如实降级为空种子，
 * 原有 BM25 + 激活扩散行为完全不变（不假装模型在跑）。
 */
function semanticForQuery(ctx, store, query, opts = {}) {
  if (opts.enabled === false) {
    return { active: false, reason: '调用方显式关闭语义链路', seeds: [], modelId: null };
  }
  const r = resolveSemantic(ctx, store);
  if (!r.active) return { active: false, reason: r.reason, seeds: [], modelId: null };
  try {
    // v6.37.0 性能优化：检索热路径只消费 seeds（激活扩散起点），expandedTerms 纯展示字段。
    // 计算它会触发 neolm.expandQuery 全扫 805MB 权重矩阵（每次击键 ~2 亿次乘加），
    // 而 activate() 根本不用它。这里显式关闭证据扩展，召回/排序结果 100% 不变。
    // 需要展示扩展词的调用方（如语义调试视图）可自行传 withEvidence:true。
    const s = semanticSeeds(r.index, query, {
      topK: opts.topK || 6,
      withEvidence: opts.withEvidence === true,   // 默认 false：热路径摘除全矩阵扫描
    });
    return {
      active: !!s.active, reason: s.active ? null : (s.reason || null),
      modelId: r.index.modelId, indexedCards: r.index.vectors.size,
      seeds: s.seeds || [], expandedTerms: s.expandedTerms || [], method: s.method || null,
      baseline: s.baseline ?? null, compared: s.compared ?? null,
    };
  } catch (e) {
    return { active: false, reason: `语义种子计算失败：${e?.message || e}`, seeds: [], modelId: null };
  }
}

/** 给工具返回体加一份统一的、如实标注的语义状态摘要 */
function semanticSummary(sem) {
  return {
    active: !!sem.active,
    reason: sem.reason || null,
    modelId: sem.modelId || null,
    indexedCards: sem.indexedCards ?? null,
    method: sem.method || null,
    baseline: sem.baseline ?? null,
    compared: sem.compared ?? null,
    expandedTerms: sem.expandedTerms || [],
    seeds: (sem.seeds || []).map((s) => ({ id: s.id, sim: s.sim, lift: s.lift ?? null })),
  };
}

// v6.18.0：产品版本单一真源 = desktop/package.json。
// 旧版 kb_legal_mind 把 engineVersion 写死 6.3.0，外部 Agent 拿到的是过期能力集；
// 读不到时宁可报 unknown，也不给一个与实际不符的数字。
let _productVersion;
function productVersion() {
  if (_productVersion !== undefined) return _productVersion;
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));
    _productVersion = pkg.version || 'unknown';
  } catch { _productVersion = 'unknown'; }
  return _productVersion;
}

// 外部 stdio Agent 的可写范围：只允许在 _memory/ 下新建文件，且永不覆盖已有文件。
// 这条边界由服务端判定，不接受调用方自报（见 server.js 的 caller 归一）。
function assertWritableTarget(store, ctx, rel, mustNotExist = true) {
  const clean = String(rel || '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || clean.includes('..') || path.isAbsolute(rel)) {
    return { error: 'invalid_path', message: '路径必须是知识库内的相对路径' };
  }
  if (ctx.canWriteBody !== true && !clean.startsWith('_memory/')) {
    return { error: 'write_denied', message: '外部 Agent 只能在 _memory/ 沉淀区新建卡片，不能写入用户正文目录' };
  }
  let abs;
  try {
    abs = store.resolver.resolve(clean);
    store.resolver.ensureInside(abs);
  } catch (e) {
    return { error: 'path_outside_vault', message: String(e?.message || e) };
  }
  if (mustNotExist && fs.existsSync(abs)) {
    return { error: 'file_exists', message: '目标文件已存在，拒绝覆盖用户内容' };
  }
  return { abs, rel: clean };
}

// -------- kb_search：找知识（激活扩散 + 联想路径） --------
function kb_search(store, ctx, args) {
  const filters = args.filters || {};
  // v6.32.0：NeoLM 真实向量召回的语义种子作为扩散起点（模型不可用即空数组）
  const sem = semanticForQuery(ctx, store, args.query, { enabled: args.semantic !== false, topK: 6 });
  let hits = activate(store, args.query, {
    topK: args.top_k || 8, hops: args.hops || 2, semanticSeeds: sem.seeds,
  });
  if (filters.memory_layer) hits = hits.filter((h) => store.getNode(h.id)?.memory_layer === filters.memory_layer);
  if (filters.domain) hits = hits.filter((h) => store.getNode(h.id)?.domain === filters.domain);
  return {
    results: hits.map((h) => {
      const n = store.getNode(h.id);
      return {
        id: h.id, title: n?.title, path: n?.path,
        score: h.score, confidence: h.confidence,
        activation_path: h.activation_path,
        path_explained: h.path_explained,
        semantic_seed: !!h.semantic_seed,
        semantic_sim: h.semantic_sim ?? null,
      };
    }),
    // 语义来源如实单列：种子 id / 真实 cosine / 扩展词 / 模型指纹，绝不混入 BM25 分数
    semantic: semanticSummary(sem),
  };
}

// -------- kb_read：取全文 --------
function kb_read(store, ctx, args) {
  // v6.18.0：契约里写了「node_id 或 path」与 max_chars，旧实现两个参数都被忽略。
  // 现在按真实 store 索引解析，绝不拿外部传入的绝对路径直接读盘。
  let node = args.node_id ? store.getNode(args.node_id) : null;
  if (!node && args.path) {
    const wanted = String(args.path).replace(/\\/g, '/').replace(/^\/+/, '');
    node = store.allNodes().find((n) => n.path === wanted || n.path?.endsWith('/' + wanted)) || null;
  }
  if (!node) return { error: 'node_not_found', node_id: args.node_id || null, path: args.path || null };
  const abs = store.resolver.resolve(node.path);
  let text = fs.readFileSync(abs, 'utf8');
  const max = Math.max(0, Math.floor(Number(args.max_chars) || 0));
  const truncated = max > 0 && text.length > max;
  if (truncated) text = text.slice(0, max);
  const neighbors = store.edgesOf(node.id).map((e) => {
    const other = e.src === node.id ? e.dst : e.src;
    const n = store.getNode(other);
    return { edge: e.type, to: other, title: n?.title, weight: Number(e.weight.toFixed(3)) };
  });
  return {
    id: node.id, title: node.title, path: node.path, text,
    chars: text.length, truncated,
    neighbors: neighbors.slice(0, 10),
  };
}

// -------- kb_expand：联想展开子图 --------
function kb_expand(store, ctx, args) {
  // v6.18.0 修复：旧实现只沿 e.dst 扩展，遇上「本节点是边的终点」时会漏掉整条
  // 反向关联；并且同一条边会在多跳里被重复写入。现在按无向语义对称展开并去重。
  if (!store.getNode(args.node_id)) return { error: 'node_not_found', node_id: args.node_id || null };
  const hops = Math.max(1, Math.min(4, Number(args.hops) || 2));
  const adj = store.adjacency();
  const visited = new Set([args.node_id]);
  const seenEdges = new Set();
  const nodes = new Map(); const edges = [];
  let frontier = [args.node_id];
  for (let d = 1; d <= hops && frontier.length; d++) {
    const next = [];
    for (const u of frontier) {
      for (const e of (adj.get(u) || [])) {
        if (args.edge_types && !args.edge_types.includes(e.type)) continue;
        const other = e.src === u ? e.dst : e.src;
        const key = e.id || `${e.src}|${e.dst}|${e.type}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          edges.push({ src: e.src, dst: e.dst, type: e.type, weight: Number(e.weight.toFixed(3)) });
        }
        if (other && !visited.has(other)) {
          visited.add(other);
          nodes.set(other, store.getNode(other)?.title);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { root: args.node_id, hops, nodes: [...nodes.entries()].map(([id, title]) => ({ id, title })), edges };
}

// -------- kb_ask：端到端问答（离线可降级，不强制模型） --------
// v4.1.0：每个被引 md 都附「引用溯源」能力 ——
//   · snippet：从 node.fts_text（已是纯文本）里命中最密段落的片段，作为"被具体引用的内容"
//   · anchor ：片段的稳定哈希，供渲染层精确定位/高亮
//   · verify ：验证深链 neolink://verify/<vaultId>/<nodeId>?s=<片段>，点击即回溯到知识库对应内容
// 答案文本末尾再追加一份「引用溯源」清单（每条带可点击验证链接），
// 使答案无论被谁消费（外部 Agent / 浏览器深链 / 本客户端问一问）都自解释、可回溯。
function kb_ask(store, ctx, args) {
  const question = args.question;
  const vaultId = ctx.vaultId || '';
  // v6.18.0 修复：契约一直写着「命中已有沉淀则直接复用（成本低）」，
  // 旧代码却只把 cached.id 放进返回字段，答案照样重新拼一遍 —— 描述与实现不符。
  // 现在真正复用沉淀答案，并把引用卡片按沉淀记录里的真实 node_id 还原。
  const cached = store.qaPairs.find((q) => q.question === question);
  if (cached && args.mode !== 'generate') {
    // v6.32.0：命中已有沉淀时本轮没有发生调取，如实标注语义链路未触发，不编造种子。
    const ids = cached.cited_node_ids || cached.cited_nodes || [];
    const cited = ids.map((raw) => {
      const id = typeof raw === 'string' ? raw : raw?.id;
      const n = id && store.getNode(id);
      if (!n) return null;
      const snippet = extractSnippet(n, question);
      return {
        id, title: n.title, path: n.path, confidence: cached.confidence ?? cached.score ?? null,
        snippet, anchor: hashStr(snippet).toString(16),
        verify: `neolink://verify/${vaultId}/${id}?s=${encodeURIComponent(snippet)}`,
      };
    }).filter(Boolean);
    return {
      question, answer: cached.answer, cited_nodes: cited,
      retrieved_node_ids: ids,
      hit_existing_sediment: cached.id, from_sediment: true, mode: 'reuse',
      semantic: semanticSummary({ active: false, reason: '命中已有沉淀答案，本轮未触发语义召回' }),
    };
  }
  // v6.32.0：调取时把 NeoLM 真实向量召回的语义种子交给激活扩散；
  // 同时把本轮真实调取到的 id 原样返回，供 kb_write_back 建立「沉淀 ↔ 调取」关联。
  const sem = semanticForQuery(ctx, store, question, { enabled: args.semantic !== false, topK: 6 });
  const hits = retrieveForAsk(store, question, { topK: 6, semanticSeeds: sem.seeds });
  let answer;
  if (args.mode === 'generate') {
    answer = hits.map((h) => `【${h.node.title}】${(h.node.fts_text || '').slice(0, 160)}`).join('\n');
  } else {
    answer = hits.map((h) => h.node?.title).join('、');
  }
  const cited_nodes = hits.map((h) => {
    const snippet = extractSnippet(h.node, question);
    const anchor = hashStr(snippet);
    const verify = `neolink://verify/${vaultId}/${h.id}?s=${encodeURIComponent(snippet)}`;
    return {
      id: h.id, title: h.node?.title, path: h.node?.path,
      confidence: h.confidence, snippet, anchor: anchor.toString(16), verify,
      semantic_seed: !!h.semantic_seed, semantic_sim: h.semantic_sim ?? null,
    };
  });
  // 答案文本末尾追加「引用溯源」清单 —— 每一条都是可点击的验证深链
  if (cited_nodes.length) {
    const list = cited_nodes.map((c) => `- [${c.title} ↗](${c.verify})`).join('\n');
    answer = `${answer}\n\n## 引用溯源（点击验证链接可回溯至知识库中对应的具体内容）\n${list}`;
  }
  return {
    question, answer,
    cited_nodes,
    retrieved_node_ids: hits.map((h) => h.id),
    hit_existing_sediment: cached ? cached.id : null,
    from_sediment: false,
    semantic: semanticSummary(sem),
    mode: args.mode === 'generate' ? 'generate' : 'retrieve_only',
  };
}

/**
 * 从节点纯文本（fts_text）中抽取与 query 最相关的片段，作为"被具体引用的内容"。
 * 命中最密段落、截断到 220 字符、折叠空白，确保后续可在渲染后的 DOM 文本中子串定位。
 */
function extractSnippet(node, query) {
  const text = (node && (node.fts_text || node.title)) || '';
  if (!text) return '';
  const paras = String(text).split(/\n{1,}/).map((s) => s.trim()).filter(Boolean);
  if (!paras.length) return String(text).slice(0, 200);
  const qTokens = String(query || '').toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
  const score = (p) => {
    if (!qTokens.length) return 0;
    const lo = p.toLowerCase();
    return qTokens.reduce((a, t) => a + (lo.includes(t) ? 1 : 0), 0);
  };
  let best = paras[0], bestScore = -1;
  for (const p of paras) { const s = score(p); if (s > bestScore) { bestScore = s; best = p; } }
  let snip = best || String(text).slice(0, 200);
  if (snip.length > 220) snip = snip.slice(0, 220);
  return snip.replace(/\s+/g, ' ').trim();
}

// -------- kb_write_back：回写沉淀（核心闭环，对应 R3） --------
function kb_write_back(store, ctx, args) {
  const ts = new Date().toISOString();
  // v6.23.0：用户可为「沉淀回写」指定一个专用知识库。ctx.sedimentStore 存在时，
  // 检索/引用仍来自源库 store，但卡片真实写进目标库；不存在时行为与 6.22.0 完全一致。
  // 跨库时不建立指向源库的图边（那会是悬空引用），改为把引用 id 与源库 id 如实写进正文。
  const wStore = (ctx && ctx.sedimentStore) || store;
  const crossVault = wStore !== store;
  let id = 'qa_' + Math.abs(hashStr(args.question + ts)).toString(16);
  const cited = args.cited_node_ids || [];
  // 新建沉淀卡片（追加式，绝不覆盖人写正文）。
  // v6.18.0：若同名文件已存在，换稳定的编号后缀而不是直接覆盖。
  let target = assertWritableTarget(wStore, ctx, `_memory/semantic/sediment-${id}.md`);
  for (let i = 1; target.error === 'file_exists' && i < 32; i++) {
    id = `qa_${Math.abs(hashStr(args.question + ts)).toString(16)}_${i}`;
    target = assertWritableTarget(wStore, ctx, `_memory/semantic/sediment-${id}.md`);
  }
  if (target.error) return { error: target.error, message: target.message };
  const cardPath = target.abs;
  const rel = target.rel;
  const lines = [
    `---`,
    `neokb_id: ${id}`,
    `kind: qa`,
    `memory_layer: semantic`,
    `domain: ${args.tags?.[0] || '沉淀'}`,
    `created: ${ts}`,
    ...(crossVault ? [
      `source_vault_id: ${ctx.vaultId || ''}`,
      `sediment_vault_id: ${ctx.sedimentVaultId || ''}`,
    ] : []),
    `---`,
    `# ${args.question}`,
    ``,
    args.answer,
  ];
  if (crossVault && cited.length) {
    lines.push(``, `## 引用卡片（源知识库）`,
      ...cited.map((cid) => `- \`${cid}\``), ``,
      `> 跨库沉淀：源库 ${ctx.vaultId || '未知'} 的卡片 id 记录在此，本沉淀库不建立指向源库的悬空图边。`);
  }
  lines.push(``, `> 来源: ${ctx.caller} | 置信度: ${args.confidence ?? 'n/a'}`);
  const block = lines.join('\n');
  fs.mkdirSync(path.dirname(cardPath), { recursive: true });
  const beforeHash = 'new-file';
  fs.writeFileSync(cardPath, block, 'utf8');
  wStore.journal('write_back_create', rel, beforeHash, null, ctx.caller);

  const cardNode = wStore.upsertNodeFromFile(cardPath, rel);

  // ---- v6.32.0 语义回流层：新沉淀卡 ↔ 本轮引用卡 / 本轮调取卡 ----
  // 纪律：模型只算分数与证据，绝不凭 cosine 自动建边。真实引用才建
  // question_answer 边；「本轮调取到却没引用」的卡只产出待人工确认的候选。
  // retrieved_node_ids 必须来自上一轮 kb_search / kb_ask 返回的真实 id，
  // 不是模型生成的，所以候选关系的第一重证据始终是「这次确实调取过」。
  const retrieved = [...new Set(
    (Array.isArray(args.retrieved_node_ids) ? args.retrieved_node_ids : [])
      .map((x) => String(x || '')).filter(Boolean)
  )].filter((id) => !cited.includes(id) && !!store.getNode(id));
  const semantic = {
    active: false, reason: '', indexed: false, modelId: null,
    reflowRanked: [], suggestions: [], method: null,
  };
  let srcSem = null, dstSem = null, cardVec = null;
  if (args.semantic === false) {
    semantic.reason = '调用方显式关闭语义链路';
  } else {
    dstSem = resolveSemantic(ctx, wStore);
    srcSem = crossVault ? resolveSemantic(ctx, store) : dstSem;
    if (!dstSem.active || !srcSem.active) {
      semantic.reason = !dstSem.active ? dstSem.reason : srcSem.reason;
    } else {
      const meta = dstSem.index.upsertNode(cardNode);  // 真实模型向量，非缓存假值
      cardVec = meta ? dstSem.index.vectorOf(cardNode.id) : null;
      if (cardVec) {
        dstSem.index.save();
        semantic.indexed = true;
        semantic.active = true;
        semantic.modelId = dstSem.index.modelId;
        semantic.method = 'neolm.vector(沉淀卡) × neolm.vector(引用/调取卡) 真实 cosine';
        wStore.journal('semantic.index', rel, null,
          { actor: ctx.caller || 'ui', modelId: semantic.modelId }, ctx.caller || 'ui');
      } else {
        semantic.reason = '新沉淀卡向量计算失败（文本无法映射到词表）';
      }
    }
  }

  /** 真实语义打分：返回 null 表示不可用，绝不填占位数字 */
  const semanticScore = (id) => {
    if (!semantic.active || !cardVec || !srcSem?.active) return null;
    const n = store.getNode(id);
    const v = srcSem.index.vectorOf(id);
    if (!n || !v) return null;
    const sim = cosine(cardVec, v);
    if (sim === null || !Number.isFinite(sim)) return null;
    return {
      id, title: n.title || id, path: n.path || null,
      sim: Number(sim.toFixed(5)),
      sharedTerms: sharedTerms(cardText(cardNode), cardText(n)),
      textHash: srcSem.index.hashes.get(id) || null,
      modelId: semantic.modelId,
    };
  };

  // v6.29.0 功能①：知识回流时，与「本次被调用/引用的内容」建立真实、可核查的关联。
  // 纪律：同库建真实图边；跨库绝不建悬空图边，改为在目标沉淀库登记真实跨库关联记录
  // （crossLinks 覆盖层）+ qaPairs.reflow_links 结构化账本。两者都只增关系、不动任何正文。
  const sourceVaultId = ctx.vaultId || (ctx.sourceVaultId || '');
  const sourceVaultName = ctx.sourceVaultName || sourceVaultId || '源知识库';
  const reflow = [];
  let built = 0;
  let crossLinked = 0;
  for (const cid of cited) {
    const srcNode = store.getNode(cid); // 源库里的真实被引卡（题名/path 均真实，不编造）
    // v6.32.0：模型给这条「真实引用」附一个可复核的语义分数，只写进边与账本，
    // 不改变边的类型与权重 —— 建边依据仍是「本轮确实引用过」这个事实。
    const sc = semanticScore(cid);
    const semTag = sc
      ? `；NeoLM 真实 cosine ${sc.sim}${sc.sharedTerms.length ? `（共享术语：${sc.sharedTerms.join('、')}）` : '（仅模型语义信号，无字面证据）'}`
      : '';
    if (sc) semantic.reflowRanked.push(sc);
    if (!crossVault) {
      // 同库：新沉淀卡 → 被引卡，建真实 question_answer 边并强化（沿用 v1.1.0 精确强化）
      if (!srcNode) continue;
      const ne = store.addEdge(cardNode.id, cid, 'question_answer',
        { base_weight: 0.85, origin: 'model', confirmed: 0, reason: `知识回流·本次问答引用「${srcNode.title || cid}」${semTag}` });
      if (ne) {
        reinforce(ne); built++;
        if (sc) {
          ne.semantic_sim = sc.sim;
          ne.semantic_model = semantic.modelId;
          ne.semantic_evidence = sc.sharedTerms;
        }
      }
      reflow.push({ src: cardNode.id, dst: cid, type: 'question_answer', title: srcNode.title || cid, built: !!ne,
        semanticSim: sc?.sim ?? null, semanticTerms: sc?.sharedTerms || [] });
    } else {
      // 跨库：不建悬空边；在沉淀库登记一条指向源库真实卡片的跨库关联（有 id/path/题名）。
      // 源卡可能已被删：拿不到就只记账本、不伪造 crossLink。
      if (srcNode) {
        const cl = wStore.addCrossLink({
          localId: cardNode.id,
          vaultId: sourceVaultId || 'unknown-source',
          vaultName: sourceVaultName,
          path: srcNode.path,
          title: srcNode.title || srcNode.path,
          reason: `知识回流·沉淀卡引用了源库卡片「${srcNode.title || cid}」${semTag}`,
          origin: 'model',
          weight: 0.85,
        });
        if (cl) crossLinked++;
        if (cl && sc) { cl.semantic_sim = sc.sim; cl.semantic_model = semantic.modelId; cl.semantic_evidence = sc.sharedTerms; }
        reflow.push({ src: cardNode.id, dst: cid, type: 'cross_vault_reflow', title: cl?.title || srcNode.title,
          source_vault_id: sourceVaultId, source_path: srcNode.path, built: !!cl,
          semanticSim: sc?.sim ?? null, semanticTerms: sc?.sharedTerms || [] });
      } else {
        // 源卡已不存在：如实标记为悬空引用，不伪造任何关联对象
        reflow.push({ src: cardNode.id, dst: cid, type: 'cross_vault_reflow', title: null, built: false, dangling: true });
      }
    }
  }
  // ---- v6.32.0：沉淀 ↔ 调取 的关联候选 ----
  // 这些 id 是本轮真实调取到、却没有被引用（因而没有自动建边）的卡。
  // 模型给出真实 cosine 与共享术语证据，产出候选；绝不自动调用 addEdge，
  // 由用户在界面确认后才建立 semantic_similar / 跨库关联。
  const connectedIds = new Set();
  for (const e of wStore.edges.values()) {
    if (e.src === cardNode.id) connectedIds.add(e.dst);
    if (e.dst === cardNode.id) connectedIds.add(e.src);
  }
  for (const rid of retrieved) {
    const sc = semanticScore(rid);
    if (!sc || sc.sim < 0.4 || connectedIds.has(rid)) continue;
    semantic.suggestions.push({
      src: cardNode.id, dst: rid, dstTitle: sc.title, dstPath: sc.path,
      sim: sc.sim, sharedTerms: sc.sharedTerms,
      evidenceKind: sc.sharedTerms.length ? 'shared_terms' : 'semantic_only',
      type: crossVault ? 'cross_vault_reflow' : 'semantic_similar',
      mode: crossVault ? 'cross_vault' : 'same_vault',
      sourceVaultId: crossVault ? (sourceVaultId || null) : null,
      modelId: semantic.modelId,
      reason: `本轮调取到但未引用的「${sc.title}」：NeoLM 真实 cosine ${sc.sim}`
        + (sc.sharedTerms.length ? `，共享术语 ${sc.sharedTerms.join('、')}` : '，仅模型语义信号（无字面证据）'),
      requiresHumanConfirm: true, built: false,
    });
  }
  semantic.suggestions.sort((a, b) => b.sim - a.sim || a.dst.localeCompare(b.dst));
  semantic.reflowRanked.sort((a, b) => b.sim - a.sim || a.id.localeCompare(b.id));
  if (crossLinked) {
    wStore.journal('reflow.crosslink', `${cardNode.id} <- ${sourceVaultName}/${cited.length} 张被引卡`,
      null, { actor: ctx.caller || 'ui', count: crossLinked }, ctx.caller || 'ui');
  }
  const origin = (ctx.caller && ctx.caller !== 'ui') ? 'agent' : 'user';
  wStore.qaPairs.push({
    id, ts, created_at: ts, createdAt: ts,
    question: args.question, answer: args.answer,
    cited_nodes: cited, cited_node_ids: cited,
    caller: ctx.caller, origin,
    accepted: 1, score: args.confidence ?? null, confidence: args.confidence ?? null,
    tags: args.tags || [],
    // v6.29.0：回流关联账本——每张被引卡与新沉淀卡的真实关系，可核查、可回溯。
    reflow_links: reflow,
    reflow_count: reflow.length,
    reflow_mode: crossVault ? 'cross_vault' : 'same_vault',
    // v6.32.0：语义回流账本（含待人工确认的「沉淀 ↔ 调取」候选）
    semantic: {
      active: semantic.active, reason: semantic.reason || null,
      modelId: semantic.modelId, indexed: semantic.indexed,
      method: semantic.method, reflowRanked: semantic.reflowRanked,
      suggestions: semantic.suggestions,
    },
    ...(crossVault ? { source_vault_id: ctx.vaultId || null, sediment_vault_id: ctx.sedimentVaultId || null } : {}),
  });
  // 跨库新增了 crossLinks，必须落盘；同库这里也统一 save（原本循环外已有 wStore.save()）
  if (crossVault && crossLinked) wStore.save();
  // 记录 hit_log：caller 引用
  wStore.hitLog.push({ ts, query_hash: hashStr(args.question).toString(16), node_id: cardNode.id, edge_path: cited, caller: ctx.caller, outcome: 'cited' });
  wStore.save();
  return { node_id: cardNode.id, path: rel, qa_id: id, built_edges: built, journal: 'recorded',
    // v6.29.0：回流关联真实统计（同库建边 / 跨库跨库关联记录）
    reflow: { mode: crossVault ? 'cross_vault' : 'same_vault', total: reflow.length,
      edges_built: built, cross_links_built: crossLinked },
    semantic: {
      active: semantic.active, reason: semantic.reason || null,
      indexed: semantic.indexed, modelId: semantic.modelId,
      method: semantic.method,
      reflowRanked: semantic.reflowRanked,
      suggestions: semantic.suggestions,
      candidates: semantic.suggestions.length,
      retrieved: retrieved.length,
      policy: '模型只给分数与证据；回流边依据真实引用，其余候选需人工确认才会建边',
    },
    ...(crossVault ? { sediment_vault: true, sediment_vault_id: ctx.sedimentVaultId || null,
      source_vault_id: ctx.vaultId || null } : {}) };
}

// -------- kb_add_node：新增知识 --------
function kb_add_node(store, ctx, args) {
  // v6.18.0 安全修复：旧实现允许任意 path 且用 writeFileSync 直接覆盖，
  // 一次误传（或与 agent 的幻觉叠加）就能把用户已写好的正文整篇抹掉。
  // 现在：路径必须落在库内、外部 Agent 只能写 _memory/、已存在文件一律拒绝。
  const ts = new Date().toISOString();
  const id = 'n_' + Math.abs(hashStr(args.title + ts)).toString(16);
  const rel = args.path || `_memory/semantic/${id}.md`;
  const target = assertWritableTarget(store, ctx, rel);
  if (target.error) return { error: target.error, message: target.message, path: rel };
  const abs = target.abs;
  const cleanRel = target.rel;
  const block = [
    `---`, `neokb_id: ${id}`, `kind: ${args.kind || 'card'}`, `memory_layer: semantic`, `domain: ${args.domain || '未分类'}`, `created: ${ts}`, `---`,
    `# ${args.title}`, ``, args.content || '', ``,
  ].join('\n');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, block, 'utf8');
  store.journal('add_node', cleanRel, 'new-file', null, ctx.caller);
  const node = store.upsertNodeFromFile(abs, cleanRel);
  // 自动建语义相似 / 共现边（基于已有节点标题共现）
  for (const n of store.allNodes()) {
    if (n.id === node.id) continue;
    if ((n.title || '').includes(args.title) || (args.title || '').includes(n.title)) {
      store.addEdge(node.id, n.id, 'semantic_similar', { base_weight: 0.4, origin: 'model' });
    }
  }
  store.save();
  return { node_id: node.id, path: cleanRel, auto_edges: [...store.edges.values()].filter((e) => e.src === node.id).length };
}

// -------- kb_link：建关系 --------
function kb_link(store, ctx, args) {
  if (!args.src || !args.dst || !args.type) return { error: 'invalid_args', message: 'src / dst / type 均为必填' };
  const confirmed = args.type === 'explicit_link';
  const e = store.addEdge(args.src, args.dst, args.type, {
    reason: args.reason || null, origin: confirmed ? 'human' : 'model', confirmed,
  });
  // v6.18.0：addEdge 在节点不存在 / 边重复时可能返回空，旧代码直接 reinforce(null) 抛错
  if (!e) return { error: 'edge_not_created', message: '节点不存在或该关系边已存在，未新建边' };
  if (confirmed) reinforce(e);
  store.journal('link', `${args.src}->${args.dst}:${args.type}`, null, null, ctx.caller);
  store.save();
  return { edge_id: e.id, type: e.type, confirmed: e.confirmed };
}

// -------- kb_link_recommend：辅助建立知识关联（v6.29.0 功能②）--------
// 当用户没建 / 没建全关联时，基于自己库里的真实信号主动推荐候选，
// 每条带可核查证据；本工具只读、只建议，绝不擅自建边（建边权在人手里）。
function kb_link_recommend(store, ctx, args) {
  const targetId = args.node_id || args.target_id || args.src;
  if (!targetId) return { error: 'invalid_args', message: 'node_id 必填' };
  return { ok: true, ...recommendLinks(store, targetId, {
    topK: args.top_k || 8,
    minSharedTerms: args.min_shared_terms || 3,
    maxCandidates: args.max_candidates || 200,
    // v6.31.0：注入真实训练的语言模型实例（缺失时为 undefined，推荐器如实降级）
    neolm: ctx.neolm || null,
  }), caller: ctx.caller || 'ui' };
}

// -------- kb_link_audit：全库关联体检（孤立卡片统计，只读真实计数）--------
function kb_link_audit(store, ctx) {
  return { ok: true, ...orphanStats(store), caller: ctx.caller || 'ui' };
}

// -------- kb_find_concept：实体消歧 --------
function kb_find_concept(store, ctx, args) {
  const name = (args.name || '').toLowerCase();
  const matches = store.allNodes().filter((n) => (n.title || '').toLowerCase().includes(name));
  return {
    query: args.name,
    canonical: matches[0]?.title || args.name,
    aliases: matches.map((m) => m.title),
    node_ids: matches.map((m) => m.id),
  };
}

// -------- kb_graph_stats：网络体检 --------
function kb_graph_stats(store, ctx) {
  const sched = new ConsolidationScheduler(store);
  return sched.healthReport();
}

// -------- kb_review_queue：待整理清单 --------
function kb_review_queue(store, ctx, args) {
  const sched = new ConsolidationScheduler(store);
  const { produced } = sched.run();
  let items = produced;
  if (args.kind) items = items.filter((i) => i.kind === args.kind);
  items = items.slice(0, args.limit || 20);
  return { items: items.map((i, idx) => ({ item_id: `r${idx}`, ...i })) };
}

// -------- kb_apply_review：执行整理建议（仅机器可执行的，绝不改人写正文） --------
// v1.1.0：支持按待整理项 id 分派（UI 传 { id }），返回真实执行结果。
function kb_apply_review(store, ctx, args) {
  const id = args.item_id || args.id;
  const item = id ? store.reviewItems.find((r) => r.id === id || r.item_id === id) : null;

  if (!item) {
    // 兼容旧调用：显式 merge 参数
    if (args.action === 'merge' && args.params?.ids) {
      const ids = args.params.ids;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          store.addEdge(ids[i], ids[j], 'semantic_similar', { base_weight: 0.6, origin: 'model' });
      store.save();
      return { applied: true, action: 'merge', note: '已建立关联边（未改动用户正文）' };
    }
    return { applied: false, note: '未找到对应的待整理项' };
  }

  const p = item.payload || {};
  if (item.kind === 'merge') {
    const ids = p.ids || (p.a && p.b ? [p.a, p.b] : []);
    let built = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!store.getNode(ids[i]) || !store.getNode(ids[j])) continue;
        store.addEdge(ids[i], ids[j], 'semantic_similar', { base_weight: 0.6, origin: 'model', reason: '合并建议（人工确认）' });
        built++;
      }
    }
    item.status = 'applied';
    store.save();
    return { applied: true, note: built ? `已建立 ${built} 条关联边（未改动正文）` : '节点已不存在，无需处理' };
  }
  if (item.kind === 'link' && p.src && p.dst) {
    store.addEdge(p.src, p.dst, p.type || 'semantic_similar', { base_weight: p.weight || 0.5, origin: 'model', reason: '补边建议（人工确认）' });
    item.status = 'applied';
    store.save();
    return { applied: true, note: '已补边' };
  }
  if (item.kind === 'decay') {
    item.status = 'applied';
    store.save();
    return { applied: true, note: '权重衰减已落库' };
  }
  if (item.kind === 'orphan') {
    return { applied: false, note: '孤立卡片需要人工补链或归档，未自动执行' };
  }
  if (item.kind === 'conflict' || item.kind === 'contradiction') {
    return { applied: false, note: '矛盾条目需要人工复核，未自动执行' };
  }
  return { applied: false, note: '该建议需人工确认，未自动执行（对应需求：只建议不自动合并）' };
}

// -------- kb_history：溯源 --------
function kb_history(store, ctx, args) {
  return {
    node_id: args.node_id,
    references: store.hitLog.filter((h) => h.node_id === args.node_id)
      .map((h) => ({ ts: h.ts, caller: h.caller, outcome: h.outcome })),
  };
}

// -------- kb_legal_mind：类脑法律思维问答（v6.3.0 深加工） --------
// 与 kb_ask 的区别：kb_ask 只把命中片段拼接；这里按 本项目自研认知规格 的
// 八阶段认知工作流逐站**真实计算**（争点/举证/双轨/对抗/假设/议会/校准/沉淀），
// 每站耗时是真实计算耗时，输出附推理链、脑区激活轨迹与引用溯源深链。
// 红线：不预置法条库或案例库，所有实体内容来自用户知识库召回；无材料时明说不知道。
function kb_legal_mind(store, ctx, args = {}) {
  const question = String(args.question || '').trim();
  if (!question) return { error: 'empty_question' };
  const topK = Math.max(1, Math.min(12, Number(args.top_k) || 6));
  const vaultId = ctx.vaultId || '';
  const org = ctx.organism || null;
  const R = {};   // 八阶段各站的真实产物

  // 八阶段：每站执行真实计算，runWorkflowSync 记录该站真实毫秒耗时
  const handlers = {
    recall: () => {
      // 反馈先学（recall 的交付物本就是「加载记忆上下文与未消化纠正」）
      R.learning = (args.feedback && org)
        ? org.learn(String(args.feedback.grade || 'C').toUpperCase(), !!args.feedback.good)
        : null;
      R.gradeTable = org ? org.status().gradeTable : { ...GRADE_WEIGHT_DEFAULT };
      R.hits = retrieveForAsk(store, question, { topK });
      const t = R.gradeTable;
      return {
        text: `加载记忆上下文：召回 ${R.hits.length} 张卡片；来源等级权重 A ${t.A} / B ${t.B} / C ${t.C} / D ${t.D}${R.learning ? `；已按本次反馈调整 ${R.learning.grade} 级权重（${R.learning.before} → ${R.learning.after}）` : ''}`,
        nodes: R.hits.slice(0, 3).map((h) => h.id),
        data: { hitCount: R.hits.length, gradeTable: t, learning: R.learning },
      };
    },
    triage: () => {
      R.grades = R.hits.map((h) => gradeOfHit(h).grade);
      R.feat = featuresFromEvidence({ hits: R.hits, question, grades: R.grades });
      R.council = deliberate(R.feat.feat);
      return {
        text: `分诊：问题 ${question.length} 字，风险信号 ${R.feat.evidence.riskWords.length} 项、利害信号 ${R.feat.evidence.stakeWords.length} 项、冲突对 ${R.feat.evidence.conflictPairs.length} 组；七维特征已由真实召回计算`,
        nodes: [], data: { feat: R.feat.feat, evidence: R.feat.evidence, council: R.council },
      };
    },
    research: () => {
      R.cites = R.hits.map((h) => {
        const g = gradeOfHit(h);
        const snippet = extractSnippet(h.node, question);
        return {
          id: h.id, title: h.node?.title, path: h.node?.path,
          confidence: h.confidence, activation: h.activation,
          activation_path: h.activation_path, path_explained: h.path_explained,
          grade: g.grade, gradeReason: g.reason,
          gradeWeight: R.gradeTable[g.grade] ?? g.weight,
          snippet, anchor: hashStr(snippet).toString(16),
          verify: `neolink://verify/${vaultId}/${h.id}?s=${encodeURIComponent(snippet)}`,
        };
      });
      const dist = R.grades.reduce((o, g) => { o[g] = (o[g] || 0) + 1; return o; }, {});
      return {
        text: `研究：完成 ${R.cites.length} 条证据分级（${JSON.stringify(dist)}），平均激活路径 ${R.feat.evidence.avgActivationPath} 跳，每条引用均生成 neolink:// 溯源深链`,
        nodes: R.cites.map((c) => c.id), data: { cites: R.cites, gradeDistribution: dist },
      };
    },
    reason: () => {
      R.issues = frameIssues(question, R.hits);
      R.burdens = R.issues.map((iss, i) => assignBurden(iss, { isDefense: i % 3 === 2 }));
      R.onus = R.issues.map((iss, i) => assessOnus(iss, R.burdens[i], R.grades, R.cites));
      R.tracks = splitTracks(R.hits);
      const weak = R.onus.filter((o) => !o.sufficient).length;
      return {
        text: `推理：归纳 ${R.issues.length} 项争点；规范轨 ${R.tracks.norm.length} 条 / 实务轨 ${R.tracks.practice.length} 条 / 冲突 ${R.tracks.conflicts.length} 处；举证未到位 ${weak} 项已明示不利后果归属`,
        nodes: R.issues.flatMap((i) => i.basis).slice(0, 6),
        data: { issues: R.issues, burdens: R.burdens, onus: R.onus, tracks: R.tracks },
      };
    },
    adversarial: () => {
      R.debate = buildDebate({
        issues: R.issues, onus: R.onus, tracks: R.tracks,
        grades: R.grades, hits: R.hits,
      });
      return {
        text: `对抗：反方最强论证与我方反驳已构造，残余风险强制披露（辩论质量分 ${R.debate.score}）`,
        nodes: [], data: { debate: R.debate },
      };
    },
    hypothesis: () => {
      R.hypotheses = buildHypotheses(R.issues, R.hits);
      R.discretion = discretionFor([question, ...R.hits.map((h) => h.node?.title || '')].join(' '));
      return {
        text: `假设：登记 ${R.hypotheses.length} 条可证伪假设（每条附依据卡片与验证路径）；命中内置裁量规则 ${R.discretion.length} 类`,
        nodes: R.hypotheses.flatMap((h) => h.basis).slice(0, 6),
        data: { hypotheses: R.hypotheses, discretion: R.discretion },
      };
    },
    synthesize: () => {
      const answers = metacogAnswers({
        question, hits: R.hits, debate: R.debate, hypotheses: R.hypotheses,
        cites: R.cites, boundaryDeclared: true,
      });
      R.metacog = metacogReport(answers);
      const base = R.cites.length
        ? R.cites.reduce((a, c) => a + calibratedConfidence(c.grade, '中', R.gradeTable), 0) / R.cites.length
        : 0;
      const value = Math.round(base * (0.5 + 0.5 * R.council.verdict) * 1e4) / 1e4;
      R.confidence = {
        value, band: confidenceBand(value),
        factors: {
          avgGradeWeight: R.cites.length
            ? Math.round((R.cites.reduce((a, c) => a + c.gradeWeight, 0) / R.cites.length) * 1e4) / 1e4 : 0,
          councilVerdict: R.council.verdict, citedCards: R.cites.length,
        },
      };
      R.answer = composeAnswer({
        question, issues: R.issues, burdens: R.burdens, onus: R.onus,
        tracks: R.tracks, debate: R.debate, hypotheses: R.hypotheses,
        council: R.council, confidence: R.confidence, metacog: R.metacog,
        cites: R.cites, discretion: R.discretion,
      });
      return {
        text: `综合：五脑议会裁决 ${R.council.verdict}、共识 ${R.council.consensus}、建议行动【${R.council.action.name}】；置信度 ${value}（${R.confidence.band.label}）；元认知 ${R.metacog.passed}/${R.metacog.total} 项通过`,
        nodes: [], data: { confidence: R.confidence, metacog: R.metacog },
      };
    },
    precipitate: () => {
      R.experience = org ? org.sediment({
        question, answer: R.answer, cited: R.cites,
        confidence: R.confidence.value, action: R.council.action.id,
      }) : null;
      // 显式开启才写回知识库；追加式沉淀卡，绝不覆盖用户正文
      R.sediment = null;
      if (args.sediment === true && R.cites.length) {
        try {
          R.sediment = kb_write_back(store, { ...ctx, caller: ctx.caller || 'legal_mind' }, {
            question, answer: R.answer,
            cited_node_ids: R.cites.map((c) => c.id),
            confidence: R.confidence.value,
            tags: ['legal-mind', '思维链'],
          });
        } catch (e) { R.sediment = { error: String(e?.message || e) }; }
      }
      return {
        text: org
          ? `沉淀：经验卡已追加（累计 ${org.status().experienceCount} 条）${R.sediment ? `，知识库沉淀卡 ${R.sediment.path} 已建立 ${R.sediment.built_edges} 条回连边` : '；知识库正文未被改写'}`
          : '沉淀：本次无 organism 上下文，未写经验卡（不影响作答）',
        nodes: R.sediment ? [R.sediment.node_id] : [],
        data: { experience: R.experience, sediment: R.sediment },
      };
    },
  };

  const flow = runWorkflowSync(handlers, { seed: { question } });

  // 脑区激活轨迹 + 沿真实轴突（含 latency_ms / myelin）的脉冲序列，供 3D 智脑播放
  const levels = stageActivation(flow.brainActivation);
  const spread = spreadActivation(levels, { steps: 2 });
  const cached = store.qaPairs.find((q) => q.question === question);

  return {
    question, answer: R.answer || '',
    cited_nodes: R.cites || [],
    hit_existing_sediment: cached ? cached.id : null,
    engine: 'legal-mind', engineVersion: productVersion(),
    trace: flow.trace, stages: flow.stages, brainActivation: flow.brainActivation,
    brainLevels: spread.levels, pulses: spread.pulses,
    council: R.council || null, councilEvidence: R.feat?.evidence || null,
    issues: R.issues || [], burdens: R.burdens || [], onus: R.onus || [],
    tracks: R.tracks || null, debate: R.debate || null,
    hypotheses: R.hypotheses || [], discretion: R.discretion || [],
    confidence: R.confidence || null, metacog: R.metacog || null,
    boundary: BOUNDARY_TEXT,
    organism: org ? org.status() : null,
    learning: R.learning || null, experience: R.experience || null,
    sediment: R.sediment || null,
    source: { root: SOURCE.root, generatedAt: SOURCE.generatedAt, stats: SOURCE.stats },
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

// -------- kb_server_status：本进程的真实遥测（v6.18.0） --------
// 桌面端经 tool:invoke 进程内直调时没有 stdio 会话，此时如实标注 telemetry 不可用，
// 而不是编造一组计数器。
function kb_server_status(store, ctx) {
  const t = ctx.telemetry;
  return {
    // 正式产品名（对外唯一口径）；server 键保留 'neokb' 仅作协议兼容标识，非产品旧称。
    product: 'NeoCosmos',
    vendor: '宋锦涛',
    serverKey: 'neokb',
    server: 'neokb',
    version: ctx.version || productVersion(),
    transport: 'stdio',
    caller: ctx.caller || 'unknown',
    protocol: t?.state?.negotiatedProtocol || null,
    vault: {
      root: store?.root || ctx.vaultPath || '',
      // v6.40.1：库来源——neocosmos-active 表示正跟随界面当前打开的库；
      // cli 表示固化的 --vault。让用户可核对 Agent 到底读了哪个库。
      source: ctx.vaultSource || 'cli',
      nodes: store?.nodes?.size ?? null,
      edges: store?.edges?.size ?? null,
      qa_pairs: store?.qaPairs?.length ?? null,
    },
    tools: listTools().length,
    // v6.31.0：本地语言模型的真实状态（不可用则如实标注，不虚构读数）
    neolm: ctx.neolm?.active
      ? { active: true, vocab: ctx.neolm.vocabSize, dim: ctx.neolm.dim,
          weightGiB: ctx.neolm.status().weightGiB, auc: ctx.neolm.status().evaluation?.aucModel }
      : { active: false, reason: '本进程未加载模型或加载校验未通过' },
    // v6.32.0：语义索引真实状态（模型缺失 / 索引损坏一律如实标注）
    semantic: (() => {
      try {
        const r = resolveSemantic(ctx, store);
        if (!r.active) return { active: false, reason: r.reason };
        const s = r.index.status();
        return { active: true, modelId: s.modelId, indexedCards: s.count, dim: s.dim,
          file: s.file, cacheValid: s.cacheValid, truncated: s.truncated, method: s.method };
      } catch (e) { return { active: false, reason: `语义索引状态读取失败：${e?.message || e}` }; }
    })(),
    hosts: HOST_IDS,
    canWriteBody: ctx.canWriteBody === true,
    // v10.18.7：外部检索作用域口径 —— Agent 与用户都能核对"当前受启用库约束吗"。
    access: ctx.externalScopeGuard ? {
      ...ctx.externalScopeGuard(),
      enforcedFor: ctx.caller === 'ui' ? 'none（桌面端本地检索不受白名单约束）' : 'external-agents',
    } : { enabled: true, scopeSource: 'not-applicable', enabledCount: null },
    telemetry: t ? t.snapshot() : { available: false, reason: '进程内直调，无 stdio 会话计数器' },
  };
}

// -------- kb_host_config：宿主接入配置（v6.18.0；v6.35.0 加入产品自有形态别名） --------
// 由 hosts.js 单一真源生成，路径来自模块自身的真实位置，不含占位符。
// v6.35.0：产品界面用"接入形态"命名，内核把形态映射到真实协议键；
// 这一层放在内核（协议实现处），UI 只传中性形态名，界面零第三方品牌字样。
const FORM_ALIASES = Object.freeze({
  'form-servers': 'openclaw',
  'form-generic': 'workbuddy',
  'form-desktop': 'claude-desktop',
  'form-plain': 'generic',
});
// 对外暴露的 host 取值 = 真实协议键 + 产品自有形态别名（二者内核都接受）
const HOST_INPUTS = Object.freeze([...HOST_IDS, ...Object.keys(FORM_ALIASES)]);
function kb_host_config(store, ctx, args = {}) {
  const requested = String(args.host || 'openclaw');
  const host = FORM_ALIASES[requested] || requested;
  if (!HOST_IDS.includes(host)) return { error: 'unknown_host', supported: HOST_IDS };
  return buildHostConfig(host, {
    vault: args.vault || store?.root || ctx.vaultPath || undefined,
    // v6.23.0：显式传入「专用沉淀回写仓库」时，配置里加 --sediment-vault；
    // 不传时完全沿用 6.22.0 的单一 --vault 形态。
    sedimentVault: args.sediment_vault || ctx.sedimentVaultPath || undefined,
    caller: args.caller,
    node: args.node,
    serverPath: args.server_path,
    cwd: args.cwd,
    name: args.name,
  });
}

// -------- kb_access_policy：外部 Agent 自查访问范围与权限边界（v10.18.7） --------
// 让 AI 在被用户问到"你能读哪些库 / 为什么这个库读不到"时，有真实、可核查的答案，
// 而不是凭空猜测或报出旧产品名。全部来自 ctx 真实状态与白名单文件，不造数。
function kb_access_policy(store, ctx) {
  const guard = ctx.externalScopeGuard ? ctx.externalScopeGuard() : null;
  const isUi = ctx.caller === 'ui';
  return {
    product: 'NeoCosmos',
    vendor: '宋锦涛',
    currentVault: {
      root: store?.root || ctx.vaultPath || '',
      source: ctx.vaultSource || 'cli',
      externallyEnabled: guard ? guard.enabled : true,
    },
    scope: guard ? {
      enforced: !isUi,
      source: guard.scopeSource,                 // enforced | legacy-unrestricted
      enabledVaultCount: guard.enabledCount,
      rule: isUi
        ? '桌面端本地检索：全部库可用'
        : '外部 Agent：仅能检索用户在 NeoCosmos 客户端启用的库；停用的库被真实拒绝',
    } : { enforced: false, source: 'not-applicable', rule: '本进程未提供白名单守卫' },
    permissions: {
      canReadContent: true,
      canWriteBody: ctx.canWriteBody === true,
      canAppendSediment: true,
      note: '外部 Agent 只读 + 在 _memory/ 沉淀区追加；不能改写或删除用户正文',
    },
    hint: guard && !guard.enabled
      ? '当前库已被用户停用。请提示用户在 NeoCosmos 客户端启用该库后再检索。'
      : '可用 kb_search / kb_read / kb_ask；被拒时按错误信息提示用户，不要重试相同调用。',
  };
}

const TOOLS = {
  kb_search, kb_read, kb_expand, kb_ask, kb_legal_mind,
  kb_write_back, kb_add_node, kb_link,
  kb_link_recommend, kb_link_audit,
  kb_find_concept, kb_graph_stats, kb_review_queue, kb_apply_review, kb_history,
  kb_server_status, kb_host_config, kb_access_policy,
};

// v6.18.0：补齐 required 契约（OpenClaw 按 draft-07 校验入参），
// 并新增两个真实工具：进程遥测与宿主接入配置。
export function listTools() {
  return [
    { name: 'kb_search', description: '在记忆网络中找知识。BM25 字面召回 + 激活扩散给出联想路径；模型可用时另加 NeoLM 真实向量语义种子（分数单列、如实标注）。', inputSchema: { type: 'object', properties: { query: { type: 'string' }, top_k: { type: 'number' }, hops: { type: 'number' }, filters: { type: 'object' }, semantic: { type: 'boolean' } }, required: ['query'] } },
    { name: 'kb_read', description: '读取某个节点的完整正文与相邻关系。node_id 或 path 二选一；max_chars 可截断长文。', inputSchema: { type: 'object', properties: { node_id: { type: 'string' }, path: { type: 'string' }, max_chars: { type: 'number' } } } },
    { name: 'kb_expand', description: '从某节点向外联想展开子图（双向关联、节点+边+权重），用于图谱下钻。', inputSchema: { type: 'object', properties: { node_id: { type: 'string' }, hops: { type: 'number' }, edge_types: { type: 'array', items: { type: 'string' } } }, required: ['node_id'] } },
    { name: 'kb_ask', description: '端到端问答：命中已有沉淀直接复用答案，否则基于真实召回片段生成并附引用溯源深链。返回 retrieved_node_ids 供下一步回写建立「沉淀 ↔ 调取」关联。', inputSchema: { type: 'object', properties: { question: { type: 'string' }, mode: { type: 'string', enum: ['retrieve_only', 'generate'] }, semantic: { type: 'boolean' } }, required: ['question'] } },
    { name: 'kb_legal_mind', description: '类脑法律思维问答：按八阶段认知工作流（回忆/分诊/研究/推理/对抗/假设/综合/沉淀）真实计算，输出争点与举证责任、双轨分析、对抗辩论与残余风险、可证伪假设、五脑议会裁决、置信校准与元认知自检，并附推理链、脑区激活轨迹和每张引用卡片的溯源深链。无模型无网络，不预置法条库。', inputSchema: { type: 'object', properties: { question: { type: 'string' }, top_k: { type: 'number' }, sediment: { type: 'boolean' }, feedback: { type: 'object' } }, required: ['question'] } },
    { name: 'kb_write_back', description: '把一次问答的结论回写沉淀进网络（追加式新文件，绝不覆盖用户正文）。每次问答后务必调用，形成闭环。传入上一轮 kb_ask 返回的 retrieved_node_ids，可用 NeoLM 真实向量给「本轮调取到却未引用」的卡生成待人工确认的关联候选（绝不自动建边）。', inputSchema: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' }, cited_node_ids: { type: 'array', items: { type: 'string' } }, retrieved_node_ids: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } }, semantic: { type: 'boolean' } }, required: ['question', 'answer'] } },
    { name: 'kb_add_node', description: '新增一条知识卡片（默认 _memory/semantic/，自动建语义边）。外部 Agent 只能写 _memory/ 下的新文件，已存在文件一律拒绝覆盖。', inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, domain: { type: 'string' }, path: { type: 'string' } }, required: ['title'] } },
    { name: 'kb_link', description: '在两条知识间建立关系边（explicit_link 视为人工确认，权重最高）。节点不存在或边已存在时明确返回未创建。', inputSchema: { type: 'object', properties: { src: { type: 'string' }, dst: { type: 'string' }, type: { type: 'string' }, reason: { type: 'string' } }, required: ['src', 'dst', 'type'] } },
    { name: 'kb_link_recommend', description: '辅助建立知识关联：当用户尚未建全关联时，基于本库真实信号（共享标签/正文共享术语/同轮问答共引/正文双链未连/同目录）为指定卡片推荐候选关联，每条附可核查证据与建议边类型。只读、只建议，绝不擅自建边——建边权永远在人手里。', inputSchema: { type: 'object', properties: { node_id: { type: 'string' }, top_k: { type: 'number' }, min_shared_terms: { type: 'number' }, max_candidates: { type: 'number' } }, required: ['node_id'] } },
    { name: 'kb_link_audit', description: '全库关联体检：只读统计没有任何关联的孤立卡片数与占比，用于判断是否需要辅助建关联。', inputSchema: { type: 'object', properties: {} } },
    { name: 'kb_find_concept', description: '实体消歧：给定名称，返回可能的规范概念与别名列表。', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'kb_graph_stats', description: '网络体检：规模、平均度、孤儿率、各层分布。', inputSchema: { type: 'object', properties: {} } },
    { name: 'kb_review_queue', description: '待整理清单：孤立节点/矛盾/合并建议/老化。', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, kind: { type: 'string' } } } },
    { name: 'kb_apply_review', description: '执行整理建议。注意：仅执行机器安全的操作（如建边），绝不自动改写或删除用户正文。', inputSchema: { type: 'object', properties: { item_id: { type: 'string' }, action: { type: 'string' }, params: { type: 'object' } } } },
    { name: 'kb_history', description: '溯源：某节点被哪些 caller 在何时引用/修改过。', inputSchema: { type: 'object', properties: { node_id: { type: 'string' } }, required: ['node_id'] } },
    { name: 'kb_server_status', description: '返回本 MCP 进程的真实状态：版本、协商协议版本、知识库规模、工具数、支持宿主、逐方法请求数与耗时、错误计数。用于连通性诊断与可观测性。', inputSchema: { type: 'object', properties: {} } },
    { name: 'kb_host_config', description: '生成标准接口接入配置。host 支持产品形态别名 form-servers / form-generic / form-desktop / form-plain，也兼容底层协议键。按形态返回真实配置、兼容形态与自检命令。路径由模块真实位置推导。可选 sediment_vault 指定专用沉淀回写仓库。', inputSchema: { type: 'object', properties: { host: { type: 'string', enum: HOST_INPUTS }, vault: { type: 'string' }, sediment_vault: { type: 'string' }, caller: { type: 'string' }, name: { type: 'string' }, server_path: { type: 'string' }, cwd: { type: 'string' }, node: { type: 'string' } } } },
    { name: 'kb_access_policy', description: '自查访问范围与权限边界：当前库是否对外启用、受不受启用库白名单约束、能读能写什么。当用户问"你能访问哪些知识库 / 为什么这个库读不到 / 你的权限"时调用，返回真实状态而非猜测。产品正式名称为 NeoCosmos。', inputSchema: { type: 'object', properties: {}, required: [] } },
  ];
}

// v10.18.7：这些工具会真实读取知识库内容。外部 Agent 调用时受「启用库白名单」约束，
// 当前库被用户停用即拒绝——让"启用/停用"对 WorkBuddy / AutoClaw 真正生效，
// 而不是只把界面按钮变灰。桌面端（caller='ui'）本地检索不受此约束。
const CONTENT_READ_TOOLS = new Set([
  'kb_search', 'kb_read', 'kb_ask', 'kb_graph_neighbors', 'kb_history',
]);

export function callTool(name, args, ctx) {
  const fn = TOOLS[name];
  if (!fn) throw new Error(`未知工具: ${name}`);
  // 运行时复查白名单（不缓存）：用户在客户端停用库后，下一次调用即时被拒。
  if (ctx.externalScopeGuard && ctx.caller !== 'ui' && CONTENT_READ_TOOLS.has(name)) {
    const g = ctx.externalScopeGuard();
    if (!g.enabled) {
      throw new Error('当前知识库已被用户在 NeoCosmos 客户端停用，检索被拒绝。请启用该库后重试。');
    }
  }
  return fn(ctx.store, ctx, args);
}

// resources/list 的真实固定资源（由 protocol.js 与节点资源一起分页返回）
export const RESOURCES = [
  { uri: 'neokb://vault/manifest', name: 'vault-manifest', mimeType: 'application/json' },
  { uri: 'neokb://graph/overview', name: 'graph-overview', mimeType: 'application/json' },
  { uri: 'neokb://server/status', name: 'server-status', mimeType: 'application/json' },
];

// resources/templates/list：只有 node/{id} 是真实可用的 URI 模板
export const RESOURCE_TEMPLATES = [
  { uriTemplate: 'neokb://node/{id}', name: 'node', description: '按节点 id 读取该卡片的真实 Markdown 正文', mimeType: 'text/markdown' },
];

export const PROMPTS = [
  {
    name: 'neokb_memory_workflow',
    description: '先查库再答、答完必回写、引用格式统一 [标题](neokb://node/{id})。',
    arguments: [{ name: 'question', description: '本轮要回答的问题', required: true }],
    template: [
      '请基于 NeoCosmos 本地知识库回答：{{question}}',
      '',
      '工作流：',
      '1. 用 kb_search 召回，检查 activation_path 与 path_explained；',
      '2. 用 kb_read 读取需要引用的节点正文；',
      '3. 作答时把引用写成 [标题](neokb://node/{id})，只引用真实召回到的卡片；',
      '4. 答完用 kb_write_back 追加沉淀卡，传入 cited_node_ids 与置信度。',
      '',
      '纪律：不编造卡片；无材料时明说不知道；不改写或删除用户正文；全部数据留在本机。',
    ].join('\n'),
  },
];
