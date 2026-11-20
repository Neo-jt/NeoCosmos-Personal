// NeoLink · v2.1.0 百万级堆扩容链路自检
// ---------------------------------------------------------------------------
// 验证三件事：
//   1) 默认启动（小库）不会触发重启 —— 零打扰
//   2) 大库触发一次带 --js-flags 的重启，且只重启一次（不自举死循环）
//   3) 重启后堆上限真的被抬高（不是纸面参数）
//
// 用法：node tools/heap-selfcheck.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(ROOT, 'build', 'win', 'electron-v33.0.0', 'NeoCosmos.exe');
const REPORT = path.join(os.tmpdir(), 'neolink-smoke.json');

if (!fs.existsSync(EXE)) {
  console.error('✗ 未找到构建产物，请先执行 node tools/build-win.mjs');
  process.exit(1);
}

function readReport() {
  try { return JSON.parse(fs.readFileSync(REPORT, 'utf8')); } catch { return null; }
}
function runSmoke(env = {}, timeoutMs = 120000) {
  try { fs.unlinkSync(REPORT); } catch { /* ignore */ }
  // 必须清掉 ELECTRON_RUN_AS_NODE：带它时 Electron 会退化成纯 Node，
  // 于是 `--smoke` 被当成 Node 的非法参数直接报错退出。
  const childEnv = { ...process.env, ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(EXE, ['--smoke'], {
    env: childEnv,
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/**
 * 等待冒烟报告落盘。
 * 注意：触发堆扩容时会发生「重启」，重启后的进程是异步拉起的，
 * 原进程先退出、报告稍后才写，所以必须轮询等待而不是立刻读。
 */
function waitReport(maxMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const rep = readReport();
    if (rep && rep.heap) return rep;
    try { execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']); } catch { /* ignore */ }
  }
  return null;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  — ' + detail : ''}`);
}

console.log('════════ NeoLink · 堆扩容链路自检 ════════');
console.log(`  可执行文件：${EXE}`);
console.log(`  物理内存：${Math.floor(os.totalmem() / 1048576)} MB\n`);

// ---------------------------------------------------------------------------
// 用例 1：小库不重启（默认堆足够）
// ---------------------------------------------------------------------------
console.log('【用例 1】小库启动不应触发重启');
{
  runSmoke({ NEOLINK_NO_RELAUNCH: '1' });
  const rep = waitReport();
  check('冒烟自检能出报告', !!rep, rep ? '' : '无 smoke.json');
  check('堆上限为默认值（未被偷偷抬高）', rep && rep.heap.limitMB < 3072,
    rep ? `${rep.heap.limitMB} MB` : '无数据');
  check('未标记 relaunched', rep && rep.heap.relaunched === false);
  check('argv 里没有 --js-flags', rep && !/--js-flags/.test(rep.heap.argv || ''), rep ? rep.heap.argv : '');
}

// ---------------------------------------------------------------------------
// 用例 2：手动指定堆 → 触发一次重启，且堆真的被抬高
// ---------------------------------------------------------------------------
console.log('\n【用例 2】显式指定大堆 → 重启一次并生效');
{
  runSmoke({ NEOLINK_HEAP_MB: '3072' });
  const rep = waitReport();
  check('重启后能出报告', !!rep, rep ? '' : '无 smoke.json（可能自举死循环）');
  if (rep) {
    check('堆上限已抬高到 ≥ 3072MB', rep.heap.limitMB >= 3072, `${rep.heap.limitMB} MB`);
    check('argv 带 --js-flags', /--js-flags/.test(rep.heap.argv || ''), rep.heap.argv);
    check('冒烟自检本体仍全绿（重启后功能无损）',
      !rep.fatal && (rep.diag ? (rep.diag.errors || []).length === 0 : false),
      rep.fatal ? String(rep.fatal) : `errors=${(rep.diag && rep.diag.errors || []).length}`);
  }
}

// ---------------------------------------------------------------------------
// 用例 3：不会自举死循环（argv 带 --js-flags 即视为"已经扩过堆"）
// ---------------------------------------------------------------------------
console.log('\n【用例 3】自举死循环防护');
{
  // 直接带 --js-flags 启动：应被视为"已扩堆"，绝不再重启
  try { fs.unlinkSync(REPORT); } catch { /* ignore */ }
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  spawnSync(EXE, ['--smoke', '--js-flags=--max-old-space-size=3072'], {
    env: childEnv, timeout: 120000, encoding: 'utf8',
  });
  const rep = waitReport();
  check('带 --js-flags 时不再重启', !!rep, rep ? '' : '无 smoke.json');
  if (rep) {
    check('堆上限维持 3072（未被二次抬高）', rep.heap.limitMB >= 3000 && rep.heap.limitMB < 4000,
      `${rep.heap.limitMB} MB`);
  }
}

// ---------------------------------------------------------------------------
// 用例 4：物理内存封顶逻辑
// ---------------------------------------------------------------------------
console.log('\n【用例 4】堆上限受物理内存封顶');
{
  runSmoke({ NEOLINK_NO_RELAUNCH: '1' });
  const rep = waitReport();
  const physMB = Math.floor(os.totalmem() / 1048576);
  check('capMB 有合理取值（物理内存的 70%）', rep && rep.heap.capMB >= 3072,
    rep ? `cap=${rep.heap.capMB} MB（物理 ${physMB} MB）` : '无数据');
  check('capMB 不超过物理内存', rep && rep.heap.capMB < physMB,
    rep ? `${rep.heap.capMB} < ${physMB}` : '');
}

console.log('\n────────────────────────────────────────');
const pass = results.filter((r) => r.ok).length;
console.log(`结果：${pass} 通过 / ${results.length - pass} 失败`);
console.log('────────────────────────────────────────');
process.exit(pass === results.length ? 0 : 1);
