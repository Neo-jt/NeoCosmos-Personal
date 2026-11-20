// NeoLink 桌面版 · 工作区控制器
// ---------------------------------------------------------------------------
// 信息架构见 docs/spec/04-workspace.md：
//   工作区 = 星图导航台（左） + 文档台（中） + 关联卡片栏（右）
//   星图为全屏的卡片管理网络；沉淀是 Agent 经 Skill/MCP 回写的控制台。
//
// v1.2.0（原创设计，借鉴原则不复刻界面）：
//  · 命令面板升级：Ctrl K = 卡片检索 + 命令执行（输入 > 只看命令）
//  · 闪念速记 Ctrl+Shift+K：一秒写进工作记忆收件箱
//  · 双主题：深空（默认）/ 纸白（日光与投影场景），标题栏一键切换
//  · 信息密度：舒适 / 紧凑（企业高信息场景）
//  · 首次引导 + F1 快捷键速查 —— 简单操作
//  · v1.1.0 全部能力保留：多知识库 / 跨库关联 / 脏状态守卫 / 自动感知
// ---------------------------------------------------------------------------
import { h, toast, status, latency, fmtTime, modal, confirmDialog, dropdown, icon, copyToClipboard, emptyState } from './ui-kit.js';
// v6.38.0：原创增强——卡片收藏与近期的单一数据源（纯前端 / localStorage）。
import { cardTools } from './card-tools.js';
import { createAppearance } from './appearance.js';
import { mountExplorer } from './views/explorer.js';
import { mountDocument } from './views/document.js';
import { mountRelations } from './views/relations.js';
// v7.0.0：版本形态锁（构建期由 tools/stage-app.mjs 写死：both / personal / enterprise）。
// 默认 'both' —— 应用内可自由切换个人版 / 企业版；锁死后隐藏切换器。
import { EDITION_LOCK } from './edition-lock.js';
// v6.14：能力清单由 tools/gen-capability-manifest.mjs 从 main.js / preload.js /
// 渲染层源码自动生成，界面只读产物，绝不手写能力列表。
import { CAPABILITY_MANIFEST } from './capability-manifest.js';

const api = window.neolink;

// ── v6.14 AURORA PRO：排版层与导航折叠 ────────────────────────────────────
// PRO 默认在 index.html 的 <body class="pro-layout"> 上开启（首屏零闪烁），
// 这里只按 localStorage 偏好关闭/恢复；关掉后所有 pro-layout 规则失效，
// 界面完整回退到 6.13 观感，功能零影响。
const PRO_LAYOUT_KEY = 'neokb-pro-layout';
const PRO_RAIL_KEY = 'neokb-pro-rail-collapsed';
function applyProLayout() {
  const on = localStorage.getItem(PRO_LAYOUT_KEY) !== '0';
  document.body.classList.toggle('pro-layout', on);
  const collapsed = localStorage.getItem(PRO_RAIL_KEY) === '1';
  document.body.classList.toggle('pro-rail-collapsed', collapsed);
  const sw = document.getElementById('appearancePro');
  if (sw) { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); }
  const tg = document.getElementById('railToggle');
  if (tg) {
    tg.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const label = tg.querySelector('span');
    if (label) label.textContent = collapsed ? '展开导航' : '收起导航';
  }
}
applyProLayout();

// ── v6.16 NORTHSTAR：工程级界面 ───────────────────────────────────────────
// 与 PRO 层一样是独立叠加层：移除 ns-layout 即完整回退到 6.15 观感。
// 这里只负责偏好持久化，不参与任何数据流。
const NS_LAYOUT_KEY = 'neokb-ns-layout';
function applyNorthstarLayout() {
  const on = localStorage.getItem(NS_LAYOUT_KEY) !== '0';
  document.body.classList.toggle('ns-layout', on);
  const sw = document.getElementById('appearanceNorthstar');
  if (sw) { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); }
}
applyNorthstarLayout();

// ── v6.21.0 Quiet Cosmos v7：第四代视觉层 ─────────────────────────────────
// 与 PRO / NORTHSTAR 相同的独立叠加层纪律：index.html 的 body 默认带 neo-v2
// （首屏零闪烁），这里只按已保存偏好关闭 / 恢复；关掉后全部 v7 规则失效，
// 界面完整回退到 6.20 观感，不改动任何数据流或功能。
const V7_LAYOUT_KEY = 'neokb-v7-layout';
function applyV7Layout() {
  const on = localStorage.getItem(V7_LAYOUT_KEY) !== '0';
  document.body.classList.toggle('neo-v2', on);
  const sw = document.getElementById('appearanceV7');
  if (sw) { sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); }
}
applyV7Layout();

const app = {
  info: null,
  vault: null,
  graph: null,
  currentId: null,
  cardTools,        // v6.38.0：收藏/近期单一数据源
  history: [],      // 导航历史（联想轨迹）
  hIndex: -1,
  listeners: new Set(),
  // v2.2.0：全局"正在取数"计数。
  // 审计（以及任何需要"界面已稳定"的自动化）要能判断"现在还有没有异步工作在跑"。
  // 原先只能靠等固定时长，既等不准（慢的时候不够）又等得久（快的时候白等）。
  // 各视图在取数期间 +1、结束 -1，外部读 app.loading 即可知道是否已安定。
  loading: 0,
  guardDirty: null, // 由文档台注册：返回 Promise<boolean>，false 表示取消导航
  // v2.3.0：文档台注册「当前卡片是否有未保存修改」+ 卡片名，
  // 供关闭确认框如实描述状态（没有它就只能写"当前卡片"，等于没说实话）。
  dirtyState: () => ({ dirty: false, title: '' }),
  on(fn) { app.listeners.add(fn); return () => app.listeners.delete(fn); },
  /** 标记一次异步取数开始（返回的函数用于标记结束） */
  beginLoad() { app.loading++; return () => { app.loading = Math.max(0, app.loading - 1); }; },
  emit(kind, payload) {
    // 事件总线隔离：单个面板的故障只影响自己，绝不殃及其它面板（v1.2.1）
    for (const fn of app.listeners) {
      try { fn(kind, payload); }
      catch (e) { console.error('[app] 面板刷新失败:', kind, e); status('界面局部刷新失败：' + String(e?.message || e)); }
    }
  },

  async refreshVault() {
    app.vault = await api.vault.info();
    app.graph = null;
    app.graphKey = null;
    updateMetrics();
    app.emit('vault', app.vault);
    return app.vault;
  },
  async graphData(force = false, opts = {}) {
    // v2.1.0：按层级缓存（总览 / 全量 / 领域 / 焦点是四份不同的载荷）
    const key = opts.level || 'auto';
    if (!app.graph || app.graphKey !== key || force) {
      const t0 = performance.now();
      app.graph = await api.graph({ force, ...opts });
      app.graphKey = key;
      latency(Math.round(performance.now() - t0));
    }
    return app.graph;
  },

  /** 打开一张卡片：驱动文档台 + 关联卡片栏 + 状态栏 */
  async openCard(id, opts = {}) {
    if (!id) return;
    // v4.1.0：引用验证溯源 —— 打开卡片时携带"被具体引用的片段"，文档台渲染后高亮定位
    if (opts.highlight !== undefined) app.pendingHighlight = opts.highlight || null;
    if (id !== app.currentId && app.guardDirty) {
      let go = true;
      try { go = await app.guardDirty(); }
      catch (e) {
        // v6.9.0：脏状态守卫自身抛错时，过去是「当作允许」继续跳转 ——
        // 恰恰在守卫失灵的那一刻把未保存的正文丢掉了。改为保守取消并明确告知。
        console.error('[app] 脏状态守卫异常，已阻止跳转:', e);
        toast('无法确认当前修改是否已保存，已取消跳转。请先手动保存。', 'err', 5000);
        go = false;
      }
      if (go === false) return;
    }
    app.currentId = id;
    // v6.20：状态栏「当前选中」此前只有能力中枢写过，文档台 / 星图打开卡片时
    // 永远停在「未选中卡片」。这里统一按真实卡片 id 更新。
    setSelected(id || '—');
    if (opts.push !== false) {
      if (app.hIndex < app.history.length - 1) app.history.length = app.hIndex + 1;
      if (app.history[app.hIndex] !== id) {
        app.history.push(id);
        if (app.history.length > 120) app.history.shift();
        app.hIndex = app.history.length - 1;
      }
    }
    // v6.11：阅读行为进入行为内核感知（不写任何用户文件）
    try {
      const p = api.astra?.perceive?.('card_open', {});
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* ignore */ }
    // v6.38.0：记入"最近打开"（只存本机 id + 时间戳，不写知识库）。
    try { cardTools.touch(id); } catch (e) { /* 偏好层失败不影响打开卡片 */ }
    app.emit('open', id);
  },
  back() { if (app.hIndex > 0) { app.hIndex--; app.openCard(app.history[app.hIndex], { push: false }); } },
  forward() { if (app.hIndex < app.history.length - 1) { app.hIndex++; app.openCard(app.history[app.hIndex], { push: false }); } },

  /** 生成卡片深链（neolink://open/<库ID>/<卡片ID>）—— 供文档台「复制链接」使用 */
  deepLinkFor(id) { return deepLinkFor(id); },

  /** 按标题打开（双链跳转入口） */
  async openByTitle(title) {
    const res = await api.doc.resolve(title);
    if (res?.ok && res.data) { await app.openCard(res.data.id); return true; }
    return false;
  },

  /** 新建卡片（全局入口：explorer 的 ＋ / Ctrl+N 都走这里） */
  async newCard() {
    const vals = await modal({
      title: '新建卡片',
      message: '标题即文件名；正文里写 [[双链]] 与 #标签。若已有指向该标题的断链，新卡片会自动继承那些突触。',
      fields: [
        { key: 'title', label: '标题', type: 'text', required: true, placeholder: '例如：突触可塑性' },
        { key: 'tags', label: '标签（空格分隔，可留空）', type: 'text', placeholder: '核心机制 检索' },
      ],
      confirmText: '创建',
    });
    if (!vals) return null;
    const res = await api.doc.create({
      title: vals.title.trim(),
      folder: '_memory/semantic',
      tags: vals.tags.split(/\s+/).filter(Boolean),
    });
    if (res?.ok) {
      toast(`已生长新卡片「${res.data.title}」${res.data.inherited ? ` · 自动继承 ${res.data.inherited} 条突触` : ''}`, 'ok');
      await app.refreshVault();
      app.emit('tree'); // 通知左栏刷新
      await app.openCard(res.data.id);
      route('workspace');
      return res.data;
    }
    toast(res?.error || '创建失败', 'err');
    return null;
  },
};

