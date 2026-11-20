// NeoCosmos 演示：在原型库上跑通"入库 → 激活扩散召回 → 回写沉淀 → 二次命中"闭环
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { KbStore, indexVault } from './storage/store.js';
import { callTool } from './mcp/tools.js';
import { ConsolidationScheduler } from './consolidation/consolidate.js';

export async function run() {
  const vault = path.join(process.cwd(), '.neokb-prototype', 'vault');
  fs.rmSync(vault, { recursive: true, force: true });
  fs.mkdirSync(path.join(vault, '_memory', 'semantic'), { recursive: true });
  fs.mkdirSync(path.join(vault, '_inbox'), { recursive: true });

  const docs = {
    '项目A成本口径.md': `# 项目A成本口径\n项目A采用全口径成本核算，含人力、算力与合规三部分。\n成本 = 人力成本 + 算力成本 + 合规成本。\n相关详见 [[算力成本说明]] 与 [[合规成本说明]]。`,
    '算力成本说明.md': `# 算力成本说明\n算力成本按 GPU 时长计费，是项目A成本口径的重要组成部分。\n参见 [[项目A成本口径]]。`,
    '合规成本说明.md': `# 合规成本说明\n合规成本包含数据出境评估与审计，属于项目A成本口径的第三块。\n参见 [[项目A成本口径]]。`,
    '竞品分析.md': `# 竞品分析\n竞品B采用轻量计费，不含合规成本，与项目A成本口径不同。`,
  };
  for (const [f, c] of Object.entries(docs)) fs.writeFileSync(path.join(vault, f), c, 'utf8');

  const store = new KbStore(vault).load();
  // 两遍建索引（先入节点、再解析双链建边），绝不修改用户正文
  await indexVault(store);
  const ctx = { store, caller: 'ui', canWriteBody: true };

  console.log('=== 1) 首次提问（未沉淀）===');
  const r1 = callTool('kb_ask', { question: '项目A的成本是怎么算的？', mode: 'generate' }, ctx);
  console.log('命中节点:', r1.cited_nodes.map((c) => c.title).join(' / '));
  console.log('是否命中已有沉淀:', r1.hit_existing_sediment ?? '否');

  console.log('\n=== 2) 回写沉淀（闭环）===');
  const wb = callTool('kb_write_back', {
    question: '项目A的成本是怎么算的？',
    answer: '项目A采用全口径成本核算：成本 = 人力成本 + 算力成本 + 合规成本。',
    cited_node_ids: r1.cited_nodes.map((c) => c.id),
    confidence: 0.9, tags: ['成本'],
  }, ctx);
  console.log('沉淀卡片:', wb.node_id, '建边:', wb.built_edges);

  console.log('\n=== 3) 二次提问（应命中沉淀，成本趋零）===');
  const r2 = callTool('kb_ask', { question: '项目A的成本是怎么算的？', mode: 'generate' }, ctx);
  console.log('命中已有沉淀:', r2.hit_existing_sediment ?? '否');
  console.log('直接复用沉淀答案:', r2.answer.slice(0, 40) + '...');

  console.log('\n=== 4) 激活扩散（联想路径）===');
  const s = callTool('kb_search', { query: '项目A 成本', top_k: 4, hops: 2 }, ctx);
  for (const h of s.results) console.log(`- ${h.title} | 置信${h.confidence} | ${h.path_explained}`);

  console.log('\n=== 5) 巩固与健康度 ===');
  const sched = new ConsolidationScheduler(store);
  const { report } = sched.run();
  console.log(JSON.stringify(report, null, 2));

  console.log('\n=== 6) 零侵入校验 ===');
  for (const f of Object.keys(docs)) {
    const after = fs.readFileSync(path.join(vault, f), 'utf8');
    console.log(`原始文件未改动: ${f} -> ${after === docs[f] ? '✓ 一致' : '✗ 被改'}`);
  }
  console.log('\n闭环演示完成。');
}

run();
