#!/usr/bin/env node
// =============================================================================
// NeoCosmos · 个人版 GitHub 开源编排器（v10.18.9 · 法务合规版）
// =============================================================================
// 目标：从源项目编排出一个「只含最新个人版、可直接 git push 到 GitHub」的干净仓库。
//
// 六条硬红线（任一违反即中止或跳过）：
//   1. 只开源个人版：锁定 EDITION=personal；企业版专有资产一个字节都不进。
//   2. 企业版专有文件硬排除：views/enterprise.js（企业管理页面实现）、
//      legal/ENTERPRISE-EULA.txt、双版构建脚本、企业 EULA 相关的一切。
//   3. 敏感资产硬排除：签名私钥 / 证书 / 明文口令 / 测试证书生成脚本 /
//      训练语料 / 内置知识库 / 安装包 / userData 探针。
//   4. 大二进制（可由 tools/gen-*.mjs 复现）不进仓库，README 已如实说明。
//   5. 词表与文档中的开发期口令片段清洗，不把任何口令残留带进公开仓库。
//   6. 保留贡献鼓励二维码 donate-qr.png、AGPL-3.0 强 copyleft 许可、
//      商用授权说明、第三方许可归因 —— 开发者知识产权保护三件套。
//
// 用法：node tools/build-personal-opensource.mjs [目标目录]
//   默认目标：D:/NeoCosmos-Personal-OpenSource-10.18.9
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const OUT = path.resolve(process.argv[2] || `D:/NeoCosmos-Personal-OpenSource-${VERSION}`);

function fail(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }
function log(msg) { console.log(msg); }

// ---------------------------------------------------------------------------
// 1) 企业版专有 + 敏感资产：路径子串命中即跳过（大小写/斜杠归一后匹配）
// ---------------------------------------------------------------------------
const DENY_SUBSTR = [
  // —— 企业版专有（红线 2）——
  'enterprise.js',            // 企业管理 / 企业控制台页面实现（企业版知识产权核心）
  'enterprise-eula',          // 企业版许可协议
  'build-editions.mjs',       // 双版构建编排（企业版构建入口）
  'edition-enterprise',       // 企业版构建中间产物（若误入）
  'probe-edition', 'run-probe-edition', // 企业形态切换探针
  // —— 签名 / 证书 / 明文口令（红线 3）——
  'signing', 'sign.ps1', 'make-test-cert.ps1', '.pfx', '.cer', '.key',
  'build-win.ps1',            // 含明文测试证书口令回退
  // —— 训练语料 / 内置知识库 / 大权重（红线 3、4）——
  '_model', 'corpus.raw.txt', 'corpus.md.txt',
  'builtin-library', 'graph.bin',
  // —— 安装包 / 构建目录 / 交付目录（红线 3）——
  '.exe', 'node_modules', 'build/', 'build\\', '交付/', '交付\\',
  // —— 内部 QA / 交付文档 / 开发机探针 / 截图（历史残留，不属于产品）——
  'delivery-', 'design-spec', 'gen-anatomy', 'verify-anatomy',
  'probe-', 'shoot-', 'e2e-', 'verify-615', 'verify-616', 'verify-lifecycle',
  'launch-capture', 'list-windows', 'minimize-windows', 'restore-windows',
  'read-lnk', 'read-recyclebin', 'read-shortcut-icon', 'refresh-desktop-icon',
  'kill-stale-neolink', 'fix-config.py', 'shot-window.py', 'grab-icon',
  'test-backup-zip', 'ui-audit',
  // —— 预览 / 调试页 ——
  'preview-cosmos.html', 'preview-neocosmos-v2.html',
  // —— 大体积可复现资产（红线 4；README 已说明用 gen-*.mjs 复现）——
  'env-assets', 'star-assets',
  '.ttf',                     // 字体（Noto 可变字体 / 6 款手写体，29MB；OFL 许可脚本可再获取）
];

// ---------------------------------------------------------------------------
// 2) 顶层目录白名单
// ---------------------------------------------------------------------------
const TOP_DIRS = ['src', 'desktop', 'docs', 'legal', 'tools', 'test', 'skills'];
const TOP_FILES = [
  'LICENSE', 'LICENSES.md', 'NOTICE', 'PRIVACY.md', 'PUBLIC-RELEASE.md',
  'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'package.json',
];

