// 右栏 · 关联卡片栏
// 这是本产品对"反向链接"的逆向重做：
//   不是"谁提到了我的标题"（字符串匹配），而是"哪些突触指向我、强度多少、谁建的、上次走过是什么时候"。
// 关联按突触类型分型成卡片：入链 / 出链 / 断链 / 语义邻居 / 共现 / 因果 / 时序 / 层级 / 沉淀引用。
// v1.1.0 新增：跨库关联分组 + 建立跨库关联（选库 → 选卡 → 确认）+ 跳转到其他库的卡片。
import { h, toast, status, fmtTime, icon, modal, confirmDialog } from '../ui-kit.js';
// v6.27.0：突触配色与 DOM 语义色统一从共享真源取，不再在本文件重复定义一份。
import { EDGE_COLORS, SEM } from '../semantic-palette.js';

const TYPE_COLOR = EDGE_COLORS;
const GROUP_DEFS = [
  { key: 'explicit_link', title: '显式链接', hint: '人写下的 [[双链]]' },
  { key: 'semantic_similar', title: '语义邻居', hint: '共享标签、结构相近但并不相邻' },
  { key: 'co_occurrence', title: '共现', hint: '总在同一语境里出现' },
  { key: 'causal', title: '因果支撑', hint: '谁支撑我、我支撑谁' },
  { key: 'temporal', title: '时间邻近', hint: '在同一时间窗内被写下' },
  { key: 'hierarchical', title: '层级包含', hint: '父子结构' },
  { key: 'question_answer', title: '问答沉淀', hint: 'Agent 回写沉淀结成的关系' },
];

