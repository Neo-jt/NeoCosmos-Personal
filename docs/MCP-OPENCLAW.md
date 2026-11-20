# NeoCosmos MCP · OpenClaw 接入说明（v6.18.0）

> 适用：NeoCosmos v10.18.9。产品正式名称是 **NeoCosmos**；`kb_` 工具名与 `neokb://` 为内部协议标识，不是产品名。本文只描述**真实实现**，不含演示数值。
> 全部数据留在本机；MCP Server 不联网、不上传、不预置知识库。

---

## 1. 支持矩阵

同一个 stdio MCP Server（`src/mcp/server.js`）现在按宿主形态输出不同配置，共用同一份工具实现：

| 宿主 | caller | 配置形态 | 生成方式 |
| --- | --- | --- | --- |
| **OpenClaw** | `openclaw` | 官方 `mcp.servers.<name>`；另给社区兼容 `mcpServers` 形态 | `--print-config openclaw` / `kb_host_config` / 客户端「沉淀」页 |
| WorkBuddy | `workbuddy` | `mcpServers` | 同上 |
| AutoClaw | `autoclaw` | `mcpServers`（与上同） | `--caller autoclaw` |
| Claude Desktop | `workbuddy` | `claude_desktop_config.json` 的 `mcpServers` | `--print-config claude-desktop` |
| 通用 MCP 客户端 | `api` | `mcpServers` | `--print-config generic` |

配置的**单一真源**是 `src/mcp/hosts.js`：路径由模块自身的真实位置推导，桌面端「沉淀」页、`kb_host_config` 工具与 CLI 都调用它，不会出现三份互相漂移的复制文本。

---

## 2. OpenClaw 三步接入

### 第 1 步 · 取配置（不启动服务）

```bash
node <安装目录>\resources\app\src\mcp\server.js \
  --vault "D:\我的知识库" --print-config openclaw
```

输出是合法 JSON，形如：

```json
{
  "host": "openclaw",
  "label": "OpenClaw",
  "shape": "mcp.servers",
  "serverName": "neocosmos",
  "caller": "openclaw",
  "configPath": "OpenClaw 配置文件 · mcp.servers.<name>（Settings → MCP / CLI add）",
  "config": {
    "mcp": {
      "servers": {
        "neocosmos": {
          "command": "node",
          "args": ["<真实绝对路径>\\src\\mcp\\server.js", "--vault", "D:\\我的知识库", "--caller", "openclaw"],
          "cwd": "<应用根目录>",
          "transport": "stdio",
          "enabled": true
        }
      }
    }
  },
  "legacyConfig": { "mcpServers": { "neocosmos": { "...": "..." } } },
  "cli": { "add": "...", "set": "...", "doctor": "...", "probe": "...", "status": "..." },
  "notes": ["..."]
}
```

`caller` 取自宿主预设，因此 `--print-config openclaw` 生成的 `--caller` 一定是 `openclaw`（只有显式传 `--caller` 才覆盖）；`legacyConfig` 是社区旧配置的兼容形态，与工具 `kb_host_config` 的返回值同源，CLI 与桌面端三入口不会再出现字段漂移。

桌面客户端里也可以：「沉淀」→「宿主接入」选 OpenClaw →「生成并复制配置」。

### 第 2 步 · 注册

官方 CLI（定义写入 `mcp.servers`，推荐）：

```bash
openclaw mcp add neocosmos \
  --command node \
  --arg "<server.js 绝对路径>" --arg --vault --arg "<知识库目录>" \
  --arg --caller --arg openclaw \
  --cwd "<应用根目录>"
```

或者把 `config` 里的 `mcp.servers` 段写进 OpenClaw 配置（Settings → MCP 的 scoped editor 亦可）：

```json5
{
  mcp: {
    servers: {
      "neocosmos": {
        command: "node",
        args: ["<server.js 绝对路径>", "--vault", "<知识库目录>", "--caller", "openclaw"],
        cwd: "<应用根目录>",
        transport: "stdio",
        enabled: true,
      },
    },
  },
}
```

> 兼容提示：社区旧文档里的 `~/.openclaw/mcp_config.json` + `mcpServers` 形态由工具以 `legacyConfig` 单独给出，**不是官方文档的配置形态**；新装环境请用 `mcp.servers`。
> 运行依赖：宿主机需有 **Node.js ≥ 18** 且 `node` 在 PATH 中；否则把 `command` 改成 node 可执行文件的绝对路径。

