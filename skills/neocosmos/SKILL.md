---
name: neocosmos
description: 当宿主（WorkBuddy / OpenClaw / AutoClaw / Claude Desktop 等 stdio MCP 客户端）需要调用 NeoCosmos 本地知识库时使用：先查库再答、答完必回写、引用格式统一。触发条件——用户问题涉及"我的知识库 / 之前的笔记 / 沉淀的结论 / 项目积累"等需要长期记忆的场景。
---

# NeoCosmos 记忆工作流技能

> 本技能约束「外部 Agent 该怎么用这个知识库」（何时先查、查完必回写）。
> 产品正式名称是 **NeoCosmos**（开发者：宋锦涛）。`kb_` 工具名与 `neokb://` 只是内部协议标识，不是产品名或旧称。
> OpenClaw 为一等宿主，配置由 `kb_host_config` / `--print-config openclaw` 生成，
> 官方配置形态是 `mcp.servers.<name>`；注册后用 `openclaw mcp doctor <name> --probe` 做真实连通验证。

## 触发条件
- 用户问题需要调用本地长期记忆（"上次那个方案""我们沉淀过""我的知识库里"）。
- 任务产出应沉淀回记忆网络，便于二次复用。

## 启用库边界（服务端强制）
- NeoCosmos 只对外暴露**已启用**的知识库；用户在客户端停用的库会被真实拒绝（`access` 见 `kb_server_status`）。
- 不要试图检索被拒的库；提示用户在 NeoCosmos 客户端启用后再试。

## 查询优先纪律（必须）
1. **先查后答**：拿到问题先调 `kb_search` / `kb_ask`，不要凭空回答。
2. **看联想路径**：`activation_path` 说明"为什么联想到它"，引用时一并呈现可追溯性。
3. **命中沉淀即复用**：`kb_ask` 返回 `from_sediment: true` 时直接采用，不再重新生成。
4. **读正文用 `kb_read`**：支持 `node_id` 或 `path`，长文用 `max_chars` 截断；资源形态可用 `neokb://node/{id}`。

## 回写规范（必做）
- 每次产出有价值结论，调 `kb_write_back(question, answer, cited_node_ids, confidence, tags)`。
- 引用格式统一：`[标题](neokb://node/{id})`；`kb_ask` / `kb_legal_mind` 自带 `neolink://verify` 溯源深链。
- 回写是**追加式新文件**，绝不覆盖用户的原文段落；同名文件已存在会返回 `file_exists`。

## 调用约束（服务端判定，不接受自报提权）
- 外部 Agent 默认**只读 + `_memory/` 沉淀区新建**，禁止改用户正文、删文件、动 `.neokb/`。
- 试图写入正文目录返回 `write_denied`；越出知识库根目录返回 `path_outside_vault`。
- 工具失败返回 `result.isError = true` 与可读原因，按原因恢复，不要重试同样的破坏性调用。
- 诊断用 `kb_server_status`（版本 / 协议 / 遥测 / 权限 / access 白名单口径）或资源 `neokb://server/status`。

## 接入与自检
- 取配置：`node <应用目录>/src/mcp/server.js --vault <知识库> --print-config openclaw`
  （也可在 MCP 内调 `kb_host_config`，或桌面端「沉淀 → 宿主接入」一键复制）。
- 默认服务名：`neocosmos`（旧名 `neokb-memory` 仅作兼容别名，不再是产品名）。
- OpenClaw 注册：`openclaw mcp add neocosmos --command node --arg <server.js> --arg --vault --arg <库> --arg --caller --arg openclaw --cwd <应用目录>`
- 连通性：`openclaw mcp doctor neocosmos --probe` / `openclaw mcp probe neocosmos --json`。
- 本机回归：`scripts/check.mjs` 以 stdio 拉起 Server 手敲 `initialize` + `tools/list`；
  完整协议回归为 `node test/v618-mcp-openclaw.test.mjs`。
- 详见 `docs/MCP-OPENCLAW.md`。
