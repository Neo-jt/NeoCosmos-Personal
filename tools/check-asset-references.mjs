#!/usr/bin/env node
/**
 * check-asset-references.mjs —— 「禁止凑数」资产引用审计门禁（v6.30.0 新增）
 * ---------------------------------------------------------------------------
 * 红线背景：用户明令「安装包每一字节都必须真实被调用，禁止随包塞未使用的
 * 资产凑体积」。本工具把该红线变成机器可校验的构建门禁：
 *
 *   扫描 staged 的 resources/app/assets 下每个文件，判定它在运行时是否
 *   被真实引用；凡「零运行时引用」的资产一律报出并以 exit(1) 中止构建。
 *
 * 引用判定（只认运行时，不认构建期生成脚本，避免"生成过"冒充"被使用"）：
 *   1. 运行时源码（desktop/ui/**、desktop/*.js|cjs、desktop/astra/**）里
 *      出现该资产的文件名或相对路径；
 *   2. 被运行时引用的 HTML/CSS 内部的相对路径链（href/src/url()）——
 *      例如帮助页 index.html 链到 faq.html / media/*.png，字体 CSS 的
 *      @font-face 链到 *.ttf，属于「间接但真实」的引用，递归计入；
 *   3. 明确的动态加载模式（TextureLoader('...path...') 等字符串路径）。
 *
 * 仅证明"可复现"的生成脚本（tools/gen-*.mjs）与从未被读取的 manifest
 * 不计入运行时引用——资产存在生成脚本 ≠ 客户端运行时会加载它。
 *
 * 用法：
 *   node tools/check-asset-references.mjs [--staged <app目录>] [--allow-unused <相对路径,...>]
 * 默认 staged 目录 = build/win/electron-v33.0.0/resources/app
 * --allow-unused 用于显式豁免（须在交付文档如实登记理由），默认无豁免。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const STAGED = path.resolve(arg('--staged', path.join(ROOT, 'build', 'win', 'electron-v33.0.0', 'resources', 'app')));
const ASSETS = path.join(STAGED, 'assets');
const ALLOW = new Set((arg('--allow-unused', '') || '').split(',').map((s) => s.trim()).filter(Boolean));

// 运行时源码根：stage 后的 app 目录里，除 assets 自身与 security/integrity 之外的代码/页面/样式。
// 用 staged 而非 desktop/，确保判定对象与实际打包内容完全一致。
const RUNTIME_EXTS = new Set(['.js', '.cjs', '.mjs', '.html', '.css', '.json']);
function collectRuntimeSources(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r.startsWith('assets/')) continue;        // assets 自身不算引用方
    if (r === 'security/integrity.json') continue; // 完整性清单是元数据，不算加载
    if (e.isDirectory()) collectRuntimeSources(p, r, out);
    else if (RUNTIME_EXTS.has(path.extname(e.name).toLowerCase())) out.push([r, p]);
  }
  return out;
}
const runtimeSources = collectRuntimeSources(STAGED);
const sourceText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

// 直接引用：某个运行时源码文本里出现资产的「带目录相对路径」。
// 重要：不能用裸 basename 匹配——assets/help/index.html 与主入口 ui/index.html
// 同名，main.js 里 loadURL('.../index.html') 会被裸 basename 误判成引用了帮助页。
// 规则：路径含 '/' 的资产只认 assets/<rel> 或 <rel> 整体出现；
//       仅根级单文件（无 '/'）才允许用文件名匹配（这些不会与入口重名）。
function directRefs(assetRel) {
  const hasDir = assetRel.includes('/');
  const needles = hasDir
    ? ['assets/' + assetRel, assetRel]
    : [assetRel, 'assets/' + assetRel];
  const hits = [];
  for (const [r, p] of runtimeSources) {
    const t = sourceText(p);
    if (needles.some((n) => t.includes(n))) hits.push(r);
  }
  return hits;
}

// 间接引用链：从"被运行时直接引用的 HTML/CSS"出发，解析其 href/src/url() 相对路径，
// 递归收集它们再引用的 assets（帮助页链、字体 CSS 的 @font-face 等）。
function indirectReferencedAssets() {
  const reached = new Set();          // assets 相对路径
  const visited = new Set();          // 已解析的资产文件（HTML/CSS）
  const queue = [];
  // 种子：运行时直接点名引用的、且位于 assets 下的 HTML/CSS。
  // 与 directRefs 同样禁止裸 basename（index.html 会与主入口误命中），只认带目录路径。
  for (const [r, p] of runtimeSources) {
    const t = sourceText(p);
    for (const [ar] of walkAssets()) {
      if (!/\.(html|css)$/i.test(ar)) continue;
      const hasDir = ar.includes('/');
      const needles = hasDir ? ['assets/' + ar, ar] : [ar, 'assets/' + ar];
      if (needles.some((n) => t.includes(n))) queue.push(ar);
    }
  }
  const resolveRel = (fromAssetRel, ref) => {
    ref = ref.split('?')[0].split('#')[0].trim();
    if (!ref || /^(https?:|data:|javascript:|neolink:|\/\/)/i.test(ref)) return null;
    const baseDir = path.posix.dirname(fromAssetRel);
    const joined = path.posix.normalize(path.posix.join(baseDir, ref));
    return joined.startsWith('..') ? null : joined;
  };
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const abs = path.join(ASSETS, cur);
    if (!fs.existsSync(abs)) continue;
    const text = sourceText(abs);
    const refs = [...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)]
      .map((m) => m[1] || m[2]);
    for (const ref of refs) {
      const target = resolveRel(cur, ref);
      if (!target) continue;
      if (walkSet().has(target)) { reached.add(target); if (/\.(html|css)$/i.test(target)) queue.push(target); }
    }
  }
  return reached;
}

let _walkCache = null, _walkSetCache = null;
function walkAssets() {
  if (_walkCache) return _walkCache;
  const out = [];
  (function w(d, rel = '') {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) w(p, r);
      else out.push([r, fs.statSync(p).size]);
    }
  })(ASSETS);
  _walkCache = out;
  return out;
}
function walkSet() {
  if (!_walkSetCache) _walkSetCache = new Set(walkAssets().map(([r]) => r));
  return _walkSetCache;
}

console.log('\n===== 「禁止凑数」资产引用审计 =====\n');
console.log(`staged 资产目录：${ASSETS}`);
console.log(`运行时源码文件：${runtimeSources.length} 个\n`);

const indirect = indirectReferencedAssets();
const unused = [];
let usedBytes = 0, unusedBytes = 0, usedCount = 0;
for (const [rel, size] of walkAssets()) {
  const direct = directRefs(rel);
  const isIndirect = indirect.has(rel);
  if (direct.length || isIndirect) {
    usedCount++; usedBytes += size;
    const why = direct.length ? `运行时引用 [${direct.slice(0, 2).join(', ')}]` : 'HTML/CSS 间接引用链';
    console.log(`  [USED]   ${rel}  ${(size / 1024).toFixed(0)} KB · ${why}`);
  } else {
    unusedBytes += size;
    unused.push([rel, size]);
    console.log(`  [UNUSED] ${rel}  ${(size / 1024).toFixed(0)} KB`);
  }
}

console.log(`\n  汇总：被引用 ${usedCount} 个 (${(usedBytes / 1048576).toFixed(1)} MiB) · ` +
  `零引用 ${unused.length} 个 (${(unusedBytes / 1048576).toFixed(1)} MiB)`);

// 显式豁免的（须在文档登记理由）不算失败
const hardUnused = unused.filter(([r]) => !ALLOW.has(r));
if (hardUnused.length) {
  console.log(`\n  ✗ 发现 ${hardUnused.length} 个「随包但零运行时引用」资产，合计 ` +
    `${(hardUnused.reduce((a, [, s]) => a + s, 0) / 1048576).toFixed(1)} MiB：`);
  for (const [r, s] of hardUnused) console.log(`      - ${r} (${(s / 1048576).toFixed(2)} MiB)`);
  console.log('\n  红线要求「每一字节都真实被调用」：这些资产未进入任何运行时加载链，属凑数，构建中止。');
  console.log('  处理方式：从 stage 复制白名单中剔除（源文件保留在仓库，可由生成脚本复现）。');
  console.log('  如确需豁免，用 --allow-unused 并必须在交付文档如实登记理由。\n');
  process.exit(1);
}
console.log('\n  ✓ 通过：staged 内每个资产都有真实运行时引用链（无凑数资产）\n');
process.exit(0);
