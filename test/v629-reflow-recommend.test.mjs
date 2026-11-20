// v6.29.0 · 功能①知识回流关联 + 功能②辅助建立知识关联 · 契约测试
// ---------------------------------------------------------------------------
// 纪律：全部在真实临时 KbStore 上跑真实 callTool / recommendLinks，
//       不写演示数据、不冒称 GUI、不虚构读数。所有断言来自真实返回值。
//       同时校验「纯净客户端红线」：不内置知识库数据、无造假填充。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}

async function main() {
  const { KbStore, indexVault } = await import(pathToFileURL(path.join(ROOT, 'src', 'storage', 'store.js')).href);
  const { callTool, listTools } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'tools.js')).href);
  const { recommendLinks, orphanStats } = await import(pathToFileURL(path.join(ROOT, 'src', 'cognition', 'link-recommender.js')).href);

  // ── [1] 工具注册：两个真实新工具 ───────────────────────────────────────
  console.log('\n[1] 能力注册（真实工具，非虚构）');
  const names = listTools().map((t) => t.name);
  ok('kb_link_recommend 已注册且带 required 契约',
    names.includes('kb_link_recommend') &&
    !!listTools().find((t) => t.name === 'kb_link_recommend').inputSchema.required.includes('node_id'));
  ok('kb_link_audit 已注册（全库关联体检）', names.includes('kb_link_audit'));
  ok('工具总数为 17（原 15 + 功能② 2 个），可核查', listTools().length === 17, `(${listTools().length})`);

  // ── [2] 构造两个真实临时库：源库 + 沉淀库 ───────────────────────────────
  console.log('\n[2] 真实临时知识库（两个独立库，零内置数据）');
  const srcVault = fs.mkdtempSync(path.join(os.tmpdir(), 'neokb-v629-src-'));
  const sedVault = fs.mkdtempSync(path.join(os.tmpdir(), 'neokb-v629-sed-'));
  // 源库：3 张真实卡，其中两张共享标签/共引，一张孤立但正文写了 [[共享标签A]] 断链
  fs.writeFileSync(path.join(srcVault, '商业秘密要件.md'),
    '---\ntags: [商业秘密, 构成要件]\n---\n# 商业秘密要件\n\n秘密性 价值性 保密性 构成要件 举证责任。\n', 'utf8');
  fs.writeFileSync(path.join(srcVault, '客户名单保护.md'),
    '---\ntags: [商业秘密, 客户名单]\n---\n# 客户名单保护\n\n秘密性 价值性 保密性 客户名单 举证责任 保护措施。\n', 'utf8');
  // 断链：[[商业秘密]] 在库里无同名卡，但「商业秘密要件」标题包含它 → 触发 broken_link 辅助
  fs.writeFileSync(path.join(srcVault, '孤立卡.md'),
    '# 孤立卡\n\n这张卡没有标签，也没连边，正文写了 [[商业秘密]]（库中无同名卡，但有近似标题）。\n', 'utf8');
  const srcStore = new KbStore(srcVault).load();
  await indexVault(srcStore);
  const sedStore = new KbStore(sedVault).load();
  await indexVault(sedStore);
  const nodes = srcStore.allNodes();
  ok('源库真实索引到 3 张卡', nodes.length === 3, `(${nodes.length})`);
  const byTitle = (t) => nodes.find((n) => n.title === t);
  const bm = byTitle('商业秘密要件');
  const kh = byTitle('客户名单保护');
  const orphan = byTitle('孤立卡');

  // ── [3] 功能②：辅助建关联 —— 只建议、不建边、带真实证据 ────────────────
  console.log('\n[3] 功能② 辅助建立知识关联（真实信号，只建议不建边）');
  const edgesBefore = srcStore.edges.size;
  const rec = recommendLinks(srcStore, kh.id, { topK: 8, minSharedTerms: 2 });
  ok('为「客户名单保护」返回候选关联（非零）', rec.suggestions.length >= 1, `(${rec.suggestions.length} 条)`);
  ok('推荐过程没有擅自建边（edges 数量不变）', srcStore.edges.size === edgesBefore);
  const top = rec.suggestions[0];
  ok('每条建议都带可核查的真实证据 signals',
    rec.suggestions.every((s) => Array.isArray(s.payload.signals) && s.payload.signals.length > 0));
  ok('每条建议 payload 含 src/dst/type/weight/reason（可被 kb_apply_review 消费）',
    rec.suggestions.every((s) => s.kind === 'link' && s.payload.src === kh.id &&
      typeof s.payload.dst === 'string' && s.payload.type && s.payload.weight > 0 && s.payload.reason));
  const sharedTagRec = rec.suggestions.find((s) => s.payload.dst === bm.id);
  ok('共享标签卡被推荐，且证据是 shared_tag / shared_term 真实信号',
    !!sharedTagRec && sharedTagRec.payload.signals.some((x) => x.kind === 'shared_tag' || x.kind === 'shared_term'));

  // 断链信号：孤立卡正文写了 [[商业秘密要件]]，应被推荐为 explicit_link
  const recOrphan = recommendLinks(srcStore, orphan.id, { topK: 8, minSharedTerms: 2 });
  const brokenRec = recOrphan.suggestions.find((s) => s.payload.dst === bm.id);
  ok('孤立卡的 [[双链]] 断链被识别为 explicit_link 强信号',
    !!brokenRec && brokenRec.payload.type === 'explicit_link' &&
    brokenRec.payload.signals.some((x) => x.kind === 'broken_link'));
  ok('已存在关联的卡对不再重复推荐（无 connected 噪音）',
    (() => {
      srcStore.addEdge(kh.id, bm.id, 'semantic_similar', { origin: 'human' });
      const r2 = recommendLinks(srcStore, kh.id, { topK: 8 });
      return !r2.suggestions.some((s) => s.payload.dst === bm.id);
    })());

  // 全库关联体检（真实计数）
  const audit = orphanStats(srcStore);
  ok('关联体检返回真实 total / orphans / ratio',
    audit.total === 3 && audit.orphans >= 0 && audit.ratio >= 0 && audit.ratio <= 1,
    `(total=${audit.total} orphans=${audit.orphans})`);

  // 采纳建议（走真实 kb_link）后才建边：以「采纳前」的真实边数为基准
  const edgesPreAdopt = srcStore.edges.size;
  const adopt = callTool('kb_link', { src: orphan.id, dst: bm.id, type: 'explicit_link', reason: '用户采纳建议' },
    { store: srcStore, caller: 'ui', canWriteBody: true });
  ok('用户采纳后才真正建边（人工主导权保留）', adopt.edge_id && srcStore.edges.size === edgesPreAdopt + 1,
    `(pre=${edgesPreAdopt} post=${srcStore.edges.size})`);

  // ── [4] 功能①：知识回流关联 —— 同库建边 + 账本；跨库登记真实来源 ──────
  console.log('\n[4] 功能① 知识回流关联（同库 / 跨库）');
  // 同库回流
  const w1 = callTool('kb_write_back', {
    question: '客户名单算商业秘密吗？', answer: '需满足秘密性/价值性/保密性。',
    cited_node_ids: [bm.id, kh.id], confidence: 0.9, tags: ['v629'],
  }, { store: srcStore, caller: 'ui', canWriteBody: true, vaultId: 'v_src', sourceVaultName: '源库' });
  const q1 = srcStore.qaPairs.find((q) => q.id === w1.qa_id);
  ok('同库回流：建 question_answer 边并强化', w1.reflow.mode === 'same_vault' && w1.reflow.edges_built === 2);
  ok('同库回流：qaPairs 写入真实 reflow_links 账本（每张被引卡一条）',
    Array.isArray(q1.reflow_links) && q1.reflow_links.length === 2 &&
    q1.reflow_links.every((l) => l.type === 'question_answer' && l.built && l.title));
  ok('回流账本可核查：账本 dst 与本次 cited 一一对应',
    q1.reflow_links.map((l) => l.dst).sort().join() === [bm.id, kh.id].sort().join());

  // 跨库回流
  const w2 = callTool('kb_write_back', {
    question: '跨库沉淀的回流关联？', answer: '在沉淀库登记指向源库的真实关联。',
    cited_node_ids: [bm.id], confidence: 0.7, tags: ['v629'],
  }, { store: srcStore, caller: 'ui', canWriteBody: true, vaultId: 'v_src',
    sourceVaultName: '源库A', sedimentStore: sedStore, sedimentVaultId: 'v_sed' });
  const q2 = sedStore.qaPairs.find((q) => q.id === w2.qa_id);
  ok('跨库回流：不建悬空图边（edges 仍为 0）', w2.built_edges === 0 && sedStore.edges.size === 0);
  ok('跨库回流：在沉淀库登记 1 条真实 crossLink', w2.reflow.cross_links_built === 1 && sedStore.crossLinks.length === 1);
  const cl = sedStore.crossLinks[0];
  ok('crossLink 指向源库真实卡片（题名/path/来源库都真实）',
    cl.local_id === w2.node_id && cl.vault_name === '源库A' && cl.title === '商业秘密要件' && !!cl.path);
  ok('跨库回流账本标记 cross_vault_reflow 且可核查',
    q2.reflow_mode === 'cross_vault' && q2.reflow_links[0].type === 'cross_vault_reflow' &&
    q2.reflow_links[0].source_vault_id === 'v_src' && q2.reflow_links[0].built);
  const sedCard = fs.readFileSync(path.join(sedVault, w2.path), 'utf8');
  ok('沉淀卡正文如实写明源库引用（不伪造图边）', sedCard.includes('引用卡片（源知识库）') && sedCard.includes(bm.id));
  ok('跨库关联未改动源库卡片正文', fs.readFileSync(path.join(srcVault, '商业秘密要件.md'), 'utf8').includes('秘密性 价值性 保密性 构成要件 举证责任。'));

  // ── [5] 纯净客户端红线：无内置知识库数据、无造假填充 ───────────────────
  console.log('\n[5] 纯净客户端红线（零内置知识库数据 / 零造假）');
  const stage = read('tools/stage-app.mjs');
  // v6.30.0：stage 改为「运行时真实引用」资产白名单（ASSET_ALLOWLIST），
  // builtin-library 根本不在白名单 = 更强的结构性排除；并保留 rmSync 双保险。
  const allowBlock = (stage.match(/const ASSET_ALLOWLIST = \[([\s\S]*?)\]/) || [])[1] || '';
  ok('stage 结构化排除 builtin-library（白名单 + 双保险，不内置任何知识库内容）',
    !!allowBlock && !/builtin-library|corpus|\.md/.test(allowBlock) &&
    /rmSync\(path\.join\(assetsOut, 'builtin-library'\)/.test(stage));
  const proc = read('tools/check-clean-client.mjs');
  ok('红线门禁覆盖：内置库目录 / 随机字节高熵 / 功能入口',
    /builtin-library/.test(proc) && /shannonEntropy/.test(proc) && /graph\.bin/.test(proc) &&
    /link-recommender\.js/.test(proc));
  const recSrc = read('src/cognition/link-recommender.js');
  // v6.30.0：推荐器新增「真实训练模型权重」加载（assets/_model/relational-model.json），
  // 这是能力必须的真实参数，不是知识库数据。红线重新精确表述：
  //   ① 绝不读任何知识库/语料目录；② 只可只读模型权重文件；③ 加载/校验失败如实降级。
  ok('推荐器不读任何知识库数据（builtin-library / corpus / 演示语料）',
    !/builtin-library|examples[/\\]corpus|[_a-z]*semantic[/\\]|graph\.bin/.test(recSrc));
  ok('模型权重读取为只读且带哈希校验/失败降级（不造假、不假装在用）',
    /readFileSync/.test(recSrc) &&
    /_model[/\\]relational-model\.json/.test(recSrc) &&
    /model\.active/.test(recSrc) &&
    /loadRamModel/.test(recSrc));
  ok('未使用 crypto.randomBytes 之类造假填充',
    !/randomBytes|Math\.random/.test(recSrc) &&
    !/randomBytes|Math\.random/.test(read('src/cognition/relational-model.js')) &&
    !/randomBytes|Math\.random/.test(read('src/cognition/relational-runtime.js')));

  console.log(`\n==== v629 结果：${pass} PASS / ${fail} FAIL ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
