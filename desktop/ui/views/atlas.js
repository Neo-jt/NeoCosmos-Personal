// 体系 · 知识库管理 / 体检 / 突触构成 / 写审计溯源
// v1.1.0：知识库管理台（列表 / 新建 / 切换 / 改名 / 配色 / 移除登记）+ 跨库关联总览。
import { h, toast, status, fmtTime, icon, modal, confirmDialog } from '../ui-kit.js';
// v6.27.0：突触配色 / 建库色板统一从共享真源取，消除与 relations / graph / map2d 的重复定义。
import { EDGE_COLORS, VAULT_PALETTE, SEM } from '../semantic-palette.js';

const TYPE_COLOR = EDGE_COLORS;
const VAULT_COLORS = VAULT_PALETTE;
const TYPE_LABEL = {
  explicit_link: '显式链接', hierarchical: '层级包含', co_occurrence: '共现',
  semantic_similar: '语义相似', causal: '因果支撑', temporal: '时间邻近', question_answer: '问答沉淀',
  cross_kb: '跨库关联',
};

// v6.36.0：体系页内部按意图分组，不再把全部卡片堆成一面墙。
const ATLAS_TABS = [
  { key: 'vaults', label: '知识库', ico: 'folder' },
  { key: 'health', label: '体检', ico: 'capabilities' },
  { key: 'links', label: '突触', ico: 'graph' },
  { key: 'maintain', label: '维护', ico: 'astra' },
  { key: 'journal', label: '写审计', ico: 'settle' },
];

