'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// ASTRA · 桌面自由漫游运动引擎（v6.11）
// ---------------------------------------------------------------------------
// 纯逻辑、零 Electron 依赖 —— 便于单测、便于复现、便于移植。
// 主进程只负责三件注入：读窗口边界、读多显示器工作区、写窗口坐标。
//
// 运动不是"随机跳点"：目标点 + 临界阻尼弹簧 + 速度上限 + 驻留时长 + 边界约束，
// 因此轨迹是连续、有惯性、有加减速的，看起来像"自己决定去哪儿"。
// 朝向 / 速度 / 行为会回传给 3D 场景，用于步态、倾斜与星尘拖尾。
// ═══════════════════════════════════════════════════════════════════════════

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const MODES = ['auto', 'follow', 'perch', 'drag'];

/**
 * @param {object} deps
 * @param {()=>{x:number,y:number,width:number,height:number}} deps.getBounds 当前窗口边界
 * @param {()=>Array<{x:number,y:number,width:number,height:number}>} deps.getWorkAreas 多显示器工作区
 * @param {()=>{x:number,y:number}} [deps.getCursor] 光标屏幕坐标
 * @param {(x:number,y:number)=>void} deps.setPosition 写窗口坐标
 * @param {()=>number} [deps.now] 毫秒时钟（测试可注入）
 * @param {()=>number} [deps.rng] 0..1 随机源（测试可注入）
 * @param {{x:number,y:number}} [deps.home] 「回到身边」的锚点
 */
