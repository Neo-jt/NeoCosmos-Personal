// NeoCosmos v10.18.7 · 全库总览（原创增强，星图内同款入口）
// ---------------------------------------------------------------------------
// 设计立场：沿用星图（cosmos.js）的视觉语言 —— 深空底、发光节点、领域色、
// HUD 卡片、图例胶囊、点击聚焦 —— 把「所有知识库 + 库间关联」收进一个悬浮
// 工作窗。v10.18.7 重设计：从"3D 球 + 裸表格"升级为"星系 + 库域卡片网格"，
// 让用户第一眼就能按库下钻，而不是先在一堆球里找名字。
//
// 数据纪律（与 v2.2.0 跨库图谱完全一致，不另造一套）：
//   · 节点 = vault:list / vaults:xgraph 返回的已登记知识库；
//   · 边   = 主进程真实扫描各库磁盘后算出的共享标题 ×2 + 共享标签；
//   · 卡片数 / 标签数 / 截断标记 / 缺失标记 / 启用态全部原样呈现，不补估值、不造示例；
//   · 切换库走真实 vault:switch，不改知识库文件，不联网。
// ---------------------------------------------------------------------------
import { h, toast, status, icon } from '../ui-kit.js';
import { createXGalaxy } from '../xgalaxy.js';
import { SEM } from '../semantic-palette.js';

