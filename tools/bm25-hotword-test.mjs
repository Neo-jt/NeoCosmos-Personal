/**
 * v2.1.0 · BM25 超高频词回归测试
 *
 * 背景：百万级真实文件库端到端时发现，搜"卡片"这类**遍布全库的高频词**
 * 返回 0 命中。根因：bm25Search 把 df > 25% N 的词当停用词直接 `continue` 跳过，
 * 于是"候选集为空 → 结果为空"。这类词本身没有区分度，但**搜不到**是明确的可用性缺陷。
 *
 * 修复：改为**限采样**参与打分（CAP 个 posting），既守住代价，又保证有命中。
 *
 * 本测试直接构造 6 万节点（越过 N>50000 的阈值）验证这一点。
 *
 * 运行：node tools/bm25-hotword-test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { KbStore, fnv1a64 } = await import(pathToFileURL(path.join(ROOT, 'src/storage/store.js')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${extra ? ' — ' + extra : ''}`); }
}

const N = 60000;               // 越过 N > 50000 的阈值
const HOT = '合同';             // 出现在每一张卡片里的超高频词
const RARE = '保密措施';        // 只出现在少数卡片里的稀有词

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neolink-bm25-'));
const store = new KbStore(tmp);

// 直接注入节点（不落盘文件）：6 万节点，每张都含超高频词
for (let i = 0; i < N; i++) {
  const rel = `_memory/semantic/域${i % 8}/卡片 ${i}.md`;
  const rare = i % 500 === 0 ? ` ${RARE}` : '';
  store.nodes.set('n_' + fnv1a64(rel), {
    id: 'n_' + fnv1a64(rel), path: rel, title: `卡片 ${i}`,
    neolink_id: 'n_' + fnv1a64(rel), domain: `域${i % 8}`, tags: [],
    links: [], aliases: [], memory_layer: 'semantic', kind: 'note',
    fts_text: `${HOT}审查要点 ${rare} 事项编号 ${i}`, archived: 0, pinned: 0,
    mtime: 0, size: 0,
  });
}
store._nodeV++;

console.log('\n【BM25】超高频词在超大语料下仍可检索');
console.log(`  语料：${N} 节点，每张都含「${HOT}」`);

const t0 = Date.now();
store.buildBM25();
const buildMs = Date.now() - t0;
ok('倒排索引可构建', !!store._bm25, `${buildMs}ms · N=${store._bm25.N}`);

const t1 = Date.now();
const hotHits = store.bm25Search(HOT, 5);
const hotMs = Date.now() - t1;
ok('超高频词能检索到结果（修复前恒为 0）', hotHits.length > 0,
  `hits=${hotHits.length} · ${hotMs}ms`);
ok('超高频词命中数达到 topK', hotHits.length === 5, `hits=${hotHits.length}`);
ok('超高频词检索代价可控（< 3 秒）', hotMs < 3000, `${hotMs}ms`);

const t2 = Date.now();
const rareHits = store.bm25Search(RARE, 5);
const rareMs = Date.now() - t2;
ok('稀有词仍正常命中', rareHits.length > 0, `hits=${rareHits.length} · ${rareMs}ms`);
ok('稀有词命中数正确（每 500 张才有一张）', rareHits.length === 5, `hits=${rareHits.length}`);

const t3 = Date.now();
const mixHits = store.bm25Search(`${HOT} ${RARE}`, 5);
ok('混合查询正常', mixHits.length > 0, `hits=${mixHits.length} · ${Date.now() - t3}ms`);

ok('不存在的词返回空（不误召回）', store.bm25Search('绝不存在的词xyz', 5).length === 0);

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n========================================');
console.log(`测试结果: ${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：' + failures.join('、')); process.exit(1); }
