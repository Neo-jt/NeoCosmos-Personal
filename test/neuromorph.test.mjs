// 类脑计算引擎契约测试：SNN / 吸引子联想记忆 / HTM 序列记忆 / 预测编码
// ---------------------------------------------------------------------------
// 真跑引擎，验证四类算法各自真实生效、确定性可复现、状态自洽；不宣称覆盖 GUI。
import { createNeuromorph, topKRegions } from '../src/cognition/neuromorph.js';
import { REGION_KEYS } from '../src/cognition/connectome-activation.js';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}
const round = (x) => Math.round(x * 1e4) / 1e4;

const eng = createNeuromorph();

// ── 0) 引擎就绪 ─────────────────────────────────────────────────────────────
console.log('\n[0] 引擎结构');
const sc = eng.selfCheck();
ok('selfCheck ok', sc.ok, JSON.stringify(sc));
const st0 = eng.status();
ok('神经元=30', st0.neurons === 30);
ok('突触=183', st0.synapses === 183, `(${st0.synapses})`);
ok('内置模式≥7', st0.patterns >= 7, `(${st0.patterns})`);

// ── 1) 脉冲神经网络 SNN：真实放电 + 沿连接组脉冲 ───────────────────────────
console.log('\n[1] SNN 脉冲沿真实连接组扩散');
const seed = { contract: 0.9, drafting: 0.9, evidence: 0.8, pfc: 0.7, workspace: 0.6 };
const cyc = eng.runCycle(seed, { steps: 160 });
ok('SNN 产出 region levels', cyc.levels && typeof cyc.levels === 'object');
const fired = Object.values(cyc.levels).filter((v) => v > 0.02).length;
ok('SNN 点亮多个脑区（放电扩散）', fired > 1, `fired=${fired}`);
ok('SNN 产出脉冲（沿轴突）', cyc.pulses.length > 0, `pulses=${cyc.pulses.length}`);
ok('脉冲端点均为真实脑区', cyc.pulses.every((p) => REGION_KEYS.includes(p.from) && REGION_KEYS.includes(p.to)));
ok('脉冲携带真实潜伏期', cyc.pulses.every((p) => Number(p.latency_ms) >= 1));
ok('脉冲含兴奋/抑制类型', cyc.pulses.some((p) => p.type === 'excitatory') && cyc.pulses.some((p) => p.type === 'inhibitory'));
// 确定性：同输入同结果
const cyc2 = eng.runCycle(seed, { steps: 160 });
const sameLevels = REGION_KEYS.every((k) => cyc.levels[k] === cyc2.levels[k]);
const samePulses = cyc.pulses.length === cyc2.pulses.length && cyc.pulses.every((p, i) => p.from === cyc2.pulses[i].from && p.to === cyc2.pulses[i].to && p.delayMs === cyc2.pulses[i].delayMs);
ok('SNN 确定性可复现（levels+pulses 一致）', sameLevels && samePulses);

// ── 2) Hopfield 吸引子联想记忆：残缺线索补全 ───────────────────────────────
console.log('\n[2] 吸引子联想记忆（pattern completion，带线索钳位）');
// 「合同」概念仅给 2 个专属脑区作为残缺线索，验证 cued recall 无歧义补全
const cue = { contract: 0.9, drafting: 0.9 };
const rec = eng.recall(cue, { iters: 50 });
ok('吸引子迭代收敛', rec.converged, `iters=${rec.iterations}`);
ok('残缺线索补全到【合同】', rec.label === '合同', `(label=${rec.label}, overlap=${rec.overlap})`);
ok('补全重叠度较高', rec.overlap > 0.4, `(${rec.overlap})`);
ok('置信候选返回 ≥4 项', rec.candidates.length >= 4, `(${rec.candidates.length})`);
ok('首位候选即【合同】', rec.candidates[0].label === '合同');
// 确定性：同线索同结果
const rec2 = eng.recall(cue, { iters: 50 });
ok('吸引子确定性可复现', rec2.label === rec.label && rec2.overlap === rec.overlap);

