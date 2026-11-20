// 资源编排：把「引擎 src/ + 桌面壳 desktop/ + UI + 本地 three.js + 示例语料」
// 组装进 Electron 的 resources/app
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
// v7.0.0：允许外部指定electron基目录（双版本构建时为 electron-personal / electron-enterprise 各自编排）。
const ELECTRON_DIR = process.env.STAGE_ELECTRON_DIR
  ? path.resolve(process.env.STAGE_ELECTRON_DIR)
  : path.join(ROOT, 'build', 'win', 'electron-v33.0.0');
const APP_DIR = path.join(ELECTRON_DIR, 'resources', 'app');

function ensure(d) { fs.mkdirSync(d, { recursive: true }); }

function copyDir(src, dst, filter) {
  ensure(dst);
  let n = 0, bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (filter && !filter(e.name, s)) continue;
    if (e.isDirectory()) {
      const r = copyDir(s, d, filter);
      n += r.files; bytes += r.bytes;
    } else {
      const st = fs.statSync(s);
      fs.copyFileSync(s, d);
      n++; bytes += st.size;
    }
  }
  return { files: n, bytes };
}

const onlyJs = (name, p) => /\.(js|mjs|json|md)$/i.test(name) || fs.statSync(p).isDirectory();

const ENGINES_ONLY = '.md';

// ---------------- importmap CSP 哈希注入 ----------------
// index.html 中的 importmap 必须是内联脚本，而 CSP 收紧到 script-src 'self' 会拦掉它。
// 这里在编排阶段计算其精确 SHA-256 并写回 CSP —— 既不放宽策略，也不怕以后改映射内容。
//
// v2.2.1 关键修复：**哈希必须按"浏览器看到的文本"来算，而不是按文件原始字节**。
//
// 背景：HTML 解析器会把源码里的 CRLF 归一化成 LF 再交给脚本。
// 而 CSP 的 script-src 哈希是对**解析后的脚本文本**算的。
// 所以若 index.html 是 CRLF 行尾（Windows 上大多数编辑器的默认），
// Node 按 CRLF 字节算出的哈希 ≠ 浏览器按 LF 文本算出的哈希 ——
// 结果是 importmap 内联脚本被 CSP 拦下，**整个应用都加载不出 three**：
// 星图空白、覆盖视图报"视图加载失败"，而且**不报任何明显的错**。
// 这种问题在开发机（文件恰好是 LF）上根本复现不了，一换机器就炸。
//
// 处置：
//   ① 哈希前把行尾统一归一化成 LF —— 与浏览器行为一致；
//   ② 写回时把整个文件也归一化成 LF —— 让源码与哈希长期保持一致；
//   ③ 写完立刻**复核**一次哈希是否真的出现在 CSP 里，不一致就让构建失败
//      （宁可构建失败，也不能悄悄产出一个坏包）。
function normalizeEol(s) { return s.replace(/\r\n/g, '\n'); }

