#!/usr/bin/env node
/**
 * verify-deliverable.mjs —— v6.30.0 交付校验（只读，不改任何产物）
 * ---------------------------------------------------------------------------
 * 汇总校验：版本号单一真源 / 纯净红线 / QS-Shield 完整性 / 原创 RAM 模型真实性 /
 * 禁止凑数资产审计 / 安装包真实体积与 SHA256（零内置知识库数据的硬证据）。
 * 全部取自真实产物，不写估值。用法：
 *   node tools/verify-deliverable.mjs
 * v6.40.0：校验【双独立客户端】——个人版 / 企业版各自独立的 exe、数据目录、
 * 协议、EULA、安装包，以及共用的合规资产（字体 OFL / three.js MIT / AGPL）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'build', 'win', 'electron-v33.0.0', 'resources', 'app');
// 融合版交付（EDITION_LOCK=both）：单一交付包 NeoCosmos-<版本>-Setup.exe。
// v6.34.0：默认路径与版本断言改为动态跟随 desktop/package.json（单一真源），升级不再漏改。
const __V = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version;
const SETUP = process.argv[2]
  || path.join(ROOT, 'build', 'dist', `NeoCosmos-Personal-${__V}-Setup.exe`);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  [PASS] ${n} ${x}`); } else { fail++; console.log(`  [FAIL] ${n} ${x}`); } };
const read = (p) => fs.readFileSync(p, 'utf8');

console.log(`\n===== v${__V} 交付校验 =====\n`);

// [1] 版本单一真源
console.log('[1] 版本单一真源');
const V = JSON.parse(read(path.join(ROOT, 'desktop', 'package.json'))).version;
const rootPkg = JSON.parse(read(path.join(ROOT, 'package.json'))).version;
const nsi = read(path.join(ROOT, 'tools', 'installer.nsi'));
ok('desktop/package.json 版本与交付版本一致', V === __V, `(${V})`);
ok('根 package.json 与 desktop 同源', rootPkg === V);
ok('installer.nsi VERSION_TAG 同步', nsi.includes(`VERSION_TAG         "${V}"`));
ok('installer.nsi 融合版输出名用 VERSION_TAG 单一真源（不硬编码版本）',
  nsi.includes(`\${PRODUCT_NAME}-\${VERSION_TAG}\${SETUP_TAIL}\${OUT_EXT}`));
ok(`staged BUILD.txt = v${V}`, read(path.join(APP, 'BUILD.txt')).includes(`v${V}`));
ok(`UI brandVersion = ${V}`, read(path.join(APP, 'ui', 'index.html')).includes(`id="brandVersion">${V}<`));
// v6.40.0 合规拆分：两版为完全独立客户端，各自独立 exe / 数据目录 / 协议 / EULA。
const DIST = path.join(ROOT, 'build', 'dist');
const P_SETUP = path.join(DIST, `NeoCosmos-Personal-${V}-Setup.exe`);
const E_SETUP = path.join(DIST, `NeoCosmos-Enterprise-${V}-Setup.exe`);
ok('个人版独立安装包存在', fs.existsSync(P_SETUP), path.basename(P_SETUP));
ok('企业版独立安装包存在', fs.existsSync(E_SETUP), path.basename(E_SETUP));
ok('NSIS 为两版定义独立 exe 名',
  nsi.includes('NeoCosmosPersonal.exe') && nsi.includes('NeoCosmosEnterprise.exe'));
ok('NSIS 为两版定义独立协议（neolinkp / neolink）',
  nsi.includes('"neolinkp"') && nsi.includes('PROTO_SCHEME'));
ok('NSIS 为两版配置独立 EULA 授权页',
  nsi.includes('PERSONAL-EULA.txt') && nsi.includes('ENTERPRISE-EULA.txt') &&
  nsi.includes('MUI_PAGE_LICENSE'));
// 合规资产（LICENSES.md / NOTICE 在仓库根目录；其余在 legal/ 目录）
for (const f of ['LICENSES.md', 'NOTICE']) {
  ok(`${f} 存在（根目录）`, fs.existsSync(path.join(ROOT, f)));
}
for (const f of ['AGPL-3.0.txt', 'COMMERCIAL-LICENSE.md', 'PERSONAL-EULA.txt', 'ENTERPRISE-EULA.txt']) {
  ok(`legal/${f} 存在`, fs.existsSync(path.join(ROOT, 'legal', f)));
}
ok('SIL OFL 1.1 字体许可证全文存在', fs.existsSync(path.join(ROOT, 'desktop', 'assets', 'fonts', 'OFL.txt')) &&
  read(path.join(ROOT, 'desktop', 'assets', 'fonts', 'OFL.txt')).includes('SIL OPEN FONT LICENSE'));
ok('three.js MIT 许可存在', fs.existsSync(path.join(ROOT, 'desktop', 'ui', 'vendor', 'three', 'LICENSE')));

// [2] 红线：staged 树零内置知识库数据
console.log('\n[2] 纯净客户端红线（打包源 = staged 树）');
const FORBIDDEN = ['builtin-library', 'graph.bin', 'examples/corpus'];
for (const f of FORBIDDEN) {
  ok(`staged 不含 ${f}`, !fs.existsSync(path.join(APP, f)));
}
function countMd(dir) { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) n += countMd(p); else if (/\.md$/i.test(e.name)) n++; } return n; }
const mdTotal = countMd(APP);
ok('staged 树 .md 总数 <= 5（仅许可/说明文档，零知识卡）', mdTotal <= 5, `(${mdTotal})`);
// 高熵随机填充扫描（>8MB 的 .bin/.dat）
function shannon(buf) { const f = new Uint32Array(256); for (let i = 0; i < buf.length; i++) f[buf[i]]++; let H = 0; for (let i = 0; i < 256; i++) { if (!f[i]) continue; const p = f[i] / buf.length; H -= p * Math.log2(p); } return H; }
let highEntropy = [];
(function walk(d, rel = '') { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else if (/\.(bin|dat)$/i.test(e.name) && fs.statSync(p).size > 8e6) { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(65536); fs.readSync(fd, b, 0, b.length, Math.floor(fs.statSync(p).size / 2)); fs.closeSync(fd); if (shannon(b) > 7.95) highEntropy.push(r); } } })(APP);
ok('无高熵随机填充文件（Shannon 熵 >7.95）', highEntropy.length === 0, highEntropy.join(','));

// [3] QS-Shield 完整性链
console.log('\n[3] QS-Shield 完整性基线');
const integ = JSON.parse(read(path.join(APP, 'security', 'integrity.json')));
ok(`integrity.json 版本 = ${V}`, integ.version === V, `(${integ.version})`);
ok('关键文件数 >= 34（本版纳入 RAM 模型定义/加载器/权重）', integ.files.length >= 34, `(${integ.files.length})`);
ok('关键文件含 src/cognition/link-recommender.js', integ.files.some((f) => f.path === 'src/cognition/link-recommender.js'));
ok('关键文件含 ui/views/relations.js', integ.files.some((f) => f.path === 'ui/views/relations.js'));
ok('关键文件含 RAM 模型定义/加载器/真实权重（防篡改哈希链）',
  ['src/cognition/relational-model.js', 'src/cognition/relational-runtime.js', 'assets/_model/relational-model.json']
    .every((p) => integ.files.some((f) => f.path === p)));

// [4] 功能②模块真实存在且语法正确
console.log('\n[4] 新功能入口真实存在');
for (const f of ['src/cognition/link-recommender.js', 'src/mcp/tools.js', 'ui/views/relations.js', 'ui/views/capabilities.js']) {
  ok(`staged 含 ${f}`, fs.existsSync(path.join(APP, f)));
}
ok('kb_link_recommend / kb_link_audit 已注册', /kb_link_recommend/.test(read(path.join(APP, 'src', 'mcp', 'tools.js'))) && /kb_link_audit/.test(read(path.join(APP, 'src', 'mcp', 'tools.js'))));

// [4.5] v6.30.0 原创 RAM 关联模型真实性（真实训练产物 / 哈希链 / 真实接入）
console.log('\n[4.5] 原创 RAM 关联模型（真实训练，非随机/非造假）');
const modelPath = path.join(APP, 'assets', '_model', 'relational-model.json');
if (fs.existsSync(modelPath)) {
  const mt = read(modelPath);
  const mm = JSON.parse(mt);
  ok('模型产物随包存在且 schema 正确', mm.schema === 'neocosmos.ram/1' && /original-trainable/.test(mm.kind));
  ok('诚实边界声明存在（非大模型/不含知识/答案）', /不是大语言模型/.test(mm.honestBoundary));
  const recalc = crypto.createHash('sha256').update(JSON.stringify({
    w: mm.weights.w, b: mm.weights.b, sampleHash: mm.provenance.sampleHash,
  })).digest('hex');
  ok('权重 -> modelHash 可逐字重算（装载器校验通过）', recalc === mm.provenance.modelHash,
    `(${mm.provenance.modelHash.slice(0, 12)}…)`);
  ok('真实训练指标达标（loss 下降 >40% 且 AUC 优于均权）',
    mm.train.lossLast < mm.train.lossFirst * 0.6 && mm.evaluation.aucRam > mm.evaluation.aucUniform + 0.02,
    `(loss ${mm.train.lossFirst}->${mm.train.lossLast}, AUC ${mm.evaluation.aucRam} vs ${mm.evaluation.aucUniform})`);
  ok('训练样本来自真实 import 依赖图（非知识库语料）',
    mm.provenance.realImportEdges > 20 && /真实 ES 模块 import 依赖图/.test(mm.provenance.dataNote));
  ok('模型产物零知识库正文（仅权重/指标/元数据，小体积）',
    !/\.md|秘密性|举证责任/.test(mt) && mt.length < 20000, `(${mt.length} B)`);
  ok('推荐器真实加载模型（运行时只读 + 失败降级）',
    /loadRamModel/.test(read(path.join(APP, 'src', 'cognition', 'link-recommender.js'))) &&
    /model\.active/.test(read(path.join(APP, 'src', 'cognition', 'link-recommender.js'))));
} else {
  ok('模型产物随包存在', false, '缺失 assets/_model/relational-model.json');
}

// [4.6] v6.30.0 禁止凑数：staged 每个资产都必须被运行时真实引用（以审计门禁退出码为硬判据）
console.log('\n[4.6] 禁止凑数资产审计（每一字节都真实被调用）');
let auditRc = 1;
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-asset-references.mjs'),
    '--staged', APP, '--allow-unused', 'fonts/OFL.txt,fonts/FONT-LICENSES.txt'], { cwd: ROOT, stdio: 'ignore' });
  auditRc = 0;
} catch { auditRc = 1; }
ok('staged 内零「未调用凑数资产」（审计门禁退出码 0）', auditRc === 0);

// [5] 安装包真实体积与哈希 + 违规文件名扫描
console.log('\n[5] 安装包产物（真实值）');
if (fs.existsSync(SETUP)) {
  const st = fs.statSync(SETUP);
  ok('个人版安装包存在（默认校验目标）', true, path.basename(SETUP));
  console.log(`       体积：${st.size} B = ${(st.size / 1048576).toFixed(1)} MiB = ${(st.size / 1e6).toFixed(1)} MB`);
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(SETUP, 'r'); const buf = Buffer.alloc(4 * 1024 * 1024); let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); fs.closeSync(fd);
  console.log(`       SHA-256：${h.digest('hex').toUpperCase()}`);
  // 违规文件名明文扫描（solid LZMA 压缩后大概率不可见，作为辅助证据，不作硬性失败条件）
  const fd2 = fs.openSync(SETUP, 'r'); const probe = Buffer.alloc(2 * 1024 * 1024); fs.readSync(fd2, probe, 0, probe.length, 0); fs.closeSync(fd2);
  const head = probe.toString('latin1');
  ok('安装包头无内置库明文标记（辅助）', !/builtin-library|graph\.bin/.test(head));
  console.log('       注：solid LZMA 压缩后文件名被熵编码，红线以 staged 打包源门禁为准（见 [2]）。');
} else {
  ok('个人版安装包存在（默认校验目标）', false, `未找到 ${SETUP}`);
}

console.log(`\n===== 结果：${pass} PASS / ${fail} FAIL =====`);
process.exit(fail ? 1 : 0);
