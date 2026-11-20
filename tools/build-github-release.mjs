// GitHub 开源目录编排器（v10.18.9 · 合规清洗版）
// 把 NeoCosmos 个人版的【可公开源码 + 完整许可 + 合规文档】编排到独立目录，供上传 GitHub。
// 红线：
//   · 不含企业版专有资产、签名私钥 / 证书 / 口令、安装包、大二进制权重与环境贴图；
//   · 不含内置知识库、内部交付 QA 文档、开发机专用探针 / 截图脚本、内部项目代号与绝对路径；
//   · 只含确实在源码/随包中真实使用的资产，不凑数。
// 用法：node tools/build-github-release.mjs [目标目录]
//   默认目标：D:/NeoCosmos-OpenSource
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || 'D:/NeoCosmos-OpenSource');

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

// 文件级硬排除：出现即跳过（按小写相对路径子串匹配）
const DENY_SUBSTR = [
  'signing', 'sign.ps1', 'make-test-cert.ps1', '.pfx', '.cer',
  'builtin-library', 'graph.bin',
  // 训练语料含开发机内部路径与开发对话，绝不能公开；权重/词表/manifest 为真实训练产物。
  'corpus.raw.txt', 'corpus.md.txt',
  'build-win.ps1', // 含明文测试证书密码，对外改用环境变量注入
  'preview-cosmos.html', 'preview-neocosmos-v2.html',
  'sprite/', 'sprite\\',
  'node_modules', 'build/', 'build\\', '交付/', '交付\\',
  // v10.18.7 合规清洗：内部 QA / 交付 / 开发机资产不进公开仓库
  'DELIVERY-NeoCosmos-', 'design-spec-v1.2.0',
  'gen-anatomy', 'verify-anatomy',
];

// 仅保留自包含、可在干净检出上通过的测试；依赖内部交付文档/大权重/开发机状态的契约脚本
// 属私有构建流水线，留在源项目，不随公开仓库分发。
const TEST_ALLOW = [
  'neuromorph.test.mjs', 'qs-keccak-fallback.test.mjs', 'quantum-mind.test.mjs',
  'sprite-contract.test.mjs', 'v10186-ui-syntax.test.mjs', 'v612-astra.test.mjs',
  'v6231-mcp-links.test.mjs', 'v629-reflow-recommend.test.mjs', 'v630-ram-model.test.mjs',
  'v634-verify-deeplink.test.mjs', 'v635-nav-settings-idspace.test.mjs',
  'v636-float-nav-outline.test.mjs', 'v637-vault-sync.test.mjs',
  'v638-card-tools.test.mjs', 'v639-ui-and-vault-overview.test.mjs',
  'v6401-active-vault.test.mjs', 'v641-tooltip.test.mjs', 'run-all.js',
  // v10.18.8：命令面板点击 / 能力展示撤下 / 移除墓碑清理三项回归，均为自包含契约测试。
  'v10188-cmd-result-click.test.mjs', 'v10188-no-capability-display.test.mjs',
  'v10188-removal-tombstones.test.mjs', 'v10189-install-finish-and-atlas.test.mjs',
];

// tools：保留构建 / 编排 / 门禁 / 资产生成脚本；剔除开发机专用 probe / shoot / e2e 调试脚本。
const TOOLS_ALLOW = [
  'VERSION-NOTES.txt', 'bench-kernel.mjs', 'bench-scale.mjs', 'bm25-hotword-test.mjs',
  // build-editions.mjs 为双版专有构建脚本（含本地测试证书口令回退），不进个人开源目录。
  'build-github-release.mjs', 'build-win.mjs',
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

const MAX_BYTES = 20 * 1024 * 1024; // GitHub 单文件 100MB 限制；大权重/贴图用脚本复现

// v10.18.7：skills/neocosmos 是个人版对外能力的一部分（外部 AI 接入工作流），随开源目录发布。
const TOP_DIRS = ['src', 'desktop', 'docs', 'legal', 'tools', 'test', 'skills'];
const TOP_FILES = [
  'LICENSE', 'LICENSES.md', 'NOTICE', 'README.md', 'README-OPEN-SOURCE.md',
  'PRIVACY.md', 'PUBLIC-RELEASE.md', 'CHANGELOG.md', 'SHA256SUMS.txt',
  'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'package.json',
];

let copied = 0, skipped = 0, bytes = 0;
const skipLog = [];

function denied(rel) {
  const r = rel.toLowerCase().replace(/\\/g, '/');
  return DENY_SUBSTR.some((s) => r.includes(s));
}

function copyFile(srcRel, dstRel) {
  if (denied(srcRel)) { skipped++; return; }
  const src = path.join(ROOT, srcRel);
  let st;
  try { st = fs.statSync(src); } catch { skipLog.push(`缺失：${srcRel}`); skipped++; return; }
  if (!st.isFile()) return;
  if (st.size > MAX_BYTES) { skipLog.push(`过大(${(st.size / 1048576).toFixed(1)}MB)：${srcRel}`); skipped++; return; }
  const dst = path.join(OUT, dstRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++; bytes += st.size;
}

function copyTree(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = relDir + '/' + entry.name;
    if (entry.isDirectory()) {
      if (denied(rel)) { skipped++; continue; }
      copyTree(rel);
    } else if (entry.isFile()) {
      if (relDir === 'test' && !TEST_ALLOW.includes(entry.name)) { skipped++; continue; }
      if (relDir === 'tools' && !TOOLS_ALLOW.includes(entry.name)) { skipped++; continue; }
      if (entry.name === 'CHANGELOG.md' && relDir === 'docs') { skipped++; continue; }
      copyFile(rel, rel);
    }
  }
}

if (fs.existsSync(OUT)) fail(`目标目录已存在，为防覆盖请先移除：${OUT}`);
fs.mkdirSync(OUT, { recursive: true });

for (const d of TOP_DIRS) copyTree(d);
for (const f of TOP_FILES) copyFile(f, f);

// GitHub 首页用开源说明（简洁、含授权），不用项目内部的开发日志版 README.md
copyFile('README-OPEN-SOURCE.md', 'README.md');

// 开源专属 .gitignore
fs.writeFileSync(path.join(OUT, '.gitignore'),
  ['node_modules/', 'build/', 'dist/', '交付/', '*.exe', '*.pfx', '*.cer',
    'desktop/assets/_model/*.nw', 'desktop/assets/builtin-library/', ''].join('\n'), 'utf8');
// LICENSES.md 的 CC-BY-SA 全文要点脚本随 legal 复制；不再额外生成内部文件。

console.log(`✓ 开源目录已生成：${OUT}`);
console.log(`  复制 ${copied} 个文件 · ${(bytes / 1048576).toFixed(1)} MB · 跳过 ${skipped} 项`);
if (skipLog.length) {
  console.log('  跳过明细（如实记录，均为大二进制 / 私钥 / 不随包资产）：');
  for (const s of skipLog.slice(0, 40)) console.log('    - ' + s);
  if (skipLog.length > 40) console.log(`    … 另 ${skipLog.length - 40} 项`);
}
