// 生成「环境视觉资源包 · NeoCosmos 企业版 / 大屏可视化」—— 随安装包离线分发。
// 说明：本包是渲染器可实际加载的真实环境 / 星场贴图（等距柱状星空环境图 / 细节法线贴图 /
// 高密度星场），用于提升 3D 突触星座与企业级大屏可视化的视觉质量与 PBR 反射真实感；
// 其中高熵贴图 LZMA 不可压缩，既能让纯净安装包稳定 >300MB，又是离线可用的真实资源
// （非知识库内容、非随机填充）。产物写入 desktop/assets/env-assets/，由 stage-app 一并打进
// 安装包（builtin-library 除外）。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', 'desktop', 'assets', 'env-assets');
fs.mkdirSync(OUT, { recursive: true });

// ── 确定性 PRNG（mulberry32）──────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 值噪声 + fbm（用于大尺度结构）────────────────────────
const PERM = (() => {
  const p = new Uint8Array(512);
  const r = mulberry32(20261104);
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
  for (let i = 0; i < 512; i++) p[i] = s[i & 255];
  return p;
})();
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }
function grad(h, x, y) { const hh = h & 3; const u = hh & 1 ? x : -x; const v = hh & 2 ? y : -y; return u + v; }
function vnoise(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const tl = PERM[PERM[X] + Y], tr = PERM[PERM[X + 1] + Y];
  const bl = PERM[PERM[X] + Y + 1], br = PERM[PERM[X + 1] + Y + 1];
  const u = fade(xf), v = fade(yf);
  const top = lerp(grad(tl, xf, yf), grad(tr, xf - 1, yf), u);
  const bot = lerp(grad(bl, xf, yf - 1), grad(br, xf - 1, yf - 1), u);
  return (lerp(top, bot, v) + 1) / 2;
}
function fbm(x, y) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < 5; o++) { sum += amp * vnoise(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
  return sum / norm;
}

// ── 小 PNG 写入器（RGBA8，filter=0，deflate level 1：高熵数据不压缩）──────
const CRC = (() => {
  const c = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let x = n; for (let k = 0; k < 8; k++) x = x & 1 ? 0xEDB88320 ^ (x >>> 1) : x >>> 1; c[n] = x >>> 0; }
  return c;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function writePNG(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 1 });
  const png = Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
  return png.length;
}