function injectImportMapHash(appDir) {
  const file = path.join(appDir, 'ui', 'index.html');
  // v6.18.0：源 index.html 本身已带正确哈希（直接启动时不会被 CSP 拦），
  // 这里做**幂等重算**：解析 CSP 指令 → 移除所有旧 sha256 项 → 写入唯一当前项。
  // 旧实现的 `replace(/script-src 'self'/, ...)` 在源已带哈希时会追加第二份，
  // 且复核只查字符串出现过、不查它是否落在 script-src 指令内（假通过）。
  const rawHtml = fs.readFileSync(file, 'utf8');
  // v6.30.0：CSP 哈希须按归一化 LF 计算（与浏览器一致），但**写回必须保留源文件
  // 原始行尾**，否则 staged 的 index.html 会从 CRLF 变成 LF，破坏「staged 与源码
  // 逐字同源」这一防夹带契约（v628 交叉校验会失败）。哈希 token 与行尾无关，
  // 故写回前按原风格还原即可：功能零影响，同源契约不破。
  const hadCrlf = /\r\n/.test(rawHtml);
  let html = normalizeEol(rawHtml);
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!m) { console.error('  ✗ 未找到 importmap，无法注入 CSP 哈希'); process.exit(1); }
  // 与浏览器一致：先归一化行尾，再算哈希
  const inner = normalizeEol(m[1]);
  const hash = crypto.createHash('sha256').update(inner, 'utf8').digest('base64');
  const token = `'sha256-${hash}'`;

  const cspRe = /(<meta http-equiv="Content-Security-Policy"[\s\S]*?content=")([^"]*)(")/;
  const cm = html.match(cspRe);
  if (!cm || !/script-src/.test(cm[2])) {
    console.error('  ✗ CSP 缺少 script-src 指令，无法注入 importmap 哈希');
    process.exit(1);
  }
  const parts = cm[2].split(';').map((s) => s.trim());
  const idx = parts.findIndex((p) => p.startsWith('script-src'));
  const tokens = parts[idx].split(/\s+/).filter((t) => t && !/^'sha256-/.test(t));
  if (!tokens.includes(token)) tokens.push(token);
  parts[idx] = tokens.join(' ');
  html = html.replace(cspRe, (_all, a, _csp, d) => a + parts.join('; ') + d);
  fs.writeFileSync(file, hadCrlf ? html.replace(/\n/g, '\r\n') : html, 'utf8');

  // 复核：重新读回，按同样规则再算一次，并断言哈希**唯一且落在 script-src 内**
  const check = fs.readFileSync(file, 'utf8');
  const m2 = check.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!m2) { console.error('  ✗ 复核失败：写回后找不到 importmap'); process.exit(1); }
  const hash2 = crypto.createHash('sha256').update(normalizeEol(m2[1]), 'utf8').digest('base64');
  const csp2 = (check.match(cspRe) || [])[2] || '';
  const scriptSrc = (csp2.split(';').map((s) => s.trim()).find((p) => p.startsWith('script-src')) || '');
  const shaTokens = scriptSrc.split(/\s+/).filter((t) => /^'sha256-/.test(t));
  if (hash2 !== hash || shaTokens.length !== 1 || shaTokens[0] !== `'sha256-${hash2}'`) {
    console.error('  ✗ 复核失败：script-src 里的哈希与实际 importmap 内容对不上');
    console.error(`     期望唯一 sha256-${hash2}，实际 ${shaTokens.length} 项：${shaTokens.join(',')}`);
    console.error('     —— 构建中止：这样的包装到用户机器上会整个加载不出 three。');
    process.exit(1);
  }
  console.log(`  CSP      importmap sha256-${hash.slice(0, 16)}… 幂等重算并复核通过（script-src 唯一）`);
}

console.log('=== NeoCosmos 桌面版 · 资源编排 ===');
ensure(APP_DIR);

// 1) 桌面壳
ensure(APP_DIR);
// v6.22.0：链接 API 真实访问日志模块（主进程直接 require，漏了会启动即崩）
// v6.23.0：连接作用域模块同样被主进程直接 require，必须随壳一起复制。
// v6.23.1：MCP 外部平台链接登记模块被主进程 require，且被 src/mcp/link-bridge.js
//   从 app 根以 ../../mcp-links.cjs 定位 —— 漏拷会让 MCP Server 静默不登记。
// v6.37.0：企业版知识库 API 自动同步器 vault-sync.cjs 被主进程直接 require，
//   漏拷会启动即崩（Cannot find module './vault-sync.cjs'）。
// v6.40.0：edition.cjs 为版本身份配置（个人/企业/融合），主进程 require；
// 下方按 EDITION 覆写其内容，实现两版进程身份 / 数据目录 / 协议隔离。
for (const f of ['main.js', 'preload.js', 'package.json', 'connection-log.cjs', 'vault-scope.cjs', 'mcp-links.cjs', 'vault-sync.cjs', 'edition.cjs']) {
  fs.copyFileSync(path.join(ROOT, 'desktop', f), path.join(APP_DIR, f));
  console.log(`  shell    ${f}`);
}

// 1b) v6.2.0 企业专属：原创抗量子（后量子）防护层，零第三方依赖。
//     完整性基线不放在源码目录，而在下面第 10 步基于 staged 产物生成 ——
//     源码与产物一旦漂移，运行时自检会立刻发现。
const sec = copyDir(path.join(ROOT, 'desktop', 'security'), path.join(APP_DIR, 'security'));
console.log(`  security ${sec.files} files · ${(sec.bytes / 1024).toFixed(0)} KB (QS-Shield, original)`);

// 1c) v6.11：ASTRA 自主意识内核 + 桌面漫游引擎（CJS，主进程直接 require）
const astra = copyDir(path.join(ROOT, 'desktop', 'astra'), path.join(APP_DIR, 'astra'));
console.log(`  astra    ${astra.files} files · ${(astra.bytes / 1024).toFixed(0)} KB (mind + motion, original)`);

// 2) UI 层（含风格、模块、视图）
// 清理被新架构取代的旧视图（精确删除已知文件名，不做任何递归清理）
const LEGACY_VIEWS = ['nebula.js', 'recall.js', 'compose.js', 'console.js', 'sleep.js'];
let removedLegacy = 0;
for (const name of LEGACY_VIEWS) {
  const p = path.join(APP_DIR, 'ui', 'views', name);
  if (fs.existsSync(p)) { fs.unlinkSync(p); removedLegacy++; }
}
if (removedLegacy) console.log(`  清理     ${removedLegacy} 个旧视图文件`);

// v6.16 真实性：preview-cosmos.html 是内部设计稿，页面数值由 Math.random 生成。
// v6.21.0：新增的 preview-neocosmos-v2.html 同为内部设计稿，卡片数 / 突触数 /
// 状态栏读数全是排版占位。两者都不是产品功能、也没有任何入口；曾随 ui/ 整目录
// 复制进发布包，容易被当成「假功能 / 真实读数」——一并排除，并清掉旧编排目录
// 里可能残留的副本（v6.21 首次编排时 staged 里确实残留了 01:10 的旧预览页）。
const PREVIEW_PAGES = ['preview-cosmos.html', 'preview-neocosmos-v2.html'];
// v6.41.0：桌面精灵（Cosmos 精灵悬浮窗）按用户要求从交付包移除。
// 精灵渲染源码 desktop/ui/sprite/ 保留在仓库（历史契约测试 / 可复现性需要），
// 但整目录不随客户端编排分发；运行时的 window/IPC/入口均已移除。
const ui = copyDir(path.join(ROOT, 'desktop', 'ui'), path.join(APP_DIR, 'ui'),
  (name) => !PREVIEW_PAGES.includes(name) && name !== 'sprite');
let purged = 0;
for (const page of PREVIEW_PAGES) {
  const leak = path.join(APP_DIR, 'ui', page);
  if (fs.existsSync(leak)) { fs.rmSync(leak); purged++; }
}
// 清掉旧编排目录里可能残留的精灵目录（历史版本 stage 过，避免随包残留）
const spriteLeak = path.join(APP_DIR, 'ui', 'sprite');
if (fs.existsSync(spriteLeak)) { fs.rmSync(spriteLeak, { recursive: true, force: true }); purged++; }
if (purged) console.log(`  - 清除 ${purged} 个内部设计预览页 / 精灵目录（不随包交付）`);
console.log(`  ui       ${ui.files} files · ${(ui.bytes / 1024).toFixed(0)} KB`);

// 3) 本地 three.js（离线可用，绝不走 CDN）
const three = copyDir(path.join(ROOT, '3d-viz', 'vendor', 'three'), path.join(APP_DIR, 'ui', 'vendor', 'three'));
console.log(`  three    ${three.files} files · ${(three.bytes / 1024).toFixed(0)} KB (vendored, offline)`);

// 4) 引擎内核（复用单一实现）
// Electron 33 在本机不支持 ESM 主进程，因此外壳为 CJS；引擎目录保留 ESM 标记，
// 由主进程以动态 import() 载入。这样「一份引擎源码」同时被 CLI(Node ESM) 与 桌面版(CJS 外壳) 共用。
const eng = copyDir(path.join(ROOT, 'src'), path.join(APP_DIR, 'src'), onlyJs);
fs.writeFileSync(path.join(APP_DIR, 'src', 'package.json'),
  JSON.stringify({ name: 'neokb-engine', type: 'module', private: true }, null, 2), 'utf8');
console.log(`  engine   ${eng.files} files · ${(eng.bytes / 1024).toFixed(0)} KB (ESM, dynamically imported)`);

// 5) 品牌资源 —— v6.30.0「禁止凑数」：改为显式白名单，只打包【运行时真实加载】的资产。
// ---------------------------------------------------------------------------
// 红线背景：此前无条件递归复制 assets 整个目录，导致一批「随包但从未被客户端
// 加载」的大文件混入安装包（星云/法线/星场贴图、未引入的手写字体、从未打开的
// help 页与配图、生成脚本用的 manifest 等，合计约 412 MiB）——这属于用未调用
// 资产凑体积，与用户「每一字节都真实被调用、禁止凑数」红线冲突。
//
// 处置：只有下列经 tools/check-asset-references.mjs 逐项核实、确实进入运行时
// 加载链的资产才随包分发；其余全部剔除，但【源文件一律保留在 desktop/assets】，
// 由 tools/gen-*-assets.mjs 生成脚本随时可复现，不影响任何真实功能。
//
// 白名单逐项理由（运行时引用点）：
//   · brand.svg                          主进程 + 标题栏品牌标记 (main.js/ui/app.js)
//   · icon.ico                           main.js / NSIS MUI_ICON / exe 品牌图标
//   · NotoSansSC-VF.ttf                  styles.css @font-face（正文中文）
//   · NotoSerifSC-VF.ttf                 styles.css @font-face（标题中文）
// v6.41.0：env-assets/env_cosmos_a_4096x2048.png 曾仅被桌面精灵 sprite3d.js 引用，
// 精灵删除后已无运行时引用，从随包白名单移除（源文件保留仓库可复现）。
// 凡新增资产，必须先在运行时代码里真实引用，并同步加入此白名单与下文门禁校验。
const assetsDir = path.join(ROOT, 'desktop', 'assets');
const assetsOut = path.join(APP_DIR, 'assets');
// 先清空 staged 的旧 assets（含历史残留的 builtin-library / 未调用大贴图），确保纯净重建。
fs.rmSync(assetsOut, { recursive: true, force: true });
ensure(assetsOut);
const ASSET_ALLOWLIST = [
  'brand.svg',
  'icon.ico',
  // 关于页「鼓励贡献」弹层真实加载的收款二维码（运行时引用）。
  'donate-qr.png',
  'NotoSansSC-VF.ttf',
  'NotoSerifSC-VF.ttf',
  // v6.40.0 合规：字体 OFL 1.1 许可证与逐款版权声明随包（OFL 条件条款 2 要求）
  'fonts/OFL.txt',
  'fonts/FONT-LICENSES.txt',
  // v6.41.0：env-assets 高清环境贴图（原精灵 3D 专用）已移除：精灵删除后无运行时引用。
  // v6.30.0 原创 RAM 关联模型的真实训练权重（link-recommender.js 运行时只读加载，
  // 带 modelHash 校验 + 失败降级；非知识库数据，仅 3.6KB 权重/指标/来源元数据）。
  '_model/relational-model.json',
  // v6.31.0 NeoLM 真实训练权重（1.50 GiB）。四份资产全部由 src/cognition/neolm/
  // runtime.js 的 MODEL_ASSETS 常量在运行时真实读取；大权重按行随机访问，不整块进内存。
  // 逐项引用链由 tools/check-asset-references.mjs 校验，真实性由
  // tools/check-model-authenticity.mjs 校验，缺一即中止构建。
  '_model/neolm/neolm.emb.nw',
  '_model/neolm/neolm.out.nw',
  '_model/neolm/neolm.vocab.json',
  '_model/neolm/neolm.manifest.json',
];
let assetFiles = 0;
for (const rel of ASSET_ALLOWLIST) {
  const src = path.join(assetsDir, rel);
  if (!fs.existsSync(src)) {
    console.error(`  ✗ 白名单资产缺失：${rel}`);
    process.exit(1);
  }
  const out = path.join(assetsOut, rel);
  ensure(path.dirname(out));
  fs.copyFileSync(src, out);
  assetFiles++;
}
// 双保险：builtin-library（内置知识库）与 examples/corpus（演示语料）绝不随包。
fs.rmSync(path.join(assetsOut, 'builtin-library'), { recursive: true, force: true });
console.log(`  assets   ${assetFiles} 个「运行时真实引用」资产（禁止凑数白名单；源文件保留仓库可复现）`);

// 6) 示例知识网络 —— v6.29.0 红线：纯净客户端不随包分发任何知识库内容。
//    此前会把 3d-viz/vault/_memory/semantic 的 55 张演示卡复制进
//    resources/app/examples/corpus（可被 vault:loadExample 一键写进用户库），
//    严格按用户红线已停止随包分发：源卡保留在仓库供「独立演示语料包」另行分发，
//    不进安装包。vault:loadExample / vault:exampleInfo 通道仍保留，
//    在无 corpus 时如实返回 available:false（优雅降级，不报错、不伪造）。
const corpusOut = path.join(APP_DIR, 'examples', 'corpus');
// 双保险：清除历史残留，确保纯净客户端绝不含任何随包知识库内容。
fs.rmSync(corpusOut, { recursive: true, force: true });
console.log(`  example  已排除示例语料随包分发（纯净客户端零内置知识库内容）`);

// 7) 许可与声明随包
for (const f of ['LICENSES.md', 'README.md']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(APP_DIR, f));
}

