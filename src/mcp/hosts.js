// NeoCosmos MCP · 宿主接入配置（单一真源，v6.18.0）
// ---------------------------------------------------------------------------
// 这个模块只做一件事：把「同一个 stdio MCP Server」翻译成各宿主真正接受的
// 配置形态，并且全部使用**真实路径**（由 import.meta.url 推导），不写占位符。
//
// OpenClaw 依据其官方文档（docs.openclaw.ai/tools/mcp 与 /cli/mcp/registry）：
//   · 服务端定义保存在配置的 `mcp.servers.<name>`；
//   · stdio 定义由 command + args 组成，可带 cwd / transport:"stdio" / enabled；
//   · CLI 注册：`openclaw mcp add <name> --command node --arg <path> ...`；
//   · 连通性用 `openclaw mcp doctor <name> --probe` / `openclaw mcp probe <name>`；
//   · 初始化时发布的 instructions 会随工具一起交给内嵌 agent。
// 同时保留社区常见的 `~/.openclaw/mcp_config.json`（mcpServers 形态）兼容输出，
// 并在返回值里如实标注哪一种是官方形态、哪一种是兼容形态。
//
// 零依赖、零副作用：桌面端 tool:invoke、CLI、MCP 工具 kb_host_config 共用本模块。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 应用根：源码态 = 项目根；打包态 = resources/app */
export const APP_ROOT = path.resolve(HERE, '..', '..');
/** 本模块所在 MCP Server 的真实绝对路径 */
export const SERVER_PATH = path.join(HERE, 'server.js');

// v10.18.7：对外服务名统一为 NeoCosmos。旧名 neokb-memory 仅作兼容别名保留，
// 不再作为默认名向外发布 —— 避免外部 AI 把内部接入标识误当成"产品旧称"播报。
export const DEFAULT_SERVER_NAME = 'neocosmos';
export const LEGACY_SERVER_NAME = 'neokb-memory';

/** 允许作为 --caller 的宿主身份；stdio 下均视为外部 Agent（无正文写权限） */
export const CALLERS = Object.freeze({
  openclaw: 'openclaw',
  workbuddy: 'workbuddy',
  autoclaw: 'autoclaw',
  'claude-desktop': 'workbuddy',
  generic: 'api',
  teammate: 'teammate',
});

/** 宿主元数据：配置形态、配置位置、说明 */
export const HOST_PRESETS = Object.freeze({
  openclaw: {
    label: 'OpenClaw',
    shape: 'mcp.servers',
    configPath: 'OpenClaw 配置文件 · mcp.servers.<name>（Settings → MCP / CLI add）',
    caller: CALLERS.openclaw,
  },
  workbuddy: {
    label: 'WorkBuddy',
    shape: 'mcpServers',
    configPath: 'WorkBuddy MCP 配置 · mcpServers',
    caller: CALLERS.workbuddy,
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    shape: 'mcpServers',
    configPath: 'claude_desktop_config.json · mcpServers',
    caller: CALLERS['claude-desktop'],
  },
  generic: {
    label: '通用 MCP 客户端',
    shape: 'mcpServers',
    configPath: '任意支持 stdio MCP 的客户端 · mcpServers',
    caller: CALLERS.generic,
  },
});

export const HOST_IDS = Object.freeze(Object.keys(HOST_PRESETS));

/** stdio 服务定义（OpenClaw `mcp set` 的 JSON 实参 / 其他宿主共用的 command+args 部分） */
export function buildServerDefinition(host, opts = {}) {
  const preset = HOST_PRESETS[host];
  if (!preset) throw new Error(`未知宿主: ${host}`);
  const serverPath = opts.serverPath || SERVER_PATH;
  const vault = opts.vault || '<知识库根目录>';
  const caller = opts.caller || preset.caller;
  // 默认用 PATH 里的 node：安装包分发到别的机器时，开发机的绝对路径必然失效。
  // 需要固定解释器时由调用方显式传 opts.node（真实绝对路径，不猜测）。
  const node = opts.node || 'node';
  const cwd = opts.cwd || APP_ROOT;
  // v6.23.0：可选「专用沉淀回写仓库」。不传时 args 与 6.22.0 逐字一致，
  // 旧配置、旧 CLI、旧测试全部保持原样；传了才追加两个真实参数。
  const args = [serverPath, '--vault', vault, '--caller', caller];
  if (opts.sedimentVault) args.push('--sediment-vault', String(opts.sedimentVault));
  const def = {
    command: node,
    args,
    cwd,
    transport: 'stdio',
    enabled: true,
  };
  if (opts.env && typeof opts.env === 'object') def.env = { ...opts.env };
  return def;
}

const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

/**
 * 生成某宿主的完整接入包。
 * @returns {{host,label,transport,serverName,serverPath,vault,caller,shape,config,configPath,serverDefinition,legacyConfig,cli,notes}}
 */
