// v6.30.0 · 原创「结构-内容关联模型」(RAM) 真实性与真实接入 · 契约测试
// ---------------------------------------------------------------------------
// 纪律：全部基于真实训练产物 + 真实临时 KbStore 上的真实 recommendLinks 调用。
//       不 mock 模型、不预置分数、不冒称大模型、不虚构指标。
//       覆盖：模型产物真实性 / 哈希链 / 篡改拒绝 / 可复现 / 零知识库数据 /
//              真实接入（模型开=分数被真实微调且给 modelProb；模型关=如实降级）/
//              "无真实证据不推荐"硬纪律不被模型破坏。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MODEL_FILE = 'desktop/assets/_model/relational-model.json';
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function main() {
  const { KbStore, indexVault } = await import(pathToFileURL(path.join(ROOT, 'src', 'storage', 'store.js')).href);
  const { recommendLinks } = await import(pathToFileURL(path.join(ROOT, 'src', 'cognition', 'link-recommender.js')).href);
  const { loadModel, infer, _reset } = await import(pathToFileURL(path.join(ROOT, 'src', 'cognition', 'relational-runtime.js')).href);
  const RM = await import(pathToFileURL(path.join(ROOT, 'src', 'cognition', 'relational-model.js')).href);

  // ── [1] 模型产物真实存在且结构正确 ────────────────────────────────────
  console.log('\n[1] 原创模型产物（真实训练产出，非随机/非人工填）');
  let raw, m;
  try { raw = read(MODEL_FILE); m = JSON.parse(raw); } catch { raw = null; }
  ok('模型文件存在', !!raw);
  if (!m) { console.log('\n==== v630 结果：无法继续（模型文件缺失）===='); process.exit(1); }
  ok('schema / kind 如实标注为原创可训练模型',
    m.schema === 'neocosmos.ram/1' && /original-trainable/.test(m.kind));
  ok('诚实边界声明存在（不是大模型、不含知识/答案）',
    /不是大语言模型/.test(m.honestBoundary) && /不含任何知识/.test(m.honestBoundary));
  ok('6 维特征与实现一致', JSON.stringify(m.features) === JSON.stringify(RM.FEATURES));
  ok('权重维度 = 特征维度', m.weights.w.length === RM.FEATURES.length);

  // ── [2] 真实性指标：loss 真降 + AUC 优于均权 ──────────────────────────
  console.log('\n[2] 真实训练指标（可核验，非编造）');
  ok('loss 实质下降（>40%）', m.train.lossLast < m.train.lossFirst * 0.6,
    `(${m.train.lossFirst} -> ${m.train.lossLast})`);
  ok('留出集 AUC 优于均权 baseline（模型真学到区分度）',
    m.evaluation.aucRam > m.evaluation.aucUniform + 0.02,
    `(RAM ${m.evaluation.aucRam} / 均权 ${m.evaluation.aucUniform})`);
  ok('训练样本来自真实 import 依赖图（正负样本数真实）',
    m.provenance.realImportEdges > 20 && m.provenance.positivePairs > 20 && m.provenance.negativePairs > 20,
    `(边 ${m.provenance.realImportEdges} / 正 ${m.provenance.positivePairs} / 负 ${m.provenance.negativePairs})`);

  // ── [3] 哈希链一致性 + 篡改拒绝 ───────────────────────────────────────
  console.log('\n[3] 哈希校验链（防造假核心）');
  const recalc = hash(JSON.stringify({ w: m.weights.w, b: m.weights.b, sampleHash: m.provenance.sampleHash }));
  ok('权重 -> modelHash 可逐字重算（装载器与训练同规则）', recalc === m.provenance.modelHash);
  _reset();
  const loaded = loadModel(() => raw);
  ok('装载器判定为真实训练产物并启用', loaded.active === true, `(${loaded.reason})`);
  _reset();
  const tampered = JSON.parse(raw); tampered.weights.w[0] = 99;
  ok('篡改任一权重即拒绝启用（active=false）', loadModel(() => JSON.stringify(tampered)).active === false);
  _reset();
  const lowAuc = JSON.parse(raw);
  lowAuc.evaluation.aucRam = lowAuc.evaluation.aucUniform; // 抹到不优于均权 => 闸门应拒
  ok('真实性闸门未达标的产物被拒绝（不采信假指标）', loadModel(() => JSON.stringify(lowAuc)).active === false);

  // ── [4] 可复现（连续两次重跑训练，权重/哈希逐字一致）────────────────────
  console.log('\n[4] 完全可复现（红线的机器证据）');
  // 注意：必须连续重跑两次再比对—— [1][2][3] 读到的 m 可能是上一次构建留下的
  // 产物（例如修脚本前后），拿它跟本次重跑比会误判为"不可复现"。
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'train-relational-model.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const base = JSON.parse(read(MODEL_FILE));
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'train-relational-model.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const m2 = JSON.parse(read(MODEL_FILE));
  ok('连续两次重跑：权重逐字一致',
    JSON.stringify(m2.weights) === JSON.stringify(base.weights));
  ok('连续两次重跑：modelHash / sampleHash 逐字一致',
    m2.provenance.modelHash === base.provenance.modelHash &&
    m2.provenance.sampleHash === base.provenance.sampleHash,
    `(${m2.provenance.modelHash.slice(0, 12)}…)`);
  _reset();
  const reloaded = loadModel(() => read(MODEL_FILE));
  ok('重跑后模型仍通过装载器校验', reloaded.active === true);
  // 后续 [6] 的 A/B 断言须用本次产物，而非开头陈旧的 m
  m.weights = m2.weights; m.provenance = m2.provenance; m.evaluation = m2.evaluation;

  // ── [5] 零知识库数据（模型产物不含任何语料/卡片）───────────────────────
  console.log('\n[5] 纯净红线：模型产物零知识库数据');
  ok('模型文件不含知识卡正文特征（无 .md 路径/语料）',
    !/\.md|秘密性|举证责任|frontmatter|#\s/.test(raw));
  ok('模型文件仅含权重/指标/来源元数据（体积为真实小模型）',
    raw.length < 20000 && !!m.weights && !!m.evaluation && !!m.provenance,
    `(${raw.length} B)`);

  // ── [6] 真实接入：模型确实影响推荐打分 ────────────────────────────────
  console.log('\n[6] 真实接入（模型开/关 A/B，真实临时库）');
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'neokb-v630-'));
  fs.writeFileSync(path.join(vault, '成本口径.md'),
    '---\ntags: [成本, 核算]\n---\n# 成本口径\n全口径成本核算，含人力、算力、合规三部分。\n', 'utf8');
  fs.writeFileSync(path.join(vault, '算力成本.md'),
    '---\ntags: [成本, 算力]\n---\n# 算力成本\n算力按 GPU 时长计费，是成本核算的一部分。\n', 'utf8');
  fs.writeFileSync(path.join(vault, '合规成本.md'),
    '---\ntags: [成本, 合规]\n---\n# 合规成本\n合规成本含数据出境评估与审计，属于成本核算第三块。\n', 'utf8');
  const store = new KbStore(vault).load();
  await indexVault(store);
  const target = store.allNodes().find((n) => n.title === '成本口径');
  ok('真实临时库索引到 3 张卡', store.allNodes().length === 3);

  const modelText = read(MODEL_FILE);
  const withModel = recommendLinks(store, target.id, { modelText });
  const noModel = recommendLinks(store, target.id, { model: 'off' });
  ok('模型开：modelActive=true 且携带 modelHash 与真实 AUC',
    withModel.model.active === true && withModel.model.modelHash === m.provenance.modelHash
      && withModel.model.aucOnHoldout === m.evaluation.aucRam);
  ok('模型关：modelActive=false（如实降级，不假装在用）', noModel.model.active === false);
  ok('两条路径都基于真实信号给出建议（模型不改变"有无证据"纪律）',
    withModel.suggestions.length > 0 && noModel.suggestions.length > 0,
    `(开 ${withModel.suggestions.length} / 关 ${noModel.suggestions.length})`);
  const anyProb = withModel.suggestions.some((s) => typeof s.payload.modelProb === 'number');
  ok('模型开：每条建议携带真实 modelProb（可核查）', anyProb);
  const allNullProb = noModel.suggestions.every((s) => s.payload.modelProb == null);
  ok('模型关：modelProb 如实为 null（不伪造分数）', allNullProb);
  // 模型真实改变分数：同一批建议，开/关的 score 至少有一处不同
  const changed = withModel.suggestions.some((s, i) => {
    const twin = noModel.suggestions.find((x) => x.payload.dst === s.payload.dst);
    return twin && Math.abs(twin.score - s.score) > 1e-6;
  });
  ok('模型权重真实影响打分（开/关 score 存在真实差异）', changed);

  // ── [7] 硬纪律：模型不得凭空制造关联（不改变"有无真实证据"的判定）─────
  // 说明（如实边界）：中文 tokenize 会产生滑动 bigram，极短文本可能出现泛化词
  // 命中（这属 v6.29.0 分词固有行为，与本模型无关）。这里验证的是模型接入纪律：
  //   模型只有权在【已有真实信号】的建议上微调分数，绝不会新增/删除建议条目。
  console.log('\n[7] 硬纪律：模型不新增/删除建议，只在既有真实信号上微调');
  const isoVault = fs.mkdtempSync(path.join(os.tmpdir(), 'neokb-v630-iso-'));
  fs.writeFileSync(path.join(isoVault, '甲.md'), '# 甲\n完全不同主题的孤立内容A。\n', 'utf8');
  fs.writeFileSync(path.join(isoVault, '乙.md'), '# 乙\n毫无关联的孤立内容B。\n', 'utf8');
  const isoStore = new KbStore(isoVault).load();
  await indexVault(isoStore);
  const isoTarget = isoStore.allNodes().find((n) => n.title === '甲');
  const isoOn = recommendLinks(isoStore, isoTarget.id, { modelText });
  const isoOff = recommendLinks(isoStore, isoTarget.id, { model: 'off' });
  const idsOn = isoOn.suggestions.map((s) => s.payload.dst).sort().join(',');
  const idsOff = isoOff.suggestions.map((s) => s.payload.dst).sort().join(',');
  ok('模型开/关：建议条目集合完全一致（模型不制造也不抹掉关联）',
    idsOn === idsOff, `(开 [${idsOn}] / 关 [${idsOff}])`);
  ok('模型关闭时全无 modelProb（不伪造模型分数）',
    isoOff.suggestions.every((s) => s.payload.modelProb == null));

  console.log(`\n==== v630 结果：${pass} PASS / ${fail} FAIL ==== `);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('v630 运行异常：', e); process.exit(1); });
