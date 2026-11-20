// 语义回流层 · Semantic Bridge（v6.32.0）
// ---------------------------------------------------------------------------
// 解决的问题：v6.31.0 的 NeoLM 只在「关联推荐」里做了一次温和重排，
// 而三条主干链路完全没用上它 ——
//   · 调取：只有 BM25 字面匹配，字面不同但语义相近的卡召回不到；
//   · 沉淀回写：只按「本轮引用过」建边，沉淀卡与「本轮调取到却没引用」的卡
//     之间没有任何可解释关系，回流账本也没有语义排序；
//   · 库关联：只有回写时被动产生的 crossLinks，库与库之间没有整体语义视图。
//
// 本模块提供一份**共享底座**：逐卡真实向量索引 + 库质心 + 语义近邻。
// 三条链路都读它，不再各自造一套"看起来像 AI"的分数。
//
// 纪律（延续本项目「禁止虚构、虚假能力」红线）：
//   1. 每个向量都由 neolm.vector() 真实读取 1.50 GiB 训练权重计算，绝不缓存假值；
//   2. 每条记录带 textHash 与 modelId：正文变了 / 模型换了必须重算，绝不复用过期向量；
//   3. 模型分数只是「候选与排序依据」，不是事实关系。本模块从不调用 addEdge /
//      addCrossLink —— 建边权在「真实引用事实」或「用户确认」手里；
//   4. 模型不可用 / 索引损坏 / 词表不认识文本时全部如实降级，返回 active:false
//      与真实原因，下游退回原有 BM25 / 激活扩散，不假装模型在跑；
//   5. 只写应用自己的索引目录 .neokb/index/semantic.json，不碰任何用户正文。
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SEMANTIC_SCHEMA = 'neocosmos.semantic-index/1';
export const INDEX_FILE = 'semantic.json';
export const DEFAULT_DIM = 1536;
export const DEFAULT_MAX_NODES = 20000;   // 超大规模库的可控上限，如实标注截断
export const DEFAULT_TEXT_CHARS = 1200;    // 每张卡参与向量计算的真实正文长度
export const DEFAULT_MIN_SIM = 0.35;       // 库桥候选的默认最低绝对 cosine
// 语义种子不能用绝对 cosine 作门槛：实测该领域模型存在很高的共同基线
// （连完全无关的查询都能得到 0.4~0.5）。改用「均值中心化后的相对显著性」：
// lift = cosine(query, card) − 该 query 在本库所有卡上的平均 cosine。
// 这是确定性、可复核的相对量，不是模型自信度，也不是包装出来的分数。
export const DEFAULT_MIN_LIFT = 0.005;
// 把 lift 映射为扩散初值的工程尺度：只是衰减系数，不是模型置信度、不是概率。
export const LIFT_SCALE = 0.03;

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/**
 * 模型指纹：由真实 manifest 字段推导，绝不手写常量。
 * 只要权重 / 词表 / 训练输入任一变化，指纹就变化，索引必须全量重算。
 */
export function modelFingerprint(neolm) {
  if (!neolm || !neolm.active || typeof neolm.status !== 'function') return null;
  try {
    const s = neolm.status();
    return sha256(JSON.stringify({
      schema: s.schema, arch: s.arch, vocab: s.vocab, dim: s.dim,
      corpusHash: s.corpus?.hash, weightGiB: s.weightGiB,
      train: s.train, evaluation: s.evaluation,
    }));
  } catch { return null; }
}

/** 参与向量计算的真实卡文本：标题 + 标签 + 正文前 N 字（不编造摘要） */
export function cardText(node, maxChars = DEFAULT_TEXT_CHARS) {
  if (!node) return '';
  const tags = Array.isArray(node.tags) ? node.tags.join(' ') : '';
  const body = String(node.fts_text || '').slice(0, maxChars);
  return `${String(node.title || '')}\n${tags}\n${body}`.trim();
}

export function cardTextHash(node, maxChars = DEFAULT_TEXT_CHARS) {
  return sha256(cardText(node, maxChars));
}

