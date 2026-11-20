// NeoLink UI 静态审计（构建前必跑）：跨模块引用一致性检查
// 背景：v1.2.0 曾因"使用了 ui-kit 的导出但未导入"导致文档台运行期崩溃——
//       这类错误语法检查查不出，只有引用审计能在构建前拦住。
// 用法：node tools/check-ui.mjs
// 校验：1) 每个文件用到的 ui-kit 导出必须已导入
//       2) 所有相对导入必须解析到真实文件
//       3) 纯模块（不含 DOM 顶层调用）可在 Node 中干净导入
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(here, '..', 'desktop', 'ui');
// v6.18.0：旧白名单只有 12 个文件，漏掉 ask / astra / capabilities /
// enterprise / mind3d 五个视图及全部 UI 公共模块，却照样打印「全部一致」。
// 改为全量发现（排除纯数据模块、自身 ui-kit、独立窗口与第三方 vendor）。
const EXCLUDE_AUDIT = new Set([
  'ui-kit.js', 'capability-manifest.js', 'pinyin-data.js', 'pinyin-initial.js',
]);
function walkJs(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'sprite' || e.name === 'node_modules') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkJs(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.js') && !EXCLUDE_AUDIT.has(rel)) out.push(rel);
  }
  return out;
}
const files = walkJs(UI);
// 死按钮规则按「视图 + app.js」执行：全站公共模块普遍用事件委托或命令面板
// 绑定，逐一按属性扫描会误报；但 14 个视图必须全部纳入。
const buttonAuditFiles = files.filter((f) => f.startsWith('views/') || f === 'app.js');

let bad = 0;
const fail = (msg) => { console.log('  [FAIL]', msg); bad++; };

// 1) ui-kit 导出名
const kitSrc = fs.readFileSync(path.join(UI, 'ui-kit.js'), 'utf8');
const kitExports = [...kitSrc.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map((m) => m[1]);

for (const f of files) {
  const p = path.join(UI, f);
  if (!fs.existsSync(p)) { fail(`文件缺失: ${f}`); continue; }
  const src = fs.readFileSync(p, 'utf8');

  // 相对导入可解析性
  for (const m of src.matchAll(/import\s+(?:[\s\S]*?from\s*)?'(\.[^']+)'/g)) {
    const target = path.resolve(path.dirname(p), m[1]);
    if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) fail(`${f}: 导入不存在 ${m[1]}`);
  }

  // ui-kit 引用 vs 导入。
  // v6.18.0：新视图的 toast / status 等由 app.js 的挂载参数注入（不是 import），
  // 必须把这些参数也算作「已提供」，否则全量审计会把正确代码误判成缺导入。
  const imported = new Set(
    [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[^']*ui-kit\.js'/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)));
  for (const m of src.matchAll(/export function mount\w+\(\{([^}]+)\}\)/g)) {
    for (const p of m[1].split(',')) {
      const key = p.trim().split(':')[0].trim();
      if (key) imported.add(key);
    }
  }
  for (const name of kitExports) {
    const used = new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(src);
    if (used && !imported.has(name)) fail(`${f}: 使用了 ui-kit 的 ${name}() 但未导入`);
  }
}

// 2) 纯模块可导入性（app.js 顶层执行 boot()，排除；graph→cosmos→three 由 importmap 解析，Node 下预期失败，仅告警）
const importables = ['ui-kit.js', 'doc-render.js',
  'views/explorer.js', 'views/document.js', 'views/relations.js',
  'views/settle.js', 'views/consolidate.js', 'views/team.js', 'views/vaults.js', 'views/atlas.js',
  'views/graph.js'];
// v2.2.1：**只有"three 解析不到"这一种失败可以放行**。
// three 在应用里由 index.html 的 importmap 映射到本地副本，
// Node 下没有 importmap，所以任何直接/间接 import 'three' 的模块
// （views/graph.js、views/vaults.js → ../xgalaxy.js）在 Node 下必然报
// "Cannot find package 'three'" —— 这是**预期**的。
// 但如果失败原因是别的（语法错误、拼错模块名、循环依赖……），
// 必须照样算作硬失败 —— 否则真问题会被这条例外吞掉。
for (const m of importables) {
  try {
    await import(pathToFileURL(path.join(UI, m)));
    console.log('  [import OK]', m);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/Cannot find package 'three'|Cannot find module 'three'/i.test(msg)) {
      console.log(`  [WARN] ${m} 在 Node 下导入失败（three 经应用内 importmap 解析，属预期）: ${msg.split('\n')[0]}`);
    } else {
      fail(`模块导入失败 ${m}: ${msg}`);
    }
  }
}