export function buildHostConfig(host, opts = {}) {
  const preset = HOST_PRESETS[host];
  if (!preset) throw new Error(`未知宿主: ${host}；支持：${HOST_IDS.join(', ')}`);
  const name = opts.name || DEFAULT_SERVER_NAME;
  const def = buildServerDefinition(host, opts);
  const vault = def.args[def.args.indexOf('--vault') + 1];
  const caller = def.args[def.args.indexOf('--caller') + 1];
  const sedimentVault = def.args.includes('--sediment-vault')
    ? def.args[def.args.indexOf('--sediment-vault') + 1] : null;

  // 官方形态：OpenClaw 配置里的 mcp.servers
  const openclawConfig = { mcp: { servers: { [name]: { ...def } } } };
  // 兼容形态：社区文档中的 ~/.openclaw/mcp_config.json
  const legacyConfig = { mcpServers: { [name]: { command: def.command, args: def.args, cwd: def.cwd } } };
  // 通用形态：Claude Desktop / WorkBuddy / 其它 stdio MCP 客户端
  const genericConfig = { mcpServers: { [name]: { command: def.command, args: def.args } } };

  const config = host === 'openclaw' ? openclawConfig
    : host === 'generic' ? genericConfig : genericConfig;

  const cli = host === 'openclaw' ? {
    add: `openclaw mcp add ${name} --command ${q(def.command)} ${def.args.map((a) => `--arg ${q(a)}`).join(' ')} --cwd ${q(def.cwd)}`,
    set: `openclaw mcp set ${name} '${JSON.stringify(def)}'`,
    doctor: `openclaw mcp doctor ${name} --probe`,
    probe: `openclaw mcp probe ${name} --json`,
    status: 'openclaw mcp status --verbose',
  } : {
    // 其它宿主没有统一 CLI；给出可直接运行的自检命令（真实、可在终端验证）
    selfcheck: `node ${q(def.args[0])} --vault ${q(vault)} `
      + `${sedimentVault ? `--sediment-vault ${q(sedimentVault)} ` : ''}`
      + `--caller ${q(caller)} --print-config ${host}`,
  };

  const notes = [
    ...(sedimentVault ? [
      `已指定专用沉淀回写仓库 ${sedimentVault}：检索与引用仍来自 --vault 指定的知识库，Agent 回写的卡片真实写入这个独立库，两个库互不覆盖。`,
    ] : []),
    ...(host === 'openclaw' ? [
      '官方配置形态是 mcp.servers.<name>；legacyConfig 为社区常见 mcpServers 形态，仅供旧版配置参考。',
      '注册后必须执行 doctor --probe 或 probe 做一次真实连通性验证，保存配置本身不代表可连接。',
      '外部 Agent 默认只有「检索 / 读取 / 追加沉淀区」权限，不能改写或删除用户正文。',
      '运行依赖：宿主机需安装 Node.js >= 18 且 node 在 PATH 中；否则把 command 换成 node 可执行文件的绝对路径。',
    ] : [
      'stdio 传输：宿主拉起本进程，双方通过 stdin/stdout 逐行交换 JSON-RPC 帧。',
      '外部 Agent 默认只有「检索 / 读取 / 追加沉淀区」权限，不能改写或删除用户正文。',
      '运行依赖：宿主机需安装 Node.js >= 18 且 node 在 PATH 中；否则把 command 换成 node 可执行文件的绝对路径。',
    ]),
  ];

  return {
    host,
    label: preset.label,
    transport: 'stdio',
    serverName: name,
    serverPath: def.args[0],
    vault,
    sedimentVault,
    caller,
    shape: preset.shape,
    configPath: preset.configPath,
    config,
    configJson: JSON.stringify(config, null, 2),
    serverDefinition: def,
    serverDefinitionJson: JSON.stringify(def, null, 2),
    legacyConfig: host === 'openclaw' ? legacyConfig : null,
    cli,
    notes,
  };
}

/** 便捷入口：把配置打印到 stdout（供 CLI / 脚本使用，不启动 stdio 会话）
 *  与 kb_host_config 工具共用 buildHostConfig 的同一份结果：OpenClaw 的
 *  社区兼容形态也必须出现在 CLI 输出里，否则「三入口同一真源」只在两处成立。
 */
export function printHostConfig(host, opts = {}) {
  const c = buildHostConfig(host, opts);
  const out = {
    host: c.host,
    label: c.label,
    shape: c.shape,
    serverName: c.serverName,
    caller: c.caller,
    configPath: c.configPath,
    config: c.config,
    cli: c.cli,
    notes: c.notes,
  };
  if (c.legacyConfig) out.legacyConfig = c.legacyConfig;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return c;
}
