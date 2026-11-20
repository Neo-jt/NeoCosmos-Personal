// v6.9.0 · QS-Shield 跨运行时 Keccak 兼容层契约测试
// ---------------------------------------------------------------------------
// 背景：Electron 33 链接 BoringSSL，sha3-256 / shake256 / HMAC-SHA3-256 一律
// 抛 "Digest method not supported"；构建期用系统 Node（OpenSSL）则一切正常。
// 于是「构建期生成的完整性基线，在正式客户端里根本验不了」，且 sign/verify、
// deriveKey、seal/open 全部空转。修复方式是在原生摘要不可用时切到纯 JS Keccak。
//
// 本测试的核心义务：**证明两条路径逐字节等价**。只要有一字节不同，
// 正式客户端就会把正确的基线判成篡改。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = path.join(ROOT, 'desktop', 'security', 'quantum-safe.js');
const req = createRequire(import.meta.url);
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name} ${extra}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}

// 同一份 CJS 源码，用环境变量切换摘要后端后重新 require（清缓存）
function load(forceJs) {
  if (forceJs) process.env.NEOLINK_QS_FORCE_JS = '1';
  else delete process.env.NEOLINK_QS_FORCE_JS;
  delete req.cache[req.resolve(MOD)];
  return req(MOD);
}

const native = load(false);
const js = load(true);
ok('系统 Node 走 openssl-native 快路径', native.status().digestBackend === 'openssl-native');
ok('强制切换后走 keccak-js 纯 JS 路径', js.status().digestBackend === 'keccak-js');
ok('原生 SHA3 探测结果与环境一致', (() => {
  try { crypto.createHash('sha3-256').digest(); return true; } catch { return false; }
})() === (native.status().digestBackend === 'openssl-native'));

// ── 1) 与 Node/OpenSSL 的标准向量逐字节比对 ────────────────────────────────
console.log('\n[1] FIPS 202 已知答案向量');
ok('SHA3-256("") 标准向量',
  js.sha3(Buffer.alloc(0)).toString('hex') ===
  'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a');
ok('SHA3-256("abc") 标准向量',
  js.sha3(Buffer.from('abc')).toString('hex') ===
  '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
ok('SHAKE256("") 前 32 字节与 Node 一致',
  js.shake(Buffer.alloc(0), 32).equals(
    crypto.createHash('shake256', { outputLength: 32 }).update(Buffer.alloc(0)).digest()));
ok('原生路径与 Node 一致（回归对照）',
  native.sha3(Buffer.from('abc')).toString('hex') ===
  '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');

// ── 2) 长度覆盖：空 / 单字节 / rate-1 / rate / rate+1 / 跨块 / 二进制 ────
console.log('\n[2] 分块边界与二进制输入');
const vectors = [];
for (const n of [0, 1, 2, 31, 32, 135, 136, 137, 271, 272, 273, 1000]) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
  vectors.push(b);
}
vectors.push(Buffer.from('精密静谧 · AURORA · 中文 UTF-8', 'utf8'));
vectors.push(Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x0a, 0x0d]));
let sha3All = true, shakeAll = true, hmacAll = true;
for (const v of vectors) {
  if (!js.sha3(v).equals(crypto.createHash('sha3-256').update(v).digest())) sha3All = false;
  for (const len of [1, 16, 32, 64, 200]) {
    if (!js.shake(v, len).equals(crypto.createHash('shake256', { outputLength: len }).update(v).digest())) shakeAll = false;
  }
  for (const k of [Buffer.alloc(0), Buffer.from('k'), Buffer.alloc(135, 0xa5), Buffer.alloc(136, 0x5a), Buffer.alloc(200, 0x33)]) {
    if (!js.hmac(k, v).equals(crypto.createHmac('sha3-256', k).update(v).digest())) hmacAll = false;
  }
}
ok(`SHA3-256 跨 ${vectors.length} 组向量（含 135/136/137 分块边界）`, sha3All);
ok('SHAKE256 跨块挤压（含 len=200 > rate）', shakeAll);
ok('HMAC-SHA3-256 短键 / 长键 / 超 rate 键', hmacAll);
ok('两后端 SHA3 / SHAKE / HMAC 一致',
  vectors.every((v) => js.sha3(v).equals(native.sha3(v)) &&
    js.shake(v, 64).equals(native.shake(v, 64)) &&
    js.hmac(Buffer.from('key'), v).equals(native.hmac(Buffer.from('key'), v))));

