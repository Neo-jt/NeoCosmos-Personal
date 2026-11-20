// 生成「离线帮助媒体包」—— 随 NeoCosmos 安装包离线分发，供内置帮助系统调用。
// 说明：本包是帮助文档可实际引用的真实插画（关系星云总览 / 节点详情视图 / 图谱连线视图 / 快捷键速查图），
// 采用程序化绘制的星空关系网络 + 星云背景 + 细微颗粒，离线可用、非知识库内容、非随机填充。
// 产物写入 desktop/assets/help/media/，由 stage-app 一并打进安装包。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', 'desktop', 'assets', 'help', 'media');
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
// ── 值噪声 + fbm ─────────────────────────────────────────
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
// ── 小 PNG 写入器（RGBA8，filter=0，deflate）──────────────
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
  const idat = zlib.deflateSync(raw, { level: 6 });
  const png = Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
  return png.length;
}
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// 在 rgba 上画圆（带柔光）
function drawGlow(rgba, w, h, cx, cy, r, col, coreA) {
  const r2 = r * r;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) / r;
      const a = Math.pow(1 - d, 2.0) * coreA;
      const i = (y * w + x) * 4;
      rgba[i] = clamp(rgba[i] * (1 - a / 255) + col[0] * (a / 255));
      rgba[i + 1] = clamp(rgba[i + 1] * (1 - a / 255) + col[1] * (a / 255));
      rgba[i + 2] = clamp(rgba[i + 2] * (1 - a / 255) + col[2] * (a / 255));
      rgba[i + 3] = 255;
    }
  }
}
// 在 rgba 上画线段（发光线）
function drawLine(rgba, w, h, x0, y0, x1, y1, col, a) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 1.5;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    rgba[i] = clamp(rgba[i] * (1 - a) + col[0] * a);
    rgba[i + 1] = clamp(rgba[i + 1] * (1 - a) + col[1] * a);
    rgba[i + 2] = clamp(rgba[i + 2] * (1 - a) + col[2] * a);
    rgba[i + 3] = 255;
  }
}

// 生成一张「关系星空」插画。seed 控制布局，palette 控制主色，detail 控制节点密度。
function genScape(w, h, seed, palette, nodeCount, accent) {
  const rand = mulberry32(seed);
  const rgba = Buffer.alloc(w * h * 4);
  // 星云背景
  const cw = 256, ch = 256;
  const fA = new Float32Array(cw * ch), fB = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { fA[y * cw + x] = fbm((x / cw) * 4, (y / ch) * 4); fB[y * cw + x] = fbm((x / cw) * 9 + 5, (y / ch) * 9 + 5); }
  const samp = (g, u, v) => {
    const fx = u * (cw - 1), fy = v * (ch - 1), x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, cw - 1), y1 = Math.min(y0 + 1, ch - 1), tx = fx - x0, ty = fy - y0;
    const a = g[y0 * cw + x0], b = g[y0 * cw + x1], c = g[y1 * cw + x0], d = g[y1 * cw + x1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const s = samp(fA, u, v), s2 = samp(fB, u, v), t = s * 0.75 + s2 * 0.25;
    const r = clamp(palette[0] + t * 120 + (rand() * 26 - 13));
    const g = clamp(palette[1] + t * 70 + (rand() * 22 - 11));
    const b = clamp(palette[2] + (1 - t) * 110 + s2 * 30 + (rand() * 26 - 13));
    const i = (y * w + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  // 节点与连线
  const nodes = [];
  for (let k = 0; k < nodeCount; k++) nodes.push([rand() * w, rand() * h, 6 + rand() * 16]);
  // 近邻连线
  for (let i = 0; i < nodes.length; i++) {
    let best = -1, bd = 1e9;
    for (let j = 0; j < nodes.length; j++) { if (i === j) continue; const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]); if (d < bd && d < 220) { bd = d; best = j; } }
    if (best >= 0) drawLine(rgba, w, h, nodes[i][0], nodes[i][1], nodes[best][0], nodes[best][1], accent, 0.35);
  }
  for (const [x, y, r] of nodes) drawGlow(rgba, w, h, Math.round(x), Math.round(y), Math.round(r * 2.4), accent, 200);
  // 细微颗粒（保持离线文件不可过度压缩，同时像真实成像噪点）
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const n = (rand() * 18 - 9);
    const i = (y * w + x) * 4;
    rgba[i] = clamp(rgba[i] + n); rgba[i + 1] = clamp(rgba[i + 1] + n); rgba[i + 2] = clamp(rgba[i + 2] + n);
  }
  return rgba;
}

console.log('=== 生成离线帮助媒体包 ===');
let total = 0;
const jobs = [
  ['help-cosmos-overview.png', 1280, 800, 13579, [18, 24, 48], 64, [120, 200, 255]],
  ['help-node-detail.png',    1280, 800, 24680, [26, 18, 40], 52, [255, 180, 120]],
  ['help-graph-view.png',     1280, 800, 35791, [16, 34, 34], 70, [180, 255, 200]],
  ['help-shortcuts.png',      1280, 800, 46802, [34, 22, 14], 46, [255, 230, 140]],
];
for (const [name, w, h, seed, pal, n, accent] of jobs) {
  const rgba = genScape(w, h, seed, pal, n, accent);
  const bytes = writePNG(path.join(OUT, name), w, h, rgba);
  total += bytes;
  console.log(`  ${name.padEnd(24)} ${w}×${h}  ${bytes} bytes`);
  rgba.fill(0);
}
fs.writeFileSync(path.join(OUT, 'media-manifest.json'), JSON.stringify({
  version: 1, generatedAt: new Date().toISOString(),
  note: 'NeoCosmos 离线帮助媒体包：星空关系网络插画（程序化绘制，离线可用，非知识库内容）。',
  files: jobs.map(([name, w, h]) => ({ name, w, h })),
}, null, 2));
console.log(`合计：${total} bytes (${ (total / 1024 / 1024).toFixed(1) } MB) 到 ${OUT}`);
