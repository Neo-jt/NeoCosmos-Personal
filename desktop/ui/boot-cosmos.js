// ═══════════════════════════════════════════════════════════════════════════
// NeoCosmos · 开机动画（好莱坞大片级 · 星系诞生）
// ───────────────────────────────────────────────────────────────────────────
// v6.37.0 三段式重设计（用户明确要求）：
//   ① 一个点 —— 屏幕中心一颗极小白炽奇点，安静呼吸、微微膨胀（0~16%）；
//   ② 星系运动 —— 奇点爆发，星尘沿螺旋轨道旋转汇成星系，突触花冠逐层连线点亮，
//      整片星系持续缓慢自转（16%~72%）；
//   ③ 转变为程序界面 —— 镜头推进、星系向边缘扩散淡出，字标隐退，自然露出其后的
//      真实主界面（72%~100%），不是生硬切换，而是"星系散开即见界面"。
// 强调色取自 AURORA 令牌，与外观实时一致。
//
// 工程约束（与 AURORA 体系一致）：
//   · 纯 three 核心，不依赖任何 addon（严格 CSP / 离线可用）；
//   · 强调色取自 design-system 的 --ds-ah/as/al 通道，随外观设置实时一致；
//   · 尊重系统「减少动态效果」与外观「界面动效」开关；
//   · WebGL 不可用时静默回落到 CSS 启动屏，绝不阻塞启动；
//   · 点击 / 任意按键可跳过；结束后自行淡出并移除 #boot。
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';

// ---- 缓动 ----
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

// ---- 读取 AURORA 强调色通道（HSL 数值，如 218 / 78% / 52%） ----
function readAccent() {
  try {
    const cs = getComputedStyle(document.body);
    const h = parseFloat(cs.getPropertyValue('--ds-ah')) || 218;
    const s = parseFloat(cs.getPropertyValue('--ds-as')) || 78;
    const l = parseFloat(cs.getPropertyValue('--ds-al')) || 52;
    return { h: h / 360, s: s / 100, l: l / 100 };
  } catch {
    return { h: 218 / 360, s: 0.78, l: 0.52 };
  }
}

