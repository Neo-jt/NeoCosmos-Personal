// v10.18.8 契约：命令面板检索结果必须真的可点击、可跳转到对应卡片。
// 回归 bug：结果项渲染在标题栏内，动态节点未显式 no-drag 时点击被拖拽区吞掉；
// 同时旧实现只有 Enter 键能打开卡片，鼠标点击没有绑定任何处理器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('结果项是真正的 button，且鼠标与指针双通道都绑定打开动作', () => {
  const s = read('desktop/ui/app.js');
  const paint = s.slice(s.indexOf('const paint = () =>'), s.indexOf('const run = async () =>'));
  assert.equal((paint.match(/h\('button',/g) || []).length, 2, '卡片项与命令项都必须是 button');
  assert.ok(/onpointerdown:\s*openIt,\s*onclick:\s*openIt/.test(paint), '卡片项需同时绑定 pointerdown 与 click');
  assert.ok(/onpointerdown:\s*runIt,\s*onclick:\s*runIt/.test(paint), '命令项需同时绑定 pointerdown 与 click');
});

test('卡片结果点击后打开对应卡片并切到文档台，且有防重复执行', () => {
  const s = read('desktop/ui/app.js');
  const paint = s.slice(s.indexOf('const paint = () =>'), s.indexOf('const run = async () =>'));
  const openIt = paint.slice(paint.indexOf('const openIt = () =>'), paint.indexOf('node = h('));
  assert.ok(openIt.includes('if (opened) return; opened = true;'), '同一结果只允许执行一次');
  assert.ok(openIt.includes('app.openCard(id); route(\'workspace\')'), '必须打开 id 对应卡片并跳转工作区');
  assert.ok(openIt.includes('close(); input.value = \'\''), '执行后收起面板并清空输入');
});

test('no-drag 用 camelCase 写入内联样式，kebab key 不可担任真源', () => {
  const s = read('desktop/ui/app.js');
  assert.ok(s.includes("WebkitAppRegion: 'no-drag'"), 'CSSStyleDeclaration 只认 camelCase');
  assert.ok(!s.includes("'-webkit-app-region': 'no-drag'"), 'kebab key 经 Object.assign 会被静默丢弃');
});

test('样式层为结果项及其后代显式 no-drag，并重置 button 默认外观', () => {
  const css = read('desktop/ui/styles.css');
  assert.ok(/\.cmd-res,\.cmd-cmd,\.cmd-res \*,\s*\.cmd-cmd \*\{-webkit-app-region:no-drag\}/.test(css));
  assert.ok(/\.cmd-cmd\{[^}]*background:transparent[^}]*width:100%[^}]*text-align:left/.test(css),
    'button 化后必须去掉默认背景并撑满宽度');
  const v7 = read('desktop/ui/neocosmos-v2.css');
  assert.ok(/body\.neo-v2 \.cmd-res,[\s\S]{0,200}webkit-app-region:no-drag/.test(v7), 'v7 视觉层仍需双保险');
});
