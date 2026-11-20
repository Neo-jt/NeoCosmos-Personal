// NeoLink · 规模基准（v2.1.0）
// ---------------------------------------------------------------------------
// 目的：用真实数据回答"这套系统能撑到多大"。
// 测量口径（全部本机、离线）：
//   1. 建索引     —— 扫描磁盘 → 解析双链 → 建突触（O(链接数)，不再是 O(链接数×节点数)）
//   2. 落盘       —— 分片 NDJSON 写 256 片
//   3. 读回       —— 分片读回 + 词条索引 + 倒排索引
//   4. 全文检索   —— BM25 倒排查询（代价与语料规模解耦）
//   5. 星图总览   —— 按领域聚合（渲染层真正拿到的东西）
//   6. 星图全量   —— 全量导出（仅小子库）
//
// 运行: node tools/bench-scale.mjs [节点数...]
// 例:   node tools/bench-scale.mjs 2000 20000 100000
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KbStore, indexVault } from '../src/storage/store.js';
import { exportGraphPayload } from '../src/viz/graph-export.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const DOMAINS = ['合同审查', '数据合规', '知识产权', '劳动人事', '公司治理', '税务筹划',
  '争议解决', '投融资', '反垄断', '隐私保护', '合规风控', '商事仲裁', '知识产权运营', '监管沟通'];
const TAGS = ['核心条款', '案例', '模板', '流程', '清单', '要点', '风险', '谈判', '审查', '归档'];

function mb(n) { return (n / 1024 / 1024).toFixed(1); }
function ms(t) { return `${(t / 1000).toFixed(2)}s`; }

/** 生成合成语料：N 张卡片，M 个领域，每张带 3 条 [[双链]] */
function generate(dir, n, domains = 14) {
  const t0 = performance.now();
  for (let d = 0; d < domains; d++) {
    fs.mkdirSync(path.join(dir, '_memory', 'semantic', DOMAINS[d % DOMAINS.length]), { recursive: true });
  }
  const dirs = DOMAINS.slice(0, domains);
  for (let i = 0; i < n; i++) {
    const d = dirs[i % dirs.length];
    const dom = DOMAINS[i % DOMAINS.length];
    const links = [];
    for (let k = 1; k <= 3; k++) {
      const j = (i + k * 7919) % n;
      // 链接目标必须用**目标卡片自己的**领域，否则标题对不上（会退化成断链）
      if (j !== i) links.push(`[[卡片 ${j} · ${DOMAINS[j % DOMAINS.length]}]]`);
    }
    const body = [
      `---`,
      `neolink_id: n_bench_${i}`,
      `kind: note`,
      `memory_layer: ${['semantic', 'semantic', 'semantic', 'episodic', 'working'][i % 5]}`,
      `domain: ${dom}`,
      `---`,
      `# 卡片 ${i} · ${dom}`,
      ``,
      `本卡片属于「${dom}」领域，讨论事项编号 ${i}。要点：${TAGS[i % TAGS.length]}、${TAGS[(i + 3) % TAGS.length]}。`,
      `关联：${links.join(' ')}`,
      `补充说明：事项 ${i} 的处理口径与领域 ${dom} 一致，需与卡片 ${(i + 101) % n} 交叉验证。`,
      ``,
    ].join('\n');
    const file = path.join(dir, '_memory', 'semantic', dom, `卡片 ${i} · ${dom}.md`);
    fs.writeFileSync(file, body, 'utf8');
  }
  return performance.now() - t0;
}

