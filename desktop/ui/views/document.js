// 中栏 · 文档台
// 卡片正文的阅读与编辑。它是"文档"，但被关系感知地渲染：
//   · [[双链]] 可点击跳转（跳不过去的就是断链 → 一键生长成新卡片，并自动继承突触）
//   · #标签 可点击筛选
//   · 本地图片按相对路径渲染（经 neolink://vault/ 沙箱协议）
//   · 沉淀区（Agent 回写）用独立色块呈现，与人写正文分列
// 编辑只由人触发；系统任何自动化都不会改写这里的内容。
//
// v1.1.0：Ctrl+S 保存 · 切卡脏状态守卫 · 重命名走模态弹窗 · 面包屑分隔符修复 · 图片渲染
import { h, toast, status, fmtTime, modal, confirmDialog, icon, dropdown } from '../ui-kit.js';
import { renderMarkdown } from '../doc-render.js';
import { cardTools } from '../card-tools.js';

const LAYER_TEXT = { semantic: '语义记忆', episodic: '情景记忆', working: '工作记忆' };
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

// v4.1.0：引用验证溯源 —— 在渲染后的文档里定位并高亮"被具体引用的片段"。
// 片段取自 kb_ask 返回的 node.fts_text（已是纯文本），这里把渲染后 DOM 文本
// 与其做归一化（空白折叠）子串匹配，命中即高亮，使"点击验证链接 → 跳到对应内容"闭环。
/** 构建 归一化索引→原文偏移 的映射（连续空白折叠为单个占位） */
function normMap(orig) {
  const map = [];
  let i = 0;
  while (i < orig.length) {
    if (/\s/.test(orig[i])) { map.push(i); while (i < orig.length && /\s/.test(orig[i])) i++; }
    else { map.push(i); i++; }
  }
  return map;
}
/** 在单个文本节点内查找归一化片段，返回 {start,end} 原文偏移；否则 null */
function findRangeInNode(node, target) {
  const orig = node.nodeValue;
  const map = normMap(orig);
  const n = map.length;
  const T = target;
  for (let s = 0; s + T.length <= n; s++) {
    let ok = true;
    for (let k = 0; k < T.length; k++) {
      const oc = orig[map[s + k]];
      const onS = /\s/.test(oc), tnS = /\s/.test(T[k]);
      if (onS !== tnS) { ok = false; break; }
      if (!onS && oc !== T[k]) { ok = false; break; }
    }
    if (ok) {
      const start = map[s];
      const end = (s + T.length < n) ? map[s + T.length] : orig.length;
      return { start, end };
    }
  }
  return null;
}
function flashNode(elm) {
  elm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  elm.classList.add('is-flash');
  clearTimeout(elm._t);
  elm._t = setTimeout(() => elm.classList.remove('is-flash'), 1600);
}
/** 渲染完成后调用：定位并高亮 app.pendingHighlight（被引片段）；无则空操作 */
export function applyHighlight(rootEl) {
  const snip = app.pendingHighlight || null;
  app.pendingHighlight = null;
  // v6.9.0：真机渲染探针抓到「Cannot read properties of undefined (reading
  // 'querySelector')」—— load() 调用本函数时漏传根元素，每次打开卡片都抛一次
  // 未处理的 Promise 异常，引用溯源高亮因此从来没真正生效过。
  // 调用方已补参，这里再做一次防御：根元素缺失时静默降级，绝不打断阅读。
  const body = rootEl?.querySelector?.('.doc-body');
  if (!body || !snip) return;
  const target = String(snip).replace(/\s+/g, ' ').trim();
  if (!target) return;
  // ① 先在某个文本节点内精确命中（文档渲染把段落切成若干文本节点）
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
  let node = null, range = null;
  while ((node = walker.nextNode())) {
    const r = findRangeInNode(node, target);
    if (r) { range = r; break; }
  }
  if (range) {
    try {
      const rg = document.createRange();
      rg.setStart(node, range.start);
      rg.setEnd(node, range.end);
      const mark = document.createElement('mark');
      mark.className = 'cite-hit';
      rg.surroundContents(mark);
      flashNode(mark);
      return;
    } catch { /* 跨节点/异常，落到 ② */ }
  }
  // ② 退化：高亮包含该片段的最小块级元素整体（如段落内含加粗/代码导致被切分）
  const blocks = body.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, pre');
  for (const b of blocks) {
    if (String(b.textContent).replace(/\s+/g, ' ').includes(target)) {
      b.classList.add('cite-hit');
      flashNode(b);
      return;
    }
  }
}

