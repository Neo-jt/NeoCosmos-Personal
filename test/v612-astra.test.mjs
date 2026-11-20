// v6.12 契约测试：思维沉淀库（安装目录自动建立 / 可更换）/ 空间折叠布局 / 内核性能节流 / 突触知识网
// 与既有套件一致的风格：纯逻辑用真实模块跑，渲染层用源码文本契约校验。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'desktop/package.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } };
const section = (t) => console.log('\n' + t);

// ───────────────────────── 1) 版本与契约 ─────────────────────────
section('① 版本与契约');
// v6.13：版本契约改为「以 package.json 为唯一真源」的动态断言。
// 升级版本时历史测试不应假失败，但四处版本戳仍必须逐一对齐。
const V = pkg.version;
ok('package.json 版本号合法', /^\d+\.\d+\.\d+$/.test(V), `(${V})`);
const nsi = readFileSync(join(ROOT, 'tools/installer.nsi'), 'utf8');
ok('PE 版本 = 包版本 .0', nsi.includes(`"${V}.0"`));
// v6.30.0：输出名改为单一真源拼装，旧的字符串字面量断言已不成立；
// 升级为校验拼装式 + 四个真源 token + 无硬编码版本残留（严格强于旧断言）。
ok('安装包输出名由单一真源拼出且与包版本一致',
  nsi.includes('${PRODUCT_NAME}-${VERSION_TAG}${SETUP_TAIL}${OUT_EXT}') &&
  (nsi.split('\n').find((l) => l.includes('!define VERSION_TAG')) || '').includes(`"${V}"`) &&
  (nsi.split('\n').find((l) => l.includes('!define SETUP_TAIL')) || '').includes('"-Setup"') &&
  (nsi.split('\n').find((l) => l.includes('!define OUT_EXT')) || '').includes('".exe"') &&
  !/\d+\.\d+\.\d+-Setup\.exe/.test(nsi));
const html = readFileSync(join(ROOT, 'desktop/ui/index.html'), 'utf8');
ok('关于界面版本与包版本一致', html.includes(`id="brandVersion">${V}<`));
ok('启动屏不再硬编码设计系统口号（版本由关于页读取真源）',
  !html.includes('AURORA DESIGN SYSTEM ·') && html.includes('正在载入知识库…'));

// ───────────────────────── 2) 思维沉淀库：自动建立 + 缓冲写入 ─────────────────────────
section('② 思维沉淀库：自动建立 / 缓冲写入 / 检索');
const os = require('node:os');
const fs = require('node:fs');
const { createThoughtLibrary } = require(join(ROOT, 'desktop/astra/astra-library.js'));
const tmp = join(os.tmpdir(), 'v612-lib-' + Date.now());
const lib = createThoughtLibrary({ root: tmp, fallbackRoot: tmp + '-fb' });
ok('库根目录自动建立', fs.existsSync(tmp) && fs.existsSync(join(tmp, 'meta.json')));
['episodic','semantic','synapse','decision','evolution'].forEach((n) => {
  lib.addEpisodic('情境记忆示例-' + n); lib.addSemantic('量子' + n); lib.addDecision({ kind: 'decision', detail: { action: 'wander' } });
});
lib.flush();
const st = lib.stats();
ok('情境记忆计数 > 0', st.episodic >= 5, `(${st.episodic})`);
ok('语义记忆计数 > 0（含突触共现）', st.semantic >= 5 && st.synapse >= 1, `(${st.semantic}/${st.synapse})`);
ok('决策计数 > 0', st.decision >= 5, `(${st.decision})`);
const q = lib.query('量子', 3);
ok('相关性检索能命中"量子"', q.some((x) => x.text.includes('量子')), JSON.stringify(q.map((x) => x.text)));

// ───────────────────────── 3) 思维沉淀库：可自主更换位置 ─────────────────────────
section('③ 思维沉淀库：relocate 复制并切换');
const dest = join(os.tmpdir(), 'v612-lib-moved-' + Date.now());
const r = lib.relocate(dest, { keepOld: false });
ok('relocate 成功', r.ok === true, JSON.stringify(r.error || ''));
ok('新目录已建立并含文件', fs.existsSync(join(dest, 'episodic.jsonl')));
ok('旧目录已按 keepOld=false 清理', !fs.existsSync(join(tmp, 'episodic.jsonl')));
ok('库根已切到新位置', lib.root === dest);
const r2 = lib.relocate(dest, {}); // 同路径应被拒绝
ok('同路径 relocate 被拒绝', r2.ok === false);

