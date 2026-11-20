// ═══════════════════════════════════════════════════════════════════════════
// AURORA Design System · 外观控制器（v6.9.0）
// ───────────────────────────────────────────────────────────────────────────
// 一个地方管理：主题（浅 / 深 / 跟随系统）、强调色、界面尺度、信息密度、动效。
// 设计原则：状态只有一份（localStorage），DOM 只表达状态（body class / data-*），
// 视觉全部交给 design-system.css 的令牌，不在这里写任何颜色值。
//
// 兼容性：保留 applyTheme/applyDensity/toggleTheme/toggleDensity 四个旧入口，
// 命令面板、快捷键与历史调用方无需改动；同时继续写回 neolink-theme /
// neolink-density 两个旧键，避免旧配置读取出现"回退到默认"的观感。
//
// v6.21.0：第四代视觉层 Quiet Cosmos v7 同样纳入这一份 state —— 此前 CSS 注释
// 承诺「一键回退」，但控制器里既没有开关也没有状态，实际只能改源码。现在
// 外观面板、命令面板、恢复默认三处都能真实切换，且首屏零闪烁逻辑与 PRO/NS 一致。
// ═══════════════════════════════════════════════════════════════════════════
const KEY = 'neocosmos-appearance';
// v6.18.0：PRO 排版 / 工程级界面两个开关此前游离在控制器之外，
// 「恢复默认」不覆盖它们、面板状态也不随偏好同步。现在纳入同一份 state，
// 同时继续读写两个历史 localStorage 键，保持首屏零闪烁的旧逻辑兼容。
const PRO_LAYOUT_KEY = 'neokb-pro-layout';
const NS_LAYOUT_KEY = 'neokb-ns-layout';
const V7_LAYOUT_KEY = 'neokb-v7-layout';
const DEFAULTS = Object.freeze({
  mode: 'light',        // light | dark | system
  accent: 'cobalt',     // cobalt | graphite | teal | amber | violet
  scale: 'standard',    // standard | large
  density: 'cozy',      // cozy | compact
  motion: true,         // 界面动效开关（尊重系统「减少动态效果」优先）
  pro: true,            // AURORA PRO 排版层
  ns: true,             // NORTHSTAR 工程级界面层
  v7: true,             // v6.21.0 Quiet Cosmos 第四代视觉层
});
const MODES = ['light', 'dark', 'system'];
const ACCENTS = ['cobalt', 'graphite', 'teal', 'amber', 'violet'];
const SCALES = ['standard', 'large'];
const DENSITIES = ['cozy', 'compact'];

const MOON_SVG = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>';

function load() {
  const out = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (raw && typeof raw === 'object') {
      if (MODES.includes(raw.mode)) out.mode = raw.mode;
      if (ACCENTS.includes(raw.accent)) out.accent = raw.accent;
      if (SCALES.includes(raw.scale)) out.scale = raw.scale;
      if (DENSITIES.includes(raw.density)) out.density = raw.density;
      if (typeof raw.motion === 'boolean') out.motion = raw.motion;
      if (typeof raw.pro === 'boolean') out.pro = raw.pro;
      if (typeof raw.ns === 'boolean') out.ns = raw.ns;
      if (typeof raw.v7 === 'boolean') out.v7 = raw.v7;
    }
  } catch { /* 配置损坏时静默回落默认值，不让启动失败 */ }
  // v6.9.0 迁移：读取 1.4 时代遗留的旧键，避免升级后主题"跳回浅色"
  // v6.18.0：两个排版层开关的旧键同样作为迁移来源（首次运行不丢用户偏好）
  // v6.21.0：v7 层也走同一份独立键，保证 app.js 首屏读取与这里状态一致
  try {
    if (!localStorage.getItem(KEY)) {
      const oldTheme = localStorage.getItem('neolink-theme');
      const oldDensity = localStorage.getItem('neolink-density');
      if (oldTheme === 'dark' || oldTheme === 'light') out.mode = oldTheme;
      if (oldDensity === 'compact' || oldDensity === 'cozy') out.density = oldDensity;
      if (localStorage.getItem(PRO_LAYOUT_KEY) === '0') out.pro = false;
      if (localStorage.getItem(NS_LAYOUT_KEY) === '0') out.ns = false;
      if (localStorage.getItem(V7_LAYOUT_KEY) === '0') out.v7 = false;
    }
  } catch { /* ignore */ }
  return out;
}