// 7.5) CSP 哈希
injectImportMapHash(APP_DIR);

// 7.6) v7.0.0：写死版本形态锁（both / personal / enterprise）。
//      默认 both（应用内可自由切换）；双版本构建分别传 personal / enterprise，
//      使个人版锁定「星图为主图谱」、企业版保留全部功能（含企业管理）。
const EDITION = (process.env.EDITION || 'both').toLowerCase();
if (!['both', 'personal', 'enterprise'].includes(EDITION)) {
  console.error(`  ✗ 非法 EDITION=${EDITION}（应为 both / personal / enterprise）`);
  process.exit(1);
}
// v6.28.0：模板与 desktop/ui/edition-lock.js 逐字一致（both 时可直接 cmp 同源），
// 避免源码与编排产物出现两份不同的形态说明。
fs.writeFileSync(path.join(APP_DIR, 'ui', 'edition-lock.js'),
  `// 版本形态锁（v7.0.0）\n` +
  `// 取值：'both' | 'personal' | 'enterprise'\n` +
  `//   both       —— 应用内可自由切换个人版 / 企业版（开发 / 通用分发默认）\n` +
  `//   personal   —— 锁定个人版：星图（graph）为主图谱，企业管理等企业能力不可见\n` +
  `//   enterprise —— 锁定企业版：保留全部功能（含星系 / 3D 智脑 / 企业管理）\n` +
  `// 此文件由 tools/stage-app.mjs 在构建期根据 EDITION 环境变量覆写，勿手工长期编辑。\n` +
  `export const EDITION_LOCK = '${EDITION}';\n`, 'utf8');