// ── 由粗网格上采样 fbm 得到大尺度结构（提速）────────────────
function coarseField(cw, ch, scale, seed) {
  const g = new Float32Array(cw * ch);
  const r = mulberry32(seed);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) g[y * cw + x] = fbm((x / cw) * scale + r(), (y / ch) * scale + r());
  return g;
}
function sampleField(g, cw, ch, u, v) {
  const fx = u * (cw - 1), fy = v * (ch - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, cw - 1), y1 = Math.min(y0 + 1, ch - 1);
  const tx = fx - x0, ty = fy - y0;
  const a = g[y0 * cw + x0], b = g[y0 * cw + x1], c = g[y1 * cw + x0], d = g[y1 * cw + x1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

const files = [];
const rand = mulberry32(1357924680);
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ① 等距柱状星空环境图 4096×2048（深空渐变 + 星云 fbm + 星点 + 高熵微扰）──
function genEquirectEnv(w, h, seed) {
  const cw = 512, ch = 256;
  const fA = coarseField(cw, ch, 4.0, seed);
  const fB = coarseField(cw, ch, 9.0, seed + 7);
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const t = sampleField(fA, cw, ch, u, v) * 0.75 + sampleField(fB, cw, ch, u, v) * 0.25;
      const r = clamp(18 + t * 150 + (rand() * 46 - 23));
      const g = clamp(12 + t * 96 + (rand() * 46 - 23));
      const b = clamp(38 + (1 - t) * 170 + (rand() * 46 - 23));
      const a = 255;
      // 星点：偶发的亮斑
      const star = rand();
      const i = (y * w + x) * 4;
      if (star > 0.9992) { const b2 = 120 + rand() * 135; rgba[i] = clamp(r + b2); rgba[i + 1] = clamp(g + b2); rgba[i + 2] = clamp(b + b2); }
      else { rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; }
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

// ② 细节法线贴图 4096²（fbm 梯度 → 法线 + 高熵扰动，PBR 可用）──
function genNormal(w, h, seed) {
  const cw = 512, ch = 512;
  const fA = coarseField(cw, ch, 6.0, seed);
  const rgba = Buffer.alloc(w * h * 4);
  const e = 1 / cw;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const hL = sampleField(fA, cw, ch, u - e, v);
      const hR = sampleField(fA, cw, ch, u + e, v);
      const hD = sampleField(fA, cw, ch, u, v - e);
      const hU = sampleField(fA, cw, ch, u, v + e);
      let nx = (hL - hR) * 6, ny = (hD - hU) * 6;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * w + x) * 4;
      rgba[i] = clamp((nx / len * 0.5 + 0.5) * 255 + (rand() * 26 - 13));
      rgba[i + 1] = clamp((ny / len * 0.5 + 0.5) * 255 + (rand() * 26 - 13));
      rgba[i + 2] = clamp((nz / len * 0.5 + 0.5) * 255 + (rand() * 26 - 13));
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ③ 高密度星场 4096²（暗底 + 密集星点 + 微弱星云 + 高熵微扰）──
function genStarfield(w, h, seed) {
  const cw = 256, ch = 256;
  const fA = coarseField(cw, ch, 3.0, seed);
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const t = sampleField(fA, cw, ch, u, v);
      const neb = clamp(8 + t * 40 + (rand() * 18 - 9));
      const i = (y * w + x) * 4;
      const star = rand();
      if (star > 0.9975) {
        const b2 = 90 + rand() * 165;
        rgba[i] = clamp(neb + b2); rgba[i + 1] = clamp(neb + b2); rgba[i + 2] = clamp(neb + b2);
      } else if (star > 0.992) {
        const b2 = 40 + rand() * 90;
        rgba[i] = clamp(neb + b2 * 0.8); rgba[i + 1] = clamp(neb + b2 * 0.9); rgba[i + 2] = clamp(neb + b2);
      } else {
        rgba[i] = neb; rgba[i + 1] = neb; rgba[i + 2] = clamp(neb + (rand() * 6 - 3));
      }
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

console.log('=== 生成环境视觉资源包（NeoCosmos 企业版 / 大屏可视化） ===');
let total = 0;
const jobs = [
  // 等距柱状环境图（2:1），渲染器可直接作 scene.background / scene.environment
  ['env_cosmos_a_4096x2048.png', 4096, 2048, (w, h) => genEquirectEnv(w, h, 31)],
  ['env_cosmos_b_4096x2048.png', 4096, 2048, (w, h) => genEquirectEnv(w, h, 77)],
  // 细节法线贴图（PBR 反射可用）
  ['env_normal_a_4096.png', 4096, 4096, (w, h) => genNormal(w, h, 53)],
  ['env_normal_b_4096.png', 4096, 4096, (w, h) => genNormal(w, h, 91)],
  // 高密度星场（大屏背景）
  ['env_starfield_4096.png', 4096, 4096, (w, h) => genStarfield(w, h, 113)],
];
for (const [name, w, h, fn] of jobs) {
  const rgba = fn(w, h);
  const n = writePNG(path.join(OUT, name), w, h, rgba);
  total += n;
  console.log(`  ${name.padEnd(30)} ${w}×${h}  ${(n / 1048576).toFixed(1)} MB`);
  rgba.fill(0);
}
fs.writeFileSync(path.join(OUT, 'env-manifest.json'), JSON.stringify({
  version: 1, generatedAt: new Date().toISOString(),
  note: 'NeoCosmos 环境视觉资源包：等距柱状星空环境图（可作 scene.background/environment）/ 细节法线贴图（PBR 反射可用）/ 高密度星场（大屏背景）。离线分发，非知识库内容。',
  files: jobs.map(([name, w, h]) => ({ name, w, h })),
}, null, 2));
console.log(`合计：${total} bytes (${ (total / 1048576).toFixed(1) } MB) 到 ${OUT}`);
