// Markdown 自研解析器（零依赖）
// 按 CommonMark 公开规范 + 社区通用 [[wikilink]] / #标签 / YAML frontmatter 约定实现。
// 不引用任何专有运行时。仅做"读取与抽取"，绝不改写用户正文。

// 极简 YAML frontmatter 解析（支持 key: value 与 key: [a, b] 列表，足够本产品使用）
function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  const meta = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)([\w.-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[2];
    let val = m[3].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      meta[key] = val.replace(/^["']|["']$/g, '');
    }
    i++;
  }
  return meta;
}

export function extractFrontmatter(text) {
  const fm = {};
  let body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    Object.assign(fm, parseFrontmatter(m[1]));
    body = text.slice(m[0].length);
  }
  return { frontmatter: fm, body };
}

// 抽取 [[wikilinks]]（支持 [[目标|别名]]）
export function extractWikilinks(body) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let mt;
  while ((mt = re.exec(body)) !== null) {
    const inner = mt[1];
    const [target, alias] = inner.split('|').map((s) => s.trim());
    out.push({ target, alias: alias || null });
  }
  return out;
}

// 抽取 #标签（行内 #tag 与 #tag/subtag）
export function extractTags(body) {
  const out = new Set();
  const re = /(?:^|\s)#([A-Za-z0-9_\u4e00-\u9fa5/-]+)/g;
  let mt;
  while ((mt = re.exec(body)) !== null) {
    out.add(mt[1]);
  }
  return [...out];
}

// 抽取大纲：仅取正文标题（跳过代码块内的 # 注释行）
export function extractOutline(body) {
  const out = [];
  const lines = String(body || '').split('\n');
  let inFence = false;
  let seq = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      out.push({
        level: m[1].length,
        text: m[2].replace(/[*_`]/g, '').trim(),
        line: i,
        anchor: `h-${seq++}`,
      });
    }
  }
  return out;
}

// 取标题：优先首个 # 标题，否则文件名
export function extractTitle(body, fallback) {
  const m = body.match(/^\s*#\s+(.+)$/m);
  if (m) return m[1].trim();
  const base = String(fallback || '').replace(/\.md$/i, '');
  return base || '未命名';
}

// 生成用于全文检索的纯文本（剥离 markdown 语法符号）
export function toPlainText(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')      // 代码块
    .replace(/`[^`]*`/g, ' ')            // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // wikilink -> 目标名
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')         // 普通链接 -> 文本
    .replace(/^#{1,6}\s+/gm, '')          // 标题符号
    .replace(/[*_~>#]/g, ' ')             // 强调/引用符号
    .replace(/\s+/g, ' ')
    .trim();
}

// 在文件末尾受保护区追加沉淀内容（对应 R3，永不覆盖人写段落）
export function appendToSedimentZone(originalText, block) {
  const BEGIN = '<!-- neokb:沉淀区 begin -->';
  const END = '<!-- neokb:沉淀区 end -->';
  if (originalText.includes(BEGIN)) {
    // 在 END 前插入新块
    const idx = originalText.lastIndexOf(END);
    const before = originalText.slice(0, idx);
    const after = originalText.slice(idx);
    return `${before}\n${block}\n${after}`;
  }
  // 首次：新建受保护区
  return `${originalText.replace(/\s*$/, '')}\n\n${BEGIN}\n${block}\n${END}\n`;
}