function createAstraMotion(deps = {}) {
  const getBounds = deps.getBounds || (() => ({ x: 0, y: 0, width: 280, height: 380 }));
  const getWorkAreas = deps.getWorkAreas || (() => [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  const getCursor = deps.getCursor || (() => null);
  const setPosition = deps.setPosition || (() => {});
  const now = deps.now || (() => Date.now());
  const rng = deps.rng || Math.random;

  const b0 = getBounds();
  const size = { width: b0.width, height: b0.height };
  const pos = { x: b0.x, y: b0.y };
  const vel = { x: 0, y: 0 };
  const home = deps.home ? { ...deps.home } : { x: b0.x, y: b0.y };
  let target = { ...pos };
  let mode = 'auto';
  let behavior = 'perch';
  let hold = false;
  let facing = 1;
  let lastT = now();
  let restUntil = 0;
  let distance = 0;
  let homeLock = false;   // 「回到身边」期间锁定目标，禁止随机漫游把它覆盖
  let lastApplied = { x: Math.round(pos.x), y: Math.round(pos.y) };
  let enabled = true;

  const SPEED_CAP = { wander: 96, glide: 150, seek: 210, perch: 0, follow: 300, drag: 0 };

  /** 把窗口左上角约束进"离它最近的工作区"，多显示器下不会飞出桌面。 */
  function constrain(x, y) {
    const areas = getWorkAreas();
    if (!areas || !areas.length) return { x, y };
    const cx = x + size.width / 2, cy = y + size.height / 2;
    // 优先选择中心点所在的工作区；否则选中心距离最近的那个
    let best = null, bestD = Infinity;
    for (const a of areas) {
      if (cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height) { best = a; bestD = 0; break; }
      const px = clamp(cx, a.x, a.x + a.width), py = clamp(cy, a.y, a.y + a.height);
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestD) { bestD = d; best = a; }
    }
    const a = best || areas[0];
    return {
      x: clamp(x, a.x, Math.max(a.x, a.x + a.width - size.width)),
      y: clamp(y, a.y, Math.max(a.y, a.y + a.height - size.height)),
    };
  }

  function pickTarget() {
    const areas = getWorkAreas();
    const a = areas[Math.floor(rng() * areas.length) % Math.max(1, areas.length)] || areas[0] || { x: 0, y: 0, width: 1280, height: 800 };
    const maxX = Math.max(a.x, a.x + a.width - size.width);
    const maxY = Math.max(a.y, a.y + a.height - size.height);
    if (behavior === 'glide') {
      // 长距离趋行：目标点离当前位置至少半个屏宽
      let t = null;
      for (let i = 0; i < 8; i++) {
        const c = { x: a.x + rng() * (maxX - a.x), y: a.y + rng() * (maxY - a.y) };
        if (dist(c, pos) > Math.min(a.width, 900) * 0.45) { t = c; break; }
        if (!t) t = c;
      }
      return constrain(t.x, t.y);
    }
    // 漫游：在当前位置附近取一个有惯性的短程目标，避免满屏乱飞
    const span = Math.min(a.width, a.height) * 0.30;
    const c = {
      x: pos.x + (rng() - 0.35) * span * (facing || 1),
      y: pos.y + (rng() - 0.5) * span * 0.55,
    };
    return constrain(c.x, c.y);
  }

  function setMode(m) {
    if (!MODES.includes(m)) return mode;
    mode = m;
    if (m !== 'auto') homeLock = false;
    if (m === 'perch' || m === 'drag') { vel.x = 0; vel.y = 0; target = { ...pos }; }
    if (m === 'auto') { restUntil = 0; tick._lastPick = now(); }
    return mode;
  }
  function setBehavior(b) {
    const valid = ['wander', 'glide', 'seek', 'perch'];
    if (!valid.includes(b)) return behavior;
    if (homeLock && b !== 'glide') return behavior;   // 回家途中不接受其它自主意图
    if (b !== behavior) {
      behavior = b; tick._lastPick = now();
      if (b === 'perch') restUntil = now() + 1200 + rng() * 2600;
    }
    return behavior;
  }
  function setHold(v) {
    hold = !!v;
    if (hold) { vel.x = 0; vel.y = 0; }
    return hold;
  }
  function setEnabled(v) { enabled = !!v; if (!enabled) { vel.x = 0; vel.y = 0; } return enabled; }
  function dragTo(x, y) {
    homeLock = false;
    const c = constrain(Number(x) || 0, Number(y) || 0);
    const dx = c.x - pos.x, dy = c.y - pos.y;
    distance += Math.hypot(dx, dy);
    pos.x = c.x; pos.y = c.y;
    vel.x = dx; vel.y = dy;
    if (Math.abs(dx) > 1) facing = dx > 0 ? 1 : -1;
    target = { ...pos };
    apply();
    return state();
  }
  function goHome() {
    const c = constrain(home.x, home.y);
    mode = 'auto'; behavior = 'glide'; target = c; restUntil = 0; hold = false;
    homeLock = true;          // 抵达之前不生成任何随机目标
    tick._lastPick = now();
    return c;
  }
  function refreshBounds() {
    try {
      const b = getBounds();
      size.width = b.width; size.height = b.height;
      pos.x = b.x; pos.y = b.y;
      const c = constrain(pos.x, pos.y);
      pos.x = c.x; pos.y = c.y;
      lastApplied = { x: Math.round(pos.x), y: Math.round(pos.y) };
    } catch (e) { /* 窗口正在销毁：保持上一帧，下次 tick 自恢复 */ }
  }
  function apply() {
    // 只在整数像素变化时写窗口，避免每帧 Windows API 调用（60fps 下可省 80% 以上）
    const ix = Math.round(pos.x), iy = Math.round(pos.y);
    if (ix === lastApplied.x && iy === lastApplied.y) return;
    lastApplied = { x: ix, y: iy };
    try { setPosition(ix, iy); } catch (e) { /* 窗口销毁：静默，主进程会停表 */ }
  }

  /** 主进程每帧调用（建议 30～40ms）。dt 由内部时钟算，钳住防止切后台后暴冲。 */
  function tick() {
    const t = now();
    const dt = clamp((t - lastT) / 1000, 0, 0.06);
    lastT = t;
    if (!enabled || hold) { vel.x *= 0.82; vel.y *= 0.82; return state(); }

    const cursor = getCursor();
    if (mode === 'drag') return state();

    if (mode === 'follow' && cursor) {
      target = constrain(cursor.x - size.width / 2 + 46, cursor.y - size.height / 2 + 30);
    } else if (mode === 'perch') {
      target = { ...pos };
    } else if (mode === 'auto') {
      if (homeLock) {
        target = constrain(home.x, home.y);
        if (dist(pos, target) < 14) {
          homeLock = false;
          setBehavior('perch');           // 到家后短暂驻留，再由自主体决定是否继续漫游
          restUntil = t + 2200;
          target = { ...pos };
        }
      } else if (behavior === 'seek' && cursor) {
        target = constrain(cursor.x - size.width / 2 + (rng() - 0.5) * 90, cursor.y - size.height / 2 + 60);
      } else if (behavior === 'perch') {
        if (t > restUntil) { setBehavior('wander'); }
        target = { ...pos };
      } else {
        const arrived = dist(pos, target) < 18;
        const stale = t - (tick._lastPick || 0) > (behavior === 'glide' ? 9000 : 4200);
        if (!tick._lastPick || arrived || stale) {
          target = pickTarget();
          tick._lastPick = t;
          // 每到达一个点，按概率短暂驻留 —— 呼吸感来自停顿，不是匀速平移
          if (rng() < 0.34) restUntil = t + 700 + rng() * 1800;
        }
        if (t < restUntil) target = { ...pos };
      }
    }

    // 临界阻尼弹簧：k 决定趋近速度，c 决定阻尼（略欠阻尼，收尾有一点自然回弹）
    const cap = SPEED_CAP[mode === 'follow' ? 'follow' : (mode === 'auto' ? behavior : 'perch')] || 90;
    if (cap > 0) {
      const k = mode === 'follow' ? 13 : 7.2;
      const c = mode === 'follow' ? 5.4 : 3.6;
      vel.x += ((target.x - pos.x) * k - vel.x * c) * dt;
      vel.y += ((target.y - pos.y) * k - vel.y * c) * dt;
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > cap) { const f = cap / sp; vel.x *= f; vel.y *= f; }
    } else { vel.x *= 0.80; vel.y *= 0.80; }

    const dx = vel.x * dt, dy = vel.y * dt;
    const before = { x: pos.x, y: pos.y };
    pos.x += dx; pos.y += dy;
    const cc = constrain(pos.x, pos.y);
    if (cc.x !== pos.x) { pos.x = cc.x; vel.x = 0; }
    if (cc.y !== pos.y) { pos.y = cc.y; vel.y = 0; }
    distance += Math.hypot(pos.x - before.x, pos.y - before.y);
    if (Math.abs(vel.x) > 12) facing = vel.x > 0 ? 1 : -1;
    apply();
    return state();
  }
  tick._lastPick = 0;

  function state() {
    const speed = Math.hypot(vel.x, vel.y);
    return {
      x: Math.round(pos.x), y: Math.round(pos.y),
      width: size.width, height: size.height,
      facing, speed: Math.round(speed), moving: speed > 6,
      mode, behavior, hold, enabled, distance: Math.round(distance),
      target: { x: Math.round(target.x), y: Math.round(target.y) },
    };
  }

  return { tick, state, setMode, setBehavior, setHold, setEnabled, dragTo, goHome, refreshBounds, constrain, MODES };
}

module.exports = { createAstraMotion, MODES };