/** 真实共享术语：用于给语义候选附一条「字面也能核查」的证据。 */
export function sharedTerms(textA, textB, limit = 6) {
  // 单个贪心切分会把「知识卡片与语义关联」切成「知识卡片 / 与语义关」，
  // 换个语序就再也找不到同一段文字。这里对 CJK 取 2/3/4-gram 全集，
  // 保证「换语序仍可核查」；返回时优先给更长的片段，证据更具体。
  const pick = (t) => {
    const out = new Set();
    const s = String(t || '').toLowerCase();
    for (const m of s.matchAll(/[a-z][a-z0-9_-]{2,}/g)) {
      out.add(m[0]);
      if (out.size >= 256) return out;
    }
    const runs = s.match(/[\u3400-\u9fff]{2,}/g) || [];
    for (const run of runs) {
      for (let n = 2; n <= 4; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          out.add(run.slice(i, i + n));
          if (out.size >= 256) return out;
        }
      }
    }
    return out;
  };
  const a = pick(textA), b = pick(textB);
  const hit = [];
  for (const x of a) if (b.has(x)) hit.push(x);
  hit.sort((x, y) => y.length - x.length || x.localeCompare(y));
  return hit.slice(0, limit);
}

function encodeVec(v) {
  const buf = Buffer.allocUnsafe(v.length * 4);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < v.length; i++) dv.setFloat32(i * 4, v[i], true);
  return buf.toString('base64');
}

function decodeVec(s) {
  const buf = Buffer.from(String(s || ''), 'base64');
  const n = Math.floor(buf.byteLength / 4);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/** 真实 cosine（向量已近似归一，但这里仍显式计算范数，不偷懒） */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    s += x * y; na += x * x; nb += y * y;
  }
  if (!(na > 0) || !(nb > 0)) return null;
  return s / Math.sqrt(na * nb);
}

