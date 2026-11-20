// NeoCosmos v6.23.1 · MCP 外部平台链接登记（双进程共用的单一真源）
// ---------------------------------------------------------------------------
// 背景与边界：
//   MCP Server 是外部宿主（AutoClaw / WorkBuddy / OpenClaw / Claude Desktop / 通用
//   客户端）用 stdio 拉起的**独立 Node 进程**，与 Electron 桌面端不是同一个进程。
//   因此"哪个平台连进来了"不能靠渲染层内存状态，必须由两端共同认可的一份
//   落盘事实派生。本模块就是这份事实的唯一读写口：
//
//     MCP Server 进程 → hello / handshake / heartbeat / bye（写自己的会话文件）
//     Electron 主进程 → aggregate（读全部会话文件）+ policy（写管理策略）
//
// 设计纪律（与 connection-log.cjs 一致）：
//   · 每个会话一个独立 JSON 文件，避免多进程同时追加同一文件造成写竞争/半行；
//   · 只记录真实发生的事件，零预置计数、零演示平台、零模拟心跳；
//   · 在线判定来自"心跳新鲜度 + 进程是否仍存活"，不把历史会话伪装成在线；
//   · 管理策略是独立文件，MCP Server 每次请求都重新读取并真实拒绝，
//     不是只改界面按钮颜色的假开关；
//   · 纯 CJS、零第三方依赖，可在临时目录里被 Node 直接单测。
//
// 目录（v6.23.1 关键设计）：MCP Server 是外部宿主**独立拉起**的进程，
//   它不会继承 Electron 的环境变量，也没有 app.getPath('userData')。
//   因此绝不能用 userData 做默认路径，否则两端各写一个目录、界面永远空。
//   两端统一用「同一函数 → 同一固定推导」：homedir/.neocosmos/mcp-links。
//   只有显式设置 NEOCOSMOS_LINK_DIR 才覆盖（须同时在两端设置，供隔离/单测用）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DIR_ENV = 'NEOCOSMOS_LINK_DIR';
const SESSION_PREFIX = 'session-';
const POLICY_FILE = 'policy.json';
// v6.40.1：NeoCosmos 当前打开的知识库的跨进程共享真源。
// 主进程 openVault 写入；MCP Server / 外部 skill 读取，从而永远跟随
// 用户在 NeoCosmos 界面里实际打开的那个库，而不是连接时固化的旧 --vault。
// 放在 linkDir 的**上一级**（~/.neocosmos/），与会话文件同生命周期推导。
const ACTIVE_VAULT_FILE = 'active-vault.json';
// v10.18.7：外部 AI 检索白名单。与 active-vault.json 同目录、同一套 homedir 推导，
// 保证 MCP 进程（无 Electron userData）与主进程读写同一处。
// 语义：只有列进这份白名单的知识库，才允许被 WorkBuddy / AutoClaw / OpenClaw
// 等外部 Agent 经 MCP 检索（kb_search / kb_ask）；停用的库真实不在其中。
const ENABLED_VAULTS_FILE = 'enabled-vaults.json';
/** 心跳超过这个时间没更新，就不再认为是"在线"（如实标注为失联/已结束）。 */
const STALE_MS = 20 * 1000;
/** 最多保留多少个历史会话文件，避免长期运行后无限膨胀。 */
const MAX_SESSION_FILES = 400;

function linkDir() {
  const explicit = process.env[DIR_ENV];
  if (explicit && String(explicit).trim()) return path.resolve(String(explicit).trim());
  return path.join(os.homedir(), '.neocosmos', 'mcp-links');
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); return true; }
  catch { return false; }
}

// ── 平台身份：既认配置声明的宿主，也认握手时客户端自报 ────────────────────
// caller 来自启动参数 --caller（由宿主接入配置写定，可信度：配置声明）；
// clientInfo 来自 MCP initialize 的 params.clientInfo（可信度：客户端自报）。
// 两者都保留：界面同时展示"声明宿主"与"自报客户端"，冲突时如实并列，不猜测。
const CALLER_LABEL = {
  openclaw: 'OpenClaw',
  workbuddy: 'WorkBuddy',
  autoclaw: 'AutoClaw',
  teammate: '团队客户端',
  generic: '通用 MCP 客户端',
  api: 'API / 命令行客户端',
  cli: 'CLI 客户端',
  'skill-check': '自检脚本',
  eval: '离线评测',
  legal_mind: '法律大脑',
  agent: '外部 Agent',
};

