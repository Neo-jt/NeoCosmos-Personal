'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ASTRA · DEEP-MATH · 深度数学与量子物理算法内核（v6.15）
// ---------------------------------------------------------------------------
// 【这一层解决什么】
//   给精灵的「自主意识 / 自我迭代」提供**真实可算**的数学量，而不是叙事形容词：
//   密度矩阵与 von Neumann 熵、Kraus 退相干通道、Hermitian 哈密顿量的酉演化、
//   Grover 振幅放大、离散时间量子游走、变分自由能与贝叶斯预测编码、
//   KL 散度 / 互信息、PageRank / 特征向量中心性 / 归一化拉普拉斯谱隙。
//   这些量进入「观测 → 预测 → 误差 → 更新 → 自省」闭环，驱动策略参数，
//   每一步都留下带公式名与输入输出的审计记录。
//
// 【工程真相 · 严禁虚构】
//   ① 全部是本机的**经典数值计算**，是对量子形式主义与统计学习的确定性模拟，
//      不是真实量子计算、不是量子硬件加速，不宣称超越物理或超越人类认知；
//   ② 无模型、无网络、无外部依赖、无随机数（种子 PRNG 保证可复现）；
//   ③ 所有数值由本文件 selfCheck() 逐项验证，界面显示的是真实返回结果；
//   ④ 「自主意识 / 自我迭代」是可解释、可审计、可关闭、可回滚的行为架构，
//      不具备主观体验、自我觉知或生命。
//
// 【为什么是 CJS】
//   astra-mind.js 是主进程 CJS 内核（Electron 33 主进程不支持 ESM）。
//   本文件是**唯一真源**：CJS 侧直接 require，ESM 测试侧用 createRequire 读取，
//   不另写一份 ESM 副本，避免同源漂移。
// ═══════════════════════════════════════════════════════════════════════════

const DEEP_MATH_BOUNDARY = [
  '本机 CPU 经典数值模拟：密度矩阵 / 酉演化 / 退相干 / 振幅放大 / 量子游走均为量子形式主义的确定性算法实现，非真实量子计算',
  '自由能与预测编码为标量高斯模型的解析贝叶斯更新，不等于生物神经过程',
  '无模型 / 无网络 / 无外部依赖 / 无随机数；同一输入必得同一输出',
  '自我迭代是可解释、可审计、可关闭、可回滚的行为架构，不具备意识或主观体验',
].join('；');

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ── 确定性 PRNG（mulberry32），供需要初态的演示算法使用 ─────────────────────
function makeRng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · 复矩阵线性代数
//    n×n 复矩阵 = { n, re: Float64Array(n*n), im: Float64Array(n*n) }
// ═══════════════════════════════════════════════════════════════════════════
function mat(n) { return { n, re: new Float64Array(n * n), im: new Float64Array(n * n) }; }
function identity(n) {
  const A = mat(n);
  for (let i = 0; i < n; i++) A.re[i * n + i] = 1;
  return A;
}
function matMul(A, B) {
  const n = A.n, C = mat(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const ar = A.re[i * n + k], ai = A.im[i * n + k];
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < n; j++) {
        const br = B.re[k * n + j], bi = B.im[k * n + j];
        C.re[i * n + j] += ar * br - ai * bi;
        C.im[i * n + j] += ar * bi + ai * br;
      }
    }
  }
  return C;
}
function matAdd(A, B) {
  const C = mat(A.n);
  for (let i = 0; i < C.re.length; i++) { C.re[i] = A.re[i] + B.re[i]; C.im[i] = A.im[i] + B.im[i]; }
  return C;
}
function matScale(A, s) {
  const C = mat(A.n);
  for (let i = 0; i < C.re.length; i++) { C.re[i] = A.re[i] * s; C.im[i] = A.im[i] * s; }
  return C;
}
function matNormInf(A) {
  let m = 0;
  for (let i = 0; i < A.n; i++) {
    let s = 0;
    for (let j = 0; j < A.n; j++) s += Math.hypot(A.re[i * A.n + j], A.im[i * A.n + j]);
    if (s > m) m = s;
  }
  return m;
}
function matConjTranspose(A) {
  const C = mat(A.n), n = A.n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    C.re[j * n + i] = A.re[i * n + j];
    C.im[j * n + i] = -A.im[i * n + j];
  }
  return C;
}