// ── 3) 派生密钥 / 加解密封装跨后端互操作 ──────────────────────────────────
console.log('\n[3] deriveKey / seal / open 互操作');
const seed = Buffer.alloc(32, 0x7c);
ok('deriveKey 两后端逐字节一致（含 length 跨块）',
  js.deriveKey(seed, 'integrity-baseline', 32).equals(native.deriveKey(seed, 'integrity-baseline', 32)) &&
  js.deriveKey(seed, 'stream', 200).equals(native.deriveKey(seed, 'stream', 200)));
const key = js.deriveKey(seed, 'aes', 32);
const plain = Buffer.from('QS-Shield 跨运行时封装验证 · 2026-11-05');
ok('js.seal → native.open 可解开', (() => {
  const r = native.open(js.seal(plain, key), key);
  return !!r && r.equals(plain);
})());
ok('native.seal → js.open 可解开', (() => {
  const r = js.open(native.seal(plain, key), key);
  return !!r && r.equals(plain);
})());
ok('篡改密文后认证失败（GCM tag 仍有效）', js.open(
  (() => { const s = native.seal(plain, key); s.data = '00' + s.data.slice(2); return s; })(), key) === null);

// ── 4) QS-WOTS 签名跨后端互验（最吃哈希性能的路径） ───────────────────────
console.log('\n[4] QS-WOTS 签名跨运行时互验');
const msg = Buffer.from('{"q":"引用可溯源","a":"沉淀记录"}');
const sigFromNative = native.sign(msg);
const sigFromJs = js.sign(msg);
ok('原生签名 → 纯 JS 验签通过', js.verify(msg, sigFromNative).ok === true);
ok('纯 JS 签名 → 原生验签通过', native.verify(msg, sigFromJs).ok === true);
ok('签名摘要与原生 SHA3 一致', sigFromJs.digest === crypto.createHash('sha3-256').update(msg).digest('hex'));
ok('篡改消息后验签失败', js.verify(Buffer.from('{"q":"篡改"}'), sigFromNative).ok === false);
ok('一次性公钥根被记录', js.hasSeenRoot(sigFromJs.root));

// ── 5) 完整性哈希链：构建期基线 → 客户端校验 ──────────────────────────────
console.log('\n[5] 完整性基线跨后端');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-keccak-'));
try {
  const files = ['a.bin', 'b.bin', 'c.bin'];
  files.forEach((f, i) => fs.writeFileSync(path.join(tmp, f), Buffer.alloc(100 + i * 37, i + 1)));
  const manifest = native.buildManifest(tmp, '6.9.0', files);
  const r1 = js.verifyManifest(tmp, manifest);
  ok('原生 buildManifest → 纯 JS verifyManifest 通过（真实客户端路径）',
    r1.ok === true && r1.checked === 3 && r1.rootMatch === true, `(ok=${r1.ok})`);
  const r2 = native.verifyManifest(tmp, js.buildManifest(tmp, '6.9.0', files));
  ok('纯 JS buildManifest → 原生 verifyManifest 通过', r2.ok === true);
  fs.writeFileSync(path.join(tmp, 'b.bin'), Buffer.alloc(137, 0xff));
  const r3 = js.verifyManifest(tmp, manifest);
  ok('文件被改动时精确定位到 b.bin（不是级联误报）',
    r3.ok === false && r3.mismatches.length === 1 && r3.mismatches[0].path === 'b.bin');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// ── 6) 真实 Electron 运行时：纯 JS 后端必须自动激活 ────────────────────────
console.log('\n[6] Electron / BoringSSL 实机');
const electronExe = path.join(ROOT, 'build', 'win', 'electron-v33.0.0', 'electron.exe');
if (fs.existsSync(electronExe)) {
  try {
    const script = `const Q=require(${JSON.stringify(MOD)});process.stdout.write(JSON.stringify({backend:Q.status().digestBackend,h:Q.sha3(Buffer.from('abc')).toString('hex')}))`;
    const out = execFileSync(electronExe, ['-e', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000,
    }).trim();
    const r = JSON.parse(out);
    ok('Electron 运行时自动切换 keccak-js（不再抛 Digest method not supported）', r.backend === 'keccak-js', `(${r.backend})`);
    ok('Electron 下 SHA3-256 输出与 OpenSSL 完全一致',
      r.h === '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532');
  } catch (e) { ok('Electron 运行时探测', false, String(e && e.message || e).slice(0, 160)); }
} else {
  console.log('  [SKIP] 未找到 electron.exe，跳过实机探测');
}

console.log(`\nQS-Shield 跨运行时 Keccak 兼容层：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
