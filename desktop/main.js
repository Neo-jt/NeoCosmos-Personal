// NeoLink 桌面版 · 主进程
// ---------------------------------------------------------------------------
// 职责边界：
//  1) 用自定义协议 neolink:// 提供渲染层资源（离线、不经外部网络）
//  2) 在本进程内直接驱动 NeoLink 引擎（KbStore / 突触 / 巩固）——不启 HTTP 服务
//  3) 通过 contextBridge 向 UI 暴露受控 IPC 通道（沙箱渲染进程，nodeIntegration=false）
//
// v1.1.0：
//  · 多知识库注册表（vaults.json）：创建 / 切换 / 重命名 / 配色 / 移除登记
//  · 跨库关联 IPC（crosskb:*）：跨库突触的建立 / 列举 / 删除 / 跳转
//  · 文件监视器：外部改动 .md 自动重建索引（文件是唯一真相源的体验闭环）
//  · neolink://vault/<rel>：卡片内本地图片渲染（严格沙箱 + 扩展名白名单）
//  · 修复：标题消毒、重命名入链重建、单实例提前退出、写操作抑制误报
// ---------------------------------------------------------------------------

const { app, BrowserWindow, ipcMain, protocol, dialog, shell, screen, safeStorage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
// v6.11：ASTRA 自主意识内核 + 桌面自由漫游运动引擎（CJS，零第三方依赖，可独立单测）
const { createAstraMind, ASTRA_BOUNDARY } = require('./astra/astra-mind.js');
const { createAstraMotion } = require('./astra/astra-motion.js');
// v6.12：思维沉淀库 —— 安装目录下自动建立、用户可自主更换的长期记忆档案
const { createThoughtLibrary } = require('./astra/astra-library.js');
// v6.22.0：链接 API 真实访问日志 / 聚合 / 黑名单（零依赖、可独立单测）
const connLog = require('./connection-log.cjs');
// v6.23.0：按知识库的连接作用域（启停 / 定向 / 按需扫描）与沉淀库选择，纯函数、零依赖
const vaultScope = require('./vault-scope.cjs');
// v6.23.1：MCP 外部平台链接登记（与独立 stdio MCP Server 进程共用同一份模块与目录推导）
const mcpLinks = require('./mcp-links.cjs');
// v6.37.0：企业版知识库 API 自动同步器（对外链接 → 增量拉取远端卡片，零依赖）
const vaultSync = require('./vault-sync.cjs');
// v6.40.0 合规拆分：版本身份（个人版 / 企业版 / 融合版）由编排期注入，
// 用于隔离进程身份、数据目录、协议与「关于」信息，使两个客户端可同时安装运行。
const editionCfg = require('./edition.cjs');
const EDITION_INFO = editionCfg.current();

// ---------------------------------------------------------------------------
// v2.1.0 · 百万级堆上限（自举重启）
//
// 事实（实测）：Electron **主进程**的 V8 老生代堆在**进程创建时**就定容了。
//   · 运行时 v8.setFlagsFromString('--max-old-space-size=4096') → 无效，仍是 2060MB
//   · 命令行 --js-flags=--max-old-space-size=4096            → 生效，4084MB
// 引擎（KbStore / 倒排索引 / 突触图）就跑在主进程里，100 万张卡片实测常驻
// ~3.7GB，默认 2GB 堆会在加载途中 OOM。
//
// 方案：不无条件重启（那会让 99% 的小库用户每次启动都白等几秒），而是**按库规模
// 决定**——启动前先看一眼目标库的规模（读 .neolink/index/meta.json 的 node_count，
// 没有索引时按 .md 文件数上限扫描），只有确实需要更大堆时才带 --js-flags 重启一次。
// 环境变量 NEOLINK_HEAP_RELAUNCHED=1 保证只重启一次，不会自举死循环。
// ---------------------------------------------------------------------------
const HEAP_RELAUNCH_ENV = 'NEOLINK_HEAP_RELAUNCHED';
const HEAP_MB_ENV = 'NEOLINK_HEAP_MB';
/** v2.1.0：超过此规模不再后台自动睡眠（巩固是重活，会与用户操作抢资源） */
const AUTO_SLEEP_MAX_NODES = 100000;
/** 按节点数决定需要的堆（MB）。0 = 默认堆够用，不必重启 */
function heapTargetMB(nodes) {
  if (nodes > 200000) return 6144;   // 百万级：结构 + 倒排实测 ~3.7GB
  if (nodes > 20000) return 3072;    // 大型库
  if (nodes > 5000) return 2560;     // 中型库，2GB 偏紧
  return 0;
}
function currentHeapMB() {
  try { return Math.round(require('node:v8').getHeapStatistics().heap_size_limit / (1024 * 1024)); }
  catch { return 0; }
}
/** 物理内存允许的堆上限（V8 只是"上限"不是预留，所以按 70% 物理内存封顶） */
function heapCapMB() {
  try {
    const totalMB = Math.floor(os.totalmem() / (1024 * 1024));
    return Math.max(3072, Math.floor(totalMB * 0.70));
  } catch { return 4096; }
}

/**
 * 估算目标库的节点规模。
 *  · 已有索引 → 直接读 meta.json 的 node_count（O(1)，免费）
 *  · 未建索引 → 扫 .md 文件数，超过 25 万即判定为百万级（提前退出，不做无谓全扫）
 */
function estimateVaultNodes(dir) {
  if (!dir) return 0;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.neolink', 'index', 'meta.json'), 'utf8'));
    const n = Number(meta.node_count);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* 未建索引 */ }
  if (!fs.existsSync(dir)) return 0;
  // v6.35.0：跳过所有点开头的隐藏目录（.neolink / .git / 各类应用元数据目录
  // 一律不计入卡片），用通用规则替代逐个列举第三方目录名，功能等价且不含品牌字样。
  const SKIP = new Set(['_graveyard', 'node_modules']);
  let n = 0;
  const stack = [String(dir)];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(path.join(d, e.name));
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        n++;
        if (n > 250000) return 250001; // 判定百万级，停止扫描
      }
    }
  }
  return n;
}

/**
 * v2.1.0 · 需要更大 V8 堆时，带 --js-flags 重启自己。
 * Electron 主进程的 V8 老生代堆在**进程创建时**就定容了，运行时改不动：
 *   · v8.setFlagsFromString('--max-old-space-size=4096') → 无效，仍是 2060MB
 *   · 命令行 --js-flags=--max-old-space-size=4096         → 生效，4084MB
 * 引擎（KbStore / 倒排 / 突触图）跑在主进程里，100 万张卡片常驻 ~3.7GB，
 * 默认 2GB 堆会在加载途中 OOM —— 所以这里必须用"重启"这一招。
 *
 * 两条触发路径：
 *   1) 启动时（bootstrap）：按注册表/配置里的激活库规模预判
 *   2) 运行中（openVault）：用户切换/打开了更大的库
 * 通过 NEOLINK_HEAP_RELAUNCHED=1 保证只重启一次，绝不自举死循环。
 */
function relaunchWithBiggerHeap(dir) {
  // 「已经带着大堆跑起来了」的判定用 argv 而不是 env：
  // 实测 Electron 33 在 Windows 上 app.relaunch({env}) 并不生效，
  // 而 --js-flags= 参数是可靠传递的。用 argv 判定可确保绝不自举死循环。
  const hasJsFlags = process.argv.some((a) => String(a).startsWith('--js-flags='));
  if (hasJsFlags) return false;
  if (process.env[HEAP_RELAUNCH_ENV] === '1') return false;   // 双重保险
  if (process.env.NEOLINK_NO_RELAUNCH === '1') return false;    // 自动化测试可关闭
  let target = Number(process.env[HEAP_MB_ENV] || 0);          // 手动指定优先
  if (!target) {
    target = heapTargetMB(estimateVaultNodes(dir));
    if (!target) return false;
  }
  const want = Math.min(target, heapCapMB());
  const cur = currentHeapMB();
  if (want <= cur) return false;                             // 当前堆已经够大
  // 重新拉起：保留全部原始参数（含 --smoke），只追加 --js-flags
  const args = process.argv.slice(1).filter((a) => !String(a).startsWith('--js-flags='));
  args.push(`--js-flags=--max-old-space-size=${want}`);
  const env = { ...process.env, [HEAP_RELAUNCH_ENV]: '1', [HEAP_MB_ENV]: String(want) };
  if (dir) env.NEOLINK_VAULT = path.resolve(String(dir));       // 重启后继续打开这个库
  try {
    // Electron 的 relauncher 会等当前进程退出后再拉起新实例，单实例锁自然让位
    app.relaunch({ args, env });
    mark('heap-relaunch', { wantMB: want, currentMB: cur, vault: dir || null });
    setTimeout(() => app.exit(0), 120);
  } catch (e) {
    console.error('[heap] relaunch failed', e);
    return false;
  }
  return true;
}

/** 启动前预判：激活库（或 NEOLINK_VAULT 指定的库）是否大到需要更大堆 */
function maybeRelaunchForBigVault() {
  let dir = process.env.NEOLINK_VAULT || null;
  if (!dir) {
    try {
      const reg = readRegistry();
      const entry = reg.activeId ? reg.vaults.find((v) => v.id === reg.activeId) : null;
      if (entry) dir = entry.path;
    } catch { /* ignore */ }
  }
  if (!dir) { try { dir = readConfig().vaultPath || null; } catch { /* ignore */ } }
  return relaunchWithBiggerHeap(dir);
}

const APP_ROOT = app.getAppPath();
const UI_DIR = path.join(APP_ROOT, 'ui');
const ENGINE = path.join(APP_ROOT, 'src');
const EXAMPLE_CORPUS = path.join(APP_ROOT, 'examples', 'corpus');

const IS_DEV = !!process.env.NEOLINK_DEV;

// ======================================================================
//  v2.2.3：自动化场景使用**独立的 userData 目录**。
//
//  为什么需要：Electron 的单实例锁（requestSingleInstanceLock）是按
//  userData 路径区分的。默认所有实例共用 %APPDATA%\NeoLink —— 于是
//  用户只要开着正式版客户端，任何探针/审计启动的实例都会
//  **拿不到锁、直接退出**（症状：探针"未返回结果"、诊断停在
//  stage=module-loaded，看着像产品坏了，其实是锁被占）。
//
//  以前只能靠"杀掉用户正在用的程序"来腾位置 —— 那是在动用户的东西。
//  现在：自动化实例用自己的目录，与用户实例**完全共存**。
//
//  只在显式给出 NEOLINK_USER_DATA 时生效，正式客户端行为**不变**。
// ======================================================================
if (process.env.NEOLINK_USER_DATA) {
  try {
    app.setPath('userData', path.resolve(process.env.NEOLINK_USER_DATA));
  } catch (e) {
    console.error('[userData] 设置独立目录失败：', e);
  }
} else if (EDITION_INFO.edition !== 'both') {
  // v6.40.0 合规拆分：个人版 / 企业版各自使用独立 userData 目录，
  // 两个客户端可同时安装、同时运行，知识库注册表/配置/连接日志互不覆盖。
  // 显式 NEOLINK_USER_DATA（自动化探针）优先级最高，始终覆盖此默认。
  try {
    app.setPath('userData', path.join(app.getPath('appData'), EDITION_INFO.userDataDir));
  } catch (e) {
    console.error('[userData] 设置版本独立目录失败：', e);
  }
}

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const REG_FILE = path.join(app.getPath('userData'), 'vaults.json');
// v6.22.0：访问日志落在 userData，全局唯一，不随切库清空；每条记录带 root 便于按库过滤。
// 它是「本机链接 API 的真实请求记录」，不是知识库内容，也不上传任何地方。
const CONN_LOG_DIR = app.getPath('userData');
// v6.23.1：MCP 平台链接目录。刻意**不放在 userData**：MCP Server 是外部宿主
// 独立拉起的进程，拿不到 Electron 的 userData，也继承不到本进程的环境变量。
// 因此两端统一用 mcpLinks.linkDir() 的 homedir 固定推导，保证读写同一处。
// 隔离/自动化场景可显式设置 NEOCOSMOS_LINK_DIR（须两端一致）。
const MCP_LINK_DIR = mcpLinks.linkDir();
// 活跃 socket 集合：HTTP 是短连接，所谓「断开」只能真实 destroy() 当前存活的 socket。
// 不把 server.close() 包装成「断开指定客户端」——那是假功能。
const activeApiSockets = new Set();
let apiBlocklist = connLog.blocklistOf(readConfig());
// v6.23.0：按库预建索引的缓存。启用某库时才真正读盘建一次索引；请求期只取缓存，
// 绝不「每次请求把全部知识库扫一遍」。停用即释放，切库/新建时由 IPC 显式维护。
const scopeStores = new Map();   // vaultId -> { store, root, warmed }
let sedimentStoreCache = null;   // { vaultId, store, root } | null

// ---------------- 诊断（多路径落盘，便于无人值守验证） ----------------
const DIAG_FILES = [
  path.join(os.tmpdir(), 'neolink-diag.json'),
  path.join(app.getPath('userData'), 'diag.json'),
];
const DIAG = { createdAt: new Date().toISOString(), stage: 'module', marks: [], errors: [] };
function dump() {
  const data = JSON.stringify(DIAG, null, 2);
  for (const f of DIAG_FILES) {
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data, 'utf8'); } catch { /* 换下一个位置 */ }
  }
}
function mark(stage, extra) {
  DIAG.stage = stage;
  DIAG.marks.push({ stage, at: Date.now(), ...(extra || {}) });
  dump();
}
function diagError(what, e) {
  DIAG.errors.push(`${what}: ${(e && (e.stack || e.message)) || e}`); dump();
}
/** v2.1.0：自检分步计时（渲染层实时回传） */
function diagMark(name, ms) {
  if (!DIAG.timings) DIAG.timings = {};
  DIAG.timings[name] = ms;
  dump();
}
mark('module-loaded', { version: app.getVersion() });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  // v6.18.0：随包 CJK 可变字体（styles.css 的 @font-face 走 /assets/ 分支）
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

// 知识库内可经 neolink://vault/ 提供的文件类型（图片为主；严格白名单）
const VAULT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};
const VAULT_FILE_MAX = 25 * 1024 * 1024;

// ---------------- 单实例（未取得锁立即退出，避免半初始化） ----------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId(EDITION_INFO.appUserModelId);
// 注册本版协议：外部（如浏览器、其他 Agent）点击深链可直接唤起本客户端并跳到指定卡片
// 个人版用 neolinkp://，企业版/融合版沿用 neolink://，两版互不抢占深链。
try { app.setAsDefaultProtocolClient(EDITION_INFO.protocol); } catch (e) { /* 某些安装环境不可注册，忽略 */ }

// ---------------- 深链：neolink://open/<库ID>/<卡片ID> ----------------
// v2.2.0 修复：深链原先只在「应用已在运行」时有效（走 second-instance 拿 argv）。
// 首次唤起时 URL 只出现在 process.argv 里，而窗口恒定加载 neolink://app/index.html，
// 于是渲染层按 location 解析必然得到 null，主进程协议处理器里的 open 分支
// 也永远不会执行 —— 两处都是死代码，「从浏览器直接唤起并直达卡片」在真实
// 使用中根本走不通（典型症状：应用未启动时点深链，只打开了应用，没跳卡片）。
// 现在统一为「待处理 + 推送」模型：
//   · 启动时扫描 argv，把深链存进 pendingDeepLink；
//   · 渲染层启动完成后主动取一次（link:takeDeepLink）；
//   · 运行期新到的深链照旧走推送（neolink:deeplink）。
function parseDeepLink(raw) {
  const s = String(raw || '');
  // v6.34.0 修复：两种深链都走 argv 唤起，必须在这里统一识别 ——
  //   · neolink://open/<库ID>/<卡片ID>              普通直达
  //   · neolink://verify/<库ID>/<节点ID>?s=<片段>   引用溯源（从导出的 md / 外部 Agent 点击）
  // 此前只认 open：外部文件里点「溯源：neolink://verify/...」时，冷启动 scanArgvDeepLink
  // 与运行中 dispatchDeepLink 都拿到 null，只打开应用不跳卡片；而协议处理器里的 verify
  // 分支是死代码（外部唤起只进 argv，不经 protocol.handle），于是溯源跳转从未真正生效。
  // 同一正则收口两种形态，verify 额外带出 snippet，交给渲染层高亮定位（见 app.js）。
  // v6.40.0：个人版外部深链协议为 neolinkp://，企业版/融合版为 neolink://；
  // 两者形态一致，统一识别（内部资源协议始终是 neolink://，不受此影响）。
  const m = s.match(/^neolinkp?:\/\/(open|verify)\/([^/?#]+)\/?([^?#]*)/i);
  if (!m) return null;
  const isVerify = String(m[1] || '').toLowerCase() === 'verify';
  const vaultId = decodeURIComponent(m[2] || '');
  // 节点 id 可能含 '/'（如 dir/sub/n_xxx），m[3] 用 [^?#]* 已整段接住，勿再按段切。
  const cardId = decodeURIComponent(m[3] || '');
  if (!vaultId && !cardId) return null;
  if (!isVerify) return { vaultId, cardId };
  // verify：从查询串取被引用片段 s，供渲染层高亮；取不到就空串，不阻断跳转。
  let snippet = '';
  try {
    const q = s.indexOf('?');
    if (q >= 0) snippet = new URLSearchParams(s.slice(q + 1)).get('s') || '';
  } catch { /* 片段解析失败仅影响高亮，卡片跳转照常 */ }
  return { vaultId, cardId, verify: true, snippet };
}

// 尚未送达渲染层的深链（首启唤起用）。渲染层取走即清空，避免重复跳转。
let pendingDeepLink = null;

/** 从命令行参数里捞出深链（Windows 下协议唤起把 URL 放在 argv 里）。 */
function scanArgvDeepLink() {
  for (const a of process.argv.slice(1)) {
    const dl = parseDeepLink(a);
    if (dl) return dl;
  }
  return null;
}

function dispatchDeepLink(raw) {
  const dl = parseDeepLink(raw);
  if (!dl) return false;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('neolink:deeplink', dl);
  } else {
    // 窗口还没起来（例如冷启动）——存起来，等渲染层来取。
    pendingDeepLink = dl;
  }
  return true;
}

// 自定义协议（必须在 app ready 前注册）
protocol.registerSchemesAsPrivileged([
  { scheme: 'neolink', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------------- 引擎（动态载入，保持单一实现） ----------------
let ENGINE_MOD = null;
async function loadEngine() {
  if (ENGINE_MOD) return ENGINE_MOD;
  const store = await import(pathToFileURL(path.join(ENGINE, 'storage', 'store.js')).href);
  const tools = await import(pathToFileURL(path.join(ENGINE, 'mcp', 'tools.js')).href);
  const graphExport = await import(pathToFileURL(path.join(ENGINE, 'viz', 'graph-export.js')).href);
  const md = await import(pathToFileURL(path.join(ENGINE, 'storage', 'markdown.js')).href);
  const consolidation = await import(pathToFileURL(path.join(ENGINE, 'consolidation', 'consolidate.js')).href);
  const derive = await import(pathToFileURL(path.join(ENGINE, 'engine', 'derive.js')).href);
  // v6.3.0：类脑认知内核（ESM；数据常量由 本项目自研认知规格 真源编译）
  const cognition = await import(pathToFileURL(path.join(ENGINE, 'cognition', 'index.js')).href);
  ENGINE_MOD = { ...store, ...tools, ...graphExport, md, consolidation, derive, cognition };
  return ENGINE_MOD;
}

// ---------------- 配置与多知识库注册表 ----------------
/**
 * v2.2.1：算出"存放知识库的根目录"（库本身放在它下面）。
 *
 * 判定顺序（**只有用户显式选过的才算数**）：
 *   ① NEOLINK_VAULT 环境变量（便携模式 / 自动化测试指定）—— 直接当成库目录用；
 *   ② cfg.vaultRoot —— 用户在「关于 → 存储位置」里亲手选定的根目录；
 *   ③ 非系统盘上的候选目录（D:\NeoCosmos-D、E:\NeoCosmos-E …），空间大的优先；
 *   ④ 实在没有别的盘，才退回文档目录。
 *
 * ⚠ 这里**刻意不看 cfg.vaultPath**。
 * cfg.vaultPath 的语义是"上次打开的库在哪"，不是"库该放在哪"。
 * 早先的版本把两者混为一谈，结果是：只要用户曾在 C 盘打开过库，
 * 之后每次新建库/首次启动都又落回 C 盘 —— 用户明说"不能默认C盘"，
 * 功能却等于没做。启动流程里"恢复上次打开的库"是另一回事（第 3 步），
 * 那里用 cfg.vaultPath 是对的。
 */
function defaultVaultRoot() {
  try {
    const cfg0 = readConfig();
    if (cfg0.vaultRoot) return path.resolve(String(cfg0.vaultRoot));
  } catch { /* ignore */ }
  const preferred = preferredVaultRoots();
  for (const p of preferred) {
    try {
      fs.mkdirSync(p, { recursive: true });
      // 写一下确认可写（有些盘只读挂载）
      const probe = path.join(p, '.neolink-write-test');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return p;
    } catch { /* 这个盘不可用，试下一个 */ }
  }
  const docs = app.getPath('documents');
  try { fs.mkdirSync(docs, { recursive: true }); } catch { /* 忽略 */ }
  return docs;
}

function defaultVaultPath() {
  if (process.env.NEOLINK_VAULT) return process.env.NEOLINK_VAULT;
  // v2.2.1：**默认位置不再硬绑在系统盘**。
  // 原先一律用 app.getPath('documents')，在绝大多数机器上就是 C:\Users\<你>\Documents
  // —— 而这恰恰是最不该放"不可再生数据"的地方：C 盘重装系统、换机迁移、
  // 加密盘解锁失败，都可能一次性带走全部知识库。
  //
  // 现在：优先用**非系统盘**上的数据目录（数据盘被格式化/拔掉的概率远低于系统盘），
  // 用户没别的盘时才退回文档目录。所有路径都在配置里显式可见、可改。
  return path.join(defaultVaultRoot(), 'NeoCosmos Vault');
}

/**
 * 列出**非系统盘**上的候选根目录（按可用空间从大到小）。
 * 取不到就返回空数组 —— 调用方会退回文档目录。
 */
function preferredVaultRoots() {
  const out = [];
  try {
    const os = require('node:os');
    const drives = [];
    // Windows：列出所有盘符
    if (process.platform === 'win32') {
      for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
        const letter = String.fromCharCode(c);
        const root = `${letter}:\\`;
        try {
          const st = fs.statfsSync(root);
          drives.push({ root, free: st.bavail * st.bsize, letter });
        } catch { /* 这个盘符不存在 */ }
      }
    } else {
      // 类 Unix：/data、/mnt、/media 下常见的数据盘
      for (const root of ['/data', '/mnt', '/media', '/volume']) {
        try {
          if (!fs.existsSync(root)) continue;
          const st = fs.statfsSync(root);
          drives.push({ root, free: st.bavail * st.bsize });
        } catch { /* ignore */ }
      }
    }
    // 系统盘（Windows 的 C:、类 Unix 的 /）排到最后 —— 只在没有别的盘时才用
    const systemRoot = process.platform === 'win32' ? 'C:\\' : '/';
    drives.sort((a, b) => {
      const as = a.root.toLowerCase() === systemRoot.toLowerCase() ? 1 : 0;
      const bs = b.root.toLowerCase() === systemRoot.toLowerCase() ? 1 : 0;
      if (as !== bs) return as - bs;           // 非系统盘优先
      return b.free - a.free;                   // 同类里空间大的优先
    });
    for (const d of drives) {
      if (d.root.toLowerCase() === systemRoot.toLowerCase()) continue;  // 系统盘不作为"优先"候选
      const name = d.letter ? `NeoCosmos-${d.letter}` : 'NeoCosmos';
      out.push(path.join(d.root, name));
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * 列出可供用户选择的存储位置（"选择存储位置"对话框的候选项）。
 * 返回真实磁盘信息，不编造。
 */
function storageLocations() {
  const out = [];
  try {
    const systemRoot = process.platform === 'win32' ? 'C:\\' : '/';
    const seen = new Set();
    const push = (root, label, isSystem) => {
      const k = root.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      let free = 0, total = 0;
      try {
        const st = fs.statfsSync(root);
        free = st.bavail * st.bsize;
        total = st.blocks * st.bsize;
      } catch { /* ignore */ }
      out.push({ root, label, isSystem, free, total });
    };
    if (process.platform === 'win32') {
      for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
        const letter = String.fromCharCode(c);
        const root = `${letter}:\\`;
        try {
          fs.statfsSync(root);
          push(root, `盘符 ${letter}:`, root.toLowerCase() === systemRoot.toLowerCase());
        } catch { /* 不存在 */ }
      }
    }
    // 常用目录也算候选
    try { push(app.getPath('documents'), '文档', false); } catch { /* ignore */ }
    try { push(app.getPath('desktop'), '桌面', false); } catch { /* ignore */ }
  } catch { /* ignore */ }
  return out;
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { console.error('[config] write failed', e); }
}

// ---------------- v2.2.1：链接 API 令牌的生成与安全存储 ----------------
// 企业库里的卡片正文是最敏感的数据，而链接 API 能读出全文。
// 令牌就是"读全部卡片"的钥匙，因此：
//   ① 默认**自动生成**一个高强度随机令牌（用户不必自己想，也不会留空）；
//   ② 落盘时用 Electron 的 safeStorage（Windows DPAPI / macOS Keychain /
//      Linux libsecret）加密，config.json 里不再留明文 ——
//      明文令牌等于把钥匙写在便利贴上。
//   ③ 读不回来时（换了机器、密钥环不可用）**如实报错**，绝不静默降级成"不鉴权"。
function generateApiToken() {
  // 32 字节随机 → base64url，约 43 位熵
  return crypto.randomBytes(32).toString('base64url');
}
function saveApiToken(token, port) {
  const cfg = readConfig();
  let stored = null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      stored = 'enc:' + safeStorage.encryptString(token).toString('base64');
    }
  } catch (e) { console.error('[api-token] encrypt failed', e); }
  if (!stored) {
    // 系统密钥环不可用：明文存，但要**明确标注**，且启动时提示风险
    stored = 'plain:' + token;
    cfg.apiTokenPlain = true;
  } else {
    delete cfg.apiTokenPlain;
  }
  // v2.2.1 修复：这里的 port 原本是**裸标识符**，而本函数只接受 token ——
  // 于是每次保存令牌都会抛 ReferenceError: port is not defined，
  // 结果"启动服务"永远失败（界面只弹一句莫名其妙的 port is not defined）。
  // 端口号要一起存进配置（status() 会读它显示给用户），所以作为参数传进来。
  cfg.apiServer = { ...(cfg.apiServer || {}), enabled: false, port: Number(port) || 8787, tokenStored: stored };
  // v2.2.1：清掉历史遗留的**明文** token 字段 —— 旧版本把它直接写在 config.json 里，
  // 等于把"读取全部卡片"的钥匙明文放在磁盘上。现在只保留加密后的 tokenStored。
  delete cfg.apiServer.token;
  writeConfig(cfg);
  return { stored, plaintext: !stored.startsWith('enc:') };
}
function loadApiToken() {
  const s = readConfig().apiServer || {};
  const stored = String(s.tokenStored || '');
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) {
      if (!safeStorage.isEncryptionAvailable()) return '';
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('plain:')) return stored.slice(6);
  } catch (e) { console.error('[api-token] decrypt failed', e); }
  return '';
}

const sha256s = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const VAULT_COLORS = ['#8B7BFF', '#46E0FF', '#3FE0C8', '#D4A843', '#FF6B8A', '#C77DFF', '#5FA8FF', '#62F0A8'];
const vaultIdFor = (dir) => 'v_' + sha256s(path.resolve(String(dir)).toLowerCase()).slice(0, 12);

function readRegistry() {
  try {
    const r = JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
    // v6.23.0：老配置没有 linkEnabled / purpose，归一化为「启用连接 / 普通知识库」，
    // 既不偷偷停用用户已有的库，也不把未登记的库编进作用域。
    if (r && Array.isArray(r.vaults)) return vaultScope.normalizeRegistry({ vaults: r.vaults, activeId: r.activeId || null });
  } catch { /* 首次运行 */ }
  return vaultScope.normalizeRegistry({ vaults: [], activeId: null });
}
function writeRegistry(reg) {
  try {
    fs.mkdirSync(path.dirname(REG_FILE), { recursive: true });
    fs.writeFileSync(REG_FILE, JSON.stringify(reg, null, 2), 'utf8');
  } catch (e) { console.error('[registry] write failed', e); }
  // v10.18.7：注册表一变（切库 / 启停 / 登记），立刻重发布「外部 AI 检索白名单」。
  // 只有 linkEnabled !== false 的库进入白名单；MCP 侧每次检索复查，停用即时生效。
  publishEnabledVaults(reg);
}
/**
 * v10.18.7：把启用库白名单发布到 MCP 共享真源（~/.neocosmos/enabled-vaults.json）。
 * 这是"启用/停用"对外部 AI 真实生效的唯一出口：WorkBuddy / AutoClaw / OpenClaw
 * 经 MCP 检索时只查这份白名单，停用的库不在其中，检索会被真实拒绝。
 * 发布失败只告警、不影响本地功能（优雅降级）。
 */
function publishEnabledVaults(reg) {
  try {
    const enabled = (reg?.vaults || []).filter((v) => v.linkEnabled !== false)
      .map((v) => ({ id: v.id, path: v.path }));
    mcpLinks.writeEnabledVaults(enabled);
  } catch (e) { console.error('[enabled-vaults] publish failed', e); }
}
function pickVaultColor(n) { return VAULT_COLORS[n % VAULT_COLORS.length]; }

/** 登记并激活一个知识库（已存在则更新元数据） */
function registerVault(dir, patch = {}) {
  const reg = readRegistry();
  const id = vaultIdFor(dir);
  let v = reg.vaults.find((x) => x.id === id);
  if (!v) {
    v = {
      id,
      path: path.resolve(String(dir)),
      name: patch.name || path.basename(path.resolve(String(dir))),
      color: patch.color || pickVaultColor(reg.vaults.length),
      created_at: new Date().toISOString(),
    };
    reg.vaults.push(v);
  }
  if (patch.name) v.name = patch.name;
  if (patch.color) v.color = patch.color;
  v.last_opened_at = new Date().toISOString();
  // v2.2.1：activate=false —— "只登记、不切换"。
  // 启动时把默认存储位置下的库登记进列表时必须用它，
  // 否则用户正开着的库会被悄悄换掉（用户没要求切换，却发生了）。
  if (patch.activate !== false) reg.activeId = id;
  writeRegistry(reg);
  return v;
}

/** 统计一个库里 .md 卡片的数量（只看 _memory/semantic 等业务目录，忽略 .neolink）。 */
function countVaultCards(dir) {
  let n = 0;
  const walk = (d, depth) => {
    if (depth > 6 || n > 1000) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (/\.md$/i.test(e.name)) n++;
    }
  };
  try { walk(dir, 0); } catch { /* ignore */ }
  return n;
}

/**
 * v2.2.1：把**无效登记**从库列表里清出去（只移出登记，磁盘文件一律不动）。
 *
 * 两条互补的规则：
 *
 * ① **系统盘上的旧默认库**（用户把库搬走后剩下的空壳）
 *    判定：在系统盘上 + 目录名是默认库约定名「NeoCosmos Vault」+
 *    里面**只有 starter 卡片**（逐文件核对，出现任何非 starter 的 .md 就不动）。
 *    不清它，用户每次启动都会被拉回 C 盘那个 6 张卡的空库；
 *    用户手工删掉，客户端下次启动又原样建回来 —— 死循环。
 *
 * ② **一张卡片都没有的登记**（被误当成知识库的普通目录）
 *    判定：目录存在、`.md` 卡片数 = 0。
 *    真正的知识库至少有客户端播种的 6 张 starter 卡片，或者是用户自己的卡片；
 *    **0 张 = 一定是误登记**（自动化测试点开系统文件夹对话框选中了普通目录就会这样）。
 *    实测事故：用户的 `D:\09-知识库临时文件` 被当成知识库打开并登记 —— 它里面
 *    装的是法规库原始资料，根本不是 .md 卡片。
 *
 * 两条规则都**只从登记列表移除**，磁盘上的文件一个都不删 ——
 * 用户随时可以在「库管理」里重新添加回来。
 */
function retireSystemDefaultVault() {
  try {
    const defaultRoot = defaultVaultRoot();
    const reg = readRegistry();
    const keep = [];
    const retired = [];
    for (const v of reg.vaults) {
      const p = String(v.path || '');
      const onSys = isOnSystemDrive(p);
      const defName = path.basename(path.resolve(p)) === 'NeoCosmos Vault';
      const notDefault = path.resolve(p) !== path.resolve(defaultRoot);
      const emptyShell = onSys && defName && notDefault && isStarterOnlyVault(p);
      const notAKnowledgeBase = fs.existsSync(p) && countVaultCards(p) === 0;
      if (emptyShell || notAKnowledgeBase) { retired.push(v); continue; }
      keep.push(v);
    }
    if (!retired.length) return [];
    reg.vaults = keep;
    if (retired.some((v) => v.id === reg.activeId)) {
      // 激活剩余库里"最近打开过"的那个 —— 通常就是用户真正在用的库
      const next = keep.slice()
        .sort((a, b) => String(b.last_opened_at || '').localeCompare(String(a.last_opened_at || '')))[0];
      reg.activeId = next ? next.id : null;
    }
    writeRegistry(reg);
    for (const v of retired) {
      console.log('[vault] 已将无效登记移出库列表（文件未删除）：', v.path);
    }
    return retired;
  } catch (e) { console.error('retire system vault failed', e); return []; }
}

/**
 * v2.2.1：判断当前是否处于**自动化**（UI 审计 / 探针 / dry-run）环境。
 *
 * 为什么要有它：原生对话框（showOpenDialog / showSaveDialog）是**系统级窗口**，
 * 渲染层里的 Escape 事件关不掉它，一旦真的弹出就会把主进程卡住；
 * 更糟的是它一旦返回，就可能把**用户的任意目录**当成知识库打开并登记。
 *
 * 实测过的真实事故：UI 审计点到了会弹系统文件夹对话框的按钮，
 * 结果用户的 `D:\09-知识库临时文件` 被当成知识库打开 —— 客户端在里面建了
 * `.neolink` 索引目录，并把该目录登记进了库列表。审计污染了用户的真实环境。
 *
 * 处置：自动化环境下，凡是需要用户选择路径的 IPC 一律直接返回"已取消"。
 * 这与 v2.2.1 给 `vault:revealPath` 定的 dryRun 规矩是同一条。
 */
function isAutomation() {
  return !!(process.env.NEOLINK_AUDIT_SCRIPT || process.env.NEOLINK_PROBE_SCRIPT || process.env.NEOLINK_DRY_SHELL);
}

/**
 * v2.2.1：判断路径是否落在**系统盘**上。
 * 用户诉求「不能默认C盘」——光把默认位置改了还不够，
 * 界面必须能**明确告诉用户**"你现在这个库在系统盘上，建议搬走"。
 */
function isOnSystemDrive(abs) {
  if (!abs) return false;
  if (process.platform !== 'win32') return String(abs).startsWith('/');
  const sysDrive = String(process.env.SystemDrive || 'C:').replace(/[:\\/]+$/, '').toUpperCase();
  const root = path.parse(path.resolve(String(abs))).root.replace(/[:\\/]+$/, '').toUpperCase();
  return root === sysDrive;
}

/** starter 套件的 6 张系统说明文档 —— 它们由 seedStarterKit 播种。 */
const STARTER_FILES = new Set([
  'NeoCosmos 使用手册.md', '突触可塑性.md', '激活扩散.md',
  '三层记忆.md', '记忆巩固.md', '多知识库与跨库关联.md',
]);

/**
 * v2.2.1：判断某个库是否**只有 starter 卡片**（即客户端自动播种的空壳）。
 *
 * 用它来决定"系统盘上的旧默认库"能不能安全退役。
 * 判据必须精确 —— 宁可多留一个库在列表里，也不能把用户的真实内容
 * 从登记列表里悄悄抹掉。所以这里逐个列出库里的 .md，
 * 只要出现任何一个**不在 starter 名单里**的文件，就认为它是用户的库，不动它。
 */
function isStarterOnlyVault(dir) {
  try {
    const sem = path.join(dir, '_memory', 'semantic');
    if (!fs.existsSync(sem)) return true;      // 连 starter 都没有 → 空壳
    let extra = 0;
    let starterHit = 0;
    const walk = (d, depth) => {
      if (depth > 4 || extra > 0) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        if (!/\.md$/i.test(e.name)) continue;
        if (STARTER_FILES.has(e.name)) starterHit++;
        else extra++;
      }
    };
    walk(sem, 0);
    return extra === 0 && starterHit <= STARTER_FILES.size;
  } catch { return false; }
}
function getVaultEntry(id) {
  const reg = readRegistry();
  return reg.vaults.find((x) => x.id === id) || null;
}

