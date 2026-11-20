// 能力中枢 · Capability Hub（v6.18.0）
// ---------------------------------------------------------------------------
// 这个视图解决一个具体问题：内核里**真实存在**的能力，主界面却没有入口。
// 例如量子桥（mind:quantum-*）、神经学习（mind:neuro-learn）、存储位置
// （vault:storageLocations）、令牌查看（api:revealToken）、复核队列
// （kb_review_queue）、写回 / 建节点 / 扩检等工具，以及四个已写好但个人版
// 下无法到达的视图（team / vaults / console / mind3d）。
//
// ── 真实性纪律（本文件的硬约束） ──────────────────────────────────────────
// ① 每一个按钮都调用一个**在 desktop/main.js 中真实注册**的 IPC 通道；
// ② 所有 API 调用一律写完整 `api.a.b()` 路径，供
//    tools/gen-capability-manifest.mjs 精确提取，禁止解构成别名绕过统计；
// ③ 结果区只回显 IPC 的真实返回值（含真实错误）；未就绪 / 空结果如实写明，
//    绝不填充示例值、估值、进度或随机数字；
// ④ 会写磁盘 or 迁移目录的操作先弹确认，用户取消即不执行；
// ⑤ 能力矩阵读的是由源码自动生成的 capability-manifest.js，不手写清单；
// ⑥ 边界声明引用内核返回的 boundary / claim 原文，不夸大任何能力。
// ---------------------------------------------------------------------------
import { h, modal, icon } from '../ui-kit.js';
import { CAPABILITY_MANIFEST } from '../capability-manifest.js';

const M = CAPABILITY_MANIFEST;
const num = (v) => (Number(v) || 0).toLocaleString('zh-CN');
const gb = (b) => (Number(b) / 1073741824).toFixed(1) + ' GB';
const pick = (r, ...keys) => {
  for (const k of keys) if (r && r[k] != null) return r[k];
  return null;
};
const dataOf = (r) => (r && typeof r === 'object' && 'ok' in r && 'data' in r) ? r.data : r;

// 从真实返回值中抽取一个简短可读字段，仅用于自检汇总的「info」列（不臆造）
const safeInfo = (r) => {
  if (r == null) return '（无返回）';
  const d = (r && typeof r === 'object' && 'ok' in r && 'data' in r) ? r.data : r;
  if (d && typeof d === 'object') {
    for (const k of ['passed', 'total', 'count', 'ok', 'status', 'nodes', 'edges', 'channels', 'generations']) {
      if (d[k] != null) return `${k}=${d[k]}`;
    }
    const ks = Object.keys(d);
    if (ks.length) return ks.slice(0, 3).join(',');
  }
  return String(r).slice(0, 60);
};

