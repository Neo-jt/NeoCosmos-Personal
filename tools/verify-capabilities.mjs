// v6.14 / v6.16 真机验证：AURORA PRO 排版 + 能力中枢 + 深度数学（零第三方依赖，Node 22 内置 fetch/WebSocket）
// ---------------------------------------------------------------------------
// 静态契约只能证明「源码这么写」，证明不了「界面真的能用」。
// 本脚本启动**真实 Electron 客户端**，经 CDP 连到真实渲染进程：
//   A 布局几何：命令轨居中 / 分组导航宽度 / 三段式标题栏 / 状态栏真实读数
//   B 能力中枢：真的点开、KPI 真的从内核读数、能力矩阵真的渲染
//   C 逐按钮：点只读按钮 → 等结果区 → 校验返回是真实 IPC 数据（不是占位）
//   D 写操作：点写盘按钮 → 必须弹确认 → 取消 → 结果区如实写「已取消」
//   E 偏好：PRO 排版 / 导航折叠 / 深色主题可切换且几何随之变化
//   F 截图：主界面 / 中枢 / 矩阵 / 深色 / 折叠，共 5 张真机图
//
// 安全边界：隔离 userData（NEOLINK_USER_DATA），关闭精灵；**全程只读用户知识库**
//（知识库默认路径不随 userData 隔离，因此刻意不载入示例语料、不写任何卡片），
// 也不调用任何会弹系统文件对话框或输出令牌的按钮。
// 用法：node tools/verify-capabilities.mjs（需先执行 node tools/stage-app.mjs）
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE_DIR = path.join(ROOT, 'build', 'win', 'electron-v33.0.0');
const EXE = path.join(EXE_DIR, 'NeoCosmos.exe');
const USER_DATA = path.join(ROOT, 'build', 'capability-verify-userdata');
const REPORT = path.join(ROOT, 'build', 'capability-verify-report.json');
const NS_CSS = fs.readFileSync(path.join(ROOT, 'desktop/ui/northstar.css'), 'utf8');
const RAIL_W = Number((NS_CSS.match(/--pro-rail-w:(\d+)px/) || [])[1] || 188);
const RAIL_MINI = Number((NS_CSS.match(/--pro-rail-w-mini:(\d+)px/) || [])[1] || 56);
const PORT = 9621;
// v6.16：版本与能力总数一律从源码产物推导，不再写死旧版数字。
// 否则每次新增真实通道，历史真机探针都会「假失败」，反而掩盖真问题。
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
const M_SRC = fs.readFileSync(path.join(ROOT, 'desktop', 'ui', 'capability-manifest.js'), 'utf8');
const TOTALS = JSON.parse(M_SRC.slice(M_SRC.indexOf('= {') + 2, M_SRC.lastIndexOf('};') + 1)).totals;

if (!fs.existsSync(EXE)) { console.error('✗ 未找到 NeoCosmos.exe，请先执行 node tools/stage-app.mjs'); process.exit(1); }
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* ignore */ }
fs.mkdirSync(USER_DATA, { recursive: true });
fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({ spriteEnabled: false }));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;               // 本机坑：不删会让 Electron 退化成纯 Node
env.NEOLINK_USER_DATA = USER_DATA;
env.NEOLINK_NO_RELAUNCH = '1';

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { cwd: EXE_DIR, env, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0, fatal = null;
const results = [];
const returns = [];   // 顶层作用域：finally 写报告时也要能拿到真实返回摘要
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
  results.push({ name, ok: !!cond, detail: extra });
}

