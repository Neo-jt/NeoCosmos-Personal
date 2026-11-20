// v6.39.0 契约：悬浮层去重 / 面包屑清理 / 关于页开发者信息 / 全库总览接线
// 断言全部来自真实源码与真实入口，禁止示例值。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('desktop/package.json'));

test('版本单一真源同步（动态读取，禁止写死）', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '版本号格式不合法');
  assert.equal(JSON.parse(read('package.json')).version, pkg.version);
  assert.ok(read('desktop/ui/index.html').includes(`id="brandVersion">${pkg.version}<`));
  const nsi = read('tools/installer.nsi');
  assert.ok(nsi.includes(`VERSION_TAG         "${pkg.version}"`));
  assert.ok(nsi.includes(`PRODUCT_VERSION     "${pkg.version}.0"`));
});

test('悬浮工作窗：层级 kicker 与 × 关闭按钮已移除，返回控件保留', () => {
  const app = read('desktop/ui/app.js');
  assert.ok(!app.includes('float-kicker'), '气泡层级小字必须移除');
  assert.ok(!app.includes('悬浮工作窗 · 第 ${floatStack.length + 1} 层'));
  assert.ok(app.includes("back.className = 'float-ctl'"), '返回控件必须保留');
  assert.ok(!app.includes("close.className = 'float-ctl'"), '× 关闭按钮必须移除');
  assert.ok(!/close\.textContent = '×'/.test(app), '不得再渲染 × 按钮');
  assert.ok(app.includes('ctrls.append(back);'), '标题栏只保留返回');
  // 关闭途径不丢失：closeAllFloats 仍供 Ctrl [ / 遮罩 / 点星图工作区调用
  assert.ok(app.includes('function closeAllFloats()'), '关闭全部能力仍保留');
  assert.ok(app.includes("floatScrim')?.addEventListener('click', () => closeFloat())"), '遮罩关闭仍在');
});