// ---------------- 外观（v6.9.0 AURORA：主题 / 强调色 / 尺度 / 密度 / 动效） ----------------
// 状态与面板由 appearance.js 单一持有；下面四个函数是历史入口的薄委托，
// 命令面板、快捷键和旧调用方一行都不用改。
const appearance = createAppearance({ toast });
// v6.20：任何主题 / 排版 / 密度 / 尺度切换后，把真实引擎读数重新写回状态栏与
// 导航轨，避免「切换只改 class，读数停留在旧快照」。
// v6.40.0 去重：原有两个逐字相同的 appearance:change 监听器，导致每次外观切换
// updateMetrics() 被执行两次。保留单一监听，读数刷新一次即够。
window.addEventListener('appearance:change', () => {
  try { updateMetrics(); } catch (e) { console.error('[ui] 切换后读数刷新失败', e); }
});
const { applyTheme, toggleTheme, applyDensity, toggleDensity } = appearance;

// ---------------- 专家模式（S0.5 公理 A2：类脑机制默认隐身，渐进披露） ----------------
function applyExpert(on) {
  document.body.classList.toggle('expert', !!on);
  localStorage.setItem('neolink-expert', on ? '1' : '0');
}
function toggleExpert() {
  const next = !document.body.classList.contains('expert');
  applyExpert(next);
  toast(next ? '专家模式已开启：显示权重 / 强化 / 记忆层' : '专家模式已关闭：界面只保留 存 / 问 / 理', 'ok', 3600);
}

// ---------------- 版本形态（v2.0.0 Aurora：个人版 / 企业版 双模） ----------------
// 一套程序、两种形态：企业版额外暴露「企业管理」页面（组织 / 知识 / 治理集中入口）；
// 个人版保持精简，避免单人用户被企业级概念干扰。
// v6.7.0：企业管理改为导航轨里正规的一页（视图），不再有会丢失的折叠浮层。
function applyEdition(mode) {
  // v7.0.0：构建期可写死版本形态（edition-lock.js）。both = 应用内自由切换；
  // personal/enterprise = 锁死，隐藏切换器，避免个人版用户误入企业能力。
  const locked = (typeof EDITION_LOCK !== 'undefined' && EDITION_LOCK !== 'both') ? EDITION_LOCK : null;
  const ed = locked || (mode === 'enterprise' ? 'enterprise' : 'personal');
  document.body.classList.toggle('edition-enterprise', ed === 'enterprise');
  localStorage.setItem('neolink-edition', ed);
  const seg = document.getElementById('editionSeg');
  if (seg) {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.edition === ed));
    // 锁死形态时隐藏切换段，个人版/企业版各自纯净。
    if (locked) seg.style.display = 'none';
  }
  // 切回个人版时若停在企业专属视图，回到工作区，避免形态与内容不一致。
  // v6.28.0 更正：星图（graph）是个人版 / 企业版共用的主图谱，
  // 此前把它当企业专属并收敛到二维地图属理解错误，已从白名单移除。
  // v6.9.0 修复：v6.7.0 把「企业管理」升级为导航轨里的正规视图后，
  // 这个白名单漏了 'enterprise' —— 用户从企业版切回个人版时，
  // 企业管理的整套内容还留在屏幕上，可左侧入口已经消失，成了一个"回不去的孤儿页"。
  if (ed === 'personal' && (['team', 'vaults', 'mind3d', 'console', 'enterprise'].includes(currentKey))) {
    route('workspace');
  }
  return ed;
}
function toggleEdition() {
  const next = document.body.classList.contains('edition-enterprise') ? 'personal' : 'enterprise';
  applyEdition(next);
  toast(next === 'enterprise'
    ? '已切换到企业版：左侧「企业管理」面板已就绪'
    : '已切换到个人版：界面精简为单库工作流', 'ok', 3200);
}

// ---------------- 闪念速记（工作记忆收件箱） ----------------
async function quickCapture() {
  const vals = await modal({
    title: '闪念速记',
    message: '一秒写进工作记忆收件箱（_inbox），稍后在「沉淀」整理成长期卡片。',
    fields: [{ key: 'text', label: '此刻的想法', type: 'textarea', required: true, placeholder: '一句话、一个链接、一个待办…' }],
    confirmText: '存入闪念',
  });
  if (!vals) return;
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const res = await api.doc.create({
    title: `闪念 ${stamp}`,
    folder: '_inbox',
    body: String(vals.text || '').trim(),
    tags: ['闪念'],
  });
  if (res?.ok) {
    toast('已存入闪念 · 工作记忆收件箱（沉淀台可整理）', 'ok');
    await app.refreshVault();
    app.emit('tree');
  } else toast(res?.error || '闪念保存失败', 'err');
}

// ---------------- 快捷键速查（F1） ----------------
function showShortcuts() {
  modal({
    title: '帮助 · 快捷键与三分钟上手',
    message: [
      '【三动作】存：Ctrl N 新建 / Ctrl Shift K 闪念 / 编辑器内输 / 插入',
      '【三动作】问：Ctrl K 万能面板，答案带联想链路',
      '【三动作】理：巩固页一轮睡眠，或等每周自动睡眠',
      '',
      'Ctrl K      万能面板：沿突触检索；输入 > 只看命令',
      'Ctrl N      新建卡片',
      'Ctrl Shift K  闪念速记（写入工作记忆）',
      'Ctrl S      保存正在编辑的卡片',
      'Ctrl B      最小化 / 展开左栏「卡片网络」',
      'Ctrl Alt B  最小化 / 展开右栏「关联卡片」',
      'Ctrl [      返回上一个功能区',
      'Ctrl ,      打开设置',
      'Alt ← / →   在联想轨迹中后退 / 前进',
      'F1          打开这份速查',
      '双击标题栏  最大化 / 还原窗口',
      '',
      '【团队】左栏「团队」页：同步盘/NAS 部署向导、共享规范一键生成、成员 AI 接入',
      '【多库】标题栏库名切换；右栏 ⇄ 跨库关联；星图外圈淡青色即其他库的卡片',
      '【星图 v2.2】星图右下角铭牌即当前知识库名称（可点，进「体系」页管理）；卡片标题、领域标签、跨库星系标签均可点；',
      '         左上「视图层级」切总览/全量，大库用「总览」按领域下钻，绝不会一次拉爆界面',
      '         左上「结构视图」切星座/引力/皮层/空间折叠/多库星系（共 5 种，选中态以引擎真实层级为准）；「领域结构」点一下即聚焦该簇',
      '【面板】左/右栏头部可最小化，贴边留把手一键还原；折叠状态与宽度都会记住',
    ].join('\n'),
    confirmText: '知道了',
  });
}

// ---------------- 首次引导 ----------------
function showOnboarding() {
  if (localStorage.getItem('neokb-onboarded') === '1') return;
  const OI = {
    net: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="2.4"/><path d="M12 12 L17.4 7.2M12 12 L5.6 8.4M12 12 L15.4 18"/></svg>',
    steps: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3.2" y="4" width="7.4" height="16" rx="1.6"/><rect x="13.4" y="4" width="7.4" height="16" rx="1.6"/></svg>',
    multi: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7.2 12h9.6"/></svg>',
    keys: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M7 14h10"/></svg>',
  };
  const rootEl = h('div', { class: 'onboard' },
    h('div', { class: 'onboard-box' },
      h('div', { class: 'onboard-kicker' }, 'NEOCOSMOS · 本地知识网络'),
      h('h2', null, '开始使用 NeoCosmos'),
      h('div', { class: 'onboard-grid' },
        h('div', { class: 'onboard-item' },
          h('b', null, h('span', { class: 'oi', html: OI.net }), '双链关系'),
          h('p', null, '正文里写 [[双链]] 就建立关系，检索沿关系扩散。')),
        h('div', { class: 'onboard-item' },
          h('b', null, h('span', { class: 'oi', html: OI.steps }), '三步上手'),
          h('p', null, '左栏选卡片 → 中间读与写 → 右栏看它的全部关系。写了 [[名字]] 但卡片不存在？点一下断链就生长出新卡片。')),
        h('div', { class: 'onboard-item' },
          h('b', null, h('span', { class: 'oi', html: OI.multi }), '多库与跨库'),
          h('p', null, '右上角库名随时切换多个知识库；右栏 ⇄ 把卡片关联到另一个库，星图外圈会亮起跨库节点。')),
        h('div', { class: 'onboard-item' },
          h('b', null, h('span', { class: 'oi', html: OI.keys }), '随时呼出'),
          h('p', null, h('span', null, 'Ctrl K 万能面板（检索 + 命令），Ctrl Shift K 闪念速记，F1 快捷键速查。所有数据只存在你本机。')))),
      // v3.0.0：首次启动简介同时介绍**开发者个人信息**。
      // 用户诉求：「首次启动开启简介同时介绍开发者个人信息」。
      // 做法：在四张能力卡下方加一条开发者名片，与产品介绍并列呈现，
      // 既交代"谁在做、为谁做"，也把联系方式如实摆出来（与「关于」面板同源）。
      h('div', { class: 'onboard-dev' },
        h('div', { class: 'onboard-dev-avatar' }, '宋'),
        h('div', { class: 'onboard-dev-info' },
          h('b', null, '开发者 · 宋锦涛'),
          h('p', null, '独立软件开发者。数据留在本机，不上传云端。'),
          h('div', { class: 'onboard-dev-contact' },
            h('span', null, '联系方式：13869162267'),
            h('button', {
              class: 'btn ghost mini',
              onclick: () => copyToClipboard('13869162267', '已复制开发者联系方式'),
            }, '复制')))),
      h('div', { class: 'onboard-actions' },
        h('button', { class: 'btn ghost', onclick: () => { dismiss(); showShortcuts(); } }, '先看快捷键'),
        h('button', { class: 'btn', onclick: dismiss }, '开始使用'))));
  function dismiss() {
    localStorage.setItem('neokb-onboarded', '1');
    rootEl.classList.add('hide');
    setTimeout(() => rootEl.remove(), 380);
  }
  document.body.appendChild(rootEl);
}

