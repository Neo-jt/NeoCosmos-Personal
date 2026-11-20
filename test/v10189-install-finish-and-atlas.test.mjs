// v10.18.9 契约：①安装完成页文字不得被截断；②「体系」与「体系管理」只留一个入口。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('安装完成页：去掉空行并压缩商用说明，三行文案可完整显示', () => {
  const nsi = read('tools/installer.nsi');
  const line = nsi.split('\n').find((l) => l.includes('!define MUI_FINISHPAGE_TEXT'));
  assert.ok(line, '必须有完成页文案定义');
  assert.ok(!line.includes('$\\r$\\n$\\r$\\n'), '空行会挤掉末尾文字，必须去掉');
  assert.equal((line.match(/\$\\r\$\\n/g) || []).length, 2, '保留两处换行：感谢 / 联系方式 / 授权说明');
  assert.ok(line.includes('${FINISH_CONTACT}') && line.includes('${FINISH_EXTRA}'));
  const extra = nsi.split('\n').find((l) => l.trim().startsWith('!define FINISH_EXTRA')
    && l.includes('AGPL-3.0'))?.trim() || '';
  assert.ok(extra.length > 0 && extra.length < 110, '个人版授权说明须短到不换行超出控件');
  assert.ok(extra.includes('闭源商用须授权'), '授权边界仍须说清');
});

test('设置页：体系与体系管理合并，只保留知识库下的体系管理', () => {
  const s = read('desktop/ui/views/settings.js');
  assert.equal((s.match(/key: 'atlas'/g) || []).length, 1, 'atlas 路由只能出现一次');
  assert.ok(!s.includes("title: '体系'"), '能力与服务里的重复「体系」须删除');
  assert.ok(s.includes("label: '体系管理'"), '保留知识库下的「体系管理」');
});
