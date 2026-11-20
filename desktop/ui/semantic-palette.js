// NeoCosmos v6.27.0 · 语义配色单一真源
// ---------------------------------------------------------------------------
// 解决 v6.24.0 全页面审查遗留的 H3（DOM 语义色硬编码 / 配色多真源）：
//   · relations.js / atlas.js / graph.js / map2d.js 曾各自定义一份**逐字相同**的
//     突触类型配色表（8 个键），mind3d.js 另有一份神经元调色板，且文件内
//     NET_ROW_COLORS 又把同一份数组抄了一遍 —— 改一处就会四处漂移；
//   · 各视图 DOM 上还散落着固定装饰色的硬编码 hex，主题与语义都无从统一。
//
// 纪律与如实边界：
//   · canvas / SVG 的绘图 API 只接受具体色值，不接受 CSS 变量。因此 JS 侧
//     保留一份具体色值作为唯一真源（CSS_SEM_HEX / CANVAS_HEX），由本模块导出；
//     这不是"没令牌化"，而是绘图 API 的客观限制，契约测试会逐项比对。
//   · design-system.css 的 --sem-* 令牌与 CSS_SEM_HEX **逐项等值**，由
//     test/v627-semantic-unity.test.mjs 精确比对，防止两边漂移。
//   · DOM 侧一律使用 SEM.*（值为 var(--sem-*)），视图文件里不再写死任何 hex。
//   · 用户为知识库设定的 vault_color 是真实数据，永远优先；本模块只提供回退色。
//   · 数据系列色在浅 / 深主题下沿用同一套值（与改动前完全一致），不冒充
//     做了主题自适应；本轮收敛的是"真源数量"与"DOM 硬编码"，不是重新配色。
//   · 纯数据模块：零依赖、零 DOM 顶层调用，可在 Node 中直接 import 做单测。
// ---------------------------------------------------------------------------

/** 与 design-system.css 的 --sem-* 令牌逐项等值的具体色值（DOM 与 canvas 共用真源）。 */
export const CSS_SEM_HEX = Object.freeze({
  '--sem-explicit-link':   '#8B7BFF',
  '--sem-hierarchical':    '#5FA8FF',
  '--sem-co-occurrence':   '#3FE0C8',
  '--sem-semantic-similar': '#C77DFF',
  '--sem-causal':          '#FF6B8A',
  '--sem-temporal':        '#D4A843',
  '--sem-question-answer': '#46E0FF',
  '--sem-cross-kb':        '#64C8FF',
  '--sem-vault':           '#7B5CFF',
  '--sem-vault-8':         '#62F0A8',
  '--sem-neuro-1':         '#6BD0FF',
  '--sem-neuro-2':         '#9B8CFF',
  '--sem-neuro-3':         '#5BE0B0',
  '--sem-neuro-4':         '#FFD166',
  '--sem-neuro-5':         '#FF7AA8',
  '--sem-neuro-6':         '#7CE0FF',
  '--sem-neuro-7':         '#C8A2FF',
});

/** 只被 canvas 绘图或 getComputedStyle 兜底使用、不作为 DOM 令牌的具体色值。 */
export const CANVAS_HEX = Object.freeze({
  darkBg: '#0c1224',
  neuroOffA: '#2a3550',
  neuroOffB: '#243054',
  themeCanvas: '#11151f',
  themeAccent: '#5b8cff',
  themeText: '#e8ecf4',
  themeMuted: '#9aa3b2',
});

/** DOM 侧语义色：一律走 design-system.css 的令牌，不写死 hex。 */
export const SEM = Object.freeze({
  explicitLink:   'var(--sem-explicit-link)',
  hierarchical:   'var(--sem-hierarchical)',
  coOccurrence:   'var(--sem-co-occurrence)',
  semanticSimilar:'var(--sem-semantic-similar)',
  causal:         'var(--sem-causal)',
  temporal:       'var(--sem-temporal)',
  questionAnswer: 'var(--sem-question-answer)',
  crossKb:        'var(--sem-cross-kb)',
  vault:          'var(--sem-vault)',
  neuro1:         'var(--sem-neuro-1)',
  neuro3:         'var(--sem-neuro-3)',
  neuro4:         'var(--sem-neuro-4)',
});

/** 突触类型配色：canvas / SVG 连线与图例用具体色值；键名由数据契约固定，勿改。 */
export const EDGE_COLORS = Object.freeze({
  explicit_link:    CSS_SEM_HEX['--sem-explicit-link'],
  hierarchical:     CSS_SEM_HEX['--sem-hierarchical'],
  co_occurrence:    CSS_SEM_HEX['--sem-co-occurrence'],
  semantic_similar: CSS_SEM_HEX['--sem-semantic-similar'],
  causal:           CSS_SEM_HEX['--sem-causal'],
  temporal:         CSS_SEM_HEX['--sem-temporal'],
  question_answer:  CSS_SEM_HEX['--sem-question-answer'],
  cross_kb:         CSS_SEM_HEX['--sem-cross-kb'],
});

/** 新建知识库时的可选色板（顺序与改动前 atlas.js 的 VAULT_COLORS 一致）。 */
export const VAULT_PALETTE = Object.freeze([
  CSS_SEM_HEX['--sem-explicit-link'],
  CSS_SEM_HEX['--sem-question-answer'],
  CSS_SEM_HEX['--sem-co-occurrence'],
  CSS_SEM_HEX['--sem-temporal'],
  CSS_SEM_HEX['--sem-causal'],
  CSS_SEM_HEX['--sem-semantic-similar'],
  CSS_SEM_HEX['--sem-hierarchical'],
  CSS_SEM_HEX['--sem-vault-8'],
]);

/** 神经元激活强度配色（顺序与改动前 mind3d.js 的 NEURO_PALETTE 一致）。 */
export const NEURO_PALETTE = Object.freeze([
  CSS_SEM_HEX['--sem-neuro-1'],
  CSS_SEM_HEX['--sem-neuro-2'],
  CSS_SEM_HEX['--sem-neuro-3'],
  CSS_SEM_HEX['--sem-neuro-4'],
  CSS_SEM_HEX['--sem-neuro-5'],
  CSS_SEM_HEX['--sem-neuro-6'],
  CSS_SEM_HEX['--sem-neuro-7'],
]);