// ---------------- 指标 / 状态栏 ----------------
function updateMetrics() {
  const v = app.vault;
  if (!v) return;
  const n = document.getElementById('mNodes');
  const e = document.getElementById('mEdges');
  const p = document.getElementById('sbPath');
  const vn = document.getElementById('vaultName');
  const dot = document.getElementById('vaultDot');
  const cw = document.getElementById('mCrossWrap');
  const cx = document.getElementById('mCross');
  // v6.9.0：数字千分位。大库（几万张卡片）下 "12345" 既难读也容易和数字标签挤在一起。
  const fmtNum = (x) => Number(x ?? 0).toLocaleString('zh-CN');
  if (n) n.textContent = fmtNum(v.nodes);
  if (e) e.textContent = fmtNum(v.edges);
  if (cw) cw.style.display = v.cross_links ? '' : 'none';
  if (cx && v.cross_links != null) cx.textContent = fmtNum(v.cross_links);
  if (v.path) {
    // v6.19.0：状态栏单行省略是刻意的，但完整路径必须可查 —— 悬停即见全文
    if (p) { p.textContent = v.path; p.title = v.path; }
    if (vn) vn.textContent = v.name || (v.path.split(/[\\/]/).filter(Boolean).slice(-1)[0] || v.path);
    if (dot && v.color) { dot.style.background = v.color; dot.style.boxShadow = `0 0 8px ${v.color}`; }
  }
}
function setSelected(text) {
  const el = document.getElementById('sbSel');
  if (el) el.textContent = text;
}

// ---------------- 覆盖视图（懒加载） ----------------
const OVERLAY = {
  graph: { loader: () => import('./views/graph.js'), key: 'mountGraph' },
  // v6.28.0：历史二维知识地图，源码与路由表保留（不删版本、不虚构功能），
  // 但不再是个人版导航入口 / 默认图谱；个人版与企业版的主图谱均为 graph（星图）。
  map: { loader: () => import('./views/map2d.js'), key: 'mountMap2d' },
  settle: { loader: () => import('./views/settle.js'), key: 'mountSettle' },
  consolidate: { loader: () => import('./views/consolidate.js'), key: 'mountConsolidate' },
  atlas: { loader: () => import('./views/atlas.js'), key: 'mountAtlas' },
  team: { loader: () => import('./views/team.js'), key: 'mountTeam' },
  vaults: { loader: () => import('./views/vaults.js'), key: 'mountVaults' },
  ask: { loader: () => import('./views/ask.js'), key: 'mountAsk' },
  // v6.7.0：企业管理 = 导航轨里正规的一页（集中组织 / 知识 / 治理入口）
  enterprise: { loader: () => import('./views/enterprise.js'), key: 'mountEnterpriseHub' },
  // 企业控制台 = 企业管理页下钻的二级页（本地只读 API / 抗量子防护 / 沉淀回写 / 备份 / 体检 / 批量导入）
  console: { loader: () => import('./views/enterprise.js'), key: 'mountEnterprise' },
  // v6.3.0 企业专属：3D 活体智脑（真实解剖脑区 + 连接组激活）
  mind3d: { loader: () => import('./views/mind3d.js'), key: 'mountMind3d' },
  // v6.11：自主引擎（本机确定性行为架构的可观测面板，双版本可用）
  astra: { loader: () => import('./views/astra.js'), key: 'mountAstra' },
  // v6.14：能力中枢 —— 全部真实内核能力的可操作入口 + 源码生成的能力矩阵
  capabilities: { loader: () => import('./views/capabilities.js'), key: 'mountCapabilities' },
  // v6.31.0：NeoLM 本地语言模型（真实训练权重 / 真实推理实验台）
  neolm: { loader: () => import('./views/neolm.js'), key: 'mountNeoLM' },
  // v6.32.0：语义回流层（调取 / 沉淀回写 / 库关联共用真实模型向量索引）
  semantic: { loader: () => import('./views/semantic-bridge.js'), key: 'mountSemanticBridge' },
  // v6.35.0：全原创设置页 —— 三段式导航的"系统层"入口，收纳其余真实能力
  settings: { loader: () => import('./views/settings.js'), key: 'mountSettings' },
  // v6.38.0：原创增强——工作台收藏夹（星标 + 近期，双版本可用）
  starred: { loader: () => import('./views/starred.js'), key: 'mountStarred' },
  // v6.39.0：原创增强——所有知识库总览（库为节点，真实跨库关联为边，双版本可用）
  vaultOverview: { loader: () => import('./views/vault-overview.js'), key: 'mountVaultOverview' },
};
let currentKey = 'workspace';
// v6.36.0：功能区导航历史（与卡片联想轨迹 app.history 完全独立）。
// 从星图 / 工作区进入设置，再进入体系、问一问等能力视图时，返回按钮沿这条栈回退。
const VIEW_LABEL = {
  graph: '星图', workspace: '工作区', settings: '设置', atlas: '体系', ask: '问一问',
  settle: '沉淀通道', consolidate: '巩固', semantic: '语义关联', neolm: '本地语言模型',
  capabilities: '能力中枢', enterprise: '企业管理', console: '企业控制台',
  astra: '自主引擎', team: '团队与部署', vaults: '库管理', mind3d: '3D 智脑', map: '知识地图',
  starred: '收藏夹', vaultOverview: '全库总览',
};
let viewStack = [currentKey];
// v6.36.0：悬浮工作窗栈。设置与能力视图都在当前界面上方逐层浮出，
// 返回只关最上层；底层功能区保持原位，不再把功能都压进一个页面。
let floatStack = [];
let overlay = null;
// v2.2.0：导航序列守卫 —— route() 是异步的（要 await 懒加载模块）。
// 并发调用时，先发后到的旧导航会在新导航之后回来，
// 把已经渲染好的容器再次清空并重新挂载 —— 表现为"切过去是空白页""内容闪一下"。
// 现在用递增序号裁决：只有最新的一次导航允许落地，旧的一律放弃。
let navSeq = 0;

// v6.36.0：返回按钮同时管两层历史——悬浮窗优先，其次才是底层功能区。
function updateBackButton() {
  const btn = document.getElementById('btnBack');
  if (!btn) return;
  const floating = floatStack.length > 0;
  const can = floating || viewStack.length > 1;
  const prev = viewStack.length > 1 ? viewStack[viewStack.length - 2] : '';
  btn.disabled = !can;
  btn.classList.toggle('is-disabled', !can);
  btn.title = floating
    ? '关闭最上层悬浮窗，回到上一层（Ctrl [）'
    : can ? `返回：${VIEW_LABEL[prev] || prev || '上一个功能区'}（Ctrl [）` : '已在初始功能区';
  btn.setAttribute('aria-label', floating ? '关闭最上层悬浮窗' : can ? `返回 ${VIEW_LABEL[prev] || prev || '上一个功能区'}` : '已在初始功能区');
}

function closeFloat() {
  const top = floatStack.pop();
  if (!top) return;
  try { top.overlay?.unmount?.(); } catch (e) { console.error(e); }
  top.el.remove();
  floatStack.forEach((w, i) => {
    w.el.style.setProperty('--float-index', String(i));
    w.el.style.zIndex = String(300 + i);
  });
  const stage = document.getElementById('floatStage');
  if (stage && !floatStack.length) {
    stage.hidden = true;
    stage.classList.remove('has-windows');
  }
  updateBackButton();
}

function closeAllFloats() {
  while (floatStack.length) closeFloat();
}