test('正文大纲回归每文档固定列，彻底废除大纲悬浮窗', () => {
  const doc = read('desktop/ui/views/document.js');
  assert.ok(!doc.includes('makeFloatPanel'), 'document.js 不得再调用悬浮面板');
  assert.ok(!doc.includes("from '../float-panel.js'"), '不得再导入 float-panel');
  assert.ok(!doc.includes('doc-outline'), '不得再有大纲浮窗 id');
  assert.ok(!doc.includes('has-float-outline'), '不得再加悬浮布局类');
  assert.ok(doc.includes('if (ob) layout.appendChild(ob);'), '大纲须作为文档固定列插入');
  // float-panel.js 的去重机制保留给星图 HUD / 卡片详情等其它真实浮窗使用
  const fp = read('desktop/ui/float-panel.js');
  assert.ok(fp.includes('const stale = registry.get(id);'), '其它浮窗仍需同 id 去重');
  assert.ok(fp.includes('stale.destroy({ restore: false })'), '旧浮窗仍需真销毁');
  const css = read('desktop/ui/neocosmos-v2.css');
  assert.ok(/body\.neo-v2 \.outline\{[\s\S]*?position:static/.test(css), 'v7 大纲须恢复固定列定位');
  assert.ok(/body\.neo-v2 \.outline\{[\s\S]*?flex:0 0 188px/.test(css), 'v7 大纲须固定 188px 列宽');
  assert.ok(!css.includes('has-float-outline'), 'v7 不得再有悬浮布局样式');
});

test('星图：卡片详情内嵌当前知识库，右下角铭牌浮窗已取消', () => {
  const g = read('desktop/ui/views/graph.js');
  assert.ok(g.includes('function kbBlock()'), '必须有内嵌库信息块');
  assert.ok(g.includes("cardBox.appendChild(kbBlock());"), '库信息必须与卡片详情同容器');
  assert.ok(!g.includes('function attachPlate()'), '不得再生成独立库铭牌浮窗');
  assert.ok(!g.includes("id: 'graph-plate'"), 'graph-plate 浮窗须移除');
  assert.ok(g.includes("kbPlateEl.style.display = 'none'"), '画布旧铭牌须隐藏');
  assert.ok(!g.includes('星图**右下角**'), '不得再用 Markdown 星号糊在提示文案里');
});

test('全库总览：星图 HUD / 命令面板 / 能力服务 / 装配清单四处接线', () => {
  const app = read('desktop/ui/app.js');
  assert.ok(app.includes("vaultOverview: { loader: () => import('./views/vault-overview.js'), key: 'mountVaultOverview' }"));
  assert.ok(app.includes('vaultOverview: \'全库总览\''));
  assert.ok(app.includes('全库总览（所有知识库与真实关联）'));
  const g = read('desktop/ui/views/graph.js');
  assert.ok(g.includes("openFloat('vaultOverview')"), '星图 HUD 必须能打开全库总览');
  const s = read('desktop/ui/views/settings.js');
  // v6.41.0：按用户要求从设置侧栏移除「全库总览」入口；功能经星图 HUD / 命令面板保留。
  assert.ok(!s.includes('title: \'全库总览\''), '设置侧栏必须已移除全库总览入口');
  const stage = read('tools/stage-app.mjs');
  assert.ok(stage.includes("'ui/views/vault-overview.js'"), '新视图必须纳入装配清单');
});

test('全库总览视图：真实数据、真实动作、零示例值', () => {
  const v = read('desktop/ui/views/vault-overview.js');
  assert.ok(v.includes('api.vaults?.xgraph?.({ force })'), '必须读取真实跨库图谱');
  assert.ok(v.includes('api.vault.list()'), '必须读取真实库登记');
  assert.ok(v.includes('createXGalaxy('), '必须复用真实 3D 多库星系');
  assert.ok(v.includes('api.vault.switch(selected.id)'), '切换库必须走真实 IPC');
  assert.ok(v.includes('unmount()'), '卸载必须释放 WebGL 上下文');
  assert.ok(!/示例数据|mock\s*[:=]|demo\s*[:=]|fake\s*[:=]/.test(v), '不得造数据');
  assert.ok(v.includes('共享标题×2 + 共享标签'), '关联算法必须如实说明');
});

test('设置-关于：开发者信息真实来源 + 功能项目可点击', () => {
  const s = read('desktop/ui/views/settings.js');
  assert.ok(s.includes("k: '开发者', v: '宋锦涛'"));
  assert.ok(s.includes("k: '联系方式', v: '13869162267'"));
  assert.ok(s.includes("k: '许可', v: isEnt ? '专有商用许可' : 'AGPL-3.0'"), '许可须与 AGPL 开源口径一致');
  assert.ok(s.includes("k: '签名', v: 'CN=宋锦涛 · 本机自签名'"));
  assert.ok(s.includes("h2', null, '开发者信息'"));
  assert.ok(s.includes("h2', null, '功能项目'"));
  assert.ok(s.includes('class: \'st-feature\''), '功能项目必须是真实按钮');
  assert.ok(s.includes('onclick: () => (openFloat || route)(f.key)'));
});

test('设置页悬停展开一级功能目录，点击直达对应功能区', () => {
  const s = read('desktop/ui/views/settings.js');
  assert.ok(s.includes('const NAV_GROUPS = ['), '必须存在功能分组真源');
  assert.ok(s.includes('? SERVICES.filter((s) => !s.ent || isEnt).map((s) => ({ label: s.title, key: s.key }))'), '能力与服务须按版本平铺全部真实功能');
  assert.ok(s.includes('onmouseenter: () => setExpanded(g.key)'), '悬停必须展开');
  assert.ok(s.includes('class: \'settings-nav-leaf\''), '子项须作为一级目录渲染');
  assert.ok(s.includes('onclick: () => activateLeaf(leaf)'), '点击子项必须直达');
  assert.ok(s.includes("anchor: 'stDeveloper'") && s.includes("id: 'stDeveloper'"));
  assert.ok(s.includes("anchor: 'stVaultEnabled'") && s.includes("'stVaultEnabled')"));
  const css = read('desktop/ui/neocosmos-v2.css');
  assert.ok(css.includes('.settings-nav-item.is-expanded + .settings-nav-leaves{ display:flex; }'));
  assert.ok(css.includes('.settings-pane > .st-section{ max-width:940px; margin:0 auto; }'));
});

test('星图标签：实色可读胶囊，后方标签不再淡到不可见', () => {
  const css = read('desktop/ui/neocosmos-v2.css');
  assert.ok(css.includes('body.neo-v2 .cosmos-label{'));
  assert.ok(/body\.neo-v2 \.cosmos-label\{[\s\S]*?background:var\(--surface\)/.test(css));
  assert.ok(/body\.neo-v2 \.cosmos-label\{[\s\S]*?backdrop-filter:none/.test(css));
  assert.ok(css.includes('body.neo-v2 .cosmos-label.is-dim{ opacity:.62 !important; }'));
  const cosmos = read('desktop/ui/cosmos.js');
  assert.ok(cosmos.includes("pointerEvents: 'none', zIndex: '4'"), '标签层须高于画布装饰层');
});
