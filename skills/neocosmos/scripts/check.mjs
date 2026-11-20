// NeoCosmos MCP 连通性自检（Agent Skill 用）
// 以 stdio 拉起 server，发送 initialize + tools/list，验证返回。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../../../src/mcp/server.js');
const vault = process.env.NEOKB_VAULT || path.resolve(here, '../../../.neokb-prototype/vault');

const child = spawn(process.execPath, [serverPath, '--vault', vault, '--caller', 'skill-check'], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const pending = [];
function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}
function onLine(line, resolve) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === 1) { console.log('initialize OK, serverInfo=', JSON.stringify(msg.result.serverInfo)); send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); }
  else if (msg.id === 2) {
    const tools = msg.result.tools.map((t) => t.name);
    console.log('tools/list OK, 工具数=', tools.length);
    console.log('工具清单:', tools.join(', '));
    const need = ['kb_search','kb_read','kb_expand','kb_ask','kb_write_back','kb_add_node','kb_link','kb_find_concept','kb_graph_stats','kb_review_queue','kb_apply_review','kb_history'];
    const missing = need.filter((n) => !tools.includes(n));
    console.log(missing.length ? '✗ 缺失工具: ' + missing.join(',') : '✓ 12 个工具全部就绪');
    child.kill();
    process.exit(missing.length ? 1 : 0);
  }
}

child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) onLine(line); }
});

child.on('spawn', () => {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {} } });
});
child.on('error', (e) => { console.error('无法拉起 server:', e.message); process.exit(1); });
setTimeout(() => { console.error('超时'); process.exit(1); }, 10000);
