'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ASTRA · 思维沉淀库（v6.12 · 神经突触 / 空间折叠 / 可迁移记忆）
// ---------------------------------------------------------------------------
// 【用户诉求】
//   精灵需要一座"专门的思维沉淀库"：在软件安装目录下自动建立，用户可后期自主
//   更换位置。它要承载星灵的真实记忆与思考轨迹 —— 不是运行时那点 volatile 状态，
//   而是一份可审计、可迁移、可查证的长期档案。
//
// 【工程实现 · 真实而非叙事】
//   · 落盘格式：追加式 JSONL（每条记忆一行），天然支持边写边读、崩溃不损前序。
//   · 缓冲写入：高频记忆先入内存环形缓冲，按阈值/定时批量落盘，避免每心跳一次
//     全量重写（这是上一版内核性能的主要痛点）。
//   · 突触网：每条语义记忆与近期记忆按关键词共现建立加权关联边，写入 synapse.jsonl，
//     真实反映"神经突触"式的联想结构，而非装饰。
//   · 可迁移：relocate() 把整座库复制到新路径并切换，旧文件可保留可清理。
//   · 安装目录优先：默认落在 exe 所在目录下的 astra-memory/，不可写时回退 userData。
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 3;
const FLUSH_EVERY = 24;            // 每累积 24 条记忆批量落盘一次
const RING = 400;                  // 内存环形缓冲上限（超出最早的被挤出，但已落盘）
const MAX_FILE_BYTES = 6 * 1024 * 1024; // 单文件 6MiB 上限，超出滚动截断旧尾
const RECENT_WINDOW = 60;          // 突触关联只在前 60 条记忆间建立（近因优先）
const GRAPH_WINDOW = 24;           // 突触图在最近 24 条语义记忆间按共现连线
const LATIN_RE = /[A-Za-z][A-Za-z0-9]{2,15}/g; // 3+ 字母词（项目/方法名等）
const CJK_RE = /[一-龥]+/g;

