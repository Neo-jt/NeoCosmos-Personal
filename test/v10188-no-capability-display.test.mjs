// v10.18.8 契约：能力中枢 / 完整能力矩阵属内部知识产权，不得在用户可见层展示入口。
// 内部路由与视图仅为自检保留；设置页、命令面板、功能项目列表均不得给出点击入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('设置页无「完整能力矩阵 / 查看能力中枢」及任何中枢入口', () => {
  const s = read('desktop/ui/views/settings.js');
  for (const text of ['完整能力矩阵', '查看能力中枢', 'stCapabilities', "key: 'capabilities'"]) {
    assert.ok(!s.includes(text), `设置页仍有可见入口：${text}`);
  }
});

test('命令面板不再把能力中枢列为可执行命令', () => {
  const s = read('desktop/ui/app.js');
  assert.ok(!s.includes("route('capabilities')"), '命令面板不得有中枢直达命令');
  assert.ok(s.includes('视图与路由保留用于内部自检'), '须说明保留原因，避免误删视图');
});

test('OVERLAY 仍保留 capabilities 路由，供内部自检与既有探针读取', () => {
  const s = read('desktop/ui/app.js');
  assert.ok(/capabilities: \{ loader: \(\) => import\('\.\/views\/capabilities\.js'\), key: 'mountCapabilities' \}/.test(s));
  assert.ok(s.includes('capabilities: CAPABILITY_MANIFEST'));
});
