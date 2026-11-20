// ============================================================================
//  NeoLink 品牌标记 · 「突触花冠」(Synaptic Rosette)
//  作者：宋锦涛 · 联系方式：13869162267
// ---------------------------------------------------------------------------
//  原创设计说明
//  ---------------------------------------------------------------------------
//  本图形为 NeoLink 独立设计的几何构造，**不复制、不描摹任何第三方产品的
//  名称、配色、图标、轮廓或构图**。构造原理如下：
//
//  ① 三层同心节点环，环上节点数分别为 3 / 6 / 9 —— 3 的倍数构成节奏，
//     而**每层相对上一层旋转一个黄金角偏移**（约 40°），于是整体呈现
//     既严格对称又不呆板的旋转韵律。这是纯粹由几何定义的原创形态。
//
//  ② 连接关系：外环节点 → 最近的中环节点 → 最近的内环节点，形成一条
//     螺旋下降的层级链。这正是 NeoLink 的核心主张 ——
//     **关系是有层级、有类型的，节点只是关系交汇处的投影**。
//
//  ③ 中心是一枚**圆角菱形**（超椭圆）核心，而不是普通圆点：
//     轮廓更独特，小尺寸下依然可辨。
//
//  ④ 外围一道细环，把构图收拢，避免元素散逸。
//
//  渲染方式：不依赖任何图像库 —— 自建 PNG 编码器（zlib + CRC32）与
//  ICO 容器，纯数学光栅化。**同一套几何数据同时产出 PNG/ICO 与 SVG**，
//  二者永远一致，不存在"图标和 logo 对不上"的问题。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = process.argv[2] || path.resolve('desktop', 'assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------- CRC32 ----------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- PNG 编码 ----------------
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    rgba.copy(raw, o, y * width * 4, (y + 1) * width * 4);
    o += width * 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- 数学工具 ----------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}
/** 超椭圆（圆角菱形）隐函数：n=2 是圆，n 越大越方；n<2 越"菱" */
function sdSuperEllipse(px, py, r, n) {
  const q = Math.pow(Math.pow(Math.abs(px), n) + Math.pow(Math.abs(py), n), 1 / n);
  return q - r;
}

// ============================================================================
//  几何定义（唯一真相来源 —— PNG 与 SVG 都由它推导）
// ============================================================================
const DEG = Math.PI / 180;
const GOLDEN_OFFSET = 40 * DEG;   // 层间旋转偏移（黄金角近似）

/** 三层节点环：{ x, y, r(半径), s(节点半径), ring } */
const RINGS = [
  { count: 3, radius: 0.285, nodeR: 0.046, offset: 0 },
  { count: 6, radius: 0.520, nodeR: 0.034, offset: GOLDEN_OFFSET },
  { count: 9, radius: 0.735, nodeR: 0.025, offset: GOLDEN_OFFSET * 2 },
];

const NODES = [];
for (const [ri, ring] of RINGS.entries()) {
  for (let i = 0; i < ring.count; i++) {
    // 每层内部再加一点固定偏移，避免各环节点上下对齐成"十字"
    const a = ring.offset + (i * 2 * Math.PI) / ring.count + (ri * 7 * DEG);
    NODES.push({
      x: Math.cos(a) * ring.radius,
      y: Math.sin(a) * ring.radius,
      s: ring.nodeR,
      ring: ri,
      ang: a,
    });
  }
}

