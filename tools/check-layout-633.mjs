// v6.33.0 排版重构门禁（构建期强制，失败即中止）
// ---------------------------------------------------------------------------
// 背景：v6.32.0 语义关联页用了 sb-* 类名前缀，与状态栏的 .sb-item / .sb-badge
// 撞名；裸 .sb-item 被重新定义成带 11px padding 的 flex 列卡片，把 27px 高的
// 状态栏撑爆，出现截图里的文字重叠。同时两个模型页的根容器漏了 flex + overflow，
// 超出视口的内容被硬裁且无法滚动；6 个 KPI 用 auto-fill 排出 5+1 孤行。
//
// 本门禁逐项复核「结构性修复」，并做一次全项目 CSS 裸类冲突扫描：
//   源码侧逐条断言；传入 --staged <dir> 时再对编排产物做同源复核。
// 只检查真实文件与真实 CSS 文本，不做任何渲染或猜测。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const stagedIdx = args.indexOf('--staged');
const STAGED = stagedIdx >= 0 ? path.resolve(args[stagedIdx + 1]) : null;

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function check(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` · ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` · ${detail}` : ''}`); }
}
const flat = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

console.log(`\n[v6.33.0 排版重构门禁]${STAGED ? ` · staged ${STAGED}` : ' · 源码侧'}\n`);

const styles = read('desktop/ui/styles.css');
const v7 = read('desktop/ui/neocosmos-v2.css');
const ns = read('desktop/ui/northstar.css');
const html = read('desktop/ui/index.html');
const view = read('desktop/ui/views/semantic-bridge.js');
const nlView = read('desktop/ui/views/neolm.js');
const pkg = JSON.parse(read('package.json'));
const dPkg = JSON.parse(read('desktop/package.json'));
const nsi = read('tools/installer.nsi');

