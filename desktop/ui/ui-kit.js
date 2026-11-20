// 极简 DOM / 提示工具（零依赖，供各视图共享）
// v1.1.0 增补：icon() SVG 图标库 · modal() / confirmDialog() 模态弹窗
// （Electron 不支持 window.prompt，原先的 prompt 调用全部替换为弹窗）
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      // v1.3.1 加固：任何事件处理器异常都显式提示，不再静默无反应
      el.addEventListener(k.slice(2).toLowerCase(), (ev) => {
        try { v(ev); }
        catch (e) {
          console.error('[ui]', k, e);
          // v6.20：异常对象可能不可字符串化（Symbol / 抛错的 toPrimitive），旧写法
          // 会在 catch 里二次抛错，让「操作失败」提示彻底消失。先安全取文案再提示。
          let detail = '';
          try { const raw = e?.message ?? e ?? ''; detail = typeof raw === 'string' ? raw : String(raw); } catch { /* 保持兜底 */ }
          toast('操作失败：' + (visibleText(detail) || '未知错误'), 'err', 4200);
        }
      });
    }
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(4)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

// ---------------- SVG 图标（线性，统一 1.6 描边） ----------------
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  graph: '<circle cx="12" cy="12" r="2.4"/><path d="M12 12 L17.4 7.2M12 12 L5.6 8.4M12 12 L15.4 18"/>',
  derive: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>',
  file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5l2-2a4 4 0 0 1 5.6 5.6l-2 2"/><path d="M13 17.5l-2 2a4 4 0 0 1-5.6-5.6l2-2"/>',
  folder: '<path d="M3.5 6.5h6l2 2.5h9V19h-17z"/>',
  cross: '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7.2 12h9.6"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M20 14v6H4V4h6"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M8 6V4h8v2"/><path d="M6.5 6.5 7.5 20h9l1-13.5"/>',
  check: '<path d="M4.5 12.5 10 18 19.5 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 21 21"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  palette: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9.5" r="1"/><circle cx="15" cy="9.5" r="1"/><circle cx="12" cy="15" r="1"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5.5 8.5V19h13V8.5"/><path d="M10 12h4"/>',
  arrowL: '<path d="M19 12H5"/><path d="M11 6 5 12l6 6"/>',
  arrowR: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  collapseL: '<path d="M14 5l-7 7 7 7"/>',
  collapseR: '<path d="M10 5l7 7-7 7"/>',
  // ── v6.17 补全的语义图标（统一 24 网格 / 1.6 描边 / currentColor）──
  workspace: '<rect x="3.2" y="5" width="7" height="14" rx="1.6"/><rect x="13.8" y="5" width="7" height="14" rx="1.6"/>',
  ask: '<path d="M4 5.5h16v9H9l-4 4v-4H4z"/><path d="M8 9.2h8M8 11.8h5"/>',
  astra: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.6" stroke-dasharray="2.6 3.4"/><path d="M12 2.4v2.6M12 19v2.6M2.4 12h2.6M19 12h2.6"/>',
  settle: '<path d="M12 3.2c3.6 3.2 5.6 6 5.6 8.6A5.6 5.6 0 0 1 12 17.4 5.6 5.6 0 0 1 6.4 11.8c0-2.6 2-5.4 5.6-8.6z"/><path d="M12 17.4v3M9.2 20.4h5.6"/>',
  consolidate: '<path d="M20 13.5A8 8 0 1 1 11.5 4 6.4 6.4 0 0 0 20 13.5z"/>',
  atlas: '<path d="M12 3.2 19.4 6v6c0 4.2-3 7.6-7.4 9.1C7.6 19.6 4.6 16.2 4.6 12V6z"/><path d="M9.2 12.1l2 2 3.6-3.9"/>',
  enterprise: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M4 20h16"/>',
  capabilities: '<rect x="3.4" y="3.4" width="7" height="7" rx="1.6"/><rect x="13.6" y="3.4" width="7" height="7" rx="1.6"/><rect x="3.4" y="13.6" width="7" height="7" rx="1.6"/><rect x="13.6" y="13.6" width="7" height="7" rx="1.6"/>',
  team: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6"/><path d="M16.5 13.5a5.5 5.5 0 0 1 4 5.5"/>',
  vaults: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/><path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
  appearance: '<path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  theme: '<path d="M20 13.5A8 8 0 1 1 11.5 4 6.4 6.4 0 0 0 20 13.5z"/>',
  sprite: '<path d="M12 2.5l1.9 6.1L20 10.5l-6.1 1.9L12 18.5l-1.9-6.1L4 10.5l6.1-1.9z"/>',
  about: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  export: '<path d="M12 3v11M7.5 9.5 12 14l4.5-4.5"/><path d="M4 19h16"/>',
  play: '<path d="M7 4.5 19 12 7 19.5z"/>',
  warn: '<path d="M12 3.5 21.5 20H2.5z"/><path d="M12 9.5v5"/><path d="M12 17h.01"/>',
  empty: '<path d="M3.5 13l2.6 5.5h12.8L21.5 13"/><path d="M3.5 13 6 5h12l2.5 8"/><path d="M9.5 13h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};