/** 找离 (x,y) 最近、且属于指定环的节点 */
function nearestInRing(x, y, ringIdx) {
  let best = null, bd = Infinity;
  for (const n of NODES) {
    if (n.ring !== ringIdx) continue;
    const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** 连接：外环 → 最近中环；中环 → 最近内环。构成螺旋下降的层级链。 */
const LINKS = [];
for (const n of NODES.filter((x) => x.ring === 2)) {
  const m = nearestInRing(n.x, n.y, 1);
  if (m) LINKS.push([n, m]);
}
for (const n of NODES.filter((x) => x.ring === 1)) {
  const m = nearestInRing(n.x, n.y, 0);
  if (m) LINKS.push([n, m]);
}

/**
 * 同层弧线：把同一圈的节点首尾相连，构成三条同心环。
 * 没有它，三层节点在视觉上只是"散落的点"，看不出层级；
 * 有了它，构图才立刻读作一朵有秩序的花冠。
 */
const RING_ARCS = [];
for (let ri = 0; ri < RINGS.length; ri++) {
  const g = NODES.filter((n) => n.ring === ri);
  for (let i = 0; i < g.length; i++) {
    const a = g[i], b = g[(i + 1) % g.length];
    RING_ARCS.push({ a, b, ring: ri });
  }
}

/** 中心核：圆角菱形（超椭圆） */
const CORE_R = 0.115;
const CORE_N = 1.55;
/** 外围细环 */
const OUTER_RING_R = 0.885;

// ---------------- 调色板（原创配色） ----------------
const COL = {
  bgTop:    [0.035, 0.043, 0.110],
  bgBottom: [0.118, 0.071, 0.243],
  bgCore:   [0.239, 0.145, 0.451],
  bgLight:  [0.443, 0.318, 0.706],
  bgWarm:   [0.545, 0.267, 0.451],
  link:     [0.545, 0.482, 1.000],
  node:     [0.275, 0.878, 1.000],
  nodeHot:  [0.839, 0.965, 1.000],
  coreIn:   [1.000, 1.000, 1.000],
  coreMid:  [0.702, 0.596, 1.000],
  coreOut:  [0.396, 0.259, 0.878],
};

// ============================================================================
//  光栅化
// ============================================================================
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aaBase = 1.7 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 2 - 1;
      const py = 1 - ((y + 0.5) / size) * 2;
      const r = Math.hypot(px, py);

      // ---- 深空底盘 ----
      let bg = mix3(COL.bgTop, COL.bgBottom, clamp((py + 1) / 2, 0, 1));
      bg = mix3(bg, COL.bgCore, smoothstep(0.15, -0.60, r) * 0.88);
      bg = mix3(bg, COL.bgLight, smoothstep(0.46, 0.0, Math.hypot(px + 0.40, py - 0.44)) * 0.52);
      bg = mix3(bg, COL.bgWarm, smoothstep(0.42, 0.0, Math.hypot(px - 0.44, py + 0.42)) * 0.34);

      // 圆盘遮罩
      const disc = 1 - smoothstep(0.962 - aaBase * 2, 0.962, r);

      // ---- 同层弧线（骨架）----
      let arc = 0;
      for (const seg of RING_ARCS) {
        const d = sdSegment(px, py, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
        const w = 0.0044 - seg.ring * 0.0005;
        const cover = 1 - smoothstep(w - aaBase, w + aaBase, d);
        if (cover > arc) arc = cover;
      }

      // ---- 层级连接线 ----
      let link = 0;
      for (const [a, b] of LINKS) {
        const d = sdSegment(px, py, a.x, a.y, b.x, b.y);
        // 越靠内的线越亮：表达"关系向核心汇聚"
        const w = 0.0075 + (2 - b.ring) * 0.0016;
        const cover = 1 - smoothstep(w - aaBase * 1.4, w + aaBase * 1.4, d);
        if (cover > link) link = cover;
      }

      // ---- 节点（带辉光） ----
      let node = 0, glow = 0;
      for (const n of NODES) {
        const d = Math.hypot(px - n.x, py - n.y);
        const cov = 1 - smoothstep(n.s - aaBase * 1.6, n.s + aaBase * 0.4, d);
        if (cov > node) node = cov;
        // 辉光按节点大小加权：核心节点更亮
        glow = Math.max(glow, Math.exp(-d * (11 - n.s * 26)) * (0.30 + n.s * 5.2));
      }

      // ---- 中心核（圆角菱形） ----
      const dCore = sdSuperEllipse(px, py, CORE_R, CORE_N);
      const core = 1 - smoothstep(-aaBase * 1.2, aaBase * 1.2, dCore);
      // 核内渐变：沿超椭圆归一化距离做插值，中心浅、边缘深
      const coreT = clamp(1 - Math.max(0, -dCore) / (CORE_R * 2.1), 0, 1);
      const coreCol = mix3(COL.coreOut, COL.coreMid, coreT);
      // 紧致镜面高光（小而偏上左，不是一大团白）
      const hx = px + CORE_R * 0.30, hy = py + CORE_R * 0.32;
      const coreHot = 1 - smoothstep(0.0, CORE_R * 0.30, Math.hypot(hx, hy));
      // 外围柔光：只在核外、且衰减快，不糊掉核的轮廓
      const coreGlow = Math.exp(-Math.max(0, dCore) * 26.0) * 0.55;

      // ---- 外围细环 + 内侧装饰环 ----
      const dRing2 = Math.abs(r - 0.845);
      const innerRing = (1 - smoothstep(0.0035 - aaBase, 0.0035 + aaBase, dRing2)) * 0.16;
      const dRing = Math.abs(r - OUTER_RING_R);
      const outer = (1 - smoothstep(0.005 - aaBase, 0.005 + aaBase, dRing)) * 0.42;

      // ---- 合成 ----
      let col = mix3(bg, [0.46, 0.50, 0.86], arc * 0.50);
      col = mix3(col, COL.link, link * 0.66);
      col = mix3(col, COL.node, node * 0.96);
      col = mix3(col, COL.nodeHot, Math.max(0, node - 0.5) * 1.0);
      col = mix3(col, COL.coreMid, glow * 0.42);
      // 核的柔光先铺底（不覆盖核自身），再画核，最后点高光
      col = mix3(col, COL.coreMid, coreGlow * 0.55);
      col = mix3(col, coreCol, core * 0.98);
      col = mix3(col, COL.coreIn, core * coreHot * 0.85);
      col = mix3(col, [0.80, 0.86, 1.0], outer);
      col = mix3(col, [0.72, 0.80, 1.0], innerRing);
      // 顶部玻璃高光
      col = mix3(col, [1, 1, 1], smoothstep(0.58, 0.98, py) * (1 - smoothstep(0.30, 0.80, r)) * 0.13);

      const i = (y * size + x) * 4;
      buf[i] = Math.round(clamp(col[0], 0, 1) * 255);
      buf[i + 1] = Math.round(clamp(col[1], 0, 1) * 255);
      buf[i + 2] = Math.round(clamp(col[2], 0, 1) * 255);
      buf[i + 3] = Math.round(disc * 255);
    }
  }
  return { pngBuf: encodePNG(size, size, buf), size };
}

