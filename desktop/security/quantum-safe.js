'use strict';
// ===========================================================================
// NeoCosmos · QS-Shield —— 原创「抗量子（Quantum-Safe / 后量子）」防护层
// ---------------------------------------------------------------------------
// 【诚实边界 · 必读】
//  本模块**不实现量子计算，也不实现 QKD（量子密钥分发）**。二者分别需要量子
//  处理器与专用量子通信信道，纯软件、离线、零依赖的本地客户端不具备；任何
//  相反宣称都是虚构。它也**不宣称等同** NIST ML-KEM / ML-DSA / SLH-DSA 标准
//  实现 —— 那需要完整的标准化工程与第三方验证。
//
//  本模块实现的是「后量子 / 抗量子密码学」：只依赖哈希单向性与对称加密的
//  算法，在量子攻击者模型下（Grover 仅提供平方根加速）仍保有安全强度：
//    · SHA3-256 / SHAKE256（Keccak，NIST FIPS 202）
//    · QS-WOTS：W-OTS 风格的哈希一次性签名（仅依赖哈希前像抗性）
//    · AES-256-GCM（量子下约 128-bit 安全）
//  全部由本项目从零手写，无任何第三方密码库。
//
//  防逆向同样如实：Electron 应用的 JS 可被解包，「绝对不可逆向」不存在。
//  本层做到的是：敏感密钥不落盘、运行时完整性自检（发现非预期改动即降级）、
//  调试器附加即降级、沉淀记录可验证不可抵赖 —— 显著提高逆向与篡改成本。
//  处置策略恒为「降级」而非自杀：不制造可被远程触发的拒绝服务。
// ===========================================================================

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUITE_ID = 'NeoCosmos/QS-Shield/1';
const DOMAIN = Buffer.from(SUITE_ID, 'utf8');
const N = 32;                              // SHA3-256 输出字节
const WINTERNITZ = 16;                     // 每链基数（1 nibble / 链）
const CHAIN_LEN = WINTERNITZ - 1;          // 最大链长 15
const DIGEST_NIBBLES = N * 2;              // 64
const CHECKSUM_NIBBLES = 3;                // sum(15-d) ≤ 960 < 16^3
const CHAINS = DIGEST_NIBBLES + CHECKSUM_NIBBLES; // 67 条链

