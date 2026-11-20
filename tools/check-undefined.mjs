// 未定义标识符扫描（作用域粗判 + 出现性核对）
// ---------------------------------------------------------------------------
// 目的：抓出**运行时才会炸**的那类缺陷 —— 函数里引用了一个根本没声明的变量。
//
// 为什么需要它：
//   本项目没有 lint，而这类缺陷的杀伤力极大：
//   `saveApiToken(token)` 函数体里写了 `{ ..., port, ... }`，
//   但 port 根本不是它的参数、也不是全局变量 ——
//   于是每次「启动服务」都抛 `ReferenceError: port is not defined`，
//   界面上只弹一句莫名其妙的话，功能**完全不可用**。
//
//   Node 的 `node --check` 只查语法，查不出这个；
//   运行时测试要真的点那个按钮才能发现 —— 而按钮埋在折叠面板深处。
//
// 判据（刻意保守，宁可漏报也不误报 —— 误报率高的闸门等于没有闸门）：
//   1) 先定位每个**对象字面量里的裸标识符**（`{ port, token }` 这种简写）；
//   2) 找出包含它的那一层函数（用花括号配平算函数的起止行）；
//   3) 如果这个标识符**在整个函数体里只出现在这一处**，
//      且**模块级也没有同名声明**（const/let/var/function/import/参数之外），
//      那它多半是真的没声明 —— 报出来。
//
//   第 3 步的"只出现在这一处"是关键：
//   嵌套函数里的变量、内层块的变量、模块级常量（如 path），
//   在函数体里都会**出现多次**，于是被自然排除，零误报。
//
// 两个踩过的坑（写在这里免得再犯）：
//   ① 路径必须用 fileURLToPath(import.meta.url) ——
//      `new URL(...).pathname` 在 Windows 上是**百分号编码**的，
//      中文路径下变成 `D:\05-%E4%BA%A7...`，文件根本找不到，
//      检查会**静默跳过一切**（看起来"通过"，实际什么都没查）。
//   ② 函数定位不能"遇到 } 就停" —— 函数体里有嵌套块，
//      那些 } 属于内层块，提前退出就永远找不到外层函数。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// v6.18.0：旧版只扫 2 个主进程文件，却在输出里写「无问题」，
// 给构建者一种渲染层也被检查过的错觉。现在把 desktop/ui/**/*.js 一并纳入
// （排除第三方 vendor 与独立窗口 sprite 的第三方资源），并如实打印覆盖范围。
function walkJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'vendor' || e.name === 'node_modules') continue;
      out.push(...walkJs(p));
    } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
// 两种检查分开，并在输出里如实区分：
//   · 主进程 / preload：沿用对象简写裸标识符的启发式（针对历史真实事故）；
//   · 渲染层 ESM：用 Node 自带 --check 做确定的语法闸门。
// 把同一套正则启发式套到渲染层会产生大量误报（箭头函数 / 解构 / 注入参数），
// 那种「一片红」的闸门比没有闸门更糟，因此不用它冒充未定义扫描。
const MAIN_TARGETS = [
  path.join(ROOT, 'desktop', 'main.js'),
  path.join(ROOT, 'desktop', 'preload.js'),
];
const UI_TARGETS = walkJs(path.join(ROOT, 'desktop', 'ui'));
const TARGETS = MAIN_TARGETS;

// 不可能是"未声明标识符"的字面量与关键字
const LITERALS = new Set([
  'null', 'undefined', 'true', 'false', 'NaN', 'Infinity',
  'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'while', 'new',
  'typeof', 'case', 'default', 'await', 'async', 'import', 'export', 'from', 'of', 'in', 'do',
  'try', 'catch', 'finally', 'throw', 'switch', 'break', 'continue', 'delete', 'void', 'this',
  'super', 'extends', 'static', 'get', 'set', 'yield', 'instanceof',
]);

let problems = 0;
function fail(msg) { problems++; console.error('  ✗ ' + msg); }