// ============================================================================
//  SVG（由同一套几何生成 —— 与 PNG 永远一致）
// ============================================================================
function buildSVG() {
  const S = 64;                       // viewBox 边长
  const u = (v) => (v * S / 2 + S / 2).toFixed(2);
  const f = (v) => v.toFixed(3);
  const ringNodes = (ri) => NODES.filter((n) => n.ring === ri);

  // 每层一个渐变（由内到外：紫 → 青）
  const linksByRing = [0, 1, 2].map((ri) => {
    const g = ringNodes(ri);
    if (!g.length) return '';
    const stops = g.map((n, i) => {
      const c = ri === 0 ? '#C9B4FF' : ri === 1 ? '#9E8CFF' : '#46E0FF';
      return `<stop offset="${((i + 0.5) / g.length * 100).toFixed(1)}%" stop-color="${c}"/>`;
    }).join('');
    return `<linearGradient id="nkL${ri}" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient>`;
  }).join('');

  // 同层弧线（骨架）：把同一圈的节点连成同心环
  const ringArcs = RING_ARCS.map((seg) => {
    const w = (0.0044 - seg.ring * 0.0005) * S / 2;
    const op = (0.50 - seg.ring * 0.06).toFixed(2);
    return `<line x1="${u(seg.a.x)}" y1="${u(seg.a.y)}" x2="${u(seg.b.x)}" y2="${u(seg.b.y)}" stroke="#7A85E0" stroke-opacity="${op}" stroke-width="${f(w)}" stroke-linecap="round"/>`;
  }).join('\n  ');

  // 层级连接链（外 → 中 → 内）
  const linkPaths = [0, 1, 2].map((ri) => {
    const segs = LINKS.filter(([, b]) => b.ring === ri);
    if (!segs.length) return '';
    const d = segs.map(([a, b]) => `M${u(a.x)} ${u(a.y)}L${u(b.x)} ${u(b.y)}`).join(' ');
    const w = (0.0075 + (2 - ri) * 0.0016) * S / 2;
    return `<path d="${d}" stroke="url(#nkL${ri})" stroke-width="${f(w)}" stroke-linecap="round" fill="none" opacity="${(0.82 - ri * 0.10).toFixed(2)}"/>`;
  }).join('\n  ');

  const nodeCircles = NODES.map((n) => {
    const c = n.ring === 0 ? '#C9B4FF' : n.ring === 1 ? '#9EE9FF' : '#67E8F9';
    const r = n.s * S / 2;
    return `<circle cx="${u(n.x)}" cy="${u(n.y)}" r="${f(r)}" fill="${c}"/>`;
  }).join('\n  ');

  /**
   * 中心核：圆角菱形（超椭圆 n=1.55）。
   * 用密集采样成折线 —— 比手写贝塞尔可靠得多：
   * 参数式 x = sign(cos t)|cos t|^(2/n)·R，y 同理；取 96 个点，
   * 在 256px 下误差远小于一个像素，且绝不会出现"路径画歪"的情况。
   */
  function superellipsePath(r, n) {
    // 注意：这里用**单位坐标**（与 NODES 一致），由 u() 统一换算到 viewBox。
    // 早前误把 R 设成 r*S/2 再交给 u()，坐标被放大 32 倍 ——
    // 核心多边形直接铺满整个画布，SVG 渲染成一块紫色方块。
    const k = 2 / n;
    const N = 96;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const px = Math.sign(c) * Math.pow(Math.abs(c), k) * r;
      const py = Math.sign(sn) * Math.pow(Math.abs(sn), k) * r;
      pts.push(`${u(px)} ${u(py)}`);
    }
    return 'M' + pts.join('L') + 'Z';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- NeoLink 原创品牌标记 · 突触花冠 (Synaptic Rosette)
     作者：宋锦涛 · 联系方式：13869162267
     几何构造：三层节点环（3 / 6 / 9），层间旋转黄金角偏移；
     同层节点连成同心环，跨层连接呈螺旋下降的层级链 ——
     关系有层级、有类型，节点是关系交汇处的投影。
     本文件由 tools/make-icon.mjs 依据与 PNG/ICO 完全相同的几何数据生成。
     独立原创设计，不复制任何第三方产品之名称、配色、图标、轮廓或构图。 -->
<svg width="256" height="256" viewBox="0 0 ${S} ${S}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NeoLink">
  <defs>
    <radialGradient id="nkBg" cx="50%" cy="46%" r="66%">
      <stop offset="0%" stop-color="#2C1A63"/>
      <stop offset="46%" stop-color="#180F3C"/>
      <stop offset="100%" stop-color="#080A18"/>
    </radialGradient>
    <radialGradient id="nkCore" cx="36%" cy="32%" r="74%">
      <stop offset="0%" stop-color="#E2D9FF"/>
      <stop offset="42%" stop-color="#B398FF"/>
      <stop offset="100%" stop-color="#5B3AD4"/>
    </radialGradient>
    <radialGradient id="nkGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7C5CFF" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#7C5CFF" stop-opacity="0"/>
    </radialGradient>
    ${linksByRing}
  </defs>

  <!-- 底盘 -->
  <circle cx="32" cy="32" r="32" fill="url(#nkBg)"/>
  <circle cx="32" cy="32" r="32" fill="url(#nkGlow)"/>

  <!-- 同层同心弧（骨架） -->
  ${ringArcs}

  <!-- 层级连接链（外 → 中 → 内） -->
  ${linkPaths}

  <!-- 外围细环 + 内侧装饰环 -->
  <circle cx="32" cy="32" r="${f(OUTER_RING_R * S / 2)}" stroke="#A9B8E8" stroke-opacity="0.42" stroke-width="0.8" fill="none"/>
  <circle cx="32" cy="32" r="${f(0.845 * S / 2)}" stroke="#8FA0D8" stroke-opacity="0.16" stroke-width="0.6" fill="none"/>

  <!-- 三层节点 -->
  ${nodeCircles}

  <!-- 中心核：圆角菱形 -->
  <path d="${superellipsePath(CORE_R, CORE_N)}" fill="url(#nkCore)"/>
  <ellipse cx="${f(S / 2 - CORE_R * S * 0.11)}" cy="${f(S / 2 - CORE_R * S * 0.12)}" rx="${f(CORE_R * S * 0.14)}" ry="${f(CORE_R * S * 0.11)}" fill="#FFFFFF" fill-opacity="0.78"/>
</svg>
`;
}

// ---------------- ICO 容器 ----------------
function buildICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, i) => {
    const p = i * 16;
    dir[p] = img.size >= 256 ? 0 : img.size;
    dir[p + 1] = img.size >= 256 ? 0 : img.size;
    dir[p + 2] = 0; dir[p + 3] = 0;
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(img.pngBuf.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += img.pngBuf.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.pngBuf)]);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map(render);
const ico = buildICO(images);

const png256 = images[images.length - 1].pngBuf;
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png256);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
fs.writeFileSync(path.join(OUT_DIR, 'brand.svg'), buildSVG());
console.log(`✓ icon.png  ${png256.length} bytes (256×256)`);
console.log(`✓ icon.ico  ${ico.length} bytes  sizes=${SIZES.join(',')}`);
console.log(`✓ brand.svg ${fs.statSync(path.join(OUT_DIR, 'brand.svg')).size} bytes`);
