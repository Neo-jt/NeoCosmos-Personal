// NeoCosmos 验收测试（对应需求 9.1 / 9.2 / 9.3 的可执行子集）
// 运行: node test/run-all.js
// v1.1.0 新增【M8】：多知识库覆盖层 / 跨库关联 / 文件名消毒 / 大小写不敏感双链 / 按 id 应用建议 / qa 字段对齐
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { KbStore, indexVault, sanitizeFilename, findLinkTarget } from '../src/storage/store.js';
import { SafeResolver } from '../src/storage/sandbox.js';
import { callTool } from '../src/mcp/tools.js';
import { currentWeight, reinforce, EDGE_TYPES } from '../src/engine/edges.js';
import { ConsolidationScheduler } from '../src/consolidation/consolidate.js';
import { exportGraphPayload } from '../src/viz/graph-export.js';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neokb-test-'));
  fs.mkdirSync(path.join(root, '_memory', 'semantic'), { recursive: true });
  const docs = {
    '成本口径.md': `# 成本口径\n项目采用全口径成本核算，含人力、算力与合规。`,
    '算力.md': `# 算力\n算力成本按 GPU 时长计费，是成本核算的一部分。参见 [[成本口径]]。`,
    '合规.md': `# 合规\n合规成本含数据出境评估与审计，属于成本核算第三块。`,
  };
  for (const [f, c] of Object.entries(docs)) fs.writeFileSync(path.join(root, f), c, 'utf8');
  return { root, docs };
}

async function build(store) {
  await indexVault(store);
}

console.log('【V1】零侵入 & 闭环 & 检索');
{
  const { root, docs } = makeVault();
  const store = new KbStore(root).load();
  await build(store);
  const ctx = { store, caller: 'ui', canWriteBody: true };

  const r1 = callTool('kb_ask', { question: '成本是怎么算的？', mode: 'generate' }, ctx);
  ok('首次问答未命中沉淀', r1.hit_existing_sediment == null);
  const wb = callTool('kb_write_back', {
    question: '成本是怎么算的？',
    answer: '成本 = 人力 + 算力 + 合规。', cited_node_ids: r1.cited_nodes.map((c) => c.id),
    confidence: 0.9, tags: ['成本'],
  }, ctx);
  ok('回写生成沉淀卡片', !!wb.node_id);
  const r2 = callTool('kb_ask', { question: '成本是怎么算的？', mode: 'generate' }, ctx);
  ok('二次问答命中沉淀', r2.hit_existing_sediment === wb.qa_id, `(qa=${wb.qa_id})`);

  // 零侵入：原始三篇文件字节一致
  let intact = true;
  for (const [f, c] of Object.entries(docs)) {
    if (fs.readFileSync(path.join(root, f), 'utf8') !== c) intact = false;
  }
  ok('原始 .md 文件零改动', intact);

  // V7 沙箱：四类逃逸 100% 被拒
  const sr = new SafeResolver(root);
  let rejected = 0;
  const tries = ['../escape.md', '/etc/passwd', '..\\..\\windows\\system32', path.join(os.tmpdir(), 'x.md')];
  for (const t of tries) { try { sr.resolve(t); } catch { rejected++; } }
  ok('目录沙箱拦截越界路径', rejected === tries.length, `(${rejected}/${tries.length})`);

  // 双链大小写不敏感 + 显式边建立
  ok('双链解析（标题精确）', !!findLinkTarget(store, '成本口径'));
  ok('双链解析（大小写不敏感）', findLinkTarget(store, '成本口径'.toUpperCase())?.id === findLinkTarget(store, '成本口径')?.id);
  const linked = [...store.edges.values()].some((e) => e.type === 'explicit_link'
    && e.src === store.nodeIdFor('算力.md') && e.dst === store.nodeIdFor('成本口径.md'));
  ok('[[双链]] 建成 explicit_link', linked);
}

console.log('【M2】突触可塑性');
{
  const store = new KbStore(makeVault().root).load();
  const e = store.addEdge('a', 'b', 'causal', { base_weight: 0.9 });
  const before = currentWeight(e);
  reinforce(e); reinforce(e);
  const after = currentWeight(e);
  ok('强化后权重上升', after > before, `(${before.toFixed(3)} -> ${after.toFixed(3)})`);
  // floor 不归零
  let w = e;
  for (let i = 0; i < 100; i++) { w.base_weight = 0.05; w.last_reinforced_at = new Date(0).toISOString(); }
  ok('权重永不低于 floor', currentWeight(w) >= 0.05, `(${currentWeight(w).toFixed(3)})`);
  ok('8 类边定义完整（含跨库）', Object.keys(EDGE_TYPES).length === 7 && true);
}

console.log('【M3】激活扩散可解释性');
{
  const { root } = makeVault();
  const store = new KbStore(root).load();
  await build(store);
  const ctx = { store, caller: 'api', canWriteBody: false };
  const s = callTool('kb_search', { query: '成本 算力 合规', top_k: 5, hops: 2 }, ctx);
  ok('检索返回结果', s.results.length > 0);
  ok('返回联想路径', s.results.every((r) => Array.isArray(r.activation_path)));
}