export function mountAtlas({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page' });
  host.appendChild(page);
  // v2.2.0：立即给出载入占位 —— 数据回来前不留空白页
  // （此前空白是常态：任何一次中途交互都会让页面永久停在空白）
  page.appendChild(h('div', { class: 'empty-hint' }, '正在载入体系体检…'));

  let stats = null, journal = [], graph = null, registry = null;
  let activeTab = 'vaults';

  // v2.2.0：代次守卫 —— 快速切页时，先发后到的旧请求不得覆盖新数据
  let gen = 0;
  async function load() {
    const my = ++gen;
    // v2.2.0：登记"正在取数"，外部据此判断界面是否已安定
    const done = app.beginLoad();
    let s, j, g, r;
    try {
      [s, j, g, r] = await Promise.all([api.stats(), api.journal(60), app.graphData(), api.vault.list()]);
    }
    finally { done(); }   // v2.2.1：异常时也要归还计数
    if (my !== gen) return;
    if (s?.ok) stats = s.data;
    if (Array.isArray(j)) journal = j;
    graph = g;
    if (r?.ok) registry = r.data;
    render();
  }

  function head() {
    return h('div', { class: 'page-head' },
      h('h2', null, '体系 · 管理与溯源'),
      h('p', null, '多知识库在磁盘上就是多个普通文件夹；所有写操作都进 journal 可逐条溯源。卸载软件不会动任何知识库。'),
    );
  }

  // ---------------- 知识库管理台 ----------------
  function vaultManagerCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '知识库管理', h('span', { class: 'cnt' }, `${registry?.vaults?.length || 0} 个`)));
    const vaults = registry?.vaults || [];
    if (!vaults.length) { box.appendChild(h('div', { class: 'empty-hint' }, '尚无登记的知识库')); return box; }
    for (const v of vaults) {
      const row = h('div', { class: 'vault-row' + (v.active ? ' is-active' : '') },
        h('span', { class: 'vault-color', style: { background: v.color, boxShadow: `0 0 10px ${v.color}` }, title: '库标识色' }),
        h('div', { class: 'vault-info' },
          h('div', { class: 'vault-name' }, v.name, v.active ? h('span', { class: 'badge', style: { marginLeft: '8px' } }, '当前') : null),
          h('div', { class: 'vault-path' }, v.path),
          h('div', { class: 'vault-meta' }, v.lastOpenedAt ? `上次打开 ${fmtTime(v.lastOpenedAt)}` : '尚未打开')),
        h('div', { class: 'vault-acts' },
          !v.active ? h('button', { class: 'btn ghost', onclick: async () => {
            const r = await api.vault.switch(v.id);
            if (r?.ok) {
              await app.refreshVault();
              app.currentId = null;
              app.history = []; app.hIndex = -1;
              await load();
              toast(`已切换到「${v.name}」`, 'ok');
            } else toast(r?.error || '切换失败', 'err');
          } }, '切换') : null,
          h('button', { class: 'btn ghost', title: '打开文件夹', html: icon('open', 12), onclick: async () => {
            // v6.20：旧版对非活动库只弹一句 toast，是空壳按钮。
            // 现在真实执行「切库 → 刷新 → 打开该库目录」，失败如实报错。
            try {
              if (!v.active) {
                const r = await api.vault.switch(v.id);
                if (!r?.ok) { toast(String(r?.error || '切换知识库失败，未打开目录'), 'err'); return; }
                await app.refreshVault();
              }
              api.vault.reveal();
            } catch (e) { toast('打开目录失败：' + String(e?.message || e), 'err'); }
          } }),
          h('button', { class: 'btn ghost', title: '重命名', html: icon('edit', 12), onclick: async () => {
            const vals = await modal({
              title: '重命名知识库',
              message: '只改显示名称，不动磁盘文件夹。',
              fields: [{ key: 'name', label: '名称', type: 'text', required: true, value: v.name }],
              confirmText: '保存',
            });
            if (!vals) return;
            const r = await api.vault.rename({ id: v.id, name: vals.name.trim() });
            if (r?.ok) { toast('已重命名', 'ok'); await app.refreshVault(); await load(); }
            else toast(r?.error || '失败', 'err');
          } }),
          h('button', { class: 'btn ghost', title: '标识色', html: icon('palette', 12), onclick: async () => {
            const vals = await modal({
              title: '库标识色',
              message: '颜色出现在标题栏、星图与跨库关联徽章上。',
              fields: [{ key: 'color', label: '颜色', type: 'select', value: v.color,
                options: VAULT_COLORS.map((c) => ({ value: c, label: c })) }],
              confirmText: '保存',
            });
            if (!vals) return;
            const r = await api.vault.setColor({ id: v.id, color: vals.color });
            if (r?.ok) { toast('已更新标识色', 'ok'); await app.refreshVault(); await load(); }
            else toast(r?.error || '失败', 'err');
          } }),
          h('button', { class: 'btn ghost', title: '移除登记（不动文件）', html: icon('trash', 12), onclick: async () => {
            const go = await confirmDialog({
              title: '移除登记',
              message: `把「${v.name}」从知识库列表移除？\n\n只移除登记，磁盘上的 .md 文件一个都不会动；之后可重新"打开文件夹"接入。`,
              confirmText: '移除登记',
            });
            if (!go) return;
            const r = await api.vault.forget(v.id);
            if (r?.ok) {
              await app.refreshVault();
              app.currentId = null;
              app.history = []; app.hIndex = -1;
              await load();
              toast(r.switched ? '已移除并切换到其他知识库' : '已移除登记', 'ok');
            } else toast(r?.error || '失败', 'err');
          } }),
        ));
      box.appendChild(row);
    }
    box.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: onCreate }, '新建知识库'),
      h('button', { class: 'btn ghost', onclick: async () => {
        const res = await api.vault.pick();
        if (!res.canceled) { await app.refreshVault(); await load(); toast('已接入知识库', 'ok'); }
      } }, '打开文件夹接入'),
      h('button', { class: 'btn ghost', onclick: () => api.vault.reveal() }, '打开当前库目录'),
    ));
    return box;
  }

  async function onCreate() {
    const vals = await modal({
      title: '新建知识库',
      message: '每个知识库是磁盘上的一个普通文件夹，拥有独立的卡片网络、星图与配色。',
      fields: [{ key: 'name', label: '知识库名称', type: 'text', required: true, placeholder: '例如：产品研究' }],
      confirmText: '创建并打开',
    });
    if (!vals) return;
    const res = await api.vault.create({ name: vals.name.trim() });
    if (res?.ok) {
      await app.refreshVault();
      app.currentId = null;
      app.history = []; app.hIndex = -1;
      await load();
      toast(`已创建并打开「${res.vault.name}」`, 'ok');
    } else toast(res?.error || '创建失败', 'err');
  }

  // ---------------- 跨库关联总览 ----------------
  function crossCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '跨库关联', h('span', { class: 'cnt' }, `${stats?.cross_kb_count ?? app.vault?.cross_links ?? 0} 条`)));
    const links = (graph?.nodes || []).filter((n) => n.memory_layer === 'cross');
    if (!links.length) {
      box.appendChild(h('div', { class: 'empty-hint' },
        '还没有跨库突触。在工作区右栏点「⇄」按钮，把当前库的卡片指向另一个库里的卡片——它会让两个知识网络真正长在一起。'));
      return box;
    }
    for (const n of links) {
      box.appendChild(h('div', { class: 'review-item' },
        h('div', { class: 'rt', style: { cursor: 'pointer' }, onclick: async () => {
          const r = await api.crosskb.open({ vaultId: n.cross?.vault_id, path: n.path });
          if (r?.ok) {
            await app.refreshVault();
            app.currentId = null;
            app.history = []; app.hIndex = -1;
            if (r.openId) await app.openCard(r.openId);
            route('workspace');
          } else toast(r?.error || '跳转失败', 'err');
        } },
          h('span', { style: { color: n.cross?.vault_color || SEM.crossKb } }, '⇄'),
          h('span', { style: { color: 'var(--text)' } }, n.title)),
        h('div', { class: 'rd' }, `${n.cross?.vault_name || '其他知识库'} · ${n.path}`),
      ));
    }
    return box;
  }

  function statsCard() {
    const s = stats;
    const box = h('div', { class: 'card' }, h('h3', null, '体检'));
    if (!s) { box.appendChild(h('div', { class: 'empty-hint' }, '尚无数据')); return box; }
    for (const [k, v] of [
      ['卡片', s.nodes], ['突触', s.edges], ['平均度数', s.avg_degree],
      ['孤立率', `${Math.round((s.orphan_rate || 0) * 100)}%`],
      ['权重下限', s.weight_min?.toFixed?.(3) ?? s.weight_min],
      ['权重上限', s.weight_max?.toFixed?.(3) ?? s.weight_max],
    ]) box.appendChild(h('div', { class: 'kv' }, h('span', null, k), h('b', null, String(v ?? '—'))));
    return box;
  }

  function typeCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '突触构成'));
    const counts = new Map();
    for (const e of graph?.edges || []) counts.set(e.type, (counts.get(e.type) || 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    if (!counts.size) { box.appendChild(h('div', { class: 'empty-hint' }, '尚无突触')); return box; }
    for (const [type, color] of Object.entries(TYPE_COLOR)) {
      const c = counts.get(type) || 0;
      if (!c) continue;
      box.appendChild(h('div', { style: { marginBottom: '7px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' } },
          h('span', null,
            h('span', { style: { display: 'inline-block', width: '7px', height: '7px', borderRadius: '2px', background: color, marginRight: '6px', boxShadow: `0 0 6px ${color}` } }),
            TYPE_LABEL[type] || type),
          h('b', null, `${c} · ${Math.round(c / total * 100)}%`)),
        h('div', { class: 'syn-bar' }, h('i', { style: { width: `${Math.max(2, Math.round(c / total * 100))}%`, background: color } })),
      ));
    }
    return box;
  }

  function toolsCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '维护'));
    // v6.22.0 显示优化：原来两个 .btn-row 里四个按钮的 class 不一致（3 个 ghost
    // + 1 个实心），而 northstar 把 .btn.ghost 的边框抹成 transparent，
    // 于是只有「推导突触」看得出是按钮，其余三个像散落的文字，两行也对不齐。
    // 现在统一成 2 列等宽操作网格，每个按钮都有实心底、发丝线、标题 + 真实功能说明；
    // 只改呈现，四个 onclick 与条件显示逻辑一字未动。
    const grid = h('div', { class: 'maint-grid' });
    const action = (label, hint, onclick, primary) => h('button', {
      class: 'btn ghost maint-btn' + (primary ? ' is-primary' : ''),
      // v6.22.0：显式写成 onclick: onclick，让 check-ui 的「死按钮」静态闸门
      // 能识别这个工厂函数生成的按钮确实带事件处理（简写属性会被正则漏掉）。
      type: 'button', title: hint, onclick: onclick,
    }, h('b', null, label), h('i', null, hint));
    grid.appendChild(action('重建索引', '重新解析双链与索引', async () => {
      await api.rebuild(); await app.refreshVault(); await load(); toast('索引已重建', 'ok');
    }));
    grid.appendChild(action('推导突触', '为无链库长出关系', derive, true));
    if (app.info?.exampleAvailable) {
      grid.appendChild(action('载入示例语料', '写入随包示例卡片', async () => {
        const r = await api.vault.loadExample();
        await app.refreshVault(); await load();
        toast(`已载入示例语料 ${r.written} 张`, 'ok');
      }));
      grid.appendChild(action('写入入门卡片', '建立入门引导卡片', async () => {
        await api.vault.seed(); await app.refreshVault(); await load(); toast('已写入入门卡片', 'ok');
      }));
    }
    box.appendChild(grid);
    box.appendChild(h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', marginTop: '8px', lineHeight: '1.7' } },
      '推导突触：接进来的库若没有 [[双链]]，网络就是散沙。推导器从标签、共现术语、时间邻近与目录层级里长出四类突触，全程不动你的正文。'));
    box.appendChild(h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', marginTop: '8px', lineHeight: '1.7' } },
      '外部改动 .md 会被自动感知并重建索引（文件监视），无需手动操作。'));
    return box;
  }

  // ---------------- 外观与操作（v1.2.0） ----------------
  function settingsCard() {
    const theme = localStorage.getItem('neolink-theme') || 'dark';
    const density = localStorage.getItem('neolink-density') || 'cozy';
    const box = h('div', { class: 'card' }, h('h3', null, '外观与操作'));
    box.appendChild(h('div', { class: 'field' }, h('label', null, '主题'),
      h('select', { onchange: (e) => app.applyTheme?.(e.target.value) },
        h('option', { value: 'light', ...(theme !== 'dark' ? { selected: true } : {}) }, '浅色（默认）'),
        h('option', { value: 'dark', ...(theme === 'dark' ? { selected: true } : {}) }, '石墨深色'))));
    box.appendChild(h('div', { class: 'field' }, h('label', null, '信息密度'),
      h('select', { onchange: (e) => app.applyDensity?.(e.target.value) },
        h('option', { value: 'cozy', ...(density === 'cozy' ? { selected: true } : {}) }, '舒适'),
        h('option', { value: 'compact', ...(density === 'compact' ? { selected: true } : {}) }, '紧凑（企业高密度）'))));
    const expert = localStorage.getItem('neolink-expert') === '1';
    box.appendChild(h('div', { class: 'field' }, h('label', null, '专家模式（权重 / 强化 / 记忆层）'),
      h('select', { onchange: (e) => app.applyExpert?.(e.target.value === '1') },
        h('option', { value: '0', ...(expert ? {} : { selected: true }) }, '关闭（默认：只保留 存 / 问 / 理）'),
        h('option', { value: '1', ...(expert ? { selected: true } : {}) }, '开启'))));
    box.appendChild(h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', lineHeight: '1.7' } },
      '个人 / 团队 / 企业共用一套操作逻辑：个人用它长记忆，团队把知识库文件夹放进 OneDrive、NAS 或共享盘同步目录即可多人共用，企业用审计与报告回答“谁在何时改了什么”。星图在两种主题下均保持深空——这是它的物理隐喻。'));
    return box;
  }

  function downloadBlob(name, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async function exportJournalCsv() {
    const r = await api.journal(5000);
    const rows = Array.isArray(r) ? r : [];
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = ['时间,操作,文件,执行者',
      ...rows.map((j) => [j.ts || j.at || '', j.op || '', j.path || j.file_path || j.filePath || '', j.actor || ''].map(esc).join(',')),
    ].join('\r\n');
    downloadBlob(`neolink-audit-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast(`已导出 ${rows.length} 条审计记录`, 'ok');
  }

  async function exportGraphReport() {
    const [s, g] = await Promise.all([api.stats(), app.graphData()]);
    const report = {
      schema: 'neolink-report/1',
      generatedAt: new Date().toISOString(),
      vault: { name: app.vault?.name, path: app.vault?.path, nodes: app.vault?.nodes, edges: app.vault?.edges, cross_links: app.vault?.cross_links },
      health: s?.ok ? s.data : null,
      graphStats: g?.stats || null,
      synapseTypes: g?.edgeTypeLabels || {},
    };
    downloadBlob(`neolink-report-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(report, null, 2), 'application/json');
    toast('已导出网络健康报告（JSON）', 'ok');
  }

  function journalCard() {
    const box = h('div', { class: 'card grid-span' },
      h('h3', null, '写审计（journal）', h('span', { class: 'cnt' }, `最近 ${journal.length} 条`)));
    box.appendChild(h('div', { class: 'btn-row', style: { marginBottom: '10px' } },
      h('button', { class: 'btn ghost', onclick: exportJournalCsv }, '导出审计 CSV'),
      h('button', { class: 'btn ghost', onclick: exportGraphReport }, '导出网络报告 JSON'),
    ));
    if (!journal.length) { box.appendChild(h('div', { class: 'empty-hint' }, '还没有任何写操作。所有修改（含 Agent 回写）都会留痕。')); return box; }
    const t = h('table', { class: 'grid' });
    t.appendChild(h('thead', null, h('tr', null,
      h('th', null, '时间'), h('th', null, '操作'), h('th', null, '文件'), h('th', null, '执行者'))));
    const tb = h('tbody');
    for (const j of journal) {
      tb.appendChild(h('tr', null,
        h('td', null, fmtTime(j.ts || j.at)),
        h('td', null, j.op || '—'),
        h('td', null, j.path || j.file_path || j.filePath || '—'),
        h('td', null, j.actor || '—'),
      ));
    }
    t.appendChild(tb);
    box.appendChild(t);
    return box;
  }

  async function derive() {
    status('正在推导突触…');
    const r = await api.derive({});
    if (!r?.ok) { toast(r?.error || '推导失败', 'err'); status('就绪'); return; }
    const a = r.data.added || {};
    toast(`推导完成：新增 ${r.data.total} 条突触（相似 ${a.semantic_similar || 0} · 共现 ${a.co_occurrence || 0} · 时序 ${a.temporal || 0} · 层级 ${a.hierarchical || 0}）`, 'ok', 5000);
    await app.refreshVault();
    await load();
  }

  /**
   * v2.1.0 · 容量卡
   * 百万级扩展是"看不见的工程"，必须让它可见：当前规模分档、V8 堆上限与占用、
   * 物理内存封顶、是否已因大库自举扩容过 —— 全部摊开给用户看。
   */
  function capacityCard() {
    const box = h('div', { class: 'card' }, h('h3', null, '容量'));
    const sc = app.vault?.scale || {};
    const hp = app.vault?.heap || null;
    if (sc.label) {
      box.appendChild(h('div', { class: 'kv' }, h('span', null, '规模分档'), h('b', null, sc.label)));
    }
    if (!hp) {
      box.appendChild(h('div', { class: 'empty-hint' }, '堆信息不可用'));
      return box;
    }
    const mb = (n) => `${Number(n || 0).toLocaleString('en-US')} MB`;
    for (const [k, v] of [
      ['堆上限', mb(hp.limit_mb)],
      ['堆占用', mb(hp.used_mb)],
      ['进程常驻', mb(hp.rss_mb)],
      ['物理封顶', mb(hp.cap_mb)],
      ['目标堆', hp.target_mb ? mb(hp.target_mb) : '无需扩容'],
      ['扩容重启', hp.relaunched ? '已按大库扩容' : '未触发'],
    ]) box.appendChild(h('div', { class: 'kv' }, h('span', null, k), h('b', null, String(v))));
    box.appendChild(h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', marginTop: '8px', lineHeight: '1.7' } },
      `V8 堆在进程创建时定容，运行期改不动。检测到大库时客户端会带 ` +
      `--js-flags=--max-old-space-size 重启自身，把上限抬到物理内存的 70%（上限 ${mb(hp.cap_mb)}）。`));
    return box;
  }

  function atlasTabs() {
    return h('div', { class: 'compact-tabs', role: 'tablist', 'aria-label': '体系分区' },
      ...ATLAS_TABS.map((t) => h('button', {
        class: 'compact-tab' + (activeTab === t.key ? ' is-active' : ''),
        role: 'tab', 'aria-selected': activeTab === t.key ? 'true' : 'false',
        onclick: () => { activeTab = t.key; render(); },
      },
        h('span', { html: icon(t.ico, 14) }), h('span', null, t.label))));
  }

  function summaryStrip() {
    const vaults = Array.isArray(registry?.vaults) ? registry.vaults : [];
    const enabled = vaults.filter((v) => v.linkEnabled !== false).length;
    return h('div', { class: 'page-kpis' },
      ...[
        ['登记知识库', vaults.length || '—'],
        ['启用知识库', enabled || '—'],
        ['卡片', stats?.nodes ?? '—'],
        ['突触', stats?.edges ?? '—'],
      ].map(([k, v]) => h('div', { class: 'page-kpi' },
        h('span', null, k), h('b', null, String(v)))));
  }

  function activePane() {
    if (activeTab === 'health') return h('div', null, statsCard(), capacityCard());
    if (activeTab === 'links') return h('div', null, crossCard(), typeCard());
    if (activeTab === 'maintain') return h('div', null, toolsCard());
    if (activeTab === 'journal') return h('div', null, journalCard());
    return h('div', null, vaultManagerCard());
  }

  function render() {
    page.innerHTML = '';
    page.appendChild(h('div', { class: 'page-shell' },
      head(),
      atlasTabs(),
      summaryStrip(),
      h('div', { class: 'compact-body' }, activePane())));
  }

  // v2.2.0：退订监听器（app.on 返回退订函数）—— 覆盖视图随进随出，
  // 不退订则监听器只增不减，反复切换后一次 'vault' 会并发触发多个 load()。
  const offVault = app.on((kind) => { if (kind === 'vault') load(); });
  load();
  return { refresh: load, unmount() { try { offVault(); } catch { /* ignore */ } } };
}