export function icon(name, size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// v6.17：真实空状态组件（图标 + 平实引导，绝不放置演示数据 / 占位数字）
// action 为可选的真实操作按钮（如「新建知识库」「运行自检」）
export function emptyState(iconName, title, hint, action) {
  return h('div', { class: 'empty' },
    h('div', { class: 'e-ico', html: icon(iconName || 'empty', 40) }),
    h('div', { class: 'e-tt' }, title || ''),
    hint ? h('div', { class: 'e-hint' }, hint) : null,
    action ? h('div', { class: 'e-act' }, action) : null);
}

// ---------------- 模态弹窗（替代 window.prompt / 复杂 confirm） ----------------
/**
 * modal({ title, message, fields, confirmText, cancelText, danger })
 * fields: [{ key, label, type: 'text'|'textarea'|'select', placeholder, value, required, options }]
 * @returns {Promise<Object|null>} 确认返回 {key:value}；取消返回 null
 */
export function modal({ title, message, fields = [], confirmText = '确定', cancelText = '取消', danger = false, wide = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    if (!root) { resolve(null); return; }
    root.innerHTML = '';
    root.classList.add('is-open');

    const inputs = {};
    let done = false;
    // v6.18.0 修复：旧实现每次打开都往常驻 #modalRoot 上挂一个匿名 mousedown 监听，
    // close() 只清 innerHTML 不清监听器 —— 开 N 次弹窗就有 N 个回调与闭包常驻。
    const onRootDown = (ev) => { if (ev.target === root) close(null); };
    const close = (val) => {
      if (done) return;
      done = true;
      root.classList.remove('is-open');
      root.innerHTML = '';
      root.removeEventListener('mousedown', onRootDown);
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); close(null); }
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit(); }
    };

    const body = h('div', { class: 'modal-body' },
      message ? h('p', { class: 'modal-msg' }, message) : null,
      fields.map((f) => {
        let input;
        if (f.type === 'textarea') input = h('textarea', { placeholder: f.placeholder || '', spellcheck: 'false' });
        else if (f.type === 'select') {
          input = h('select', null, (f.options || []).map((o) => h('option', { value: o.value }, o.label)));
        } else input = h('input', { placeholder: f.placeholder || '', spellcheck: 'false' });
        if (f.value != null) input.value = String(f.value);
        inputs[f.key] = input;
        return h('div', { class: 'field' }, h('label', null, f.label + (f.required ? ' *' : '')), input);
      }));

    const submit = () => {
      const vals = {};
      for (const [k, el] of Object.entries(inputs)) vals[k] = el.value;
      const missing = fields.find((f) => f.required && !String(vals[f.key] || '').trim());
      if (missing) {
        inputs[missing.key].style.borderColor = 'var(--rose)';
        inputs[missing.key].focus();
        return;
      }
      close(vals);
    };

    const box = h('div', { class: 'modal' + (wide ? ' is-wide' : ''), role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('b', null, title)),
      body,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn ghost', onclick: () => close(null) }, cancelText),
        h('button', { class: 'btn' + (danger ? ' warn' : ''), onclick: submit }, confirmText)));
    root.appendChild(box);
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', onRootDown);
    const first = Object.values(inputs)[0];
    if (first && (!fields[0] || fields[0].type !== 'textarea')) setTimeout(() => first.focus(), 40);
    else if (first) setTimeout(() => first.focus(), 40);
  });
}

