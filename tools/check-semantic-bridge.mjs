// v6.32.0 语义回流层真实性门禁（构建期强制，失败即中止）
// ---------------------------------------------------------------------------
// 校验的不是"代码里有没有 import 模型"，而是：
//   1. 逐卡向量与现场用真实权重重算的结果一致（不是缓存假值 / 不是随机数）；
//   2. 正文变化会被 textHash 捕获并触发真实重算，模型指纹变化会让旧索引失效；
//   3. 语义种子是均值中心化后的相对显著性，且无关查询确实得不到显著种子；
//   4. 沉淀回写产生真实语义分数与候选，但绝不自动建边（建边权仍在人手）；
//   5. 库桥候选只给建议，函数自身绝不写 crossLinks；
//   6. UI → preload → IPC → 引擎 全链路真实接线，源码 / staged 双侧核对。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const MODEL_DIR = path.resolve(arg('--dir', path.join(ROOT, 'desktop', 'assets', '_model', 'neolm')));
const STAGED = arg('--staged', null);
const read = (rel, base = ROOT) => fs.readFileSync(path.join(base, rel), 'utf8');
let pass = 0, fail = 0;
function check(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` · ${detail}` : ''}`); }
  else { fail++; console.error(`  ✗ ${label}${detail ? ` · ${detail}` : ''}`); }
}
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

console.log('\n[语义回流层真实性门禁] v6.32.0');
check(fs.existsSync(path.join(MODEL_DIR, 'neolm.manifest.json')), '模型产物目录存在', MODEL_DIR);

// ---------- A. 源码 / staged 全链路接线 ----------
const mainSrc = read('desktop/main.js');
const preloadSrc = read('desktop/preload.js');
const viewSrc = read('desktop/ui/views/semantic-bridge.js');
const toolsSrc = read('src/mcp/tools.js');
const diffusionSrc = read('src/engine/diffusion.js');
const CHANNELS = ['semantic:status', 'semantic:reindex', 'semantic:search',
  'semantic:suggestions', 'semantic:apply-suggestion', 'semantic:vaults',
  'semantic:bridges', 'semantic:apply-bridge'];
for (const ch of CHANNELS) {
  check(mainSrc.includes(`ipcMain.handle('${ch}'`), `主进程注册 IPC ${ch}`);
}
check(CHANNELS.length === 8, '语义通道清单完整', `${CHANNELS.length} 个`);
for (const m of ['status', 'reindex', 'search', 'suggestions', 'applySuggestion', 'vaults', 'bridges', 'applyBridge']) {
  check(preloadSrc.includes(`${m}: (`), `preload 暴露 api.semantic.${m}`);
  check(viewSrc.includes(`api.semantic.${m}(`), `视图真实调用 api.semantic.${m}`);
}
check(toolsSrc.includes("resolveSemantic") && toolsSrc.includes('semanticSeeds'), 'MCP 工具层接入语义索引');
check(diffusionSrc.includes('semanticSeeds') && diffusionSrc.includes('semantic_seed'), '激活扩散接入语义种子并如实标注');
check(read('desktop/ui/app.js').includes("views/semantic-bridge.js"), '路由注册语义关联视图');
// v6.35.0：语义关联从主导航移入「设置 → 能力与服务」，功能与视图容器仍在。
// 断言随之升级为「视图容器 + 设置页入口 + 路由注册」三者齐备（强于旧的单一导航按钮）。
check(read('desktop/ui/index.html').includes('id="viewSemantic"')
  && read('desktop/ui/views/settings.js').includes("key: 'semantic'")
  && read('desktop/ui/app.js').includes('semantic: { loader:'),
  '视图容器 + 设置页入口 + 路由注册齐备');
if (STAGED) {
  check(fs.existsSync(path.join(STAGED, 'src', 'cognition', 'semantic-bridge.js')), 'staged 含语义桥内核');
  check(fs.existsSync(path.join(STAGED, 'ui', 'views', 'semantic-bridge.js')), 'staged 含语义关联视图');
  check(fs.readFileSync(path.join(STAGED, 'main.js'), 'utf8').includes("'semantic:bridges'"), 'staged 主进程含库桥 IPC');
}

// ---------- B. 真实模型 + 真实向量索引 ----------
const { KbStore, indexVault } = await import(pathToFileURL(path.join(ROOT, 'src', 'storage', 'store.js')).href);
const { createNeoLM } = await import(pathToFileURL(path.join(ROOT, 'src', 'cognition', 'neolm', 'runtime.js')).href);
const S = await import(pathToFileURL(path.join(ROOT, 'src', 'cognition', 'semantic-bridge.js')).href);
const { callTool } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'tools.js')).href);

const lm = createNeoLM({ dir: MODEL_DIR });
check(lm.active, '真实训练权重加载成功', lm.active ? `${lm.status().weightGiB} GiB` : lm.reason);
if (!lm.active) { console.error('\n✗ 门禁失败：模型不可用，无法验证语义链路'); process.exit(1); }

function makeVault(prefix, cards) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `neosb-${prefix}-`));
  const dir = path.join(root, '_memory', 'semantic');
  fs.mkdirSync(dir, { recursive: true });
  cards.forEach(([title, body], i) => {
    fs.writeFileSync(path.join(dir, `card-${i}.md`),
      `---\ntags: [语义]\n---\n# ${title}\n\n${body}\n`, 'utf8');
  });
  return root;
}
const A = makeVault('a', [
  ['知识关联', '知识卡片之间建立双链与突触，形成可联想的网络，关联推荐依赖共享标签。'],
  ['语义检索', '用向量余弦召回字面不同但含义接近的条目，作为激活扩散的起点。'],
  ['沉淀回写', '每轮问答把结论追加写入记忆库，并与被引用的卡片建立问答沉淀关系。'],
]);
const B = makeVault('b', [
  ['记忆巩固', '离线巩固任务会检测孤立卡片并补建关联，保持记忆网络可联想。'],
  ['跨库突触', '跨知识库的关联以覆盖层记录，不改动任何用户正文。'],
]);
const storeA = new KbStore(A).load(); await indexVault(storeA);
const storeB = new KbStore(B).load(); await indexVault(storeB);

