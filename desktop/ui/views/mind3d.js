// 企业模式 · OMNI-BRAIN 类脑计算仪表盘（v6.8.0）
// ---------------------------------------------------------------------------
// 这是「3D 类脑模型显示」的全面迭代：沿用 3D 脑（深空脑舞台），但把驱动它的
// 「虚拟量子采样」替换为**真实的类脑计算引擎**（SNN 脉冲神经网络 + Hopfield
// 吸引子联想记忆 + HTM 序列记忆 + 预测编码）。界面四个页签：
//
//   · 智慧脑  —— 3D 脑，由真实 SNN 脉冲沿真实连接组点亮；右侧类脑引擎面板展示
//               四类算法的实时指标与诚实边界；八阶段法律推理、自主思考照旧。
//   · 神经网络 —— 30 个脑区作为脉冲神经元，实时栅格（spike raster）与神经元阵列，
//               展示真实放电活动，而非装饰动画。
//   · 分析    —— 生命体征（引擎真实状态）、神经突触池（真源统计）、类脑芯片阵列
//               （30 脑区激活热图）、认知基因组（概念构成甜甜圈）。
//   · 存档    —— 思维事件 / 开放假设 / 经验卡台账（来自自主认知循环，真实落盘）。
//
// 诚实边界：类脑引擎是本机 CPU 上对真实神经形态算法的经典数值模拟，非物理芯片、
// 非量子、无意识；它只做联想补全 / 序列预测 / 脉冲传播，不改变八阶段法律推理结论。
import { h } from '../ui-kit.js';
import { createBrain3D } from '../brain3d.js';
// v6.27.0：神经元调色板与画布语义色统一从共享真源取；本文件内曾把同一份数组
// 抄成 NEURO_PALETTE 与 NET_ROW_COLORS 两份，现合并为一份。
import { NEURO_PALETTE, CANVAS_HEX, SEM } from '../semantic-palette.js';

