// v6.35.0 契约：三项原创导航 / 设置页 / 移除接入防复活 / id 三维坐标体系
// 全部从真实源码抽取并忠实执行，禁止放水断言；测试夹具用临时目录（非产品内置数据）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const V = JSON.parse(read('package.json')).version;

test('版本真源不低于 6.35.0，三处同步', () => {
  const vs = V.split('.').map(Number);
  assert.ok(vs[0] > 6 || (vs[0] === 6 && vs[1] >= 35), `版本过低：${V}`);
  assert.equal(JSON.parse(read('desktop/package.json')).version, V);
  assert.ok(read('tools/installer.nsi').includes(`"${V}"`));
});

// ---------- 三项导航 ----------
test('左侧导航只有 星图 / 工作区 / 设置 三项', () => {
  const html = read('desktop/ui/index.html');
  const views = [...html.matchAll(/class="rail-item[^"]*"[^>]*data-view="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(views.sort(), ['graph', 'settings', 'workspace']);
});

test('设置按钮独立置于 rail-scroll 之外（底部系统层）', () => {
  const html = read('desktop/ui/index.html');
  const scrollEnd = html.indexOf('/rail-scroll');
  const settingsPos = html.indexOf('data-view="settings"');
  assert.ok(settingsPos > scrollEnd, '设置按钮应在滚动导航区之后');
});

test('被移出导航的功能全部保留 OVERLAY 路由（能力中枢仅内部自检保留）', () => {
  const app = read('desktop/ui/app.js');
  for (const key of ['ask', 'astra', 'settle', 'consolidate', 'atlas', 'enterprise',
    'neolm', 'semantic', 'capabilities', 'team', 'vaults', 'console', 'mind3d', 'settings']) {
    assert.ok(new RegExp(`\\b${key}:\\s*\\{\\s*loader:`).test(app), `OVERLAY 缺 ${key}`);
  }
  // v10.18.8：能力中枢路由仍在，但用户可见入口全部撤下。
  const s = read('desktop/ui/views/settings.js');
  assert.ok(!s.includes("key: 'capabilities'") && !s.includes('查看能力中枢'));
});

test('命令面板含被移出功能的直达命令', () => {
  const app = read('desktop/ui/app.js');
  for (const label of ['设置（', '问一问（', '自主引擎（', '本地语言模型（', '语义关联（']) {
    assert.ok(app.includes(label), `命令面板缺 ${label}`);
  }
});

// ---------- 原创设置页 ----------
test('设置页为原创四类结构，且全部入口指向真实路由', () => {
  const s = read('desktop/ui/views/settings.js');
  for (const sec of ['graph', 'service', 'vault', 'about']) {
    assert.ok(s.includes(`key: '${sec}'`), `设置页缺分类 ${sec}`);
  }
  assert.ok(!s.includes("key: 'appearance'"), '外观分类已按用户要求移除');
  assert.ok(s.includes("key: 'ask'") && !s.includes("key: 'capabilities'"));
  assert.ok(s.includes('mountSettings'));
});

test('外观只在标题栏保留唯一入口，设置页不再重复', () => {
  const s = read('desktop/ui/views/settings.js');
  const html = read('desktop/ui/index.html');
  assert.ok(!s.includes('appearance?.open?.()'));
  assert.ok(!s.includes('appearance?.state?.()'));
  assert.ok(html.includes('id="btnAppearance"'), '标题栏外观入口保留');
  assert.ok(!/localStorage/.test(s), '设置页不得自建并行状态');
});

test('设置页读数为真实来源，无示例值', () => {
  const s = read('desktop/ui/views/settings.js');
  assert.ok(s.includes('CAPABILITY_MANIFEST'));
  assert.ok(s.includes("document.getElementById('brandVersion')"));
  // 只查可见字符串字面量，不查声明性注释（注释里写了"不填充示例值"是正确纪律）
  const visible = s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/示例值：|demo\s*[:=]|mock\s*[:=]/.test(visible));
});

// ---------- UI 品牌清除 ----------
test('UI 用户可见层零第三方品牌字样', () => {
  const files = fs.readdirSync(path.join(ROOT, 'desktop/ui/views')).map((f) => `desktop/ui/views/${f}`)
    .concat(['desktop/ui/index.html', 'desktop/ui/app.js', 'desktop/ui/cosmos.js']);
  const bad = /obsidian|workbuddy|autoclaw|openclaw|claude[ -]?desktop/i;
  for (const f of files) {
    const text = read(f);
    // 排除注释行与 CSS cursor 误报后，可见文案不得命中
    const visible = text.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    assert.ok(!bad.test(visible), `${f} 仍有品牌字样`);
  }
});