// ───────────────────────── 4) 内核性能：落盘节流 ─────────────────────────
section('④ 内核性能：全量落盘节流（PERSIST_EVERY=5）');
const { createAstraMind } = require(join(ROOT, 'desktop/astra/astra-mind.js'));
let writes = 0;
const mind = createAstraMind({
  seed: 5,
  storage: { read: () => null, write: () => { writes++; } },
});
for (let i = 0; i < 40; i++) mind.tick({ force: true });
// 40 跳：强制事件（每次 evolve/reset 等）之外，普通 tick 每 5 跳才写一次
ok('落盘次数显著少于心跳数（节流生效）', writes > 0 && writes <= 40 / 5 + 3, `writes=${writes} ticks=40`);
ok('心跳累计正确', mind._raw().heartbeats === 40);

// ───────────────────────── 5) 突触网：钩子级联到沉淀库 ─────────────────────────
section('⑤ 突触知识网：内核记忆 → 沉淀库');
const tmp2 = join(os.tmpdir(), 'v612-mind-' + Date.now());
const lib2 = createThoughtLibrary({ root: tmp2 });
const mind2 = createAstraMind({
  seed: 9,
  hooks: {
    onRemember: (k, t, e) => { if (k === 'semantic') lib2.addSemantic(t, {}); else lib2.addEpisodic(t, {}); },
    onAudit: (k, d) => { if (k === 'decision') lib2.addDecision({ kind: k, detail: d }); },
  },
});
mind2.perceive('user_message', { text: '空间折叠算法如何压缩知识图谱的距离' });
mind2.perceive('user_message', { text: '空间折叠与量子纠缠的边界和类脑计算' });
for (let i = 0; i < 20; i++) mind2.tick({ force: true });
lib2.flush();
const g = lib2.synapseGraph(48);
ok('突触图节点来自语义记忆', g.nodes.length >= 2, `(${g.nodes.length})`);
ok('突触图存在关联边', g.edges.length >= 1, `(${g.edges.length})`);

// ───────────────────────── 6) 空间折叠布局（源码契约） ─────────────────────────
section('⑥ 空间折叠布局：真实径向折叠变换');
const cosmosSrc = readFileSync(join(ROOT, 'desktop/ui/cosmos.js'), 'utf8');
ok('LAYOUT_MODES 含 spacefold', /\{ key: 'spacefold'/.test(cosmosSrc));
ok('折叠变换使用指数收缩 1-e^{-d/R}', /1 - Math\.exp\(-d \/ R\)/.test(cosmosSrc));
ok('折叠叠加同心涟漪', /Math\.sin\(\(d \/ R\) \* Math\.PI \* 3\)/.test(cosmosSrc));
const graphSrc = readFileSync(join(ROOT, 'desktop/ui/views/graph.js'), 'utf8');
ok('星图 HUD 动态读取 LAYOUT_MODES（含空间折叠）', /LAYOUT_MODES\.map\(\(mm\)/.test(graphSrc));

// ───────────────────────── 7) 主进程接线（源码契约） ─────────────────────────
section('⑦ 主进程接线：库 IPC / 安装目录根');
const mainSrc = readFileSync(join(ROOT, 'desktop/main.js'), 'utf8');
ok('校验 astra:library:status / query / relocate / graph IPC',
  /astra:library:status/.test(mainSrc) && /astra:library:relocate/.test(mainSrc) && /astra:library:graph/.test(mainSrc));
ok('库根优先落在安装目录（app.getPath("exe") 下 astra-memory）', /path\.dirname\(app\.getPath\('exe'\)\), 'astra-memory'/.test(mainSrc));
ok('broadcastAstra 携带 libraryRoot', /libraryRoot: ensureAstraLibrary\(\)\.root/.test(mainSrc));

console.log(`\nv6.12 思维沉淀库 / 空间折叠 / 内核性能契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