/** 从自报名称推断平台键；认不出来就如实返回 unknown，不硬套。 */
function platformKeyOf(clientName) {
  const s = String(clientName || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (!s) return '';
  if (s.includes('workbuddy') || s.includes('work buddy')) return 'workbuddy';
  if (s.includes('autoclaw')) return 'autoclaw';
  if (s.includes('openclaw')) return 'openclaw';
  if (s.includes('claude')) return 'claude-desktop';
  if (s.includes('cursor')) return 'cursor';
  if (s.includes('cline') || s.includes('roocode')) return 'cline';
  if (s.includes('cherry') || s.includes('cherrystudio')) return 'cherry-studio';
  if (s.includes('neokb') || s.includes('neocosmos')) return 'neocosmos';
  return 'unknown';
}

const PLATFORM_LABEL = {
  workbuddy: 'WorkBuddy',
  autoclaw: 'AutoClaw',
  openclaw: 'OpenClaw',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  cline: 'Cline / Roo Code',
  'cherry-studio': 'Cherry Studio',
  neocosmos: 'NeoCosmos 自身工具',
  generic: '通用 MCP 客户端',
  unknown: '未识别平台',
};

/** 归一平台身份：优先握手自报，其次 --caller，最后 unknown。 */
function identify(clientInfo, caller) {
  const name = String(clientInfo && clientInfo.name || '').slice(0, 120);
  const version = String(clientInfo && clientInfo.version || '').slice(0, 60);
  const c = String(caller || '').slice(0, 60);
  const guessed = platformKeyOf(name);
  const callerKey = CALLER_LABEL[c] && c !== 'generic' && c !== 'api' ? c : '';
  const key = guessed || callerKey || (c === 'generic' || c === 'api' ? 'generic' : 'unknown');
  return {
    platformKey: key,
    platformLabel: PLATFORM_LABEL[key] || key,
    clientName: name,
    clientVersion: version,
    caller: c,
    callerLabel: CALLER_LABEL[c] || (c || '未声明'),
    identitySource: guessed ? 'handshake' : (key === 'unknown' ? 'unknown' : 'caller'),
  };
}

// ── 会话文件读写 ──────────────────────────────────────────────────────────
function safeSid(sid) {
  const s = String(sid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return s || '';
}
function sessionFile(dir, sid) {
  const s = safeSid(sid);
  return s ? path.join(dir, SESSION_PREFIX + s + '.json') : '';
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ── v6.40.1：NeoCosmos 当前打开库的跨进程共享真源 ────────────────────────
// 路径固定为 ~/.neocosmos/active-vault.json（linkDir 的上一级），
// 主进程 openVault 写入，MCP Server / 外部 skill 读取。
function activeVaultFile() {
  return path.join(path.dirname(linkDir()), ACTIVE_VAULT_FILE);
}
function enabledVaultsFile() {
  return path.join(path.dirname(linkDir()), ENABLED_VAULTS_FILE);
}
/** 主进程在打开/切换库后调用。只记录路径与元数据，绝不触碰知识库内容。 */
function writeActiveVault(info) {
  try {
    ensureDir(path.dirname(activeVaultFile()));
    writeJsonAtomic(activeVaultFile(), {
      schema: 1,
      vaultPath: String(info.vaultPath || ''),
      vaultId: String(info.vaultId || ''),
      product: String(info.product || 'NeoCosmos'),
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch { return false; }
}
/**
 * MCP Server / 外部工具读取当前激活库。
 * @param {number} maxAgeMs 超过此龄期视为过期（默认 7 天）；过期返回 null，
 *                          让调用方回落到 --vault，避免陈旧指针。
 */
function readActiveVault(maxAgeMs = 7 * 24 * 3600 * 1000) {
  try {
    const f = activeVaultFile();
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!d.vaultPath || !fs.existsSync(d.vaultPath)) return null;
    if (!fs.existsSync(path.join(d.vaultPath, '.neokb', 'index'))) return null;
    if (d.updatedAt && maxAgeMs > 0 && (Date.now() - Date.parse(d.updatedAt) > maxAgeMs)) return null;
    return d;
  } catch { return null; }
}

/**
 * v10.18.7：主进程把「当前允许外部 AI 检索的知识库白名单」发布为共享真源。
 * vaults: [{id, path}] —— 只含已启用（linkEnabled !== false）的库。
 * 每次切库 / 启停都重写，MCP 侧每次检索复查，停用即时生效。
 */
function writeEnabledVaults(vaults) {
  try {
    ensureDir(path.dirname(enabledVaultsFile()));
    writeJsonAtomic(enabledVaultsFile(), {
      schema: 1,
      // 归一化：去掉空路径、重复路径；只保留磁盘上真实存在的库
      vaults: (Array.isArray(vaults) ? vaults : [])
        .filter((v) => v && v.path && fs.existsSync(String(v.path)))
        .map((v) => ({ id: String(v.id || ''), path: path.resolve(String(v.path)) }))
        .filter((v, i, arr) => arr.findIndex((x) => x.path === v.path) === i),
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch { return false; }
}
/** MCP Server / 外部工具读取外部检索白名单；文件缺失返回 null（由调用方决定降级口径）。 */
function readEnabledVaults() {
  try {
    const f = enabledVaultsFile();
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(d.vaults)) return null;
    return d;
  } catch { return null; }
}

/**
 * MCP Server 侧写入一条会话事件。
 * rec 必须含 sid；event 为 hello / handshake / heartbeat / bye。
 * 返回落盘后的完整会话对象；目录不可写时返回 null（调用方优雅降级）。
 */
/**
 * v6.35.0：某会话 / 平台是否已进入"移除接入"墓碑。
 * 数据来自策略文件（用户的真实移除动作），不是内存态；两端进程都读同一份。
 */
function isRemoved(dir, sid, platformKey) {
  const p = readPolicy(dir);
  const s = safeSid(sid);
  const key = String(platformKey || '');
  return (!!s && p.removedSessions.includes(s))
    || (!!key && p.removedPlatforms.includes(key));
}

function record(dir, event, rec) {
  const sid = safeSid(rec && rec.sid);
  if (!sid || !ensureDir(dir)) return null;
  // 移除接入后，在线 MCP 进程仍会继续心跳 / flush；这里在写盘前用墓碑拦住，
  // 已移除的会话文件不会被重新创建（这是"移除"与"禁用"的本质区别）。
  if (isRemoved(dir, sid, rec && rec.platformKey)) return null;
  const file = sessionFile(dir, sid);
  const now = new Date().toISOString();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { /* 首次登记或坏文件：从空开始，不编造历史 */ }

  const base = (prev && typeof prev === 'object') ? prev : {};
  const merged = {
    sid,
    // 身份字段：hello/handshake 会覆盖，心跳保持原值
    caller: rec.caller ?? base.caller ?? '',
    callerLabel: rec.callerLabel ?? base.callerLabel ?? '',
    platformKey: rec.platformKey ?? base.platformKey ?? 'unknown',
    platformLabel: rec.platformLabel ?? base.platformLabel ?? '未识别平台',
    clientName: rec.clientName ?? base.clientName ?? '',
    clientVersion: rec.clientVersion ?? base.clientVersion ?? '',
    identitySource: rec.identitySource ?? base.identitySource ?? 'unknown',
    // 运行事实
    pid: Number(rec.pid ?? base.pid) || 0,
    vault: String(rec.vault ?? base.vault ?? '').slice(0, 400),
    vaultId: String(rec.vaultId ?? base.vaultId ?? '').slice(0, 80),
    serverVersion: String(rec.serverVersion ?? base.serverVersion ?? '').slice(0, 40),
    protocolVersion: String(rec.protocolVersion ?? base.protocolVersion ?? '').slice(0, 40),
    nodeVersion: String(rec.nodeVersion ?? base.nodeVersion ?? '').slice(0, 40),
    platform: String(rec.platform ?? base.platform ?? '').slice(0, 40),
    sedimentVault: String(rec.sedimentVault ?? base.sedimentVault ?? '').slice(0, 400),
    startedAt: base.startedAt || now,
    lastSeenAt: now,
    helloCount: (Number(base.helloCount) || 0) + (event === 'hello' ? 1 : 0),
    handshakeCount: (Number(base.handshakeCount) || 0) + (event === 'handshake' ? 1 : 0),
    requests: (Number(base.requests) || 0) + (Number(rec.addRequests) || 0),
    errors: (Number(base.errors) || 0) + (Number(rec.addErrors) || 0),
    tools: mergeTools(base.tools, rec.addTools),
    lastTool: String(rec.lastTool ?? base.lastTool ?? '').slice(0, 80),
    state: event === 'bye' ? 'offline' : 'online',
    endReason: event === 'bye' ? String(rec.reason || '会话结束').slice(0, 120) : '',
    endedAt: event === 'bye' ? now : (base.endedAt || ''),
    blockedCount: (Number(base.blockedCount) || 0) + (Number(rec.addBlocked) || 0),
    lastEvent: event,
    updatedAt: now,
  };
  try { writeJsonAtomic(file, merged); return merged; }
  catch (e) { console.error('[mcp-links] write failed', e && e.message || e); return null; }
}

function mergeTools(prev, add) {
  const out = {};
  if (prev && typeof prev === 'object') {
    for (const [k, v] of Object.entries(prev)) {
      if (typeof k === 'string' && Number.isFinite(Number(v))) out[k.slice(0, 80)] = Number(v);
    }
  }
  if (add && typeof add === 'object') {
    for (const [k, v] of Object.entries(add)) {
      const key = String(k).slice(0, 80);
      out[key] = (Number(out[key]) || 0) + (Number(v) || 0);
    }
  }
  // 只留调用次数最高的 20 个，避免单会话文件无限增长
  const entries = Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 20);
  return Object.fromEntries(entries);
}

/** 读全部会话文件；坏文件跳过但绝不补假数据。 */
function readSessions(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.startsWith(SESSION_PREFIX) || !n.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (o && typeof o === 'object' && o.sid && o.startedAt) out.push(o);
    } catch { /* 跳过坏行 */ }
  }
  return out;
}

// ── 管理策略（Electron 主进程写，MCP Server 读并真实执行）────────────────
function defaultPolicy() {
  return {
    version: 1,
    paused: false,
    blockedPlatforms: [],   // platformKey 列表（禁用，可恢复）
    revokedSessions: [],    // sid 列表（断开的会话）
    // v6.35.0：移除接入的墓碑。在线 MCP 进程每 5 秒心跳会重写会话文件，
    // 只删文件会被"复活"；墓碑让 record() 在写盘前拒绝已移除的 sid / 平台。
    removedSessions: [],    // sid 墓碑：被移除的单个会话不得重新登记
    removedPlatforms: [],   // platformKey 墓碑：被移除的平台不得重新登记
    // 平台移除时一并写墓碑的 sid 清单（platformKey -> [sid]），供"恢复平台"时
    // 精确撤销这些会话墓碑；否则恢复后在线心跳仍被会话墓碑拦住（v6.35.0 实测）。
    removedByPlatform: {},
    aliases: {},            // platformKey -> 用户自定义显示名
    updatedAt: '',
  };
}
function normalizePolicy(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const arr = (v) => Array.isArray(v) ? [...new Set(v.map((x) => String(x).slice(0, 80)).filter(Boolean))].slice(0, 200) : [];
  return {
    version: 1,
    paused: !!o.paused,
    blockedPlatforms: arr(o.blockedPlatforms),
    revokedSessions: arr(o.revokedSessions),
    removedSessions: arr(o.removedSessions),
    removedPlatforms: arr(o.removedPlatforms),
    removedByPlatform: (o.removedByPlatform && typeof o.removedByPlatform === 'object' && !Array.isArray(o.removedByPlatform))
      ? Object.fromEntries(Object.entries(o.removedByPlatform).slice(0, 100)
        .map(([k, v]) => [String(k).slice(0, 80), arr(v)])) : {},
    aliases: (o.aliases && typeof o.aliases === 'object' && !Array.isArray(o.aliases))
      ? Object.fromEntries(Object.entries(o.aliases).slice(0, 100)
        .map(([k, v]) => [String(k).slice(0, 80), String(v).slice(0, 60)])) : {},
    updatedAt: String(o.updatedAt || '').slice(0, 40),
  };
}
function readPolicy(dir) {
  try { return normalizePolicy(JSON.parse(fs.readFileSync(path.join(dir, POLICY_FILE), 'utf8'))); }
  catch { return defaultPolicy(); }
}
function writePolicy(dir, policy) {
  if (!ensureDir(dir)) return null;
  const next = normalizePolicy(policy);
  next.updatedAt = new Date().toISOString();
  try { writeJsonAtomic(path.join(dir, POLICY_FILE), next); return next; }
  catch (e) { console.error('[mcp-links] policy write failed', e && e.message || e); return null; }
}

/** 某会话此刻是否还允许继续调用工具 —— MCP Server 每次请求都用它做门禁。 */
function gate(policy, session) {
  const p = normalizePolicy(policy);
  const key = String(session && session.platformKey || 'unknown');
  const sid = String(session && session.sid || '');
  if (p.paused) return { allowed: false, reason: '链接已被用户在 NeoCosmos「沉淀 · 回写通道」中暂停' };
  if (p.blockedPlatforms.includes(key)) return { allowed: false, reason: `平台「${key}」已被用户禁用接入` };
  if (sid && p.revokedSessions.includes(sid)) return { allowed: false, reason: '该连接已被用户断开' };
  // v6.35.0 移除接入：已移除的平台 / 会话，即使进程仍在心跳，工具调用也被真实拒绝。
  if (p.removedPlatforms.includes(key)) return { allowed: false, reason: `平台「${key}」的接入已被用户移除` };
  if (sid && p.removedSessions.includes(sid)) return { allowed: false, reason: '该连接已被用户移除' };
  return { allowed: true, reason: '' };
}

// ── 聚合：给界面用的只读视图 ──────────────────────────────────────────────
/** Windows 下 process.kill(pid, 0) 可用于探测进程是否存在；异常一律按"不存活"处理。 */
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; }
  catch { return false; }
}

/**
 * @param {string} dir 链接目录
 * @param {{now?:number, staleMs?:number, limit?:number}} opts
 * 所有计数、状态、时间都由真实会话文件派生，没有预置值。
 */
function aggregate(dir, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const staleMs = Number(opts.staleMs) || STALE_MS;
  const policy = readPolicy(dir);
  const all = readSessions(dir);
  const sessions = all.map((s) => {
    const t = Date.parse(s.lastSeenAt || s.startedAt || '');
    const fresh = Number.isFinite(t) && now - t <= staleMs && now - t >= -60000;
    const alive = s.state !== 'offline' && fresh && pidAlive(s.pid);
    const g = gate(policy, s);
    const alias = policy.aliases[s.platformKey] || '';
    return {
      sid: s.sid,
      platformKey: s.platformKey || 'unknown',
      platformLabel: alias || s.platformLabel || PLATFORM_LABEL[s.platformKey] || s.platformKey,
      platformOfficial: s.platformLabel || '',
      alias,
      identitySource: s.identitySource || 'unknown',
      clientName: s.clientName || '',
      clientVersion: s.clientVersion || '',
      caller: s.caller || '',
      callerLabel: s.callerLabel || '',
      pid: s.pid || 0,
      vault: s.vault || '',
      vaultId: s.vaultId || '',
      sedimentVault: s.sedimentVault || '',
      serverVersion: s.serverVersion || '',
      protocolVersion: s.protocolVersion || '',
      nodeVersion: s.nodeVersion || '',
      platform: s.platform || '',
      startedAt: s.startedAt || '',
      lastSeenAt: s.lastSeenAt || '',
      endedAt: s.endedAt || '',
      endReason: s.endReason || '',
      requests: Number(s.requests) || 0,
      errors: Number(s.errors) || 0,
      blockedCount: Number(s.blockedCount) || 0,
      helloCount: Number(s.helloCount) || 0,
      handshakeCount: Number(s.handshakeCount) || 0,
      tools: (s.tools && typeof s.tools === 'object') ? s.tools : {},
      lastTool: s.lastTool || '',
      lastEvent: s.lastEvent || '',
      // 在线 = 进程还活着 + 心跳新鲜 + 没有被断开 + 没有被暂停/禁用
      online: !!alive && g.allowed,
      state: !g.allowed ? 'blocked' : (alive ? 'online' : 'offline'),
      stateReason: !g.allowed ? g.reason
        : (s.state === 'offline' ? (s.endReason || '会话已结束')
          : (!fresh ? '心跳超时（进程可能已退出）' : (!pidAlive(s.pid) ? '进程已不存在' : ''))),
      revoked: policy.revokedSessions.includes(s.sid),
    };
  }).sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));

  // 按平台分组：一个平台可能有多个并发会话（宿主多开很常见）
  const byPlatform = new Map();
  for (const s of sessions) {
    let p = byPlatform.get(s.platformKey);
    if (!p) {
      p = {
        platformKey: s.platformKey,
        platformLabel: s.platformLabel,
        alias: s.alias,
        identitySource: s.identitySource,
        callerLabel: s.callerLabel,
        online: 0, total: 0, requests: 0, errors: 0, blockedCount: 0,
        lastSeenAt: '', startedAt: '', sessions: [],
        vaults: new Set(), clients: new Set(), protocols: new Set(),
      };
      byPlatform.set(s.platformKey, p);
    }
    p.total++;
    if (s.online) p.online++;
    p.requests += s.requests;
    p.errors += s.errors;
    p.blockedCount += s.blockedCount;
    if (s.lastSeenAt > p.lastSeenAt) p.lastSeenAt = s.lastSeenAt;
    if (!p.startedAt || (s.startedAt && s.startedAt < p.startedAt)) p.startedAt = s.startedAt;
    if (s.vault) p.vaults.add(s.vault);
    if (s.clientName) p.clients.add(s.clientName + (s.clientVersion ? ' ' + s.clientVersion : ''));
    if (s.protocolVersion) p.protocols.add(s.protocolVersion);
    if (s.state === 'blocked') p.blockedSessions = (p.blockedSessions || 0) + 1;
    p.sessions.push(s);
  }

  const platforms = [...byPlatform.values()].map((p) => ({
    platformKey: p.platformKey,
    platformLabel: p.platformLabel,
    alias: p.alias,
    identitySource: p.identitySource,
    callerLabel: p.callerLabel,
    online: p.online,
    total: p.total,
    requests: p.requests,
    errors: p.errors,
    blockedCount: p.blockedCount,
    blockedSessions: p.blockedSessions || 0,
    lastSeenAt: p.lastSeenAt,
    startedAt: p.startedAt,
    vaults: [...p.vaults],
    clients: [...p.clients],
    protocols: [...p.protocols],
    sessions: p.sessions,
    blocked: policy.paused || policy.blockedPlatforms.includes(p.platformKey),
  })).sort((a, b) => b.online - a.online || (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));

  const onlineSessions = sessions.filter((s) => s.online).length;
  return {
    dir,
    staleMs,
    window: MAX_SESSION_FILES,
    recorded: all.length,
    sessions: sessions.slice(0, Number(opts.limit) || MAX_SESSION_FILES),
    platforms,
    policy,
    summary: {
      onlineSessions,
      onlinePlatforms: platforms.filter((p) => p.online > 0).length,
      totalPlatforms: platforms.length,
      totalSessions: sessions.length,
      totalRequests: sessions.reduce((n, s) => n + s.requests, 0),
      totalErrors: sessions.reduce((n, s) => n + s.errors, 0),
      paused: policy.paused,
      blockedPlatforms: policy.blockedPlatforms.length,
    },
  };
}

