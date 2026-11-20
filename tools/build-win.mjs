// 一键构建：编排资源 → 品牌化 exe → 编译 Windows 安装包
// 用法：node tools/build-win.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NODE = process.execPath;
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const BUILD = path.join(ROOT, 'build');
const ELECTRON_DIR = path.join(BUILD, 'win', 'electron-v33.0.0');
const SRC_EXE = path.join(ELECTRON_DIR, 'electron.exe');
const DST_EXE = path.join(ELECTRON_DIR, 'NeoCosmos.exe');

function run(cmd, args, opts = {}) {
  console.log(`\n> ${path.basename(cmd)} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`✗ 步骤失败（退出码 ${r.status}）`);
    process.exit(r.status || 1);
  }
  return r;
}

// 清理残留进程是**尽力而为**的辅助步骤，绝不该因它失败而中断构建。
// 注意：run() 内部对非 0 退出会直接 process.exit()，try/catch 拦不住，
// 所以这里单独用 spawnSync 吞掉退出码（详见 kill-stale-neolink.mjs 的契约）。
function runBestEffort(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r;
  } catch (e) {
    console.log(`  · 清理步骤异常（非致命）：${e.message}`);
    return null;
  }
}

console.log('════════ NeoLink · Windows 安装包构建 ════════');

// 1) 图标
run(NODE, ['tools/make-icon.mjs', 'desktop/assets']);

// 2) 资源编排
run(NODE, ['tools/stage-app.mjs']);

// 3) 准备可被本机「应用程序控制策略」放行的 exe 供闸门启动
//    本机构建机有一条应用控制策略，按**哈希**放行 electron.exe；
//    而 rebrand（改图标 / 写版本）会改变 exe 哈希，导致被策略拦截、无法启动做审计。
//    因此闸门阶段先用「与 electron.exe 哈希一致的副本」充当 NeoCosmos.exe，
//    供审计 / e2e / 探针启动 —— 应用逻辑与正式品牌化 exe 完全一致，仅缺图标与版本资源；
//    真正的品牌化（换图标 + 写入版本）放到**全部闸门通过之后、编译安装包之前**再做，
//    这样最终分发的安装包里仍是带品牌图标的 exe（用户机器无此策略、或自行放行）。
if (!fs.existsSync(SRC_EXE)) { console.error('✗ 未找到 electron.exe'); process.exit(1); }
fs.copyFileSync(SRC_EXE, DST_EXE);
console.log(`  · 已用 electron.exe 的哈希一致副本作为审计用 NeoCosmos.exe（策略可放行）`);

// 4) UI 审计闸门（构建前必跑）
//    v2.2.0 引入两把闸刀，此前只写了工具却从未接进构建 —— 骨架在、接线丢了
//    （项目历史上同款 bug 已犯两次：左侧栏 is-hidden、CSS2D 标签层）。
//    ① check-ui.mjs    静态审计：引用一致性 + 死按钮扫描
//    ② run-ui-audit.mjs 运行时审计：在真实渲染进程里跑状态矩阵
//       （浅色/深色 × 舒适/紧凑 × 侧栏折叠/展开 × 个人版/企业版），
//       量化"内容裁切 / 元素越界 / 疑似死点击 / 显示值与真实数据不符"。
//    任一把闸刀报出问题即中断构建 —— 闸门不设则形同虚设。
console.log('\n════════ UI 审计闸门 ════════');
// v2.2.1：跑闸门前必须清掉**残留的 NeoLink 进程**。
// 单实例锁是全局的（同一个 userData），用户自己装的那份若正开着，
// 审计脚本拉起的实例会**静默退出**（app.quit，不报任何错）——
// 表现是"审计停在 module-loaded"，看着像产品缺陷，其实是锁被占。
// kill-stale-neolink.mjs 不传参数时会自动从注册表发现安装目录。
{
  const killScript = path.join('tools', 'kill-stale-neolink.mjs');
  // 清理本构建的残留进程（解除单实例锁）—— 尽力而为，失败不阻断构建。
  runBestEffort(NODE, [killScript, path.join(BUILD, 'win', 'electron-v33.0.0', 'NeoCosmos.exe')], { stdio: 'ignore' });
  runBestEffort(NODE, [killScript], { stdio: 'ignore' });
}
run(NODE, ['tools/check-ui.mjs']);
run(NODE, ['tools/run-ui-audit.mjs']);
// 跨库目录树 · 端到端（v2.2.1 新增）
// 这条闸门守住"全部库"视图：跨库树的卡片 id 是按相对路径派生的，
// 两个库里同名同路径的卡片会撞 id —— 一旦哪里漏带 vaultId，
// 就会"点 A 库的卡片、打开 B 库的卡片"，而且**不报任何错**。
// 这类问题只有真的把树点一遍才会暴露，静态审计查不到。
run(NODE, ['tools/e2e-allvaults.mjs']);
// v2.2.1：系统盘旧默认库「退役」验证（新增闸门）。
// 这条守住用户诉求「不能默认C盘」的最后一环：
// 用户把库搬到 D 盘后，C 盘那个由客户端自动播种的空壳若还占着 activeId，
// 每次启动都会被拉回系统盘 —— 用户手工删过，客户端下次启动又原样建回来。
// 判定必须精确，所以测试同时验证**用户的真库不会被误伤**。
run(NODE, ['tools/e2e-retire-vault.mjs']);
// v2.2.3：星图切库 · 刷新 / 不频闪 / 标签三态（新增闸门）。
// 这条守住用户在标题栏切库后的三件事：
//   ① 星图必须**及时**刷新成新库（铭牌、节点、标签都要跟着换）；
//   ② 切库过程**不能频闪** —— 场景反复重建、或出现"容器里一个 canvas 都没有"
//      的空窗，都会让画面闪白/闪黑；
//   ③ 标签必须能「全部显示 / 全部隐藏」—— 原来只有开/关两态，
//      而且"开"其实有距离预算上限，用户看到的不是"全都显示"。
// 这类问题全是运行时行为，静态审计查不出来，只能真的切一次库。
//
// ⚠ 跑之前必须清掉残留实例：客户端是**单实例**的，
//   上一个实例还活着时新实例会直接退出（表现为"审计停在 module-loaded"，
//   看着像产品缺陷，其实是锁被占）。
{
  const killScript = path.join('tools', 'kill-stale-neolink.mjs');
  // 清理本构建的残留进程（解除单实例锁）—— 尽力而为，失败不阻断构建。
  runBestEffort(NODE, [killScript, path.join(BUILD, 'win', 'electron-v33.0.0', 'NeoCosmos.exe')], { stdio: 'ignore' });
  runBestEffort(NODE, [killScript], { stdio: 'ignore' });
}
run(NODE, ['tools/run-probe.mjs', 'tools/probe-graph-refresh.js']);
// v2.3.0：关闭确认闸门 —— 守住「点右上角关闭必须弹确认框」。
// 这条守两件事：
//   ① 点标题栏 X **必须弹框**，不能是一键静默关闭；
//   ② 有未保存修改时，弹框文案必须**如实说明会丢失**，并点名是哪张卡片
//      （文案不实等于没提示 —— 用户以为内容还在，关掉就丢了）。
// 这是纯运行时行为，静态审计查不出。
run(NODE, ['tools/run-probe.mjs', 'tools/probe-close-confirm.js']);
// v2.2.2：快捷方式图标闸门 —— 守住"桌面图标显示白板"。
// 根因：IconLocation 写成「含中文的路径,0」时，Windows 解析"路径,索引"
// 会把索引算进路径，路径失效 → 静默退化成白色空白文档图标，**不报任何错**。
// 闸门在真实机器上核对桌面快捷方式的图标字段，并让 Windows 自己把图标提取成
// PNG —— 两项都过，才算图标这一环真的没问题。
{
  const desk = path.join(os.homedir(), 'Desktop', 'NeoCosmos.lnk');
  if (fs.existsSync(desk)) {
    // 不传第二个参数 —— 让闸门自己从 .lnk 的 IconLocation 解析目标 exe。
    // 桌面快捷方式指向的是**用户安装目录**那份，与构建目录里的不是同一个文件，
    // 拿后者去比对会误报（闸门曾因此把构建卡住）。
    run(NODE, ['tools/check-shortcut-icon.mjs', desk]);
  } else {
    console.log('  · 桌面快捷方式不存在，跳过图标闸门');
  }
}

// 4.5) 品牌化 exe（换图标 + 写入版本）—— 必须在**所有闸门之后**
//    闸门期间启动的 NeoCosmos.exe 必须是策略可放行的「electron.exe 哈希一致副本」，
//    品牌化会改变哈希、被应用控制策略拦截，故放到闸门全过、编译安装包之前。
//    这样最终分发的安装包里是带品牌图标的 exe，而构建期间的审计仍能在策略下跑通。
run(NODE, ['tools/rebrand-exe.mjs', SRC_EXE, DST_EXE, path.join(ROOT, 'desktop', 'assets', 'icon.ico')]);
// v2.2.1：**图标唯一真相源校验**。
// 桌面快捷方式现在指向 `NeoCosmos.exe,0`，也就是 exe 内嵌的图标 —— 这就要求
// exe 里的图标必须与 desktop/assets/icon.ico **逐字节同源**。
// 一旦有人只改了 ico 忘了重新品牌化 exe（或者反之），桌面就会显示旧图标，
// 而两边"看起来都有图标"，极难察觉。这里在构建时把它钉死。
run(NODE, ['tools/verify-exe-icon.mjs', DST_EXE, path.join(ROOT, 'desktop', 'assets', 'icon.ico')]);

// 5) 编译安装包
fs.mkdirSync(path.join(BUILD, 'dist'), { recursive: true });
const MAKENSIS = path.join(BUILD, 'nsis', 'nsis-3.10', 'Bin', 'makensis.exe');
if (!fs.existsSync(MAKENSIS)) { console.error('✗ 未找到 makensis.exe'); process.exit(1); }
// v2.2.1：MSYS_NO_PATHCONV=1 —— Git Bash 会把 "/V2" 这样的参数
// 转换成 Windows 路径（"/V2" → "D:/.../PortableGit/V2"），
// makensis 于是报 "Can't open script"，看起来像构建失败。
// 这个环境变量让 Git Bash 别做路径转换。
run(MAKENSIS, ['/V2', path.join('tools', 'installer.nsi')], {
  env: { ...process.env, MSYS_NO_PATHCONV: '1' },
});

// 6) 汇总
const dist = path.join(BUILD, 'dist');
console.log('\n════════ 构建完成 ════════');
for (const f of fs.readdirSync(dist)) {
  const st = fs.statSync(path.join(dist, f));
  console.log(`  ${f.padEnd(34)} ${(st.size / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`\n输出目录：${dist}`);