// 径向辉光贴图（程序化，零外部依赖，启动更快）
function glowTexture(size = 256, inner = 'rgba(255,255,255,1)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, 'rgba(200,225,255,0.5)');
  g.addColorStop(0.6, 'rgba(140,180,255,0.12)');
  g.addColorStop(1, 'rgba(120,160,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 程序化星云贴图（柔和径向，强调色晕染）
function nebulaTexture(accent, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `hsla(${accent.h * 360},${accent.s * 100}%,${accent.l * 100}%,0.55)`);
  g.addColorStop(0.35, `hsla(${accent.h * 360},${accent.s * 100}%,${(accent.l + 8) * 100}%,0.18)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 突触花冠节点布局：中心 + 三环（3 / 6 / 9 节点），黄金角偏移
function coronaNodes() {
  const nodes = [{ x: 0, y: 0, z: 0, r: 0 }];
  const rings = [
    { r: 2.15, n: 3, y: 0.05, off: 0.0 },
    { r: 3.35, n: 6, y: -0.05, off: 0.32 },
    { r: 4.55, n: 9, y: 0.0, off: 0.61 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ring.off;
      nodes.push({ x: Math.cos(a) * ring.r, y: ring.y, z: Math.sin(a) * ring.r * 0.62, r: ring.r });
    }
  }
  return nodes;
}

export function startBootCosmos(opts = {}) {
  const bootEl = document.getElementById('boot');
  const canvas = document.getElementById('bootCanvas');
  const reduced = !!opts.reducedMotion;
  const accent = opts.accent || readAccent();

  // 统一出口：淡出并移除启动层，resolve
  let settled = false;
  const done = (ok = true) => {
    if (settled) return Promise.resolve();
    settled = true;
    return new Promise((resolve) => {
      if (!bootEl) return resolve();
      bootEl.classList.add('hide');
      setTimeout(() => { try { bootEl.remove(); } catch { /* ignore */ } resolve(); }, 620);
    });
  };

  // 没有画布：直接回落 CSS 启动屏
  if (!bootEl || !canvas) return done();

  // 减少动态效果：不跑 WebGL，直接呈现 CSS 启动屏（字标立即可见），短暂后淡出
  if (reduced) {
    setTimeout(() => done(), 700);
    return done();
  }

  const skip = () => done();
  const onKey = () => skip();
  const onClick = () => skip();
  window.addEventListener('keydown', onKey, { once: true });
  bootEl.addEventListener('click', onClick, { once: true });

  // WebGL 不可用 → 快速回落（CSS 启动屏仍在）
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    console.warn('[boot-cosmos] WebGL 不可用，回落 CSS 启动屏', e);
    window.removeEventListener('keydown', onKey);
    bootEl.removeEventListener('click', onClick);
    setTimeout(() => done(), 900);
    return done();
  }

  bootEl.classList.add('boot-gl'); // 隐藏 CSS 几何，仅留画布 + 字标（已确认非减少动效路径）

  const soft = (() => {
    try {
      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const nm = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      return /swiftshader|llvmpipe|software|basic render/i.test(nm);
    } catch { return false; }
  })();
  renderer.setPixelRatio(soft ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.set(0, 0, reduced ? 9 : 14);

  const col = new THREE.Color().setHSL(accent.h, accent.s, accent.l);
  const colSoft = new THREE.Color().setHSL(accent.h, Math.min(1, accent.s + 0.05), Math.min(1, accent.l + 0.18));

  // ---- 星尘（球壳分布，部分偏向强调色） ----
  const STARS = soft ? 900 : 2200;
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(STARS * 3), sc = new Float32Array(STARS * 3);
  const starCol = new THREE.Color();
  for (let i = 0; i < STARS; i++) {
    const u = Math.random(), v = Math.random();
    const theta = u * Math.PI * 2, phi = Math.acos(2 * v - 1);
    const rad = 9 + Math.random() * 8;
    sp[i * 3] = Math.sin(phi) * Math.cos(theta) * rad;
    sp[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * rad * 0.72;
    sp[i * 3 + 2] = Math.cos(phi) * rad;
    if (Math.random() < 0.32) starCol.setHSL(accent.h, accent.s, accent.l * (0.7 + Math.random() * 0.5));
    else starCol.setHSL(0.6, 0.1, 0.7 + Math.random() * 0.3);
    sc[i * 3] = starCol.r; sc[i * 3 + 1] = starCol.g; sc[i * 3 + 2] = starCol.b;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const glow = glowTexture();
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 0.16, map: glow, vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(stars);

  // ---- 星云（两片柔光，缓慢逆向旋转，强调色晕染） ----
  const nebTex = nebulaTexture(accent);
  const nebMat = new THREE.SpriteMaterial({ map: nebTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: colSoft });
  const neb1 = new THREE.Sprite(nebMat); neb1.scale.set(20, 20, 1); neb1.position.z = -6; scene.add(neb1);
  const neb2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: nebTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color().setHSL((accent.h + 0.5) % 1, accent.s, accent.l) }));
  neb2.scale.set(13, 13, 1); neb2.position.set(2.4, 1.2, -4); scene.add(neb2);

  // ---- 突触花冠：节点 + 连线 ----
  const nodes = coronaNodes();
  const nodeGeo = new THREE.BufferGeometry();
  const np = new Float32Array(nodes.length * 3);
  nodes.forEach((n, i) => { np[i * 3] = n.x; np[i * 3 + 1] = n.y; np[i * 3 + 2] = n.z; });
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(np, 3));
  const coronaGrp = new THREE.Group(); scene.add(coronaGrp);
  const nodePts = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
    size: 0.5, map: glow, color: col, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  coronaGrp.add(nodePts);

  // 连线：中心→环1、环1→环2、环2→环3 交错，构成层级关系网
  const segs = [];
  const ringIdx = [0, [1, 2, 3], [4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16, 17, 18]];
  const link = (a, b) => segs.push(nodes[a].x, nodes[a].y, nodes[a].z, nodes[b].x, nodes[b].y, nodes[b].z);
  [1, 2, 3].forEach((i) => link(0, i));
  for (let i = 0; i < 6; i++) link(1 + (i % 3), 4 + i);
  for (let i = 0; i < 9; i++) link(4 + (i % 6), 10 + i);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: colSoft, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  coronaGrp.add(lines);

  // ---- 核心：辉光精灵 + 水晶多面体 ----
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: col }));
  coreGlow.scale.set(0.1, 0.1, 1); coronaGrp.add(coreGlow);
  const coreMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42, 1),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0, metalness: 0.3, roughness: 0.25, transparent: true, opacity: 0 }),
  );
  coronaGrp.add(coreMesh);

  // ---- v6.12：宇宙奇点（大爆炸开场）—— 一点白炽在中心坍缩成形，时空褶皱环向外扩散 ----
  const singColor = new THREE.Color().setHSL(accent.h, Math.min(1, accent.s + 0.04), 0.96);
  const singularity = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: singColor,
  }));
  singularity.scale.setScalar(0.001); coronaGrp.add(singularity);
  // 时空褶皱环（奇点爆发的冲击波）：一个面向相机的环，向外扩张并淡出
  const warpMat = new THREE.MeshBasicMaterial({ color: colSoft, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const warpRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.92, 64), warpMat);
  warpRing.position.z = 0; coronaGrp.add(warpRing);

  // ---- 光照（即便无环境贴图也能勾出体积） ----
  scene.add(new THREE.AmbientLight(0xBBD4FF, 0.5));
  const key = new THREE.DirectionalLight(0xFFFFFF, 0.9); key.position.set(2, 3, 5); scene.add(key);
  const rim = new THREE.PointLight(col.getHex(), 1.2, 40); rim.position.set(-3, 1, 3); scene.add(rim);

  // ---- 尺寸自适应 ----
  function resize() {
    const w = bootEl.clientWidth || window.innerWidth, h = bootEl.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // ---- 时间线（v6.37.0 三段式：点 → 星系运动 → 转变为界面）----
  const TOTAL = reduced ? 0.9 : 5.2;
  const clock = new THREE.Clock();
  let raf = 0, running = true;
  // 星尘原始球壳坐标，供"螺旋轨道旋转"用（避免只做整体 rotation.y 的生硬转动）
  const starBase = new Float32Array(sp);

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const t = Math.min(clock.getElapsedTime(), TOTAL);
    const p = t / TOTAL;

    // ── 阶段①：一个点（0 → 0.16）────────────────────────────────────
    // 中心一颗极小白炽奇点：从几乎不可见，安静呼吸般膨胀到饱满。
    const aS = easeInOutCubic(clamp01(p / 0.16));
    const breathe = 1 + Math.sin(t * 3.2) * 0.12;             // 呼吸脉动
    singularity.material.opacity = Math.min(1, aS * 1.6);
    singularity.scale.setScalar(lerp(0.02, 1.9, aS) * breathe);
    singularity.material.rotation += 0.02;
    // 镜头极缓慢外移，暗示"这个点在变大/我们在靠近"
    camera.position.z = reduced ? 9 : lerp(11.6, 11.2, aS);

    // ── 阶段②：星系运动（0.16 → 0.72）───────────────────────────────
    // 奇点在 0.16~0.26 爆发：冲击波环扩散、星尘沿螺旋轨道旋转汇入、星云晕开。
    const burst = easeInOutCubic(clamp01((p - 0.16) / 0.10));
    singularity.material.opacity = (1 - burst) * 1;
    singularity.scale.setScalar(lerp(1.9, 6.5, burst));
    const warp = easeOutCubic(clamp01((p - 0.16) / 0.20));
    warpRing.material.opacity = (1 - burst) * 0.92 * Math.sin(clamp01((p - 0.16) / 0.20) * Math.PI);
    warpRing.scale.setScalar(lerp(1.0, 18, warp));
    warpRing.lookAt(camera.position);

    // 星尘涌出 + 星云晕开
    const aA = easeOutCubic(clamp01((p - 0.18) / 0.34));
    stars.material.opacity = aA * 0.92;
    neb1.material.opacity = aA * 0.52; neb2.material.opacity = aA * 0.34;
    neb1.material.rotation += 0.0010; neb2.material.rotation -= 0.0013;
    // 螺旋轨道运动：每颗粒子按半径差速绕 Z 轴旋转，形成星系旋臂"流动"感
    // （仅在星系阶段激活，收束阶段渐隐）
    const spinBase = Math.max(0, t - 5.2 * 0.16);
    const spin = soft ? 0.35 : 0.6;
    const attr = starGeo.attributes.position.array;
    for (let i = 0; i < STARS; i++) {
      const o = i * 3;
      const x0 = starBase[o], y0 = starBase[o + 1];
      const rad = Math.sqrt(x0 * x0 + y0 * y0) || 1;
      const ang = spinBase * spin / (1 + rad * 0.14);   // 内圈快、外圈慢 → 旋臂
      const ca = Math.cos(ang), sa = Math.sin(ang);
      attr[o] = x0 * ca - y0 * sa;
      attr[o + 1] = x0 * sa + y0 * ca;
    }
    starGeo.attributes.position.needsUpdate = true;

    // 突触花冠逐层点亮 + 星系整体自转
    const aB = easeInOutCubic(clamp01((p - 0.34) / 0.34));
    lineMat.opacity = aB * 0.82;
    nodePts.material.opacity = aB;
    coronaGrp.scale.setScalar(lerp(0.78, 1, aB));
    coronaGrp.rotation.z = t * 0.16;                      // 星系缓慢自转（持续运动感）
    camera.position.z = reduced ? 9 : lerp(11.2, 8.6, aB);

    // 核心点燃
    const aC = easeOutCubic(clamp01((p - 0.52) / 0.20));
    coreGlow.material.opacity = aC;
    coreGlow.scale.setScalar(lerp(0.1, 6.4, aC));
    coreMesh.material.opacity = aC;
    coreMesh.material.emissiveIntensity = aC * 2.4;
    coreMesh.rotation.x = t * 0.4; coreMesh.rotation.y = t * 0.6;
    coreGlow.material.rotation += 0.01;

    // ── 阶段③：转变为程序界面（0.72 → 1）───────────────────────────
    // 镜头推进、整片星系向边缘扩散并淡出，字标隐退——自然"散开"露出真实主界面。
    const dissolve = easeInOutCubic(clamp01((p - 0.72) / 0.28));
    const fade = 1 - dissolve;
    stars.material.opacity *= fade;
    neb1.material.opacity *= fade; neb2.material.opacity *= fade;
    lineMat.opacity *= fade; nodePts.material.opacity *= fade;
    coreGlow.material.opacity *= fade; coreMesh.material.opacity *= fade;
    stars.scale.setScalar(lerp(1, 2.4, dissolve));        // 星尘向边缘扩散
    coronaGrp.scale.setScalar(lerp(1, 2.2, dissolve));
    camera.position.z = reduced ? 9 : lerp(8.6, 6.4, dissolve);
    // 字标层随动画一起淡出：加 dissolving 类触发 CSS 过渡（v6.37.0）
    if (bootEl && dissolve > 0 && !bootEl.classList.contains('dissolving')) {
      bootEl.classList.add('dissolving');
    }

    if (t >= TOTAL) { running = false; cancelAnimationFrame(raf); done(); return; }
    renderer.render(scene, camera);
  }
  frame();

  // 安全兜底：极端情况下若 done() 未触发，9s 后强制移除
  setTimeout(() => { if (!settled) { running = false; cancelAnimationFrame(raf); done(); } }, 9000);

  return done();
}