const ixA = S.createSemanticIndex({ store: storeA, neolm: lm });
const sync = ixA.sync({ force: true });
check(ixA.active && sync.count === storeA.nodes.size, '逐卡真实向量计算', `${sync.count} 张`);
check(sync.failed === 0, '全部卡片成功映射词表', `失败 ${sync.failed}`);

// 反造假核心：拿现场重算的向量与索引里的向量逐个比对
let worst = 1;
for (const [id, v] of ixA.vectors) {
  const n = storeA.getNode(id);
  const live = lm.vector(S.cardText(n));
  const c = S.cosine(v, live);
  if (c !== null && c < worst) worst = c;
}
check(worst > 0.99999, '索引向量与真实权重现场重算一致（非缓存假值）', `最小 cosine ${worst.toFixed(6)}`);

// 文本哈希失效：改正文 → 同一 id 的 textHash 必须变化，sync 必须真实重算
const firstId = [...ixA.vectors.keys()][0];
const beforeHash = ixA.hashes.get(firstId);
const n0 = storeA.getNode(firstId);
n0.fts_text = n0.fts_text + ' 这是一段新增的正文，用于验证文本哈希失效后必须重算向量。';
const afterHash = S.cardTextHash(n0);
check(beforeHash !== afterHash, '正文变化被 textHash 真实捕获');
const sync2 = ixA.sync();
check(sync2.updated >= 1, '失效卡触发真实重算', `updated=${sync2.updated}`);
// 复原，避免影响后续检索证据
n0.fts_text = n0.fts_text.replace(' 这是一段新增的正文，用于验证文本哈希失效后必须重算向量。', '');
ixA.sync();

// 模型指纹：由 manifest 真实字段推导，且与权重哈希账本自洽
const fp = S.modelFingerprint(lm);
check(typeof fp === 'string' && fp.length === 64, '模型指纹来自真实 manifest', fp.slice(0, 16) + '…');
const ixFile = path.join(A, '.neokb', 'index', 'semantic.json');
const saved = ixA.save();
check(saved.ok && fs.existsSync(ixFile), '语义索引真实落盘', `${saved.count} 条 / ${saved.bytes} 字节`);
const disk = JSON.parse(fs.readFileSync(ixFile, 'utf8'));
check(disk.modelId === fp && disk.count === saved.count, '落盘索引带真实模型指纹与计数');
const ixReload = S.createSemanticIndex({ store: storeA, neolm: lm });
check(ixReload.vectors.size === saved.count, '指纹一致时复用磁盘向量', `${ixReload.vectors.size} 条`);

// ---------- C. 语义种子：相对显著性而非绝对 cosine ----------
const relevant = S.semanticSeeds(ixA, '联想网络与向量召回', { topK: 3, withEvidence: false });
const noise = S.semanticSeeds(ixA, '完全无关的句子 xyzq', { topK: 3, withEvidence: false });
check(relevant.active && relevant.seeds.length > 0, '相关查询产出真实语义种子', `${relevant.seeds.length} 个`);
check(relevant.seeds.every((s) => s.lift > 0 && s.strength >= 0 && s.strength <= 1),
  '每个种子都带 lift 与归一化 strength');
check(typeof relevant.baseline === 'number' && relevant.compared === ixA.vectors.size,
  '共同基线如实参与计算', `baseline ${relevant.baseline}`);
const topRelevant = relevant.seeds[0]?.lift ?? 0;
const topNoise = noise.seeds[0]?.lift ?? 0;
check(topRelevant > topNoise, '无关查询的显著性低于相关查询',
  `${topRelevant.toFixed(5)} > ${topNoise.toFixed(5)}`);
check(relevant.method.includes('均值中心化'), '方法名如实标注中心化，不冒充绝对相似度');

// 语义种子进入激活扩散，且如实标注来源
const { activate } = await import(pathToFileURL(path.join(ROOT, 'src', 'engine', 'diffusion.js')).href);
const hits = activate(storeA, '联想网络与向量召回', { topK: 8, semanticSeeds: relevant.seeds });
check(Array.isArray(hits) && hits.length > 0, '语义种子驱动真实激活扩散', `${hits.length} 个结果`);
check(hits.every((h) => typeof h.semantic_seed === 'boolean'), '扩散结果如实标注语义来源');

