/**
 * v2.1.0 · 旧 32 位 ID → 新 64 位 ID 就地迁移的回归测试
 *
 * 背景：node_id 原本是 32 位 FNV-1a。32 位空间按生日问题在 10 万张卡片量级
 * 就开始碰撞（期望 1.16 次），实测确实静默吞掉过卡片。v2.1.0 把 ID 扩到 64 位，
 * 代价是升级前的索引里带着旧 id —— 迁移写错一次，就是"一卡两节点"或"边断链"。
 *
 * 这个脚本直接构造一个**旧格式索引**（单文件 nodes.json / edges.json，32 位 id），
 * 然后让真实的 KbStore.load() 去迁移它，逐项断言迁移结果。
 *
 * 运行：node tools/migrate-legacy-ids.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { KbStore, findLinkTarget, fnv1a, fnv1a64, indexVault } =
  await import(pathToFileURL(path.join(ROOT, 'src/storage/store.js')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${extra ? ' — ' + extra : ''}`); }
}

const LEGACY_RE = /^n_[0-9a-f]{8}$/;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neolink-migrate-'));
const vault = path.join(tmpRoot, 'vault');
fs.mkdirSync(vault, { recursive: true });

// ---------- 造 4 张卡片 ----------
const CARDS = [
  { rel: '算力.md', title: '算力', body: '算力是核心成本。[[成本口径]]' },
  { rel: '成本口径.md', title: '成本口径', body: '成本口径需要统一。[[算力]]' },
  { rel: '领域/合规审查.md', title: '合规审查', body: '合规审查要点。[[算力]]' },
  { rel: '领域/证据规则.md', title: '证据规则', body: '证据规则。[[合规审查]]' },
];
for (const c of CARDS) {
  const abs = path.join(vault, c.rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\nkind: note\n---\n# ${c.title}\n\n${c.body}\n`, 'utf8');
}

// ---------- 造旧格式索引（32 位 id，单文件格式） ----------
const indexDir = path.join(vault, '.neolink', 'index');
const overlayDir = path.join(vault, '.neolink', 'overlay');
fs.mkdirSync(indexDir, { recursive: true });
fs.mkdirSync(overlayDir, { recursive: true });

const legacyNodes = CARDS.map((c) => ({
  id: 'n_' + fnv1a(c.rel),            // ← 旧 32 位 id
  path: c.rel,
  title: c.title,
  neolink_id: 'n_' + fnv1a(c.rel),      // ← 自动派生的 neolink_id 也等于旧 id
  mtime: Date.now(), size: 100,
  kind: 'note', memory_layer: 'semantic', domain: null,
  tags: [], links: [], aliases: [],
  archived: 0, pinned: 0, fts_text: `${c.title} ${c.body}`,
}));
const byRel = new Map(legacyNodes.map((n) => [n.path, n]));
const legacyEdges = [
  { id: 'e_' + fnv1a(byRel.get('算力.md').id + '>' + byRel.get('成本口径.md').id + ':explicit_link'),
    src: byRel.get('算力.md').id, dst: byRel.get('成本口径.md').id, type: 'explicit_link',
    weight: 0.4, base_weight: 0.4, strength_hits: 0 },
  { id: 'e_' + fnv1a(byRel.get('领域/合规审查.md').id + '>' + byRel.get('算力.md').id + ':explicit_link'),
    src: byRel.get('领域/合规审查.md').id, dst: byRel.get('算力.md').id, type: 'explicit_link',
    weight: 0.4, base_weight: 0.4, strength_hits: 0 },
];
fs.writeFileSync(path.join(indexDir, 'nodes.json'), JSON.stringify(legacyNodes), 'utf8');
fs.writeFileSync(path.join(indexDir, 'edges.json'), JSON.stringify(legacyEdges), 'utf8');
// 旧沉淀对引用旧 id
fs.writeFileSync(path.join(indexDir, 'qa.json'), JSON.stringify([{
  id: 'qa_legacy1', question: 'Q', answer: 'A',
  cited_node_ids: [byRel.get('算力.md').id],
  cited_nodes: [{ id: byRel.get('算力.md').id, title: '算力' }],
  created_at: '2020-01-01T00:00:00.000Z',
}]), 'utf8');

console.log('\n【M-ID】旧 32 位 ID → 新 64 位 ID 就地迁移');
console.log(`  临时库：${vault}`);

// ---------- 加载并触发迁移 ----------
const store = new KbStore(vault);
store.load();

const nodes = [...store.nodes.values()];
ok('卡片数量不变（迁移不产生"一卡两节点"）', store.nodes.size === CARDS.length,
  `${store.nodes.size} / ${CARDS.length}`);
ok('不再残留旧格式 id', !nodes.some((n) => LEGACY_RE.test(n.id)),
  nodes.filter((n) => LEGACY_RE.test(n.id)).map((n) => n.id).join(',') || '无');
ok('全部节点 id 已重算为 64 位',
  nodes.every((n) => n.id === 'n_' + fnv1a64(n.path)));
ok('每张卡片仍可按路径定位（无丢失、无重复）',
  new Set(nodes.map((n) => n.path)).size === CARDS.length);
ok('旧 id 已登记为 legacy_ids（历史 [[n_xxx]] 链接不断链）',
  nodes.some((n) => Array.isArray(n.legacy_ids) && n.legacy_ids.length === 1
    && LEGACY_RE.test(n.legacy_ids[0])));

// 边：引用必须全部指向存在的节点
const edges = [...store.edges.values()];
ok('边数量不丢', edges.length === legacyEdges.length, `${edges.length} / ${legacyEdges.length}`);
ok('边 id 已重算为 64 位', edges.every((e) => /^e_[0-9a-f]{16}(_\d+)?$/.test(e.id)));
ok('边端点全部指向已存在的节点（无悬空）',
  edges.every((e) => store.nodes.has(e.src) && store.nodes.has(e.dst)));
ok('迁移后仍保留 explicit_link 边',
  edges.filter((e) => e.type === 'explicit_link').length === 2);

// 沉淀引用
ok('沉淀对引用的节点 id 已重挂',
  store.qaPairs[0]?.cited_node_ids?.[0] && store.qaPairs[0].cited_node_ids[0] === 'n_' + fnv1a64('算力.md'));

// neolink_id 同步
const calc = nodes.find((n) => n.path === '算力.md');
ok('自动派生的 neolink_id 同步更新为新 id', calc?.neolink_id === calc?.id, `${calc?.neolink_id}`);

// 历史链接解析：[[n_旧id]] 仍能命中
const oldCalcId = 'n_' + fnv1a('算力.md');
const hit = findLinkTarget(store, oldCalcId);
ok('历史 [[n_旧id]] 链接仍能解析到同一张卡片', hit && hit.path === '算力.md',
  hit ? hit.path : '未命中');

// 标题链接解析不受影响
ok('标题链接解析正常', findLinkTarget(store, '成本口径')?.path === '成本口径.md');

// ---------- 幂等性：保存后重载 ----------
store.save();
const store2 = new KbStore(vault);
store2.load();
ok('落盘重载后卡片数仍为 4（迁移幂等）', store2.nodes.size === CARDS.length, String(store2.nodes.size));
ok('落盘重载后 id 不再变动',
  [...store2.nodes.values()].every((n) => n.id === 'n_' + fnv1a64(n.path)));
ok('落盘重载后 legacy_ids 仍在（历史链接长期可解）',
  [...store2.nodes.values()].some((n) => Array.isArray(n.legacy_ids) && n.legacy_ids.length));

// ---------- 增量索引协同：改动一张卡片后不产生重复节点 ----------
const abs = path.join(vault, '算力.md');
fs.writeFileSync(abs, `---\nkind: note\n---\n# 算力\n\n算力是核心成本（已更新）。[[成本口径]]\n`, 'utf8');
await indexVault(store2);
ok('增量索引后卡片数不变（无重复节点）', store2.nodes.size === CARDS.length, String(store2.nodes.size));
ok('增量索引后节点 id 未变（边不断链）',
  [...store2.nodes.values()].every((n) => n.id === 'n_' + fnv1a64(n.path)));
ok('增量索引后边仍全部有效',
  [...store2.edges.values()].every((e) => store2.nodes.has(e.src) && store2.nodes.has(e.dst)));

// ---------- 64 位 vs 32 位碰撞期望的量级对照 ----------
const n = 1_000_000;
const p32 = (n * n) / (2 * (2 ** 32));
const p64 = (n * n) / (2 * (2 ** 64));
ok('32 位在 100 万量级碰撞期望 > 100', p32 > 100, `期望 ${p32.toFixed(1)} 次`);
ok('64 位在 100 万量级碰撞期望 < 1e-7', p64 < 1e-7, `期望 ${p64.toExponential(2)} 次`);

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('\n========================================');
console.log(`测试结果: ${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：' + failures.join('、')); process.exit(1); }