function l2(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/**
 * 创建一个绑定到某个 KbStore 的语义索引。
 * @returns {{active:boolean, reason:string, modelId:string|null, file:string,
 *            vectors:Map, hashes:Map, sync:Function, save:Function,
 *            upsertNode:Function, vectorOf:Function, status:Function, profile:Function}}
 */
export function createSemanticIndex({ store, neolm, opts = {} } = {}) {
  const inactive = (reason) => ({
    active: false, reason, modelId: null, file: null, dim: DEFAULT_DIM,
    vectors: new Map(), hashes: new Map(),
    sync: () => ({ active: false, reason, added: 0, updated: 0, removed: 0, unchanged: 0 }),
    save: () => ({ ok: false, reason }),
    upsertNode: () => null,
    vectorOf: () => null,
    profile: () => ({ active: false, reason, nodeCount: 0 }),
    status: () => ({ active: false, reason, count: 0, file: null, modelId: null }),
  });
  if (!store || !store.allNodes) return inactive('未提供有效的知识库 store');
  if (!neolm || !neolm.active || typeof neolm.vector !== 'function') {
    return inactive('本地语言模型未加载或校验未通过，语义链路如实降级');
  }
  const modelId = modelFingerprint(neolm);
  if (!modelId) return inactive('无法读取模型指纹（status 不可用）');

  const dim = Number(neolm.dim) || DEFAULT_DIM;
  const maxNodes = Math.max(1, Number(opts.maxNodes) || DEFAULT_MAX_NODES);
  const textChars = Math.max(64, Number(opts.textChars) || DEFAULT_TEXT_CHARS);
  const file = path.join(store.indexDir, INDEX_FILE);
  const vectors = new Map();   // nodeId -> Float64Array
  const hashes = new Map();    // nodeId -> textHash
  let diskModelId = null;
  let truncated = false;
  let lastSync = null;

  // 只在指纹一致时复用磁盘向量；模型换了必须全量重算，绝不拿旧权重算出的向量冒充。
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && raw.schema === SEMANTIC_SCHEMA && raw.modelId === modelId && raw.dim === dim
        && Array.isArray(raw.records)) {
      diskModelId = modelId;
      for (const r of raw.records) {
        if (!r || typeof r.id !== 'string' || typeof r.textHash !== 'string') continue;
        const v = decodeVec(r.vector);
        if (v.length !== dim) continue;
        vectors.set(r.id, v);
        hashes.set(r.id, r.textHash);
      }
    }
  } catch { /* 首次运行 / 索引损坏：视为无缓存，下面真实重算 */ }

  function compute(node) {
    const v = neolm.vector(cardText(node, textChars));
    if (!v || v.length !== dim) return null;
    return Float64Array.from(v);
  }

  function upsertNode(node) {
    if (!node || !node.id) return null;
    const th = cardTextHash(node, textChars);
    const v = compute(node);
    if (!v) return null;
    vectors.set(node.id, v);
    hashes.set(node.id, th);
    return { id: node.id, textHash: th, dim };
  }

  /** 增量同步：只重算新增 / 正文变化的卡，并移除已删除卡的过期向量。 */
  function sync(o = {}) {
    const nodes = store.allNodes().filter((n) => !n.archived);
    const live = new Set();
    let added = 0, updated = 0, unchanged = 0, removed = 0, failed = 0;
    truncated = nodes.length > maxNodes;
    const force = !!o.force || diskModelId !== modelId;
    for (const n of nodes.slice(0, maxNodes)) {
      live.add(n.id);
      const th = cardTextHash(n, textChars);
      if (!force && vectors.has(n.id) && hashes.get(n.id) === th) { unchanged++; continue; }
      const v = compute(n);
      if (!v) { failed++; continue; }
      if (vectors.has(n.id)) updated++; else added++;
      vectors.set(n.id, v);
      hashes.set(n.id, th);
    }
    for (const id of [...vectors.keys()]) {
      if (!live.has(id)) { vectors.delete(id); hashes.delete(id); removed++; }
    }
    diskModelId = modelId;
    lastSync = new Date().toISOString();
    return { active: true, modelId, added, updated, unchanged, removed, failed,
      truncated, count: vectors.size, force };
  }

  function save() {
    const records = [...vectors.entries()].map(([id, v]) => ({
      id, textHash: hashes.get(id) || '', vector: encodeVec(v),
    }));
    const payload = {
      schema: SEMANTIC_SCHEMA, version: 1, modelId, dim, textChars,
      generatedAt: new Date().toISOString(),
      source: 'NeoLM 真实训练权重逐卡计算（neolm.vector）',
      count: records.length, records,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true, file, count: records.length, bytes: fs.statSync(file).size };
  }

  function vectorOf(id) { return vectors.get(id) || null; }

  /** 库质心：所有真实卡向量的平均 + L2 归一（不是编造的"库标签"）。 */
  function profile() {
    if (vectors.size === 0) return { active: false, reason: '索引为空', nodeCount: 0, modelId };
    const c = new Float64Array(dim);
    for (const v of vectors.values()) for (let i = 0; i < dim; i++) c[i] += v[i];
    for (let i = 0; i < dim; i++) c[i] /= vectors.size;
    l2(c);
    return {
      active: true, modelId, nodeCount: vectors.size, dim,
      vector: c,
      truncated,
      method: '逐卡真实向量算术平均 + L2 归一',
    };
  }

  function status() {
    return {
      active: true, modelId, dim, count: vectors.size, file,
      textChars, maxNodes, truncated, lastSync,
      cacheValid: diskModelId === modelId,
      method: 'neolm.vector(cardText) → Float32 落盘 → cosine',
    };
  }

  return {
    active: true, reason: '真实模型向量索引已就绪', modelId, dim, file,
    store, neolm, vectors, hashes,
    sync, save, upsertNode, vectorOf, profile, status,
    cosineOf: (idA, idB) => cosine(vectors.get(idA), vectors.get(idB)),
    cosineWith: (id, vec) => cosine(vectors.get(id), vec),
  };
}

// 进程内按「库根目录 + 模型指纹」缓存索引，避免每次工具调用重复解码磁盘。
const INDEX_CACHE = new Map();

/**
 * 工具层统一入口。模型缺失、索引创建失败一律如实返回不可用对象。
 * store._nodeV 变化（新增卡 / 重建索引）时自动增量同步。
 */
