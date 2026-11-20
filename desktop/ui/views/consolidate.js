// 巩固 · 一轮"睡眠"
// 离线自我整理：实体消歧、合并建议（只建议不自动合并）、孤立检测、矛盾检测、按天衰减，并产出健康度。
// v1.1.0：图标改用 SVG；"应用"按钮如实反映引擎结果（不再假报成功）。
import { h, toast, status, icon } from '../ui-kit.js';

const KIND_LABEL = {
  merge: '合并建议', orphan: '孤立卡片', conflict: '矛盾检测',
  decay: '权重衰减', link: '补边建议', moc: 'MOC 草稿',
};

export function mountConsolidate({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page' });
  host.appendChild(page);
  // v2.2.0：立即给出载入占位 —— 数据回来前不留空白页
  // （此前空白是常态：任何一次中途交互都会让页面永久停在空白）
  page.appendChild(h('div', { class: 'empty-hint' }, '正在载入统计…'));

  let result = null;
  let stats = null;
  let busy = false;

  // v2.2.0：代次守卫 —— 快速切页时，先发后到的旧请求不得覆盖新数据
  let gen = 0;
  async function loadStats() {
    const my = ++gen;
    // v2.2.0：登记"正在取数"
    const done = app.beginLoad();
    let r;
    try { r = await api.stats(); }
    finally { done(); }   // v2.2.1：异常时也要归还计数
    if (my !== gen) return;
    if (r?.ok) { stats = r.data; render(); }
  }

  async function sleep() {
    if (busy) return;
    busy = true;
    status('正在睡眠…');
    const r = await api.consolidate();
    busy = false;
    if (!r?.ok) { toast(r?.error || '睡眠失败', 'err'); render(); return; }
    result = r.data;
    await app.refreshVault();
    status(`睡眠完成 · 产出 ${result.produced.length} 条待整理项`);
    toast(`睡眠完成：产出 ${result.produced.length} 条待整理项`, 'ok');
    render();
  }

  function head() {
    return h('div', { class: 'page-head' },
      h('h2', null, '巩固 · 一轮睡眠'),
      h('p', null, '睡眠是离线自我整理：实体消歧、近似概念合并建议、孤立与矛盾检测、按天衰减，并产出健康度报告。所有机器生成项只"建议"不自动执行——尤其不会合并或改写你手写的任何内容。'),
    );
  }

  function healthCard() {
    const s = result?.report || stats;
    const box = h('div', { class: 'card' }, h('h3', null, '网络健康度'));
    if (!s) { box.appendChild(h('div', { class: 'empty-hint' }, '尚无数据')); return box; }
    const rows = [
      ['卡片数', s.nodes], ['突触数', s.edges], ['平均度数', s.avg_degree],
      ['孤立率', `${Math.round((s.orphan_rate || 0) * 100)}%`],
      ['权重区间', `${s.weight_min?.toFixed?.(3) ?? s.weight_min} ~ ${s.weight_max?.toFixed?.(3) ?? s.weight_max}`],
    ];
    for (const [k, v] of rows) box.appendChild(h('div', { class: 'kv' }, h('span', null, k), h('b', null, String(v ?? '—'))));

    if (s.layer_stats) {
      box.appendChild(h('div', { style: { fontSize: '10.5px', color: 'var(--dim)', margin: '12px 0 6px' } }, '记忆层分布'));
      for (const [k, v] of Object.entries(s.layer_stats)) {
        const total = Object.values(s.layer_stats).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
        const p = Math.round((Number(v) || 0) / total * 100);
        box.appendChild(h('div', { style: { marginBottom: '6px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' } },
            h('span', null, k), h('b', null, String(v))),
          h('div', { class: 'syn-bar' }, h('i', { style: { width: `${Math.max(2, p)}%` } })),
        ));
      }
    }
    return box;
  }

  function producedCard() {
    const items = result?.produced || [];
    const box = h('div', { class: 'card' },
      h('h3', null, '本轮产出', h('span', { class: 'cnt' }, `${items.length} 条`)));
    if (!items.length) {
      box.appendChild(h('div', { class: 'empty-hint' }, result ? '本轮没有产出待整理项 —— 网络当前是整洁的。' : '执行一次睡眠后，这里列出本轮发现的待整理项。'));
      return box;
    }
    const byKind = new Map();
    for (const it of items) {
      if (!byKind.has(it.kind)) byKind.set(it.kind, []);
      byKind.get(it.kind).push(it);
    }
    for (const [kind, list] of byKind) {
      box.appendChild(h('div', { style: { fontSize: '11.5px', color: 'var(--muted)', margin: '8px 0 4px' } }, `${KIND_LABEL[kind] || kind} · ${list.length}`));
      for (const it of list) {
        box.appendChild(h('div', { class: 'review-item' },
          h('div', { class: 'rt' },
            h('span', { class: 'rt-ico', html: icon('file', 12) }),
            h('span', { style: { color: 'var(--text)' } }, it.title)),
          h('div', { class: 'rd' }, it.detail),
          h('div', { class: 'ra' },
            h('button', { class: 'btn ghost', onclick: async () => {
              const r = await api.applyReview({ id: it.id });
              const d = r?.data;
              if (r?.ok && d?.applied) {
                toast(d.note || '已应用', 'ok');
                await app.refreshVault(); await loadStats();
              } else {
                toast(d?.note || r?.error || '该建议需要人工处理，未自动执行', 'err', 4200);
              }
            } }, '应用'),
            it.payload?.ids?.[0] ? h('button', { class: 'btn ghost', onclick: () => { app.openCard(it.payload.ids[0]); route('workspace'); } }, '打开卡片') : null,
            it.payload?.a ? h('button', { class: 'btn ghost', onclick: () => { app.openCard(it.payload.a); route('workspace'); } }, '打开卡片') : null,
            it.payload?.node_id ? h('button', { class: 'btn ghost', onclick: () => { app.openCard(it.payload.node_id); route('workspace'); } }, '打开卡片') : null,
          ),
        ));
      }
    }
    return box;
  }

  function render() {
    page.innerHTML = '';
    page.appendChild(head());
    page.appendChild(h('div', { class: 'btn-row', style: { marginBottom: '14px' } },
      h('button', { class: 'btn', onclick: sleep, disabled: busy }, busy ? '正在睡眠…' : '执行一轮睡眠'),
      h('button', { class: 'btn ghost', onclick: () => route('settle') }, '去沉淀台处理待整理项'),
    ));
    page.appendChild(h('div', { class: 'grid2' }, healthCard(), producedCard()));
  }

  loadStats();
  render();
  return { refresh: loadStats };
}
