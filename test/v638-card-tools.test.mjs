// v6.38.0 契约：card-tools（收藏 / 近期）真实逻辑 + 接线完整性
// 断言全部来自真实源码，禁止示例值与放水条件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 用最小 localStorage mock 在 Node 里加载浏览器模块
function withLocalStorage(fn) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return fn(store);
}

test('card-tools：收藏切换 / 去重 / 持久化 / 坏数据归零', async () => {
  await withLocalStorage(async (store) => {
    const { cardTools } = await import('../desktop/ui/card-tools.js?' + Date.now());
    assert.equal(cardTools.isStarred('a'), false);
    assert.equal(cardTools.toggleStar('a'), true);
    assert.equal(cardTools.isStarred('a'), true);
    assert.equal(cardTools.starCount(), 1);
    cardTools.toggleStar('b');
    assert.deepEqual(cardTools.starredIds().sort(), ['a', 'b']);
    assert.equal(cardTools.toggleStar('a'), false);
    assert.equal(cardTools.isStarred('a'), false);
    assert.equal(cardTools.starCount(), 1);
    // 落盘结构是真实 JSON
    assert.ok(JSON.parse(store.get('neokb-card-stars-v1')).ids.includes('b'));
    // 坏数据归零
    store.set('neokb-card-stars-v1', '{broken');
    assert.equal(cardTools.starCount(), 0);
  });
});

test('card-tools：近期访问新→旧、去重上限、清空不影响收藏', async () => {
  await withLocalStorage(async () => {
    const { cardTools } = await import('../desktop/ui/card-tools.js?' + (Date.now() + 1));
    cardTools.toggleStar('keep');
    cardTools.touch('a'); cardTools.touch('b'); cardTools.touch('a');
    assert.deepEqual(cardTools.recentIds().slice(0, 2), ['a', 'b']);
    assert.equal(cardTools.recentIds().length, 2, '重复访问同一 id 必须去重前移');
    for (let i = 0; i < 50; i++) cardTools.touch('x' + i);
    assert.equal(cardTools.recentIds().length, 40, '近期必须有 40 条上限');
    cardTools.clearRecent();
    assert.equal(cardTools.recentIds().length, 0);
    assert.equal(cardTools.isStarred('keep'), true, '清空近期不得影响收藏');
  });
});

test('收藏视图接线：OVERLAY / 标签 / 命令 / 容器 / 星标按钮齐备', () => {
  const app = read('desktop/ui/app.js');
  assert.ok(app.includes("starred: { loader: () => import('./views/starred.js'), key: 'mountStarred' }"));
  assert.ok(app.includes("starred: '收藏夹'"));
  assert.ok(app.includes("label: '收藏夹（我的星标 / 最近打开）'"));
  assert.ok(app.includes("try { cardTools.touch(id); }"), '打开卡片必须记入近期');
  assert.ok(app.includes('cardTools,        // v6.38.0'));

  const html = read('desktop/ui/index.html');
  assert.ok(html.includes('id="viewStarred"'), '缺收藏夹视图容器');
  assert.ok(!html.includes('id="btnBack"'), '左上角返回按钮须已移除');

  const exp = read('desktop/ui/views/explorer.js');
  assert.ok(exp.includes("import { cardTools }"), '卡片树须接入收藏');
  assert.ok(exp.includes("class: 'tree-star'"), '卡片行须有星标按钮');

  const doc = read('desktop/ui/views/document.js');
  assert.ok(doc.includes("import { cardTools }"), '文档头须接入收藏');
  assert.ok(doc.includes("class: 'btn ghost icon-only doc-star'"), '正文头须有星标按钮');

  const view = read('desktop/ui/views/starred.js');
  assert.ok(view.includes('api.doc.allTree'), '收藏视图须用真实库数据解析标题');
  assert.ok(!/示例数据|mock\s*[:=]|demo\s*[:=]/.test(view), '收藏视图不得造数据');
});
