// 企业 3D 智脑渲染层（v6.3.0）
// ---------------------------------------------------------------------------
// 坐标、脑叶、183 条轴突全部来自 本项目自研认知规格 解剖真源（anatomy.js 同源编译），
// 不是随手画的球壳：额极/枕极、左右半球、小脑后下、Brodmann 分区依据都可点开查。
//
// 「活」的部分是**真实数据驱动**：思维链八阶段产生的脑区激活值 → 沿连接组按
// 真实 latency_ms 时序扩散的脉冲 → 这里按同样时序播放。没有一段动画是凭空循环。
//
// 边界：THREE 场景是可视化，不是生物组织、不产生意识；坐标投影为示意比例。
import * as THREE from 'three';

const LOBE_FALLBACK = '#7be0ff';
const MAX_PULSES = 160;

export function createBrain3D({ host, anatomy, connectome, onRegion } = {}) {
  const regions = anatomy.regions || [];
  const organs = anatomy.organs || [];
  const lobes = anatomy.lobes || [];
  const synapses = connectome.synapses || [];
  const meta = connectome.regionMeta || {};
  const K = (anatomy.scale || 7) * 1.45;   // 归一化坐标 → 场景单位
  const lobeColor = Object.fromEntries(lobes.map((l) => [l.key, l.color]));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  camera.position.set(0, 2.2, 27);
  camera.lookAt(0, 0, 0);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    return { unavailable: true, error: String(e?.message || e), dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'brain3d-canvas';
  host.appendChild(renderer.domElement);

  const root = new THREE.Group();
  scene.add(root);
  const disposables = [];
  const reg = (x) => { disposables.push(x); return x; };

  // ---- 半透明颅脑外廓（位置示意，仅用于建立空间感；真实坐标在脑区节点上） ----
  const shellGeo = reg(new THREE.SphereGeometry(1, 36, 26));
  const shellMat = reg(new THREE.MeshBasicMaterial({
    color: 0x6fe9ff, wireframe: true, transparent: true, opacity: 0.055, depthWrite: false,
  }));
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.set(8.9, 7.6, 9.8);
  root.add(shell);

  // ---- 183 条长程轴突（真实连接组） ----
  const positions = new Float32Array(synapses.length * 6);
  const colors = new Float32Array(synapses.length * 6);
  const baseColors = [];
  const posOf = new Map();
  for (const r of regions) posOf.set(r.key, new THREE.Vector3(r.pos[0] * K, r.pos[1] * K, r.pos[2] * K));

  synapses.forEach((e, i) => {
    const a = posOf.get(e.from) || new THREE.Vector3();
    const b = posOf.get(e.to) || new THREE.Vector3();
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    const c = new THREE.Color(e.type === 'inhibitory' ? 0x5aa9ff : 0xff9a4d);
    const dim = 0.13;
    baseColors.push(c);
    for (let k = 0; k < 2; k++) colors.set([c.r * dim, c.g * dim, c.b * dim], i * 6 + k * 3);
  });
  const tractGeo = reg(new THREE.BufferGeometry());
  tractGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  tractGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const tractMat = reg(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false }));
  root.add(new THREE.LineSegments(tractGeo, tractMat));
  const glow = new Float32Array(synapses.length);

  // ---- 30 个真实解剖脑区 ----
  const regionMap = new Map();
  const sphereGeo = reg(new THREE.SphereGeometry(0.36, 18, 14));
  for (const r of regions) {
    const color = new THREE.Color((meta[r.key] && meta[r.key].color) || lobeColor[r.lobe] || LOBE_FALLBACK);
    const mat = reg(new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.18,
      transparent: true, opacity: 0.86, roughness: 0.42, metalness: 0.12,
    }));
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.copy(posOf.get(r.key));
    mesh.userData.key = r.key;
    root.add(mesh);
    regionMap.set(r.key, { mesh, mat, color, level: 0, info: r });
  }

  // ---- 6 枚认知器官（八面体，与解剖脑区区分） ----
  const organGeo = reg(new THREE.OctahedronGeometry(0.52, 0));
  for (const o of organs) {
    const color = new THREE.Color(0xffffff);
    const mat = reg(new THREE.MeshStandardMaterial({
      color, emissive: 0xff7bd5, emissiveIntensity: 0.3,
      transparent: true, opacity: 0.9, wireframe: true,
    }));
    const mesh = new THREE.Mesh(organGeo, mat);
    mesh.position.set(o.pos[0] * K, o.pos[1] * K, o.pos[2] * K);
    mesh.userData.organ = o.name;
    root.add(mesh);
  }

  // ---- 灯光 ----
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const key = new THREE.PointLight(0xffffff, 90, 120);
  key.position.set(12, 16, 22);
  scene.add(key);

  // ---- 脉冲粒子（按真实 latency_ms 时序播放） ----
  const pPos = new Float32Array(MAX_PULSES * 3);
  const pCol = new Float32Array(MAX_PULSES * 3);
  const pGeo = reg(new THREE.BufferGeometry());
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = reg(new THREE.PointsMaterial({ size: 0.62, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  const points = new THREE.Points(pGeo, pMat);
  root.add(points);
  let active = [];
  let playStart = 0;

  function playPulses(pulses = [], levels = {}) {
    setActivation(levels);
    const picked = [...pulses]
      .filter((p) => posOf.has(p.from) && posOf.has(p.to))
      .sort((a, b) => b.level - a.level)
      .slice(0, MAX_PULSES);
    active = picked.map((p) => ({
      from: posOf.get(p.from), to: posOf.get(p.to),
      start: Number(p.delayMs) || 0,
      dur: Math.max(120, (Number(p.latency_ms) || 8) * 14),
      sign: p.sign,
      idx: Math.max(0, synapses.findIndex((e) => e.from === p.from && e.to === p.to)),
    }));
    playStart = performance.now();
    for (let i = 0; i < active.length; i++) pCol.set(i % 2 ? [0.42, 0.85, 1] : [1, 0.72, 0.4], i * 3);
    pGeo.attributes.color.needsUpdate = true;
    return { played: active.length, total: pulses.length, spanMs: Math.max(...picked.map((p) => p.delayMs || 0), 0) };
  }

  function setActivation(levels = {}) {
    for (const [k, rec] of regionMap) {
      const v = Math.max(0, Math.min(1, Number(levels[k]) || 0));
      rec.level = v;
      rec.mat.emissiveIntensity = 0.18 + v * 2.1;
      const s = 1 + v * 0.85;
      rec.mesh.scale.setScalar(s);
    }
  }

  // ---- 交互：点击脑区回传真实解剖信息 ----
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  function onClick(ev) {
    if (!onRegion) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects([...regionMap.values()].map((r) => r.mesh), false)[0];
    if (hit?.object?.userData?.key) {
      const rec = regionMap.get(hit.object.userData.key);
      onRegion({ key: rec.info.key, name: meta[rec.info.key]?.name || rec.info.key, lobe: rec.info.lobe, hemi: rec.info.hemi, basis: rec.info.basis, level: rec.level });
    }
  }
  renderer.domElement.addEventListener('click', onClick);

  let autoRotate = true, running = true, raf = 0;
  function resize() {
    const w = Math.max(1, host.clientWidth || 800), h = Math.max(1, host.clientHeight || 520);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (autoRotate) root.rotation.y += 0.0016;
    const now = performance.now() - playStart;
    for (let i = 0; i < MAX_PULSES; i++) {
      const a = active[i];
      if (!a) { pPos[i * 3 + 1] = 1e6; continue; }
      const t = (now - a.start) / a.dur;
      if (t < 0 || t > 1) { pPos[i * 3 + 1] = 1e6; continue; }
      pPos[i * 3] = a.from.x + (a.to.x - a.from.x) * t;
      pPos[i * 3 + 1] = a.from.y + (a.to.y - a.from.y) * t;
      pPos[i * 3 + 2] = a.from.z + (a.to.z - a.from.z) * t;
      if (a.idx >= 0) glow[a.idx] = Math.max(glow[a.idx], 1 - t);
    }
    pGeo.attributes.position.needsUpdate = true;
    // 轴突高亮随时间衰减（真实脉冲经过才亮，不做常亮装饰）
    let dirty = false;
    for (let i = 0; i < synapses.length; i++) {
      if (glow[i] <= 0.001) continue;
      glow[i] *= 0.94; dirty = true;
      const c = baseColors[i], g = 0.13 + glow[i] * 1.5;
      colors.set([c.r * g, c.g * g, c.b * g], i * 6);
      colors.set([c.r * g, c.g * g, c.b * g], i * 6 + 3);
    }
    if (dirty) tractGeo.attributes.color.needsUpdate = true;
    renderer.render(scene, camera);
  }
  frame();

  return {
    unavailable: false,
    setActivation, playPulses,
    setAutoRotate(v) { autoRotate = !!v; },
    resetView() { root.rotation.set(0, 0, 0); camera.position.set(0, 2.2, 27); camera.lookAt(0, 0, 0); },
    stats: { regions: regions.length, organs: organs.length, synapses: synapses.length, lobes: lobes.length, scale: K },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      for (const d of disposables) { try { d.dispose?.(); } catch (e) { /* ignore */ } }
      try { renderer.dispose(); renderer.forceContextLoss?.(); } catch (e) { /* ignore */ }
      try { renderer.domElement.remove(); } catch (e) { /* ignore */ }
    },
  };
}