export function resolveSemantic(ctx, store, opts = {}) {
  const neolm = ctx?.neolm || null;
  const modelId = modelFingerprint(neolm);
  if (!modelId) {
    return { active: false, reason: '本地语言模型未加载或校验未通过，语义链路如实降级', index: null };
  }
  const root = store?.root || '';
  const key = `${root}|${modelId}|${Number(opts.maxNodes) || DEFAULT_MAX_NODES}`;
  let hit = INDEX_CACHE.get(key);
  if (!hit) {
    let index;
    try { index = createSemanticIndex({ store, neolm, opts }); }
    catch (e) { return { active: false, reason: `语义索引创建失败：${e?.message || e}`, index: null }; }
    if (!index.active) return { active: false, reason: index.reason, index: null };
    hit = { index, nodeV: -1, dirty: true };
    INDEX_CACHE.set(key, hit);
  }
  const nv = Number(store?._nodeV) || 0;
  if (hit.dirty || hit.nodeV !== nv || opts.force) {
    hit.index.sync({ force: !!opts.force });
    hit.nodeV = nv;
    hit.dirty = false;
  }
  return { active: true, reason: hit.index.reason, index: hit.index };
}

/** 显式让某库的缓存失效（重建索引 / 切换库时调用） */
export function invalidateSemantic(root) {
  for (const k of [...INDEX_CACHE.keys()]) {
    if (!root || k.startsWith(`${root}|`)) INDEX_CACHE.delete(k);
  }
}

// expandQuery 会扫描 750 MiB 权重，按查询串做进程内短缓存，避免高频重复读盘。
const EXPAND_CACHE = new Map();
function expandedTerms(neolm, text, k = 5) {
  const key = `${String(text).slice(0, 200)}|${k}`;
  if (EXPAND_CACHE.has(key)) return EXPAND_CACHE.get(key);
  let out = [];
  try {
    if (neolm?.active && typeof neolm.expandQuery === 'function') {
      out = neolm.expandQuery(String(text || ''), k).filter((t) => t && t.trim());
    }
  } catch { out = []; }
  if (EXPAND_CACHE.size > 128) EXPAND_CACHE.clear();
  EXPAND_CACHE.set(key, out);
  return out;
}

/**
 * 语义种子：把问题向量与索引里每张真实卡向量算 cosine，取 top-K 作为
 * 激活扩散的额外起点。每个种子附真实分数与可核查证据。
 * 纪律：这些 id 只是「起点」，最终路径仍必须走真实图边；分数单列，
 * 不混入 BM25 排名冒充字面命中。
 */
export function semanticSeeds(index, text, opts = {}) {
  if (!index?.active || !index.neolm?.active) return { active: false, reason: '语义索引不可用', seeds: [] };
  const topK = Math.max(1, Math.min(Number(opts.topK) || 6, 30));
  const minLift = Number.isFinite(Number(opts.minLift)) ? Number(opts.minLift) : DEFAULT_MIN_LIFT;
  let q;
  try { q = index.neolm.vector(String(text || '')); }
  catch (e) { return { active: false, reason: `查询向量计算失败：${e?.message || e}`, seeds: [] }; }
  if (!q) return { active: false, reason: '查询文本无法映射到词表', seeds: [] };
  const rows = [];
  let sum = 0;
  for (const [id, v] of index.vectors) {
    const sim = cosine(q, v);
    if (sim === null || !Number.isFinite(sim)) continue;
    rows.push({ id, sim, textHash: index.hashes.get(id) || null });
    sum += sim;
  }
  const mean = rows.length ? sum / rows.length : 0;
  const positive = rows
    .map((r) => ({ ...r, lift: r.sim - mean }))
    .filter((r) => r.lift > minLift)
    .sort((a, b) => b.lift - a.lift || a.id.localeCompare(b.id));
  const seeds = positive.slice(0, topK).map((r) => ({
    id: r.id,
    sim: Number(r.sim.toFixed(5)),                       // 原始 cosine，如实保留
    lift: Number(r.lift.toFixed(5)),                     // 相对显著性
    // 固定尺度映射：噪声级 lift 只得到很弱的扩散初值，不会压过字面证据
    strength: Number(Math.min(1, r.lift / LIFT_SCALE).toFixed(5)),
    textHash: r.textHash,
  }));
  return {
    active: true, modelId: index.modelId, minLift, liftScale: LIFT_SCALE,
    baseline: Number(mean.toFixed(5)), compared: rows.length,
    expandedTerms: opts.withEvidence === false ? [] : expandedTerms(index.neolm, text, 5),
    method: '均值中心化 cosine：lift = 真实 cosine − 本库平均 cosine；扩散初值按固定尺度映射（工程衰减系数，非模型置信度）',
    seeds,
  };
}

