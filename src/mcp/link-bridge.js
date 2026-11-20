// NeoCosmos v6.23.1 · MCP Server ↔ 连接登记 的桥（ESM，零第三方依赖）
// ---------------------------------------------------------------------------
// 职责：把"本进程是一个被外部宿主拉起的 MCP 会话"这一事实，写进两端共用的
//   连接登记表，并在每次请求时读取用户在本机客户端里设置的管理策略。
//
// 为什么单独一层：server.js 是协议传输层，不该关心落盘细节；而登记模块
//   desktop/mcp-links.cjs 是 CJS，被 Electron 主进程直接 require。这里用
//   createRequire 定位它，同时兼容两种部署形态：
//     打包态 resources/app/src/mcp/ → ../../mcp-links.cjs（app 根）
//     源码态 <root>/src/mcp/        → ../../desktop/mcp-links.cjs
//   两个进程加载的是**同一份文件、同一个 linkDir() 推导**，不会路径漂移。
//
// 纪律：登记模块缺失 / 目录不可写时一律优雅降级返回 null，
//   MCP 的全部能力保持原样，绝不因为"状态展示"拖垮真实工具调用。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadLinks() {
  const candidates = [
    path.resolve(HERE, '..', '..', 'mcp-links.cjs'),
    path.resolve(HERE, '..', '..', 'desktop', 'mcp-links.cjs'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return require(p); }
    catch { /* 试下一个候选 */ }
  }
  return null;
}

const HEARTBEAT_MS = 5000;      // 空闲会话也要证明自己活着，否则界面会误判离线
const FLUSH_REQUESTS = 20;
const POLICY_TTL_MS = 800;

/**
 * v6.40.1：读取 NeoCosmos 当前打开的知识库（跨进程共享真源）。
 * 供 MCP Server 启动时决定是否用「当前库」覆盖连接时固化的 --vault。
 * 模块缺失 / 无有效记录时返回 null（优雅降级，沿用 --vault）。
 */
export function resolveActiveVault() {
  const links = loadLinks();
  if (!links || typeof links.readActiveVault !== 'function') return null;
  try { return links.readActiveVault(); } catch { return null; }
}

/**
 * v10.18.7：读取「外部 AI 检索白名单」（主进程在切库 / 启停时发布）。
 * 返回 { vaults:[{id,path}], updatedAt } 或 null。
 *
 * 口径纪律（用户诉求："启用和停用不能是摆设"）：
 *   · 文件存在   → 严格按白名单判定：当前库 path 不在其中即视为停用，检索拒绝。
 *   · 文件不存在 → 兼容老客户端（尚未发布过白名单）：放行，避免升级期集体断连；
 *                  但 kb_server_status 会如实标注 scopeSource='legacy-unrestricted'。
 * 每次检索调用都重新读盘（不缓存），用户在客户端停用某库后即时生效。
 */
export function readEnabledVaults() {
  const links = loadLinks();
  if (!links || typeof links.readEnabledVaults !== 'function') return null;
  try { return links.readEnabledVaults(); } catch { return null; }
}

/** 归一化路径比较（大小写 / 斜杠 / 尾部分隔符），跨平台稳健。 */
function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
/**
 * 判断当前检索库是否被允许对外部 AI 可见。
 * @returns {boolean} true=允许；白名单存在但不含该库 → false；白名单缺失 → true（兼容）
 */
export function isVaultExternallyEnabled(vaultPath) {
  const wl = readEnabledVaults();
  if (!wl || !Array.isArray(wl.vaults)) return true; // 老客户端未发布：放行
  const target = normPath(path.resolve(String(vaultPath || '')));
  return wl.vaults.some((v) => normPath(path.resolve(String(v.path || ''))) === target);
}

/**
 * 创建一个连接会话登记器。
 * init: { caller, vault, vaultId, serverVersion, sedimentVault, onRevoke }
 * @returns {null | {sid, dir, handshake, note, close}}
 */
