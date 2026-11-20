// 三层记忆分区（对应 M4）
// 工作记忆 _inbox / 情景记忆 _memory/episodic / 语义记忆 _memory/semantic

import path from 'node:path';

export const MEMORY_LAYERS = {
  working:   { dir: '_inbox',          label: '工作记忆', priority: 1 },
  episodic:  { dir: '_memory/episodic', label: '情景记忆', priority: 2 },
  semantic:  { dir: '_memory/semantic', label: '语义记忆', priority: 3 },
};

export function classifyLayer(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.includes('_memory/semantic')) return 'semantic';
  if (p.includes('_memory/episodic')) return 'episodic';
  if (p.includes('_inbox')) return 'working';
  return 'semantic'; // 默认正文视为可沉淀语义层
}

/**
 * 工作记忆老化：超过 maxAgeDays 未动则降级/提醒清理。
 */
export function workingStaleThreshold() {
  return 7 * 86400000;
}

export function isStaleWorking(node, now = Date.now()) {
  if (node.memory_layer !== 'working') return false;
  return (now - (node.mtime || now)) > workingStaleThreshold();
}

/**
 * 记忆分层健康度：统计各层规模。
 */
export function layerStats(nodes) {
  const stats = { working: 0, episodic: 0, semantic: 0 };
  for (const n of nodes) stats[n.memory_layer] = (stats[n.memory_layer] || 0) + 1;
  return stats;
}