const INTEGRITY_FILES = [
  'security/quantum-safe.js',
  'main.js',
  'preload.js',
  'ui/app.js',
  'ui/views/enterprise.js',
  'src/mcp/tools.js',
  'src/storage/store.js',
  // v6.3.0：类脑认知内核纳入同一条 SHA3 完整性哈希链（防篡改、可精确定位）
  'src/cognition/anatomy.js',
  'src/cognition/index.js',
  'src/cognition/council.js',
  'src/cognition/calibration.js',
  'src/cognition/workflow.js',
  'src/cognition/connectome-activation.js',
  'src/cognition/legal-mind.js',
  'src/cognition/organism.js',
  // v6.29.0 功能①②：辅助建关联模块 + 回流关联落点纳入同一条 SHA3 完整性哈希链
  'src/cognition/link-recommender.js',
  // v6.30.0 原创 RAM 关联模型：定义 / 可信加载器 / 真实训练权重纳入哈希链，
  // 与 relational-runtime 的 modelHash 校验形成双保险，权重被篡改必被检出。
  'src/cognition/relational-model.js',
  'src/cognition/relational-runtime.js',
  'assets/_model/relational-model.json',
  // v6.31.0 NeoLM：模型内核、运行时与训练产物清单纳入 SHA3 链。
  // 两个 750 MiB 权重不重复纳入（避免每次启动校验 1.5 GiB）：它们的逐字节
  // SHA-256 记在 manifest 里，由 runtime.verify() 按需全量复核，等效可检出篡改。
  'src/cognition/neolm/core.js',
  'src/cognition/neolm/runtime.js',
  'assets/_model/neolm/neolm.manifest.json',
  'assets/_model/neolm/neolm.vocab.json',
  'ui/views/neolm.js',
  // v6.32.0：语义回流层内核与新视图纳入同一条 SHA3 链 ——
  // 它们决定「模型是否真的参与调取/沉淀/库关联」以及「确认按钮是否真的建边」。
  'src/cognition/semantic-bridge.js',
  'ui/views/semantic-bridge.js',
  'ui/views/relations.js',
  'ui/views/ask.js',
  'ui/views/mind3d.js',
  'ui/brain3d.js',
  // v6.16：第三代设计层、能力中枢与深度数学内核纳入同一条哈希链
  'ui/northstar.css',
  'ui/views/capabilities.js',
  'astra/astra-mind.js',
  'astra/deep-math.cjs',
  // v6.21.0：第四代视觉层及其开关控制器纳入同一条哈希链
  // （CSS 漏了会静默退回旧观感；控制器漏了「一键回退」就成了空承诺）
  'ui/neocosmos-v2.css',
  'ui/appearance.js',
  // v6.22.0：链接管理的真实日志模块与视图纳入同一条哈希链
  // （日志模块若被替换，IP / 调用次数就可能变成编造值，必须可检出）
  'connection-log.cjs',
  'ui/views/connections.js',
  // v6.23.0：作用域模块决定「哪些库可被连接」，沉淀台决定「回写落到哪个库」，
  // 两者被篡改都可能让连接与回写悄悄偏离用户选择，纳入同一条哈希链。
  'vault-scope.cjs',
  'ui/views/settle.js',
  // v6.27.0：语义配色单一真源被 8 个视图共同 import，替换它会让全站配色漂移，
  // 漏拷会让多个页面同时白屏 —— 纳入同一条 SHA3 哈希链。
  'ui/semantic-palette.js',
  // v6.35.0：三项导航的设置页、星位坐标布局、移除接入墓碑逻辑纳入同一条哈希链。
  // 篡改 cosmos.js 可伪造星位坐标；篡改 mcp-links.cjs 可绕过"移除接入"防复活门禁。
  'ui/views/settings.js',
  'ui/cosmos.js',
  'mcp-links.cjs',
  // v10.18.7：启用库白名单是本版"外部 AI 只读启用库"的安全边界，
  // 视图层总览重设计与跨库检索同属对外可见的关键逻辑 —— 一并纳入 SHA3 哈希链。
  // 篡改任一文件都可能让"停用库"静默重新对外可见，必须可检出。
  'ui/views/explorer.js',
  'ui/views/vault-overview.js',
  'src/mcp/server.js',
  'src/mcp/protocol.js',
  'src/mcp/hosts.js',
  'src/mcp/link-bridge.js',
];

let signatureCounter = 0;
const usedRoots = new Set();