// ---------------- v2.2.0：跨库关联图谱 + 本地链接 API ----------------
// 纪律：全部在本机完成，不依赖任何外部服务、不上传任何数据。
// 跨库图谱：以库为节点，以「共享标题×2 + 共享标签」为边权 —— 数值全部来自
//           对各库磁盘内容的真实扫描，读不到就少报，绝不虚报。
// 链接 API：可选启用的本地只读 HTTP 服务，仅监听 127.0.0.1，带令牌鉴权。
function normTitle(s) { return String(s || '').toLowerCase().replace(/[`*_~#[\]()]/g, '').replace(/\s+/g, ' ').trim(); }
function normTag(s) { return String(s || '').toLowerCase().replace(/^#/, '').trim(); }

// 扫描上限：防止超大库拖慢界面。超出即如实标注"已扫描 N / 共 M"。
// v2.2.0：原来只有"读内容"的上限，**统计卡片数的目录遍历却是全量的** ——
// 一个百万级库会把主线程占满十几秒，整个应用冻结、其他 IPC 全部排队，
// 界面表现为"点了没反应"。现在连遍历也设上限：超过即截断并如实标注，
// 界面显示 "≥N"（下限），绝不假装是全量。
const XG_SCAN_LIMIT = 1500;      // 读取正文的文件数上限
const XG_WALK_LIMIT = 20000;     // 遍历目录时统计的文件数上限
const XG_TIME_LIMIT = 900;       // 单库扫描的耗时上限（毫秒）—— 绝不阻塞界面
const XG_TITLE_LIMIT = 2000;     // 用于库间比对的标题上限（两两比对是 O(n·m)）
const XG_TAG_LIMIT = 2000;       // 用于库间比对的标签上限

/** 只读扫描一个知识库目录：统计卡片数，抽取标题与标签。不写盘、不建索引、不改任何文件。 */
function scanVault(dir) {
  const titles = new Set(), tags = new Set();
  let cards = 0, scanned = 0, truncated = false;
  const t0 = Date.now();
  const root = path.resolve(String(dir));
  const walk = (d, depth) => {
    if (depth > 8) return;
    if (cards >= XG_WALK_LIMIT || Date.now() - t0 > XG_TIME_LIMIT) { truncated = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;             // .neolink 等元数据目录跳过
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); if (truncated) return; continue; }
      if (!/\.md$/i.test(e.name)) continue;
      cards++;
      if (cards >= XG_WALK_LIMIT || Date.now() - t0 > XG_TIME_LIMIT) { truncated = true; return; }
      if (scanned >= XG_SCAN_LIMIT) continue;          // 只截断"读正文"，计数继续
      scanned++;
      if (titles.size < XG_TITLE_LIMIT) titles.add(normTitle(e.name.replace(/\.md$/i, '')));
      let raw = '';
      try { raw = fs.readFileSync(p, 'utf8').slice(0, 8000); } catch { continue; }
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm) {
        const arr = fm[1].match(/tags:\s*\[([^\]]*)\]/);
        if (arr) for (const t of arr[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))) if (t) tags.add(normTag(t));
        const one = fm[1].match(/tags:\s*([^\n\[]+)/);
        if (one) for (const t of one[1].split(/\s+/)) if (t) tags.add(normTag(t));
      }
      for (const m of raw.matchAll(/(?:^|\s)#([^\s#，。；：、]{1,30})/g)) {
        if (tags.size >= XG_TAG_LIMIT) break;
        tags.add(normTag(m[1]));
      }
    }
  };
  walk(root, 0);
  return { titles, tags, cards, scanned, truncated };
}

/** 跨库关联图谱：库为节点，共享标题×2 + 共享标签 为边权 */
// v2.2.0：加一层短 TTL 缓存。
// 原实现每次调用都**把所有登记库重新扫一遍磁盘** —— 而 scanVault 单库上限 900ms，
// 登记 5 个库（其中还可能有一个百万级库）时，一次刷新就是数秒。
// 界面表现为：点「刷新状态」后界面卡住好几秒按钮才有反应，
// 而用户要的只是"重新看一眼当前状态"，并不需要每次都重扫全盘。
// 缓存 30 秒：既让连续刷新几乎瞬时，又保证数据不会长期陈旧。
// 库的内容变了（用户新建/删除卡片）时，30 秒后自然刷新 —— 跨库关联本就是
// 概览性质的数据，不要求实时。
let _xGraphCache = { at: 0, data: null };
const XG_CACHE_TTL = 30000;
function computeXGraph(force = false, opts = {}) {
  const now = Date.now();
  // v6.23.0：带库过滤的请求不共用全量缓存，否则「只扫启用的库」会被旧缓存架空。
  const ids = Array.isArray(opts.ids) ? opts.ids.join(',') : '';
  if (!ids && !force && _xGraphCache.data && now - _xGraphCache.at < XG_CACHE_TTL) {
    return _xGraphCache.data;
  }
  const data = computeXGraphUncached(ids ? new Set(ids) : null);
  if (!ids) _xGraphCache = { at: now, data };
  return data;
}

function computeXGraphUncached(onlyIds = null) {
  const reg = readRegistry();
  // v6.23.0：链接 API 的 /api/vaults 只扫描已启用连接的库；停用的库连目录都不读。
  // 跨库关联视图（vaults:xgraph）不传 onlyIds，仍展示全部登记库，语义不变。
  const vaults = onlyIds ? reg.vaults.filter((v) => onlyIds.has(v.id)) : reg.vaults;
  const summary = vaults.map((v) => {
    const base = { id: v.id, name: v.name, path: v.path, color: v.color || '#7B5CFF' };
    if (!v.path || !fs.existsSync(v.path)) return { ...base, cards: 0, tags: 0, missing: true, titles: new Set(), tagsSet: new Set() };
    try {
      const s = scanVault(v.path);
      return { ...base, cards: s.cards, scanned: s.scanned, truncated: s.truncated, tags: s.tags.size, titles: s.titles, tagsSet: s.tags };
    } catch (e) {
      return { ...base, cards: 0, tags: 0, error: String(e && e.message || e), titles: new Set(), tagsSet: new Set() };
    }
  });
  const nodes = summary.map((s) => ({
    id: s.id, name: s.name, path: s.path, color: s.color,
    cards: s.cards, tags: s.tags, scanned: s.scanned ?? null, truncated: !!s.truncated,
    missing: !!s.missing, error: s.error || null,
  }));
  const edges = [];
  for (let i = 0; i < summary.length; i++) {
    for (let j = i + 1; j < summary.length; j++) {
      const a = summary[i], b = summary[j];
      let sharedTitles = 0, sharedTags = 0;
      for (const t of a.titles) if (b.titles.has(t)) sharedTitles++;
      for (const t of a.tagsSet) if (b.tagsSet.has(t)) sharedTags++;
      const weight = sharedTitles * 2 + sharedTags;
      if (weight > 0) edges.push({ source: a.id, target: b.id, sharedTitles, sharedTags, weight });
    }
  }
  return { nodes, edges };
}

// ---------------- v6.2.0：QS-Shield 抗量子防护层 + 逆向沉淀回写 ----------------
// 诚实边界见 desktop/security/quantum-safe.js 顶部：这里实现的是「抗量子（后量子）
// 密码学」，不是量子计算，也不是 QKD；防逆向做到的是「篡改可检测 + 调试即降级 +
// 密钥不落盘 + 逆向成本显著提高」，不是「绝对不可逆向」。界面与文档照此表述。
const QS = require('./security/quantum-safe.js');

const SEDIMENT_LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxQuestion: 2000,
  maxAnswer: 12000,
  maxThinking: 12000,
  maxConversationTurns: 20,
  maxTurnContent: 2000,
  maxCited: 50,
  maxTags: 10,
  perMinute: 30,
  auditKeep: 500,
};

const qsState = {
  manifest: null,
  integrity: { ok: false, reason: 'not_checked', checked: 0, mismatches: [], rootMatch: false },
  debug: { tripped: false, reasons: [] },
  degraded: false,
  degradeReasons: [],
  ingestCount: 0,
  ingestRejected: 0,
  audit: [],
  auditVault: undefined,
  window: [],
  idempotency: new Map(),
};

function sedimentConfig() {
  const e = readConfig().enterprise || {};
  return {
    enabled: e.sedimentEnabled === true,          // 默认关闭：写入能力必须由企业显式开启
    perMinute: Math.max(1, Math.min(300, Number(e.sedimentPerMinute) || SEDIMENT_LIMITS.perMinute)),
  };
}
function setSedimentConfig(patch) {
  const cfg = readConfig();
  cfg.enterprise = { ...(cfg.enterprise || {}), ...patch };
  writeConfig(cfg);
  return sedimentConfig();
}

// ---------------- v6.37.0：企业版知识库 API 自动同步 ----------------
// 后端真实门禁：默认关闭，只有 enterprise.sync.enabled 显式为真才允许拉取；
// 这与 sediment 的纪律一致（写/联网能力必须企业显式开启），不靠 UI 灰按钮糊弄。
function syncConfig() { return vaultSync.readSyncConfig(readConfig()); }
function syncEnabled() { return syncConfig().enabled === true; }
/** 同步落盘目录：当前库的 _memory/remote/，绝不触碰用户正文目录 */
function syncDestDir() {
  if (!state.root) return null;
  return path.join(state.root, '_memory', 'remote');
}
function syncToken() {
  // 令牌保存在 enterprise.sync.token（用户在企业设置中填写的远端 API Bearer 令牌）。
  // 为空时同步器会如实回报鉴权失败，绝不静默降级成"不鉴权"。
  const c = syncConfig();
  return c.token ? String(c.token) : '';
}
async function runVaultSync(opts = {}) {
  if (!syncEnabled()) return { ok: false, error: '知识库自动同步未启用（企业版需在设置中开启）' };
  if (state.syncRunning) return { ok: false, error: '上一次同步仍在进行' };
  const dest = syncDestDir();
  if (!dest) return { ok: false, error: '尚未打开任何知识库' };
  const c = syncConfig();
  state.syncRunning = true;
  try {
    const r = await vaultSync.pull({
      baseUrl: c.baseUrl, token: syncToken(), vaultId: c.vaultId,
      intervalMs: c.intervalMs, destDir: dest,
    });
    // 把结果写入配置，供状态查询与重启后展示（不含令牌明文）
    const cfg = readConfig();
    const s = vaultSync.readSyncConfig(cfg);
    s.lastSyncAt = new Date().toISOString();
    s.lastResult = { ok: !!r.ok, added: r.added || 0, updated: r.updated || 0,
      unchanged: r.unchanged || 0, total: r.total || 0, error: r.error || null };
    cfg.enterprise = { ...(cfg.enterprise || {}), sync: s };
    writeConfig(cfg);
    // 同步后让当前库重建索引，使新拉取的卡片立即可检索（真实增量索引）
    if (r.ok && (r.added > 0 || r.updated > 0) && state.store?.indexVault) {
      try { state.store.indexVault(); } catch { /* 索引失败不影响同步结果回报 */ }
    }
    return r;
  } finally { state.syncRunning = false; }
}
function applySyncSchedule() {
  if (state.syncTimer) { clearInterval(state.syncTimer); state.syncTimer = null; }
  const c = syncConfig();
  if (!c.enabled || !c.baseUrl) return;
  // 启动后先静默拉一次，再按间隔自动同步；失败只是记状态，不弹窗打扰。
  setTimeout(() => { void runVaultSync(); }, 3000).unref?.();
  state.syncTimer = setInterval(() => { void runVaultSync(); }, c.intervalMs);
  state.syncTimer.unref?.();
}

function sedimentAuditFile() {
  return state.root ? path.join(state.root, '.neolink', 'security', 'sediment-log.jsonl') : null;
}
/** 审计日志按库懒加载；切换库时清空进程内的幂等表，避免跨库串号 */
function ensureAudit() {
  if (qsState.auditVault === state.root) return;
  qsState.auditVault = state.root || null;
  qsState.audit = [];
  qsState.idempotency.clear();
  const f = sedimentAuditFile();
  if (f && fs.existsSync(f)) {
    try {
      qsState.audit = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
        .slice(-SEDIMENT_LIMITS.auditKeep)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
    } catch { qsState.audit = []; }
  }
  for (const r of qsState.audit) {
    if (r.idempotencyKey) qsState.idempotency.set(r.idempotencyKey, r);
  }
}
function appendSedimentAudit(rec) {
  const f = sedimentAuditFile();
  if (!f) return false;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(rec) + '\n', 'utf8');
    qsState.audit.push(rec);
    if (qsState.audit.length > SEDIMENT_LIMITS.auditKeep) {
      qsState.audit = qsState.audit.slice(-SEDIMENT_LIMITS.auditKeep);
      const raw = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      if (raw.length > SEDIMENT_LIMITS.auditKeep * 2) {
        fs.writeFileSync(f, raw.slice(-SEDIMENT_LIMITS.auditKeep).join('\n') + '\n', 'utf8');
      }
    }
    return true;
  } catch { return false; }
}

/** 启动自检：完整性基线 + 反调试探针。发现异常一律「降级」而非退出。 */
function qsBootstrap() {
  const root = __dirname;
  const manifestPath = path.join(root, 'security', 'integrity.json');
  const packaged = fs.existsSync(path.join(root, 'BUILD.txt'));
  const reasons = [];
  if (fs.existsSync(manifestPath)) {
    try {
      qsState.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      qsState.integrity = QS.verifyManifest(root, qsState.manifest);
      if (!qsState.integrity.ok) {
        const files = qsState.integrity.mismatches.map((m) => m.path).slice(0, 3).join('、');
        reasons.push('完整性自检未通过' + (files ? '（' + files + '）' : ''));
      }
    } catch (e) {
      // v6.9.0：旧写法把异常原因整个吞掉，diag.json 只留下 'manifest_unreadable'，
      // 无法区分「JSON 损坏 / 权限拒绝 / verifyManifest 内部异常」，真机排障只能靠猜。
      // 这里如实把错误文本带到诊断标记与 securityStatus，便于定位；不改变降级语义。
      qsState.integrity = {
        ok: false, reason: 'manifest_unreadable', checked: 0, mismatches: [], rootMatch: false,
        error: String(e && e.message || e),
      };
      reasons.push('完整性清单无法读取');
    }
  } else if (packaged) {
    qsState.integrity = { ok: false, reason: 'manifest_missing', checked: 0, mismatches: [], rootMatch: false };
    reasons.push('正式包缺少完整性清单');
  } else {
    // 源码直跑（开发态）：没有 BUILD.txt，如实标注未配置基线，不假装通过
    qsState.integrity = { ok: false, reason: 'dev_mode', checked: 0, mismatches: [], rootMatch: false };
  }
  qsState.debug = QS.probeDebug();
  if (qsState.debug.tripped) reasons.push('检测到调试器：' + qsState.debug.reasons.join('、'));
  qsState.degraded = reasons.length > 0;
  qsState.degradeReasons = reasons;
  mark('qs-shield', {
    degraded: qsState.degraded,
    integrity: qsState.integrity.reason || 'ok',
    digestBackend: QS.status().digestBackend,
    ...(qsState.integrity.error ? { integrityError: qsState.integrity.error } : {}),
  });
}

function securityStatus() {
  const s = QS.status();
  return {
    ok: true,
    suite: s.suite, claim: s.claim,
    quantumComputing: s.quantumComputing, qkd: s.qkd,
    algorithms: s.algorithms,
    hashBytes: s.hashBytes, winternitz: s.winternitz, chainsPerSignature: s.chainsPerSignature,
    signatureCount: s.signatureCount, seenRoots: s.seenRoots, digestBackend: s.digestBackend,
    integrity: {
      ...qsState.integrity,
      baselineFiles: qsState.manifest?.files?.length || 0,
      baselineAt: qsState.manifest?.createdAt || null,
      devMode: qsState.integrity.reason === 'dev_mode',
    },
    debug: qsState.debug,
    degraded: qsState.degraded,
    degradeReasons: qsState.degradeReasons,
    tokenStorage: 'Electron safeStorage（Windows DPAPI / macOS Keychain）',
    // v6.22.0：如实反映当前绑定模式，不再在局域网模式下还写着「仅回环」
    apiBinding: (apiServerStatus().bind === 'lan' ? '0.0.0.0 局域网（用户显式开启）' : '127.0.0.1 回环') + ' + Bearer 令牌',
  };
}

function sedimentStatus() {
  ensureAudit();
  const c = sedimentConfig();
  const now = Date.now();
  return {
    ok: true,
    enabled: c.enabled,
    endpoint: 'POST /api/sediment',
    degraded: qsState.degraded,
    perMinute: c.perMinute,
    usedThisMinute: qsState.window.filter((t) => now - t < 60000).length,
    ingestCountThisSession: qsState.ingestCount,
    rejectedThisSession: qsState.ingestRejected,
    auditRecords: qsState.audit.length,
    auditFile: sedimentAuditFile(),
    running: !!apiServer,
    recent: qsState.audit.slice(-5).reverse().map((r) => ({
      id: r.id, ts: r.ts, question: r.question, caller: r.caller,
      citedCount: r.citedCount, cardPath: r.cardPath,
      rootShort: (r.qs?.root || '').slice(0, 16),
    })),
  };
}

/** 字段白名单 + 长度收敛。任何不合规字段直接拒绝，绝不静默吞掉。 */
function normalizeSediment(b, store) {
  // v6.23.0：引用卡片必须在「本次请求定向到的那个库」里真实存在，
  // 而不是一律拿当前活动库来判定（否则跨库请求会凭空引用到别的库）。
  const src = store || state.store;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'body_must_be_object' };
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const question = s(b.question, SEDIMENT_LIMITS.maxQuestion).trim();
  if (!question) return { error: 'question_required' };
  const answer = s(b.answer, SEDIMENT_LIMITS.maxAnswer);
  const thinking = s(b.thinking, SEDIMENT_LIMITS.maxThinking);
  let conversation = [];
  if (b.conversation !== undefined) {
    if (!Array.isArray(b.conversation)) return { error: 'conversation_must_be_array' };
    if (b.conversation.length > SEDIMENT_LIMITS.maxConversationTurns) return { error: 'too_many_turns' };
    conversation = b.conversation.map((t) => ({
      role: s(t && t.role, 20) || 'unknown',
      content: s(t && t.content, SEDIMENT_LIMITS.maxTurnContent),
    })).filter((t) => t.content);
  }
  if (!answer && !thinking && !conversation.length) return { error: 'nothing_to_sediment' };
  let cited = [];
  if (b.cited_node_ids !== undefined) {
    if (!Array.isArray(b.cited_node_ids)) return { error: 'cited_node_ids_must_be_array' };
    // 只保留当前库里真实存在的卡片 id，杜绝凭空引用
    cited = b.cited_node_ids.filter((x) => typeof x === 'string')
      .slice(0, SEDIMENT_LIMITS.maxCited)
      .filter((id) => !!src.getNode(id));
  }
  const tags = Array.isArray(b.tags)
    ? b.tags.filter((x) => typeof x === 'string').slice(0, SEDIMENT_LIMITS.maxTags).map((x) => x.slice(0, 40))
    : [];
  let confidence = null;
  if (typeof b.confidence === 'number' && Number.isFinite(b.confidence)) {
    confidence = Math.max(0, Math.min(1, b.confidence));
  }
  const caller = s(b.caller, 80) || 'api';
  return { payload: { question, answer, thinking, conversation, cited_node_ids: cited, confidence, tags, caller } };
}

/**
 * 逆向沉淀：外部系统读走卡片（GET /api/cards）→ 生成答案/分析思维/对话 →
 * 回写到这里 → 复用 kb_write_back 追加式生成卡片并回连被引卡片 →
 * 下次检索可召回。全过程留抗量子签名与逐条审计，可离线验签。
 */
function sedimentIngest(body, meta = {}, srcStore = state.store) {
  const reject = (code, error, extra) => {
    qsState.ingestRejected++;
    return { code, payload: { ok: false, error, ...(extra || {}) } };
  };
  const cfg = sedimentConfig();
  if (!cfg.enabled) return reject(403, 'sediment_disabled', { hint: '请在企业控制台开启「逆向沉淀回写」开关' });
  if (qsState.degraded) return reject(403, 'security_degraded', { reasons: qsState.degradeReasons });
  if (!srcStore || !state.root || !state.engine) return reject(409, 'no_vault_open');
  ensureAudit();
  const idem = typeof body?.idempotency_key === 'string' ? body.idempotency_key.slice(0, 128) : '';
  if (idem && qsState.idempotency.has(idem)) {
    const prev = qsState.idempotency.get(idem);
    return { code: 200, payload: { ok: true, duplicate: true, id: prev.id, ts: prev.ts, cardPath: prev.cardPath } };
  }
  const now = Date.now();
  qsState.window = qsState.window.filter((t) => now - t < 60000);
  if (qsState.window.length >= cfg.perMinute) {
    return reject(429, 'rate_limited', {
      limit: cfg.perMinute,
      retryAfterSec: Math.max(1, Math.ceil((60000 - (now - qsState.window[0])) / 1000)),
    });
  }
  const norm = normalizeSediment(body, srcStore);
  if (norm.error) return reject(400, norm.error);
  const p = norm.payload;
  const canonical = JSON.stringify(p);
  let signed;
  try { signed = QS.sign(canonical); }
  catch (e) { return reject(500, 'sign_failed', { detail: String(e?.message || e) }); }

  const lines = ['## 最终回答', p.answer || '（本次未提供最终回答）', ''];
  if (p.thinking) lines.push('## 分析思维', p.thinking, '');
  if (p.conversation.length) {
    lines.push('## 对话记录');
    for (const t of p.conversation) lines.push(`- **${t.role}**：${t.content}`);
    lines.push('');
  }
  if (p.cited_node_ids.length) {
    lines.push('## 引用卡片（回连原卡）');
    for (const id of p.cited_node_ids) {
      const n = srcStore.getNode(id);
      lines.push(`- ${n ? n.title : id} \`${id}\``);
    }
    lines.push('');
  }
  lines.push(`> 逆向沉淀 · 来源 ${p.caller} · 置信度 ${p.confidence === null ? 'n/a' : p.confidence} · ${signed.createdAt}`);
  lines.push(`> 抗量子签名 QS-WOTS-SHA3-256 · root ${signed.root.slice(0, 24)}…`);
  lines.push('> 完整签名与规范化载荷见 .neolink/security/sediment-log.jsonl，可用 /api/sediment/verify?id= 验证。');

  let toolOut = null;
  // v6.23.0：读的是「请求定向到的源库」，写的是「用户选定的沉淀回写仓库」。
  // 没选沉淀库时 sedimentStore 缺失，kb_write_back 保持 6.22.0 行为写回源库。
  const sedRef = getSedimentStore();
  try {
    const ctx = {
      ...(state.ctx || {}),
      store: srcStore, caller: p.caller, canWriteBody: true,
      vaultId: meta.vaultId || (state.root ? vaultIdFor(state.root) : ''),
      // v6.29.0 功能①：把源库真实名称传进回写上下文，供跨库回流关联标注来源（不编造库名）。
      sourceVaultName: meta.vaultName || (srcStore ? path.basename(srcStore.root) : ''),
      ...(sedRef ? { sedimentStore: sedRef.store, sedimentVaultId: sedRef.id } : {}),
    };
    toolOut = state.engine.callTool('kb_write_back', {
      question: p.question,
      answer: lines.join('\n'),
      cited_node_ids: p.cited_node_ids,
      confidence: p.confidence,
      tags: p.tags,
    }, ctx);
  } catch (e) {
    return reject(500, 'write_back_failed', { detail: String(e?.message || e) });
  }
  if (toolOut?.error) return reject(400, 'write_back_failed', { detail: String(toolOut.message || toolOut.error) });
  // kb_write_back 真实返回 { node_id, path, qa_id, built_edges, journal }；
  // 直接用它，比从 qaPairs 末尾猜测更可靠（并发回写时不会串号）。
  const fallbackId = 'qa_' + QS.sha3(Buffer.from(canonical, 'utf8')).toString('hex').slice(0, 16);
  const qaId = String(toolOut?.qa_id || fallbackId);
  const cardPath = String(toolOut?.path || ('_memory/semantic/sediment-' + qaId + '.md'));
  const rec = {
    id: qaId, ts: new Date().toISOString(), caller: p.caller,
    question: p.question.slice(0, 200), canonical, qs: signed, cardPath,
    citedCount: p.cited_node_ids.length,
    bytes: Buffer.byteLength(canonical, 'utf8'),
    idempotencyKey: idem || null,
    remote: meta.remote || null,
    // 审计如实区分：从哪个库读的、写到哪个库去的。
    sourceVaultId: meta.vaultId || null,
    sourceVaultName: meta.vaultName || null,
    sedimentVaultId: sedRef ? sedRef.id : null,
    sedimentVaultName: sedRef ? sedRef.name : null,
  };
  const logged = appendSedimentAudit(rec);
  if (idem) qsState.idempotency.set(idem, rec);
  qsState.window.push(Date.now());
  qsState.ingestCount++;
  mark('sediment-ingest', { id: qaId, cited: p.cited_node_ids.length });
  return {
    code: 200,
    payload: {
      ok: true, id: qaId, cardPath, cited: p.cited_node_ids.length,
      vaultId: meta.vaultId || null,
      sedimentVaultId: sedRef ? sedRef.id : null,
      sedimentVaultName: sedRef ? sedRef.name : null,
      signature: { alg: signed.alg, root: signed.root, createdAt: signed.createdAt, oneTime: true },
      auditWritten: logged,
    },
  };
}

/** 离线验签：从审计日志取回规范化载荷与签名，重算哈希链并比对 root */
function sedimentVerify(id) {
  ensureAudit();
  const rec = qsState.audit.find((r) => r.id === id || (r.idempotencyKey && r.idempotencyKey === id));
  if (!rec) return { ok: false, error: 'not_found' };
  const v = QS.verify(rec.canonical, rec.qs);
  return {
    ok: v.ok, reason: v.reason || null,
    id: rec.id, ts: rec.ts, caller: rec.caller, cardPath: rec.cardPath,
    alg: rec.qs?.alg || null, root: rec.qs?.root || null,
    signedAt: rec.qs?.createdAt || null,
    canonicalSha3: QS.sha3(Buffer.from(rec.canonical, 'utf8')).toString('hex'),
  };
}
function sedimentListApi(n = 20) {
  ensureAudit();
  const limit = Math.max(1, Math.min(100, parseInt(n, 10) || 20));
  return {
    ok: true, count: qsState.audit.length,
    items: qsState.audit.slice(-limit).reverse().map((r) => ({
      id: r.id, ts: r.ts, question: r.question, caller: r.caller,
      citedCount: r.citedCount, bytes: r.bytes, cardPath: r.cardPath,
      rootShort: (r.qs?.root || '').slice(0, 16),
    })),
  };
}

/** 读取请求体：硬上限 + 超时。超限不销毁连接，避免连错误响应都发不出去。 */
function readBody(req, limit, cb) {
  let size = 0, done = false;
  const chunks = [];
  const finish = (err) => {
    if (done) return;
    done = true;
    cb(err, err ? null : Buffer.concat(chunks));
  };
  req.on('data', (c) => {
    if (done) return;
    size += c.length;
    if (size > limit) { const e = new Error('body_too_large'); e.code = 'LIMIT'; finish(e); return; }
    chunks.push(c);
  });
  req.on('end', () => finish(null));
  req.on('error', () => { const e = new Error('body_read_error'); e.code = 'BAD'; finish(e); });
  req.setTimeout(10000, () => { const e = new Error('body_timeout'); e.code = 'BAD'; finish(e); });
}