async function bench(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `neolink-bench-${n}-`));
  console.log(`\n${'='.repeat(64)}`);
  console.log(`  规模基准 · ${n.toLocaleString('en-US')} 张卡片`);
  console.log('='.repeat(64));

  const genMs = generate(dir, n);
  console.log(`  语料生成        ${ms(genMs)}`);

  const store = new KbStore(dir).load();

  // 1) 建索引
  let t = performance.now();
  await indexVault(store);
  const idxMs = performance.now() - t;
  console.log(`  建索引          ${ms(idxMs)}   节点 ${store.nodes.size.toLocaleString()} · 边 ${store.edges.size.toLocaleString()}`);

  // 2) 落盘
  t = performance.now();
  store.save();
  const saveMs = performance.now() - t;
  const idxBytes = fs.readdirSync(path.join(dir, '.neolink', 'index', 'nodes'))
    .reduce((s, f) => s + fs.statSync(path.join(dir, '.neolink', 'index', 'nodes', f)).size, 0);
  console.log(`  落盘(分片)      ${ms(saveMs)}   索引 ${mb(idxBytes)}MB`);

  // 3) 读回
  t = performance.now();
  const store2 = new KbStore(dir).load();
  const loadMs = performance.now() - t;
  console.log(`  读回            ${ms(loadMs)}   节点 ${store2.nodes.size.toLocaleString()} · 边 ${store2.edges.size.toLocaleString()}`);

  // 4) 全文检索
  t = performance.now();
  const bm = store2.buildBM25();
  const bmMs = performance.now() - t;
  const qTimes = [];
  for (const q of ['合规审查要点', '数据出境评估流程', '争议解决策略', '知识产权运营']) {
    const t1 = performance.now();
    const hits = store2.bm25Search(q, 20);
    qTimes.push(performance.now() - t1);
    if (!hits.length) console.log(`    ⚠ 查询「${q}」无命中`);
  }
  const qAvg = qTimes.reduce((a, b) => a + b, 0) / qTimes.length;
  console.log(`  倒排建索引      ${ms(bmMs)}   词条 ${bm.terms.toLocaleString()} · ${bm.mode} 模式${bm.capped ? '（已封顶）' : ''}`);
  console.log(`  全文查询 x4     平均 ${qAvg.toFixed(1)}ms`);

  // 5) 星图总览（渲染层真正拿到的载荷）
  t = performance.now();
  const ov = exportGraphPayload(store2, { level: 'overview' });
  const ovMs = performance.now() - t;
  const ovBytes = Buffer.byteLength(JSON.stringify(ov));
  console.log(`  星图·总览       ${ms(ovMs)}   ${ov.nodes.length} 个超节点 / ${ov.edges.length} 条超边 · IPC 载荷 ${mb(ovBytes)}MB`);

  // 6) 星图全量（仅在可控规模内跑）
  if (n <= 20000) {
    t = performance.now();
    const full = exportGraphPayload(store2, { level: 'full', iterations: 60 });
    const fullMs = performance.now() - t;
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    console.log(`  星图·全量       ${ms(fullMs)}   ${full.nodes.length} 节点 / ${full.edges.length} 边 · IPC 载荷 ${mb(fullBytes)}MB`);
  } else {
    console.log(`  星图·全量       跳过（>2 万节点时默认走总览层级，避免 GB 级 IPC 克隆）`);
  }

  const mem = process.memoryUsage();
  console.log(`  常驻内存        heap ${mb(mem.heapUsed)}MB · rss ${mb(mem.rss)}MB`);

  fs.rmSync(dir, { recursive: true, force: true });
  return { n, idxMs, saveMs, loadMs, bmMs, qAvg, ovMs };
}

const sizes = process.argv.slice(2).map(Number).filter((x) => x > 0);
const syntheticArg = process.argv.find((a) => a.startsWith('--synthetic'));
if (syntheticArg) {
  const n = Number(syntheticArg.split('=')[1] || syntheticArg.replace('--synthetic', '')) || 1000000;
  await benchSynthetic(n);
} else {
  const targets = sizes.length ? sizes : [2000, 20000, 100000];
  const results = [];
  for (const n of targets) results.push(await bench(n));

  console.log(`\n${'='.repeat(64)}`);
  console.log('  汇总');
  console.log('='.repeat(64));
  console.log('  卡片数        建索引      落盘      读回      建倒排    查询均     总览');
  for (const r of results) {
    console.log(`  ${String(r.n).padStart(9)}   ${ms(r.idxMs).padStart(8)}  ${ms(r.saveMs).padStart(8)}  ${ms(r.loadMs).padStart(8)}  ${ms(r.bmMs).padStart(8)}  ${r.qAvg.toFixed(1).padStart(6)}ms  ${ms(r.ovMs).padStart(8)}`);
  }
  console.log('\n  说明：');
  console.log('   · 建索引 = 磁盘扫描 + 双链解析（O(链接数)，不再随节点数平方增长）');
  console.log('   · 落盘/读回 = 256 片 NDJSON，单文件不会膨胀到 GB 级');
  console.log('   · 查询均 = 4 次全文查询的平均耗时，与语料规模解耦');
  console.log('   · 总览 = 渲染层实际拿到的载荷，节点数恒定在千级以内');
}

