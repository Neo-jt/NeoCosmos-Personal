// NeoCosmos v6.35.0 · 语义回流层（Semantic Bridge）视图
// ---------------------------------------------------------------------------
// 真实性纪律：
//  ① 每个按钮都调用 main.js 里真实注册的 api.semantic.* 通道，完整路径书写便于能力清单提取；
//  ② 所有读数（向量数 / cosine / 相对显著性 / 共享术语 / 库质心相似度）都来自真实 IPC 返回，
//     未取到时显示「—」或真实错误，绝不用示例值或随机数填充；
//  ③ 模型不可用 / 索引为空 / 库不可读时如实显示降级原因，不假装模型在跑；
//  ④ 模型只给候选与证据；这里每一个「确认建立」按钮都对应一次真实的用户动作，
//     机器自己绝不擅自建边或建跨库关联。
//
// v6.33.0 排版重构：类名迁入 semb- 独立命名空间。此前使用 sb-* 前缀，
//   与状态栏的 .sb-item / .sb-badge 撞名，导致 27px 状态栏被撑成卡片并叠字。
//   同时把扁平的「标题+说明+KPI+一坨路径」改为 kicker / 标题 / 阅读宽度说明 /
//   分隔线 / 指标网格 / 定义列表 / 四层结果卡，所有数据字段与 IPC 调用保持不变。
import { h, toast } from '../ui-kit.js';

const esc = (s) => String(s == null ? '' : s);
const num = (v) => (Number(v) || 0).toLocaleString('zh-CN');
const fmt = (v, d = 5) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d));
const short = (s, n = 24) => {
  const t = esc(s);
  return t.length > n ? `${t.slice(0, n)}…` : (t || '—');
};
const unwrap = (r) => {
  if (!r || r.ok === false) throw new Error(r?.error || '调用未返回数据');
  return r.data;
};

function kpi(label, value) {
  return h('div', { class: 'semb-kpi' }, h('span', null, label), h('b', null, value));
}
function msg(cls, text) { return h('p', { class: `semb-${cls}` }, text); }
function pending(text) { return msg('pending', `正在${text}…（首次会只读加载训练权重并计算真实向量）`); }
function failed(label, e) { return msg('error', `${label}失败：${esc(e?.message || e)}`); }

// 定义列表：把「索引文件 / 模型指纹 / 沉淀回写库」这类长值拆成 key-value 两栏，
// 不再像旧版那样把标签和 Windows 路径挤在同一行里读不清。
function facts(pairs) {
  const rows = pairs.filter((p) => p && p[1] != null && p[1] !== '');
  if (!rows.length) return null;
  return h('dl', { class: 'semb-facts' }, rows.map(([k, v]) => [
    h('dt', { class: 'semb-fact-k' }, k),
    h('dd', { class: 'semb-fact-v' }, esc(v)),
  ]));
}

// 统一的卡片骨架：kicker → 标题 → 有阅读宽度的说明 → 发丝线 → 主体。
function card({ kicker, title, hint, actions, level = 3, body = [] }) {
  const headMain = h('div', { class: 'semb-head-main' },
    h('span', { class: 'semb-kicker' }, kicker),
    h(level === 2 ? 'h2' : 'h3', { class: level === 2 ? 'semb-h2' : 'semb-h3' }, title),
    hint ? h('p', { class: 'semb-sub' }, hint) : null);
  return h('section', { class: 'card semb-card' },
    h('div', { class: 'semb-head' }, headMain,
      actions && actions.length ? h('div', { class: 'semb-actions' }, actions) : null),
    h('hr', { class: 'semb-divider' }),
    h('div', { class: 'semb-body' }, body));
}

