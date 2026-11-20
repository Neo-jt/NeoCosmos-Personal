// 记忆巩固（对应 M5 / M6）—— "睡眠"离线任务
// 做实体消歧、补边、合并建议、孤立检测、矛盾检测、权重衰减、MOC 草稿、健康度报告。
// 所有机器生成项只"建议"不自动改人写内容（对应需求："只建议不自动合并"）。

import { decayAll, currentWeight } from '../engine/edges.js';
import { isStaleWorking, layerStats } from '../engine/memory.js';

export class ConsolidationScheduler {
  constructor(store) {
    this.store = store;
  }

  /**
   * 执行一轮巩固，返回本轮产出清单（review_items）。
   */
  run() {
    const produced = [];
    this._disambiguate(produced);
    this._mergeSuggestions(produced);
    this._orphanDetection(produced);
    this._contradictionDetection(produced);
    this._decay(produced);
    const report = this.healthReport();
    return { produced, report };
  }

  // 实体消歧：把相近标题归并到 canonical（仅在内存做别名映射，不改动文件）
  _disambiguate(out) {
    const byTitle = new Map();
    for (const n of this.store.allNodes()) {
      const key = n.title.toLowerCase().replace(/\s+/g, '');
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(n.id);
    }
    for (const [key, ids] of byTitle) {
      if (ids.length > 1) {
        out.push({ kind: 'merge', payload: { canonical: key, ids, action: '建议合并同名词条' } });
      }
    }
  }

  // 近似概念合并建议（标题相似度 > 0.92 仅建议）
  _mergeSuggestions(out) {
    const nodes = this.store.allNodes();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sim = titleSimilarity(nodes[i].title, nodes[j].title);
        if (sim > 0.92) {
          out.push({ kind: 'merge', payload: { a: nodes[i].id, b: nodes[j].id, sim, action: '近似概念合并建议' } });
        }
      }
    }
  }

  // 孤立节点检测：无任一边
  _orphanDetection(out) {
    const connected = new Set();
    for (const e of this.store.edges.values()) { connected.add(e.src); connected.add(e.dst); }
    for (const n of this.store.allNodes()) {
      if (!connected.has(n.id)) {
        out.push({ kind: 'orphan', payload: { id: n.id, title: n.title, action: '建议补关联或归入领域' } });
      }
    }
  }

  // 矛盾检测：同概念下互斥关键词（简单启发式）
  _contradictionDetection(out) {
    const groups = new Map();
    for (const n of this.store.allNodes()) {
      if (n.domain) {
        if (!groups.has(n.domain)) groups.set(n.domain, []);
        groups.get(n.domain).push(n);
      }
    }
    const OPP = [['支持', '反对'], ['成立', '不成立'], ['有效', '无效'], ['应当', '不应当']];
    for (const [, list] of groups) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const ta = (list[i].fts_text || '').slice(0, 200);
          const tb = (list[j].fts_text || '').slice(0, 200);
          for (const [x, y] of OPP) {
            if ((ta.includes(x) && tb.includes(y)) || (ta.includes(y) && tb.includes(x))) {
              out.push({ kind: 'conflict', payload: { a: list[i].id, b: list[j].id, pair: [x, y], action: '同领域互斥陈述，建议复核' } });
            }
          }
        }
      }
    }
  }

  _decay(out) {
    const before = [...this.store.edges.values()].reduce((s, e) => s + e.weight, 0);
    decayAll(this.store.edges.values());
    const after = [...this.store.edges.values()].reduce((s, e) => s + e.weight, 0);
    out.push({ kind: 'decay', payload: { before: Number(before.toFixed(2)), after: Number(after.toFixed(2)) } });
  }

  healthReport() {
    const nodes = this.store.allNodes();
    const edges = [...this.store.edges.values()];
    const degree = new Map();
    for (const e of edges) {
      degree.set(e.src, (degree.get(e.src) || 0) + 1);
      degree.set(e.dst, (degree.get(e.dst) || 0) + 1);
    }
    const orphans = nodes.filter((n) => !(degree.get(n.id) > 0)).length;
    const avgDegree = edges.length ? (2 * edges.length / nodes.length) : 0;
    const aging = edges.map((e) => currentWeight(e)).sort((a, b) => a - b);
    return {
      nodes: nodes.length,
      edges: edges.length,
      avg_degree: Number(avgDegree.toFixed(2)),
      orphan_rate: nodes.length ? Number((orphans / nodes.length).toFixed(3)) : 0,
      layer_stats: layerStats(nodes),
      weight_min: aging[0] || 0,
      weight_max: aging[aging.length - 1] || 0,
    };
  }
}

function titleSimilarity(a, b) {
  const sa = new Set((a || '').toLowerCase().split(/\s+/).filter(Boolean));
  const sb = new Set((b || '').toLowerCase().split(/\s+/).filter(Boolean));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const uni = new Set([...sa, ...sb]).size;
  return uni ? inter / uni : 0;
}