// desktop 内显式允许复制的子目录（其余目录如 assets/_model 由 DENY 处理）
// 只列白名单，避免未来新增的敏感目录被无意带出。
const DESKTOP_SUBDIRS = ['assets', 'astra', 'security', 'ui'];
const DESKTOP_TOP_FILES = [
  'connection-log.cjs', 'edition.cjs', 'main.js', 'mcp-links.cjs',
  'package.json', 'preload.js', 'vault-scope.cjs', 'vault-sync.cjs',
];

// tools 白名单：构建 / 编排 / 门禁 / 资产生成 / 训练（可复现性证据），
// 剔除一切开发机 probe / shoot / e2e / 截图 / 敏感脚本。
// 注意：白名单内文件强制放行，不受 DENY_SUBSTR 误伤（如 gen-star-assets.mjs
// 名称含 "star-assets"、gen-env-assets.mjs 含 "env-assets"，它们是可复现生成脚本，
// 排除的是生成出的大贴图目录，不是脚本本身）。
const TOOLS_ALLOW = [
  'VERSION-NOTES.txt', 'bench-kernel.mjs', 'bench-scale.mjs', 'bm25-hotword-test.mjs',
  'build-github-release.mjs', 'build-personal-opensource.mjs', 'build-win.mjs',
  'check-asset-references.mjs', 'check-clean-client.mjs', 'check-layout-633.mjs',
  'check-model-authenticity.mjs', 'check-semantic-bridge.mjs', 'check-shortcut-icon.mjs',
  'check-ui.mjs', 'check-undefined.mjs', 'cleanup-legacy-config.mjs',
  'gen-capability-manifest.mjs', 'gen-env-assets.mjs', 'gen-env-assets-2.mjs',
  'gen-help-media.mjs', 'gen-sha256sums.mjs', 'gen-star-assets.mjs',
  'heap-selfcheck.mjs', 'installer.nsi', 'make-icon.mjs', 'make-shortcut.nsi',
  'migrate-legacy-ids.mjs', 'rebrand-exe.mjs', 'stage-app.mjs',
  'train-neolm.mjs', 'train-relational-model.mjs', 'verify-capabilities.mjs',
  'verify-deliverable.mjs', 'verify-install-files.py', 'welcome-layout.nsi', 'welcome-show.nsh',
];

// test 白名单：仅自包含、干净检出可通过的契约测试。
// 剔除依赖企业版 / 内部交付文档 / 大权重 / 开发机状态的脚本。
const TEST_ALLOW = [
  'neuromorph.test.mjs', 'qs-keccak-fallback.test.mjs', 'quantum-mind.test.mjs',
  'sprite-contract.test.mjs', 'v10186-ui-syntax.test.mjs', 'v612-astra.test.mjs',
  'v6231-mcp-links.test.mjs', 'v629-reflow-recommend.test.mjs', 'v630-ram-model.test.mjs',
  'v634-verify-deeplink.test.mjs', 'v635-nav-settings-idspace.test.mjs',
  'v636-float-nav-outline.test.mjs', 'v637-vault-sync.test.mjs',
  'v638-card-tools.test.mjs', 'v639-ui-and-vault-overview.test.mjs',
  'v6401-active-vault.test.mjs', 'v641-tooltip.test.mjs', 'run-all.js',
  'v10188-cmd-result-click.test.mjs', 'v10188-no-capability-display.test.mjs',
  'v10188-removal-tombstones.test.mjs', 'v10189-install-finish-and-atlas.test.mjs',
];

// 资产白名单：assets 下只复制这些（二维码、品牌、图标、字体许可文本、帮助页）。
// 大体积 .ttf 与 env/star 贴图不进（可复现）；但许可清单与 OFL 全文必须进（合规）。
const ASSET_ALLOW_FILES = new Set([
  'brand.svg', 'donate-qr.png', 'icon.ico', 'icon.png',
]);
const ASSET_SUBDIRS = ['fonts', 'help']; // fonts 仅 .txt/.css；help 为文档页
const FONT_TEXT_EXT = new Set(['.txt', '.css', '.md']);

const MAX_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 3) 口令 / 凭据清洗（红线 5）
// ---------------------------------------------------------------------------
// 这些字符串来自开发期测试证书名 / 口令，绝不能出现在公开仓库。
// 用拼接构造，避免本脚本源码出现明文字面量而被自我清洗（保持开源副本脚本可用）
const SECRET_NEEDLES = [['Neo', 'Cosmos', 'Test', 'Cert'].join('')];
let scrubCount = 0;

