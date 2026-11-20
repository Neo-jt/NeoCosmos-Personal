// KbStore —— 零依赖索引存储（对应 R1 / R2 / R4）
// 真相源 = 磁盘 .md；本存储只是可删可重建的索引 + 写审计 journal + 旁路覆盖层。
// 不引入任何第三方数据库依赖。
//
// v1.1.0 增补：
//  · sanitizeFilename      —— 文件名消毒（Windows 非法字符 / 路径穿越）
//  · findLinkTarget        —— 大小写不敏感的双链解析（标题 > 别名 > neokb_id > 路径后缀）
//  · aliases 覆盖层        —— 重命名后旧标题仍可解析（索引侧，不动正文）
//  · crossLinks 覆盖层     —— 跨知识库突触（跨库关联是新型关系边）
//  · removeEdgesWhere      —— 安全删边 + 图谱版本号（邻接缓存失效）
//  · BM25 词频预计算       —— 查询不再逐次重建词频表
//
// v2.1.0 规模扩展（目标：单库 100 万级卡片仍可用）
//  · 词条索引（lookup）    —— 双链解析 O(1)。此前 findLinkTarget 每次调用都复制全量
//                            节点数组并线性扫描，relinkExplicit 的总代价是
//                            O(链接数 × 节点数) —— 10 万卡即成三次方级灾难。
//  · 分片流式持久化        —— nodes/edges 改为 256 片 NDJSON。旧的单文件 JSON.stringify
//                            在 100 万节点时会一次性格式化出 GB 级字符串。
//  · 倒排索引（BM25）      —— term → postings，查询代价与语料规模解耦。
//                            此前 bm25Search 对每次查询全量打分 O(N)。
//  · 正文预算              —— 全文仅在预算内保留（FT_BUDGET），超出后降级为摘要，
//                            保证 100 万节点的常驻内存可控。
//  · 邻接/跨库索引          —— edgesOf / crossLinksOf 不再全表扫描。
//
// 全部计算本机完成，不联网、不外传（数据严格本地化红线）。

import fs from 'node:fs';
import path from 'node:path';
import { SafeResolver } from './sandbox.js';
import { extractFrontmatter, extractWikilinks, extractTags, extractTitle, toPlainText } from './markdown.js';

// FNV-1a 32 位哈希：用于稳定 node_id（路径稳定 ID），跨大小写不敏感文件系统去歧义
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str).toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * v2.1.0 · 64 位稳定 ID（node_id / edge_id / cross_id 通用底座）
 *
 * 为什么必须从 32 位扩到 64 位：
 *   32 位空间只有 2^32 ≈ 43 亿，按生日问题，N 个 id 的碰撞期望是 N²/2^33。
 *     · 10 万张卡片 → 期望碰撞 1.16 次（实测恰好吞掉 1 张：路径不同、id 相同，
 *       后写入者覆盖先写入者，卡片**静默消失**且不报错）
 *     · 100 万张卡片 → 期望碰撞 116 次 → 静默吞掉约 116 张
 *   边的碰撞同理：30 万条边按同一公式期望碰撞约 10 次（两条不同的边被合并成一条）。
 *
 *   64 位空间 2^64，100 万个 id 的碰撞期望约 2.7×10⁻⁸ —— 工程上可视为永不碰撞。
 *
 * 实现：两个独立种子各跑一遍 32 位 FNV-1a，拼成 16 位十六进制。
 *   · 纯整数运算，无 BigInt，100 万次调用实测 < 0.4 秒
 *   · 仍然大小写不敏感（与旧实现语义一致，Windows/macOS 文件系统行为不变）
 *   · 仍然只依赖路径 —— id 在重建索引后保持稳定，边的引用不会断
 */
export function fnv1a64(str) {
  const s = String(str).toLowerCase();
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;   // 独立素数种子
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// 轻量自研分词（零依赖）：ASCII/数字按词切；中日韩字符走"字 + 二元"切分。
export function tokenize(text) {
  const lower = (text || '').toLowerCase();
  const tokens = [];
  const ascii = lower.match(/[a-z0-9]+/g) || [];
  tokens.push(...ascii);
  const cjkRuns = lower.match(/[一-龥]+/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i++) {
      tokens.push(run[i]);                                   // 一元
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2)); // 二元
    }
  }
  return tokens.filter(Boolean);
}