export function mountVaultOverview({ host, app, api, toast: uiToast, status: uiStatus, route }) {
  const notify = uiToast || toast;
  const say = uiStatus || status;
  host.innerHTML = '';
  const page = h('div', { class: 'page vault-overview ov-v2' });
  host.appendChild(page);

  let registry = { vaults: [], activeId: null };
  let xgraph = { nodes: [], edges: [] };
  let galaxy = null;
  let selected = null;
  let autoRotate = false;
  let gen = 0;
  let disposed = false;

  const count = (v) => (Number(v) || 0).toLocaleString('zh-CN');

  async function loadAll(force = false) {
    const my = ++gen;
    say('正在读取所有知识库与库间关联…');
    try {
      const [r, x] = await Promise.all([
        api.vault.list(),
        api.vaults?.xgraph?.({ force }),
      ]);
      if (disposed || my !== gen) return;
      if (r?.ok) registry = r.data || registry;
      else notify(String(r?.error || '知识库登记读取失败'), 'err');
      if (x?.ok) xgraph = x.data || xgraph;
      else notify(String(x?.error || '跨库关联读取失败'), 'err');
      render();
      say(`全库总览已就绪 · ${xgraph.nodes.length} 库 · ${xgraph.edges.length} 条关联`);
    } catch (e) {
      if (disposed || my !== gen) return;
      page.innerHTML = '';
      page.appendChild(h('div', { class: 'empty-hint' }, '全库总览加载失败：' + String(e?.message || e)));
      say('全库总览加载失败');
      notify(String(e?.message || e), 'err', 6000);
    }
  }

  function currentId() {
    return app.vault?.id || registry.activeId || null;
  }

  /** 库节点统一取色：真实 v.color 优先，回退语义库色（与星图节点卡同口径）。 */
  function vaultColor(n) {
    return n?.color || n?.vault_color || SEM.vault || 'var(--accent)';
  }

  /** 某库对外的启用态：以注册表 linkEnabled 为真源，与设置页/外部检索白名单同口径。 */
  function enabledOf(node) {
    const v = (registry.vaults || []).find((x) => x.id === node.id);
    return v ? v.linkEnabled !== false : true;
  }
  /** 某库的关联度数（真实边数）。 */
  function degreeOf(nodeId) {
    return (xgraph.edges || []).filter((e) => e.source === nodeId || e.target === nodeId).length;
  }

  function head() {
    return h('div', { class: 'page-head ov-head' },
      h('div', { class: 'ov-head-title' },
        h('h2', null, h('span', { class: 'ov-head-glyph' }), '全库总览 · 所有知识库与关联'),
        h('p', null,
          '每个球体是一座已登记知识库；球体之间的连线来自本机真实扫描：共享标题×2 + 共享标签。'
          + '不上传、不读取联网数据、不改写任何卡片正文。扫描截断或目录缺失会如实标注。')));
  }

  function stats() {
    const nodes = xgraph.nodes || [];
    const present = nodes.filter((n) => !n.missing && !n.error).length;
    const current = nodes.find((n) => n.id === currentId());
    const enabled = nodes.filter((n) => enabledOf(n)).length;
    const totalCards = nodes.reduce((s, n) => s + (Number(n.cards) || 0), 0);
    return h('div', { class: 'ov-stats ov-kpi' },
      h('div', { class: 'ov-kpi-cell' },
        h('b', null, count(nodes.length)), h('span', null, '已登记知识库'),
        h('i', null, `${count(enabled)} 已启用`)),
      h('div', { class: 'ov-kpi-cell' },
        h('b', null, count(totalCards)), h('span', null, '卡片总量'),
        h('i', null, `${count(present)} 库可读取`)),
      h('div', { class: 'ov-kpi-cell' },
        h('b', null, count(xgraph.edges.length)), h('span', null, '真实关联边'),
        h('i', null, '共享标题×2 + 共享标签')),
      h('div', { class: 'ov-kpi-cell is-current' },
        h('b', null, current ? current.name : '—'), h('span', null, '当前知识库'),
        h('i', null, '星系中带轨道环')));
  }

  function toolbar() {
    return h('div', { class: 'xv-toolbar' },
      h('button', {
        class: 'btn ghost',
        title: '重新扫描所有已登记知识库（主进程 30 秒缓存会被强制刷新）',
        onclick: () => loadAll(true),
      }, h('span', { html: icon('refresh', 14) }), ' 刷新扫描'),
      h('button', {
        class: 'btn ghost',
        onclick: () => {
          autoRotate = !autoRotate;
          galaxy?.setAutoRotate(autoRotate);
          notify(autoRotate ? '全库星系开始自转' : '全库星系已停止自转', 'ok', 1600);
        },
      }, autoRotate ? '停止自转' : '自动旋转'),
      h('button', {
        class: 'btn ghost',
        onclick: () => {
          const id = currentId();
          if (!id) { notify('当前没有打开的知识库', 'err'); return; }
          galaxy?.focus(id);
          notify('镜头已回到当前知识库', 'ok', 1600);
        },
      }, '回到当前库'));
  }

  function legend() {
    return h('div', { class: 'xv-legend' },
      h('span', null, h('span', { class: 'sw', style: { background: 'var(--accent)' } }), '知识库节点'),
      h('span', null, h('span', { class: 'sw', style: { background: SEM.neuro4 } }), '当前库（带轨道环）'),
      h('span', null, h('span', { class: 'sw sw-off' }), '已停用（外部 AI 不可检索）'),
      h('span', null, '球体大小 = 卡片数　管粗细 = 关联强度'),
      h('span', null, '可拖拽旋转 · 滚轮缩放 · 点击球体或库卡查看关联明细'));
  }

  /**
   * 库域卡片网格：星图"节点卡"的下钻面。每库一张卡，真实读数 + 库色 + 启用态，
   * 点击即聚焦星系对应球体并展开关联明细。这是对旧版"裸比例条"的核心升级。
   */
  function vaultCards() {
    const nodes = (xgraph.nodes || []).slice()
      .sort((a, b) => (Number(b.cards) || 0) - (Number(a.cards) || 0));
    const box = h('div', { class: 'ov-vault-grid' });
    if (!nodes.length) return box;
    const maxCards = nodes.reduce((m, n) => Math.max(m, Number(n.cards) || 0), 0);
    for (const n of nodes) {
      const col = vaultColor(n);
      const rc = Number(n.cards) || 0, rt = Number(n.tags) || 0;
      const deg = degreeOf(n.id);
      const isCur = n.id === currentId();
      const enabled = enabledOf(n);
      let flag = '';
      if (n.missing) flag = '目录缺失';
      else if (n.error) flag = '读取异常';
      else if (n.truncated) flag = '扫描截断';
      const pct = maxCards ? Math.max(3, Math.round(rc / maxCards * 100)) : 3;
      const bar = h('i'); bar.style.width = pct + '%'; bar.style.background = col;
      const card = h('button', {
        class: 'ov-vault-card' + (isCur ? ' is-current' : '') + (selected?.id === n.id ? ' is-selected' : ''),
        'data-vault': n.id,
        style: { '--vc': col },
        title: `${n.name || n.id} · ${rc} 卡片 / ${rt} 标签 / ${deg} 关联${flag ? ' · ' + flag : ''}`,
        onclick: () => {
          selected = n;
          galaxy?.setHighlight(n.id);
          galaxy?.focus(n.id);
          const old = document.getElementById('ovDetail');
          if (old) old.replaceWith(detail());
          for (const el of box.querySelectorAll('.ov-vault-card')) el.classList.remove('is-selected');
          card.classList.add('is-selected');
        },
      },
        h('span', { class: 'ov-vc-top' },
          h('span', { class: 'ov-vc-dot' }),
          h('b', null, n.name || n.id),
          isCur ? h('span', { class: 'ov-vc-cur' }, '当前') : null,
          !enabled ? h('span', { class: 'ov-vc-off' }, '已停用') : null),
        h('span', { class: 'ov-vc-nums' },
          h('span', null, h('b', null, count(rc)), ' 卡片'),
          h('span', null, h('b', null, count(rt)), ' 标签'),
          h('span', null, h('b', null, String(deg)), ' 关联')),
        h('span', { class: 'ov-vc-bar' }, bar),
        flag ? h('span', { class: 'ov-vc-flag' }, flag) : null);
      box.appendChild(card);
    }
    return box;
  }

  function detail() {
    const box = h('div', { id: 'ovDetail', class: 'ov-detail' });
    if (!selected) {
      box.appendChild(h('div', { class: 'empty-hint' }, '点击星系球体或上方库卡，查看该库与其他库的关联明细。'));
      // 真实规模摘要：直接取 xgraph.nodes 已返回的卡片/标签计数，按卡片数排序。
      // 不造数、不估值；单库或读取失败时如实标注，不留白屏。
      const nodes = xgraph.nodes || [];
      const maxCards = nodes.reduce((m, n) => Math.max(m, Number(n.cards) || 0), 0);
      const rows = nodes.slice().sort((a, b) => (Number(b.cards) || 0) - (Number(a.cards) || 0));
      if (rows.length) {
        box.appendChild(h('div', { class: 'ov-scale' },
          h('div', { class: 'ov-scale-h' },
            h('b', null, '各库规模'),
            h('span', null, '按卡片数 · 本机真实计数'))));
        for (const r of rows) {
          const rc = Number(r.cards) || 0;
          const rt = Number(r.tags) || 0;
          let pct = maxCards ? Math.round(rc / maxCards * 100) : 3;
          if (pct < 3) pct = 3;
          const title = r.name + ' · ' + rc + ' 卡片 / ' + rt + ' 标签';
          const nums = count(rc) + ' 卡 · ' + count(rt) + ' 签';
          let flag = '';
          if (r.missing) flag = '目录缺失';
          else if (r.error) flag = '读取异常';
          else if (r.truncated) flag = '扫描截断';
          const bar = h('i');
          bar.style.width = pct + '%';
          bar.style.background = vaultColor(r);
          box.appendChild(h('div', { class: 'ov-scale-row', title: title },
            h('span', { class: 'ov-scale-name' }, r.name || r.id),
            h('span', { class: 'ov-scale-bar' }, bar),
            h('span', { class: 'ov-scale-num' }, nums),
            flag ? h('span', { class: 'ov-scale-flag' }, flag) : null));
        }
      }
      return box;
    }
    const rel = (xgraph.edges || [])
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => {
        const otherId = e.source === selected.id ? e.target : e.source;
        const other = (xgraph.nodes || []).find((n) => n.id === otherId);
        return { id: otherId, name: other?.name || otherId, w: e.weight || 0, st: e.sharedTitles || 0, sg: e.sharedTags || 0 };
      })
      .sort((a, b) => b.w - a.w);

    box.appendChild(h('div', { class: 'xvd-head' },
      h('b', null, h('span', { class: 'ov-vc-dot', style: { background: vaultColor(selected) } }), selected.name || '未命名知识库'),
      h('span', { class: 'cnt' }, `${count(selected.cards)} 卡片 · ${count(selected.tags)} 标签 · ${degOf(selected.id)} 关联`)));
    if (!enabledOf(selected)) box.appendChild(h('div', { class: 'ov-flag' }, '已停用：该库不对外部 AI 客户端开放检索，仅本机可用。'));
    if (selected.missing) box.appendChild(h('div', { class: 'ov-flag' }, '目录缺失：主进程未扫描到该库文件'));
    else if (selected.error) box.appendChild(h('div', { class: 'ov-flag' }, `读取异常：${selected.error}`));
    else if (selected.truncated) box.appendChild(h('div', { class: 'ov-flag' }, '扫描已截断：下方计数仅覆盖实际扫描部分'));
    box.appendChild(h('div', { class: 'ov-acts' },
      h('button', {
        class: 'btn',
        disabled: selected.id === currentId(),
        onclick: async () => {
          const r = await api.vault.switch(selected.id);
          if (!r?.ok) { notify(String(r?.error || '切换知识库失败'), 'err'); return; }
          await app.refreshVault();
          await loadAll(false);
          notify(`已切换到「${selected.name || r.vault?.name || '知识库'}」`, 'ok');
        },
      }, selected.id === currentId() ? '当前知识库' : '切换到此库')));

    if (rel.length) {
      const maxW = rel.reduce((m, r) => Math.max(m, r.w), 0) || 1;
      box.appendChild(h('div', { class: 'ov-rel' }, ...rel.map((r) => {
        const wbar = h('i'); wbar.style.width = Math.max(4, Math.round(r.w / maxW * 100)) + '%';
        return h('div', {
          class: 'xv-edge-row ov-rel-row',
          title: '聚焦这座关联库',
          onclick: () => { galaxy?.setHighlight(r.id); galaxy?.focus(r.id); },
        },
          h('span', { class: 'xe-a' }, r.name),
          h('span', { class: 'xe-wbar' }, wbar),
          h('span', { class: 'xe-w' }, String(r.w)),
          h('span', { class: 'xe-d' }, `共享标题 ${r.st} · 共享标签 ${r.sg}`));
      })));
    } else {
      box.appendChild(h('div', { class: 'empty-hint' },
        (xgraph.nodes || []).length < 2
          ? '至少登记两个知识库，才能计算库间关联。'
          : '该库目前与其他库没有共享标题或标签，因此没有关联边。'));
    }
    return box;
  }

  function edges() {
    if (!(xgraph.edges || []).length) return null;
    return h('div', { class: 'card ov-edge-card' },
      h('h3', null, '库间关联明细', h('span', { class: 'cnt' }, `${xgraph.edges.length} 条`)),
      h('div', { class: 'xv-edges' }, ...xgraph.edges.map((e) => {
        const a = (xgraph.nodes || []).find((n) => n.id === e.source);
        const b = (xgraph.nodes || []).find((n) => n.id === e.target);
        return h('div', { class: 'xv-edge-row' },
          h('span', { class: 'xe-a' }, a?.name || e.source),
          h('span', { class: 'xe-w' }, String(e.weight || 0)),
          h('span', { class: 'xe-b' }, b?.name || e.target),
          h('span', { class: 'xe-d' }, `共享标题 ${e.sharedTitles || 0} · 共享标签 ${e.sharedTags || 0}`));
      })));
  }

  function drawGraph(card) {
    if (galaxy) { try { galaxy.dispose(); } catch (e) { console.error(e); } galaxy = null; }
    const root = card.querySelector('#ovGalaxyRoot');
    if (!root) return;
    if (!(xgraph.nodes || []).length) {
      root.appendChild(h('div', { class: 'empty-hint' }, '尚未登记任何知识库。请先在标题栏打开或新建一个知识库。'));
      return;
    }
    galaxy = createXGalaxy({
      container: root,
      xgraph,
      currentId: currentId(),
      onSelect: (n) => {
        selected = n;
        galaxy?.setHighlight(n?.id || null);
        const old = document.getElementById('ovDetail');
        if (old) old.replaceWith(detail());
        const grid = card.querySelector('.ov-vault-grid');
        if (grid) for (const el of grid.querySelectorAll('.ov-vault-card')) {
          el.classList.toggle('is-selected', el.dataset.vault === n?.id);
        }
      },
    });
    galaxy.setAutoRotate(autoRotate);
    if (selected) galaxy.setHighlight(selected.id);
  }

  function render() {
    if (disposed) return;
    page.innerHTML = '';
    page.append(head(), stats());
    const card = h('div', { class: 'card ov-galaxy-card' },
      h('h3', null, '多库星系',
        h('span', { class: 'cnt' }, `${xgraph.nodes.length} 库 · ${xgraph.edges.length} 条关联`)),
      h('div', { class: 'xv-graph xv-graph-3d', id: 'ovGalaxyRoot' }),
      toolbar(),
      legend());
    page.appendChild(card);
    const gridWrap = h('section', { class: 'ov-section' },
      h('div', { class: 'ov-section-h' },
        h('h3', null, '库域下钻', h('span', { class: 'cnt' }, `${(xgraph.nodes || []).length} 座知识库`)),
        h('span', null, '点击库卡 → 聚焦星系 + 查看真实关联')),
      vaultCards());
    page.appendChild(gridWrap);
    page.appendChild(detail());
    const edgeCard = edges();
    if (edgeCard) page.appendChild(edgeCard);
    setTimeout(() => drawGraph(card), 30);
  }

  loadAll(false);
  return {
    refresh: () => loadAll(false),
    unmount() {
      disposed = true;
      gen++;
      if (galaxy) { try { galaxy.dispose(); } catch (e) { console.error(e); } galaxy = null; }
    },
  };
}

export default mountVaultOverview;
