#!/usr/bin/env node
/**
 * check-clean-client.mjs —— 「纯净客户端」红线门禁（v6.29.0 新增）
 * ---------------------------------------------------------------------------
 * 红线（用户明令，最高优先级，不可协商）：
 *   1. 客户端不得内置任何知识库内容数据；
 *   2. 禁止任何造假 / 虚构：不得塞随机字节、高熵填充文件、无读取代码的占位资源；
 *   3. 所有功能必须真实。
 *
 * 本脚本对「已编排的 staged 产物」做机器化校验，任何一条命中即 exit(1)，
 * 由 build 链在 makensis 之前强制调用，让红线从口头承诺变成可验证门禁。
 *
 * 允许的例外（都是真实、被代码读取的品牌/渲染/帮助资产，不是知识库内容）：
 *   - 品牌图标、字体、帮助中心 HTML/PNG、3D 星图渲染贴图；
 *   - 帮助中心里的少量说明性 .md（若后来有），单目录 <20 张，不构成知识库。
 * 注意：examples/corpus 演示语料自 v6.29.0 起不再随包分发（红线要求纯净），
 *       本门禁对任何「单目录 >=20 张 .md」一律判违规，不开后门。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const APP_DIR = path.resolve(process.argv[2]
  || path.join(import.meta.dirname, '..', 'build', 'win', 'electron-v33.0.0', 'resources', 'app'));

let failures = 0;
const fail = (msg) => { console.error(`  ✗ 红线命中：${msg}`); failures++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log(`\n[纯净客户端红线门禁] 扫描 ${APP_DIR}\n`);

if (!fs.existsSync(APP_DIR)) {
  console.error(`  ✗ staged 产物不存在：${APP_DIR}（请先跑 stage-app.mjs）`);
  process.exit(1);
}

// ---------- 红线 1：不得内置任何知识库内容数据 ----------
// builtin-library 曾含 816 张领域卡 + graph.bin(随机字节)，已被 stage 排除；
// 这里做双重确认：既不允许目录存在，也不允许任何残留的领域卡/预置库文件。
const BUILTIN = path.join(APP_DIR, 'assets', 'builtin-library');
if (fs.existsSync(BUILTIN)) fail('存在内置知识库目录 assets/builtin-library/（必须排除）');

// 扫描全 app，禁止出现「成规模的预置知识卡目录」：任何单目录 >=20 张 .md 即判违规。
// 红线不开后门——包括历史的 examples/corpus 演示语料（已停止随包分发）。
const presetCardDirs = [];
function walkForPresetCards(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      let mdCount = 0;
      try { mdCount = fs.readdirSync(abs).filter((x) => /\.md$/i.test(x)).length; } catch { /* ignore */ }
      if (mdCount >= 20) presetCardDirs.push({ dir: r, mdCount });
      walkForPresetCards(abs, r);
    }
  }
}
walkForPresetCards(APP_DIR);
for (const d of presetCardDirs) fail(`发现成规模预置知识卡目录 ${d.dir}（${d.mdCount} 张 .md）——纯净客户端不得内置知识库内容`);

// ---------- 红线 2：禁止造假 / 虚构（随机字节、高熵填充、无结构大文件）----------
// 已知历史造假文件 graph.bin（crypto.randomBytes 生成），绝不允许出现。
const FORBIDDEN_BIN = ['graph.bin', 'edges.bin', 'random.bin'];
function walkForBins(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walkForBins(abs, r); continue; }
    if (FORBIDDEN_BIN.includes(e.name.toLowerCase())) fail(`发现已知造假/填充文件 ${r}`);
    // 任何 >20MB 的无扩展名 .bin 或未知二进制大文件都视为可疑（Electron 运行时 dll/wasm 不计，它们在 app 外）
    const size = fs.statSync(abs).size;
    if (size > 20 * 1024 * 1024 && /\.(bin|dat)$/i.test(e.name) && !/icudtl/i.test(e.name)) {
      fail(`可疑大二进制 ${r}（${(size / 1048576).toFixed(1)}MB）——需证明被真实代码读取，否则视为填充`);
    }
  }
}
walkForBins(APP_DIR);

// graph.bin 熵检测兜底：即便被改名，只要 app 内出现内容近乎均匀随机的 >8MB 文件即判造假。
// （抽样 64KB 算 Shannon 熵，>7.95 bit/byte 视为高熵随机填充；真实图片/字体/模型不会这么均匀。）
function shannonEntropy(buf) {
  const freq = new Uint32Array(256);
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++;
  let H = 0;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;
    const p = freq[i] / buf.length;
    H -= p * Math.log2(p);
  }
  return H;
}
const BINARY_EXT = new Set(['.bin', '.dat', '.raw']);
function walkForHighEntropy(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walkForHighEntropy(abs, r); continue; }
    if (!BINARY_EXT.has(path.extname(e.name).toLowerCase())) continue;
    const size = fs.statSync(abs).size;
    if (size < 8 * 1024 * 1024) continue;
    const fd = fs.openSync(abs, 'r');
    const sample = Buffer.alloc(65536);
    fs.readSync(fd, sample, 0, sample.length, Math.floor(size / 2));
    fs.closeSync(fd);
    const H = shannonEntropy(sample);
    if (H > 7.95) fail(`高熵随机填充嫌疑 ${r}（熵 ${H.toFixed(3)} bit/B）——疑似 crypto.randomBytes 造假`);
  }
}
walkForHighEntropy(APP_DIR);

