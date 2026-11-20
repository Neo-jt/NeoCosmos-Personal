// v6.22.0 · 链接 API 真实访问日志（主进程侧，零第三方依赖）
// ---------------------------------------------------------------------------
// 这个模块只做一件事：把**真正发生过**的 HTTP 请求落成 JSONL，再从日志里
// 派生出「客户端 IP / 调用次数 / 最近调用 / 接口分布」。它不产生任何演示数值，
// 不预置计数，也不把别的审计日志（沉淀回写 / MCP 遥测）改头换面当连接记录。
//
// 为什么独立成 .cjs：main.js 依赖 Electron，无法在 Node 下直接 require 做单测。
// 把日志与聚合抽出来后，契约测试可以在临时目录里**真实写入若干条请求**、
// 再断言聚合结果，而不是只读源码里的字符串。
//
// 安全约束：URL 只记 pathname，绝不把 ?token= 之类的查询串写进日志。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 统计窗口：只保留最近 MAX_KEEP 条真实记录，超出按时间截断。
// UI 会如实标注「基于最近 N 条访问记录」，不冒充全量历史。
const MAX_KEEP = 5000;
const TRIM_EVERY = 200;
let appendsSinceTrim = 0;

function accessFile(dir) {
  return path.join(dir, 'api-access.jsonl');
}

/** 把 IPv4-mapped IPv6 / IPv6 回环统一成可比较、可展示的形式。 */
function normalizeIp(raw) {
  if (!raw) return 'unknown';
  let s = String(raw).trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  return s || 'unknown';
}

function sanitize(rec) {
  const p = String(rec && rec.path || '/').split('?')[0] || '/';
  return {
    ts: String(rec && rec.ts || new Date().toISOString()),
    ip: normalizeIp(rec && rec.ip),
    method: String(rec && rec.method || 'GET').slice(0, 8).toUpperCase(),
    path: p.slice(0, 300),
    status: Number(rec && rec.status) || 0,
    root: String(rec && rec.root || '').slice(0, 200),
    // v6.23.0：按稳定库 id 区分连接来源。旧日志没有这个字段时保持为空字符串，
    // 由 aggregate 回退到目录名过滤；不改写一个字的历史记录。
    vaultId: String(rec && rec.vaultId || '').slice(0, 64),
  };
}

function trim(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_KEEP) return 0;
    fs.writeFileSync(file, lines.slice(-MAX_KEEP).join('\n') + '\n', 'utf8');
    return lines.length - MAX_KEEP;
  } catch { return 0; }
}

/** 追加一条真实访问记录。dir 通常是 app.getPath('userData')。 */
function appendAccess(dir, rec) {
  const file = accessFile(dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(sanitize(rec)) + '\n', 'utf8');
    if (++appendsSinceTrim >= TRIM_EVERY) { appendsSinceTrim = 0; trim(file); }
    return true;
  } catch (e) {
    console.error('[conn-log] append failed', e && e.message || e);
    return false;
  }
  // 注意：日志写入失败**不能**影响请求本身，也不伪造一条成功记录。
}

/** 读取窗口内的记录；坏行跳过但不编造内容。 */
function readAccess(dir, limit = MAX_KEEP) {
  const file = accessFile(dir);
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); }
  catch { return []; }
  const out = [];
  for (const line of lines.slice(-limit)) {
    try {
      const o = JSON.parse(line);
      if (o && typeof o === 'object' && o.ts && o.ip) out.push(sanitize(o));
    } catch { /* 跳过坏行，不补假数据 */ }
  }
  return out;
}

/**
 * 从真实日志派生连接视图数据。
 * opts: { root?: string, vaultId?: string, blocklist?: string[], now?: number, recentLimit?: number, limit?: number }
 * 所有计数、时间、分布都由 records 计算，没有任何预置值。
 * v6.23.0：vaultId 优先于目录名（同名目录的库不再串数据）；历史记录没有
 * vaultId 时回退匹配目录名，既不丢真实历史，也不把两个同名的库混成一笔。
 */
