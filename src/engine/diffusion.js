// 激活扩散检索（对应 M3）—— 联想而非查字典
// 输出带 activation_path（A→B→C 推理链）+ 置信度，这是与"朴素向量 RAG"的分水岭。

import { currentWeight } from './edges.js';

const BETA = 0.6;          // 阻尼
const MAX_HOPS = 3;        // 最大跳数
const THRESHOLD = 0.08;    // 激活阈值
const RRF_K = 60;          // RRF 常数

/**
 * 激活扩散主入口。
 * @param {object} store KbStore 实例
 * @param {string} query 查询词
 * @param {object} opts { topK, hops, seedExtra, semanticSeeds }
 *   seedExtra: 额外的种子节点 id 列表（例如从标签命中得到）
 *   semanticSeeds: v6.32.0 NeoLM 真实向量召回的种子，可为 id 字符串或
 *                  {id, sim, lift, strength} 对象。它们只作为扩散「起点」，路径仍必须
 *                  走真实图边；初始激活按「相对显著性强度」落在 [0.4,0.8]，
 *                  低于 BM25 字面命中的 1.0，保证语义召回不压过真实字面证据。
 * @returns {Array} 排序结果 [{id, score, activation_path, confidence}]
 */
export function activate(store, query, opts = {}) {
  const topK = opts.topK || 8;
  const hops = opts.hops || MAX_HOPS;
  const adj = store.adjacency();

  // 1) 种子召回：BM25 + 可选向量种子 + 语义种子
  const seedRank = store.bm25Search(query, 20);
  const seedIds = new Set(seedRank.map((r) => r.id));
  for (const id of (opts.seedExtra || [])) seedIds.add(id);
  const semanticScores = new Map();
  for (const s of (opts.semanticSeeds || [])) {
    const id = typeof s === 'string' ? s : s?.id;
    if (!id) continue;
    // v6.32.0：优先用「均值中心化后的相对显著性强度」，没有则回落到原始 cosine
    const raw = typeof s === 'object'
      ? (Number.isFinite(s.strength) ? s.strength : (Number.isFinite(s.sim) ? s.sim : 0.5))
      : 0.5;
    semanticScores.set(id, Math.max(0, Math.min(1, raw)));
    seedIds.add(id);
  }

  // 2) 扩散：从种子出发，按边权重传播激活值
  const activation = new Map();      // nodeId -> 激活值
  const pathTo = new Map();          // nodeId -> 到达路径数组
  for (const id of seedIds) {
    // 语义种子带真实 cosine 的保守初值；BM25 字面命中仍为 1.0
    const sem = semanticScores.get(id);
    activation.set(id, sem === undefined ? 1.0 : 0.4 + 0.4 * sem);
    pathTo.set(id, [id]);
  }

  let frontier = [...seedIds];
  for (let d = 1; d <= hops; d++) {
    const next = new Map();
    for (const u of frontier) {
      const aU = activation.get(u) || 0;
      if (aU < THRESHOLD) continue;
      const outs = adj.get(u) || [];
      for (const e of outs) {
        const w = currentWeight(e);
        const contrib = aU * w * BETA ** d;
        if (contrib < THRESHOLD) continue;
        const prev = activation.get(e.dst) || 0;
        if (contrib > prev) {
          activation.set(e.dst, contrib);
          pathTo.set(e.dst, [...(pathTo.get(u) || [u]), e.dst]);
        }
        next.set(e.dst, true);
      }
    }
    frontier = [...next.keys()];
    if (!frontier.length) break;
  }

  // 3) 融合：RRF —— 把 BM25 排名与扩散激活排名融合
  const diffusionRank = [...activation.entries()]
    .filter(([id]) => !seedIds.has(id) || activation.get(id) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const rrf = new Map();
  const addRank = (ids, list) => {
    ids.forEach((id, rank) => {
      rrf.set(id, (rrf.get(id) || 0) + 1 / (RRF_K + rank + 1));
    });
  };
  addRank(seedRank.map((r) => r.id), seedRank);
  addRank(diffusionRank, diffusionRank);

  // 4) 组装结果：带 activation_path + 置信度
  const results = [...rrf.entries()]
    .map(([id, score]) => {
      const a = activation.get(id) || 0;
      const path = pathTo.get(id) || [id];
      const confidence = Math.min(1, 0.5 * score + 0.5 * a);
      return {
        id,
        score: Number(score.toFixed(4)),
        activation: Number(a.toFixed(4)),
        activation_path: path,
        path_explained: path.length > 1 ? `因 ${path.join(' → ')} 联想至此`
          : semanticScores.has(id) ? '语义种子命中（NeoLM 真实向量，非字面匹配）' : '种子直接命中',
        // v6.32.0：语义种子来源如实标注，分数单列，绝不冒充 BM25 字面命中
        semantic_seed: semanticScores.has(id),
        semantic_sim: semanticScores.has(id) ? Number(semanticScores.get(id).toFixed(5)) : null,
        confidence: Number(confidence.toFixed(3)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results;
}

/**
 * 端到端问答召回：返回命中节点 + 引用路径，供外部 Agent 生成答案或命中沉淀。
 */
export function retrieveForAsk(store, question, opts = {}) {
  const hits = activate(store, question, opts);
  const nodes = hits.map((h) => {
    const n = store.getNode(h.id);
    return n ? { ...h, node: n } : null;
  }).filter(Boolean);
  return nodes;
}
