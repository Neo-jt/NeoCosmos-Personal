// NeoLM · 原创本地领域语言模型内核（v6.31.0）
// ---------------------------------------------------------------------------
// 诚实纪律（与本项目「禁止虚构 / 虚假能力」红线一致）：
//   · 这里只有数学与确定性数据处理，没有任何预置答案、知识卡或演示语料；
//   · 词表全部来自本仓库真实文本，按真实频次统计产生；
//   · 权重只能由 tools/train-neolm.mjs 的真实梯度下降写入，加载端校验哈希；
//   · 模型是「结构 + 上下文」的 CBOW/Skip-gram 神经语言模型，不是通用聊天大模型，
//     不会编造事实；它提供的是可计算的词向量、相似度、下一 token 分布与续写。
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

export const SCHEMA = 'neocosmos.neolm/1';
export const VOCAB_SIZE = 131072;
export const DIM = 1536;
export const WINDOW = 2;
export const NEGATIVES = 5;
export const UNK = '<unk>';
export const WEIGHT_FILES = ['neolm.emb.nw', 'neolm.out.nw'];
export const VOCAB_FILE = 'neolm.vocab.json';
export const MANIFEST_FILE = 'neolm.manifest.json';
export const ROW_BYTES = DIM * 4;
export const MATRIX_BYTES = VOCAB_SIZE * ROW_BYTES; // 805,306,368 B 每矩阵

/** 确定性伪随机（LCG，无 Math.random，保证训练完全可复现）。 */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 初始化一行权重：标准的小幅均匀初始化，确定性且与 seed 绑定。 */
export function initRow(rng, out, offset = 0) {
  for (let d = 0; d < DIM; d++) out[offset + d] = (rng() - 0.5) * 0.10;
  return out;
}

export const sigmoid = (x) => x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
export const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 收集本仓库真实文本（排除构建产物 / 依赖 / 二进制资产 / 模型产物自身）。 */
export function collectCorpus(root, fs, path, opts = {}) {
  const SKIP = new Set(['build', 'node_modules', '.git', '3d-viz', '_archive', 'docs-archive']);
  const EXT = /\.(js|mjs|cjs|md|json|css|html|txt|nsi|ps1|yml|yaml|nsh)$/i;
  const files = [];
  (function walk(dir, rel = '') {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // desktop 下只取真实源码文本（ui / astra / security / *.js|cjs），排除 assets 大文件
        if (r === 'desktop' || r.startsWith('desktop/')) {
          if (r === 'desktop/assets' || r.startsWith('desktop/assets/')) continue;
        }
        walk(p, r);
      } else if (EXT.test(e.name)) {
        let size = 0;
        try { size = fs.statSync(p).size; } catch { continue; }
        if (size > 0 && size < (opts.maxFileBytes || 2_000_000)) files.push([r, p, size]);
      }
    }
  })(root);
  files.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  let text = '', mdText = '';
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for (const [r, p] of files) {
    let s;
    try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
    s = s.replace(/\r\n?/g, '\n');
    text += s + '\n';
    if (/\.md$/i.test(r)) mdText += s + '\n';   // 真实中文文档，训练时可过采样以平衡源码噪声
    digest.update(s, 'utf8');
    bytes += Buffer.byteLength(s, 'utf8');
  }
  return {
    text, mdText,
    files: files.map(([r]) => r),
    bytes,
    corpusHash: digest.digest('hex'),
  };
}

/** 有实义 token：至少含一个 CJK 字符 / 字母 / 数字，排除纯标点与空白。 */
export const isMeaningful = (s) => /[\u3400-\u9fffA-Za-z0-9]/.test(s);

/**
 * 从真实文本统计词表。全部 token 都是文本里真实出现过的字符串，
 * 按「类型优先级 → 真实频次 → 字典序」确定性截断到 VOCAB_SIZE。
 * 单字符全量收录，保证任何文本都能被分词（无未登录空洞）。
 */