function aggregate(dir, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const blocklist = Array.isArray(opts.blocklist) ? opts.blocklist.map(normalizeIp) : [];
  const blocked = new Set(blocklist);
  const rootFilter = opts.root ? String(opts.root) : '';
  const vaultFilter = opts.vaultId ? String(opts.vaultId) : '';
  const all = readAccess(dir, opts.limit || MAX_KEEP);
  const rows = vaultFilter
    ? all.filter((r) => r.vaultId === vaultFilter || (!r.vaultId && rootFilter && r.root === rootFilter))
    : (rootFilter ? all.filter((r) => r.root === rootFilter) : all);

  // 按库计数的真源：从**全部**记录派生，不受当前库过滤影响，供作用域界面显示。
  const byVault = new Map();
  for (const r of all) {
    const key = r.vaultId || '';
    if (!key) continue;                    // 旧日志没有库 id，不猜测归属
    let v = byVault.get(key);
    if (!v) { v = { vaultId: key, calls: 0, lastTs: r.ts, ips: new Set() }; byVault.set(key, v); }
    v.calls++;
    v.ips.add(r.ip);
    if (r.ts > v.lastTs) v.lastTs = r.ts;
  }

  const byIp = new Map();
  const byPath = new Map();
  let denied = 0, errors = 0, last24h = 0;
  for (const r of rows) {
    const t = Date.parse(r.ts);
    if (Number.isFinite(t) && now - t <= 86400000 && now - t >= 0) last24h++;
    if (r.status === 401 || r.status === 403) denied++;
    if (r.status >= 400) errors++;

    byPath.set(r.path, (byPath.get(r.path) || 0) + 1);
    let c = byIp.get(r.ip);
    if (!c) {
      c = { ip: r.ip, calls: 0, firstTs: r.ts, lastTs: r.ts, denied: 0,
            errors: 0, byPath: new Map(), blocked: blocked.has(r.ip) };
      byIp.set(r.ip, c);
    }
    c.calls++;
    if (r.ts < c.firstTs) c.firstTs = r.ts;
    if (r.ts > c.lastTs) c.lastTs = r.ts;
    if (r.status === 401 || r.status === 403) c.denied++;
    if (r.status >= 400) c.errors++;
    c.byPath.set(r.path, (c.byPath.get(r.path) || 0) + 1);
  }

  const clients = [...byIp.values()].map((c) => ({
    ip: c.ip,
    calls: c.calls,
    firstTs: c.firstTs,
    lastTs: c.lastTs,
    denied: c.denied,
    errors: c.errors,
    blocked: c.blocked,
    topPath: [...c.byPath.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '',
    byPath: [...c.byPath.entries()].map(([p, n]) => ({ path: p, calls: n }))
      .sort((a, b) => b.calls - a.calls || a.path.localeCompare(b.path)),
  })).sort((a, b) => b.calls - a.calls || b.lastTs.localeCompare(a.lastTs));

  const paths = [...byPath.entries()].map(([p, calls]) => ({ path: p, calls }))
    .sort((a, b) => b.calls - a.calls || a.path.localeCompare(b.path));
  const recent = rows.slice(-Math.max(1, Number(opts.recentLimit) || 20)).reverse();
  const vaultCounts = [...byVault.values()].map((v) => ({
    vaultId: v.vaultId, calls: v.calls, lastTs: v.lastTs, clients: v.ips.size,
  })).sort((a, b) => b.calls - a.calls || a.vaultId.localeCompare(b.vaultId));

  return {
    window: MAX_KEEP,
    recorded: all.length,
    scoped: rows.length,
    total: rows.length,
    last24h,
    denied,
    errors,
    clientCount: clients.length,
    clients,
    paths,
    recent,
    root: rootFilter || null,
    vaultId: vaultFilter || null,
    vaultCounts,
  };
}

// ── 黑名单：纯函数操作 config 对象，落盘由 main.js 的 writeConfig 统一负责 ──
// 这样 config.json 只有一个写入者，避免并发覆盖令牌等字段。
function blocklistOf(cfg) {
  const raw = cfg && cfg.apiServer && cfg.apiServer.blocklist;
  return Array.isArray(raw) ? [...new Set(raw.map(normalizeIp).filter((s) => s && s !== 'unknown'))] : [];
}
function addToBlocklist(cfg, ip) {
  const next = { ...(cfg || {}) };
  const s = { ...(next.apiServer || {}) };
  const list = blocklistOf(next);
  const v = normalizeIp(ip);
  if (v && v !== 'unknown' && !list.includes(v)) list.push(v);
  s.blocklist = list;
  next.apiServer = s;
  return next;
}
function removeFromBlocklist(cfg, ip) {
  const next = { ...(cfg || {}) };
  const s = { ...(next.apiServer || {}) };
  const v = normalizeIp(ip);
  s.blocklist = blocklistOf(next).filter((x) => x !== v);
  next.apiServer = s;
  return next;
}
function isBlocked(list, ip) {
  return (Array.isArray(list) ? list : []).map(normalizeIp).includes(normalizeIp(ip));
}

/** 真实枚举本机非回环 IPv4，供局域网模式显示可访问地址；不做任何猜测。 */
function lanAddresses() {
  const out = [];
  try {
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a && a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
      }
    }
  } catch { /* 无网络接口时返回空数组，不编造地址 */ }
  return out;
}

module.exports = {
  MAX_KEEP, accessFile, normalizeIp, sanitize, appendAccess, readAccess, aggregate,
  blocklistOf, addToBlocklist, removeFromBlocklist, isBlocked, lanAddresses,
};
