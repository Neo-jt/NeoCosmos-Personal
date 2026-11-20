// v6.37.0 企业版知识库 API 自动同步器契约测试（mock fetch，零网络）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../desktop/vault-sync.cjs');

test('默认配置：默认关闭、5 分钟间隔、字段齐全', () => {
  const c = S.readSyncConfig({});
  assert.equal(c.enabled, false);
  assert.equal(c.intervalMs, 300000);
  assert.equal(c.baseUrl, '');
  assert.equal(typeof S.sha256, 'function');
});

test('patchSyncConfig：只接受已知字段，间隔钳制在 30s~24h', () => {
  const cfg = { other: 1, enterprise: { sedimentEnabled: true } };
  const out = S.patchSyncConfig(cfg, { enabled: true, baseUrl: 'http://x', evil: 9, intervalMs: 1 });
  assert.equal(out.other, 1);
  assert.equal(out.enterprise.sedimentEnabled, true);
  assert.equal(out.enterprise.sync.enabled, true);
  assert.equal(out.enterprise.sync.baseUrl, 'http://x');
  assert.equal(out.enterprise.sync.evil, undefined);
  assert.equal(out.enterprise.sync.intervalMs, 30000);
});

test('pull：首次全量新增，二次不变则 unchanged（增量去重）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsync-'));
  const cards = [
    { id: 'a1', title: '卡片A', fts_text: '内容甲' },
    { id: 'b2', title: '卡片B', body: '内容乙' },
  ];
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => ({ ok: true, cards }) }; };
  const opts = { baseUrl: 'http://api.test', destDir: dir, fetchImpl };
  const r1 = await S.pull(opts);
  assert.equal(r1.ok, true);
  assert.equal(r1.added, 2);
  assert.equal(r1.unchanged, 0);
  const r2 = await S.pull(opts);
  assert.equal(r2.ok, true);
  assert.equal(r2.added, 0);
  assert.equal(r2.unchanged, 2);
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(path.join(dir, 'a1.md')), true);
  assert.equal(fs.existsSync(path.join(dir, 'sync-state.json')), true);
});

test('pull：远端内容变化则更新；不覆盖用户正文目录', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsync-'));
  let cards = [{ id: 'c3', title: '旧', fts_text: '旧内容' }];
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ cards }) });
  const opts = { baseUrl: 'http://api.test', destDir: dir, fetchImpl };
  await S.pull(opts);
  cards = [{ id: 'c3', title: '新', fts_text: '新内容' }];
  const r = await S.pull(opts);
  assert.equal(r.updated, 1);
  const text = fs.readFileSync(path.join(dir, 'c3.md'), 'utf8');
  assert.match(text, /新内容/);
  assert.doesNotMatch(text, /旧内容/);
});

test('pull：HTTP 非 2xx / 无链接 / 超时都如实报错，不伪造成功', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsync-'));
  const r0 = await S.pull({ baseUrl: '', destDir: dir });
  assert.equal(r0.ok, false);
  assert.match(r0.error, /未配置/);
  const r1 = await S.pull({ baseUrl: 'http://api.test', destDir: dir, fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /403/);
  const r2 = await S.pull({ baseUrl: 'http://api.test', destDir: dir, fetchImpl: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /超时/);
});

test('pull：Bearer 令牌头正确透传（复用对外 API 鉴权体系）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsync-'));
  let seenHeaders = null;
  const fetchImpl = async (_url, init) => { seenHeaders = init.headers; return { ok: true, status: 200, json: async () => ({ cards: [] }) }; };
  await S.pull({ baseUrl: 'http://api.test', token: 'secret-token', destDir: dir, fetchImpl });
  assert.equal(seenHeaders.authorization, 'Bearer secret-token');
});