// 中文以"二元共现（bigram）"切分：使"空间折叠"这类短语在两段记忆里能真正连上突触，
// 而不像 [一-龥]{2,6} 那种最长匹配那样把不同上下文各切成互不相同的整段、导致永不相连。
function tokensOf(text) {
  if (!text) return [];
  const out = new Set();
  const s = String(text);
  let m; LATIN_RE.lastIndex = 0;
  while ((m = LATIN_RE.exec(s)) !== null) out.add(m[0].toLowerCase());
  const runs = s.match(CJK_RE) || [];
  for (const run of runs) {
    if (run.length < 2) continue;
    for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}
const r3 = (v) => Math.round(v * 1000) / 1000;

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/**
 * @param {object} deps
 * @param {string}   deps.root          库根目录（安装目录下 astra-memory）
 * @param {string=}  deps.fallbackRoot   不可写时的回退根（通常 userData）
 * @param {object=}  deps.config         持久化配置对象（{read,write}），保存当前库路径
 */
function createThoughtLibrary({ root, fallbackRoot, config } = {}) {
  const cfg = config || { read: () => ({}), write: () => {} };
  let effectiveRoot = resolveRoot(root, fallbackRoot);

  function resolveRoot(want, fb) {
    const candidates = [want, fb].filter(Boolean);
    for (const c of candidates) {
      try {
        fs.mkdirSync(c, { recursive: true });
        // 真写一条探测，确认有写权限（Program Files 下常因 UAC 失败）
        const probe = path.join(c, '.writetest');
        fs.writeFileSync(probe, '1');
        fs.unlinkSync(probe);
        return c;
      } catch { /* 该候选不可写，试下一个 */ }
    }
    // 极端兜底：进程当前目录
    const last = path.join(process.cwd(), 'astra-memory');
    try { fs.mkdirSync(last, { recursive: true }); } catch {}
    return last;
  }

  const fileOf = (name) => path.join(effectiveRoot, `${name}.jsonl`);
  const metaFile = () => path.join(effectiveRoot, 'meta.json');

  function ensureDir() { try { fs.mkdirSync(effectiveRoot, { recursive: true }); } catch {} }

  // 环形缓冲：未落盘的记忆先留在这里
  const buffer = [];
  let flushScheduled = false;
  let seq = loadSeq();

  function loadSeq() {
    try {
      const m = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
      return (m && Number.isFinite(m.seq)) ? m.seq : 0;
    } catch { return 0; }
  }
  function saveMeta(extra = {}) {
    ensureDir();
    const m = { schema: SCHEMA, root: effectiveRoot, relocatedAt: new Date().toISOString(), seq, ...extra };
    try { fs.writeFileSync(metaFile(), JSON.stringify(m)); } catch {}
  }
  saveMeta();

  function persistConfig() {
    const c = cfg.read() || {};
    c.astraLibraryRoot = effectiveRoot;
    try { cfg.write(c); } catch {}
  }
  persistConfig();

  /** 受控追加：写入环形缓冲，必要时触发批量落盘。 */
  function append(kind, obj) {
    obj = obj || {};
    // 注意：kind 必须来自函数首参，不能让 obj.kind 覆盖（否则会写到错误文件）。
    // at 以 obj.at 为准、缺失时补当前时间。
    const rec = { seq: ++seq, ...obj, kind, at: obj.at || new Date().toISOString() };
    buffer.push(rec);
    if (buffer.length > RING) buffer.shift();
    if (!flushScheduled) {
      flushScheduled = true;
      // 让出当前调用栈：把同一心跳内的多条记忆合并成一次磁盘写入
      Promise.resolve().then(flush).catch(() => { flushScheduled = false; });
    }
    return rec;
  }

  function flush() {
    flushScheduled = false;
    if (!buffer.length) return;
    ensureDir();
    // 按文件归类批量写，减少打开/关闭次数
    const byFile = new Map();
    while (buffer.length) {
      const rec = buffer.shift();
      const f = fileOf(rec.kind);
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(JSON.stringify(rec));
    }
    for (const [f, lines] of byFile) {
      try { fs.appendFileSync(f, lines.join('\n') + '\n', 'utf8'); } catch (e) { /* 落盘失败不阻断自主循环 */ }
      // 滚动截断：超出上限时删去文件头 30%（保留尾部最新记忆）
      const st = safeStat(f);
      if (st && st.size > MAX_FILE_BYTES) rotate(f);
    }
    saveMeta();
  }

  function rotate(f) {
    try {
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      const keep = lines.slice(Math.floor(lines.length * 0.3));
      fs.writeFileSync(f, keep.join('\n') + '\n', 'utf8');
    } catch {}
  }

  // —— 突触关联：记录近期记忆的关键词倒排，新记忆与近因窗口内共享词者连线 ——
  const recentTokens = new Map(); // seq -> tokens

  function recordSynapse(text, metaKind) {
    const toks = tokensOf(text);
    if (!toks.length) return null;
    // 仅在前 RECENT_WINDOW 条之间建立关联（近因 + 主题相关）
    const ids = [...recentTokens.keys()].slice(-RECENT_WINDOW);
    const edges = [];
    for (const s of ids) {
      const o = recentTokens.get(s);
      const shared = o.filter((t) => toks.includes(t));
      if (shared.length) edges.push({ to: s, weight: Math.min(1, shared.length / 3), tokens: shared.slice(0, 3) });
    }
    append('synapse', { from: seq, text: text.slice(0, 60), edges });
    recentTokens.set(seq, toks);
    if (recentTokens.size > RECENT_WINDOW * 2) {
      const drop = recentTokens.keys().next().value;
      recentTokens.delete(drop);
    }
    return edges;
  }

  // —— 对外 API ——
  function addEpisodic(text, extra = {}) { append('episodic', { text: String(text || '').slice(0, 240), mood: extra.mood || '', kind: extra.kind || '' }); }
  function addSemantic(text, extra = {}) {
    const rec = append('semantic', { text: String(text || '').slice(0, 80), count: 1, weight: extra.weight ?? 0.34 });
    recordSynapse(rec.text, 'semantic');
    return rec;
  }
  function addDecision(detail) { append('decision', detail); }
  function addEvolution(rec) { append('evolution', rec); }

  function countLines(name) {
    const f = fileOf(name);
    const st = safeStat(f);
    if (!st) return 0;
    try {
      const len = Math.min(st.size, 64 * 1024);
      const off = Math.max(0, st.size - len);
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, off);
      fs.closeSync(fd);
      const s = buf.toString('utf8');
      let total = 0;
      for (let i = 0; i < s.length; i++) if (s[i] === '\n') total++;
      return total;
    } catch { return 0; }
  }

  function stats() {
    return {
      root: effectiveRoot,
      schema: SCHEMA,
      seq,
      episodic: countLines('episodic'),
      semantic: countLines('semantic'),
      synapse: countLines('synapse'),
      decision: countLines('decision'),
      evolution: countLines('evolution'),
      bytes: ['episodic', 'semantic', 'synapse', 'decision', 'evolution', 'meta']
        .reduce((s, n) => s + (safeStat(fileOf(n))?.size || 0), 0),
    };
  }

  /** 相关性查询：在语义记忆里找与 query 共享关键词最多的条目（真实检索，非装饰）。 */
  function query(text, limit = 8) {
    const q = [...new Set(tokensOf(text))];
    if (!q.length) return [];
    const hits = [];
    try {
      const lines = fs.readFileSync(fileOf('semantic'), 'utf8').split('\n').filter(Boolean);
      for (const ln of lines) {
        try {
          const r = JSON.parse(ln);
          const t = [...new Set(tokensOf(r.text))];
          let score = 0;
          for (const k of q) {
            if (t.includes(k)) score += 1;                          // 完整 token 命中
            else if (t.some((x) => x.includes(k) || k.includes(x))) score += 0.5; // 子串/包含
          }
          if (score > 0) hits.push({ text: r.text, score: Math.round(score * 100) / 100, count: r.count || 1 });
        } catch {}
      }
    } catch {}
    hits.sort((a, b) => b.score - a.score || b.count - a.count);
    return hits.slice(0, limit);
  }

  /**
   * 重定位：把整座库复制到新路径并切换，旧库按 keepOld 决定是否保留。
   * 用户可在"意识中枢 / 精灵面板"里随时更换沉淀库位置。
   */
  function relocate(newRoot, { keepOld = true } = {}) {
    const dest = String(newRoot || '').trim();
    if (!dest || dest === effectiveRoot) return { ok: false, error: '目标路径无效或与当前相同' };
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of ['episodic', 'semantic', 'synapse', 'decision', 'evolution']) {
        const src = fileOf(name);
        if (safeStat(src)) fs.copyFileSync(src, path.join(dest, `${name}.jsonl`));
      }
      if (safeStat(metaFile())) fs.copyFileSync(metaFile(), path.join(dest, 'meta.json'));
      const oldRoot = effectiveRoot;
      effectiveRoot = dest;
      seq = loadSeq();
      saveMeta({ previousRoot: oldRoot });
      persistConfig();
      if (!keepOld) {
        for (const name of ['episodic', 'semantic', 'synapse', 'decision', 'evolution', 'meta']) {
          try { fs.rmSync(path.join(oldRoot, `${name}.jsonl`), { force: true }); } catch {}
        }
        try { fs.rmSync(path.join(oldRoot, 'meta.json'), { force: true }); } catch {}
        try { fs.rmSync(oldRoot, { recursive: true, force: true }); } catch {}
      }
      return { ok: true, root: effectiveRoot, previousRoot: oldRoot, keptOld: keepOld };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  function open() { try { if (typeof require('electron')?.shell?.openPath === 'function') require('electron').shell.openPath(effectiveRoot); } catch {} return effectiveRoot; }

  /**
   * v6.12：导出突触关联图（神经突触知识网的真实结构），供意识中枢可视化。
   * 采用 Hebbian 准则"同时被激活的神经元相连"：在最近 GRAPH_WINDOW 条语义记忆内，
   * 两两比对关键词共现，把共享 token 的节点连成加权边。边的结构完全由落盘的记忆
   * 决定、可重放、不依赖随机，是真实的数据驱动网络而非装饰。
   */
  function synapseGraph(limit = 48) {
    const nodes = [];
    const tokenMap = [];
    try {
      const lines = fs.readFileSync(fileOf('semantic'), 'utf8').split('\n').filter(Boolean).slice(-limit);
      for (const ln of lines) {
        try {
          const r = JSON.parse(ln);
          const toks = tokensOf(r.text);
          const node = { seq: r.seq, text: String(r.text || ''), weight: Number(r.weight) || 0.34, tokens: toks };
          nodes.push(node);
          tokenMap.push({ seq: r.seq, tokens: toks });
        } catch {}
      }
    } catch {}
    const edges = [];
    const win = tokenMap.slice(-Math.min(tokenMap.length, GRAPH_WINDOW));
    for (let i = 0; i < win.length; i++) {
      for (let j = i + 1; j < win.length; j++) {
        const shared = win[i].tokens.filter((t) => win[j].tokens.includes(t));
        if (shared.length) {
          edges.push({
            from: win[i].seq, to: win[j].seq,
            weight: r3(Math.min(1, shared.length / 3)),
            tokens: shared.slice(0, 3),
          });
        }
      }
    }
    return { nodes, edges, root: effectiveRoot };
  }

  return {
    get root() { return effectiveRoot; },
    addEpisodic, addSemantic, addDecision, addEvolution,
    query, stats, relocate, open, flush, synapseGraph,
    _raw: () => ({ root: effectiveRoot, seq, buffer: buffer.length }),
  };
}

module.exports = { createThoughtLibrary, _tokens: tokensOf };