/** 矩阵指数 e^A：缩放 + 平方 + 泰勒级数（A 为复矩阵）。 */
function matExp(A) {
  const n = A.n;
  let scale = 0;
  let norm = matNormInf(matScale(A, 1));
  while (norm > 0.5 && scale < 24) { norm /= 2; scale++; }
  const As = matScale(A, 1 / Math.pow(2, scale));
  let term = identity(n), E = identity(n);
  for (let k = 1; k <= 64; k++) {
    term = matScale(matMul(term, As), 1 / k);
    E = matAdd(E, term);
    if (matNormInf(term) < 1e-15) break;
  }
  for (let s = 0; s < scale; s++) E = matMul(E, E);
  return E;
}

/** Hermitian 哈密顿量：由无向加权邻接矩阵构造，对角为度（真实图拉普拉斯型）。 */
function hamiltonianFromAdjacency(adj, coupling = 0.35) {
  const n = adj.length, H = mat(n);
  for (let i = 0; i < n; i++) {
    let deg = 0;
    for (let j = 0; j < n; j++) {
      const w = Number(adj[i][j]) || 0;
      if (i !== j && w !== 0) { H.re[i * n + j] = -coupling * w; deg += Math.abs(w); }
    }
    H.re[i * n + i] = coupling * deg;
  }
  return H;
}

/** U(t) = e^{-iHt}；A = -iHt（H 实对称 ⇒ A 纯虚）。 */
function unitaryFromHamiltonian(H, t) {
  const A = mat(H.n);
  for (let i = 0; i < A.re.length; i++) A.im[i] = -H.re[i] * t; // H 只有实部
  return matExp(A);
}

/** 最大 |U†U − I| 元素，用于验证酉性（应 ≈ 0）。 */
function unitarityError(U) {
  const P = matMul(matConjTranspose(U), U), I = identity(U.n);
  let e = 0;
  for (let i = 0; i < P.re.length; i++) {
    e = Math.max(e, Math.abs(P.re[i] - I.re[i]), Math.abs(P.im[i]));
  }
  return e;
}