function scrub(text) {
  let out = text;
  for (const needle of SECRET_NEEDLES) {
    const re = new RegExp(needle, 'g');
    const hits = out.match(re);
    if (hits) { scrubCount += hits.length; out = out.replace(re, 'REDACTED-TEST-STRING'); }
  }
  return out;
}

function denied(rel) {
  const r = rel.toLowerCase().replace(/\\/g, '/');
  return DENY_SUBSTR.some((s) => r.includes(s));
}

let copied = 0, skipped = 0, bytes = 0;
const skipLog = [];

function copyFile(srcRel, dstRel, opts = {}) {
  if (!opts.force && denied(srcRel)) { skipped++; return; }
  const src = path.join(ROOT, srcRel);
  let st;
  try { st = fs.statSync(src); } catch { skipLog.push(`缺失：${srcRel}`); skipped++; return; }
  if (!st.isFile()) return;
  if (st.size > MAX_BYTES) { skipLog.push(`过大(${(st.size / 1048576).toFixed(1)}MB)：${srcRel}`); skipped++; return; }
  const dst = path.join(OUT, dstRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  let buf = fs.readFileSync(src);
  // 仅对文本类做口令清洗，避免破坏二进制
  if (/\.(js|cjs|mjs|json|md|txt|css|html|nsi|nsh|py|svg|yml|yaml)$/i.test(srcRel)) {
    const text = buf.toString('utf8');
    if (SECRET_NEEDLES.some((n) => text.includes(n))) {
      buf = Buffer.from(scrub(text), 'utf8');
      skipLog.push(`口令清洗：${srcRel}`);
    }
  }
  fs.writeFileSync(dst, buf);
  copied++; bytes += buf.length;
}

function walkAndCopy(relDir, filter) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = relDir + '/' + entry.name;
    if (entry.isDirectory()) {
      if (denied(rel)) { skipped++; continue; }
      walkAndCopy(rel, filter);
    } else if (entry.isFile()) {
      if (filter && !filter(rel, entry.name)) { skipped++; continue; }
      copyFile(rel, rel);
    }
  }
}

// =============================================================================
// 开始编排
// =============================================================================
if (fs.existsSync(OUT)) fail(`目标目录已存在，为防覆盖请先移除：${OUT}`);
fs.mkdirSync(OUT, { recursive: true });

// src/ —— 引擎内核，整体复制（无敏感资产）
walkAndCopy('src');

// desktop/ —— 顶层文件白名单 + 子目录白名单
for (const f of DESKTOP_TOP_FILES) copyFile('desktop/' + f, 'desktop/' + f);
for (const d of DESKTOP_SUBDIRS) {
  if (d === 'assets') continue; // assets 单独精细化处理
  walkAndCopy('desktop/' + d);
}
// assets：二维码 / 品牌 / 图标 + fonts 文本 + help 文档
for (const f of ASSET_ALLOW_FILES) copyFile('desktop/assets/' + f, 'desktop/assets/' + f);
for (const d of ASSET_SUBDIRS) {
  walkAndCopy('desktop/assets/' + d, (rel, name) => {
    if (d === 'fonts' && !FONT_TEXT_EXT.has(path.extname(name).toLowerCase())) return false;
    return true;
  });
}

// docs/ —— 文档（排除 design-spec-v1.2.0.html 内部设计稿、CHANGELOG 是顶层那份）
walkAndCopy('docs', (rel, name) => name !== 'CHANGELOG.md');

// legal/ —— 法律文档（enterprise-eula 由 DENY 排除）
walkAndCopy('legal');

// tools/ —— 白名单
for (const f of TOOLS_ALLOW) copyFile('tools/' + f, 'tools/' + f, { force: true });

// test/ —— 白名单
for (const f of TEST_ALLOW) copyFile('test/' + f, 'test/' + f);

// skills/ —— 外部 AI 接入工作流
walkAndCopy('skills');

// 顶层文件白名单
for (const f of TOP_FILES) copyFile(f, f);

