// 契约测试：量子引擎 trace ↔ 精灵 3D 场景（sprite3d.setQuantum）的数据契约
// ---------------------------------------------------------------------------
// 这条测试把两个模块的「隐式约定」钉成可执行断言：
//   sprite3d.setQuantum(trace) 只读取三个字段 ——
//     trace.channels[i].prob     （五色光带强度）
//     trace.entropy.normalized   （光晕扩散/亮度系数）
//     trace.peakIndex            （峰值光带索引）
// 一旦引擎的 trace 形状漂移，这里立刻红，而不是等用户装好客户端才发现精灵是「死」的。
import { createQuantumMind } from '../src/cognition/quantum-mind.js';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}
const near = (a, b, t) => Math.abs(a - b) <= t;

const Q = createQuantumMind();

// 1) 有知识库形态：basis 由卡片组成（这里手造几条，覆盖五通道）
const basis = [
  { id: 'n0', text: '支持论证', channel: 0 },
  { id: 'n1', text: '质疑反驳', channel: 1 },
  { id: 'n2', text: '规范检索', channel: 2 },
  { id: 'n3', text: '实务推演', channel: 3 },
  { id: 'n4', text: '裁判裁量', channel: 4 },
  { id: 'n5', text: '对照情形', channel: 2 },
];
const tr = Q.think('合同违约金怎么算', basis);

ok('trace 含五条色系通道', tr.channels.length === 5, `(${tr.channels.length})`);
ok('每条通道带 prob 字段', tr.channels.every((c) => typeof c.prob === 'number' && c.prob >= 0));
ok('通道概率总和≈1（setQuantum 直接消费）', near(tr.channels.reduce((s, c) => s + c.prob, 0), 1, 5e-4));
ok('entropy.normalized ∈ [0,1]（光晕扩散系数）',
  tr.entropy && tr.entropy.normalized >= 0 && tr.entropy.normalized <= 1, `(${tr.entropy?.normalized})`);
ok('peakIndex 有效（峰值光带）',
  Number.isInteger(tr.peakIndex) && tr.peakIndex >= 0 && tr.peakIndex < tr.basisCount, `(${tr.peakIndex})`);
ok('amplitudes 长度 = basisCount', Array.isArray(tr.amplitudes) && tr.amplitudes.length === tr.basisCount);
ok('boundary 附在 trace（诚实标注「非真实量子计算」）',
  typeof tr.boundary === 'string' && tr.boundary.includes('非真实量子计算'));

// 2) 无知识库形态：合成 8 漫游态，精灵仍可「量子漫游」
const tr2 = Q.think('随便聊聊', null);
ok('无知识库时合成漫游态（≥2）', tr2.basisCount >= 2, `(${tr2.basisCount})`);
ok('漫游态同样满足 setQuantum 契约',
  Array.isArray(tr2.channels) && tr2.channels.length === 5 && typeof tr2.entropy.normalized === 'number');

// 3) 自主思考动画：idleDrift 不坍缩，但产出同种 trace
const d = Q.idleDrift();
ok('idleDrift 产出可被 setQuantum 消费的 trace',
  !!d && Array.isArray(d.channels) && d.channels.length === 5 && typeof d.entropy.normalized === 'number');
ok('idleDrift 不报告坍缩（保留叠加态）', d.collapsedIndex === null);

console.log(`\n精灵 3D 契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