export function mountCapabilities({ host, app, api, toast, status, route, setSelected, fmtTime }) {
  host.innerHTML = '';
  const root = h('div', { class: 'pro-hub', id: 'capabilityHub' });
  host.appendChild(root);

  // ───────── 通用：结果回显 ─────────
  function makeOut() {
    const state = h('span', { class: 'o-state idle' }, '未执行');
    const meta = h('span', { class: 'o-meta' }, '');
    const pre = h('pre');
    const copy = h('button', { class: 'btn ghost', title: '复制完整返回内容到剪贴板' }, '复制');
    const exportBtn = h('button', { class: 'btn ghost', title: '将真实返回结果导出为 .json 文件' }, '导出');
    const chips = h('div', { class: 'pro-inline-list' });
    const box = h('div', { class: 'pro-out', hidden: true },
      h('div', { class: 'pro-out-head' }, state, meta, h('span', { class: 'o-actions' }, copy, exportBtn)),
      chips, pre);
    let last = '';
    copy.addEventListener('click', async () => {
      if (!last) { toast('尚无返回结果', 'err', 2200); return; }
      try { await navigator.clipboard.writeText(last); toast('已复制真实返回结果', 'ok', 2200); }
      catch (e) { toast('剪贴板不可用：' + String(e?.message || e), 'err', 3200); }
    });
    // v6.17：真实导出 —— 把内核真实返回结果存为本地 .json 文件（无任何再加工）
    exportBtn.addEventListener('click', () => {
      if (!last) { toast('尚无可导出的返回结果', 'err', 2200); return; }
      try {
        const blob = new Blob([last], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `neocosmos-capability-${Date.now()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('已导出真实返回结果为 JSON 文件', 'ok', 2600);
      } catch (e) { toast('导出失败：' + String(e?.message || e), 'err', 3200); }
    });
    return {
      box,
      set(kind, label, value, ms, summary) {
        box.hidden = false;
        state.className = 'o-state ' + kind;
        state.textContent = label;
        meta.textContent = ms == null ? '' : `耗时 ${ms.toFixed(0)} ms · 真实 IPC 返回`;
        if (value === undefined) { last = ''; pre.textContent = ''; }
        else {
          let s;
          try { s = JSON.stringify(value, null, 2); } catch { s = String(value); }
          last = s;
          const truncated = s.length > 12000;
          pre.textContent = truncated ? s.slice(0, 12000) + '\n…（返回过长，此处截断显示；复制可获得完整内容）' : s;
        }
        chips.innerHTML = '';
        for (const [k, v] of (summary || [])) {
          if (v == null) continue;
          chips.appendChild(h('span', { class: 'pro-chip' }, k + ' ', h('b', null, String(v))));
        }
      },
    };
  }

  async function confirmWrite(title, message) {
    const r = await modal({ title, message, confirmText: '确认执行', cancelText: '取消', danger: true });
    return !!r;
  }

  function bind(btn, out, fn, opts = {}) {
    btn.addEventListener('click', async () => {
      if (opts.confirm) {
        const ok = await confirmWrite(opts.confirmTitle || '确认操作', opts.confirm);
        if (!ok) { out.set('idle', '已取消', undefined); return; }
      }
      btn.disabled = true;
      out.set('busy', '执行中…', undefined);
      const t0 = performance.now();
      try {
        const r = await fn();
        const failed = r && typeof r === 'object' && r.ok === false;
        out.set(failed ? 'err' : 'ok', failed ? '返回失败' : '成功', r, performance.now() - t0,
          opts.summary ? opts.summary(r) : null);
        if (failed) toast('内核返回失败：' + String(r.error || ''), 'err', 4200);
        else if (opts.okToast) toast(opts.okToast, 'ok', 2600);
        if (opts.after) { try { opts.after(r); } catch (e) { console.error('[hub] after', e); } }
      } catch (e) {
        out.set('err', '异常', { error: String(e && e.message || e) }, performance.now() - t0);
        toast('操作异常：' + String(e && e.message || e), 'err', 4200);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  // ───────── 通用：字段 ─────────
  function fields(defs) {
    const wrap = h('div', { class: 'pro-fields' });
    const get = {};
    for (const d of defs) {
      const isTextarea = d.type === 'textarea';
      const isSelect = d.type === 'select';
      const input = h(isTextarea ? 'textarea' : isSelect ? 'select' : 'input', {
        type: isTextarea || isSelect ? null : (d.type === 'number' ? 'number' : 'text'),
        placeholder: d.placeholder || '',
        value: d.value == null ? '' : String(d.value),
        'aria-label': d.label,
      });
      // textarea 的内容只能靠 textContent，value 属性不会显示（这里不使用任何占位文本）
      if (isTextarea && d.value != null) input.textContent = String(d.value);
      if (d.type === 'select') {
        for (const o of (d.options || [])) input.appendChild(h('option', { value: o.value }, o.label));
        input.value = String(d.value ?? (d.options?.[0]?.value ?? ''));
      }
      if (d.type === 'number') { input.min = d.min ?? 0; input.max = d.max ?? 99999; input.step = d.step ?? 1; }
      const cell = h('label', { class: 'pro-field' + (d.wide ? ' wide' : '') },
        h('span', null, d.label), input);
      wrap.appendChild(cell);
      get[d.key] = () => {
        const raw = input.value;
        if (d.type === 'number') return Number(raw);
        if (d.type === 'json') {
          if (!String(raw).trim()) return {};
          return JSON.parse(raw);
        }
        if (d.type === 'list') return String(raw).split(/[,，\s]+/).filter(Boolean);
        return raw;
      };
      get['$' + d.key] = input;
    }
    return { wrap, get };
  }

  // ───────── 通用：操作卡 ─────────
  function card(spec) {
    const out = makeOut();
    const f = fields(spec.fields || []);
    const actions = h('div', { class: 'pro-actions' });
    const c = h('div', { class: 'pro-card', 'data-cap': spec.id || '' },
      h('div', { class: 'pro-card-head' },
        h('h4', null, spec.title),
        spec.tag ? h('span', { class: 'c-tag' }, spec.tag) : null),
      spec.note ? h('p', { class: 'pro-note' }, spec.note) : null,
      spec.warn ? h('p', { class: 'pro-warn' }, spec.warn) : null,
      f.wrap, spec.extra || null, actions, out.box);
    for (const a of (spec.actions || [])) {
      const btn = h('button', { class: 'btn' + (a.primary ? ' is-primary' : ''), title: a.title || a.label }, a.label);
      bind(btn, out, () => a.run(f.get), {
        confirm: a.confirm, confirmTitle: a.confirmTitle, okToast: a.okToast,
        summary: a.summary, after: a.after,
      });
      actions.appendChild(btn);
    }
    return { root: c, out, get: f.get };
  }

  function section(index, title, en, desc, children) {
    return h('section', { class: 'pro-section', 'data-section': index },
      h('div', { class: 'pro-section-head' },
        h('span', { class: 's-index' }, String(index).padStart(2, '0')),
        h('h3', null, title),
        desc ? h('span', { class: 's-desc' }, desc) : null),
      h('div', { class: 'pro-grid' }, children));
  }

  // ═════════ 页头 + 真实运行时刻画 ═════════
  const metaBox = h('div', { class: 'pro-hub-meta' });
  const refreshAll = h('button', { class: 'btn' }, '刷新全部读数');
  // v6.27.0：能力中枢是全站唯一缺 .page-head 的独立页面。补上统一标题外壳后，
  // §14.2 的字号梯度 / 分隔线才覆盖到它；只加 class，不动按钮、数据流与文案。
  root.appendChild(h('div', { class: 'pro-hub-head page-head' },
    h('div', null,
      h('h2', null, '能力中枢'),
      h('p', { class: 'pro-lede' }, '内核已注册能力的可操作入口。')),
    h('div', { class: 'pro-hub-meta' }, refreshAll, metaBox)));

  // KPI：全部来自真实调用
  const kpiBox = h('div', { class: 'pro-kpis' });
  root.appendChild(kpiBox);

  // ───── 内核自检 · 一键验证（真实 IPC 汇总，不虚构任何能力）─────
  const selfOut = makeOut();
  const selfCheckBtn = h('button', { class: 'btn is-primary', title: '依次运行真实内核自检并汇总结果' }, '运行全部内核自检');
  const selfCard = h('div', { class: 'pro-card pro-selfcheck' },
    h('div', { class: 'pro-card-head' },
      h('span', { class: 'ci', html: icon('check', 16) }),
      h('h4', null, '内核自检 · 一键验证')),
    h('p', { class: 'pro-note' }, '运行数值内核、图统计、自主引擎、认知计算的内核自检。'),
    h('div', { class: 'pro-actions' }, selfCheckBtn),
    selfOut.box);
  selfCheckBtn.addEventListener('click', async () => {
    selfCheckBtn.disabled = true;
    selfOut.set('busy', '自检进行中…', undefined);
    const t0 = performance.now();
    const results = [];
    const step = async (name, fn) => {
      try {
        const r = await fn();
        // v6.20：「没抛异常」≠「自检通过」。{ ok:false } / passed<total / failed>0
        // 都是真实失败，必须计入失败数，否则「N/N 通过」是高估的假结论。
        const d = r && typeof r === 'object' ? (r.data ?? r) : null;
        const ok = r?.ok !== false && d?.ok !== false
          && !(Number.isFinite(d?.total) && Number.isFinite(d?.passed) && d.passed < d.total)
          && !(Number.isFinite(d?.failed) && d.failed > 0);
        results.push({ name, ok: !!ok, r });
      } catch (e) { results.push({ name, ok: false, error: String(e && e.message || e) }); }
    };
    await step('数值内核 · 算法自检', () => api.astra.deepMath());
    await step('图统计 · kb_graph_stats', () => api.stats());
    await step('自主引擎 · 状态', () => api.astra.status());
    await step('认知计算 · 状态', () => api.mind.status());
    const pass = results.filter((x) => x.ok).length;
    const summary = [
      ['项目', results.length], ['通过', pass],
      ['失败', results.length - pass], ['耗时(ms)', Math.round(performance.now() - t0)],
    ];
    selfOut.set(
      pass === results.length ? 'ok' : (pass > 0 ? 'warn' : 'err'),
      `自检完成 · ${pass}/${results.length} 通过`,
      { steps: results.map((x) => ({ name: x.name, ok: x.ok, info: x.ok ? safeInfo(x.r) : x.error })) },
      performance.now() - t0, summary);
    selfCheckBtn.disabled = false;
  });
  // 放在 KPI 条与分区之间，作为全页第一个可操作入口
  root.insertBefore(selfCard, root.children[2] || null);
  const kpiDefs = [
    { key: 'nodes', label: '知识卡片', sub: 'kb_graph_stats · 当前库' },
    { key: 'edges', label: '关系突触', sub: 'kb_graph_stats · 当前库' },
    { key: 'channels', label: '内核通道', sub: '源码清单快照' },
    { key: 'apis', label: '桥接 API', sub: '源码清单快照' },
    { key: 'hub', label: '中枢直达', sub: '完整路径精确匹配' },
    { key: 'integrity', label: '完整性基线', sub: 'QS-Shield 校验文件' },
    { key: 'service', label: '本地服务', sub: '127.0.0.1 只读 API' },
    { key: 'runtime', label: '运行时', sub: 'Electron / Node' },
  ];
  const kpiEls = {};
  for (const d of kpiDefs) {
    const val = h('div', { class: 'k-value' }, '读取中…');
    const el = h('div', { class: 'pro-kpi is-pending', 'data-kpi': d.key },
      h('div', { class: 'k-label' }, d.label), val, h('div', { class: 'k-sub' }, d.sub));
    kpiEls[d.key] = { el, val };
    kpiBox.appendChild(el);
  }
  function setKpi(key, value, sub, accent) {
    const k = kpiEls[key];
    if (!k) return;
    k.el.classList.remove('is-pending');
    k.val.textContent = value == null ? '未就绪' : String(value);
    k.val.classList.toggle('is-accent', !!accent);
    if (sub != null) k.el.querySelector('.k-sub').textContent = sub;
  }

  async function loadKpis() {
    setKpi('channels', num(M.totals.channels), '源码清单快照');
    setKpi('apis', num(M.totals.apis), '源码清单快照');
    setKpi('hub', num(M.totals.hub), '完整路径精确匹配', true);
    const settled = await Promise.allSettled([
      api.stats(), api.enterprise.securityStatus(), api.apiServer.status(), api.init(),
    ]);
    const [stats, sec, svc, init] = settled.map((s) => s.status === 'fulfilled' ? s.value : null);
    const sd = stats && stats.ok ? stats.data : null;
    setKpi('nodes', sd ? num(sd.nodes) : null, sd ? `平均度 ${sd.avg_degree} · 孤儿率 ${sd.orphan_rate}%` : '未打开知识库');
    setKpi('edges', sd ? num(sd.edges) : null, sd ? `权重 ${sd.weight_min}–${sd.weight_max}` : '未打开知识库');
    const ig = sec && sec.integrity;
    setKpi('integrity', ig ? `${ig.checked} 项` : (sec ? '—' : null),
      ig ? (ig.ok ? '哈希链与基线一致' : '存在不一致') : 'QS-Shield 未就绪');
    setKpi('service', svc && svc.data ? (svc.data.running ? `运行中 :${svc.data.port}` : '已停止') : null,
      svc && svc.data ? `端口 ${svc.data.port} · ${svc.data.hasToken ? '已设令牌' : '未设令牌'}` : '未就绪');
    setKpi('runtime', init ? `E${String(init.electron).split('.')[0]}` : null,
      init ? `Electron ${init.electron} · Node ${init.node} · ${init.platform}/${init.arch}` : '未就绪');
    metaBox.innerHTML = '';
    metaBox.appendChild(h('div', { class: 'pro-stamp', title: `源码指纹 ${M.sourceHash}` },
      '清单由源码生成 · 构建期快照，非实时探测'));
  }
  refreshAll.addEventListener('click', async () => {
    refreshAll.disabled = true; refreshAll.textContent = '读取中…';
    try { await loadKpis(); toast('读数已按真实内核状态刷新', 'ok', 2400); }
    finally { refreshAll.disabled = false; refreshAll.textContent = '刷新全部读数'; }
  });

  // ═════════ 01 · 量子启发式桥 ═════════
  const quantum = card({
    id: 'quantum', tag: 'mind:quantum-*', title: '量子形式主义 · 状态与单步推演',
    note: '本机 CPU 上的确定性算法：叠加态 / 纠缠 / 酉演化 / Born 规则坍缩。下方所有数字来自量子认知内核的真实运行时状态，边界原文亦由内核返回。',
    fields: [],
    actions: [
      { label: '读取状态', primary: true, run: () => api.mind.quantumStatus(),
        summary: (r) => { const d = dataOf(r) || {}; return [['基态', d.basisCount], ['耦合边', d.coupledEdges], ['连接组', d.connectomeEdges], ['推演步数', d.steps], ['绑定', d.bound]]; } },
      { label: '单步推演', run: () => api.mind.quantumStep(),
        summary: (r) => { const d = dataOf(r) || {}; return [['步', d.step], ['坍缩', d.collapsed?.name], ['概率', d.collapsed?.probability], ['熵(bits)', d.audit?.entropyBits]]; } },
      { label: '查看内核边界', run: async () => { const r = await api.mind.quantumStatus(); return { boundary: dataOf(r)?.boundary ?? '（内核未返回边界文本）' }; } },
    ],
  });
  const quantumBind = card({
    id: 'quantum-bind', tag: 'mind:quantum-bind', title: '量子态绑定',
    note: '切换内核的绑定标志，返回值是内核真实的 { bound, status }。',
    fields: [{ key: 'on', label: '绑定到认知链', type: 'select', value: 'true', options: [{ value: 'true', label: '开启绑定' }, { value: 'false', label: '解除绑定' }] }],
    actions: [
      { label: '应用绑定', primary: true, run: (g) => api.mind.quantumBind(g.on() === 'true'),
        summary: (r) => [['bound', dataOf(r)?.bound], ['steps', dataOf(r)?.status?.steps]] },
    ],
  });
  root.appendChild(section(1, '数值内核 · 量子形式主义', '', '经典 CPU 模拟 · 非量子计算机',
    [quantum.root, quantumBind.root]));

  // ═════════ 02 · 类脑计算引擎 ═════════
  const neuro = card({
    id: 'neuro', tag: 'mind:neuro-*', title: '认知算法 · SNN / 吸引子 / 序列 / 预测编码',
    note: '四种认知算法，各自独立可调用。',
    fields: [
      { key: 'steps', label: '脉冲步数', type: 'number', value: 160, min: 10, max: 2000 },
      { key: 'pattern', label: '模式 / 线索 JSON', type: 'json', value: '{}', placeholder: '{"前额叶": 0.9}', wide: true },
      { key: 'label', label: '概念标签', value: 'capability-hub' },
    ],
    actions: [
      { label: '读取状态', primary: true, run: () => api.mind.neuroStatus(),
        summary: (r) => { const d = dataOf(r) || {}; return [['神经元', d.neurons], ['突触', d.synapses], ['模式', d.patterns], ['自由能', d.predictorFreeEnergy]]; } },
      { label: '跑一轮 SNN', run: (g) => api.mind.neuroStep({ steps: g.steps(), label: g.label() }),
        summary: (r) => { const d = dataOf(r) || {}; return [['脉冲', d.spikes], ['激活脑区', d.firedRegions]]; } },
      { label: '联想召回', run: (g) => api.mind.neuroRecall({ cue: g.pattern() }) },
      { label: '序列预测', run: () => api.mind.neuroPredict({}) },
      { label: '写入概念', run: (g) => api.mind.neuroLearn({ pattern: g.pattern(), label: g.label() }), okToast: '概念已送入类脑引擎' },
      { label: '查看内核边界', run: async () => { const r = await api.mind.neuroStatus(); return { boundary: dataOf(r)?.boundary ?? '（内核未返回边界文本）' }; } },
    ],
  });
  const cognition = card({
    id: 'cognition', tag: 'mind:*', title: '认知内核 · 解剖 / 账本 / 状态',
    note: '八阶段推理的结构、反馈账本与运行时状态。',
    actions: [
      { label: '内核状态', primary: true, run: () => api.mind.status() },
      { label: '解剖结构', run: () => api.mind.anatomy() },
      { label: '反馈账本', run: () => api.mind.ledger() },
      { label: '审计轨迹', run: () => api.astra.audit(20) },
      { label: '长期记忆', run: () => api.astra.memories(20) },
      { label: '设为停留', run: () => api.astra.hold(true), okToast: '已通知星灵内核进入停留' },
      { label: '恢复巡行', run: () => api.astra.hold(false), okToast: '已通知星灵内核恢复巡行' },
      { label: '回到初始位', run: () => api.astra.home() },
      { label: '重置星灵', confirm: '重置会清空星灵的运行时状态与世代演化记录，且不可撤销。确认执行？', confirmTitle: '确认重置星灵',
        run: () => api.astra.reset(), okToast: '星灵内核已重置' },
    ],
  });
  // v6.15：深度数学 / 自我迭代闭环。三个按钮分别对应主进程新注册的
  // astra:deep-status / astra:deep-math / astra:self-iterate，数值全部来自
  // desktop/astra/deep-math.cjs 的确定性计算，没有演示数据、没有随机占位。
  const deepMath = card({
    id: 'deep-math', tag: 'astra:deep-*', title: '数值实验 · 策略迭代',
    note: '本机确定性数值计算，迭代会改写策略参数。',
    warn: '本地经典数值模拟，非真实量子计算，不具备意识。',
    fields: [
      { key: 'obs', label: '观测值（0–1，留空 = 取自真实运行态）', value: '', placeholder: '留空则读取内核真实进度 / 反馈比' },
    ],
    actions: [
      { label: '读取迭代状态', primary: true, run: () => api.astra.deepStatus(),
        summary: (r) => { const d = dataOf(r) || {}; return [['世代', d.generation], ['策略探索率', d.policy?.explore], ['上次自由能', d.last?.freeEnergy]]; } },
      { label: '算法自检', run: () => api.astra.deepMath(),
        summary: (r) => { const d = dataOf(r) || {}; return [['通过', d.passed], ['总数', d.total], ['结论', d.passed === d.total ? '全部通过' : '存在失败']]; } },
      { label: '单步自我迭代', run: (g) => {
          const raw = String(g.obs()).trim();
          const obs = raw === '' ? undefined : Number(raw);
          return api.astra.selfIterate(obs);
        },
        summary: (r) => { const d = dataOf(r) || {}; const x = d.record || {};
          return [['世代', x.generation], ['观测', x.observation], ['预测', x.prediction], ['误差', x.error],
            ['自由能', x.freeEnergy], ['决策', x.decision], ['策略', `${x.policyBefore}→${x.policyAfter}`]]; },
        okToast: '自我迭代已执行，策略参数由真实计算改写' },
    ],
  });
  root.appendChild(section(2, '认知计算', '', '真实数值模拟 · 无生物神经与意识',
    [neuro.root, cognition.root, deepMath.root]));

  // ═════════ 03 · 知识工具台 ═════════
  const nodeIdField = { key: 'nodeId', label: '节点 ID', placeholder: '可点「取真实节点」自动填入', wide: true };
  const toolStats = card({
    id: 'tool-stats', tag: 'kb_graph_stats', title: '网络体检与联想展开',
    actions: [
      { label: '网络体检', primary: true, run: () => api.stats(),
        summary: (r) => { const d = dataOf(r) || {}; return [['节点', d.nodes], ['边', d.edges], ['平均度', d.avg_degree], ['孤儿率', d.orphan_rate]]; } },
      { label: '联想展开', run: (g) => api.expand({ node_id: g.nodeId(), hops: g.hops() }) },
      { label: '溯源', run: (g) => api.history({ node_id: g.nodeId() }) },
      { label: '取真实节点', run: () => api.doc.tree(), okToast: '已从当前库读取目录树',
        after: (r) => {
          // 从真实目录树里取第一张卡片的 id 自动填入，避免用户凭空猜 id
          const walk = (n) => {
            if (!n) return null;
            if (Array.isArray(n.files) && n.files.length) return n.files[0].id;
            for (const c of (n.dirs || [])) { const x = walk(c); if (x) return x; }
            return null;
          };
          const id = walk(dataOf(r));
          if (id) toolStats.get.$nodeId.value = String(id);
        } },
    ],
    fields: [nodeIdField, { key: 'hops', label: '展开跳数', type: 'number', value: 2, min: 1, max: 6 }],
  });
  const toolWrite = card({
    id: 'tool-write', tag: 'kb_add_node / kb_write_back', title: '写入 · 新增卡片 / 回写沉淀',
    note: '两个工具都会在当前知识库磁盘上真实创建 Markdown 卡片并写入审计日志；回写为追加式，绝不覆盖人写正文。',
    warn: '写操作会真实改动当前知识库，执行前会再次确认。',
    fields: [
      { key: 'title', label: '卡片标题', value: '', placeholder: '例如：突触可塑性', wide: true },
      { key: 'content', label: '正文', type: 'textarea', value: '', placeholder: '卡片正文…', wide: true },
      { key: 'domain', label: '领域', value: '未分类' },
      { key: 'question', label: '回写问题', value: '', wide: true },
      { key: 'answer', label: '回写结论', type: 'textarea', value: '', wide: true },
      { key: 'cited', label: '被引节点 ID（逗号分隔）', type: 'list', value: '', wide: true },
    ],
    actions: [
      { label: '新增卡片', primary: true,
        confirm: '将向当前知识库写入一张新卡片，并在标题共现时自动建立语义边。确认执行？', confirmTitle: '确认新增知识卡片',
        run: (g) => api.addNode({ title: g.title(), content: g.content(), domain: g.domain() }),
        okToast: '卡片已真实写入当前知识库' },
      { label: '回写沉淀',
        confirm: '将把一次问答的结论追加成沉淀卡片，并尝试与被引节点建立 question_answer 边。确认执行？', confirmTitle: '确认回写沉淀',
        // v6.20：confidence 原本写死 0.8 并随卡片落盘，是污染真实数据的假评分。
        // 不传该字段，由内核按真实引用情况计算；无法计算时内核留空。
        run: (g) => api.writeBack({ question: g.question(), answer: g.answer(), cited_node_ids: g.cited(), tags: ['能力中枢'] }),
        okToast: '沉淀卡片已真实写入',
        summary: (r) => { const d = dataOf(r) || {}; return [['卡片', d.node_id], ['建边', d.built_edges], ['审计', d.journal]]; } },
    ],
  });
  const reviewList = h('div', { class: 'pro-inline-list' });
  const review = card({
    id: 'tool-review', tag: 'kb_review_queue', title: '待整理清单与执行建议',
    note: '清单由巩固调度器对当前库真实计算得出；执行建议仅做机器安全的操作（建边 / 衰减），内核明确拒绝自动改写或删除用户正文。',
    extra: reviewList,
    fields: [
      { key: 'limit', label: '条数', type: 'number', value: 10, min: 1, max: 100 },
      { key: 'kind', label: '类型（可空）', value: '' },
      { key: 'itemId', label: '待整理项 ID', value: '', wide: true },
    ],
    actions: [
      { label: '读取队列', primary: true, run: (g) => api.reviewQueue({ limit: g.limit(), kind: g.kind() || undefined }),
        after: (r) => {
          reviewList.innerHTML = '';
          const items = dataOf(r)?.items || [];
          if (!items.length) { reviewList.appendChild(h('div', { class: 'pro-empty' }, '当前库没有待整理项。')); return; }
          for (const it of items) {
            const id = it.id || it.item_id;
            const chip = h('button', { class: 'pro-chip', title: '点击填入该项 ID' }, String(it.kind || 'item'), ' ', h('b', null, String(id)));
            chip.addEventListener('click', () => { review.get.$itemId.value = String(id); });
            reviewList.appendChild(chip);
          }
        } },
      { label: '执行建议', run: (g) => api.applyReview({ item_id: g.itemId(), action: '', params: {} }),
        summary: (r) => { const d = dataOf(r) || {}; return [['applied', d.applied], ['note', d.note]]; } },
    ],
  });
  const maintenance = card({
    id: 'tool-maintenance', tag: 'index / synapse / consolidate', title: '索引 · 推导 · 巩固',
    note: '重建索引会重新解析双链；推导突触会为无链库长出关系；巩固会跑一轮真实的睡眠整理。三者都会改动索引 / 权重。',
    actions: [
      { label: '重建索引', primary: true, run: () => api.rebuild(), okToast: '索引已重建' },
      { label: '推导突触', run: () => api.derive({}) },
      { label: '执行一轮巩固', run: () => api.consolidate() },
      { label: '审计日志尾部', run: () => api.journal(20) },
      { label: '沉淀列表', run: () => api.sediment(10) },
    ],
  });
  const toolLink = card({
    id: 'tool-link', tag: 'kb_link', title: '建立关联边',
    note: 'kb_link 会真实在两个节点间建一条带类型的边并写入审计日志；type = explicit_link 时视为人工确认并强化该边。',
    warn: '建边会真实改动当前知识库的关系网络，执行前会再次确认。',
    fields: [
      { key: 'src', label: '源节点 ID', value: '', wide: true },
      { key: 'dst', label: '目标节点 ID', value: '', wide: true },
      { key: 'type', label: '边类型', value: 'explicit_link' },
    ],
    actions: [
      { label: '建立关联边', primary: true,
        confirm: '将在这两个节点间建立一条真实的关系边并写入审计日志。确认执行？', confirmTitle: '确认建立关联',
        run: (g) => api.link({ src: g.src(), dst: g.dst(), type: g.type() }),
        okToast: '关联边已写入',
        summary: (r) => { const d = dataOf(r) || {}; return [['edge_id', d.edge_id], ['type', d.type], ['confirmed', d.confirmed]]; } },
      // v6.29.0：关联体检（只读）——如实统计全库孤立卡片，判断是否需要辅助建关联。
      { label: '关联体检（只读）',
        run: () => api.linkAudit(),
        okToast: '已读取真实关联统计',
        summary: (r) => { const d = dataOf(r) || {}; return [['total', d.total], ['orphans', d.orphans], ['connected', d.connected], ['ratio', d.ratio]]; } },
    ],
  });
  root.appendChild(section(3, '知识工具台', 'Knowledge Tools', '写操作真实落盘 · 均需确认',
    [toolStats.root, toolWrite.root, review.root, maintenance.root, toolLink.root]));

  // ═════════ 04 · 思维沉淀库 ═════════
  const library = card({
    id: 'library', tag: 'astra:library:*', title: '沉淀库 · 情境 / 语义 / 突触 / 决策',
    note: '沉淀库是安装目录下（或用户自行迁移到）的普通文件夹；状态、检索命中与概念图都由内核读取真实文件得出。',
    fields: [
      { key: 'q', label: '检索概念', value: '', placeholder: '输入概念后回车或点检索', wide: true },
      { key: 'limit', label: '返回上限', type: 'number', value: 10, min: 1, max: 100 },
    ],
    actions: [
      { label: '读取状态', primary: true, run: () => api.astra.library.status(),
        summary: (r) => { const s = dataOf(r)?.stats || {}; return [['情境', s.episodic], ['语义', s.semantic], ['突触', s.synapse], ['决策', s.decision]]; } },
      { label: '检索概念', run: (g) => api.astra.library.query(g.q(), g.limit()) },
      { label: '概念图', run: (g) => api.astra.library.graph(g.limit()) },
      { label: '打开目录', run: () => api.astra.library.open(), okToast: '已打开思维沉淀库目录' },
      { label: '星灵状态', run: () => api.astra.status() },
    ],
  });
  root.appendChild(section(4, '沉淀库', 'Astra Memory Library', '纯本地文件 · 可审计可迁移', [library.root]));

  // ═════════ 05 · 存储与迁移 ═════════
  const storage = card({
    id: 'storage', tag: 'vault:storageLocations', title: '存储位置与迁移',
    note: '盘符、可用空间、当前库路径均来自本机文件系统真实读取。迁移会复制知识库到新位置并切换，执行前需确认。',
    warn: '迁移是真实的目录级操作；示例语料载入会向当前库写入真实 Markdown 卡片。',
    fields: [{ key: 'target', label: '迁移目标目录', value: '', placeholder: '可点「选择目录」自动填入', wide: true }],
    actions: [
      { label: '读取存储位置', primary: true, run: () => api.vault.storageLocations(),
        summary: (r) => { const d = dataOf(r) || {}; return [['可选位置', (d.locations || []).length], ['系统盘', d.currentOnSystemDrive], ['当前', d.current]]; } },
      { label: '当前库信息', run: () => api.vault.info() },
      { label: '示例语料信息', run: () => api.vault.exampleInfo(),
        summary: (r) => [['可用', dataOf(r)?.available], ['卡片数', dataOf(r)?.count]] },
      { label: '选择目录', confirm: '选择存储位置会立即在该位置建立/切换知识库（内核的真实行为）。确认执行？', confirmTitle: '确认选择存储位置',
        run: () => api.vault.chooseStorage(),
        after: (r) => { const p = pick(dataOf(r), 'vaultRoot', 'path', 'dir', 'targetDir'); if (p) storage.get.$target.value = String(p); } },
      { label: '载入示例语料', confirm: '将向当前知识库写入随包附带的示例语料卡片。确认执行？', confirmTitle: '确认载入示例语料',
        run: () => api.vault.loadExample(), okToast: '示例语料已写入当前知识库',
        summary: (r) => [['写入', dataOf(r)?.written ?? r?.written]] },
      { label: '迁移知识库', confirm: '将把当前知识库迁移到目标目录并切换过去，请在确认前备份重要数据。确认执行？', confirmTitle: '确认迁移知识库',
        run: (g) => api.vault.migrate(g.target()), okToast: '迁移已完成' },
    ],
  });
  root.appendChild(section(5, '存储与迁移', 'Storage / Migration', '真实磁盘读取 · 非模拟', [storage.root]));

  // ═════════ 06 · 本地只读 API ═════════
  const service = card({
    id: 'service', tag: 'api:*', title: '本地只读 HTTP 服务',
    note: '默认仅监听 127.0.0.1、令牌强制必填（≥16 位），不上传云端、知识库文件始终留在本机；局域网共享需在「链接管理」中显式开启（仍强制令牌）。令牌只在用户主动点「显示已存令牌」时读取。',
    fields: [
      { key: 'port', label: '端口', type: 'number', value: 8787, min: 1024, max: 65535 },
      { key: 'token', label: '令牌（启动用）', value: '', placeholder: '可点「生成高强度令牌」', wide: true },
    ],
    actions: [
      { label: '服务状态', primary: true, run: () => api.apiServer.status(),
        summary: (r) => { const d = dataOf(r) || {}; return [['running', d.running], ['port', d.port], ['hasToken', d.hasToken]]; } },
      { label: '生成高强度令牌', run: () => api.apiServer.genToken(),
        after: (r) => { const t = dataOf(r)?.token; if (t) service.get.$token.value = t; } },
      { label: '显示已存令牌', run: () => api.apiServer.revealToken() },
      { label: '启动服务', run: (g) => api.apiServer.start({ port: g.port(), token: g.token() }), okToast: '本地只读服务已启动' },
      { label: '停止服务', run: () => api.apiServer.stop(), okToast: '本地只读服务已停止' },
    ],
  });
  root.appendChild(section(6, '本地只读 API', 'Local API Service', '本机回环 · 令牌强制', [service.root]));

  // ═════════ 07 · 审计 / 完整性 / 深链 / 备份 ═════════
  const audit = card({
    id: 'audit', tag: 'ent:* / vault:audit', title: 'QS-Shield 完整性与合规体检',
    note: '后量子签名 / SHA3 哈希链的真实性校验结果，以及基于当前库实时统计的合规体检（孤儿卡片、悬空双链、重复标题等）。',
    actions: [
      { label: '安全套件状态', primary: true, run: () => api.enterprise.securityStatus(),
        summary: (r) => { const d = dataOf(r) || {}; return [['套件', d.suite], ['校验文件', d.integrity?.checked], ['一致', d.integrity?.ok], ['算法', (d.algorithms || []).length]]; } },
      { label: '重算完整性', run: () => api.enterprise.recheckIntegrity() },
      { label: '合规体检报告', run: () => api.enterprise.audit(),
        summary: (r) => { const d = dataOf(r) || {}; return [['卡片', d.totalCards], ['突触', d.totalSynapses], ['悬空链', d.danglingLinks]]; } },
      { label: '安全声明原文', run: async () => { const r = await api.enterprise.securityStatus(); return { claim: dataOf(r)?.claim, quantumComputing: dataOf(r)?.quantumComputing, qkd: dataOf(r)?.qkd }; } },
    ],
  });
  const sediment = card({
    id: 'sediment', tag: 'ent:sediment* / link:verify', title: '沉淀校验与深链溯源',
    note: '逆向沉淀的开关、记录与逐条哈希校验；深链校验用于回溯卡片片段是否仍在库中真实存在。',
    fields: [
      { key: 'n', label: '记录条数', type: 'number', value: 10, min: 1, max: 200 },
      { key: 'sid', label: '沉淀记录 ID', value: '' },
      { key: 'vaultId', label: '深链 vaultId', value: '', wide: true },
      { key: 'nodeId', label: '深链 nodeId', value: '', wide: true },
      { key: 'snippet', label: '深链片段 snippet', value: '', wide: true },
    ],
    actions: [
      { label: '沉淀开关状态', primary: true, run: () => api.enterprise.sedimentStatus() },
      { label: '沉淀记录', run: (g) => api.enterprise.sedimentList(g.n()) },
      { label: '校验单条沉淀', run: (g) => api.enterprise.verifySediment(g.sid()) },
      { label: '开关写入能力', run: () => api.enterprise.setSediment({ enabled: false }),
        confirm: '该操作会关闭逆向沉淀写入能力（POST /api/sediment 将返回 403）。确认执行？', confirmTitle: '确认关闭写入' },
      { label: '验证深链', run: (g) => api.verify.node({ vaultId: g.vaultId(), nodeId: g.nodeId(), snippet: g.snippet() }) },
      { label: '按卡片打开', run: (g) => api.deepLink.deep({ vaultId: g.vaultId(), cardId: g.nodeId() }) },
    ],
  });
  const backup = card({
    id: 'backup', tag: 'vault:backup / verify / restore', title: '备份 · 校验 · 还原',
    note: '备份包含全部卡片正文、逐张 sha256 清单与审计日志；还原只写入新目录，绝不覆盖现有库；校验不通过的包会被拒绝。文件选择由系统对话框完成。',
    warn: '备份 / 还原会打开系统文件对话框，并写入真实磁盘文件。',
    actions: [
      { label: '备份整个库', primary: true, run: () => api.vaultBackup.backup(), okToast: '备份已生成' },
      { label: '校验备份包', run: () => api.vaultBackup.verify() },
      { label: '从备份还原', confirm: '还原将写入一个全新目录（不覆盖现有库），并生成可打开的副本。确认执行？', confirmTitle: '确认从备份还原',
        run: () => api.vaultBackup.restore(), okToast: '还原已完成' },
    ],
  });
  const misc = card({
    id: 'misc', tag: 'window / vault / vaults / sprite', title: '系统通道 · 窗口 / 路径 / 跨库 / 桌面伴侣',
    note: '这些通道此前只被内部代码或隐藏视图调用，这里按真实签名逐个挂出：窗口最大化状态、打开库内相对路径、跨库关联图谱、冷启动深链、精灵状态与尺寸、外部链接。',
    fields: [
      { key: 'rel', label: '库内相对路径', value: '', placeholder: '例如 _memory/semantic/', wide: true },
      { key: 'url', label: '外部链接（需自行填写真实 URL）', value: '', placeholder: 'https://…', wide: true },
      { key: 'scale', label: '精灵尺寸', type: 'number', value: 0.9, min: 0.6, max: 1.5, step: 0.05 },
    ],
    actions: [
      { label: '窗口是否最大化', primary: true, run: () => api.win.isMaximized() },
      { label: '打开库内路径', run: (g) => api.vault.revealPath(g.rel()) },
      { label: '跨库关联图谱', run: () => api.vaults.xgraph({ force: false }) },
      { label: '取走冷启动深链', run: () => api.deepLink.takeDeepLink() },
      // v6.41.0：精灵状态 / 精灵尺寸两个操作随桌面精灵删除而移除（api.sprite 桥已不存在）。
      { label: '打开外部链接', run: (g) => api.openExternal(g.url()) },
    ],
  });
  root.appendChild(section(7, '审计 · 校验 · 备份', 'Integrity / Audit / Backup', '真实哈希链 · 无模拟结果',
    [audit.root, sediment.root, backup.root, misc.root]));

  // ═════════ 08 · 全域可达 ═════════
  const NAV = [
    { key: 'graph', en: '', title: '星图', desc: '全屏卡片关系网络' },
    { key: 'ask', en: '', title: '问一问', desc: '引用可溯源的离线问答' },
    { key: 'astra', en: '', title: '自主引擎', desc: '驱动 / 记忆 / 演化' },
    { key: 'atlas', en: '', title: '体系体检', desc: '知识库管理与诊断' },
    { key: 'settle', en: '', title: '沉淀台', desc: 'Agent 回写控制台' },
    { key: 'consolidate', en: '', title: '巩固', desc: '整理索引与突触' },
    { key: 'enterprise', en: '', title: '企业管理', desc: '组织 / 知识 / 治理' },
    { key: 'console', en: '', title: '企业控制台', desc: 'API / 防护 / 备份 / 体检' },
    { key: 'team', en: '', title: '团队与部署', desc: '同步盘 / NAS 部署向导' },
    { key: 'vaults', en: '', title: '库管理', desc: '跨库关联图谱 / 链接 API' },
    { key: 'mind3d', en: '', title: '3D 脑区视图', desc: '真实脑区与连接组激活' },
    { key: 'workspace', en: '', title: '工作区', desc: '卡片 / 文档 / 关联三栏' },
  ];
  const navGrid = h('div', { class: 'pro-nav-grid' });
  for (const n of NAV) {
    const b = h('button', { class: 'pro-nav-btn', 'data-route': n.key },
      h('b', null, n.title), h('span', null, n.desc));
    b.addEventListener('click', () => {
      try { route(n.key); setSelected('能力中枢 → ' + n.title); }
      catch (e) { toast('导航失败：' + String(e?.message || e), 'err', 3200); }
    });
    navGrid.appendChild(b);
  }
  root.appendChild(section(8, '全域可达', 'Every View Reachable', '此前四个视图无一级入口',
    [h('div', { class: 'pro-card' },
      h('div', { class: 'pro-card-head' }, h('h4', null, '已存在视图 · 一键直达'), null),
      h('p', { class: 'pro-note' },
        '团队与部署 / 库管理 / 企业控制台 / 3D 智脑这四个视图早已实现，但此前只在企业版 Hub 内部可达（个人版等于没有入口）。此处按真实路由逐个挂出，不新增任何虚构页面。'),
      navGrid)]));

  // ═════════ 09 · 能力矩阵（源码生成） ═════════
  const matrixSearch = h('input', { type: 'search', placeholder: '过滤通道 / API / 视图文件…', 'aria-label': '过滤能力矩阵' });
  const matrixCount = h('span', { class: 'm-count' }, '');
  const matrixBody = h('div');
  const matrixMore = h('button', { class: 'pro-matrix-more' }, '显示全部');
  let showAll = false;
  function renderMatrix() {
    const q = matrixSearch.value.trim().toLowerCase();
    const rows = M.apis.filter((a) => !q || (a.path + ' ' + (a.channel || '') + ' ' + (a.tool || '') + ' ' + a.refs.join(' ')).toLowerCase().includes(q));
    const shown = showAll ? rows : rows.slice(0, 40);
    matrixBody.innerHTML = '';
    const table = h('div', { class: 'pro-matrix' },
      h('div', { class: 'pro-matrix-row m-head' },
        h('span', null, 'IPC 通道'), h('span', null, '桥接 API / 工具'),
        h('span', null, '界面状态'), h('span', null, '其它视图引用')));
    for (const a of shown) {
      const label = { hub: '中枢直达', view: '其它视图', none: '仅内核' }[a.state];
      table.appendChild(h('div', { class: 'pro-matrix-row' },
        h('span', { class: 'm-ch' }, a.channel || '（订阅/事件）'),
        h('span', { class: 'm-api' }, a.tool ? a.path + ' → ' + a.tool : a.path),
        h('span', { class: 'm-state ' + a.state }, label),
        h('span', { class: 'm-refs', title: a.refs.join(', ') || '—' }, a.refs.join(', ') || '—')));
    }
    if (!shown.length) table.appendChild(h('div', { class: 'pro-empty' }, '没有匹配的通道（过滤条件：' + (q || '无') + '）。'));
    matrixBody.appendChild(table);
    matrixCount.textContent = `显示 ${shown.length} / ${rows.length} 条桥接 API · 源码清单共 ${M.totals.channels} 个通道`;
    matrixMore.hidden = rows.length <= 40;
    matrixMore.textContent = showAll ? '收起（只显示前 40 条）' : `显示全部 ${rows.length} 条`;
  }
  matrixSearch.addEventListener('input', renderMatrix);
  matrixMore.addEventListener('click', () => { showAll = !showAll; renderMatrix(); });
  renderMatrix();
  const channelList = h('div', { class: 'pro-inline-list' },
    ...M.channels.map((c) => h('span', { class: 'pro-chip', title: c.kind }, c.name)));
  root.appendChild(section(9, '能力矩阵', 'Capability Matrix', '由源码生成 · 可复核',
    [h('div', { class: 'pro-card' },
      h('div', { class: 'pro-card-head' }, h('h4', null, '内核通道 ↔ 界面入口'), h('span', { class: 'c-tag' }, M.sourceHash)),
      h('p', { class: 'pro-note' }, M.coverageNote),
      h('p', { class: 'pro-note' }, '清单生成自 ', h('b', null, M.generatedBy), '：通道取自 desktop/main.js 的 ipcMain 注册，API 取自 desktop/preload.js，界面状态取自渲染层源码。'),
      h('div', { class: 'pro-matrix-tools' }, matrixSearch, matrixCount),
      matrixBody, matrixMore,
      h('p', { class: 'pro-note', style: { marginTop: '16px' } }, `主进程实际注册通道（${M.channels.length}）：`),
      channelList)]));

  // ═════════ 10 · 真实边界（一句话，不堆砌、不多解释） ═════════
  root.appendChild(h('div', { class: 'pro-boundary' },
    h('p', null, '本机确定性数值模拟，非量子计算、非类脑芯片，不构成意识；数据留在本机。')));

  // 初始真实读数
  loadKpis().catch((e) => console.error('[hub] 读数失败', e));

  return {
    unmount() { /* 无订阅 / 无定时器：切走时不留后台工作 */ },
  };
}
