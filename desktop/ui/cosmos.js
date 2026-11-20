// NeoLink · 星云渲染引擎 (cosmos) —— v2.0.0 Aurora
// ---------------------------------------------------------------------------
// 电影级深空 3D 突触网络。全部资源程序化生成（无任何外部贴图/字体/CDN），离线可用。
//
// v2.0.0 Aurora 增补（本次重设计的核心）：
//  1) 知识库名称渲染在星图画布上
//     —— 解决"这张网属于谁"的问题：原版库名只在标题栏/状态栏。
//     v2.2.0 调整：铭牌由**居中**改为**右下角**（中央是信息最密集处，
//     大字库名既压标签又压暗节点；移走后中央完全让给数据本身）。
//  2) 结构可读：四种布局模式把同一份数据组织成四种结构
//     constellation 星座（引擎真实力导向 + 领域质心标注）
//     gravity     引力（按度数定半径，枢纽近中心）
//     cortex      皮层（三层记忆分同心壳）
//     multikb     多库星系（本地主星系 + 跨库卫星星系，各自标注库名）
//  3) 领域聚焦：点击某一领域，其余淡出，簇结构一眼可辨。
//
// createCosmos({ container, graph, vault, layoutMode, onSelect, onHover, onReady }) -> cosmos
//   cosmos.focus(nodeId)                 相机平滑聚焦
//   cosmos.setActivation(Map<id, score>) 激活强度可视化（0..1，用于扩散过程呈现）
//   cosmos.setPathEdges(Set<edgeKey>)    高亮某条联想路径
//   cosmos.setTypeFilter(Set<type>)      按突触类型过滤
//   cosmos.setLayoutMode(mode)           切换结构布局（自动重算坐标）
//   cosmos.setDomainFocus(domain|null)   聚焦某一领域（null 取消）
//   cosmos.setAutoRotate(bool)
//   cosmos.setLabels(bool)
//   cosmos.snapshot()                    导出 PNG dataURL
//   cosmos.dispose()
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ---------------- 配色 ----------------
const TYPE_COLORS = {
  explicit_link: 0x8B7BFF,
  hierarchical: 0x5FA8FF,
  co_occurrence: 0x3FE0C8,
  semantic_similar: 0xC77DFF,
  causal: 0xFF6B8A,
  temporal: 0xD4A843,
  question_answer: 0x46E0FF,
  cross_kb: 0x64C8FF,
};
const DOMAIN_COLORS = [
  0x7B5CFF, 0x46E0FF, 0xC77DFF, 0x5FA8FF, 0xFF6B8A,
  0xD4A843, 0x3FE0C8, 0xFF9E5F, 0x8A9BFF, 0x62F0A8,
];

// 布局模式 → 中文名（渲染层显示策略，不污染引擎）
/**
 * id 三维坐标体系（原创算法，v6.35.0）—— 把任意节点 id 确定性映射为三维坐标。
 *
 * 设计目标：坐标只由 id 本身决定，与力导向迭代、节点插入顺序、库规模无关；
 * 同一张卡片在任意时刻、任意设备上打开都落在同一点。这是"知识有固定星位"
 * 的原创表达，不依赖也不需要任何第三方布局算法。
 *
 * 算法（纯函数，零随机）：
 *   1) 对 id 做三次不同种子的 FNV-1a 32 位哈希，得到三个近似独立的 32 位整数；
 *   2) 方位角 θ = 2π·(h1/2^32)，极角 φ = acos(2·h2/2^32 − 1)（球面均匀采样）；
 *   3) 半径 r = R·cbrt(h3/2^32)（立方根让点在球体积内均匀分布，而非聚在球心）；
 *   4) 由 (r, θ, φ) 转笛卡尔 xyz。
 * 结果可与领域颜色、度数大小叠加显示，但位置本身恒定。
 */
export function idCoordinate(id, radius = 1) {
  const s = String(id == null ? '' : id);
  const fnv = (seed, str) => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
  const U = 4294967296; // 2^32
  const u1 = fnv(0x811c9dc5, s) / U;
  const u2 = fnv(0x9e3779b9, s) / U;
  const u3 = fnv(0x85ebca6b, s) / U;
  const theta = u1 * Math.PI * 2;
  const phi = Math.acos(2 * u2 - 1);
  const r = radius * Math.cbrt(u3);
  return [
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  ];
}

export const LAYOUT_MODES = [
  { key: 'constellation', label: '星座' },
  { key: 'idspace', label: '星位（id 坐标）' },
  { key: 'gravity', label: '引力' },
  { key: 'cortex', label: '皮层' },
  { key: 'spacefold', label: '空间折叠' },
  { key: 'multikb', label: '多库星系' },
];

/**
 * 领域配色（与星图渲染层保持一致的唯一来源）。
 * HUD 图例与画布共用它，避免"图例颜色和星图对不上"。
 */
export function domainColorOf(domains) {
  const map = new Map();
  [...new Set(domains)].sort().forEach((d, i) => map.set(d, DOMAIN_COLORS[i % DOMAIN_COLORS.length]));
  return map;
}