/** 删除已结束的会话文件；在线会话一律保留，避免"清空"把活连接抹掉。 */
function clearHistory(dir) {
  const all = readSessions(dir);
  let removed = 0;
  for (const s of all) {
    if (s.state === 'offline' || !pidAlive(s.pid)) {
      const f = sessionFile(dir, s.sid);
      if (f) { try { fs.unlinkSync(f); removed++; } catch { /* 忽略 */ } }
    }
  }
  return { removed, kept: all.length - removed };
}

/**
 * v6.35.0 移除接入（真实、防复活）：
 *   - scope='session'：按 sids 删除会话文件，并把这些 sid 写入 removedSessions 墓碑；
 *   - scope='platform'：按 platformKey 删除该文件下全部会话，并把 key 写入
 *     removedPlatforms 墓碑（同时把命中的 sid 也写入会话墓碑）。
 * 顺序：先写墓碑（让在跑的会话写盘立刻被 record 拦截），再删文件。
 * 返回 { removed, sids, platformKey, scope }；目录不可写时如实返回 removed:0。
 */
function removeSessions(dir, opts = {}) {
  const scope = String(opts.scope || 'session') === 'platform' ? 'platform' : 'session';
  const p = readPolicy(dir);
  const all = readSessions(dir);
  let targets;
  const platformKey = safeSid(opts.platformKey);
  if (scope === 'platform') {
    if (!platformKey) return { removed: 0, sids: [], platformKey: '', scope };
    targets = all.filter((s) => String(s.platformKey || 'unknown') === platformKey);
  } else {
    const want = new Set((Array.isArray(opts.sids) ? opts.sids : [opts.sid])
      .map((x) => safeSid(x)).filter(Boolean));
    if (!want.size) return { removed: 0, sids: [], platformKey: '', scope };
    targets = all.filter((s) => want.has(s.sid));
  }
  const sids = targets.map((s) => s.sid);
  // 1) 先写墓碑：在线进程的 record() 从此刻起拒绝写回这些会话
  for (const sid of sids) if (!p.removedSessions.includes(sid)) p.removedSessions.push(sid);
  if (scope === 'platform') {
    if (!p.removedPlatforms.includes(platformKey)) p.removedPlatforms.push(platformKey);
    p.removedByPlatform[platformKey] = [...new Set([...(p.removedByPlatform[platformKey] || []), ...sids])];
  }
  const written = writePolicy(dir, p);
  if (!written) return { removed: 0, sids: [], platformKey, scope };
  // 2) 再删文件（含可能残留的 .tmp）
  let removed = 0;
  for (const sid of sids) {
    const f = sessionFile(dir, sid);
    if (f) { try { fs.unlinkSync(f); removed++; } catch { /* 忽略 */ } }
    try { fs.unlinkSync(f + '.tmp'); } catch { /* 忽略 */ }
  }
  return { removed, sids, platformKey, scope };
}

