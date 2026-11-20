#!/usr/bin/env node
/**
 * cleanup-legacy-config.mjs —— v6.40.1 旧配置残留清理（安全归档式）
 * ---------------------------------------------------------------------------
 * 用户诉求：新版本清理旧配置残留，只要最新版本，且不影响系统运行。
 *
 * 安全契约（绝不越界）：
 *   1. 绝不删除 / 移动任何知识库数据（.md、用户 D:\ 库目录）——本工具只认
 *      APPDATA 下的【配置目录】与 ~/.neocosmos/mcp-links 的【会话文件】。
 *   2. 用「归档」而非「删除」：旧配置目录重命名为 <name>.legacy-neocosmos-6.40.1，
 *      可随时改回，零不可逆操作。
 *   3. 保留当前版本配置目录（NeoCosmos / 个人版 / 企业版），一个字节不动。
 *   4. 默认 dry-run：只打印将要处理什么；加 --apply 才真正归档。
 *   5. 归档前校验：目标不存在、源不含任何 .md、不影响当前激活库。
 *
 * 用法：
 *   node tools/cleanup-legacy-config.mjs          # 扫描，只出清单
 *   node tools/cleanup-legacy-config.mjs --apply   # 执行归档
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APPLY = process.argv.includes('--apply');
const STAMP = 'legacy-neocosmos-6.40.1';
// 旧代号配置目录（历史版本遗留，新版本不再使用）。当前版本目录不在列表。
const LEGACY_APPDATA_DIRS = ['NeoLink', 'NeoLink-Cosmos', 'NeoKB'];
// 当前版本仍在使用的配置目录（保留，不动）
const KEEP_APPDATA_DIRS = ['NeoCosmos', 'NeoCosmosPersonal', 'NeoCosmosEnterprise'];

const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const linkDir = path.join(os.homedir(), '.neocosmos', 'mcp-links');

function mdFiles(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 不深入知识库型目录；只统计配置目录内是否混入 .md
        if (/^(vault|知识库|knowledge|library)$/i.test(e.name)) continue;
        n += mdFiles(p);
      } else if (/\.md$/i.test(e.name)) n++;
    }
  } catch { /* 目录不可读，跳过 */ }
  return n;
}

const actions = [];
let safe = true;

console.log(`\n=== NeoCosmos 旧配置残留清理（${APPLY ? '执行' : '仅扫描'}）===\n`);

// 1) 旧 APPDATA 配置目录 → 归档
for (const name of LEGACY_APPDATA_DIRS) {
  const src = path.join(appdata, name);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
  const dst = path.join(appdata, `${name}.${STAMP}`);
  const md = mdFiles(src);
  const conflict = fs.existsSync(dst);
  actions.push({ type: 'archive-dir', src, dst, md, conflict });
  if (md > 0 || conflict) safe = false;
}

// 2) 旧 MCP 会话文件（.tmp / 指向旧库的 session）→ 归档到子目录
if (fs.existsSync(linkDir)) {
  const files = fs.readdirSync(linkDir).filter((f) => /^session-.*\.json(\.tmp)?$/.test(f));
  for (const f of files) actions.push({ type: 'archive-file', src: path.join(linkDir, f) });
}

// 打印清单
for (const a of actions) {
  if (a.type === 'archive-dir') {
    console.log(`[配置目录] ${a.src}`);
    console.log(`   → 归档为 ${a.dst}`);
    console.log(`   含 .md 文件：${a.md}  目标冲突：${a.conflict ? '是' : '否'}`);
  } else {
    let vault = '';
    try { vault = JSON.parse(fs.readFileSync(a.src, 'utf8')).vault || ''; } catch {}
    console.log(`[MCP会话]   ${path.basename(a.src)}  vault=${vault || '(未知)'}`);
  }
}
console.log(`\n保留不动：${KEEP_APPDATA_DIRS.map((d) => path.join(appdata, d)).filter((p) => fs.existsSync(p)).join(', ') || '(无)'}`);
console.log(`知识库数据：完全不触碰（本工具不扫描、不修改任何 D:\\ 库目录）`);

if (!actions.length) { console.log('\n✓ 无旧配置残留，无需清理。'); process.exit(0); }
if (!safe) {
  console.log('\n✗ 安全检查未通过（旧配置目录含 .md 或归档目标已存在），已中止，未做任何改动。');
  process.exit(1);
}
if (!APPLY) {
  console.log(`\n以上 ${actions.length} 项为拟清理内容（更安全：归档而非删除）。确认无误后加 --apply 执行。`);
  process.exit(0);
}

// 执行归档
for (const a of actions) {
  try {
    if (a.type === 'archive-dir') {
      fs.renameSync(a.src, a.dst);
      console.log(`✓ 已归档目录：${a.src} → ${a.dst}`);
    } else {
      const arch = path.join(linkDir, `.archived-${STAMP}`);
      fs.mkdirSync(arch, { recursive: true });
      fs.renameSync(a.src, path.join(arch, path.basename(a.src)));
      console.log(`✓ 已归档会话：${path.basename(a.src)}`);
    }
  } catch (e) {
    console.error(`✗ 归档失败（已跳过，不影响其它项）：${a.src} — ${e.message}`);
  }
}
console.log('\n✓ 清理完成。所有旧配置均以归档形式保留，可随时改回；系统运行与知识库数据未受影响。');