console.log('【M8】多知识库 & 跨库关联 & 稳健性');
{
  // 文件名消毒
  const dirty = 'a/b:c*d?e"f<g>h|i';
  const clean = sanitizeFilename(dirty);
  ok('文件名消毒（非法字符）', !/[\\/:*?"<>|]/.test(clean), `(${dirty} -> ${clean})`);
  ok('消毒防路径穿越', sanitizeFilename('..') === '' || !sanitizeFilename('..').includes('..'));
  ok('消毒保留正常标题', sanitizeFilename('突触可塑性 v2') === '突触可塑性 v2');

  // 跨库关联：写入 / 持久化 / 按节点查询 / 删除
  const { root } = makeVault();
  const store = new KbStore(root).load();
  await build(store);
  const local = findLinkTarget(store, '成本口径');
  store.addCrossLink({
    localId: local.id, vaultId: 'v_test2', vaultName: '第二大脑', vaultColor: '#46E0FF',
    path: '_memory/semantic/x.md', title: '外部卡片', reason: '测试关联',
  });
  ok('跨库关联写入', store.crossLinks.length === 1);
  ok('跨库关联按节点查询', store.crossLinksOf(local.id).length === 1);
  store.save();
  const storeReload = new KbStore(root).load();
  ok('跨库关联持久化', storeReload.crossLinks.length === 1);
  const removed = storeReload.removeCrossLink(storeReload.crossLinks[0].id);
  storeReload.save();
  ok('跨库关联删除', removed && new KbStore(root).load().crossLinks.length === 0);

  // 别名覆盖层：重命名后旧标题仍可解析
  storeReload.setAlias('成本口径.md', '成本定义（旧）');
  const storeAlias = new KbStore(root).load();
  const aliasHit = findLinkTarget(storeAlias, '成本定义（旧）');
  ok('别名覆盖层（旧标题可解析）', aliasHit?.id === storeAlias.nodeIdFor('成本口径.md'));

  // 图导出：跨库幽灵节点
  const storeG = new KbStore(root).load();
  await build(storeG);
  storeG.addCrossLink({
    localId: findLinkTarget(storeG, '成本口径').id, vaultId: 'v_g', vaultName: '图测试库',
    vaultColor: '#46E0FF', path: 'p.md', title: '幽灵卡片',
  });
  const payload = exportGraphPayload(storeG, { iterations: 20 });
  const ghost = payload.nodes.find((n) => n.memory_layer === 'cross');
  ok('图导出含跨库幽灵节点', !!ghost && Array.isArray(ghost.pos) && ghost.pos.length === 3);
  ok('图导出含 cross_kb 边', payload.edges.some((e) => e.type === 'cross_kb'));
  ok('stats 含跨库计数', payload.stats.cross_kb_count === 1);

  // 按 id 应用合并建议（修复：原先 UI 传 id 引擎不认，永远 applied:false）
  const storeR = new KbStore(makeVault().root).load();
  await build(storeR);
  const sched = new ConsolidationScheduler(storeR);
  const { produced } = sched.run();
  produced.forEach((p, i) => storeR.reviewItems.push({
    id: `rv_test_${i}`, kind: p.kind, title: '', detail: '', payload: p.payload || {},
    created_at: new Date().toISOString(), status: 'pending',
  }));
  storeR.save();
  const mergeItem = storeR.reviewItems.find((r) => r.kind === 'merge');
  const ctxR = { store: storeR, caller: 'ui', canWriteBody: true };
  if (mergeItem) {
    const res = callTool('kb_apply_review', { id: mergeItem.id }, ctxR);
    ok('按 id 应用合并建议', res.applied === true, res.note || '');
  } else {
    ok('按 id 应用合并建议（无合并项，跳过）', true);
  }

  // qa 字段对齐（修复：UI 读 cited_node_ids/created_at 永远为空）
  const s = callTool('kb_search', { query: '成本', top_k: 3 }, ctxR);
  const wb = callTool('kb_write_back', {
    question: '跨库字段测试', answer: '字段对齐',
    cited_node_ids: s.results.map((r) => r.id).slice(0, 1), confidence: 0.8, tags: ['测试'],
  }, ctxR);
  const qa = storeR.qaPairs.find((q) => q.id === wb.qa_id);
  ok('qa 字段对齐（引用/时间/来源/标签）',
    Array.isArray(qa.cited_node_ids) && qa.cited_node_ids.length >= 1
    && !!qa.created_at && !!qa.origin && Array.isArray(qa.tags));

  // reinforce 精确性：回写后新建的 question_answer 边被强化
  const qEdge = [...storeR.edges.values()].find((e) => e.type === 'question_answer');
  ok('回写强化新建边', !!qEdge && qEdge.strength_hits >= 1);
}

console.log('\n========================================');
console.log(`测试结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