// 3) 视图挂载参数完整性：视图解构的参数必须由 app.js 挂载点提供
//（v1.3.1 教训：覆盖视图漏传 route，导致跨台按钮全部点击无反应）
const appSrc = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
const provided = new Set(['host', 'app', 'api', 'toast', 'status', 'route', 'openFloat', 'setSelected', 'fmtTime']);
for (const f of files) {
  const src = fs.readFileSync(path.join(UI, f), 'utf8');
  for (const m of src.matchAll(/export function mount\w+\(\{([^}]+)\}\)/g)) {
    // v6.18.0：支持重命名解构（status: setStatus），需求的参数名是冒号前的键
    const need = m[1].split(',').map((s) => s.trim().split(':')[0].trim())
      .filter((s) => s && s !== 'host' && !s.includes('='));
    for (const n of need) if (!provided.has(n)) fail(`${f}: 挂载缺少参数 ${n}`);
  }
}

// 4) 死按钮静态扫描：h('button', {...}) 的属性里若没有任何 on* 事件键，
//    且创建之后也没有 addEventListener 绑定，该按钮点击必然无反应 ——
//    运行时探针可能因为懒加载/时序漏检，这里兜底。
//    （v1.3.1 教训：视图里存在"看得见但点不动"的按钮，必须在构建前拦住。）
for (const f of buttonAuditFiles) {
  const src = fs.readFileSync(path.join(UI, f), 'utf8');
  for (const q of ["h('button'", 'h("button"']) {
    let idx = 0;
    while (true) {
      const i = src.indexOf(q, idx);
      if (i < 0) break;
      idx = i + 1;
      const open = src.indexOf('{', i);
      if (open < 0) continue;
      let depth = 0, j = open;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) break; }
      }
      const attrs = src.slice(open, j + 1);
      // 事件也可能写在创建之后（const b = h(...); b.addEventListener(...)），
      // 因此再看紧随其后的一小段窗口。
      const after = src.slice(j + 1, j + 320);
      const boundLater = /\.addEventListener\s*\(/.test(after.split('\n').slice(0, 4).join('\n'));
      // v6.18.0：真实代码里大量按钮是「先 const 命名、后在几十行之外绑定」，
      // 或经 bind(btn, ...) / 父容器 click 委托。旧规则只看紧随 4 行，
      // 把 14 个视图里十几个正常按钮全判成死按钮。改为按变量名全文件核对。
      const prefix = src.slice(Math.max(0, i - 160), i);
      const varM = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix);
      const varName = varM?.[1];
      const boundByName = !!varName && new RegExp(
        `\\b${varName}\\s*\\.\\s*(?:addEventListener|onclick|on)\\b|\\bbind\\s*\\(\\s*${varName}\\b`
      ).test(src);
      const delegated = /'data-[\w-]+'\s*:/.test(attrs) && /addEventListener\s*\(\s*['"]click['"]/.test(src);
      if (!/\bon[a-z]+\s*:/.test(attrs) && !boundLater && !boundByName && !delegated) {
        const line = src.slice(0, i).split('\n').length;
        fail(`${f}:${line} 按钮无任何事件处理（点击必然无反应）`);
      }
    }
  }
}

// 5) 重复对象键扫描（v2.2.0 血泪教训）
//    同一个对象字面量里出现同名键，JS 以**最后一个**为准，前面的被彻底遮蔽。
//    真实事故：preload.js 里 `link: { deep, onDeepLink }`（深链）与
//    `link: (args) => kb_link`（MCP 工具透传）同名，后者把前者整个盖掉 ——
//    api.link.deep 成了 undefined，深链功能在**任何**场景下都没生效过，
//    而语法检查、引用一致性审计、运行时 UI 审计全都查不出来（它不报错，
//    只是安静地什么都不做）。这类缺陷只能靠"扫重复键"挡住。
{
  const scanDupKeys = (file, src) => {
    // v6.18.0：旧正则只认「恰好 2 空格缩进」的键，嵌套命名空间里的重复键
    // 完全扫不到 —— 而 preload.js 的 API 绝大多数是嵌套对象。
    // 现在按花括号深度给每个对象块单独记键，天然覆盖任意层级。
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
    const stack = [new Map()];
    let depth = 0;
    code.split('\n').forEach((line, i) => {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(.+)$/.exec(line);
      if (m) {
        const key = m[1];
        const seen = stack[depth] || (stack[depth] = new Map());
        if (seen.has(key)) {
          fail(`${file}:${i + 1} 对象里出现重复键 "${key}"（首次在第 ${seen.get(key)} 行）`
            + ` —— 后者覆盖前者，前者定义的能力会静默失效`);
        } else seen.set(key, i + 1);
      }
      for (const ch of line) {
        if (ch === '{') { depth++; stack[depth] = new Map(); }
        else if (ch === '}') { if (depth > 0) depth--; }
      }
    });
  };
  for (const f of ['../preload.js', '../main.js']) {
    const p = path.join(UI, f);
    if (!fs.existsSync(p)) continue;
    scanDupKeys(path.basename(p), fs.readFileSync(p, 'utf8'));
  }
}