/**
 * 库桥候选：两个库之间的真实卡对语义近邻。
 * 纪律：只读建议，绝不建边。每条必须给出 cosine 与共享术语证据；
 * 只有模型分数、没有字面证据的候选如实标成 semantic_only，并排在后面。
 */
export function bridgeCandidates({ a, b, opts = {} } = {}) {
  const bad = (reason) => ({ active: false, reason, pairs: [], compared: 0 });
  if (!a?.index?.active || !b?.index?.active) return bad('至少一个库的语义索引不可用');
  if (a.index.modelId !== b.index.modelId) return bad('两个库的模型指纹不同，拒绝给出不可比的相似度');
  const cap = Math.max(1, Math.min(Number(opts.perVaultCap) || 80, 500));
  const topK = Math.max(1, Math.min(Number(opts.topK) || 12, 60));
  // 与语义种子同理：该领域模型有很高的共同基线，绝对 cosine 门槛会把无关卡
  // 也判成"相关"。这里用全体卡对的平均 cosine 做中心化，只取显著高于基线的卡对。
  const minLift = Number.isFinite(Number(opts.minLift)) ? Number(opts.minLift) : 0.03;
  const pa = a.index.profile(), pb = b.index.profile();
  const vaultSim = pa.active && pb.active ? cosine(pa.vector, pb.vector) : null;

  // 确定性截断：按 id 排序取前 cap 张，绝不用随机采样冒充"代表性"
  const take = (ix, st) => [...ix.vectors.keys()].sort().slice(0, cap)
    .map((id) => ({ id, node: st?.getNode?.(id) || null, vec: ix.vectorOf(id) }))
    .filter((r) => r.vec);
  const rowsA = take(a.index, a.store), rowsB = take(b.index, b.store);
  const scored = [];
  let compared = 0, sum = 0;
  for (const ra of rowsA) {
    const ta = cardText(ra.node);
    for (const rb of rowsB) {
      const sim = cosine(ra.vec, rb.vec);
      if (sim === null || !Number.isFinite(sim)) continue;
      compared++; sum += sim;
      scored.push({ ra, rb, ta, sim });
    }
  }
  const baseline = compared ? sum / compared : 0;
  const pairs = scored
    .filter((r) => r.sim - baseline >= minLift)
    .sort((x, y) => (y.sim - x.sim) || x.ra.id.localeCompare(y.ra.id))
    .slice(0, Math.max(topK * 3, 36))
    .map((r) => {
      const nb = r.rb.node;
      const terms = nb ? sharedTerms(r.ta, cardText(nb)) : [];
      return {
        aId: r.ra.id, aTitle: r.ra.node?.title || r.ra.id, aPath: r.ra.node?.path || null,
        bId: r.rb.id, bTitle: nb?.title || r.rb.id, bPath: nb?.path || null,
        sim: Number(r.sim.toFixed(5)),
        lift: Number((r.sim - baseline).toFixed(5)),
        evidenceKind: terms.length ? 'shared_terms' : 'semantic_only',
        sharedTerms: terms,
        modelId: a.index.modelId,
        requiresHumanConfirm: true,
      };
    });
  pairs.sort((x, y) => y.lift - x.lift
    || (x.evidenceKind === y.evidenceKind ? 0 : x.evidenceKind === 'shared_terms' ? -1 : 1));
  return {
    active: true, modelId: a.index.modelId,
    vaultSimilarity: vaultSim === null ? null : Number(vaultSim.toFixed(5)),
    vaultSimilarityNote: '库质心 cosine 同样存在共同基线，只作库间相对比较，不代表绝对语义相关',
    vaultA: { nodeCount: pa.nodeCount, truncated: !!pa.truncated },
    vaultB: { nodeCount: pb.nodeCount, truncated: !!pb.truncated },
    compared, cap, minLift, baseline: Number(baseline.toFixed(5)),
    method: '两库逐卡真实向量 cosine + 均值中心化显著性 + 共享术语证据 + 库质心 cosine',
    pairs: pairs.slice(0, topK),
  };
}

export default {
  SEMANTIC_SCHEMA, modelFingerprint, cardText, cardTextHash, sharedTerms, cosine,
  createSemanticIndex, resolveSemantic, invalidateSemantic, semanticSeeds, bridgeCandidates,
};
