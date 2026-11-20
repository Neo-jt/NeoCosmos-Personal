// ================================================================
//  Card Tools · 收藏与近期（v6.38.0 原创增强）
// ================================================================
//  定位：纯前端、localStorage 持久化的"个人工作台"偏好层。
//  设计纪律（与全局真实性红线一致）：
//    · 只用用户本机数据，不联网、不上传、不臆造任何卡片；
//    · 星标/近期只存 id 与本地时间戳，正文永远来自真实 doc API；
//    · 单一来源：所有视图都经本模块读写，避免多处 localStorage 键漂移；
//    · 损坏数据静默归零，绝不因为一段坏 JSON 让界面崩掉。
//
//  这是一组"知识管理产品的公开通用能力"的原创实现：
//  代码、数据结构、键名、交互均为本项目自有，未引用任何第三方实现。
// ================================================================

const K_STAR = 'neokb-card-stars-v1';
const K_RECENT = 'neokb-card-recent-v1';
const RECENT_MAX = 40;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch { return fallback; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/** 星标集合（返回 Set<string>） */
function loadStars() {
  const raw = readJSON(K_STAR, { ids: [] });
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((x) => typeof x === 'string') : [];
  return new Set(ids);
}

function saveStars(set) {
  return writeJSON(K_STAR, { ids: [...set] });
}

/** 近期访问列表：[{ id, at }]，新→旧 */
function loadRecent() {
  const raw = readJSON(K_RECENT, { items: [] });
  const items = Array.isArray(raw.items)
    ? raw.items.filter((x) => x && typeof x.id === 'string' && Number.isFinite(x.at))
    : [];
  return items.slice(0, RECENT_MAX);
}

function saveRecent(items) {
  return writeJSON(K_RECENT, { items: items.slice(0, RECENT_MAX) });
}

export const cardTools = {
  /** 是否已收藏 */
  isStarred(id) { return !!id && loadStars().has(id); },

  /** 切换收藏，返回切换后的状态 */
  toggleStar(id) {
    if (!id) return false;
    const s = loadStars();
    if (s.has(id)) s.delete(id); else s.add(id);
    saveStars(s);
    return s.has(id);
  },

  /** 全部收藏 id（插入顺序） */
  starredIds() { return [...loadStars()]; },

  /** 收藏数量 */
  starCount() { return loadStars().size; },

  /** 记录一次访问（同 id 去重并前移） */
  touch(id) {
    if (!id) return;
    const items = loadRecent().filter((x) => x.id !== id);
    items.unshift({ id, at: Date.now() });
    saveRecent(items);
  },

  /** 近期访问 id 列表（新→旧） */
  recentIds() { return loadRecent().map((x) => x.id); },

  /** 清除近期（不影响收藏） */
  clearRecent() { saveRecent([]); },
};

export default cardTools;