// ---------- id 三维坐标体系 ----------
test('idCoordinate 从源码抽取执行：确定性 / 有界 / 无随机', () => {
  const cosmos = read('desktop/ui/cosmos.js');
  const start = cosmos.indexOf('export function idCoordinate');
  const end = cosmos.indexOf('\nexport const LAYOUT_MODES', start);
  assert.ok(start > 0 && end > start, 'cosmos.js 缺 idCoordinate 定义');
  let body = cosmos.slice(start, end).replace('export function', 'function');
  const fn = new Function(`${body}; return idCoordinate;`)();

  const a = fn('node-abc', 100);
  const b = fn('node-abc', 100);
  assert.deepEqual(a, b, '同一 id 必须产出同一坐标');
  assert.notDeepEqual(fn('node-abc', 100), fn('node-def', 100), '不同 id 坐标应不同');
  assert.equal(a.length, 3);
  assert.ok(a.every(Number.isFinite), '坐标必须有限数');
  assert.ok(Math.hypot(...a) <= 100 + 1e-6, '坐标不得超出半径');
  // 零随机：源码函数体内不得出现 Math.random
  assert.ok(!/Math\.random/.test(body), 'id 坐标不得用随机');
});

test('星位为默认布局且登记在 LAYOUT_MODES', () => {
  const graph = read('desktop/ui/views/graph.js');
  assert.ok(/let layoutMode = 'idspace'/.test(graph));
  const cosmos = read('desktop/ui/cosmos.js');
  assert.ok(cosmos.includes("{ key: 'idspace'"));
  assert.ok(cosmos.includes("mode === 'idspace'"));
});

// ---------- 移除接入（真实夹具） ----------
test('移除接入：删除登记 + 墓碑防心跳复活 + 恢复后可再登记', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-v635-'));
  const prev = process.env.NEOCOSMOS_LINK_DIR;
  process.env.NEOCOSMOS_LINK_DIR = dir;
  try {
    const m = require(path.join(ROOT, 'desktop/mcp-links.cjs'));
    m.record(dir, 'hello', { sid: 'sessA', platformKey: 'p1', platformLabel: 'P1', pid: 999991 });
    m.record(dir, 'hello', { sid: 'sessB', platformKey: 'p2', platformLabel: 'P2', pid: 999992 });
    const r = m.removeSessions(dir, { scope: 'platform', platformKey: 'p1' });
    assert.equal(r.removed, 1);
    assert.equal(m.readSessions(dir).some((s) => s.sid === 'sessA'), false);
    // 在线进程心跳不得复活
    assert.equal(m.record(dir, 'heartbeat', { sid: 'sessA', platformKey: 'p1', pid: 999991 }), null);
    assert.equal(m.gate(m.readPolicy(dir), { sid: 'sessA', platformKey: 'p1' }).allowed, false);
    // 正常平台不受影响
    assert.ok(m.record(dir, 'heartbeat', { sid: 'sessB', platformKey: 'p2', pid: 999992 }));
    // 恢复后 p1 可再次登记
    m.restoreRemoved(dir, { platformKey: 'p1' });
    assert.ok(m.record(dir, 'heartbeat', { sid: 'sessA', platformKey: 'p1', pid: 999991 }));
  } finally {
    if (prev == null) delete process.env.NEOCOSMOS_LINK_DIR;
    else process.env.NEOCOSMOS_LINK_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('移除接入 IPC 与 preload 桥接真实存在', () => {
  const main = read('desktop/main.js');
  const pre = read('desktop/preload.js');
  assert.ok(main.includes("ipcMain.handle('mcp:link-remove'"));
  assert.ok(main.includes("ipcMain.handle('mcp:link-restore'"));
  assert.ok(pre.includes("remove: (opts) => ipcRenderer.invoke('mcp:link-remove', opts)"));
  assert.ok(pre.includes("restore: (opts) => ipcRenderer.invoke('mcp:link-restore', opts)"));
});

test('接入知识库按会话分行显示，不再拼接成一行', () => {
  const p = read('desktop/ui/views/mcp-links-panel.js');
  assert.ok(p.includes('知识库：${s.vault}'));
  assert.ok(!p.includes("p.vaults.join(' · ')"));
});