console.log(`  edition  EDITION_LOCK = ${EDITION}`);

// 7.7) v6.40.0：把主进程版本身份配置 edition.cjs 覆写为当前形态。
//      源码默认 both；两版构建写入 personal / enterprise，使进程身份、
//      userData 目录、外部协议、关于信息全部随客户端独立。
//      只替换 `const EDITION = '...';` 这一行的取值，其余结构与源码一致。
{
  const src = fs.readFileSync(path.join(ROOT, 'desktop', 'edition.cjs'), 'utf8');
  const out = src.replace(/const EDITION = '[a-z]+';/, `const EDITION = '${EDITION}';`);
  if (out === src && EDITION !== 'both') {
    console.error('  ✗ edition.cjs 的 EDITION 常量覆写失败（未找到匹配行）');
    process.exit(1);
  }
  fs.writeFileSync(path.join(APP_DIR, 'edition.cjs'), out, 'utf8');
  console.log(`  edition  主进程身份 = ${EDITION}（edition.cjs 已覆写）`);
}

// 8) 校验必须存在的入口
const must = [
  'main.js', 'preload.js', 'package.json',
  'ui/index.html', 'ui/app.js', 'ui/styles.css', 'ui/cosmos.js',
  // v6.9.0 AURORA：设计令牌层与外观控制器缺一不可，漏了会静默退回旧界面
  'ui/design-system.css', 'ui/appearance.js',
  // v6.16 NORTHSTAR：第三代设计层缺了会静默退回旧观感
  'ui/aurora-pro.css', 'ui/northstar.css', 'ui/views/capabilities.js',
  // v6.21.0 Quiet Cosmos v7：第四代视觉层漏了同样会静默退回 6.20 观感
  'ui/neocosmos-v2.css',
  // v6.22.0：链接管理页 + 真实访问日志模块，缺任一个都会让企业版点击后报错
  'ui/views/connections.js', 'connection-log.cjs',
  // v6.23.0：按库连接作用域 + 沉淀回写仓库（缺了主进程启动即崩 / 沉淀台丢配置入口）
  'vault-scope.cjs', 'ui/views/settle.js',
  // v6.23.1：MCP 平台链接登记（主进程 require + MCP Server 从 app 根定位）
  'mcp-links.cjs', 'src/mcp/link-bridge.js',
  // v6.37.0：企业版知识库 API 自动同步器（主进程 require + 完整性基线）
  'vault-sync.cjs',
  // v6.38.0：原创增强——收藏/近期单一数据源 + 收藏夹视图（缺则命令面板入口白屏）
  'ui/card-tools.js', 'ui/views/starred.js',
  // v6.39.0：全库总览（星图 / 命令面板 / 设置三处入口共用，缺则白屏）
  'ui/views/vault-overview.js',
  // v6.27.0：语义配色单一真源（8 个视图共同 import，漏拷会让多个页面同时加载失败）
  'ui/semantic-palette.js',
  'astra/deep-math.cjs',
  // v6.10：好莱坞级「星图诞生」开机动画（WebGL）
  'ui/boot-cosmos.js',
  'ui/vendor/three/build/three.module.js',
  'src/storage/store.js', 'src/mcp/tools.js', 'src/viz/graph-export.js',
  'src/consolidation/consolidate.js', 'src/engine/diffusion.js',
  'src/cognition/index.js', 'src/cognition/quantum-mind.js', 'src/cognition/quantum-cognition.js', 'src/cognition/neuromorph.js',
  // v6.29.0 功能②：辅助建立知识关联（真实信号推荐，缺了关联页"建议关联"入口会报错）
  'src/cognition/link-recommender.js',
  // v6.30.0 原创 RAM 关联模型：模型定义 + 可信加载器 + 真实训练权重，三者缺一即无法真实推理
  'src/cognition/relational-model.js',
  'src/cognition/relational-runtime.js',
  'assets/_model/relational-model.json',
  // v6.31.0 NeoLM：内核 + 运行时 + 四份真实训练产物，缺任一即无法真实推理
  'src/cognition/neolm/core.js',
  'src/cognition/neolm/runtime.js',
  'ui/views/neolm.js',
  'assets/_model/neolm/neolm.emb.nw',
  'assets/_model/neolm/neolm.out.nw',
  'assets/_model/neolm/neolm.vocab.json',
  'assets/_model/neolm/neolm.manifest.json',
  // v6.32.0 语义回流层：内核 + 新视图缺任一即「语义关联」页白屏 / 三条链路失效
  'src/cognition/semantic-bridge.js',
  'ui/views/semantic-bridge.js',
  'ui/views/mind3d.js', 'ui/brain3d.js',
  // v6.41.0：桌面精灵 5 文件已从随包 must-list 移除（用户要求删除桌面精灵）。
  // 源码保留在 desktop/ui/sprite/ 供历史契约测试复现，但不进交付包。
  // v6.35.0 全原创三项导航：设置页 + 星位布局，缺一则导航缺项 / 星图默认布局失效
  'ui/views/settings.js',
  // v6.11 ASTRA：主进程内核、漫游引擎、主窗口意识中枢视图缺一不可
  'astra/astra-mind.js', 'astra/astra-motion.js', 'ui/views/astra.js',
  'assets/icon.ico',
];
let bad = 0;
for (const f of must) {
  const p = path.join(APP_DIR, f);
  if (!fs.existsSync(p)) { console.error(`  ✗ 缺失 ${f}`); bad++; }
}
// 负向校验：交付物里不允许出现任何带演示数值的内部设计稿
for (const page of PREVIEW_PAGES) {
  if (fs.existsSync(path.join(APP_DIR, 'ui', page))) {
    console.error(`  ✗ 演示预览页 ${page} 仍留在发布包中`); bad++;
  }
}
if (bad) { console.error('资源编排失败：缺少关键文件'); process.exit(1); }

