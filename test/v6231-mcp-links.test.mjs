// v6.23.1 · MCP 外部平台链接状态契约测试
// ---------------------------------------------------------------------------
// 纪律：全部用真实临时目录 + 真实文件读写，不 mock、不预置平台/次数。
// 覆盖：平台识别（握手优先 / caller 回退 / 未知）→ 会话登记 → 心跳 → 聚合
//       → 暂停 / 禁用 / 断开 门禁真实生效 → 别名 → 清除历史 → 裁剪。
// 另起一个真实 stdio MCP Server 子进程，验证「Server 侧登记 + 策略拒绝工具调用」
// 这条跨进程链路确实通，而不是只在同进程里自说自话。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require(path.join(ROOT, 'desktop', 'mcp-links.cjs'));
// v6.27.0：引擎版本断言跟随 desktop/package.json 单一真源，不再写死某个小版本
// （MCP Server 的 serverVersion 是从包版本真读的，写死会让每次迭代都误报回归）。
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version;

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neocosmos-mcp-links-'));

// ── [1] 平台身份 ──────────────────────────────────────────────────────────
console.log('\n[1] 平台身份识别（不猜测、不冒充）');
const a = L.identify({ name: 'WorkBuddy', version: '5.9.3' }, 'openclaw');
ok('握手自报优先于 --caller，且两者都保留',
  a.platformKey === 'workbuddy' && a.identitySource === 'handshake' &&
  a.clientName === 'WorkBuddy' && a.caller === 'openclaw' && a.callerLabel === 'OpenClaw');
const b = L.identify({ name: 'AutoClaw Desktop', version: '1.2' }, 'generic');
ok('AutoClaw 可从自报名称识别', b.platformKey === 'autoclaw' && b.platformLabel === 'AutoClaw');
const c = L.identify(null, 'workbuddy');
ok('无握手信息时如实回退到 --caller 并标注来源',
  c.platformKey === 'workbuddy' && c.identitySource === 'caller' && c.clientName === '');
const d = L.identify({ name: 'SomeUnknownHost' }, '');
ok('识别不出如实标 unknown，不硬套平台', d.platformKey === 'unknown');

// ── [2] 真实会话登记与聚合 ────────────────────────────────────────────────
console.log('\n[2] 会话登记 / 握手 / 心跳 / 聚合（真实临时目录）');
const SID1 = 'aaaa1111', SID2 = 'bbbb2222';
const common = { pid: process.pid, vault: 'D:/我的知识库', serverVersion: V, platform: process.platform };
const seed = (sid, caller, key, label) => L.record(dir, 'hello', {
  sid, caller, callerLabel: L.CALLER_LABEL[caller] || caller,
  platformKey: key, platformLabel: label, identitySource: 'caller', ...common,
});
ok('两个会话 hello 真实落盘', !!seed(SID1, 'workbuddy', 'workbuddy', 'WorkBuddy')
  && !!seed(SID2, 'autoclaw', 'autoclaw', 'AutoClaw'));
ok('每会话一个独立文件，避免多进程写竞争',
  fs.existsSync(L.sessionFile(dir, SID1)) && fs.existsSync(L.sessionFile(dir, SID2)) &&
  L.readSessions(dir).length === 2);

L.record(dir, 'handshake', {
  sid: SID1, clientName: 'WorkBuddy', clientVersion: '5.9.3',
  platformKey: 'workbuddy', platformLabel: 'WorkBuddy', identitySource: 'handshake',
  protocolVersion: '2025-06-18', ...common,
});
L.record(dir, 'heartbeat', {
  sid: SID1, addRequests: 9, addErrors: 1,
  addTools: { kb_search: 6, kb_read: 3 }, lastTool: 'kb_read', ...common,
});
const agg = L.aggregate(dir, { now: Date.now() });
ok('握手自报身份写进会话文件且不被心跳覆盖',
  agg.sessions.find((s) => s.sid === SID1).clientName === 'WorkBuddy' &&
  agg.sessions.find((s) => s.sid === SID1).protocolVersion === '2025-06-18');
ok('调用次数 / 错误 / 逐工具 Top 由真实记录派生',
  agg.summary.totalRequests === 9 && agg.summary.totalErrors === 1 &&
  agg.sessions.find((s) => s.sid === SID1).tools.kb_search === 6);