// ---------------- 链接 API（可选的本地只读 HTTP 服务） ----------------
let apiServer = null;
function sendJSON(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(buf);
}
// ── v6.23.0 连接作用域：请求级定向、启停真实生效、按需读盘 ───────────────
function activeVaultId() {
  return state.root ? vaultIdFor(state.root) : (readRegistry().activeId || '');
}
/** 客户端用 X-NeoKB-Vault: <id> 或 ?vault=<id> 指定库；缺省为当前活动库。 */
function apiVaultFor(req, url) {
  const requested = String(req.headers['x-neokb-vault'] || url.searchParams.get('vault') || '').trim();
  return vaultScope.resolveVault(readRegistry(), requested, activeVaultId());
}
/** 只取当前库或已预建索引的缓存；此处绝不扫描任何知识库目录。 */
function apiVaultStore(target) {
  if (!target || !target.ok) return null;
  const id = target.id;
  const root = String(target.entry.path || '');
  const name = String(target.entry.name || '');
  if (id === activeVaultId() && state.store) return { id, root, name, store: state.store, warmed: true };
  const hit = scopeStores.get(id);
  if (hit && hit.root === root) return { id, root, name, store: hit.store, warmed: hit.warmed };
  if (!state.engine || !root || !fs.existsSync(root)) return null;
  try {
    const st = new state.engine.KbStore(root).load();
    scopeStores.set(id, { store: st, root, warmed: false });
    return { id, root, name, store: st, warmed: false };
  } catch { return null; }
}
/** 用户「启用」某库时才真正读盘建一次索引（异步 IPC，不阻塞 HTTP 请求）。 */
async function warmScopeStore(id) {
  const key = String(id || '');
  const reg = readRegistry();
  const v = reg.vaults.find((x) => x.id === key);
  if (!v) return { ok: false, error: 'vault_not_found' };
  if (!v.path || !fs.existsSync(v.path)) return { ok: false, error: 'vault_missing' };
  if (key === activeVaultId() && state.store) return { ok: true, warmed: true, cached: false };
  try {
    const E = state.engine || await loadEngine();
    const st = new E.KbStore(v.path).load();
    await E.indexVault(st);
    scopeStores.set(key, { store: st, root: v.path, warmed: true });
    return { ok: true, warmed: true, cached: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
function evictScopeStore(id) { scopeStores.delete(String(id || '')); }

/** 用户选定的沉淀回写仓库；没选则返回 null（回写仍进当前库，界面如实标注）。 */
function sedimentVaultRef() {
  return vaultScope.sedimentTarget(readConfig(), readRegistry());
}
function getSedimentStore() {
  const ref = sedimentVaultRef();
  if (!ref) return null;
  if (sedimentStoreCache && sedimentStoreCache.vaultId === ref.id) {
    return { ...ref, store: sedimentStoreCache.store, warmed: sedimentStoreCache.warmed };
  }
  if (!state.engine || !ref.path || !fs.existsSync(ref.path)) return null;
  try {
    const st = new state.engine.KbStore(ref.path).load();
    sedimentStoreCache = { vaultId: ref.id, store: st, root: ref.path, warmed: false };
    return { ...ref, store: st, warmed: false };
  } catch { return null; }
}
async function warmSedimentStore(ref) {
  const r = await warmScopeStore(ref.id);
  if (!r.ok) return r;
  const hit = scopeStores.get(ref.id);
  if (hit) sedimentStoreCache = { vaultId: ref.id, store: hit.store, root: ref.path, warmed: hit.warmed };
  else if (state.store && ref.id === activeVaultId()) {
    sedimentStoreCache = { vaultId: ref.id, store: state.store, root: state.root, warmed: true };
  }
  return r;
}

function apiRoute(req, res, url, body, vault) {
  const p = url.pathname;
  const v = vault || { id: activeVaultId(), root: state.root || '', name: '', store: state.store, warmed: false };
  const vid = v.id || '';
  if (p === '/api/health' || p === '/api/' || p === '/') {
    return sendJSON(res, 200, {
      ok: true, product: 'NeoCosmos', version: app.getVersion(), author: '宋锦涛',
      securitySuite: QS.SUITE_ID,
      sedimentEndpoint: sedimentConfig().enabled ? '/api/sediment (enabled)' : '/api/sediment (disabled)',
      // v6.23.0：客户端可定向到指定库；停用 / 不存在的库会被真实拒绝。
      vaultRouting: { header: 'X-NeoKB-Vault', query: 'vault', defaultVaultId: vid,
        requestVaultId: vid, scanMode: 'on_demand', sedimentVaultId: sedimentVaultRef()?.id || null },
    });
  }
  // ---- v6.2.0 企业专属：抗量子安全状态 + 逆向沉淀回写闭环 ----
  if (p === '/api/security/status') return sendJSON(res, 200, securityStatus());
  if (p === '/api/sediment/status') return sendJSON(res, 200, sedimentStatus());
  if (p === '/api/sediment/list') return sendJSON(res, 200, sedimentListApi(url.searchParams.get('limit')));
  if (p === '/api/sediment/verify') return sendJSON(res, 200, sedimentVerify(url.searchParams.get('id') || ''));
  if (p === '/api/sediment' && req.method === 'POST') {
    const r = sedimentIngest(body, {
      remote: req.socket?.remoteAddress || null, vaultId: vid, vaultName: v.name,
    }, v.store || state.store);
    return sendJSON(res, r.code, r.payload);
  }
  if (p === '/api/vaults') {
    const reg = readRegistry();
    const enabled = vaultScope.scopes(reg).filter((s) => s.linkEnabled)
      .map((s) => ({ id: s.id, name: s.name, path: s.path, color: s.color, purpose: s.purpose }));
    // v6.23.0：默认只返回登记元数据，一个字节的卡片正文都不读。
    // 只有显式 ?scan=1 才按需扫描，且只扫「已启用」的库；停用的库不会被碰触。
    const scan = url.searchParams.get('scan') === '1';
    return sendJSON(res, 200, {
      activeId: vid, vaultId: vid, vaultName: v.name || null,
      vaults: enabled,
      scope: { enabled: enabled.length, registered: reg.vaults.length,
        linkEnabledIds: vaultScope.scanIds(reg), scanMode: 'on_demand', scanned: scan },
      xgraph: scan ? computeXGraph(false, { ids: vaultScope.scanIds(reg) }) : null,
      xgraphHint: scan ? '本次按要求扫描了已启用连接的库' : '未扫描磁盘；加 ?scan=1 才按需扫描已启用的库',
    });
  }
  if (p === '/api/graph') {
    const g = state.engine.exportGraphPayload(v.store, { iterations: 200 });
    return sendJSON(res, 200, { ...g, vaultId: vid, vaultName: v.name || null });
  }
  if (p === '/api/cards' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '50', 10) || 50);
    let items = [...v.store.allNodes()].map((n) => ({
      id: n.id, title: n.title, path: n.path, layer: n.memory_layer, tags: n.tags || [], degree: n.degree || 0,
    }));
    if (q) {
      const nq = normTitle(q);
      items = items.filter((it) => normTitle(it.title).includes(nq) || (it.tags || []).some((t) => normTag(t).includes(nq)));
    }
    return sendJSON(res, 200, { vaultId: vid, vaultName: v.name || null,
      count: items.length, items: items.slice(0, limit) });
  }
  const m = p.match(/^\/api\/cards\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const node = v.store.getNode(id) || [...v.store.allNodes()].find((n) => n.title === id);
    if (!node) return sendJSON(res, 404, { error: 'not_found', vaultId: vid });
    let rel = null;
    try { rel = relations(id, { contextLimit: 0, store: v.store }); } catch { rel = null; }
    return sendJSON(res, 200, {
      id: node.id, title: node.title, path: node.path, layer: node.memory_layer,
      tags: node.tags || [], body: node.body || '', relations: rel,
      vaultId: vid, vaultName: v.name || null,
      deepLink: `neolink://open/${vid}/${encodeURIComponent(node.id)}`,
    });
  }
  return sendJSON(res, 404, { error: 'not_found', path: p, vaultId: vid });
}
function startApiServer(opts = {}) {
  const port = Math.max(1024, Math.min(65535, parseInt(opts.port, 10) || 8787));
  const token = String(opts.token || '').trim();
  // v2.2.1 安全加固：**令牌强制必填**。
  // 原实现是 `!token || ...` —— 令牌留空等于**完全不鉴权**，
  // 而 UI 上的提示还写着"留空表示不校验（仅建议本机自用）"。
  // 问题在于：监听 127.0.0.1 挡得住外网，却**挡不住本机上的任何进程**，
  // 更挡不住**浏览器里的任意网页**（见下面的 CORS 处理）——
  // 而这个 API 能读出卡片的**正文全文**。企业库往往是最敏感的数据，
  // "本机自用"这种口头约定撑不住。现在：不填令牌直接拒绝启动。
  if (!token) {
    return { ok: false, error: '必须设置访问令牌才能启动链接 API（该接口可读取卡片正文全文）' };
  }
  if (token.length < 16) {
    return { ok: false, error: '访问令牌至少 16 位（当前 ' + token.length + ' 位）——它等同于读取你全部卡片的钥匙' };
  }
  // 令牌落盘时用系统密钥环加密（见 saveApiToken），不写明文
  const saved = saveApiToken(token, port);
  if (apiServer) stopApiServer();
  // v6.22.0：绑定模式默认仍是回环（保持「数据不出本机」的既有承诺），
  // 只有用户在链接管理页显式选择「局域网」才会监听 0.0.0.0。
  // 两种模式都强制 Bearer 令牌，且 CORS 仍只允许 localhost / 127.0.0.1 回显。
  const cfg0 = readConfig();
  const bindMode = (opts.bind === 'lan' || opts.bind === 'loopback')
    ? opts.bind : (cfg0.apiServer && cfg0.apiServer.bind === 'lan' ? 'lan' : 'loopback');
  const host = bindMode === 'lan' ? '0.0.0.0' : '127.0.0.1';
  const server = http.createServer((req, res) => {
    // ── v6.22.0 真实访问日志 ──────────────────────────────────────────────
    // 每一个真实请求（含 400 / 401 / 403 / OPTIONS 预检）在响应结束时落一条记录。
    // 只记 pathname，绝不把 ?token= 写进日志；IP / 次数 / 接口分布全部由日志派生。
    const clientIp = connLog.normalizeIp(req.socket && req.socket.remoteAddress);
    const rootName = state.root ? path.basename(state.root) : '';
    let logged = false;
    res.on('finish', () => {
      if (logged) return;
      logged = true;
      connLog.appendAccess(CONN_LOG_DIR, {
        ts: new Date().toISOString(),
        ip: clientIp,
        method: req.method,
        path: String(req.url || '/').split('?')[0],
        status: res.statusCode,
        // v6.23.0：按稳定库 id 归属；鉴权前就被拒绝的请求没有解析出库，如实留空。
        root: (res._neokbVault && res._neokbVault.root) || rootName,
        vaultId: (res._neokbVault && res._neokbVault.id) || '',
      });
    });
    // 真实黑名单：命中即拒绝请求本身，不只是界面上标个状态。
    if (connLog.isBlocked(apiBlocklist, clientIp)) {
      return sendJSON(res, 403, { error: 'blocked', ip: clientIp });
    }
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${port}`); }
    catch { return sendJSON(res, 400, { error: 'bad_request' }); }
    // v2.2.1 安全加固：不再对任意来源开放 CORS。
    // 原实现 `Access-Control-Allow-Origin: *'` 意味着**任意一个网页**都能
    // 用用户浏览器里的 JS 读取 127.0.0.1 上的这个 API —— 相当于把
    // 企业的知识库开放给了所有访问过的网站。现在只在带正确令牌时
    // 才回显允许来源（回显具体 Origin 而非 *），且不带凭据。
    const origin = req.headers.origin || '';
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (origin) {
      // 其他来源：不回显 Allow-Origin，浏览器自会拦下跨域读取
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    // 鉴权：令牌**必须**匹配（不再有"空令牌即免检"的口子）
    const auth = req.headers['authorization'] || '';
    const qToken = url.searchParams.get('token') || '';
    const okToken = auth === `Bearer ${token}` || qToken === token;
    if (!okToken) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="NeoCosmos"');
      return sendJSON(res, 401, { error: 'unauthorized' });
    }
    // ── v6.23.0 请求级作用域（鉴权通过后才解析，不向未授权请求泄露库清单）──
    // 停用的库返回 403、不存在的库返回 404：这是服务端真实拒绝，不是界面灰按钮。
    // 数据端点只拿目标库自己的 store，不会把当前活动库的内容串给别人。
    const publicPath = ['/api/health', '/api/', '/', '/api/security/status'].includes(url.pathname);
    let vault = null;
    if (!publicPath) {
      const target = apiVaultFor(req, url);
      if (!target.ok) {
        return sendJSON(res, target.error === 'vault_disabled' ? 403 : 404,
          { error: target.error, vaultId: target.id });
      }
      vault = apiVaultStore(target);
      if (!vault || !vault.store) {
        return sendJSON(res, 409, { error: 'vault_not_ready', vaultId: target.id,
          hint: '请在链接管理里启用该知识库（会预建一次索引），或先在客户端里打开一次' });
      }
      res._neokbVault = { id: vault.id, root: path.basename(vault.root) };
    }
    // 安全状态端点不依赖知识库：未开库时也能核实防护层是否在降级态
    if (url.pathname === '/api/security/status') return sendJSON(res, 200, securityStatus());
    // v6.2.0：POST 仅用于逆向沉淀回写。体长有硬上限，避免本机进程灌爆内存。
    if (req.method === 'POST') {
      return readBody(req, SEDIMENT_LIMITS.maxBodyBytes, (err, raw) => {
        if (err) return sendJSON(res, err.code === 'LIMIT' ? 413 : 400, { error: err.message });
        let parsed = null;
        try { parsed = JSON.parse(raw.toString('utf8')); }
        catch { return sendJSON(res, 400, { error: 'invalid_json' }); }
        if (!state.store) return sendJSON(res, 409, { error: 'no_vault_open' });
        try { apiRoute(req, res, url, parsed, vault); }
        catch (e) { sendJSON(res, 500, { error: String(e && e.message || e) }); }
      });
    }
    if (!state.store) return sendJSON(res, 409, { error: 'no_vault_open' });
    try { apiRoute(req, res, url, undefined, vault); }
    catch (e) { sendJSON(res, 500, { error: String(e && e.message || e) }); }
  });
  server.on('error', (e) => { apiServer = null; mark('api-server-error', { error: String(e && e.message || e) }); });
  // 追踪真实活跃 socket，供「断开该 IP 的当前连接」使用。HTTP 短连接没有
  // 常驻会话，关掉 socket 只影响此刻的连接，后续请求要靠黑名单拒绝 —— 界面如实说明。
  server.on('connection', (socket) => {
    activeApiSockets.add(socket);
    socket.on('close', () => activeApiSockets.delete(socket));
    socket.on('error', () => activeApiSockets.delete(socket));
  });
  server.listen(port, host, () => { mark('api-server-start', { port, bind: bindMode }); });
  apiServer = server;
  const cfg = readConfig();
  cfg.apiServer = { ...(cfg.apiServer || {}), enabled: true, port, bind: bindMode };
  writeConfig(cfg);
  apiBlocklist = connLog.blocklistOf(cfg);
  // 令牌只在**启动的那一刻**回传给界面（用户要拿它去配 Agent）；
  // 之后 status() 不再明文回传，界面上的令牌框显示占位符。
  return { ok: true, port, token, host, bind: bindMode,
           lanIps: connLog.lanAddresses().map((x) => x.address),
           tokenEncrypted: !saved.plaintext };
}
/** 真实断开某 IP 当前存活的 socket，返回实际关闭数量（不虚报）。 */
function disconnectIp(ip) {
  const target = connLog.normalizeIp(ip);
  let closed = 0;
  for (const s of activeApiSockets) {
    if (connLog.normalizeIp(s.remoteAddress) !== target) continue;
    try { s.destroy(); closed++; } catch { /* 已关闭的 socket 不计入 */ }
    activeApiSockets.delete(s);
  }
  return closed;
}
function stopApiServer() {
  if (apiServer) { try { apiServer.close(); } catch { /* ignore */ } apiServer = null; }
  const cfg = readConfig();
  cfg.apiServer = { ...(cfg.apiServer || {}), enabled: false };
  writeConfig(cfg);
  return { ok: true, running: false };
}
function apiServerStatus() {
  const cfg = readConfig();
  const s = cfg.apiServer || {};
  const stored = String(s.tokenStored || '');
  const bind = s.bind === 'lan' ? 'lan' : 'loopback';
  return {
    running: !!apiServer,
    port: s.port || 8787,
    bind,
    host: bind === 'lan' ? '0.0.0.0' : '127.0.0.1',
    // v6.22.0：真实枚举的本机局域网 IPv4，不猜测、不写死
    lanIps: connLog.lanAddresses(),
    activeConnections: activeApiSockets.size,
    blocklist: connLog.blocklistOf(cfg),
    logWindow: connLog.MAX_KEEP,
    // 只回传"有没有设令牌"，不回传令牌本身
    hasToken: !!stored,
    tokenEncrypted: stored.startsWith('enc:'),
    tokenPlaintextRisk: stored.startsWith('plain:'),
  };
}

/** v6.22.0：链接管理页的单一取数入口 —— 状态 + 从真实日志聚合的连接视图。 */
function connectionOverview() {
  const st = apiServerStatus();
  const rootName = state.root ? path.basename(state.root) : '';
  const vaultId = activeVaultId();
  const agg = connLog.aggregate(CONN_LOG_DIR, {
    root: rootName || undefined,
    vaultId: vaultId || undefined,
    blocklist: st.blocklist,
  });
  const reg = readRegistry();
  return { server: st, ...agg, vault: rootName || null, vaultId: vaultId || null,
    // v6.23.0：每个库的启停状态 + 从真实日志派生的按库调用数（没有记录就是 0）。
    scopes: vaultScope.scopeSummary(reg, agg.vaultCounts),
    sedimentVault: sedimentVaultRef(),
    scanPolicy: { mode: 'on_demand', enabled: vaultScope.scanIds(reg).length,
      registered: reg.vaults.length } };
}

// ---------------- 运行时状态 ----------------
const state = {
  store: null, root: null, ctx: null, engine: null, graphCache: null, graphCacheKey: null,
  suppressWatchUntil: 0, remoteCache: new Map(),
  organism: null, mindTimer: null,   // v6.3.0 自主认知循环
  quantumCognition: null,            // v6.6.0 量子认知层（桌面精灵用，保留）
  neuro: null,                       // v6.8.0 类脑计算引擎（SNN/吸引子/序列/预测编码）
  // v6.11 ASTRA：常驻自主意识内核 / 漫游引擎 / 定时器 / 交互状态
  astra: null, astraMotion: null, astraHeartTimer: null, astraFrameTimer: null,
  astraDrag: null, astraIgnore: false, astraClickThrough: true,
  astraPanelOpen: false, astraUserMode: 'auto', astraLastHit: 0, astraHeartCount: 0,
  astraLibrary: null,            // v6.12 思维沉淀库（安装目录下自动建立）
  syncTimer: null,               // v6.37.0 企业版知识库 API 自动同步定时器
  syncRunning: false,            // v6.37.0 防止同步任务并发重入
};
let watcher = null;
let watchTimer = null;

// ---------------- v6.3.0：自主认知循环 ----------------
// 「活体系统」是产品隐喻；真实内涵只有四件事：持久状态、可开关的自主联想循环、
// 反馈驱动的权重学习、经验卡追加。确定性状态机，无模型/无网络/无意识，受 CPU 约束。
// 状态落在 app userData，与知识库内容隔离，升级或换库都不丢。
function initOrganism() {
  if (state.organism || !state.engine?.cognition) return;
  const file = path.join(app.getPath('userData'), 'organism-state.json');
  const storage = {
    read: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    write: (s) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf8');
      } catch (e) { console.error('[organism] 状态落盘失败', e); }
    },
  };
  state.organism = state.engine.cognition.createOrganism({ storage });
  // 自主循环默认关闭；开启后每 20s 由默认网络沿真实连接组自发联想一次，
  // 思维事件可回放、可审计，并实时推给渲染层的 3D 智脑。
  state.mindTimer = setInterval(() => {
    try {
      if (!state.organism || !state.organism.status().autonomous) return;
      const r = state.organism.tick();
      if (!r.skipped && win && !win.isDestroyed()) win.webContents.send('mind:tick', { event: r.event, pulses: r.pulses, levels: r.levels });
      // v6.8.0：类脑计算引擎接入自主循环 —— 每次心跳用真实 SNN 把漫游激活跑成神经脉冲，
      // 并做吸引子联想补全 + 序列/预测编码，结果推给 3D 智脑与神经网络视图（不吸收噪声漫游）。
      if (!r.skipped) neuroSense(r.levels, r.event?.seedRegion || 'idle', false);
      // v6.6.0：量子认知层接入自主循环 —— 每次心跳额外跑一次
      // 「制备 → 连接组纠缠 → 酉演化 → Born 测量」，把坍缩脑区回灌 3D 智脑。
      // v6.41.0：桌面精灵已移除，仅保留 3D 智脑通道（win）。
      if (!r.skipped && state.quantumCognition?.bound) {
        try {
          state.quantumCognition.setOrganism?.(state.organism);
          const qp = state.quantumCognition.run();
          if (win && !win.isDestroyed()) win.webContents.send('mind:quantum', qp);
        } catch (e) { /* 量子层异常绝不影响自主循环 */ }
      }
    } catch (e) { /* 自主循环异常绝不影响主流程 */ }
  }, 20000);
  if (state.mindTimer.unref) state.mindTimer.unref();
}

async function openVault(dir) {
  const E = await loadEngine();
  state.engine = E;
  if (!dir) throw new Error('vault 路径为空');
  const abs = path.resolve(String(dir));
  fs.mkdirSync(abs, { recursive: true });
  // v2.1.0：目标库大到当前堆撑不住时，带 --js-flags 重启后再打开（避免 OOM）
  if (relaunchWithBiggerHeap(abs)) {
    await new Promise((r) => setTimeout(r, 400)); // 等重启进程接手
    return null;
  }
  const st = new E.KbStore(abs).load();
  // v2.1.0：state.root 先落位。万一后续步骤抛异常，状态也是"已加载但待修复"，
  // 而不是 root 为 null —— 后者会让 vaultInfo / graph:get 一律抛
  // "path argument must be of type string. Received null"，把真正的错误掩盖掉。
  state.root = st.root;
  state.store = st;
  await E.indexVault(state.store);
  state.ctx = { store: state.store, caller: 'ui', canWriteBody: true, vaultId: state.root ? vaultIdFor(state.root) : '' };
  state.graphCache = null; state.graphCacheKey = null;
  registerVault(abs);
  const cfg = readConfig();
  cfg.vaultPath = state.root;
  cfg.lastOpenedAt = new Date().toISOString();
  writeConfig(cfg);
  // v6.40.1：把「当前打开的库」发布为跨进程共享真源。
  // 外部平台（AutoClaw / WorkBuddy）经 MCP 调取时据此跟随当前库，
  // 不再命中连接时固化的旧库 / 内置示例文档。
  try {
    mcpLinks.writeActiveVault({
      vaultPath: state.root,
      vaultId: state.root ? vaultIdFor(state.root) : '',
      product: EDITION_INFO.appName,
    });
  } catch { /* 发布失败不阻断开库 */ }
  state.suppressWatchUntil = Date.now() + 1500; // 吞掉打开时的初始事件风暴
  startWatcher();
  // v2.1.0：后台预热倒排索引。倒排是懒构建的，但百万级库建一遍要 ~57 秒
  // （两遍构建：全局 df + 倒排），若等到用户第一次搜索才建，用户会以为"搜索卡住了"。
  // 这里在打开库后空闲时先建好；内存在 4084MB 上限内（实测常驻 2.5GB + 倒排约 0.6GB）。
  setTimeout(() => {
    try {
      if (state.store && !state.store._bm25 && state.store.nodes.size > 20000) {
        state.store.buildBM25();
      }
    } catch (e) { /* 预热失败不影响主流程：搜索时仍会按需构建 */ }
  }, 3000);
  // v6.37.0：打开库后按企业配置启动 / 重排知识库 API 自动同步（关闭时该函数直接 no-op）
  try { applySyncSchedule(); } catch { /* 同步调度失败不影响开库主流程 */ }
  return vaultInfo();
}

function vaultInfo() {
  if (!state.store) return { ready: false, path: null, nodes: 0, edges: 0 };
  const entry = getVaultEntry(vaultIdFor(state.root));
  return {
    ready: true,
    path: state.root,
    id: entry ? entry.id : null,
    name: entry ? entry.name : path.basename(state.root),
    color: entry ? entry.color : '#8B7BFF',
    cross_links: state.store.crossLinks.length,
    nodes: state.store.nodes.size,
    edges: state.store.edges.size,
    layers: layerCounts(),
    domains: domainCounts(),
    review_items: state.store.reviewItems.length,
    qa_count: state.store.qaPairs.length,
    scale: scaleInfo(),
    heap: heapInfo(),
    // v2.1.0：上下文健康度（openVault 中途失败时 ctx 可能未建立，会让所有 MCP 工具报错）
    ctx_ok: !!state.ctx,
    ctx_store_ok: !!(state.ctx && state.ctx.store),
  };
}

/** v2.1.0：V8 堆状态（百万级语料需要更大的堆，UI 显式告知用户当前上限） */
function heapInfo() {
  const limit = currentHeapMB();
  return {
    limit_mb: limit,
    used_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
    rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    cap_mb: heapCapMB(),
    target_mb: heapTargetMB(state.store ? state.store.nodes.size : 0),
    relaunched: process.env[HEAP_RELAUNCH_ENV] === '1',
  };
}

/**
 * v2.1.0：规模分档。UI 依此决定星图默认走「全量」还是「总览」层级，
 * 也让用户清楚知道当前库处在哪一档。
 *   small   ≤ 2 千     全量渲染
 *   medium  ≤ 2 万     全量渲染（稀疏化显示）
 *   large   ≤ 20 万    总览 + 下钻
 *   million > 20 万    总览 + 下钻（目标容量 100 万张卡片）
 */
function scaleInfo() {
  const n = state.store ? state.store.nodes.size : 0;
  const e = state.store ? state.store.edges.size : 0;
  const tier = n > 200000 ? 'million' : n > 20000 ? 'large' : n > 2000 ? 'medium' : 'small';
  return {
    tier,
    nodes: n,
    edges: e,
    default_level: n > 20000 ? 'overview' : 'full',
    target_capacity: 1000000,
    label: { small: '小型库', medium: '中型库', large: '大型库', million: '百万级库' }[tier],
  };
}

function layerCounts() {
  const c = {};
  // v2.1.0：直接遍历 Map.values()，不再复制一份百万级数组
  for (const n of state.store.nodes.values()) {
    const l = n.memory_layer || 'semantic';
    c[l] = (c[l] || 0) + 1;
  }
  return c;
}

/** 领域分布（总览层级下 UI 需要真实领域计数，不能用聚合节点数冒充） */
function domainCounts() {
  const c = {};
  for (const n of state.store.nodes.values()) {
    const d = n.domain || '_root';
    c[d] = (c[d] || 0) + 1;
  }
  return c;
}

// 首次运行播种：给一个"能立刻看懂"的最小知识网络
function seedStarterKit(dir) {
  const sem = path.join(dir, '_memory', 'semantic');
  fs.mkdirSync(sem, { recursive: true });
  const files = {
    'NeoCosmos 使用手册.md': [
      '# NeoCosmos 使用手册',
      '',
      'NeoCosmos 是**关系优先**的知识网络：突触（带类型、带权重、会强化也会衰减的关系）是第一公民，笔记只是突触交汇处的投影。',
      '',
      '- 写卡片：点左上角「＋」，或直接把 .md 放进 `_memory/semantic/`（外部改动会被自动感知并重建索引）。',
      '- 建关系：正文里写 `[[双链]]`，保存后即成为 explicit_link。',
      '- 找知识：顶部搜索框沿突触扩散检索，每个结果都带"为什么联想到它"的推理链。',
      '- 多知识库：点右上角库名，可新建多个知识库随时切换；卡片之间还能**跨库关联**。',
      '- 睡一觉：在「巩固」执行一轮睡眠，权重归一化、孤立/矛盾条目入库待办。',
      '',
      '相关：[[突触可塑性]] · [[激活扩散]] · [[三层记忆]] · [[多知识库与跨库关联]]。',
      '',
      '#记忆方法 #NeoCosmos',
    ].join('\n'),
    '突触可塑性.md': [
      '# 突触可塑性',
      '',
      '每条关系拥有当前权重、强化次数与最近激活时间：同路径被反复走通即**长时程增强**；久未使用按半衰期衰减到 0.05 下限（永不归零）。',
      '',
      '它使知识网络具备"越用越准"的性质，而不是静态图谱。参见 [[激活扩散]] 与 [[NeoCosmos 使用手册]]。',
      '',
      '#核心机制 #可塑性',
    ].join('\n'),
    '激活扩散.md': [
      '# 激活扩散',
      '',
      '先把查询词作为种子注入网络，再沿突触按权重与跳数衰减做扩散，最终分数与词面召回按 RRF 融合。',
      '',
      '因此**词汇零重叠但结构相邻**的笔记也能被召回，并给出可解释的联想路径。参见 [[突触可塑性]]。',
      '',
      '#核心机制 #检索',
    ].join('\n'),
    '三层记忆.md': [
      '# 三层记忆',
      '',
      '工作记忆（`_inbox`）存放短期线索并会老化；情景记忆沉淀问答与过程；语义记忆（`_memory/semantic`）是稳定结论。',
      '',
      '老化由记忆等级与时间共同决定，巩固时会被 Upgrade / Archive。参见 [[记忆巩固]]。',
      '',
      '#核心机制 #记忆分层',
    ].join('\n'),
    '记忆巩固.md': [
      '# 记忆巩固',
      '',
      '"睡眠"离线任务：实体消歧、补边建议、合并建议（只建议不自动合并）、孤立检测、矛盾检测、按天衰减，并产出健康度报告。',
      '',
      '它保证网络随时间自我整理，而不是越用越乱。参见 [[三层记忆]]。',
      '',
      '#核心机制 #巩固',
    ].join('\n'),
    '多知识库与跨库关联.md': [
      '# 多知识库与跨库关联',
      '',
      'NeoCosmos 支持同时管理多个知识库：每个库是磁盘上一个普通文件夹，有自己的卡片网络、星图与配色；右上角库名可随时切换。',
      '',
      '**跨库关联**是一种新型突触：在右栏「关联卡片」里点「关联到其他库」，把本库卡片指向另一个库里的某张卡片。它会出现在关联列表与星图（外圈的幽灵节点），点一下即可切库直达。',
      '',
      '跨库关系存在 `.neolink/overlay/crosskb.json` 覆盖层里——你的 .md 正文永远不会被改动。',
      '',
      '#核心机制 #多库',
    ].join('\n'),
  };
  let written = 0;
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(sem, name);
    if (!fs.existsSync(p)) { fs.writeFileSync(p, body, 'utf8'); written++; }
  }
  return written;
}

function copyExampleCorpus(dir) {
  let written = 0;
  if (!fs.existsSync(EXAMPLE_CORPUS)) return { written, available: false };
  const walk = (src, relBase) => {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const abs = path.join(src, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.neolink' || e.name === '_graveyard') continue;
        walk(abs, rel);
      } else if (/\.md$/i.test(e.name)) {
        const dst = path.join(dir, '_memory', 'semantic', '示例', e.name);
        if (!fs.existsSync(dst)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.writeFileSync(dst, fs.readFileSync(abs), 'utf8');
          written++;
        }
      }
    }
  };
  walk(EXAMPLE_CORPUS, '');
  return { written, available: true };
}

// ---------------- 文档层：工作区的文档台与关联卡片 ----------------
// 设计依据见 docs/spec/04-workspace.md：
//  · 真相源仍是磁盘上的 .md（file-over-app），本层只做索引与写审计
//  · 关联不是"谁提到了我的标题"这种字符串匹配，而是分型的突触查询
//  · 任何写操作进 journal；自动化（含 AI）永不改写人写正文

const EDGE_LABELS = {
  explicit_link: '显式链接', causal: '因果支撑', hierarchical: '层级包含',
  question_answer: '问答沉淀', semantic_similar: '语义相似',
  co_occurrence: '共现', temporal: '时间邻近', cross_kb: '跨库关联',
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16);
// v2.2.1：备份清单用的**完整** sha256（二进制输入，64 位十六进制）。
// sha256() 是给 journal 用的 16 位短哈希，不能拿来校验备份 —— 那会漏掉碰撞。
const sha256Full = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const dirOf = (rel) => { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); };
const zhCmp = (a, b) => String(a).localeCompare(String(b), 'zh');

function requireStore() {
  if (!state.store) throw new Error('尚无打开的知识库');
  return state.store;
}

function degreeMap() {
  const store = state.store;
  const deg = new Map();
  // v2.1.0：直接遍历 values()，不复制百万级数组
  for (const id of store.nodes.keys()) deg.set(id, 0);
  for (const e of store.edges.values()) {
    deg.set(e.src, (deg.get(e.src) || 0) + 1);
    deg.set(e.dst, (deg.get(e.dst) || 0) + 1);
  }
  return deg;
}

// v2.1.0：卡片树单次返回上限。百万级卡片不能一次性序列化过 IPC（几百 MB 结构化克隆），
// 超限时截断并在 UI 明示"共 N 张，已显示前 M 张"。
const TREE_CAP = 20000;

/** 卡片树：文件夹 + 文件（真相源结构，不做任何改写） */
function buildTree(opts = {}) {
  const cap = Number.isFinite(opts.cap) ? opts.cap : TREE_CAP;
  const store = requireStore();
  const deg = degreeMap();
  const root = { name: '知识库', path: '', dirs: new Map(), files: [] };
  const map = new Map([['', root]]);
  let total = 0;
  let shown = 0;
  let truncated = false;
  for (const n of store.nodes.values()) {
    total++;
    if (truncated) continue;                    // 已截断：只计数，不再展开文件
    if (shown >= cap) { truncated = true; continue; }
    const parts = dirOf(n.path).split('/').filter(Boolean);
    let cur = ''; let node = root;
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!map.has(cur)) {
        const d = { name: p, path: cur, dirs: new Map(), files: [] };
        map.set(cur, d);
        node.dirs.set(p, d);
      }
      node = map.get(cur);
    }
    node.files.push({
      id: n.id, title: n.title, path: n.path,
      layer: n.memory_layer || 'semantic', kind: n.kind || 'note',
      tags: n.tags || [], degree: deg.get(n.id) || 0, mtime: n.mtime || 0,
    });
    shown++;
  }
  const ser = (d) => ({
    name: d.name, path: d.path,
    dirs: [...d.dirs.values()].sort((a, b) => zhCmp(a.name, b.name)).map(ser),
    files: d.files.sort((a, b) => zhCmp(a.title, b.title)),
  });
  const out = ser(root);
  out.total = total;
  out.shown = shown;
  out.truncated = truncated;
  return out;
}

/**
 * v2.2.1：跨库目录树 —— 所有已登记库合并成一棵以库为顶层的树。
 *
 * 与 buildTree() 的区别：
 *   · buildTree 只读**当前库**的内存 store（快，但只有一个库）；
 *   · 本函数对**每一个**已登记库做**只读磁盘扫描**，
 *     不加载它的 store、不建索引、不写盘、不改当前库状态。
 *
 * 为什么用磁盘扫描而不是给每个库都建一个 store：
 *   store.load() 会跑 _migrateLegacyIds()，那会**改写内存里的 id 并可能落盘** ——
 *   对"只是看一眼有哪些文件"这种只读需求，动别人的库是不该有的副作用。
 *   磁盘扫描只读文件拿标题与标签，代价稍高但绝无副作用。
 *
 * 卡片 id 用 engine 的 nodeIdFor(relPath) 计算，与 store 里的完全一致，
 * 这样点开时渲染层拿到的 id 能直接在目标库里定位到这张卡片。
 */