// 9) 版本戳
const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(APP_DIR, 'BUILD.txt'), [
  `NeoCosmos Desktop v${pkg.version}`,
  `built at ${new Date().toISOString()}`,
  `engine: src/ (local-first, zero third-party runtime deps)`,
  `renderer: ui/ (custom protocol neolink://, offline)`,
  `three.js: ui/vendor/three (vendored, offline)`,
  `security: QS-Shield (post-quantum, original, zero third-party deps)`,
  `cognition: src/cognition (本项目自研认知常量 + 零依赖深加工算法)`,
].join('\n'), 'utf8');

// 10) v6.2.0：抗量子防护层的完整性基线
//     复用 staged 的 QS-Shield 模块本身来算（同源编译纪律：不手抄第二份哈希逻辑），
//     对 staged 产物而非源码计算，避免「源码改了、基线没跟着改」的假通过。
const QS = require(path.join(APP_DIR, 'security', 'quantum-safe.js'));
const manifest = QS.buildManifest(APP_DIR, pkg.version);
fs.writeFileSync(path.join(APP_DIR, 'security', 'integrity.json'),
  JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`  qs-shield 完整性基线 ${manifest.files.length} 个关键文件 · root ${manifest.root.slice(0, 16)}…`);

// 11) v6.30.0「禁止凑数」门禁：staged 内每个资产都必须在运行时被真实引用。
//     与 tools/build-editions.mjs 的 guard() 双保险；此处让单独 stage 也能自检。
const { execFileSync } = require('node:child_process');
console.log('  audit   「禁止凑数」资产引用审计（staged 零未调用资产）…');
// v6.40.0 合规豁免：字体许可证属于法律要求随附的合规文档，不参与运行时加载。
// 依据 OFL 1.1 条件条款 2 / 第三方声明义务必须随包，理由已在 LICENSES.md 与交付文档登记。
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-asset-references.mjs'),
  '--staged', APP_DIR, '--allow-unused', 'fonts/OFL.txt,fonts/FONT-LICENSES.txt'],
  { cwd: ROOT, stdio: 'inherit' });