ok('在线判定 = 心跳新鲜 + 进程存活 + 未受限',
  agg.summary.onlineSessions === 2 && agg.summary.onlinePlatforms === 2 &&
  agg.summary.totalPlatforms === 2);
ok('按平台分组，两个平台各自独立',
  agg.platforms.length === 2 &&
  agg.platforms.some((p) => p.platformKey === 'workbuddy' && p.requests === 9) &&
  agg.platforms.some((p) => p.platformKey === 'autoclaw' && p.requests === 0));
ok('接入知识库如实聚合', agg.platforms[0].vaults.includes('D:/我的知识库'));

// 心跳超时 / 进程不存在 → 不假装在线
const stale = L.aggregate(dir, { now: Date.now() + 60000 });
ok('心跳超时后不再算在线，且给出如实原因',
  stale.summary.onlineSessions === 0 &&
  stale.sessions.every((s) => s.state === 'offline' && /心跳超时/.test(s.stateReason)));

// ── [3] 管理策略真实生效 ──────────────────────────────────────────────────
console.log('\n[3] 管理策略：暂停 / 禁用 / 断开 / 别名');
ok('默认策略不拦任何请求', L.gate(L.readPolicy(dir), { sid: SID1, platformKey: 'workbuddy' }).allowed);
const p1 = L.writePolicy(dir, { paused: true });
ok('暂停后门禁明确拒绝并给出原因',
  !L.gate(p1, { sid: SID1, platformKey: 'workbuddy' }).allowed &&
  /暂停/.test(L.gate(p1, { sid: SID1, platformKey: 'workbuddy' }).reason));
const paused = L.aggregate(dir, { now: Date.now() });
ok('暂停后界面聚合如实标 blocked，不显示假在线',
  paused.summary.onlineSessions === 0 && paused.sessions.every((s) => s.state === 'blocked'));

const p2 = L.writePolicy(dir, { paused: false, blockedPlatforms: ['autoclaw'] });
ok('只禁用某平台时，其它平台仍可用',
  L.gate(p2, { sid: SID1, platformKey: 'workbuddy' }).allowed &&
  !L.gate(p2, { sid: SID2, platformKey: 'autoclaw' }).allowed);
const p3 = L.writePolicy(dir, { blockedPlatforms: [], revokedSessions: [SID2] });
ok('断开会话按 sid 精确生效', !L.gate(p3, { sid: SID2, platformKey: 'autoclaw' }).allowed);
const revoked = L.aggregate(dir, { now: Date.now() });
ok('被断开的会话在聚合里标 revoked 且不计在线',
  revoked.sessions.find((s) => s.sid === SID2).revoked === true &&
  revoked.sessions.find((s) => s.sid === SID2).online === false);

const p4 = L.writePolicy(dir, { revokedSessions: [], aliases: { workbuddy: '办公室的 WorkBuddy' } });
ok('别名写入策略且不丢失原有字段',
  p4.aliases.workbuddy === '办公室的 WorkBuddy' && p4.paused === false);
const aliased = L.aggregate(dir, { now: Date.now() });
ok('界面拿到自定义名并保留官方原名',
  aliased.platforms.find((p) => p.platformKey === 'workbuddy').platformLabel === '办公室的 WorkBuddy' &&
  aliased.platforms.find((p) => p.platformKey === 'workbuddy').sessions[0].platformOfficial === 'WorkBuddy');
ok('坏策略文件不导致崩溃（归一为默认）',
  (() => { fs.writeFileSync(path.join(dir, 'policy.json'), '{broken', 'utf8'); return L.readPolicy(dir).paused === false; })());
L.writePolicy(dir, { aliases: {} });

// ── [4] bye / 清除历史 / 裁剪 ─────────────────────────────────────────────
console.log('\n[4] 会话结束 / 清除历史 / 窗口裁剪');
L.record(dir, 'bye', { sid: SID2, reason: 'stdin 关闭', ...common });
const afterBye = L.aggregate(dir, { now: Date.now() });
ok('bye 后会话标离线并带结束原因',
  afterBye.sessions.find((s) => s.sid === SID2).state === 'offline' &&
  afterBye.sessions.find((s) => s.sid === SID2).endReason === 'stdin 关闭');