/**
 * 合成规模探针：直接在内存里造 N 个节点 / 3N 条边，不落盘。
 * 用来回答"百万级时索引本身要吃多少内存、下钻要等多久"——
 * 磁盘 IO 部分由 bench() 单独测量，两者互补。
 */
async function benchSynthetic(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neolink-syn-'));
  const store = new KbStore(dir);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`  合成规模探针 · ${n.toLocaleString('en-US')} 节点 / ${(n * 3).toLocaleString('en-US')} 边（纯内存，不落盘）`);
  console.log('='.repeat(64));

  const domains = 60;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const d = DOMAINS[i % domains];
    const id = 'n_syn_' + i;
    store.nodes.set(id, {
      id, path: `_memory/semantic/${d}/卡片 ${i}.md`,
      title: `卡片 ${i} · ${d}`,
      mtime: 1750000000000 + i, size: 320,
      kind: 'note',
      memory_layer: ['semantic', 'episodic', 'working'][i % 3],
      domain: d,
      tags: [TAGS[i % TAGS.length], TAGS[(i + 5) % TAGS.length]],
      links: [], aliases: [], archived: 0, pinned: 0,
      fts_text: `本卡片属于「${d}」领域，讨论事项编号 ${i}。要点：合规、审查。关联事项 ${i + 1}。`,
      neolink_id: id,
    });
  }
  let e = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 1; k <= 3; k++) {
      const j = (i + k * 7919) % n;
      if (j === i) continue;
      const id = 'e_syn_' + (e++);
      store.edges.set(id, {
        id, src: 'n_syn_' + i, dst: 'n_syn_' + j, type: 'explicit_link',
        weight: 0.6, base_weight: 0.6, strength_hits: 0,
        last_reinforced_at: '2026-11-01T00:00:00.000Z', origin: 'human',
        reason: null, confirmed: 1, bidirectional: 1,
      });
    }
  }
  const buildMs = performance.now() - t0;
  const afterBuild = process.memoryUsage();
  console.log(`  构造索引结构   ${ms(buildMs)}   节点 ${store.nodes.size.toLocaleString()} · 边 ${store.edges.size.toLocaleString()}`);
  console.log(`  结构内存       heap ${mb(afterBuild.heapUsed)}MB · rss ${mb(afterBuild.rss)}MB`);

  let t = performance.now();
  const bm = store.buildBM25();
  const bmMs = performance.now() - t;
  const afterBm = process.memoryUsage();
  console.log(`  倒排建索引     ${ms(bmMs)}   词条 ${bm.terms.toLocaleString()} · ${bm.mode} 模式${bm.capped ? '（已封顶）' : ''}`);
  console.log(`  倒排后内存     heap ${mb(afterBm.heapUsed)}MB · rss ${mb(afterBm.rss)}MB`);

  const qt = [];
  for (const q of ['合规审查要点', '数据出境评估', '争议解决策略', '知识产权运营']) {
    const t1 = performance.now();
    store.bm25Search(q, 20);
    qt.push(performance.now() - t1);
  }
  console.log(`  全文查询 x4    平均 ${(qt.reduce((a, b) => a + b, 0) / qt.length).toFixed(1)}ms`);

  t = performance.now();
  const ov = exportGraphPayload(store, { level: 'overview' });
  const ovMs = performance.now() - t;
  const ovBytes = Buffer.byteLength(JSON.stringify(ov));
  console.log(`  星图·总览      ${ms(ovMs)}   ${ov.nodes.length} 个超节点 / ${ov.edges.length} 条超边 · IPC 载荷 ${mb(ovBytes)}MB`);

  const someId = 'n_syn_' + Math.floor(n / 2);
  t = performance.now();
  const fo = exportGraphPayload(store, { level: 'focus', id: someId, hops: 2 });
  const foMs = performance.now() - t;
  const foBytes = Buffer.byteLength(JSON.stringify(fo));
  console.log(`  星图·焦点下钻  ${ms(foMs)}   ${fo.nodes.length} 节点 / ${fo.edges.length} 边 · IPC 载荷 ${mb(foBytes)}MB`);

  const fin = process.memoryUsage();
  console.log(`  最终内存       heap ${mb(fin.heapUsed)}MB · rss ${mb(fin.rss)}MB`);
  console.log(`\n  结论：百万级下「渲染层拿到的对象数」与「IPC 载荷」恒定在千级/MB 级，`);
  console.log('        界面耗时与语料规模基本无关；瓶颈只剩引擎侧的常驻内存。');

  fs.rmSync(dir, { recursive: true, force: true });
}
