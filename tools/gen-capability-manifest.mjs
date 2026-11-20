// 真实能力清单生成器 · v10.18.7
// ---------------------------------------------------------------------------
// 目的：把「界面上到底有没有这个功能」从一句主观判断，变成**从源码自动推导**
//       且可重复复核的事实。产品界面（能力中枢）只读本脚本的产物，不手写清单。
//
// 输入（唯一真源）：
//   desktop/main.js                        主进程真实注册的 IPC 通道
//   desktop/preload.js                     contextBridge 暴露的渲染层 API
//   desktop/ui/views/capabilities.js       能力中枢里显式调用的 api 路径
//   desktop/ui/**/*.js                     其它视图里的引用（保守口径，见下）
//
// 输出：desktop/ui/capability-manifest.js（ES module，供渲染层 import）
//
// 口径（如实写在产物里，不粉饰）：
//   hub  —— 能力中枢中以完整 `api.a.b()` 路径显式调用，精确到方法
//   view —— 其它视图中出现同名方法调用（按叶子方法名统计，属**保守**口径，
//           通用名如 status/open 可能高估，绝不会低估到把已有入口说成没有）
//   none —— 渲染层零引用（内核内部 / 订阅 / 窗口控制 / 或确无界面）
//
// 严禁：不得把未在 main.js 注册的通道写进清单；不得凭记忆补功能；
//       产物不含任何时间戳，同一份源码永远生成同一份字节。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mainSrc = read('desktop/main.js');
const preloadSrc = read('desktop/preload.js');
const hubPath = 'desktop/ui/views/capabilities.js';
const hubSrc = fs.existsSync(path.join(ROOT, hubPath)) ? read(hubPath) : '';

// ── 1 · 主进程真实注册的请求通道 ──────────────────────────────────────────
const channels = new Map();
for (const m of mainSrc.matchAll(/ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]/g)) {
  const name = m[2];
  const prev = channels.get(name);
  // 同一通道既有 on 又有 handle 时记为 both，不重复计数
  const kind = prev && prev.kind !== m[1] ? 'both' : m[1];
  channels.set(name, { name, kind });
}

// 主进程主动推送的事件（非请求通道，单独列出，不混入通道总数）
const events = new Set();
for (const m of mainSrc.matchAll(/\.webContents\.send\(\s*['"]([^'"]+)['"]/g)) events.add(m[1]);
for (const m of preloadSrc.matchAll(/ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g)) events.add(m[1]);

// ── 2 · preload 暴露的 API 路径 → 真实通道 ────────────────────────────────
// 逐行按缩进解析 api 对象层级；只认真正的 ipcRenderer.invoke/send 调用。
const block = preloadSrc.slice(
  preloadSrc.indexOf('const api = {'),
  preloadSrc.indexOf('contextBridge.exposeInMainWorld'),
);
const stack = [];
const apis = [];
for (const line of block.split('\n')) {
  const group = line.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:\s*\{\s*$/);
  if (group) {
    const lvl = Math.floor(group[1].length / 2);
    stack[lvl] = group[2];
    stack.length = lvl + 1;
    continue;
  }
  const leaf = line.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/);
  if (!leaf) continue;
  const lvl = Math.floor(leaf[1].length / 2);
  const parts = stack.slice(0, lvl).filter(Boolean);
  parts.push(leaf[2]);
  const apiPath = parts.join('.');
  const call = line.match(/ipcRenderer\.(invoke|send)\(\s*['"]([^'"]+)['"]/);
  const channel = call ? call[2] : null;
  const tool = line.match(/ipcRenderer\.invoke\(\s*'tool:invoke'\s*,\s*'([^']+)'/);
  apis.push({ path: apiPath, leaf: leaf[2], channel, tool: tool ? tool[1] : null });
}
// 去重（同一路径理论上唯一）
const apiByPath = new Map();
for (const a of apis) if (!apiByPath.has(a.path)) apiByPath.set(a.path, a);

// ── 3 · 渲染层引用扫描 ────────────────────────────────────────────────────
const UI = path.join(ROOT, 'desktop', 'ui');
const uiFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'capability-manifest.js') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.js$/.test(e.name)) uiFiles.push(p);
  }
})(UI);
const uiText = new Map();
for (const p of uiFiles) uiText.set(path.relative(UI, p).replace(/\\/g, '/'), fs.readFileSync(p, 'utf8'));