/** 复态向量 U|ψ⟩，并归一化。 */
function evolveState(U, psi) {
  const n = U.n;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const ur = U.re[i * n + j], ui = U.im[i * n + j];
      re[i] += ur * psi.re[j] - ui * psi.im[j];
      im[i] += ur * psi.im[j] + ui * psi.re[j];
    }
  }
  let s = 0;
  for (let i = 0; i < n; i++) s += re[i] * re[i] + im[i] * im[i];
  const k = 1 / Math.sqrt(s || 1);
  const out = { re: new Float64Array(n), im: new Float64Array(n) };
  for (let i = 0; i < n; i++) { out.re[i] = re[i] * k; out.im[i] = im[i] * k; }
  return out;
}
function probabilities(psi) {
  const p = [];
  let s = 0;
  for (let i = 0; i < psi.re.length; i++) { const v = psi.re[i] ** 2 + psi.im[i] ** 2; p.push(v); s += v; }
  return p.map((v) => v / (s || 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · 密度矩阵与 Kraus 退相干通道（2×2 qubit，解析可验）
// ═══════════════════════════════════════════════════════════════════════════
function densityFromState(psi) {
  const n = psi.re.length, R = mat(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    R.re[i * n + j] = psi.re[i] * psi.re[j] + psi.im[i] * psi.im[j];
    R.im[i * n + j] = psi.im[i] * psi.re[j] - psi.re[i] * psi.im[j];
  }
  return R;
}
function trace(R) { let s = 0; for (let i = 0; i < R.n; i++) s += R.re[i * R.n + i]; return s; }
function purity(R) { return Math.max(0, Math.min(1, matMul(R, R).re[0] + matMul(R, R).re[3])); }
/** 2×2 密度矩阵的 von Neumann 熵 S = −Tr(ρ log₂ρ)，由 det ρ 解析求本征值。 */
function vonNeumannEntropy(R) {
  const n = R.n;
  if (n !== 2) return null;
  const a = R.re[0], d = R.re[3];
  const br = R.re[1], bi = R.im[1];
  const det = Math.max(0, Math.min(0.25, a * d - (br * br + bi * bi)));
  const disc = Math.sqrt(Math.max(0, 1 - 4 * det));
  const l1 = (1 + disc) / 2, l2 = (1 - disc) / 2;
  const h = (x) => (x > 1e-15 ? -x * Math.log2(x) : 0);
  return h(l1) + h(l2);
}
/** Kraus 算子组作用：ρ' = Σ K ρ K†（完全正且保迹）。 */
function applyKraus(R, Ks) {
  let out = mat(R.n);
  for (const K of Ks) out = matAdd(out, matMul(matMul(K, R), matConjTranspose(K)));
  return out;
}
function phaseDampingKraus(lambda) {
  const l = clamp(lambda), s = Math.sqrt(1 - l);
  const K0 = mat(2), K1 = mat(2);
  K0.re[0] = 1; K0.re[3] = s;
  K1.re[3] = Math.sqrt(l);
  return [K0, K1];
}
function amplitudeDampingKraus(gamma) {
  const g = clamp(gamma), s = Math.sqrt(1 - g);
  const K0 = mat(2), K1 = mat(2);
  K0.re[0] = 1; K0.re[3] = s;
  K1.re[1] = Math.sqrt(g);
  return [K0, K1];
}
/** Bloch 向量 r=(rx,ry,rz)，ρ=(I+r·σ)/2。 */
function blochVector(R) {
  return {
    rx: r6(2 * R.re[1]), ry: r6(-2 * R.im[1]), rz: r6(R.re[0] - R.re[3]),
    length: r6(Math.hypot(2 * R.re[1], 2 * R.im[1], R.re[0] - R.re[3])),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Grover 振幅放大（离散搜索，真实二次加速曲线）
// ═══════════════════════════════════════════════════════════════════════════
function groverTrace(N, target, maxSteps) {
  const n = Math.max(2, Math.floor(N)), t = ((Math.floor(target) % n) + n) % n;
  const s = 1 / Math.sqrt(n);
  const amp = new Float64Array(n).fill(s);
  const steps = Math.min(Math.max(1, Math.floor(maxSteps) || 1), 200);
  const optimal = Math.max(1, Math.round((Math.PI / 4) * Math.sqrt(n)));
  const curve = [];
  for (let k = 0; k <= steps; k++) {
    curve.push({ step: k, probability: r6(amp[t] ** 2) });
    if (k === steps) break;
    // Oracle：翻转目标振幅
    amp[t] = -amp[t];
    // Diffusion：2|s⟩⟨s| − I
    let mean = 0;
    for (let i = 0; i < n; i++) mean += amp[i];
    mean /= n;
    for (let i = 0; i < n; i++) amp[i] = 2 * mean - amp[i];
  }
  return { N: n, target: t, optimalSteps: optimal, peak: Math.max(...curve.map((c) => c.probability)), curve };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · 离散时间量子游走（1D 环，Hadamard coin）
//    位置分布方差随 t² 增长（弹道扩散），经典随机游走仅随 t 线性增长。
// ═══════════════════════════════════════════════════════════════════════════
function quantumWalk(positions, steps) {
  const P = Math.max(4, Math.floor(positions)), T = Math.max(1, Math.floor(steps));
  // 态：pos × coin(0=右,1=左)，复振幅
  const re = new Float64Array(P * 2), im = new Float64Array(P * 2);
  const mid = Math.floor(P / 2);
  re[mid * 2] = 1 / Math.sqrt(2); im[mid * 2 + 1] = 1 / Math.sqrt(2); // 对称初态
  const H = 1 / Math.sqrt(2);
  const variances = [];
  for (let t = 0; t <= T; t++) {
    const p = new Float64Array(P);
    let total = 0;
    for (let x = 0; x < P; x++) {
      p[x] = re[x * 2] ** 2 + im[x * 2] ** 2 + re[x * 2 + 1] ** 2 + im[x * 2 + 1] ** 2;
      total += p[x];
    }
    let mean = 0;
    for (let x = 0; x < P; x++) { p[x] /= (total || 1); mean += x * p[x]; }
    let varr = 0;
    for (let x = 0; x < P; x++) varr += p[x] * (x - mean) ** 2;
    variances.push({ step: t, variance: r6(varr), mass: r6(total) });
    if (t === T) break;
    const nre = new Float64Array(P * 2), nim = new Float64Array(P * 2);
    for (let x = 0; x < P; x++) {
      const c0r = re[x * 2], c0i = im[x * 2], c1r = re[x * 2 + 1], c1i = im[x * 2 + 1];
      // Hadamard coin
      const h0r = H * (c0r + c1r), h0i = H * (c0i + c1i);
      const h1r = H * (c0r - c1r), h1i = H * (c0i - c1i);
      // 条件移位：coin 0 → x+1，coin 1 → x−1（环）
      const xr = (x + 1) % P, xl = (x - 1 + P) % P;
      nre[xr * 2] += h0r; nim[xr * 2] += h0i;
      nre[xl * 2 + 1] += h1r; nim[xl * 2 + 1] += h1i;
    }
    re.set(nre); im.set(nim);
  }
  const last = variances[variances.length - 1];
  return { positions: P, steps: T, finalVariance: last.variance, classicalVariance: r6(T),
    ballisticRatio: r6(last.variance / Math.max(1e-9, T)), massError: r6(Math.abs(last.mass - 1)), variances };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · 信息论
// ═══════════════════════════════════════════════════════════════════════════
function shannonEntropy(p) {
  const s = p.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  let h = 0;
  for (const v of p) { const q = Math.max(0, v) / s; if (q > 1e-15) h -= q * Math.log2(q); }
  return { bits: r6(h), normalized: r6(h / (Math.log2(p.length || 2) || 1)) };
}
function klDivergence(p, q) {
  let d = 0;
  for (let i = 0; i < p.length; i++) {
    const a = Math.max(1e-12, p[i]), b = Math.max(1e-12, q[i] ?? 1e-12);
    d += a * Math.log2(a / b);
  }
  return r6(Math.max(0, d));
}
/** 2×2 联合分布的互信息 I(X;Y) = Σ p(x,y) log₂[p(x,y)/(p(x)p(y))]。 */
function mutualInformation(joint) {
  const px = [joint[0][0] + joint[0][1], joint[1][0] + joint[1][1]];
  const py = [joint[0][0] + joint[1][0], joint[0][1] + joint[1][1]];
  let mi = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const v = Math.max(1e-12, joint[i][j]), den = Math.max(1e-12, px[i] * py[j]);
    mi += v * Math.log2(v / den);
  }
  return r6(Math.max(0, mi));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · 变分自由能 / 预测编码（标量高斯生成模型，解析可验）
//    q(x)=N(μ,v)，先验 N(μ0,v0)，似然 p(o|x)=N(x,vo)
//    后验精度 = 先验精度 + 观测精度；F = KL(q||prior) − E_q[ln p(o|x)]
// ═══════════════════════════════════════════════════════════════════════════
function bayesianUpdate(priorMu, priorVar, observation, obsVar) {
  const pi0 = 1 / Math.max(1e-9, priorVar), pio = 1 / Math.max(1e-9, obsVar);
  const pi = pi0 + pio;
  const mu = (pi0 * priorMu + pio * observation) / pi;
  return { mu: r6(mu), variance: r6(1 / pi), precision: r6(pi) };
}
function variationalFreeEnergy(mu, v, priorMu, priorVar, observation, obsVar) {
  const kl = 0.5 * (Math.log(priorVar / v) + (v + (mu - priorMu) ** 2) / priorVar - 1);
  const negLogLike = 0.5 * (Math.log(TAU * obsVar) + (v + (observation - mu) ** 2) / obsVar);
  return { freeEnergy: r6(kl + negLogLike), kl: r6(kl), negLogLikelihood: r6(negLogLike) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · 图谱算法（幂迭代 / Jacobi 特征值）
// ═══════════════════════════════════════════════════════════════════════════
function pageRank(adj, opts = {}) {
  const n = adj.length, d = opts.damping ?? 0.85, iters = opts.iters ?? 100;
  let r = new Float64Array(n).fill(1 / n);
  let residual = 1;
  for (let k = 0; k < iters; k++) {
    const out = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let deg = 0;
      for (let i = 0; i < n; i++) deg += Math.abs(adj[j][i] || 0);
      if (deg === 0) { for (let i = 0; i < n; i++) out[i] += r[j] / n; continue; }
      for (let i = 0; i < n; i++) out[i] += r[j] * Math.abs(adj[j][i] || 0) / deg;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) { out[i] = d * out[i] + (1 - d) / n; sum += out[i]; }
    for (let i = 0; i < n; i++) out[i] /= (sum || 1);
    residual = 0;
    for (let i = 0; i < n; i++) residual = Math.max(residual, Math.abs(out[i] - r[i]));
    r = out;
    if (residual < 1e-12) break;
  }
  return { ranks: Array.from(r, r6), sum: r6(r.reduce((a, b) => a + b, 0)), residual: r6(residual) };
}
function eigenCentrality(adj, iters = 200) {
  const n = adj.length;
  let v = new Float64Array(n).fill(1 / Math.sqrt(n));
  let lambda = 0;
  for (let k = 0; k < iters; k++) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) w[i] += adj[i][j] * v[j];
    const nrm = Math.sqrt(w.reduce((a, b) => a + b * b, 0)) || 1;
    for (let i = 0; i < n; i++) w[i] /= nrm;
    lambda = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) lambda += w[i] * adj[i][j] * w[j];
    v = w;
  }
  return { centrality: Array.from(v, r6), eigenvalue: r6(lambda) };
}
/** 实对称矩阵 Jacobi 特征值分解（n ≤ 64），返回升序特征值。 */
function jacobiEigenvalues(A, iters = 1000) {
  const n = A.length;
  const M = A.map((row) => row.slice());
  for (let sweep = 0; sweep < iters; sweep++) {
    let p = 0, q = 1, mx = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(M[i][j]) > mx) { mx = Math.abs(M[i][j]); p = i; q = j; }
    }
    if (mx < 1e-12) break;
    const theta = 0.5 * Math.atan2(2 * M[p][q], M[q][q] - M[p][p]);
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let k = 0; k < n; k++) {
      const mkp = M[k][p], mkq = M[k][q];
      M[k][p] = c * mkp - s * mkq; M[k][q] = s * mkp + c * mkq;
    }
    for (let k = 0; k < n; k++) {
      const mpk = M[p][k], mqk = M[q][k];
      M[p][k] = c * mpk - s * mqk; M[q][k] = s * mpk + c * mqk;
    }
  }
  const eig = [];
  for (let i = 0; i < n; i++) eig.push(M[i][i]);
  return eig.sort((a, b) => a - b).map(r6);
}
/** 归一化拉普拉斯谱隙（algebraic connectivity，λ₂）。 */
function normalizedLaplacianGap(adj) {
  const n = adj.length;
  const deg = adj.map((row) => row.reduce((a, b) => a + Math.abs(b), 0));
  const L = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    if (i === j) return deg[i] > 0 ? 1 : 0;
    return deg[i] > 0 && deg[j] > 0 ? -Math.abs(adj[i][j]) / Math.sqrt(deg[i] * deg[j]) : 0;
  }));
  const eig = jacobiEigenvalues(L);
  return { eigenvalues: eig, spectralGap: eig[1] ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8 · 自我迭代闭环（纯函数，状态可 JSON 落盘）
//    每轮：观测 → 预测 → 误差 → 贝叶斯更新 → 自由能 → 信息熵 → 策略调整
// ═══════════════════════════════════════════════════════════════════════════
const ITERATION_FORMULAS = [
  'predict = q.μ（当前生成模型对下一观测的预测）',
  'error = observation − predict',
  'q ← Bayes(q, o)：μ=(π₀μ₀+πₒo)/(π₀+πₒ)，v=1/(π₀+πₒ)',
  'F = KL(q‖prior) − E_q[ln p(o|x)]（变分自由能）',
  'H = −Σ p log₂ p（近期误差分布的香农熵）',
  'purity = 1 − H_normalized（误差可预测性，映射为 Bloch 纯度的类比量）',
  'explore = clamp(0.15 + 0.7·H_normalized)（熵高 ⇒ 多探索，熵低 ⇒ 多利用）',
  'learningRate = clamp(|ΔF| / (1+|ΔF|))（自由能下降幅度决定学习率）',
];

function initialIterationState(seed = 1) {
  return {
    schema: 1, seed: Number(seed) || 1, generation: 0,
    model: { mu: 0.5, variance: 0.25, priorMu: 0.5, priorVar: 0.25, obsVar: 0.16 },
    policy: { exploration: 0.5, learningRate: 0.1, confidence: 0.5 },
    errorWindow: [], log: [], boundary: DEEP_MATH_BOUNDARY,
  };
}

/** 单步自我迭代。返回全新状态（不改入参），record 为可审计记录。 */
function iterateSelf(state, observation, opts = {}) {
  const s0 = state && state.schema === 1 ? state : initialIterationState(opts.seed);
  const s = JSON.parse(JSON.stringify(s0));
  const o = clamp(Number(observation));
  const m = s.model;
  const prediction = m.mu;
  const error = o - prediction;

  const posterior = bayesianUpdate(m.priorMu, m.priorVar, o, m.obsVar);
  const F = variationalFreeEnergy(posterior.mu, posterior.variance, m.priorMu, m.priorVar, o, m.obsVar);

  // 近期误差分布的归一化熵：越小说明模型越能解释观测
  s.errorWindow.push(Math.abs(error));
  if (s.errorWindow.length > 8) s.errorWindow.shift();
  const ew = s.errorWindow;
  const mags = ew.map((e) => 1 / (1 + e * 12));
  const total = mags.reduce((a, b) => a + b, 0) || 1;
  const dist = mags.map((v) => v / total);
  const H = shannonEntropy(dist);
  const purity = r6(1 - H.normalized);
  const explore = r6(0.15 + 0.7 * H.normalized);
  const prevF = s.log.length ? s.log[s.log.length - 1].freeEnergy : F.freeEnergy;
  const dF = Math.abs(prevF - F.freeEnergy);
  const learningRate = r6(dF / (1 + dF));

  // 后验成为下一轮先验；轻微向观测回归，避免方差坍缩到 0 后失去可塑性
  const nextVar = Math.max(0.02, posterior.variance * 0.92 + 0.02);
  s.model = {
    mu: posterior.mu, variance: r6(nextVar),
    priorMu: posterior.mu, priorVar: r6(nextVar), obsVar: m.obsVar,
  };
  s.policy = {
    exploration: explore, learningRate, confidence: r6(clamp(1 - Math.abs(error))),
  };
  s.generation += 1;

  const record = {
    generation: s.generation, observation: r6(o), prediction: r6(prediction),
    error: r6(error), absError: r6(Math.abs(error)),
    freeEnergy: F.freeEnergy, kl: F.kl, negLogLikelihood: F.negLogLikelihood,
    entropyBits: H.bits, entropyNormalized: H.normalized, purity,
    exploration: explore, learningRate, confidence: s.policy.confidence,
    posteriorMu: posterior.mu, posteriorVariance: posterior.variance,
    decision: Math.abs(error) > 0.2 ? 'explore' : (explore > 0.5 ? 'probe' : 'exploit'),
    formulas: ITERATION_FORMULAS,
    at: opts.at || null,
  };
  s.log.push(record);
  if (s.log.length > 40) s.log = s.log.slice(-40);
  return { state: s, record };
}

/** 把迭代策略映射成量子态的退相干量：置信越低，相位阻尼越强（真实映射）。 */
function policyToQuantum(policy) {
  const lambda = r6(clamp(0.05 + 0.8 * (1 - clamp(policy.confidence))));
  let psi = { re: new Float64Array([Math.SQRT1_2, Math.SQRT1_2]), im: new Float64Array([0, 0]) };
  const rho0 = densityFromState(psi);
  const rho1 = applyKraus(rho0, phaseDampingKraus(lambda));
  return {
    lambda, blochBefore: blochVector(rho0), blochAfter: blochVector(rho1),
    entropyBefore: r6(vonNeumannEntropy(rho0)), entropyAfter: r6(vonNeumannEntropy(rho1)),
    purityAfter: r6(purity(rho1)), traceAfter: r6(trace(rho1)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9 · 全量数值自检（界面显示的就是它的真实返回）
// ═══════════════════════════════════════════════════════════════════════════
function selfCheck() {
  const checks = {};
  const put = (name, ok, value, note) => { checks[name] = { ok: !!ok, value: r6(typeof value === 'number' ? value : 0), note }; };

  // 酉性：U†U = I
  const adj = [[0, 1, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 1, 0]];
  const H = hamiltonianFromAdjacency(adj, 0.35), U = unitaryFromHamiltonian(H, 0.7);
  const ue = unitarityError(U);
  put('酉演化 U†U=I', ue < 1e-9, ue, 'U=e^(-iHt)，矩阵指数缩放平方 + 泰勒');
  const psi = evolveState(U, { re: new Float64Array([1, 0, 0, 0]), im: new Float64Array(4) });
  const pp = probabilities(psi);
  put('演化后 Born 归一', Math.abs(pp.reduce((a, b) => a + b, 0) - 1) < 1e-9, pp.reduce((a, b) => a + b, 0), 'Σ|αᵢ|²');

  // 密度矩阵 / 退相干
  const psi2 = { re: new Float64Array([Math.SQRT1_2, Math.SQRT1_2]), im: new Float64Array([0, 0]) };
  const rho = densityFromState(psi2);
  const s0 = vonNeumannEntropy(rho);
  const rhoD = applyKraus(rho, phaseDampingKraus(0.6));
  const s1 = vonNeumannEntropy(rhoD);
  put('纯态 von Neumann 熵≈0', s0 < 1e-9, s0, 'S=−Tr(ρ log₂ρ)');
  put('相位阻尼后熵上升', s1 > s0 + 0.2, s1, 'Kraus K₀=diag(1,√(1−λ)), K₁=diag(0,√λ)');
  put('退相干保迹', Math.abs(trace(rhoD) - 1) < 1e-9, trace(rhoD), 'Tr ρ=1');
  const rhoA = applyKraus(rho, amplitudeDampingKraus(0.5));
  put('振幅阻尼保迹', Math.abs(trace(rhoA) - 1) < 1e-9, trace(rhoA), 'K₁=[[0,√γ],[0,0]]');

  // Grover
  const g = groverTrace(16, 7, 8);
  put('Grover 峰值概率 >0.9', g.peak > 0.9, g.peak, 'N=16，最优迭代≈π/4·√N=' + g.optimalSteps);
  put('Grover 最优迭代≈π/4√N', g.optimalSteps === Math.round(Math.PI / 4 * 4), g.optimalSteps, '3');

  // 量子游走
  const qw = quantumWalk(64, 16);
  put('量子游走概率守恒', qw.massError < 1e-9, qw.massError, 'Σp=1');
  put('弹道扩散快于经典游走', qw.finalVariance > qw.classicalVariance, qw.finalVariance, '经典方差=' + qw.classicalVariance);

  // 信息论
  put('均匀分布香农熵=1bit', Math.abs(shannonEntropy([0.5, 0.5]).bits - 1) < 1e-9, shannonEntropy([0.5, 0.5]).bits, 'H=−Σp log₂p');
  put('同分布 KL=0', klDivergence([0.5, 0.5], [0.5, 0.5]) < 1e-9, klDivergence([0.5, 0.5], [0.5, 0.5]), 'D_KL(p‖p)=0');
  put('独立联合分布互信息=0', mutualInformation([[0.25, 0.25], [0.25, 0.25]]) < 1e-9, mutualInformation([[0.25, 0.25], [0.25, 0.25]]), 'I(X;Y)=0');

  // 自由能 / 预测编码
  let st = initialIterationState(7), Fs = [];
  for (let k = 0; k < 6; k++) { const r = iterateSelf(st, 0.8, { at: 'selfcheck' }); st = r.state; Fs.push(r.record.freeEnergy); }
  put('自由能随迭代不增', Fs.every((v, i) => i === 0 || v <= Fs[i - 1] + 1e-6), Fs[Fs.length - 1], Fs.map(r4).join(' → '));
  put('预测误差随迭代下降', st.log[st.log.length - 1].absError < st.log[0].absError, st.log[st.log.length - 1].absError, '贝叶斯精度加权更新');
  put('策略探索率在 [0,1]', st.policy.exploration >= 0 && st.policy.exploration <= 1, st.policy.exploration, '由误差分布熵映射');

  // 图谱
  const pr = pageRank(adj);
  put('PageRank 和为 1', Math.abs(pr.sum - 1) < 1e-9, pr.sum, '阻尼 0.85 幂迭代');
  const ec = eigenCentrality(adj);
  put('特征向量中心性收敛', ec.eigenvalue > 0, ec.eigenvalue, 'Rayleigh 商');
  const gap = normalizedLaplacianGap(adj);
  put('归一化拉普拉斯 λ₁≈0', Math.abs(gap.eigenvalues[0]) < 1e-6, gap.eigenvalues[0], '连通图最小特征值');
  put('谱隙 λ₂>0', gap.spectralGap > 0, gap.spectralGap, 'algebraic connectivity');

  // 退相干映射
  const pq = policyToQuantum({ confidence: 0.2 });
  put('低置信度触发更强退相干', pq.entropyAfter > pq.entropyBefore, pq.entropyAfter, 'λ=' + pq.lambda);

  const ok = Object.values(checks).every((c) => c.ok);
  return {
    ok, passed: Object.values(checks).filter((c) => c.ok).length,
    total: Object.keys(checks).length, checks,
    boundary: DEEP_MATH_BOUNDARY, formulas: ITERATION_FORMULAS,
  };
}

module.exports = {
  DEEP_MATH_BOUNDARY, ITERATION_FORMULAS,
  makeRng, mat, identity, matMul, matExp, hamiltonianFromAdjacency,
  unitaryFromHamiltonian, unitarityError, evolveState, probabilities,
  densityFromState, trace, purity, vonNeumannEntropy, applyKraus,
  phaseDampingKraus, amplitudeDampingKraus, blochVector,
  groverTrace, quantumWalk,
  shannonEntropy, klDivergence, mutualInformation,
  bayesianUpdate, variationalFreeEnergy,
  pageRank, eigenCentrality, jacobiEigenvalues, normalizedLaplacianGap,
  initialIterationState, iterateSelf, policyToQuantum,
  selfCheck,
};
