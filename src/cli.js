// NeoCosmos CLI 入口（零依赖）
// 用法示例：
//   node src/cli.js build  --vault <目录>
//   node src/cli.js ask    --vault <目录> "问题"
//   node src/cli.js stats  --vault <目录>
//   node src/cli.js demo

import path from 'node:path';
import fs from 'node:fs';
import { KbStore, indexVault } from './storage/store.js';
import { activate } from './engine/diffusion.js';
import { ConsolidationScheduler } from './consolidation/consolidate.js';
import { callTool } from './mcp/tools.js';

function parseArgs(argv) {
  const a = { _: [], vault: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--vault') a.vault = argv[++i];
    else a._.push(argv[i]);
  }
  return a;
}

async function buildIndex(store) {
  await indexVault(store);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!cmd) { console.log('子命令: build | ask | stats | demo'); process.exit(0); }

  if (cmd === 'demo') { import('./demo.js').then((m) => m.run()); return; }

  if (!a.vault) { console.error('缺少 --vault'); process.exit(1); }
  const store = new KbStore(a.vault).load();
  await buildIndex(store);
  const ctx = { store, caller: 'cli', canWriteBody: true };

  if (cmd === 'build') {
    console.log(`已建索引: 节点=${store.nodes.size} 边=${store.edges.size}`);
  } else if (cmd === 'stats') {
    const sched = new ConsolidationScheduler(store);
    console.log(JSON.stringify(sched.healthReport(), null, 2));
  } else if (cmd === 'ask') {
    const q = a._.slice(1).join(' ') || '测试';
    const res = callTool('kb_ask', { question: q, mode: 'generate' }, ctx);
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log('未知子命令:', cmd);
  }
}

main();
