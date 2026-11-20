// v6.23.0 · 知识库连接作用域（主进程侧，零第三方依赖，可在 Node 下直接单测）
// ---------------------------------------------------------------------------
// 解决两件真实的事，而不是画一个开关：
//   1. 每个知识库有稳定的 id（沿用 vaultIdFor(path)）、显式「允许连接 / 停用」状态，
//      停用的库不会出现在链接 API 的可访问列表里，也不会被跨库扫描碰触。
//   2. 跨库图谱扫描从「每次请求扫全部登记库」改成「按需扫描、且只扫启用的库」。
//      本模块只决定 *哪些库* 可扫，不产生任何卡片数、调用数或连接数。
//
// 真实性纪律：所有读数由调用方从真实日志 / 真实磁盘传入；本模块不预置计数，
// 不引入任何随机源，不推断没发生过的连接，不把同名目录当成同一个库。
// 配置写入统一由 main.js 的 writeRegistry / writeConfig 负责，本模块全是纯函数。
'use strict';

const PURPOSES = Object.freeze({ KB: 'kb', SEDIMENT: 'sediment' });

/** 老配置里没有 linkEnabled / purpose：默认「启用连接、普通知识库」，绝不悄悄停用用户已有的库。 */
function normalizeRegistry(reg) {
  const src = reg && typeof reg === 'object' ? reg : {};
  const vaults = Array.isArray(src.vaults) ? src.vaults : [];
  return {
    vaults: vaults.map((v) => ({
      ...(v && typeof v === 'object' ? v : {}),
      linkEnabled: v && typeof v.linkEnabled === 'boolean' ? v.linkEnabled : true,
      purpose: v && (v.purpose === PURPOSES.SEDIMENT || v.purpose === PURPOSES.KB)
        ? v.purpose : PURPOSES.KB,
    })),
    activeId: src.activeId || null,
  };
}

function findVault(reg, id) {
  const key = String(id || '');
  if (!key) return null;
  return normalizeRegistry(reg).vaults.find((v) => v && v.id === key) || null;
}

function linkable(reg, id) {
  const v = findVault(reg, id);
  return !!(v && v.linkEnabled === true);
}

/** 只读视图：给界面列出「哪些库在连接作用域里」，不携带任何编造读数。 */
function scopes(reg) {
  const r = normalizeRegistry(reg);
  return r.vaults.map((v) => ({
    id: v.id, name: v.name, path: v.path, color: v.color || null,
    purpose: v.purpose, linkEnabled: v.linkEnabled === true,
    active: v.id === r.activeId,
  }));
}

/** 给跨库扫描用：只有启用的库才会被读盘。 */
function scanIds(reg) {
  return scopes(reg).filter((s) => s.linkEnabled).map((s) => s.id);
}

function setLinkEnabled(reg, id, on) {
  const r = normalizeRegistry(reg);
  const v = r.vaults.find((x) => x.id === String(id || ''));
  if (!v) return { ok: false, error: 'vault_not_found', registry: r };
  v.linkEnabled = on === true;
  return { ok: true, registry: r, vault: { id: v.id, linkEnabled: v.linkEnabled } };
}

function setPurpose(reg, id, purpose) {
  const p = purpose === PURPOSES.SEDIMENT ? PURPOSES.SEDIMENT : PURPOSES.KB;
  const r = normalizeRegistry(reg);
  const v = r.vaults.find((x) => x.id === String(id || ''));
  if (!v) return { ok: false, error: 'vault_not_found', registry: r };
  v.purpose = p;
  return { ok: true, registry: r, vault: { id: v.id, purpose: p } };
}

/**
 * 请求级定向：客户端用 X-NeoKB-Vault: <id> 或 ?vault=<id> 指定库。
 * 不指定就用当前活动库（保持 6.22.0 的行为），但活动库被停用时照样拒绝。
 * 返回结构里带明确错误码，服务端据此真实返回 403 / 404，不是只在界面灰掉按钮。
 */
function resolveVault(reg, requestedId, activeId) {
  const id = String(requestedId || activeId || '');
  const v = findVault(reg, id);
  if (!v) return { ok: false, id, error: 'vault_not_found' };
  if (v.linkEnabled !== true) return { ok: false, id, error: 'vault_disabled', entry: v };
  return { ok: true, id: v.id, entry: v };
}

/** 沉淀回写的目标库：用户显式选过、且仍在注册表里才算数；选过但库被移除则如实返回 null。 */
function sedimentTarget(cfg, reg) {
  const id = cfg && cfg.sediment ? String(cfg.sediment.vaultId || '') : '';
  if (!id) return null;
  const v = findVault(reg, id);
  if (!v) return null;
  return { id: v.id, name: v.name, path: v.path, purpose: v.purpose };
}

/** 纯函数：写入由 main.js 的 writeConfig 统一落盘（config.json 只有一个写入者）。 */
function setSedimentTarget(cfg, id) {
  const next = { ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  next.sediment = { ...(next.sediment || {}), vaultId: id ? String(id) : null };
  return next;
}

/**
 * 把真实聚合出的「按库调用数」合并进作用域列表。
 * counts 必须来自 connection-log.aggregate() 的 byVault，缺失就是 0 次（不是「未知」）。
 */
function scopeSummary(reg, counts) {
  const byId = new Map();
  for (const c of Array.isArray(counts) ? counts : []) {
    if (c && c.vaultId) byId.set(String(c.vaultId), c);
  }
  return scopes(reg).map((s) => {
    const c = byId.get(s.id) || null;
    return {
      ...s,
      calls: c ? Number(c.calls) || 0 : 0,
      lastTs: c ? c.lastTs || null : null,
      clients: c ? Number(c.clients) || 0 : 0,
    };
  });
}

module.exports = {
  PURPOSES, normalizeRegistry, findVault, linkable, scopes, scanIds,
  setLinkEnabled, setPurpose, resolveVault, sedimentTarget, setSedimentTarget, scopeSummary,
};