async function openFloat(key) {
  if (key === 'graph' || key === 'workspace') { closeAllFloats(); return route(key); }
  const def = OVERLAY[key];
  const stage = document.getElementById('floatStage');
  if (!def || !stage) return route(key);
  if (floatStack.some((w) => w.key === key)) return;   // 同一窗口不重复叠层

  const win = document.createElement('section');
  win.className = 'float-window';
  win.style.setProperty('--float-index', String(floatStack.length));
  win.style.zIndex = String(300 + floatStack.length);
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', `${VIEW_LABEL[key] || key} · 悬浮工作窗`);

  const bar = document.createElement('header');
  bar.className = 'float-bar';
  // v6.39.0：层级 kicker（"悬浮工作窗 · 第 N 层"）移除。
  // 用户实测截图里这行小字与企业页标题挤在一起，既不是操作入口也不表达状态，
  // 属于纯噪声；返回 / 关闭控件与窗口标题全部保留。
  const meta = document.createElement('div');
  meta.className = 'float-meta';
  const title = document.createElement('b');
  title.textContent = VIEW_LABEL[key] || key;
  meta.append(title);

  const ctrls = document.createElement('div');
  ctrls.className = 'float-ctrls';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'float-ctl';
  back.title = '返回上一层';
  back.textContent = '←';
  back.addEventListener('click', () => closeFloat());
  // v6.40.0：按用户要求去掉标题栏的「×」关闭按钮。
  // 关闭途径不丢失：← 返回逐层关闭、Ctrl [、点遮罩 floatScrim、点星图/工作区
  // 都会收起悬浮窗；closeAllFloats() 本体保留，供这些路径调用。
  ctrls.append(back);
  bar.append(meta, ctrls);

  const content = document.createElement('div');
  content.className = 'float-content';
  win.append(bar, content);
  stage.hidden = false;
  stage.classList.add('has-windows');
  stage.appendChild(win);

  // 悬浮窗内部再点能力卡时继续向上叠一层；点星图 / 工作区则收起全部悬浮窗回底层。
  const floatRoute = (next, opts) => {
    if (next === 'graph' || next === 'workspace') { closeAllFloats(); return route(next); }
    if (next === 'settings') return openFloat('settings');
    return openFloat(next);
  };

  let inst = {};
  try {
    const mod = await def.loader();
    inst = mod[def.key]({
      host: content, app, api, toast, status,
      route: floatRoute, openFloat: floatRoute, setSelected, fmtTime,
    }) || {};
  } catch (e) {
    console.error(e);
    content.textContent = `窗口加载失败：${String(e?.message || e)}`;
  }
  floatStack.push({ key, el: win, overlay: inst });
  updateBackButton();
}

async function routeBack() {
  if (floatStack.length) { closeFloat(); return; }
  if (viewStack.length <= 1) return;
  viewStack.pop();
  const prev = viewStack[viewStack.length - 1] || 'workspace';
  await route(prev, { fromBack: true });
  updateBackButton();
}

async function route(key, opts = {}) {
  // v6.36.0：设置不再占用底层页面，改为在当前界面上方浮出工作窗。
  if (key === 'settings' && !opts.fromBack) { await openFloat('settings'); return; }
  // v6.28.0：个人版形态下只有企业专属视图不可用，收敛到工作区。
  // 星图（graph）在个人版 / 企业版都是主图谱，禁止再收敛到二维地图。
  if (!document.body.classList.contains('edition-enterprise')) {
    if (['team', 'vaults', 'mind3d', 'console', 'enterprise'].includes(key)) key = 'workspace';
  }
  const my = ++navSeq;
  // v6.11：导航是行为内核的真实感知输入（好奇心 + 语义记忆）；失败绝不阻断路由
  try {
    const p = api.astra?.perceive?.('view_change', { view: String(key) });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* 感知通道不可用时保持原有导航行为 */ }
  if (key === currentKey && key !== 'workspace') return;
  // v6.36.0：每个真实功能区跳转都进栈；返回按钮沿原路径回退，不是固定回首页。
  if (!opts.fromBack && viewStack[viewStack.length - 1] !== key) {
    viewStack.push(key);
    if (viewStack.length > 40) viewStack.shift();
  }
  updateBackButton();
  // 卸载覆盖视图
  const prevKeyForCleanup = currentKey;
  if (overlay?.unmount) { try { overlay.unmount(); } catch (e) { console.error(e); } }
  overlay = null;
  // v6.9.0：unmount() 释放的是订阅 / WebGL / 观察器，隐藏页里的 DOM 节点仍在。
  // 3D 智脑等重视图切走后 canvas 会常驻显存，这里一并清空宿主。
  if (key !== prevKeyForCleanup && prevKeyForCleanup !== 'workspace') {
    const staleHost = document.getElementById(`view${cap(prevKeyForCleanup)}`);
    if (staleHost) staleHost.innerHTML = '';
  }
  const prevHost = document.getElementById(`view${cap(currentKey)}`);
  if (prevHost && key !== currentKey) prevHost.classList.remove('is-active');

  const prevKey = currentKey;
  currentKey = key;
  for (const btn of document.querySelectorAll('.rail-item')) {
    btn.classList.toggle('is-active', btn.dataset.view === key);
  }

  const host = document.getElementById(`view${cap(key)}`);
  if (host) host.classList.add('is-active');

  if (key === 'workspace') { app.emit('route', key); return; }
  if (prevKey === key) return;

  const def = OVERLAY[key];
  if (!def || !host) return;
  try {
    const mod = await def.loader();
    if (my !== navSeq) return;   // 已有更新的导航在途：本次落地会覆盖它，直接放弃
    host.innerHTML = '';
    // v1.3.1 修复：覆盖视图必须拿到 route 等导航方法，
    // 否则“打开文档 / 去沉淀台 / 切库打开”等跨台按钮全部点击无反应
    overlay = mod[def.key]({ host, app, api, toast, status,
      route, openFloat, setSelected, fmtTime }) || {};
  } catch (e) {
    console.error(e);
    if (my !== navSeq) return;
    host.innerHTML = '';
    // v6.18.0：跨视图统一真实空 / 错误状态组件，不再各页各写一行灰字
    host.appendChild(emptyState('warn', '视图加载失败', String(e?.message || e)));
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------- 全局命令（命令面板第二栏） ----------------
const COMMANDS = [
  { label: '新建卡片', key: 'Ctrl N', run: () => app.newCard() },
  { label: '闪念速记', key: 'Ctrl Shift K', run: () => quickCapture() },
  { label: '新建知识库', key: '', run: () => onCreateVault() },
  { label: '打开知识库文件夹…', key: '', run: onPickVault },
  { label: '打开知识库目录', key: '', run: () => { api.vault.reveal(); toast('已在文件管理器中打开知识库目录', 'ok'); } },
  { label: '切换 浅色 / 石墨深色 主题', key: '', run: () => toggleTheme() },
  { label: '外观设置（主题 / 强调色 / 尺度 / 动效）', key: '', run: () => appearance.open() },
  { label: '切换 舒适 / 紧凑 密度', key: '', run: () => toggleDensity() },
  { label: '切换 个人版 / 企业版', key: '', run: () => toggleEdition() },
  { label: '企业管理（企业版）', key: '', run: () => route('enterprise') },
  { label: '切换专家模式（权重 / 强化 / 记忆层）', key: '', run: () => toggleExpert() },
  { label: '打开星图（全屏关系网络）', key: '', run: () => route('graph') },
  { label: '打开沉淀台', key: '', run: () => route('settle') },
  { label: '执行一轮睡眠（巩固）', key: '', run: () => route('consolidate') },
  { label: '知识库管理 · 体系体检', key: '', run: () => route('atlas') },
  { label: '问一问（引用可溯源）', key: '', run: () => route('ask') },
  { label: '自主引擎（驱动 / 记忆 / 决策 / 策略演化）', key: '', run: () => route('astra') },
  // v10.18.8：按用户要求不再对外展示「能力中枢 / 能力矩阵」入口（知识产权不再随界面展示）。
  // 视图与路由保留用于内部自检，但命令面板、设置页均不再给出可点击展示入口。
  { label: '团队与部署（同步盘 / NAS 向导）', key: '', run: () => route('team') },
  { label: '库管理（跨库关联图谱 / 链接 API）', key: '', run: () => route('vaults') },
  { label: '企业控制台（只读 API / 防护 / 备份 / 体检）', key: '', run: () => route('console') },
  { label: '切换 AURORA PRO 排版', key: '', run: () => document.getElementById('appearancePro')?.click() },
  { label: '切换工程级界面', key: '', run: () => document.getElementById('appearanceNorthstar')?.click() },
  { label: '切换 Quiet Cosmos v7 视觉层', key: '', run: () => document.getElementById('appearanceV7')?.click() },
  { label: '折叠 / 展开导航轨', key: '', run: () => document.getElementById('railToggle')?.click() },
  { label: '打开 3D 智脑（企业版）', key: '', run: () => route('mind3d') },
  // v6.35.0：三项导航后，全部能力的命令直达 + 设置页入口
  { label: '设置（图谱 / 能力 / 知识库 / 关于）', key: 'Ctrl ,', run: () => route('settings') },
  { label: '本地语言模型（真实权重 / 真实推理）', key: '', run: () => route('neolm') },
  { label: '语义关联（沉淀回流 / 语义调取 / 库桥）', key: '', run: () => route('semantic') },
  { label: '重建索引（重新解析双链）', key: '', run: onRebuildCmd },
  { label: '推导突触（为无链库长出关系）', key: '', run: onDeriveCmd },
  { label: '快捷键速查', key: 'F1', run: () => showShortcuts() },
  // v6.38.0：原创增强——工作台收藏夹（星标 + 最近打开）
  { label: '收藏夹（我的星标 / 最近打开）', key: '', run: () => route('starred') },
  // v6.39.0：所有知识库总览（星图内同款入口，命令面板直达）
  { label: '全库总览（所有知识库与真实关联）', key: '', run: () => openFloat('vaultOverview') },
  { label: '关于 NeoCosmos（作者与原创声明）', key: '', run: () => showAbout() },
];
function matchCmds(q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return COMMANDS;
  return COMMANDS.filter((c) => c.label.toLowerCase().includes(s) || c.key.toLowerCase().includes(s));
}
async function onPickVault() {
  const res = await api.vault.pick();
  if (!res.canceled) {
    await app.refreshVault();
    app.currentId = null;
    app.history = []; app.hIndex = -1;
    await autoOpenFirst();
    toast(`已打开知识库：${res.vault.name || res.vault.path}`, 'ok');
  }
}
async function onRebuildCmd() {
  status('正在重建索引…');
  await api.rebuild();
  await app.refreshVault();
  app.emit('tree');
  status('索引已重建');
  toast('索引已重建：双链已重新解析为突触', 'ok');
}
async function onDeriveCmd() {
  status('正在推导突触…');
  const r = await api.derive({});
  if (!r?.ok) { toast(r?.error || '推导失败', 'err'); status('就绪'); return; }
  toast(`新增 ${r.data.total} 条突触`, 'ok');
  await app.refreshVault();
  app.emit('tree');
  status('突触推导完成');
}

// ---------------- 命令轨：检索 + 命令（Ctrl K） ----------------
function wireCmd() {
  const input = document.getElementById('cmdInput');
  const box = document.getElementById('cmdResults');
  let cards = [];   // 检索结果
  let cmds = [];    // 命令
  let rows = [];    // 合并后的可导航列表
  let cur = 0;
  let timer = null;
  let query = '';
  // v6.9.0：检索请求序号。快速连续输入时，先发后到的旧响应会覆盖新结果
  //（表现为"结果闪一下变回上一句"）；每次输入 / 关闭都让在途响应作废。
  let reqSeq = 0;

  const close = () => {
    ++reqSeq;
    box.classList.remove('is-open'); box.innerHTML = '';
    cards = []; cmds = []; rows = []; cur = 0;
    input?.setAttribute('aria-expanded', 'false');
  };
  const escapePath = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/\*\*(.+?)\*\*/g, '<em>$1</em>');

  const buildRows = () => {
    const cmdOnly = query.startsWith('>');
    rows = [];
    if (!cmdOnly) for (const c of cards.slice(0, 8)) rows.push({ kind: 'card', data: c });
    for (const c of (cmdOnly ? cmds : cmds.slice(0, 5))) rows.push({ kind: 'cmd', data: c });
    cur = Math.min(cur, Math.max(0, rows.length - 1));
  };

  const paint = () => {
    box.innerHTML = '';
    if (!rows.length) {
      box.appendChild(h('div', { class: 'cmd-empty' }, query.startsWith('>')
        ? '没有匹配的命令'
        : '没有沿突触联想到任何卡片（输入 > 可只看命令）'));
      box.classList.add('is-open');
      return;
    }
    const cmdOnly = query.startsWith('>');
    let lastKind = null;
    rows.forEach((r, idx) => {
      if (r.kind !== lastKind) {
        lastKind = r.kind;
        if (!cmdOnly) {
          box.appendChild(h('div', { class: 'cmd-sec' }, r.kind === 'card' ? '沿突触联想到' : '命令'));
        }
      }
      let node;
      const a11y = { role: 'option', 'aria-selected': idx === cur ? 'true' : 'false' };
      // v10.18.7 修：结果项在标题栏拖拽区内，用 <button> + 显式 no-drag + pointerdown 兜底，
      // 保证"检索出来就能点开、跳转到对应卡片"（此前点击被 drag 区吞掉，看着能点却无反应）。
      // 注意：CSSStyleDeclaration 只认 camelCase，kebab key 经 Object.assign 会被静默丢弃！
      const noDrag = { style: { WebkitAppRegion: 'no-drag' } };
      if (r.kind === 'card') {
        let opened = false;
        const openIt = () => {
          if (opened) return; opened = true;
          const id = r.data.id; close(); input.value = '';
          app.openCard(id); route('workspace');
        };
        node = h('button', {
          type: 'button', ...a11y, ...noDrag,
          onpointerdown: openIt, onclick: openIt,
          class: 'cmd-res' + (idx === cur ? ' is-cur' : ''),
        },
          h('span', { class: 't' }, h('b', null, r.data.title || '未命名'),
            h('span', { class: 'badge' }, r.data.confidence == null ? '—' : `${Math.round(r.data.confidence * 100)}%`)),
          r.data.path_explained ? h('span', { class: 'why', html: escapePath(r.data.path_explained) }) : null);
      } else {
        let ran = false;
        const runIt = () => { if (ran) return; ran = true; close(); input.value = ''; r.data.run(); };
        node = h('button', {
          type: 'button', ...a11y, ...noDrag,
          onpointerdown: runIt, onclick: runIt,
          class: 'cmd-cmd' + (idx === cur ? ' is-cur' : ''),
        },
          h('span', { class: 'ci', html: icon('derive', 12) }),
          h('span', { class: 'cl' }, r.data.label),
          r.data.key ? h('span', { class: 'ck' }, r.data.key) : null);
      }
      box.appendChild(node);
    });
    box.classList.add('is-open');
  };

  const run = async () => {
    const my = ++reqSeq;
    query = input.value.trim();
    if (!query) { close(); return; }
    if (query.startsWith('>')) {
      cards = [];
      cmds = matchCmds(query.slice(1));
      buildRows(); paint();
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    let res;
    try { res = await api.search({ query, top_k: 8, hops: 2 }); }
    catch (e) {
      console.error('[cmd] 检索失败:', e);
      if (my !== reqSeq) return;
      res = null;   // 检索失败仍列出可用命令，不让面板变成死路
    }
    if (my !== reqSeq) return;   // 过期响应：丢弃，绝不回写界面
    cards = (res?.ok && res?.data?.results) ? res.data.results : [];
    cmds = matchCmds(query);
    buildRows(); paint();
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    ++reqSeq;      // 让在途响应立即作废
    cur = 0;       // 新查询从第一项开始，不再继承上一次的高亮位置
    timer = setTimeout(run, 160);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) run(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); cur = Math.min(rows.length - 1, cur + 1); paint(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); cur = Math.max(0, cur - 1); paint(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      const r = rows[cur];
      if (!r) return;
      close(); input.value = '';
      if (r.kind === 'card') { app.openCard(r.data.id); route('workspace'); }
      else r.data.run();
    } else if (ev.key === 'Escape') { close(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 200));

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' && !ev.shiftKey) { ev.preventDefault(); input.focus(); input.select(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); quickCapture(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.altKey && ev.key.toLowerCase() === 'b') { ev.preventDefault(); togglePane('right'); }
    // v6.35.0：Ctrl + , 直达设置（与主流桌面应用一致，且命令面板已登记）
    else if ((ev.ctrlKey || ev.metaKey) && ev.key === ',') { ev.preventDefault(); route('settings'); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key === '[') { ev.preventDefault(); routeBack(); }
    else if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'b') { ev.preventDefault(); togglePane('left'); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'n') { ev.preventDefault(); app.newCard(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      if (app.docPane && app.docPane.saveIfEditing) app.docPane.saveIfEditing();
    }
    else if ((ev.altKey) && ev.key === 'ArrowLeft') { ev.preventDefault(); app.back(); }
    else if ((ev.altKey) && ev.key === 'ArrowRight') { ev.preventDefault(); app.forward(); }
    else if (ev.key === 'F1') { ev.preventDefault(); showShortcuts(); }
  });
  return { close, run };
}

