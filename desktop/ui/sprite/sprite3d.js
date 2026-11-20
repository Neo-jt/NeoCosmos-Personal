// ═══════════════════════════════════════════════════════════════════════════
// Cosmos 精灵 · 星灵 Astra（v6.10 · 游戏引擎级 3D 实体）
// ───────────────────────────────────────────────────────────────────────────
// 设计立意：把旧版「深空合金机器人」彻底重构为一尊悬浮于桌面的「星灵」——
//   一缕由水晶壳包裹的量子之心，外围缠绕能量触须与轨道光环，身披旋臂星尘，
//   五段量子通道弧随认知模态概率明灭。强调色取自 AURORA 主题（localStorage 同步），
//   环境反射用 PMREM 由程序化渐变生成，并可在资源可用时升级为高清环境贴图，
//   呈现出金属 / 玻璃 / 虹彩薄膜的真实质感（clearcoat + iridescence + 环境光）。
//
// 工程约束：仅用 three 核心（无 addon，严格 CSP / 离线）；强调色随主题一致；
//   软渲染（SwiftShader）自动降采样；暴露与旧版完全一致的 createSpriteScene API。
// ═══════════════════════════════════════════════════════════════════════════
// 精灵窗口没有 importmap（与 index.html 不同），必须用相对路径解析 vendored three
import * as THREE from '../vendor/three/build/three.module.js';

// 与量子引擎 CHANNELS 同序：金 / 粉 / 蓝 / 绿 / 紫
const CH_COLOR = [0xFFD66B, 0xFF9ED2, 0x6BD0FF, 0x8FF0B0, 0xC79BFF];

// AURORA 强调色预设（与 design-system.css 同源）
const ACCENT_HSL = {
  cobalt:   { h: 218 / 360, s: 0.78, l: 0.54 },
  graphite: { h: 218 / 360, s: 0.30, l: 0.46 },
  teal:     { h: 173 / 360, s: 0.74, l: 0.42 },
  amber:    { h: 36 / 360,  s: 0.84, l: 0.52 },
  violet:   { h: 265 / 360, s: 0.72, l: 0.62 },
};
function readAccentHSL() {
  try {
    const raw = JSON.parse(localStorage.getItem('neocosmos-appearance') || '{}');
    if (raw && ACCENT_HSL[raw.accent]) return ACCENT_HSL[raw.accent];
  } catch { /* 忽略 */ }
  return ACCENT_HSL.cobalt;
}