// 能力中枢：按完整路径精确匹配（允许可选链 api?.x.y）。
// 必须先剥离注释 —— 文档注释里会出现 `api.a.b()` 这类**说明性示例**，
// 不剥离就会把 `a.b` 误统计成一个真实调用，属于自己制造的假数据。
const hubCode = hubSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const hubActions = new Set();
for (const m of hubCode.matchAll(/\bapi\??\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
  hubActions.add(m[1].replace(/\?\./g, '.'));
}

const GROUP_LABEL = {
  app: '应用与窗口', api: '本地只读 API', astra: '星灵 · 自主引擎', consolidate: '巩固',
  crosskb: '跨库管辖', diag: '诊断', doc: '文档', ent: '企业安全', graph: '关系图谱',
  index: '索引', journal: '审计日志', link: '深链', mind: '认知内核', sediment: '沉淀',
  conn: '连接管理',
  sprite: '桌面精灵', synapse: '突触推导', tool: '知识工具', vault: '知识库',
  vaults: '多库视图', window: '窗口控制',
};

const list = [...apiByPath.values()].map((a) => {
  const refs = [];
  for (const [file, src] of uiText) {
    if (file === 'views/capabilities.js' || file === 'preload.js') continue;
    // 允许 `api.x.foo()`、`api.x?.foo()`、`api.x?.foo?.()` 三种真实写法。
    // 注意可选链调用的后缀是 `?.(`，中间还有一个点，早期版本漏了它导致误报零引用。
    if (new RegExp('[?]?\\.' + a.leaf.replace(/\$/g, '\\$') + '[?]?[.]?\\s*\\(').test(src)) refs.push(file);
  }
  const hub = hubActions.has(a.path);
  const state = hub ? 'hub' : (refs.length ? 'view' : 'none');
  return {
    path: a.path,
    channel: a.channel,
    tool: a.tool,
    group: (a.channel || a.path.split('.')[0]).split(':')[0],
    state,
    refs: refs.slice(0, 6),
  };
});

list.sort((x, y) => x.path.localeCompare(y.path));
const totals = {
  channels: channels.size,
  events: events.size,
  apis: list.length,
  hub: list.filter((x) => x.state === 'hub').length,
  view: list.filter((x) => x.state === 'view').length,
  none: list.filter((x) => x.state === 'none').length,
  tools: list.filter((x) => x.tool).length,
  // v6.20：桌面桥接工具（tool:）与 MCP 对外工具是两套口径，旧清单只有一个
  // 含糊的 tools:12，界面却拿它当「所有工具数」。这里从 MCP 真源读真实数量。
  mcpTools: (() => {
    const mcpSrc = fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'tools.js'), 'utf8');
    return new Set([...mcpSrc.matchAll(/name:\s*'(kb_[a-z_]+)'/g)].map((m) => m[1])).size;
  })(),
};

const sourceHash = crypto.createHash('sha256')
  .update(mainSrc).update('\n---PRELOAD---\n').update(preloadSrc)
  .update('\n---HUB---\n').update(hubSrc)
  .digest('hex').slice(0, 16);

const manifest = {
  generatedBy: 'tools/gen-capability-manifest.mjs',
  coverageNote: 'hub=能力中枢完整路径精确匹配；view=其它视图同名方法调用（保守口径，通用名可能高估）；none=渲染层零引用',
  sourceHash,
  totals,
  groups: Object.entries(GROUP_LABEL).map(([key, label]) => ({
    key, label,
    channels: [...channels.values()].filter((c) => c.name.split(':')[0] === key).map((c) => c.name),
    apis: list.filter((a) => a.group === key).length,
  })).filter((g) => g.channels.length || g.apis),
  channels: [...channels.values()].sort((a, b) => a.name.localeCompare(b.name)),
  events: [...events].sort(),
  apis: list,
};

const out = path.join(UI, 'capability-manifest.js');
const body = '// 自动生成 · 请勿手改 · 由 tools/gen-capability-manifest.mjs 从源码推导\n'
  + '// 同一份源码永远生成同一份字节；界面只读此清单，不手写能力列表。\n'
  + 'export const CAPABILITY_MANIFEST = ' + JSON.stringify(manifest, null, 2) + ';\n';
fs.writeFileSync(out, body, 'utf8');

console.log('  能力清单已生成 desktop/ui/capability-manifest.js');
console.log(`  IPC 通道 ${totals.channels} · 推送事件 ${totals.events} · 桥接 API ${totals.apis}（桌面桥接工具 ${totals.tools} · MCP 工具 ${totals.mcpTools}）`);
console.log(`  界面覆盖：能力中枢 ${totals.hub} · 其它视图 ${totals.view} · 零引用 ${totals.none} · 源码指纹 ${sourceHash}`);
if (totals.none) {
  console.log('  零引用（如实保留，多为内部/订阅通道）：');
  for (const a of list.filter((x) => x.state === 'none')) console.log('    - ' + a.path + (a.channel ? ' → ' + a.channel : ''));
}