const cleared = L.clearHistory(dir);
ok('清除历史只删离线会话，在线会话不被抹掉',
  cleared.removed === 1 && !fs.existsSync(L.sessionFile(dir, SID2)) &&
  fs.existsSync(L.sessionFile(dir, SID1)));
for (let i = 0; i < 8; i++) {
  L.record(dir, 'hello', { sid: 'hist' + i, state: 'x', pid: 999999999, ...common });
}
const pruned = L.prune(dir);
ok('裁剪只在超过上限时生效（此处未超，返回 0）', pruned === 0);

// ── [5] 真实 stdio MCP Server 的跨进程链路 ───────────────────────────────
console.log('\n[5] 真实 MCP Server 子进程：登记 + 握手 + 策略拒绝工具调用');
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'neocosmos-mcp-vault-'));
fs.writeFileSync(path.join(vault, '测试卡片.md'), '# 测试卡片\n\n链接状态端到端验证。\n', 'utf8');
const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neocosmos-mcp-e2e-'));
const serverPath = path.join(ROOT, 'src', 'mcp', 'server.js');

function runServer(extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverPath, '--vault', vault, '--caller', 'workbuddy'], {
      cwd: ROOT,
      env: { ...process.env, NEOCOSMOS_LINK_DIR: linkDir, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    const results = [];
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
    const waitFor = () => new Promise((r) => setTimeout(r, 350));

    (async () => {
      await waitFor();
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'WorkBuddy', version: '5.9.3' },
        capabilities: {},
      } });
      send({ jsonrpc: '2.0', id: 2, method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kb_search', arguments: { query: '链接' } } });
      await waitFor();
      child.stdin.end();
      await new Promise((r) => child.on('close', r));
      for (const line of out.split('\n').filter(Boolean)) {
        try { results.push(JSON.parse(line)); } catch { /* 忽略非 JSON 行 */ }
      }
      resolve({ results, out, err, code: child.exitCode });
    })().catch((e) => resolve({ results, out, err, code: -1, error: String(e) }));
  });
}

const run = await runServer();
const init = run.results.find((r) => r.id === 1);
const tool = run.results.find((r) => r.id === 3);
ok('MCP Server 正常握手（登记逻辑未破坏协议）',
  !!init?.result?.protocolVersion && init.result.serverInfo?.name === 'neokb');
ok('工具调用仍正常返回（登记未拖垮 MCP 能力）',
  !!tool?.result && !tool?.error);

const e2eSessions = L.readSessions(linkDir);
ok('独立 Server 进程真实写入会话文件', e2eSessions.length >= 1,
  `(${e2eSessions.length} 条)`);
const e2e = e2eSessions[0] || {};
ok('握手自报的客户端身份跨进程落盘',
  e2e.clientName === 'WorkBuddy' && e2e.clientVersion === '5.9.3' &&
  e2e.platformKey === 'workbuddy' && e2e.identitySource === 'handshake' &&
  e2e.protocolVersion === '2025-06-18');
ok('协议版本 / 知识库 / 引擎版本如实记录',
  e2e.vault === vault && e2e.serverVersion === V && e2e.platform === process.platform, `(${V})`);
ok('会话结束时标记 offline', e2e.state === 'offline');
const e2eAgg = L.aggregate(linkDir, { now: Date.now() });
ok('主进程侧能聚合同一份跨进程登记',
  e2eAgg.platforms.some((p) => p.platformKey === 'workbuddy' && p.total >= 1));

// 暂停后重新起一个 Server，验证工具调用被真实拒绝
L.writePolicy(linkDir, { paused: true });
const blocked = await runServer();
const blockedTool = blocked.results.find((r) => r.id === 3);
ok('用户在界面点「暂停全部」后，独立 Server 的工具调用被真实拒绝',
  blockedTool?.error?.code === -32001 && /暂停/.test(blockedTool.error.message || ''),
  `(code=${blockedTool?.error?.code})`);
const blockedInit = blocked.results.find((r) => r.id === 1);
ok('握手仍放行（便于看到是谁在尝试接入）', !!blockedInit?.result?.protocolVersion);
const blockedSessions = L.readSessions(linkDir);
ok('被拦截次数真实落盘', blockedSessions.some((s) => (s.blockedCount || 0) >= 1));

// ── 清理 ──────────────────────────────────────────────────────────────────
for (const p of [dir, vault, linkDir]) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n========================================\nv6.23.1 MCP 链接状态契约测试：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
