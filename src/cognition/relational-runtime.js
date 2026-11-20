// RAM 运行时桥接（v6.30.0）—— 把「真实训练出的关联模型」安全接入推荐打分。
// ---------------------------------------------------------------------------
// 诚实纪律：
//   · 模型权重只能来自 tools/train-relational-model.mjs 的真实训练产物；
//   · 加载时校验 modelHash（对权重+样本哈希重算），任何不符 => 不启用模型，
//     如实降级为人工权重，modelActive=false，绝不假装模型在跑；
//   · 模型只做「信号强度的连续微调」，不改变「无真实证据即不推荐」的硬规则。
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { FEATURES, score as modelScore } from './relational-model.js';

const EXPECTED_SCHEMA = 'neocosmos.ram/1';
let cached = null; // { ok:boolean, weights, meta }

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * 加载并校验模型。loadText 为读取 model json 文本的函数（Node 用 fs，渲染用 IPC 注入）。
 * @returns {{active:boolean, reason:string, meta:object|null, weights:object|null}}
 */
export function loadModel(readText) {
  if (cached) return cached;
  try {
    const txt = readText();
    const m = JSON.parse(txt);
    if (m.schema !== EXPECTED_SCHEMA) return (cached = fail('schema 不匹配'));
    if (!m.weights || !Array.isArray(m.weights.w) || m.weights.w.length !== FEATURES.length) {
      return (cached = fail('权重维度不符'));
    }
    // 真实性校验：对 权重 + sampleHash 重算 modelHash（与训练脚本同规则）
    const recalc = hash(JSON.stringify({ w: m.weights.w, b: m.weights.b,
      sampleHash: m.provenance?.sampleHash }));
    if (recalc !== m.provenance?.modelHash) return (cached = fail('modelHash 校验失败（权重被改动或非训练产物）'));
    // 闸门复核：训练时记录的指标必须真实达标，否则不采信
    const ev = m.evaluation || {};
    if (!(ev.aucRam > ev.aucUniform + 0.02 && m.train?.lossLast < m.train?.lossFirst * 0.6)) {
      return (cached = fail('训练产物真实性闸门未达标'));
    }
    cached = { active: true, reason: '真实训练产物，哈希与闸门校验通过',
      meta: m, weights: m.weights };
  } catch (e) {
    cached = fail('加载/解析失败：' + (e?.message || String(e)));
  }
  return cached;
}
function fail(reason) {
  return { active: false, reason, meta: null, weights: null };
}

/**
 * 把 6 维真实特征喂给模型，得到 [0,1] 关联概率。仅当模型 active 时才有意义。
 * 特征顺序必须与 FEATURES 完全一致（由调用方按同样规则提取）。
 */
export function infer(loaded, features) {
  if (!loaded.active || !loaded.weights) return null;
  return modelScore(loaded.weights, features);
}

/** 仅供测试/诊断：重置缓存 */
export function _reset() { cached = null; }