// ---- 程序化贴图 ----
function glowTexture(size = 256, inner = 'rgba(255,255,255,1)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, 'rgba(210,230,255,0.55)');
  g.addColorStop(0.6, 'rgba(150,190,255,0.14)');
  g.addColorStop(1, 'rgba(120,160,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 程序化等距环境（供 PMREM 生成反射）—— 深空底 + 顶部冷光 + 强调色辉光
function gradientEnvEquirect(accent, w = 512, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a1430');
  g.addColorStop(0.42, '#16284f');
  g.addColorStop(0.5, `hsl(${accent.h * 360},70%,${Math.min(72, accent.l * 130)}%)`);
  g.addColorStop(0.58, '#16284f');
  g.addColorStop(1, '#05080f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 一点暖色星点，丰富高光
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 1.4 + 0.3;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.5})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSpriteScene(container, opts = {}) {
  const LIVE = (globalThis.__SPRITE_SCENE_LIVE || (globalThis.__SPRITE_SCENE_LIVE = { n: 0 }));
  LIVE.n++;
  const W = container.clientWidth || 320, H = container.clientHeight || 440;
  const accent = readAccentHSL();
  const col = new THREE.Color().setHSL(accent.h, accent.s, accent.l);
  const colBright = new THREE.Color().setHSL(accent.h, Math.min(1, accent.s + 0.06), Math.min(1, accent.l + 0.18));
  const violet = new THREE.Color(0xC79BFF);
  const gold = new THREE.Color(0xFFD66B);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
  // v6.11：相机后撤到 10.6 —— 七阶道纹冠最大半径 2.55，实算半宽 2.65 / 半高 3.65，
  // 保证七阶全部展开时符环不被窗口左右边缘裁掉（fov 38°, 320×440）。
  camera.position.set(0, 0.05, 10.6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  let soft = false;
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const nm = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    soft = /swiftshader|llvmpipe|software|basic render/i.test(nm);
  } catch { /* 按硬件渲染 */ }
  renderer.setPixelRatio(soft ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setSize(W, H, false);
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });

  // ---- 环境反射（PMREM）：先用程序化渐变，资源就绪后升级高清贴图 ----
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envRT = null;
  function applyEnv(tex) {
    try {
      const rt = pmrem.fromEquirectangular(tex);
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
    } catch (e) { /* 环境生成失败不影响主场景 */ }
  }
  applyEnv(gradientEnvEquirect(accent));
  // 可选升级：高清环境贴图（neolink://app/assets/env-assets/...）
  try {
    new THREE.TextureLoader().load(
      'neolink://app/assets/env-assets/env_cosmos_a_4096x2048.png',
      (tex) => { tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; applyEnv(tex); },
      undefined,
      () => { /* 资源缺失：保持程序化环境 */ },
    );
  } catch { /* 忽略 */ }

  // ---- 布光 ----
  scene.add(new THREE.AmbientLight(0xBBD4FF, 0.55));
  const key = new THREE.DirectionalLight(0xFFFFFF, 1.0); key.position.set(2.4, 3.2, 4.5); scene.add(key);
  const rimA = new THREE.PointLight(col.getHex(), 1.4, 30); rimA.position.set(-3.2, 1.2, 2.6); scene.add(rimA);
  const rimB = new THREE.PointLight(violet.getHex(), 1.1, 30); rimB.position.set(3.0, -0.8, 1.8); scene.add(rimB);

  const dotTex = glowTexture();
  const mkGlow = (hex, k = 1.8) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: k, metalness: 0.2, roughness: 0.4 });
  const mkAdd = (hex, opacity) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

  const root = new THREE.Group(); scene.add(root);
  const clickable = [];
  const markClickable = (m) => { clickable.push(m); return m; };

  // ───────── 量子之心（内核 + 水晶壳 + 光晕） ─────────
  const heart = markClickable(new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 1),
    mkGlow(col.getHex(), 2.6),
  ));
  root.add(heart);
  const heartHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: colBright, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  heartHalo.scale.set(1.6, 1.6, 1); root.add(heartHalo);

  // 水晶壳：clearcoat + iridescence + 玻璃感（不开启 transmission，避免透明窗体下的离屏开销）
  const shell = markClickable(new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 2),
    new THREE.MeshPhysicalMaterial({
      color: col, metalness: 0.0, roughness: 0.10,
      transmission: 0.0, transparent: true, opacity: 0.42,
      clearcoat: 1.0, clearcoatRoughness: 0.08,
      iridescence: 1.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 480],
      emissive: col, emissiveIntensity: 0.18, envMapIntensity: 1.6,
      side: THREE.DoubleSide,
    }),
  ));
  root.add(shell);
  // 全息晶格（叠加线框，强化科技/神性质感）
  const lattice = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.96, 1)),
    new THREE.LineBasicMaterial({ color: colBright, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  root.add(lattice);

  // ───────── 能量触须（三条螺旋管 + 沿线游走的辉光） ─────────
  const tendrils = [];
  for (let k = 0; k < 3; k++) {
    const pts = [];
    const base = (k / 3) * Math.PI * 2;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const a = base + t * Math.PI * 1.6;
      const r = 0.55 + t * 1.15;
      pts.push(new THREE.Vector3(Math.cos(a) * r, (t - 0.5) * 1.7, Math.sin(a) * r * 0.7));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = markClickable(new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, 0.028, 8, false),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.3 }),
    ));
    const g = new THREE.Group(); g.add(tube); root.add(g);
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: colBright, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.scale.set(0.4, 0.4, 1); root.add(spark);
    tendrils.push({ g, tube, curve, spark, base, offset: Math.random() });
  }

  // ───────── 轨道光环（三重倾斜） ─────────
  const orbits = [];
  const orbitSpec = [
    { r: 1.55, tube: 0.018, color: col, rx: 1.15, rz: 0.18 },
    { r: 1.86, tube: 0.014, color: violet, rx: 0.55, rz: 1.05 },
    { r: 2.16, tube: 0.012, color: gold, rx: 1.5, rz: 0.6 },
  ];
  for (const o of orbitSpec) {
    const g = new THREE.Group(); g.rotation.set(o.rx, 0, o.rz); root.add(g);
    const ring = markClickable(new THREE.Mesh(
      new THREE.TorusGeometry(o.r, o.tube, 10, 120),
      mkAdd(o.color, 0.5),
    ));
    g.add(ring);
    orbits.push({ g, ring, rx: o.rx, rz: o.rz });
  }

  // ───────── 旋臂星尘（星灵之「披风」） ─────────
  const DUST = soft ? 700 : 1600;
  const dustGeo = new THREE.BufferGeometry();
  const dpos = new Float32Array(DUST * 3), dcol = new Float32Array(DUST * 3);
  const tmpC = new THREE.Color();
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < DUST; i++) {
    const t = i / DUST;
    const ang = i * GA + t * 6.0;
    const rad = 0.9 + t * 2.6;
    const y = (Math.random() - 0.5) * (0.18 + t * 0.5);
    dpos[i * 3] = Math.cos(ang) * rad;
    dpos[i * 3 + 1] = y;
    dpos[i * 3 + 2] = Math.sin(ang) * rad * 0.85;
    const pick = Math.random();
    if (pick < 0.45) tmpC.copy(colBright);
    else if (pick < 0.7) tmpC.copy(violet);
    else if (pick < 0.85) tmpC.copy(gold);
    else tmpC.setHSL(0.6, 0.05, 0.8);
    dcol[i * 3] = tmpC.r; dcol[i * 3 + 1] = tmpC.g; dcol[i * 3 + 2] = tmpC.b;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dcol, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 0.06, map: dotTex, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(dust);

  // 远景微星（景深）
  const FAR = 240;
  const farGeo = new THREE.BufferGeometry();
  const fpos = new Float32Array(FAR * 3);
  for (let i = 0; i < FAR; i++) {
    const u = Math.random(), v = Math.random();
    const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), R = 16 + Math.random() * 16;
    fpos[i * 3] = Math.sin(ph) * Math.cos(th) * R;
    fpos[i * 3 + 1] = Math.sin(ph) * Math.sin(th) * R * 0.7;
    fpos[i * 3 + 2] = Math.cos(ph) * R;
  }
  farGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  const far = new THREE.Points(farGeo, new THREE.PointsMaterial({ size: 0.12, color: 0x9fc2ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(far);

  // ───────── 五段量子通道弧（真实概率驱动） ─────────
  const ARC_SPAN = (Math.PI * 2 / 5) * 0.8;
  const channelArcs = [];
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2;
    const arc = markClickable(new THREE.Mesh(
      new THREE.TorusGeometry(2.34, 0.05, 10, 48, ARC_SPAN),
      mkAdd(CH_COLOR[i], 0.35),
    ));
    arc.position.set(0, -0.1, -0.4);
    arc.rotation.z = a0 + (Math.PI * 2 / 5 - ARC_SPAN) / 2;
    root.add(arc);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: CH_COLOR[i], transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    dot.scale.set(0.4, 0.4, 1); root.add(dot);
    channelArcs.push({ arc, m: arc.material, dot, a0, span: ARC_SPAN });
  }

  // ───────── v6.11：七阶道纹冠（炁阶 L1→L7 真实逐级解锁） ─────────
  // 每阶是一圈独立几何：金线符环 + 等距刻度 + 一枚沿环流转的光子。
  // 显示数量由 Astra 内核的成熟度决定；低阶不会"假装"点亮高阶。
  const sigils = [];
  for (let lv = 1; lv <= 7; lv++) {
    const g = new THREE.Group();
    const r = 2.10 + (lv - 1) * 0.075;   // 2.10 → 2.55，始终落在实算视锥内
    g.rotation.set(1.18 + lv * 0.035, 0, (lv % 2 ? 1 : -1) * 0.10 * lv);
    const line = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.006 + lv * 0.0007, 6, 160),
      mkAdd(lv >= 5 ? 0xFFE9B0 : gold.getHex(), 0.30),
    );
    g.add(line);
    const COUNT = 6 + lv;
    const tickGeo = new THREE.BufferGeometry();
    const tp = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2;
      tp[i * 3] = Math.cos(a) * r; tp[i * 3 + 1] = Math.sin(a) * r; tp[i * 3 + 2] = 0;
    }
    tickGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    const ticks = new THREE.Points(tickGeo, new THREE.PointsMaterial({
      size: 0.055 + lv * 0.006, map: dotTex, color: lv >= 5 ? 0xFFF0C0 : 0xFFD66B,
      transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    g.add(ticks);
    const photon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTex, color: colBright, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    photon.scale.set(0.2, 0.2, 1); g.add(photon);
    g.visible = lv === 1;
    root.add(g);
    sigils.push({ g, line, photon, r, lv });
  }

  // 接触光斑：移动时增亮、放大，给"走在桌面上"一个落点
  const contact = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dotTex, color: col, transparent: true, opacity: 0.20,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  contact.scale.set(2.6, 0.62, 1);
  contact.position.set(0, -2.05, -0.8);
  scene.add(contact);

  // ---- 交互：点按唤起对话；拖动（>7px）不触发，供桌面自由拖拽 ----
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let clickCb = null;
  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects(clickable, false).length > 0;
  }
  renderer.domElement.style.cursor = 'pointer';
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    down = { x: ev.clientX, y: ev.clientY, hit: pick(ev) };
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    const d = down; down = null;
    if (!d || !d.hit || !clickCb) return;
    // 拖动超过阈值视为"抓着精灵换位置"，不打开对话面板
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 7) return;
    clickCb();
  });
  renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  renderer.domElement.addEventListener('pointerleave', () => { down = null; });

  // ---- 量子态驱动 ----
  let channels = [0.2, 0.2, 0.2, 0.2, 0.2];
  let entropyN = 0.5, peakIdx = 0;
  function setQuantum(trace) {
    if (!trace) return;
    if (Array.isArray(trace.channels)) channels = trace.channels.map((c) => c.prob != null ? c.prob : 0.2);
    entropyN = trace.entropy?.normalized != null ? trace.entropy.normalized : 0.5;
    peakIdx = Number.isInteger(trace.peakIndex) ? Math.min(4, Math.max(0, trace.peakIndex % 5)) : 0;
  }

  // ---- 渲染循环 ----
  const clock = new THREE.Clock();
  let raf = 0, running = true;
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  let pulseBoost = 0;
  // v6.11 行为层：由主进程漫游引擎 / 意识内核实时喂入
  const beh = { facing: 1, speed: 0, behavior: 'perch', mood: 'serene', level: 1, tilt: 0, bob: 0, trail: 0, turn: 0 };
  function setBehavior(s = {}) {
    if (Number.isFinite(s.facing)) beh.facing = s.facing < 0 ? -1 : 1;
    if (Number.isFinite(s.speed)) beh.speed = Math.max(0, Math.min(400, s.speed));
    if (typeof s.behavior === 'string') beh.behavior = s.behavior;
  }
  function setMood(m) {
    const k = (m && typeof m === 'object') ? m.key : m;
    if (typeof k === 'string' && k) beh.mood = k;
  }
  function setLevel(n) { beh.level = Math.max(1, Math.min(7, Math.round(Number(n) || 1))); }
  function resize() {
    const w = container.clientWidth || W, h = container.clientHeight || H;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
  }
  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();

    root.position.y = Math.sin(t * 0.9) * 0.08;
    // 自转保留，行为朝向只作为叠加偏移（否则会把缓慢自转拉没）
    root.rotation.y = Math.sin(t * 0.28) * 0.12 + t * 0.04 + beh.turn;

    // 量子之心：自旋 + 呼吸 + 熵驱动明灭 + 情绪增益
    heart.rotation.set(t * 0.5, t * 0.9, 0);
    const hb = 1 + 0.05 * Math.sin(t * 2.0) + pulseBoost * 0.22;
    heart.scale.setScalar(hb);
    const moodGain = beh.mood === 'dormant' ? 0.78 : (beh.mood === 'delighted' || beh.mood === 'inquiring' ? 1.12 : 1);
    heart.material.emissiveIntensity = (2.2 + pulseBoost * 2.4 + entropyN * 0.6) * moodGain;
    heartHalo.material.opacity = 0.34 + 0.14 * Math.sin(t * 1.7) + pulseBoost * 0.4;
    heartHalo.scale.setScalar(1.4 + 0.2 * Math.sin(t * 1.7) + pulseBoost * 0.6);

    // 水晶壳：反向缓慢自转 + 虹彩微闪
    shell.rotation.set(-t * 0.12, t * 0.18, 0);
    lattice.rotation.copy(shell.rotation);
    shell.material.emissiveIntensity = 0.16 + 0.06 * Math.sin(t * 0.9) + entropyN * 0.1;

    // 能量触须：飘摆 + 沿线游走的辉光
    tendrils.forEach((td, i) => {
      td.g.rotation.y = t * (0.18 + i * 0.05) + Math.sin(t * 1.1 + i) * 0.1;
      td.g.rotation.z = Math.sin(t * 0.9 + i) * 0.06;
      const u = ((t * 0.18 + td.offset) % 1 + 1) % 1;
      const p = td.curve.getPointAt(u);
      td.spark.position.copy(p);
      td.spark.material.opacity = 0.5 + 0.5 * Math.sin(t * 3 + i);
      td.tube.material.emissiveIntensity = 1.3 + 0.5 * Math.sin(t * 1.6 + i) + pulseBoost * 1.2;
    });

    // 轨道环
    orbits.forEach((o, i) => {
      o.g.rotation.y = t * (0.16 + i * 0.07);
      o.g.rotation.x = o.rx + Math.sin(t * 0.22 + i) * 0.08;
      o.ring.material.opacity = 0.34 + 0.12 * Math.sin(t * 1.5 + i) + pulseBoost * 0.2;
    });

    // 星尘旋臂 + 远景微星
    dust.rotation.y = t * 0.05;
    dust.material.opacity = 0.6 + 0.3 * entropyN;
    far.rotation.y = -t * 0.012;

    // 量子通道弧：亮度 = Born 概率；高熵整体更亮更弥散
    channelArcs.forEach((arc, i) => {
      const p = channels[i] != null ? channels[i] : 0.2;
      arc.m.opacity = 0.12 + p * 1.1 + pulseBoost * 0.3 + (i === peakIdx ? 0.12 : 0);
      const u = ((t * (0.08 + i * 0.012)) % 1 + 1) % 1;
      const a = arc.a0 + (Math.PI * 2 / 5 - ARC_SPAN) / 2 + u * ARC_SPAN;
      arc.dot.position.set(Math.cos(a) * 2.34, -0.1 + Math.sin(a) * 2.34, -0.4);
      const s = 0.22 + p * 0.9 + pulseBoost * 0.2;
      arc.dot.scale.set(s, s, 1);
      arc.dot.material.opacity = 0.3 + p * 0.65;
    });

    // ── v6.11 行为层：转身 / 步态 / 星尘拖尾 / 接触光斑 / 七阶符环 ──
    const moving = beh.behavior !== 'perch' && beh.speed > 6;
    const targetTilt = moving ? -beh.facing * Math.min(0.17, beh.speed / 1500) : 0;
    beh.tilt += (targetTilt - beh.tilt) * 0.08;
    root.rotation.z = beh.tilt;
    beh.turn += ((beh.facing < 0 ? -0.12 : 0.12) - beh.turn) * 0.06;
    const step = moving
      ? Math.sin(t * 7.5) * Math.min(0.10, beh.speed / 2600)
      : Math.sin(t * 1.4) * 0.035;
    beh.bob += (step - beh.bob) * 0.12;
    root.position.y += beh.bob;
    beh.trail += ((moving ? Math.min(1, beh.speed / 180) : 0) - beh.trail) * 0.06;
    dust.position.x = -beh.facing * beh.trail * 0.55;
    dust.material.opacity = 0.6 + 0.3 * entropyN + beh.trail * 0.25;
    contact.material.opacity = 0.14 + beh.trail * 0.22 + 0.05 * Math.sin(t * 1.7);
    contact.scale.set(2.4 + beh.trail * 0.8, 0.55 + beh.trail * 0.14, 1);
    // 道纹冠：只点亮 ≤ 当前炁阶的环，阶数越高转得越沉静
    sigils.forEach((sg) => {
      const on = sg.lv <= beh.level;
      sg.g.visible = on;
      if (!on) return;
      const dir = sg.lv % 2 ? 1 : -1;
      sg.g.rotation.z += 0.00055 * dir * (1 + sg.lv * 0.12) * (1 + beh.trail * 0.8);
      sg.line.material.opacity = 0.18 + 0.14 * Math.sin(t * 0.7 + sg.lv) + pulseBoost * 0.35 + beh.trail * 0.2;
      const a = t * (0.32 + sg.lv * 0.05) * dir;
      sg.photon.position.set(Math.cos(a) * sg.r, Math.sin(a) * sg.r, 0);
      sg.photon.material.opacity = 0.45 + 0.35 * Math.sin(t * 2 + sg.lv);
    });

    pulseBoost *= 0.94;
    renderer.render(scene, camera);
  }
  resize(); tick();

  return {
    setQuantum,
    // v6.11：行为 / 情绪 / 炁阶（新增能力，旧调用方不传也完全兼容）
    setBehavior, setMood, setLevel,
    onSpriteClick(cb) { clickCb = cb; },
    pulse(intensity = 1) { pulseBoost = Math.min(0.6, pulseBoost + 0.3 * intensity); },
    resize,
    setRunning(v) { if (v && !running) { running = true; tick(); } else if (!v && running) { running = false; cancelAnimationFrame(raf); } },
    dispose() {
      running = false; cancelAnimationFrame(raf);
      try { ro.disconnect(); } catch (e) { /* ignore */ }
      if (scene.environment) scene.environment.dispose?.();
      if (envRT) envRT.dispose();
      try { pmrem.dispose(); } catch (e) { /* ignore */ }
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); });
        }
      });
      try { renderer.dispose(); renderer.forceContextLoss?.(); } catch (e) { /* ignore */ }
      renderer.domElement.remove();
      LIVE.n--;
    },
  };
}
