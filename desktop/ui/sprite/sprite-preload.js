// Cosmos 精灵 · 悬浮窗预加载层（极简桥，CJS 与主壳同源）
// 渲染层只拿到受控的 cosmosSprite API，拿不到原始 ipc / fs / Node 能力。
const { ipcRenderer, contextBridge } = require('electron');

const mk = (name) => {
  const h = (e, arg) => mk.cb[name] && mk.cb[name](arg);
  ipcRenderer.on(name, h);
  return () => ipcRenderer.removeListener(name, h);
};
mk.cb = {};

// 主进程对 invoke 的返回统一是 { ok, data }（与全局 wrap 契约一致）。
// 渲染层（sprite-window.js）直接读 res.answer / res.meta / res.quantum / res.hasVault，
// 所以这里把 invoke 结果解包成 data 载荷（出错时回退到 fallback，绝不抛到 UI）。
async function unwrap(promise, fallback) {
  try {
    const r = await promise;
    if (r && r.ok) return r.data;
    return { ...(fallback || {}), error: (r && r.error) || 'unknown' };
  } catch (e) {
    return { ...(fallback || {}), error: String(e?.message || e) };
  }
}

// v6.11：直接返回 data 本体（数组 / 对象 / null 都原样），不做 spread 兜底，
// 避免把审计数组摊成 {0:…}，渲染层按值判空即可。
async function raw(promise) {
  try { const r = await promise; return r && r.ok ? r.data : null; }
  catch (e) { return null; }
}

const api = {
  ask: (q) => unwrap(ipcRenderer.invoke('sprite:ask', q), { answer: '（无内容）', meta: '', quantum: null }),
  close: () => unwrap(ipcRenderer.invoke('sprite:close'), { enabled: false }),
  status: () => unwrap(ipcRenderer.invoke('sprite:status'), { enabled: false, hasVault: false, scale: 0.9 }),
  // v6.5.0：尺寸调节（真改窗口大小，不是 CSS 缩放贴图）
  setScale: (v) => unwrap(ipcRenderer.invoke('sprite:set-scale', v), { scale: 0.9 }),
  onScale: (cb) => { mk.cb['sprite:scale'] = cb; return mk('sprite:scale'); },
  onQuantum: (cb) => { mk.cb['sprite:quantum'] = cb; return mk('sprite:quantum'); },
  onThought: (cb) => { mk.cb['sprite:thought'] = cb; return mk('sprite:thought'); },
  onAnswer: (cb) => { mk.cb['sprite:answer'] = cb; return mk('sprite:answer'); },
  onStatus: (cb) => { mk.cb['sprite:status'] = cb; return mk('sprite:status'); },

  // ---- v6.11 ASTRA：意识状态 / 漫游控制 / 拖拽 / 鼠标穿透 ----
  astraStatus: () => raw(ipcRenderer.invoke('astra:status')),
  astraMode: (m) => raw(ipcRenderer.invoke('astra:mode', m)),
  astraHome: () => raw(ipcRenderer.invoke('astra:home')),
  astraHold: (on) => raw(ipcRenderer.invoke('astra:hold', on)),
  astraTick: () => raw(ipcRenderer.invoke('astra:tick', {})),
  astraEvolve: () => raw(ipcRenderer.invoke('astra:evolve')),
  astraRollback: (gen) => raw(ipcRenderer.invoke('astra:rollback', gen)),
  astraPerceive: (kind, payload) => raw(ipcRenderer.invoke('astra:perceive', kind, payload || {})),
  astraAudit: (n) => raw(ipcRenderer.invoke('astra:audit', n || 40)),
  astraMemories: (n) => raw(ipcRenderer.invoke('astra:memories', n || 40)),
  astraClickThrough: (on) => raw(ipcRenderer.invoke('astra:click-through', on)),
  astraHit: (interactive) => { try { ipcRenderer.send('astra:hit', { interactive: !!interactive }); } catch (e) { /* ignore */ } },
  astraDragStart: (off) => { try { ipcRenderer.send('astra:drag-start', off); } catch (e) { /* ignore */ } },
  astraDragEnd: () => { try { ipcRenderer.send('astra:drag-end'); } catch (e) { /* ignore */ } },
  onAstraState: (cb) => { mk.cb['astra:state'] = cb; return mk('astra:state'); },
};

contextBridge.exposeInMainWorld('cosmosSprite', api);