// ---------- D. 沉淀回写：真实分数 + 候选，但绝不自动建边 ----------
const ctx = { store: storeA, caller: 'ui', canWriteBody: true, vaultId: 'vA', neolm: lm };
const ask = callTool('kb_ask', { question: '知识卡片如何互相连接' }, ctx);
check(Array.isArray(ask.retrieved_node_ids) && ask.semantic && 'active' in ask.semantic,
  '调取返回真实 id 与语义状态', `${ask.retrieved_node_ids?.length} 个 id`);
const edgesBefore = storeA.edges.size;
const wb = callTool('kb_write_back', {
  question: '知识卡片如何互相连接', answer: '通过双链与语义关联建立连接',
  cited_node_ids: [], retrieved_node_ids: ask.retrieved_node_ids,
}, ctx);
check(wb.semantic?.active === true && wb.semantic.indexed === true, '沉淀卡真实入语义索引');
check(Array.isArray(wb.semantic?.suggestions), '产出「沉淀 ↔ 调取」候选', `${wb.semantic?.suggestions?.length} 条`);
check((wb.semantic?.suggestions || []).every((s) => s.requiresHumanConfirm === true && s.built === false),
  '每条候选都标记待人工确认且未建边');
check(storeA.edges.size === edgesBefore, '模型没有擅自建立任何关系边', `edges ${edgesBefore} → ${storeA.edges.size}`);
const qa = storeA.qaPairs.at(-1);
check(!!qa?.semantic?.suggestions, '候选写入真实沉淀账本');
check((wb.semantic?.suggestions || []).every((s) => Number.isFinite(s.sim) && s.sim > 0),
  '候选分数是真实数值而非占位');

// 真实引用时，回流边带可复核的语义分数
const citedId = ask.retrieved_node_ids[0] || [...storeA.nodes.keys()][0];
const edgesBefore2 = storeA.edges.size;
const wb2 = callTool('kb_write_back', {
  question: '另一轮关于知识关联的问答', answer: '引用了知识关联卡片',
  cited_node_ids: [citedId], retrieved_node_ids: [],
}, ctx);
check(wb2.built_edges >= 1, '真实引用照常建立回流边', `+${wb2.built_edges}`);
check(storeA.edges.size > edgesBefore2, '回流边真实入库');
const refEdge = [...storeA.edges.values()].find((e) => e.src === wb2.node_id && e.dst === citedId);
check(!!refEdge && Number.isFinite(refEdge?.semantic_sim), '回流边带真实 NeoLM cosine',
  `sim=${refEdge?.semantic_sim}`);
const direct = S.cosine(lm.vector(S.cardText(storeA.getNode(wb2.node_id))),
  lm.vector(S.cardText(storeA.getNode(citedId))));
check(Math.abs(Number(refEdge?.semantic_sim) - direct) < 0.001,
  '边上的语义分数与现场重算一致（未伪造）', `${refEdge?.semantic_sim} vs ${direct?.toFixed(5)}`);

// ---------- E. 库桥：只读建议，绝不写跨库关联 ----------
const ixB = S.createSemanticIndex({ store: storeB, neolm: lm });
ixB.sync({ force: true });
const crossBefore = storeA.crossLinks.length;
const bridges = S.bridgeCandidates({
  a: { store: storeA, index: ixA }, b: { store: storeB, index: ixB },
  opts: { topK: 6 },
});
check(bridges.active === true, '两库语义索引可比，库桥计算执行', `compared=${bridges.compared}`);
check(typeof bridges.baseline === 'number' && typeof bridges.vaultSimilarity === 'number',
  '库质心与卡对基线都是真实计算值');
check((bridges.pairs || []).every((p) => p.requiresHumanConfirm === true && Number.isFinite(p.lift)),
  '库桥候选全部标记待确认且带显著性');
check(storeA.crossLinks.length === crossBefore && storeB.crossLinks.length === 0,
  '库桥函数自身绝不擅自建立跨库关联');

// 模型不可用时三条链路如实降级
const down = S.resolveSemantic({ neolm: null }, storeA);
check(down.active === false && !!down.reason, '模型缺失时语义链路如实降级', down.reason?.slice(0, 24));
const degraded = callTool('kb_search', { query: '知识关联' }, { store: storeA, caller: 'ui', neolm: null });
check(degraded.semantic?.active === false && !!degraded.semantic.reason,
  '调取工具在模型缺失时如实标注并保留原有结果', `${degraded.results?.length} 个结果`);

console.log(`\n汇总：${pass} 项通过 / ${fail} 项失败 · 真实向量 ${ixA.vectors.size} + ${ixB.vectors.size} 张`);
if (fail) { console.error('✗ 语义回流层真实性门禁未通过，禁止编排发布'); process.exit(1); }
console.log('✓ 通过：模型真实参与调取 / 沉淀回流 / 库关联，且始终未越过人工确认边界。\n');
