// NeoLink · Markdown 渲染器（自研，零依赖）
// ---------------------------------------------------------------------------
// 只渲染知识库正文需要的子集，且刻意做成"关系感知"的：
//   · [[双链]]  -> 可点击跳转（目标不存在时渲染为断链，点击即"生长"新卡片）
//   · #标签      -> 可点击筛选
//   · 本地图片   -> 相对路径经 neolink://vault/ 沙箱协议渲染（v1.1.0）
//   · 沉淀区标记 -> 独立色块（AI 回写内容与人写正文在视觉上分列）
// 安全：全程 createElement + textContent，绝不用 innerHTML 拼用户内容。
// ---------------------------------------------------------------------------

const SED_BEGIN = '<!-- neolink:沉淀区 begin -->';
const SED_END = '<!-- neolink:沉淀区 end -->';

const INLINE_RE = new RegExp([
  '(`[^`]+`)',                                   // 1 行内代码
  '(\\[\\[[^\\]]+\\]\\])',                       // 2 双链
  '(#[A-Za-z0-9_\\u4e00-\\u9fa5/-]+)',           // 3 标签
  '(\\*\\*[^*]+\\*\\*)',                         // 4 加粗
  '(~~[^~]+~~)',                                 // 5 删除线
  '(\\*[^*\\n]+\\*)',                            // 6 斜体
  '(!\\[[^\\]]*\\]\\([^)]*\\))',                 // 7 图片
  '(\\[[^\\]]+\\]\\([^)]*\\))',                  // 8 普通链接
].join('|'), 'g');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** 行内渲染：把一段纯文本切成 DOM 节点 */
function inline(text, ctx, parent) {
  let last = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    if (m[1]) {
      parent.appendChild(el('code', 'md-code', tok.slice(1, -1)));
    } else if (m[2]) {
      const inner = tok.slice(2, -2);
      const [target, alias] = inner.split('|').map((s) => s.trim());
      const known = ctx.known && ctx.known.has ? ctx.known.has(target) : null;
      const broken = known === false;
      const a = el('a', 'md-link' + (broken ? ' is-broken' : ''), alias || target);
      a.dataset.link = target;
      a.title = broken ? `断链：${target}（点击生长为新卡片，并自动继承指向它的突触）` : `跳转到 ${target}`;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (ctx.onLink) ctx.onLink(target, broken);
      });
      parent.appendChild(a);
    } else if (m[3]) {
      const t = tok.slice(1);
      const s = el('span', 'md-tag', tok);
      s.title = `按标签筛选：${t}`;
      s.addEventListener('click', () => { if (ctx.onTag) ctx.onTag(t); });
      parent.appendChild(s);
    } else if (m[4]) {
      parent.appendChild(el('strong', 'md-strong', tok.slice(2, -2)));
    } else if (m[5]) {
      parent.appendChild(el('del', 'md-del', tok.slice(2, -2)));
    } else if (m[6]) {
      parent.appendChild(el('em', 'md-em', tok.slice(1, -1)));
    } else if (m[7] || m[8]) {
      const mm = tok.match(/!?\[([^\]]*)\]\(([^)]*)\)/);
      if (!mm) { parent.appendChild(document.createTextNode(tok)); }
      else if (m[7]) {
        renderImage(mm[1], mm[2], ctx, parent);
      } else {
        const a = el('a', 'md-link', mm[1] || mm[2]);
        a.title = mm[2];
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (ctx.onExternal) ctx.onExternal(mm[2]);
        });
        parent.appendChild(a);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  return parent;
}

/** 图片渲染：本地相对路径 → neolink://vault/ 沙箱 URL；http(s) → 外链；失败回退占位块 */
function renderImage(alt, src, ctx, parent) {
  const rawSrc = String(src || '').trim();
  if (/^https?:\/\//i.test(rawSrc)) {
    const a = el('a', 'md-link', alt || rawSrc);
    a.title = `${rawSrc}（外部图片，点击在浏览器打开）`;
    a.addEventListener('click', (ev) => { ev.preventDefault(); if (ctx.onExternal) ctx.onExternal(rawSrc); });
    parent.appendChild(a);
    return;
  }
  let url = null;
  if (ctx.resolveImage) url = ctx.resolveImage(rawSrc);
  if (!url) {
    parent.appendChild(el('span', 'md-img', `图片：${alt || rawSrc}`));
    return;
  }
  const img = document.createElement('img');
  img.className = 'md-img-real';
  img.alt = alt || rawSrc;
  img.loading = 'lazy';
  img.src = url;
  img.addEventListener('error', () => {
    const chip = el('span', 'md-img', `图片缺失：${alt || rawSrc}`);
    img.replaceWith(chip);
  });
  parent.appendChild(img);
}

function para(text, ctx) {
  const p = el('p', 'md-p');
  inline(text, ctx, p);
  return p;
}

const isTableSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
const splitRow = (s) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((x) => x.trim());

/**
 * 渲染正文
 * @param {string} body 正文（不含 frontmatter）
 * @param {{known?:Set<string>, onLink?:Function, onTag?:Function, onExternal?:Function, resolveImage?:Function}} ctx
 * @returns {{root:HTMLElement, anchors:Array<{level:number,text:string,id:string}>}}
 */
export function renderMarkdown(body, ctx = {}) {
  const root = el('div', 'md-root');
  const anchors = [];
  // v6.9.0 关键修复：Windows 知识库里的 .md 绝大多数是 CRLF 行尾。
  // 原来直接 split('\n')，每行末尾会残留一个 \r；而 JS 正则里 \r 属于
  // 「行终止符」，`.` 不匹配它 —— 于是 /^(#{1,6})\s+(.*)$/ 全线失配，
  // 所有 Markdown 标题都被降级渲染成带井号的普通段落，大纲也拿不到标题。
  // 真机探针实测：README.md 的 H1/H2 全部变成 <p class="md-p"># …</p>。
  // 统一归一化行尾即可一次性修复标题 / 分隔线 / 代码块 / 表格的边界判定。
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let seq = 0;

  const pushSediment = (blockLines) => {
    const box = el('div', 'md-sediment');
    const head = el('div', 'sz-head', '沉淀区 · 由 Agent 回写（不覆盖人写正文）');
    box.appendChild(head);
    const inner = el('div', 'sz-body');
    // 沉淀区内部按普通正文渲染，但不重复包裹
    let buf = [];
    const flush = () => { if (buf.length) { inline(buf.join('\n'), ctx, inner); inner.appendChild(document.createElement('br')); buf = []; } };
    for (const l of blockLines) {
      if (l.trim() === SED_BEGIN || l.trim() === SED_END) continue;
      buf.push(l);
    }
    flush();
    box.appendChild(inner);
    root.appendChild(box);
  };

  while (i < lines.length) {
    const line = lines[i];

    // 沉淀区
    if (line.trim() === SED_BEGIN) {
      const block = [];
      i++;
      while (i < lines.length && lines[i].trim() !== SED_END) { block.push(lines[i]); i++; }
      i++; // 跳过 END
      pushSediment(block);
      continue;
    }

    // 代码块
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3);
      const lang = line.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence}`).test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      const pre = el('pre', 'md-pre');
      const code = el('code', lang ? `lang-${lang}` : '', buf.join('\n'));
      pre.appendChild(code);
      root.appendChild(pre);
      continue;
    }

    // 标题
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lv = hm[1].length;
      const id = `h-${seq++}`;
      const h = el(`h${lv}`, `md-h md-h${lv}`);
      h.id = id;
      inline(hm[2], ctx, h);
      anchors.push({ level: lv, text: h.textContent, id });
      root.appendChild(h);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { root.appendChild(el('hr', 'md-hr')); i++; continue; }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(splitRow(lines[i])); i++; }
      const table = el('table', 'md-table');
      const thead = el('thead'); const htr = el('tr');
      for (const c of head) { const th = el('th'); inline(c, ctx, th); htr.appendChild(th); }
      thead.appendChild(htr); table.appendChild(thead);
      const tb = el('tbody');
      for (const r of rows) {
        const tr = el('tr');
        for (const c of r) { const td = el('td'); inline(c, ctx, td); tr.appendChild(td); }
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      root.appendChild(table);
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const q = el('blockquote', 'md-quote');
      inline(buf.join('\n'), ctx, q);
      root.appendChild(q);
      continue;
    }

    // 列表（含任务列表）
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const list = el(ordered ? 'ol' : 'ul', ordered ? 'md-ol' : 'md-ul');
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const li = el('li', 'md-li');
        const tm = raw.match(/^\[( |x|X)\]\s+(.*)$/);
        if (tm) {
          li.classList.add('md-task');
          const cb = el('span', 'md-check' + (tm[1] === ' ' ? '' : ' is-done'), tm[1] === ' ' ? '○' : '✓');
          li.appendChild(cb);
          const span = el('span');
          if (tm[1] !== ' ') span.classList.add('is-done-text');
          inline(tm[2], ctx, span);
          li.appendChild(span);
        } else {
          inline(raw, ctx, li);
        }
        list.appendChild(li);
        i++;
      }
      root.appendChild(list);
      continue;
    }

    // 空行
    if (line.trim() === '') { i++; continue; }

    // 段落（连续行合并）
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ''
      && !/^\s*(```|~~~)/.test(lines[i])
      && !/^#{1,6}\s/.test(lines[i])
      && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && lines[i].trim() !== SED_BEGIN) { buf.push(lines[i]); i++; }
    root.appendChild(para(buf.join('\n'), ctx));
  }

  return { root, anchors };
}