// ---------------- 窗格宽度拖动 ----------------
function wireSplitters() {
  const bind = (id, paneId, min, max, sign) => {
    const sp = document.getElementById(id);
    const pane = document.getElementById(paneId);
    if (!sp || !pane) return;
    let dragging = false;
    sp.addEventListener('mousedown', (ev) => { dragging = true; ev.preventDefault(); document.body.style.cursor = 'col-resize'; });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      // v2.1.0：宽度持久化——过去拖完就丢，下次启动回到默认宽度
      localStorage.setItem('neokb-w-' + paneId, pane.style.flexBasis || String(pane.getBoundingClientRect().width));
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      const rect = pane.parentElement.getBoundingClientRect();
      const w = sign > 0 ? ev.clientX - rect.left : rect.right - ev.clientX;
      pane.style.flexBasis = `${Math.max(min, Math.min(max, w))}px`;
    });
  };
  bind('spLeft', 'paneLeft', 180, 460, 1);
  bind('spRight', 'paneRight', 200, 520, -1);

  // 恢复上次宽度（在面板折叠状态下跳过，展开时再补）
  for (const [paneId, min, max] of [['paneLeft', 180, 460], ['paneRight', 200, 520]]) {
    const pane = document.getElementById(paneId);
    const saved = localStorage.getItem('neokb-w-' + paneId);
    if (pane && saved) {
      const w = Math.max(min, Math.min(max, parseInt(saved, 10) || 0));
      if (w > 0) pane.style.flexBasis = `${w}px`;
    }
  }
}

// ---------------- 关于 NeoLink（作者署名 · 版权 · 原创声明） ----------------
// 纪律：弹窗里的每一个数字都取自运行时真实状态（app.info / app.vault），
// 绝不写死、绝不占位——显示的必须是对得上的。
const AUTHOR = '宋锦涛';
const CONTACT = '13869162267';

