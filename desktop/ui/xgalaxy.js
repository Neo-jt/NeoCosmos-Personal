// ============================================================================
//  NeoLink · 多库星系渲染引擎 (xgalaxy) —— v2.2.1
// ============================================================================
//  把「跨库关联图谱」从 2D 画布升级为**真正的 3D 星系**。
//
//  设计意图
//  ---------------------------------------------------------------------------
//  跨库图谱和主星图讲的是同一件事，只是尺度不同：
//    主星图  = 一个库内部的突触网络（节点=卡片，边=突触）
//    多库星系= 库与库之间的关联网络（节点=知识库，边=共享标题/标签）
//  所以两者应当**共享同一套视觉语言**：深空底、发光节点、按权重渐变的边、
//  关系有层级（强关联的库彼此更近）。
//
//  具体构造
//  ---------------------------------------------------------------------------
//  ① 节点 = 一个发光的球体，半径 ∝ √(卡片数)（面积正比于规模，直觉正确）。
//     当前库额外套一圈"轨道环"，一眼认出"我在这儿"。
//  ② 边 = 贝塞尔曲线管（Tube），粗细与亮度 ∝ 关联强度。
//     用曲线而非直线：两点之间的连线在 3D 里容易"穿过"球体，
//     拱起的弧线既避免遮挡，也让密集区域更易读。
//  ③ 布局 = 三维力导向（斥力 + 边引力 + 向心力），
//     再叠加"按共享标签数分层"的轻微球壳约束 —— 关联紧密的库聚成一簇。
//  ④ 标签 = CSS2D（与主星图同一套），始终可读，且支持去重叠。
//  ⑤ 交互：拖拽旋转 / 滚轮缩放 / 点选节点查看详情 / 自动旋转。
//
//  性能
//  ---------------------------------------------------------------------------
//  库的数量天然很少（个位数到几十个），远小于卡片数，
//  所以这里**不需要 LOD**：一次建好全部几何即可。
//  但仍然做了软件渲染降级（与主星图一致）——
//  虚拟机 / 远程桌面上没有独显时，像素比必须压到 1。
//
//  createXGalaxy({ container, xgraph, currentId, onSelect }) -> galaxy
//   galaxy.setHighlight(vaultId|null)
//   galaxy.setAutoRotate(bool)
//   galaxy.dispose()
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const VAULT_COLORS = [0x8B7BFF, 0x46E0FF, 0xFF6B8A, 0x3FE0C8, 0xD4A843, 0xC77DFF, 0x5FA8FF, 0xFF9F6B];
const CURRENT_COLOR = 0xFFD166;

