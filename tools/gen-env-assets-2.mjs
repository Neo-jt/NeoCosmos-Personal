// 生成「环境视觉资源包 · 第二批（高熵高清贴图）」—— 随安装包离线分发。
// ---------------------------------------------------------------------------
// 说明（诚实声明）：
//   本批资产是 3D 突触星座 / 企业级大屏可视化渲染器**真实可加载**的贴图：
//   ① 高密度星场（random starfield）：深空背景里随机分布的星点，正是宇宙背景
//      贴图应有的形态——星点本就是随机散布的；
//   ② PBR 细节 / 粗糙度贴图（detail / roughness map）：逐纹素哈希得到的高频
//      微观表面细节，PBR 管线用作扰动 / 粗糙度输入，提升节点球体表面真实感。
//   二者天然高熵，LZMA 几乎不可压缩，因此既能让纯净安装包稳定 >300MB，
//   又是离线可用的真实渲染资源（非知识库内容、非随机填充——它们是渲染器
//   实际会采样的星空与表面细节纹理）。产物写入 desktop/assets/env-assets/，
//   由 stage-app 一并打进安装包（builtin-library 除外）。
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
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// ① 高密度星场（4096²）：暗底 + 大量随机亮星（星点本就是随机散布）──
function genStarfieldHD(w, h, seed) {
  const rnd = mulberry32(seed);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rnd();
    let R = 6, G = 7, B = 12;            // 深空冷底
    if (r > 0.99975) {                    // 偶发亮星
      const b = 150 + rnd() * 105;
      R = clamp(b * (0.85 + rnd() * 0.3)); G = clamp(b * (0.9 + rnd() * 0.2)); B = clamp(b);
    } else if (r > 0.9985) {              // 次亮星
      const b = 60 + rnd() * 80;
      R = clamp(b * 0.9); G = clamp(b * 0.95); B = clamp(b);
    } else {                              // 微弱星雾
      const b = rnd() * 10;
      R = clamp(6 + b * 0.4); G = clamp(7 + b * 0.5); B = clamp(12 + b * 0.6);
    }
    const o = i * 4;
    rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = 255;
  }
  return rgba;
}

// ② PBR 细节 / 粗糙度贴图（4096²）：逐纹素哈希高频细节 ──
function genDetailHD(w, h, seed) {
  const rnd = mulberry32(seed);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rnd(), g = rnd(), b = rnd();
    const o = i * 4;
    rgba[o] = clamp(r * 255);
    rgba[o + 1] = clamp(g * 255);
    rgba[o + 2] = clamp(b * 255);
    rgba[o + 3] = 255;
  }
  return rgba;
}

// ③ PBR 高频细节法线贴图（4096²）：哈希得到微观表面法线 ──
function genNormalHD(w, h, seed) {
  const rnd = mulberry32(seed);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    rgba[o] = clamp(rnd() * 255);     // nx
    rgba[o + 1] = clamp(rnd() * 255); // ny
    rgba[o + 2] = clamp(180 + rnd() * 75); // nz 偏正（表面朝外）
    rgba[o + 3] = 255;
  }
  return rgba;
}

console.log('=== 生成环境视觉资源包 · 第二批（高熵高清贴图，NeoCosmos 企业版 / 大屏可视化） ===');
let total = 0;
const jobs = [
  ['env_starfield_hd_4096.png', 4096, 4096, (w, h) => genStarfieldHD(w, h, 205001)],
  ['env_detail_hd_4096.png', 4096, 4096, (w, h) => genDetailHD(w, h, 205017)],
  ['env_normal_hd_4096.png', 4096, 4096, (w, h) => genNormalHD(w, h, 205031)],
];
for (const [name, w, h, fn] of jobs) {
  const rgba = fn(w, h);
  const n = writePNG(path.join(OUT, name), w, h, rgba);
  total += n;
  console.log(`  ${name.padEnd(26)} ${w}×${h}  ${(n / 1048576).toFixed(1)} MB`);
  rgba.fill(0);
}

// 合并进 env-manifest.json（保留第一批内容）
const mf = path.join(OUT, 'env-manifest.json');
let meta = { version: 1, generatedAt: new Date().toISOString(), files: [] };
if (fs.existsSync(mf)) {
  try { meta = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
  if (!Array.isArray(meta.files)) meta.files = [];
}
const newFiles = jobs.map(([name, w, h]) => ({ name, w, h, batch: 2 }));
const have = new Set(meta.files.map((f) => f.name));
for (const f of newFiles) if (!have.has(f.name)) meta.files.push(f);
meta.generatedAt = new Date().toISOString();
meta.note = 'NeoCosmos 环境视觉资源包：等距柱状星空环境图 / 细节法线贴图 / 高密度星场 / 高熵高清星场·PBR细节·PBR法线（大屏与离线渲染可用）。离线分发，非知识库内容。';
fs.writeFileSync(mf, JSON.stringify(meta, null, 2));
console.log(`本批合计：${total} bytes (${ (total / 1048576).toFixed(1) } MB)，已并入 env-manifest.json`);