function showAbout() {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  const info = app.info || {};
  const v = app.vault || {};
  const edition = document.body.classList.contains('edition-enterprise') ? '企业版' : '个人版';
  const kv = (k, val) => h('div', { class: 'kv' }, h('span', null, k), h('b', null, val));

  // v2.2.1：把运行环境一并如实列出（取不到就写"—"，绝不编造）
  const plat = {
    win32: 'Windows', darwin: 'macOS', linux: 'Linux',
  }[info.platform] || info.platform || '—';
  const arch = { x64: 'x64', arm64: 'ARM64', ia32: 'x86' }[info.arch] || info.arch || '—';
  const runtime = [plat, arch, info.electron ? `Electron ${info.electron}` : null].filter(Boolean).join(' · ');
  // 注意：listRegistry() 返回的是 { vaults, activeId }，不是数组 —— 别按数组取长度
  const regList = info.registry && Array.isArray(info.registry.vaults) ? info.registry.vaults : [];
  const regCount = regList.length;

  const box = h('div', { class: 'modal is-wide' },
    h('div', { class: 'modal-head about-head' },
      h('img', { class: 'about-logo', src: './assets/brand.svg', alt: 'NeoCosmos' }),
      h('div', null,
        h('b', null, 'NeoCosmos · 关系优先的知识网络'),
        h('div', { class: 'about-sub' }, `${info.version ? 'v' + info.version : '版本未取到'} · 本地优先 · 零云端`))),
    h('div', { class: 'modal-body about-body' },
      h('p', { class: 'about-desc' },
        '基于本地 Markdown 卡片与双链关系的知识网络。数据留在本机，不上传云端。'),

      h('div', { class: 'about-sec' }, '开发者'),
      kv('开发者', info.author || AUTHOR),
      kv('联系方式', info.contact || CONTACT),
      kv('作品名称', `${info.appName || 'NeoCosmos'} · 关系优先的知识网络`),
      kv('版本', `${info.version ? 'v' + info.version : '版本未取到'}`),

      h('div', { class: 'about-sec' }, '运行环境'),
      kv('运行模式', edition),
      kv('系统与架构', runtime),
      kv('Node 运行时', info.node ? `v${info.node}` : '—'),
      kv('数据目录', info.userData || '—'),

      h('div', { class: 'about-sec' }, '当前知识库'),
      kv('知识库', v.name || '未打开'),
      kv('路径', v.path || '—'),
      kv('规模', `${v.nodes ?? 0} 卡片 · ${v.edges ?? 0} 突触${v.cross_links ? ` · ${v.cross_links} 条跨库关联` : ''}`),
      kv('已登记知识库', `${regCount} 个`),

      // v2.2.1：存储位置由用户自选 ——「关于」是最自然的地方。
      // 用户诉求原文：「存储、目录等等，用户可以自己选择存储位置，不能默认C盘」。
      h('div', { class: 'about-sec' }, '存储位置'),
      // v2.2.1 修复：当前库若落在系统盘上，必须**明确说明** ——
      // 以前只把"选择位置"的按钮摆在那儿，用户选完却看不到任何反馈，
      // 也不知道自己的库其实还在 C 盘。这里把位置、默认根目录、
      // 以及"是否在系统盘"这三件事实如实摊开。
      info.vaultOnSystemDrive
        ? h('div', { class: 'about-warn' },
          '⚠ 当前知识库位于系统盘（通常是 C 盘）。'
          + '系统盘重装、换机或磁盘故障时，最先被带走的往往就是它。'
          + '建议用下方「迁移到其他位置」把它搬到数据盘 —— 迁移是复制 + 逐字节校验，原位置不会被动。')
        : null,
      kv('当前库位置', v.path || '—'),
      kv('默认存储根目录', info.storageRoot || '—'),
      h('p', { class: 'about-desc', style: { marginTop: '0' } },
        '知识库就是磁盘上的一个普通文件夹，位置由你决定。'
        + '建议放在非系统盘（如 D://）或移动硬盘 —— 系统盘重装、换机时最容易被一并带走。'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn ghost',
          title: '选择一个位置存放知识库（下次启动直接用它）',
          onclick: async () => {
            const r = await api.vault?.chooseStorage?.();
            if (r?.canceled) return;
            if (!r?.ok && r?.error) { toast(r.error, 'err', 6000); return; }
            await app.refreshVault?.();
            // v2.2.1：把位置相关的真实状态同步回「关于」面板 ——
            // 否则切完位置再打开「关于」，显示的还是切换前的那套信息。
            app.info = {
              ...app.info,
              vault: r?.vault || app.info?.vault,
              registry: r?.registry || app.info?.registry,
              vaultOnSystemDrive: !!r?.onSystemDrive,
              storageRoot: r?.vaultRoot || app.info?.storageRoot,
            };
            toast(r?.message || '存储位置已更新', 'ok', 4200);
            close();
          },
        }, '选择存储位置'),
        h('button', {
          class: 'btn ghost',
          title: '把当前知识库整体搬到另一个位置（复制并逐字节校验，原位置不删除）',
          onclick: async () => {
            const r = await api.vault?.migrate?.();
            if (r?.canceled) return;
            if (!r?.ok) { toast(r?.error || '迁移失败', 'err', 8000); return; }
            await app.refreshVault?.();
            app.info = {
              ...app.info,
              vault: r?.vault || app.info?.vault,
              registry: r?.registry || app.info?.registry,
              vaultOnSystemDrive: !!r?.onSystemDrive,
            };
            toast(r.message || '迁移完成', 'ok', 8000);
            close();
          },
        }, '迁移到其他位置')),

      h('div', { class: 'about-sec' }, '许可与第三方'),
      kv('授权', info.license || 'AGPL-3.0'),
      h('p', { class: 'about-license-note' },
        edition === '企业版'
          ? '本产品为企业专有授权，商业使用须取得授权。商用授权请联系开发者：' + (info.author || AUTHOR) + ' · ' + (info.contact || CONTACT) + '。'
          : '个人版以 AGPL-3.0 开源，个人 / 学习 / 研究 / 内网免费；若想商用须联系开发者取得授权：' + (info.author || AUTHOR) + ' · ' + (info.contact || CONTACT) + '。'),
      h('div', { class: 'about-third' },
        ...(Array.isArray(info.thirdParty) ? info.thirdParty : []).map((t) => h('div', null, '· ' + t))),
      h('div', { class: 'about-third' }, '· 完整第三方许可证清单见安装目录 LICENSES.md'),

      h('p', { class: 'about-note' },
        '原创声明：本软件的视觉语言、品牌标记、术语体系、引擎算法与协议均为独立设计，'
        + '遵循净室开发原则，不复制任何第三方产品之名称、配色、图标、界面或代码。'
        + '知识本体即磁盘上的普通 .md 文件夹，卸载软件不会触碰你的数据。')),
    h('div', { class: 'modal-foot' },
      h('button', {
        class: 'btn ghost',
        onclick: () => copyToClipboard(`${info.author || AUTHOR} · ${info.contact || CONTACT}`, '已复制开发者信息'),
      }, '复制开发者信息'),
      h('button', {
        class: 'btn ghost',
        onclick: () => copyToClipboard(`NeoCosmos ${info.version ? 'v' + info.version : '版本未取到'} · ${info.author || AUTHOR} · ${info.contact || CONTACT}`, '已复制版本信息'),
      }, '复制版本信息'),
      h('button', { class: 'btn', onclick: close }, '知道了')),
  );

  function close() {
    root.classList.remove('is-open');
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }

  root.innerHTML = '';
  root.appendChild(box);
  root.classList.add('is-open');
  document.addEventListener('keydown', onKey, true);
}