// ---------------------------------------------------------------------------
// 基础原语（v6.9.0：跨运行时 Keccak 兼容层）
// ---------------------------------------------------------------------------
// 真机探针抓到的重大缺陷：构建期用系统 Node（OpenSSL），SHA3-256 / SHAKE256 /
// HMAC-SHA3-256 都可用；但 Electron 33 链接的是 **BoringSSL**，这三个摘要全部
// 抛 "Digest method not supported"（实测 `process.versions.openssl === '0.0.0'`）。
// 后果不是「降级」这么简单：qsBootstrap 的 verifyManifest 会抛异常被吞成
// manifest_unreadable，sign/verify/seal/open/deriveKey 也全部不可用——
// 整个 QS-Shield 在正式客户端里是空转的，而构建期的测试永远发现不了。
//
// 处置：保留原生快路径（Node/OpenSSL），运行时探测能力，缺失时切到下面这份
// 从零手写的 Keccak-f[1600] 纯 JS 实现（FIPS 202：SHA3-256 / SHAKE256，
// rate=136 字节，域分隔 0x06 / 0x1f，pad10*1）。两条路径输出**必须逐字节
// 一致**，否则构建期生成的完整性基线在客户端里就验不过；一致性由
// test/qs-keccak-fallback.test.mjs 用多组向量双向比对固化。
// 不引入任何第三方依赖，符合本模块「零依赖手写」的既有约束。
// 64 位轮常数写成 BigInt 便于核对 FIPS 202 原表，初始化时拆成高低 32 位；
// 置换本身用 32 位整数对完成（BigInt 版实测 QS-WOTS 签名要 700ms，会卡住
// Electron 主进程；32 位版约快一个数量级，且输出逐字节相同）。
const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RC_HI = KECCAK_RC.map((v) => Number((v >> 32n) & 0xffffffffn) >>> 0);
const RC_LO = KECCAK_RC.map((v) => Number(v & 0xffffffffn) >>> 0);
// r[x][y]：Rho 步每道的循环左移量
const KECCAK_ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
// 把 (hi:lo) 这个 64 位字循环左移 r 位，返回 [hi, lo]（均为 32 位模式）
function rotl64pair(hi, lo, r) {
  hi >>>= 0; lo >>>= 0;
  if (r === 0) return [hi, lo];
  if (r === 32) return [lo, hi];
  if (r < 32) {
    return [((hi << r) | (lo >>> (32 - r))) >>> 0, ((lo << r) | (hi >>> (32 - r))) >>> 0];
  }
  const s = r - 32;
  return [((lo << s) | (hi >>> (32 - s))) >>> 0, ((hi << s) | (lo >>> (32 - s))) >>> 0];
}
// SH/SL：25 条 64 位 lane 的高 / 低 32 位。JS 位运算结果带符号，但全程只做
// ^ & ~ << >>>，位模式一致；取字节时统一用 >>> 还原无符号，故不影响结果。
function keccakF(SH, SL) {
  const CH = new Array(5), CL = new Array(5);
  const BH = new Array(25), BL = new Array(25);
  for (let round = 0; round < 24; round++) {
    // Theta
    for (let x = 0; x < 5; x++) {
      CH[x] = SH[x] ^ SH[x + 5] ^ SH[x + 10] ^ SH[x + 15] ^ SH[x + 20];
      CL[x] = SL[x] ^ SL[x + 5] ^ SL[x + 10] ^ SL[x + 15] ^ SL[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const d = rotl64pair(CH[(x + 1) % 5], CL[(x + 1) % 5], 1);
      const DH = CH[(x + 4) % 5] ^ d[0];
      const DL = CL[(x + 4) % 5] ^ d[1];
      for (let y = 0; y < 5; y++) { SH[x + 5 * y] ^= DH; SL[x + 5 * y] ^= DL; }
    }
    // Rho + Pi：B[y][(2x+3y)%5] = ROT(A[x][y], r[x][y])
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const dst = y + 5 * ((2 * x + 3 * y) % 5);
        const r = rotl64pair(SH[x + 5 * y], SL[x + 5 * y], KECCAK_ROT[x][y]);
        BH[dst] = r[0]; BL[dst] = r[1];
      }
    }
    // Chi
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const i = x + 5 * y;
        const i1 = ((x + 1) % 5) + 5 * y;
        const i2 = ((x + 2) % 5) + 5 * y;
        SH[i] = BH[i] ^ (~BH[i1] & BH[i2]);
        SL[i] = BL[i] ^ (~BL[i1] & BL[i2]);
      }
    }
    // Iota
    SH[0] ^= RC_HI[round];
    SL[0] ^= RC_LO[round];
  }
}
function keccakSponge(input, suffix, outLen) {
  const RATE = 136;                       // SHA3-256 / SHAKE256 的 bitrate 均为 1088 bit
  const SH = new Array(25).fill(0);
  const SL = new Array(25).fill(0);
  const msg = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const absorb = (block) => {
    for (let i = 0; i < RATE / 8; i++) {
      const o = i * 8;
      SL[i] ^= (block[o] | (block[o + 1] << 8) | (block[o + 2] << 16) | (block[o + 3] << 24)) >>> 0;
      SH[i] ^= (block[o + 4] | (block[o + 5] << 8) | (block[o + 6] << 16) | (block[o + 7] << 24)) >>> 0;
    }
    keccakF(SH, SL);
  };
  let off = 0;
  while (msg.length - off >= RATE) { absorb(msg.subarray(off, off + RATE)); off += RATE; }
  const last = Buffer.alloc(RATE);
  msg.copy(last, 0, off);
  last[msg.length - off] = suffix;       // pad10*1：域分隔字节
  last[RATE - 1] |= 0x80;                // 末位补 1；恰在末字节时与 suffix 合并
  absorb(last);
  const out = Buffer.alloc(outLen);
  let done = 0;
  while (done < outLen) {
    for (let i = 0; i < RATE / 8 && done < outLen; i++) {
      const lo = SL[i] >>> 0, hi = SH[i] >>> 0;
      const bytes = [lo & 255, (lo >>> 8) & 255, (lo >>> 16) & 255, (lo >>> 24) & 255,
        hi & 255, (hi >>> 8) & 255, (hi >>> 16) & 255, (hi >>> 24) & 255];
      for (let j = 0; j < 8 && done < outLen; j++) out[done++] = bytes[j];
    }
    if (done < outLen) keccakF(SH, SL);   // XOF：跨块继续挤压
  }
  return out;
}
const jsSha3 = (b) => keccakSponge(b, 0x06, N);
const jsShake = (b, len) => keccakSponge(b, 0x1f, len);
function jsHmac(key, b) {
  const RATE = 136;
  const raw = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'utf8');
  const k = raw.length > RATE ? jsSha3(raw) : raw;
  const ipad = Buffer.alloc(RATE), opad = Buffer.alloc(RATE);
  for (let i = 0; i < RATE; i++) {
    const v = i < k.length ? k[i] : 0;
    ipad[i] = v ^ 0x36; opad[i] = v ^ 0x5c;
  }
  const inner = jsSha3(Buffer.concat([ipad, Buffer.isBuffer(b) ? b : Buffer.from(String(b), 'utf8')]));
  return jsSha3(Buffer.concat([opad, inner]));
}

