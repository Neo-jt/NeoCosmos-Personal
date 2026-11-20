// exe 品牌化：把 electron.exe 变成 NeoCosmos.exe（换图标 + 写入版本信息 + 资源覆写）
// 使用纯 JS 的 PE 资源编辑器 resedit，不依赖任何外部二进制（如 rcedit）。
// v1.1.0：版本号从 desktop/package.json 读取（单一版本源）。
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE_MODULES = path.join(here, '..', 'build', 'node_modules');

async function imp(spec) {
  const base = path.join(NODE_MODULES, spec);
  const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  const entry = pkg.module || pkg.main || 'index.js';
  return import(pathToFileUrl(path.join(base, entry)));
}
function pathToFileUrl(p) { return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, ''); }

const [, , srcExe, dstExe, iconPath, editionArg] = process.argv;
if (!srcExe || !dstExe || !iconPath) {
  console.error('用法: node tools/rebrand-exe.mjs <src electron.exe> <dst.exe> <icon.ico> [both|personal|enterprise]');
  process.exit(1);
}
// v6.40.0 合规拆分：个人版 / 企业版 exe 写入独立产品名与版权署名。
const EDITION = ['personal', 'enterprise'].includes(editionArg) ? editionArg : 'both';
const EXE_META = {
  both: {
    fileDesc: 'NeoCosmos · 突触式知识网络',
    product: 'NeoCosmos',
    copyright: `Copyright © ${'宋锦涛'} · ${'13869162267'}`,
    original: 'NeoCosmos.exe',
    internal: 'NeoCosmos',
  },
  personal: {
    fileDesc: 'NeoCosmos 个人版 · 关系优先的知识网络（AGPL-3.0）',
    product: 'NeoCosmos Personal',
    copyright: 'Copyright © 宋锦涛 · AGPL-3.0 · 商用须授权',
    original: 'NeoCosmosPersonal.exe',
    internal: 'NeoCosmosPersonal',
  },
  enterprise: {
    fileDesc: 'NeoCosmos 企业版 · 知识管理与协作（专有商用）',
    product: 'NeoCosmos Enterprise',
    copyright: `Copyright © 宋锦涛 · ${'13869162267'} · 专有商用`,
    original: 'NeoCosmosEnterprise.exe',
    internal: 'NeoCosmosEnterprise',
  },
}[EDITION];

// 版本与署名单一来源：desktop/package.json
let APP_VERSION = '2.2.0';
let APP_AUTHOR = '宋锦涛';
let APP_CONTACT = '13869162267';
try {
  const pkgPath = path.resolve(here, '..', 'desktop', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  APP_VERSION = pkg.version || APP_VERSION;
  APP_AUTHOR = pkg.author || APP_AUTHOR;
  APP_CONTACT = pkg.contact || APP_CONTACT;
} catch { /* 保留默认 */ }
const [V1, V2, V3] = String(APP_VERSION).split('.').map((x) => parseInt(x, 10) || 0);

const PELibrary = await imp('pe-library');
const ResEdit = await imp('resedit');

console.log('=== exe 品牌化 ===');
const exeBuf = fs.readFileSync(srcExe);
console.log(`  读取 ${srcExe} (${(exeBuf.length / 1024 / 1024).toFixed(1)} MB)`);

const exe = PELibrary.NtExecutable.from(exeBuf);
const res = PELibrary.NtExecutableResource.from(exe);

// --- 图标组 ---
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
const iconItems = iconFile.icons.map((item) => item.data);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 0x409, iconItems);
console.log(`  图标组已替换：${iconItems.length} 个尺寸`);

// --- 版本信息 ---
const existing = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const vi = existing && existing.length ? existing[0] : ResEdit.Resource.VersionInfo.createEmpty();
const strings = {
  FileDescription: EXE_META.fileDesc,
  FileVersion: APP_VERSION,
  ProductName: EXE_META.product,
  ProductVersion: APP_VERSION,
  CompanyName: APP_AUTHOR,
  LegalCopyright: EXE_META.copyright,
  OriginalFilename: path.basename(dstExe),
  InternalName: EXE_META.internal,
};
vi.setStringValues({ lang: 0x409, codepage: 1200 }, strings, true);
if (typeof vi.setFileVersion === 'function') vi.setFileVersion(V1, V2, V3, 0, 0x409);
if (typeof vi.setProductVersion === 'function') vi.setProductVersion(V1, V2, V3, 0, 0x409);
vi.lang = 0x409;
vi.outputToResourceEntries(res.entries);
console.log(`  版本信息已写入：${EXE_META.product} ${APP_VERSION}`);

res.outputResource(exe);
const out = Buffer.from(exe.generate());
fs.writeFileSync(dstExe, out);
console.log(`? 已生成 ${dstExe} (${(out.length / 1024 / 1024).toFixed(1)} MB)`);
