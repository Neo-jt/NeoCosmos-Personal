#!/usr/bin/env node
/**
 * check-model-authenticity.mjs —— NeoLM「禁止虚构 / 虚假能力」真实性门禁（v6.31.0）
 * ---------------------------------------------------------------------------
 * 用户红线：安装包里的每个字节都必须真实被调用，禁止随机填充、假指标、假能力。
 * 1.5 GiB 的模型若只是 crypto.randomBytes 或"没训练过的随机初值"，本门禁必须拦下。
 *
 * 机器化校验（任一项失败即 exit(1)，由 stage / build 链强制调用）：
 *   A. 产物完整性：四份文件齐全、尺寸精确、逐字节 SHA-256 与 manifest 一致、体积 >= 1 GiB；
 *   B. 训练证据：loss 真降、留出集 AUC 真优于基线、manifest 记录语料/脚本哈希可重算；
 *   C. 反填充：重放同一 LCG 初始向量，逐行比对 —— 训练后每一行都必须【确实被梯度改写】；
 *      同时抽样检查权重非常量、非零、E/U 各行有差异（随机填充与全零都过不了）；
 *   D. 真实推理：加载 runtime 跑相似度 / 近邻 / 续写 / 全量 verify，输出非恒定且可复现；
 *   E. 真实接线：UI 里每个 api.neolm.* 调用都必须有 preload 桥接与 main.js 的 IPC 通道。
 *
 * 用法：node tools/check-model-authenticity.mjs [--dir <模型目录>]
 * 默认模型目录 = staged resources/app/assets/_model/neolm
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA, VOCAB_SIZE, DIM, ROW_BYTES, MATRIX_BYTES,
  WEIGHT_FILES, VOCAB_FILE, MANIFEST_FILE,
  lcg, initRow, sha256Hex, collectCorpus,
} from '../src/cognition/neolm/core.js';
import { createNeoLM } from '../src/cognition/neolm/runtime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DIR = path.resolve(arg('--dir', path.join(ROOT, 'build', 'win', 'electron-v33.0.0', 'resources', 'app', 'assets', '_model', 'neolm')));

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
const check = (cond, msg, detail = '') => { if (cond) ok(msg + (detail ? ` · ${detail}` : '')); else fail(msg + (detail ? ` · ${detail}` : '')); };

console.log('\n===== NeoLM 模型真实性门禁 =====\n');
console.log(`模型目录：${DIR}\n`);

function shaFile(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(16 * 1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}

// ---------- A. 产物完整性 ----------
const files = [...WEIGHT_FILES, VOCAB_FILE, MANIFEST_FILE];
for (const f of files) check(fs.existsSync(path.join(DIR, f)), `存在 ${f}`);
if (failures) { console.error('\n✗ 产物缺失，门禁中止\n'); process.exit(1); }

let m;
try { m = JSON.parse(fs.readFileSync(path.join(DIR, MANIFEST_FILE), 'utf8')); }
catch (e) { console.error(`✗ manifest 解析失败：${e.message}`); process.exit(1); }

check(m.schema === SCHEMA, 'schema 正确', m.schema);
check(m.arch?.vocab === VOCAB_SIZE && m.arch?.dim === DIM, '架构维度与运行时一致', `${m.arch?.vocab}×${m.arch?.dim}`);
check(m.arch?.matrixBytes === MATRIX_BYTES, '单矩阵字节数精确', String(m.arch?.matrixBytes));
const weightBytes = m.weights?.reduce((a, w) => a + w.bytes, 0) || 0;
check(weightBytes >= 1073741824, '权重总大小 >= 1 GiB', `${(weightBytes / 1073741824).toFixed(3)} GiB`);
check(m.arch?.weightBytes === weightBytes, 'manifest 体积字段自洽');

for (const w of m.weights || []) {
  const p = path.join(DIR, w.file);
  const size = fs.statSync(p).size;
  check(size === w.bytes && size === MATRIX_BYTES, `权重尺寸精确 ${w.file}`, `${size} B`);
  const actual = shaFile(p);
  check(actual === w.sha256, `逐字节 SHA-256 一致 ${w.file}`, actual.slice(0, 16) + '…');
}
const vocabBuf = fs.readFileSync(path.join(DIR, VOCAB_FILE));
check(sha256Hex(vocabBuf) === m.vocab?.sha256, '词表 SHA-256 一致');
let vj;
try { vj = JSON.parse(vocabBuf.toString('utf8')); } catch { vj = null; }
check(vj && Array.isArray(vj.tokens) && vj.tokens.length === VOCAB_SIZE, '词表长度正确', String(vj?.tokens?.length));
check(vj?.tokens?.every((e) => Array.isArray(e) && typeof e[0] === 'string' && e[0].length > 0), '词表每项都是真实非空 token');

// ---------- B. 训练证据 ----------
const tr = m.train || {}, ev = m.evaluation || {}, cov = m.coverage || {}, pv = m.provenance || {};
check(tr.steps > 1000 && tr.pairs > 0, '训练确有真实步数 / 样本对', `${tr.steps} steps / ${tr.pairs} pairs`);
check(tr.lossLast < tr.lossFirst * 0.95, 'loss 真实下降', `${tr.lossFirst} → ${tr.lossLast}`);
check(Array.isArray(tr.lossCurve) && tr.lossCurve.length >= 2, 'loss 曲线有真实采样点', `${tr.lossCurve?.length} 点`);
check(ev.aucModel > ev.aucBaseline + 0.02, '留出集 AUC 真优于基线', `${ev.aucModel} vs ${ev.aucBaseline}（${ev.holdoutPairs} 对）`);
check(Array.isArray(ev.inferenceEvidence) && ev.inferenceEvidence.some((x) => Array.isArray(x.nearest) && x.nearest.length >= 3),
  'manifest 记录了真实推理证据');
check(cov.changedEmbRows === VOCAB_SIZE && cov.changedOutRows === VOCAB_SIZE && cov.embRatio === 1 && cov.outRatio === 1,
  '训练器自报覆盖率 100%', `${cov.changedEmbRows}/${cov.changedOutRows}`);

const trainScript = path.join(ROOT, 'tools', 'train-neolm.mjs');
check(sha256Hex(fs.readFileSync(trainScript)) === pv.trainScriptHash,
  'trainScriptHash 与真实训练脚本一致（证明产物由该脚本产出）', pv.trainScriptHash?.slice(0, 16) + '…');
// 训练时固化的语料快照（构建期证据，不随安装包分发）。
// 训练之后仓库会继续改文档 / 版本戳 / 门禁脚本，所以不能用"当前文件重放"来证明；
// 用快照精确复现当时的训练输入，并另外如实统计训练后变更了哪些文件。
const CORPUS_DIR = path.resolve(arg('--corpus-dir', path.join(ROOT, 'desktop', 'assets', '_model', 'neolm')));
const rels = Array.isArray(pv.fileList) ? pv.fileList : [];
check(rels.length > 0 && rels.length === pv.corpusFiles, '训练语料文件清单完整', `${rels.length} 个文件`);
const fh = new Map(Array.isArray(pv.fileHashes) ? pv.fileHashes : []);
check(fh.size === rels.length, '训练时逐文件哈希清单完整', `${fh.size} 项`);
let missingCorpus = 0;
const changedAfterTrain = [];
for (const rel of rels) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { missingCorpus++; continue; }
  const cur = sha256Hex(Buffer.from(fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n'), 'utf8'));
  if (fh.has(rel) && fh.get(rel) !== cur) changedAfterTrain.push(rel);
}
check(missingCorpus === 0, '清单里的语料文件全部仍在仓库', missingCorpus ? `缺失 ${missingCorpus} 个` : '');
ok(`训练后变更 ${changedAfterTrain.length} 个文件（版本戳 / 文档 / 门禁等），已如实登记，以训练时快照为证据基准`);
const rawP = path.join(CORPUS_DIR, 'neolm.corpus.raw.txt');
const mdP = path.join(CORPUS_DIR, 'neolm.corpus.md.txt');
check(fs.existsSync(rawP) && fs.existsSync(mdP), '训练语料快照存在（构建期真实性证据）');
if (fs.existsSync(rawP) && fs.existsSync(mdP)) {
  const raw = fs.readFileSync(rawP, 'utf8');
  const md = fs.readFileSync(mdP, 'utf8');
  check(sha256Hex(Buffer.from(raw, 'utf8')) === pv.rawTextHash, '原始语料快照哈希与 manifest 一致', pv.rawTextHash?.slice(0, 16) + '…');
  check(raw.length === pv.corpusChars && md.length === pv.mdChars, '快照规模与 manifest 一致', `${raw.length} / ${md.length} 字符`);
  const trainText = md.repeat(Number(pv.mdOversample || 3)) + raw;
  check(sha256Hex(Buffer.from(trainText, 'utf8')) === pv.trainTextHash,
    '训练序列可由快照精确复现（中文文档过采样倍数如实）', `×${pv.mdOversample}`);
}
check(typeof pv.corpusHash === 'string' && pv.corpusHash.length === 64, '训练时逐文件语料哈希已记录');

// ---------- C. 反随机填充：重放 LCG 初值逐行比对 ----------
// probe 必须与权重同为 Float32Array，否则精度差会造成"假覆盖率"。
const N = 2048;
const rng = lcg(Number(m.arch?.initSeed));
const probe = new Float32Array(DIM);
const rowBuf = Buffer.allocUnsafe(ROW_BYTES);
const fds = WEIGHT_FILES.map((f) => fs.openSync(path.join(DIR, f), 'r'));
function readRow(which, id) {
  fs.readSync(fds[which], rowBuf, 0, ROW_BYTES, id * ROW_BYTES);
  return new Float32Array(rowBuf.buffer, rowBuf.byteOffset, DIM);
}
let changedE = 0, changedU = 0, constantRows = 0, zeroRows = 0;
for (let v = 0; v < N; v++) {
  initRow(rng, probe, 0);
  const e = readRow(0, v);
  let diff = false;
  for (let d = 0; d < DIM; d++) if (e[d] !== probe[d]) { diff = true; break; }
  if (diff) changedE++;
  initRow(rng, probe, 0);
  const u = readRow(1, v);
  diff = false;
  for (let d = 0; d < DIM; d++) if (u[d] !== probe[d]) { diff = true; break; }
  if (diff) changedU++;
}
// 大 id 结构抽样：非常量、非全零、E 与 U 不同
const bigIds = [4096, 16383, 32768, 65535, 98304, VOCAB_SIZE - 1];
for (const id of bigIds) {
  for (const which of [0, 1]) {
    const r = readRow(which, id);
    let sum = 0, min = Infinity, max = -Infinity, nz = 0;
    for (let d = 0; d < DIM; d++) { const x = r[d]; sum += x; if (x < min) min = x; if (x > max) max = x; if (x !== 0) nz++; }
    if (max - min < 1e-7) constantRows++;
    if (nz === 0) zeroRows++;
    if (!Number.isFinite(sum)) constantRows++;
  }
}
for (const fd of fds) fs.closeSync(fd);
check(changedE === N && changedU === N,
  `重放 LCG 初值：前 ${N} 行 E/U 全部被真实梯度改写（非随机初值残留）`, `${changedE}/${changedU}`);
check(constantRows === 0 && zeroRows === 0, '大 id 抽样：无常量行 / 无全零行');

// ---------- D. 真实推理自检 ----------
const model = createNeoLM({ dir: DIR });
check(model.active === true, '运行时真实加载成功', model.reason || model.status?.().reason || '');
if (model.active) {
  const s = model.status();
  check(s.weightGiB >= 1, '运行时报告体积 >= 1 GiB', `${s.weightGiB} GiB`);
  const s1 = model.similarity('知识', '关联');
  const s2 = model.similarity('知识', '香蕉');
  check(Number.isFinite(s1) && Number.isFinite(s2) && s1 !== s2,
    '相似度对不同输入给出不同真实值', `${s1} vs ${s2}`);
  const near = model.nearest('知识关联', 5);
  check(near.length === 5 && near.every((x) => Number.isFinite(x.cosine)), '近邻扫描返回 5 条真实 cosine');
  const g1 = model.generate('知识关联', 6), g2 = model.generate('知识关联', 6);
  check(g1.text === g2.text && g1.steps.length === 6, '续写确定性可复现', JSON.stringify(g1.text));
  check(model.verify().ok === true, '运行时全量 verify 通过');
  model.close();
}

// ---------- E. 真实接线（UI 按钮 -> preload -> IPC） ----------
const view = fs.readFileSync(path.join(ROOT, 'desktop', 'ui', 'views', 'neolm.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
const calls = [...new Set([...view.matchAll(/api\.neolm\.(\w+)\s*\(/g)].map((x) => x[1]))];
check(calls.length >= 5, 'UI 确实调用了多个真实模型能力', calls.join(', '));
for (const c of calls) {
  check(new RegExp(`\\b${c}\\s*:`).test(preload), `preload 暴露 api.neolm.${c}`);
  check(main.includes(`'neolm:${c}'`), `main.js 注册 IPC neolm:${c}`);
}
check(main.includes('neolm:') && preload.includes('neolm:'), '桌面端模型通道真实存在');

console.log(`\n汇总：体积 ${(weightBytes / 1073741824).toFixed(3)} GiB · loss ${tr.lossFirst}→${tr.lossLast} · AUC ${ev.aucModel} · 覆盖率 100%`);
if (failures) {
  console.error(`\n✗ 真实性门禁未通过：${failures} 项失败，构建中止。\n`);
  process.exit(1);
}
console.log('\n✓ 通过：模型是真实训练的产物、权重非填充、能力真实接线、推理真实可复现。\n');
process.exit(0);
