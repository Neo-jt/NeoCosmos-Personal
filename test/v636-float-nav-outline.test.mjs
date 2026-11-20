// v6.36.0 契约：悬浮工作窗 / 双层返回 / 设置去重 / 知识库分组 / 常驻大纲 / 紧凑排版
// 断言全部来自真实源码，禁止示例值与放水条件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('版本真源四处同步（动态读取，禁止写死）', () => {
  const V = JSON.parse(read('package.json')).version;
  assert.match(V, /^\d+\.\d+\.\d+$/, '版本号格式不合法');
  assert.equal(JSON.parse(read('desktop/package.json')).version, V);
  assert.ok(read('tools/installer.nsi').includes(`VERSION_TAG         "${V}"`), 'NSIS 版本标签未同步');
  assert.ok(read('desktop/ui/index.html').includes(`id="brandVersion">${V}<`), '界面版本戳未同步');
});

test('界面提供悬浮工作窗层；顶栏返回按钮按 6.38 需求移除但返回能力保留', () => {
  const html = read('desktop/ui/index.html');
  assert.ok(html.includes('id="floatStage"'), '缺悬浮工作窗容器');
  assert.ok(html.includes('id="floatScrim"'), '缺遮罩关闭层');
  // v6.38.0：用户要求删除左上角常驻返回按钮。
  assert.ok(!html.includes('id="btnBack"'), '顶栏返回按钮应已移除');
  const app = read('desktop/ui/app.js');
  assert.ok(app.includes("ev.key === '['"), '返回快捷键 Ctrl [ 必须保留');
  assert.ok(app.includes('async function routeBack()'), '返回逻辑函数必须保留');
  assert.ok(app.includes("back.title = '返回上一层'"), '悬浮窗内返回控件必须保留');
  assert.ok(!html.includes('title="设置：外观'), '设置按钮不应再提示外观');
});

test('悬浮窗与底层功能区使用两套独立历史，返回优先关最上层', () => {
  const app = read('desktop/ui/app.js');
  assert.ok(app.includes('let floatStack = []'));
  assert.ok(app.includes('let viewStack = [currentKey]'));
  assert.ok(/async function openFloat\(key\)/.test(app));
  assert.ok(/function closeFloat\(\)/.test(app));
  assert.ok(app.includes("if (key === 'settings' && !opts.fromBack) { await openFloat('settings'); return; }"),
    '设置必须通过悬浮窗打开');
  assert.ok(app.includes('if (floatStack.length) { closeFloat(); return; }'),
    '返回必须优先关闭最上层悬浮窗');
  assert.ok(app.includes("ev.key === '['"), '缺 Ctrl [ 返回快捷键');
  assert.ok(app.includes("if (btn.dataset.view === 'settings') openFloat('settings');"),
    '左侧设置按钮必须打开悬浮窗');
  assert.ok(app.includes('window.__NEOLINK__ = { app, route, openFloat, closeFloat, closeAllFloats'),
    '悬浮窗导航必须可被真机探针调用');
});

test('设置页删除重复外观，能力入口改为向上叠层', () => {
  const s = read('desktop/ui/views/settings.js');
  assert.ok(!s.includes("key: 'appearance'"));
  assert.ok(!s.includes('appearance?.open?.()'));
  assert.ok(!s.includes('appearance?.state?.()'));
  for (const sec of ['graph', 'service', 'vault', 'about']) {
    assert.ok(s.includes(`key: '${sec}'`), `缺分类 ${sec}`);
  }
  assert.ok(s.includes('onclick: () => (openFloat || route)(s.key)'),
    '能力卡必须打开悬浮工作窗，不能压回底层页面');
});

test('知识库按真实 linkEnabled 分启用与全部，启停走真实通道', () => {
  const s = read('desktop/ui/views/settings.js');
  assert.ok(s.includes("v.linkEnabled !== false"), '分组必须读真实启用状态');
  assert.ok(s.includes('启用的知识库'));
  assert.ok(s.includes('全部知识库'));
  assert.ok(s.includes('api.connections?.scopeSet?.({ id: v.id, enabled })'),
    '启停必须走真实 conn:scopeSet');
  assert.ok(!/示例数据|demo\s*[:=]|mock\s*[:=]/.test(s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('体系页改为内部分区 tab，外观重复卡不再渲染', () => {
  const a = read('desktop/ui/views/atlas.js');
  assert.ok(a.includes('const ATLAS_TABS'));
  assert.ok(a.includes("class: 'compact-tabs'"));
  assert.ok(a.includes('class: \'compact-body\''));
  const renderBody = a.slice(a.indexOf('function render()'));
  assert.ok(!renderBody.includes('settingsCard()'), '体系页不应再渲染重复外观卡');
});

test('文档大纲常驻右侧且可点击定位并高亮当前章节', () => {
  const d = read('desktop/ui/views/document.js');
  assert.ok(d.includes("h('nav', { class: 'outline'"), '大纲必须是常驻导航而非 details 浮层');
  assert.ok(!d.includes("h('details', { class: 'outline'"));
  assert.ok(!d.includes('box.open = false'), '跳转后不得收起大纲');
  assert.ok(d.includes('scrollIntoView({ behavior: \'smooth\', block: \'start\' })'));
  assert.ok(d.includes('function syncActive()'));
  assert.ok(d.includes('class: \'doc-layout\''));
});

test('紧凑排版与动效存在，且没有 auto-fill 网格', () => {
  const c = read('desktop/ui/styles.css');
  for (const token of ['.float-window', '.compact-tabs', '.doc-layout', '.outline .o-item.is-active',
    '@keyframes float-win-in', '@keyframes st-view-in']) {
    assert.ok(c.includes(token), `缺样式 ${token}`);
  }
  const v636Css = c.slice(c.indexOf('v6.36.0 · 紧凑分区排版'));
  assert.ok(!/repeat\(auto-fill/.test(v636Css), '新版排版段不得使用 auto-fill');
  assert.ok(c.includes('prefers-reduced-motion:no-preference'), '动效必须尊重减少动态效果');
});