export function buildVocab(text, size = VOCAB_SIZE, opts = {}) {
  // n-gram 用整数编码做 Map 键（避免千万级临时字符串，仍可无损还原成原字符）。
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const uni = new Map(), bi = new Map(), tri = new Map(), words = new Map();
  const clean = text.replace(/\t/g, ' ');
  const n = clean.length;
  for (let i = 0; i < n; i++) {
    const c1 = clean.charCodeAt(i);
    bump(uni, c1);
    if (i + 1 < n) bump(bi, c1 * 65536 + clean.charCodeAt(i + 1));
    if (i + 2 < n) bump(tri, c1 * 4294967296 + clean.charCodeAt(i + 1) * 65536 + clean.charCodeAt(i + 2));
  }
  for (const m of clean.matchAll(/[A-Za-z_][A-Za-z0-9_]{1,31}/g)) bump(words, m[0]);

  const biText = (k) => String.fromCharCode(Math.floor(k / 65536), k % 65536);
  const triText = (k) => {
    const c1 = Math.floor(k / 4294967296), rem = k % 4294967296;
    return String.fromCharCode(c1, Math.floor(rem / 65536), rem % 65536);
  };
  const cmp = (a, b) => b.f - a.f || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  // 纯标点 / 纯空白的 n-gram 不进词表（它们真实存在但会淹没中文语义）。
  const meaningful = opts.meaningfulOnly === false ? (() => true) : isMeaningful;
  const groups = [
    ['char', [...uni].map(([k, f]) => ({ t: String.fromCharCode(k), f }))],
    ['word', [...words].filter(([, f]) => f >= 2).map(([t, f]) => ({ t, f }))],
    ['bigram', [...bi].filter(([, f]) => f >= 2).map(([k, f]) => ({ t: biText(k), f })).filter((x) => meaningful(x.t))],
    ['trigram', [...tri].filter(([, f]) => f >= 2).map(([k, f]) => ({ t: triText(k), f })).filter((x) => meaningful(x.t))],
  ];
  const chosen = [], seen = new Set();
  for (const [kind, list] of groups) {
    list.sort(cmp);
    for (const it of list) {
      if (chosen.length >= size) break;
      if (seen.has(it.t) || it.t.includes('\n')) continue;
      seen.add(it.t);
      chosen.push({ t: it.t, f: it.f, kind });
    }
  }
  // 候选不足时（极小语料场景）按频次补齐真实出现过的 trigram 单次项，
  // 并用 UNK 占位保证索引闭合；所有 token 仍是语料里真实出现过的字符串。
  if (chosen.length < size) {
    const rest = [...tri].filter(([, f]) => f >= 2).sort((a, b) => b[1] - a[1]);
    for (const [k, f] of rest) {
      if (chosen.length >= size) break;
      const t = triText(k);
      if (seen.has(t) || !meaningful(t)) continue;
      seen.add(t); chosen.push({ t, f, kind: 'trigram' });
    }
  }
  if (!seen.has(UNK)) {
    if (chosen.length < size) chosen.push({ t: UNK, f: 0, kind: 'special' });
    else chosen[chosen.length - 1] = { t: UNK, f: 0, kind: 'special' };
  }
  return {
    tokens: chosen,
    stats: {
      charCandidates: uni.size, wordCandidates: words.size,
      bigramCandidates: bi.size, trigramCandidates: tri.size,
      selected: chosen.length,
      minFreq: chosen.reduce((a, x) => Math.min(a, x.f), Infinity),
    },
  };
}

/** 词表索引：token -> id，以及按长度分组的最长匹配表。 */
export function makeIndex(tokens) {
  const idOf = new Map();
  tokens.forEach((e, i) => idOf.set(e.t, i));
  const byLen = new Map();
  const lenByFirst = new Map();   // 首字符 -> 可能出现的长度集合（避免逐位置试全部长度）
  for (const [t, id] of idOf) {
    const n = t.length;
    if (!byLen.has(n)) byLen.set(n, new Map());
    byLen.get(n).set(t, id);
    const fc = t.charCodeAt(0);
    if (!lenByFirst.has(fc)) lenByFirst.set(fc, new Set());
    lenByFirst.get(fc).add(n);
  }
  const lengthsByFirst = new Map();
  for (const [fc, set] of lenByFirst) lengthsByFirst.set(fc, [...set].sort((a, b) => b - a));
  return { idOf, byLen, lengthsByFirst, lengths: [...byLen.keys()].sort((a, b) => b - a) };
}

/** 最长匹配分词（确定性）。未登录字符回退到单字 / UNK。 */
export function tokenize(text, idx, limit = Infinity) {
  const out = [];
  const unkId = idx.idOf.get(UNK) ?? 0;
  let i = 0;
  const src = String(text || '').replace(/\r/g, '');
  while (i < src.length && out.length < limit) {
    const lens = idx.lengthsByFirst.get(src.charCodeAt(i));
    let hit = -1, hitLen = 0;
    if (lens) {
      for (const n of lens) {
        if (i + n > src.length) continue;
        const id = idx.byLen.get(n).get(src.slice(i, i + n));
        if (id !== undefined) { hit = id; hitLen = n; break; }
      }
    }
    if (hit >= 0) { out.push(hit); i += hitLen; }
    else { out.push(unkId); i += 1; }
  }
  return out;
}

/** 一次真实的 Skip-gram 负采样梯度更新（原地修改 E / U，无临时分配）。 */
export function trainPair(E, U, center, other, label, lr, scratch) {
  const c = center * DIM, o = other * DIM;
  let s = 0;
  for (let d = 0; d < DIM; d++) s += E[c + d] * U[o + d];
  const g = (label - sigmoid(s)) * lr;
  for (let d = 0; d < DIM; d++) {
    scratch[d] += g * U[o + d];       // 累积中心向量梯度（用更新前的 U）
    U[o + d] += g * E[c + d];         // 更新输出向量（用更新前的 E 中心）
  }
  return -Math.log(label === 1 ? sigmoid(s) : 1 - sigmoid(s) + 1e-9) || 0;
}

export function dotAt(a, ai, b, bi) {
  let s = 0;
  for (let d = 0; d < DIM; d++) s += a[ai + d] * b[bi + d];
  return s;
}

export function cosineAt(a, ai, b, bi) {
  let s = 0, na = 0, nb = 0;
  for (let d = 0; d < DIM; d++) {
    const x = a[ai + d], y = b[bi + d];
    s += x * y; na += x * x; nb += y * y;
  }
  return na > 0 && nb > 0 ? s / Math.sqrt(na * nb) : 0;
}

/** 把一段文本真实映射为向量（token 向量平均 + L2 归一）。 */
export function textVector(text, idx, E, readRow) {
  const ids = tokenize(text, idx, 256);
  const v = new Float64Array(DIM);
  let n = 0;
  for (const id of ids) {
    const row = readRow(id);
    for (let d = 0; d < DIM; d++) v[d] += row[d];
    n++;
  }
  if (!n) return new Float64Array(DIM);
  let norm = 0;
  for (let d = 0; d < DIM; d++) { v[d] /= n; norm += v[d] * v[d]; }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < DIM; d++) v[d] /= norm;
  return v;
}