export function mountMind3d({ host, api, toast, status: setStatus, route }) {
  host.innerHTML = '';
  const page = h('div', { class: 'page omni-page' });
  host.appendChild(page);

  // ---------------- 顶部品牌 + 页签 ----------------
  const topbar = h('div', { class: 'omni-topbar' },
    h('div', { class: 'omni-brand' },
      h('span', { class: 'omni-logo' }, '◈'),
      h('div', null,
        h('b', null, '智慧脑'),
        h('span', { class: 'omni-sub' }, '脑区可视化'),
      )),
    h('div', { class: 'omni-tabs' }),
    h('div', { class: 'omni-topright' },
      h('input', { class: 'omni-search', placeholder: '搜索节点…', 'aria-label': '搜索节点' }),
      h('button', { class: 'btn ghost sm', onclick: () => resetAll() }, '重置思考'),
    ),
  );
  page.appendChild(topbar);

  // ---------------- 页签内容容器 ----------------
  const tabs = [
    { key: 'brain', label: '智慧脑' },
    { key: 'net', label: '神经网络' },
    { key: 'analysis', label: '分析' },
    { key: 'archive', label: '存档' },
  ];
  const panels = {};
  const tabBar = topbar.querySelector('.omni-tabs');
  let activeTab = 'brain';
  for (const t of tabs) {
    const btn = h('button', { class: 'omni-tab' + (t.key === activeTab ? ' is-on' : '') }, t.label);
    btn.addEventListener('click', () => switchTab(t.key));
    tabBar.appendChild(btn);
    panels[t.key] = h('div', { class: 'omni-panel' + (t.key === activeTab ? ' is-on' : '') });
    page.appendChild(panels[t.key]);
  }
  function switchTab(key) {
    activeTab = key;
    tabBar.querySelectorAll('.omni-tab').forEach((b, i) => b.classList.toggle('is-on', tabs[i].key === key));
    for (const t of tabs) panels[t.key].classList.toggle('is-on', t.key === key);
    // 切换时按最新数据刷新对应视图
    if (key === 'net' && lastNeuro) updateNetView(lastNeuro);
    if (key === 'analysis') updateAnalysis(lastNeuro?.status);
    if (key === 'archive') api.mind.ledger?.().then((ld) => { if (ld?.data) renderArchive(ld.data); }).catch(() => {});
  }

  // =====================================================================
  // 智慧脑 面板
  // =====================================================================
  const brainPanel = panels.brain;
  brainPanel.appendChild(h('div', { class: 'page-head' },
    h('h2', null, '智慧脑 · 脑区可视化'),
    h('p', null, '脑区与连接取自运行时连接组，激活沿脉冲网络扩散。'),
  ));
  const boundary = h('div', { class: 'mind3d-boundary' });
  brainPanel.appendChild(boundary);
  const controls = h('div', { class: 'mind3d-controls' });
  brainPanel.appendChild(controls);
  const statGrid = h('div', { class: 'mind3d-stats' });
  brainPanel.appendChild(statGrid);

  // 类脑引擎面板（替换原量子层）：展示真实 SNN/吸引子/序列/预测编码指标
  const neuroLayer = h('div', { class: 'q-layer neuro-layer' });
  brainPanel.appendChild(neuroLayer);

  const main = h('div', { class: 'mind3d-main' });
  const stage = h('div', { class: 'mind3d-stage' });
  const side = h('div', { class: 'mind3d-side' });
  main.appendChild(stage); main.appendChild(side);
  brainPanel.appendChild(main);

  const askBox = h('div', { class: 'mind3d-ask' });
  brainPanel.appendChild(askBox);

  let brain = null, offTick = null, offNeuro = null, destroyed = false;
  let anatomyData = null, lastRegion = null;
  const el = {};
  function cell(label, value, sub) {
    return h('div', { class: 'mind3d-stat' },
      h('b', null, String(value)), h('span', null, label), sub ? h('em', null, sub) : null);
  }

  // ---------------- 类脑引擎面板渲染 ----------------
  const btnNeuroStep = h('button', { class: 'btn' }, 'SNN 脉冲演化');
  const btnRecall = h('button', { class: 'btn ghost' }, '吸引子联想补全');
  const btnPredict = h('button', { class: 'btn ghost' }, '序列/预测下一步');
  btnNeuroStep.addEventListener('click', async () => {
    setStatus('类脑引擎：SNN 脉冲演化中…');
    try { const r = await api.mind.neuroStep?.({ label: '手动演化' }); if (r) renderNeuro(r); toast('SNN 沿真实连接组完成一次脉冲演化', 'ok'); }
    catch (e) { toast('演化失败：' + String(e?.message || e), 'err'); } finally { setStatus('就绪'); }
  });
  btnRecall.addEventListener('click', async () => {
    // 用当前最活跃概念作为线索，做残缺→补全（也可扩展为用户输入线索）
    const cue = currentTopRegions(4);
    setStatus('类脑引擎：吸引子联想补全中…');
    try { const r = await api.mind.neuroRecall?.({ cue }); if (r) { renderNeuro(r); toast(`联想补全 → 【${r.recall?.label}】· overlap ${r.recall?.overlap}`, 'ok', 4200); } }
    catch (e) { toast('联想失败：' + String(e?.message || e), 'err'); } finally { setStatus('就绪'); }
  });
  btnPredict.addEventListener('click', async () => {
    setStatus('类脑引擎：预测下一步中…');
    try { const r = await api.mind.neuroPredict?.({}); if (r) { renderNeuro({ predict: r.predict, status: r.status }); toast(`预测来源：${r.predict?.source}（置信 ${r.predict?.confidence ?? 0}）`, 'ok', 4200); updateAnalysis(r.status); } }
    catch (e) { toast('预测失败：' + String(e?.message || e), 'err'); } finally { setStatus('就绪'); }
  });

  function neuroMetric(label, value, sub) {
    return h('div', { class: 'q-metric' }, h('b', null, String(value)), h('span', null, label), sub ? h('em', null, sub) : null);
  }
  function drawNeuroLayer(st, recall, predict, payload) {
    neuroLayer.innerHTML = '';
    neuroLayer.appendChild(h('div', { class: 'q-head' },
      h('div', { class: 'q-title' },
        h('b', null, '认知算法'),
        h('span', null, 'SNN 脉冲 · Hopfield 吸引子 · HTM 序列记忆 · 预测编码')),
    ));
    neuroLayer.appendChild(h('p', { class: 'q-boundary' }, (st && st.boundary) || ''));
    neuroLayer.appendChild(h('div', { class: 'q-controls' }, btnNeuroStep, btnRecall, btnPredict));
    const metrics = [];
    if (st) {
      metrics.push(neuroMetric('神经元', st.neurons, 'Izhikevich RS'));
      metrics.push(neuroMetric('突触', st.synapses, `兴奋 ${st.excitatory}/${st.inhibitory} 抑制`));
      metrics.push(neuroMetric('存储模式', st.patterns, '吸引子记忆'));
      metrics.push(neuroMetric('序列命中率', st.sequenceAccuracy ?? 0, `${st.sequenceHits}/${st.sequenceTotal}`));
      metrics.push(neuroMetric('预测自由能', st.predictorFreeEnergy ?? 0, '预测编码'));
      metrics.push(neuroMetric('点亮脑区', st.firedRegions ?? 0, '本次 SNN'));
    }
    neuroLayer.appendChild(h('div', { class: 'q-metrics' }, ...metrics));
    if (recall) {
      neuroLayer.appendChild(h('div', { class: 'q-collapse' },
        h('i', { style: { background: SEM.neuro1 } }),
        h('span', null, `吸引子联想补全 → `),
        h('b', null, recall.label || '未知'),
        h('span', null, ` · overlap ${recall.overlap} · 收敛 ${recall.converged ? '是' : '否'} · ${recall.iterations} 步`),
      ));
    }
    if (predict) {
      neuroLayer.appendChild(h('div', { class: 'q-collapse' },
        h('i', { style: { background: SEM.neuro3 } }),
        h('span', null, `下一步预测（${predict.source}）· 置信 ${predict.confidence ?? 0} · 自由能 ${predict.freeEnergy ?? 0}`),
      ));
    }
  }
  let lastNeuro = null;
  function renderNeuro(payload) {
    if (!payload) return;
    lastNeuro = payload;
    if (payload.status) drawNeuroLayer(payload.status, payload.recall, payload.predict, payload);
    if (payload.levels || payload.pulses) play({ levels: payload.levels || {}, pulses: payload.pulses || [] });
    updateNetView(payload);
    updateAnalysis(payload.status);
  }

  // ---------------- 3D 脑点亮 ----------------
  function play(payload) {
    if (!brain || !payload) return;
    const r = brain.playPulses(payload.pulses || [], payload.levels || {});
    if (r && payload.pulses?.length) {
      el.pulseNote && (el.pulseNote.textContent = `本次播放 ${r.played}/${r.total} 个脉冲 · 时序跨度 ${r.spanMs} ms（按真实传导潜伏期）`);
    }
  }
  function currentTopRegions(k) {
    if (!lastNeuro?.levels) return {};
    const entries = Object.entries(lastNeuro.levels).sort((a, b) => b[1] - a[1]).slice(0, k);
    const cue = {}; for (const [key, v] of entries) cue[key] = v; return cue;
  }

  // ---------------- 侧栏 ----------------
  el.regionCard = h('div', { class: 'mind3d-card' },
    h('h3', null, '脑区解剖信息'),
    h('p', { class: 'mind3d-hint' }, '点击 3D 脑中的任一台球，查看它对应的真实 Brodmann 分区依据与当前激活值。'));
  el.thoughtList = h('div', { class: 'mind3d-list' });
  el.hypList = h('div', { class: 'mind3d-list' });
  el.legend = h('div', { class: 'mind3d-legend' });
  el.answer = h('div', { class: 'mind3d-answer' });
  side.appendChild(el.regionCard);
  side.appendChild(h('div', { class: 'mind3d-card' }, h('h3', null, '脑叶图例'), el.legend));
  side.appendChild(h('div', { class: 'mind3d-card' }, h('h3', null, '最近思维事件（自主循环）'), el.thoughtList));
  side.appendChild(h('div', { class: 'mind3d-card' }, h('h3', null, '开放假设台账'), el.hypList));

  // ---------------- 控制条 ----------------
  const btnAuto = h('button', { class: 'btn' }, '开启自主思考');
  const btnTick = h('button', { class: 'btn ghost' }, '手动思考一次');
const btnRotate = h('button', { class: 'btn ghost' }, '暂停自转');
  const btnReset = h('button', { class: 'btn ghost' }, '重置视角');
  btnAuto.addEventListener('click', async () => {
    const on = btnAuto.dataset.on !== '1';
    const r = await api.mind.autonomous(on);
    if (!r?.ok) { toast(r?.error || '切换失败', 'err'); return; }
    btnAuto.dataset.on = on ? '1' : '0';
    btnAuto.textContent = on ? '关闭自主思考' : '开启自主思考';
    btnAuto.classList.toggle('is-on', on);
    toast(on ? '自主认知循环已开启：每 20 秒自发联想一次' : '自主认知循环已关闭', on ? 'ok' : '', 4200);
    await refresh();
  });
  btnTick.addEventListener('click', async () => {
    setStatus('正在进行一次自发联想…');
    const r = await api.mind.tick();
    setStatus('就绪');
    if (!r?.ok) { toast(r?.error || '思考失败', 'err'); return; }
    if (r.data?.neuro) renderNeuro(r.data.neuro);
    if (r.data?.pulses?.length) play({ pulses: r.data.pulses, levels: r.data.levels });
    toast(`已产生 1 条可回放思维事件 · ${r.data?.pulses?.length || 0} 个脉冲`, 'ok');
    await refresh();
  });
  let rotating = true;
  btnRotate.addEventListener('click', () => { rotating = !rotating; brain?.setAutoRotate(rotating); btnRotate.textContent = rotating ? '暂停自转' : '恢复自转'; });
  btnReset.addEventListener('click', () => brain?.resetView());
  controls.append(btnAuto, btnTick, btnRotate, btnReset);

  // ---------------- 带问题思考（八阶段） ----------------
  const qInput = h('textarea', { class: 'ask-input', rows: 2, placeholder: '带着一个法律问题思考一次，例如：违约金过高能否请求酌减？', 'aria-label': '向智脑提问' });
  const btnAsk = h('button', { class: 'btn ask-go' }, '带着问题思考');
  const askRow = h('div', { class: 'ask-box' }, qInput, btnAsk);
  askBox.appendChild(h('div', { class: 'mind3d-card' },
    h('h3', null, '结合知识库思考（走完整八阶段认知链）'),
    h('p', { class: 'mind3d-hint' }, '提问会真实调用 kb_legal_mind：召回 → 证据分级 → 争点与举证 → 双轨 → 对抗 → 假设 → 五脑议会 → 沉淀；其脑区激活会真实驱动类脑引擎与 3D 脑。'),
    askRow, el.answer));
  btnAsk.addEventListener('click', async () => {
    const q = qInput.value.trim();
    if (!q) { toast('请先输入问题', 'err'); return; }
    btnAsk.disabled = true; setStatus('认知链运行中…');
    try {
      const r = await api.mind.legalAsk({ question: q, top_k: 6 });
      if (!r?.ok) { toast(r?.error || '思考失败', 'err'); return; }
      const d = r.data || {};
      if (d.brainLevels) play({ levels: d.brainLevels, pulses: d.pulses || [] });
      renderAnswer(d);
      toast(`八阶段完成 · 建议行动【${d.council?.action?.name}】`, 'ok', 4200);
      await refresh();
    } catch (e) { toast('思考失败：' + String(e?.message || e), 'err'); }
    finally { btnAsk.disabled = false; setStatus('就绪'); }
  });
  function renderAnswer(d) {
    el.answer.innerHTML = '';
    if (!d || !d.council) return;
    const rows = [
      ['议会裁决', `${d.council.verdict} · 共识 ${d.council.consensus}`],
      ['建议行动', d.council.action?.name || '—'],
      ['综合置信度', `${d.confidence?.value ?? '—'}（${d.confidence?.band?.label || '—'}）`],
      ['争点 / 举证未到位', `${d.issues?.length || 0} / ${(d.onus || []).filter((o) => !o.sufficient).length}`],
      ['引用卡片 / 轴突脉冲', `${d.cited_nodes?.length || 0} / ${d.pulses?.length || 0}`],
    ];
    const grid = h('div', { class: 'mind3d-kv' });
    for (const [k, v] of rows) grid.appendChild(h('div', { class: 'mind3d-kv-row' }, h('span', null, k), h('b', null, String(v))));
    el.answer.appendChild(grid);
    el.answer.appendChild(h('button', { class: 'btn ghost', onclick: () => route('ask') }, '前往「问一问」查看完整推理链与引用溯源 ↗'));
  }

  // ---------------- 状态刷新 ----------------
  async function refresh() {
    if (destroyed) return;
    const [s, l, ns] = await Promise.all([
      api.mind.status(), api.mind.ledger(), api.mind.neuroStatus ? api.mind.neuroStatus() : Promise.resolve(null),
    ]);
    if (destroyed) return;
    if (ns?.ok) { lastNeuro = lastNeuro || {}; lastNeuro.status = ns.data; drawNeuroLayer(ns.data, lastNeuro.recall, lastNeuro.predict, lastNeuro); updateAnalysis(ns.data); }
    const st = s?.data;
    if (st) {
      statGrid.innerHTML = '';
      const w = st.gradeTable || {};
      statGrid.append(
        cell('心跳', st.heartbeats, '自主循环 tick'),
        cell('思维事件', st.thoughtCount, '可回放'),
        cell('经验卡', st.experienceCount, '只追加'),
        cell('开放假设', st.openHypotheses, '可证伪'),
        cell('反馈校准', st.feedback?.total || 0, `+${st.feedback?.positive || 0} / −${st.feedback?.negative || 0}`),
        cell('A 级权重', w.A ?? '—', `B ${w.B ?? '—'} · C ${w.C ?? '—'} · D ${w.D ?? '—'}`),
      );
      btnAuto.dataset.on = st.autonomous ? '1' : '0';
      btnAuto.textContent = st.autonomous ? '关闭自主思考' : '开启自主思考';
      btnAuto.classList.toggle('is-on', !!st.autonomous);
    }
    const led = l?.data;
    if (led) {
      el.thoughtList.innerHTML = '';
      if (!led.thoughts?.length) el.thoughtList.appendChild(h('div', { class: 'empty-hint' }, '尚无思维事件。开启自主思考或点「手动思考一次」。'));
      for (const t of (led.thoughts || []).slice(0, 8)) el.thoughtList.appendChild(h('div', { class: 'mind3d-event' }, h('b', null, `#${t.tick} · ${t.seedRegion}`), h('span', null, `${(t.regions || []).slice(0, 4).join(' → ')} · ${t.pulseCount} 脉冲`)));
      el.hypList.innerHTML = '';
      if (!led.hypotheses?.length) el.hypList.appendChild(h('div', { class: 'empty-hint' }, '尚无开放假设。'));
      for (const x of (led.hypotheses || []).slice(0, 6)) el.hypList.appendChild(h('div', { class: 'mind3d-event' }, h('b', null, `${x.id} · ${x.status}`), h('span', null, String(x.text || '').slice(0, 90))));
    }
  }

  // =====================================================================
  // 神经网络 面板（SNN 脉冲栅格 + 神经元阵列）
  // =====================================================================
  const netPanel = panels.net;
  netPanel.appendChild(h('div', { class: 'page-head' },
    h('h2', null, '神经网络 · 脉冲活动'),
    h('p', null, '每个真实解剖脑区对应一台 Izhikevich 脉冲神经元（数量由连接组数据给出）；左图为按真实连接组的放电栅格（横轴=时间，每行为一个脑区），右图为神经元阵列热度。'),
  ));
  const netControls = h('div', { class: 'mind3d-controls' },
    h('button', { class: 'btn', onclick: async () => {
      // v6.20：旧写法只发 IPC、不渲染结果也不提示，点了像死按钮。
      try {
        const r = await api.mind.neuroStep?.({ label: '网络视图' });
        if (r) { renderNeuro(r); toast('SNN 沿真实连接组完成一次脉冲演化', 'ok'); }
        else toast('内核未返回本次脉冲演化结果', 'err');
      } catch (e) { toast('脉冲演化失败：' + String(e?.message || e), 'err'); }
    } }, '跑一次脉冲演化'),
  );
  netPanel.appendChild(netControls);
  const netWrap = h('div', { class: 'net-wrap' });
  const rasterWrap = h('div', { class: 'net-raster' });
  const rasterCanvas = h('canvas', { class: 'net-canvas', width: 760, height: 360 });
  rasterWrap.appendChild(h('div', { class: 'net-cap' }, '脉冲栅格 Spike Raster · 真实放电'));
  rasterWrap.appendChild(rasterCanvas);
  const gridWrap = h('div', { class: 'net-grid' });
  gridWrap.appendChild(h('div', { class: 'net-cap' }, '神经元阵列 · 当前激活热度'));
  const netTiles = h('div', { class: 'net-tiles' });
  gridWrap.appendChild(netTiles);
  netWrap.append(rasterWrap, gridWrap);
  netPanel.appendChild(netWrap);
  let netRegionMeta = {};
  function buildNetTiles() {
    netTiles.innerHTML = '';
    for (const r of (anatomyData?.anatomy?.regions || [])) {
      const name = (netRegionMeta[r.key]?.name) || r.key;
      const tile = h('div', { class: 'net-tile', 'data-region': r.key },
        h('span', { class: 'net-tile-name' }, name), h('i', { class: 'net-tile-dot' }));
      netTiles.appendChild(tile);
    }
  }
  function updateNetView(payload) {
    // 仅当神经网络页签可见时绘制，省算力
    if (activeTab !== 'net') return;
    drawRaster(payload?.spikes);
    paintNetTiles(payload?.levels || {});
  }
  function paintNetTiles(lv) {
    netTiles.querySelectorAll('.net-tile').forEach((t) => {
      const k = t.getAttribute('data-region');
      const v = Number(lv[k] || 0);
      const dot = t.querySelector('.net-tile-dot');
      dot.style.background = v > 0.05 ? NEURO_PALETTE[Math.floor(v * (NEURO_PALETTE.length - 1))] : CANVAS_HEX.neuroOffA;
      dot.style.boxShadow = v > 0.05 ? `0 0 ${4 + v * 14}px ${dot.style.background}` : 'none';
      t.style.opacity = String(0.4 + v * 0.6);
    });
  }
  let rasterCtx = null;
  function drawRaster(spikes) {
    if (!rasterCtx) rasterCtx = rasterCanvas.getContext('2d');
    const ctx = rasterCtx; const W = rasterCanvas.width, H = rasterCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = CANVAS_HEX.darkBg; ctx.fillRect(0, 0, W, H);
    if (!Array.isArray(spikes) || !spikes.length) return;
    const n = spikes.length; const rowH = H / n;
    let maxT = 1;
    for (const sp of spikes) for (const t of sp) if (t > maxT) maxT = t;
    for (let i = 0; i < n; i++) {
      const sp = spikes[i] || []; const y = i * rowH + rowH / 2;
      ctx.strokeStyle = NEURO_PALETTE[i % NEURO_PALETTE.length]; ctx.lineWidth = 1.4;
      for (const t of sp) { const x = (t / maxT) * W; ctx.beginPath(); ctx.moveTo(x, y - rowH * 0.32); ctx.lineTo(x, y + rowH * 0.32); ctx.stroke(); }
    }
  }

  // =====================================================================
  // 分析 面板（生命体征 / 突触池 / 芯片阵列 / 认知基因组）
  // =====================================================================
  const analysisPanel = panels.analysis;
  analysisPanel.appendChild(h('div', { class: 'page-head' },
    h('h2', null, '分析 · 引擎真实状态'), h('p', null, '以下数字全部来自类脑引擎与自主认知循环的运行时真实计算，界面不做任何虚构填充。')));
  const vitalSigns = h('div', { class: 'omni-vitals' });
  const synapsePool = h('div', { class: 'omni-card' }, h('div', { class: 'omni-card-h' }, '神经突触池'), h('div', { class: 'omni-pool' }));
  const chipArray = h('div', { class: 'omni-card' }, h('div', { class: 'omni-card-h' }, '类脑芯片阵列 · 实时激活'), h('div', { class: 'omni-chips' }));
  const genome = h('div', { class: 'omni-card' }, h('div', { class: 'omni-card-h' }, '解剖构成 · 真实连接组'), h('div', { class: 'omni-genome' }));
  analysisPanel.append(vitalSigns, h('div', { class: 'omni-analysis-grid' }, synapsePool, chipArray, genome));
  function updateAnalysis(st) {
    if (!st || activeTab !== 'analysis') return;
    vitalSigns.innerHTML = '';
    const vs = [
      ['神经元', st.neurons], ['突触', st.synapses], ['存储模式', st.patterns],
      ['序列命中率', st.sequenceAccuracy ?? '—'], ['预测自由能', st.predictorFreeEnergy ?? '—'],
      ['点亮脑区', st.firedRegions ?? '—'], ['脉冲发放率', st.lastSpikeRate ?? '—'], ['髓鞘化', st.myelinated ?? '—'],
    ];
    for (const [k, v] of vs) vitalSigns.appendChild(h('div', { class: 'omni-vital' }, h('b', null, String(v)), h('span', null, k)));
    const pool = synapsePool.querySelector('.omni-pool'); pool.innerHTML = '';
    const pc = [['脑区', st.neurons ?? '—'], ['突触', st.synapses ?? '—'], ['兴奋', st.excitatory ?? '—'], ['抑制', st.inhibitory ?? '—'], ['髓鞘', st.myelinated ?? '—']];
    for (const [k, v] of pc) pool.appendChild(h('div', { class: 'omni-pool-item' }, h('b', null, String(v)), h('span', null, k)));
    const chips = chipArray.querySelector('.omni-chips');
    if (chips.childElementCount === 0 && anatomyData) {
      for (const r of (anatomyData.anatomy?.regions || [])) {
        const name = (netRegionMeta[r.key]?.name) || r.key;
        chips.appendChild(h('div', { class: 'omni-chip', 'data-region': r.key }, h('span', null, name), h('i')));
      }
    }
    const lv = lastNeuro?.levels || {};
    chips.querySelectorAll('.omni-chip').forEach((c) => {
      const k = c.getAttribute('data-region'); const v = Number(lv[k] || 0);
      const dot = c.querySelector('i'); dot.style.background = v > 0.05 ? NEURO_PALETTE[Math.floor(v * (NEURO_PALETTE.length - 1))] : CANVAS_HEX.neuroOffB; dot.style.boxShadow = v > 0.05 ? `0 0 ${3 + v * 10}px ${dot.style.background}` : 'none';
    });
  }
  function renderGenome() {
    const g = genome.querySelector('.omni-genome'); g.innerHTML = '';
    // v6.20：旧版用 7 个写死的法律标签画「等分甜甜圈」，却声称"全部来自真实计算"，
    // 是固定的假构成。改为只呈现解剖连接组返回的真实计数；取不到就如实留空。
    const regions = anatomyData?.anatomy?.regions || [];
    const synapses = anatomyData?.connectome?.synapses || [];
    const lobes = anatomyData?.anatomy?.lobes || [];
    if (!regions.length) {
      g.appendChild(h('div', { class: 'empty-hint' }, '尚未取到解剖连接组数据，暂无可显示的构成。'));
      return;
    }
    const rows = [['真实脑区', regions.length], ['长程轴突', synapses.length], ['解剖脑叶', lobes.length]];
    for (const [k, v] of rows) g.appendChild(h('div', { class: 'omni-genome-li' }, h('span', null, k), h('b', null, String(v))));
    for (const l of lobes) {
      const n = regions.filter((r) => r.lobe === l.key || r.lobeKey === l.key).length;
      g.appendChild(h('div', { class: 'omni-genome-li' },
        h('i', { style: { background: l.color || SEM.vault } }),
        h('span', null, String(l.key || '—')),
        h('b', null, n ? String(n) : '—')));
    }
  }

  // ---------------- 存档 面板 ----------------
  const archivePanel = panels.archive;
  archivePanel.appendChild(h('div', { class: 'page-head' }, h('h2', null, '存档 · 认知台账'), h('p', null, '思维事件、开放假设、经验卡的落盘记录。')));
  const archiveBox = h('div', { class: 'omni-archive' });
  archivePanel.appendChild(archiveBox);
  function renderArchive(led) {
    archiveBox.innerHTML = '';
    const sec = (title, items, fmt) => {
      const card = h('div', { class: 'mind3d-card' }, h('h3', null, title));
      if (!items?.length) card.appendChild(h('div', { class: 'empty-hint' }, '暂无记录。'));
      for (const it of (items || []).slice(0, 12)) card.appendChild(h('div', { class: 'mind3d-event' }, fmt(it)));
      archiveBox.appendChild(card);
    };
    sec('最近思维事件', led?.thoughts, (t) => [h('b', null, `#${t.tick} · ${t.seedRegion}`), h('span', null, `${(t.regions || []).slice(0, 4).join(' → ')} · ${t.pulseCount} 脉冲`)]);
    sec('开放假设台账', led?.hypotheses, (x) => [h('b', null, `${x.id} · ${x.status}`), h('span', null, String(x.text || '').slice(0, 90))]);
    sec('经验卡', led?.experiences, (e) => [h('b', null, e.question?.slice(0, 40) || e.id), h('span', null, `置信 ${e.confidence ?? '—'} · 引用 ${e.citedCount ?? 0}`)]);
  }

  // ---------------- 初始化 ----------------
  function resetAll() { brain?.resetView(); lastNeuro = null; toast('已重置思考视图', 'ok'); }
  (async () => {
    const r = await api.mind.anatomy();
    if (destroyed) return;
    if (!r?.ok) { stage.appendChild(h('div', { class: 'empty-hint' }, '解剖数据加载失败：' + String(r?.error || ''))); return; }
    anatomyData = r.data;
    netRegionMeta = anatomyData.anatomy?.regionMeta || {};
    boundary.innerHTML = '';
    boundary.appendChild(h('b', null, '边界说明'));
    boundary.appendChild(h('p', null, String(anatomyData.boundary || '')));
    boundary.appendChild(h('p', null, `脑区 ${anatomyData.anatomy?.regions?.length} / 轴突 ${anatomyData.connectome?.synapses?.length}；三维投影为示意比例。`));

    brain = createBrain3D({
      host: stage, anatomy: anatomyData.anatomy, connectome: anatomyData.connectome,
      onRegion: (info) => {
        lastRegion = info;
        el.regionCard.innerHTML = '';
        el.regionCard.append(
          h('h3', null, `${info.name} · ${info.key}`),
          h('p', null, `脑叶：${info.lobe} ｜ 半球：${info.hemi} ｜ 当前激活：${Number(info.level || 0).toFixed(3)}`),
          h('p', { class: 'mind3d-basis' }, info.basis),
        );
      },
    });
    if (brain.unavailable) { stage.appendChild(h('div', { class: 'empty-hint' }, 'WebGL 不可用：' + brain.error)); return; }
    el.pulseNote = h('div', { class: 'mind3d-pulse-note' }, '等待思维事件…');
    stage.appendChild(el.pulseNote);
    el.legend.innerHTML = '';
    for (const l of (anatomyData.anatomy.lobes || [])) el.legend.appendChild(h('div', { class: 'mind3d-lobe' }, h('i', { style: { background: l.color } }), h('b', null, l.key), h('span', null, l.note)));

    buildNetTiles();
    renderGenome();

    offTick = api.mind.onTick((payload) => { if (!payload) return; play(payload); refresh(); });
    if (api.mind.onNeuro) offNeuro = api.mind.onNeuro((p) => { if (!p || destroyed) return; renderNeuro(p); });
    await refresh();
    const ld = await api.mind.ledger().catch(() => null);
    if (ld?.data) renderArchive(ld.data);
  })();

  return {
    refresh,
    unmount() {
      destroyed = true;
      try { offTick?.(); } catch (e) { /* ignore */ }
      try { offNeuro?.(); } catch (e) { /* ignore */ }
      try { brain?.dispose(); } catch (e) { console.error(e); }
      brain = null;
    },
  };
}