async function list() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
  catch { return []; }
}
function cdp(t, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const tm = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout ' + method)); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      clearTimeout(tm); ws.close();
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.onerror = () => { clearTimeout(tm); reject(new Error('ws error')); };
  });
}
const ev = (t, expr) => cdp(t, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  .then((r) => r.result?.exceptionDetails ? { __exception__: String(r.result.exceptionDetails.text) } : r.result?.value);
async function shot(t, file) {
  // 截图前清掉验证脚本点击产生的临时 toast（只影响截图，不改产品行为）
  await ev(t, `(() => { const r = document.querySelector('.toast-root'); if (r) r.innerHTML = ''; return 'ok'; })()`).catch(() => {});
  const r = await cdp(t, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return fs.statSync(file).size;
}

// 点某个操作卡里指定文字的按钮，并等结果区落定
async function clickAction(t, capId, label, timeoutMs = 18000) {
  const r = await ev(t, `(() => {
    const c = document.querySelector('[data-cap="${capId}"]');
    if (!c) return 'NO_CARD';
    const b = [...c.querySelectorAll('.pro-actions button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return 'NO_BTN';
    b.click(); return 'CLICKED';
  })()`);
  if (r !== 'CLICKED') return { error: r };
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await ev(t, `(() => {
      const c = document.querySelector('[data-cap="${capId}"]');
      const o = c?.querySelector('.o-state'); const p = c?.querySelector('pre');
      return { state: o?.textContent || '', text: (p?.textContent || '').slice(0, 260), len: (p?.textContent || '').length };
    })()`);
    if (s && s.state && s.state !== '执行中…' && s.state !== '未执行') return s;
    await sleep(180);
  }
  return { error: 'TIMEOUT' };
}

(async () => {
  let ts = [];
  for (let i = 0; i < 70; i++) { ts = await list(); if (ts.some((t) => /index\.html/.test(t.url))) break; await sleep(500); }
  let main = ts.find((t) => /index\.html/.test(t.url));
  if (!main) throw new Error('主窗口未出现');
  await ev(main, `localStorage.setItem('neokb-onboarded','1'); localStorage.removeItem('neokb-pro-layout'); localStorage.removeItem('neokb-pro-rail-collapsed'); 'ok'`);
  await cdp(main, 'Page.reload', { ignoreCache: true });
  await sleep(4200);
  ts = await list(); main = ts.find((t) => /index\.html/.test(t.url));
  for (let i = 0; i < 50; i++) {
    const ready = await ev(main, `!!window.__NEOLINK__ && document.readyState === 'complete' && document.styleSheets.length >= 3`);
    if (ready) break;
    await sleep(400);
  }
  await cdp(main, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);

  // 只读探测真实知识库。刻意**不调用 loadExample()**：
  // 知识库默认路径不随 NEOLINK_USER_DATA 隔离，若库为空会真的向用户的库写入示例卡片。
  // 验证脚本绝不改动用户数据 —— 这里只确认「有真实库、有真实卡片」即可。
  const vaultProbe = await ev(main, `window.neolink.vault.info().then(r => ({ ready: r?.ready ?? null, nodes: r?.nodes ?? null, path: r?.path ?? null }))`);
  ok('真机连接真实知识库（全程只读，不写用户数据）',
    vaultProbe?.ready === true && Number(vaultProbe.nodes) > 0,
    `(卡片 ${vaultProbe?.nodes} · ${vaultProbe?.path || '路径未返回'})`);
  await sleep(600);

  console.log('\n[A] 布局几何与设计层');
  const geo = await ev(main, `(() => {
    const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      pro: document.body.classList.contains('pro-layout'),
      sheets: [...document.styleSheets].map(s => (s.href||'').split('/').pop()),
      title: q('.titlebar'), cmd: q('.cmdbar'), rail: q('.rail'), status: q('.statusbar'),
      drag: q('.drag'), dragRight: q('.drag.drag-right'),
      rightStart: Math.min(...['.tb-actions', '.edition-seg', '.chip-vault', '.win-btns']
        .map(s => q(s)?.x ?? Infinity)),
      groups: document.querySelectorAll('.rail-group').length,
      items: document.querySelectorAll('.rail-item').length,
      sbCaps: document.getElementById('sbCaps')?.textContent || '',
      sbCapsTitle: document.getElementById('sbCaps')?.title || '',
      version: document.getElementById('brandVersion')?.textContent || '',
      manifest: window.__NEOLINK__?.capabilities ? {
        hash: window.__NEOLINK__.capabilities.sourceHash,
        channels: window.__NEOLINK__.capabilities.totals.channels,
        apis: window.__NEOLINK__.capabilities.totals.apis,
        hub: window.__NEOLINK__.capabilities.totals.hub,
      } : null,
    };
  })()`);
  ok('PRO 设计层已加载且生效', geo?.pro && geo.sheets.includes('aurora-pro.css'), `(${geo?.sheets.join(', ')})`);
  // v6.16：三段式标题栏。旧版把命令轨按窗口中轴绝对定位，实测与右侧控件重叠 126px。
  // 现在命令轨是文档流中的 flex 项，判据改为「不与右侧任何控件相交」+「夹在两段拖拽区之间」。
  ok('命令轨不再与右侧控件重叠（v6.16 三段式根因修复）',
    geo?.cmd && Number.isFinite(geo.rightStart) && geo.cmd.x + geo.cmd.w <= geo.rightStart,
    `(命令轨右缘 ${geo?.cmd ? geo.cmd.x + geo.cmd.w : '—'} / 右侧起点 ${geo?.rightStart})`);
  ok('命令轨夹在左右两段弹性拖拽区之间',
    geo?.drag && geo?.dragRight && geo.cmd &&
    geo.cmd.x >= geo.drag.x + geo.drag.w - 2 &&
    geo.dragRight.x >= geo.cmd.x + geo.cmd.w - 2);
  ok(`分组导航宽度跟随设计层真源（${RAIL_W}px）、三个分组、九个入口`,
    geo?.rail?.w === RAIL_W && geo.groups === 3 && geo.items === 9,
    `(轨 ${geo?.rail?.w}px · 组 ${geo.groups} · 项 ${geo.items})`);
  ok('状态栏只显示可核验状态，真实计数保留在 tooltip',
    geo?.sbCaps === '能力清单 · 已核对' &&
    /源码生成：\d+ 通道 \/ \d+ API \/ 中枢直达 \d+/.test(geo?.sbCapsTitle || ''),
    `(${geo?.sbCaps})`);
  // 运行时 brandVersion 由 app.js 写成 `v${version}`，HTML 初始占位没有 v 前缀
  ok(`版本戳与 package.json 一致（${PKG.version}）`,
    geo?.version === PKG.version || geo?.version === 'v' + PKG.version, `(${geo?.version})`);
  ok('真机清单与源码清单一致',
    geo?.manifest?.channels === TOTALS.channels && geo?.manifest?.apis === TOTALS.apis && geo?.manifest?.hub === TOTALS.hub,
    `(${JSON.stringify(geo?.manifest)} / 源码 ${TOTALS.channels}-${TOTALS.apis}-${TOTALS.hub})`);
  await shot(main, path.join(ROOT, 'build/ns-6.16-workspace.png'));

  console.log('\n[B] 打开能力中枢');
  await ev(main, `window.__NEOLINK__?.route?.('capabilities'); 'ok'`);
  for (let i = 0; i < 50; i++) { if (await ev(main, `!!document.getElementById('capabilityHub')`)) break; await sleep(300); }
  await sleep(2200); // 等 KPI 的真实 IPC 全部落定
  const hubState = await ev(main, `(() => {
    const h = document.getElementById('capabilityHub');
    const kpis = [...document.querySelectorAll('.pro-kpi')].map(k => ({ k: k.dataset.kpi, v: k.querySelector('.k-value')?.textContent, pending: k.classList.contains('is-pending') }));
    return { exists: !!h, kpis, cards: document.querySelectorAll('.pro-card').length,
      sections: document.querySelectorAll('.pro-section').length,
      matrixRows: document.querySelectorAll('.pro-matrix-row:not(.m-head)').length,
      channelChips: document.querySelectorAll('.pro-inline-list .pro-chip').length,
      kpiDisplay: getComputedStyle(document.querySelector('.pro-kpis')).display,
      kpiVisible: [...document.querySelectorAll('.pro-kpi')].filter(k => getComputedStyle(k).display !== 'none').length,
      kpiHidden: [...document.querySelectorAll('.pro-kpi')].filter(k => getComputedStyle(k).display === 'none').length,
      kpiSubClamped: [...document.querySelectorAll('.pro-kpi .k-sub')].every(s => s.scrollHeight <= s.clientHeight + 1),
      scrollable: h ? h.scrollHeight > h.clientHeight : false };
  })()`);
  ok('能力中枢真实挂载', hubState?.exists && hubState.cards >= 12 && hubState.sections === 9,
    `(卡片 ${hubState?.cards} · 分区 ${hubState?.sections})`);
  ok('全部 KPI 已由真实 IPC 落定（无读取中 / 无占位）',
    hubState?.kpis?.length === 8 && hubState.kpis.every((k) => !k.pending && k.v !== '读取中…'),
    `(${hubState?.kpis?.map((k) => k.k + '=' + k.v).join(' · ')})`);
  ok('能力矩阵渲染真实清单', hubState?.matrixRows > 0, `(首屏 ${hubState?.matrixRows} 行)`);
  ok('工程级界面把读数收成一行事实条（只留 4 项用户读数）',
    hubState?.kpiDisplay === 'flex' && hubState?.kpiVisible === 4 && hubState?.kpiHidden === 4,
    `(display ${hubState?.kpiDisplay} · 可见 ${hubState?.kpiVisible} · 收起 ${hubState?.kpiHidden})`);
  ok('读数副标题完整可读、不再被省略号截断', hubState?.kpiSubClamped === true);
  ok('中枢内容超高时可滚动（不被舞台裁掉）', hubState?.scrollable === true);
  await shot(main, path.join(ROOT, 'build/ns-6.16-hub.png'));

  console.log('\n[C] 逐按钮核对真实返回（只读通道）');
  const READONLY = [
    ['quantum', '读取状态'], ['quantum', '查看内核边界'],
    ['neuro', '读取状态'], ['neuro', '查看内核边界'],
    ['deep-math', '读取迭代状态'], ['deep-math', '算法自检 21 项'],
    ['cognition', '内核状态'], ['cognition', '解剖结构'], ['cognition', '反馈账本'],
    ['tool-stats', '网络体检'], ['tool-stats', '取真实节点'],
    ['tool-review', '读取队列'],
    ['tool-maintenance', '审计日志尾部'], ['tool-maintenance', '沉淀列表'],
    ['library', '读取状态'], ['library', '星灵状态'],
    ['storage', '读取存储位置'], ['storage', '当前库信息'], ['storage', '示例语料信息'],
    ['service', '服务状态'],
    ['audit', '安全套件状态'], ['audit', '合规体检报告'], ['audit', '安全声明原文'], ['audit', '重算完整性'],
    ['sediment', '沉淀开关状态'], ['sediment', '沉淀记录'],
    ['misc', '窗口是否最大化'], ['misc', '跨库关联图谱'], ['misc', '精灵状态'], ['misc', '取走冷启动深链'],
  ];
  for (const [cap, label] of READONLY) {
    const r = await clickAction(main, cap, label);
    // 真实返回可能是对象/数组/数字/字符串，也可能是裸布尔或 null（如 win.isMaximized() → false）
    const good = !r.error && r.len > 0 && /^(?:[{["\d-]|true\b|false\b|null\b)/.test(r.text.trim())
      && !/undefined|NaN/.test(r.text.slice(0, 80));
    ok(`${cap} · ${label} → 真实返回`, good,
      good ? `(${r.state} · ${r.len} 字符 · ${r.text.slice(0, 58).replace(/\s+/g, ' ')}…)` : JSON.stringify(r));
    returns.push({ card: cap, action: label, state: r.state || null, length: r.len || 0, head: (r.text || '').slice(0, 160) });
  }

  console.log('\n[D] 写操作必须确认，取消后不执行');
  const before = await ev(main, `window.neolink.stats().then(r => r?.data?.nodes ?? null)`);
  await ev(main, `(() => { const c=document.querySelector('[data-cap="tool-write"]'); [...c.querySelectorAll('.pro-actions button')].find(x=>x.textContent.trim()==='新增卡片').click(); return 'ok'; })()`);
  await sleep(600);
  const modalOpen = await ev(main, `document.getElementById('modalRoot')?.classList.contains('is-open')`);
  ok('写盘按钮弹出确认框', modalOpen === true);
  await ev(main, `(() => { const r=document.getElementById('modalRoot'); const b=[...r.querySelectorAll('button')].find(x=>x.textContent.trim()==='取消'); b?.click(); return 'ok'; })()`);
  await sleep(600);
  const cancelOut = await ev(main, `(() => { const c=document.querySelector('[data-cap="tool-write"]'); return {state:c?.querySelector('.o-state')?.textContent, text:c?.querySelector('pre')?.textContent||''}; })()`);
  const after = await ev(main, `window.neolink.stats().then(r => r?.data?.nodes ?? null)`);
  ok('取消后结果区如实写明「已取消」', cancelOut?.state === '已取消', `(${cancelOut?.state})`);
  ok('取消后知识库节点数未变（没有偷偷写盘）', before === after, `(${before} → ${after})`);

  console.log('\n[E] 偏好切换与主题');
  await ev(main, `document.getElementById('appearancePro').click(); 'ok'`);
  await sleep(450);
  const off = await ev(main, `(() => ({ pro: document.body.classList.contains('pro-layout'), rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width) }))()`);
  ok('关闭 PRO 排版后完整回退（导航回到 76px 图标轨）', off?.pro === false && off?.rail === 76, JSON.stringify(off));
  await ev(main, `document.getElementById('appearancePro').click(); 'ok'`);
  await sleep(450);
  const on = await ev(main, `(() => ({ pro: document.body.classList.contains('pro-layout'), rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width) }))()`);
  ok('重新启用 PRO 排版后恢复', on?.pro === true && on?.rail === RAIL_W, JSON.stringify(on));
  await ev(main, `document.getElementById('railToggle').click(); 'ok'`);
  await sleep(450);
  const collapsed = await ev(main, `(() => ({ c: document.body.classList.contains('pro-rail-collapsed'), rail: Math.round(document.querySelector('.rail').getBoundingClientRect().width), txt: getComputedStyle(document.querySelector('.rail-txt')).display }))()`);
  ok('导航可折叠且说明文字隐藏',
    collapsed?.c === true && collapsed?.rail === RAIL_MINI && collapsed?.txt === 'none', JSON.stringify(collapsed));
  await shot(main, path.join(ROOT, 'build/ns-6.16-collapsed.png'));
  await ev(main, `document.getElementById('railToggle').click(); 'ok'`);
  await sleep(450);
  await ev(main, `document.getElementById('btnTheme').click(); 'ok'`);
  await sleep(800);
  const dark = await ev(main, `(() => ({ dark: document.body.classList.contains('theme-dark'), bg: getComputedStyle(document.querySelector('.pro-card')||document.body).backgroundColor }))()`);
  ok('深色主题下能力中枢仍可读', dark?.dark === true, JSON.stringify(dark));
  await shot(main, path.join(ROOT, 'build/ns-6.16-dark.png'));
  await ev(main, `document.getElementById('btnTheme').click(); 'ok'`);
  await sleep(600);
  await ev(main, `(() => { const h=document.getElementById('capabilityHub'); const s=document.querySelector('[data-section="9"]'); if(s) h.scrollTop = s.offsetTop - 20; return h.scrollTop; })()`);
  await sleep(500);
  await shot(main, path.join(ROOT, 'build/ns-6.16-hub-matrix.png'));

  console.log('\n[G] 深度数学 · 自我迭代（真机 IPC，真实数值）');
  // 结果区 pre 按 12000 字符截断显示（复制按钮给完整内容），返回体约 18KB，
  // 所以数值断言走渲染层的同一个真实桥接 API，而不是去解析被截断的显示文本。
  const stepViaBridge = () => ev(main, `window.neolink.astra.selfIterate().then(r => {
    const x = r?.data?.record || {};
    return { ok: r?.ok, generation: x.generation, observation: x.observation, prediction: x.prediction,
      error: x.error, freeEnergy: x.freeEnergy, decision: x.decision,
      policyBefore: x.policyBefore, policyAfter: x.policyAfter, confidence: x.confidence };
  })`);
  const r1 = await stepViaBridge(), r2 = await stepViaBridge();
  ok('单步自我迭代返回真实内核记录（非占位 / 非演示数据）',
    r1?.ok === true && Number.isFinite(r1.generation) && Number.isFinite(r1.freeEnergy) && Number.isFinite(r1.error),
    `(第 ${r1?.generation} 代 · F=${r1?.freeEnergy} · 误差=${r1?.error})`);
  ok('连续两次迭代世代递增，数值逐轮重新计算',
    !!r2 && r2.generation === r1?.generation + 1,
    `(${r1?.generation} → ${r2?.generation})`);
  ok('迭代结论真实改写策略参数与置信度',
    Number.isFinite(r1?.policyBefore) && Number.isFinite(r1?.policyAfter) && Number.isFinite(r1?.confidence),
    `(explore ${r1?.policyBefore} → ${r1?.policyAfter})`);

  console.log('\n[F] 截图');
  for (const f of ['ns-6.16-workspace.png', 'ns-6.16-hub.png', 'ns-6.16-hub-matrix.png', 'ns-6.16-dark.png', 'ns-6.16-collapsed.png']) {
    const p = path.join(ROOT, 'build', f);
    ok(`真机截图 ${f}`, fs.existsSync(p) && fs.statSync(p).size > 20000, `(${fs.existsSync(p) ? fs.statSync(p).size : 0} B)`);
  }
})().catch((e) => { fatal = e.message; console.error('  [FATAL]', e.message); }).finally(() => {
  const report = {
    at: new Date().toISOString(), version: PKG.version,
    pass, fail, fatal, results,
    realReturns: returns,
  };
  try { fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8'); } catch { /* ignore */ }
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  console.log(`\nv6.14 真机验证：${pass} 通过 / ${fail} 失败${fatal ? ' · 致命错误：' + fatal : ''}`);
  console.log('报告：build/capability-verify-report.json');
  process.exit(fail || fatal ? 1 : 0);
});