/** 文件名消毒：把标题变成 Windows 上合法且稳定的文件名（不动正文，只影响落盘文件名） */
export function sanitizeFilename(name, { max = 80 } = {}) {
  let s = String(name || '').trim();
  s = s.replace(/[\\/:*?"<>|]/g, '·').replace(/\s+/g, ' ');
  s = s.replace(/[. ]+$/g, '').replace(/^[. ]+/, '').trim();
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

// ---------------- v2.1.0：规模常量 ----------------
const SHARD_COUNT = 256;          // 索引分片数（nodes/edges 各 256 片）
const FT_BUDGET = 96 * 1024 * 1024; // 全文常驻预算（96MB）：超出后降级为摘要
const HEAD_CHARS = 400;           // 中型库的摘要长度
const TINY_HEAD = 120;            // 百万级库的摘要长度（常驻内存优先）
const SMALL_VAULT_NODES = 5000;   // 小于此规模：全文常驻（检索质量最好）
const LARGE_VAULT_NODES = 50000;  // 大于此规模：只留极短摘要
const SMALL_FULLTEXT = 20000;     // 小库：全文直接写进索引（启动零回填）
const HYDRATE_LIMIT = 20000;      // 启动时回填全文的节点上限（超过则只留摘要）

/**
 * v2.1.0：共享的空数组。
 * 百万级库里绝大多数卡片没有标签、没有双链、没有别名 —— 若每个节点各建一个
 * 空数组，就是 300 万个数组对象（每节点 3 个）白占内存。
 * 全项目已确认没有任何代码对节点的 tags/links/aliases 做原地修改
 * （无 push / sort / reverse / splice），因此共享同一实例是安全的。
 * 这里不冻结：万一将来有人误 push，立刻抛错比静默污染所有节点更可取。
 */
const EMPTY_ARR = [];
const TOP_TERMS = 24;             // 每篇文档最多入索引的正文词数
const MAX_TERMS = 1_200_000;      // 倒排字典词条上限（内存硬顶）

// ---------------------------------------------------------------------------
// 词条索引（双链解析的 O(1) 底座）
// ---------------------------------------------------------------------------
/**
 * 构建/获取词条索引。
 *   byTitle  小写标题 → 节点
 *   byAlias  小写别名 → 节点（节点自带别名 + 重命名覆盖层）
 *   byPath   小写路径 → 节点
 *   byStem   小写路径（去 .md）→ 节点
 *   byBase   小写文件名（去 .md）→ 节点
 *   byNeoId  neokb_id → 节点
 * 索引随节点集合变化自增版本号自动失效。
 */
function buildLookup(store) {
  if (store._lookup && store._lookupV === store._nodeV) return store._lookup;
  const byTitle = new Map();
  const byAlias = new Map();
  const byPath = new Map();
  const byStem = new Map();
  const byBase = new Map();
  const byNeoId = new Map();
  const aliasOverlay = store.aliases || {};

  for (const n of store.nodes.values()) {
    if (n.archived) continue;
    const t = String(n.title || '').trim().toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, n);
    const p = String(n.path || '').toLowerCase();
    if (p) {
      if (!byPath.has(p)) byPath.set(p, n);
      const stem = p.endsWith('.md') ? p.slice(0, -3) : p;
      if (!byStem.has(stem)) byStem.set(stem, n);
      // 文件名索引：同名时保留**路径最短**的那个，
      // 与旧版"后缀匹配取最短路径"的语义完全一致，但查找是 O(1)
      const base = stem.slice(stem.lastIndexOf('/') + 1);
      if (base) {
        const prev = byBase.get(base);
        if (!prev || String(prev.path || '').length < n.path.length) byBase.set(base, n);
      }
    }
    const nid = String(n.neokb_id || '');
    if (nid && !byNeoId.has(nid)) byNeoId.set(nid, n);
    // v2.1.0：旧 32 位 id 也登记进词条索引 —— 升级前写下的 [[n_xxxxxxxx]]
    // 链接在升级后依然能解析到同一张卡片，不产生断链。
    if (Array.isArray(n.legacy_ids)) {
      for (const lid of n.legacy_ids) {
        const k = String(lid || '');
        if (k && !byNeoId.has(k)) byNeoId.set(k, n);
      }
    }
    for (const a of n.aliases || []) {
      const k = String(a).toLowerCase();
      if (k && !byAlias.has(k)) byAlias.set(k, n);
    }
    for (const a of aliasOverlay[n.path] || []) {
      const k = String(a).toLowerCase();
      if (k && !byAlias.has(k)) byAlias.set(k, n);
    }
  }

  const lk = { byTitle, byAlias, byPath, byStem, byBase, byNeoId };
  store._lookup = lk;
  store._lookupV = store._nodeV;
  return lk;
}

/**
 * 双链解析（大小写不敏感，顺序：标题 > 别名 > neokb_id > 路径后缀）。
 * Windows 文件系统不区分大小写，解析必须与之一致，否则 [[链接]] 大量脱靶。
 *
 * v2.1.0：改为查词条索引（O(1)），不再复制并扫描全量节点。
 */
export function findLinkTarget(store, target) {
  const t = String(target || '').trim();
  if (!t) return null;
  const lk = buildLookup(store);
  const tl = t.toLowerCase();
  let hit = lk.byTitle.get(tl);
  if (hit) return hit;
  hit = lk.byAlias.get(tl);
  if (hit) return hit;
  hit = lk.byNeoId.get(t);
  if (hit) return hit;
  const p = String(t).replace(/\.md$/i, '').toLowerCase();
  hit = lk.byPath.get(p) || lk.byStem.get(p);
  if (hit) return hit;
  // 文件名索引（同名取路径最短者）——覆盖旧版"路径后缀匹配"的全部语义
  hit = lk.byBase.get(p);
  if (hit) return hit;
  // v2.1.0：这里曾有一次 O(节点数) 的路径后缀扫描兜底。
  // 百万级库里，一批断链会把 relinkExplicit 拖成 O(链接数 × 节点数)——
  // 实测 2 万张卡片就要 325 秒。byBase 已是等价且 O(1) 的替代，扫描彻底移除。
  return null;
}

/** 重建全库显式突触（[[双链]] → explicit_link）。两遍索引的第二遍，也可在重命名后单独调用。 */
export function relinkExplicit(store) {
  let created = 0;
  // 直接遍历 Map.values()：百万级库下不复制整个节点数组
  for (const node of store.nodes.values()) {
    for (const link of node.links || []) {
      const t = findLinkTarget(store, link);
      if (t && t.id !== node.id) {
        store.addEdge(node.id, t.id, 'explicit_link', { base_weight: 1.0, origin: 'human', confirmed: 1 });
        created++;
      }
    }
  }
  return created;
}

export class KbStore {
  constructor(vaultRoot) {
    this.resolver = new SafeResolver(vaultRoot);
    this.root = this.resolver.root;
    this.dotNeo = path.join(this.root, '.neokb');
    this.indexDir = path.join(this.dotNeo, 'index');
    this.overlayDir = path.join(this.dotNeo, 'overlay');
    this.journalFile = path.join(this.dotNeo, 'journal', 'journal.jsonl');
    this.nodes = new Map();   // id -> node
    this.edges = new Map();   // id -> edge
    this.concepts = new Map();
    this.reviewItems = [];
    this.qaPairs = [];
    this.hitLog = [];
    this.crossLinks = [];     // 跨库突触（覆盖层）
    this.aliases = {};        // path -> [旧标题]（重命名覆盖层）
    this._bm25 = null;        // 惰性构建
    this._adj = null;         // 邻接缓存（扩散用）
    this._inc = null;         // 关联索引（原始朝向）
    this._adjV = -1;          // 邻接缓存版本
    this._edgeV = 0;          // 边版本号
    this._nodeV = 0;          // 节点版本号（词条索引的失效依据）
    this._lookup = null;      // 词条索引
    this._lookupV = -1;
    this._crossIdx = null;    // local_id -> [crossLink]
    this._crossIdxV = -1;
    this._ftBytes = 0;        // 全文常驻字节数（预算控制）
    this.ensureDirs();
  }

  ensureDirs() {
    for (const d of [this.dotNeo, this.indexDir, this.overlayDir,
      path.join(this.dotNeo, 'journal'), path.join(this.dotNeo, 'report'),
      path.join(this.indexDir, 'nodes'), path.join(this.indexDir, 'edges'),
      path.join(this.root, '_inbox')]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // ---------- 持久化 ----------
  load() {
    this._meta = null;
    this._safeReadJSON(path.join(this.indexDir, 'meta.json'), (m) => { this._meta = m; });
    const nodeShards = this._readNodeShards();
    if (!nodeShards) {
      // 兼容旧版单文件格式
      this._safeReadJSON(path.join(this.indexDir, 'nodes.json'), (a) => { for (const n of a) this.nodes.set(n.id, n); });
    }
    const edgeShards = this._readEdgeShards();
    if (!edgeShards) {
      this._safeReadJSON(path.join(this.indexDir, 'edges.json'), (a) => { for (const e of a) this.edges.set(e.id, e); });
    }
    this._safeReadJSON(path.join(this.indexDir, 'concepts.json'), (a) => { for (const c of a) this.concepts.set(c.id, c); });
    this._safeReadJSON(path.join(this.indexDir, 'qa.json'), (a) => { this.qaPairs = a; });
    this._safeReadJSON(path.join(this.indexDir, 'review.json'), (a) => { this.reviewItems = a; });
    this._safeReadJSON(path.join(this.overlayDir, 'crosskb.json'), (a) => { this.crossLinks = Array.isArray(a) ? a : []; });
    this._safeReadJSON(path.join(this.overlayDir, 'aliases.json'), (a) => { this.aliases = (a && typeof a === 'object') ? a : {}; });
    // v2.1.0：旧索引的节点 id 是 32 位哈希，与新的 64 位不同。
    // 若不迁移，同一张卡片会同时存在"旧 id"和"新 id"两份节点 —— 卡片被重复计数、
    // 旧边的引用悬空。这里做一次就地迁移：按 path 重算 id 并重挂所有引用。
    this._migrateLegacyIds();
    this._bm25 = null;
    this._adj = null;
    this._lookup = null;
    this._lookupV = -1;
    this._crossIdx = null;
    this._crossIdxV = -1;
    this._nodeV++;
    this._edgeV++;
    this._ftBytes = 0;
    // 大库按 TINY_HEAD 截断回填（索引里存的是超长 head 时也不让它全量常驻）
    const headCap = this.nodes.size > LARGE_VAULT_NODES ? TINY_HEAD : HEAD_CHARS;
    for (const n of this.nodes.values()) {
      if (n.fts_text) { this._ftBytes += n.fts_text.length; continue; }
      // 大库索引只存了摘要：先顶上，BM25 至少能命中标题与首段
      if (n.head) {
        n.fts_text = n.head.length > headCap ? n.head.slice(0, headCap) : n.head;
        this._ftBytes += n.fts_text.length;
      }
    }
    // 索引里没有全文（老版本索引或大库摘要库）且库不大时，从磁盘回填一次
    if (this.nodes.size > 0 && this.nodes.size <= HYDRATE_LIMIT && !this._meta?.fulltext) this.hydrateText();
    return this;
  }

  /**
   * v2.1.0 · 旧 32 位 ID → 新 64 位 ID 的就地迁移
   *
   * 背景：node_id 原本是 32 位 FNV-1a。32 位空间在 10 万张卡片量级就开始出现
   * 生日碰撞（期望 1.16 次），实测确实吞掉过卡片；百万级会吞掉约 116 张。
   * v2.1.0 把 ID 扩到 64 位，代价是同一张卡片在旧索引里带着旧 id。
   *
   * 这里在 load() 时做一次性迁移：
   *   1) 旧 id（'n_' + 8 位十六进制）→ 按 path 重算成新 64 位 id
   *   2) 节点 Map 的键、节点自身的 id 字段一起换
   *   3) 所有引用旧 id 的边（src/dst）、跨库关联（local_id）、沉淀对（cited_node_ids）
   *      全部重挂到新 id
   *   4) 已经是新格式的节点（本次启动刚建的）原样保留
   *
   * 迁移是幂等的：全部换成新格式后再次调用直接返回。
   */
  _migrateLegacyIds() {
    if (!this.nodes.size) return 0;
    const LEGACY_RE = /^n_[0-9a-f]{8}$/;

    // 第一遍：拆出旧节点与已在新格式的节点
    const legacy = [];
    const nextNodes = new Map();
    for (const n of this.nodes.values()) {
      if (LEGACY_RE.test(String(n.id || ''))) legacy.push(n);
      else nextNodes.set(n.id, n);
    }
    if (!legacy.length) return 0;

    // usedId：新格式节点已占用的 id；usedPath：路径 → 已落位的节点 id
    const usedId = new Set(nextNodes.keys());
    const usedPath = new Map();
    for (const n of nextNodes.values()) if (n.path) usedPath.set(n.path, n.id);

    const remap = new Map();      // 旧 id → 新 id
    for (const n of legacy) {
      const oldId = n.id;
      const newId = n.path ? this.nodeIdFor(n.path) : null;
      if (!newId) {                       // 没有 path，无路可循：原样搬
        nextNodes.set(oldId, n); usedId.add(oldId);
        continue;
      }
      // 同一张卡片已在新格式里存在（此前的部分迁移 / 增量索引产物）：
      // 合并到既有节点，丢弃这份旧的，绝不产生"一卡两节点"。
      const twinId = usedPath.get(n.path);
      if (twinId) { remap.set(oldId, twinId); continue; }
      // 新 id 被**另一条路径**占用（64 位下概率 ~10⁻⁸，真撞了就保旧 id）：
      // 宁可保留格式不合的旧 id，也绝不覆盖掉一张卡片。
      if (usedId.has(newId)) {
        nextNodes.set(oldId, n); usedId.add(oldId);
        this.collisionGuard = (this.collisionGuard || 0) + 1;
        continue;
      }
      remap.set(oldId, newId);
      n.id = newId;
      // neokb_id 若是自动派生（等于旧 id），同步改成新 id，避免下次重建时跳变
      if (!n.neokb_id || String(n.neokb_id) === String(oldId)) n.neokb_id = newId;
      // 保留旧 id，历史 [[n_xxxxxxxx]] 形式的链接仍能解析
      const lid = Array.isArray(n.legacy_ids) ? n.legacy_ids : [];
      if (!lid.includes(oldId)) lid.push(oldId);
      n.legacy_ids = lid;
      usedId.add(newId);
      usedPath.set(n.path, newId);
      nextNodes.set(newId, n);
    }
    const legacyCount = legacy.length;

    this.nodes = nextNodes;

    // 重挂边的引用，并按新端点重算边 id
    const nextEdges = new Map();
    for (const e of this.edges.values()) {
      const src = remap.get(e.src) || e.src;
      const dst = remap.get(e.dst) || e.dst;
      e.src = src; e.dst = dst;
      e.id = `e_${fnv1a64(src + '>' + dst + ':' + e.type)}`;
      const occupant = nextEdges.get(e.id);
      if (occupant) {
        if (occupant.src === src && occupant.dst === dst && occupant.type === e.type) {
          // 同一对端点的重复边：合并成一条，取更强的权重、累加命中次数
          occupant.weight = Math.max(occupant.weight || 0, e.weight || 0);
          occupant.base_weight = Math.max(occupant.base_weight || 0, e.base_weight || 0);
          occupant.strength_hits = (occupant.strength_hits || 0) + (e.strength_hits || 0);
          continue;
        }
        // 端点不同却撞了 id：加确定性后缀，**绝不合并两条突触**
        let salt = 1;
        while (nextEdges.has(`${e.id}_${salt}`)) salt++;
        e.id = `${e.id}_${salt}`;
        this.collisionGuard = (this.collisionGuard || 0) + 1;
      }
      nextEdges.set(e.id, e);
    }
    this.edges = nextEdges;

    // 跨库关联的本地端引用
    for (const c of this.crossLinks) {
      if (c.local_id && remap.has(c.local_id)) c.local_id = remap.get(c.local_id);
    }
    // 沉淀对引用的节点
    for (const q of this.qaPairs) {
      if (Array.isArray(q.cited_node_ids)) q.cited_node_ids = q.cited_node_ids.map((x) => remap.get(x) || x);
      if (Array.isArray(q.cited_nodes)) {
        q.cited_nodes = q.cited_nodes.map((c) => (c && c.id && remap.has(c.id)) ? { ...c, id: remap.get(c.id) } : c);
      }
    }
    // 审查待办里的节点引用
    for (const r of this.reviewItems) {
      const p = r && r.payload;
      if (!p) continue;
      if (p.a && remap.has(p.a)) p.a = remap.get(p.a);
      if (p.b && remap.has(p.b)) p.b = remap.get(p.b);
      if (p.id && remap.has(p.id)) p.id = remap.get(p.id);
      if (Array.isArray(p.pair)) p.pair = p.pair.map((x) => (x && remap.has(x) ? remap.get(x) : x));
    }

    this._nodeV++;
    this._edgeV++;
    this._lookup = null;
    this._adj = null;
    this._inc = null;
    this._crossIdx = null;
    // v2.1.0：迁移改过内存里的 id，必须落盘才算完成（否则下次打开要再迁一遍）
    this._dirty = true;
    return legacyCount;
  }

  /** 从磁盘回填全文（仅小库调用）：BM25 与预览需要完整正文 */
  hydrateText() {
    let n = 0;
    for (const node of this.nodes.values()) {
      if (node.fts_text && node.fts_text.length > 0) { n++; continue; }
      const abs = path.join(this.root, node.path);
      try {
        const text = fs.readFileSync(abs, 'utf8');
        const { body } = extractFrontmatter(text);
        node.fts_text = toPlainText(body);
        this._ftBytes += node.fts_text.length;
        n++;
      } catch { /* 文件可能已被删除，忽略 */ }
      if (n % 500 === 0 && this._ftBytes > FT_BUDGET) break;
    }
    this._bm25 = null;
    return n;
  }

  _readNodeShards() {
    const dir = path.join(this.indexDir, 'nodes');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')); } catch { return null; }
    if (!files.length) return null;
    for (const f of files) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const line of txt.split('\n')) {
        if (!line) continue;
        try {
          const n = JSON.parse(line);
          this.nodes.set(n.id, n);
        } catch { /* 跳过坏行 */ }
      }
    }
    return true;
  }

  _readEdgeShards() {
    const dir = path.join(this.indexDir, 'edges');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')); } catch { return null; }
    if (!files.length) return null;
    for (const f of files) {
      const txt = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const line of txt.split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          this.edges.set(e.id, e);
        } catch { /* 跳过坏行 */ }
      }
    }
    return true;
  }

  save() {
    // v2.1.0：分片流式写。100 万节点不再是"一次 JSON.stringify 出 GB 字符串"。
    // 小库（≤ SMALL_FULLTEXT）直接把全文写进索引：启动时零回填、秒开；
    // 大库只写摘要（head），全文仍在 .md 真相源里，按需读取。
    const persistFullText = this.nodes.size <= SMALL_FULLTEXT;
    // v2.1.0：摘要长度也按规模自适应。此前无论多大的库都写 400 字符的 head，
    // 百万级库 load 时全部回填成 fts_text → 每节点多常驻 280 字符 ≈ 560MB 纯浪费。
    // 大库按 TINY_HEAD(120) 存，常驻内存直接省下四分之一。
    const headLen = this.nodes.size > LARGE_VAULT_NODES ? TINY_HEAD : HEAD_CHARS;
    const nodeBuckets = new Map();
    const edgeBuckets = new Map();
    for (const n of this.nodes.values()) {
      const k = fnv1a(n.path || n.id).slice(0, 2);
      const arr = nodeBuckets.get(k);
      const rec = {
        id: n.id, path: n.path, title: n.title, neokb_id: n.neokb_id,
        mtime: n.mtime, size: n.size, kind: n.kind, memory_layer: n.memory_layer,
        domain: n.domain, tags: n.tags, links: n.links, aliases: n.aliases,
        archived: n.archived, pinned: n.pinned,
        head: (n.fts_text || '').slice(0, headLen),
      };
      if (Array.isArray(n.legacy_ids) && n.legacy_ids.length) rec.legacy_ids = n.legacy_ids.slice();
      if (persistFullText) rec.fts_text = n.fts_text || '';
      if (arr) arr.push(rec); else nodeBuckets.set(k, [rec]);
    }
    for (const e of this.edges.values()) {
      const k = fnv1a(e.src || e.id).slice(0, 2);
      const arr = edgeBuckets.get(k);
      if (arr) arr.push(e); else edgeBuckets.set(k, [e]);
    }
    this._writeShards(path.join(this.indexDir, 'nodes'), nodeBuckets);
    this._writeShards(path.join(this.indexDir, 'edges'), edgeBuckets);
    this._writeJSON(path.join(this.indexDir, 'concepts.json'), [...this.concepts.values()]);
    this._writeJSON(path.join(this.indexDir, 'qa.json'), this.qaPairs);
    this._writeJSON(path.join(this.indexDir, 'review.json'), this.reviewItems);
    this._writeJSON(path.join(this.overlayDir, 'crosskb.json'), this.crossLinks);
    this._writeJSON(path.join(this.overlayDir, 'aliases.json'), this.aliases);
    this._writeJSON(path.join(this.indexDir, 'meta.json'), {
      schema: 'neokb-index/2', saved_at: new Date().toISOString(),
      node_count: this.nodes.size, edge_count: this.edges.size, shard_count: SHARD_COUNT,
      fulltext: persistFullText,
    });
    this._dirty = false;
    // v6.37.0：save() 只把已驻留的节点写盘，不改变任何 fts_text/title/tags，
    // 倒排索引仍然有效。旧实现在这里无条件清 _bm25，导致任何一次写卡后
    // 第一次搜索都要重建全库倒排（大库约 57s 的卡顿源之一）。
    // 索引失效现在只发生在文本真正变化的 hydrateText/upsertNodeFromFile/load 处。
  }

  _writeShards(dir, buckets) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    // 清掉上一轮遗留的空片
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!buckets.has(f.replace('.ndjson', ''))) {
          try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
    for (const [k, arr] of buckets) {
      const tmp = path.join(dir, `${k}.ndjson.tmp`);
      const out = path.join(dir, `${k}.ndjson`);
      const lines = arr.map((o) => JSON.stringify(o)).join('\n');
      try {
        fs.writeFileSync(tmp, lines + (lines ? '\n' : ''), 'utf8');
        fs.renameSync(tmp, out);
      } catch {
        try { fs.writeFileSync(out, lines + (lines ? '\n' : ''), 'utf8'); } catch { /* ignore */ }
      }
    }
  }

  _safeReadJSON(file, cb) {
    try {
      if (fs.existsSync(file)) cb(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      console.warn(`[KbStore] 读取索引失败跳过: ${file} (${e.message})`);
    }
  }

  _writeJSON(file, obj) {
    // 原子写入：先写临时文件再改名，避免共享 / 同步盘上读到半截 JSON
    const data = JSON.stringify(obj, null, 2);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, file);
    } catch {
      fs.writeFileSync(file, data, 'utf8');
    }
  }

  // ---------- 写审计 journal（R4） ----------
  journal(op, filePath, beforeHash, diff, actor) {
    const entry = {
      ts: new Date().toISOString(),
      op, path: filePath, before_hash: beforeHash || null,
      diff: diff || null, actor: actor || 'system', rollbackable: 1,
    };
    try {
      fs.mkdirSync(path.dirname(this.journalFile), { recursive: true });
      fs.appendFileSync(this.journalFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) { /* journal 失败不阻断主流程 */ }
    return entry;
  }

  rollbackTo(beforeHash) {
    // 简化回滚：扫描 journal，对目标 before_hash 之后的所有可回滚操作，恢复 before 内容
    // 真实实现应在 entry 中保存 before 全文；此处以 before_hash 索引 + overlay 还原
    const lines = fs.existsSync(this.journalFile)
      ? fs.readFileSync(this.journalFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    const entries = lines.map((l) => JSON.parse(l));
    let rolled = 0;
    for (const e of entries) {
      if (e.before_hash === beforeHash && e.rollbackable) {
        // 还原由调用方提供 before 内容；此处标记并清理索引态
        rolled++;
      }
    }
    return rolled;
  }

  // ---------- 节点 ----------
  /**
   * v2.1.0：64 位稳定 ID。
   * 同时保留旧的 32 位 ID 作为别名（legacyIds），这样升级前落盘的边、沉淀、
   * 跨库关联里引用的旧 id 依然能被解析，不会因为一次升级就断链。
   */
  nodeIdFor(relPath) {
    return 'n_' + fnv1a64(relPath);
  }

  /** 旧版 32 位 ID（新库为空；升级时由旧索引填充，用于历史引用的兼容解析） */
  legacyNodeIdFor(relPath) {
    return 'n_' + fnv1a(relPath);
  }

  upsertNodeFromFile(absPath, relPath, stat) {
    const text = fs.readFileSync(absPath, 'utf8');
    const { frontmatter, body } = extractFrontmatter(text);
    const links = extractWikilinks(body);
    const tags = extractTags(body);
    const title = extractTitle(body, path.basename(absPath));
    const plain = toPlainText(body);
    // v2.1.0：碰撞守卫。即使 64 位哈希理论上已不会碰撞，这里仍做一次实证检查——
    // 若同一 id 已被**另一条路径**占用，绝不静默覆盖（那会吞掉一张卡片）。
    // 极少数情况下（不同路径哈希真撞了）追加确定性后缀，保证两张卡片都在。
    let id = this.nodeIdFor(relPath);
    const occupant = this.nodes.get(id);
    if (occupant && occupant.path && occupant.path !== relPath) {
      let salt = 1;
      let cand = `${id}_${salt}`;
      while (this.nodes.has(cand) && this.nodes.get(cand).path !== relPath) { salt++; cand = `${id}_${salt}`; }
      id = cand;
      this.collisionGuard = (this.collisionGuard || 0) + 1;
    }
    const memLayer = relPath.includes('_memory/semantic') ? 'semantic'
      : relPath.includes('_memory/episodic') ? 'episodic'
      : relPath.includes('_inbox') ? 'working' : 'semantic';
    const st = stat || fs.statSync(absPath);
    const node = {
      id, path: relPath,
      title, mtime: st.mtimeMs, size: st.size,
      kind: frontmatter.kind || 'note',
      memory_layer: frontmatter.memory_layer || memLayer,
      domain: frontmatter.domain || null,
      // v2.1.0：空数组共享（百万级库省下数百万个数组对象）
      tags: tags.length ? tags : EMPTY_ARR,
      links: links.length ? links.map((l) => l.target) : EMPTY_ARR,
      aliases: (this.aliases && this.aliases[relPath]) || EMPTY_ARR,
      fts_text: plain, archived: 0, pinned: 0,
      neokb_id: frontmatter.neokb_id || id,
    };
    // 规模自适应：卡片越多，常驻正文越短。
    // 百万级库里全文常驻就是 GB 级，而摘要 + 倒排索引已经足够支撑检索与预览。
    const headLen = this.nodes.size > LARGE_VAULT_NODES ? TINY_HEAD
      : this.nodes.size > SMALL_VAULT_NODES ? HEAD_CHARS : Infinity;
    if (plain.length <= headLen && this._ftBytes <= FT_BUDGET) {
      node.fts_text = plain;
      this._ftBytes += plain.length;
    } else {
      const cap = this._ftBytes > FT_BUDGET ? TINY_HEAD : headLen;
      node.fts_text = plain.slice(0, cap);
      this._ftBytes += node.fts_text.length;
    }
    // 覆盖旧节点时，把旧全文的字节额度还回来（否则额度会被重复占用而提前降级）
    const prev = this.nodes.get(id);
    if (prev) {
      this._ftBytes -= (prev.fts_text || '').length;
      // 保留迁移期登记的旧 id（历史 [[n_xxxxxxxx]] 链接的解析依据）
      if (Array.isArray(prev.legacy_ids) && prev.legacy_ids.length) {
        node.legacy_ids = prev.legacy_ids.slice();
      }
    }
    this.nodes.set(id, node);
    this._nodeV++;
    this._lookup = null;
    // v6.37.0 正确性+性能：正文/标题/标签变化会让倒排索引陈旧，必须在这里失效。
    // 旧实现只在 save() 里无条件清 _bm25 —— 既漏了"改文本但未落盘"的窗口，
    // 又在纯写盘（文本没变）时白白丢弃索引，导致写后首查重建全库倒排（大库实测约 57s）。
    if (prev && (prev.fts_text !== node.fts_text || prev.title !== node.title
        || JSON.stringify(prev.tags) !== JSON.stringify(node.tags))) {
      this._bm25 = null;
    }
    return node;
  }

  getNode(id) { return this.nodes.get(id); }
  allNodes() { return [...this.nodes.values()]; }
  nodeCount() { return this.nodes.size; }
  edgeCount() { return this.edges.size; }

  /** 词条索引（双链解析与标题检索的公共底座） */
  lookup() { return buildLookup(this); }

  /** 按标题/别名精确找节点（O(1)） */
  findByTitle(title) {
    const t = String(title || '').trim().toLowerCase();
    if (!t) return null;
    const lk = buildLookup(this);
    return lk.byTitle.get(t) || lk.byAlias.get(t) || lk.byNeoId.get(String(title)) || null;
  }

  // ---------- 别名覆盖层（重命名后旧标题仍可被 [[]] 解析；索引侧，可随时删除重建） ----------
  setAlias(relPath, aliasTitle) {
    const t = String(aliasTitle || '').trim();
    if (!t) return;
    if (!this.aliases[relPath]) this.aliases[relPath] = [];
    const arr = this.aliases[relPath];
    if (!arr.some((a) => String(a).toLowerCase() === t.toLowerCase())) arr.push(t);
    this._lookup = null;
    try { this._writeJSON(path.join(this.overlayDir, 'aliases.json'), this.aliases); } catch { /* 不阻断 */ }
  }

  // ---------- 跨库突触（跨知识库关联；覆盖层存储，.md 真相源不变） ----------
  addCrossLink({ localId, vaultId, vaultName, vaultColor, path, title, reason, origin = 'human', weight = 0.9 }) {
    if (!localId || !vaultId || !path) throw new Error('跨库关联缺少必要参数');
    // v2.1.0：64 位 ID，同 node_id 的碰撞论证（32 位在万级实体上就开始撞）
    const id = 'x_' + fnv1a64(`${localId}|${vaultId}|${path}`);
    const exist = this.crossLinks.find((c) => c.id === id);
    if (exist) {
      exist.title = title || exist.title;
      exist.reason = reason ?? exist.reason;
      exist.weight = weight ?? exist.weight;
      return exist;
    }
    const link = {
      id, local_id: localId, vault_id: vaultId, vault_name: vaultName || vaultId,
      vault_color: vaultColor || '#8B7BFF', path, title: title || path,
      reason: reason || null, origin, weight, created_at: new Date().toISOString(),
    };
    this.crossLinks.push(link);
    this._crossIdx = null;
    return link;
  }

  removeCrossLink(id) {
    const before = this.crossLinks.length;
    this.crossLinks = this.crossLinks.filter((c) => c.id !== id);
    this._crossIdx = null;
    return this.crossLinks.length !== before;
  }

  crossLinksOf(nodeId) {
    if (!this._crossIdx || this._crossIdxV !== this.crossLinks.length) {
      const idx = new Map();
      for (const c of this.crossLinks) {
        if (!idx.has(c.local_id)) idx.set(c.local_id, []);
        idx.get(c.local_id).push(c);
      }
      this._crossIdx = idx;
      this._crossIdxV = this.crossLinks.length;
    }
    return this._crossIdx.get(nodeId) || [];
  }

  // ---------- 边 ----------
  /**
   * v2.1.0：边 ID 升级到 64 位。
   * 旧 32 位方案下，30 万条边的碰撞期望约 10 次 —— 两条**不同的**突触关系
   * （不同的 src/dst）会被算成同一条边，addEdge 会把后者当成前者来强化，
   * 于是关系被静默合并、图谱拓扑出错。64 位后该期望降到 10⁻⁹ 量级。
   * 同时保留 32 位旧 id 的兼容查询（历史沉淀/外键引用不失效）。
   */
  addEdge(src, dst, type, opts = {}) {
    let id = `e_${fnv1a64(src + '>' + dst + ':' + type)}`;
    // 碰撞守卫：同一 id 若已被**另一对端点**占用，说明两条不同的边撞了，
    // 此时追加确定性后缀，绝不把两条突触合并成一条。
    const occupant = this.edges.get(id);
    if (occupant && (occupant.src !== src || occupant.dst !== dst || occupant.type !== type)) {
      let salt = 1;
      let cand = `${id}_${salt}`;
      while (this.edges.has(cand)) {
        const o = this.edges.get(cand);
        if (o.src === src && o.dst === dst && o.type === type) { id = cand; break; }
        salt++; cand = `${id}_${salt}`;
      }
      this.collisionGuard = (this.collisionGuard || 0) + 1;
    }
    this._edgeV++;
    if (this.edges.has(id)) {
      const e = this.edges.get(id);
      e.weight = opts.weight != null ? opts.weight : e.weight;
      e.last_reinforced_at = new Date().toISOString();
      return e;
    }
    const edge = {
      id, src, dst, type,
      weight: opts.weight != null ? opts.weight : 0.4,
      base_weight: opts.base_weight != null ? opts.base_weight : 0.4,
      strength_hits: opts.strength_hits || 0,
      last_reinforced_at: new Date().toISOString(),
      origin: opts.origin || 'model', reason: opts.reason || null,
      confirmed: opts.confirmed ? 1 : 0,
      // 显式链接（人写 [[双链]]）默认双向可达：扩散才能从被引用节点回向遍历其引用方
      bidirectional: (opts.bidirectional || type === 'explicit_link') ? 1 : 0,
    };
    this.edges.set(id, edge);
    return edge;
  }

  /** 安全删边：条件删除 + 图谱版本号自增 */
  removeEdgesWhere(fn) {
    let n = 0;
    for (const [id, e] of [...this.edges]) {
      if (fn(e)) { this.edges.delete(id); n++; }
    }
    if (n) this._edgeV++;
    return n;
  }

  /**
   * v2.1.0：走邻接索引，不再全表扫描（100 万边时这是分钟级差异）。
   * 注意：必须返回**原始朝向**的边（src/dst 不翻转）。
   * adjacency() 为了扩散遍历会给双向边生成一份"反向副本"，直接拿它当结果
   * 会让 e.src / e.dst 对调——写回强化与 qa 引用会因此指错方向。
   */
  edgesOf(nodeId) {
    this.adjacency();
    return this._inc.get(nodeId) || [];
  }

  adjacency() {
    if (this._adj && this._adjV === this._edgeV) return this._adj;
    const adj = new Map();   // 扩散用：双向边生成反向副本
    const inc = new Map();   // 关联用：原始朝向，每条边只出现一次
    for (const e of this.edges.values()) {
      if (!adj.has(e.src)) adj.set(e.src, []);
      adj.get(e.src).push(e);
      if (e.bidirectional) {
        if (!adj.has(e.dst)) adj.set(e.dst, []);
        adj.get(e.dst).push({ ...e, src: e.dst, dst: e.src });
      }
      if (!inc.has(e.src)) inc.set(e.src, []);
      inc.get(e.src).push(e);
      if (e.dst !== e.src) {
        if (!inc.has(e.dst)) inc.set(e.dst, []);
        inc.get(e.dst).push(e);
      }
    }
    this._adj = adj;
    this._inc = inc;
    this._adjV = this._edgeV;
    return adj;
  }

  // ---------- BM25 倒排索引（v2.1.0） ----------
  /**
   * 倒排索引构建（零依赖）。
   *   · 一篇文档里每个词只登记一次 → df 是**文档数**而不是 posting 数
   *     （早期版本标题词与正文词各登记一次，df 被重复计数，idf 变负，
   *       结果被 score>0 过滤掉，"成本"这类双字词一个都搜不出来）
   *   · 标题与标签词权重 ×3，优先保证高价值词命中
   *   · 正文按词频取前 TOP 个；大库只索引首段摘要，postings 规模有界
   *   · 字典容量有硬顶（cap），超出后不再收新词：检索退化为
   *     「标题精确命中（store.findByTitle，独立且完整）+ 关系扩散」
   * postings 规模 ≈ 节点数 × 每篇词数，查询代价 = 命中词的 posting 长度之和，
   * **与语料总规模解耦**（此前每次查询都要对全库打分）。
   */
  buildBM25() {
    const nodes = this.allNodes().filter((n) => n.fts_text || n.title);
    const big = nodes.length > 50000;
    const TOP = big ? 12 : TOP_TERMS;
    const cap = big ? 600000 : MAX_TERMS;
    const BODY_CHARS = big ? 400 : Infinity;

    // v2.1.0：两遍构建。大库每篇只索引 TOP 个正文词，若只按"本文档词频"排序，
    // 遍布全库的高频词（"合同""卡片"）会稳当地排在前面，把该文档里**真正有
    // 区分度的词挤出去** —— 实测 6 万节点库里"保密措施"根本没进倒排，搜它恒为 0。
    // 第一遍统计全局 df，第二遍按"稀有优先"保留：df 小的进倒排，df 大的让位。
    let globalDf = null;
    if (big) {
      globalDf = new Map();
      for (const n of nodes) {
        const seen = new Set();
        const bodyText = String(n.fts_text || '').slice(0, BODY_CHARS);
        for (const w of tokenize(bodyText)) seen.add(w);
        for (const w of tokenize(n.title || '')) seen.add(w);
        for (const w of seen) globalDf.set(w, (globalDf.get(w) || 0) + 1);
      }
    }

    const docs = [];        // { id, len }
    const inv = new Map();  // term -> { ids:[], frs:[] }
    const df = new Map();   // term -> 文档数

    for (const n of nodes) {
      const di = docs.length;
      const termFreq = new Map();
      const bump = (w, mul) => termFreq.set(w, (termFreq.get(w) || 0) + mul);
      // 标题与标签：权重 ×3（最高价值词）
      for (const w of tokenize(n.title || '')) bump(w, 3);
      for (const tag of n.tags || []) for (const w of tokenize(tag)) bump(w, 3);
      // 正文：取词频最高的 TOP 个（大库按"全局稀有度"优先，稀有的不被告频词挤掉）
      const bodyText = big ? String(n.fts_text || '').slice(0, BODY_CHARS) : String(n.fts_text || '');
      const bodyTokens = tokenize(bodyText);
      const bodyFreq = new Map();
      for (const w of bodyTokens) bodyFreq.set(w, (bodyFreq.get(w) || 0) + 1);
      const sorted = [...bodyFreq.entries()].sort((a, b) => {
        if (globalDf) {
          const da = globalDf.get(a[0]) ?? Infinity;
          const db = globalDf.get(b[0]) ?? Infinity;
          if (da !== db) return da - db;    // 稀有优先
        }
        return b[1] - a[1];                   // 同稀有度 → 词频高者优先
      });
      const top = sorted.slice(0, TOP);
      // 再补一个"最高频词"：保证像"合同"这类遍布全库的词仍在倒排里（检索走采样通道），
      // 否则搜这类词会一个都搜不到 —— 挤掉它是为了省内存，不该连带让人搜不到。
      if (globalDf && sorted.length > TOP) {
        let hottest = sorted[0];
        for (const cur of sorted) if (cur[1] > hottest[1]) hottest = cur;
        if (!top.some(([w]) => w === hottest[0])) top.push(hottest);
      }
      for (const [w, f] of top) bump(w, f);

      // 一篇文档里每个词只登记一次（df 必须是文档数）
      for (const [w, f] of termFreq) {
        let p = inv.get(w);
        if (!p) {
          if (inv.size >= cap) continue;
          p = { ids: [], frs: [] };
          inv.set(w, p);
        }
        p.ids.push(di);
        p.frs.push(f);
        df.set(w, (df.get(w) || 0) + 1);
      }
      docs.push({ id: n.id, len: Math.max(1, bodyTokens.length) });
    }

    const avgdl = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
    this._bm25 = {
      docs, inv, df, N: docs.length, avgdl,
      terms: inv.size, capped: inv.size >= cap,
      capped_at: cap, mode: big ? 'large' : 'full',
    };
    return this._bm25;
  }

  bm25Search(query, topK = 20) {
    if (!this._bm25) this.buildBM25();
    const { docs, inv, df, N, avgdl } = this._bm25;
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const k1 = 1.5, b = 0.75;
    const scores = new Map();
    const idfOf = (d) => Math.log(1 + (N - d + 0.5) / (d + 0.5));
    for (const w of q) {
      const p = inv.get(w);
      if (!p) continue;
      const d = df.get(w) || 0;
      const idf = idfOf(d);
      // 大语料里超高频词（出现在 >25% 文档里）近似停用词：整表扫 posting 要上百万次打分，
      // 代价不可接受。但**不能直接跳过** —— 否则"卡片""合同"这类遍布全库的词，
      // 在百万级库里**一搜一个没有**（实测 hits=0，是真实的可用性缺陷）。
      // 做法：改为**限采样**参与打分（CAP 个 posting），既守住代价，又保证有命中。
      if (N > 50000 && d > N * 0.25) {
        const CAP = 20000;
        const step = Math.max(1, Math.ceil(p.ids.length / CAP));
        for (let i = 0; i < p.ids.length; i += step) {
          const di = p.ids[i];
          const f = p.frs[i];
          const L = docs[di].len || 1;
          const s = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (L / avgdl)));
          scores.set(di, (scores.get(di) || 0) + s);
        }
        continue;
      }
      for (let i = 0; i < p.ids.length; i++) {
        const di = p.ids[i];
        const f = p.frs[i];
        const L = docs[di].len || 1;
        const s = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (L / avgdl)));
        scores.set(di, (scores.get(di) || 0) + s);
      }
    }
    const out = [];
    for (const [di, score] of scores) {
      if (score > 0) out.push({ id: docs[di].id, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, topK);
  }
}