/** 剥掉注释与字符串，避免它们的括号/标识符干扰分析 */
function clean(line) {
  // 注意：`/\/\/.*$/` 在 **CRLF 行尾**下会失效 ——
  // `.*` 贪婪吃掉 `\r`，而 `$`（无 m 标志）只匹配字符串末尾或 `\n` 之前，
  // 于是**整行注释根本没被剥掉**，注释里的 `{ port }` 全被当成真代码。
  // 所以这里不用 `$`，直接 `.*` 匹配到行尾。
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/`(\\.|[^`\\])*`/g, '``');
}

/** 从函数声明行做花括号配平，返回其结束行（含）；配平不了返回 -1 */
function functionEnd(lines, start) {
  let depth = 0, seen = false;
  for (let k = start; k < lines.length && k < start + 800; k++) {
    for (const ch of clean(lines[k])) {
      if (ch === '{') { depth++; seen = true; }
      else if (ch === '}') depth--;
    }
    if (seen && depth <= 0) return k;
  }
  return -1;
}

/** 找到**包含第 i 行**的最近函数声明行；找不到返回 -1 */
function findFunctionStart(lines, i) {
  // 仅定位具名 function 声明：箭头函数 / 对象方法用花括号配平定位会串到相邻块，
  // 实测在主进程与渲染层都会产生成片误报。渲染层改由确定的 ESM 语法闸门覆盖。
  for (let k = i; k >= 0 && k > i - 600; k--) {
    if (!/^\s*(?:export\s+)?(?:async\s+)?function\s*\w*\s*\(/.test(lines[k])) continue;
    if (functionEnd(lines, k) >= i) return k;
  }
  return -1;
}

/**
 * 判断 name 是否是**回调函数的形参**。
 * 形参只在自己的回调体里可见，外层看不到 ——
 * 正则法必须单独把它们排除，否则误报一片。
 */
function isCallbackParam(lines, i, name) {
  // 只看**当前行与紧邻的上一行** ——
  // 形参列表几乎总是和回调体在同一行或紧挨着。
  // 范围放太宽会误伤真缺陷（本轮就差点把 `port` 一起放过去：
  // 它上面几行恰好有别的回调，形参里也有个同名的东西）。
  for (let k = i; k >= Math.max(0, i - 1); k--) {
    const l = clean(lines[k]);
    // 箭头函数的参数列表
    for (const m of l.matchAll(/\(([^()]*)\)\s*=>/g)) {
      for (const p of m[1].split(',')) {
        const n = p.trim().split(/[\s=:]/)[0];
        if (n === name) return true;
      }
    }
    // 普通函数的形参
    for (const m of l.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)) {
      for (const p of m[1].split(',')) {
        const n = p.trim().split(/[\s=:]/)[0];
        if (n === name) return true;
      }
    }
  }
  return false;
}

/** 取函数名 */
function fnNameOf(lines, i) {
  const m = lines[i].match(/function\s*([A-Za-z_$][\w$]*)/);
  return m ? m[1] : '(匿名)';
}

/**
 * 模块级声明的名字（顶层作用域可见，函数里也能用）。
 * 只取**不在任何函数体内**的声明行。
 */
function moduleLevelNames(lines) {
  const names = new Set();
  let inFn = false, fnDepth = 0, depth = 0;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (!inFn && /^\s*(?:export\s+)?(?:async\s+)?function\s*\w*\s*\(/.test(l)) {
      inFn = true; fnDepth = 0;
    }
    if (!inFn) {
      for (const m of l.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
      // 逗号连写：let a = null, b = null;
      for (const m of l.matchAll(/\b(?:const|let|var)\s+[^;\n]*?,\s*([A-Za-z_$][\w$]*)\s*(?:=|,|;)/g)) {
        names.add(m[1]);
      }
      for (const m of l.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
      // 解构
      for (const m of l.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
        for (const p of m[1].split(',')) {
          const n = p.trim().split(/[\s:]/)[0];
          if (n && /^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
        }
      }
    }
    // 跟踪花括号深度，判断函数是否结束
    for (const ch of clean(l)) {
      if (ch === '{') { depth++; if (inFn) fnDepth++; }
      else if (ch === '}') { depth--; if (inFn) fnDepth--; }
    }
    if (inFn && fnDepth <= 0) { inFn = false; }
  }
  return names;
}

// ---------------------------------------------------------------------------
for (const file of TARGETS) {
  if (!fs.existsSync(file)) {
    console.error(`  ✗ 找不到文件：${file}`);
    problems++;
    continue;
  }
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const moduleNames = moduleLevelNames(lines);

  // 对象字面量里的裸标识符：{ port, token } / { port: x, ... }
  const re = /[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g;
  const fnCache = new Map();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    // 行尾注释要剥掉 —— 注释里的 `{ name, path, ... }` 会被误判成对象字面量
    const line = raw.replace(/\/\/.*$/, '');
    const re2 = new RegExp(re.source, 'g');
    let m;
    while ((m = re2.exec(line))) {
      const name = m[1];
      if (LITERALS.has(name)) continue;
      // 模块级已声明 → 没问题
      if (moduleNames.has(name)) continue;

      const fnStart = findFunctionStart(lines, i);
      if (fnStart < 0) continue;
      const fnEnd = functionEnd(lines, fnStart);
      if (fnEnd < 0) continue;

      // 该标识符在**整个函数体**里还出现在别处吗？
      // 出现 → 它多半是嵌套函数/内层块/形参里的合法变量，跳过。
      let elsewhere = false;
      const wordRe = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
      for (let k = fnStart; k <= fnEnd; k++) {
        if (k === i) continue;
        if (wordRe.test(clean(lines[k]))) { elsewhere = true; break; }
      }
      if (elsewhere) continue;

      // 回调形参：(e, n) => / function (e, n) {  —— 单字母形参很常见，
      // 它们在**回调自己的作用域**里，外层看不到，
      // 于是"回调体里用了自己的形参"会被误判成未声明。
      // 判据：该标识符在本行/邻近行以**回调形参**的身份出现过。
      if (isCallbackParam(lines, i, name)) continue;

      fail(`${rel}:${i + 1}  函数「${fnNameOf(lines, fnStart)}」内引用了未声明的「${name}」`
        + ` —— 运行时会抛 ReferenceError: ${name} is not defined`);
    }
  }
}

// 渲染层：确定的语法闸门（不是启发式，不冒充「未定义标识符扫描」）
let syntaxChecked = 0;
for (const file of UI_TARGETS) {
  const rel = path.relative(ROOT, file);
  const r = spawnSync(process.execPath, ['--experimental-default-type=module', '--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    fail(`${rel}: ESM 语法检查失败 —— ${String(r.stderr || r.error || '').split('\n').slice(0, 3).join(' ')}`);
  } else syntaxChecked++;
}

if (problems) {
  console.error(`\n未定义标识符 / 语法扫描：${problems} 个问题`);
  process.exit(1);
}
console.log(`  ✓ 未定义标识符扫描：无问题（启发式覆盖 ${MAIN_TARGETS.length} 个主进程文件）`);
console.log(`  ✓ 渲染层 ESM 语法闸门：${syntaxChecked} 个文件全部通过（UI 引用一致性由 check-ui.mjs 覆盖）`);
