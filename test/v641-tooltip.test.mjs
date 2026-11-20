// v6.41.0 最终修正：设置按钮悬停提示删除，可见文字与路由保留
// 断言全部来自真实源码，不使用示例值。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('设置按钮不再渲染悬停提示（title 属性已移除）', () => {
  const html = read('desktop/ui/index.html');
  const m = html.match(/<button[^>]*id="railItemSettings"[^>]*>/);
  assert.ok(m, '必须能定位到设置按钮');
  assert.ok(!/\btitle\s*=/.test(m[0]), '设置按钮不得带 title，否则鼠标悬停会弹出原生提示');
  assert.ok(/data-view="settings"/.test(m[0]), '设置按钮路由不能丢');
  assert.ok(/class="rail-item rail-settings"/.test(m[0]), '设置按钮样式类不能丢');
});

test('设置按钮可见文字保留，删除提示不影响可发现性', () => {
  const html = read('desktop/ui/index.html');
  const i = html.indexOf('id="railItemSettings"');
  assert.ok(i > -1, '必须能定位到设置按钮');
  const tail = html.slice(i, i + 900);
  assert.ok(/<span>设置<\/span>/.test(tail), '设置按钮必须保留可见文字标签');
});

test('真机探针钉死悬停提示删除与标签保留', () => {
  const probe = read('tools/probe-v641.js');
  assert.ok(probe.includes('settingsTooltipRemoved'), '探针必须检查 title 已删除');
  assert.ok(probe.includes('settingsLabelKept'), '探针必须检查可见文字仍在');
});