let nativeSha3 = false;
try { crypto.createHash('sha3-256').update(Buffer.alloc(1)).digest(); nativeSha3 = true; }
catch { nativeSha3 = false; }
// NEOLINK_QS_FORCE_JS=1 供契约测试与真机探针强制走纯 JS 路径，验证跨运行时等价
const DIGEST_BACKEND = (process.env.NEOLINK_QS_FORCE_JS === '1' || !nativeSha3) ? 'keccak-js' : 'openssl-native';
const USE_JS = DIGEST_BACKEND === 'keccak-js';

const sha3 = USE_JS ? jsSha3 : (b) => crypto.createHash('sha3-256').update(b).digest();
const shake = USE_JS ? jsShake : (b, len) => crypto.createHash('shake256', { outputLength: len }).update(b).digest();
const hmac = USE_JS ? jsHmac : (key, b) => crypto.createHmac('sha3-256', key).update(b).digest();

function cat(...parts) {
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(String(p), 'utf8'))));
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; }
function timingEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function asBuffer(v) { return Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8'); }

// ---------------------------------------------------------------------------
// 1) 多源熵混合
//    主熵源是操作系统 CSPRNG；其余只是**附加扰动**，不充当熵来源。
//    如实说明：这是高熵经典随机数，不是量子随机数发生器（QRNG）。
// ---------------------------------------------------------------------------
function mixEntropy() {
  return sha3(cat(
    DOMAIN, Buffer.from([0x01]),
    crypto.randomBytes(64),                         // OS CSPRNG：唯一主熵源
    Buffer.from(process.hrtime.bigint().toString(36)),
    Buffer.from(String(Date.now()) + ':' + process.pid),
    Buffer.from(process.platform + '/' + process.arch + '/' + process.versions.node),
    Buffer.from(String(signatureCounter)),
  ));
}

// ---------------------------------------------------------------------------
// 2) 域分隔密钥派生（SHAKE256 流式扩展）
//    同一主种子在不同 label 下产出互不相干的密钥；长度与标签均进 KDF 输入，
//    避免跨用途复用与长度截断歧义。
// ---------------------------------------------------------------------------
function deriveKey(masterSeed, label, length = 32) {
  if (!Buffer.isBuffer(masterSeed) || masterSeed.length < 16) {
    throw new Error('主种子至少 16 字节');
  }
  const lb = Buffer.from(String(label), 'utf8');
  return shake(cat(DOMAIN, Buffer.from([0x02]), u16(lb.length), lb, u16(length), masterSeed), length);
}

// ---------------------------------------------------------------------------
// 3) AES-256-GCM 静态封装
// ---------------------------------------------------------------------------
function seal(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('需要 32 字节密钥');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(asBuffer(plaintext)), c.final()]);
  return {
    v: 1, alg: 'AES-256-GCM',
    iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}
function open(sealed, key) {
  try {
    if (!sealed || sealed.alg !== 'AES-256-GCM' || !Buffer.isBuffer(key) || key.length !== 32) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'));
    d.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(sealed.data, 'hex')), d.final()]);
  } catch { return null; }   // 认证失败即返回 null，不泄露原因
}

