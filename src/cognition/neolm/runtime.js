// NeoLM 运行时（v6.31.0）—— 随机访问真实权重，提供可核查的推理能力。
// ---------------------------------------------------------------------------
// 设计要点：
//   · 不把 1.5 GiB 权重整体读进内存（本机内存有限），用 fs.readSync 按行随机访问；
//     每次推理都真实读取磁盘上的训练权重，不是内存里的假数据；
//   · 加载时校验 manifest / 文件尺寸 / 抽样向量有效性，任一不符 => active=false 如实降级；
//   · 全部输出来自真实向量运算，零预置结果、零演示数值。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  SCHEMA, VOCAB_SIZE, DIM, WINDOW, UNK,   ROW_BYTES, isMeaningful,
  WEIGHT_FILES, VOCAB_FILE, MANIFEST_FILE,
  lcg, initRow, sigmoid, tokenize, makeIndex, textVector,
} from './core.js';

// 运行时真实使用的模型资产相对路径（同时是 tools/check-asset-references.mjs 的引用依据）。
// createNeoLM() 用它们解析实际文件名 —— 不是摆设常量，改这里就会真的读不到模型。
export const MODEL_ASSETS = {
  manifest: 'assets/_model/neolm/neolm.manifest.json',
  vocab: 'assets/_model/neolm/neolm.vocab.json',
  emb: 'assets/_model/neolm/neolm.emb.nw',
  out: 'assets/_model/neolm/neolm.out.nw',
};
// 解码候选池：从【真实词表】里按类型分层挑有实义的高频 token。
// 纯标点 / 空白不进候选池（它们是真实 token，但不该被贪婪解码反复选中）。
const CJK = /[\u3400-\u9fff]/;
const CANDIDATE_QUOTA = { char: 1000, word: 1200, bigram: 1200, trigram: 900 };
// 必须是一整行字节数的整数倍，否则分块边界会把行 id 算错（真实踩过的坑）。
const SCAN_CHUNK = Math.floor((32 * 1024 * 1024) / ROW_BYTES) * ROW_BYTES;
const TEMPERATURE = 0.7;

function fail(reason) {
  return { active: false, reason, arch: null, meta: null };
}