function buildAllVaultsTree(opts = {}) {
  const cap = Number.isFinite(opts.cap) ? opts.cap : TREE_CAP;
  const reg = readRegistry();
  const currentId = state.root ? vaultIdFor(state.root) : reg.activeId;
  const vaults = [];
  let total = 0;
  let shown = 0;
  let truncated = false;

  // v2.2.1：**同名库要能区分**。
  // 用户把库从 C 盘搬到 D 盘后，磁盘上就有两个都叫「NeoCosmos Vault」的目录；
  // 跨库树上并排显示两个一模一样的名字，用户根本分不清哪个是哪个。
  // 这里只对**重名**的库加盘符后缀（NeoCosmos Vault（D:）），不重名的保持原样 ——
  // 改的是显示名，registry 里的正式名称不动。
  const nameCount = new Map();
  for (const v of reg.vaults) nameCount.set(v.name, (nameCount.get(v.name) || 0) + 1);
  const displayName = (v) => {
    if ((nameCount.get(v.name) || 0) <= 1) return v.name;
    const drive = path.parse(path.resolve(String(v.path || ''))).root.replace(/[:\\/]+$/, '').toUpperCase();
    return `${v.name}（${drive || '?'}）`;
  };

  for (const v of reg.vaults) {
    if (shown >= cap) { truncated = true; break; }
    if (!v.path || !fs.existsSync(v.path)) {
      vaults.push({
        id: v.id, name: displayName(v), path: v.path, color: v.color || '#7B5CFF',
        // v6.37.0：带出启用态，供左栏「启用的知识库」过滤复用同一口径
        linkEnabled: v.linkEnabled !== false,
        missing: true, cards: 0, dirs: [], files: [],
      });
      continue;
    }
    const scanned = scanVaultTree(v.path, {
      cap: cap - shown,
      currentVault: v.id === currentId,
    });
    total += scanned.total;
    shown += scanned.shown;
    if (scanned.truncated) truncated = true;
    vaults.push({
      id: v.id, name: displayName(v), path: v.path, color: v.color || '#7B5CFF',
      // v6.37.0：带出启用态，供左栏「启用的知识库」过滤复用同一口径
      linkEnabled: v.linkEnabled !== false,
      missing: false, active: v.id === currentId,
      cards: scanned.total, dirs: scanned.dirs, files: scanned.files,
    });
  }

  return { vaults, currentId, total, shown, truncated };
}

/**
 * 只读扫描一个库，产出其目录树。
 *
 * 与 store 的关系：id 用 fnv1a64(relPath) 派生，与 store.nodeIdFor 完全一致，
 * 因此渲染层拿到的 id 能在该库里直接定位到卡片。
 * 标题与标签从 frontmatter / 正文里抽（与引擎同源规则），抽不到就用文件名。
 */
function scanVaultTree(dir, opts = {}) {
  const cap = Number.isFinite(opts.cap) ? opts.cap : TREE_CAP;
  const root = path.resolve(String(dir));
  const t0 = Date.now();
  const timeLimit = 2500;                   // 单库扫描的时间上限，界面不能被卡住
  const dirs = new Map();                   // relDir → { name, path, subdirs:Set, files:[] }
  const files = [];
  let total = 0, shown = 0, truncated = false;

  const dirNode = (relDir, name) => {
    if (!dirs.has(relDir)) dirs.set(relDir, { name, path: relDir, subdirs: new Set(), files: [] });
    return dirs.get(relDir);
  };
  dirNode('', '');

  const walk = (absDir, relDir, depth) => {
    if (depth > 8) return;
    if (shown >= cap) { truncated = true; return; }
    if (Date.now() - t0 > timeLimit) { truncated = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;                 // .neolink 等元数据目录跳过
      const p = path.join(absDir, e.name);
      if (e.isDirectory()) {
        const childRel = relDir ? `${relDir}/${e.name}` : e.name;
        // 子目录名要登记在**父目录**的 subdirs 里。
        // 早前误写成 dirNode(childRel, ...).subdirs.add(...) ——
        // 那是把子目录名加到子目录自己身上，父目录永远收不到子目录，
        // 于是整棵树只有根节点有内容，所有子目录全部消失
        // （表现为：跨库树里只看得见根目录那几张文件，目录层级整个丢了）。
        dirNode(relDir, relDir ? relDir.split('/').pop() : '').subdirs.add(e.name);
        dirNode(childRel, e.name);
        walk(p, childRel, depth + 1);
        if (truncated) return;
        continue;
      }
      if (!/\.md$/i.test(e.name)) continue;
      total++;
      if (shown >= cap) { truncated = true; continue; }
      const relPath = relDir ? `${relDir}/${e.name}` : e.name;
      const meta = readCardMeta(p, e.name);
      const id = nodeIdOf(relPath);
      const rec = {
        id, path: relPath, title: meta.title,
        layer: meta.layer, tags: meta.tags, degree: 0,
      };
      files.push(rec);
      dirNode(relDir, relDir ? relDir.split('/').pop() : '').files.push(rec);
      shown++;
    }
  };

  walk(root, '', 0);

  // 组装成可序列化的树
  const build = (relDir) => {
    const node = dirs.get(relDir);
    if (!node) return null;
    return {
      name: node.name,
      path: node.path,
      dirs: [...node.subdirs]
        .map((n) => build(node.path ? `${node.path}/${n}` : n))
        .filter(Boolean)
        .sort((a, b) => zhCmp(a.name, b.name)),
      files: node.files.sort((a, b) => zhCmp(a.title, b.title)),
    };
  };

  const rootTree = build('');
  return {
    total, shown, truncated,
    dirs: rootTree ? rootTree.dirs : [],
    files: rootTree ? rootTree.files : [],
  };
}

/**
 * 读一张卡片的元信息（标题 / 层 / 标签）。
 * 只读前若干字节，够解析 frontmatter 与首个标题即可。
 *
 * v2.2.1：**标题规则必须与引擎的 extractTitle 完全一致** ——
 * 引擎是"优先取正文首个 # 标题，否则用文件名"（src/storage/markdown.js）。
 * 早前这里优先取 frontmatter 的 title，于是同一张卡片在跨库树里显示
 * "架构v2升级说明"、在文档台里显示"架构 v2 升级说明" —— 同一个卡片两个名字，
 * 用户点进去会觉得"这不是我点的那个"。所以下面严格照搬引擎的优先级。
 */
function readCardMeta(absPath, fileName) {
  const fallbackTitle = fileName.replace(/\.md$/i, '');
  let raw = '';
  try { raw = fs.readFileSync(absPath, 'utf8').slice(0, 4000); } catch { /* 读不了就退回文件名 */ }
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let tags = [];
  let layer = 'semantic';
  if (fm) {
    const arr = fm[1].match(/tags:\s*\[([^\]]*)\]/);
    if (arr) tags = arr[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const one = fm[1].match(/tags:\s*([^\n\[]+)/);
    if (one && !arr) tags = one[1].trim().split(/\s+/).filter(Boolean);
    const ml = fm[1].match(/memory_layer:\s*["']?([\w-]+)/);
    if (ml) layer = ml[1];
  }
  // 标题：与引擎 extractTitle 同源 —— 先看正文首个 # 标题，再退回文件名
  const body = fm ? raw.slice(fm[0].length) : raw;
  const h1 = body.match(/^\s*#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : fallbackTitle;
  if (layer === 'semantic') {
    if (/_memory\/episodic/i.test(absPath)) layer = 'episodic';
    else if (/_inbox/i.test(absPath)) layer = 'working';
  }
  return { title, tags, layer };
}

/**
 * 与引擎 nodeIdFor 一致的卡片 id（fnv1a64 派生自相对路径）。
 *
 * v2.2.1：这里**必须**用引擎那份实现，不能自己重写一份哈希 ——
 * 跨库树的卡片 id 要能和目标库里 store 里的 id 完全对上，
 * 否则点开卡片会报"卡片不存在"。
 * 引擎那份的算法（两个独立种子的 32 位 FNV-1a 拼接）是**大小写不敏感**的，
 * 自己另写一套几乎必然对不上。
 */
function nodeIdOf(relPath) {
  if (typeof ENGINE_MOD?.nodeIdFor === 'function') return ENGINE_MOD.nodeIdFor(relPath);
  return 'n_' + fnv1a64Local(relPath);
}

/**
 * 引擎 fnv1a64 的**逐行等价实现**（仅在引擎尚未载入时兜底）。
 * 严格照搬 src/storage/store.js 的算法：两个独立种子的 32 位 FNV-1a 拼接。
 * 注意：引擎那份对输入做了 toLowerCase()，此处必须一致。
 */
function fnv1a64Local(str) {
  const s = String(str).toLowerCase();
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x01000193 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** 读单张卡片：正文 + 大纲 + 双链解析（含断链判定） */
function readDoc(id) {
  const store = requireStore();
  const node = store.getNode(id);
  if (!node) throw new Error('卡片不存在');
  const abs = store.resolver.resolve(node.path);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    // 文件已被外部删除：自我修复——把它从索引里摘掉，边同步清理
    if (e && e.code === 'ENOENT') {
      store.nodes.delete(id);
      store.removeEdgesWhere((x) => x.src === id || x.dst === id);
      store.save();
      state.graphCache = null; state.graphCacheKey = null;
      throw new Error('该卡片文件已不存在（可能被外部删除），已自动从索引移除');
    }
    throw e;
  }
  const { frontmatter, body } = state.engine.md.extractFrontmatter(raw);
  const outline = state.engine.md.extractOutline(body);
  const links = state.engine.md.extractWikilinks(body).map((l) => {
    const t = state.engine.findLinkTarget(store, l.target);
    return { target: l.target, exists: !!t, id: t ? t.id : null, title: t ? t.title : null };
  });
  return {
    id: node.id, title: node.title, path: node.path,
    layer: node.memory_layer || 'semantic', kind: node.kind || 'note',
    domain: node.domain || null, tags: node.tags || [],
    mtime: node.mtime, size: node.size, frontmatter, body, raw,
    outline, links,
  };
}

/** 单卡重索引：只重建该节点的显式突触（避免全库重建） */
function reindexNode(rel) {
  const store = state.store;
  const node = store.upsertNodeFromFile(store.resolver.resolve(rel), rel);
  store.removeEdgesWhere((e) => e.src === node.id && e.type === 'explicit_link');
  for (const link of node.links) {
    const t = state.engine.findLinkTarget(store, link);
    if (t && t.id !== node.id) {
      store.addEdge(node.id, t.id, 'explicit_link', { base_weight: 1.0, origin: 'human', confirmed: 1 });
    }
  }
  store.save();
  return node;
}

/** 保存正文：只允许「人」写正文，全程审计 */
function saveDoc(id, text) {
  const store = requireStore();
  const node = store.getNode(id);
  if (!node) throw new Error('卡片不存在');
  const abs = store.resolver.resolve(node.path);
  const before = fs.readFileSync(abs, 'utf8');
  state.suppressWatchUntil = Date.now() + 2500;
  // 原子写入（临时文件 + 改名）：团队共享盘 / 同步盘下更安全
  const tmpSave = `${abs}.tmp-${Date.now()}`;
  fs.writeFileSync(tmpSave, text, 'utf8');
  try { fs.renameSync(tmpSave, abs); }
  catch { fs.writeFileSync(abs, text, 'utf8'); }
  store.journal('doc.save', node.path, sha256(before), {
    actor: 'user', beforeLen: before.length, afterLen: text.length,
  }, 'user');
  const n = reindexNode(node.path);
  state.graphCache = null; state.graphCacheKey = null;
  return { ok: true, id: n.id, title: n.title };
}

/** 新建卡片：断链可在此"生长"，并自动继承所有指向它的突触 */
function createDoc(opts = {}) {
  const store = requireStore();
  const title = state.engine.sanitizeFilename(opts.title || '');
  if (!title) throw new Error('标题不能为空（且不能全是非法字符）');
  const folderRaw = (opts.folder && String(opts.folder).trim()) || '_memory/semantic';
  const folder = folderRaw.replace(/^\/+|\/+$/g, '');
  // 沙箱校验：folder 越界直接抛错（SafeResolver）
  store.resolver.resolve(folder ? `${folder}/x.md` : 'x.md');
  let rel = folder ? `${folder}/${title}.md` : `${title}.md`;
  let abs = store.resolver.resolve(rel);
  let n = 2;
  while (fs.existsSync(abs)) {
    rel = folder ? `${folder}/${title} (${n}).md` : `${title} (${n}).md`;
    abs = store.resolver.resolve(rel);
    n++;
  }
  const tags = (opts.tags || []).map((t) => (String(t).startsWith('#') ? String(t) : `#${t}`));
  const body = [
    `# ${title}`, '',
    opts.body || '', '',
    tags.join(' '), '',
  ].join('\n');
  state.suppressWatchUntil = Date.now() + 2500;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  store.journal('doc.create', rel, null, { actor: 'user', title }, 'user');
  const node = store.upsertNodeFromFile(abs, rel);
  // 自动继承：任何指向该标题的 wikilink（此前是断链）立即结成突触
  let inherited = 0;
  for (const other of store.allNodes()) {
    if (other.id === node.id) continue;
    if ((other.links || []).some((l) => String(l).toLowerCase() === title.toLowerCase())) {
      store.addEdge(other.id, node.id, 'explicit_link', { base_weight: 1.0, origin: 'human', confirmed: 1 });
      inherited++;
    }
  }
  store.save();
  state.graphCache = null; state.graphCacheKey = null;
  return { ok: true, id: node.id, title: node.title, path: node.path, inherited };
}

/** 归档（优雅遗忘）：移入 _graveyard，不真删，可复活 */
function archiveDoc(id) {
  const store = requireStore();
  const node = store.getNode(id);
  if (!node) throw new Error('卡片不存在');
  const src = store.resolver.resolve(node.path);
  const dstRel = `_graveyard/${node.path}`.replace(/^\/+/, '');
  const dst = store.resolver.resolve(dstRel);
  state.suppressWatchUntil = Date.now() + 2500;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  store.journal('doc.archive', node.path, sha256(node.path), { actor: 'user', to: dstRel }, 'user');
  store.nodes.delete(id);
  store.removeEdgesWhere((e) => e.src === id || e.dst === id);
  store.save();
  state.graphCache = null; state.graphCacheKey = null;
  return { ok: true, archivedTo: dstRel };
}

function renameDoc(id, newTitle) {
  const store = requireStore();
  const node = store.getNode(id);
  if (!node) throw new Error('卡片不存在');
  const t = state.engine.sanitizeFilename(newTitle || '');
  if (!t) throw new Error('标题不能为空（且不能全是非法字符）');
  if (t === node.title) return { ok: true, id: node.id, title: node.title, path: node.path };
  const dir = dirOf(node.path);
  const newRel = (dir ? `${dir}/${t}.md` : `${t}.md`);
  const src = store.resolver.resolve(node.path);
  const dst = store.resolver.resolve(newRel);
  if (src.toLowerCase() !== dst.toLowerCase() && fs.existsSync(dst)) throw new Error('同名卡片已存在');
  const oldTitle = node.title;
  state.suppressWatchUntil = Date.now() + 2500;
  fs.renameSync(src, dst);
  store.journal('doc.rename', node.path, sha256(node.path), { actor: 'user', to: newRel }, 'user');
  // 别名覆盖层：别的卡片里写的 [[旧标题]] 依然能解析到新文件（索引侧，不动正文）
  store.setAlias(newRel, oldTitle);
  store.nodes.delete(id);
  store.removeEdgesWhere((e) => e.src === id || e.dst === id);
  const n = reindexNode(newRel);
  // 重建入链：所有引用旧标题 / 新标题的卡片重新结突触
  let relinked = 0;
  for (const other of store.allNodes()) {
    if (other.id === n.id) continue;
    const hit = (other.links || []).some((l) => {
      const l0 = String(l).toLowerCase();
      return l0 === oldTitle.toLowerCase() || l0 === t.toLowerCase();
    });
    if (hit) {
      store.addEdge(other.id, n.id, 'explicit_link', { base_weight: 1.0, origin: 'human', confirmed: 1 });
      relinked++;
    }
  }
  store.save();
  state.graphCache = null; state.graphCacheKey = null;
  return { ok: true, id: n.id, title: n.title, path: n.path, relinked };
}

/** 关联卡片：分型的突触查询（见 04-workspace.md 反转 3） */
function relations(id, opts = {}) {
  // v6.23.0：链接 API 定向到非活动库时传它自己的 store，避免把 A 库的关系安到 B 库上。
  const store = opts.store || requireStore();
  const node = store.getNode(id);
  if (!node) throw new Error('卡片不存在');
  const ctxLimit = opts.contextLimit || 12;
  const pack = (otherId, e) => {
    const n = store.getNode(otherId);
    if (!n) return null;
    return {
      id: n.id, title: n.title, path: n.path, layer: n.memory_layer || 'semantic',
      type: e.type, typeLabel: EDGE_LABELS[e.type] || e.type,
      weight: Number((e.weight || 0).toFixed(3)),
      origin: e.origin || 'model', confirmed: !!e.confirmed,
      hits: e.strength_hits || 0, lastReinforced: e.last_reinforced_at || null,
      reason: e.reason || null,
      tags: n.tags || [],
    };
  };
  const groups = {};
  const byType = {};
  let strengthSum = 0, degree = 0;
  for (const e of store.edges.values()) {
    if (e.src !== id && e.dst !== id) continue;
    const other = e.src === id ? e.dst : e.src;
    const item = pack(other, e);
    if (!item) continue;
    item.direction = e.src === id ? 'out' : 'in';
    // 双向边在两侧都会出现，标注一次即可
    if (!groups[e.type]) groups[e.type] = [];
    groups[e.type].push(item);
    byType[e.type] = (byType[e.type] || 0) + 1;
    strengthSum += item.weight;
    degree++;
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.weight - a.weight);

  // 上下文片段：源文档里提到本卡标题的那一行（只取前若干条，控制 IO）
  const withContext = [];
  const inbound = groups.explicit_link ? groups.explicit_link.filter((x) => x.direction === 'in') : [];
  for (const item of inbound.slice(0, ctxLimit)) {
    let snippet = '';
    try {
      const txt = fs.readFileSync(store.resolver.resolve(item.path), 'utf8');
      const line = txt.split('\n').find((l) => l.includes(node.title));
      if (line) snippet = line.replace(/^\s*[-*>]?\s*/, '').slice(0, 160);
    } catch { /* 忽略：上下文只是增强信息 */ }
    withContext.push({ ...item, snippet });
  }

  // 断链：正文写了 [[X]] 但 X 尚不存在 —— 待生长的突触
  const broken = (node.links || []).filter((l) => {
    const t = state.engine.findLinkTarget(store, l);
    return !t || t.id === id;
  }).map((l) => ({ target: l }));

  // 沉淀引用：外部 Agent 回写进来的问答沉淀
  const sediment = store.qaPairs.filter(
    (q) => (q.cited_node_ids || q.cited_nodes || []).includes(id),
  ).map((q) => ({
    id: q.id, question: q.question, answer: q.answer,
    confidence: q.confidence ?? q.score ?? null, tags: q.tags || [],
    createdAt: q.created_at || q.createdAt || q.ts || null,
    origin: q.origin || (q.caller && q.caller !== 'ui' ? 'agent' : 'user'),
  }));

  // v6.29.0 功能①：回流来源——本卡被哪些「问答沉淀」引用过，以及新建的沉淀卡
  // 又回流连向了哪些被引卡（真实账本，来自 qaPairs[].reflow_links）。
  const reflow = [];
  for (const q of store.qaPairs) {
    // (a) 本卡作为被引卡：它参与过的回流
    const links = Array.isArray(q.reflow_links) ? q.reflow_links : [];
    const selfAsSource = links.filter((l) => l && (l.dst === id || l.src === id));
    if (!selfAsSource.length) continue;
    for (const l of selfAsSource) {
      const otherId = l.dst === id ? l.src : l.dst;
      const other = store.getNode(otherId);
      reflow.push({
        qaId: q.id, question: q.question,
        otherId, otherTitle: other ? other.title : (l.title || otherId),
        direction: l.dst === id ? 'out' : 'in',   // 本卡是被引(dst) → 沉淀卡从本卡长出
        mode: q.reflow_mode || (l.type === 'cross_vault_reflow' ? 'cross_vault' : 'same_vault'),
        type: l.type, built: !!l.built, dangling: !!l.dangling,
        createdAt: q.created_at || q.createdAt || q.ts || null,
      });
    }
  }

  // 跨库关联：从本卡出发指向其他知识库的突触
  const cross = store.crossLinksOf(id).map((c) => ({
    id: c.id, title: c.title, path: c.path,
    vault_id: c.vault_id, vault_name: c.vault_name, vault_color: c.vault_color,
    weight: Number((c.weight ?? 0.9).toFixed(3)), reason: c.reason || null,
    origin: c.origin || 'human', createdAt: c.created_at || null,
  }));

  return {
    id: node.id, title: node.title, path: node.path,
    layer: node.memory_layer || 'semantic', tags: node.tags || [],
    groups, byType, degree,
    strength: Number(strengthSum.toFixed(2)),
    avgWeight: degree ? Number((strengthSum / degree).toFixed(3)) : 0,
    inboundWithContext: withContext,
    broken, sediment, cross, reflow,
    typeLabels: EDGE_LABELS,
  };
}

/** 沉淀控制台：Agent 经 MCP/Skill 回写进来的东西 */
function sedimentList(limit = 80) {
  const store = requireStore();
  // v6.23.0：用户可选「专用沉淀回写仓库」。回写真实落到那个库后，沉淀台必须
  // 把两个库的 qaPairs 一起读出来并标明来源，不能让界面假装没有新回写。
  const sedRef = getSedimentStore();
  const sources = [{ id: state.root ? vaultIdFor(state.root) : '', name: '当前知识库', store }];
  if (sedRef && sedRef.store && sedRef.store !== store) {
    sources.push({ id: sedRef.id, name: sedRef.name, store: sedRef.store });
  }
  const findNode = (id) => {
    for (const s of sources) { const n = s.store.getNode(id); if (n) return n; }
    return null;
  };
  const seen = new Set();
  const qa = [];
  for (const src of sources) {
    for (const q of src.store.qaPairs.slice(-limit).reverse()) {
      const key = String(q.id || '');
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      qa.push({
        id: q.id, question: q.question, answer: q.answer,
        confidence: q.confidence ?? q.score ?? null, tags: q.tags || [],
        createdAt: q.created_at || q.createdAt || q.ts || null,
        vaultId: src.id, vaultName: src.name,
        cited: (q.cited_node_ids || q.cited_nodes || []).map((cid) => {
          const n = findNode(cid);
          return n ? { id: n.id, title: n.title } : null;
        }).filter(Boolean),
        origin: q.origin || (q.caller && q.caller !== 'ui' ? 'agent' : 'user'),
      });
    }
  }
  qa.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const inbox = store.allNodes()
    .filter((n) => (n.memory_layer === 'working') || n.path.includes('_inbox'))
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    .slice(0, limit)
    .map((n) => ({ id: n.id, title: n.title, path: n.path, tags: n.tags || [], mtime: n.mtime }));
  const review = store.reviewItems.slice(-limit).reverse().map((r) => ({
    id: r.id, kind: r.kind, title: r.title, detail: r.detail,
    payload: r.payload, createdAt: r.created_at || r.createdAt || null,
    status: r.status || 'pending',
  }));
  return { qa: qa.slice(0, limit), inbox, review, totals: {
    qa: qa.length, inbox: inbox.length, review: store.reviewItems.length,
  }, sedimentVault: sedRef ? { id: sedRef.id, name: sedRef.name, path: sedRef.path } : null,
     vaults: sources.map((s) => ({ id: s.id, name: s.name })) };
}

/** 一轮"睡眠"：消歧 / 补边建议 / 孤立与矛盾检测 / 按天衰减 / 健康度 */
function runConsolidation() {
  const store = requireStore();
  const { ConsolidationScheduler } = state.engine.consolidation;
  const out = new ConsolidationScheduler(store).run();
  const now = new Date().toISOString();
  const DESC = {
    merge: '合并建议', orphan: '孤立卡片', conflict: '矛盾检测',
    decay: '权重衰减', link: '补边建议', moc: 'MOC 草稿',
  };
  const added = [];
  out.produced.forEach((p, i) => {
    const item = {
      id: `rv_${Date.now().toString(36)}_${i}`,
      kind: p.kind,
      title: (p.payload && p.payload.action) || DESC[p.kind] || p.kind,
      detail: describePayload(p),
      payload: p.payload || {},
      created_at: now,
      status: 'pending',
    };
    store.reviewItems.push(item);
    added.push(item);
  });
  store.save();
  state.graphCache = null; state.graphCacheKey = null;
  return { produced: added, report: out.report, vault: vaultInfo() };
}

function describePayload(p) {
  const pl = p.payload || {};
  const names = (ids) => (ids || []).map((id) => state.store.getNode(id)?.title || id).join('、');
  if (pl.ids) return `同名词条：${names(pl.ids)}`;
  if (pl.a && pl.b) return `${state.store.getNode(pl.a)?.title || pl.a} ≈ ${state.store.getNode(pl.b)?.title || pl.b}`;
  if (pl.node_id) return state.store.getNode(pl.node_id)?.title || pl.node_id;
  if (pl.count != null) return String(pl.count);
  if (pl.before != null) return `总强度 ${pl.before} → ${pl.after}`;
  return JSON.stringify(pl).slice(0, 160);
}

// ---------------- 文件监视器：外部改动 .md 自动重建索引 ----------------
function startWatcher() {
  if (watcher) { try { watcher.close(); } catch { /* 忽略 */ } watcher = null; }
  if (!state.root || process.env.NEOLINK_NO_WATCH) return;
  try {
    watcher = fs.watch(state.root, { recursive: true }, onVaultFsEvent);
  } catch (e) { console.error('[watch] 启动失败', e); }
  // A8 腐烂治理自动化：打开库时若距上次自动睡眠超过 7 天，后台跑一轮（只产建议，不动正文）
  scheduleAutoSleep();
}

let lastAutoSleepAt = 0;
function scheduleAutoSleep() {
  try {
    // v2.1.0：大库不做后台自动睡眠。巩固（消歧 / 合并建议 / 孤立与矛盾检测）
    // 在百万级库上是重活，会把 CPU 与内存吃满、把界面拖死 —— 用户手动触发更合适。
    if (state.store && state.store.nodes.size > AUTO_SLEEP_MAX_NODES) return;
    const cfg = readConfig();
    const last = Date.parse(cfg.lastAutoSleepAt || '') || 0;
    if (Date.now() - last < 7 * 86400000) return;
    setTimeout(() => {
      try {
        if (!state.store) return;
        const before = state.store.reviewItems.length;
        runConsolidation();
        const added = state.store.reviewItems.length - before;
        const cfg2 = readConfig();
        cfg2.lastAutoSleepAt = new Date().toISOString();
        writeConfig(cfg2);
        if (win && !win.isDestroyed() && added > 0) {
          win.webContents.send('app:notice', { text: `自动睡眠完成：新增 ${added} 条待整理建议（未改动任何正文）` });
        }
        console.log(`[auto-sleep] 完成，新增 ${added} 条待整理项`);
      } catch (e) { console.error('[auto-sleep] 失败', e); }
    }, 8000);
  } catch { /* 不阻断 */ }
}

function onVaultFsEvent(_ev, filename) {
  if (!state.store) return;
  const f = String(filename || '');
  if (!f || f.startsWith('.neolink')) return;          // 自写索引/审计文件
  if (Date.now() < state.suppressWatchUntil) return; // 自己刚写完，抑制回环
  clearTimeout(watchTimer);
  watchTimer = setTimeout(async () => {
    if (!state.store) return;
    try {
      state.suppressWatchUntil = Date.now() + 2000;
      await state.engine.indexVault(state.store);
      state.graphCache = null; state.graphCacheKey = null;
      const info = vaultInfo();
      if (win && !win.isDestroyed()) win.webContents.send('vault:changed', info);
    } catch (e) { console.error('[watch] 重建索引失败', e); }
  }, 900);
}

// ---------------- 窗口 ----------------
let win = null;
// v6.41.0：桌面精灵（Cosmos 精灵悬浮窗）已按用户要求移除。
// 量子 / ASTRA / 类脑内核保留 —— 3D 智脑、自主引擎面板与能力中枢仍在使用。
const rendererErrors = [];
// v2.3.0：关闭确认状态（模块级 —— IPC 处理器与 createWindow 都要用）。
//   closeConfirmed —— 渲染层已确认过，这次 close 直接放行
//   closePending   —— 已发起确认询问，避免连点弹多个框
let closeConfirmed = false;
let closePending = false;
let appQuitting = false;          // v6.12：显式退出客户端的意向标志，确保即使精灵尚在关闭中也最终退出
const SMOKE = process.argv.includes('--smoke') || !!process.env.NEOLINK_SMOKE;
// 运行时 UI 审计（构建前质量闸门）。仅在显式给出脚本路径时启用，
// 正式客户端不携带该脚本，因此对用户零影响。
const AUDIT_SCRIPT = process.env.NEOLINK_AUDIT_SCRIPT || '';
// 深链端到端验证探针（tools/e2e-deeplink.mjs 注入）。同样只在显式指定时启用。
const PROBE_SCRIPT = process.env.NEOLINK_PROBE_SCRIPT || '';
const PROBE_RESULT = process.env.NEOLINK_PROBE_RESULT || '';

function createWindow() {
  const primary = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1560, Math.max(1120, primary.width - 120));
  const h = Math.min(980, Math.max(720, primary.height - 90));

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 1060,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#05070F',
    title: 'NeoCosmos · 关系优先的知识网络',
    icon: path.join(APP_ROOT, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    mark('ready-to-show'); win.show();
    if (SMOKE) setTimeout(runSmoke, 2500);
    else if (AUDIT_SCRIPT) setTimeout(runAudit, 2600);
    else if (PROBE_SCRIPT) setTimeout(runProbe, 3200);
  });
  win.on('closed', () => { mark('window-closed'); win = null; });

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) rendererErrors.push(`${String(message).slice(0, 240)} @ ${sourceId || ''}:${line}`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => diagError(`preload ${preloadPath}`, error));
  win.webContents.on('did-finish-load', () => mark('did-finish-load'));
  mark('window-created');

  win.loadURL('neolink://app/index.html');

  if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer] did-fail-load', code, desc, url);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone', details.reason, details.exitCode);
  });

  // ================================================================
  //  v2.3.0：关闭前**必须确认**（用户需求「点击右上角关闭，弹出对话框提醒是否关闭」）。
  //
  //  为什么要两层：
  //    ① 标题栏右上角的 X 走渲染层（app.js 的 confirmCloseApp）——
  //       那条路能拿到"当前卡片有没有未保存修改"，文案可以如实说明。
  //    ② 但 **Alt+F4 / 任务栏右键关闭 / 系统注销** 走的是主进程，
  //       不经过渲染层。若只在渲染层拦，这些路径就是"静默退出"——
  //       用户正在写卡片时按一下 Alt+F4，内容就没了。
  //
  //  所以主进程这里也必须拦一次。代价是渲染层那条路会弹**两次**
  //  ⇒ 用一个标志位区分：渲染层确认过就放行，不再重复询问。
  // ================================================================
  win.on('close', (e) => {
    if (closeConfirmed) { closeConfirmed = false; return; }   // 放行
    if (closePending) return;      // 已在询问中：忽略重复触发
    e.preventDefault();            // 先别关
    closePending = true;
    // 让渲染层弹确认框；有未保存修改时它会明确告知"会丢失"
    // 注意：webContents.send() 返回 undefined（非 Promise），不能 .catch；
    // 窗口正在销毁时 send 可能抛错，这里用 try/catch 兜住，避免主进程崩溃。
    try { win.webContents.send('window:ask-close'); } catch { /* 渲染层已不可达 */ }
  });
  win.on('closed', () => { win = null; });
}

/**
 * v6.12：确保主窗口存在且可见。
 * 典型场景：用户「退出 NeoCosmos」后，app 进程可能因为精灵窗口独存而仍驻留，
 * 再次双击桌面图标触发 second-instance 时 win 已是 null —— 此时必须重建主窗口，
 * 否则表现为「启动无窗口、点不开」。这里统一收口：已存在则恢复/聚焦，已销毁则重建。
 */
let bootstrapped = false;      // v6.13：引导是否完成（协议 / IPC / 引擎都就绪）
let pendingFocus = false;      // 引导期间收到的二次唤起，等就绪后统一补上
function ensureMainWindow() {
  appQuitting = false;           // 重新唤起主窗口 ==> 不再是退出意向
  // 冷启动快速双击时 second-instance 可能早于 bootstrap 完成：
  // 此刻 neolink:// 协议与 IPC 尚未注册，直接 createWindow() 会加载到空白页。
  // 记下意图，等 bootstrap 收尾再恢复；不丢用户的这一次双击。
  if (!bootstrapped) { pendingFocus = true; return; }
  if (win && !win.isDestroyed()) {
    try { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } catch (e) { /* ignore */ }
    return;
  }
  try { createWindow(); } catch (e) { console.error('[win] 重建主窗口失败', e); }
}
function wrap(fn) {
  // v2.2.1：**契约唯一化**。
  // 约定：经 wrap() 的处理器，内层函数只负责返回**业务数据**，
  // 成功与否一律用**抛异常**表达；wrap() 统一产出
  //   成功 → { ok: true,  data: 业务数据 }
  //   失败 → { ok: false, error: 原因 }
  //
  // 早前内层还会自己 return { ok: ... }，于是出现双层 ok：
  //   { ok: true, data: { ok: false, ... } }
  // 渲染层读 r.ok 永远读到外层的 true（**失败也报成功**），
  // 读 r.业务字段又恒为 undefined（抛错 / 静默不做事）。
  // 实测：`crosskb:remove` 删不掉却提示"已删除"；
  //      `crosskb:add` 建成了却抛 TypeError，提示出不来、列表也不刷新
  //      —— 表现就是"点了没反应"。
  // 现在内层一律不自带 ok，契约只有一种读法，静态审计也能逐条核对。
  try { return { ok: true, data: fn() }; }
  catch (e) { console.error('[ipc] ', e); return { ok: false, error: String(e?.message || e) }; }
}
/** v6.23.0：与 wrap 同契约的异步版，用于「启用时预建索引」这类真正要读盘的操作。 */
async function wrapAsync(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { console.error('[ipc] ', e); return { ok: false, error: String(e?.message || e) }; }
}

