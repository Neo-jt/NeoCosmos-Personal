// 自主引擎 · 可观测面板（v6.11 / v6.16 去叙事化）
// ---------------------------------------------------------------------------
// 确定性行为内核的可观测面板：成熟度等级、内在驱动、可解释决策链、
// 自主目标、长期记忆、世代演化与回滚、完整审计轨迹。
// 所有数字来自主进程 ASTRA 内核的真实运行时状态；没有任何占位或估算。
// 如实标注：全部状态为本地确定性计算，不具备意识或生命。
import { h, modal } from '../ui-kit.js';
// v6.27.0：突触网强调色的兜底值取自共享调色板，避免与 mind3d 各自写死一份。
import { NEURO_PALETTE } from '../semantic-palette.js';

const DRIVES = [
  ['curiosity', '好奇'], ['affinity', '亲和'], ['vigor', '活力'], ['order', '秩序'],
];
const AXIS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const fmt = (iso) => {
  try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
const num = (v) => (Number(v) || 0).toLocaleString('zh-CN');

export function mountAstra({ host, api, toast }) {
  host.innerHTML = '';
  const A = api.astra;
  if (!A) {
    host.appendChild(h('div', { class: 'empty-hint' }, '行为内核不可用：请更新客户端外壳后重试。'));
    return {};
  }
  const page = h('div', { class: 'page astra-page' });
  host.appendChild(page);

  page.appendChild(h('div', { class: 'page-head' },
    h('h2', null, '自主引擎'),
    h('p', null, '本地行为引擎的可观测状态：驱动 / 目标 / 记忆 / 决策 / 世代。'),
  ));

  // ───────── 顶部：身份 / 成熟度阶梯 / 统计 ─────────
  // v6.20：取数前一律用「—」，不再用 L1 / 入门 / 成熟度 0% 冒充真实读数。
  const badgeLv = el('span', 'ash-sigil', '—');
  const badgeKey = el('div', 'ash-key', '读取中…');
  const badgeEn = el('div', 'ash-en', '—');
  const badgeDesc = el('div', 'ash-desc', '等待内核返回真实状态。');
  const identity = el('div', 'ash-identity');
  const txtWrap = el('div', 'ash-identity-txt');
  txtWrap.append(badgeKey, badgeEn);
  identity.append(badgeLv, txtWrap, badgeDesc);

  const ladder = el('div', 'ash-ladder');
  const rungs = [];
  for (let i = 1; i <= 7; i++) {
    const r = el('div', 'ash-rung');
    r.append(el('b', null, 'L' + i), el('span', null, '·'));
    r.title = '等级 ' + i;
    r.addEventListener('click', () => { const lv = last?.mind?.levels?.[i - 1]; if (lv) toast(`L${i} ${lv.key} · ${lv.en}｜${lv.desc}｜解锁：${lv.unlock}`, 'ok', 4200); });
    ladder.appendChild(r); rungs.push(r);
  }
  const levelTrack = el('div', 'ash-track');
  const levelFill = el('i'); levelTrack.appendChild(levelFill);
  const levelCaption = el('div', 'ash-caption', '成熟度 — · 距下一阶 —');

  const statEls = {};
  const stats = el('div', 'ash-stats');
  for (const [key, label] of [['heartbeats', '心跳'], ['generation', '世代'], ['memories', '记忆'], ['success', '目标成功率']]) {
    const c = el('div', 'ash-stat');
    const b = el('b', null, '—'); c.append(b, el('span', null, label));
    stats.appendChild(c); statEls[key] = b;
  }

  const hero = el('div', 'astra-hero');
  hero.append(identity, el('div', 'ash-ladder-wrap'), el('div', 'ash-stats-wrap'));
  hero.children[1].append(ladder, levelTrack, levelCaption);
  hero.children[2].append(stats);
  page.appendChild(hero);

  // ───────── 控制栏 ─────────
  const autoBtn = h('button', { class: 'astra-switch', role: 'switch', 'aria-checked': 'true', title: '自动心跳' });
  autoBtn.append(el('i'), el('span', null, '自主'));
  const ctBtn = h('button', { class: 'astra-switch is-off', role: 'switch', 'aria-checked': 'false', title: '漫游时鼠标穿过空白区域' });
  ctBtn.append(el('i'), el('span', null, '鼠标穿透'));

  const modeSeg = el('div', 'astra-seg');
  const modeBtns = [];
  for (const [m, label] of [['auto', '自主漫游'], ['follow', '跟随光标'], ['perch', '停留此处']]) {
    const b = el('button', null, label);
    b.dataset.mode = m;
    b.addEventListener('click', () => void call(() => A.mode(m), '漫游模式：' + label));
    modeSeg.appendChild(b); modeBtns.push(b);
  }
  const controls = el('div', 'astra-controls');
  controls.append(
    autoBtn, ctBtn, modeSeg,
    h('button', { class: 'btn ghost', onclick: () => void call(() => A.home(), '已让星灵回到身边') }, '回到身边'),
    h('button', { class: 'btn ghost', onclick: () => void call(() => A.tick({}), '完成一次自主心跳') }, '心跳一次'),
    h('button', { class: 'btn ghost astra-gold', onclick: () => void call(() => A.evolve(), '已触发一次自我迭代') }, '自主演化'),
    h('button', { class: 'btn ghost', onclick: () => void rollbackPrev() }, '回滚上一世'),
  );
  page.appendChild(controls);

  // ───────── 主体两栏 ─────────
  const card = (title, sub) => {
    const c = el('section', 'astra-card');
    const head = el('div', 'ac-head');
    head.append(el('h3', null, title));
    if (sub) head.append(el('span', null, sub));
    c.appendChild(head);
    const body = el('div', 'ac-body');
    c.appendChild(body);
    return { c, body };
  };

  // 驱动雷达
  const radar = svg('svg', { viewBox: '0 0 200 200', class: 'astra-radar', 'aria-label': '内在驱动雷达' });
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const pts = AXIS.map(([dx, dy]) => `${100 + dx * 70 * f},${100 + dy * 70 * f}`).join(' ');
    radar.appendChild(svg('polygon', { points: pts, fill: 'none', stroke: 'var(--ds-line-2)', 'stroke-width': '1' }));
  }
  AXIS.forEach(([dx, dy], i) => {
    radar.appendChild(svg('line', { x1: 100, y1: 100, x2: 100 + dx * 70, y2: 100 + dy * 70, stroke: 'var(--ds-line-2)', 'stroke-width': '1' }));
    const t = svg('text', { x: 100 + dx * 86, y: 100 + dy * 86 + 4, 'text-anchor': 'middle', class: 'ar-label' });
    t.textContent = DRIVES[i][1]; radar.appendChild(t);
  });
  const radarPoly = svg('polygon', { class: 'ar-poly' });
  const radarDots = AXIS.map(() => svg('circle', { r: 3.2, class: 'ar-dot' }));
  radar.appendChild(radarPoly);
  radarDots.forEach((d) => radar.appendChild(d));
  const driveRows = el('div', 'astra-drive-rows');
  const driveBars = {};
  for (const [k, label] of DRIVES) {
    const row = el('div', 'adr-row');
    const bar = el('div', 'adr-bar'); const fill = el('i'); bar.appendChild(fill);
    const val = el('b', null, '—');
    row.append(el('span', null, label), bar, val);
    driveRows.appendChild(row); driveBars[k] = { fill, val };
  }
  const moodLine = el('div', 'astra-mood-line', '情绪 —');

  const cDrive = card('内在驱动', 'DRIVES');
  cDrive.body.append(radar, driveRows, moodLine);

  const cDecision = card('此刻的决策', 'EXPLAINABLE');
  const decisionBox = el('div', 'astra-decision');
  cDecision.body.appendChild(decisionBox);

  const cGoals = card('自主目标', 'GOALS');
  const goalsBox = el('div', 'astra-goals');
  cGoals.body.appendChild(goalsBox);

  const cMemory = card('长期记忆', 'MEMORY');
  const memoryBox = el('div', 'astra-memory');
  cMemory.body.appendChild(memoryBox);

  const cLineage = card('世代演化', 'LINEAGE / 可回滚');
  const lineageBox = el('div', 'astra-lineage');
  cLineage.body.appendChild(lineageBox);

  const cAudit = card('决策审计', 'AUDIT TRAIL');
  const auditBox = el('div', 'astra-audit');
  cAudit.body.appendChild(auditBox);

  // ───────── v6.15：深度推理 · 自我迭代（数值全部来自 deep-math.cjs 的真实计算） ─────────
  const cDeep = card('数值实验 · 策略迭代', 'NUMERICS / ITERATION');
  const deepStat = el('div', 'astra-libstat', '读取中…');
  const deepBars = el('div', 'ad-drives');
  const deepActions = el('div', 'am-actions');
  const deepStepBtn = el('button', 'am-btn gold', '单步自我迭代');
  const deepCheckBtn = el('button', 'am-btn', '算法自检');
  const deepLogBtn = el('button', 'am-btn', '最近迭代');
  deepActions.append(deepStepBtn, deepCheckBtn, deepLogBtn);
  const deepOut = el('pre', 'astra-audit');
  deepOut.style.cssText = 'white-space:pre-wrap;font-size:10.5px;line-height:1.65;max-height:210px;overflow:auto;margin:10px 0 0;padding:10px;border-radius:8px;background:var(--ds-surface-2,transparent)';
  const deepNote = el('div', 'astra-worldnote',
    '本地经典数值模拟，非真实量子计算，不具备意识。');
  cDeep.body.append(deepStat, deepBars, deepActions, deepOut, deepNote);
  const showDeep = (v) => { deepOut.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); };
  deepStepBtn.addEventListener('click', async () => {
    const r = await A.selfIterate();
    showDeep(r?.ok ? r.data.record : ('迭代失败：' + (r?.error || '未知错误')));
    try { const st = await A.status(); if (st?.ok) update(st.data); } catch { /* ignore */ }
  });
  deepCheckBtn.addEventListener('click', async () => {
    const r = await A.deepMath();
    if (r?.ok) {
      const c = r.data.checks || {};
      showDeep(`算法自检 ${r.data.passed}/${r.data.total} 项通过\n`
        + Object.entries(c).map(([k, v]) => `${v.ok ? '✓' : '✗'} ${k} = ${v.value}  (${v.note})`).join('\n')
        + '\n\n边界：' + r.data.boundary);
    } else showDeep('自检失败：' + (r?.error || '未知错误'));
  });
  deepLogBtn.addEventListener('click', async () => {
    const r = await A.deepStatus();
    showDeep(r?.ok ? (r.data.log || []).map((x) =>
      `#${x.generation} 观测 ${x.observation} / 预测 ${x.prediction} / 误差 ${x.error} / F ${x.freeEnergy} / H ${x.entropyNormalized} / ${x.decision}`).join('\n') || '尚无迭代记录'
      : ('读取失败：' + (r?.error || '未知错误')));
  });

  // v6.12：思维沉淀库（安装目录下自动建立 / 可自主更换）+ 神经突触知识网可视化
  const cLibrary = card('思维沉淀库', 'THOUGHT LIBRARY');
  const libStat = el('div', 'astra-libstat', '加载中…');
  const libRoot = el('div', 'astra-libroot', '');
  const libActions = el('div', 'am-actions');
  const openBtn = el('button', 'am-btn', '打开文件夹');
  const moveBtn = el('button', 'am-btn gold', '更换位置…');
  const queryInput = el('input', 'astra-libq'); queryInput.placeholder = '在沉淀库中检索…';
  const queryOut = el('div', 'astra-libqout');
  libActions.append(openBtn, moveBtn);
  const synapseCanvas = el('canvas', 'astra-synapse');
  synapseCanvas.width = 320; synapseCanvas.height = 200;
  cLibrary.body.append(
    libStat, libRoot, libActions,
    h('div', { class: 'am-sec' },
      h('div', { class: 'am-h', style: { margin: '2px 0 8px' } }, '神经突触知识网'),
      synapseCanvas,
      h('div', { class: 'am-h', style: { margin: '10px 0 6px' } }, '关联检索'),
      h('div', { class: 'astra-libqrow' }, queryInput),
      queryOut,
    ),
  );
  openBtn.addEventListener('click', () => void call(() => A.library.open(), '已打开思维沉淀库目录'));
  moveBtn.addEventListener('click', async () => {
    // v6.20：旧写法调用了一个未在桥接层注册的文件选择方法，静默失败后
    // 降级到 Electron 不支持的原生输入框，等于「更换位置」没有可用入口。
    // 改为项目统一的 modal 输入真实目录路径。
    const vals = await modal({
      title: '更换思维沉淀库位置',
      message: '填写目标目录（该目录下会自动建立 astra-memory）。目录必须已存在；迁移不会删除原目录内容。',
      fields: [{ key: 'dir', label: '目标目录', type: 'text', required: true, value: libRoot.dataset.root || '' }],
      confirmText: '迁移',
    });
    const dir = String(vals?.dir || '').trim();
    if (!dir) return;
    const r = await call(() => A.library.relocate(dir, { keepOld: false }), '思维沉淀库已迁移至 ' + dir);
    if (r && r.ok) loadLibrary();
  });
  queryInput.addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter') return;
    const txt = queryInput.value.trim();
    if (!txt) return;
    const r = await A.library.query(txt, 10);
    queryOut.textContent = '';
    (r?.hits || []).forEach((h2) => {
      const chip = el('span', 'am-chip', `${h2.text} ·${h2.score}`);
      queryOut.appendChild(chip);
    });
    if (!queryOut.children.length) queryOut.appendChild(el('span', 'astra-empty', '沉淀库中没有匹配的概念。'));
  });

  const grid = el('div', 'astra-grid');
  const colL = el('div', 'astra-col'), colR = el('div', 'astra-col');
  colL.append(cDrive.c, cDecision.c, cGoals.c, cDeep.c);
  colR.append(cMemory.c, cLineage.c, cAudit.c, cLibrary.c);
  grid.append(colL, colR);
  page.appendChild(grid);

  // ───────── 真实边界（一句话） ─────────
  const boundary = card('真实边界', '');
  const boundaryTxt = el('div', 'astra-boundary', '');
  const worldNote = el('div', 'astra-worldnote',
    '本地确定性实现，非真实量子计算，不具备意识；等级仅调整界面与行为权限。');
  boundary.body.append(boundaryTxt, worldNote);
  page.appendChild(boundary.c);

  // ───────── 数据更新 ─────────
  let last = null;
  const bar = (label, value, ratio, cls) => {
    const r = el('div', 'adr-row');
    const b = el('div', 'adr-bar'); const f = el('i');
    f.style.width = Math.round(Math.max(0, Math.min(1, Number(ratio) || 0)) * 100) + '%';
    if (cls) f.className = cls;
    b.appendChild(f);
    r.append(el('span', null, label), b, el('b', null, value));
    return r;
  };
  const keepScroll = (node, fn) => { const y = node.scrollTop; node.textContent = ''; fn(); node.scrollTop = y; };

  function update(p) {
    if (!p || !p.mind) return;
    last = p;
    const m = p.mind;

    // 身份 / 阶梯 / 统计
    badgeLv.textContent = 'L' + m.level;
    badgeKey.textContent = m.levelInfo?.key || '—';
    badgeEn.textContent = (m.levelInfo?.en || '').toUpperCase();
    badgeDesc.textContent = m.levelInfo?.desc || '';
    rungs.forEach((r, i) => {
      r.classList.toggle('is-on', i + 1 <= m.level);
      r.classList.toggle('is-now', i + 1 === m.level);
      r.querySelector('span').textContent = m.levels?.[i]?.key || '';
      r.title = `L${i + 1} ${m.levels?.[i]?.key || ''} · ${m.levels?.[i]?.en || ''}｜解锁：${m.levels?.[i]?.unlock || ''}`;
    });
    levelFill.style.width = Math.round(Math.max(0, Math.min(1, ((m.level - 1) + (m.levelProgress || 0)) / 6)) * 100) + '%';
    levelCaption.textContent = `成熟度 ${Math.round((m.maturity || 0) * 100)}% · 本级进度 ${Math.round((m.levelProgress || 0) * 100)}% · 解锁「${m.levelInfo?.unlock || '—'}」`;
    statEls.heartbeats.textContent = num(m.heartbeats);
    statEls.generation.textContent = '第 ' + num(m.generation) + ' 世';
    statEls.memories.textContent = num((m.counts?.episodic || 0) + (m.counts?.semantic || 0));
    statEls.success.textContent = Math.round((m.successRate || 0) * 100) + '%';

    // 控制栏状态
    autoBtn.classList.toggle('is-off', !m.autonomous);
    autoBtn.setAttribute('aria-checked', m.autonomous ? 'true' : 'false');
    ctBtn.classList.toggle('is-off', !p.clickThrough);
    ctBtn.setAttribute('aria-checked', p.clickThrough ? 'true' : 'false');
    modeBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.mode === (p.mode || 'auto')));

    // 雷达
    const pts = DRIVES.map(([k], i) => {
      const v = Math.max(0, Math.min(1, Number(m.drives?.[k]) || 0));
      return `${100 + AXIS[i][0] * 70 * v},${100 + AXIS[i][1] * 70 * v}`;
    });
    radarPoly.setAttribute('points', pts.join(' '));
    radarDots.forEach((d, i) => {
      const [x, y] = pts[i].split(',').map(Number);
      d.setAttribute('cx', x); d.setAttribute('cy', y);
    });
    for (const [k] of DRIVES) {
      const v = Number(m.drives?.[k]) || 0;
      driveBars[k].fill.style.width = Math.round(v * 100) + '%';
      driveBars[k].val.textContent = v.toFixed(2);
    }
    moodLine.textContent = `情绪「${m.mood?.label || '—'}」· 愉悦 ${(m.mood?.valence ?? 0).toFixed(2)} · 唤醒 ${(m.mood?.arousal ?? 0).toFixed(2)} · 自我置信 ${(m.selfModel?.confidence ?? 0).toFixed(2)} · 桌面里程 ${num(m.selfModel?.distance)} px`;

    // v6.15：自我迭代的真实数值（自由能 / 误差熵 / 探索率 / 置信度）
    const d = m.deep;
    if (d) {
      const L = d.last || {};
      const f = Number(L.freeEnergy ?? 0), h = Number(L.entropyNormalized ?? 0);
      const ex = Number(d.policy?.exploration ?? 0), cf = Number(d.policy?.confidence ?? 0);
      deepStat.textContent = `第 ${num(d.generation)} 轮 · 预测 ${L.prediction ?? '—'} · 观测 ${L.observation ?? '—'} · 误差 ${L.error ?? '—'} · F ${L.freeEnergy ?? '—'} · 退相干 λ ${L.quantum?.lambda ?? '—'}`;
      deepBars.textContent = '';
      deepBars.append(
        bar('自由能 F（越低越吻合）', f.toFixed(3), 1 - Math.min(1, f)),
        bar('误差分布熵 H', h.toFixed(3), h),
        bar('探索 / 利用', ex.toFixed(3), ex),
        bar('自我置信', cf.toFixed(3), cf),
      );
    }

    // 决策链
    keepScroll(decisionBox, () => {
      const d = m.lastDecision;
      const head = el('div', 'ad-head');
      head.append(el('b', null, d ? `${d.label} · ${d.text}` : '等待第一次心跳'), el('span', null, d ? `第 ${d.tick} 跳 · 置信 ${(d.confidence ?? 0).toFixed(2)}` : ''));
      decisionBox.appendChild(head);
      const ol = el('ol', 'ad-chain');
      (d?.reason || []).forEach((line) => ol.appendChild(el('li', null, line)));
      decisionBox.appendChild(ol);
      decisionBox.appendChild(el('div', 'ad-foot', `当前意图：${m.intent?.text || '—'}｜漫游：${p.motion ? p.motion.mode + ' / ' + p.motion.behavior + ' / ' + p.motion.speed + 'px·s⁻¹' : '精灵未开启'}`));
    });

    // 目标
    keepScroll(goalsBox, () => {
      if (!m.goals?.length) goalsBox.appendChild(el('div', 'astra-empty', '此刻没有待办目标，正在观察环境。'));
      m.goals.forEach((g) => goalsBox.appendChild(bar(g.label, `${Math.round(g.progress)}/${g.target}`, (g.progress || 0) / (g.target || 1))));
      goalsBox.appendChild(el('div', 'ad-foot', `已完成 ${num(m.selfModel?.goalsDone)} · 过期 ${num(m.selfModel?.goalsFailed)} · 对话 ${num(m.selfModel?.conversations)} 次 · 反馈 ${num(m.feedback?.total)} 条`));
    });

    // 记忆
    keepScroll(memoryBox, () => {
      (m.memory?.episodic || []).slice(0, 10).forEach((e) => {
        const row = el('div', 'am-item');
        row.append(el('time', null, fmt(e.at)), el('span', null, e.text || ''), el('i', null, e.mood || ''));
        memoryBox.appendChild(row);
      });
      const sem = m.memory?.semantic || [];
      if (sem.length) {
        const chips = el('div', 'am-chips');
        sem.slice(0, 12).forEach((s) => chips.appendChild(el('span', null, `${s.text} ×${s.count}`)));
        memoryBox.appendChild(chips);
      }
      if (!memoryBox.children.length) memoryBox.appendChild(el('div', 'astra-empty', '记忆尚空。和桌面伴侣说句话，就会留下第一条。'));
    });

    // 世代
    keepScroll(lineageBox, () => {
      lineageBox.appendChild(el('div', 'ad-foot', `第 ${m.generation} 世 · ${m.epoch || 0} 次迭代 · ${m.counts?.generations || 0} 份可回滚快照`));
      (m.lineage || []).slice().reverse().slice(0, 6).forEach((g) => {
        const row = el('div', 'alineage-row');
        row.append(el('b', null, '第 ' + g.gen + ' 世'), el('span', null, `L${g.level} · 成功率 ${g.successRate} · 记忆 ${g.memories} · 第 ${g.tick} 跳`));
        const b = el('button', null, '回滚');
        b.addEventListener('click', () => void call(() => A.rollback(g.gen), `已回滚到第 ${g.gen} 世`));
        row.appendChild(b);
        lineageBox.appendChild(row);
      });
      if (!(m.lineage || []).length) lineageBox.appendChild(el('div', 'astra-empty', '尚无世代快照。点「自主演化」生成第一份。'));
    });

    // 审计
    keepScroll(auditBox, () => {
      (m.audit || []).slice(0, 14).forEach((a) => {
        const row = el('div', 'aa-row');
        const detail = typeof a.detail === 'string' ? a.detail : (a.detail?.top || a.detail?.conclusion || a.detail?.note || a.detail?.label || a.detail?.action || '');
        row.append(el('span', 'aa-kind aa-' + String(a.kind), a.kind), el('time', null, '#' + num(a.tick)), el('span', 'aa-detail', String(detail)));
        auditBox.appendChild(row);
      });
      if (!auditBox.children.length) auditBox.appendChild(el('div', 'astra-empty', '审计轨迹为空。'));
    });

    boundaryTxt.textContent = m.boundary || p.boundary || '';
  }

  // ───────── 动作 ─────────
  async function call(fn, okMsg) {
    try {
      const r = await fn();
      if (r && r.ok === false) throw new Error(r.error || '操作失败');
      if (okMsg) toast(okMsg, 'ok');
      const fresh = await A.status();
      if (fresh?.ok) update(fresh.data);
      loadLibrary(); // 沉淀库随时间变化，动作后顺手刷新
      return r;
    } catch (e) { toast('操作失败：' + String(e?.message || e), 'err', 3600); return null; }
  }
  async function rollbackPrev() {
    const g = (last?.mind?.generation || 2) - 1;
    if (g < 1) { toast('已经是第一世，无可回滚', 'err'); return; }
    await call(() => A.rollback(g), `已回滚到第 ${g} 世`);
  }
  autoBtn.addEventListener('click', () => {
    const next = !(last?.mind?.autonomous);
    void call(() => A.setAutonomous(next), next ? '自主运行已开启' : '自主运行已暂停');
  });
  ctBtn.addEventListener('click', () => {
    const next = !last?.clickThrough;
    void call(() => A.clickThrough(next), next ? '漫游时空白区域鼠标穿透' : '鼠标穿透已关闭');
  });

  // ───────── 思维沉淀库：状态 + 突触网可视化 ─────────
  function accentColor() {
    try { const v = getComputedStyle(document.body).getPropertyValue('--ds-accent').trim(); if (v) return v; } catch { /* ignore */ }
    return NEURO_PALETTE[0];
  }
  function drawSynapse(canvas, graph) {
    const ctx = canvas.getContext('2d');
    // v6.37.0 修复：canvas 像素缓冲固定 320×200，但 CSS 把宽度拉满列宽，
    // 造成突触图按 320 算半径后被横向拉伸、缩在中心一圈且右侧大片空白。
    // 绘制前按实际渲染尺寸设置像素缓冲，让图形铺满可用区域（含设备像素比）。
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 320, cssH = canvas.clientHeight || 200;
    const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const W = cssW, H = cssH;   // setTransform 后绘图坐标系为 CSS 像素
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const nodes = (graph?.nodes || []).slice(-28);
    const n = nodes.length;
    if (!n) { ctx.fillStyle = 'rgba(140,170,210,.5)'; ctx.font = '12px sans-serif'; ctx.fillText('尚无突触关联', 12, H / 2); return; }
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 18;
    const pos = nodes.map((node, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rr = R * (0.45 + 0.55 * ((i % 3) / 2));
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, node];
    });
    const bySeq = new Map(nodes.map((nd, i) => [nd.seq, i]));
    const ac = accentColor();
    // 先画边（突触）：按权重决定透明度与粗细
    (graph?.edges || []).forEach((e) => {
      const i = bySeq.get(e.from), j = bySeq.get(e.to);
      if (i == null || j == null) return;
      ctx.strokeStyle = `rgba(255,214,107,${0.10 + e.weight * 0.5})`;
      ctx.lineWidth = 0.5 + e.weight * 1.2;
      ctx.beginPath(); ctx.moveTo(pos[i][0], pos[i][1]); ctx.lineTo(pos[j][0], pos[j][1]); ctx.stroke();
    });
    // 再画节点：半径随权重，中心点更亮
    pos.forEach(([x, y, node], i) => {
      const rad = 2.4 + Math.min(5, node.weight * 6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.4);
      g.addColorStop(0, ac); g.addColorStop(1, 'rgba(107,208,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ac;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    });
  }
  async function loadLibrary() {
    try {
      const s = await A.library.status();
      if (s?.ok) {
        const st = s.stats;
        libStat.textContent = `情境 ${num(st.episodic)} · 语义 ${num(st.semantic)} · 突触 ${num(st.synapse)} · 决策 ${num(st.decision)} · 演化 ${num(st.evolution)}（约 ${num(Math.round(st.bytes / 1024))} KB）`;
        libRoot.textContent = '位置：' + st.root;
        libRoot.dataset.root = st.root;
      }
      const g = await A.library.graph(48);
      if (g?.graph) drawSynapse(synapseCanvas, g.graph);
    } catch { /* 桥不可用时静默 */ }
  }

  // ───────── 订阅 ─────────
  let unsub = null;
  try { unsub = A.onState(update); } catch (e) { /* 桥不可用时靠手动刷新 */ }
  A.status().then((r) => { if (r?.ok) update(r.data); }).catch(() => {});
  loadLibrary();
  // 沉淀库随时间增长，轻量定时刷新（卸载时清除）
  const libTimer = setInterval(() => { try { loadLibrary(); } catch { /* ignore */ } }, 9000);

  return {
    unmount() { try { unsub?.(); } catch (e) { /* ignore */ } try { clearInterval(libTimer); } catch {} },
  };
}