export function mountRelations({ host, app, api, toast, status, setSelected, route }) {
  host.innerHTML = '';
  const scroll = h('div', { class: 'rel-scroll' });
  const head = h('div', { class: 'nav-head' },
    h('div', { class: 'nav-title' }, h('b', null, '关联卡片'),
      h('div', { class: 'nav-actions' },
        h('button', {
          class: 'icon-btn', title: '把这张卡片关联到另一个知识库', 'aria-label': '建立跨库关联',
          html: icon('cross', 13), onclick: () => addCross(),
        }),
        h('button', {
          class: 'icon-btn mini-hide', title: '最小化右栏 (Ctrl+Alt+B)', 'aria-label': '最小化右栏',
          html: icon('collapseR', 13), onclick: () => app.togglePane?.('right'),
        }))),
    h('div', { class: 'nav-sub' }, '按突触分型'),
  );
  host.append(head, scroll);

  let rel = null;
  let collapsed = new Set();

  async function load(id) {
    if (!id) {
      scroll.innerHTML = '';
      scroll.appendChild(h('div', { class: 'rel-empty' }, '打开一张卡片后，这里显示它的全部突触关系，也可以建立指向其他知识库的跨库关联。'));
      setSelected?.('未选中卡片');
      return;
    }
    const r = await api.doc.relations(id, { contextLimit: 12 });
    if (!r?.ok) { scroll.innerHTML = ''; scroll.appendChild(h('div', { class: 'rel-empty' }, r?.error || '读取关联失败')); return; }
    rel = r.data;
    setSelected?.(`${rel.title} · ${rel.degree} 条突触 · 总强度 ${rel.strength}`);
    render();
  }

  function summary() {
    const box = h('div', { class: 'rel-summary expert-only' },
      h('div', { class: 'rs-row' }, h('span', null, '突触度数'), h('b', null, String(rel.degree))),
      h('div', { class: 'rs-row' }, h('span', null, '强度总和'), h('b', null, String(rel.strength))),
      h('div', { class: 'rs-row' }, h('span', null, '平均权重'), h('b', null, String(rel.avgWeight))),
    );
    if (rel.cross && rel.cross.length) {
      box.appendChild(h('div', { class: 'rs-row' }, h('span', null, '跨库关联'), h('b', null, String(rel.cross.length))));
    }
    return box;
  }

  function weightBar(w) {
    return h('div', { class: 'syn-bar' }, h('i', { style: { width: `${Math.max(3, Math.round(w * 100))}%` } }));
  }

  function card(item, opts = {}) {
    const c = h('div', { class: 'rel-card' + (opts.cls ? ' ' + opts.cls : '') },
      h('div', { class: 'rc-top' },
        h('span', { class: 'rc-title' }, item.title || item.target || '未命名'),
        item.direction ? h('span', { class: 'rc-dir' }, item.direction === 'in' ? '入链' : '出链') : null,
      ),
      item.reason ? h('div', { class: 'rc-why' }, item.reason) : null,
      item.snippet ? h('div', { class: 'rc-snip' }, item.snippet) : null,
      item.weight != null ? weightBar(item.weight) : null,
      h('div', { class: 'syn-meta expert-only' },
        h('span', null, `权重 ${item.weight ?? '—'}`),
        item.hits != null ? h('span', null, `强化 ${item.hits} 次`) : null,
        h('span', null, item.origin === 'human' ? '人建立' : (item.origin || '系统推导')),
        item.lastReinforced ? h('span', null, fmtTime(item.lastReinforced)) : null,
      ),
    );
    if (opts.onClick) c.addEventListener('click', opts.onClick);
    return c;
  }

  function crossCard(item) {
    const c = h('div', { class: 'rel-card cross-card' },
      h('div', { class: 'rc-top' },
        h('span', { class: 'kb-badge', style: { borderColor: item.vault_color || SEM.crossKb } },
          h('span', { class: 'kb-dot', style: { background: item.vault_color || SEM.crossKb } }),
          item.vault_name || '其他知识库'),
        h('span', { class: 'rc-title' }, item.title || item.path || '未命名'),
      ),
      item.reason ? h('div', { class: 'rc-why' }, item.reason) : null,
      h('div', { class: 'rc-snip' }, item.path || ''),
      h('div', { class: 'syn-meta expert-only' },
        h('span', null, `权重 ${item.weight ?? '—'}`),
        item.origin === 'human' ? h('span', null, '人建立') : h('span', null, item.origin || '—'),
        item.createdAt ? h('span', null, fmtTime(item.createdAt)) : null,
      ),
      h('div', { class: 'rc-acts' },
        h('button', { class: 'btn ghost', onclick: (ev) => { ev.stopPropagation(); openRemote(item); } }, '打开（切库）'),
        h('button', { class: 'btn ghost', onclick: async (ev) => {
          ev.stopPropagation();
          const go = await confirmDialog({ title: '删除跨库关联', message: `删除指向「${item.vault_name} / ${item.title}」的跨库突触？\n\n只删除这条关联，不动两边任何文件。`, confirmText: '删除' });
          if (!go) return;
          const r = await api.crosskb.remove(item.id);
          if (r?.ok) { toast('已删除跨库关联', 'ok'); await app.refreshVault(); await load(app.currentId); }
          else toast(r?.error || '删除失败', 'err');
        } }, '删除'),
      ),
    );
    return c;
  }

  function group(title, hint, color, items, key) {
    if (!items.length) return null;
    const isCollapsed = collapsed.has(key);
    const g = h('div', { class: 'rel-group' + (isCollapsed ? ' is-collapsed' : '') },
      h('div', { class: 'rg-head', title: hint, onclick: () => { isCollapsed ? collapsed.delete(key) : collapsed.add(key); render(); } },
        h('span', { class: 'rg-dot', style: { background: color, boxShadow: `0 0 8px ${color}` } }),
        h('span', { class: 'rg-title' }, title),
        h('span', { class: 'rg-count' }, String(items.length))),
      h('div', { class: 'rg-body' }, items.map((it) => card(it, { onClick: () => app.openCard(it.id) }))),
    );
    return g;
  }

  function render() {
    scroll.innerHTML = '';
    if (!rel) return;
    scroll.appendChild(summary());

    const all = rel.groups || {};

    // 跨库关联（置顶：这是通往其他网络的门户）
    if (rel.cross && rel.cross.length) {
      const g = h('div', { class: 'rel-group' + (collapsed.has('cross') ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', title: '指向其他知识库的突触', onclick: () => { collapsed.has('cross') ? collapsed.delete('cross') : collapsed.add('cross'); render(); } },
          h('span', { class: 'rg-dot', style: { background: SEM.crossKb, boxShadow: `0 0 8px ${SEM.crossKb}` } }),
          h('span', { class: 'rg-title' }, '跨库关联'), h('span', { class: 'rg-count' }, String(rel.cross.length))),
        h('div', { class: 'rg-body' }, rel.cross.map(crossCard)),
      );
      scroll.appendChild(g);
    }

    // 入链 / 出链（显式链接分方向，这是"反向链接"的升级形态）
    const expl = all.explicit_link || [];
    const inbound = rel.inboundWithContext && rel.inboundWithContext.length
      ? rel.inboundWithContext
      : expl.filter((x) => x.direction === 'in');
    const outbound = expl.filter((x) => x.direction === 'out');

    if (inbound.length) {
      const g = h('div', { class: 'rel-group' + (collapsed.has('in') ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', onclick: () => { collapsed.has('in') ? collapsed.delete('in') : collapsed.add('in'); render(); } },
          h('span', { class: 'rg-dot', style: { background: SEM.explicitLink, boxShadow: `0 0 8px ${SEM.explicitLink}` } }),
          h('span', { class: 'rg-title' }, '入链突触'), h('span', { class: 'rg-count' }, String(inbound.length))),
        h('div', { class: 'rg-body' }, inbound.map((it) => card(it, { onClick: () => app.openCard(it.id) }))),
      );
      scroll.appendChild(g);
    }
    if (outbound.length) {
      const g = h('div', { class: 'rel-group' + (collapsed.has('out') ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', onclick: () => { collapsed.has('out') ? collapsed.delete('out') : collapsed.add('out'); render(); } },
          h('span', { class: 'rg-dot', style: { background: SEM.vault, boxShadow: `0 0 8px ${SEM.vault}` } }),
          h('span', { class: 'rg-title' }, '出链突触'), h('span', { class: 'rg-count' }, String(outbound.length))),
        h('div', { class: 'rg-body' }, outbound.map((it) => card(it, { onClick: () => app.openCard(it.id) }))),
      );
      scroll.appendChild(g);
    }

    // 断链：待生长的突触
    if (rel.broken && rel.broken.length) {
      const g = h('div', { class: 'rel-group' + (collapsed.has('broken') ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', onclick: () => { collapsed.has('broken') ? collapsed.delete('broken') : collapsed.add('broken'); render(); } },
          h('span', { class: 'rg-dot', style: { background: SEM.temporal, boxShadow: `0 0 8px ${SEM.temporal}` } }),
          h('span', { class: 'rg-title' }, '待生长突触（断链）'), h('span', { class: 'rg-count' }, String(rel.broken.length))),
        h('div', { class: 'rg-body' }, rel.broken.map((b) => card(
          { title: b.target, weight: null, reason: '本卡引用了它，但它还不存在' },
          { cls: 'broken-card', onClick: () => grow(b.target) }))),
      );
      scroll.appendChild(g);
    }

    for (const def of GROUP_DEFS) {
      if (def.key === 'explicit_link') continue; // 已按方向拆成入链/出链
      const items = all[def.key] || [];
      if (!items.length) continue;
      const g = h('div', { class: 'rel-group' + (collapsed.has(def.key) ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', title: def.hint, onclick: () => { collapsed.has(def.key) ? collapsed.delete(def.key) : collapsed.add(def.key); render(); } },
          h('span', { class: 'rg-dot', style: { background: TYPE_COLOR[def.key], boxShadow: `0 0 8px ${TYPE_COLOR[def.key]}` } }),
          h('span', { class: 'rg-title' }, def.title), h('span', { class: 'rg-count' }, String(items.length))),
        h('div', { class: 'rg-body' }, items.map((it) => card(it, { onClick: () => app.openCard(it.id) }))),
      );
      scroll.appendChild(g);
    }

    // 沉淀引用
    if (rel.sediment && rel.sediment.length) {
      const g = h('div', { class: 'rel-group' + (collapsed.has('sed') ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', onclick: () => { collapsed.has('sed') ? collapsed.delete('sed') : collapsed.add('sed'); render(); } },
          h('span', { class: 'rg-dot', style: { background: SEM.questionAnswer, boxShadow: `0 0 8px ${SEM.questionAnswer}` } }),
          h('span', { class: 'rg-title' }, '沉淀引用'), h('span', { class: 'rg-count' }, String(rel.sediment.length))),
        h('div', { class: 'rg-body' }, rel.sediment.map((s) => {
          const c = h('div', { class: 'rel-card' },
            h('div', { class: 'rc-top' }, h('span', { class: 'rc-title' }, s.question || '（无问题）')),
            h('div', { class: 'rc-why' }, String(s.answer || '').slice(0, 120)),
            h('div', { class: 'syn-meta' },
              h('span', null, `置信 ${s.confidence ?? '—'}`),
              h('span', null, s.origin === 'agent' ? 'Agent 回写' : (s.origin || 'user')),
              s.createdAt ? h('span', null, fmtTime(s.createdAt)) : null),
          );
          c.addEventListener('click', () => route('settle'));
          return c;
        })),
      );
      scroll.appendChild(g);
    }

    // v6.29.0 功能①：回流来源——本卡参与过的知识回流（新沉淀卡 ↔ 被引卡的真实账本）
    if (rel.reflow && rel.reflow.length) {
      const g = h('div', { class: 'rel-group' + (collapsed.has('reflow') ? ' is-collapsed' : '') },
        h('div', { class: 'rg-head', onclick: () => { collapsed.has('reflow') ? collapsed.delete('reflow') : collapsed.add('reflow'); render(); } },
          h('span', { class: 'rg-dot', style: { background: SEM.questionAnswer, boxShadow: `0 0 8px ${SEM.questionAnswer}` } }),
          h('span', { class: 'rg-title' }, '回流来源'), h('span', { class: 'rg-count' }, String(rel.reflow.length))),
        h('div', { class: 'rg-body' }, rel.reflow.map((rf) => h('div', { class: 'rel-card' },
          h('div', { class: 'rc-top' },
            h('span', { class: 'rc-title' }, rf.otherTitle || rf.otherId),
            h('span', { class: 'rc-dir' }, rf.mode === 'cross_vault' ? '跨库回流' : (rf.direction === 'out' ? '回流长出' : '被回流'))),
          h('div', { class: 'rc-why' }, String(rf.question || '').slice(0, 120)),
          h('div', { class: 'syn-meta' },
            h('span', null, rf.built ? '已建立关联' : (rf.dangling ? '源卡已不存在（未伪造关联）' : '已登记来源')),
            rf.createdAt ? h('span', null, fmtTime(rf.createdAt)) : null),
        ))),
      );
      scroll.appendChild(g);
    }

    // v6.29.0 功能②：建议关联 —— 无关联时置顶，引导用户把散沙连成网络
    const isOrphan = !rel.degree;
    if (isOrphan && !scroll.children.length) {
      scroll.appendChild(h('div', { class: 'rel-empty' },
        '这张卡片还没有任何突触。下面按本库的真实信号，帮你找可以连的卡片——点「建立关联」才真正连接，正文不动。'));
    }
    if (isOrphan) {
      scroll.insertBefore(recommendGroup(), scroll.firstChild);
      // 仅当推荐尚未就绪时异步计算一次并在完成后重绘；就绪后不再 render，避免递归循环。
      if (!recommendations && !recLoading) {
        ensureRecommendations().then(() => { if (rel && app.currentId) render(); });
      }
    }

    if (!scroll.children.length) {
      scroll.appendChild(h('div', { class: 'rel-empty' }, '这张卡片还没有任何突触。在正文里写 [[双链]]，或让它参与一次召回，关系就会长出来。'));
    }

    // 非孤立卡片：在末尾放一个可展开的"建议关联"（补更全的关联，不改已有的）
    if (!isOrphan) {
      const toggle = h('button', { class: 'btn ghost', style: { width: '100%', marginTop: 8 },
        onclick: async () => {
          if (!recommendations) await ensureRecommendations(true);
          const host = h('div', { style: { marginTop: 6 } });
          if (toggle.parentNode) toggle.parentNode.insertBefore(host, toggle.nextSibling);
          if (host.parentNode) host.appendChild(recommendGroup());
          toggle.remove();
        } }, '辅助建立关联（基于真实信号推荐）');
      scroll.appendChild(toggle);
    }
  }

  // ---------------- 跨库关联流程：选库 → 选卡 →（可选）理由 ----------------
  async function addCross() {
    if (!app.currentId || !rel) { toast('先打开一张卡片，再建立跨库关联', 'err'); return; }
    const lr = await api.vault.list();
    if (!lr?.ok) { toast('读取知识库列表失败', 'err'); return; }
    const others = (lr.data.vaults || []).filter((v) => !v.active);
    if (!others.length) { toast('还没有第二个知识库——先在标题栏新建一个知识库，再来跨库关联', 'err', 4200); return; }

    const pick = await modal({
      title: '跨库关联 · 第 1 步',
      message: `把「${rel.title}」关联到哪个知识库？`,
      fields: [{
        key: 'vaultId', label: '目标知识库', type: 'select', required: true,
        options: others.map((v) => ({ value: v.id, label: v.name })),
      }],
      confirmText: '下一步',
    });
    if (!pick) return;
    const vaultId = pick.vaultId;
    const vault = others.find((v) => v.id === vaultId);

    const remote = await api.crosskb.remoteList({ vaultId });
    if (!remote?.ok) { toast(remote?.error || '读取目标库失败', 'err'); return; }
    const options = remote.data.items.map((n) => ({ value: n.path, label: n.title }));
    if (!options.length) { toast('目标知识库还是空的', 'err'); return; }

    const pick2 = await modal({
      title: '跨库关联 · 第 2 步',
      message: `在「${vault?.name || '目标库'}」里选择要关联的卡片（共 ${remote.data.total} 张）。`,
      fields: [
        { key: 'path', label: '目标卡片', type: 'select', required: true, options },
        { key: 'reason', label: '关联理由（可留空）', type: 'text', placeholder: '例如：同一课题的另一份结论' },
      ],
      confirmText: '建立关联',
    });
    if (!pick2) return;
    const target = remote.data.items.find((n) => n.path === pick2.path);
    const r = await api.crosskb.add({
      localId: app.currentId,
      vaultId,
      path: pick2.path,
      title: target ? target.title : pick2.path,
      reason: pick2.reason || null,
    });
    if (r?.ok) {
      // v2.2.1：crosskb:add 经 wrap() 包装，业务字段在 r.data 里。
      // 早前直接读 r.link.title —— r.link 恒为 undefined，
      // 于是**建成了却抛 TypeError**：提示出不来、列表也不刷新，
      // 用户看到的就是"点了没反应"。
      toast(`已建立跨库突触 →「${vault?.name || ''} / ${r.data?.link?.title || ''}」`, 'ok');
      await app.refreshVault();
      await load(app.currentId);
    } else toast(r?.error || '建立失败', 'err');
  }

  async function openRemote(item) {
    const r = await api.crosskb.open({ id: item.id });
    if (!r?.ok) { toast(r?.error || '跳转失败', 'err'); return; }
    await app.refreshVault();
    app.history = []; app.hIndex = -1;
    app.currentId = null;
    if (r.openId) {
      await app.openCard(r.openId);
      route('workspace');
      toast(`已切换到「${r.vault.name}」并打开「${r.vault.name}」中的卡片`, 'ok');
    } else {
      route('workspace');
      toast(`已切换到「${r.vault.name}」——目标卡片文件已不存在（可能被移动）`, 'err', 4200);
    }
  }

  async function grow(target) {
    const go = await confirmDialog({
      title: '生长新卡片',
      message: `生长新卡片「${target}」？\n\n它会立即自动继承所有指向它的突触。`,
      confirmText: '生长',
      danger: false,
    });
    if (!go) return;
    const res = await api.doc.create({ title: target, folder: '_memory/semantic' });
    if (res?.ok) {
      toast(`已生长「${res.data.title}」${res.data.inherited ? ` · 继承 ${res.data.inherited} 条突触` : ''}`, 'ok');
      await app.refreshVault();
      await app.openCard(res.data.id);
    } else toast(res?.error || '生长失败', 'err');
  }

  // ---------------- v6.29.0 功能②：辅助建立知识关联 ----------------
  // 只用本库真实信号推荐；每条都列出"凭什么"；用户点"建立"才调用 kb_link。
  let recommendations = null;
  let recLoading = false;
  const TYPE_LABEL = { explicit_link: '显式链接', semantic_similar: '语义相似',
    co_occurrence: '共现', hierarchical: '层级包含', question_answer: '问答沉淀' };

  async function ensureRecommendations(force = false) {
    if (!app.currentId) return;
    if (recommendations && !force) return;
    if (recLoading) return;
    recLoading = true;
    try {
      const r = await api.linkRecommend({ node_id: app.currentId, top_k: 6 });
      recommendations = (r && r.ok) ? r : null;
    } catch { recommendations = null; }
    recLoading = false;
  }

  async function adopt(s) {
    const p = s.payload || {};
    const label = TYPE_LABEL[p.type] || p.type;
    const go = await confirmDialog({
      title: '建立这条关联',
      message: `在「${rel.title}」与「${p.dstTitle || '目标卡片'}」之间建立「${label}」关联？\n\n依据：${(p.signals || []).map((x) => x.evidence).join('；')}\n\n只新增一条关系记录，不改动任何卡片正文。`,
      confirmText: '建立关联',
    });
    if (!go) return;
    const r = await api.link({ src: p.src, dst: p.dst, type: p.type, reason: p.reason });
    if (r?.ok !== false) {
      toast(`已建立「${label}」关联`, 'ok');
      recommendations = null;
      await app.refreshVault();
      await load(app.currentId);
    } else toast(r?.error || '建立失败', 'err');
  }

  function recommendGroup() {
    const g = h('div', { class: 'rel-group rec-group' },
      h('div', { class: 'rg-head' },
        h('span', { class: 'rg-dot', style: { background: SEM.semanticSimilar, boxShadow: `0 0 8px ${SEM.semanticSimilar}` } }),
        h('span', { class: 'rg-title' }, '建议关联'),
        h('span', { class: 'rg-count' }, recommendations ? String((recommendations.suggestions || []).length) : '…'),
        h('button', { class: 'btn ghost mini', style: { marginLeft: 'auto' }, onclick: async (ev) => {
          ev.stopPropagation(); recommendations = null; await ensureRecommendations(true); render();
        } }, '重算')),
    );
    const body = h('div', { class: 'rg-body' });
    const list = (recommendations?.suggestions || []);
    if (!list.length) {
      body.appendChild(h('div', { class: 'rc-why', style: { padding: '8px 2px' } },
        recommendations ? '没有找到有真实依据的候选关联——不硬凑，等库里出现共引/共现/双链再说。' : '正在基于本库真实信号计算…'));
    }
    for (const s of list) {
      const p = s.payload || {};
      // 目标卡标题来自本库真实节点（n.title），不编造
      const title = p.dstTitle || String(p.dst || '').slice(0, 10);
      const cardEl = h('div', { class: 'rel-card rec-card' },
        h('div', { class: 'rc-top' },
          h('span', { class: 'rc-title' }, title),
          h('span', { class: 'rc-dir' }, TYPE_LABEL[p.type] || p.type)),
        ...(p.signals || []).map((sig) => h('div', { class: 'rc-why' }, '· ' + sig.evidence)),
        h('div', { class: 'rc-acts' },
          h('button', { class: 'btn ghost', onclick: (ev) => { ev.stopPropagation(); adopt(s); } }, '建立关联'),
          h('button', { class: 'btn ghost', onclick: (ev) => { ev.stopPropagation(); cardEl.remove(); } }, '忽略')),
      );
      body.appendChild(cardEl);
    }
    g.appendChild(body);
    return g;
  }

  app.on((kind) => {
    if (kind === 'open') { recommendations = null; load(app.currentId); }
    if (kind === 'vault') { recommendations = null; load(app.currentId); }
  });

  if (app.currentId) load(app.currentId);
  else {
    scroll.innerHTML = '';
    scroll.appendChild(h('div', { class: 'rel-empty' }, '打开一张卡片后，这里显示它的全部突触关系。'));
  }

  return { refresh: () => load(app.currentId) };
}