// ---------------- v6.6.0：Cosmos 精灵「星核」桌面伴侣 ----------------
// 科技宇宙形态：深空合金舱体 + 光学 visor + 全息能量核 + 悬浮数据鳍 + 五段量子通道弧。
// v6.5.0：尺寸可调（0.6～1.5 倍，写进 userData 配置）+ 避开主窗口放置；
// v6.6.0：整体上移，避免全息投影环与角色下缘压住主窗口底部状态栏。
// 量子物理「启发式」构架：本机 CPU 经典模拟叠加态/纠缠/酉演化/Born 规则坍缩
// （见 src/cognition/quantum-mind.js、quantum-cognition.js，非真实量子计算，界面如实标注）。
function ensureQuantum() {
  if (!state.quantum) {
    if (!state.engine) return null;
    try { state.quantum = state.engine.cognition.createQuantumMind({ connectome: state.engine.cognition.CONNECTOME }); }
    catch (e) { console.error('[sprite] 量子引擎初始化失败', e); return null; }
  }
  return state.quantum;
}
/**
 * v6.6.0：量子认知层（3D 智脑用）。与精灵共用同一个 createQuantumMind 实例，
 * 因此「桌面星核」与「3D 智脑」看到的是同一份量子态，不会各算各的。
 */
function ensureQuantumCognition() {
  if (!state.quantumCognition) {
    if (!state.engine?.cognition) return null;
    const Q = ensureQuantum();
    if (!Q) return null;
    try {
      state.quantumCognition = state.engine.cognition.createQuantumCognition({
        quantum: Q, organism: state.organism,
        connectome: state.engine.cognition.CONNECTOME,
        anatomy: state.engine.cognition.ANATOMY,
      });
    } catch (e) { console.error('[mind] 量子认知层初始化失败', e); return null; }
  }
  // 自主内核可能晚于量子层初始化（先打开界面、后打开知识库），每次取用时补挂最新引用，
  // 保证 seed 里的心跳数确实来自运行时真实状态而不是恒为 0。
  if (state.organism) state.quantumCognition.setOrganism?.(state.organism);
  return state.quantumCognition;
}

/**
 * v6.8.0：类脑计算引擎（3D 智脑 / 神经网络视图的真实驱动）。
 * 一台真正参与计算的多算法神经形态引擎：SNN 脉冲沿真实连接组扩散、
 * Hopfield 吸引子联想补全、HTM 序列记忆预测下一步、线性预测编码给自由能。
 */
function ensureNeuro() {
  if (!state.neuro) {
    if (!state.engine?.cognition) return null;
    try { state.neuro = state.engine.cognition.createNeuromorph(); }
    catch (e) { console.error('[mind] 类脑计算引擎初始化失败', e); return null; }
  }
  return state.neuro;
}
/**
 * 驱动类脑引擎并对渲染层广播一次真实计算结果。
 * @param {object} levels 脑区激活（来自自主漫游 / 手动思考 / 八阶段推理）
 * @param {string} label  这次激活的语义标签（用于联想记忆登记）
 * @param {boolean} doAbsorb 是否把该激活作为「真实概念」写入吸引子记忆（仅对可信的八阶段结果）
 */
function neuroSense(levels, label, doAbsorb) {
  const neuro = ensureNeuro();
  if (!neuro || !levels) return null;
  try {
    if (doAbsorb) neuro.absorb(levels, label || 'real-activation');
    const cyc = neuro.runCycle(levels, { steps: 160 });
    const recall = neuro.recall(levels, { iters: 40 });
    const predict = neuro.predict();
    const status = neuro.status();
    const payload = {
      levels: cyc.levels, pulses: cyc.pulses, spikes: cyc.spikes,
      firedRegions: cyc.firedRegions, recall, predict, status, label: label || null,
    };
    if (win && !win.isDestroyed()) win.webContents.send('mind:neuro', payload);
    return payload;
  } catch (e) { console.error('[neuro] 驱动失败', e); return null; }
}
// v6.41.0：桌面精灵（Cosmos 精灵悬浮窗）及相关尺寸/计时/窗口函数已整体移除。
// persistSprite / spriteScale / spriteSize / setSpriteScale / placeSpriteWindow /
// startSpriteTimer / stopSpriteTimer / createSpriteWindow / destroySpriteWindow 不再存在。
// 量子内核（ensureQuantum / ensureQuantumCognition / ensureNeuro / neuroSense）与
// ASTRA 自主引擎（startAstraHeart / startAstraFrame / broadcastAstra 等）保留，
// 继续为 3D 智脑、自主引擎面板与能力中枢提供真实计算。

// ═══════════════════════════════════════════════════════════════════════════
// v6.11 · ASTRA 自主意识内核 + 桌面自由漫游
// ---------------------------------------------------------------------------
// 与「知识库引擎」彻底解耦：即使从未打开过知识库，星灵依然是活的。
//   · 心跳（1.5s）常驻：驱动演化 → 目标 → 可解释决策 → 自省 → 世代演化 → 广播
//   · 运动帧（33ms）仅在悬浮窗开启时跑：弹簧插值 → 多显示器边界约束 → setPosition
//   · 鼠标穿透由渲染层按命中区域主动申请；看门狗在 forward 失效时自动降级，
//     最坏情况回到"窗口始终可交互"（旧行为），绝不会出现点不到的精灵。
// 全部状态落在 app userData，与用户知识库正文完全隔离。
// ═══════════════════════════════════════════════════════════════════════════
function astraStateFile() { return path.join(app.getPath('userData'), 'astra-mind.json'); }

/** v6.12：思维沉淀库根目录 —— 优先安装在软件安装目录下，不可写时回退 userData。 */
function resolveAstraLibraryRoot() {
  const saved = (() => { try { return readConfig().astraLibraryRoot; } catch { return null; } })();
  const fallback = path.join(app.getPath('userData'), 'astra-memory');
  let primary = null;
  try { if (app.isPackaged) primary = path.join(path.dirname(app.getPath('exe')), 'astra-memory'); } catch { /* dev 模式下无 exe 概念 */ }
  if (!primary && !saved) primary = path.join(app.getAppPath ? app.getAppPath() : process.cwd(), 'astra-memory');
  return saved || primary || fallback;
}

function ensureAstraLibrary() {
  if (state.astraLibrary) return state.astraLibrary;
  const root = resolveAstraLibraryRoot();
  state.astraLibrary = createThoughtLibrary({
    root,
    fallbackRoot: path.join(app.getPath('userData'), 'astra-memory'),
    config: { read: () => { try { return readConfig(); } catch { return {}; } }, write: (c) => writeConfig(c) },
  });
  return state.astraLibrary;
}

function ensureAstra() {
  if (state.astra) return state.astra;
  const file = astraStateFile();
  const storage = {
    read: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    write: (s) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(s), 'utf8');
      } catch (e) { console.error('[astra] 状态落盘失败', e); }
    },
  };
  const lib = ensureAstraLibrary();
  // 思维沉淀库钩子：记忆与决策实时沉淀到安装目录下的长期档案（缓冲写入，不阻塞主循环）
  const hooks = {
    onRemember: (kind, text, extra) => {
      try {
        if (kind === 'semantic') lib.addSemantic(text, { at: extra?.entry?.at });
        else lib.addEpisodic(text, { mood: extra?.entry?.mood, kind: extra?.entry?.kind });
      } catch (e) { /* 沉淀失败不影响主循环 */ }
    },
    onAudit: (kind, detail, rec) => {
      try {
        if (kind === 'decision' || kind === 'evolution' || kind === 'level_up' || kind === 'goal_done') {
          lib.addDecision({ kind, detail, at: rec?.at });
        }
        if (kind === 'evolution') lib.addEvolution({ detail, at: rec?.at });
      } catch (e) { /* 沉淀失败不影响主循环 */ }
    },
  };
  state.astra = createAstraMind({ storage, hooks });
  state.astra.perceive('boot');
  return state.astra;
}

// v6.41.0：桌面精灵已移除，其「桌面漫游 / 鼠标穿透」运动层不再有承载窗口。
// 保留函数签名供既有 IPC 调用，统一安全降级为无窗口状态；ASTRA 心智 / 心跳内核不受影响。
function ensureAstraMotion() {
  // 精灵悬浮窗已移除 —— 不再创建漫游运动实例。
  return null;
}

/** v6.41.0：精灵窗口已移除，鼠标穿透只维护内部状态，不再作用于任何窗口。 */
function setSpriteInteractive(interactive) {
  state.astraLastHit = Date.now();
  state.astraIgnore = false;
}

function broadcastAstra(extra) {
  const payload = {
    mind: ensureAstra().status(),
    motion: state.astraMotion ? state.astraMotion.state() : null,
    clickThrough: state.astraClickThrough,
    mode: state.astraUserMode,
    boundary: ASTRA_BOUNDARY,
    libraryRoot: ensureAstraLibrary().root,
    ...(extra || {}),
  };
  // v6.41.0：桌面精灵已移除，仅向主窗口广播自主状态。
  for (const w of [win]) {
    try { if (w && !w.isDestroyed()) w.webContents.send('astra:state', payload); } catch { /* 窗口已关闭 */ }
  }
  return payload;
}

function astraHeartbeat() {
  try {
    const mind = ensureAstra();
    state.astraHeartCount++;
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch { /* 平台不支持空闲检测 */ }
    const userAway = idle > 90;
    // 真实感知：系统空闲时长驱动「使用者在/不在」，每 20 次心跳采样一次，避免亲和度飙升
    if (state.astraHeartCount % 20 === 0) {
      mind.perceive(userAway ? 'user_away' : 'user_near');
      if (idle > 240) mind.perceive('idle_long');
    }
    const r = mind.tick({ userAway, conversing: !!state.astraPanelOpen });
    const extra = {};
    if (!r.skipped) {
      state.astraMotion?.setBehavior(r.decision.motion);
      if (r.levelUp) { extra.event = 'level_up'; extra.level = r.level; }
      if (r.evolved) { extra.event = 'evolution'; extra.evolution = r.evolved; }
    }
    broadcastAstra(extra);
  } catch (e) { console.error('[astra] 心跳异常', e); }
}

function astraFrame() {
  // v6.41.0：桌面精灵已移除，桌面漫游帧不再执行。
  const m = state.astraMotion;
  if (!m) return;
  if (state.astraDrag) {
    try {
      const c = screen.getCursorScreenPoint();
      m.dragTo(c.x - state.astraDrag.x, c.y - state.astraDrag.y);
    } catch { /* 光标读取失败：保持上一帧 */ }
  } else {
    const st = m.tick();
    // 真实走过的桌面里程写进自我模型，不是装饰数字
    const base = state.astraLastDistance || 0;
    if (st.distance - base >= 25) { ensureAstra().registerDistance(st.distance - base); state.astraLastDistance = st.distance; }
  }
  // 看门狗：如果 forward 鼠标事件没送达，自动关闭穿透，保证精灵永远点得到
  if (state.astraIgnore && Date.now() - (state.astraLastHit || 0) > 4000) {
    state.astraClickThrough = false;
    setSpriteInteractive(true);
  }
}

function startAstraHeart() {
  ensureAstra();
  if (state.astraHeartTimer) return;
  state.astraHeartTimer = setInterval(astraHeartbeat, 1500);
  if (state.astraHeartTimer.unref) state.astraHeartTimer.unref();
  astraHeartbeat();
}
function startAstraFrame() {
  // v6.41.0：精灵窗口已移除，不启动漫游帧。
  if (!ensureAstraMotion()) return;
  if (state.astraFrameTimer) return;
  state.astraFrameTimer = setInterval(astraFrame, 33);
  if (state.astraFrameTimer.unref) state.astraFrameTimer.unref();
}
function stopAstraFrame() {
  if (state.astraFrameTimer) { clearInterval(state.astraFrameTimer); state.astraFrameTimer = null; }
  state.astraMotion = null; state.astraDrag = null;
  state.astraPanelOpen = false; state.astraLastDistance = 0;
  state.astraIgnore = false; // v6.41.0：精灵窗口已移除，无需恢复鼠标事件
}

