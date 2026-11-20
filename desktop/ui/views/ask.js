// 问一问 · 类脑法律思维 + 引用可溯源（v6.3.0）
// ---------------------------------------------------------------------------
// 两种模式共用同一个入口与同一套引用溯源卡：
//   · 快速问答：原有 kb_ask（片段拼接，轻量）
//   · 法律思维：kb_legal_mind（八阶段认知链，默认）
// 法律思维模式下界面上的每个数字都来自运行时真实返回值：逐站毫秒耗时、
// 五脑议会打分、证据分级、争点举证、对抗辩论、置信校准、元认知自检、
// 脑区激活与轴突脉冲。没有一处是占位或估算。
// 「活体智脑」仅为产品隐喻，能力边界在页面底部固定展示。
import { h, emptyState, copyToClipboard } from '../ui-kit.js';

// 能力边界是一份如实的声明，页面上展示与导出文件里附的必须是同一段文字。
const BOUNDARY_TEXT = '本地确定性推理，无模型 / 无网络 / 无外部调用；「活体智脑」仅为产品隐喻，不具备生命或意识。本工具输出不构成法律意见，仅供研究参考；结论须由具备执业资格的律师结合全案复核。';

export function mountAsk({ host, app, api, toast, status, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page ask-page' });
  host.appendChild(page);

  page.appendChild(h('div', { class: 'page-head' },
    h('h2', null, '问一问 · 类脑法律思维'),
    h('p', null, '基于知识库的八阶段推理，结论可溯源。'),
  ));

  // ---- 模式：v6.41.0 按用户要求移除「快速问答」tab，固定使用类脑法律思维 ----
  // 入口与后端能力未删：仅收敛本页 UI 为单一模式（mind），快速问答通道在其它入口仍可用。
  const tabs = h('div', { class: 'ask-tabs', role: 'tablist', 'aria-label': '问答模式' });
  const tabMind = h('button', { class: 'btn ghost is-active', 'data-mode': 'mind', role: 'tab', 'aria-selected': 'true' }, '类脑法律思维');
  tabs.appendChild(tabMind);
  const btn3d = h('button', { class: 'btn ghost ask-3d', title: '在企业 3D 智脑中查看本次激活' }, '3D 智脑 ↗');
  btn3d.addEventListener('click', () => route('mind3d'));
  btn3d.style.display = document.body.classList.contains('edition-enterprise') ? '' : 'none';
  tabs.appendChild(btn3d);
  page.appendChild(tabs);
  const mode = 'mind'; // 固定模式：移除快速问答后不再需要切换

  const box = h('div', { class: 'ask-box' });
  const input = h('textarea', { class: 'ask-input', rows: 2, placeholder: '向你的知识库提问，例如：违约金约定过高，能否请求法院酌减？', 'aria-label': '提问' });
  const btn = h('button', { class: 'btn ask-go' }, '问一问');
  box.appendChild(input); box.appendChild(btn);
  page.appendChild(box);

  const result = h('div', { class: 'ask-result', 'aria-live': 'polite' });
  page.appendChild(result);
  // v6.17：真实空状态（无提问时引导，不放置任何演示内容）
  result.appendChild(emptyState('ask', '还没有提问',
    '在上方输入问题，基于你的知识库进行可溯源的八阶段推理。每个结论都标注证据来源，点击即可跳回原文核对。'));

  // v6.41.0：按用户要求移除页面底部「能力边界」展示框。
  // 注意：导出文件仍附 BOUNDARY_TEXT（第 12 行常量 + 导出段），对外产物保留如实声明。

  // 本页真实作答计数：只在本页生命周期内累计，不冒充跨会话统计
  let asks = 0;
  let busy = false, last = null;
  async function run() {
    const q = input.value.trim();
    if (!q) { toast('请先输入问题', 'err'); return; }
    if (busy) return;
    busy = true; btn.disabled = true;
    status(mode === 'mind' ? '八阶段认知链运行中…' : '正在检索知识库…');
    result.innerHTML = '';
    try {
      const r = mode === 'mind'
        ? await api.mind.legalAsk({ question: q, top_k: 6 })
        : await api.ask({ question: q, mode: 'generate' });
      if (!r || !r.ok) { toast(r?.error || '问答失败', 'err'); return; }
      const d = r.data || {};
      if (mode === 'mind') { last = d; renderMind(d); }
      else renderResult(d);
      // v6.19.0：结果工具条只消费内核真实返回，读数与导出都零加工
      asks += 1;
      result.insertBefore(buildTools(d), result.firstChild);
    } catch (e) {
      toast('问答失败：' + String(e?.message || e), 'err');
    } finally {
      busy = false; btn.disabled = false; status('就绪');
    }
  }
  btn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  // ---------------------------------------------------------------- 法律思维渲染
  function sec(title, sub, ...children) {
    const s = h('div', { class: 'lm-sec' }, h('h3', null, title));
    if (sub) s.appendChild(h('p', { class: 'lm-sub' }, sub));
    for (const c of children) if (c) s.appendChild(c);
    return s;
  }
  function kv(k, v, cls) { return h('div', { class: 'lm-kv' + (cls ? ' ' + cls : '') }, h('span', null, k), h('b', null, String(v))); }
  function para(text, cls) { return h('p', { class: cls || 'lm-p' }, String(text || '')); }

  function renderMind(d) {
    result.innerHTML = '';
    const stages = d.stages || [];
    const c = d.council || {};

    // ① 思维窗：八阶段逐站真实耗时
    const flow = h('div', { class: 'lm-flow' });
    for (const s of stages) {
      flow.appendChild(h('div', { class: 'lm-stage' + (s.degraded ? ' is-degraded' : '') },
        h('div', { class: 'lm-stage-h' },
          h('b', null, s.name), h('span', null, `${s.organ} · ${s.ms} ms`),
          h('em', null, s.degraded ? '已降级' : '完成')),
        para(s.text, 'lm-stage-t'),
        h('div', { class: 'lm-regions' }, ...(s.regions || []).map((r) => h('i', null, r))),
      ));
    }
    result.appendChild(sec('思维窗 · 八阶段真实执行', `总耗时 ${d.trace?.totalMs ?? '—'} ms；每站耗时为该阶段真实计算用时，激活强度由该阶段涉及的知识节点数决定`, flow));

    // ② 五脑议会
    const council = h('div', { class: 'lm-council' });
    for (const b of (c.brains || [])) {
      const w = Math.round((b.hw || 0) * 100);
      council.appendChild(h('div', { class: 'lm-brain' },
        h('div', { class: 'lm-brain-h' }, h('b', null, `${b.name} · ${b.id}`), h('span', null, `${b.eye} · 分 ${b.score} · 权 ${b.hw}`)),
        h('div', { class: 'lm-bar' }, h('i', { style: { width: `${Math.max(2, Math.round((b.score || 0) * 100))}%` } })),
        para(`投【${(c.action && b.act === c.action.id) ? c.action.name : b.act}】 ${b.voice}`, 'lm-brain-v'),
      ));
    }
    const csec = sec('五脑议会 · 加权裁决',
      `裁决 ${c.verdict ?? '—'} ｜ 共识 ${c.consensus ?? '—'} ｜ 建议行动【${c.action?.name || '—'}】${c.action?.why ? '：' + c.action.why : ''}`, council);
    if (d.councilEvidence) {
      const e = d.councilEvidence;
      csec.appendChild(h('details', { class: 'lm-details' },
        h('summary', null, '展开：七维特征的计算依据（全部来自真实召回）'),
        para(`命中 ${e.hitCount} 张 ｜ 平均置信 ${e.avgConfidence} ｜ 平均激活路径 ${e.avgActivationPath} 跳 ｜ 术语重叠 ${e.termOverlap} ｜ 等级分布 ${JSON.stringify(e.gradeDistribution)}`, 'lm-small'),
        para(`风险词：${(e.riskWords || []).join('、') || '无'}；利害词：${(e.stakeWords || []).join('、') || '无'}；冲突对：${(e.conflictPairs || []).join('、') || '无'}`, 'lm-small'),
        para(e.basis, 'lm-small')));
    }
    result.appendChild(csec);

    // ③ 争点 / 举证责任 / 不利后果
    const issues = h('div', { class: 'lm-issues' });
    for (const iss of (d.issues || [])) {
      const b = (d.burdens || []).find((x) => x.issueId === iss.id);
      const o = (d.onus || []).find((x) => x.issueId === iss.id);
      issues.appendChild(h('div', { class: 'lm-issue' },
        h('b', null, `${iss.id} · ${iss.text}`),
        para(`关联 ${iss.supportCards} 张卡片${iss.basis?.length ? `（${iss.basis.slice(0, 3).join('、')}）` : ''}`, 'lm-small'),
        b ? para(`举证责任：${b.party} ｜ ${b.kind} ｜ 标准：${b.standard}`) : null,
        o ? para(o.text, o.sufficient ? 'lm-ok' : 'lm-warn') : null,
      ));
    }
    if (!(d.issues || []).length) issues.appendChild(h('div', { class: 'empty-hint' }, '知识库中未检出可用于归纳争点的卡片，本次不预设案由。'));
    result.appendChild(sec('争点归纳 · 举证责任 · 不利后果', '按规范说分配：要件归主张方、抗辩归抗辩方；证据不足即如实标注不利后果归属', issues));

    // ④ 双轨推理
    const tr = d.tracks || {};
    const dual = h('div', { class: 'lm-dual' },
      h('div', { class: 'lm-track' }, h('b', null, `规范轨 · ${tr.norm?.length || 0} 条`),
        ...(tr.norm || []).slice(0, 4).map((r) => para(`［${r.cardTitle}］${r.text}`, 'lm-small'))),
      h('div', { class: 'lm-track' }, h('b', null, `实务轨 · ${tr.practice?.length || 0} 条`),
        ...(tr.practice || []).slice(0, 4).map((r) => para(`［${r.cardTitle}］${r.text}`, 'lm-small'))));
    for (const x of (tr.conflicts || [])) dual.appendChild(para(`⚠ 冲突 ${x.pair}：${x.note}`, 'lm-warn'));
    result.appendChild(sec('双轨推理 · 规范 ‖ 实务', tr.note, dual));

    // ⑤ 对抗辩论（残余风险醒目）
    const db = d.debate || {};
    result.appendChild(sec(`反向论证 · 质量分 ${db.score ?? '—'}`, '反方论证与残余风险',
      para('我方主张：' + (db.claim || ''), 'lm-p'),
      para('反方最强论证：' + (db.counter || ''), 'lm-warn'),
      para('我方反驳：' + (db.rebuttal || ''), 'lm-p'),
      para('残余风险（强制披露）：' + (db.residual || ''), 'lm-risk')));

    // ⑥ 假设台账 + 裁量口径
    const ledger = h('div', { class: 'lm-list' });
    for (const x of (d.hypotheses || [])) ledger.appendChild(h('div', { class: 'lm-item' },
      h('b', null, `${x.id} · ${x.status}`), para(x.text, 'lm-small'), para(`依据：${(x.basis || []).join('、') || '无'} ｜ 验证：${x.verify}`, 'lm-small')));
    for (const x of (d.discretion || [])) ledger.appendChild(h('div', { class: 'lm-item' },
      h('b', null, `裁量口径 · ${x.key}`), para(x.rule, 'lm-small'), para(x.source, 'lm-small')));
    if (!(d.hypotheses || []).length && !(d.discretion || []).length) ledger.appendChild(h('div', { class: 'empty-hint' }, '本次无开放假设，也未命中内置裁量规则。'));
    result.appendChild(sec('假设台账 · 自由裁量口径', '假设须带依据与可验证路径；裁量口径来自推理框架规则表，须以你的知识库为准', ledger));

    // ⑦ 置信度 / 元认知 / 激活
    const met = d.metacog || {};
    const summary = h('div', { class: 'lm-kvs' },
      kv('综合置信度', `${d.confidence?.value ?? '—'}（${d.confidence?.band?.label || '—'}）`),
      kv('元认知自检', met.passed == null || met.total == null ? '—' : `${met.passed}/${met.total} 项通过`),
      kv('证据等级均值', d.confidence?.factors?.avgGradeWeight ?? '—'),
      kv('引用卡片 / 轴突脉冲', `${(d.cited_nodes || []).length} / ${(d.pulses || []).length}`),
      kv('脑区激活数', Object.keys(d.brainLevels || {}).length),
      kv('真源编译时间', String(d.source?.generatedAt || '').slice(0, 19).replace('T', ' ')));
    // v6.20：没有真实自检结果时不再无条件宣称「七项全部通过」。
    const metaNote = met.missing?.length
      ? `缺口：${met.missing.map((m) => m.q).join('；')}`
      : (met.passed == null || met.total == null
        ? '本次内核未返回元认知自检结果'
        : (met.passed === met.total ? `自检 ${met.passed}/${met.total} 项全部通过` : `自检 ${met.passed}/${met.total} 项通过，存在未通过项`));
    const msec = sec('置信校准 · 元认知自检', metaNote, summary);
    if (d.organism) msec.appendChild(para(`认知状态：心跳 ${d.organism.heartbeats} ｜ 思维事件 ${d.organism.thoughtCount} ｜ 经验卡 ${d.organism.experienceCount} ｜ 反馈校准 ${d.organism.feedback?.total || 0} 次${d.learning ? ` ｜ 本次学习 ${d.learning.grade} 级 ${d.learning.before} → ${d.learning.after}` : ''}`, 'lm-small'));
    result.appendChild(msec);

    // ⑧ 引用溯源卡（沿用原有交互）
    const cites = d.cited_nodes || [];
    if (cites.length) {
      const cs = h('div', { class: 'ask-cites' },
        h('div', { class: 'cites-head' }, `引用溯源 · ${cites.length} 个被引文件（点击「溯源验证 ↗」跳回知识库并高亮）`));
      for (const c of cites) cs.appendChild(citeCard(c));
      result.appendChild(cs);
    } else {
      result.appendChild(h('div', { class: 'empty-hint' }, '没有命中任何知识卡片；本次未生成实体结论，换个问法或先导入材料试试。'));
    }

    // ⑨ 反馈 / 沉淀 / 完整答案
    const actions = h('div', { class: 'lm-actions' });
    // v6.20：没有引用时不再用写死的 C 级去提交真实反馈权重调整 —— 那是假输入。
    const topGrade = cites[0]?.grade || null;
    const fbOk = h('button', { class: 'btn ghost' }, '这个结论靠谱');
    const fbNo = h('button', { class: 'btn ghost' }, '这个结论不靠谱');
    const fbNote = h('span', { class: 'lm-note' }, topGrade
      ? '反馈会真实调整该来源等级权重，下次作答立即生效'
      : '本次没有引用卡片，无法定位要校准的来源等级，反馈已停用');
    if (!topGrade) { fbOk.disabled = true; fbNo.disabled = true; fbOk.title = '无引用卡片，不可提交反馈'; fbNo.title = fbOk.title; }
    fbOk.addEventListener('click', () => { if (topGrade) doFeedback(topGrade, true, fbNote); });
    fbNo.addEventListener('click', () => { if (topGrade) doFeedback(topGrade, false, fbNote); });
    const sedBtn = h('button', { class: 'btn ghost' }, '把这次思考沉淀回知识库');
    sedBtn.addEventListener('click', async () => {
      sedBtn.disabled = true;
      const r = await api.mind.legalAsk({ question: d.question, sediment: true });
      sedBtn.disabled = false;
      if (!r?.ok) { toast(r?.error || '沉淀失败', 'err'); return; }
      const s = r.data?.sediment;
      if (s?.error) { toast('沉淀失败：' + s.error, 'err'); return; }
      toast(`已生成沉淀卡 ${s?.path}，回连 ${s?.built_edges} 张被引卡片（原卡正文未改动）`, 'ok', 5000);
      sedNote.textContent = `沉淀卡：${s?.path} ｜ 回连边 ${s?.built_edges} 条`;
    });
    const sedNote = h('span', { class: 'lm-note' }, '追加式写库，绝不覆盖你写的正文');
    actions.append(fbOk, fbNo, fbNote, sedBtn, sedNote);
    result.appendChild(sec('反馈校准 · 逆向沉淀', '反馈改权重；沉淀把完整推理链写成新卡片并自动回连被引原卡', actions));

    result.appendChild(h('details', { class: 'lm-details' },
      h('summary', null, '展开：完整答案文本（含能力边界与引用溯源清单，可供外部 Agent 直接消费）'),
      h('pre', { class: 'lm-answer' }, d.answer || '')));
  }

  async function doFeedback(grade, good, note) {
    const r = await api.mind.feedback({ grade, good });
    if (!r?.ok) { toast(r?.error || '反馈失败', 'err'); return; }
    const d = r.data || {};
    toast(`${d.grade} 级权重 ${d.before} → ${d.after}（${d.delta > 0 ? '+' : ''}${d.delta}）`, 'ok');
    note.textContent = `已校准：${d.grade} 级 ${d.before} → ${d.after}，累计反馈 ${d.feedback?.total || 0} 次`;
  }

  // ---------------------------------------------------------------- 快速问答（原有能力）
  function renderResult(data) {
    const ansBlock = h('div', { class: 'ask-answer' });
    ansBlock.textContent = stripVerifyBlock(data.answer || '') || '（无作答文本）';
    result.appendChild(ansBlock);
    const cites = data.cited_nodes || [];
    if (cites.length) {
      const s = h('div', { class: 'ask-cites' },
        h('div', { class: 'cites-head' }, `引用溯源 · ${cites.length} 个被引文件（点击「溯源验证 ↗」跳回知识库并高亮）`));
      for (const c of cites) s.appendChild(citeCard(c));
      result.appendChild(s);
    } else result.appendChild(h('div', { class: 'empty-hint' }, '没有命中任何知识卡片，换个问法试试。'));
  }

  function citeCard(c) {
    const card = h('div', { class: 'cite-card' });
    card.appendChild(h('div', { class: 'cite-title' }, c.title || c.id));
    const meta = [];
    if (c.confidence != null) meta.push(`置信度 ${Math.round((Number(c.confidence) || 0) * 100)}%`);
    if (c.grade) meta.push(`${c.grade} 级证据`);
    meta.push(`激活 ${c.activation ?? '—'}`);
    card.appendChild(h('div', { class: 'cite-meta' }, meta.join(' ｜ ')));
    if (c.gradeReason) card.appendChild(h('div', { class: 'cite-reason' }, c.gradeReason));
    if (c.snippet) card.appendChild(h('div', { class: 'cite-snip' }, c.snippet));
    const btnV = h('button', { class: 'btn ghost cite-verify' }, '溯源验证 ↗');
    btnV.addEventListener('click', async () => {
      const m = /neolink:\/\/verify\/([^/]+)\/([^?]+)/.exec(c.verify || '');
      const vaultId = m ? decodeURIComponent(m[1]) : '';
      status('正在溯源…');
      const r = await api.verify.node({ vaultId, nodeId: c.id, snippet: c.snippet || '' });
      if (!r?.ok || !r.cardId) { toast(r?.error || '未找到对应卡片', 'err'); return; }
      await app.openCard(r.cardId, { highlight: r.snippet || c.snippet });
      route('workspace');
      toast('已溯源并高亮被引用的具体内容', 'ok');
    });
    card.appendChild(btnV);
    return card;
  }

  function stripVerifyBlock(ans) {
    const i = String(ans || '').indexOf('## 引用溯源');
    return (i >= 0 ? String(ans).slice(0, i) : ans).trim();
  }

  // ───────────── v6.19.0 · 结果导出（只消费内核真实返回） ─────────────────
  function answerText(d) {
    return stripVerifyBlock(d?.answer || '') || '（无作答文本）';
  }
  function stamp() {
    const t = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
  }
  function downloadFile(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function toMarkdown(d) {
    const cites = d?.cited_nodes || [];
    const lines = [
      `# 问一问 · ${mode === 'mind' ? '类脑法律思维' : '快速问答'}`,
      '', `> 问题：${d?.question || input.value.trim()}`, '',
      '## 答案', '', answerText(d), '',
      `## 引用溯源（${cites.length}）`, '',
    ];
    if (cites.length) {
      for (const c of cites) {
        const bits = [c.title || c.id];
        if (c.grade) bits.push(`${c.grade} 级证据`);
        if (c.confidence != null) bits.push(`置信 ${Math.round((Number(c.confidence) || 0) * 100)}%`);
        lines.push(`- ${bits.join(' · ')}`);
        if (c.verify) lines.push(`  - 溯源：${c.verify}`);
      }
    } else lines.push('（本轮未命中知识卡片）');
    lines.push('', '## 能力边界', '', BOUNDARY_TEXT, '');
    if (d?.trace?.totalMs != null) lines.push(`> 本轮总耗时 ${d.trace.totalMs} ms（内核真实计时）`, '');
    return lines.join('\n');
  }
  /** 结果工具条：读数全部来自本轮 d 与页面真实计数，导出物是原始返回本身 */
  function buildTools(d) {
    const bar = h('div', { class: 'ask-tools', role: 'group', 'aria-label': '本轮结果操作' });
    const meta = [];
    if (d?.stages?.length) meta.push(`${d.stages.length} 阶段`);
    if (d?.cited_nodes?.length) meta.push(`${d.cited_nodes.length} 个引用`);
    if (d?.trace?.totalMs != null) meta.push(`${d.trace.totalMs} ms`);
    const label = `第 ${asks} 次作答 · ${mode === 'mind' ? '类脑法律思维' : '快速问答'}${meta.length ? ' · ' + meta.join(' · ') : ''}`;
    bar.appendChild(h('span', { class: 'ask-tools-n' }, label));

    const btnCopy = h('button', { class: 'btn ghost', title: '复制本轮真实答案文本' }, '复制答案');
    btnCopy.addEventListener('click', () => copyToClipboard(answerText(d), '答案已复制'));
    const btnJson = h('button', { class: 'btn ghost', title: '导出内核本轮完整原始返回（JSON）' }, '导出 JSON');
    btnJson.addEventListener('click', () => {
      downloadFile(`neokb-ask-${stamp()}.json`, JSON.stringify(d, null, 2), 'application/json;charset=utf-8');
      toast(`已导出第 ${asks} 次作答的原始返回`, 'ok');
    });
    const btnMd = h('button', { class: 'btn ghost', title: '导出答案与引用清单（Markdown）' }, '导出 Markdown');
    btnMd.addEventListener('click', () => {
      downloadFile(`neokb-ask-${stamp()}.md`, toMarkdown(d), 'text/markdown;charset=utf-8');
      toast(`已导出第 ${asks} 次作答的 Markdown`, 'ok');
    });
    bar.append(btnCopy, btnJson, btnMd);
    return bar;
  }

  return { refresh: () => {} };
}
