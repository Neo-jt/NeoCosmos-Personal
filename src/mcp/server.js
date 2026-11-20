// NeoCosmos MCP Server · stdio 传输层（v6.18.0）
// ---------------------------------------------------------------------------
// 职责边界：本文件只负责「进程生命周期 + 逐行 JSON-RPC 帧 + 日志」；
// 协议语义全部在 protocol.js，工具契约在 tools.js，宿主配置在 hosts.js。
// 三者都能在没有终端的环境里被独立验证。
//
// 支持宿主：OpenClaw（一等公民）/ WorkBuddy / AutoClaw / Claude Desktop /
//           以及任何实现了 stdio MCP 的通用客户端。
//
// 安全边界：stdio 通道一律视为外部 Agent —— canWriteBody 恒为 false，
// 不接受 --caller ui / api 之类的自报提权。桌面客户端走进程内 IPC（caller=ui），
// 不经过本进程。外部 Agent 只能检索、读取、在 _memory/ 沉淀区追加新文件。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KbStore, indexVault } from '../storage/store.js';
import { listTools } from './tools.js';
import { createProtocolHandler, createTelemetry, DEFAULT_PROTOCOL_VERSION, PROTOCOL_VERSIONS } from './protocol.js';
import { buildHostConfig, printHostConfig, HOST_IDS, SERVER_PATH } from './hosts.js';
// v6.23.1：把「本会话由哪个外部平台拉起」登记到两端共用的连接表，
// 并让用户在桌面端设置的暂停 / 禁用 / 断开在本进程真实生效。
import { createLinkSession, resolveActiveVault, isVaultExternallyEnabled, readEnabledVaults } from './link-bridge.js';
// v6.31.0：本地领域语言模型（真实训练权重、按行只读）。让外部平台经 MCP
// 调用的工具也能用到真实语义信号；模型不可用时一律优雅降级，绝不影响既有能力。
import { createNeoLM } from '../cognition/neolm/runtime.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/**
 * 模型目录兼容两种形态：
 *   打包态 resources/app/assets/_model/neolm；源码态 仓库/desktop/assets/_model/neolm。
 * 找不到 manifest 就返回 null（ctx.neolm 为 null，kb_server_status 如实标注不可用）。
 */
function loadNeoLM() {
  for (const dir of [
    path.join(ROOT, 'assets', '_model', 'neolm'),
    path.join(ROOT, 'desktop', 'assets', '_model', 'neolm'),
  ]) {
    if (!fs.existsSync(path.join(dir, 'neolm.manifest.json'))) continue;
    try {
      const inst = createNeoLM({ dir });
      if (inst?.active) return inst;
    } catch { /* 校验失败：尝试下一个候选，最终如实降级 */ }
  }
  return null;
}

/** 版本单一真源：桌面版 package.json；根 package.json 为历史兼容回落 */
function productVersion() {
  for (const rel of ['desktop/package.json', 'package.json']) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      if (pkg.version) return pkg.version;
    } catch { /* 继续回落 */ }
  }
  return 'unknown';
}

/** stdio 下允许自报的身份；未知身份统一降为最低权限的 agent */
const ALLOWED_CALLERS = new Set([
  'openclaw', 'workbuddy', 'autoclaw', 'teammate', 'generic',
  'api', 'cli', 'skill-check', 'eval', 'legal_mind', 'agent',
]);
function normalizeCaller(raw) {
  const s = String(raw ?? 'api').trim();
  if (!ALLOWED_CALLERS.has(s)) return 'agent';
  // 本地可信身份不允许经外部 stdio 自报
  if (s === 'ui' || s === 'sprite') return 'agent';
  return s;
}

function vaultIdFor(root) {
  let h = 0;
  for (let i = 0; i < root.length; i++) { h = (h << 5) - h + root.charCodeAt(i); h |= 0; }
  return 'v' + Math.abs(h).toString(16);
}

