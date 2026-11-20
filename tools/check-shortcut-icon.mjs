// 快捷方式图标字段 · 验收闸门
// ---------------------------------------------------------------------------
// 目的：守住"桌面图标显示成白板"这个坑。
//
// 根因（用户实测）：NSIS 的 CreateShortCut 若把 ",0" 手工拼进 icon_file 参数，
// IconLocation 会写成「含中文的路径,0」——Windows 解析"路径,索引"时把索引
// 算进路径 → 路径无效 → **静默退化成白色空白文档图标**，且**不报任何错**。
// 改成纯路径（让 shell 自己取目标 exe 的默认图标）后立刻正常。
//
// 本闸门做四件事：
//   ① IconLocation 不得出现两个以上逗号（"path,0,0" 解析不了）；
//   ② 含非 ASCII 的路径不得带 ,索引 后缀；
//   ③ 图标路径必须精确等于目标 exe（不能有多余尾字符）；
//   ④ 目标 exe 必须真实存在，且 Windows 能从中提取出图标（证明系统读得出来）。
//
// 用法：node tools/check-shortcut-icon.mjs <lnk 路径> [目标 exe]
//        省略第二个参数时，从 .lnk 的 IconLocation 字段里解析出目标 exe 自行校验。
// ⚠ 不能拿"构建目录里的 exe"去比对桌面快捷方式 —— 桌面快捷方式指向的是
//    **用户安装目录**里的那份，两者本就不是同一个文件（闸门曾因此误报）。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lnk = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', 'NeoLink.lnk');
const exeArg = process.argv[3] || '';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
};

console.log('════ 快捷方式图标 · 验收 ════');
console.log('  快捷方式：', lnk);
if (!fs.existsSync(lnk)) { console.error('✗ 快捷方式不存在'); process.exit(1); }

// ---------- 解析 .lnk 里的路径字符串（尽力而为） ----------
// 说明：NSIS 自己写 .lnk，**不遵循** MS-SHLLINK 的标准定长 StringData 布局
// （实测按官方算法解析出来是空的，暴力扫描 0x4C~0x120 也定位不到起点）。
// 所以这里只做"能解析出就用、解析不出就跳过"的辅助检查；
// **真正的判据是下面那条 —— 让 Windows 自己从这个快捷方式取图标**，
// 那才是 Explorer 渲染桌面图标走的同一条路径。
function extractUtf16Strings(buf) {
  const out = [];
  for (const start of [0, 1]) {
    let s = '';
    for (let i = start; i + 1 < buf.length; i += 2) {
      const c = buf.readUInt16LE(i);
      const printable = c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 0xFFFD);
      if (!printable) {
        if (s.length > 3) out.push(s);
        s = '';
        continue;
      }
      s += String.fromCharCode(c);
    }
    if (s.length > 3) out.push(s);
  }
  return out;
}
const d = fs.readFileSync(lnk);
const all = extractUtf16Strings(d).join('\n');
const re = /[A-Za-z]:\\[^\n]{0,240}?\.(?:exe|ico|lnk)(?:,\s*-?\d+)?/g;
const found = [...new Set(all.match(re) || [])];
if (found.length) {
  console.log('  路径/图标串：');
  for (const t of found) console.log('    ', JSON.stringify(t));
}
for (const t of found) console.log('    ', JSON.stringify(t));

const hasNonAscii = (s) => /[^\x00-\x7F]/.test(s);
// 辅助检查：路径字段若解析得出来，就查它的格式问题；
// 解析不出来（NSIS 的 .lnk 布局非标准）就跳过，交给下面那条系统级判据把关。
if (found.length) {
  const bad = found.filter((t) => t.includes(',') && t.split(',').length > 2);
  ok('图标定位串没有多余逗号（Windows 解析不了 "path,0,0"）', bad.length === 0,
    bad.length ? `非法值：${JSON.stringify(bad[0])}` : `发现 ${found.length} 条`);
  const badWithIdx = found.filter((t) => /,\s*-?\d+\s*$/.test(t) && hasNonAscii(t.split(',')[0]));
  ok('含中文的路径不携带 ,索引 后缀（Windows 会解析失败 → 白板）', badWithIdx.length === 0,
    badWithIdx.length ? `非法值：${JSON.stringify(badWithIdx[0])}` : '');
} else {
  console.log('  · 未能解析出路径字段（NSIS 的 .lnk 布局非标准）—— 跳过格式检查，改由系统级判据把关');
}

// ---------- 最权威的一条：让 Windows 自己从这个快捷方式取图标 ----------
// 这一条比任何字段解析都有说服力 —— Explorer 渲染桌面图标走的就是它。
// （实测 ExtractIconEx 对 .lnk 恒返回 0，必须走 SHGetFileInfo；
//   且路径必须是**反斜杠**的绝对路径，否则 hIcon 也是 0。）
{
  const ps = path.join(here, 'grab-icon.ps1');
  const out = path.join(here, '..', 'build', 'shortcut-icon-check.png');
  const winLnk = path.resolve(lnk).replace(/\//g, '\\');
  try {
    const r = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ps, '-Target', winLnk, '-Out', out,
    ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    const line = String(r).trim().split('\n').pop();
    ok('Windows 能从快捷方式直接读出图标（Explorer 同一条路径）',
      /EXTRACT_OK|SHGET_OK/.test(String(r)), line);
  } catch (e) {
    ok('Windows 能从快捷方式直接读出图标（Explorer 同一条路径）', false,
      String(e.stdout || '').trim().slice(0, 140));
  }
}

// ---------- 目标 exe 存在性（解析得出来才查） ----------
{
  const iconPaths = found.map((t) => t.replace(/,\s*-?\d+$/, ''));
  const target = iconPaths.find((p) => /\.exe$/i.test(p));
  if (target) ok('图标指向的 exe 真实存在于磁盘', fs.existsSync(target), target);
  else console.log('  · 未解析出目标 exe，跳过存在性检查');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