// ---------------- 深链：neolink://open/<库ID>/<卡片ID> ----------------
// 两种形态都要认：
//   ① location.search  —— 协议处理器 302 到 neolink://app/index.html?vaultId=..&cardId=..
//   ② location.pathname —— 直接以 neolink://open/<库ID>/<卡片ID> 载入时
const DEEP_LINK_RE = /^neolink:\/\/open\/([^/?#]+)\/?([^?#]*)/i;

/** 从当前地址解析深链（应用以 neolink://open/... 启动时走这条） */
function parseDeepLinkFromLocation() {
  // ① 查询串优先（经 302 跳转后的标准形态）
  try {
    const sp = new URLSearchParams(String(location.search || ''));
    const v = sp.get('vaultId') || '';
    const c = sp.get('cardId') || '';
    const verify = sp.get('verify') === '1';
    const snippet = sp.get('snippet') || '';
    if (v || c) return { vaultId: v, cardId: c, verify, snippet };
  } catch { /* 忽略，走 pathname */ }
  // ② 直接以 neolink://open/... 载入
  const m = DEEP_LINK_RE.exec(String(location.href || ''));
  if (!m) return null;
  return { vaultId: decodeURIComponent(m[1] || ''), cardId: decodeURIComponent(m[2] || '') };
}

/** 生成某张卡片的深链（供「复制链接」使用） */
function deepLinkFor(id) {
  const vaultId = app.vault?.id || '';
  return `neolink://open/${vaultId}/${encodeURIComponent(String(id || ''))}`;
}

// 深链处理结果留痕：成功/失败、目标卡片、失败原因。
// 用途有二 —— ① 端到端验证脚本据此判定"首启是否真的跳到了卡片"；
// ② 出问题时能如实知道是"没解析到"还是"解析到了但卡片不存在"。
let lastDeepLink = null;
function recordDeepLink(target, ok, error, openedCardId) {
  lastDeepLink = {
    vaultId: target?.vaultId || '',
    cardId: target?.cardId || '',
    // v6.34.0：记录溯源形态与片段，供外部 deep link e2e 验证 verify 深链确实驱动跳转与高亮。
    verify: !!target?.verify,
    snippet: target?.snippet || '',
    ok: !!ok,
    error: error || null,
    openedCardId: openedCardId || null,
    at: Date.now(),
  };
}

async function handleDeepLink(dl) {
  const target = dl || parseDeepLinkFromLocation();
  // v2.2.0：冷启动唤起时，深链不在 location 里（窗口恒定加载 neolink://app/index.html），
  // 而是由主进程从 argv 收下后转交 —— 这里主动取一次。取不到就当没有，不报错。
  if (!target && api.deepLink?.takeDeepLink) {
    try {
      const r = await api.deepLink.takeDeepLink();
      // v6.18.0：旧版丢弃递归结果、无条件 return true，内层打开失败时
      // 外层仍报成功，e2e 与记录里的判定与事实相反。
      if (r?.ok && r.deepLink) return await handleDeepLink(r.deepLink);
    } catch (e) { console.error('[deeplink] 取首启深链失败', e); }
    return false;
  }
  if (!target || (!target.vaultId && !target.cardId)) return false;
  try {
    const res = await api.deepLink?.deep(target);
    if (!res || !res.ok) { toast(res?.error || '深链打开失败', 'err'); recordDeepLink(target, false, res?.error || '深链打开失败'); return false; }
    if (res.vault) { app.vault = res.vault; app.graph = null; app.graphKey = null; updateMetrics(); }
    if (res.cardId) {
      await app.openCard(res.cardId, { highlight: target.verify ? target.snippet : null });
      route('workspace');
      toast(target.verify ? '已溯源并高亮被引用的具体内容' : '已通过深链打开卡片', 'ok');
      recordDeepLink(target, true, null, res.cardId);
    } else {
      toast('深链指向的卡片不存在', 'err');
      recordDeepLink(target, false, '卡片不存在');
    }
    return true;
  } catch (e) {
    toast('深链打开失败：' + String(e?.message || e), 'err');
    recordDeepLink(target, false, String(e?.message || e));
    return false;
  }
}

// ---------------- 侧栏最小化（v2.1.0） ----------------
// 修复说明：样式表里一直存在一条 .pane.is-hidden{display:none} 规则，但全项目没有任何地方
// toggle 过它——功能骨架在、接线丢了，所以"左侧可以最小化"这件事事实上从未生效。
// 本次补齐完整闭环：折叠 → 贴边把手 → 一键还原 → 状态持久化 → 快捷键 → 宽度记忆。
const PANE_KEY = { left: 'neolink-pane-left', right: 'neolink-pane-right' };
const PANE_LABEL = { left: '卡片网络', right: '关联卡片' };
const PANE_W = { left: 'paneLeft', right: 'paneRight' };

function paneCollapsed(side) { return localStorage.getItem(PANE_KEY[side]) === '1'; }

function applyPaneState(side) {
  const ws = document.getElementById('viewWorkspace');
  if (!ws) return;
  const collapsed = paneCollapsed(side);
  ws.classList.toggle('pane-no-' + side, collapsed);
  // splitter 必须跟着隐藏，否则会留下一条 4px 的可拖动死区
  const sp = document.getElementById(side === 'left' ? 'spLeft' : 'spRight');
  if (sp) sp.style.display = collapsed ? 'none' : '';
}

function togglePane(side) {
  const next = paneCollapsed(side) ? '0' : '1';
  localStorage.setItem(PANE_KEY[side], next);
  applyPaneState(side);
  const label = PANE_LABEL[side];
  const hint = side === 'left' ? 'Ctrl+B' : 'Ctrl+Alt+B';
  toast(next === '1' ? `${label}已最小化 · ${hint} 一键还原` : `${label}已展开`, 'ok', 2200);
  // 展开后让内部内容重算尺寸（图表 / 虚拟列表 / 星图 canvas）
  window.dispatchEvent(new Event('resize'));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
}

function wirePanes() {
  applyPaneState('left');
  applyPaneState('right');
  document.getElementById('restoreLeft')?.addEventListener('click', () => togglePane('left'));
  document.getElementById('restoreRight')?.addEventListener('click', () => togglePane('right'));
}


// ---------------- 标题栏 ----------------

/**
 * v2.3.0：关闭程序前弹确认框（用户需求「点击右上角关闭，弹出对话框提醒是否关闭」）。
 *
 * 为什么必须做：NeoLink 是**本地优先**的知识库，关掉进程就等于关掉所有在编辑的卡片。
 * 用户可能正在写一篇长卡片，顺手点右上角 X 就把内容丢了 —— 没有确认框时
 * 这种误操作**不可逆**（正文改动只进写审计 journal，但不自动恢复）。
 *
 * 文案如实反映状态：
 *   · 有未保存修改 → 明确告知"会丢失"，主按钮写「放弃修改并退出」
 *   · 没有未保存   → 轻量询问，主按钮写「退出 NeoCosmos」
 *
 * 两条关闭路径都汇到这里：
 *   ① 标题栏 X（本函数直接调用）
 *   ② Alt+F4 / 任务栏关闭 —— 主进程 win.on('close') 拦截后发 window:ask-close
 * ② 这条路若也走 api.win.close()，主进程会**再拦一次** ⇒ 弹两个框。
 * 所以 ② 用 api.win.replyClose(true/false) 直接回传结果，不再调 close()。
 */
async function confirmCloseApp(fromMainProcess = false) {
  const st = (typeof app.dirtyState === 'function') ? app.dirtyState() : { dirty: false, title: '' };
  const hasDirty = !!st.dirty;
  const what = st.title ? `「${st.title}」` : '当前卡片';

  const go = await confirmDialog({
    title: hasDirty ? '有未保存的修改' : '退出 NeoCosmos',
    message: hasDirty
      ? `${what}有未保存的修改，直接退出会丢失这些改动。确定要放弃修改并退出吗？`
      : '确定要退出 NeoCosmos 吗？退出后客户端会完全关闭，需要重新双击桌面图标才能打开。',
    confirmText: hasDirty ? '放弃并退出' : '退出 NeoCosmos',
    cancelText: '取消',
  });

  if (fromMainProcess) {
    // 由主进程发起的询问：回传结果，不自己调 close()
    api.win.replyClose?.(go);
    return;
  }
  // v6.12：标题栏 X 这条路已经在渲染层弹过确认框了。直接 replyClose(true) 把结果回传主进程，
  // 由主进程置 closeConfirmed 后放行 win.close() —— 不再二次调用 api.win.close()（那会重新触发
  // 主进程 win.on('close') 拦截器，又弹一次确认框，表现为「点一下 X 弹两个对话框」）。
  if (go) api.win.replyClose?.(true);
}

function wireChrome() {
  for (const b of document.querySelectorAll('.wb[data-act]')) {
    b.addEventListener('click', () => {
      if (b.dataset.act === 'close') { confirmCloseApp(false); return; }
      api.win[b.dataset.act]?.();
    });
  }
  // 双击标题栏空白区最大化/还原。
  // v6.9.0：旧白名单漏了「个人版/企业版」分段控件与命令结果浮层，
  // 双击切换版本时窗口会跟着一起最大化；改为把所有交互元素统一排除。
  document.querySelector('.titlebar')?.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('button, input, a, label, .cmdbar, .chip, .edition-seg, .win-btns, .cmd-results, [data-popover]')) return;
    api.win.max();
  });

  // 闪念 / 主题 / 关于
  document.getElementById('btnCapture')?.addEventListener('click', () => quickCapture());
  document.getElementById('btnTheme')?.addEventListener('click', () => toggleTheme());
  document.getElementById('btnAbout')?.addEventListener('click', () => showAbout());

  // v6.14：PRO 排版开关与分组导航折叠（真实偏好，写入 localStorage）
  // v6.18.0：两个排版开关委托给外观控制器的单一状态源。
  // 此前它们各自写 localStorage 并单独 apply，导致「恢复默认」不覆盖、
  // 面板开关与 body class 可能各说各话。
  document.getElementById('appearancePro')?.addEventListener('click', () => {
    appearance.setLayout('pro', !document.body.classList.contains('pro-layout'));
  });
  document.getElementById('appearanceNorthstar')?.addEventListener('click', () => {
    appearance.setLayout('ns', !document.body.classList.contains('ns-layout'));
  });
  // v6.21.0：第四代视觉层的真实开关（同样委托给外观控制器单一状态源）
  document.getElementById('appearanceV7')?.addEventListener('click', () => {
    appearance.setLayout('v7', !document.body.classList.contains('neo-v2'));
  });
  document.getElementById('railToggle')?.addEventListener('click', () => {
    const nextCollapsed = !document.body.classList.contains('pro-rail-collapsed');
    try { localStorage.setItem(PRO_RAIL_KEY, nextCollapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    applyProLayout();
  });

  // v6.41.0：桌面精灵 UI 入口与事件绑定已整体移除（用户要求删除桌面精灵）。
  // ASTRA / 量子 / 3D 智脑 / 能力中枢功能不受影响。

  // v6.36.0：全局返回按钮 —— 从任一功能区回到上一个功能区
  const backBtn = document.getElementById('btnBack');
  backBtn?.addEventListener('click', () => { routeBack(); });
  updateBackButton();

  // 版本形态（个人版 / 企业版）
  const seg = document.getElementById('editionSeg');
  if (seg) {
    seg.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      applyEdition(b.dataset.edition);
      toast(b.dataset.edition === 'enterprise'
        ? '企业版：左侧「企业管理」入口已开放'
        : '个人版：已切回精简工作流', 'ok', 2600);
    });
  }

  const chip = document.getElementById('vaultChip');
  chip?.addEventListener('click', async () => {
    const r = await api.vault.list();
    const vaults = (r?.ok && r.data?.vaults) ? r.data.vaults : [];
    const items = [];
    if (vaults.length) items.push({ title: '知识库' });
    for (const v of vaults) {
      items.push({
        label: v.name, dot: v.color, sub: v.active ? '当前' : '',
        active: v.active,
        onClick: async () => {
          if (v.active) return;
          const res = await api.vault.switch(v.id);
          if (res?.ok) {
            await app.refreshVault();
            app.currentId = null;
            app.history = []; app.hIndex = -1;
            await autoOpenFirst();
            toast(`已切换到「${res.vault.name}」`, 'ok');
          } else toast(res?.error || '切换失败', 'err');
        },
      });
    }
    items.push({ sep: true });
    items.push({ label: '新建知识库…', icon: 'plus', onClick: onCreateVault });
    items.push({ label: '打开文件夹…', icon: 'folder', onClick: onPickVault });
    items.push({ label: '打开知识库目录', icon: 'open', onClick: () => api.vault.reveal() });
    items.push({ sep: true });
    items.push({ label: '管理知识库（体系）', icon: 'palette', onClick: () => route('atlas') });
    dropdown(chip, items);
  });
}

