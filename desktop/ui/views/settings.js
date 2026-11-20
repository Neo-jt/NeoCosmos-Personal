// NeoCosmos · 设置（原创结构，v6.36.0）
// ---------------------------------------------------------------------------
// 设计立场（全原创，不参考 / 不复用任何第三方客户端的设置结构）：
//   · 左侧三个主导航位只有 星图 / 工作区 / 设置；设置是唯一的"系统层"入口。
//   · 设置页按用户意图重组为四类：图谱与工作区 / 能力与服务 / 知识库 / 关于。
//     外观从本页移除：窗口右上角已有唯一外观入口，避免两个地方改同一状态。
//   · 能力与服务里的每一项都指向 OVERLAY 中真实存在的路由，功能零丢失。
//   · 知识库分为「启用」与「全部」两组，数据来自 vault:list 的真实 linkEnabled；
//     启停走真实 conn:scopeSet，停用会被服务端真实拒绝，不灰按钮糊弄。
//   · 读数一律来自 capability-manifest / app 状态 / IPC 返回值；零示例、零估值。
// ---------------------------------------------------------------------------
import { h, icon, toast } from '../ui-kit.js';
import { CAPABILITY_MANIFEST } from '../capability-manifest.js';

const T = CAPABILITY_MANIFEST.totals || {};
const n = (v) => (Number(v) || 0).toLocaleString('zh-CN');

// v6.41.0：按用户要求精简设置侧栏——移除「自主引擎 / 本地语言模型 / 全库总览」入口。
// 注意：仅移除设置面板的展示入口，功能本身与其它调用点（能力中枢、主界面命令面板）保留。
const SERVICES = [
  { key: 'ask', ico: 'ask', title: '问一问', sub: '基于本库作答 · 引用可溯源' },
  { key: 'settle', ico: 'settle', title: '沉淀通道', sub: '外部助手经标准接口回写' },
  { key: 'consolidate', ico: 'consolidate', title: '巩固', sub: '一轮睡眠 · 自我整理' },
  // v10.18.9：「体系」与「知识库 → 体系管理」是同一功能，只保留后者一个入口。
  { key: 'semantic', ico: 'link', title: '语义关联', sub: '沉淀回流 · 语义调取 · 库桥' },
  { key: 'starred', ico: 'link', title: '工作台收藏夹', sub: '我的星标 · 最近打开（双版本）' },
  { key: 'enterprise', ico: 'enterprise', title: '企业管理', sub: '组织 · 知识 · 治理（企业版）', ent: true },
];

// v6.39.0：左侧目录改为「悬停展开为一级功能目录」。
// 每组不再只是一个抽象分类：鼠标移到组上，组内的真实功能全部平铺成一级入口；
// 点子项直接打开对应功能区，而不是先切分类再找卡片。
const NAV_GROUPS = [
  // v6.41.0：按用户要求移除「图谱与工作区」分组（红圈项）。
  // 星图 / 工作区 / 收藏夹入口仍在主界面左侧导航与命令面板，功能不受影响。
  {
    key: 'service', label: '能力与服务', ico: 'capabilities',
    // 实际 leaves 在 drawNav() 按当前版本动态生成，企业项不会被个人版误展开。
    leaves: null,
  },
  {
    key: 'vault', label: '知识库', ico: 'folder',
    leaves: [
      { label: '启用的知识库', group: 'vault', anchor: 'stVaultEnabled' },
      { label: '全部知识库', group: 'vault', anchor: 'stVaultAll' },
      { label: '体系管理', key: 'atlas' },
    ],
  },
  {
    key: 'about', label: '关于', ico: 'about',
    leaves: [
      { label: '开发者信息', group: 'about', anchor: 'stDeveloper' },
      { label: '功能项目', group: 'about', anchor: 'stFeatures' },
    ],
  },
];