function parseArgs(argv) {
  const a = {
    vault: null,
    // v6.23.0：可选的专用沉淀回写仓库（真实目录）。不传时行为完全沿用 6.22.0。
    sedimentVault: null,
    caller: process.env.NEOKB_CALLER || 'api',
    // 只有显式 --caller / NEOKB_CALLER 才允许覆盖宿主预设身份。
    // 否则 --print-config openclaw 会被默认的 'api' 覆盖，生成的配置与文档不符。
    callerExplicit: !!process.env.NEOKB_CALLER,
    printConfig: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vault') a.vault = argv[++i];
    else if (argv[i] === '--sediment-vault') a.sedimentVault = argv[++i];
    else if (argv[i] === '--caller') { a.caller = argv[++i]; a.callerExplicit = true; }
    else if (argv[i] === '--print-config') a.printConfig = argv[++i] || 'openclaw';
    else if (argv[i] === '--host') a.printConfig = argv[++i] || 'openclaw';
    else if (argv[i] === '--help' || argv[i] === '-h') a.help = true;
  }
  return a;
}

function help() {
  process.stdout.write([
    'NeoCosmos MCP Server · stdio',
    '',
    '启动：  node src/mcp/server.js --vault <知识库根目录> [--sediment-vault <沉淀回写仓库>] [--caller <宿主>]',
    '        --sediment-vault 可选：检索 / 引用仍读 --vault，回写卡片真实写进这个独立的库。',
    '宿主：  ' + HOST_IDS.join(' / ') + '（默认 api，外部 Agent 权限）',
    '取配置：node src/mcp/server.js [--vault <目录>] --print-config openclaw',
    '        node src/mcp/server.js --print-config workbuddy',
    '自检：  openclaw mcp doctor neocosmos --probe',
    '',
    '握手协商协议版本：' + PROTOCOL_VERSIONS.join(' / ') + '（默认 ' + DEFAULT_PROTOCOL_VERSION + '）',
    '服务入口（真实绝对路径）：' + SERVER_PATH,
    '工具数：' + listTools().length + '；resources / prompts / ping 均实现。',
    '边界：外部 Agent 无正文写权限；数据全部留在本机；非真实量子计算。',
    '',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 纯输出分支：不打开知识库、不占用 stdin，便于宿主配置脚本直接取 JSON
  if (args.help) { help(); return; }
  if (args.printConfig) {
    if (!HOST_IDS.includes(args.printConfig)) {
      process.stderr.write(`[NeoCosmos] 未知宿主: ${args.printConfig}；支持 ${HOST_IDS.join(', ')}\n`);
      process.exitCode = 2;
      return;
    }
    // v6.40.1：取配置时也优先用 NeoCosmos 当前打开的库，让用户重新生成的
    // 接入配置天然指向当前库，不再固化旧的 --vault / 示例库。
    let cfgVault = args.vault || undefined;
    if (process.env.NEOKB_PIN_VAULT !== '1') {
      const active = resolveActiveVault();
      if (active && active.vaultPath) cfgVault = active.vaultPath;
    }
    if (!cfgVault) {
      process.stderr.write('[NeoCosmos] 未指定 --vault 且无当前激活库：配置里的知识库路径为待替换占位符。\n');
    }
    printHostConfig(args.printConfig, {
      vault: cfgVault,
      sedimentVault: args.sedimentVault || undefined,
      // 取配置时身份由宿主预设决定；仅用户显式指定 --caller 时覆盖。
      ...(args.callerExplicit ? { caller: normalizeCaller(args.caller) } : {}),
    });
    return;
  }

  if (!args.vault) {
    process.stderr.write('用法: node src/mcp/server.js --vault <知识库根目录> [--caller openclaw|workbuddy|autoclaw|...]\n');
    process.stderr.write('取接入配置: node src/mcp/server.js --print-config openclaw\n');
    process.exitCode = 1;
    return;
  }

  const caller = normalizeCaller(args.caller);
  const version = productVersion();
  // v6.40.1：调取库以「NeoCosmos 当前打开的库」为准。
  // 外部平台连接时固化的 --vault 可能是旧库 / 含示例文档的库；只要本机
  // NeoCosmos 发布过当前激活库，就改用它，确保 Agent 回答的是用户在
  // 界面里真正打开的那一个库。NEOKB_PIN_VAULT=1 可显式锁定到 --vault（高级用法）。
  let vaultRoot = args.vault;
  let vaultSource = 'cli';
  if (process.env.NEOKB_PIN_VAULT !== '1') {
    const active = resolveActiveVault();
    if (active && active.vaultPath && fs.existsSync(active.vaultPath)) {
      vaultRoot = active.vaultPath;
      vaultSource = 'neocosmos-active';
    }
  }
  if (vaultSource === 'neocosmos-active' && path.resolve(vaultRoot) !== path.resolve(args.vault)) {
    process.stderr.write(`[NeoCosmos] 调取库已切换到 NeoCosmos 当前打开的库：${vaultRoot}\n`);
  }
  // v10.18.7：启用/停用必须对外部 AI 真实生效 —— 若当前库已被用户停用，
  // 进入"受限模式"：索引照建（供 kb_access_policy / kb_server_status 自查），
  // 但一切内容检索工具由 ctx.externalScopeGuard 在调用时真实拒绝。
  // 这样 AI 能明确告诉用户"库被停用了"，而不是连接直接断掉无从诊断。
  // 白名单文件缺失（老客户端尚未发布）时 isVaultExternallyEnabled 放行，兼容升级期。
  const externallyEnabled = isVaultExternallyEnabled(vaultRoot);
  if (!externallyEnabled) {
    process.stderr.write('[NeoCosmos] 受限模式：当前知识库已被用户在客户端停用，内容检索将被拒绝。\n');
    process.stderr.write(`[NeoCosmos] 被拒库：${vaultRoot}\n`);
  }
  const store = new KbStore(vaultRoot).load();
  await indexVault(store);
  // v6.23.0：专用沉淀回写仓库是第二个真实 KbStore。目录不存在就明确报错退出，
  // 不静默退化成「回写进源库」——用户选了独立仓库，就必须写进那个仓库。
  let sedimentStore = null;
  if (args.sedimentVault) {
    const abs = path.resolve(String(args.sedimentVault));
    if (!fs.existsSync(abs)) {
      process.stderr.write(`[NeoCosmos] 沉淀回写仓库不存在：${abs}\n`);
      process.exit(1);
      return;
    }
    sedimentStore = new KbStore(abs).load();
    await indexVault(sedimentStore);
  }

  const telemetry = createTelemetry({
    node: process.version,
    platform: process.platform,
    pid: process.pid,
    version,
    caller,
  });
  // v6.31.0：真实模型实例（只读打开权重文件，抽样校验；失败为 null）
  const neolm = loadNeoLM();
  const ctx = {
    store,
    caller,
    neolm,
    vaultSource,                 // 'neocosmos-active' | 'cli'：如实标注库来源
    // v10.18.7：外部检索白名单口径 —— 每个检索工具调用前复查，停用即时生效。
    // 只有外部调用者（caller !== 'ui'）才受白名单约束；桌面端本地检索不受影响。
    externalScopeGuard: () => ({
      enabled: isVaultExternallyEnabled(store.root),
      scopeSource: readEnabledVaults() ? 'enforced' : 'legacy-unrestricted',
      enabledCount: (readEnabledVaults()?.vaults || []).length,
    }),
    vaultId: vaultIdFor(store.root),
    // 航天级纪律：stdio 通道永远不允许写正文；桌面端 IPC 才拥有该权限
    canWriteBody: false,
    version,
    telemetry,
    // 只有显式指定 --sediment-vault 时才存在；kb_write_back 据此改写到独立库
    ...(sedimentStore ? {
      sedimentStore,
      sedimentVaultId: vaultIdFor(sedimentStore.root),
      sedimentVaultPath: sedimentStore.root,
    } : {}),
  };
  const handle = createProtocolHandler({ store, ctx, version, telemetry });

  // v6.23.1：登记本会话（哪个外部平台拉起的），并让客户端里的管理动作在此生效。
  // 登记不可用时返回 null，下面所有调用都用可选链，MCP 能力完全不受影响。
  const linkSession = createLinkSession({
    caller,
    vault: store.root,
    vaultId: ctx.vaultId,
    serverVersion: version,
    sedimentVault: sedimentStore ? sedimentStore.root : '',
    onRevoke: () => { setTimeout(() => bye('用户断开连接'), 60); },
  });

  process.stdin.setEncoding('utf8');
  process.stdout.on('error', (e) => {
    if (e?.code === 'EPIPE') process.exit(0);
    else process.stderr.write('[NeoCosmos] stdout 写入失败: ' + (e?.message || e) + '\n');
  });

  function respond(obj) {
    if (!obj) return;                       // 通知不回包
    try { process.stdout.write(JSON.stringify(obj) + '\n'); }
    catch (e) { process.stderr.write('[NeoCosmos] 响应写入失败: ' + (e?.message || e) + '\n'); }
  }

  let buffer = '';
  const MAX_LINE = 8 * 1024 * 1024;         // 单行 8MB 上限，防止异常帧撑爆内存
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_LINE && !buffer.includes('\n')) {
      process.stderr.write('[NeoCosmos] 丢弃超长无换行帧\n');
      buffer = '';
      return;
    }
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); }
      catch { respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } }); continue; }

      // v6.23.1：握手 / ping / shutdown 永远放行（否则宿主连协议都建不起来），
      // 其余工具调用走用户在本机客户端设置的门禁 —— 暂停 / 禁用 / 断开是真实生效的，
      // 不是只把界面按钮变灰。
      const method = String(msg?.method || '');
      const meta = method === 'initialize' || method === 'ping' || method === 'shutdown'
        || method.startsWith('notifications/');
      const toolName = method === 'tools/call' ? String(msg?.params?.name || '') : '';
      const verdict = linkSession
        ? linkSession.note(method, toolName, false)
        : { allowed: true, reason: '', terminal: false };

      if (!meta && !verdict.allowed) {
        respond({
          jsonrpc: '2.0', id: msg?.id ?? null,
          error: { code: -32001, message: verdict.reason || '连接已被 NeoCosmos 用户限制' },
        });
        continue;
      }

      try {
        const result = handle(msg);
        // 握手后客户端自报 clientInfo，覆盖 --caller 的配置声明，界面显示真实平台
        if (method === 'initialize' && result?.result && linkSession) {
          linkSession.handshake(msg?.params?.clientInfo, telemetry.state.negotiatedProtocol);
        }
        respond(result);
      }
      catch (e) {
        telemetry.setError(String(e?.message || e));
        if (linkSession) linkSession.note(method, toolName, true);
        respond({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: '内部错误: ' + (e?.message || e) } });
      }
    }
  });

  const bye = (why) => {
    if (linkSession) linkSession.close(why);
    process.stderr.write(`[NeoCosmos] 会话结束（${why}）：请求 ${telemetry.state.requests} / 错误 ${telemetry.state.errors}\n`);
    process.exit(0);
  };
  process.stdin.on('end', () => bye('stdin 关闭'));
  process.on('SIGINT', () => bye('SIGINT'));
  process.on('SIGTERM', () => bye('SIGTERM'));
  process.on('uncaughtException', (e) => {
    telemetry.setError(String(e?.message || e));
    process.stderr.write('[NeoCosmos] 未捕获异常（会话保持）: ' + (e?.stack || e) + '\n');
  });
  process.on('unhandledRejection', (e) => {
    telemetry.setError(String(e?.message || e));
    process.stderr.write('[NeoCosmos] 未处理拒绝（会话保持）: ' + String(e) + '\n');
  });

  const cfg = buildHostConfig('openclaw', {
    vault: store.root, caller,
    ...(sedimentStore ? { sedimentVault: sedimentStore.root } : {}),
  });
  process.stderr.write([
    `[NeoCosmos] v${version} 已就绪 · stdio`,
    `  vault    ${store.root}`,
    ...(sedimentStore ? [`  沉淀库  ${sedimentStore.root}（回写独立落盘）`] : []),
    `  规模     节点 ${store.nodes.size} / 边 ${store.edges.size} / 沉淀 ${store.qaPairs.length}`,
    `  身份     caller=${caller} · 正文写权限=否 · 协议默认=${DEFAULT_PROTOCOL_VERSION}`,
    `  能力     ${listTools().length} 工具 / resources / prompts / ping / 遥测`,
    `  宿主     ${HOST_IDS.join(', ')}`,
    `  OpenClaw ${cfg.cli.add}`,
  ].join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write('[NeoCosmos] 启动失败: ' + (e?.stack || e) + '\n');
  process.exit(1);
});