export function confirmDialog({ title, message, confirmText = '确定', danger = true }) {
  return modal({ title, message, fields: [], confirmText, danger }).then((v) => v !== null);
}

// ---------------- 通用下拉菜单（标题栏知识库切换等） ----------------
let openMenuCloser = null;
export function closeMenu() { if (openMenuCloser) { openMenuCloser(); } }

/**
 * dropdown(anchorEl, items)
 * items: [{ label, icon, sub, dot, active, danger, disabled, onClick } | { sep:true } | { title:'分组名' }]
 */
export function dropdown(anchorEl, items) {
  const root = document.getElementById('menuRoot');
  if (!root) return;
  if (openMenuCloser) openMenuCloser();
  root.innerHTML = '';
  // v6.20：空菜单（取数失败 / 列表为空）曾打开一个只有内边距的纯白圆角浮层，
  // 与右下角空白提示观感一致且拦截鼠标。没有可点击项就不打开。
  const usable = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!usable.some((it) => !it.sep && !it.title && it.label)) {
    root.classList.remove('is-open');
    return;
  }
  root.classList.add('is-open');

  const finish = () => {
    root.classList.remove('is-open');
    root.innerHTML = '';
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    openMenuCloser = null;
  };
  openMenuCloser = finish;
  const onDoc = (ev) => {
    if (root.contains(ev.target) || (anchorEl && anchorEl.contains(ev.target))) return;
    finish();
  };
  const onKey = (ev) => { if (ev.key === 'Escape') finish(); };

  for (const it of usable) {
    if (it.sep) { root.appendChild(h('div', { class: 'menu-sep' })); continue; }
    if (it.title) { root.appendChild(h('div', { class: 'menu-title' }, it.title)); continue; }
    const btn = h('button', {
      class: 'menu-item' + (it.active ? ' is-active' : '') + (it.danger ? ' danger' : ''),
      disabled: it.disabled ? true : null,
      onclick: () => { finish(); if (it.onClick) it.onClick(); },
    },
      it.dot != null ? h('span', { class: 'mi-dot', style: { background: it.dot, boxShadow: `0 0 8px ${it.dot}` } }) : null,
      it.icon ? h('span', { class: 'mi-ico', html: icon(it.icon, 13) }) : null,
      h('span', { class: 'mi-label' }, it.label),
      it.sub ? h('span', { class: 'mi-sub' }, it.sub) : null,
    );
    root.appendChild(btn);
  }

  // 定位：默认贴 anchor 下方右对齐；越界自动翻转
  const rect = anchorEl.getBoundingClientRect();
  root.style.visibility = 'hidden';
  root.style.left = '0px'; root.style.top = '0px';
  requestAnimationFrame(() => {
    const mw = root.offsetWidth, mh = root.offsetHeight;
    let x = rect.right - mw;
    let y = rect.bottom + 6;
    if (x < 8) x = 8;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, rect.top - mh - 6);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.visibility = '';
  });
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
}