export function createLinkSession(init = {}) {
  const links = loadLinks();
  if (!links) return null;

  const caller = String(init.caller || 'agent');
  // 自检 / 离线评测不是真实的外部平台接入，不进用户可见的连接列表。
  if (caller === 'skill-check' || caller === 'eval') return null;

  const dir = links.linkDir();
  const sid = crypto.randomBytes(8).toString('hex');
  const ident = links.identify(null, caller);

  // 静态事实（不会随握手变化）
  const common = {
    pid: process.pid,
    vault: String(init.vault || ''),
    vaultId: String(init.vaultId || ''),
    serverVersion: String(init.serverVersion || ''),
    sedimentVault: String(init.sedimentVault || ''),
    nodeVersion: process.version,
    platform: process.platform,
  };
  // 可变身份：握手拿到 clientInfo 后以「客户端自报」为准，但不能被后续心跳覆盖回去
  let identity = {
    caller,
    callerLabel: ident.callerLabel,
    platformKey: ident.platformKey,
    platformLabel: ident.platformLabel,
    identitySource: ident.identitySource,
    clientName: '',
    clientVersion: '',
    protocolVersion: '',
  };

  let ok = true;
  try {
    if (!links.ensureDir(dir)) ok = false;
    else if (!links.record(dir, 'hello', { ...common, ...identity, sid })) ok = false;
  } catch { ok = false; }
  if (!ok) return null;

  // 累计计数，节流落盘：高频 stdio 请求不能每条都写文件
  let addRequests = 0, addErrors = 0, addBlocked = 0;
  let addTools = {}, lastTool = '';
  let sinceFlush = 0;
  let lastFlush = Date.now();
  let policyCache = null, policyAt = 0;
  let closed = false;
  let revokeFired = false;

  function readPolicy() {
    const t = Date.now();
    if (!policyCache || t - policyAt > POLICY_TTL_MS) {
      policyCache = links.readPolicy(dir);
      policyAt = t;
    }
    return policyCache;
  }

  function flush(event = 'heartbeat') {
    if (closed) return;
    try {
      links.record(dir, event, {
        ...common, ...identity, sid,
        addRequests, addErrors, addBlocked, addTools, lastTool,
      });
      addRequests = 0; addErrors = 0; addBlocked = 0; addTools = {};
      sinceFlush = 0; lastFlush = Date.now();
    } catch { /* 登记失败不影响 MCP 本身 */ }
  }

  // 独立心跳：即使宿主一直不发请求，也持续刷新 lastSeenAt；
  // 同时感知「用户断开本会话」，让 stdio 通道真的关闭而不是只改个状态。
  const timer = setInterval(() => {
    if (closed) return;
    flush('heartbeat');
    try {
      const p = readPolicy();
      if (!revokeFired && p.revokedSessions.includes(sid)) {
        revokeFired = true;
        if (typeof init.onRevoke === 'function') init.onRevoke();
      }
    } catch { /* 忽略 */ }
  }, HEARTBEAT_MS);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    sid,
    dir,
    /** initialize 握手：客户端自报身份优先于 --caller 配置声明 */
    handshake(clientInfo, protocolVersion) {
      if (closed) return;
      const id = links.identify(clientInfo || null, caller);
      identity = {
        ...identity,
        platformKey: id.platformKey,
        platformLabel: id.platformLabel,
        identitySource: id.identitySource,
        clientName: id.clientName,
        clientVersion: id.clientVersion,
        protocolVersion: String(protocolVersion || ''),
      };
      try {
        links.record(dir, 'handshake', { ...common, ...identity, sid });
        lastFlush = Date.now();
      } catch { /* 忽略 */ }
    },
    /**
     * 每次 JSON-RPC 请求调用。返回门禁结果：
     *   { allowed, reason, terminal }
     * terminal=true 表示用户已断开本会话，调用方应结束进程以真正断开连接。
     */
    note(method, toolName, isError) {
      if (closed) return { allowed: true, reason: '', terminal: false };
      addRequests++;
      if (isError) addErrors++;
      if (toolName) {
        const k = String(toolName).slice(0, 80);
        addTools[k] = (addTools[k] || 0) + 1;
        lastTool = k;
      }
      sinceFlush++;

      let g;
      try { g = links.gate(readPolicy(), { sid, platformKey: identity.platformKey }); }
      catch { g = { allowed: true, reason: '' }; }
      const p = policyCache || {};
      const terminal = Array.isArray(p.revokedSessions) && p.revokedSessions.includes(sid);

      if (!g.allowed) {
        addBlocked++;
        flush('heartbeat');   // 被拦截要立刻落盘，界面才看得到拦截次数
      } else if (sinceFlush >= FLUSH_REQUESTS || Date.now() - lastFlush >= HEARTBEAT_MS) {
        flush('heartbeat');
      }
      return { allowed: g.allowed, reason: g.reason || '', terminal };
    },
    close(reason) {
      if (closed) return;
      closed = true;
      try { clearInterval(timer); } catch { /* 忽略 */ }
      try {
        links.record(dir, 'bye', {
          ...common, ...identity, sid, addRequests, addErrors, reason,
        });
      } catch { /* 忽略 */ }
    },
  };
}
