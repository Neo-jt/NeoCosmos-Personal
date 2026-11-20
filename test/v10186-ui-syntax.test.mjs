// v10.18.7：UI 视图语法闸门。
// 背景：关于页新增方框时曾因括号多写一个导致 settings.js 运行时
// 「Unexpected token ')'」、设置浮层整页加载失败；静态文本测试与排版门禁
// 均无法发现（它们不解析 JS）。本测试用 node --check 逐个校验所有
// 会被浏览器加载的 UI 模块，任何语法错误立即失败，防止再漏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const UI = path.join(ROOT, 'desktop', 'ui');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js') && !name.includes('vendor')) out.push(p);
  }
  return out;
}

test('所有会被浏览器加载的 UI 模块通过语法检查', () => {
  const files = [path.join(UI, 'app.js'), path.join(UI, 'ui-kit.js'), ...walk(path.join(UI, 'views'))]
    .filter((f) => fs.existsSync(f));
  assert.ok(files.length >= 10, `UI 模块数量异常：${files.length}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-syntax-'));
  const failed = [];
  for (const f of files) {
    const mjs = path.join(tmp, path.basename(f).replace(/\.js$/, '.mjs'));
    fs.copyFileSync(f, mjs);
    try {
      execFileSync(process.execPath, ['--check', mjs], { stdio: 'pipe' });
    } catch (e) {
      failed.push(`${path.relative(ROOT, f)}: ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  assert.deepEqual(failed, [], `UI 语法错误：\n${failed.join('\n')}`);
});

test('关于页两个方框的点击回调确实绑定', () => {
  const src = fs.readFileSync(path.join(UI, 'views', 'settings.js'), 'utf8');
  assert.match(src, /st-developer-action donate[\s\S]{0,120}showAboutOverlay\('donate'\)/);
  assert.match(src, /st-developer-action license[\s\S]{0,120}showAboutOverlay\('license'\)/);
  assert.match(src, /st-about-qr[^\n]*donate-qr\.png/);
  assert.match(src, /联系开发者[\s\S]{0,80}\d{11}/);
});