const TOAST_ROOT = () => document.getElementById('toastRoot');
const MAX_TOASTS = 3;
const TOAST_KINDS = new Set(['ok', 'err', 'warn', 'info']);
// v6.20：trim() 只移除 ECMAScript 空白；零宽空格 / ZWNJ / ZWJ / 词连接符 /
// 变体选择符等 Unicode Cf 字符不属于空白，旧守卫会放行一个「有文本节点却
// 看不见任何字」的提示，形成白底 + 左侧青绿色条的幽灵浮层（截图右下红框）。
const INVISIBLE = /[\u200B-\u200D\u2060\uFE0F\uFEFF\u00AD\u034F\u061C\u180E\u17B4\u17B5\u2061-\u2064]/gu;
function visibleText(v) {
  let s;
  try { s = typeof v === 'string' ? v : String(v ?? ''); }
  catch { return ''; }
  return s.replace(INVISIBLE, '').trim();
}
function sweepGhostToasts(root) {
  for (const el of root.querySelectorAll('.toast')) {
    if (!visibleText(el.textContent)) el.remove();
  }
}
let toastSweeperInstalled = false;
function installToastSweeper(root) {
  if (toastSweeperInstalled || typeof MutationObserver === 'undefined') return;
  toastSweeperInstalled = true;
  // 兜住任何来源（历史节点 / 外部注入 / 旧版常驻进程）留下的空白提示节点
  new MutationObserver(() => sweepGhostToasts(root))
    .observe(root, { childList: true, subtree: true, characterData: true });
}
/** 右下提示：空消息一律不创建节点；同文本去重；最多 3 条；点击即关。 */
export function toast(msg, kind = '', ms = 2600) {
  const root = TOAST_ROOT();
  if (!root) return;
  installToastSweeper(root);
  sweepGhostToasts(root);
  const text = visibleText(msg);
  if (!text) return;
  const k = typeof kind === 'string' && TOAST_KINDS.has(kind.trim()) ? kind.trim() : '';
  const key = `${k}|${text}`;
  const live = [...root.querySelectorAll('.toast:not(.is-leaving)')];
  const dup = live.find((el) => el.dataset.toastKey === key);
  if (dup) { dup.dataset.toastCount = String((Number(dup.dataset.toastCount) || 1) + 1); return; }
  for (const old of live.slice(0, Math.max(0, live.length - MAX_TOASTS + 1))) old.remove();
  const t = h('div', { class: `toast ${k}`.trim(), role: 'status', 'aria-live': 'polite' }, text);
  t.dataset.toastKey = key;
  t.dataset.toastCount = '1';
  t.title = '点击关闭';
  t.addEventListener('click', () => t.remove());
  root.appendChild(t);
  const life = Number.isFinite(ms) && ms > 0 ? ms : 2600;
  setTimeout(() => {
    if (!t.isConnected) return;
    t.classList.add('is-leaving');
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0'; t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 320);
  }, life);
}

export function status(text) {
  const el = document.getElementById('sbStatus');
  if (el) el.textContent = visibleText(text) || '—';
}

export function latency(ms) {
  const el = document.getElementById('sbLatency');
  if (el) el.textContent = ms == null ? '—' : `${ms} ms`;
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function pct(n) { return `${Math.round(n * 100)}%`; }

/**
 * 安全写剪贴板。
 * 窗口未聚焦时浏览器会抛 NotAllowedError —— 此前各视图直接 await
 * navigator.clipboard.writeText(...)，异常无人接管，会变成未捕获的 Promise 拒绝
 * （渲染进程报错）。此处统一兜住，并如实告诉用户发生了什么。
 */
export async function copyToClipboard(text, okMsg = '已复制') {
  const t = String(text ?? '');
  try {
    await navigator.clipboard?.writeText(t);
    toast(okMsg, 'ok');
    return true;
  } catch (e) {
    toast('复制失败：' + String(e?.message || e) + '（窗口未聚焦时请先点一下窗口）', 'err', 4200);
    return false;
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 供 <b>高亮联想路径</b> 使用的最小内联渲染
export function inlineSafe(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