// ---------------------------------------------------------------------------
// 4) QS-WOTS：W-OTS 风格的哈希一次性签名
//    安全性只依赖「哈希求前像困难」，量子下 Grover 给平方根加速，
//    256-bit 输出仍约 128-bit 后量子强度。
//
//    摘要 32 字节拆成 64 个 nibble，每 nibble 对应一条长度 15 的哈希链；
//    另加 3 条校验和链 = sum(15 - d_i)。校验和保证：攻击者无法把所有 nibble
//    都调大来复用已有签名（那样校验和必然变小，需要逆推哈希链，不可行）。
//    每次签名都生成**全新密钥对**，一次性语义由构造本身保证。
// ---------------------------------------------------------------------------
function chainStep(x) {
  return sha3(cat(DOMAIN, Buffer.from([0x51]), x));   // 每步域分隔
}
function chain(x, steps) {
  let cur = Buffer.from(x);
  for (let i = 0; i < steps; i++) cur = chainStep(cur);
  return cur;
}
function toNibbles(digest) {
  const out = [];
  for (const byte of digest) out.push(byte >> 4, byte & 0x0f);
  return out;
}
function chainValues(message) {
  const d = toNibbles(sha3(asBuffer(message)));
  const cs = d.reduce((a, v) => a + (CHAIN_LEN - v), 0);
  // 3 个 nibble，大端；cs 最大 960，16^3 = 4096 足够
  const csn = [(cs >> 8) & 0x0f, (cs >> 4) & 0x0f, cs & 0x0f];
  return d.concat(csn);
}
function keygen(seed) {
  const priv = [];
  for (let i = 0; i < CHAINS; i++) {
    priv.push(shake(cat(DOMAIN, Buffer.from([0x52]), seed, u16(i)), N));
  }
  const ends = priv.map((p) => chain(p, CHAIN_LEN));
  const root = sha3(cat(DOMAIN, Buffer.from([0x53]), Buffer.concat(ends)));
  return { priv, root };
}
function sign(message) {
  const seed = mixEntropy();                 // 每次全新密钥对
  const { priv, root } = keygen(seed);
  const vals = chainValues(message);
  const signature = priv.map((p, i) => chain(p, vals[i]).toString('hex'));
  signatureCounter++;
  usedRoots.add(root.toString('hex'));
  return {
    alg: 'QS-WOTS-SHA3-256', suite: SUITE_ID, oneTime: true,
    root: root.toString('hex'),
    digest: sha3(asBuffer(message)).toString('hex'),
    signature,
    createdAt: new Date().toISOString(),
  };
}
function verify(message, pkg) {
  try {
    if (!pkg || pkg.alg !== 'QS-WOTS-SHA3-256') return { ok: false, reason: 'unsupported_alg' };
    if (!Array.isArray(pkg.signature) || pkg.signature.length !== CHAINS) {
      return { ok: false, reason: 'bad_signature_length' };
    }
    const vals = chainValues(message);
    const ends = pkg.signature.map((s, i) => chain(Buffer.from(s, 'hex'), CHAIN_LEN - vals[i]));
    const root = sha3(cat(DOMAIN, Buffer.from([0x53]), Buffer.concat(ends)));
    if (!timingEqual(root, Buffer.from(String(pkg.root), 'hex'))) {
      return { ok: false, reason: 'signature_mismatch' };
    }
    return { ok: true, alg: pkg.alg, root: pkg.root, oneTime: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}
function hasSeenRoot(root) { return usedRoots.has(String(root)); }

// ---------------------------------------------------------------------------
// 5) 运行时完整性自检（SHA3 文件哈希 + HMAC 链式基线）
//    用途如实：检测文件损坏、升级残留、非预期改动；发现即降级企业能力。
//    它**不是**抗主动攻击者的密码学签名：基线密钥由公开常量派生且随包分发，
//    能显著提高篡改成本，但不能阻止拿到本机的攻击者重算基线。
// ---------------------------------------------------------------------------
function integrityKey(version) {
  return shake(cat(DOMAIN, Buffer.from('integrity-baseline'), Buffer.from(String(version || '0'))), N);
}
function buildManifest(rootDir, version, files = INTEGRITY_FILES) {
  const key = integrityKey(version);
  let prev = Buffer.alloc(N);
  const chain = [];
  for (const rel of files) {
    let fileHash = null, bytes = 0;
    try {
      const b = fs.readFileSync(path.join(rootDir, rel));
      fileHash = sha3(b); bytes = b.length;
    } catch { /* 缺失文件也如实入链 */ }
    const link = hmac(key, cat(prev, Buffer.from(rel), fileHash || Buffer.from('MISSING')));
    chain.push({ path: rel, sha3: fileHash ? fileHash.toString('hex') : null, bytes, link: link.toString('hex') });
    prev = link;
  }
  const root = hmac(key, cat(prev, Buffer.from('QS-ROOT')));
  return {
    suite: SUITE_ID, version: String(version), createdAt: new Date().toISOString(),
    files: chain, root: root.toString('hex'),
  };
}
function verifyManifest(rootDir, manifest) {
  if (!manifest || !manifest.version || !Array.isArray(manifest.files)) {
    return { ok: false, reason: 'no_manifest', checked: 0, mismatches: [], rootMatch: false };
  }
  const key = integrityKey(manifest.version);
  let prev = Buffer.alloc(N), rootMatch = false;
  const mismatches = [];
  for (const rec of manifest.files) {
    let fileHash = null;
    try { fileHash = sha3(fs.readFileSync(path.join(rootDir, String(rec.path)))); }
    catch { /* 缺失 */ }
    if ((rec.sha3 || null) !== (fileHash ? fileHash.toString('hex') : null)) {
      mismatches.push({ path: rec.path, why: fileHash ? 'content_changed' : 'file_missing' });
    }
    const link = hmac(key, cat(prev, Buffer.from(String(rec.path)), fileHash || Buffer.from('MISSING')));
    if (!timingEqual(link, Buffer.from(String(rec.link), 'hex'))) {
      if (!mismatches.some((m) => m.path === rec.path)) {
        mismatches.push({ path: rec.path, why: 'chain_broken' });
      }
    }
    // 用**基线**链值推进，而不是本次重算值：否则一处改动会让后续所有链
    // 级联失配，界面无法精确指出到底哪个文件异常。基线本身仍是链式构造。
    prev = Buffer.from(String(rec.link), 'hex');
  }
  rootMatch = timingEqual(
    hmac(key, cat(prev, Buffer.from('QS-ROOT'))),
    Buffer.from(String(manifest.root), 'hex'),
  );
  return {
    ok: mismatches.length === 0 && rootMatch,
    checked: manifest.files.length,
    mismatches, rootMatch,
  };
}

// ---------------------------------------------------------------------------
// 6) 反调试探针（降级，不自杀）
// ---------------------------------------------------------------------------
function probeDebug() {
  const reasons = [];
  const hay = [
    ...(process.execArgv || []), ...(process.argv || []),
    String(process.env.NODE_OPTIONS || ''),
  ].join(' ');
  if (/--inspect(-brk)?(=|:|\s|$)/.test(hay)) reasons.push('Node 检查器启动参数');
  if (/--remote-debugging-port/.test(hay)) reasons.push('远程调试端口已开启');
  if (/\s--require(=|\s)|^\s*-r\s/.test(String(process.env.NODE_OPTIONS || ''))) {
    reasons.push('NODE_OPTIONS 预加载注入');
  }
  try {
    const inspector = require('node:inspector');
    if (inspector.url()) reasons.push('调试器已附加到主进程');
  } catch { /* 探测不可用不构成异常 */ }
  return { tripped: reasons.length > 0, reasons, policy: 'degrade' };
}

// ---------------------------------------------------------------------------
// 7) 状态汇总（UI 里每一个字段都来自本模块的真实运行时值）
// ---------------------------------------------------------------------------
function status() {
  return {
    suite: SUITE_ID,
    claim: '抗量子（后量子）密码防护；非量子计算、非 QKD',
    quantumComputing: false,
    qkd: false,
    algorithms: ['SHA3-256', 'SHAKE256', 'QS-WOTS-SHA3-256', 'AES-256-GCM'],
    hashBytes: N,
    winternitz: WINTERNITZ,
    chainsPerSignature: CHAINS,
    signatureCount: signatureCounter,
    seenRoots: usedRoots.size,
    integrityFiles: INTEGRITY_FILES.length,
    digestBackend: DIGEST_BACKEND,   // openssl-native | keccak-js（Electron/BoringSSL 走后者）
  };
}

module.exports = {
  SUITE_ID, INTEGRITY_FILES,
  sha3, shake, hmac, mixEntropy, deriveKey, timingEqual,
  seal, open,
  sign, verify, hasSeenRoot,
  buildManifest, verifyManifest,
  probeDebug, status,
};
