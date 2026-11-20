// 量子认知引擎 · 契约测试（Node 直接跑，无需 Electron）
// 验证：归一化保真 / 纠缠演进不破坏 Born 归一 / 测量概率和为 1 /
//       确定性（同文本同结果）/ idleDrift 不坍缩 / 通道概率和为 1。
import { createQuantumMind, QUANTUM_BOUNDARY, CHANNELS } from '../src/cognition/quantum-mind.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}
const sum = (a) => a.reduce((s, x) => s + x, 0);
const near = (x, y, eps = 1e-6) => Math.abs(x - y) < eps;

const Q = createQuantumMind();

// 1) 准备 → 归一化
const items = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, text: `概念${i}`, channel: i % 5 }));
let tr = Q.prepare('测试问题：商业秘密的保密措施如何认定', items);
ok(near(Q.normValue(), 1, 1e-9), '准备后 Σ|αᵢ|² = 1（Born 归一，真实态）');
ok(near(sum(tr.channels.map((c) => c.prob)), 1, 5e-4), '五通道概率和≈1（四舍五入）');
ok(tr.channels.length === 5, '存在五条色系通道');

// 2) 纠缠 + 演进 → 仍归一化
tr = Q.entangle(6);
tr = Q.evolve(8);
ok(near(Q.normValue(), 1, 1e-9), '纠缠+演进后 Born 归一仍成立（真实态）');
ok(near(sum(tr.channels.map((c) => c.prob)), 1, 5e-4), '纠缠+演进后五通道概率和仍≈1');
ok(tr.entropy.bits >= 0, '熵非负');
ok(tr.peakProb > 0 && tr.peakProb <= 1, '峰值概率在 (0,1]');

// 3) 测量 → 概率分布和为 1、坍缩点有效
const m = Q.measure();
ok(near(sum(m.probabilities), 1, 1e-9), '测量概率分布和为 1');
ok(m.index >= 0 && m.index < m.probabilities.length, '坍缩索引有效');
ok(m.top.length === 3, '返回 top3');
ok(m.entropy.bits >= 0, '测量熵有效');

// 4) 确定性：同文本 → 同峰值（可复现）
const A = createQuantumMind(); A.prepare('重复问题', items); A.entangle(6); A.evolve(8);
const B = createQuantumMind(); B.prepare('重复问题', items); B.entangle(6); B.evolve(8);
ok(A.trace().peakLabel === B.trace().peakLabel, '同一问题演化后峰值潜态可复现（确定性）');
const mA = A.measure(), mB = B.measure();
ok(mA.index === mB.index, '同一问题测量结果可复现（确定性采样）');

// 5) 自主漂移：不坍缩（collapsedIndex 为 null）
const d = Q.idleDrift();
ok(d.collapsedIndex === null, 'idleDrift 不坍缩（保留叠加态）');
ok(near(Q.normValue(), 1, 1e-9), 'idleDrift 后仍 Born 归一（真实态）');

// 6) 无知识库漫游：合成基也能思考
const Q2 = createQuantumMind();
const g = Q2.think('', null);
ok(g.basisCount === 8, '无知识库时合成 8 个漫游潜态');
ok(near(sum(g.channels.map((c) => c.prob)), 1, 5e-4), '漫游态五通道概率和≈1');

// 7) 边界标注存在且诚实
ok(typeof QUANTUM_BOUNDARY === 'string' && QUANTUM_BOUNDARY.includes('非真实量子计算'), '边界声明诚实标注「非真实量子计算」');
ok(CHANNELS.length === 5, '五脑议会通道齐备');

console.log(`\n量子引擎测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