export function mountSettings({ host, app, api, toast, status, route, openFloat, setSelected, fmtTime }) {
  let active = 'service'; // v6.41.0：graph 分组已移除，默认落在「能力与服务」
  let expanded = null;
  let collapseTimer = null;
  let vaultRegistry = null;
  let vaultLoading = false;
  let vaultError = '';

  const root = h('div', { class: 'settings-view' });
  const nav = h('aside', { class: 'settings-nav', role: 'tablist', 'aria-label': '设置分类' });
  const pane = h('div', { class: 'settings-pane' });
  root.appendChild(nav);
  root.appendChild(pane);
  host.innerHTML = '';
  host.appendChild(root);

  async function loadVaults(force = false) {
    if (vaultLoading && !force) return;
    vaultLoading = true;
    vaultError = '';
    if (active === 'vault') draw();
    try {
      const r = await api.vault?.list?.();
      if (r?.ok) vaultRegistry = r.data || { vaults: [] };
      else vaultError = String(r?.error || '读取知识库失败');
    } catch (e) {
      vaultError = String(e?.message || e);
    }
    vaultLoading = false;
    if (active === 'vault') draw();
  }

  async function switchVault(v) {
    const r = await api.vault?.switch?.(v.id);
    if (!r?.ok) { toast(String(r?.error || '切换失败'), 'err'); return; }
    await app?.refreshVault?.();
    app.currentId = null;
    app.history = []; app.hIndex = -1;
    vaultRegistry = null;
    await loadVaults();
    toast(`已切换到「${v.name || v.path}」`, 'ok');
  }

  async function setVaultEnabled(v, enabled) {
    status?.(enabled ? '正在启用知识库…' : '正在停用知识库…');
    try {
      const r = await api.connections?.scopeSet?.({ id: v.id, enabled });
      const failed = !r || r.ok === false || !!r.error;
      if (failed) {
        toast(String(r?.error || r?.message || '设置失败'), 'err');
      } else {
        vaultRegistry = null;
        await loadVaults();
        toast(`已${enabled ? '启用' : '停用'}「${v.name || v.path}」`, 'ok');
      }
    } catch (e) {
      toast(String(e?.message || e), 'err');
    }
    status?.('就绪');
  }

  function serviceSection() {
    const isEnt = document.body.classList.contains('edition-enterprise');
    const cards = SERVICES.filter((s) => !s.ent || isEnt).map((s) => h('button', {
      class: 'st-svc', onclick: () => (openFloat || route)(s.key),
    },
      h('span', { class: 'st-svc-ico', html: icon(s.ico, 18) }),
      h('span', { class: 'st-svc-t' }, h('b', null, s.title), h('small', null, s.sub)),
      h('span', { class: 'st-svc-arrow' }, '→')));
    return h('div', { class: 'st-section' },
      h('div', { class: 'st-sec-head' },
        h('h2', null, '能力与服务'),
        h('p', null, '内核里真实存在的能力入口。点按即向上浮出工作窗，返回只关最上层，底层界面保持原位。')),
      h('div', { class: 'st-svc-grid' }, ...cards));
  }

  function vaultRow(v) {
    const enabled = v.linkEnabled !== false;
    const current = !!v.active;
    // v6.41.0：副标题不再重复「当前」——当前状态由右侧 st-vault-badge 唯一标识，
    // 避免同一卡片出现两次「当前」（此前副标题一次、徽标一次，观感冗余）。
    const meta = [
      enabled ? '启用' : '停用',
      v.lastOpenedAt ? `上次打开 ${fmtTime(v.lastOpenedAt)}` : '尚未打开',
    ].filter(Boolean).join(' · ');
    return h('div', { class: 'st-vault-row' + (current ? ' is-current' : '') },
      h('span', { class: 'st-vault-dot', style: { background: v.color || 'var(--dim)' } }),
      h('div', { class: 'st-vault-t' },
        h('b', { title: v.name || '' }, v.name || v.path || '未命名知识库'),
        h('small', { title: v.path || '' }, `${v.path || '—'} · ${meta}`)),
      h('div', { class: 'st-vault-acts' },
        current
          ? h('span', { class: 'st-vault-badge on', title: '这是当前正在使用的知识库' }, '当前')
          : h('button', { class: 'btn ghost', onclick: () => switchVault(v) }, '切换'),
        h('button', { class: 'btn ghost', onclick: () => setVaultEnabled(v, !enabled) },
          enabled ? '停用' : '启用'),
        h('button', { class: 'btn ghost', title: '在体系中管理', onclick: () => route('atlas') }, '管理')));
  }

  function vaultGroup(title, sub, list, emptyText, anchorId) {
    return h('div', { class: 'st-vault-group', id: anchorId },
      h('div', { class: 'st-vault-head' }, h('b', null, title), h('span', null, `${list.length} 个 · ${sub}`)),
      list.length
        ? h('div', { class: 'st-vault-grid' }, ...list.map(vaultRow))
        : h('div', { class: 'st-empty' }, emptyText));
  }

  function vaultSection() {
    const all = Array.isArray(vaultRegistry?.vaults) ? vaultRegistry.vaults : [];
    const enabled = all.filter((v) => v.linkEnabled !== false);
    return h('div', { class: 'st-section' },
      h('div', { class: 'st-sec-head' },
        h('h2', null, '知识库'),
        h('p', null, '启用列表是可被外部接入与扫描的库；全部列表包含本机登记的所有库。两组都来自真实注册表。')),
      h('div', { class: 'st-card' },
        h('div', { class: 'st-vault-tools' },
          h('button', { class: 'btn', onclick: () => route('atlas') }, '前往体系管理'),
          h('button', { class: 'btn ghost', onclick: () => loadVaults(true) }, '刷新列表')),
        vaultLoading && !all.length
          ? h('div', { class: 'st-empty' }, '正在读取本机知识库登记…')
          : null,
        vaultError
          ? h('div', { class: 'st-empty' }, `读取失败：${vaultError}`)
          : null,
        !vaultLoading && !vaultError
          ? h('div', null,
            vaultGroup('启用的知识库', '允许接入 / 可被扫描', enabled, '当前没有启用的知识库。可在下方「全部知识库」中启用。', 'stVaultEnabled'),
            vaultGroup('全部知识库', '包含已停用', all, '尚无登记的知识库。请到「体系」中新建或打开文件夹接入。', 'stVaultAll'))
          : null));
  }

  // 关于页局部弹层：鼓励贡献（二维码）与商用授权（开发者联系信息）。
  // 只挂在当前设置浮层 root 内，随浮层卸载自动移除，不影响主窗口。
  function showAboutOverlay(kind) {
    const isDonate = kind === 'donate';
    const veil = h('div', { class: 'st-about-veil' });
    const close = () => veil.remove();
    const card = h('div', { class: 'st-about-pop', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'st-about-pop-head' },
        h('b', null, isDonate ? '鼓励贡献' : '商用授权'),
        h('button', { class: 'st-about-pop-x', 'aria-label': '关闭', onclick: close }, '×')),
      isDonate
        ? h('div', { class: 'st-about-pop-body' },
            h('img', { class: 'st-about-qr', src: './assets/donate-qr.png', alt: '鼓励开发者贡献二维码' }),
            h('p', null, '扫码鼓励开发者贡献；非强制，不影响任何功能。'))
        : h('div', { class: 'st-about-pop-body' },
            h('p', { class: 'st-about-pop-lead' }, '若想商用，请联系开发者取得授权。'),
            h('p', null, h('b', null, '开发者：'), '宋锦涛'),
            h('p', null, h('b', null, '联系开发者：'), '13869162267'),
            h('p', { class: 'st-about-pop-tip' }, '个人版以 AGPL-3.0 开源；闭源商用 / 商业 SaaS 须另行授权。')));
    veil.appendChild(card);
    veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
    root.appendChild(veil);
  }

  function aboutSection() {
    const ver = document.getElementById('brandVersion')?.textContent?.trim() || '';
    const isEnt = document.body.classList.contains('edition-enterprise');
    // 开发者信息真源：README.md 末段「作者 / 版权」、installer.nsi 完成页、
    // package.json 的 license 字段。这里不写示例值，也不从网络取数。
    const DEV = [
      { k: '开发者', v: '宋锦涛' },
      { k: '联系方式', v: '13869162267' },
      { k: '许可', v: isEnt ? '专有商用许可' : 'AGPL-3.0' },
      { k: '签名', v: 'CN=宋锦涛 · 本机自签名' },
    ];
    const FEATURES = [
      { t: '全库总览', s: '所有知识库 + 真实库间关联（v6.39.0）', key: 'vaultOverview' },
      { t: '工作台收藏夹', s: '星标 / 最近打开，只存本机（v6.38.0）', key: 'starred' },
      { t: '星图', s: '关系网络 · 激活扩散 · 多库星系', key: 'graph' },
      { t: '本地语言模型', s: '真实训练权重的领域模型，不是通用聊天', key: 'neolm' },
      { t: '语义关联', s: '沉淀回流 / 语义调取 / 库桥', key: 'semantic' },
      { t: '企业 API 自动同步', s: '企业版：一次配置，按间隔增量同步', key: 'enterprise', ent: true },
    ];
    return h('div', { class: 'st-section' },
      h('div', { class: 'st-sec-head' },
        h('h2', null, '关于'),
        h('p', null, '全部读数来自源码、安装包与运行状态，不含示例值。')),
      h('div', { class: 'st-card st-about' },
        h('div', { class: 'st-about-brand' },
          h('span', { class: 'st-about-mark' }, 'N'),
          h('div', null,
            h('b', null, 'NeoCosmos'),
            h('small', null, ver ? `版本 ${ver}` : '版本以标题栏为准'))),
        h('div', { class: 'st-about-grid' },
          h('div', null, h('b', null, n(T.channels)), h('span', null, '本机通道')),
          h('div', null, h('b', null, n(T.events)), h('span', null, '推送事件')),
          h('div', null, h('b', null, n(T.apis)), h('span', null, '接口')),
          h('div', null, h('b', null, n(T.hub)), h('span', null, '中枢直达')),
          h('div', null, h('b', null, n(T.view)), h('span', null, '视图调用')),
          h('div', null, h('b', null, n(T.tools)), h('span', null, '内核工具')),
          h('div', null, h('b', null, n(T.mcpTools)), h('span', null, '标准接口工具'))),
        h('p', { class: 'st-boundary' },
          '数据留在本机；本地领域模型，非通用聊天模型；行为引擎无意识。')),
      h('div', { class: 'st-card st-about-detail', id: 'stDeveloper' },
        h('div', { class: 'st-sec-head' },
          h('h2', null, '开发者信息'),
          h('p', null, '取自随包说明与安装包元数据；自签名仅用于本机校验，对外分发仍需 CA OV/EV 证书。')),
        h('div', { class: 'st-developer' }, ...DEV.map((d) => h('div', null,
          h('span', null, d.k), h('b', null, d.v))),
          h('button', { class: 'st-developer-action donate', onclick: () => showAboutOverlay('donate') },
            h('span', null, '鼓励贡献'), h('b', null, '扫码支持开发')),
          h('button', { class: 'st-developer-action license', onclick: () => showAboutOverlay('license') },
            h('span', null, '商用授权'), h('b', null, '联系开发者')))),
      h('div', { class: 'st-card st-about-detail', id: 'stFeatures' },
        h('div', { class: 'st-sec-head' },
          h('h2', null, '功能项目'),
          h('p', null, '点击直达各功能入口。')),
        h('div', { class: 'st-feature-list' }, ...FEATURES.filter((f) => !f.ent || isEnt).map((f) => h('button', {
          class: 'st-feature',
          onclick: () => (openFloat || route)(f.key),
        },
          h('span', { class: 'st-feature-dot' }),
          h('span', null, h('b', null, f.t), h('small', null, f.s)))))));
  }

  const RENDER = {
    service: serviceSection,
    vault: vaultSection,
    about: aboutSection,
  };

  function setExpanded(key) {
    clearTimeout(collapseTimer);
    expanded = key;
    for (const el of nav.querySelectorAll('.settings-nav-item')) {
      el.classList.toggle('is-expanded', el.dataset.group === key);
    }
  }
  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      expanded = null;
      for (const el of nav.querySelectorAll('.settings-nav-item')) el.classList.remove('is-expanded');
    }, 220);
  }

  function activateLeaf(leaf) {
    clearTimeout(collapseTimer);
    if (leaf.key) {
      // 功能项直接打开对应工作区，不走"先切分类再找卡片"两步。
      (openFloat || route)(leaf.key);
      return;
    }
    if (leaf.group) { active = leaf.group; draw(); }
    if (leaf.anchor) {
      setTimeout(() => {
        const target = pane.querySelector('#' + leaf.anchor);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }

  function drawNav() {
    nav.innerHTML = '';
    nav.onmouseleave = scheduleCollapse;
    for (const g of NAV_GROUPS) {
      const isEnt = document.body.classList.contains('edition-enterprise');
      const leaves = g.key === 'service'
        ? SERVICES.filter((s) => !s.ent || isEnt).map((s) => ({ label: s.title, key: s.key }))
        : (g.leaves || []);
      const group = h('button', {
        class: 'settings-nav-item' + (active === g.key ? ' is-active' : '') + (expanded === g.key ? ' is-expanded' : ''),
        'data-group': g.key,
        role: 'tab', 'aria-selected': active === g.key ? 'true' : 'false',
        onmouseenter: () => setExpanded(g.key),
        onfocus: () => setExpanded(g.key),
        onclick: () => {
          active = g.key;
          expanded = g.key;
          draw();
          if (g.key === 'vault' && !vaultRegistry && !vaultLoading) loadVaults();
        },
      },
        h('span', { class: 'st-nav-ico', html: icon(g.ico, 15) }),
        h('span', null, g.label));
      nav.appendChild(group);

      // 悬停即展开：组内每项平铺为一级入口，点击直达功能/分区。
      const leavesBox = h('div', {
        class: 'settings-nav-leaves', 'data-group': g.key,
        onmouseenter: () => clearTimeout(collapseTimer),
        onmouseleave: scheduleCollapse,
      }, ...leaves.map((leaf) => h('button', {
        class: 'settings-nav-leaf',
        title: leaf.key ? `打开「${leaf.label}」` : `定位到「${leaf.label}」`,
        onclick: () => activateLeaf(leaf),
      }, h('span', { class: 'st-leaf-dot' }), h('span', null, leaf.label))));
      nav.appendChild(leavesBox);
    }
  }

  function draw() {
    drawNav();
    pane.innerHTML = '';
    try { pane.appendChild((RENDER[active] || serviceSection)()); }
    catch (e) {
      pane.appendChild(h('div', { class: 'st-empty' }, '设置内容加载失败：' + String(e?.message || e)));
    }
  }

  const offVault = app?.on?.((kind) => {
    if (kind === 'vault') { vaultRegistry = null; if (active === 'vault') loadVaults(); }
  });

  draw();
  return {
    refresh: loadVaults,
    unmount() {
      try { offVault?.(); } catch { /* ignore */ }
      try { root.remove(); } catch { /* ignore */ }
    },
  };
}

export default mountSettings;