export function createAppearance({ toast } = {}) {
  let state = load();
  const mq = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const osReduce = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let panelBound = false;

  const say = (msg) => { try { toast?.(msg, 'ok', 2200); } catch { /* ignore */ } };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      // 三个独立键由 app.js 首屏读取，必须同步写回，避免两套状态漂移
      localStorage.setItem(PRO_LAYOUT_KEY, state.pro ? '1' : '0');
      localStorage.setItem(NS_LAYOUT_KEY, state.ns ? '1' : '0');
      localStorage.setItem(V7_LAYOUT_KEY, state.v7 ? '1' : '0');
    } catch { /* ignore */ }
  };
  const effective = () => state.mode === 'system' ? (mq?.matches ? 'dark' : 'light') : state.mode;

  function syncPanel() {
    const pop = document.getElementById('appearancePop');
    const all = (sel) => document.querySelectorAll(sel);
    // 主题卡（单选）
    all('[data-appearance-mode]').forEach((el) => {
      const on = el.dataset.appearanceMode === state.mode;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // 强调色色卡
    all('[data-appearance-accent]').forEach((el) => {
      const on = el.dataset.appearanceAccent === state.accent;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // 尺度 / 密度分段
    all('[data-appearance-scale]').forEach((el) => el.classList.toggle('is-on', el.dataset.appearanceScale === state.scale));
    all('[data-appearance-density]').forEach((el) => el.classList.toggle('is-on', el.dataset.appearanceDensity === state.density));
    // 动效开关 + 三个视觉层开关（v6.18.0 / v6.21.0：全部由同一份 state 驱动）
    for (const [id, on] of [
      ['appearanceMotion', state.motion],
      ['appearancePro', state.pro],
      ['appearanceNorthstar', state.ns],
      ['appearanceV7', state.v7],
    ]) {
      const sw = document.getElementById(id);
      if (sw) {
        sw.classList.toggle('on', !!on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    if (pop) pop.dataset.mode = state.mode;
    // v6.19.0：面板除了能拨开关，还要能核对「当前到底生效了什么」。
    // 全部取自同一份 state / effective()，不写演示值。
    const ro = document.getElementById('apReadout');
    if (ro) {
      const modeText = { light: '浅色', dark: '深色', system: '跟随系统' }[state.mode] || state.mode;
      const accentText = { cobalt: '钴蓝', graphite: '石墨', teal: '青碧', amber: '琥珀', violet: '堇紫' }[state.accent] || state.accent;
      const lines = [
        `主题 ${modeText}（当前解析 ${effective() === 'dark' ? '深色' : '浅色'}）`,
        `强调色 ${accentText}`,
        `尺度 ${state.scale === 'large' ? '大字号' : '标准'}`,
        `密度 ${state.density === 'compact' ? '紧凑' : '舒适'}`,
        `动效 ${state.motion ? '开' : '关'}`,
        `排版 ${state.pro ? 'PRO' : '基础'} / ${state.ns ? '工程级' : '经典'}`,
        `视觉 ${state.v7 ? 'Quiet Cosmos v7' : '6.20 经典'}`,
      ];
      ro.textContent = lines.join(' · ');
      ro.setAttribute('title', '当前生效的外观状态（来自外观控制器单一状态源）');
    }
  }

  function apply() {
    const dark = effective() === 'dark';
    const b = document.body;
    b.classList.toggle('theme-dark', dark);
    b.classList.toggle('density-compact', state.density === 'compact');
    b.classList.toggle('scale-large', state.scale === 'large');
    // 系统层「减少动态效果」优先于应用内开关：任一要求减少，就减少
    b.classList.toggle('reduce-motion', !state.motion || !!osReduce?.matches);
    b.classList.toggle('pro-layout', !!state.pro);
    b.classList.toggle('ns-layout', !!state.ns);
    // v6.21.0：第四代视觉层由同一份 state 驱动；关掉即完整回退到 6.20 观感
    b.classList.toggle('neo-v2', !!state.v7);
    b.dataset.accent = state.accent;
    b.dataset.themeMode = state.mode;
    b.dataset.themeResolved = dark ? 'dark' : 'light';

    // 旧键兼容（其它脚本、旧版配置读取）
    try {
      localStorage.setItem('neolink-theme', dark ? 'dark' : 'light');
      localStorage.setItem('neolink-density', state.density);
    } catch { /* ignore */ }

    const btn = document.getElementById('btnTheme');
    if (btn) {
      btn.innerHTML = dark ? SUN_SVG : MOON_SVG;
      btn.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到石墨深色主题');
      btn.setAttribute('title', dark ? '切换到浅色主题（外观设置可跟随系统）' : '切换到石墨深色主题（外观设置可跟随系统）');
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
    // 原生控件（滚动条 / 表单）跟随明暗
    try { document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; } catch { /* ignore */ }
    syncPanel();
    try { window.dispatchEvent(new CustomEvent('appearance:change', { detail: { ...state, dark } })); } catch { /* ignore */ }
  }

  const commit = (patch, msg) => {
    state = { ...state, ...patch };
    save();
    apply();
    if (msg) say(msg);
  };

  // ── 兼容旧入口 ──────────────────────────────────────────────────────────
  function applyTheme(t) {
    const mode = t === 'dark' ? 'dark' : t === 'system' ? 'system' : 'light';
    commit({ mode });
  }
  function toggleTheme() {
    const next = effective() === 'dark' ? 'light' : 'dark';
    commit({ mode: next }, next === 'dark' ? '已切换到石墨深色主题' : '已切换到浅色主题');
  }
  function applyDensity(d) { commit({ density: d === 'compact' ? 'compact' : 'cozy' }); }
  function toggleDensity() {
    const next = state.density === 'compact' ? 'cozy' : 'compact';
    commit({ density: next }, next === 'compact' ? '已切换到紧凑密度' : '已切换到舒适密度');
  }
  // v6.18.0：排版层开关唯一入口。app.js 的点击绑定改为委托这里，
  // 「恢复默认」通过 commit(DEFAULTS) 一并复位全部 class 与面板开关。
  // v6.21.0：v7 层加入同一入口，避免出现「只有 CSS、没有开关」的空承诺。
  function setLayout(kind, on) {
    const key = kind === 'pro' ? 'pro' : kind === 'ns' ? 'ns' : kind === 'v7' ? 'v7' : null;
    if (!key) return;
    const label = { pro: 'AURORA PRO 排版', ns: '工程级界面', v7: 'Quiet Cosmos v7 视觉层' }[key];
    commit({ [key]: !!on }, `${on ? '已启用' : '已回退'}${label}`);
  }

  // ── 面板开关 ────────────────────────────────────────────────────────────
  /** v6.19.0：旧实现只设 top=r.bottom+10，既不约束可用高度也不做越界翻转，
   *  矮窗口下面板底部会伸到状态栏之外。这里按真实视口余量定位并限高。 */
  function place(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    const gap = 10, margin = 10;
    const w = pop.offsetWidth || 324;
    const h = pop.offsetHeight || 520;
    const below = window.innerHeight - r.bottom - gap - margin;
    const above = r.top - gap - margin;
    const flip = below < Math.min(h, 240) && above > below;
    const space = flip ? above : below;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - w - margin));
    const top = flip
      ? Math.max(margin, r.top - gap - Math.min(h, space))
      : r.bottom + gap;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.maxHeight = Math.max(160, Math.min(720, space)) + 'px';
    pop.dataset.placement = flip ? 'above' : 'below';
  }
  function close() {
    const pop = document.getElementById('appearancePop');
    if (pop) pop.hidden = true;
    const btn = document.getElementById('btnAppearance');
    btn?.setAttribute('aria-expanded', 'false');
    // Esc / 关闭按钮收起面板后把焦点还回锚点，键盘用户不会丢失落点
    if (pop && document.activeElement && pop.contains(document.activeElement)) btn?.focus();
  }
  function open() {
    const pop = document.getElementById('appearancePop');
    const btn = document.getElementById('btnAppearance');
    if (!pop || !btn) return;
    pop.hidden = false;
    place(pop, btn);
    btn.setAttribute('aria-expanded', 'true');
    syncPanel();
  }
  function toggle() {
    const pop = document.getElementById('appearancePop');
    if (!pop || pop.hidden) open(); else close();
  }

  // ── 事件绑定（boot 时调用一次） ────────────────────────────────────────
  function init() {
    // 首次绘制前先落地状态（避免闪白/闪黑）
    apply();
    if (panelBound) return;
    panelBound = true;

    document.getElementById('btnAppearance')?.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.getElementById('appearanceClose')?.addEventListener('click', (e) => { e.stopPropagation(); close(); });

    const pop = document.getElementById('appearancePop');
    pop?.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      e.stopPropagation();
      if (t.dataset.appearanceMode) commit({ mode: t.dataset.appearanceMode }, '主题已更新');
      else if (t.dataset.appearanceAccent) commit({ accent: t.dataset.appearanceAccent }, '强调色已更新');
      else if (t.dataset.appearanceScale) commit({ scale: t.dataset.appearanceScale }, '界面尺度已更新');
      else if (t.dataset.appearanceDensity) commit({ density: t.dataset.appearanceDensity }, '信息密度已更新');
      // 注意：commit 的实参在写入 state 之前求值，这里必须用「切换后的值」组织提示，
      // 否则关闭动效会提示「已开启」、开启动效反而提示「已关闭」。
      else if (t.id === 'appearanceMotion') {
        const next = !state.motion;
        commit({ motion: next }, next ? '界面动效已开启' : '界面动效已关闭');
      }
      else if (t.id === 'appearanceReset') commit({ ...DEFAULTS }, '外观已恢复默认');
    });

    // 点击面板外关闭（与 Cosmos 精灵弹层互不干扰：打开一个就关掉另一个）
    document.addEventListener('click', (e) => {
      if (!pop || pop.hidden) return;
      if (pop.contains(e.target) || document.getElementById('btnAppearance')?.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop?.hidden) close(); }, true);
    // v6.19.0：窗口尺寸变化时按新的真实余量重新定位，而不是粗暴关掉面板
    window.addEventListener('resize', () => {
      if (!pop || pop.hidden) return;
      const btn = document.getElementById('btnAppearance');
      if (btn) place(pop, btn);
    });

    // 打开外观面板时收起精灵弹层，避免两个浮层叠在一起
    document.getElementById('btnAppearance')?.addEventListener('click', () => {
      const sp = document.getElementById('spritePop');
      if (sp) sp.hidden = true;
    });

    // 跟随系统：主题 / 减少动效，系统变化时实时生效。
    // v6.9.0 修复：旧守卫 `state.mode==='system' || !state.motion || osReduce.matches`
    // 在「OS 减少动效由开变关 + 应用动效开启 + 非跟随主题」时三项全假，
    // 不重新 apply()，body 上的 reduce-motion 会一直残留到下次手动操作。
    // 媒体查询变化本身就很稀疏，无条件重算一次状态最稳妥且幂等。
    const onSystem = () => apply();
    // 两个媒体查询各自独立降级：不能因为其中一个不支持 addEventListener，
    // 就把另一个一并丢进 catch（旧写法会漏绑 osReduce）。
    const bindMq = (m) => {
      if (!m) return;
      try {
        if (typeof m.addEventListener === 'function') m.addEventListener('change', onSystem);
        else if (typeof m.addListener === 'function') m.addListener(onSystem); // 老 Chromium
      } catch { /* 单个媒体查询绑定失败不影响其余外观能力 */ }
    };
    bindMq(mq);
    bindMq(osReduce);
  }

  return {
    init, apply, open, close, toggle,
    applyTheme, toggleTheme, applyDensity, toggleDensity, setLayout,
    state: () => ({ ...state }),
    effective,
  };
}