async function onCreateVault() {
  const vals = await modal({
    title: '新建知识库',
    message: '每个知识库是磁盘上的一个普通文件夹，拥有独立的卡片网络、星图与配色。之后可在标题栏随时切换，也能跨库关联。',
    fields: [
      { key: 'name', label: '知识库名称', type: 'text', required: true, placeholder: '例如：产品研究 / 法律案例库' },
    ],
    confirmText: '创建并打开',
  });
  if (!vals) return;
  const res = await api.vault.create({ name: vals.name.trim() });
  if (res?.ok) {
    await app.refreshVault();
    app.currentId = null;
    app.history = []; app.hIndex = -1;
    await autoOpenFirst();
    toast(`已创建并打开「${res.vault.name}」`, 'ok');
  } else toast(res?.error || '创建失败', 'err');
}

// ---------------- 启动 ----------------
let explorer = null, docPane = null, relPane = null;

async function autoOpenFirst() {
  const res = await api.doc.tree();
  if (!res?.ok) return;
  const first = [];
  const walk = (d) => {
    for (const f of d.files || []) first.push(f);
    for (const sd of d.dirs || []) walk(sd);
  };
  walk(res.data);
  if (first.length) await app.openCard(first[0].id);
  else { app.currentId = null; app.emit('open', null); }
}

// v6.10：好莱坞级「星图诞生」开机动画驱动。
//   强调色取自 AURORA 令牌，动效尊重外观开关与系统「减少动态效果」；
//   WebGL 不可用或脚本异常时静默回落 CSS 启动屏；设 9s 安全兜底强制移除。
async function runBootCosmos() {
  const bootEl = document.getElementById('boot');
  if (!bootEl) return;
  const safety = setTimeout(() => {
    const el = document.getElementById('boot');
    if (el && !el.classList.contains('hide')) { el.classList.add('hide'); setTimeout(() => el.remove(), 620); }
  }, 9000);
  try {
    const mod = await import('./boot-cosmos.js');
    const cs = getComputedStyle(document.body);
    const accent = {
      h: (parseFloat(cs.getPropertyValue('--ds-ah')) || 218) / 360,
      s: (parseFloat(cs.getPropertyValue('--ds-as')) || 78) / 100,
      l: (parseFloat(cs.getPropertyValue('--ds-al')) || 52) / 100,
    };
    const reduced = !appearance.state().motion
      || document.body.classList.contains('reduce-motion')
      || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    await mod.startBootCosmos({ reducedMotion: reduced, accent });
  } catch (e) {
    console.warn('[boot] 开机动画不可用，回落 CSS 启动屏', e);
    bootEl.classList.add('hide');
    setTimeout(() => bootEl.remove(), 620);
  } finally {
    clearTimeout(safety);
  }
}

async function boot() {
  // 外观先于一切绘制（避免闪白/闪黑）。v6.9.0：单一状态源 + 旧键迁移 +
  // 面板事件绑定 + 跟随系统主题/减少动效，全部由 appearance.init() 一次完成。
  appearance.init();
  applyExpert(localStorage.getItem('neolink-expert') === '1');
  applyEdition(localStorage.getItem('neolink-edition') || 'personal');
  app.applyTheme = applyTheme;
  app.applyDensity = applyDensity;
  app.appearance = appearance;
  app.applyExpert = applyExpert;
  app.isExpert = () => document.body.classList.contains('expert');
  app.quickCapture = quickCapture;

  wireChrome();
  wireSplitters();
  wirePanes();
  const cmd = wireCmd();
  app.cmd = cmd;
  app.togglePane = togglePane;

  for (const btn of document.querySelectorAll('.rail-item')) {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'settings') openFloat('settings');
      else route(btn.dataset.view);
    });
  }
  document.getElementById('floatScrim')?.addEventListener('click', () => closeFloat());

  // v6.18.0：把「引擎初始化」与「UI 读数刷新」拆成两个独立的错误边界。
  // 旧版一个大 try 从 init 包到 DOM 写入，brandVersion 或能力清单取数出错时
  // 会误报「引擎初始化失败」，并连带跳过状态栏刷新。
  try {
    app.info = await api.init();
  } catch (e) {
    console.error(e);
    toast('引擎初始化失败：' + (e?.message || e), 'err', 8000);
    app.info = app.info || {};
  }
  try {
    const verEl = document.getElementById('brandVersion');
    if (verEl && app.info?.version) verEl.textContent = `v${app.info.version}`;
    // v6.20：状态栏只显示可由源码清单核对的真实计数，删掉「已核对」——
    // 那是一个从未执行过的动作。清单是构建期快照，如实标注，不冒充运行时探测。
    const capsEl = document.getElementById('sbCaps');
    if (capsEl) {
      const t = CAPABILITY_MANIFEST.totals;
      capsEl.textContent = `能力清单 · ${t.channels} 通道 / ${t.apis} API / ${t.mcpTools} MCP 工具`;
      capsEl.title = `源码清单快照（构建期由源码推导，非实时注册探测）：${t.channels} 通道 / ${t.apis} 桥接 API / 中枢直达 ${t.hub} / 桌面桥接工具 ${t.tools} / MCP 工具 ${t.mcpTools} · ${CAPABILITY_MANIFEST.generatedBy} · 指纹 ${CAPABILITY_MANIFEST.sourceHash}`;
    }
    const engEl = document.getElementById('sbEngine');
    if (engEl) {
      const ver = app.info?.version;
      engEl.textContent = ver ? `引擎 · v${ver}` : '引擎 · 版本未取到';
      engEl.title = '本地引擎：不联网、不上传；版本取自 app:init 运行时返回值';
    }
  } catch (e) {
    console.error('[boot] 界面读数刷新失败（不影响引擎）', e);
  }
  if (app.info?.vault?.ready) { app.vault = app.info.vault; updateMetrics(); }

  // 三栏常驻
  const ctx = { app, api, toast, status, setSelected, fmtTime, route, openFloat };
  explorer = mountExplorer({ host: document.getElementById('paneLeft'), ...ctx });
  docPane = mountDocument({ host: document.getElementById('paneMid'), ...ctx });
  relPane = mountRelations({ host: document.getElementById('paneRight'), ...ctx });
  app.docPane = docPane;

  // 外部文件变更：主进程已重建索引，这里只刷新
  if (api.onVaultChanged) {
    api.onVaultChanged(async (info) => {
      if (info && info.ready) {
        app.vault = info;
        app.graph = null;
        app.graphKey = null;
        updateMetrics();
        app.emit('vault', info);
        status('检测到文件变更，索引已自动重建');
      }
    });
  }

  // 主进程通知（如自动睡眠结果）
  // v6.19.0：旧写法只判断 n.text 为真，纯空格 / 换行仍会传进 toast 生成空白浮层；
  // 这里先规整为 trim 后的真实文本，并允许通知自带 kind。
  if (api.onNotice) {
    api.onNotice((n) => {
      const text = String(typeof n === 'string' ? n : (n?.text ?? '')).trim();
      if (text) toast(text, n?.kind || 'ok', 5000);
    });
  }

  // v2.3.0：主进程要求确认关闭（Alt+F4 / 任务栏右键关闭 / 系统注销）。
  // 这条路径不经过标题栏的 X，必须单独接 —— 否则这些关闭方式是**静默**的，
  // 用户正在写卡片时按一下 Alt+F4，内容就没了。
  if (api.win?.onAskClose) {
    api.win.onAskClose(() => { confirmCloseApp(true); });
  }

  await autoOpenFirst();

  // 深链：启动时解析地址 + 监听外部唤起
  await handleDeepLink();
  if (api.deepLink?.onDeepLink) api.deepLink.onDeepLink((dl) => { handleDeepLink(dl); });

  // v6.10：好莱坞级「星图诞生」开机动画（WebGL）。
  //   · 强调色取自 AURORA 令牌，随外观实时一致；
  //   · 尊重「界面动效」开关与系统「减少动态效果」；
  //   · WebGL 不可用 / 脚本异常时静默回落 CSS 启动屏；
  //   · 动画结束自行淡出移除 #boot，并设 9s 安全兜底强制移除。
  runBootCosmos();

  status('就绪');
  // v6.41.0：首次引导弹窗不再自动出现。
  // 此前仅在 dismiss() 时写 neokb-onboarded=1，但用户数据目录切换 / localStorage 被清理
  // 会导致标记丢失，表现为「隔几天又弹一次」。现默认关闭自动弹出；如需手动查看，
  // 可在控制台执行 localStorage.setItem('neokb-show-onboard','1') 后重启（显式 opted-in）。
  try {
    if (localStorage.getItem('neokb-show-onboard') === '1') {
      localStorage.removeItem('neokb-show-onboard');
      setTimeout(showOnboarding, 700);
    }
  } catch { /* localStorage 不可用则不弹，符合默认关闭 */ }
}

window.__NEOLINK__ = { app, route, openFloat, closeFloat, closeAllFloats, toast, api, cardTools, capabilities: CAPABILITY_MANIFEST, deepLink: () => lastDeepLink };

// v6.18.0 启动错误边界：旧版裸调用 boot()，任一挂载 / IPC 抛错时
// runBootCosmos() 不执行，z-index 300 的不透明启动屏会永久盖住整个界面。
// 现在无论成功失败都有明确的收口，并保留一道独立的强制兜底定时器。
function dismissBootScreen() {
  const el = document.getElementById('boot');
  if (el) el.remove();
}
const bootGuard = setTimeout(dismissBootScreen, 12000);
boot()
  .catch((e) => {
    console.error('[boot] 启动链路异常', e);
    dismissBootScreen();
    try { toast('启动异常：' + (e?.message || e) + '（界面已保留，可继续使用）', 'err', 9000); } catch { /* ignore */ }
  })
  .finally(() => clearTimeout(bootGuard));
