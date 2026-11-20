// 认知内核统一出口（引擎层与桌面壳共用）
// 数据常量来自 anatomy.js（本项目自研认知规格 真源编译），算法为本仓库深加工重写。
export { SOURCE, ANATOMY, CONNECTOME, COGNITION, COUNCIL, ADJUDICATION } from './anatomy.js';

export { deliberate, featuresFromEvidence, councilReport, FEAT_KEYS, DISSENT_EPS, ACTIONS, BRAINS } from './council.js';

export {
  gradeOfHit, calibratedConfidence, calibrate, confidenceBand,
  metacogReport, debateScore, GRADE_WEIGHT_DEFAULT, CONF_WEIGHT, METACOG_CHECKS,
} from './calibration.js';

export {
  PHASES, ORGANS, ORGAN_REGION, PHASE_REGIONS, regionsForPhase,
  runWorkflow, runWorkflowSync, makeStep, validateTrace, traceTimeline,
  selfCheck as workflowSelfCheck,
} from './workflow.js';

export {
  spreadActivation, stageActivation, idleWander,
  REGION_KEYS, REGION_META, SYNAPSES,
  selfCheck as connectomeSelfCheck,
} from './connectome-activation.js';

export {
  frameIssues, proofStandard, assignBurden, assessOnus, splitTracks,
  discretionFor, buildDebate, buildHypotheses, metacogAnswers,
  composeAnswer, BOUNDARY_TEXT,
} from './legal-mind.js';

export { createOrganism, ORGANISM_BOUNDARY } from './organism.js';

export {
  createQuantumMind, QUANTUM_BOUNDARY, CHANNELS,
} from './quantum-mind.js';

// v6.6.0：量子算法正式接入 3D 智脑（脑区为基 / 连接组为纠缠图 / Born 坍缩回灌激活）
export {
  createQuantumCognition, QUANTUM_COGNITION_BOUNDARY,
} from './quantum-cognition.js';

// v6.8.0：类脑计算引擎（SNN + Hopfield 吸引子联想 + HTM 序列记忆 + 预测编码）
export {
  createNeuromorph, NEUROMORPH_BOUNDARY,
} from './neuromorph.js';

import { selfCheck as workflowSelfCheck } from './workflow.js';
import { selfCheck as connectomeSelfCheck } from './connectome-activation.js';
import { SOURCE } from './anatomy.js';

/** 内核总自检：结构闭合 + 真源统计守恒。 */
export function selfCheck() {
  const w = workflowSelfCheck();
  const c = connectomeSelfCheck();
  const s = SOURCE.stats;
  const checks = {
    workflow: w.ok, connectome: c.ok,
    regions: s.regions === 30, synapses: s.synapses >= 180,
    phases: s.phases === 8, brains: s.brains === 5,
  };
  return {
    ok: Object.values(checks).every(Boolean), checks,
    workflow: w, connectome: c,
    source: { root: SOURCE.root, generatedAt: SOURCE.generatedAt, stats: s },
  };
}