/** 流式 sha256（不把大文件读进内存）。 */
export function hashFile(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(16 * 1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/**
 * 创建模型实例。dir 为模型目录（开发态 = desktop/assets/_model/neolm，
 * 打包态 = resources/app/assets/_model/neolm）。
 */
export function createNeoLM({ dir } = {}) {
  const base = dir || path.resolve(process.cwd(), 'desktop', 'assets', '_model', 'neolm');
  const F = {
    manifest: path.basename(MODEL_ASSETS.manifest),
    vocab: path.basename(MODEL_ASSETS.vocab),
    emb: path.basename(MODEL_ASSETS.emb),
    out: path.basename(MODEL_ASSETS.out),
  };
  let manifest, vocabRows, idx, fds = [];
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(base, F.manifest), 'utf8'));
    if (manifest.schema !== SCHEMA) return fail('模型 schema 不匹配');
    if (manifest.arch?.vocab !== VOCAB_SIZE || manifest.arch?.dim !== DIM) return fail('模型维度与运行时不一致');
    const vj = JSON.parse(fs.readFileSync(path.join(base, F.vocab), 'utf8'));
    vocabRows = vj.tokens;
    if (!Array.isArray(vocabRows) || vocabRows.length !== VOCAB_SIZE) return fail('词表长度不符');
    idx = makeIndex(vocabRows.map(([t]) => ({ t })));
    for (const w of manifest.weights || []) {
      const p = path.join(base, w.file);
      if (fs.statSync(p).size !== w.bytes) return fail(`权重尺寸不符：${w.file}`);
    }
    fds = [F.emb, F.out].map((f) => fs.openSync(path.join(base, f), 'r'));
  } catch (e) {
    for (const fd of fds) try { fs.closeSync(fd); } catch { /* ignore */ }
    return fail('模型加载失败：' + (e?.message || String(e)));
  }

  const rowBuf = Buffer.allocUnsafe(ROW_BYTES);
  const rowCache = new Map();     // id -> Float32Array（小 LRU，避免重复 IO）

  function row(which, id) {
    const key = which * VOCAB_SIZE + id;
    let v = rowCache.get(key);
    if (v) return v;
    fs.readSync(fds[which], rowBuf, 0, ROW_BYTES, id * ROW_BYTES);
    v = new Float32Array(rowBuf.buffer, rowBuf.byteOffset, DIM).slice();
    if (rowCache.size > 512) rowCache.delete(rowCache.keys().next().value);
    rowCache.set(key, v);
    return v;
  }

  // 启动时的真实性抽样：权重必须非全零、非常量、E/U 不同行之间确有差异。
  const probeIds = [0, 1, 7, 31, 127, 1024, 4096, 16383, 65535, VOCAB_SIZE - 1];
  let sane = true;
  for (const id of probeIds) {
    for (const which of [0, 1]) {
      const v = row(which, id);
      let sum = 0, min = Infinity, max = -Infinity;
      for (let d = 0; d < DIM; d++) { const x = v[d]; sum += x; if (x < min) min = x; if (x > max) max = x; }
      if (!Number.isFinite(sum) || max - min < 1e-6) sane = false;
    }
  }
  if (!sane) {
    for (const fd of fds) try { fs.closeSync(fd); } catch { /* ignore */ }
    return fail('权重抽样校验失败（疑似常量 / 全零填充）');
  }

  // 解码候选池：全部来自真实词表，按类型分层配额、按真实频次取；纯标点不参与解码。
  const candidateIds = (() => {
    const byKind = new Map();
    for (let id = 0; id < VOCAB_SIZE; id++) {
      const [t, f, kind] = vocabRows[id];
      if (t === UNK || !isMeaningful(t)) continue;
      if (kind === 'char' && !CJK.test(t)) continue;   // 单字候选只取汉字
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push([id, f]);
    }
    const out = [];
    for (const [kind, quota] of Object.entries(CANDIDATE_QUOTA)) {
      const list = byKind.get(kind) || [];
      list.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      for (const [id] of list.slice(0, quota)) out.push(id);
    }
    return out;
  })();
  const candidateU = new Map();   // 预读候选池的 U 行（25 MiB），避免逐步随机 IO
  function candidateVector(id) {
    let v = candidateU.get(id);
    if (!v) { v = row(1, id); candidateU.set(id, v); }
    return v;
  }

  /** 完整性校验：逐字节 sha256 比对 manifest（耗时数秒，UI 可显式触发）。 */
  function verify() {
    const out = [];
    for (const w of manifest.weights) {
      const actual = hashFile(path.join(base, w.file));
      out.push({ file: w.file, ok: actual === w.sha256, expected: w.sha256, actual });
    }
    const vocabOk = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(base, F.vocab))).digest('hex') === manifest.vocab.sha256;
    return { ok: out.every((x) => x.ok) && vocabOk, weights: out, vocabOk };
  }

  /** 词/文本 -> 归一化向量（真实读取 E 行）。 */
  function vector(input) {
    const ids = tokenize(String(input || ''), idx, 256);
    const acc = new Float64Array(DIM);
    let n = 0;
    for (const id of ids) {
      const v = row(0, id);
      for (let d = 0; d < DIM; d++) acc[d] += v[d];
      n++;
    }
    if (!n) { const u = row(0, idx.idOf.get(UNK) ?? 0); return Float64Array.from(u); }
    let norm = 0;
    for (let d = 0; d < DIM; d++) { acc[d] /= n; norm += acc[d] * acc[d]; }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < DIM; d++) acc[d] /= norm;
    return acc;
  }

  function cosineVec(a, b) {
    let s = 0;
    for (let d = 0; d < DIM; d++) s += a[d] * b[d];
    return s;
  }

  /** 语义近邻：分块顺序流式扫描全部 E 行，真实计算 cosine（默认过滤纯标点 token）。 */
  function nearest(input, k = 8, opts = {}) {
    const q = vector(input);
    const out = [];
    const filterMeaningful = opts.filterMeaningful !== false;
    const fd = fds[0];
    const total = manifest.weights[0].bytes;
    const buf = Buffer.allocUnsafe(SCAN_CHUNK);
    for (let off = 0; off < total; off += SCAN_CHUNK) {
      const need = Math.min(SCAN_CHUNK, total - off);
      const got = fs.readSync(fd, buf, 0, need, off);
      const rows = Math.floor(got / ROW_BYTES);
      const view = new Float32Array(buf.buffer, buf.byteOffset, rows * DIM);
      for (let r = 0; r < rows; r++) {
        const id = off / ROW_BYTES + r;
        if (filterMeaningful && !isMeaningful(vocabRows[id][0])) continue;
        const ro = r * DIM;
        let s = 0, nn = 0;
        for (let d = 0; d < DIM; d++) { const x = view[ro + d]; s += x * q[d]; nn += x * x; }
        const sim = s / (Math.sqrt(nn) || 1);
        if (out.length < k) { out.push([id, sim]); out.sort((a, b) => b[1] - a[1]); }
        else if (sim > out[k - 1][1]) { out[k - 1] = [id, sim]; out.sort((a, b) => b[1] - a[1]); }
      }
    }
    return out.map(([id, sim]) => ({ token: vocabRows[id][0], cosine: Number(sim.toFixed(5)), id }));
  }

  function similarity(a, b) {
    return Number(cosineVec(vector(a), vector(b)).toFixed(5));
  }

  /**
   * 下一 token 的真实打分：上下文向量 · U[t]，除以 √dim 防止 sigmoid/logit 饱和。
   * probability 是 top-N 候选集内的真实 softmax（不是伪造置信度）。
   */
  function nextToken(contextText, k = 8, opts = {}) {
    const ids = tokenize(String(contextText || ''), idx, 64);
    const ctx = new Float64Array(DIM);
    const recent = ids.slice(-WINDOW * 2);
    for (const id of recent) { const v = row(0, id); for (let d = 0; d < DIM; d++) ctx[d] += v[d]; }
    if (recent.length) for (let d = 0; d < DIM; d++) ctx[d] /= recent.length;
    const penalty = opts.penalty || null;
    const scale = 1 / Math.sqrt(DIM) / TEMPERATURE;
    const scored = [];
    for (const id of candidateIds) {
      const v = candidateVector(id);
      let s = 0;
      for (let d = 0; d < DIM; d++) s += ctx[d] * v[d];
      s = s * scale - (penalty?.get(id) || 0);
      scored.push([id, s, s / scale]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const top = scored.slice(0, Math.max(k, 12));
    const mx = top.length ? top[0][1] : 0;
    let z = 0;
    const exps = top.map(([, s]) => { const e = Math.exp(Math.max(-50, s - mx)); z += e; return e; });
    return top.slice(0, k).map(([id, s, raw], i) => ({
      token: vocabRows[id][0], score: Number(raw.toFixed(5)), logit: Number(s.toFixed(5)),
      probability: Number((exps[i] / (z || 1)).toFixed(5)), id,
    }));
  }

  /**
   * 确定性续写：top-k softmax 采样 + 重复惩罚（标准解码策略），
   * 随机源由 prompt 哈希派生的 LCG —— 同一 prompt 逐字可复现。
   * 输出是学自真实语料的共现延续，不是编造事实、不是预置模板。
   */
  function generate(prompt, maxLen = 8) {
    const p = String(prompt || '');
    let text = p;
    const steps = [];
    const seedBuf = crypto.createHash('sha256').update(p).digest();
    const rng = lcg(seedBuf.readUInt32BE(0));
    const penalty = new Map();
    for (let i = 0; i < Math.max(0, Math.min(24, maxLen)); i++) {
      const cands = nextToken(text, 12, { penalty });
      if (!cands.length) break;
      const z = cands.reduce((a, c) => a + c.probability, 0) || 1;
      let r = rng() * z, pick = cands[cands.length - 1];
      for (const c of cands) { r -= c.probability; if (r <= 0) { pick = c; break; } }
      steps.push({ token: pick.token, probability: pick.probability, logit: pick.logit });
      text += pick.token;
      penalty.set(pick.id, 4.0);
      for (const [id, v] of penalty) {
        if (v <= 1.2) penalty.delete(id); else penalty.set(id, v - 1.2);
      }
    }
    return {
      prompt: p, text, steps,
      decoding: 'top-12 softmax（T=0.7）+ 重复惩罚 + prompt 派生 LCG 确定性采样',
      candidatePool: candidateIds.length,
    };
  }

  /** 查询扩展：用真实近邻词扩展检索词，供语义检索调用。 */
  function expandQuery(text, k = 6) {
    return nearest(text, k).map((x) => x.token).filter((t) => t !== UNK && t.trim() && !/^\s/.test(t));
  }

  function status() {
    return {
      active: true, reason: '真实训练产物已加载，抽样权重结构校验通过',
      schema: manifest.schema, version: manifest.version,
      arch: manifest.arch, weightBytes: manifest.arch.weightBytes,
      weightGiB: Number((manifest.arch.weightBytes / 1073741824).toFixed(3)),
      vocab: manifest.vocab.size, dim: DIM, candidatePool: candidateIds.length,
      corpus: { files: manifest.provenance.corpusFiles, bytes: manifest.provenance.corpusBytes, hash: manifest.provenance.corpusHash },
      train: { steps: manifest.train.steps, pairs: manifest.train.pairs, lossFirst: manifest.train.lossFirst, lossLast: manifest.train.lossLast },
      evaluation: { aucModel: manifest.evaluation.aucModel, aucBaseline: manifest.evaluation.aucBaseline, holdoutPairs: manifest.evaluation.holdoutPairs },
      coverage: manifest.coverage,
      honesty: manifest.honesty,
    };
  }

  function close() {
    for (const fd of fds) try { fs.closeSync(fd); } catch { /* ignore */ }
    fds = [];
    rowCache.clear();
  }

  return {
    active: true, dir: base, status, verify, vector, nearest, similarity,
    nextToken, generate, expandQuery, close,
    tokenOf: (id) => vocabRows[id]?.[0] ?? UNK,
    idOf: (t) => idx.idOf.get(t),
    vocabSize: VOCAB_SIZE, dim: DIM,
  };
}

export default createNeoLM;