// 11b) v6.31.0：纯净客户端红线 + NeoLM 模型真实性门禁。
//      单独 stage 也必须自检，不能只依赖 build-editions.mjs 的 guard()：
//      1.5 GiB 权重必须被证明是真实训练产物（逐字节哈希 / LCG 初值重放 / 真实推理），
//      不是随机填充改扩展名；并复核 UI→preload→IPC 的真实接线。
console.log('  audit   「纯净客户端红线」门禁（零内置知识库 / 零随机填充）…');
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-clean-client.mjs'), APP_DIR],
  { cwd: ROOT, stdio: 'inherit' });
console.log('  audit   NeoLM 模型真实性门禁（反填充 / 训练证据 / 真实推理 / 真实接线）…');
execFileSync(process.execPath, [
  path.join(ROOT, 'tools', 'check-model-authenticity.mjs'),
  '--dir', path.join(APP_DIR, 'assets', '_model', 'neolm'),
  '--corpus-dir', path.join(ROOT, 'desktop', 'assets', '_model', 'neolm'),
], { cwd: ROOT, stdio: 'inherit' });

// 11c) v6.32.0：语义回流层真实性门禁。逐卡向量必须与真实权重现场重算一致，
//      沉淀候选必须「未确认不建边」，库桥必须只读建议；同时核对 staged 侧全链路接线。
console.log('  audit   语义回流层真实性门禁（调取 / 沉淀 / 库关联真实接线）…');
execFileSync(process.execPath, [
  path.join(ROOT, 'tools', 'check-semantic-bridge.mjs'),
  '--dir', path.join(APP_DIR, 'assets', '_model', 'neolm'),
  '--staged', APP_DIR,
], { cwd: ROOT, stdio: 'inherit' });

// 11d) v6.33.0：全局排版重构门禁。逐项复核状态栏命名空间隔离、视图根容器滚动、
//      固定列网格、最高优先级层响应式降级、定义列表与长文本换行，并核对
//      staged 的 5 个 UI 文件与源码逐字同源。排版回归会让构建直接中止。
console.log('  audit   全局排版重构门禁（命名空间隔离 / 滚动容器 / 网格 / 响应式）…');
execFileSync(process.execPath, [
  path.join(ROOT, 'tools', 'check-layout-633.mjs'),
  '--staged', APP_DIR,
], { cwd: ROOT, stdio: 'inherit' });

console.log(`✓ 已编排到 ${APP_DIR}`);
