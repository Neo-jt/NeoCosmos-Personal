// v6.34.0 · 外部文件溯源深链（neolink://verify）跳转契约测试
// ---------------------------------------------------------------------------
// 背景：用户在导出的 Markdown 报告 / 外部 Agent 里点「溯源：neolink://verify/...」
//       链接，期望唤起 NeoCosmos 并直接跳到对应文档卡片。但主进程 parseDeepLink
//       的正则只认 neolink://open，导致冷启动 scanArgvDeepLink 与运行中
//       dispatchDeepLink 都拿不到深链 —— 只打开应用、不跳转。
// 本测试：从真实源码抽取 parseDeepLink 函数体，在 Function 沙箱里忠实执行，
//       覆盖 open / verify 两种形态、片段提取、含斜杠节点 id、非法输入，
//       并复核下游渲染层 handleDeepLink 确实用 verify/snippet 驱动跳转与高亮。
//       不预置结果、不放水断言；任何一项解析回归都会失败。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}${extra ? ' ' + extra : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${extra ? ' ' + extra : ''}`); }
}

const mainSrc = read('desktop/main.js');
const appSrc = read('desktop/ui/app.js');

console.log('\n===== v6.34.0 外部文件溯源深链契约测试 =====\n');

// ── [0] 从真实源码抽取 parseDeepLink 并在沙箱忠实重建 ──────────────────
// 抽取 "function parseDeepLink(raw) {" 起到匹配的 "}"（按大括号计数），
// 保证测的就是线上函数，不是另写一份可能漂移的实现。
function extractFunction(src, name) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start < 0) throw new Error(`未找到函数 ${name}`);
  const braceOpen = src.indexOf('{', start);
  let depth = 0, i = braceOpen;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
const fnSrc = extractFunction(mainSrc, 'parseDeepLink');
// 沙箱里提供 URLSearchParams（Node 全局已有）；函数体不依赖其它局部变量。
const parseDeepLink = new Function(`${fnSrc}; return parseDeepLink;`)();

console.log('[0] 真实源码抽取与函数可运行');
ok('parseDeepLink 从 main.js 抽取成功且可执行', typeof parseDeepLink === 'function');
ok('正则同时接受 open/verify 两种形态', /\(\s*open\|verify\s*\)/.test(fnSrc) || /open\|verify/.test(fnSrc), '源码正则已收口两种深链');
ok('verify 分支回传 verify:true', /verify:\s*true/.test(fnSrc));
ok('verify 分支回传 snippet', /snippet/.test(fnSrc));

// ── [1] open 深链（历史兼容，不得回归）───────────────────────────────────
console.log('\n[1] open 深链解析（历史兼容）');
{
  const r = parseDeepLink('neolink://open/v_abc123/n_deadbeef');
  ok('open: 解析出库 ID', r && r.vaultId === 'v_abc123', JSON.stringify(r));
  ok('open: 解析出卡片 ID', r && r.cardId === 'n_deadbeef');
  ok('open: 不带 verify 标记', r && !r.verify);
}

// ── [2] verify 溯源深链（本轮修复核心）────────────────────────────────────
console.log('\n[2] verify 溯源深链解析（外部文件点击入口）');
{
  const r = parseDeepLink('neolink://verify/v_abc123/n_123?s=%E5%BC%95%E7%94%A8%E7%89%87%E6%AE%B5');
  ok('verify: 深链被识别（非 null）', !!r, JSON.stringify(r));
  ok('verify: 解析出库 ID', r && r.vaultId === 'v_abc123');
  ok('verify: 解析出节点 ID 作为 cardId', r && r.cardId === 'n_123');
  ok('verify: 带 verify:true 供渲染层走高亮分支', r && r.verify === true);
  ok('verify: 片段 s 被解码为中文', r && r.snippet === '引用片段', `snippet=${r && r.snippet}`);
}

// ── [3] 含斜杠的节点 ID（dir/sub/n_xxx 必须整段接住）────────────────────
console.log('\n[3] 含斜杠节点 ID 与无片段');
{
  const r = parseDeepLink('neolink://verify/v_abc123/dir/sub/n_123?s=abc%20def');
  ok('verify: 含斜杠节点 ID 整段保留', r && r.cardId === 'dir/sub/n_123', `cardId=${r && r.cardId}`);
  ok('verify: 片段中空格正确解码', r && r.snippet === 'abc def', `snippet=${r && r.snippet}`);
  const r2 = parseDeepLink('neolink://verify/v_abc123/n_999');
  ok('verify: 无片段时 snippet 为空串且不误判 null', r2 && r2.cardId === 'n_999' && r2.snippet === '');
}

// ── [4] 大小写与非法输入 ─────────────────────────────────────────────────
console.log('\n[4] 形态变体与非法输入');
{
  ok('VERIFY 大写也识别（正则 i 标志）', !!parseDeepLink('NEOLINK://VERIFY/v_x/n_y?s=z'));
  ok('非 neolink 协议返回 null', parseDeepLink('https://example.com/verify/v_x/n_y') === null);
  ok('空串返回 null', parseDeepLink('') === null);
  ok('只有 host 无库无卡片返回 null', parseDeepLink('neolink://verify/') === null);
}

// ── [5] 两个调用入口都经过 parseDeepLink（修复覆盖面）───────────────────
console.log('\n[5] 冷启动与二次唤起两条入口');
{
  ok('scanArgvDeepLink 调用 parseDeepLink', /function scanArgvDeepLink[\s\S]*?parseDeepLink\(a\)/.test(mainSrc));
  ok('dispatchDeepLink 调用 parseDeepLink', /function dispatchDeepLink[\s\S]*?parseDeepLink\(raw\)/.test(mainSrc));
  ok('冷启动把 scanArgv 结果存入 pendingDeepLink', /scanArgvDeepLink\(\)[\s\S]{0,120}pendingDeepLink\s*=\s*argvDeepLink/.test(mainSrc));
  ok('second-instance 用 dispatchDeepLink 分发 argv', /second-instance[\s\S]*?dispatchDeepLink\(a\)/.test(mainSrc));
}

// ── [6] 渲染层下游契约：handleDeepLink 消费 verify/snippet ───────────────
console.log('\n[6] 渲染层下游跳转与高亮契约');
{
  ok('handleDeepLink 按 verify 决定高亮片段', /target\.verify\s*\?\s*target\.snippet/.test(appSrc));
  ok('handleDeepLink 打开卡片后 route(workspace)', /openCard\(res\.cardId[\s\S]{0,120}route\('workspace'\)/.test(appSrc));
  ok('溯源成功有明确 toast', appSrc.includes('已溯源并高亮被引用的具体内容'));
  ok('深链解析支持 query 形态 verify/snippet 字段', /sp\.get\('verify'\)/.test(appSrc) && /sp\.get\('snippet'\)/.test(appSrc));
}

// ── [7] 交付版本戳 ───────────────────────────────────────────────────────
console.log('\n[7] 版本戳');
{
  const pkg = JSON.parse(read('package.json'));
  const parts = String(pkg.version || '').split('.').map((x) => Number(x));
  ok('根包版本不低于 6.34.0（本特性引入版，后续升级保持有效）',
    parts[0] > 6 || (parts[0] === 6 && (parts[1] > 34 || (parts[1] === 34 && parts[2] >= 0))),
    `version=${pkg.version}`);
}

console.log(`\n===== 结果：${pass} PASS / ${fail} FAIL =====\n`);
process.exit(fail ? 1 : 0);
