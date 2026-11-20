// v10.18.8 契约：「恢复 N 项移除」不是开发残留，而是本机用户「移除接入」留下的墓碑。
// ① 面板文案须说清来源；② 本机历史墓碑已清理；③ 清理后在线宿主可重新登记。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require(path.join(ROOT, 'desktop', 'mcp-links.cjs'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('面板不再用含糊的「恢复 N 项移除」，改为标明来源的撤销记录', () => {
  const s = read('desktop/ui/views/mcp-links-panel.js');
  assert.ok(!s.includes('项移除`)'), '旧文案须撤下');
  assert.ok(s.includes('条移除记录`)'), '新文案须给出');
  assert.ok(s.includes('并非开发残留'), '须明确告知记录来源');
  assert.ok(s.includes('移除记录只来自你点过的「移除接入」'), '面板脚注须说明来源');
});

test('本机历史墓碑已清空（备份保留，不误删用户其它策略）', () => {
  const p = path.join(process.env.USERPROFILE || os.homedir(), '.neocosmos', 'mcp-links', 'policy.json');
  if (!fs.existsSync(p)) return;
  const policy = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepEqual(policy.removedSessions || [], [], '会话墓碑须为空');
  assert.deepEqual(policy.removedPlatforms || [], [], '平台墓碑须为空');
  assert.deepEqual(policy.removedByPlatform || {}, {}, '平台关联墓碑须为空');
  assert.equal(policy.paused, false, '不得顺带改变暂停状态');
});

test('真实临时目录：撤销墓碑后宿主可再次登记', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neocosmos-cleanup-'));
  const sid = 'cleanup1111';
  const rec = {
    sid, caller: 'workbuddy', callerLabel: 'WorkBuddy',
    platformKey: 'workbuddy', platformLabel: 'WorkBuddy', identitySource: 'caller',
    pid: process.pid, vault: 'D:/notes', serverVersion: '10.18.8', platform: process.platform,
  };
  L.record(dir, 'hello', rec);
  assert.equal(L.aggregate(dir).platforms.length, 1, '须先有真实登记');
  L.removeSessions(dir, { scope: 'platform', platformKey: 'workbuddy' });
  assert.equal(L.aggregate(dir).platforms.length, 0, '移除后不应再有登记');
  L.record(dir, 'heartbeat', rec);
  assert.equal(L.aggregate(dir).platforms.length, 0, '墓碑仍在时心跳不得复活');
  const p = L.readPolicy(dir);
  L.restoreRemoved(dir, { sids: p.removedSessions, platformKey: 'workbuddy' });
  L.record(dir, 'hello', rec);
  assert.equal(L.aggregate(dir).platforms.length, 1, '撤销后须能重新登记');
});
