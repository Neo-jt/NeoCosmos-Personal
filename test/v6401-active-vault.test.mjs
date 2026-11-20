// v6.40.1 契约：外部平台调取以 NeoCosmos 当前打开的库为准（不再命中示例库）
// ---------------------------------------------------------------------------
// 验证三条链路：
//   1. active-vault 跨进程真源读写（mcp-links.cjs）
//   2. MCP Server 启动时用当前库覆盖固化的 --vault
//   3. print-config 生成接入配置时也指向当前库
//   4. 主进程 openVault 发布当前库
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  [PASS] ${n} ${x}`); } else { fail++; console.log(`  [FAIL] ${n} ${x}`); } };

console.log('\n=== v6.40.1 当前库调取契约 ===\n');

// [1] active-vault 真源模块
const links = require(path.join(ROOT, 'desktop', 'mcp-links.cjs'));
ok('mcp-links 导出 activeVaultFile/writeActiveVault/readActiveVault',
  typeof links.activeVaultFile === 'function' &&
  typeof links.writeActiveVault === 'function' &&
  typeof links.readActiveVault === 'function');
ok('active-vault.json 位于 ~/.neocosmos/（跨进程固定推导）',
  /active-vault\.json$/.test(links.activeVaultFile()));

// [2] MCP Server 覆盖逻辑
const server = read('src/mcp/server.js');
ok('server.js import resolveActiveVault', /resolveActiveVault/.test(server) && /link-bridge\.js/.test(server));
ok('会话启动用 NEOKB_PIN_VAULT 开关 + resolveActiveVault 覆盖 --vault',
  /NEOKB_PIN_VAULT/.test(server) && /resolveActiveVault\(\)/.test(server) &&
  /vaultRoot\s*=\s*active\.vaultPath/.test(server));
ok('print-config 也跟随当前库',
  /if \(args\.printConfig\)[\s\S]*resolveActiveVault\(\)[\s\S]*cfgVault\s*=\s*active\.vaultPath/.test(server));
ok('库来源如实标注 neocosmos-active / cli', /vaultSource\s*=\s*'neocosmos-active'/.test(server) && /vaultSource\s*=\s*'cli'/.test(server));

// [3] 状态工具回报库来源
const tools = read('src/mcp/tools.js');
ok('kb_server_status 回报 vault.source', /source:\s*ctx\.vaultSource/.test(tools));

// [4] link-bridge 导出
const bridge = read('src/mcp/link-bridge.js');
ok('link-bridge 导出 resolveActiveVault', /export function resolveActiveVault/.test(bridge) && /readActiveVault/.test(bridge));

// [5] 主进程发布当前库
const main = read('desktop/main.js');
ok('openVault 写入 active-vault（writeActiveVault）',
  /mcpLinks\.writeActiveVault\s*\(/.test(main) && /vaultPath:\s*state\.root/.test(main));

// [6] 旧配置清理工具存在且安全（归档式）
const cleanup = read('tools/cleanup-legacy-config.mjs');
ok('清理工具仅归档不删除（renameSync 到 .legacy）', /renameSync/.test(cleanup) && /legacy-neocosmos/.test(cleanup));
ok('清理工具明确不触碰知识库数据', /不触碰|完全不触碰/.test(cleanup) && !/rmSync\([^)]*vault/.test(cleanup));
ok('清理工具默认 dry-run，需 --apply', /process\.argv\.includes\('--apply'\)/.test(cleanup));

console.log(`\n=== 结果：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