// 6) IPC 契约一致性扫描（v2.2.1 血泪教训）
// ------------------------------------------------------------------
// 主进程有两条 IPC 返回通道，约定必须分清：
//   ① 处理器**直接返回** { ok, error?, ...业务字段 } → 渲染层读 r.<字段>
//   ② 处理器经 wrap() 包装 → { ok, error?, data: 业务字段 } → 渲染层读 r.data.<字段>
//
// 把 ② 当成 ① 读，后果是隐蔽但严重的：
//   · 读 `r.ok` —— 外层 ok 恒为 true，**失败也报成功**；
//   · 读 `r.业务字段` —— 恒为 undefined，抛 TypeError 或静默不做事。
// 实测：`crosskb:remove` 删不掉却提示"已删除"；
//      `crosskb:add` 建成了却抛错，提示出不来、列表也不刷新 ——
//      表现就是"点了没反应"。
//
// 本检查：凡经 wrap() 的通道，渲染层**不得**直接读 r.<业务字段>。
// （wrap() 现已统一约定为"内层不自带 ok"，只有一种读法，不存在歧义。）
{
  const mainSrc = fs.readFileSync(path.join(UI, '..', 'main.js'), 'utf8');
  const preSrc = fs.readFileSync(path.join(UI, '..', 'preload.js'), 'utf8');

  // ① 经 wrap() 的通道
  const wrapped = new Set();
  // v6.18.0：旧正则要求 `=> wrap(` 紧邻，多行函数体（如 tool:invoke 的
  // `async (_e,name,args) => { ... return wrap(...) }`）全部漏检。
  // 改为按相邻 ipcMain.handle 之间切片判断是否经 wrap()。
  const handles = [...mainSrc.matchAll(/ipcMain\.handle\('([^']+)'/g)];
  for (let i = 0; i < handles.length; i++) {
    const seg = mainSrc.slice(handles[i].index, i + 1 < handles.length ? handles[i + 1].index : mainSrc.length);
    if (/\bwrap\s*\(/.test(seg)) wrapped.add(handles[i][1]);
  }
  // ② api 路径 → 通道（支持 crosskb.add 这种嵌套命名空间）
  const api2ch = new Map();
  for (const m of preSrc.matchAll(/(\w+):\s*\{([\s\S]*?)\n  \}/g)) {
    const ns = m[1], body = m[2];
    for (const m2 of body.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g)) {
      const k = `${ns}.${m2[1]}`;
      if (!api2ch.has(k)) api2ch.set(k, new Set());
      api2ch.get(k).add(m2[2]);
    }
  }
  for (const m of preSrc.matchAll(/^  (\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/gm)) {
    if (!api2ch.has(m[1])) api2ch.set(m[1], new Set());
    api2ch.get(m[1]).add(m[2]);
  }
  // ③ 扫描渲染层
  const viewFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) viewFiles.push(p);
    }
  };
  walk(UI);

  /** 把注释内容替换成空格（保留换行，行号才不会错）。
   *  否则注释里写的 "r.link.title" 会被当成真实代码，误报一堆。 */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));

  /**
   * 找出 pos 所在的最内层大括号块的结束位置。
   * 变量只在它所在的块内有效 —— 按块取范围，才不会把
   * 别的函数里的同名变量读到的字段算到这一条头上。
   */
  const blockEnd = (src, pos) => {
    let depth = 0;
    for (let i = pos; i >= 0; i--) {
      const ch = src[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) {
          // 找到了开括号，往前找配对的闭括号
          let d = 0;
          for (let j = i; j < src.length; j++) {
            const c = src[j];
            if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) return j; }
          }
          return src.length;
        }
        depth--;
      }
    }
    return src.length;
  };

  for (const f of viewFiles) {
    const raw = fs.readFileSync(f, 'utf8');
    const src = stripComments(raw);   // 注释已抹平，行号保持不变
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+api\.([\w.]+)\(/g)) {
      const vname = m[1], apiPath = m[2];
      const chans = api2ch.get(apiPath);
      if (!chans || ![...chans].some((c) => wrapped.has(c))) continue;
      // 取该变量所在块的末尾，只在块内找属性读取
      const end = blockEnd(src, m.index);
      const body = src.slice(m.index + m[0].length, end);
      const line = src.slice(0, m.index).split('\n').length;
      const rel = path.relative(UI, f);
      for (const pm of body.matchAll(new RegExp(`\\b${vname}\\.([A-Za-z_]\\w*)`, 'g'))) {
        const prop = pm[1];
        if (prop === 'ok' || prop === 'error' || prop === 'data') continue;
        fail(`${rel}:${line} api.${apiPath} 直接读 ${vname}.${prop}`
          + ` —— 该通道经 wrap() 包装，业务字段在 ${vname}.data 里；`
          + `直接读会得到 undefined（可能抛错或"点了没反应"）`);
      }
    }
  }
}

console.log(bad ? `审计结果：${bad} 个问题` : '审计结果：全部一致，无缺失引用');
process.exit(bad ? 1 : 0);