/** 撤销"移除接入"墓碑：恢复后该平台 / 会话可再次被真实登记。 */
function restoreRemoved(dir, opts = {}) {
  const p = readPolicy(dir);
  const sids = new Set((Array.isArray(opts.sids) ? opts.sids : (opts.sid ? [opts.sid] : []))
    .map((x) => safeSid(x)).filter(Boolean));
  const platformKey = safeSid(opts.platformKey);
  // 恢复平台时，连同该平台当初写入墓碑的 sid 一起精确撤销，
  // 否则会话墓碑会继续拦住在线心跳（实测 bug，v6.35.0 修复）。
  if (platformKey && Array.isArray(p.removedByPlatform[platformKey])) {
    for (const sid of p.removedByPlatform[platformKey]) sids.add(safeSid(sid));
    delete p.removedByPlatform[platformKey];
  }
  const before = p.removedSessions.length + p.removedPlatforms.length;
  if (sids.size) p.removedSessions = p.removedSessions.filter((s) => !sids.has(s));
  if (platformKey) p.removedPlatforms = p.removedPlatforms.filter((k) => k !== platformKey);
  const written = writePolicy(dir, p);
  return { restored: written ? before - (p.removedSessions.length + p.removedPlatforms.length) : 0 };
}

/** 周期性裁剪：只留最近 MAX_SESSION_FILES 个会话文件，按最后活动排序。 */
function prune(dir) {
  const all = readSessions(dir);
  if (all.length <= MAX_SESSION_FILES) return 0;
  const stale = all.sort((a, b) => (a.lastSeenAt || '').localeCompare(b.lastSeenAt || ''))
    .slice(0, all.length - MAX_SESSION_FILES);
  let removed = 0;
  for (const s of stale) {
    const f = sessionFile(dir, s.sid);
    if (f) { try { fs.unlinkSync(f); removed++; } catch { /* 忽略 */ } }
  }
  return removed;
}

module.exports = {
  DIR_ENV, STALE_MS, MAX_SESSION_FILES,
  linkDir, ensureDir, identify, platformKeyOf, CALLER_LABEL, PLATFORM_LABEL,
  activeVaultFile, writeActiveVault, readActiveVault,
  enabledVaultsFile, writeEnabledVaults, readEnabledVaults,
  sessionFile, record, readSessions,
  defaultPolicy, normalizePolicy, readPolicy, writePolicy, gate, isRemoved,
  aggregate, clearHistory, removeSessions, restoreRemoved, prune, pidAlive,
};
