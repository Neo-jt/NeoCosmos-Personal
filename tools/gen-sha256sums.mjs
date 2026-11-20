// 生成对外分发的 SHA256SUMS.txt（安装包校验）。
// 用法：node tools/gen-sha256sums.mjs
//   读取 build/dist/ 下当前版本的所有 Setup.exe，输出 SHA256SUMS.txt 到项目根与交付目录。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'build', 'dist');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version;

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

const files = fs.readdirSync(DIST)
  .filter((f) => f.endsWith(`-${VER}-Setup.exe`))
  .sort();
if (!files.length) {
  console.error(`✗ build/dist 下没有版本 ${VER} 的安装包`);
  process.exit(1);
}

const lines = [
  `# NeoCosmos ${VER} 安装包 SHA-256 校验值`,
  '# 校验方法（Windows PowerShell）：Get-FileHash <文件> -Algorithm SHA256',
  '# 校验方法（Linux/macOS）：sha256sum <文件>',
  '',
  ...files.map((f) => `${sha256(path.join(DIST, f))}  ${f}`),
  '',
];
const content = lines.join('\n');
for (const out of [path.join(ROOT, 'SHA256SUMS.txt'), path.join(ROOT, '交付', 'SHA256SUMS.txt')]) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content, 'utf8');
  console.log(`✓ ${path.relative(ROOT, out)}`);
}
console.log(content);