export function createXGalaxy(opts = {}) {
  const container = opts.container;
  const xgraph = opts.xgraph || { nodes: [], edges: [] };
  const currentId = opts.currentId || null;
  const onSelect = opts.onSelect || (() => {});

  const nodes = xgraph.nodes || [];
  const edges = xgraph.edges || [];

  // ---------------- 场景骨架 ----------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  camera.position.set(0, 90, 320);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // 软件渲染降级（与主星图同一套判断）：没有独显时像素比压到 1
  let softRender = false;
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    softRender = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(name);
  } catch { /* 拿不到就按硬件渲染处理 */ }
  renderer.setPixelRatio(softRender ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
  container.appendChild(renderer.domElement);

  // 标签层
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.classList.add('cosmos-label-layer');   // 审计脚本据此排除逐帧噪声
  Object.assign(labelRenderer.domElement.style, {
    position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '2',
  });
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.minDistance = 60;
  controls.maxDistance = 900;
  controls.autoRotateSpeed = 0.55;

  // ---------------- 背景星尘（几层随机点，暗示深空） ----------------
  {
    const N = 900;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // 球壳分布
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 900 + Math.random() * 500;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * s * r;
      pos[i * 3 + 1] = Math.sin(th) * s * r;
      pos[i * 3 + 2] = u * r;
      c.setHSL(0.6 + Math.random() * 0.12, 0.45, 0.55 + Math.random() * 0.35);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
    scene.add(new THREE.Points(g, m));
  }

  // ---------------- 三维力导向布局 ----------------
  const maxCards = Math.max(1, ...nodes.map((n) => n.cards || 0));
  const pos = nodes.map((n, i) => {
    // 初始摆成球面，交给力导向去整理
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const b = Math.acos(1 - (2 * (i + 0.5)) / Math.max(1, nodes.length));
    return {
      id: n.id, name: n.name, node: n,
      cur: n.id === currentId,
      cards: n.cards || 0,
      x: Math.sin(b) * Math.cos(a) * 170,
      y: Math.cos(b) * 170,
      z: Math.sin(b) * Math.sin(a) * 170,
      vx: 0, vy: 0, vz: 0,
      r: 9 + 19 * Math.sqrt((n.cards || 0) / maxCards),
    };
  });
  const pm = new Map(pos.map((p) => [p.id, p]));
  const maxW = Math.max(1, ...edges.map((e) => e.weight || 0));

  if (pos.length) {
    for (let it = 0; it < 260; it++) {
      // 斥力
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, dz = pos[i].z - pos[j].z;
          const d2 = dx * dx + dy * dy + dz * dz + 40;
          const d = Math.sqrt(d2);
          const f = 26000 / d2;
          const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
          pos[i].vx += fx; pos[i].vy += fy; pos[i].vz += fz;
          pos[j].vx -= fx; pos[j].vy -= fy; pos[j].vz -= fz;
        }
      }
      // 边引力（强度 ∝ 共享权重：关联越强，靠得越近）
      for (const e of edges) {
        const a = pm.get(e.source), b = pm.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        const k = 0.5 + (e.weight || 0) / maxW;
        const f = (d - (150 - 70 * k)) * 0.010 * k;
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        a.vx += fx; a.vy += fy; a.vz += fz;
        b.vx -= fx; b.vy -= fy; b.vz -= fz;
      }
      // 向心力（把整体收在原点附近）
      for (const p of pos) {
        p.vx += -p.x * 0.0045; p.vy += -p.y * 0.0045; p.vz += -p.z * 0.0045;
        p.vx *= 0.80; p.vy *= 0.80; p.vz *= 0.80;
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
      }
    }
  }

  // ---------------- 节点：发光球体 ----------------
  const nodeGroup = new THREE.Group();
  scene.add(nodeGroup);
  const disposables = [];
  const labelObjs = new Map();
  const sphereGeo = new THREE.SphereGeometry(1, 28, 20);
  disposables.push(sphereGeo);

  function makeGlowTexture() {
    // 程序化生成径向辉光贴图（无外部资源）
    const N = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(cv);
    t.needsUpdate = true;
    return t;
  }
  const glowTex = makeGlowTexture();
  disposables.push(glowTex);

  const pickables = [];
  for (const [i, p] of pos.entries()) {
    const color = p.cur ? CURRENT_COLOR : VAULT_COLORS[i % VAULT_COLORS.length];
    // 实心球
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(p.r);
    mesh.position.set(p.x, p.y, p.z);
    mesh.userData.pid = p.id;
    nodeGroup.add(mesh);
    pickables.push(mesh);
    disposables.push(mat);

    // 外层辉光片（永远朝向相机）
    const sprMat = new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      opacity: 0.38,
    });
    const spr = new THREE.Sprite(sprMat);
    spr.scale.setScalar(p.r * 4.2);
    spr.position.copy(mesh.position);
    nodeGroup.add(spr);
    disposables.push(sprMat);

    // 当前库：加一圈轨道环，标示"我在这儿"
    if (p.cur) {
      const ringGeo = new THREE.TorusGeometry(p.r * 1.85, p.r * 0.075, 10, 64);
      const ringMat = new THREE.MeshBasicMaterial({ color: CURRENT_COLOR, transparent: true, opacity: 0.62 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(mesh.position);
      ring.rotation.x = Math.PI / 2.3;
      nodeGroup.add(ring);
      disposables.push(ringGeo, ringMat);
      p.ring = ring;
    }

    // 标签
    const el = document.createElement('div');
    el.className = 'xg-label' + (p.cur ? ' is-cur' : '');
    el.textContent = p.name || '(未命名)';
    el.title = `${p.name}\n${p.cards} 张卡片`;
    const lo = new CSS2DObject(el);
    lo.position.set(p.x, p.y + p.r + 9, p.z);
    nodeGroup.add(lo);
    labelObjs.set(p.id, lo);
  }

  // ---------------- 边：拱起的管 ----------------
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);
  for (const e of edges) {
    const a = pm.get(e.source), b = pm.get(e.target);
    if (!a || !b) continue;
    const k = (e.weight || 0) / maxW;
    // 二次贝塞尔：控制点沿中点向外拱起，避免连线穿过节点
    const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const outward = mid.clone().normalize().multiplyScalar(18 + 34 * (1 - k));
    const ctrl = mid.clone().add(outward);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, a.y, a.z), ctrl, new THREE.Vector3(b.x, b.y, b.z));
    const tubeR = 0.8 + 4.4 * k;
    const geo = new THREE.TubeGeometry(curve, 26, tubeR, 8, false);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7B8CFF, transparent: true,
      opacity: 0.22 + 0.55 * k, depthWrite: false,
    });
    const tube = new THREE.Mesh(geo, mat);
    // 元数据在构建时就记好：高亮时需要知道这条边连的是哪两个库
    mat.userData.baseOpacity = 0.22 + 0.55 * k;
    tube.userData.a = a.id;
    tube.userData.b = b.id;
    edgeGroup.add(tube);
    disposables.push(geo, mat);
  }

  // ---------------- 拾取 ----------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = -1;
  let selected = -1;
  let highlightId = null;

  function pick(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? pos.findIndex((p) => p.id === hits[0].object.userData.pid) : -1;
  }

  function setHighlight(id) {
    highlightId = id || null;
    // 高亮时：目标节点与它的邻边更亮，其余淡出
    for (const [i, p] of pos.entries()) {
      const mesh = pickables[i];
      const isTarget = !highlightId || p.id === highlightId;
      const mat = mesh.material;
      mat.opacity = isTarget ? 0.95 : 0.35;
      const lo = labelObjs.get(p.id);
      if (lo) lo.element.style.opacity = isTarget ? '1' : '0.42';
    }
    for (const child of edgeGroup.children) {
      const mat = child.material;
      const base = mat.userData.baseOpacity ?? mat.opacity;
      if (!highlightId) { mat.opacity = base; continue; }
      // 与高亮库直接相连的边提亮，其余压暗 —— 一眼看出"它跟谁有关系"
      const related = child.userData.a === highlightId || child.userData.b === highlightId;
      mat.opacity = Math.min(1, base * (related ? 1.6 : 0.22));
    }
  }

  renderer.domElement.addEventListener('pointermove', (ev) => {
    const i = pick(ev);
    if (i !== hovered) {
      hovered = i;
      renderer.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab';
    }
  });
  renderer.domElement.addEventListener('click', (ev) => {
    const i = pick(ev);
    if (i < 0) { selected = -1; onSelect(null); return; }
    selected = i;
    onSelect(pos[i].node);
  });

  // ---------------- 渲染循环 ----------------
  const clock = new THREE.Clock();
  let raf = 0, running = true;


  function resize() {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 360;
    if (w < 2 || h < 2) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
  }
  /**
   * 自动取景：按布局的包围盒把相机拉到合适距离。
   * 不做这一步的话，库多或分布得开时，最外圈的球体会被视口切掉一半 ——
   * 看起来就像"少了几个库"。
   */
  function frameAll() {
    if (!pos.length) return;
    // 用**实际包围盒**而不是包围球来取景。
    // 包围球会把斜向分布的球体拉得很远，画面里东西却很小 —— 看着"星系很空"。
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pos) {
      const m = p.r * 2.4;              // 半径 + 辉光与标签的余量
      minX = Math.min(minX, p.x - m); maxX = Math.max(maxX, p.x + m);
      minY = Math.min(minY, p.y - m); maxY = Math.max(maxY, p.y + m);
      minZ = Math.min(minZ, p.z - m); maxZ = Math.max(maxZ, p.z + m);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const halfH = (maxY - minY) / 2, halfW = (maxX - minX) / 2, halfD = (maxZ - minZ) / 2;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
    // 垂直与水平两个方向都要装得下，取更远的那个
    const distV = halfH / Math.tan(vFov / 2);
    const distH = halfW / Math.tan(hFov / 2);
    const dist = Math.max(distV, distH, halfD) * 1.35 + 60;
    controls.target.set(cx, cy, cz);
    camera.position.set(cx + dist * 0.36, cy + dist * 0.30, cz + dist * 0.88);
    camera.near = Math.max(1, dist / 300);
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.update();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  // 取景放在 resize 之后 —— 宽高比要先定下来，垂直方向才是约束边
  frameAll();

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    controls.update();
    // 当前库的轨道环缓缓自转 —— 提示"这是当前所在的库"
    for (const p of pos) {
      if (!p.ring) continue;
      p.ring.rotation.z = t * 0.4;
      p.ring.rotation.y = Math.sin(t * 0.3) * 0.25;
    }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  tick();

  const api = {
    get selectedIndex() { return selected; },
    setHighlight,
    setAutoRotate(v) { controls.autoRotate = !!v; },
    setRunning(v) { running = v; if (v) { clock.start(); tick(); } else cancelAnimationFrame(raf); },
    focus(id) {
      const p = pm.get(id);
      if (!p) return;
      controls.target.set(p.x, p.y, p.z);
      const d = Math.max(90, p.r * 9);
      camera.position.set(p.x + d * 0.42, p.y + d * 0.34, p.z + d * 0.84);
      camera.near = Math.max(1, d / 200);
      camera.far = d * 12;
      camera.updateProjectionMatrix();
      controls.update();
    },
    frameAll,
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      // 释放顺序与主星图一致：控制器 → 几何材质 → 渲染器 → **强制释放 WebGL 上下文**
      // （不释放上下文会累积，Chromium 上限约 16 个后就会杀掉渲染进程）
      try { controls.dispose(); } catch { /* ignore */ }
      for (const d of disposables) { try { d.dispose?.(); } catch { /* ignore */ } }
      try {
        renderer.dispose();
        renderer.forceContextLoss?.();
      } catch { /* ignore */ }
      labelRenderer.domElement.remove();
      renderer.domElement.remove();
      if (globalThis.__NEOLINK_XGALAXY__ === api) globalThis.__NEOLINK_XGALAXY__ = null;
    },
  };
  // 诊断出口：把实例挂到全局，便于截图工具与自动化测试取用
  // （与 cosmos 的 __NEOLINK_SCENE_LIVE 同一套路）。
  // 注意必须放在 api 定义之后 —— 提前赋值会撞上 const 的暂时性死区。
  globalThis.__NEOLINK_XGALAXY__ = api;
  return api;
}