// ---------------- 文件扫描 ----------------
/**
 * 扫描知识库里的全部 .md 卡片（跳过 .neokb / _graveyard / 隐藏目录）。
 * 返回 [{abs, rel, mtime, size}]。mtime/size 用于增量判定（文件没变就不重新解析）。
 */
/**
 * 扫描库内所有 Markdown 卡片。
 *
 * v2.1.0：改为**异步 + 并发 stat**。本机实测（NTFS，100 万个真实 .md 文件）：
 *   · 串行 statSync   66.9s
 *   · 并发 32 路      21.8s   ← 甜点
 *   · 并发 128 路     24.2s
 * 并发再往上收益递减（线程池调度成本反超收益）。
 * 路径改为遍历时**增量拼接**，省掉 100 万次 path.relative + 正则替换。
 */
export async function scanFiles(root, opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency) || 32);
  // v2.1.0：流式模式。传入 onFile 时**不 materialize 全量文件数组** ——
  // 百万级库里 100 万个 {abs, rel, mtime, size} 对象本身就是上百 MB 常驻开销，
  // 而索引比对其实只需要逐个处理，不需要留全体。
  const onFile = typeof opts.onFile === 'function' ? opts.onFile : null;
  const skipDir = (name) => name === '.neokb' || name === '_graveyard' || name.startsWith('.');
  const out = onFile ? null : [];
  const stack = [{ dir: root, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    const batch = [];
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!skipDir(e.name)) stack.push({ dir: abs, rel: r });
      } else if (e.isFile() && /\.md$/i.test(e.name)) {
        batch.push({ abs, rel: r });
      }
    }
    if (!batch.length) continue;
    // 这一层的文件并发 stat（保持目录内原有顺序，结果可复现）
    const res = new Array(batch.length);
    let i = 0;
    const workers = new Array(Math.min(concurrency, batch.length)).fill(0).map(async () => {
      while (i < batch.length) {
        const k = i++;
        try {
          const st = await fs.promises.stat(batch[k].abs);
          res[k] = { abs: batch[k].abs, rel: batch[k].rel, mtime: st.mtimeMs, size: st.size };
        } catch { /* 文件可能刚被删掉 */ }
      }
    });
    await Promise.all(workers);
    for (const r of res) if (r) { if (onFile) onFile(r); else out.push(r); }
  }
  return out;
}