// ── 3) HTM 序列记忆：转移预测 ──────────────────────────────────────────────
console.log('\n[3] HTM 序列记忆（下一步预测）');
const engS = createNeuromorph();
const A = { contract: 0.9, drafting: 0.9, evidence: 0.8, pfc: 0.7 };
const B = { tort: 0.9, limbic: 0.8, sensory: 0.8, ofc: 0.7, tpj: 0.7 };
const C = { ip: 0.9, atl: 0.8, lexmind: 0.8, wernicke: 0.7 };
engS.absorb(A, 'A'); engS.absorb(B, 'B'); engS.absorb(C, 'C');
const sdrA = topKRegions(A), sdrB = topKRegions(B);
const pred = engS.predict({ sdr: sdrA });
ok('序列记忆命中转移 A→B', pred.source === 'sequence' && pred.confidence > 0, `(conf=${pred.confidence})`);
ok('预测下一步含 B 的脑区', Object.keys(pred.next).length > 0 && Object.keys(pred.next).some((k) => B[k] !== undefined));
const stS = engS.status();
ok('序列记忆状态真实（hits/total 可累计）', typeof stS.sequenceTotal === 'number' && stS.sequenceTotal >= 1, `(total=${stS.sequenceTotal})`);

// ── 4) 预测编码：自由能 + 线性前向模型兜底 ─────────────────────────────────
console.log('\n[4] 预测编码（自由能 / 兜底预测）');
const engP = createNeuromorph();
// 单次吸收（无序列转移）→ predict 应回退到预测编码线性模型
engP.absorb({ contract: 0.9, drafting: 0.9, evidence: 0.8, pfc: 0.7, workspace: 0.6 }, 'X');
const predP = engP.predict();   // 无转移时回退预测编码
ok('预测编码兜底预测存在', predP.source === 'predictor' && typeof predP.next === 'object', `(${predP.source})`);
const stP = engP.status();
ok('预测编码自由能有限', Number.isFinite(stP.predictorFreeEnergy), `(${stP.predictorFreeEnergy})`);
// 再学习一段轨迹，自由能应在学习后有限且不溢出
for (let i = 0; i < 12; i++) {
  const lv = {};
  const rk = ['contract', 'drafting', 'evidence', 'strategy', 'finance', 'pfc'];
  lv[rk[i % rk.length]] = 0.9;
  lv[rk[(i + 1) % rk.length]] = 0.7;
  engP.absorb(lv, 'seq' + i);
}
const stP2 = engP.status();
ok('自由能随学习保持有限（≤1）', Number.isFinite(stP2.predictorFreeEnergy) && stP2.predictorFreeEnergy <= 1, `(${stP2.predictorFreeEnergy})`);

// ── 5) 快照 / 恢复 ─────────────────────────────────────────────────────────
console.log('\n[5] 快照与恢复');
const snap = eng.snapshot();
const engR = createNeuromorph();
const okRestore = engR.restore(snap);
ok('restore 成功', okRestore);
ok('恢复后模式数一致', engR.status().patterns === eng.status().patterns);
const recR = engR.recall(cue, { iters: 50 });
ok('恢复后吸引子行为一致', recR.label === rec.label && recR.overlap === rec.overlap);

// ── 6) 状态字段真实（无虚构填充） ───────────────────────────────────────────
console.log('\n[6] 状态自洽');
const st = eng.status();
ok('status 含四类真实指标', ['neurons', 'synapses', 'patterns', 'sequenceAccuracy', 'predictorFreeEnergy', 'lastSpikeRate', 'firedRegions'].every((k) => k in st));
ok('边界声明诚实标注非物理芯片/非量子/无意识', /非物理神经形态芯片/.test(st.boundary) && /非量子计算/.test(st.boundary) && /无意识/.test(st.boundary));

console.log(`\n类脑计算引擎契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