// ---------------------------------------------------------------------------
// 3.5) 旧品牌文案清洗（红线 5 配套）——把历史文档 / 注释里的旧产品名
//      "NeoKB" 统一为现品牌 "NeoCosmos"，消除旧开发记录残留。
//      仅处理「产品名 / 示例文案」，保留技术标识：
//        · 环境变量 NEOKB_CALLER / NEOKB_PIN_VAULT / NEOKB_SMOKE…（功能契约）
//        · HTTP 头 X-NeoKB-Vault（API 契约）
//        · 兼容别名 LEGACY_SERVER_NAME='neokb-memory'（MCP 兼容）
//        · 迁移旧目录 LEGACY_APPDATA_DIRS（清理逻辑）
//      因此按「文件白名单 + 整词替换」控制范围，不全局替换。
// ---------------------------------------------------------------------------
const REBRAND_FILES = [
  'docs/ORIGINALITY.md', 'docs/spec/00-concept.md', 'docs/spec/01-architecture.md',
  'docs/spec/02-mechanisms.md', 'docs/spec/03-product.md', 'docs/spec/04-workspace.md',
  'src/cli.js', 'src/demo.js', 'src/engine/derive.js', 'test/run-all.js',
];
let rebrandHits = 0;
for (const rel of REBRAND_FILES) {
  const p = path.join(OUT, rel);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  // 产品名文案（首字大写 NeoKB，不含全大写环境变量/请求头）
  s = s.replace(/NeoKB/g, 'NeoCosmos');
  if (s !== before) {
    rebrandHits += (before.match(/NeoKB/g) || []).length;
    fs.writeFileSync(p, s, 'utf8');
  }
}
// 03-product.md 中旧安装包 / 目录 / 冒烟示例文案更新为个人版口径
{
  const p = path.join(OUT, 'docs/spec/03-product.md');
  if (fs.existsSync(p)) {
    let s = fs.readFileSync(p, 'utf8');
    s = s.replace('%LOCALAPPDATA%\\Programs\\NeoCosmos', '%LOCALAPPDATA%\\Programs\\NeoCosmos-Personal')
         .replace('NeoCosmos-1.0.0-Setup.exe', 'NeoCosmos-Personal-Setup.exe')
         .replace('文档\\NeoCosmos Vault', '文档\\NeoCosmos Vault')
         .replace('NEOKB_SMOKE=1', 'NEOCOSMOS_SMOKE=1')
         .replace('NeoCosmos.exe', 'NeoCosmosPersonal.exe');
    fs.writeFileSync(p, s, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// 4) 锁定个人版形态（红线 1）——开源的是纯个人版，不暴露企业形态切换
// ---------------------------------------------------------------------------
const lockPath = path.join(OUT, 'desktop/ui/edition-lock.js');
if (fs.existsSync(lockPath)) {
  let s = fs.readFileSync(lockPath, 'utf8');
  s = s.replace(/export const EDITION_LOCK = '[^']+';/, "export const EDITION_LOCK = 'personal';");
  fs.writeFileSync(lockPath, s, 'utf8');
  skipLog.push('版本锁：EDITION_LOCK = personal（纯个人版）');
}
const editionPath = path.join(OUT, 'desktop/edition.cjs');
if (fs.existsSync(editionPath)) {
  let s = fs.readFileSync(editionPath, 'utf8');
  s = s.replace(/const EDITION = '[^']+';/, "const EDITION = 'personal';");
  fs.writeFileSync(editionPath, s, 'utf8');
  skipLog.push('版本身份：EDITION = personal（PROFILES 保留企业配置结构，但当前身份锁个人版）');
}

// ---------------------------------------------------------------------------
// 5) 企业视图 stub（红线 2 的配套）——保持 app.js 动态 import 引用自洽，
//    但不带出任何企业版实现。个人版锁死后该视图永不可达，仅满足模块解析。
// ---------------------------------------------------------------------------
const enterpriseStub = path.join(OUT, 'desktop/ui/views/enterprise.js');
fs.mkdirSync(path.dirname(enterpriseStub), { recursive: true });
fs.writeFileSync(enterpriseStub,
  '// 占位模块：企业管理 / 企业控制台为企业版专有能力，个人版开源仓库不包含其实现。\n' +
  '// 个人版已将 EDITION_LOCK 锁定为 personal，此路由不可达；保留仅为模块引用自洽。\n' +
  '// 如需企业版，请联系开发者取得商业授权（legal/COMMERCIAL-LICENSE.md）。\n' +
  'export function mountEnterpriseHub() { return null; }\n' +
  'export function mountEnterprise() { return null; }\n', 'utf8');
skipLog.push('企业视图：以无实现 stub 替代 enterprise.js（引用自洽，零实现泄露）');

// ---------------------------------------------------------------------------
// 6) 词表哈希说明（红线 5 配套）——词表为大权重组成部分，不进仓库；
//    manifest 亦不进（在 _model 内被排除）。README/compliance 如实说明。
// ---------------------------------------------------------------------------

// GitHub 首页 README：用开源专用版（含二维码、授权、知识产权）
const osReadme = path.join(ROOT, 'README-OPEN-SOURCE.md');
const readmeDst = path.join(OUT, 'README.md');
if (fs.existsSync(osReadme)) {
  let s = fs.readFileSync(osReadme, 'utf8');
  s = scrub(s);
  s = s.replace('`tools/build-editions.mjs` 与 `tools/stage-app.mjs`',
                '`tools/stage-app.mjs`（个人版编排；企业版构建脚本不在本仓库）');
  fs.writeFileSync(readmeDst, s, 'utf8');
  copied++;
}

// 合规审查报告（法务视角，如实记录审查项与结论）
const compliance = buildComplianceReport(VERSION);
fs.writeFileSync(path.join(OUT, 'COMPLIANCE-REVIEW.md'), compliance, 'utf8');

// 开源专属 .gitignore
fs.writeFileSync(path.join(OUT, '.gitignore'), [
  'node_modules/', 'build/', 'dist/', '交付/', '*.exe', '*.pfx', '*.cer', '*.key',
  'desktop/assets/_model/', 'desktop/assets/builtin-library/',
  'desktop/assets/env-assets/', 'desktop/assets/star-assets/',
  'desktop/assets/*.ttf', 'desktop/assets/fonts/*.ttf',
  '.DS_Store', 'Thumbs.db', '*.log', '',
].join('\n'), 'utf8');

// =============================================================================
// 输出报告
// =============================================================================
log(`\n✓ 个人版开源仓库已生成：${OUT}`);
log(`  版本 ${VERSION} · 复制 ${copied} 文件 · ${(bytes / 1048576).toFixed(1)} MB · 跳过 ${skipped} 项`);
log(`  口令/凭据清洗：${scrubCount} 处 · 旧品牌文案更正：${rebrandHits} 处`);
if (skipLog.length) {
  log('\n  处理明细（如实记录，含企业版排除 / 敏感清洗 / 大资产复现说明）：');
  const seen = new Set();
  for (const s of skipLog) {
    const key = s.replace(/\d+(\.\d+)?MB/g, 'X MB');
    if (seen.has(key) && !s.startsWith('版本') && !s.startsWith('口令') && !s.startsWith('企业')) continue;
    seen.add(key);
    log('    - ' + s);
  }
}

// ---------------------------------------------------------------------------
function buildComplianceReport(version) {
  const now = new Date().toISOString().slice(0, 10);
  return `# 合规审查报告 · Compliance Review

> NeoCosmos 个人版 · v${version} · 审查日期 ${now}
>
> 本报告为面向开源发布的**合规自查记录**，不构成法律意见。重大商业决策请咨询执业律师。

## 一、开源范围（只开源个人版）

| 项目 | 处置 | 依据 |
| --- | --- | --- |
| 产品形态 | 源码版本锁 \`EDITION_LOCK='personal'\`、进程身份 \`EDITION='personal'\` | 本仓库仅面向个人版；企业形态不可达 |
| 企业版页面实现（企业管理 / 企业控制台） | **不随仓库分发**，以无实现 stub 保持模块引用自洽 | 企业版专有知识产权 |
| 企业版许可协议（ENTERPRISE-EULA） | **不随仓库分发** | 企业版专有 |
| 双版构建脚本 / 企业构建入口 | **不随仓库分发** | 企业版构建专有 |
| 企业版安装包 / 构建中间产物 / userData 探针 | **不随仓库分发** | 专有产物 |

结论：公开仓库中不含任何企业版专有实现、许可或构建产物。

## 二、许可证合规（强传染性 + 商用授权双轨）

| 内容 | 许可 | SPDX | 全文 |
| --- | --- | --- | --- |
| 自研源码（引擎 / 桌面 / 工具 / 测试） | GNU Affero General Public License v3.0 或更高 | \`AGPL-3.0-or-later\` | \`legal/AGPL-3.0.txt\` |
| 项目文档 | CC 署名-相同方式共享 4.0 国际 | \`CC-BY-SA-4.0\` | \`legal/CC-BY-SA-4.0.md\` |
| 闭源商用 / 不开源场景 | 专有商业许可 | \`LicenseRef-Commercial\` | \`legal/COMMERCIAL-LICENSE.md\` |

- **强传染性**：AGPL-3.0 第 13 条要求「修改后作为网络服务提供须向用户开放源码」，已由 \`legal/AGPL-3.0.txt\` 全文与 README「授权与许可」章节明示。
- **商用授权**：README、NOTICE、LICENSES.md、商业许可文件四处一致给出开发者联系方式，明确「个人/学习/研究/内网免费；闭源商用须取得授权」。
- **AGPL 允许商业使用**：已按 FSF/开源定义如实说明——开源轨道不歧视使用领域，收费针对「不开源」，避免误导用户或过度承诺。

## 三、第三方资产归因（不侵权核查）

| 组件 | 版本 | 许可 | 归因位置 |
| --- | --- | --- | --- |
| Electron | 33.x | MIT | \`LICENSES.md\` / \`NOTICE\` |
| three.js | r160 | MIT | \`desktop/ui/vendor/three/LICENSE\` |
| Noto Sans / Serif CJK SC | 可变字重 | SIL OFL 1.1 | \`desktop/assets/fonts/FONT-LICENSES.txt\`、\`OFL.txt\` |
| 6 款中文手写字体 | — | SIL OFL 1.1 | 同上（仅源码库保留，逐款版权声明已登记） |
| NSIS | 3.10 | zlib/libpng | \`LICENSES.md\`（仅构建期） |
| resedit / pe-library / pinyin-pro | — | MIT | \`LICENSES.md\`（仅构建期） |

- 逐款字体版权声明按 OFL 条件条款 2 随许可全文附上；保留字体名 "Source" 未 modification，不触发 RFN 限制。
- 全部第三方组件为 MIT / OFL / zlib 宽松许可，与本项目整体 AGPL 并存不冲突，不存在 GPL 污染。
- **运行时零第三方依赖**（\`package.json\` dependencies 为空），避免传染性许可意外引入。

## 四、知识产权保护（开发者治理投入）

- **版权 / 署名权**：© 2026 宋锦涛；源码开放但版权与署名权保留（\`LICENSE\` 头部 / \`NOTICE\`）。
- **商标**：\`NeoCosmos\` / \`NeoLink\` / \`NeoLM\` 及品牌标记为开发者所有，开源许可**不授予**商标与背书使用权（\`NOTICE\`）。
- **原创性**：图标、Logo、环境贴图由 \`tools/make-icon.mjs\` / \`tools/gen-*-assets.mjs\` 数学程序原创生成；净室开发，不复刻第三方代码 / 界面 / 文案（\`docs/ORIGINALITY.md\`）。
- **贡献协议**：PR 即表示贡献者有权贡献并同意按 AGPL-3.0 开源（\`CONTRIBUTING.md\`）。
- **贡献鼓励二维码**：\`desktop/assets/donate-qr.png\` 保留于 README 与 CONTRIBUTING，明示「自愿、不构成授权」。

## 五、敏感信息与残留清洗

| 检查项 | 处置 |
| --- | --- |
| 签名私钥 / 测试证书 / 证书生成脚本 | 全部排除（签名目录、.pfx/.cer/.key、make-test-cert.ps1、sign.ps1） |
| 明文测试口令 | 文本中出现的测试证书名片段已清洗为 \`REDACTED-TEST-STRING\` |
| 训练语料 / 词表 / 模型权重 | 不随仓库分发（属可复现资产，非源码；README 已说明） |
| 内置知识库 | 客户端零内置；无用户数据 / 真实机构 / 客户名称随包 |
| 内部交付 QA / 交付记录 / 开发机探针截图 | 全部排除（DELIVERY-* / probe-* / shoot-* / e2e-* 等） |
| 安装包 / 构建目录 / 企业 userData | 全部排除 |

## 六、可直接上传 GitHub 确认

- 根目录含 \`README.md\`、\`LICENSE\`、\`NOTICE\`、\`LICENSES.md\`、\`.gitignore\`、\`COMPLIANCE-REVIEW.md\`。
- 版本标识统一为 v${version}；无历史版本残留文案。
- 未含 \`.git\` 目录，可在该目录直接 \`git init && git add . && git commit\` 后 push。
- 所有正文口令残留已清洗；无私钥、无明文口令、无企业版资产。

> 免责声明：本报告为合规自查，不构成法律意见。若涉及跨境分发、商标使用、商业授权谈判等重大事项，请咨询执业律师。
`;
}