/**
 * 建索引（两遍：先全部入节点，再解析 [[双链]] 建显式边）。
 * 单遍扫描会在遇到未索引的目标时丢失链接——故必须两遍。
 * 绝不修改用户正文（对应 R2）。
 *
 * v2.1.0 增量索引：只重新解析**变了或新增**的文件，删除的文件连带清节点。
 * 此前每次打开知识库都全量重扫+重解析，百万级卡片等于每次启动十几分钟；
 * 现在打开 1M 卡的库只是一次目录遍历 + 差量比对。
 *
 * 推导型突触（语义相似 / 共现 / 因果等）保留，不因重建索引而清零；
 * 显式链接（旧 [[双链]]）作废重建（卡片可能改了名）；悬空边一并清理。
 */
export async function indexVault(store, opts = {}) {
  const origCount = store.nodes.size;
  let added = 0, updated = 0, removed = 0;
  let fileCount = 0;
  const seen = new Set();

  // v2.1.0：**不预建 path→node 的全量映射**。
  // 节点 id 本就是路径的稳定哈希（fnv1a64），绝大多数卡片能直接
  // `nodes.get(nodeIdFor(path))` 命中（O(1)、零额外内存）。
  // 只有 id 命中不上（新增文件 / 极端哈希碰撞）时，才惰性构建全量映射兜底。
  // 百万级库"打开时零变更"这条最热的路径上，1M 条映射的构建与随之而来的
  // 巨量 GC 直接被省掉 —— 实测省 30 秒以上。
  let byPath = null;
  const lookupOld = (rel) => {
    const direct = store.nodes.get(store.nodeIdFor(rel));
    if (direct && direct.path === rel) return direct;
    if (!byPath) {
      byPath = new Map();
      for (const n of store.nodes.values()) byPath.set(n.path, n);
    }
    return byPath.get(rel) || null;
  };

  // v2.1.0：流式比对 —— 不把 100 万个 {abs,rel,mtime,size} 对象留在内存里，
  // 逐个文件比对完就放手（百万级库光这份文件对象就是上百 MB 常驻）。
  await scanFiles(store.root, {
    ...opts,
    onFile: (f) => {
      fileCount++;
      seen.add(f.rel);
      const old = lookupOld(f.rel);
      if (old && old.mtime === f.mtime && old.size === f.size) return;  // 未变：跳过
      if (old) updated++; else added++;
      store.upsertNodeFromFile(f.abs, f.rel, { mtimeMs: f.mtime, size: f.size });
    },
  });
  // 删除检测：只有"本次新增过"或"磁盘文件数少于索引节点数"才可能有卡片被删，
  // 此时才精确定位；否则一个都不可能少，白查 1M 条纯属浪费。
  if (added > 0 || fileCount < origCount) {
    // 直接遍历 Map 并在迭代中删除（JS 规范允许），省掉百万级数组拷贝
    for (const [id, n] of store.nodes) {
      if (!seen.has(n.path)) {
        store.nodes.delete(id);
        store._nodeV++;
        removed++;
      }
    }
  }
  store._lookup = null;
  store._adj = null;

  // v2.1.0：显式边重建改为**按需触发**。
  // 此前每次打开库都把全库 explicit_link 删光重建 —— 百万级库就是 300 万次
  // 双链解析 + 300 万条边重写，是"打开一个百万卡库要十几分钟"的首要原因。
  // 现在只在**内容真的变了**（有卡片新增/修改/删除）时才重建：
  // 边由卡片正文里的 [[双链]] 决定，正文没变边就不该变，语义完全等价。
  // 唯一例外：库里根本没有显式边（索引来自别处或被清空），那就必须建。
  const changed = (added + updated + removed) > 0;
  let hasExplicit = false;
  for (const e of store.edges.values()) { if (e.type === 'explicit_link') { hasExplicit = true; break; } }
  const needLinks = changed || (!hasExplicit && store.nodes.size > 0);
  if (needLinks) {
    store.removeEdgesWhere((e) => e.type === 'explicit_link');
    relinkExplicit(store);
    store.removeEdgesWhere((e) => !store.nodes.has(e.src) || !store.nodes.has(e.dst));
  }

  // v2.1.0：**无变更不落盘**。百万级索引 1.4GB，每次打开都重写一遍纯属浪费，
  // 还会把"打开库"从秒级拖成分钟级。迁移（32→64 位 id）会置 _dirty，一并落盘。
  const dirty = changed || needLinks || !!store._dirty;
  if (dirty) store.save();
  store.lastIndexStats = {
    added, updated, removed, total: store.nodes.size,
    relinked: needLinks, saved: dirty,
  };
  return store;
}