// ---------- 红线 2b：v6.31.0 NeoLM 权重（.nw）不得成为"改名绕过" ----------
// 模型是 1.5 GiB 的真实训练权重，不是 .bin/.dat 随机填充；但它不该靠扩展名
// 躲过检查。这里做两层：manifest 真实性字段自洽 + 抽样按 float32 解析，
// 随机字节改名为 .nw 会立刻出现 NaN / 1e38 量级 / 常量行而被拦下。
// 全量逐字节哈希、LCG 初值重放、真实推理复核由 tools/check-model-authenticity.mjs 执行。
const NEOLM_DIR = path.join(APP_DIR, 'assets', '_model', 'neolm');
if (fs.existsSync(NEOLM_DIR)) {
  const mf = path.join(NEOLM_DIR, 'neolm.manifest.json');
  let mm = null;
  if (!fs.existsSync(mf)) fail('NeoLM 目录缺少训练产物 manifest');
  else {
    try { mm = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { fail(`NeoLM manifest 解析失败：${e.message}`); }
  }
  if (mm) {
    if (!(mm.arch?.weightBytes >= 1073741824)) fail('NeoLM 权重未达 1 GiB（与交付声明不符）');
    if (mm.coverage?.embRatio !== 1 || mm.coverage?.outRatio !== 1) fail('NeoLM 覆盖率非 100%（可能存在未训练的随机初值行）');
    if (!(mm.evaluation?.aucModel > mm.evaluation?.aucBaseline + 0.02)) fail('NeoLM 留出集 AUC 未真实优于基线');
    if (!(mm.train?.lossLast < mm.train?.lossFirst * 0.95)) fail('NeoLM 训练 loss 未真实下降');
    ok('NeoLM manifest 真实性字段自洽（全量校验由独立真实性门禁执行）');
  }
  const dim = Number(mm?.arch?.dim) || 1536;
  const rowBytes = dim * 4;
  for (const f of ['neolm.emb.nw', 'neolm.out.nw']) {
    const p = path.join(NEOLM_DIR, f);
    if (!fs.existsSync(p)) { fail(`缺失模型权重 ${f}`); continue; }
    const size = fs.statSync(p).size;
    if (size < 500 * 1024 * 1024) fail(`模型权重异常偏小 ${f}（${(size / 1048576).toFixed(0)} MiB）`);
    const fd = fs.openSync(p, 'r');
    let badRows = 0;
    for (let k = 0; k < 8; k++) {
      const off = Math.floor((Math.floor((k + 0.5) * size / 8) / rowBytes)) * rowBytes;
      const buf = Buffer.allocUnsafe(rowBytes);
      fs.readSync(fd, buf, 0, rowBytes, off);
      const v = new Float32Array(buf.buffer, buf.byteOffset, dim);
      let min = Infinity, max = -Infinity, finite = true;
      for (let d = 0; d < dim; d++) {
        const x = v[d];
        if (!Number.isFinite(x) || Math.abs(x) > 1e4) { finite = false; break; }
        if (x < min) min = x;
        if (x > max) max = x;
      }
      if (!finite || max - min < 1e-7) badRows++;
    }
    fs.closeSync(fd);
    if (badRows) fail(`${f} 抽样 ${badRows}/8 行疑似随机字节或常量填充`);
    else ok(`${f} 抽样 8 行均为有限、非恒定的真实浮点权重`);
  }
}

// ---------- 红线 3：功能真实性 —— 入口文件必须存在且非空 ----------
const MUST_NONEMPTY = [
  'src/mcp/tools.js', 'src/storage/store.js', 'src/engine/derive.js',
  'src/cognition/link-recommender.js',   // v6.29.0 功能②：辅助建关联真实模块
  'ui/views/relations.js', 'main.js', 'preload.js',
];
for (const f of MUST_NONEMPTY) {
  const abs = path.join(APP_DIR, f);
  if (!fs.existsSync(abs) || fs.statSync(abs).size < 200) fail(`功能入口缺失或为空：${f}`);
}

if (failures) {
  console.error(`\n✗ 纯净客户端红线门禁未通过：${failures} 项命中，构建中止。\n`);
  process.exit(1);
}
const digest = crypto.createHash('sha256');
digest.update(fs.existsSync(BUILTIN) ? 'dirty' : 'clean-client-6.36.0');
console.log(`\n✓ 纯净客户端红线门禁通过：无内置知识库内容 / 无随机填充 / 功能入口齐全`);
console.log(`  校验根 ${APP_DIR} · root ${digest.digest('hex').slice(0, 16)}…\n`);