export function createCosmos(opts) {
  // 诊断用：存活场景计数。星图视图若在 await 期间被卸载后仍创建场景，
  // 该计数只增不减 —— 渲染进程会被泄漏的渲染循环占满（界面卡住）。
  // 审计脚本据此发现泄漏（见 tools/ui-audit.js checkSceneLeak）。
  const LIVE = (globalThis.__NEOLINK_SCENE_LIVE || (globalThis.__NEOLINK_SCENE_LIVE = { n: 0 }));
  LIVE.n++;
  const { container, graph } = opts;
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  let vault = opts.vault || null;            // { id, name, color } —— let：库就绪/切换后由 setVault 刷新铭牌，避免创建瞬间的快照冻结成"永远空态"
  let vaultColor = vault?.color || '#8B7BFF';
  const domains = [...new Set(nodes.map((n) => n.domain))].sort();
  const domainColor = domainColorOf(domains);

  // 密度自适应：卡片越多、突触越密，单点越小、边越淡、泛光越弱，否则中心会过曝成一团白
  const N = nodes.length || 1;
  const E = edges.length || 1;
  const densityScale = N > 400 ? 0.62 : N > 180 ? 0.8 : N > 90 ? 0.92 : 1.0;
  // 边是加法混合，密度高时叠加即饱和：按边数把基础透明度压下来
  const edgeAlphaScale = E > 900 ? 0.3 : E > 400 ? 0.46 : E > 150 ? 0.68 : 1.0;
  const bloomScale = N > 400 ? 0.3 : N > 180 ? 0.42 : N > 90 ? 0.62 : 1.0;

  const disposables = [];
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070f, 0.0016);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 8000);
  camera.position.set(120, 90, 240);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  // v2.1.0：软件渲染降级。没有独显的机器（虚拟机 / 远程桌面 / 老机器）上
  // WebGL 走 SwiftShader / llvmpipe 软件光栅化，像素比 2 + bloom 后处理
  // 会把每帧拖到秒级 —— 实测在软件渲染下星图整页交互要 150 秒以上。
  // 这里探测渲染器：识别为软件渲染就把像素比压到 1 并关掉泛光后期。
  let softRender = false;
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    softRender = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(name);
  } catch { /* 拿不到就按硬件渲染处理 */ }
  renderer.setPixelRatio(softRender ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });

  // CSS2D 标签层
  const labelRenderer = new CSS2DRenderer();
  // v2.2.1：给标签层一个明确的类名。CSS2DRenderer **每帧**都会重写每个标签的
  // style.transform（把节点投影到屏幕坐标），这是它的正常工作方式。
  // 但外部的 DOM 探针（如 UI 审计）若不加区分地监听 body 的属性变化，
  // 就会看到"每秒 60 次变化"的噪声 —— 既让"界面是否安定"的判断永远不成立，
  // 也让"点了有没有反应"的判定全部误判为有反应。标记出来才能被正确排除。
  labelRenderer.domElement.classList.add('cosmos-label-layer');
  Object.assign(labelRenderer.domElement.style, {
    // v6.39.0：标签层提到 z4 —— 仍低于浮动面板（z20+），但高于旧画布铭牌层（z3），
    // 密集星图里胶囊标签不会被底层装饰层压住。
    position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '4',
    // v2.2.2：**裁掉画布外的标签**。
    // CSS2DRenderer 不做视口裁剪 —— 它把 3D 投影点原样映射成屏幕坐标，
    // 相机背后的节点（投影 z>1）会被投影到画面边缘之外，
    // 标签于是跑到画布外、压在右栏面板上（用户截图里右边缘那一片
    // "KB-CP-2026-xxxx" 就是这么来的）。加 overflow:hidden 后，
    // 画布外的标签不再外溢。
    overflow: 'hidden',
  });
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  // v2.2.2：**相机是否正在移动** —— 决定标签避让要不要每帧重算。
  // 阻尼开启时 controls.update() 每帧都可能触发 change；相机真正停下来后
  // change 不再触发。这里用「变化后 220ms 无新变化」判定静止，
  // 把 camMoving 复位回 false，标签避让随即降回低频（每 4 帧一次），省 CPU。
  // v3.0.0 修复：旧实现只在 change 里置 true、从不复位，
  // 于是用户一旦动过相机，camMoving 就永远为 true —— 标签每帧重算、永不降频。
  let camMoving = false;
  let camIdleTimer = 0;
  controls.addEventListener('change', () => {
    camMoving = true;
    clearTimeout(camIdleTimer);
    camIdleTimer = setTimeout(() => { camMoving = false; }, 220);
  });
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.62;
  controls.zoomSpeed = 0.85;
  controls.minDistance = 14;
  controls.maxDistance = 1400;
  controls.autoRotateSpeed = 0.28;

  // ---------------- 程序化纹理 ----------------
  function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 256, stops = null) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    if (stops) for (const [o, col] of stops) g.addColorStop(o, col);
    else { g.addColorStop(0, inner); g.addColorStop(1, outer); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    disposables.push(t);
    return t;
  }

  const TEX_NEB = radialTexture(null, null, 512, [
    [0.0, 'rgba(255,255,255,0.85)'],
    [0.28, 'rgba(255,255,255,0.32)'],
    [0.62, 'rgba(255,255,255,0.08)'],
    [1.0, 'rgba(255,255,255,0)'],
  ]);
  const TEX_GLOW = radialTexture(null, null, 256, [
    [0.0, 'rgba(255,255,255,1)'],
    [0.22, 'rgba(255,255,255,0.55)'],
    [0.55, 'rgba(255,255,255,0.12)'],
    [1.0, 'rgba(255,255,255,0)'],
  ]);
  const TEX_STAR = radialTexture(null, null, 128, [
    [0.0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.45)'],
    [1.0, 'rgba(255,255,255,0)'],
  ]);

  // ---------------- 深空背景（不受雾影响） ----------------
  const bgMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform float uTime;
      float h31(vec3 p){
        p = fract(p*0.3183099 + vec3(0.71,0.113,0.419));
        p *= 17.0;
        return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
      }
      float vnoise(vec3 x){
        vec3 i = floor(x), f = fract(x);
        f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h31(i+vec3(0,0,0)), h31(i+vec3(1,0,0)), f.x),
                       mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x),
                       mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){
        float v = 0.0, a = 0.5;
        for(int i=0;i<5;i++){ v += a*vnoise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 d = normalize(vDir);
        float up = d.y*0.5+0.5;
        vec3 base = mix(vec3(0.016,0.020,0.047), vec3(0.043,0.031,0.086), up);
        base = mix(base, vec3(0.055,0.043,0.118), pow(smoothstep(0.15,1.0,up),1.6));

        float n1 = fbm(d*2.1 + vec3(0.0,0.0,uTime*0.006));
        float n2 = fbm(d*3.7 - vec3(uTime*0.004,0.0,0.0));
        vec3 nebA = vec3(0.360,0.192,0.694);   // violet
        vec3 nebB = vec3(0.203,0.408,0.760);   // azure
        float m1 = smoothstep(0.52,0.95,n1) * smoothstep(-0.6,0.5,d.y);
        float m2 = smoothstep(0.58,0.98,n2) * (0.55+0.45*sin(d.x*2.0));
        vec3 col = base + nebA*m1*0.62 + nebB*m2*0.42;

        // 远端微弱星尘
        float dust = pow(h31(floor(d*520.0)), 62.0);
        col += vec3(dust)*0.9;

        // 左上主光晕（对应参考图的硬光方向）
        float halo = pow(max(dot(d, normalize(vec3(-0.55,0.72,0.42))),0.0), 6.0);
        col += vec3(0.36,0.30,0.62)*halo*0.30;

        // 暗角
        col *= 1.0 - 0.28*pow(length(vec2(d.x,d.y)*0.72),2.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const bg = new THREE.Mesh(new THREE.SphereGeometry(3200, 48, 32), bgMat);
  bg.renderOrder = -100;
  bg.frustumCulled = false;
  scene.add(bg);

  // ---------------- 远景星场 ----------------
  // v2.2.0：远景星是**背景**，不是主角。此前 2600 颗、尺寸 6~28px、星云 7 片叠加，
  // 实测整屏偏紫发闷，中心节点的轮廓与标签都被吃掉了。
  // 本次：星点减到 1500 并整体推远、缩小；星云减到 5 片并降透明度。
  // 目标：背景只提供"这是深空"的氛围感，数据（节点/突触/标签）必须一眼可辨。
  let starUniform = null;
  {
    const N = 1500;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 2000 + Math.random() * 1700;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
      const warm = Math.random();
      c.setHSL(warm > 0.75 ? 0.09 : 0.62, 0.35, 0.72 + Math.random() * 0.24);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = 4 + Math.random() * 12;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: TEX_STAR }, uPR: { value: renderer.getPixelRatio() } },
      vertexShader: `
        attribute float aSize; varying vec3 vC; uniform float uTime; uniform float uPR;
        void main(){
          vC = color;
          vec4 mv = modelViewMatrix*vec4(position,1.0);
          float tw = 0.55+0.45*sin(uTime*1.1 + position.x*0.011 + position.z*0.017);
          gl_PointSize = aSize*tw*uPR*(300.0/-mv.z);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `
        varying vec3 vC; uniform sampler2D uMap;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC, t.a*0.85); }`,
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    const stars = new THREE.Points(g, m);
    stars.frustumCulled = false;
    stars.renderOrder = -90;
    scene.add(stars);
    disposables.push(g, m);
    starUniform = m.uniforms;
  }

  // ---------------- 体积星云（程序化精灵，不受雾影响） ----------------
  const nebulaGroup = new THREE.Group();
  const NEB_COLORS = [0x6B3FA8, 0x2E5FB8, 0xA34FB8, 0x1F3C86, 0x7B3F9A];
  for (let i = 0; i < 5; i++) {
    const col = new THREE.Color(NEB_COLORS[i % NEB_COLORS.length]);
    const mat = new THREE.SpriteMaterial({
      map: TEX_NEB, color: col, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.045 + Math.random() * 0.05, depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(mat);
    const r = 1600 + Math.random() * 1200;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    s.position.set(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.65, r * Math.sin(ph) * Math.sin(th));
    const sc = 900 + Math.random() * 900;
    s.scale.set(sc, sc, 1);
    s.renderOrder = -80;
    nebulaGroup.add(s);
    disposables.push(mat);
  }
  scene.add(nebulaGroup);

  // ================================================================
  //  v2.0.0：布局系统（同一份数据 → 四种可读结构）
  // ================================================================
  const localNodes = nodes.filter((n) => n.memory_layer !== 'cross');
  const ghostNodes = nodes.filter((n) => n.memory_layer === 'cross');

  // 本地星系的重心与半径（所有模式的公共基准）
  const localCenter = [0, 0, 0];
  if (localNodes.length) {
    for (const n of localNodes) { localCenter[0] += n.pos[0]; localCenter[1] += n.pos[1]; localCenter[2] += n.pos[2]; }
    localCenter[0] /= localNodes.length; localCenter[1] /= localNodes.length; localCenter[2] /= localNodes.length;
  }
  let localRadius = 1;
  for (const n of localNodes) {
    const r = Math.hypot(n.pos[0] - localCenter[0], n.pos[1] - localCenter[1], n.pos[2] - localCenter[2]);
    if (r > localRadius) localRadius = r;
  }

  /** 计算某布局模式下每个节点的世界坐标 */
  function computePositions(mode) {
    const map = new Map();
    const maxDeg = Math.max(1, ...localNodes.map((n) => n.degree || 0));

    if (mode === 'gravity') {
      // 按领域分扇区；半径由突触度数决定（枢纽近中心）
      const doms = [...new Set(localNodes.map((n) => n.domain))].sort();
      const sec = new Map(doms.map((d, i) => [d, (i / Math.max(1, doms.length)) * Math.PI * 2]));
      localNodes.forEach((n) => {
        const ang = (sec.get(n.domain) || 0) + ((n.degree || 0) % 5) * 0.13;
        const rad = localRadius * (0.22 + (1 - (n.degree || 0) / maxDeg) * 0.78);
        map.set(n.id, [Math.cos(ang) * rad, (n.pos[1] - localCenter[1]) * 0.25, Math.sin(ang) * rad]);
      });
    } else if (mode === 'cortex') {
      // 三层记忆分同心壳：语义(内) / 情景(中) / 工作(外)
      const shells = { semantic: 0.42, episodic: 0.74, working: 1.0 };
      const doms = [...new Set(localNodes.map((n) => n.domain))].sort();
      const sec = new Map(doms.map((d, i) => [d, (i / Math.max(1, doms.length)) * Math.PI * 2]));
      const byLayer = new Map();
      localNodes.forEach((n) => {
        const k = n.memory_layer || 'semantic';
        if (!byLayer.has(k)) byLayer.set(k, []);
        byLayer.get(k).push(n);
      });
      for (const [layer, list] of byLayer) {
        const rad = localRadius * (shells[layer] ?? 0.6);
        list.forEach((n, i) => {
          const ang = (sec.get(n.domain) || 0) + (i / Math.max(1, list.length)) * Math.PI * 2;
          const y = layer === 'working' ? localRadius * 0.28 : layer === 'episodic' ? -localRadius * 0.16 : 0;
          map.set(n.id, [Math.cos(ang) * rad, y, Math.sin(ang) * rad]);
        });
      }
    } else if (mode === 'multikb') {
      // 本地主星系居中；跨库幽灵节点按来源库聚成卫星星系，各自成簇
      for (const n of localNodes) {
        map.set(n.id, [n.pos[0] - localCenter[0], n.pos[1] - localCenter[1], n.pos[2] - localCenter[2]]);
      }
      const groups = new Map();
      for (const n of ghostNodes) {
        const key = n.cross?.vault_name || n.cross?.vault_id || '其他知识库';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      }
      const gk = [...groups.keys()];
      const orbit = Math.max(localRadius * 0.75, 60);
      gk.forEach((key, gi) => {
        const list = groups.get(key);
        const ang = (gi / Math.max(1, gk.length)) * Math.PI * 2 + 0.6;
        const cx = Math.cos(ang) * orbit;
        const cz = Math.sin(ang) * orbit;
        const cy = gi % 2 === 0 ? localRadius * 0.18 : -localRadius * 0.18;
        const spread = Math.max(14, localRadius * 0.16);
        list.forEach((n, i) => {
          const a2 = (i / Math.max(1, list.length)) * Math.PI * 2;
          map.set(n.id, [cx + Math.cos(a2) * spread, cy + ((i % 3) - 1) * spread * 0.5, cz + Math.sin(a2) * spread]);
        });
        map.set(`__galaxy__${key}`, [cx, cy, cz]);
      });
    } else if (mode === 'spacefold') {
      // 空间折叠：以星座坐标为底，沿质心做"软折叠"——远端按 1-e^{-d/R} 指数收缩，
      // 并叠加同心涟漪，让遥远的知识簇向中心收拢、亲密簇自然聚拢。这是真实的
      // 径向压缩变换（保角缩放），不是装饰。
      const R = localRadius * 1.5;
      localNodes.forEach((n) => {
        const x = n.pos[0] - localCenter[0];
        const y = n.pos[1] - localCenter[1];
        const z = n.pos[2] - localCenter[2];
        const d = Math.hypot(x, y, z) || 1e-3;
        const fold = 1 - Math.exp(-d / R);                 // 0→1：越远收缩越强
        const ripple = 1 + 0.05 * Math.sin((d / R) * Math.PI * 3); // 同心褶皱
        const tighten = n.memory_layer === 'working' ? 0.92 : 1.0;
        const s = fold * ripple * tighten;
        map.set(n.id, [x * s, y * s, z * s]);
      });
    } else if (mode === 'idspace') {
      // 星位（原创 id 三维坐标体系）：每张卡片的坐标只由它的 id 决定，
      // 与引擎力导向 / 插入顺序 / 库规模完全无关。同一 id 永远落在同一点。
      // 本库节点在球体积内按 id 均匀分布；跨库节点用同一 id 坐标外推 1.35 倍，
      // 既保持 id 决定论，又与本库星系分层。
      for (const n of nodes) {
        const ghost = n.memory_layer === 'cross';
        map.set(n.id, idCoordinate(n.id, localRadius * (ghost ? 1.35 : 1)));
      }
    } else {
      // constellation：沿用引擎真实力导向坐标（本身已按领域聚类）
      for (const n of nodes) map.set(n.id, [n.pos[0], n.pos[1], n.pos[2]]);
    }

    // ================================================================
    //  v2.2.2：**跨库节点统一落位**（引力 / 皮层两种结构视图）。
    //
    //  症状（用户实测）：切换到"引力"视图后，跨库关联卡片的名称
    //  （KB-CP-2026-xxxx 那一批）孤零零地堆在画面最右侧，
    //  既不挨着本库星系的卡片名，也看不出它们属于哪个库。
    //
    //  根因：computePositions 的引力/皮层分支**只给本库节点重算坐标**，
    //  跨库节点（ghostNodes）被整个漏掉了 —— 于是它们的位置停留在
    //  applyPositions 里那句 "if (!p) continue" 的效果上：保留引擎给的
    //  原始坐标。跨库卡片在引擎里是按跨库关系摆放的，坐标离本库星系很远，
    //  投影到屏幕上就甩到了边缘。
    //  （"多库星系"视图本来就专门处理了它们，"星座"视图用引擎全量坐标、
    //  本就包含跨库节点的位置，所以这两种模式不需要补。）
    //
    //  做法：按来源库分组，把每组的跨库卡片摆在本库星系外围一圈的卫星位上，
    //  角度均匀分布。这样它们的名称与本库卡片名落在同一片画面里，
    //  配合标签避让（updateLabelsByDistance）就不会再挤成一团。
    // ================================================================
    if (ghostNodes.length && mode !== 'multikb' && mode !== 'constellation' && mode !== 'idspace') {
      const groups = new Map();
      for (const n of ghostNodes) {
        const key = n.cross?.vault_name || n.cross?.vault_id || '其他知识库';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
      }
      const gk = [...groups.keys()];
      const orbit = localRadius * 1.15;   // 略大于本库半径：环绕而不远离
      const spread = Math.max(14, localRadius * 0.16);
      gk.forEach((key, gi) => {
        const list = groups.get(key);
        const ang = (gi / Math.max(1, gk.length)) * Math.PI * 2 + 0.6;
        const cx = Math.cos(ang) * orbit;
        const cz = Math.sin(ang) * orbit;
        list.forEach((n, i) => {
          const a2 = (i / Math.max(1, list.length)) * Math.PI * 2;
          map.set(n.id, [cx + Math.cos(a2) * spread, ((i % 3) - 1) * spread * 0.5, cz + Math.sin(a2) * spread]);
        });
      });
    }
    return map;
  }

  // ---------------- 节点 ----------------
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);
  const indexOf = new Map();
  nodes.forEach((n, i) => indexOf.set(n.id, i));

  const nPos = new Float32Array(nodes.length * 3);
  const nCol = new Float32Array(nodes.length * 3);
  const nSize = new Float32Array(nodes.length);
  const nAct = new Float32Array(nodes.length);
  const nDim = new Float32Array(nodes.length).fill(1);
  const baseSize = new Float32Array(nodes.length);
  const baseColor = [];
  const c = new THREE.Color();
  nodes.forEach((n, i) => {
    const p = n.pos || [0, 0, 0];
    nPos[i * 3] = p[0]; nPos[i * 3 + 1] = p[1]; nPos[i * 3 + 2] = p[2];
    if (n.memory_layer === 'cross') {
      // 跨库幽灵节点：外圈淡青色，视觉上与本地星团区分
      c.setHex(TYPE_COLORS.cross_kb);
    } else {
      c.setHex(domainColor.get(n.domain) || 0x7B5CFF);
      if (n.memory_layer === 'working') c.offsetHSL(0, 0.15, 0.08);
      if (n.memory_layer === 'episodic') c.offsetHSL(-0.06, 0.1, 0.02);
    }
    baseColor.push(c.clone());
    nCol[i * 3] = c.r; nCol[i * 3 + 1] = c.g; nCol[i * 3 + 2] = c.b;
    // 规模自适应：卡片越多，单点越小、泛光越弱，否则整张图会过曝成一团白
    // v2.2.0：加尺寸下限 —— 度数为 0 的叶子节点此前只有 4.4×densityScale，
    // 大库时缩到 2.7px 几乎看不见，"点了没反应"其实是根本没点中。
    const ghostK = n.memory_layer === 'cross' ? 0.78 : 1.0;
    const s = Math.max(2.8, (4.4 + Math.min(3.6, Math.sqrt(n.degree || 0) * 0.92)) * densityScale * ghostK);
    baseSize[i] = s;
    nSize[i] = s;
  });

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(nCol, 3));
  nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1));
  nodeGeo.setAttribute('aAct', new THREE.BufferAttribute(nAct, 1));
  nodeGeo.setAttribute('aDim', new THREE.BufferAttribute(nDim, 1));

  const nodeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: TEX_GLOW }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aSize; attribute vec3 aColor; attribute float aAct; attribute float aDim;
      varying vec3 vC; varying float vA; varying float vD;
      uniform float uTime; uniform float uPR;
      void main(){
        vC = aColor; vA = aAct; vD = aDim;
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        float pulse = 1.0 + 0.22*sin(uTime*2.2 + position.x*0.18)*aAct + 0.06*sin(uTime*0.8+position.z*0.1);
        gl_PointSize = aSize*pulse*uPR*(430.0/-mv.z);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vA; varying float vD;
      uniform sampler2D uMap;
      void main(){
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d);
        if(r>0.5) discard;
        float core = smoothstep(0.5,0.02,r);
        float halo = smoothstep(0.5,0.10,r);
        vec3 col = mix(vC, vec3(1.0), 0.55*(1.0-core));
        col += vC*vA*0.7;
        float a = core*core*0.95 + halo*0.30*(0.55+vA*0.9);
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(col*(1.0+vA*0.55), a*(0.55+0.45*t.a)*vD);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const nodePoints = new THREE.Points(nodeGeo, nodeMat);
  nodePoints.frustumCulled = false;
  nodeGroup.add(nodePoints);
  disposables.push(nodeGeo, nodeMat);

  // ---------------- 突触边 ----------------
  const eCount = edges.length;
  const ePos = new Float32Array(eCount * 6);
  const eCol = new Float32Array(eCount * 6);
  const eAlpha = new Float32Array(eCount * 2);
  const eBaseAlpha = new Float32Array(eCount * 2);
  const visible = new Uint8Array(eCount);
  edges.forEach((e, i) => {
    const a = nodes[indexOf.get(e.src)], b = nodes[indexOf.get(e.dst)];
    if (!a || !b) { visible[i] = 0; return; }
    visible[i] = 1;
    const pa = a.pos || [0, 0, 0], pb = b.pos || [0, 0, 0];
    ePos[i * 6] = pa[0]; ePos[i * 6 + 1] = pa[1]; ePos[i * 6 + 2] = pa[2];
    ePos[i * 6 + 3] = pb[0]; ePos[i * 6 + 4] = pb[1]; ePos[i * 6 + 5] = pb[2];
    const col = new THREE.Color(TYPE_COLORS[e.type] || 0x7B5CFF);
    eCol[i * 6] = col.r; eCol[i * 6 + 1] = col.g; eCol[i * 6 + 2] = col.b;
    eCol[i * 6 + 3] = col.r; eCol[i * 6 + 4] = col.g; eCol[i * 6 + 5] = col.b;
    const al = (0.16 + Math.min(0.72, (e.weight || 0.3) * 0.95)) * edgeAlphaScale;
    eAlpha[i * 2] = al; eAlpha[i * 2 + 1] = al;
    eBaseAlpha[i * 2] = al; eBaseAlpha[i * 2 + 1] = al;
  });

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  edgeGeo.setAttribute('aColor', new THREE.BufferAttribute(eCol, 3));
  edgeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(eAlpha, 1));

  const edgeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aAlpha;
      varying vec3 vC; varying float vA;
      void main(){ vC=aColor; vA=aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vC; varying float vA; uniform float uTime;
      void main(){
        float flow = 0.82 + 0.18*sin(uTime*1.6);
        gl_FragColor = vec4(vC*(1.0+vA*0.7), vA*flow);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.frustumCulled = false;
  scene.add(edgeLines);
  disposables.push(edgeGeo, edgeMat);

  // ---------------- 突触能量脉冲（沿强边流动） ----------------
  const pulseEdges = [...edges.keys()]
    .filter((i) => visible[i] && (edges[i].weight || 0) > 0.42)
    .slice(0, 90);
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(pulseEdges.length * 3);
  const pCol = new Float32Array(pulseEdges.length * 3);
  const pSize = new Float32Array(pulseEdges.length);
  pulseEdges.forEach((ei, i) => {
    const e = edges[ei];
    const col = new THREE.Color(TYPE_COLORS[e.type] || 0x7B5CFF);
    pCol[i * 3] = col.r; pCol[i * 3 + 1] = col.g; pCol[i * 3 + 2] = col.b;
    pSize[i] = 5 + (e.weight || 0.4) * 7;
  });
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: TEX_GLOW }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aSize; varying vec3 vC; uniform float uPR;
      void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=aSize*uPR*(300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `
      varying vec3 vC; uniform sampler2D uMap;
      void main(){ vec4 t=texture2D(uMap, gl_PointCoord); gl_FragColor=vec4(vC*1.4, t.a*0.55); }`,
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pulses = new THREE.Points(pGeo, pMat);
  pulses.frustumCulled = false;
  scene.add(pulses);
  disposables.push(pGeo, pMat);

  // ================================================================
  //  v2.0.0：知识库名称锚点 + 领域结构标签（CSS2D，随 3D 投影）
  // ================================================================
  const labelObjs = new Map();
  const byDegree = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0));
  // v2.0.0：标签密度自适应 —— 标签层真正开始渲染后（全量显示会糊成一片），
  // 按规模取一个上限：优先给度数最高（最枢纽）的卡片命名。
  //
  // v2.2.1：固定上限（40 个）是"文件显示不全"的另一半原因 ——
  // 692 张卡片只有 40 个有名字，其余全是无名小球，用户看到的就像"少了很多文件"。
  // 现在改成**按相机距离动态取舍**：离镜头近的节点优先给名字，
  // 拉近镜头就逐层显现更多卡片名，远处的不显示（否则糊成一片）。
  // 这样既保持画面干净，又保证"放大就能看到每一张卡片的真名"。
  const labelCap = Math.max(8, Math.min(40, Math.round(nodes.length * 0.32)));
  const labelled = new Set(byDegree.slice(0, labelCap).map((n) => n.id));
  for (const n of nodes) if (n.memory_layer === 'cross') labelled.add(n.id);
  // 距离优先的候选池：所有节点都进池（不止 labelCap 个），每帧按距离重排。
  const labelPool = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0));
  // 屏幕空间里最多同时显示多少个标签（按视口大小动态定）
  const maxOnScreenLabels = () => {
    const area = (container.clientWidth || 1200) * (container.clientHeight || 700);
    return Math.max(12, Math.min(220, Math.round(area / 9000)));
  };

  function makeLabel(n) {
    const el = document.createElement('div');
    el.className = 'cosmos-label';
    el.textContent = n.title;
    el.title = n.path || n.title;
    if (n.memory_layer === 'cross') el.classList.add('is-cross');
    // v2.1.0 修复：标签此前只是"文字"——CSS2D 层整层 pointer-events:none，
    // 且从未绑定任何事件，于是节点标题点不动。现在标签本身即按钮。
    // pointerdown 阻止冒泡：避免与 OrbitControls 的拖拽/选中逻辑打架。
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const idx = indexOf.get(n.id);
      if (idx != null) selected = idx;
      if (opts.onSelect) opts.onSelect(n);
      pinLabel(n.id);
    });
    el.addEventListener('pointerenter', () => {
      el.classList.add('is-hover');
      if (opts.onHover) opts.onHover(n);
    });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-hover');
      if (opts.onHover) opts.onHover(null);
    });
    const obj = new CSS2DObject(el);
    obj.position.set(n.pos[0], n.pos[1], n.pos[2]);
    return obj;
  }
  function ensureLabel(id) {
    if (labelObjs.has(id)) return;
    const n = nodes[indexOf.get(id)];
    if (!n) return;
    const o = makeLabel(n);
    nodeGroup.add(o);
    labelObjs.set(id, o);
  }
  // v2.2.1：**不再开局就建好固定那批标签**。
  // 原先按度数取前 40 个建成 DOM 元素，其余 652 张卡片永远没有名字 ——
  // 而"有多少张卡片"恰恰是用户最想确认的事。现在改为**按需创建**：
  // 相机拉近时逐个补建（ensureLabel），拉远时只保留可见的那些，
  // 于是"放大就能看到每一张卡片的真名"。
  // 跨库节点（卫星星系）例外：它们数量少且是重要的地标，始终保留名字。
  for (const n of nodes) {
    if (n.memory_layer === 'cross') { ensureLabel(n.id); continue; }
  }

  let selectedId = null;
  // ================================================================
  //  v2.2.3：标签显示改为**三态**，不再只有开/关两个档。
  //
  //  用户诉求（实测反馈）：「可以显示或者隐藏所有的标签」。
  //  原来只有二态按钮，且"显示"档仍有**距离预算**上限
  //  （maxOnScreenLabels()，按视口面积算，最多 220 个）——
  //  692 张卡片的库永远不可能同时显示所有名字，
  //  于是用户看到"我开了显示标签，却还是有一堆卡片没名字"。
  //
  //  三态：
  //    'auto' —— 默认。按相机距离动态取舍：近的优先给名字，
  //             拉近镜头逐层显现更多。画面始终干净。
  //    'all'  —— **全部显示**。给每一个节点都建标签、全部显示，
  //             不受距离预算限制（会挤，但用户明确要的就是这个）。
  //    'none' —— 全部隐藏（只留当前选中卡片的名字）。
  //
  //  为什么用字符串而不是布尔：布尔只能表达"开/关"，
  //  而"开"这个语义在旧实现里是**有上限的**，与用户理解的"开=全都显示"不符。
  // ================================================================
  // v2.2.3：标签显示模式。
  // 'auto' —— 按相机距离动态取舍（默认，画面干净）
  // 'all'  —— 全部显示，不设预算上限
  // 'none' —— 全部隐藏
  //
  // 为什么必须从 opts 传入：mount() 每次都会重建整个场景，
  // 若新场景不知道用户当前选的模式，切库/切密度/切层级之后
  // 标签显示方式就被悄悄重置回默认值了（用户会以为按钮失灵）。
  let labelMode = (opts.labelMode === 'all' || opts.labelMode === 'none') ? opts.labelMode : 'auto';
  let labelsVisible = labelMode !== 'none';
  function setLabels(mode) {
    // 兼容布尔入参（视图层旧调用点）：true → 'auto'，false → 'none'
    const m = (mode === true) ? 'auto' : (mode === false) ? 'none' : String(mode || 'auto');
    labelMode = (m === 'all' || m === 'none' || m === 'auto') ? m : 'auto';
    labelsVisible = labelMode !== 'none';
    // 'all'：给**每一个**节点都建标签（默认只建跨库节点的），否则重建场景后
    // 标签显示方式会被悄悄重置回默认。'none' 不需要预建，按需即可。
    if (labelMode === 'all') {
      for (const n of nodes) ensureLabel(n.id);
    }
    // 统一走 refreshLabels —— 选标签 / 去重叠 / 淡化 一次性算完，
    // 杜绝旧实现「两套节律错峰」导致的标签闪烁。
    refreshLabels();
  }
  function pinLabel(id) {
    if (selectedId && labelObjs.has(selectedId)) {
      const prev = labelObjs.get(selectedId);
      prev.visible = labelsVisible;
      prev.element?.classList.remove('is-pinned');
    }
    selectedId = id || null;
    if (!selectedId) { refreshLabels(); return; }
    ensureLabel(selectedId);
    const o = labelObjs.get(selectedId);
    if (o) { o.visible = true; o.element?.classList.add('is-pinned'); }
    // 选中态变了，立刻重算（选中标签永远满亮、不淡化、不被去重叠藏掉）
    refreshLabels();
  }

  // ---- 知识库名称铭牌：星图**右下角** ----
  // v2.1.0 原本把库名画在星图正中央（30px 发光大字），实测有两个问题：
  //   ① 压住星核与中心区域的节点标签，"中央"本来就是信息最密集的位置；
  //   ② 大面积径向底衬把中心节点压暗，形成一块"谁也看不清"的死区。
  // v2.2.0：库名移到**右下角**铭牌（与提示条不重叠），改为左对齐的紧凑玻璃卡，
  //   字号降到 15px，不再需要径向底衬 —— 中心区域完全让给数据本身。
  //   能力不变：库名依然可点，点了直接进「体系」页管理知识库。
  const kbPlate = document.createElement('div');
  kbPlate.className = 'cosmos-kb-plate';
  Object.assign(kbPlate.style, {
    position: 'absolute', inset: '0', zIndex: '3', pointerEvents: 'none',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    padding: '0 18px 18px 0',
  });
  const kbAnchorEl = document.createElement('div');
  kbAnchorEl.className = 'cosmos-kb';
  kbAnchorEl.innerHTML = `
    <div class="kb-name"></div>
    <div class="kb-meta"></div>`;
  // v2.1.0：库名可点击 —— 点了直接进「体系」页管理知识库（.kb-meta 仍不吃事件）
  kbAnchorEl.querySelector('.kb-name').addEventListener('pointerdown', (ev) => ev.stopPropagation());
  kbAnchorEl.querySelector('.kb-name').addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    if (opts.onVaultNameClick) opts.onVaultNameClick(vault);
  });
  kbPlate.appendChild(kbAnchorEl);
  container.appendChild(kbPlate);

  // ---- 领域结构标签（星座视图）：每个领域簇的质心 ----
  const domainLabels = new Map();   // domain -> { obj, el }
  const domainLabelGroup = new THREE.Group();
  scene.add(domainLabelGroup);

  function domainCentroids(posMap) {
    const acc = new Map();
    for (const n of nodes) {
      if (n.memory_layer === 'cross') continue;
      const p = posMap.get(n.id);
      if (!p) continue;
      if (!acc.has(n.domain)) acc.set(n.domain, { x: 0, y: 0, z: 0, c: 0 });
      const a = acc.get(n.domain);
      a.x += p[0]; a.y += p[1]; a.z += p[2]; a.c++;
    }
    const out = [];
    for (const [d, a] of acc) out.push({ domain: d, pos: [a.x / a.c, a.y / a.c, a.z / a.c], count: a.c });
    return out;
  }

  function syncDomainLabels(posMap, mode) {
    for (const [, rec] of domainLabels) {
      domainLabelGroup.remove(rec.obj);
      rec.obj.element?.remove();
    }
    domainLabels.clear();
    if (mode !== 'constellation') return;
    for (const cd of domainCentroids(posMap)) {
      if (cd.count < 2) continue;           // 单卡领域不标注，避免噪声
      // 核心区的领域标签会让位给知识库名称（中央标题优先）
      const dist = Math.hypot(cd.pos[0], cd.pos[1], cd.pos[2]);
      if (dist < localRadius * 0.22) continue;
      const el = document.createElement('div');
      el.className = 'cosmos-domain';
      el.innerHTML = '<b></b><i></i>';
      el.querySelector('b').textContent = cd.domain;
      el.querySelector('i').textContent = cd.count;
      el.title = `聚焦领域「${cd.domain}」（${cd.count} 张卡片）`;
      // v2.1.0：领域标签可点击 —— 点一下即聚焦该簇（与左侧 HUD 图例同一动作）
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (opts.onDomainClick) opts.onDomainClick(cd.domain);
      });
      const obj = new CSS2DObject(el);
      obj.position.set(cd.pos[0], cd.pos[1], cd.pos[2]);
      domainLabelGroup.add(obj);
      domainLabels.set(cd.domain, { obj, el });
    }
  }

  // ---- 跨库星系标签（多库视图） ----
  const galaxyLabels = new Map();
  const galaxyLabelGroup = new THREE.Group();
  scene.add(galaxyLabelGroup);
  function syncGalaxyLabels(posMap, mode) {
    for (const [, rec] of galaxyLabels) {
      galaxyLabelGroup.remove(rec.obj);
      rec.obj.element?.remove();
    }
    galaxyLabels.clear();
    if (mode !== 'multikb') return;
    for (const [key, p] of posMap) {
      if (!key.startsWith('__galaxy__')) continue;
      const name = key.slice('__galaxy__'.length);
      const cnt = nodes.filter((n) => (n.cross?.vault_name || '其他知识库') === name).length;
      const sample = nodes.find((n) => (n.cross?.vault_name || '其他知识库') === name);
      const el = document.createElement('div');
      el.className = 'cosmos-galaxy';
      el.innerHTML = '<b></b><i></i>';
      el.querySelector('b').textContent = name;
      el.querySelector('i').textContent = `${cnt} 张卡片（跨库）`;
      if (sample?.cross?.vault_color) el.style.setProperty('--gc', sample.cross.vault_color);
      el.title = `切换到知识库「${name}」`;
      // v2.1.0：跨库星系标签可点击 —— 点一下直接切到那座卫星星系所属的知识库
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (opts.onVaultClick) opts.onVaultClick(sample?.cross?.vault_id, name);
      });
      const obj = new CSS2DObject(el);
      obj.position.set(p[0], p[1], p[2]);
      galaxyLabelGroup.add(obj);
      galaxyLabels.set(name, { obj, el });
    }
  }

  // ---------------- 后处理 ----------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // v2.1.0：软件渲染下泛光后期是帧率杀手（每帧多一遍高斯模糊 + 混合），
  // 直接不挂 —— 星图仍然完整可读，只是少了那层辉光。
  let bloom = null;
  if (!softRender) {
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.86 * bloomScale, 0.7, 0.12);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());

  // ---------------- 拾取 ----------------
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 2.4;
  const pointer = new THREE.Vector2();
  let hovered = -1;
  let selected = -1;

  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(nodePoints, false);
    return hits.length ? hits[0].index : -1;
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const idx = pick(ev);
    if (idx !== hovered) {
      hovered = idx;
      renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
      if (opts.onHover) opts.onHover(idx >= 0 ? nodes[idx] : null);
    }
  });
  renderer.domElement.addEventListener('click', (ev) => {
    const idx = pick(ev);
    selected = idx;
    if (idx >= 0 && opts.onSelect) opts.onSelect(nodes[idx]);
    if (idx >= 0) pinLabel(nodes[idx].id);
  });

  // ---------------- 相机聚焦动画 ----------------
  let fly = null;
  function focus(id) {
    const i = indexOf.get(id);
    if (i == null) return;
    const target = new THREE.Vector3(nPos[i * 3], nPos[i * 3 + 1], nPos[i * 3 + 2]);
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const dist = 58;
    fly = {
      fromPos: camera.position.clone(), toPos: target.clone().add(dir.multiplyScalar(dist)),
      fromTgt: controls.target.clone(), toTgt: target.clone(), t: 0,
    };
    selected = i;
  }

  function frameAll() {
    const box = new THREE.Box3();
    for (let i = 0; i < nodes.length; i++) box.expandByPoint(new THREE.Vector3(nPos[i * 3], nPos[i * 3 + 1], nPos[i * 3 + 2]));
    if (box.isEmpty()) return;
    // v2.2.0：取景半径改用**分位数**而非包围盒全尺寸。
    // 原来按整盒取景：力导向图里少数边缘节点会被甩得很远，
    // 于是相机退到极远，密实的枢纽区被缩成一小团、标签全叠在一起（实测如此）。
    // 现在取 80 分位的节点距离为半径：核心区（枢纽所在）填满画面，
    // 边缘节点仍可用滚轮/复位自由查看。
    const d = [];
    for (let i = 0; i < nodes.length; i++) {
      d.push(Math.hypot(nPos[i * 3], nPos[i * 3 + 1], nPos[i * 3 + 2]));
    }
    d.sort((a, b) => a - b);
    const q = d.length ? d[Math.min(d.length - 1, Math.floor(d.length * 0.8))] : 0;
    const radius = Math.max(60, q * 1.15);
    const dist = radius / Math.tan((camera.fov * Math.PI / 180) / 2) * 0.8;
    const dir = new THREE.Vector3(0.55, 0.42, 1).normalize();
    // 目标点始终是"星系核心"（知识库名称锚点所在处），名称才不会跑出视野
    const core = new THREE.Vector3(0, 0, 0);
    fly = {
      fromPos: camera.position.clone(), toPos: core.clone().add(dir.multiplyScalar(dist)),
      fromTgt: controls.target.clone(), toTgt: core.clone(), t: 0,
    };
  }

  // ---------------- 激活可视化 ----------------
  const actTarget = new Float32Array(nodes.length);
  function setActivation(map) {
    actTarget.fill(0);
    if (map) for (const [id, v] of map) {
      const i = indexOf.get(id);
      if (i != null) actTarget[i] = Math.max(actTarget[i], Math.min(1, v));
    }
    nodeGeo.attributes.aAct.needsUpdate = true;
  }

  function setPathEdges(keys) {
    const arr = edgeGeo.attributes.aAlpha.array;
    for (let i = 0; i < edges.length; i++) {
      const on = keys && keys.has(`${edges[i].src}->${edges[i].dst}`) ? 1 : 0;
      arr[i * 2] = on ? Math.min(1, eBaseAlpha[i * 2] * 2.6) : eBaseAlpha[i * 2];
      arr[i * 2 + 1] = on ? Math.min(1, eBaseAlpha[i * 2 + 1] * 2.6) : eBaseAlpha[i * 2 + 1];
    }
    edgeGeo.attributes.aAlpha.needsUpdate = true;
  }

  const hiddenTypes = new Set();
  function setTypeFilter(activeTypes) {
    hiddenTypes.clear();
    const arr = edgeGeo.attributes.aAlpha.array;
    for (let i = 0; i < edges.length; i++) {
      const visibleNow = !activeTypes || activeTypes.has(edges[i].type);
      arr[i * 2] = visibleNow ? eBaseAlpha[i * 2] : 0;
      arr[i * 2 + 1] = visibleNow ? eBaseAlpha[i * 2 + 1] : 0;
    }
    edgeGeo.attributes.aAlpha.needsUpdate = true;
  }

  // ---------------- 领域聚焦（v2.0.0） ----------------
  let focusDomain = null;
  function setDomainFocus(domain) {
    focusDomain = domain || null;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const inDomain = !focusDomain || n.domain === focusDomain;
      nDim[i] = inDomain ? 1 : 0.12;
    }
    nodeGeo.attributes.aDim.needsUpdate = true;
    // 边：不属于该领域的边淡出
    const arr = edgeGeo.attributes.aAlpha.array;
    for (let i = 0; i < edges.length; i++) {
      const a = nodes[indexOf.get(edges[i].src)];
      const b = nodes[indexOf.get(edges[i].dst)];
      const hit = !focusDomain || (a && a.domain === focusDomain) || (b && b.domain === focusDomain);
      const base = hit ? eBaseAlpha[i * 2] : eBaseAlpha[i * 2] * 0.12;
      arr[i * 2] = base; arr[i * 2 + 1] = base;
    }
    edgeGeo.attributes.aAlpha.needsUpdate = true;
    // 领域标签：非聚焦域隐藏
    for (const [d, rec] of domainLabels) {
      rec.el.classList.toggle('is-dim', !!focusDomain && d !== focusDomain);
      rec.el.classList.toggle('is-active', !!focusDomain && d === focusDomain);
    }
  }

  // ---------------- 布局模式切换（v2.0.0） ----------------
  let layoutMode = opts.layoutMode || 'constellation';
  let positions = computePositions(layoutMode);

  function applyPositions(posMap) {
    positions = posMap;
    for (let i = 0; i < nodes.length; i++) {
      const p = posMap.get(nodes[i].id);
      if (!p) continue;
      nPos[i * 3] = p[0]; nPos[i * 3 + 1] = p[1]; nPos[i * 3 + 2] = p[2];
    }
    nodeGeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < edges.length; i++) {
      const a = posMap.get(edges[i].src);
      const b = posMap.get(edges[i].dst);
      if (!a || !b) continue;
      ePos[i * 6] = a[0]; ePos[i * 6 + 1] = a[1]; ePos[i * 6 + 2] = a[2];
      ePos[i * 6 + 3] = b[0]; ePos[i * 6 + 4] = b[1]; ePos[i * 6 + 5] = b[2];
    }
    edgeGeo.attributes.position.needsUpdate = true;
    for (const [id, o] of labelObjs) {
      const p = posMap.get(id);
      if (p) o.position.set(p[0], p[1], p[2]);
    }
    syncDomainLabels(posMap, layoutMode);
    syncGalaxyLabels(posMap, layoutMode);
    // 知识库名称铭牌：始终位于星系核心（画面正中）
    updateKBLabel();
  }

  function setLayoutMode(mode) {
    if (!LAYOUT_MODES.some((m) => m.key === mode)) return false;
    layoutMode = mode;
    applyPositions(computePositions(mode));
    if (focusDomain) setDomainFocus(focusDomain);
    return true;   // v6.20：让调用方确认真实切换成功，不再静默失败后状态漂移
  }

  function updateKBLabel() {
    const nameEl = kbAnchorEl.querySelector('.kb-name');
    const metaEl = kbAnchorEl.querySelector('.kb-meta');
    if (!vault) {
      kbAnchorEl.classList.add('is-empty');
      nameEl.textContent = '未打开知识库';
      metaEl.textContent = '';
      return;
    }
    kbAnchorEl.classList.remove('is-empty');
    kbAnchorEl.style.setProperty('--kc', vaultColor);
    nameEl.textContent = vault.name || '未命名知识库';
    const localCount = localNodes.length;
    const crossCount = ghostNodes.length;
    if (layoutMode === 'multikb') {
      const gk = [...new Set(ghostNodes.map((n) => n.cross?.vault_name || '其他知识库'))];
      metaEl.textContent = `主星系 ${localCount} 张卡片 · 卫星星系 ${gk.length} 座（${crossCount} 个跨库节点）`;
    } else {
      const doms = new Set(localNodes.map((n) => n.domain));
      metaEl.textContent = `${localCount} 张卡片 · ${edges.length} 条突触 · ${doms.size} 个领域`;
    }
  }

  // v6.20.1：库元数据就绪 / 切换后，由外部（graph.js）调用刷新铭牌。
  // 解决 createCosmos 创建瞬间 opts.vault 是空快照、之后库异步就绪/切换时
  // 铭牌却一直停在"未打开知识库"空态的问题（此前 vault 是 const 一次性冻结）。
  function setVault(v) {
    if (!v || typeof v !== 'object') return;
    vault = v;
    vaultColor = v.color || '#8B7BFF';
    updateKBLabel();
  }

  // ---------------- 渲染循环 ----------------
  const clock = new THREE.Clock();
  let raf = 0;
  let running = true;
  // v3.0.0：标签刷新节流计数器（静止时降频，省 CPU）
  let labelRefreshTick = 0;

  // v3.0.0：窗口失焦 / 标签页隐藏时暂停渲染循环，省 CPU/GPU/电量。
  // 星图是常驻 WebGL 场景，用户切到别的窗口时 RAF 仍在每帧全速渲染 —— 纯浪费。
  // 失焦即停、回焦即恢复；切走标签页（visibilitychange→hidden）同理。
  // 关掉的是"动画心跳"，不是场景：回来时时钟继续走、状态不丢、画面不会闪。
  // winPaused 只记录"是否由失焦触发"，避免重复 resume / 与显式 setRunning 打架。
  let winPaused = false;
  function setRunning(v) {
    if (v && !running) { running = true; clock.start(); tick(); }
    else if (!v && running) { running = false; cancelAnimationFrame(raf); }
  }
  function pauseForBlur() { if (running) { winPaused = true; setRunning(false); } }
  function resumeFromFocus() { if (winPaused) { winPaused = false; setRunning(true); } }
  const onWinBlur = () => pauseForBlur();
  const onWinFocus = () => resumeFromFocus();
  const onVis = () => { if (document.hidden) pauseForBlur(); else resumeFromFocus(); };
  window.addEventListener('blur', onWinBlur);
  window.addEventListener('focus', onWinFocus);
  document.addEventListener('visibilitychange', onVis);

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    if (bloom) bloom.setSize(w, h);
    labelRenderer.setSize(w, h);
  }

  const tmp = new THREE.Vector3();
  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();

    bgMat.uniforms.uTime.value = t;
    if (starUniform) starUniform.uTime.value = t;
    nodeMat.uniforms.uTime.value = t;
    edgeMat.uniforms.uTime.value = t;

    // 激活值平滑趋近
    let actDirty = false;
    for (let i = 0; i < nodes.length; i++) {
      const cur = nAct[i], tgt = actTarget[i];
      if (Math.abs(cur - tgt) > 0.002) { nAct[i] = cur + (tgt - cur) * 0.14; actDirty = true; }
    }
    if (actDirty) nodeGeo.attributes.aAct.needsUpdate = true;

    // 脉冲沿突触流动
    if (pulseEdges.length) {
      const arr = pGeo.attributes.position.array;
      for (let i = 0; i < pulseEdges.length; i++) {
        const ei = pulseEdges[i];
        const a = positions.get(edges[ei].src);
        const b = positions.get(edges[ei].dst);
        if (!a || !b) continue;
        const speed = 0.16 + (i % 7) * 0.021;
        const u = (t * speed + i * 0.13) % 1;
        const w0 = 1 - u;
        arr[i * 3] = a[0] * w0 + b[0] * u;
        arr[i * 3 + 1] = a[1] * w0 + b[1] * u;
        arr[i * 3 + 2] = a[2] * w0 + b[2] * u;
      }
      pGeo.attributes.position.needsUpdate = true;
    }

    // 相机聚焦插值
    if (fly) {
      fly.t = Math.min(1, fly.t + 0.035);
      const e = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - Math.pow(-2 * fly.t + 2, 2) / 2;
      camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
      controls.target.lerpVectors(fly.fromTgt, fly.toTgt, e);
      if (fly.t >= 1) fly = null;
    }

    nebulaGroup.rotation.y = t * 0.006;
    tmp.set(0, 0, 0);
    controls.update();
    composer.render();
    // v2.0.0 修复：CSS2D 标签层此前从未被渲染（节点标题、知识库名称、领域标签全部不显示）。
    // 必须显式调用 labelRenderer.render —— EffectComposer 只跑 WebGL 通道，不含 DOM 标签层。
    labelRenderer.render(scene, camera);
    // v2.2.0：标签去重叠 —— 屏幕空间贪心抑制，度数高者优先占位，被压住的隐藏。
    // 没有这一步，枢纽密集区的几十个标签会互相叠印，谁也读不清（实测如此）。
    //
    // v2.2.2：**相机在动时改为每帧执行**。
    // 相机带阻尼、标签位置每帧都在变，而去重原本每 4 帧才跑一次 ——
    // 于是"这一帧算好的结果"到下一帧就失效，密集区必然出现重叠
    // （实测 54 个标签时 0 重叠，80 个标签时 7 处）。
    // 相机静止时仍走低频（省 CPU）。
    //
    // v3.0.0：标签刷新**合并为单一节律**。
    // 旧实现把「按距离选标签」(每 6 帧) 与「去重叠」(每 4 帧) 拆成两套独立节律，
    // 两者错峰执行 ⇒ 某一帧放出来的标签下一帧被藏掉、再下一帧又放出来 ⇒ 密集区持续闪烁。
    // 现在每帧（相机动时）/ 每 4 帧（静止时）只跑一次 refreshLabels，
    // 它内部一次性完成「选标签 → 去重叠 → 后方淡化」，且重叠不再硬藏、改为降透明度，
    // 配合 CSS 过渡，标签永远不会闪。
    if (camMoving) {
      refreshLabels();
    } else {
      if ((labelRefreshTick++ % 4) === 0) refreshLabels();
    }
  }

  // ---- 标签去重叠 ----
  const projV = new THREE.Vector3();
  // 相机位置与节点世界坐标的临时向量 —— updateLabelsByDistance 用来算
  // 「节点离镜头多远」与「投影点落在画布哪里」。
  const camPos = new THREE.Vector3();
  const nodeWorld = new THREE.Vector3();
  // v3.0.0：标签刷新唯一入口（取代原先的 updateLabelsByDistance + declutterLabels）。
  // 一次性完成：① 按相机距离 / 视野 / 预算选出「有资格的标签」；
  // ② 重叠的标签**降透明度而非硬藏**——后方标签自动淡化（is-dim），
  //    画面不再闪烁、也不再叠印（用户诉求：不闪烁、不重叠、后方淡化）；
  // ③ 被选中的标签永远满亮且不被去重叠。
  // 单一节律（见 tick）：相机动时每帧、静止时每 4 帧，杜绝旧实现两套节律错峰导致的闪烁。
  const LABEL_LIFT = 16; // 必须与 styles.css 中 .cosmos-label 的 margin-top 一致
  function refreshLabels() {
    // none：只保留选中卡片的名字
    if (!labelsVisible) {
      for (const [id, o] of labelObjs) o.visible = (id === selectedId);
      return;
    }
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    camPos.copy(camera.position);
    const budget = (labelMode === 'all') ? Infinity : maxOnScreenLabels();

    // 1) 候选：投影到屏幕，记录距离 / 视野 / 尺寸
    const cand = [];
    for (const n of nodes) {
      const i = indexOf.get(n.id);
      if (i == null) continue;
      let o = labelObjs.get(n.id);
      // 'all' 模式：预建全部标签；其余模式按需（命中资格后再建），避免一次建几百个 DOM
      if (!o && labelMode === 'all') { ensureLabel(n.id); o = labelObjs.get(n.id); }
      const proj = projV.set(nPos[i * 3], nPos[i * 3 + 1], nPos[i * 3 + 2]).project(camera);
      const off = proj.z > 1;                                   // 在相机背面
      const inView = !off && proj.x >= -1 && proj.x <= 1 && proj.y >= -1 && proj.y <= 1;
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h - LABEL_LIFT;
      const d = nodeWorld.set(nPos[i * 3], nPos[i * 3 + 1], nPos[i * 3 + 2]).distanceTo(camPos);
      cand.push({
        id: n.id, o, x, y, off, inView, d, deg: n.degree || 0,
        bw: (o?.element?.offsetWidth || 60) + 8,
        bh: (o?.element?.offsetHeight || 18) + 4,
        needCreate: !o,
      });
    }

    // 2) 稳定排序：选中 > 在视野内 > 近 > 度数高 > id（id 兜底，顺序不抖动就不会闪）
    cand.sort((a, b) => {
      const sa = a.id === selectedId ? 1 : 0, sb = b.id === selectedId ? 1 : 0;
      if (sa !== sb) return sb - sa;
      if (a.inView !== b.inView) return a.inView ? -1 : 1;
      if (a.d !== b.d) return a.d - b.d;
      if (a.deg !== b.deg) return b.deg - a.deg;
      return a.id < b.id ? -1 : 1;
    });

    // 3) 资格 + 重叠淡化
    const placed = [];
    let shown = 0;
    for (const c of cand) {
      if (c.id === selectedId) { c.eligible = true; c.dim = false; placed.push(c); continue; }
      if (c.off) { c.eligible = false; continue; }
      if (!c.inView) { c.eligible = false; continue; }       // 视野外不显示（CSS2D 也本就画不到画布内）
      if (labelMode === 'all') c.eligible = true;
      else { c.eligible = shown < budget; if (c.eligible) shown++; }
      if (!c.eligible) continue;
      // 与已放置的（更靠前 / 更重要的）标签重叠 ⇒ 降透明度，绝不硬藏
      let hit = false;
      for (const p of placed) {
        if (Math.abs(c.x - p.x) < (c.bw + p.bw) / 2 && Math.abs(c.y - p.y) < (c.bh + p.bh) / 2) { hit = true; break; }
      }
      c.dim = hit;
      placed.push(c);
    }

    // 3.5) 给命中资格但尚未建标签的节点补建（auto 模式：仅建近处 / 视野内的）
    for (const c of cand) {
      if (c.eligible && c.needCreate && !c.o) {
        ensureLabel(c.id);
        c.o = labelObjs.get(c.id);
      }
    }

    // 4) 应用：可见性 + 透明度（CSS 过渡负责平滑，绝不硬跳）
    for (const c of cand) {
      if (!c.o) continue;
      c.o.visible = !!c.eligible;
      if (!c.eligible) continue;
      const el = c.o.element;
      if (el) {
        el.style.opacity = c.dim ? '0.2' : '1';
        el.classList.toggle('is-dim', c.dim);
        el.classList.toggle('is-pinned', c.id === selectedId);
      }
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  applyPositions(positions);
  frameAll();
  tick();
  // v2.2.3：应用初始标签模式。
  // 'all' 档需要给**每一个**节点都建标签（默认只建跨库节点的），
  // 'none' 档要确保一个都不显示 —— 这两件事必须在场景就绪时做一次，
  // 否则重建场景后标签显示方式会悄悄退回默认。
  if (labelMode !== 'auto') {
    try { setLabels(labelMode); } catch (e) { /* ignore */ }
  }
  setTimeout(() => { if (opts.onReady) opts.onReady({ nodes: nodes.length, edges: edges.length, layoutMode }); }, 60);

  return {
    focus, frameAll, setActivation, setPathEdges, setTypeFilter, setLabels,
    pinLabel, setLayoutMode, setDomainFocus,
    get layoutMode() { return layoutMode; },
    get focusDomain() { return focusDomain; },
    // v2.2.3：把标签模式暴露出去，供视图层渲染按钮文案（避免两边状态不同步）。
    get labelMode() { return labelMode; },
    setAutoRotate(v) { controls.autoRotate = !!v; },
    // v2.2.1：把库铭牌元素交给视图层，让它也能被做成"可拖动 + 可最小化"的浮动面板。
    // 之前铭牌是写死在右下角的 absolute 定位，和卡片详情面板、提示条挤在一块 ——
    // 用户在截图里圈出的"右下角重叠"就是它。
    get kbPlateEl() { return kbPlate; },
    get kbAnchorEl() { return kbAnchorEl; },
    // v6.20.1：库元数据更新后重刷右下角铭牌，避免空态冻结
    setVault,
    setBloom(strength) { if (bloom) bloom.strength = strength; },
    get selectedIndex() { return selected; },
    snapshot() { composer.render(); return renderer.domElement.toDataURL('image/png'); },
    setRunning,
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      // v3.0.0：移除失焦/可见性监听，杜绝 dispose 后还被 blur/focus 唤醒、
      // 对着已销毁的 WebGL 上下文继续渲染而崩掉渲染进程。
      try {
        window.removeEventListener('blur', onWinBlur);
        window.removeEventListener('focus', onWinFocus);
        document.removeEventListener('visibilitychange', onVis);
      } catch (e) { /* ignore */ }
      ro.disconnect();
      // v2.2.1：**必须释放 WebGL 上下文**。
      // three.js 的 renderer.dispose() 只回收 GPU 资源，**不释放上下文本身**。
      // 而 Chromium 对同一渲染进程同时存活的 WebGL 上下文有上限（约 16 个），
      // 超了就主动杀掉最老的那一个 —— 表现为「渲染进程崩溃」。
      // 星图视图的 mount() 每被调用一次就 new 一个 WebGLRenderer（切层级、切密度
      // 都会触发），若上下文不释放，来回切换十几次必定崩掉整个客户端。
      // 顺序：控制器 → 后处理（渲染目标）→ 几何/材质 → 渲染器 → 强制释放上下文。
      try { controls.dispose(); } catch (e) { /* ignore */ }
      try { composer.dispose?.(); } catch (e) { /* ignore */ }
      try { if (bloom) bloom.dispose?.(); } catch (e) { /* ignore */ }
      for (const d of disposables) { try { d.dispose?.(); } catch (e) { /* ignore */ } }
      try {
        renderer.dispose();
        // forceContextLoss 会立即交还上下文槽位，这是防崩溃的关键一步
        renderer.forceContextLoss?.();
      } catch (e) { /* ignore */ }
      labelRenderer.domElement.remove();
      kbPlate.remove();
      renderer.domElement.remove();
      LIVE.n--;   // 诊断：存活场景计数回落
    },
  };
}
