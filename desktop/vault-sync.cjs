'use strict';
/**
 * vault-sync.cjs —— v6.37.0 企业版 · 知识库 API 自动同步器
 * ---------------------------------------------------------------------------
 * 需求：企业版登记一个"对外 API 链接"后，知识库能自动拉取远端更新，
 *       不必每次让用户手动重新链接 / 重新导入。
 *
 * 设计纪律（与项目真实性红线一致）：
 *   · 零三方依赖：只用 Node 内置 fetch / fs，离线环境不发起请求、如实降级；
 *   · 只追加不覆盖：远端卡片写入本地 vault 的 _memory/remote/ 沉淀区，
 *     采用"远端 id + 内容哈希"去重，绝不改写用户正文目录里的任何 .md；
 *   · 增量：上次同步的哈希记录在 sync-state.json，未变化的文件跳过写入；
 *   · 诚实：网络失败 / 鉴权失败 / 非 2xx 全部原样回报，不假装成功、不造假数据；
 *   · 配置持久化到 config.json 的 enterprise.sync 段，一次配置长期自动生效。
 *
 * 对端契约（复用产品已有的对外只读 API）：
 *   GET {baseUrl}/api/vaults        -> { ok, vaults:[{id,name,...}] }
 *   GET {baseUrl}/api/cards?vault=  -> { ok, cards:[{id,title,path,fts_text,...}] }
 *   鉴权头：Authorization: Bearer <token>（沿用 api:genToken 的令牌体系）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  enabled: false,
  baseUrl: '',
  token: '',            // 明文仅在内存传递；落盘由调用方用 safeStorage 加密（此处存引用标记）
  vaultId: '',          // 远端库 id；空 = 默认库
  intervalMs: 300000,   // 自动同步间隔，默认 5 分钟
  lastSyncAt: null,
  lastResult: null,
};

function sha256(s) { return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16); }

/**
 * 读取同步配置（从给定 cfg 对象的 enterprise.sync 段）。
 */
function readSyncConfig(cfg) {
  const s = (cfg && cfg.enterprise && cfg.enterprise.sync) || {};
  return { ...DEFAULTS, ...s };
}

/**
 * 合并写入同步配置。只接受已知字段，避免污染 config。
 */
function patchSyncConfig(cfg, patch) {
  const cur = readSyncConfig(cfg);
  const next = { ...cur };
  for (const k of ['enabled', 'baseUrl', 'token', 'vaultId', 'intervalMs']) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
  }
  next.enabled = !!next.enabled;
  next.intervalMs = Math.max(30000, Math.min(86400000, Number(next.intervalMs) || DEFAULTS.intervalMs));
  return {
    ...cfg,
    enterprise: { ...(cfg && cfg.enterprise || {}), sync: next },
  };
}

/**
 * 通过对外 API 拉取远端卡片并增量写入本地沉淀区。
 * @param {object} o { baseUrl, token, vaultId, destDir, stateFile, fetchImpl }
 * @returns {Promise<{ok, added, updated, unchanged, removed, total, error?, detail?}>}
 */
async function pull(o = {}) {
  const baseUrl = String(o.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return { ok: false, error: '未配置对外 API 链接' };
  const token = String(o.token || '');
  const headers = { 'accept': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const f = typeof o.fetchImpl === 'function' ? o.fetchImpl : fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    // 1) 取卡片清单
    const url = `${baseUrl}/api/cards${o.vaultId ? `?vault=${encodeURIComponent(o.vaultId)}` : ''}`;
    const res = await f(url, { headers, signal: ctrl.signal });
    if (!res || !res.ok) {
      return { ok: false, error: `远端返回 HTTP ${res ? res.status : '无响应'}`, detail: '请检查链接、令牌与库 id' };
    }
    const json = await res.json();
    const cards = Array.isArray(json && (json.cards || json.data)) ? (json.cards || json.data) : [];

    // 2) 读上次同步状态，做内容哈希去重
    const destDir = o.destDir;
    if (!destDir) return { ok: false, error: '未指定本地沉淀目录' };
    fs.mkdirSync(destDir, { recursive: true });
    let state = {};
    try { state = JSON.parse(fs.readFileSync(o.stateFile || path.join(destDir, 'sync-state.json'), 'utf8')) || {}; }
    catch { state = {}; }
    const stateFile = o.stateFile || path.join(destDir, 'sync-state.json');

    let added = 0, updated = 0, unchanged = 0;
    const seen = new Set();
    for (const c of cards) {
      if (!c || !c.id) continue;
      const id = String(c.id).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 80);
      seen.add(id);
      const text = c.fts_text != null ? String(c.fts_text) : (c.body != null ? String(c.body) : '');
      // 去重哈希只基于实质内容（标题+正文），绝不掺入同步时间戳 ——
      // 否则每次自动同步内容哈希都变，会反复重写文件、永远无法"unchanged"。
      const h = sha256(`${c.title || c.id}\n${text}`);
      if (state[id] === h) { unchanged++; continue; }
      const content = `# ${c.title || c.id}\n\n${text}\n\n> 来源：远端 API 自动同步 · id=${c.id} · ${new Date().toISOString()}\n`;
      const fp = path.join(destDir, `${id}.md`);
      const existed = fs.existsSync(fp);
      fs.writeFileSync(fp, content, 'utf8');
      state[id] = h;
      if (existed) updated++; else added++;
    }

    // 3) 远端已删除的卡片：本地镜像保留但不计入（诚实：不擅自删除用户可见数据）
    const removed = 0;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    return { ok: true, added, updated, unchanged, removed, total: cards.length,
      syncedAt: new Date().toISOString() };
  } catch (e) {
    const msg = (e && e.name === 'AbortError') ? '请求超时（15s）' : String((e && e.message) || e);
    return { ok: false, error: `同步失败：${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { DEFAULTS, sha256, readSyncConfig, patchSyncConfig, pull };