### 第 3 步 · 验证（保存配置不等于连得上）

```bash
openclaw mcp doctor neocosmos --probe   # 静态检查 + 真实连通
openclaw mcp probe neocosmos --json     # 列出工具 / resources / prompts 能力
openclaw mcp status --verbose              # 只看配置，不连接
```

本机回归（不依赖 OpenClaw 安装）：

```bash
node test/v618-mcp-openclaw.test.mjs       # 真实 spawn stdio 会话，逐帧验证
```

---

## 3. 协议能力（真实实现，可逐条核验）

| 能力 | 行为 |
| --- | --- |
| `initialize` | **协商** `protocolVersion`：客户端声明的版本在支持集合内则原样回显，否则回落 `2025-06-18`；返回 `serverInfo`（版本取 `desktop/package.json` 真源）与 `instructions`（工作流与边界，随工具交给 agent） |
| `capabilities` | `tools / resources / prompts` 三项；`listChanged`、`subscribe` 如实声明为 false |
| `tools/list` | 15 个工具：12 个历史工具 + `kb_server_status`（真实遥测）+ `kb_host_config`（宿主接入） |
| `tools/call` | 工具异常返回 `result.isError = true` + 可读原因（OpenClaw 会把错误文本交给 agent 恢复），不是协议级 error |
| `resources/list` | 3 个固定资源 + 真实节点资源，按 `cursor` 分页 |
| `resources/templates/list` | `neokb://node/{id}` 模板 |
| `resources/read` | `vault/manifest`（真实计数）、`graph/overview`（真实体检）、`server/status`（真实遥测）、`node/{id}`（真实 Markdown 正文）；未知 URI 返回 `-32002` |
| `prompts/list` / `prompts/get` | 工作流提示词，支持 `question` 参数真实替换 |
| `ping` / `shutdown` | 有响应；所有无 `id` 的通知**一律不回包**（符合 JSON-RPC） |
| 非法帧 | 单行 JSON 解析失败返回 `-32700`，不终止会话；单行超过 8MB 无换行则丢弃 |

---

## 4. 权限模型（服务端判定，不接受调用方自报）

- stdio 通道一律视为**外部 Agent**：`canWriteBody = false`，`--caller ui` / `api` 之类的自报提权会被归一为 `agent`。
- 允许：检索、读取、在 `_memory/` 沉淀区**新建**文件（`kb_write_back` / `kb_add_node`）。
- 拒绝：写入用户正文目录（`write_denied`）、覆盖任何已存在文件（`file_exists`）、越出知识库根目录的路径（`path_outside_vault`）。
- 桌面客户端不经过 stdio，走进程内 `tool:invoke` IPC，caller 为 `ui`，拥有完整编辑权限；两条路径的边界独立、可审计。
- 所有写操作进 `journal`，`hit_log` 记录 caller 与引用路径。

---

## 5. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| `probe` 起不来 | `command` 解析不到：确认 Node ≥ 18 在 PATH；`cwd` 目录存在；Windows 路径用引号包住 |
| 工具数不对 | 执行 `node src/mcp/server.js --help` 看真实工具数；配置里不要同时写 `command` 与 `url`（OpenClaw 会拒绝混合定义） |
| 有配置但没工具 | 检查 `toolFilter.include` / `exclude`；用 `openclaw mcp status --verbose` 看解析结果 |
| 写卡报 `file_exists` | 设计如此：拒绝覆盖用户正文，换一个 `path` 或不传 `path` 让引擎生成新文件 |
| 写卡报 `write_denied` | 外部 Agent 只能写 `_memory/`；请改用 `kb_write_back` 或把 `path` 放进沉淀区 |
| 中文乱码 / 路径异常 | 配置 JSON 用 UTF-8；`--vault` 传真实存在的目录绝对路径 |
| 想看进程是否活着 | 调 `kb_server_status` 或读 `neokb://server/status`，里面有请求数、逐方法耗时、错误计数与协商版本 |

---

## 6. 如实边界

- 数值内核是本机 CPU 上的确定性算法与经典数值模拟，**非真实量子计算**。
- 自主引擎是无模型 / 无网络 / 可审计 / 可回滚的本地行为架构，**不构成意识或生命**。
- 客户端不含内置知识库，知识库由使用者自行创建或导入；MCP 只是把这张本地网络开放给外部 Agent。
- 安装包使用自签名证书；OpenClaw 拉起的是本机 Node 进程，不涉及任何远端服务。