export function mountDocument({ host, app, api, toast, status, setSelected, fmtTime, route }) {
  host.innerHTML = '';
  const wrap = h('div', { class: 'doc-wrap' });
  host.appendChild(wrap);

  let doc = null;
  let mode = 'read';
  let titles = new Set();
  let dirty = false;

  // ================================================================
  //  v2.3.0：对外暴露「当前卡片名 + 是否有未保存修改」。
  //
  //  用途：标题栏右上角的关闭按钮要弹确认框（用户需求）。
  //  确认框的文案必须**如实反映当前状态**：
  //    · 有未保存修改 → 必须明确告知"会丢失"，且按钮写「放弃并退出」
  //    · 没有未保存   → 只做一次轻量询问（是否最小化到托盘/直接退出）
  //  拿不到卡片名就只能写"当前卡片"，那等于没说实话。
  // ================================================================
  app.dirtyState = () => ({
    dirty,
    title: (() => {
      const id = app.currentId;
      if (!id) return '';
      const el = document.querySelector('#paneMid .doc-title, #paneMid [data-doc-title]');
      return (el?.textContent || '').trim();
    })(),
  });

  // 脏状态守卫：切换卡片前由 app.openCard 询问
  app.guardDirty = async () => {
    if (!dirty) return true;
    const go = await confirmDialog({
      title: '未保存的修改',
      message: '当前卡片有未保存的修改，离开将丢失。确定放弃并继续吗？',
      confirmText: '放弃修改',
    });
    if (go) dirty = false;
    return go;
  };

  async function loadTitles() {
    const r = await api.doc.tree();
    if (!r?.ok) return;
    const walk = (d) => { for (const f of d.files || []) titles.add(f.title); for (const s of d.dirs || []) walk(s); };
    titles = new Set();
    walk(r.data);
  }

  /** 本地图片 → neolink://vault/ 沙箱 URL（相对路径基于卡片所在目录解析） */
  function resolveImage(src) {
    try {
      const s = String(src || '').trim().replace(/^\.?\//, '');
      if (!s || /^(https?:|data:|blob:)/i.test(s)) return null;
      if (!IMG_EXT.test(s)) return null;
      if (s.includes('..')) return null;
      const base = doc && doc.path ? doc.path.slice(0, doc.path.lastIndexOf('/') + 1) : '';
      let rel = (base + s).replace(/\\/g, '/');
      // 规整 ./ 与 ../（在字符串层面；SafeResolver 仍会兜底）
      const parts = [];
      for (const seg of rel.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { parts.pop(); continue; }
        parts.push(seg);
      }
      if (!parts.length) return null;
      return 'neolink://vault/' + parts.map((p) => encodeURIComponent(p)).join('/');
    } catch { return null; }
  }

  function empty() {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'doc-empty' },
      h('div', { class: 'big' }, '还没有打开任何卡片'),
      h('div', { class: 'sub' }, '在左侧「卡片网络」里选一张，或按 Ctrl K 沿突触检索。也可以点左上角「＋」写第一张卡片——它会自动继承所有指向它的突触。')));
  }

  async function load(id) {
    if (!id) { dirty = false; empty(); return; }
    const r = await api.doc.read(id);
    if (!r?.ok) {
      dirty = false;
      wrap.innerHTML = '';
      wrap.appendChild(h('div', { class: 'doc-empty' }, h('div', { class: 'big' }, '读取失败'), h('div', { class: 'sub' }, r?.error || '')));
      toast(r?.error || '读取失败', 'err');
      return;
    }
    doc = r.data;
    app.currentPath = doc.path || null;   // 供审计核对「面包屑 == 真实路径」
    mode = 'read';
    dirty = false;
    try { render(); }
    catch (e) {
      console.error('[document] render failed', e);
      wrap.innerHTML = '';
      wrap.appendChild(        h('div', { class: 'doc-empty' },
          h('div', { class: 'big' }, '文档渲染失败'),
          h('div', { class: 'sub' }, String(e?.message || e) + '\n\n请按 F5 或重启应用；该问题已记录到控制台。')));
    }
    // v4.1.0：引用验证溯源 —— 渲染完成后定位并高亮被引片段（若有）
    // v6.9.0：补上根元素参数（此前无参调用，见 applyHighlight 内的说明）
    applyHighlight(wrap);
  }

  function head() {
    const segs = (doc.path || '').split('/').filter(Boolean);
    const crumb = h('div', { class: 'crumb' });
    segs.forEach((s, i) => {
      if (i) crumb.appendChild(h('span', { class: 'sep' }, '›'));
      // v2.2.0：面包屑段此前是**静态标签**，却带着 pointer 光标与悬停样式 ——
      // 看起来能点、点了没反应（与左栏目录行同款缺陷，那处已修，此处漏了）。
      //
      // v2.2.1：点击改为**在系统文件管理器里打开对应文件夹**（用户诉求：
      // 「点击可以跳转到对应文件夹」）。末段是卡片文件名，点了会在资源管理器里
      // **定位并选中**该文件；其余段是目录，点了直接打开该目录。
      //
      // 原来这里的"在左栏按目录过滤"能力没有丢 —— 左栏「卡片网络」的目录行
      // 本身就带这个过滤（点目录行即可），那才是应用内导航的入口。
      const dirUpTo = segs.slice(0, i + 1).join('/');
      const isLast = i === segs.length - 1;
      crumb.appendChild(h('span', {
        class: 'seg',
        title: isLast ? `在文件夹中定位「${s}」` : `打开文件夹「${dirUpTo}」`,
        onclick: async () => {
          const r = await api.vault?.revealPath?.(dirUpTo);
          if (!r?.ok) { toast(r?.error || '打开文件夹失败', 'err', 4000); return; }
          toast(r.mode === 'reveal-file' ? `已在文件夹中定位「${s}」` : `已打开文件夹「${s}」`, 'ok', 2400);
        },
      }, s));
    });

    const meta = h('div', { class: 'doc-meta' },
      h('span', { class: `badge ${doc.layer || 'semantic'} expert-only` }, LAYER_TEXT[doc.layer] || doc.layer),
      h('span', null, doc.path || ''),
      ...(doc.tags || []).map((t) => h('span', { class: 'badge tag-badge', title: `按标签「${t}」过滤卡片`, onclick: () => app.emit('tag', t) }, `#${t}`)),
      h('span', null, doc.size != null ? `${Math.max(1, Math.round(doc.size / 102.4) / 10)} KB` : ''),
      h('span', null, doc.mtime ? `更新于 ${fmtTime(new Date(doc.mtime).toISOString())}` : ''),
    );

    const tools = h('div', { class: 'doc-tools' },
      // v2.2.0：后退/前进在**没有历史可走时**此前仍渲染成可点的样子，
      // 点了什么也不会发生（hIndex 已在头/尾）。现在如实置灰 ——
      // 界面上的可点性必须对得上真实状态，不能"看着能点其实不能"。
      h('button', {
        class: 'btn ghost icon-only', title: '联想轨迹后退（Alt+←）', 'aria-label': '后退',
        disabled: !(app.hIndex > 0),
        onclick: () => app.back?.(), html: icon('arrowL', 12),
      }),
      h('button', {
        class: 'btn ghost icon-only', title: '联想轨迹前进（Alt+→）', 'aria-label': '前进',
        disabled: !(app.hIndex < app.history.length - 1),
        onclick: () => app.forward?.(), html: icon('arrowR', 12),
      }),
      h('div', { class: 'mode-switch' },
        h('button', { class: mode === 'read' ? 'is-on' : '', onclick: () => switchMode('read') }, '阅读'),
        h('button', { class: mode === 'edit' ? 'is-on' : '', onclick: () => switchMode('edit') }, '编辑')),
      h('button', { class: 'btn ghost', title: '在星图中定位', onclick: () => { app.pendingFocus = doc.id; route('graph'); } }, '星图'),
      // v6.38.0：原创增强——顶部星标，切换收藏只更新按钮，不切模式、不丢正文。
      (() => {
        const on = cardTools.isStarred(doc.id);
        return h('button', {
          class: 'btn ghost icon-only doc-star' + (on ? ' is-on' : ''),
          title: on ? '取消收藏' : '收藏这张卡片', 'aria-label': on ? '取消收藏' : '收藏',
          onclick: (e) => {
            const now = cardTools.toggleStar(doc.id);
            e.currentTarget.classList.toggle('is-on', now);
            e.currentTarget.textContent = now ? '★' : '☆';
            e.currentTarget.title = now ? '取消收藏' : '收藏这张卡片';
            toast(now ? '已加入收藏夹' : '已取消收藏', 'ok');
          },
        }, on ? '★' : '☆');
      })(),
      h('button', {
        class: 'btn ghost icon-only', title: '更多操作', 'aria-label': '更多操作', html: icon('dots', 14),
        onclick: (ev) => dropdown(ev.currentTarget, [
          { label: '导出 .md（分享 / 归档）', icon: 'open', onClick: onExport },
          { label: '复制卡片深链（neolink://）', icon: 'link', onClick: onCopyLink },
          { label: '重命名（旧标题自动成别名）', icon: 'edit', onClick: onRename },
          { sep: true },
          { label: '归档（优雅遗忘，不真删）', icon: 'archive', danger: true, onClick: onArchive },
        ]),
      }),
    );

    return h('div', { class: 'doc-head' },
      crumb,
      h('div', { class: 'doc-title-row' }, h('div', { class: 'doc-title' }, doc.title || '未命名'), tools),
      meta,
    );
  }

  async function switchMode(next) {
    if (next === mode) return;
    if (mode === 'edit' && dirty) {
      const go = await confirmDialog({
        title: '未保存的修改',
        message: '有未保存的修改，放弃并切换模式？',
        confirmText: '放弃修改',
      });
      if (!go) return;
      dirty = false;
    }
    mode = next;
    render();
  }

  function outlineBox(anchors, scroller) {
    if (!anchors.length) return null;
    // v6.36.0：大纲改为正文右侧常驻导航。它不再是 details 浮层，
    // 不会因为滚动 / 跳转自动收起；点击标题定位后保留当前所在章节高亮。
    const box = h('nav', { class: 'outline', 'aria-label': '正文大纲' },
      h('div', { class: 'o-head' },
        h('span', null, '正文大纲'),
        h('b', null, `${anchors.length} 节`)));
    for (const a of anchors) {
      const b = h('button', {
        class: 'o-item',
        'data-outline-id': a.id,
        style: { paddingLeft: `${6 + (a.level - 1) * 9}px` },
      }, a.text);
      b.addEventListener('click', () => {
        const t = document.getElementById(a.id);
        if (!t) return;
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        for (const el of wrap.querySelectorAll('.md-h.is-jump-target')) el.classList.remove('is-jump-target');
        t.classList.add('is-jump-target');
        for (const item of box.querySelectorAll('.o-item')) item.classList.remove('is-active');
        b.classList.add('is-active');
        clearTimeout(b._jumpTimer);
        b._jumpTimer = setTimeout(() => t.classList.remove('is-jump-target'), 1400);
      });
      box.appendChild(b);
    }
    function syncActive() {
      const top = (scroller?.getBoundingClientRect().top || 0) + 72;
      let currentId = '';
      for (const a of anchors) {
        const el = document.getElementById(a.id);
        if (el && el.getBoundingClientRect().top <= top) currentId = a.id;
        else break;
      }
      for (const item of box.querySelectorAll('.o-item')) {
        item.classList.toggle('is-active', item.getAttribute('data-outline-id') === currentId);
      }
    }
    scroller?.addEventListener('scroll', syncActive, { passive: true });
    setTimeout(syncActive, 0);
    return box;
  }

  function render() {
    wrap.innerHTML = '';
    wrap.appendChild(head());

    if (mode === 'edit') {
      const ta = h('textarea', { class: 'doc-editor', spellcheck: 'false', 'aria-label': '正文编辑器' });
      ta.value = doc.raw || '';
      ta.addEventListener('input', () => { dirty = true; syncSlash(); });

      // A3：写作区 "/" 呼出插入菜单（标题 / 列表 / 双链 / 表格…）
      const slashMenu = h('div', { class: 'slash-menu' });
      const SLASH_ITEMS = [
        { label: '标题', hint: '##', text: '## ', caret: 0 },
        { label: '小标题', hint: '###', text: '### ', caret: 0 },
        { label: '列表', hint: '-', text: '- ', caret: 0 },
        { label: '待办', hint: '[ ]', text: '- [ ] ', caret: 0 },
        { label: '引用', hint: '>', text: '> ', caret: 0 },
        { label: '代码块', hint: '```', text: '```\n\n```', caret: -4 },
        { label: '表格', hint: '| |', text: '| 列1 | 列2 |\n| --- | --- |\n|  |  |', caret: 0 },
        { label: '双链', hint: '[[ ]]', text: '[[]]', caret: -2 },
        { label: '标签', hint: '#', text: '#', caret: 0 },
        { label: '分隔线', hint: '---', text: '\n---\n\n', caret: 0 },
      ];
      let slashOpenFlag = false, slashCur = 0, slashList = [], slashFrom = -1;
      const scroll = h('div', { class: 'doc-scroll' }, ta, slashMenu);
      const closeSlash = () => { slashOpenFlag = false; slashMenu.classList.remove('is-open'); };
      const caretXY = () => {
        const div = document.createElement('div');
        const cs = getComputedStyle(ta);
        for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'width', 'boxSizing', 'borderWidth']) div.style[p] = cs[p];
        div.style.position = 'absolute'; div.style.visibility = 'hidden'; div.style.left = '-9999px';
        div.style.whiteSpace = 'pre-wrap'; div.style.wordWrap = 'break-word';
        div.textContent = ta.value.slice(0, ta.selectionStart);
        const span = document.createElement('span');
        span.textContent = ta.value.slice(ta.selectionStart) || '.';
        div.appendChild(span);
        document.body.appendChild(div);
        const x = span.offsetLeft - ta.scrollLeft, y = span.offsetTop - ta.scrollTop;
        div.remove();
        return { x, y };
      };
      const paintSlash = () => {
        slashMenu.innerHTML = '';
        slashList.forEach((it, i) => {
          slashMenu.appendChild(h('div', {
            class: 'slash-item' + (i === slashCur ? ' is-cur' : ''),
            onmousedown: (ev) => { ev.preventDefault(); pickSlash(i); },
          }, h('span', null, it.label), h('span', { class: 'si-hint' }, it.hint)));
        });
      };
      const openSlash = (query) => {
        const q = String(query || '').toLowerCase();
        slashList = SLASH_ITEMS.filter((it) => !q || it.label.toLowerCase().includes(q) || String(it.hint).includes(q));
        if (!slashList.length) { closeSlash(); return; }
        slashCur = 0; slashOpenFlag = true;
        paintSlash();
        const { x, y } = caretXY();
        slashMenu.style.left = `${Math.max(8, Math.min(ta.offsetLeft + x, ta.offsetLeft + ta.clientWidth - 244))}px`;
        slashMenu.style.top = `${ta.offsetTop + y + 24}px`;
        slashMenu.classList.add('is-open');
      };
      const syncSlash = () => {
        const pos = ta.selectionStart;
        const before = ta.value.slice(0, pos);
        const m = before.match(/(?:^|\n|\s)\/([\w\u4e00-\u9fa5]*)$/);
        if (m) { slashFrom = pos - m[1].length - 1; openSlash(m[1]); }
        else closeSlash();
      };
      const pickSlash = (i) => {
        const it = slashList[i != null ? i : slashCur];
        if (!it) return;
        const pos = ta.selectionStart;
        const start = (slashFrom >= 0 && slashFrom <= pos) ? slashFrom : pos - 1;
        ta.value = ta.value.slice(0, start) + it.text + ta.value.slice(pos);
        const end = start + it.text.length + it.caret;
        ta.setSelectionRange(end, end);
        dirty = true;
        closeSlash();
        ta.focus();
      };
      ta.addEventListener('keydown', (ev) => {
        if (!slashOpenFlag) return;
        if (ev.key === 'ArrowDown') { ev.preventDefault(); slashCur = (slashCur + 1) % slashList.length; paintSlash(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); slashCur = (slashCur - 1 + slashList.length) % slashList.length; paintSlash(); }
        else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickSlash(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); closeSlash(); }
      });
      ta.addEventListener('blur', () => setTimeout(closeSlash, 180));
      wrap.appendChild(scroll);
      wrap.appendChild(h('div', { class: 'doc-foot' },
        h('button', { class: 'btn', onclick: () => save(ta.value) }, '保存（Ctrl+S）'),
        h('button', { class: 'btn ghost', onclick: async () => {
          if (dirty) {
            const go = await confirmDialog({ title: '未保存的修改', message: '放弃本次修改并返回阅读模式？', confirmText: '放弃修改' });
            if (!go) return;
          }
          dirty = false; mode = 'read'; render();
        } }, '取消'),
        h('span', { class: 'dirty-hint', style: { fontSize: '11px', color: dirty ? 'var(--gold)' : 'var(--dim)' } },
          dirty ? '● 有未保存的修改' : '保存会进写审计 journal，可溯源；自动化永不改写此区'),
      ));
      setTimeout(() => ta.focus(), 30);
      return;
    }

    const layout = h('div', { class: 'doc-layout' });
    const scroll = h('div', { class: 'doc-scroll' });
    const body = h('div', { class: 'doc-body' });
    const { root, anchors } = renderMarkdown(doc.body || '', {
      known: titles,
      onLink: (target, broken) => onLink(target, broken),
      onTag: (t) => app.emit('tag', t),
      onExternal: (url) => api.openExternal?.(url),
      resolveImage,
    });
    body.appendChild(root);
    scroll.appendChild(body);
    layout.appendChild(scroll);
    // v6.40.0：正文大纲回归「每篇文档自己的固定目录列」。
    // 用户实测截图里旧的悬浮面板机制把大纲做成脱离文档流的浮窗，切文档时
    // render() 反复挂新面板、旧面板残留叠加成 4 份，还压住正文。
    // 根治：大纲作为 .doc-layout 的固定右侧列（.doc-scroll 正文 + .outline 目录），
    // 随 wrap.innerHTML='' 一起销毁重建 —— 一篇文档永远只有一份目录，不悬浮、
    // 不拖动、不持久化位置，也不再遮挡任何正文。滚动高亮仍监听 .doc-scroll。
    const ob = outlineBox(anchors, scroll);
    if (ob) layout.appendChild(ob);
    wrap.appendChild(layout);
  }

  async function onLink(target, broken) {
    if (!broken) {
      const ok = await app.openByTitle(target);
      if (!ok) toast(`未找到「${target}」`, 'err');
      return;
    }
    const go = await confirmDialog({
      title: '待生长的突触',
      message: `「${target}」尚不存在。\n\n现在生长为新卡片？它会立即自动继承所有指向它的突触。`,
      confirmText: '生长新卡片',
      danger: false,
    });
    if (!go) return;
    const res = await api.doc.create({ title: target, folder: '_memory/semantic' });
    if (res?.ok) {
      toast(`已生长「${res.data.title}」${res.data.inherited ? ` · 继承 ${res.data.inherited} 条突触` : ''}`, 'ok');
      await app.refreshVault();
      await loadTitles();
      await app.openCard(res.data.id);
    } else toast(res?.error || '生长失败', 'err');
  }

  async function save(text) {
    const res = await api.doc.save(doc.id, text);
    if (res?.ok) {
      dirty = false;
      status('已保存并重建该卡突触');
      toast('已保存', 'ok');
      await app.refreshVault();
      await loadTitles();
      await load(doc.id);
    } else toast(res?.error || '保存失败', 'err');
  }

  /** Ctrl+S 入口：编辑态才响应 */
  function saveIfEditing() {
    if (mode !== 'edit' || !doc) return;
    const ta = wrap.querySelector('.doc-editor');
    if (ta) save(ta.value);
  }

  /** 导出单卡为 .md（分享 / 归档 / 团队交换） */
  async function onExport() {
    if (!doc) return;
    const r = await api.doc.export(doc.id);
    if (r?.ok) toast(`已导出到：${r.path}`, 'ok', 4200);
    else if (!r?.canceled) toast(r?.error || '导出失败', 'err');
  }

  /** 复制卡片深链：neolink://open/<库ID>/<卡片ID>，可粘给外部 Agent 或浏览器唤起本客户端 */
  async function onCopyLink() {
    if (!doc) return;
    const link = app.deepLinkFor?.(doc.id);
    if (!link) { toast('无法生成深链：当前知识库尚未就绪', 'err'); return; }
    try {
      await navigator.clipboard?.writeText(link);
      toast('已复制卡片深链：' + link, 'ok', 4200);
    } catch (e) {
      toast('复制失败：' + String(e?.message || e), 'err');
    }
  }

  async function onRename() {
    if (!doc) return;
    const vals = await modal({
      title: '重命名卡片',
      message: '文件会同步改名；其他卡片里写的旧标题会作为别名保留，[[旧标题]] 依然能跳转。',
      fields: [{ key: 'title', label: '新标题', type: 'text', required: true, value: doc.title || '' }],
      confirmText: '重命名',
    });
    if (!vals) return;
    const t = vals.title.trim();
    if (!t || t === doc.title) return;
    const res = await api.doc.rename(doc.id, t);
    if (res?.ok) {
      toast(`已重命名${res.data.relinked ? ` · 重建 ${res.data.relinked} 条入链` : ''}`, 'ok');
      await app.refreshVault();
      await loadTitles();
      await app.openCard(res.data.id);
      app.emit('tree');
    } else toast(res?.error || '重命名失败', 'err');
  }

  async function onArchive() {
    if (!doc) return;
    const go = await confirmDialog({
      title: '归档（优雅遗忘）',
      message: `把「${doc.title}」移入 _graveyard？\n\n卡片与其突触被归档而非删除，随时可从磁盘取回。`,
      confirmText: '归档',
    });
    if (!go) return;
    const res = await api.doc.archive(doc.id);
    if (res?.ok) {
      toast('已归档（优雅遗忘）', 'ok');
      await app.refreshVault();
      app.currentId = null;
      await load(null);
      app.emit('tree');
    } else toast(res?.error || '归档失败', 'err');
  }

  app.on((kind) => {
    if (kind === 'vault') { loadTitles(); }
    if (kind === 'open') load(app.currentId);
  });

  loadTitles();
  if (app.currentId) load(app.currentId); else empty();
  return { refresh: () => load(app.currentId), saveIfEditing };
}