function registerIpc() {
  // v2.1.0：自检分步计时回传（渲染层 → 主进程）
  ipcMain.on('diag:mark', (_e, p) => {
    if (p && p.name) diagMark(String(p.name), Number(p.ms) || 0);
  });
  ipcMain.handle('app:init', async () => {
    const E = await loadEngine();
    state.engine = E;
    const cfg = readConfig();
    // NEOLINK_VAULT 优先：便于便携模式与自动化测试指向指定库
    if (process.env.NEOLINK_VAULT) cfg.vaultPath = process.env.NEOLINK_VAULT;
    // 迁移：把旧配置里的 vaultPath 登记进注册表
    const reg = readRegistry();
    if (!reg.vaults.length && cfg.vaultPath && fs.existsSync(cfg.vaultPath)) registerVault(cfg.vaultPath);
    // v2.2.1：**先退役系统盘上的旧默认库，再决定开哪个库**。
    //
    // 顺序很重要：用户把库搬到 D 盘后，C 盘「文档\NeoCosmos Vault」那个由客户端
    // 自动播种的空壳还留在登记列表里，而且往往正是 activeId ——
    // 若先开库，用户每次启动都会被拉回 C 盘那个只有 6 张系统说明的空库，
    // 真正的库反而不在眼前（用户曾手工删过它，客户端下次启动又原样建回来）。
    //
    // 退役条件必须**精确**，否则会抹掉用户真实内容：
    //   ① 在系统盘上；
    //   ② 目录名是默认库的约定名「NeoCosmos Vault」；
    //   ③ 里面**只有 starter 卡片**（逐文件核对，出现任何非 starter 的 .md 就不动）；
    //   ④ 客户端的默认存储位置已经不在这个位置了。
    // 磁盘文件不删、用户可在「库管理」里重新添加 —— 这里只是不再占着"当前库"。
    retireSystemDefaultVault();
    const reg2 = readRegistry();
    let opened = false;
    // v2.1.0：init 幂等 —— 目标库已经开着就别再 openVault 一次。
    // 渲染层启动时会调一次 init，自检脚本还会再调一次；百万级库每次 openVault
    // 要 90 秒，重复开库等于白白多等一轮。
    const target = (process.env.NEOLINK_VAULT && fs.existsSync(process.env.NEOLINK_VAULT))
      ? process.env.NEOLINK_VAULT
      : (reg2.activeId && getVaultEntry(reg2.activeId)?.path) || cfg.vaultPath;
    if (state.store && state.root && target && path.resolve(String(target)) === path.resolve(state.root)) {
      opened = true;
    }
    // 1) 环境变量指定的库
    if (!opened && process.env.NEOLINK_VAULT && fs.existsSync(process.env.NEOLINK_VAULT)) {
      try { await openVault(process.env.NEOLINK_VAULT); opened = true; } catch (e) { console.error(e); diagError('openVault(env)', e); }
    }
    // 2) 注册表激活库
    if (!opened && reg2.activeId) {
      const entry = getVaultEntry(reg2.activeId);
      if (entry && fs.existsSync(entry.path)) {
        try { await openVault(entry.path); opened = true; } catch (e) { console.error(e); diagError('openVault(registry)', e); }
      }
    }
    // 3) 旧配置路径
    if (!opened && cfg.vaultPath && fs.existsSync(cfg.vaultPath)) {
      try { await openVault(cfg.vaultPath); opened = true; } catch (e) { console.error(e); diagError('openVault(config)', e); }
    }
    // 4) 默认库 + 播种
    if (!opened) {
      // v2.2.1：默认库路径已改为"优先非系统盘"（见 defaultVaultPath），
      // 用户也可在「关于」面板里随时改。
      const vp = defaultVaultPath();
      try {
        fs.mkdirSync(vp, { recursive: true });
        seedStarterKit(vp);
        await openVault(vp);
      } catch (e) { console.error('auto vault failed', e); }
    }
    // 5) v2.2.1：把**默认存储位置**下的库也登记进列表（只登记，不切换）。
    //
    // 为什么需要这一步：用户可能早就把库建在了 D 盘（或用「选择存储位置」
    // 建过），但那一版 chooseStorage 有 bug —— 已经开着别的库时它什么也不做，
    // 新库既没播种也没登记，于是用户的库在"全部库"列表里**根本不存在**，
    // 却又实实在在躺在磁盘上。启动时补登记，等于把"用户自己建的库"还给用户。
    // registerVault(..., { activate: false }) —— 不动用户当前打开的库。
    try {
      const root = defaultVaultRoot();
      for (const cand of [path.join(root, 'NeoCosmos Vault')]) {
        if (!fs.existsSync(cand)) continue;
        const regNow = readRegistry();
        if (regNow.vaults.some((x) => path.resolve(x.path) === path.resolve(cand))) continue;
        registerVault(cand, { activate: false });
        console.log('[vault] 已登记默认存储位置下的知识库：', cand);
      }
    } catch (e) { console.error('register default vault failed', e); }
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      userData: app.getPath('userData'),
      vault: vaultInfo(),
      registry: listRegistry(),
      exampleAvailable: fs.existsSync(EXAMPLE_CORPUS),
      // v2.2.1：让界面能明确告诉用户"当前库在系统盘上"
      vaultOnSystemDrive: state.root ? isOnSystemDrive(state.root) : false,
      storageRoot: (() => { try { return defaultVaultRoot(); } catch { return null; } })(),
      // v2.2.1：「关于」面板需要这些真实信息，取不到就留空（不编造）
      // v6.40.0 合规拆分：appName / 授权 / 联系方式随版本身份变化。
      author: '宋锦涛',
      contact: EDITION_INFO.commercial || EDITION_INFO.edition === 'both'
        ? '13869162267'
        : '商用授权联系：13869162267（见 legal/COMMERCIAL-LICENSE.md）',
      appName: EDITION_INFO.appName,
      edition: EDITION_INFO.edition,
      // 授权与第三方组件说明（放在 app 里，随包分发）——逐项真实，见 LICENSES.md
      license: EDITION_INFO.license,
      thirdParty: [
        'Electron 33 (MIT) — 应用外壳',
        'three.js r160 (MIT) — 3D 星图渲染，许可见 ui/vendor/three/LICENSE',
        'Noto Sans CJK SC / Noto Serif CJK SC (SIL OFL 1.1) — 中文字体，许可见 assets/fonts/OFL.txt',
        'NSIS 3.10 (zlib/libpng) — 安装包编译（仅构建期）',
      ],
    };
  });

  ipcMain.handle('window:control', (_e, action) => {
    if (!win) return false;
    if (action === 'min') win.minimize();
    else if (action === 'max') { win.isMaximized() ? win.unmaximize() : win.maximize(); }
    else if (action === 'close') win.close();
    return true;
  });
  ipcMain.handle('window:isMaximized', () => !!win && win.isMaximized());

  // ---------------------------------------------------------------------
  //  v2.3.0：渲染层的关闭确认结果。
  //
  //  两条关闭路径汇到这一处：
  //    ① 标题栏 X → 渲染层弹框 → 回传 true/false
  //    ② Alt+F4 / 任务栏关闭 → 主进程 win.on('close') 拦截 → 通知渲染层弹框
  //       → 回传 true/false
  //  true = 确认退出（放行关闭）；false = 取消（窗口留着）。
  // ---------------------------------------------------------------------
  ipcMain.on('window:close-reply', (_e, ok) => {
    if (!win) return;
    if (ok) {
      closeConfirmed = true;      // 让 win.on('close') 这次放行
      closePending = false;
      appQuitting = true;         // 明确意向：这次是真的退出
      // v6.41.0：桌面精灵已移除，无需额外销毁精灵窗口。
      try { win.close(); } catch { /* ignore */ }
    } else {
      closePending = false;       // 取消：窗口继续留着
    }
  });

  // ---------------- 多知识库 ----------------
  function listRegistry() {
    const reg = readRegistry();
    const vaults = reg.vaults
      .slice()
      .sort((a, b) => String(b.last_opened_at || '').localeCompare(String(a.last_opened_at || '')))
      .map((v) => ({
        id: v.id, name: v.name, path: v.path, color: v.color,
        lastOpenedAt: v.last_opened_at || null, createdAt: v.created_at || null,
        purpose: v.purpose, linkEnabled: v.linkEnabled === true,
        active: v.id === reg.activeId && state.root && vaultIdFor(state.root) === v.id,
      }));
    return { vaults, activeId: state.root ? vaultIdFor(state.root) : reg.activeId };
  }

  ipcMain.handle('vault:list', () => wrap(() => listRegistry()));

  ipcMain.handle('vault:create', async (_e, opts = {}) => {
    const E = state.engine || await loadEngine();
    const name = E.sanitizeFilename(String(opts.name || '').trim());
    if (!name) return { ok: false, error: '知识库名称不能为空' };
    // v2.2.1 修复：默认位置原先写死 app.getPath('documents')（= C 盘），
    // 用户明说"不能默认C盘"。改用 defaultVaultRoot() ——
    // 用户选过的位置优先，否则非系统盘优先，实在没别的盘才回文档目录。
    let dir = opts.dir
      ? path.resolve(String(opts.dir))
      : path.join(defaultVaultRoot(), name);
    // 目标非空保护：**两种来源都要查**。
    // 原先只查了 opts.dir 分支，于是"按默认位置新建"可能落进一个已存在的
    // 库里，把 starter 文档写进去、把用户自己的卡片混在同一个库中。
    if (fs.existsSync(dir) && fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length) {
      return { ok: false, error: '目标文件夹已存在且非空，请换一个位置' };
    }
    fs.mkdirSync(dir, { recursive: true });
    seedStarterKit(dir);
    await openVault(dir);
    registerVault(dir, { name });
    return { ok: true, vault: vaultInfo(), registry: listRegistry() };
  });

  ipcMain.handle('vault:switch', async (_e, id) => {
    const entry = getVaultEntry(String(id || ''));
    if (!entry) return { ok: false, error: '知识库不存在' };
    if (!fs.existsSync(entry.path)) return { ok: false, error: '知识库文件夹已被移动或删除' };
    await openVault(entry.path);
    return { ok: true, vault: vaultInfo(), registry: listRegistry() };
  });

  ipcMain.handle('vault:rename', (_e, opts = {}) => wrap(() => {
    const entry = getVaultEntry(String(opts.id || ''));
    if (!entry) throw new Error('知识库不存在');
    const name = String(opts.name || '').trim();
    if (!name) throw new Error('名称不能为空');
    registerVault(entry.path, { name });
    return { registry: listRegistry() };
  }));

  ipcMain.handle('vault:setColor', (_e, opts = {}) => wrap(() => {
    const entry = getVaultEntry(String(opts.id || ''));
    if (!entry) throw new Error('知识库不存在');
    registerVault(entry.path, { color: String(opts.color || '#8B7BFF') });
    return { registry: listRegistry() };
  }));

  ipcMain.handle('vault:forget', async (_e, id) => {
    const reg = readRegistry();
    const entry = getVaultEntry(String(id || ''));
    if (!entry) return { ok: false, error: '知识库不存在' };
    reg.vaults = reg.vaults.filter((v) => v.id !== entry.id);
    // v6.23.0：移除登记时同步清掉以它为目标的沉淀库设置与索引缓存，
    // 否则界面会挂着一个已经不存在的「专用沉淀库」。
    const cfg0 = readConfig();
    if (cfg0.sediment && cfg0.sediment.vaultId === entry.id) {
      writeConfig(vaultScope.setSedimentTarget(cfg0, null));
      sedimentStoreCache = null;
    }
    evictScopeStore(entry.id);
    // 只移除登记，绝不动磁盘上的知识库文件夹
    if (reg.activeId === entry.id) {
      const next = reg.vaults[0] || null;
      reg.activeId = next ? next.id : null;
      writeRegistry(reg);
      if (next) { await openVault(next.path); return { ok: true, switched: true, vault: vaultInfo(), registry: listRegistry() }; }
      const vp = defaultVaultPath();
      fs.mkdirSync(vp, { recursive: true });
      seedStarterKit(vp);
      await openVault(vp);
      return { ok: true, switched: true, vault: vaultInfo(), registry: listRegistry() };
    }
    writeRegistry(reg);
    return { ok: true, switched: false, registry: listRegistry() };
  });

  ipcMain.handle('vault:open', async (_e, dir) => { await openVault(dir); return vaultInfo(); });
  ipcMain.handle('vault:info', () => vaultInfo());

  // ---------------- v2.2.0：跨库图谱 + 链接 API + 深链 ----------------
  // force=true 表示用户显式点了「刷新状态」—— 此时绕开缓存真正重扫，
  // 否则用户点了刷新却看到旧数据，那才是真的"点了没反应"。
  ipcMain.handle('vaults:xgraph', (_e, opts) => {
    try { return { ok: true, data: computeXGraph(!!(opts && opts.force)) }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  ipcMain.handle('api:start', (_e, opts = {}) => {
    try {
      const r = startApiServer(opts);
      // v2.2.1：startApiServer 失败时返回的是 { ok:false, error }，
      // 原先这里一律包成 { ok:true, data:r }，于是"令牌为空被拒绝"这种失败
      // 在界面上看起来像**启动成功**（r.ok 为 false 被吞掉了）。
      // 现在如实透传：失败就是失败。
      if (!r || r.ok === false) return { ok: false, error: String(r?.error || '启动失败') };
      return { ok: true, data: r };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  // v2.2.1：生成一个高强度随机令牌（用户不用自己想，也不会不小心留空）。
  // 令牌生成在**主进程**做，渲染层拿不到 crypto.randomBytes（沙箱限制），
  // 且不必为了生成令牌而把随机源暴露给渲染层。
  ipcMain.handle('api:genToken', () => {
    try { return { ok: true, data: { token: generateApiToken() } }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  // v2.2.1：重新读取已保存的令牌（加密存储解密）。
  // 只在用户明确点击"显示令牌"时调用 —— 平时界面只显示"已设置 / 已加密"。
  ipcMain.handle('api:revealToken', () => {
    try {
      const t = loadApiToken();
      if (!t) return { ok: false, error: '未找到已保存的令牌（系统密钥环不可用或已更换机器）' };
      return { ok: true, data: { token: t } };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('api:stop', () => {
    try { return { ok: true, data: stopApiServer() }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('api:status', () => {
    try { return { ok: true, data: apiServerStatus() }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  // ---- v6.22.0 链接管理：真实访问日志 / 黑名单 / 绑定模式 / 服务启停 ----
  // 契约统一走 wrap()：成功 { ok:true, data }，失败 { ok:false, error }。
  // 所有返回的 IP / 次数 / 时间 / 接口分布都由 api-access.jsonl 派生，没有预置计数。
  ipcMain.handle('conn:list', () => wrap(() => connectionOverview()));
  ipcMain.handle('conn:block', (_e, ip) => wrap(() => {
    const cfg = connLog.addToBlocklist(readConfig(), String(ip || ''));
    writeConfig(cfg);
    apiBlocklist = connLog.blocklistOf(cfg);       // 立即对后续请求生效
    return connectionOverview();
  }));
  ipcMain.handle('conn:unblock', (_e, ip) => wrap(() => {
    const cfg = connLog.removeFromBlocklist(readConfig(), String(ip || ''));
    writeConfig(cfg);
    apiBlocklist = connLog.blocklistOf(cfg);
    return connectionOverview();
  }));
  ipcMain.handle('conn:disconnect', (_e, ip) => wrap(() => {
    const target = connLog.normalizeIp(String(ip || ''));
    return { ip: target, closed: disconnectIp(target) };
  }));
  ipcMain.handle('conn:bind', (_e, mode) => wrap(() => {
    const bind = mode === 'lan' ? 'lan' : 'loopback';
    const cfg = readConfig();
    cfg.apiServer = { ...(cfg.apiServer || {}), bind };
    writeConfig(cfg);
    // 运行中切换绑定必须重启监听才生效；令牌从系统密钥环取，不回传渲染层。
    if (apiServer) {
      const port = Number(cfg.apiServer.port) || 8787;
      const token = loadApiToken();
      if (!token) return { ...apiServerStatus(), restarted: false,
        warning: '未找到已保存的令牌；绑定已写入配置，下次启动服务时生效' };
      const r = startApiServer({ port, token, bind });
      if (!r || r.ok === false) throw new Error(String(r && r.error || '重启服务失败'));
      return { ...apiServerStatus(), restarted: true };
    }
    return { ...apiServerStatus(), restarted: false };
  }));
  ipcMain.handle('conn:service', (_e, action) => wrap(() => {
    if (action === 'stop') { stopApiServer(); return apiServerStatus(); }
    if (action !== 'start') throw new Error('未知的服务操作');
    const cfg = readConfig();
    const port = Number(cfg.apiServer && cfg.apiServer.port) || 8787;
    const bind = cfg.apiServer && cfg.apiServer.bind === 'lan' ? 'lan' : 'loopback';
    // 用已保存的令牌；没有就现场生成高强度令牌（随机源只在主进程）
    const token = loadApiToken() || generateApiToken();
    const r = startApiServer({ port, token, bind });
    if (!r || r.ok === false) throw new Error(String(r && r.error || '启动失败'));
    return apiServerStatus();
  }));

  // ---- v6.23.0 连接作用域 + 沉淀回写仓库 ----
  // 启用 = 真实写注册表 + 真实预建一次索引；停用 = 真实拒绝后续请求 + 释放索引缓存。
  // 没有「只把按钮变灰」的假开关：服务端 apiVaultFor() 会真实返回 403。
  ipcMain.handle('conn:scopeSet', (_e, opts = {}) => wrapAsync(async () => {
    const id = String((opts && opts.id) || '');
    const enabled = !!(opts && opts.enabled);
    const r = vaultScope.setLinkEnabled(readRegistry(), id, enabled);
    if (!r.ok) throw new Error('知识库不存在');
    writeRegistry(r.registry);
    let warmError = null;
    if (enabled) {
      const w = await warmScopeStore(id);
      if (!w.ok) warmError = String(w.error || '索引预建失败');
    } else {
      evictScopeStore(id);
    }
    return { ...connectionOverview(), warmError };
  }));
  ipcMain.handle('conn:sedimentSet', (_e, opts = {}) => wrapAsync(async () => {
    const id = (opts && opts.id) ? String(opts.id) : null;
    if (id && !vaultScope.findVault(readRegistry(), id)) throw new Error('目标知识库不在登记列表里');
    writeConfig(vaultScope.setSedimentTarget(readConfig(), id));
    sedimentStoreCache = null;
    let warmError = null;
    const ref = sedimentVaultRef();
    if (ref) {
      const w = await warmSedimentStore(ref);
      if (!w.ok) warmError = String(w.error || '沉淀库索引预建失败');
    }
    return { ...connectionOverview(), warmError };
  }));
  ipcMain.handle('conn:sedimentCreate', (_e, opts = {}) => wrapAsync(async () => {
    const E = state.engine || await loadEngine();
    const base = E.sanitizeFilename(String((opts && opts.name) || '').trim()) || 'NeoCosmos 沉淀库';
    const root = defaultVaultRoot();
    let dir = path.join(root, base), n = 1;
    // 绝不覆盖用户已有的非空目录：重名就换一个真实的新目录。
    while (fs.existsSync(dir) && fs.readdirSync(dir).filter((x) => !x.startsWith('.')).length) {
      dir = path.join(root, `${base}-${n++}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    // 专用沉淀库保持干净：不放任何示例卡片，只由 KbStore 建好 .neokb 元数据目录。
    new E.KbStore(dir).load();
    // 只登记、不切换用户当前打开的知识库。
    const v = registerVault(dir, { name: path.basename(dir), activate: false });
    const tagged = vaultScope.setPurpose(readRegistry(), v.id, vaultScope.PURPOSES.SEDIMENT);
    writeRegistry(tagged.registry);
    writeConfig(vaultScope.setSedimentTarget(readConfig(), v.id));
    sedimentStoreCache = null;
    const ref = sedimentVaultRef();
    if (ref) await warmSedimentStore(ref);
    return { ...connectionOverview(),
      created: { id: v.id, name: path.basename(dir), path: dir, purpose: vaultScope.PURPOSES.SEDIMENT } };
  }));

  // ---- v6.23.1 MCP 外部平台链接状态与管理 ----
  // 只读视图全部由真实会话文件派生；所有管理动作都写进独立 policy.json，
  // 由独立 stdio MCP Server 进程在每次请求时读取并真实执行，不是界面上的假开关。
  ipcMain.handle('mcp:links', () => wrap(() => {
    mcpLinks.prune(MCP_LINK_DIR);
    return mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() });
  }));
  ipcMain.handle('mcp:link-policy', (_e, patch = {}) => wrap(() => {
    const cur = mcpLinks.readPolicy(MCP_LINK_DIR);
    const p = { ...cur, ...(patch || {}) };
    const written = mcpLinks.writePolicy(MCP_LINK_DIR, p);
    if (!written) throw new Error('链接管理策略写入失败（目录不可写）');
    return mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() });
  }));
  ipcMain.handle('mcp:link-revoke', (_e, opts = {}) => wrap(() => {
    const sid = String((opts && opts.sid) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (!sid) throw new Error('缺少会话标识');
    const p = mcpLinks.readPolicy(MCP_LINK_DIR);
    if (!p.revokedSessions.includes(sid)) p.revokedSessions.push(sid);
    if (!mcpLinks.writePolicy(MCP_LINK_DIR, p)) throw new Error('断开请求写入失败');
    return mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() });
  }));
  ipcMain.handle('mcp:link-alias', (_e, opts = {}) => wrap(() => {
    const key = String((opts && opts.key) || '').slice(0, 80);
    const label = String((opts && opts.label) || '').trim().slice(0, 60);
    if (!key) throw new Error('缺少平台标识');
    const p = mcpLinks.readPolicy(MCP_LINK_DIR);
    if (label) p.aliases[key] = label; else delete p.aliases[key];
    if (!mcpLinks.writePolicy(MCP_LINK_DIR, p)) throw new Error('备注写入失败');
    return mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() });
  }));
  ipcMain.handle('mcp:link-clear', () => wrap(() => {
    const r = mcpLinks.clearHistory(MCP_LINK_DIR);
    return { ...r, ...mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() }) };
  }));
  ipcMain.handle('mcp:link-reveal', () => wrap(() => {
    mcpLinks.ensureDir(MCP_LINK_DIR);
    Promise.resolve(shell.openPath(MCP_LINK_DIR)).catch(() => { /* 打开失败不影响返回 */ });
    return { dir: MCP_LINK_DIR };
  }));
  // v6.35.0：移除接入——删除会话登记并写墓碑，防止在线进程心跳把记录写回来。
  ipcMain.handle('mcp:link-remove', (_e, opts = {}) => wrap(() => {
    const r = mcpLinks.removeSessions(MCP_LINK_DIR, opts || {});
    return { ...r, ...mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() }) };
  }));
  ipcMain.handle('mcp:link-restore', (_e, opts = {}) => wrap(() => {
    const r = mcpLinks.restoreRemoved(MCP_LINK_DIR, opts || {});
    return { ...r, ...mcpLinks.aggregate(MCP_LINK_DIR, { now: Date.now() }) };
  }));

  // ---- v6.31.0 NeoLM：原创本地领域语言模型（真实训练权重 / 真实推理） ----
  // 权重位于 assets/_model/neolm/，由 runtime.js 按行随机访问真实读取；
  // 不把 1.5 GiB 读进内存。任一校验失败 -> active:false 如实降级，绝不伪造状态或结果。
  const NEOLM_DIR = path.join(__dirname, 'assets', '_model', 'neolm');
  const NEOLM_ASSETS = [
    'assets/_model/neolm/neolm.emb.nw',
    'assets/_model/neolm/neolm.out.nw',
    'assets/_model/neolm/neolm.vocab.json',
    'assets/_model/neolm/neolm.manifest.json',
  ];
  let neolmInstance = null, neolmLoadError = '';
  async function getNeoLM() {
    if (neolmInstance) return neolmInstance;
    if (neolmLoadError) throw new Error(neolmLoadError);
    try {
      for (const rel of NEOLM_ASSETS) {
        const p = path.join(__dirname, ...rel.split('/'));
        if (!fs.existsSync(p)) throw new Error(`模型资产缺失：${rel}`);
      }
      const mod = await import(pathToFileURL(path.join(ENGINE, 'cognition', 'neolm', 'runtime.js')).href);
      const inst = mod.createNeoLM({ dir: NEOLM_DIR });
      if (!inst || !inst.active) throw new Error((inst && inst.reason) || '模型未就绪');
      neolmInstance = inst;
      return inst;
    } catch (e) {
      neolmLoadError = String(e?.message || e);
      throw e;
    }
  }
  ipcMain.handle('neolm:status', () => wrapAsync(async () => {
    try { return (await getNeoLM()).status(); }
    catch (e) { return { active: false, reason: String(e?.message || e) }; }
  }));
  ipcMain.handle('neolm:nearest', (_e, opts = {}) => wrapAsync(async () => {
    const m = await getNeoLM();
    return { items: m.nearest(String((opts && opts.text) || ''), Math.max(1, Math.min(20, Number(opts?.k) || 8))) };
  }));
  ipcMain.handle('neolm:similarity', (_e, opts = {}) => wrapAsync(async () => {
    const m = await getNeoLM();
    return { value: m.similarity(String((opts && opts.a) || ''), String((opts && opts.b) || '')) };
  }));
  ipcMain.handle('neolm:next', (_e, opts = {}) => wrapAsync(async () => {
    const m = await getNeoLM();
    return { items: m.nextToken(String((opts && opts.text) || ''), Math.max(1, Math.min(20, Number(opts?.k) || 8))) };
  }));
  ipcMain.handle('neolm:generate', (_e, opts = {}) => wrapAsync(async () => {
    const m = await getNeoLM();
    return m.generate(String((opts && opts.prompt) || ''), Math.max(1, Math.min(24, Number(opts?.maxLen) || 8)));
  }));
  ipcMain.handle('neolm:expand', (_e, opts = {}) => wrapAsync(async () => {
    const m = await getNeoLM();
    return { terms: m.expandQuery(String((opts && opts.text) || ''), Math.max(1, Math.min(20, Number(opts?.k) || 6))) };
  }));
  ipcMain.handle('neolm:verify', () => wrapAsync(async () => (await getNeoLM()).verify()));

  // ---- v6.32.0 语义回流层：调取 / 沉淀 / 库关联共用真实模型向量索引 ----
  // 纪律：模型只算分数与证据；建边 / 建跨库关联一律需要「用户确认」这个真实动作。
  let semanticMod = null;
  async function getSemantic() {
    if (!semanticMod) {
      semanticMod = await import(pathToFileURL(path.join(ENGINE, 'cognition', 'semantic-bridge.js')).href);
    }
    return semanticMod;
  }
  /** 只取真实模型；失败时返回 null + 真实原因，绝不伪造一个"看起来可用"的模型 */
  async function semanticModel() {
    try { return { lm: await getNeoLM(), reason: null }; }
    catch (e) { return { lm: null, reason: String(e?.message || e) }; }
  }
  /** 按登记库 id 取真实 store（已缓存优先；未建索引才补建一次） */
  async function semanticVaultStore(id) {
    const key = String(id || '');
    if ((!key || key === activeVaultId()) && state.store) {
      return { id: activeVaultId(), name: '当前知识库', path: state.root || '', store: state.store };
    }
    const v = readRegistry().vaults.find((x) => x.id === key);
    if (!v || !v.path || !fs.existsSync(v.path)) return null;
    const E = state.engine || await loadEngine();
    let st = scopeStores.get(key)?.store || null;
    if (!st) {
      st = new E.KbStore(v.path).load();
      scopeStores.set(key, { store: st, root: v.path, warmed: false });
    }
    if (st.nodes.size === 0) await E.indexVault(st);
    return { id: key, name: v.name, color: v.color || '#7B5CFF', path: v.path, store: st };
  }
  function markSuggestionBuilt(store, qaId, dst) {
    if (!store || !qaId) return false;
    const q = (store.qaPairs || []).find((x) => x.id === qaId);
    const s = q?.semantic?.suggestions?.find((x) => x.dst === dst);
    if (!s) return false;
    s.built = true;
    s.confirmedAt = new Date().toISOString();
    s.confirmedBy = 'ui';
    store.save();
    return true;
  }

  ipcMain.handle('semantic:status', () => wrapAsync(async () => {
    const S = await getSemantic();
    const { lm, reason: modelReason } = await semanticModel();
    if (!state.store) return { active: false, reason: '尚无打开的知识库', model: { active: !!lm, reason: modelReason }, index: null };
    const r = S.resolveSemantic({ neolm: lm }, state.store);
    return {
      active: r.active,
      reason: r.active ? null : r.reason,
      model: lm
        ? { active: true, vocab: lm.vocabSize, dim: lm.dim, weightGiB: lm.status().weightGiB }
        : { active: false, reason: modelReason },
      index: r.active ? r.index.status() : null,
      vault: { path: state.root || null, nodes: state.store.nodes.size, qaPairs: state.store.qaPairs.length },
      sediment: (() => {
        const sed = getSedimentStore();
        return sed ? { id: sed.id, path: sed.path, qaPairs: sed.store?.qaPairs?.length ?? 0 } : null;
      })(),
    };
  }));

  ipcMain.handle('semantic:reindex', () => wrapAsync(async () => {
    if (!state.store) throw new Error('尚无打开的知识库');
    const S = await getSemantic();
    const { lm, reason } = await semanticModel();
    if (!lm) return { active: false, reason };
    const r = S.resolveSemantic({ neolm: lm }, state.store, { force: true });
    if (!r.active) return { active: false, reason: r.reason };
    const saved = r.index.save();
    return { ok: true, active: true, ...r.index.status(), saved };
  }));

  ipcMain.handle('semantic:search', (_e, opts = {}) => wrapAsync(async () => {
    if (!state.store) throw new Error('尚无打开的知识库');
    const S = await getSemantic();
    const { lm, reason } = await semanticModel();
    if (!lm) return { active: false, reason, seeds: [] };
    const r = S.resolveSemantic({ neolm: lm }, state.store);
    if (!r.active) return { active: false, reason: r.reason, seeds: [] };
    const s = S.semanticSeeds(r.index, String(opts.text || ''), {
      topK: Math.max(1, Math.min(20, Number(opts.topK) || 8)),
    });
    const seeds = (s.seeds || []).map((x) => {
      const n = state.store.getNode(x.id);
      return { ...x, title: n?.title || null, path: n?.path || null };
    });
    r.index.save();
    return { active: !!s.active, reason: s.reason || null, modelId: s.modelId,
      baseline: s.baseline, compared: s.compared, method: s.method,
      expandedTerms: s.expandedTerms || [], seeds };
  }));

  /** 待人工确认的「沉淀 ↔ 调取」候选：从真实 qaPairs 账本读出，绝不现场编造 */
  ipcMain.handle('semantic:suggestions', () => wrapAsync(async () => {
    const sources = [{ key: 'active', label: '当前知识库', store: state.store }];
    const sed = getSedimentStore();
    if (sed?.store && sed.store !== state.store) {
      sources.push({ key: 'sediment', label: '沉淀回写库', store: sed.store });
    }
    const items = [];
    for (const src of sources) {
      for (const q of (src.store?.qaPairs || [])) {
        for (const s of (q.semantic?.suggestions || [])) {
          items.push({ ...s, qaId: q.id, question: q.question, when: q.ts || q.created_at || null,
            storeKey: src.key, vaultLabel: src.label });
        }
      }
    }
    items.sort((a, b) => (a.built === b.built ? (b.sim - a.sim) : (a.built ? 1 : -1)));
    return { ok: true, modelActive: !!(await semanticModel()).lm, total: items.length,
      pending: items.filter((x) => !x.built).length, items };
  }));

  /** 人工确认后才真正建边 / 建跨库关联；每一步都记 journal + 落盘 */
  ipcMain.handle('semantic:apply-suggestion', (_e, item = {}) => wrapAsync(async () => {
    if (!state.store) throw new Error('尚无打开的知识库');
    const sed = getSedimentStore();
    const qaStore = item.storeKey === 'sediment' ? (sed?.store || state.store) : state.store;
    if (item.mode === 'cross_vault') {
      const srcNode = state.store.getNode(item.dst);
      if (!srcNode) return { ok: false, error: '源知识库卡片已不存在，拒绝建立悬空关联' };
      const target = sed?.store || state.store;
      if (!target.getNode(item.src)) return { ok: false, error: '沉淀卡片已不存在' };
      const cl = target.addCrossLink({
        localId: item.src,
        vaultId: item.sourceVaultId || activeVaultId() || 'unknown-source',
        vaultName: '源知识库', path: srcNode.path, title: srcNode.title || srcNode.path,
        reason: `人工确认的语义关联：${item.reason || ''}（确认时间 ${new Date().toISOString()}）`,
        origin: 'human', weight: 0.5,
      });
      if (!cl) return { ok: false, error: '跨库关联未创建' };
      cl.semantic_sim = item.sim; cl.semantic_lift = item.lift ?? null;
      cl.semantic_model = item.modelId || null; cl.semantic_confirmed = 1;
      target.journal('semantic.crosslink', `${item.src} -> ${srcNode.path}`, null,
        { actor: 'ui', sim: item.sim }, 'ui');
      target.save();
      markSuggestionBuilt(qaStore, item.qaId, item.dst);
      state.graphCache = null;
      return { ok: true, kind: 'cross_link', id: cl.id };
    }
    const a = state.store.getNode(item.src), b = state.store.getNode(item.dst);
    if (!a || !b) return { ok: false, error: '关联两端的卡片至少有一张已不存在' };
    const e = state.store.addEdge(item.src, item.dst, item.type || 'semantic_similar', {
      base_weight: 0.5, origin: 'human', confirmed: 1,
      reason: `人工确认的语义关联：${item.reason || ''}（确认时间 ${new Date().toISOString()}）`,
    });
    if (!e) return { ok: false, error: '关系边未创建' };
    e.semantic_sim = item.sim; e.semantic_lift = item.lift ?? null;
    e.semantic_model = item.modelId || null; e.semantic_confirmed = 1;
    state.store.journal('semantic.link', `${item.src} -> ${item.dst}`, null,
      { actor: 'ui', sim: item.sim }, 'ui');
    state.store.save();
    markSuggestionBuilt(qaStore, item.qaId, item.dst);
    state.graphCache = null;
    return { ok: true, kind: 'edge', id: e.id };
  }));

  ipcMain.handle('semantic:vaults', () => wrapAsync(async () => {
    const reg = readRegistry();
    const list = [];
    for (const v of reg.vaults) {
      const isActive = v.id === activeVaultId();
      const st = isActive ? state.store : scopeStores.get(v.id)?.store || null;
      const indexFile = v.path ? path.join(v.path, '.neokb', 'index', 'semantic.json') : '';
      list.push({
        id: v.id, name: v.name, path: v.path, color: v.color || '#7B5CFF',
        active: isActive, exists: !!(v.path && fs.existsSync(v.path)),
        cards: st?.nodes?.size ?? null,
        hasSemanticIndex: !!(indexFile && fs.existsSync(indexFile)),
      });
    }
    if (!list.some((x) => x.active) && state.store) {
      list.unshift({ id: activeVaultId(), name: '当前知识库', path: state.root || '',
        color: '#7B5CFF', active: true, exists: true, cards: state.store.nodes.size,
        hasSemanticIndex: fs.existsSync(path.join(state.root || '', '.neokb', 'index', 'semantic.json')) });
    }
    return { ok: true, vaults: list, total: list.length };
  }));

  ipcMain.handle('semantic:bridges', (_e, opts = {}) => wrapAsync(async () => {
    const S = await getSemantic();
    const { lm, reason } = await semanticModel();
    if (!lm) return { active: false, reason, pairs: [] };
    const va = await semanticVaultStore(opts.aId);
    const vb = await semanticVaultStore(opts.bId);
    if (!va || !vb) return { active: false, reason: '指定的知识库不存在或目录不可读', pairs: [] };
    if (va.store === vb.store) return { active: false, reason: '同一个知识库不需要建立库桥', pairs: [] };
    const ra = S.resolveSemantic({ neolm: lm }, va.store);
    const rb = S.resolveSemantic({ neolm: lm }, vb.store);
    if (!ra.active || !rb.active) {
      return { active: false, reason: !ra.active ? ra.reason : rb.reason, pairs: [] };
    }
    const out = S.bridgeCandidates({
      a: { store: va.store, index: ra.index },
      b: { store: vb.store, index: rb.index },
      opts: { topK: Math.max(1, Math.min(40, Number(opts.topK) || 12)) },
    });
    ra.index.save(); rb.index.save();
    return { ...out,
      vaultA: { ...out.vaultA, id: va.id, name: va.name, path: va.path },
      vaultB: { ...out.vaultB, id: vb.id, name: vb.name, path: vb.path } };
  }));

  ipcMain.handle('semantic:apply-bridge', (_e, item = {}) => wrapAsync(async () => {
    const va = await semanticVaultStore(item.aVaultId);
    const vb = await semanticVaultStore(item.bVaultId);
    if (!va || !vb) return { ok: false, error: '知识库不存在' };
    const bNode = vb.store.getNode(item.bId);
    const aNode = va.store.getNode(item.aId);
    if (!aNode || !bNode) return { ok: false, error: '跨库关联的卡片至少有一张已不存在' };
    const cl = va.store.addCrossLink({
      localId: item.aId, vaultId: vb.id, vaultName: vb.name, vaultColor: vb.color,
      path: bNode.path, title: bNode.title || bNode.path,
      reason: `人工确认的语义库桥：NeoLM cosine ${item.sim}、相对显著性 ${item.lift}`
        + (item.sharedTerms?.length ? `；共享术语 ${item.sharedTerms.join('、')}` : '；仅模型语义信号，无字面证据'),
      origin: 'human', weight: 0.5,
    });
    if (!cl) return { ok: false, error: '跨库关联未创建' };
    cl.semantic_sim = item.sim; cl.semantic_lift = item.lift ?? null;
    cl.semantic_model = item.modelId || null; cl.semantic_confirmed = 1;
    va.store.journal('semantic.bridge', `${item.aId} -> ${vb.id}/${bNode.path}`, null,
      { actor: 'ui', sim: item.sim, lift: item.lift }, 'ui');
    va.store.save();
    state.graphCache = null;
    return { ok: true, kind: 'cross_link', id: cl.id };
  }));

  // ---- v6.2.0 企业专属：抗量子安全状态 / 完整性复检 / 逆向沉淀开关与验签 ----
  // 契约与 vault:audit 一致：直接返回 { ok, ...字段 }，不再套一层 data。
  ipcMain.handle('ent:securityStatus', () => {
    try { return securityStatus(); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('ent:recheckIntegrity', () => {
    try { qsBootstrap(); return securityStatus(); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('ent:sedimentStatus', () => {
    try { return sedimentStatus(); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('ent:setSediment', (_e, opts = {}) => {
    try {
      const c = setSedimentConfig({ sedimentEnabled: !!(opts && opts.enabled) });
      return { ok: true, enabled: c.enabled, perMinute: c.perMinute };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('ent:sedimentList', (_e, n) => {
    try { return sedimentListApi(n); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('ent:verifySediment', (_e, id) => {
    try { return sedimentVerify(String(id || '')); }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  // ---- v6.37.0 企业版：知识库 API 自动同步（对外链接 → 增量拉取远端更新）----
  ipcMain.handle('ent:syncStatus', () => wrap(() => {
    const c = syncConfig();
    return {
      ok: true, enabled: c.enabled, baseUrl: c.baseUrl, vaultId: c.vaultId,
      intervalMs: c.intervalMs, lastSyncAt: c.lastSyncAt, lastResult: c.lastResult,
      running: !!state.syncRunning, destDir: syncDestDir(),
      hasToken: !!c.token,
    };
  }));
  ipcMain.handle('ent:syncConfigSet', (_e, opts = {}) => wrap(() => {
    const cfg = readConfig();
    const next = vaultSync.patchSyncConfig(cfg, opts || {});
    // enabled/baseUrl 变化时重排定时器，做到"配置一次，之后自动更新，无需重新链接"
    writeConfig(next);
    applySyncSchedule();
    const c = vaultSync.readSyncConfig(next);
    return { ok: true, enabled: c.enabled, baseUrl: c.baseUrl, vaultId: c.vaultId,
      intervalMs: c.intervalMs, hasToken: !!c.token };
  }));
  ipcMain.handle('ent:syncNow', () => runVaultSync());

  // 深链：neolink://open/<库ID>/<卡片ID> —— 由渲染层解析并打开对应卡片
  ipcMain.handle('link:deep', async (_e, payload = {}) => {
    const vaultId = String(payload.vaultId || '');
    const cardId = String(payload.cardId || '');
    try {
      if (vaultId && state.root && vaultIdFor(state.root) !== vaultId) {
        const entry = getVaultEntry(vaultId);
        if (!entry) return { ok: false, error: '目标知识库不存在' };
        if (!fs.existsSync(entry.path)) return { ok: false, error: '目标知识库文件夹已被移动或删除' };
        await openVault(entry.path);
      }
      const node = cardId && state.store ? state.store.getNode(cardId) : null;
      return { ok: true, vault: vaultInfo(), cardId: node ? node.id : null, found: !!node };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  // v4.1.0：引用验证溯源 —— 解析 neolink://verify/<库ID>/<节点ID>?s=<片段>，
  // 必要时切换到目标库，打开对应卡片并把"被具体引用的片段"回传给渲染层高亮。
  ipcMain.handle('link:verify', async (_e, payload = {}) => {
    const vaultId = String(payload.vaultId || '');
    const nodeId = String(payload.nodeId || '');
    const snippet = payload.snippet || '';
    try {
      if (vaultId && state.root && vaultIdFor(state.root) !== vaultId) {
        const entry = getVaultEntry(vaultId);
        if (!entry) return { ok: false, error: '目标知识库不存在' };
        if (!fs.existsSync(entry.path)) return { ok: false, error: '目标知识库文件夹已被移动或删除' };
        await openVault(entry.path);
      }
      const node = nodeId && state.store ? state.store.getNode(nodeId) : null;
      return { ok: true, vault: vaultInfo(), cardId: node ? node.id : null, found: !!node, snippet };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  ipcMain.handle('link:takeDeepLink', async () => {
    // v2.2.0：渲染层启动完成后主动取一次首启深链（取走即清空）
    const dl = pendingDeepLink;
    pendingDeepLink = null;
    return { ok: true, deepLink: dl || null };
  });

  ipcMain.handle('vault:pick', async () => {
    // v2.2.1：自动化环境不弹原生对话框（见 isAutomation 注释）
    if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
    const res = await dialog.showOpenDialog(win, {
      title: '选择知识库文件夹',
      defaultPath: state.root || defaultVaultPath(),
      properties: ['openDirectory', 'createDirectory', 'dontResolveAliases'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    await openVault(res.filePaths[0]);
    return { canceled: false, vault: vaultInfo(), registry: listRegistry() };
  });

  // ---------------- v2.2.1：存储位置由用户自选 ----------------
  // 用户诉求：「存储、目录等等，用户可以自己选择存储位置，不能默认C盘」。
  // 这里提供三件事：
  //   ① 列出真实可用的存储位置（各盘符 + 常用目录），带可用空间；
  //   ② 让用户挑一个位置作为**默认库位置**（记住，下次开库直接用它）；
  //   ③ 把当前库整体**迁移**到新位置 —— 复制 + 校验 + 逐字节核对，
  //      确认无误后才切换，绝不先删旧库。
  ipcMain.handle('vault:storageLocations', () => {
    try {
      return {
        ok: true,
        data: {
          locations: storageLocations(),
          current: state.root || null,
          defaultPath: defaultVaultPath(),
          storageRoot: defaultVaultRoot(),
          // v2.2.1：当前库是否落在系统盘上 —— 界面据此给出醒目提示
          currentOnSystemDrive: state.root ? isOnSystemDrive(state.root) : false,
          systemRoot: process.platform === 'win32' ? 'C:\\' : '/',
        },
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  /** 选择"默认存储位置"：用户挑一个根目录，我们在其下建 NeoCosmos Vault。 */
  ipcMain.handle('vault:chooseStorage', async () => {
    try {
      // v2.2.1：自动化环境不弹原生对话框（见 isAutomation 注释）
    if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
    const res = await dialog.showOpenDialog(win, {
        title: '选择知识库存储位置（建议选非系统盘，如 D:\\ 或移动硬盘）',
        defaultPath: (() => {
          try {
            const cfg0 = readConfig();
            if (cfg0.vaultRoot) return path.resolve(String(cfg0.vaultRoot));
          } catch { /* ignore */ }
          const roots = preferredVaultRoots();
          return roots[0] || app.getPath('documents');
        })(),
        properties: ['openDirectory', 'createDirectory', 'dontResolveAliases'],
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      const chosen = path.resolve(res.filePaths[0]);
      // 用户选的是**存放知识的根目录**，库本身放在它下面
      const target = path.join(chosen, 'NeoCosmos Vault');
      // 目标里已经有内容？那是用户自己放的东西 —— 只登记，不覆盖、不播种。
      const existed = fs.existsSync(target)
        && fs.readdirSync(target).filter((n) => !n.startsWith('.')).length > 0;
      fs.mkdirSync(target, { recursive: true });
      // 记住这个选择：下次启动直接用它，不再走默认逻辑
      const cfg = readConfig();
      cfg.vaultRoot = chosen;
      cfg.vaultPath = target;
      writeConfig(cfg);
      // v2.2.1 修复：原来这里写着 `if (!state.root)` 才 seed+openVault ——
      // 于是**用户已经开着某个库的时候点了「选择存储位置」，什么都没发生**：
      // 新位置既没建库、没播种，新库也没进登记列表（跨库视图里根本看不到）。
      // 功能等于半残。现在无条件切过去：选中即生效，用户马上能看到结果。
      if (!existed) seedStarterKit(target);
      await openVault(target);
      return {
        ok: true, canceled: false,
        vault: vaultInfo(), registry: listRegistry(),
        vaultRoot: chosen, seeded: !existed,
        onSystemDrive: isOnSystemDrive(target),
        message: existed
          ? `存储位置已改为 ${chosen}（该目录下已有知识库，直接沿用，未覆盖任何文件）`
          : `存储位置已改为 ${chosen}，已新建知识库并切换过去`,
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  /**
   * 迁移当前库到新位置。
   * 步骤：复制 → 逐文件 sha256 核对 → 全部一致才切换并登记。
   * 旧目录**保留不动**（用户确认新库无误后可自行删除）——
   * 迁移过程中任何一步失败，旧库都还是好的。
   */
  ipcMain.handle('vault:migrate', async (_e, opts = {}) => {
    try {
      if (!state.root) return { ok: false, error: '尚未打开知识库' };
      let dest = String(opts.targetDir || '');
      if (!dest) {
        // 界面没给目标 → 让用户挑一个（原生对话框的反馈在应用之外，
        // 所以审计脚本会跳过这类按钮，不会把它误判成死按钮）
        // v2.2.1：自动化环境不弹原生对话框
        if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
        const r = await dialog.showOpenDialog(win, {
          title: '选择迁移到哪个文件夹（会新建 NeoCosmos Vault 子目录，不覆盖已有内容）',
          defaultPath: path.dirname(state.root) || undefined,
          properties: ['openDirectory', 'createDirectory', 'dontResolveAliases'],
        });
        if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
        dest = path.join(r.filePaths[0], 'NeoCosmos Vault');
      }
      const src = state.root;
      const abs = path.resolve(dest);
      if (abs === path.resolve(src)) return { ok: false, error: '目标位置与当前库相同' };
      if (fs.existsSync(abs) && fs.readdirSync(abs).filter((n) => !n.startsWith('.')).length > 0) {
        return { ok: false, error: '目标文件夹非空 —— 为避免覆盖已有卡片，已拒绝迁移' };
      }
      const files = listVaultFiles(src);
      fs.mkdirSync(abs, { recursive: true });
      // 复制
      for (const rel of files) {
        const s = path.join(src, rel), d = path.join(abs, rel);
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
      // 逐字节核对 —— 迁移这种事不能"看起来复制了"
      const bad = [];
      for (const rel of files) {
        const s = path.join(src, rel), d = path.join(abs, rel);
        if (!fs.existsSync(d) || sha256Full(fs.readFileSync(s)) !== sha256Full(fs.readFileSync(d))) bad.push(rel);
      }
      if (bad.length) {
        return { ok: false, error: `迁移校验未通过：${bad.length} 个文件内容不一致，目标位置已保留供检查，原库未受影响` };
      }
      // 一切一致 → 切换
      await openVault(abs);
      const cfg = readConfig();
      cfg.vaultPath = abs;
      // v2.2.1：迁移后把"默认存储根目录"也一并跟着改。
      // 否则只改了 vaultPath，下次新建库/首次启动仍会落回原来的根目录 ——
      // 用户说"不能默认C盘"，迁完了却在别处又冒出一个 C 盘库，就是没改干净。
      cfg.vaultRoot = path.dirname(abs);
      writeConfig(cfg);
      return {
        ok: true, cards: files.length, target: abs, previous: src,
        vault: vaultInfo(), registry: listRegistry(),
        onSystemDrive: isOnSystemDrive(abs),
        message: `已迁移 ${files.length} 张卡片到新位置。原位置的文件**未删除**，确认无误后可自行清理。`,
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  ipcMain.handle('vault:reveal', () => {
    if (state.root) shell.openPath(state.root);
    return true;
  });

  /**
   * v2.2.1：把知识库内的某个相对路径在**系统文件管理器**里打开。
   * 面包屑点击即用此能力 ——「点一下就跳到那张卡片所在的文件夹」。
   *
   * 安全要点：入参是**相对路径**，必须验证解析后仍在库根目录之内。
   * 否则一条形如 `../../../../Windows/System32/cmd.exe` 的路径
   * 就能让渲染层打开任意目录 —— 渲染层不可信，这条边界必须在主进程守。
   *
   * @param {string} rel  相对库根的路径（如 `_memory/semantic/示例` 或某个 .md 文件）
   *
   * 目录与文件由主进程自己判断（读磁盘），不靠渲染层传标志位 ——
   * 那样更可靠，也省得渲染层把标志位传错。
   */
  ipcMain.handle('vault:revealPath', async (_e, rel) => {
    try {
      if (!state.root) return { ok: false, error: '尚未打开知识库' };
      const raw = String(rel || '');
      if (!raw) return { ok: false, error: '路径为空' };
      // 归一化并确认不越界
      const abs = path.resolve(state.root, raw);
      const relCheck = path.relative(state.root, abs);
      if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
        return { ok: false, error: '路径超出知识库范围' };
      }
      if (!fs.existsSync(abs)) {
        return { ok: false, error: '目标不存在（可能已被移动或删除）' };
      }
      let st;
      try { st = fs.statSync(abs); } catch (e) { return { ok: false, error: '无法读取目标：' + String(e && e.message || e) }; }
      // v2.2.1：自动化（UI 审计 / 探针）里**不要真的弹出资源管理器**。
      // 审计会逐个点击可点元素，点了就弹窗的话，一次审计能弹出几十个
      // 资源管理器窗口，把桌面淹没。自动化模式下只做校验、不真的打开。
      // （NEOLINK_ALLOW_SHELL=1 可显式放行真弹窗 —— 用于人工验证 Explorer 真的被拉起）
      if (!process.env.NEOLINK_ALLOW_SHELL
        && (process.env.NEOLINK_AUDIT_SCRIPT || process.env.NEOLINK_PROBE_SCRIPT || process.env.NEOLINK_DRY_SHELL)) {
        return { ok: true, path: abs, mode: st.isDirectory() ? 'open-dir' : 'reveal-file', dryRun: true };
      }
      if (st.isDirectory()) {
        const err = await shell.openPath(abs);
        if (err) return { ok: false, error: '打开失败：' + String(err) };
        return { ok: true, path: abs, mode: 'open-dir' };
      }
      // 文件：在资源管理器里定位到它（并选中）
      shell.showItemInFolder(abs);
      return { ok: true, path: abs, mode: 'reveal-file' };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  ipcMain.handle('vault:loadExample', async () => {
    state.suppressWatchUntil = Date.now() + 3000;
    const r = copyExampleCorpus(state.root);
    // v2.1.0：只做**增量索引**，不再 openVault 全库重开。
    // 百万级库重开一次要 90 秒，而这里只新增了几十张卡 —— 增量索引足够。
    if (state.store) {
      await state.engine.indexVault(state.store);
      state.graphCache = null; state.graphCacheKey = null;
    }
    return { ...r, vault: vaultInfo() };
  });

  /**
   * v2.2.1：**只读**地报告示例语料的情况 —— 绝不写用户的库。
   * 供自检与「体系」页确认示例语料是否可用。
   */
  ipcMain.handle('vault:exampleInfo', () => {
    try {
      if (!fs.existsSync(EXAMPLE_CORPUS)) return { ok: true, available: false, count: 0 };
      let count = 0;
      const walk = (d, depth) => {
        if (depth > 4) return;
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p, depth + 1);
          else if (/\.md$/i.test(e.name)) count++;
        }
      };
      walk(EXAMPLE_CORPUS, 0);
      return { ok: true, available: true, count };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  ipcMain.handle('vault:seed', async () => {
    state.suppressWatchUntil = Date.now() + 3000;
    const n = seedStarterKit(state.root);
    if (state.store) {
      await state.engine.indexVault(state.store);
      state.graphCache = null; state.graphCacheKey = null;
    }
    return { written: n, vault: vaultInfo() };
  });

  // ---------------- 跨库关联 ----------------
  ipcMain.handle('crosskb:remoteList', async (_e, opts = {}) => {
    try {
      const entry = getVaultEntry(String(opts.vaultId || ''));
      if (!entry) return { ok: false, error: '目标知识库不存在' };
      if (!fs.existsSync(entry.path)) return { ok: false, error: '目标知识库文件夹不存在' };
      const E = state.engine || await loadEngine();
      const key = entry.path;
      const cached = state.remoteCache.get(key);
      let remote;
      if (cached && Date.now() - cached.ts < 60000) remote = cached.store;
      else {
        remote = new E.KbStore(entry.path).load();
        await E.indexVault(remote);
        state.remoteCache.set(key, { ts: Date.now(), store: remote });
        if (state.remoteCache.size > 4) {
          const firstKey = state.remoteCache.keys().next().value;
          state.remoteCache.delete(firstKey);
        }
      }
      const q = String(opts.q || '').trim().toLowerCase();
      let items = remote.allNodes()
        .filter((n) => !n.archived)
        .map((n) => ({ path: n.path, title: n.title, layer: n.memory_layer || 'semantic', tags: n.tags || [] }));
      if (q) items = items.filter((n) => n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
      items = items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh')).slice(0, 200);
      return { ok: true, data: { vault: { id: entry.id, name: entry.name, color: entry.color }, items, total: remote.nodes.size } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  ipcMain.handle('crosskb:add', (_e, opts = {}) => wrap(() => {
    const store = requireStore();
    const entry = getVaultEntry(String(opts.vaultId || ''));
    if (!entry) throw new Error('目标知识库不存在');
    if (entry.id === vaultIdFor(state.root)) throw new Error('不能跨库关联到当前库自己');
    const localId = String(opts.localId || '');
    if (!store.getNode(localId)) throw new Error('本地卡片不存在');
    const link = store.addCrossLink({
      localId,
      vaultId: entry.id,
      vaultName: entry.name,
      vaultColor: entry.color,
      path: String(opts.path || ''),
      title: String(opts.title || opts.path || ''),
      reason: opts.reason ? String(opts.reason) : null,
      origin: 'human',
      weight: 0.9,
    });
    store.journal('crosskb.add', `${localId} -> ${entry.name}/${link.path}`, null, { actor: 'user' }, 'user');
    store.save();
    state.graphCache = null; state.graphCacheKey = null;
    return { link, vault: vaultInfo() };
  }));

  ipcMain.handle('crosskb:remove', (_e, id) => wrap(() => {
    const store = requireStore();
    const removed = store.removeCrossLink(String(id || ''));
    // 删不掉就抛异常 —— 由 wrap() 统一转成 { ok:false, error }。
    // 早前这里 return { ok: removed }，被 wrap 包成双层 ok，
    // 渲染层读外层 r.ok 恒为 true，于是**删不掉也提示"已删除"**。
    if (!removed) throw new Error('跨库关联不存在或已被删除');
    store.save(); state.graphCache = null;
    return {};
  }));

  ipcMain.handle('crosskb:open', async (_e, opts = {}) => {
    try {
      const store = requireStore();
      let link = null;
      if (opts.id) link = store.crossLinks.find((c) => c.id === String(opts.id));
      if (!link && opts.vaultId && opts.path) {
        const entry = getVaultEntry(String(opts.vaultId));
        if (entry) link = { vault_id: entry.id, path: String(opts.path) };
      }
      if (!link) return { ok: false, error: '跨库关联不存在' };
      const entry = getVaultEntry(link.vault_id);
      if (!entry) return { ok: false, error: '目标知识库已被移除登记' };
      if (!fs.existsSync(entry.path)) return { ok: false, error: '目标知识库文件夹不存在' };
      await openVault(entry.path);
      const targetId = state.store.nodeIdFor(link.path);
      const exists = !!state.store.getNode(targetId);
      return {
        ok: true,
        vault: vaultInfo(),
        registry: listRegistry(),
        openId: exists ? targetId : null,
        openPath: link.path,
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  ipcMain.handle('graph:get', async (_e, opts = {}) => {
    if (!state.store) throw new Error('尚无打开的知识库');
    // v2.1.0：分级载荷（full / overview / region / focus）。
    // 渲染层永远只拿到几千个对象，100 万级卡片才不会在 IPC 克隆这一步卡死。
    const level = opts.level || null;
    const key = level
      ? `${level}|${opts.domain || ''}|${opts.id || ''}|${opts.hops || ''}`
      : 'auto';
    if (!opts.force && state.graphCache && state.graphCacheKey === key) return state.graphCache;
    const g = state.engine.exportGraphPayload(state.store, {
      iterations: opts.iterations || 420,
      level: level || undefined,
      domain: opts.domain || undefined,
      id: opts.id || undefined,
      hops: opts.hops || undefined,
      vault: vaultInfo(),
    });
    state.graphCache = g;
    state.graphCacheKey = key;
    return g;
  });

  // ---------------- v6.3.0：类脑认知内核 IPC ----------------
  // 所有返回值都是运行时真实状态或真源数据，界面不做任何虚构填充。
  ipcMain.handle('mind:status', () => wrap(() => {
    if (!state.organism) throw new Error('认知内核尚未就绪');
    return state.organism.status();
  }));
  ipcMain.handle('mind:anatomy', () => wrap(() => {
    const C = state.engine?.cognition;
    if (!C) throw new Error('认知内核尚未就绪');
    return {
      anatomy: C.ANATOMY, connectome: C.CONNECTOME,
      cognition: C.COGNITION, council: C.COUNCIL,
      adjudication: C.ADJUDICATION, source: C.SOURCE,
      boundary: C.ORGANISM_BOUNDARY,
    };
  }));
  ipcMain.handle('mind:autonomous', (_e, on) => wrap(() => {
    if (!state.organism) throw new Error('认知内核尚未就绪');
    return { autonomous: state.organism.setAutonomous(!!on), status: state.organism.status() };
  }));
  ipcMain.handle('mind:tick', () => wrap(() => {
    if (!state.organism) throw new Error('认知内核尚未就绪');
    const r = state.organism.tick(true);   // 手动「思考一次」：即使自主开关关闭也允许
    if (!r.skipped && win && !win.isDestroyed()) win.webContents.send('mind:tick', { event: r.event, pulses: r.pulses, levels: r.levels });
    // v6.6.0：手动思考若已接入量子层，同一心跳再跑一次量子认知步并随结果返回
    let quantum = null;
    if (!r.skipped && state.quantumCognition?.bound) {
      try { quantum = state.quantumCognition.run(); } catch (e) { /* 不阻断手动思考 */ }
    }
    // v6.8.0：手动思考同步跑一次类脑引擎（真实 SNN + 联想 + 预测），随结果返回
    const neuro = (!r.skipped) ? neuroSense(r.levels, r.event?.seedRegion || 'manual', false) : null;
    return { event: r.event, pulses: r.pulses, levels: r.levels, quantum, neuro, status: state.organism.status() };
  }));
  ipcMain.handle('mind:feedback', (_e, args = {}) => wrap(() => {
    if (!state.organism) throw new Error('认知内核尚未就绪');
    return state.organism.learn(String(args.grade || 'C').toUpperCase(), !!args.good);
  }));
  ipcMain.handle('mind:ledger', () => wrap(() => {
    if (!state.organism) throw new Error('认知内核尚未就绪');
    const s = state.organism.snapshot();
    return {
      thoughts: s.thoughts.slice(-40).reverse(),
      hypotheses: s.hypotheses.slice(-40).reverse(),
      experiences: s.experiences.slice(-20).reverse(),
      feedback: s.feedback,
    };
  }));

  // ---------------- v6.6.0：量子认知层 IPC（量子算法接入 3D 智脑） ----------------
  // 全部数值来自运行时真实计算：基底 = 30 真实脑区，纠缠 = 183 真轴突，
  // 测量 = Born 规则确定性采样，脉冲延迟 = 连接组 latency_ms。
  ipcMain.handle('mind:quantum-status', () => wrap(() => {
    const qc = ensureQuantumCognition();
    if (!qc) throw new Error('量子认知层尚未就绪');
    return qc.status();
  }));
  ipcMain.handle('mind:quantum-step', () => wrap(() => {
    const qc = ensureQuantumCognition();
    if (!qc) throw new Error('量子认知层尚未就绪');
    const payload = qc.run();
    if (win && !win.isDestroyed()) win.webContents.send('mind:quantum', payload);
    return payload;
  }));
  ipcMain.handle('mind:quantum-bind', (_e, on) => wrap(() => {
    const qc = ensureQuantumCognition();
    if (!qc) throw new Error('量子认知层尚未就绪');
    const bound = qc.setBound(!!on);
    return { bound, status: qc.status() };
  }));

  // ---------------- v6.8.0：类脑计算引擎 IPC（SNN/吸引子/序列/预测编码） ----------------
  // 四个真实算法各自可独立调用；数字全部来自运行时真实计算，界面不做任何虚构填充。
  const neuroOrThrow = () => { const n = ensureNeuro(); if (!n) throw new Error('类脑计算引擎尚未就绪'); return n; };
  ipcMain.handle('mind:neuro-status', () => wrap(() => neuroOrThrow().status()));
  ipcMain.handle('mind:neuro-step', (_e, args = {}) => wrap(() => {
    const n = neuroOrThrow();
    const seed = (args && args.pattern && typeof args.pattern === 'object') ? args.pattern
      : ((n.listConcepts()[0] || {}).regions || []).reduce((o, k) => (o[k] = 0.9, o), {});
    const cyc = n.runCycle(seed, { steps: args?.steps || 160 });
    const recall = n.recall(seed, { iters: 40 });
    const predict = n.predict();
    const payload = { levels: cyc.levels, pulses: cyc.pulses, spikes: cyc.spikes, firedRegions: cyc.firedRegions, recall, predict, status: n.status(), label: args?.label || null };
    if (win && !win.isDestroyed()) win.webContents.send('mind:neuro', payload);
    return payload;
  }));
  ipcMain.handle('mind:neuro-recall', (_e, args = {}) => wrap(() => {
    const n = neuroOrThrow();
    const recall = n.recall((args && args.cue) || {}, { iters: 40 });
    // 用补全后的模式再跑一次 SNN，让 3D 脑按真实脉冲点亮该概念
    const cyc = n.runCycle(recall.recalled, { steps: 120 });
    const payload = { recall, levels: cyc.levels, pulses: cyc.pulses, spikes: cyc.spikes, firedRegions: cyc.firedRegions, status: n.status() };
    if (win && !win.isDestroyed()) win.webContents.send('mind:neuro', payload);
    return payload;
  }));
  ipcMain.handle('mind:neuro-predict', (_e, args = {}) => wrap(() => {
    const n = neuroOrThrow();
    const predict = n.predict({ sdr: args?.sdr });
    return { predict, status: n.status() };
  }));
  ipcMain.handle('mind:neuro-learn', (_e, args = {}) => wrap(() => {
    const n = neuroOrThrow();
    if (args && args.pattern && typeof args.pattern === 'object') n.absorb(args.pattern, args.label || 'user-concept');
    return { status: n.status() };
  }));

  // ---------------- v6.41.0：桌面精灵 IPC 已移除 ----------------
  // sprite:open / close / status / set-scale / ask 五个通道整体删除（用户要求移除桌面精灵）。
  // 自主引擎（astra:*）与认知内核 IPC 全部保留，能力中枢 / 3D 智脑 / 问一问不受影响。

  // ---------------- v6.11：ASTRA 自主意识 / 桌面漫游 IPC ----------------
  // 契约与全局 wrap 一致：{ ok, data } / { ok:false, error }。
  ipcMain.handle('astra:status', () => wrap(() => ({
    mind: ensureAstra().status(),
    motion: state.astraMotion ? state.astraMotion.state() : null,
    clickThrough: state.astraClickThrough, mode: state.astraUserMode,
    panelOpen: !!state.astraPanelOpen, boundary: ASTRA_BOUNDARY,
    libraryRoot: ensureAstraLibrary().root,
  })));
  // v6.15：深度数学内核 / 自我迭代闭环（全部是真实计算，没有演示数据）
  ipcMain.handle('astra:deep-status', () => wrap(() => ensureAstra().deepStatus()));
  ipcMain.handle('astra:deep-math', () => wrap(() => ensureAstra().deepMathCheck()));
  ipcMain.handle('astra:self-iterate', (_e, observation) => wrap(() =>
    ensureAstra().selfIterate(observation == null ? undefined : observation)));
  ipcMain.handle('astra:set-autonomous', (_e, on) => wrap(() => {
    const v = ensureAstra().setAutonomous(!!on);
    broadcastAstra({ event: 'autonomy' });
    return { autonomous: v };
  }));
  ipcMain.handle('astra:tick', (_e, opts) => wrap(() => {
    const r = ensureAstra().tick({ force: true, ...(opts || {}) });
    broadcastAstra({ event: 'manual_tick' });
    return r;
  }));
  ipcMain.handle('astra:evolve', () => wrap(() => {
    const r = ensureAstra().evolve(true, 'manual');
    broadcastAstra({ event: 'evolution', evolution: r });
    return r;
  }));
  ipcMain.handle('astra:rollback', (_e, gen) => wrap(() => {
    const r = ensureAstra().rollback(gen);
    broadcastAstra({ event: 'rollback' });
    return r;
  }));
  ipcMain.handle('astra:reset', () => wrap(() => {
    const r = ensureAstra().reset();
    broadcastAstra({ event: 'reset' });
    return r;
  }));
  ipcMain.handle('astra:perceive', (_e, kind, payload) => wrap(() => {
    const r = ensureAstra().perceive(String(kind || '').slice(0, 40), payload || {});
    return r;
  }));
  ipcMain.handle('astra:audit', (_e, n) => wrap(() => ensureAstra().audit(Number(n) || 40)));
  ipcMain.handle('astra:memories', (_e, n) => wrap(() => ensureAstra().memories(Number(n) || 40)));
  ipcMain.handle('astra:mode', (_e, mode) => wrap(() => {
    const m = ['auto', 'follow', 'perch'].includes(mode) ? mode : 'auto';
    state.astraUserMode = m;
    const applied = state.astraMotion?.setMode(m) || m;
    broadcastAstra({ event: 'mode' });
    return { mode: applied };
  }));
  ipcMain.handle('astra:hold', (_e, on) => wrap(() => {
    state.astraPanelOpen = !!on;
    const hold = state.astraMotion?.setHold(!!on) ?? false;
    setSpriteInteractive(true);   // 面板打开时绝不穿透
    return { hold, panelOpen: state.astraPanelOpen };
  }));
  ipcMain.handle('astra:home', () => wrap(() => {
    const c = state.astraMotion?.goHome() || null;
    broadcastAstra({ event: 'home' });
    return c;
  }));
  ipcMain.handle('astra:click-through', (_e, on) => wrap(() => {
    state.astraClickThrough = !!on;
    if (!on) setSpriteInteractive(true);
    broadcastAstra({ event: 'click-through' });
    return { clickThrough: state.astraClickThrough };
  }));
  ipcMain.handle('astra:refresh-bounds', () => wrap(() => {
    state.astraMotion?.refreshBounds();
    return state.astraMotion?.state() || null;
  }));

  // 高频通道用 on（不产生往返 Promise）：鼠标命中报告 / 拖拽起止
  ipcMain.on('astra:hit', (_e, p) => { setSpriteInteractive(!!p?.interactive); });
  ipcMain.on('astra:drag-start', (_e, off) => {
    state.astraDrag = {
      x: Math.max(0, Number(off?.offsetX) || 0),
      y: Math.max(0, Number(off?.offsetY) || 0),
    };
    state.astraPanelOpen = false;
    state.astraMotion?.setMode('drag');
    setSpriteInteractive(true);
  });
  ipcMain.on('astra:drag-end', () => {
    if (!state.astraDrag) return;
    state.astraDrag = null;
    state.astraMotion?.refreshBounds();
    state.astraMotion?.setMode(state.astraUserMode || 'auto');
    ensureAstra().perceive('drag');
    broadcastAstra({ event: 'drag' });
  });

  // v6.12：思维沉淀库 —— 安装目录自动建立、可自主更换、可检索
  ipcMain.handle('astra:library:status', () => wrap(() => {
    const lib = ensureAstraLibrary();
    return { ok: true, stats: lib.stats(), relocated: !!((readConfig().astraLibraryRoot) || null) };
  }));
  ipcMain.handle('astra:library:query', (_e, text, limit) => wrap(() => {
    const lib = ensureAstraLibrary();
    return { ok: true, hits: lib.query(String(text || ''), Number(limit) || 8) };
  }));
  ipcMain.handle('astra:library:relocate', (_e, newRoot, opts) => wrap(() => {
    const lib = ensureAstraLibrary();
    const r = lib.relocate(String(newRoot || ''), opts || {});
    if (r.ok) broadcastAstra({ event: 'library_relocated', root: r.root });
    return r;
  }));
  ipcMain.handle('astra:library:open', () => wrap(() => {
    const lib = ensureAstraLibrary();
    const r = lib.open();
    return { ok: true, root: r };
  }));
  ipcMain.handle('astra:library:graph', (_e, limit) => wrap(() => {
    const lib = ensureAstraLibrary();
    return { ok: true, graph: lib.synapseGraph(Number(limit) || 48) };
  }));

  // 通用工具通道：引擎侧 MCP 工具直接暴露给 UI（与 MCP Server 同一实现）
  ipcMain.handle('tool:invoke', async (_e, name, args) => {
    // v6.18.0：kb_host_config 只读模块自身路径与传入的库目录，不依赖已打开的 store。
    // 未开库时也应能生成真实接入配置，而不是弹「尚无打开的知识库」。
    const needsStore = name !== 'kb_host_config';
    if (!state.store && needsStore) return { ok: false, error: '尚无打开的知识库' };
    return wrapAsync(async () => {
      // v2.1.0：ctx 兜底。openVault 中途失败时 state.ctx 可能还没建立，
      // 此时用 store 兜一个最小上下文 —— 否则所有 MCP 工具都会报
      // "Cannot read properties of null (reading 'store')"，把真实错误盖住。
      const ctx = state.ctx || {
        store: state.store, caller: 'ui', canWriteBody: true,
        vaultId: state.root ? vaultIdFor(state.root) : '',
        vaultPath: state.root || args?.vault || '',
      };
      // v6.31.0：注入真实语言模型实例；加载失败即 null，既有工具照常工作（优雅降级）。
      let lm = null;
      try { lm = await getNeoLM(); } catch { lm = null; }
      // v6.3.0：只有 kb_legal_mind 需要 organism（反馈学习 / 经验沉淀），其余工具 ctx 原样不动
      const base = name === 'kb_legal_mind' ? { ...ctx, organism: state.organism } : ctx;
      const toolCtx = { ...base, neolm: lm };
      const out = state.engine.callTool(name, args || {}, toolCtx);
      // 任何写操作后失效图谱缓存
      if (/write|add|link|apply|review/.test(name)) state.graphCache = null;
      // v6.8.0：把八阶段真实脑区激活喂给类脑计算引擎（作为可信概念写入吸引子记忆 + SNN 脉冲 + 联想/预测）
      if (name === 'kb_legal_mind' && out && !out.error && out.brainLevels) {
        neuroSense(out.brainLevels, (args && args.question) || 'legal', true);
      }
      return out;
    });
  });

  ipcMain.handle('index:rebuild', async () => {
    if (!state.store) throw new Error('尚无打开的知识库');
    state.suppressWatchUntil = Date.now() + 2000;
    // v2.1.0：indexVault 内部按需落盘，这里不再重复 save（百万级索引重写一遍要几分钟）
    await state.engine.indexVault(state.store);
    state.graphCache = null; state.graphCacheKey = null;
    return vaultInfo();
  });

  ipcMain.handle('journal:tail', async (_e, n = 40) => {
    const f = path.join(state.root, '.neolink', 'journal', 'journal.jsonl');
    if (!fs.existsSync(f)) return [];
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }).reverse();
  });

  // ---------------- 文档层通道（工作区） ----------------
  ipcMain.handle('doc:tree', () => wrap(() => buildTree()));

  /**
   * v2.2.1：跨库目录树 —— 把**所有已登记库**合并成一棵目录树。
   *
   * 用户诉求：「显示当前的所有的库，就作为一个库的目录就可以」。
   * 此前左栏只显示**当前库**的卡片树，多库并列时用户必须反复切换库、
   * 靠记忆拼接"这个文件在哪个库里"。
   *
   * 设计：
   *   · 每个已登记库是树的一个**顶层目录节点**（库名），其下是该库自己的目录结构；
   *   · 节点带 vaultId，渲染层据此知道点开时要不要先切库；
   *   · 卡片 id 是**按相对路径派生**的（fnv1a64），
   *     两个库里的同名同路径文件会得到同一个 id —— 所以这里必须
   *     **带上 vaultId 一起返回**，渲染层要用 `vaultId + id` 组合去定位，
   *     绝不能只用 id（否则 A 库的卡片会打开成 B 库的）。
   *
   * 只读：不建索引、不写盘、不切换当前库。
   */
  ipcMain.handle('vaults:tree', (_e, opts = {}) => wrap(() => buildAllVaultsTree(opts)));
  ipcMain.handle('doc:read', (_e, id) => wrap(() => readDoc(id)));
  ipcMain.handle('doc:save', (_e, id, text) => wrap(() => saveDoc(id, text)));
  ipcMain.handle('doc:create', (_e, opts) => wrap(() => createDoc(opts)));
  ipcMain.handle('doc:archive', (_e, id) => wrap(() => archiveDoc(id)));
  ipcMain.handle('doc:rename', (_e, id, t) => wrap(() => renameDoc(id, t)));
  ipcMain.handle('doc:export', async (_e, id) => {
    try {
      const store = requireStore();
      const node = store.getNode(String(id || ''));
      if (!node) return { ok: false, error: '卡片不存在' };
      // v2.2.1：自动化环境不弹原生对话框
      if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
      const res = await dialog.showSaveDialog(win, {
        title: '导出卡片（Markdown）',
        defaultPath: `${node.title.replace(/[\\/:*?"<>|]/g, '·')}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      fs.copyFileSync(store.resolver.resolve(node.path), res.filePath);
      store.journal('doc.export', node.path, null, { actor: 'user', to: res.filePath }, 'user');
      return { ok: true, path: res.filePath };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  // ---------------- v2.2.1：企业级备份 / 还原 / 校验 ----------------
  // 企业场景里最贵的不是功能，是**数据丢了**。本机 .md 文件夹虽然安全，
  // 但硬盘会坏、误删会发生、迁移会出错 —— 没有备份就没有真正的安全。
  // 这里提供三个动作，全部**只读或只写副本，绝不动用户的原始文件**：
  //   ① backup  导出整个库为一份 .zip（卡片 + 索引 + 审计日志 + 清单）
  //   ② verify  校验一份备份包是否完整、可解、与当前库是否一致
  //   ③ restore 从备份包还原（**写到新目录**，绝不覆盖现有库）
  const BACKUP_MANIFEST = 'neolink-backup.json';

  // v2.2.1：打包/解包用 **Node 自带的 zlib**，不依赖系统 tar。
  // 原因：Windows 自带的 tar 是 bsdtar（支持 zip），但 PATH 里往往先命中
  // Git 附带的 GNU tar —— 它**不支持 `-a`（zip）**，会把备份包打成 tar，
  // 还原时再解一次格式还对不上；而在没装 Git 的机器上又可能压根没有 tar。
  // 用 zlib 写 zip 格式只有百来行，且跨平台一致、不依赖任何外部命令。
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  /** 把 { 归档内相对路径: Buffer } 打包成 zip 字节 */
  function makeZip(entries) {
    const zlib = require('node:zlib');
    const locals = [], central = [];
    let offset = 0;
    for (const [name, data] of entries) {
      const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
      const comp = zlib.deflateRawSync(data, { level: 6 });
      const crc = crc32(data);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);            // version needed
      lh.writeUInt16LE(0x0800, 6);        // flags: UTF-8 文件名
      lh.writeUInt16LE(8, 8);             // method: deflate
      lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);  // 时间/日期（固定值，保证可复现）
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(comp.length, 18);
      lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);
      locals.push(lh, nameBuf, comp);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
      ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
      ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(comp.length, 20);
      ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);
      ch.writeUInt32LE(offset, 42);
      central.push(ch, nameBuf);
      offset += lh.length + nameBuf.length + comp.length;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, centralBuf, end]);
  }
  /** 解 zip：返回 { 相对路径: Buffer }；遇到 zip64 等不支持的特性就明确报错 */
  function readZip(buf) {
    const zlib = require('node:zlib');
    // 找中央目录结尾记录（EOCD）
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的备份包（找不到 zip 结尾记录）');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('备份包中央目录损坏');
      const method = buf.readUInt16LE(p + 10);
      const compSize = buf.readUInt32LE(p + 20);
      const rawSize = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const cmtLen = buf.readUInt16LE(p + 32);
      const localOff = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
      // 定位本地头，读出真实数据
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      let data;
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else throw new Error('备份包用了不支持的压缩方式（method=' + method + '）');
      if (name.endsWith('/')) { /* 目录项，跳过 */ }
      else out.set(name.replace(/^\.?\//, ''), data);
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  function listVaultFiles(root) {
    // 只收 .md 正文与 .neolink 元数据；跳过临时文件与索引分片（可重建）
    const out = [];
    const walk = (dir, rel, depth) => {
      if (depth > 12) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) {
          if (e.name === 'index') continue;      // 索引可重建，不进备份
          walk(abs, r, depth + 1);
        } else if (/\.md$/i.test(e.name)) {
          out.push(r);
        }
      }
    };
    walk(root, '', 0);
    return out;
  }

  /** 备份：不依赖任何三方库，用系统 tar（Windows 10+ 自带 bsdtar）打包 */
  ipcMain.handle('vault:backup', async (_e, opts = {}) => {
    try {
      if (!state.root) return { ok: false, error: '尚未打开知识库' };
      // v2.2.1：自动化环境不弹原生对话框
      if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
      const res = await dialog.showSaveDialog(win, {
        title: '备份整个知识库',
        defaultPath: path.join(path.dirname(state.root), `NeoCosmos-备份-${new Date().toISOString().slice(0, 10)}.zip`),
        filters: [{ name: '备份包', extensions: ['zip'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const stamp = new Date().toISOString();
      const files = listVaultFiles(state.root);
      // 先写清单（含每张卡片的 sha256），这样还原前能校验、还原后能核对
      const manifest = {
        format: 'neolink-backup/1',
        createdAt: stamp,
        appVersion: app.getVersion(),
        vaultName: state.store ? (getVaultEntry(vaultIdFor(state.root))?.name || path.basename(state.root)) : path.basename(state.root),
        vaultPath: state.root,
        cardCount: files.length,
        files: {},
      };
      // 打包内容：卡片正文 + 审计日志 + 清单
      const entries = [];
      for (const rel of files) {
        try {
          const buf = fs.readFileSync(path.join(state.root, rel));
          manifest.files[rel] = sha256Full(buf);
          entries.push([rel, buf]);
        } catch (e) { /* 单个文件读不到就跳过，如实反映在清单里 */ }
      }
      // 审计日志一并带走（企业合规要能回溯"谁在何时改了什么"）
      const jf = path.join(state.root, '.neolink', 'journal', 'journal.jsonl');
      if (fs.existsSync(jf)) {
        try { entries.push(['.neolink/journal/journal.jsonl', fs.readFileSync(jf)]); } catch { /* ignore */ }
      }
      entries.push([BACKUP_MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')]);
      const zipBuf = makeZip(entries);
      fs.writeFileSync(res.filePath, zipBuf);
      state.store?.journal('vault.backup', path.basename(state.root), null,
        { actor: 'user', to: res.filePath, cards: files.length }, 'user');
      return { ok: true, path: res.filePath, cards: files.length, bytes: zipBuf.length, manifest };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  /** 校验备份包：清单齐全？每张卡片哈希对得上？ */
  ipcMain.handle('vault:verifyBackup', async (_e, filePath) => {
    try {
      let p = String(filePath || '');
      if (!p) {
        // 渲染层没给路径 → 让用户选一个备份包
        // v2.2.1：自动化环境不弹原生对话框
        if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
        const r = await dialog.showOpenDialog(win, {
          title: '选择要校验的备份包',
          filters: [{ name: '备份包', extensions: ['zip'] }],
          properties: ['openFile'],
        });
        if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
        p = r.filePaths[0];
      }
      if (!p || !fs.existsSync(p)) return { ok: false, error: '备份包不存在' };
      let entries;
      try { entries = readZip(fs.readFileSync(p)); }
      catch (e) { return { ok: false, error: '无法读取备份包：' + String(e && e.message || e) }; }
      const mfBuf = entries.get(BACKUP_MANIFEST);
      if (!mfBuf) return { ok: false, error: '不是 NeoCosmos 备份包（缺少清单文件）' };
      let manifest;
      try { manifest = JSON.parse(mfBuf.toString('utf8')); }
      catch (e) { return { ok: false, error: '备份包清单已损坏' }; }
      const missing = [], changed = [];
      for (const [rel, want] of Object.entries(manifest.files || {})) {
        const data = entries.get(rel);
        if (!data) { missing.push(rel); continue; }
        if (sha256Full(data) !== want) changed.push(rel);
      }
      const ok = missing.length === 0 && changed.length === 0;
      return {
        ok, usable: ok,
        cardCount: manifest.cardCount ?? Object.keys(manifest.files || {}).length,
        createdAt: manifest.createdAt, appVersion: manifest.appVersion,
        vaultName: manifest.vaultName,
        missing: missing.slice(0, 20), missingCount: missing.length,
        changed: changed.slice(0, 20), changedCount: changed.length,
        summary: ok
          ? `校验通过：${manifest.cardCount ?? '?'} 张卡片内容与清单完全一致`
          : `校验未通过：缺失 ${missing.length} 个、内容不符 ${changed.length} 个`,
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  /** 还原：写到**新目录**，绝不覆盖现有库 —— 还原前先校验，坏了就拒绝 */
  ipcMain.handle('vault:restoreBackup', async (_e, opts = {}) => {
    try {
      let p = String(opts.filePath || '');
      if (!p) {
        // v2.2.1：自动化环境不弹原生对话框
        if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
        const r = await dialog.showOpenDialog(win, {
          title: '选择要还原的备份包',
          filters: [{ name: '备份包', extensions: ['zip'] }],
          properties: ['openFile'],
        });
        if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
        p = r.filePaths[0];
      }
      if (!p || !fs.existsSync(p)) return { ok: false, error: '备份包不存在' };
      let entries;
      try { entries = readZip(fs.readFileSync(p)); }
      catch (e) { return { ok: false, error: '无法读取备份包：' + String(e && e.message || e) }; }
      const mfBuf = entries.get(BACKUP_MANIFEST);
      if (!mfBuf) return { ok: false, error: '不是 NeoCosmos 备份包（缺少清单文件）' };
      let manifest;
      try { manifest = JSON.parse(mfBuf.toString('utf8')); }
      catch (e) { return { ok: false, error: '备份包清单已损坏' }; }
      // 还原前**必须**校验通过 —— 拿一个坏包覆盖数据，是最糟糕的结果
      const missing = [], changed = [];
      for (const [rel, want] of Object.entries(manifest.files || {})) {
        const data = entries.get(rel);
        if (!data) { missing.push(rel); continue; }
        if (sha256Full(data) !== want) changed.push(rel);
      }
      if (missing.length || changed.length) {
        return { ok: false, error: `备份包校验未通过（缺失 ${missing.length}、不符 ${changed.length}），已拒绝还原 —— 你的现有数据没有任何改动` };
      }
      // 目标目录：默认放在原库旁边，绝不覆盖
      const suggested = String(opts.targetDir || '') ||
        (state.root ? path.join(path.dirname(state.root), path.basename(state.root) + '-还原-' + new Date().toISOString().slice(0, 10)) : '');
      // v2.2.1：自动化环境不弹原生对话框（见 isAutomation 注释）
    if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
    const res = await dialog.showOpenDialog(win, {
        title: '选择还原到哪个文件夹（新建，不会覆盖现有库）',
        defaultPath: suggested || undefined,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
      const target = res.filePaths[0];
      const existing = fs.existsSync(target) && fs.readdirSync(target).filter((n) => !n.startsWith('.')).length > 0;
      if (existing) {
        return { ok: false, error: '目标文件夹非空，已拒绝还原（避免覆盖你已有的卡片）' };
      }
      fs.mkdirSync(target, { recursive: true });
      let copied = 0;
      for (const [rel, data] of entries) {
        if (rel === BACKUP_MANIFEST) continue;
        // 防目录穿越：还原出来的路径必须落在目标目录内
        const dst = path.resolve(target, rel);
        const root = path.resolve(target);
        if (dst !== root && !dst.startsWith(root + path.sep)) {
          return { ok: false, error: `备份包内含非法路径「${rel}」，已中止还原` };
        }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, data);
        copied++;
      }
      return { ok: true, target, cards: copied, vaultName: manifest.vaultName, createdAt: manifest.createdAt };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  // v6.1.3：企业版 · 合规体检报告（真实统计，基于当前打开的知识库）
  ipcMain.handle('vault:audit', (_e) => {
    try {
      const store = requireStore();
      const nodes = [...store.nodes.values()];
      const edges = [...store.edges.values()];
      const n = nodes.length, e = edges.length;
      const degree = new Map();
      for (const ed of edges) {
        degree.set(ed.source, (degree.get(ed.source) || 0) + 1);
        degree.set(ed.target, (degree.get(ed.target) || 0) + 1);
      }
      let orphans = 0; const layers = {}; const titles = new Map();
      const ids = new Set(), titleSet = new Set();
      for (const nd of nodes) {
        ids.add(nd.id);
        if (nd.title) { titleSet.add(nd.title); titles.set(nd.title, (titles.get(nd.title) || 0) + 1); }
        if ((degree.get(nd.id) || 0) === 0) orphans++;
        const layer = nd.memory_layer || 'semantic';
        layers[layer] = (layers[layer] || 0) + 1;
      }
      let dangling = 0, linkCount = 0;
      for (const nd of nodes) {
        for (const t of (nd.links || [])) { linkCount++; if (!ids.has(t) && !titleSet.has(t)) dangling++; }
      }
      let dupTitles = 0; for (const [, c] of titles) if (c > 1) dupTitles += (c - 1);
      const avgDegree = n ? (2 * e / n) : 0;
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        vaultName: state.root ? path.basename(state.root) : '',
        vaultPath: state.root || '',
        totalCards: n, totalSynapses: e,
        avgDegree: +avgDegree.toFixed(2),
        orphanCards: orphans, orphanRate: +(orphans / (n || 1) * 100).toFixed(1),
        danglingLinks: dangling, totalLinks: linkCount,
        duplicateTitles: dupTitles,
        crossLinks: (store.crossLinks || []).length,
        reviewItems: (store.reviewItems || []).length,
        layers,
      };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // v6.1.3：企业版 · 批量导入文件夹（真实写入当前库，复用 KbStore.upsertNodeFromFile）
  ipcMain.handle('vault:importFolder', async (_e, opts = {}) => {
    try {
      const store = requireStore();
      if (isAutomation()) return { ok: false, canceled: true, dryRun: true };
      let dir = String(opts.dir || '');
      if (!dir) {
        const res = await dialog.showOpenDialog(win, {
          title: '选择要批量导入的文件夹',
          defaultPath: state.root ? path.dirname(state.root) : undefined,
          properties: ['openDirectory', 'createDirectory'],
        });
        if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
        dir = res.filePaths[0];
      }
      if (!dir || !fs.existsSync(dir)) return { ok: false, error: '文件夹不存在' };
      const files = [];
      const walk = (d, depth) => {
        if (depth > 12) return;
        let entries = []; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const en of entries) {
          const abs = path.join(d, en.name);
          if (en.isDirectory()) { if (en.name === 'index' || en.name.startsWith('.') || en.name === 'archive') continue; walk(abs, depth + 1); }
          else if (/\.md$/i.test(en.name)) files.push(abs);
        }
      };
      walk(dir, 0);
      let imported = 0, skipped = 0;
      for (const abs of files) {
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        try { store.upsertNodeFromFile(abs, rel, fs.statSync(abs)); imported++; } catch { skipped++; }
      }
      store.save();
      try { await state.engine.indexVault(store); } catch { /* 索引失败不阻断导入结果 */ }
      state.graphCache = null; state.graphCacheKey = null;
      return { ok: true, dir, imported, skipped, total: files.length, vaultName: state.root ? path.basename(state.root) : '' };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  ipcMain.handle('doc:relations', (_e, id, opts) => wrap(() => relations(id, opts)));  ipcMain.handle('doc:resolve', (_e, title) => wrap(() => {
    const store = requireStore();
    const n = state.engine.findLinkTarget(store, title);
    return n ? { id: n.id, title: n.title, path: n.path } : null;
  }));
  ipcMain.handle('sediment:list', (_e, n) => wrap(() => sedimentList(n)));
  ipcMain.handle('consolidate:run', () => wrap(() => runConsolidation()));
  ipcMain.handle('synapse:derive', (_e, opts) => wrap(() => {
    const store = requireStore();
    const r = state.engine.derive.deriveSynapses(store, opts || {});
    store.save();
    state.graphCache = null; state.graphCacheKey = null;
    return { ...r, vault: vaultInfo() };
  }));

  ipcMain.handle('app:openExternal', (_e, url) => { shell.openExternal(url); return true; });
}

// ---------------- 协议服务 ----------------
function serveNeokb() {
  protocol.handle('neolink', async (req) => {
    const url = new URL(req.url);
    // neolink://open/<库ID>/<卡片ID> —— 深链：应用外壳 + 深链参数
    // 渲染层启动时从 location 解析出库/卡片并跳转，跨应用也能直接唤起某张卡片。
    //
    // v2.2.0 修复：此分支原先直接回 index.html，但页面里的相对引用（./app.js、
    // ./styles.css、./assets/brand.svg）会以 neolink://open/<库ID>/ 为基准解析，
    // 落到 open 这个 host 上 —— 而 open 分支只会回 index.html，于是脚本被当成
    // HTML 载入，应用起不来。改用 302 跳到 neolink://app/：既让相对路径与
    // CSP 'self' 都留在同一 origin（neolink://app），又把深链参数用查询串带走
    // （<base> 会让 location.pathname 不可依赖，location.search 不受影响）。
    // neolink://verify/<库ID>/<节点ID>?s=<片段> —— 引用验证溯源深链：
    // 应用外壳 + 深链参数走 302 到 neolink://app/（与 open 同源处理，相对路径与 CSP 同 origin）。
    if (url.host === 'verify') {
      const seg = decodeURIComponent(url.pathname || '/').replace(/^\/+/, '').split('/');
      const vaultId = seg[0] || '';
      const nodeId = seg.slice(1).join('/') || '';
      const snippet = url.searchParams.get('s') || '';
      const to = `neolink://app/index.html?vaultId=${encodeURIComponent(vaultId)}&cardId=${encodeURIComponent(nodeId)}&verify=1&snippet=${encodeURIComponent(snippet)}`;
      return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-cache' } });
    }
    if (url.host === 'open') {
      const seg = decodeURIComponent(url.pathname || '/').replace(/^\/+/, '').split('/');
      const vaultId = seg[0] || '';
      const cardId = seg.slice(1).join('/') || '';
      const to = `neolink://app/index.html?vaultId=${encodeURIComponent(vaultId)}&cardId=${encodeURIComponent(cardId)}`;
      return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-cache' } });
    }
    // neolink://vault/<rel> —— 当前知识库内的图片等静态资源（严格沙箱 + 白名单）
    if (url.host === 'vault') {
      if (!state.store) return new Response('no vault', { status: 503 });
      try {
        const rel = decodeURIComponent(url.pathname || '/').replace(/^\/+/, '');
        const abs = state.store.resolver.resolve(rel);
        const ext = path.extname(abs).toLowerCase();
        if (!VAULT_MIME[ext]) return new Response('forbidden type', { status: 403 });
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > VAULT_FILE_MAX) return new Response('too large', { status: 413 });
        const buf = fs.readFileSync(abs);
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { 'content-type': VAULT_MIME[ext], 'cache-control': 'no-cache' },
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }
    let rel = decodeURIComponent(url.pathname || '/');
    if (rel === '/' || rel === '') rel = '/index.html';
    // v2.2.0：品牌资源（brand.svg 等）位于 resources/app/assets，
    // 而页面根是 resources/app/ui —— 二者不同级。原先没有这条路由，
    // 标题栏的原创品牌标记加载不到，渲染成"破图"。
    if (rel.startsWith('/assets/')) {
      const name = rel.slice('/assets/'.length);
      // v6.18.0 修复：此前只放行「单级文件名 + 图片/svg/ico」，随包分发的
      // NotoSansSC-VF.ttf / NotoSerifSC-VF.ttf 一律 403 —— 中文被迫回退系统字体，
      // 字重与行高在不同机器上漂移。现在放行字体类型与 fonts/ 子目录，
      // 同时用严格字符白名单 + 真实路径前缀双重校验挡住目录穿越。
      const safeName = /^(?:fonts\/)?[\w.\-]+$/.test(name);
      if (!safeName) return new Response('forbidden', { status: 403 });
      const ext = path.extname(name).toLowerCase();
      const allowed = !!VAULT_MIME[ext] || ['.svg', '.png', '.ico', '.ttf', '.otf', '.woff', '.woff2'].includes(ext);
      if (!allowed) return new Response('forbidden type', { status: 403 });
      const assetsRoot = path.join(APP_ROOT, 'assets');
      const abs = path.join(assetsRoot, name);
      if (!abs.startsWith(assetsRoot + path.sep)) return new Response('forbidden', { status: 403 });
      try {
        const buf = fs.readFileSync(abs);
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' },
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }
    let abs = path.join(UI_DIR, rel.replace(/^\/+/, ''));
    const inRoot = abs === UI_DIR || abs.startsWith(UI_DIR + path.sep);
    if (!inRoot) abs = path.join(UI_DIR, 'index.html');
    try {
      const buf = fs.readFileSync(abs);
      const ext = path.extname(abs).toLowerCase();
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ---------------- 运行时 UI 审计（构建前质量闸门） ----------------
// 目的：用真实渲染进程量化"显示问题 / 死点击 / 虚构值"，杜绝肉眼漏检。
// 脚本由外部路径注入（NEOLINK_AUDIT_SCRIPT），正式客户端不携带，零影响。
async function runAudit() {
  mark('audit-start');
  let report = null, fatal = null;
  try {
    const code = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
    report = await win.webContents.executeJavaScript(code, true);
  } catch (e) {
    fatal = String(e && e.message || e);
  }
  const payload = JSON.stringify({ fatal, report, rendererErrors: rendererErrors.slice(0, 20) }, null, 2);
  console.log('AUDIT_RESULT ' + payload);
  for (const d of DIAG_FILES) {
    try { fs.writeFileSync(d.replace(/diag\.json$/, 'audit.json'), payload, 'utf8'); } catch { /* ignore */ }
  }
  mark('audit-done');
  app.exit(fatal ? 1 : 0);
}

// ---------------- 深链端到端验证探针 ----------------
// 目的：验证 neolink:// 深链在**真实客户端**里确实能跳到目标卡片。
// 这类缺陷静态审计查不出（代码都在、语法都对、IPC 都通），只有真的
// 带 URL 启动一次客户端才暴露。由 tools/e2e-deeplink.mjs 注入。
async function runProbe() {
  mark('probe-start');
  let report = null, fatal = null;
  try {
    const code = fs.readFileSync(PROBE_SCRIPT, 'utf8');
    report = await win.webContents.executeJavaScript(code, true);
  } catch (e) {
    fatal = String(e && e.message || e);
  }
  // v2.2.3：探针跑完后**可选截图**（NEOLINK_PROBE_SHOT = 落盘路径）。
  //
  // 为什么要有这个：验证"星图排版对不对"这类**视觉**结论，
  // 光看探针返回的数字不够 —— 标签挤不挤、密不密、有没有压住面板，
  // 数字说不了算，必须真的看一眼。
  //
  // 用 win.webContents.capturePage() 而不是屏幕截图：
  // 它直接从渲染层取画面，**不受其他窗口遮挡**，也不需要动用户的窗口。
  let shotPath = null;
  const shotTarget = String(process.env.NEOLINK_PROBE_SHOT || '');
  if (shotTarget && !fatal) {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(shotTarget, img.toPNG());
      shotPath = shotTarget;
    } catch (e) {
      fatal = fatal || ('capturePage 失败：' + String((e && e.message) || e));
    }
  }
  const payload = {
    fatal, report, shotPath,
    rendererErrors: rendererErrors.slice(0, 20),
    // 主进程侧的证据：argv 里是否真的扫到了深链
    deepLinkFromArgv: (() => {
      for (const a of process.argv.slice(1)) { if (parseDeepLink(a)) return parseDeepLink(a); }
      return null;
    })(),
  };
  try {
    if (PROBE_RESULT) fs.writeFileSync(PROBE_RESULT, JSON.stringify(payload, null, 2), 'utf8');
  } catch { /* ignore */ }
  console.log('PROBE_RESULT ' + JSON.stringify(payload, null, 2));
  mark('probe-done');
  app.exit(fatal ? 1 : 0);
}

// ---------------- 自检（--smoke）：无人工操作时验证渲染层与引擎联通 ----------------
async function runSmoke() {
  mark('smoke-start');
  const script = `(async () => {
    const out = { hasApi: !!window.neolink, hasShell: !!window.__NEOLINK__, errors: [] };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // v2.1.0：分步计时 —— 百万级库上必须知道时间花在哪一步，否则自检只会"超时"二字。
    // 每步实时回传主进程落盘，即便整体超时也能看到已完成到哪一段。
    const marks = {};
    let _last = performance.now();
    const mk = (name) => {
      const n = performance.now();
      marks[name] = Math.round(n - _last);
      _last = n;
      try { window.neolink?.diagMark?.(name, marks[name]); } catch (e) { /* ignore */ }
    };
    try { const i = await window.neolink.init(); out.vault = { ready: i.vault?.ready, nodes: i.vault?.nodes, edges: i.vault?.edges }; }
    catch (e) { out.errors.push('init: ' + (e && e.message || e)); }
    mk('init');
    // v2.1.0：大库（>2 万卡）跳过"注入示例语料 / 突触推导"—— 那是小库功能，
    // 在百万级库上既会污染语料又会把自检拖到分钟级。这里只验证客户端能加载、能检索、能渲染。
    const BIG = (out.vault?.nodes || 0) > 20000;
    out.bigVault = BIG;
    try { const g = await window.neolink.graph({}); out.graph = { nodes: g.nodes.length, edges: g.edges.length }; }
    catch (e) { out.errors.push('graph: ' + (e && e.message || e)); }
    mk('graph');
    try { const t = await window.neolink.doc.tree(); out.tree = t.ok ? { files: (t.data.files || []).length, dirs: (t.data.dirs || []).length } : { err: t.error }; }
    catch (e) { out.errors.push('tree: ' + (e && e.message || e)); }
    mk('tree');
    if (BIG) {
      out.example = { skipped: '大库不注入示例语料' };
    } else {
      // v2.2.1：**自检绝不往用户的库里写东西**。
      //
      // 实测踩到的坑：这里原本直接调 vault.loadExample()，
      // 那会把 55 张演示卡片**写进用户当前打开的真实知识库**
      // （_memory/semantic/示例/）。自检每跑一次就污染一次，
      // 而用户完全不知情 —— 直到卡片数对不上才发现。
      //
      // 现在改成**只读校验**：确认示例语料源存在、且解析器能处理它，
      // 但一个字节都不往用户的库里写。
      // 真正需要验证写入路径的，用临时库（见 tools/ 下的 e2e 脚本）。
      try {
        const ex = await window.neolink.vault.exampleInfo();
        out.example = { available: ex.available, corpus: ex.count, note: '只读校验，未写入用户库' };
      } catch (e) { out.errors.push('exampleInfo: ' + (e && e.message || e)); }
    }

    // 突触推导：让没有双链的库长出关系
    if (BIG) {
      out.derive = { skipped: '大库跳过推导' };
    } else {
      try {
        const t0 = performance.now();
        const d = await window.neolink.derive({});
        out.derive = d.ok
          ? { total: d.data.total, added: d.data.added, ms: Math.round(performance.now() - t0), edges: d.data.vault?.edges }
          : { err: d.error };
      } catch (e) { out.errors.push('derive: ' + (e && e.message || e)); }
    }

    // 多知识库：注册表可用
    try {
      const l = await window.neolink.vault.list();
      out.registry = l.ok ? { count: l.data.vaults.length, active: l.data.activeId } : { err: l.error };
    } catch (e) { out.errors.push('vaultList: ' + (e && e.message || e)); }

    // 工作区三栏是否真的渲染出内容
    await sleep(1200);
    out.workspace = {
      cards: document.querySelectorAll('.tree-file').length,
      docTitle: (document.querySelector('.doc-title') || {}).textContent || null,
      md: document.querySelectorAll('.doc-body .md-p, .doc-body .md-h1, .doc-body .md-h2').length,
      links: document.querySelectorAll('.doc-body .md-link').length,
      relCards: document.querySelectorAll('.rel-card').length,
    };

    // 文档读取 + 关联卡片（大库跳过：300 万条边上的邻接索引构建 + 2 万行卡片树渲染）
    if (BIG) {
      out.doc = { skipped: '大库跳过文档读取' };
      out.rel = { skipped: '大库跳过关联面板' };
    } else {
      try {
        const id = window.__NEOLINK__.app.currentId;
        if (id) {
          const d = await window.neolink.doc.read(id);
          out.doc = d.ok ? { title: d.data.title, outline: (d.data.outline || []).length, links: (d.data.links || []).length } : { err: d.error };
          const r = await window.neolink.doc.relations(id, {});
          out.rel = r.ok ? { degree: r.data.degree, groups: Object.keys(r.data.groups || {}), broken: (r.data.broken || []).length } : { err: r.error };
        }
      } catch (e) { out.errors.push('doc: ' + (e && e.message || e)); }
    }
    mk('doc');

    // 星图（3D 管理网络）
    try {
      window.__NEOLINK__.app.graph = null;
      await window.__NEOLINK__.route('graph');
      await sleep(3500);
      out.canvas = document.querySelectorAll('#cosmosRoot canvas').length;
      out.graphCard = !!document.querySelector('.graph-card');
      // v2.0.0：知识库名称必须出现在星图上（渲染层锚点 + HUD 卡片）
      out.starMap = {
        kbOnCanvas: (document.querySelector('.cosmos-kb .kb-name') || {}).textContent || null,
        kbMeta: (document.querySelector('.cosmos-kb .kb-meta') || {}).textContent || null,
        kbInHud: (document.querySelector('.graph-hud .kb-name span:last-child') || {}).textContent || null,
        viewModes: document.querySelectorAll('.view-modes .vm-btn:not(.lv-btn)').length,
        levelModes: document.querySelectorAll('.lv-btn').length,
        levelNote: (document.querySelector('.level-note') || {}).textContent || null,
        domainRows: document.querySelectorAll('.domain-row').length,
        canvasDomainLabels: document.querySelectorAll('.cosmos-domain').length,
        canvasNodeLabels: document.querySelectorAll('.cosmos-label').length,
      };
      // v2.1.0：标签必须真的能点（此前 CSS2D 层 pointer-events:none + 事件从未绑定）
      try {
        const lab = document.querySelector('.cosmos-label');
        const dom = document.querySelector('.cosmos-domain');
        out.labelClick = {
          labelPE: lab ? getComputedStyle(lab).pointerEvents : null,
          domainPE: dom ? getComputedStyle(dom).pointerEvents : null,
          labelCursor: lab ? getComputedStyle(lab).cursor : null,
        };
        if (lab) {
          const before = (document.querySelector('.graph-card .gc-title') || {}).textContent || null;
          lab.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await sleep(500);
          const after = (document.querySelector('.graph-card .gc-title') || {}).textContent || null;
          out.labelClick.clicked = after !== before || !!after;
          out.labelClick.after = after;
        }
        if (dom) {
          dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          await sleep(400);
          out.labelClick.domainFocus = document.querySelectorAll('.domain-row.is-focus').length;
        }
      } catch (e) { out.errors.push('label-click: ' + (e && e.message || e)); }
      // 切到多库星系视图，确认结构标签重建
      const mk = document.querySelector('.view-modes .vm-btn:not(.lv-btn)[title*="多库"]')
        || Array.from(document.querySelectorAll('.view-modes .vm-btn:not(.lv-btn)')).pop();
      if (mk) { mk.click(); await sleep(900); out.starMap.afterModeSwitch = (document.querySelector('.cosmos-kb .kb-name') || {}).textContent || null; }
    } catch (e) { out.errors.push('graph-view: ' + (e && e.message || e)); }

    // 团队页（v2.0.0：修复了缺失的 viewTeam 路由）
    try {
      await window.__NEOLINK__.route('team'); await sleep(500);
      out.team = document.querySelectorAll('#viewTeam .card').length;
      await window.__NEOLINK__.route('workspace'); await sleep(300);
    } catch (e) { out.errors.push('team-view: ' + (e && e.message || e)); }

    // 个人版 / 企业版双模（v2.0.0）
    try {
      const eb = document.querySelector('#editionSeg button[data-edition="enterprise"]');
      if (eb) {
        eb.click(); await sleep(300);
        const rail = document.getElementById('railItemEnterprise');
        // v6.7.0：企业管理是导航轨里正规的一页（企业版才显示），不再有折叠浮层
        out.edition = {
          switched: document.body.classList.contains('edition-enterprise'),
          enterpriseRailVisible: rail ? getComputedStyle(rail).display !== 'none' : false,
        };
        // 企业管理页应可正常进入并渲染分组卡片
        try {
          await window.__NEOLINK__.route('enterprise'); await sleep(400);
          out.edition.hubCards = document.querySelectorAll('#viewEnterprise .hub-link').length;
        } catch (e) { out.errors.push('enterprise-hub: ' + (e && e.message || e)); }
        const pb = document.querySelector('#editionSeg button[data-edition="personal"]');
        if (pb) { pb.click(); await sleep(200); }
        out.edition.backToPersonal = !document.body.classList.contains('edition-enterprise');
        out.edition.enterpriseRailHiddenInPersonal = rail ? getComputedStyle(rail).display === 'none' : false;
      }
    } catch (e) { out.errors.push('edition: ' + (e && e.message || e)); }

    // 侧栏最小化（v2.1.0：此前 .pane.is-hidden 是一条无人 toggle 的悬空规则）
    try {
      await window.__NEOLINK__.route('workspace'); await sleep(500);
      const ws = document.getElementById('viewWorkspace');
      // 折叠状态是记在本地里的，上一次会话（乃至上一次截图流程）可能已把它折叠。
      // 测试必须从**展开态**起步，否则点"最小化"没反应、判定全错。
      const restore0 = document.getElementById('restoreLeft');
      if (ws && ws.classList.contains('pane-no-left') && restore0) {
        restore0.click(); await sleep(400);
      }
      const leftBefore = getComputedStyle(document.getElementById('paneLeft')).display;
      const btn = document.querySelector('#paneLeft .mini-hide');
      let collapsed = false, restored = false, handleVisible = false;
      if (btn && ws) {
        btn.click(); await sleep(400);
        collapsed = ws.classList.contains('pane-no-left');
        const h = document.getElementById('restoreLeft');
        handleVisible = h ? getComputedStyle(h).display !== 'none' : false;
        const leftAfter = getComputedStyle(document.getElementById('paneLeft')).display;
        // 再点贴边把手还原
        if (h) { h.click(); await sleep(400); }
        restored = !ws.classList.contains('pane-no-left');
        out.paneCollapse = { leftBefore, leftAfter, collapsed, handleVisible, restored };
      } else {
        out.paneCollapse = { err: '未找到最小化按钮', collapsed, restored };
      }
    } catch (e) { out.errors.push('pane-collapse: ' + (e && e.message || e)); }

    // 沉淀 / 巩固 / 体系（大库跳过：这几页要渲染与全库规模相关的面板）
    if (BIG) {
      out.settle = { skipped: '大库跳过' };
      out.atlas = { skipped: '大库跳过' };
      out.backToWorkspace = { skipped: '大库跳过' };
    } else {
      try {
        await window.__NEOLINK__.route('settle'); await sleep(400);
        out.settle = document.querySelectorAll('.card').length;
        await window.__NEOLINK__.route('atlas'); await sleep(400);
        out.atlas = document.querySelectorAll('.card').length;
        await window.__NEOLINK__.route('workspace'); await sleep(300);
        out.backToWorkspace = document.querySelectorAll('.tree-file').length;
      } catch (e) { out.errors.push('routes: ' + (e && e.message || e)); }
    }
    mk('views');

    try {
      // v2.1.0：自适应检索词。示例语料里是"商业秘密 反向工程"，
      // 而合成压测语料里每张卡片都写"本卡片属于「X」领域" —— 只有"卡片"能命中。
      // 先试示例词，零命中再试合成词，两轮都记进报告。
      const queries = BIG ? ['卡片', '领域'] : ['商业秘密 反向工程', '卡片'];
      let last = null;
      for (const q of queries) {
        const s = await window.neolink.search({ query: q, top_k: 5 });
        last = { query: q, ok: s.ok, hits: s.ok ? (s.data.results || []).length : 0, err: s.error };
        if (last.hits > 0) break;
      }
      out.search = last;
    }
    catch (e) { out.errors.push('search: ' + (e && e.message || e)); }
    mk('search');
    out.marks = marks;
    return out;
  })()`;
  const report = { fatal: null, diag: null };
  try {
    report.diag = await win.webContents.executeJavaScript(script, true);
  } catch (e) {
    diagError('executeJavaScript', e);
    report.fatal = String(e && e.message || e);
  }
  if (report.diag) report.diag.rendererErrors = rendererErrors.slice(0, 15);
  // v2.1.0：报告主进程堆上限（百万级语料需要 4GB，低于此值会在加载途中 OOM）
  try {
    const v8 = require('node:v8');
    const hs = v8.getHeapStatistics();
    report.heap = {
      limitMB: Math.round(hs.heap_size_limit / (1024 * 1024)),
      usedMB: Math.round(hs.used_heap_size / (1024 * 1024)),
      totalMB: Math.round(hs.total_heap_size / (1024 * 1024)),
      rssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      capMB: heapCapMB(),
      targetMB: heapTargetMB(state.store ? state.store.nodes.size : 0),
      relaunched: process.env[HEAP_RELAUNCH_ENV] === '1',
      argv: process.argv.slice(1).join(' '),
      node: process.versions.node,
      electron: process.versions.electron,
    };
  } catch (e) { report.heap = { err: String(e && e.message || e) }; }
  DIAG.smoke = report;
  DIAG.rendererErrors = rendererErrors.slice(0, 20);

  // 先落盘自检报告（即便随后走截图分支退出，报告也必须留下）
  const payload = JSON.stringify(report, null, 2);
  for (const d of DIAG_FILES) {
    try { fs.writeFileSync(d.replace(/diag\.json$/, 'smoke.json'), payload, 'utf8'); } catch { /* ignore */ }
  }

  // 渲染稳定后抓一张图，便于人工核验视觉效果
  if (process.env.NEOLINK_SHOT) {
    const shotWs = path.join(app.getPath('userData'), 'neolink-shot.png');
    const shotGr = path.join(app.getPath('userData'), 'neolink-shot-graph.png');
    const shotCol = path.join(app.getPath('userData'), 'neolink-shot-collapsed.png');
    const shotVaults = path.join(app.getPath('userData'), 'neolink-shot-vaults.png');
    const shotDark = path.join(app.getPath('userData'), 'neolink-shot-dark.png');
    const shotDiag = { steps: [], errors: [] };
    /**
     * 切页并收敛 DOM 状态。
     * 只调 route() 不够：.deck-view 是 position:absolute 的兄弟节点，
     * 只要有一个残留 is-active，它就会盖在目标视图上（截图串页）。
     * 这里显式把 is-active 收敛到唯一目标，并记录实际生效的视图 —— 诊断与截图同源。
     */
    const go = async (key, hostId, innerWait, afterWait) => {
      let info = null;
      try {
        info = await win.webContents.executeJavaScript(`(async () => {
          await window.__NEOLINK__.route(${JSON.stringify(key)});
          await new Promise(r => setTimeout(r, ${Number(innerWait) || 0}));
          const want = ${JSON.stringify(hostId)};
          for (const el of document.querySelectorAll('.deck-view')) {
            el.classList.toggle('is-active', el.id === want);
          }
          for (const b of document.querySelectorAll('.rail-item')) {
            b.classList.toggle('is-active', b.dataset.view === ${JSON.stringify(key)});
          }
          await new Promise(r => setTimeout(r, 250));
          return {
            key: ${JSON.stringify(key)},
            active: [...document.querySelectorAll('.deck-view.is-active')].map(e => e.id),
            rail: [...document.querySelectorAll('.rail-item.is-active')].map(e => e.dataset.view),
            canvas: document.querySelectorAll('#cosmosWrap canvas, #viewGraph canvas').length,
          };
        })()`, true);
      } catch (e) { info = { key, err: String((e && e.message) || e) }; }
      shotDiag.steps.push(info || { key, err: 'no info' });
      if (info && info.err) shotDiag.errors.push(`${key}: ${info.err}`);
      await new Promise((r) => setTimeout(r, Number(afterWait) || 0));
      return info;
    };
    setTimeout(async () => {
      try {
        await go('workspace', 'viewWorkspace', 500, 1200);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shotWs, img.toPNG());
        DIAG.screenshot = shotWs;
      } catch (e) { diagError('captureWorkspace', e); shotDiag.errors.push('ws: ' + e); }
      try {
        // 星图：three.js 需要时间起帧，多等
        await go('graph', 'viewGraph', 3000, 4500);
        const img2 = await win.webContents.capturePage();
        fs.writeFileSync(shotGr, img2.toPNG());
        DIAG.screenshotGraph = shotGr;
      } catch (e) { diagError('captureGraph', e); shotDiag.errors.push('gr: ' + e); }
      // v2.2.1：左栏「全部库」视图留证 —— 新增的跨库目录树需要可视化核对
      try {
        await go('workspace', 'viewWorkspace', 500, 800);
        await win.webContents.executeJavaScript(`(async () => {
          const b = [...document.querySelectorAll('.nav-scope-btn')].find(x => x.textContent.trim() === '全部库');
          if (b) b.click();
          await new Promise(r => setTimeout(r, 4500));
          return true;
        })()`, true);
        const imgAll = await win.webContents.capturePage();
        const shotAll = path.join(app.getPath('userData'), 'neolink-shot-allvaults.png');
        fs.writeFileSync(shotAll, imgAll.toPNG());
        DIAG.screenshotAllVaults = shotAll;
      } catch (e) { diagError('captureAllVaults', e); shotDiag.errors.push('all: ' + e); }
      // v2.1.0：左栏最小化态单独留证（用户报告的 bug，需要可视化对照）
      try {
        await go('workspace', 'viewWorkspace', 500, 600);
        await win.webContents.executeJavaScript(`(() => {
          const b = document.querySelector('#paneLeft .mini-hide');
          if (b) b.click();
          return true;
        })()`, true);
        await new Promise((r) => setTimeout(r, 1200));
        const img3 = await win.webContents.capturePage();
        fs.writeFileSync(shotCol, img3.toPNG());
        DIAG.screenshotCollapsed = shotCol;
      } catch (e) { diagError('captureCollapsed', e); shotDiag.errors.push('co: ' + e); }
      // v2.2.0：企业版「库管理」页（跨库图谱 + 链接 API）
      try {
        await win.webContents.executeJavaScript(`(() => {
          document.body.classList.add('edition-enterprise');
          const seg = document.getElementById('editionSeg');
          if (seg) for (const b of seg.querySelectorAll('button')) b.classList.toggle('is-on', b.dataset.edition === 'enterprise');
          return true;
        })()`, true);
        await go('vaults', 'viewVaults', 2200, 1400);
        const img4 = await win.webContents.capturePage();
        fs.writeFileSync(shotVaults, img4.toPNG());
        DIAG.screenshotVaults = shotVaults;
      } catch (e) { diagError('captureVaults', e); shotDiag.errors.push('va: ' + e); }
      // v2.2.0：深色主题下的工作区（双主题都要看，不能只验浅色）
      try {
        await win.webContents.executeJavaScript(`(() => {
          document.body.classList.remove('edition-enterprise');
          document.body.classList.add('theme-dark');
          return true;
        })()`, true);
        await go('workspace', 'viewWorkspace', 900, 1200);
        const img5 = await win.webContents.capturePage();
        fs.writeFileSync(shotDark, img5.toPNG());
        DIAG.screenshotDark = shotDark;
      } catch (e) { diagError('captureDark', e); shotDiag.errors.push('dk: ' + e); }
      try {
        fs.writeFileSync(path.join(app.getPath('userData'), 'neolink-shot.json'),
          JSON.stringify(shotDiag, null, 2), 'utf8');
      } catch { /* ignore */ }
      mark('smoke-done');
      app.exit(0);
    }, 2500);
    return;
  }
  mark('smoke-done');
  console.log('SMOKE_RESULT ' + payload);
  app.exit(0);
}

// ---------------- 生命周期 ----------------
async function bootstrap() {
  mark('bootstrap');
  // v2.2.0：冷启动时若由 neolink:// 深链唤起，URL 在 argv 里 —— 先收下，
  // 渲染层启动后自己来取（link:takeDeepLink）。此前这条路径完全没接，
  // 导致「应用未运行时点深链」只打开应用、不跳卡片。
  const argvDeepLink = scanArgvDeepLink();
  if (argvDeepLink) { pendingDeepLink = argvDeepLink; mark('deep-link-from-argv', argvDeepLink); }
  // v2.1.0：先判断本次是否需要更大 V8 堆（百万级语料），需要则带 --js-flags 重启自己
  if (maybeRelaunchForBigVault()) return;
  serveNeokb();
  mark('protocol-ready');
  // v10.18.7：冷启动即发布外部检索白名单 —— MCP 进程可能在客户端之前被宿主拉起，
  // 此刻必须有真源可查；停用的库从第一帧起就不对外部 AI 可见。
  publishEnabledVaults(readRegistry());
  // v6.3.0：认知内核在窗口创建前就绪（不依赖 openVault，空库也能看 3D 智脑状态）
  state.engine = await loadEngine();
  initOrganism();
  startAstraHeart();      // v6.11：自主意识常驻心跳，与知识库是否打开无关
  qsBootstrap();          // v6.2.0：完整性基线 + 反调试自检（异常降级，不阻断启动）
  registerIpc();
  createWindow();
  // v6.41.0：桌面精灵已移除，冷启动不再自动唤起任何悬浮窗。
  bootstrapped = true;
  // 启动过程中若已有人双击过图标，此刻协议 / IPC 都就绪，补上聚焦/重建。
  if (pendingFocus) { pendingFocus = false; ensureMainWindow(); }
  if (SMOKE) setTimeout(() => { if (DIAG.stage !== 'smoke-done') { DIAG.errors.push('smoke 超时未完成，stage=' + DIAG.stage); mark('smoke-timeout'); app.exit(1); } }, 420000);
  // 审计超时：v2.2.0 起审计覆盖的元素从 8 个涨到 230+（专家模式打开后
  // 左栏整块纳入探测），耗时随之上涨 —— 180s 不够用，这里放宽到 900s。
  if (AUDIT_SCRIPT && !SMOKE) setTimeout(() => { if (DIAG.stage !== 'audit-done') { DIAG.errors.push('audit 超时未完成，stage=' + DIAG.stage); mark('audit-timeout'); app.exit(1); } }, 900000);
}

app.whenReady().then(bootstrap).catch((e) => diagError('whenReady', e));

app.on('second-instance', (_e, argv) => {
  // v2.2.0：第二次启动若带深链，交给当前窗口跳转
  for (const a of (argv || [])) { if (dispatchDeepLink(a)) break; }
  // v6.12：已存在实例时（无论主窗口是否曾被关闭），确保主窗口恢复/重建并聚焦；
  // 以往仅 `if (win) {...}`，win 为 null 时什么都不做 → 双击图标「无窗口、点不开」。
  ensureMainWindow();
  // v6.41.0：桌面精灵已移除，second-instance 仅恢复/聚焦主窗口。
});
app.on('window-all-closed', () => {
  // v6.41.0：桌面精灵已移除，主窗口关闭即退出（显式退出走 window:close-reply）。
  app.quit();
});
// v6.13：macOS dock / 系统重新激活时只恢复主窗口。
// 旧实现调用 bootstrap() 会**重复注册整套 ipcMain.handle**，抛
// "Attempted to register a second handler" 并可能连带重跑引擎加载；
// 这与「退出后双击打不开」同属生命周期缺陷，一并收口到 ensureMainWindow()。
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) ensureMainWindow(); });

process.on('uncaughtException', (e) => { diagError('uncaught', e); console.error('[uncaught]', e); });
process.on('unhandledRejection', (e) => { diagError('unhandled', e); console.error('[unhandled]', e); });