// ───────────── A. 命名空间隔离：状态栏与页面级类名彻底分家 ─────────────
console.log('[A] 命名空间隔离（根因）');
const bare = (css, name) => (flat(css).match(new RegExp(`(?:^|\\})\\s*\\.${name}\\s*\\{`, 'g')) || []).length;
for (const n of ['sb-item', 'sb-badge', 'sb-root', 'sb-card', 'sb-mono']) {
  check(bare(styles, n) === 0, `styles.css 无裸 .${n} 定义`, `命中 ${bare(styles, n)} 处`);
}
check(/\.statusbar\s*>\s*\.sb-item\s*\{/.test(styles), '状态栏读数改为直接子元素作用域');
check(/\.statusbar\s*>\s*\.sb-badge\s*\{/.test(styles), '状态栏徽章改为直接子元素作用域');
check(/body\.neo-v2 \.statusbar\s*>\s*\.sb-item\s*\{/.test(v7), '最高优先级层同样只认状态栏子元素');
check(!/flex-direction:\s*column/.test((flat(styles).match(/\.sb-item\s*\{[^}]*\}/) || [''])[0]),
  '不再有任何 .sb-item 被改成 flex 列容器');
check(!/class:\s*['"`]sb-/.test(view), '语义视图不再使用 sb- 前缀');
check(/class:\s*['"`]semb-root/.test(view), '语义视图根容器为 semb-root');
check((view.match(/semb-[a-z-]+/g) || []).length >= 20, '语义视图完整迁入 semb- 命名空间',
  `${(view.match(/semb-[a-z-]+/g) || []).length} 处`);
check(/\.semb-item\s*\{/.test(styles), '新的 semb-item 列表卡样式存在');

// 全项目 CSS 裸类冲突扫描：同名裸类被重复定义且都带布局声明
const CSS_FILES = ['styles.css', 'design-system.css', 'aurora-pro.css', 'northstar.css', 'neocosmos-v2.css'];
const bareMap = new Map();
for (const f of CSS_FILES) {
  const css = flat(read('desktop/ui/' + f));
  for (const m of css.matchAll(/(?:^|\})\s*\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g)) {
    if (!bareMap.has(m[1])) bareMap.set(m[1], []);
    bareMap.get(m[1]).push({ f, body: m[2] });
  }
}
// 全项目裸类重复定义只做**审计披露**：五代叠加层大量采用「同类名渐进覆盖」
// （.rail-item 在不同断点改 padding、.cmdbar 在不同宽度改 width 等），这是既有
// 设计惯例而非缺陷，逐组判失败会误报，也会诱导为了过门禁去盲改历史布局。
// 真正要阻止的是 v6.32.0 那种事故模式：状态栏四类名被重新定义成卡片。
const repeated = [...bareMap.entries()].filter(([, v]) => v.length >= 2);
console.log(`  · 审计：全项目同名裸类重复定义 ${repeated.length} 组（渐进覆盖，逐组保留原样）`);
const STATUS_CLASSES = ['sb-item', 'sb-badge', 'sb-grow', 'sb-sep'];
const cardified = STATUS_CLASSES.filter((k) => (bareMap.get(k) || []).some((x) =>
  /flex-direction:\s*column/.test(x.body) && /padding:\s*(?:[89]|1\d)px/.test(x.body)
  && /border-radius/.test(x.body) && /background/.test(x.body)));
check(cardified.length === 0, '状态栏四类名未被卡片化（v6.32.0 事故模式）',
  cardified.length ? cardified.join(',') : '0 个');

// ───────────── B. 根容器：能滚动、铺满、居中 ─────────────
console.log('\n[B] 视图根容器（内容不再被裁且滚不动）');
const rootRule = (flat(styles).match(/body \.deck-view\.is-active > \.page,[^}]*\}/) || [''])[0];
check(/flex:\s*1 1 auto/.test(rootRule) && /overflow-y:\s*auto/.test(rootRule) && /width:\s*100%/.test(rootRule),
  '舞台根容器统一 flex + overflow + width');
check(/\.nl-root\{[^}]*overflow-y:auto/.test(flat(styles)), 'NeoLM 页根容器可滚动');
const centerRule = (flat(styles).match(/body \.deck-view\.is-active > \.nl-root,\s*body \.deck-view\.is-active > \.semb-root\{[^}]*max-width:\s*var\(--lay-read[^}]*\}/) || [''])[0];
check(/max-width:\s*var\(--lay-read/.test(centerRule) && /margin-inline:\s*auto/.test(centerRule),
  '模型页有阅读宽度上限并居中');
check(/body \.deck-view\.is-active > \*\{min-width:0\}/.test(flat(styles)), '舞台所有直接子项有 min-width:0');

// ───────────── C. 网格与阅读宽度 ─────────────
console.log('\n[C] 指标网格 / 字阶 / 阅读宽度');
check(/--lay-kpi-cols:\s*3/.test(styles), '定义 3 列指标网格令牌');
check(/repeat\(var\(--lay-kpi-cols\),minmax\(0,1fr\)\)/.test(flat(styles)), 'KPI 网格改用固定列变量');
check(/@media \(max-width:1180px\)\{[^}]*--lay-kpi-cols:\s*2/.test(flat(styles)), '中等宽度降为 2 列');
check(/@media \(max-width:760px\)\{[^}]*--lay-kpi-cols:\s*1/.test(flat(styles)), '窄窗口降为 1 列');
const rebuild = styles.slice(styles.indexOf('v6.33.0 · LAYOUT REBUILD'));
check(!/repeat\(auto-fill/.test(rebuild), '新版排版段不再使用 auto-fill 网格');
for (const t of ['--lay-gutter', '--lay-gap', '--lay-card-pad', '--lay-read', '--lay-measure', '--lay-radius',
  '--lay-fs-kicker', '--lay-fs-title', '--lay-fs-sec', '--lay-fs-body', '--lay-fs-meta']) {
  check(styles.includes(t + ':'), `定义统一令牌 ${t}`);
}
const title = Number((styles.match(/--lay-fs-title:\s*(\d+)px/) || [])[1]);
const sec = Number((styles.match(/--lay-fs-sec:\s*(\d+)px/) || [])[1]);
const body = Number((styles.match(/--lay-fs-body:\s*([\d.]+)px/) || [])[1]);
check(title > sec && sec > body, '标题 / 分区 / 正文字阶严格递减', `${title} > ${sec} > ${body}`);
check(/\.semb-sub,\.semb-hint\{[^}]*max-width:\s*var\(--lay-measure/.test(flat(styles)), '说明文字有阅读宽度');

// ───────────── D. 最高优先级层的响应式降级 ─────────────
console.log('\n[D] 最高优先级视觉层补齐响应式（此前 0 条 media）');
const v7Media = [...v7.matchAll(/@media\s*\(([^)]*)\)/g)].map((m) => m[1]);
check(v7Media.length >= 4, 'v7 层已有分级降级规则', `${v7Media.length} 条`);
for (const bp of ['max-width:1180px', 'max-width:1024px', 'max-width:820px', 'max-height:680px']) {
  check(v7Media.includes(bp), `包含断点 ${bp}`);
}
check(/body\.neo-v2 \.doc-body\{[^}]*margin-left:auto/.test(flat(v7)), '文档正文阅读区居中口径收敛');
check(/body\.neo-v2 \.page-head p[^}]*max-width:var\(--lay-measure/.test(flat(v7)), '多代漂移的行宽收敛到单一令牌');

// ───────────── E. 状态栏 / 导航轨 / 顶栏溢出 ─────────────
console.log('\n[E] 状态栏与导航轨溢出修复');
const sbRule = (flat(styles).match(/\.statusbar > \.sb-item\{[^}]*\}/) || [''])[0];
check(/padding:\s*0/.test(sbRule) && /display:\s*inline-block/.test(sbRule) && /text-overflow:\s*ellipsis/.test(sbRule),
  '状态栏读数强制单行、零内边距、超长省略');
check(/body\.neo-v2 \.statusbar\{[^}]*flex-wrap:\s*nowrap/.test(flat(v7)), '状态栏恒定单行');
check(/#sbCaps[\s\S]{0,80}display:none/.test(v7) || /display:none/.test((v7.match(/@media \(max-width:820px\)\{[\s\S]*?\n\}/) || [''])[0]),
  '窄窗口分级隐藏次要状态段');
check(/body\.neo-v2 \.rail-metric b\{[^}]*text-overflow:\s*ellipsis/.test(flat(v7)), '窄轨计数省略不溢出');
check(/overflow-wrap:\s*anywhere/.test((flat(styles).match(/body \.mono,body \.nl-row code[\s\S]*?\}/) || [''])[0]),
  '等宽长文本统一换行保护');

// ───────────── F. 长值改定义列表 ─────────────
console.log('\n[F] 长路径 / 指纹的结构化排版');
check(/\.semb-facts\{[^}]*grid-template-columns:\s*max-content/.test(flat(styles)), '定义列表 label / value 分栏');
check(/\.semb-fact-v\{[^}]*overflow-wrap:\s*anywhere/.test(flat(styles)), '长值可断行且不撑破容器');
check(/function facts\(/.test(view) && /semb-fact-k/.test(view), '视图真实生成定义列表');
check(/semb-item-foot/.test(view), '结果卡有独立操作行');
check(/semb-kicker/.test(view) && /semb-divider/.test(view), '卡片有 kicker 与发丝线分层');

// ───────────── G. 样式层顺序与数据链路不变 ─────────────
console.log('\n[G] 样式层顺序 / 数据链路零回归');
const links = [...html.matchAll(/<link rel="stylesheet" href="\.\/([\w.-]+\.css)"/g)].map((m) => m[1]);
check(links.length === 5, '样式层仍为 5 层（未堆叠第 6 个补丁文件）', links.join(' → '));
check(links.join(',') === 'styles.css,design-system.css,aurora-pro.css,northstar.css,neocosmos-v2.css',
  '加载顺序不变，最高优先级层仍在末位');
for (const m of ['status', 'reindex', 'search', 'suggestions', 'applySuggestion', 'vaults', 'bridges', 'applyBridge']) {
  check(view.includes(`api.semantic.${m}(`), `语义视图仍真实调用 api.semantic.${m}`);
}
check(nlView.includes('api.neolm.'), 'NeoLM 视图数据链路未改');

// ───────────── H. 版本一致性 ─────────────
console.log('\n[H] 版本真源');
// v6.34.0：版本断言改为从 pkg.version 动态派生（单一真源），升级不再漏改门禁。
const V = pkg.version;
check(V === dPkg.version, '根 / 桌面 package.json 版本一致', V);
check(nsi.includes(`"${V}.0"`) && nsi.includes(`"${V}"`), '安装脚本版本与包版本一致', V);
check(html.includes(`id="brandVersion">${V}<`), '标题栏版本戳与包版本一致', V);
check(ns.includes(`NORTHSTAR · v${V}`) && v7.includes(`NeoCosmos v${V}`), '两个视觉层版本头同步', V);

// ───────────── I. staged 同源复核 ─────────────
if (STAGED) {
  console.log('\n[I] staged 产物同源复核');
  for (const f of ['ui/styles.css', 'ui/neocosmos-v2.css', 'ui/northstar.css',
    'ui/index.html', 'ui/views/semantic-bridge.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'desktop', f.replace(/^ui\//, 'ui/')), 'utf8');
    const dst = path.join(STAGED, f);
    check(fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === src, `staged 与源码逐字一致 ${f}`);
  }
}

console.log(`\n排版重构门禁：${pass} 通过 / ${fail} 失败\n`);
if (fail) process.exit(1);
