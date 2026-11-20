// 突触推导（内核能力）
// ---------------------------------------------------------------------------
// 问题：把一个已有的 Markdown 知识库（比如 600 张裁判观点卡）直接接进 NeoCosmos 时，
// 里面往往没有 [[双链]] —— 于是网络是空的，星图只是一盘散沙，扩散检索也无从发力。
//
// 解决：推导器在不改动任何正文的前提下，从"结构信号"里长出突触：
//   · semantic_similar  共享非域标签（跨簇的语义亲近）
//   · co_occurrence     同组内共享多个正文术语（总在同一语境出现）
//   · temporal          同组内时间邻近（同一批写下，往往同属一件事）
//   · hierarchical      子目录簇 → 簇内索引卡（真正的层级包含，只在有子目录时建立）
//
// 纪律：只新建带 origin='derived' 的边，永远不动用户正文；同类边不去重覆盖人建的边。
// ---------------------------------------------------------------------------

import { tokenize } from '../storage/store.js';

const dirOf = (rel) => { const i = String(rel || '').lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
const baseName = (rel) => {
  const s = String(rel || '').split('/').pop() || '';
  return s.replace(/\.md$/i, '');
};

function termSet(text, limit = 60) {
  const t = tokenize(String(text || ''));
  const stop = new Set(['的', '了', '和', '与', '在', '是', '有', '为', '对', '中', '本案', '法院', '认定']);
  const out = new Set();
  for (const w of t) {
    if (w.length < 2 || stop.has(w)) continue;
    out.add(w);
    if (out.size >= limit) break;
  }
  return out;
}

/**
 * 推导一轮突触
 * @param {import('../storage/store.js').KbStore} store
 * @param {{capSimilar?:number, capCooccur?:number, capTemporal?:number, maxCompare?:number, minSharedTerms?:number}} opts
 * @returns {{added:Record<string,number>, total:number}}
 */
export function deriveSynapses(store, opts = {}) {
  const capSimilar = opts.capSimilar ?? 3;
  const capCooccur = opts.capCooccur ?? 3;
  const capTemporal = opts.capTemporal ?? 2;
  const maxCompare = opts.maxCompare ?? 80;      // 每组内每个节点最多与多少个候选比较
  const minSharedTerms = opts.minSharedTerms ?? 3;
  const added = { semantic_similar: 0, co_occurrence: 0, temporal: 0, hierarchical: 0 };
  const nodes = store.allNodes().filter((n) => !n.archived);
  if (nodes.length < 2) return { added, total: 0 };

  const degree = new Map();
  for (const e of store.edges.values()) {
    degree.set(e.src, (degree.get(e.src) || 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
  }

  // 已存在的 (src,dst,type) —— 不覆盖人建的边，也不重复计数
  const seen = new Set();
  for (const e of store.edges.values()) seen.add(`${e.src}>${e.dst}:${e.type}`);

  let total = 0;
  const link = (a, b, type, weight, reason) => {
    const key = `${a}>${b}:${type}`;
    if (seen.has(key) || a === b) return false;
    seen.add(key);
    store.addEdge(a, b, type, {
      base_weight: weight, weight, origin: 'derived', reason, bidirectional: 1,
    });
    added[type] = (added[type] || 0) + 1;
    total++;
    return true;
  };

  // ---------- 分组：同目录视为一个"簇候选池" ----------
  const groups = new Map();
  for (const n of nodes) {
    const g = dirOf(n.path) || '__root__';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }

  // ---------- 1) semantic_similar：共享非域标签 ----------
  const tagIndex = new Map();
  for (const n of nodes) for (const t of n.tags || []) {
    if (!tagIndex.has(t)) tagIndex.set(t, []);
    tagIndex.get(t).push(n);
  }
  const tagCap = new Map();
  for (const [tag, list] of tagIndex) {
    if (list.length < 2 || list.length > 120) continue; // 过大标签无区分度
    for (let i = 0; i < list.length; i++) {
      if ((tagCap.get(list[i].id) || 0) >= capSimilar) continue;
      for (let j = i + 1; j < list.length; j++) {
        if ((tagCap.get(list[i].id) || 0) >= capSimilar) break;
        if ((tagCap.get(list[j].id) || 0) >= capSimilar) continue;
        if (link(list[i].id, list[j].id, 'semantic_similar', 0.5, `共享标签 #${tag}`)) {
          tagCap.set(list[i].id, (tagCap.get(list[i].id) || 0) + 1);
          tagCap.set(list[j].id, (tagCap.get(list[j].id) || 0) + 1);
        }
      }
    }
  }

  // ---------- 2) co_occurrence：同组内共享多个正文术语 ----------
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sets = list.map((n) => termSet(n.fts_text));
    const cap = new Map();
    for (let i = 0; i < list.length; i++) {
      if ((cap.get(list[i].id) || 0) >= capCooccur) continue;
      // 组内规模大时，只与滑动窗口内的候选比较（保证 O(n·K)）
      const step = list.length > maxCompare ? Math.ceil(list.length / maxCompare) : 1;
      for (let s = 1; s <= maxCompare; s++) {
        const j = (i + s * step) % list.length;
        if (j === i) continue;
        if ((cap.get(list[i].id) || 0) >= capCooccur) break;
        if ((cap.get(list[j].id) || 0) >= capCooccur) continue;
        let shared = 0; const words = [];
        for (const w of sets[i]) { if (sets[j].has(w)) { shared++; if (words.length < 3) words.push(w); } }
        if (shared < minSharedTerms) continue;
        if (link(list[i].id, list[j].id, 'co_occurrence', 0.35, `共现术语：${words.join('、')}`)) {
          cap.set(list[i].id, (cap.get(list[i].id) || 0) + 1);
          cap.set(list[j].id, (cap.get(list[j].id) || 0) + 1);
        }
      }
    }
  }

  // ---------- 3) temporal：同组内时间邻近 ----------
  for (const list of groups.values()) {
    const withTime = list.filter((n) => n.mtime).sort((a, b) => a.mtime - b.mtime);
    const cap = new Map();
    for (let i = 0; i + 1 < withTime.length; i++) {
      for (let j = i + 1; j < Math.min(withTime.length, i + 4); j++) {
        if ((cap.get(withTime[i].id) || 0) >= capTemporal) break;
        if ((cap.get(withTime[j].id) || 0) >= capTemporal) continue;
        const gapDays = Math.abs((withTime[j].mtime - withTime[i].mtime) / 86400000);
        if (gapDays > 3) continue;
        if (link(withTime[i].id, withTime[j].id, 'temporal', 0.25, `时间邻近 ${gapDays.toFixed(1)} 天`)) {
          cap.set(withTime[i].id, (cap.get(withTime[i].id) || 0) + 1);
          cap.set(withTime[j].id, (cap.get(withTime[j].id) || 0) + 1);
        }
      }
    }
  }

  // ---------- 4) hierarchical：子目录簇 → 簇内索引卡 ----------
  // 只在确实存在子目录时建立；平铺的卡片库不硬造层级。
  for (const [g, list] of groups) {
    if (g === '__root__' || list.length < 3) continue;
    const dirName = baseName(g);
    const index = list.find((n) => n.title === dirName)
      || list.slice().sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))[0];
    if (!index) continue;
    for (const n of list) {
      if (n.id === index.id) continue;
      link(index.id, n.id, 'hierarchical', 0.7, `层级包含：${dirName}`);
    }
  }

  return { added, total };
}