export function mountSemanticBridge({ host, api }) {
  const root = h('div', { class: 'semb-root' });
  const statusBody = h('div', { class: 'semb-out' });
  const searchOut = h('div', { class: 'semb-out' });
  const suggestOut = h('div', { class: 'semb-out' });
  const bridgeOut = h('div', { class: 'semb-out' });
  const searchInput = h('input', {
    class: 'semb-input', type: 'text', spellcheck: 'false', autocomplete: 'off',
    placeholder: '输入一个与库中卡片字面不同、但含义相近的问题，查看语义种子',
  });
  const vaultA = h('select', { class: 'semb-select' });
  const vaultB = h('select', { class: 'semb-select' });
  let vaultList = [];

  root.appendChild(card({
    kicker: 'Semantic index', level: 2,
    title: '语义关联 · 沉淀回流与库桥',
    hint: '基于本地词向量生成关联候选；建立关联需要你的确认。',
    actions: [
      h('button', { class: 'btn ghost mini', onclick: () => loadStatus().catch(() => {}) }, '刷新状态'),
      h('button', { class: 'btn ghost mini', onclick: () => reindex().catch(() => {}) }, '重建语义索引'),
    ],
    body: [statusBody],
  }));

  root.appendChild(card({
    kicker: '01 · 调取', title: '语义调取',
    hint: '计算语义相似度，结果仅供参考。',
    body: [
      h('div', { class: 'semb-row' }, searchInput,
        h('button', { class: 'btn primary mini', onclick: () => runSearch().catch(() => {}) }, '计算语义种子')),
      searchOut,
    ],
  }));

  root.appendChild(card({
    kicker: '02 · 沉淀 ↔ 调取', title: '待确认关联',
    hint: '本轮调取到但未被引用的卡片，确认后才建立关联。',
    actions: [h('button', { class: 'btn ghost mini', onclick: () => loadSuggestions().catch(() => {}) }, '刷新候选')],
    body: [suggestOut],
  }));

  root.appendChild(card({
    kicker: '03 · 库与库', title: '语义库桥',
    hint: '每个库由真实卡向量平均出质心；库桥候选必须同时给出 cosine、相对显著性与共享术语证据。'
      + '库质心相似度只作库间相对比较，不代表绝对语义相关。',
    body: [
      h('div', { class: 'semb-row' }, vaultA, vaultB,
        h('button', { class: 'btn primary mini', onclick: () => runBridges().catch(() => {}) }, '计算库桥候选')),
      bridgeOut,
    ],
  }));

  root.appendChild(card({
    kicker: 'Honest boundaries', title: '诚实边界',
    body: [h('ul', { class: 'semb-boundary' },
      h('li', null, 'NeoLM 是从本仓库真实文本训练出的领域神经语言模型，不是通用聊天大模型；不含知识、答案或预置卡片。'),
      h('li', null, '向量由 1.50 GiB 真实训练权重逐卡计算，带文本哈希与模型指纹；正文或模型变化必须重算，绝不复用过期值。'),
      h('li', null, 'cosine 与「相对显著性」是可复核的向量几何量，不是模型置信度，也不代表事实关系成立。'),
      h('li', null, '模型不可用时三条链路全部如实降级到原有 BM25 / 激活扩散，界面显示真实原因而非占位数字。'))],
  }));

  host.appendChild(root);

  async function loadStatus() {
    statusBody.innerHTML = '';
    statusBody.appendChild(pending('读取语义索引状态'));
    try {
      const s = unwrap(await api.semantic.status());
      statusBody.innerHTML = '';
      statusBody.appendChild(h('div', { class: 'semb-kpis' }, [
        kpi('模型', s.model?.active ? `已加载 · ${num(s.model.vocab)} 词 / ${num(s.model.dim)} 维` : '不可用'),
        kpi('语义索引', s.index?.active !== false && s.index ? `${num(s.index.count)} 张卡` : '未建立'),
        kpi('向量维度', s.index?.dim ?? '—'),
        kpi('当前库卡片', num(s.vault?.nodes)),
        kpi('沉淀账本', num(s.vault?.qaPairs)),
        kpi('索引缓存', s.index?.cacheValid ? '指纹一致，可复用' : '需重算'),
      ]));
      if (!s.active) statusBody.appendChild(msg('warn', `语义链路降级：${esc(s.reason || '未知原因')}`));
      const f = facts([
        ['索引文件', s.index?.file],
        ['模型指纹', s.index?.modelId ? short(s.index.modelId, 32) : null],
        ['沉淀回写库', s.sediment ? `${esc(s.sediment.path)} · ${num(s.sediment.qaPairs)} 条账本` : null],
      ]);
      if (f) statusBody.appendChild(f);
      if (s.index?.truncated) statusBody.appendChild(msg('warn',
        `库超过索引上限（${num(s.index.maxNodes)} 张），已如实截断，未索引的卡不参与语义召回`));
    } catch (e) { statusBody.innerHTML = ''; statusBody.appendChild(failed('读取状态', e)); }
  }

  async function reindex() {
    statusBody.innerHTML = '';
    statusBody.appendChild(pending('全量重算语义向量'));
    try {
      const r = unwrap(await api.semantic.reindex());
      if (!r.active) throw new Error(r.reason || '索引不可用');
      toast(`语义索引已重建：${num(r.count)} 张卡，逐卡真实计算`);
      await loadStatus();
    } catch (e) { statusBody.innerHTML = ''; statusBody.appendChild(failed('重建索引', e)); }
  }

  async function runSearch() {
    searchOut.innerHTML = '';
    searchOut.appendChild(pending('计算查询向量与逐卡 cosine'));
    try {
      const r = unwrap(await api.semantic.search({ text: searchInput.value, topK: 8 }));
      searchOut.innerHTML = '';
      if (!r.active) { searchOut.appendChild(msg('warn', `语义调取降级：${esc(r.reason || '未知原因')}`)); return; }
      searchOut.appendChild(h('div', { class: 'semb-meta' },
        h('span', null, `本库平均 cosine ${fmt(r.baseline)}`),
        h('span', null, `参与比较 ${num(r.compared)} 张`),
        h('span', null, `扩展词 ${esc((r.expandedTerms || []).join(' / ') || '—')}`)));
      if (r.method) searchOut.appendChild(h('p', { class: 'semb-mono' }, esc(r.method)));
      if (!r.seeds?.length) { searchOut.appendChild(msg('pending', '没有显著高于基线的语义种子（真实返回为空）')); return; }
      searchOut.appendChild(h('div', { class: 'semb-list' }, r.seeds.map((s) =>
        h('div', { class: 'semb-item' },
          h('div', { class: 'semb-item-main' },
            h('b', null, esc(s.title || s.id)),
            h('span', { class: 'semb-mono' }, esc(short(s.path || s.id, 40)))),
          h('div', { class: 'semb-item-metrics' },
            h('span', null, `cosine ${fmt(s.sim)}`),
            h('span', null, `显著性 +${fmt(s.lift)}`),
            h('span', null, `扩散初值权重 ${fmt(s.strength, 3)}`))))));
    } catch (e) { searchOut.innerHTML = ''; searchOut.appendChild(failed('语义调取', e)); }
  }

  async function loadSuggestions() {
    suggestOut.innerHTML = '';
    suggestOut.appendChild(pending('读取沉淀回流的语义候选'));
    try {
      const r = unwrap(await api.semantic.suggestions());
      suggestOut.innerHTML = '';
      suggestOut.appendChild(h('div', { class: 'semb-meta' },
        h('span', null, `账本候选 ${num(r.total)} 条`),
        h('span', null, `待确认 ${num(r.pending)} 条`),
        h('span', null, `模型可用 ${r.modelActive ? '是' : '否'}`)));
      if (!r.items?.length) {
        suggestOut.appendChild(msg('pending', '暂无候选。先做一次问答并回写沉淀，且回写时传入本轮真实调取的卡片 id，才会产生待确认关联。'));
        return;
      }
      suggestOut.appendChild(h('div', { class: 'semb-list' }, r.items.map((it) =>
        h('div', { class: `semb-item ${it.built ? 'semb-item-done' : ''}` },
          h('div', { class: 'semb-item-main' },
            h('b', null, `${esc(short(it.dstTitle, 30))} ← ${esc(short(it.question, 26))}`),
            h('span', { class: 'semb-mono' },
              `${esc(it.vaultLabel || '')} · ${esc(it.mode === 'cross_vault' ? '跨库关联' : '语义相似边')}`)),
          h('div', { class: 'semb-item-metrics' },
            h('span', null, `cosine ${fmt(it.sim)}`),
            h('span', null, `共享术语 ${esc((it.sharedTerms || []).join('、') || '无')}`)),
          h('div', { class: 'semb-item-foot' },
            h('span', { class: 'semb-mono' },
              esc(it.evidenceKind === 'shared_terms' ? '有共享术语字面证据' : '仅模型语义信号，无字面证据')),
            it.built
              ? h('span', { class: 'semb-badge' }, '已确认建立')
              : h('button', {
                class: 'btn ghost mini',
                onclick: async () => {
                  try {
                    const out = unwrap(await api.semantic.applySuggestion(it));
                    if (!out.ok) throw new Error(out.error || '未创建');
                    toast(`已建立${out.kind === 'edge' ? '语义相似边' : '跨库关联'}：${short(out.id, 16)}`);
                    await loadSuggestions();
                  } catch (e) { toast(`建立关联失败：${e?.message || e}`); }
                },
              }, '确认建立关联'))))));
    } catch (e) { suggestOut.innerHTML = ''; suggestOut.appendChild(failed('读取候选', e)); }
  }

  async function loadVaults() {
    const r = unwrap(await api.semantic.vaults());
    vaultList = r.vaults || [];
    const opts = vaultList.map((v) => h('option', { value: v.id },
      `${esc(v.name)}${v.active ? '（当前）' : ''} · ${v.cards == null ? '未加载' : `${num(v.cards)} 张`}`));
    vaultA.innerHTML = ''; vaultB.innerHTML = '';
    for (const o of opts) { vaultA.appendChild(o.cloneNode(true)); vaultB.appendChild(o.cloneNode(true)); }
    if (vaultList.length > 1 && vaultA.value === vaultB.value) vaultB.selectedIndex = 1;
  }

  async function runBridges() {
    bridgeOut.innerHTML = '';
    bridgeOut.appendChild(pending('计算两库逐卡向量与库质心'));
    try {
      const r = unwrap(await api.semantic.bridges({ aId: vaultA.value, bId: vaultB.value, topK: 12 }));
      bridgeOut.innerHTML = '';
      if (!r.active) { bridgeOut.appendChild(msg('warn', `库桥不可用：${esc(r.reason || '未知原因')}`)); return; }
      bridgeOut.appendChild(h('div', { class: 'semb-kpis' }, [
        kpi('库质心 cosine', fmt(r.vaultSimilarity)),
        kpi('卡对基线', fmt(r.baseline)),
        kpi('参与比较卡对', num(r.compared)),
        kpi('显著候选', num(r.pairs?.length)),
      ]));
      const f = facts([
        ['参与库', `${esc(r.vaultA?.name || '')} ${num(r.vaultA?.nodeCount)} 张 ↔ ${esc(r.vaultB?.name || '')} ${num(r.vaultB?.nodeCount)} 张`],
        ['比较口径', r.vaultSimilarityNote],
      ]);
      if (f) bridgeOut.appendChild(f);
      if (!r.pairs?.length) { bridgeOut.appendChild(msg('pending', '没有显著高于基线的跨库卡对（真实返回为空）')); return; }
      bridgeOut.appendChild(h('div', { class: 'semb-list' }, r.pairs.map((p) => {
        const item = { aVaultId: r.vaultA?.id, bVaultId: r.vaultB?.id,
          aId: p.aId, bId: p.bId, sim: p.sim, lift: p.lift,
          sharedTerms: p.sharedTerms, modelId: p.modelId };
        return h('div', { class: 'semb-item' },
          h('div', { class: 'semb-item-main' },
            h('b', null, `${esc(short(p.aTitle, 22))} ↔ ${esc(short(p.bTitle, 22))}`),
            h('span', { class: 'semb-mono' }, esc(p.evidenceKind === 'shared_terms' ? '有共享术语证据' : '仅模型语义信号（无字面证据）'))),
          h('div', { class: 'semb-item-metrics' },
            h('span', null, `cosine ${fmt(p.sim)}`),
            h('span', null, `显著性 +${fmt(p.lift)}`),
            h('span', null, `共享术语 ${esc((p.sharedTerms || []).join('、') || '无')}`)),
          h('div', { class: 'semb-item-foot' },
            h('span', { class: 'semb-mono' }, '确认后才写入真实跨库关联'),
            h('button', {
              class: 'btn ghost mini',
              onclick: async () => {
                try {
                  const out = unwrap(await api.semantic.applyBridge(item));
                  if (!out.ok) throw new Error(out.error || '未创建');
                  toast(`已建立跨库关联：${short(out.id, 16)}`);
                  // 真实刷新：用最新一次确认后的状态重算库桥候选，让用户从界面
                  // 看到这条边已被确认写入，而不是只靠一条会消失的 toast。
                  await runBridges().catch(() => {});
                } catch (e) { toast(`建立库桥失败：${e?.message || e}`); }
              },
            }, '确认建立库桥')));
      })));
    } catch (e) { bridgeOut.innerHTML = ''; bridgeOut.appendChild(failed('计算库桥', e)); }
  }

  loadStatus().catch((e) => console.error('[semantic] 状态读取失败', e));
  loadSuggestions().catch((e) => console.error('[semantic] 候选读取失败', e));
  loadVaults().catch((e) => { bridgeOut.appendChild(failed('读取知识库列表', e)); });
  return { unmount() { /* 无定时器 / 无订阅：切走时不留后台工作 */ } };
}

export default mountSemanticBridge;
