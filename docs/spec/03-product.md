# NeoCosmos 桌面产品 · 综合设计说明（v1.0.0）

> 配套：[`00-concept.md`](00-concept.md) 概念构想 · [`01-architecture.md`](01-architecture.md) 架构 · [`02-mechanisms.md`](02-mechanisms.md) 机制
> 本文回答三件事：**这个产品被设计成什么样子**、**为什么这样组织**、**它如何被交付到 Windows 桌面**。

---

## 一、产品定位

一句话：**把"回忆"这件事做成一台机器，而不是做一个文件夹。**

传统知识工具的原子是"文档/条目"，关系只是文档的附属（标签、双链、目录）。NeoCosmos 的原子是**突触**——一条带类型、带权重、会被强化也会衰减、并且能解释自己为什么被想起来的关系。文档只是突触交汇处的暂态投影。

这个倒置不是措辞变化，它决定了哪些能力是**架构内生的**（而插件补不出来）：

| 面向用户的能力 | 架构内生的原因 |
|---|---|
| 忘记措辞也能想到它（隐式召回） | 激活扩散沿结构传播，不依赖词面重合 |
| 每次联想都能给出"为什么会想到" | 扩散过程天然产生 `activation_path` |
| 越用越准 | 突触可塑性（长期增强 / 按半衰期衰减） |
| 睡一觉自己整理 | 巩固任务：消歧 / 补边 / 孤立与矛盾检测 / 衰减 |
| 机器永远不敢改你的正文 | 沉淀区独立、写操作全量 journal、UI 层只读展示原文 |

---

## 二、信息架构（五个模块，一条闭环）

```
         ┌──────── 沉淀 COMPOSE ────────┐
         │  回写问答 / 新增卡片 / 审阅   │
         ▼                              │
   召回 RECALL ──► 星图 NEBULA ──► 体系 CONSOLE
   扩散检索      三维联想视界     体检·溯源·设置
         ▲                              │
         └──────── 巩固 SLEEP ──────────┘
              消歧 / 补边 / 衰减 / 健康度
```

- **星图 NEBULA**：主角。3D 突触星座，既是浏览也是"概率分布的可视化"——你看到的发光强度就是此刻的激活值。
- **召回 RECALL**：工作口。提问 → 扩散 → 每个结果附带推理链 → 可一键沉淀。
- **沉淀 COMPOSE**：输入端。回写卡片（追加式）+ 新增卡片 + 待整理清单（**只给建议，执行需人确认**）。
- **巩固 SLEEP**：维护端。一轮睡眠把网络整理一遍，产出清单与健康度。
- **体系 CONSOLE**：信任端。规模、各类突触占比、记忆层分布、写操作溯源 journal —— 让用户能"审计"这台机器。

**闭环**：提问（召回）→ 得到结论 → 回写（沉淀）→ 下次提问直接命中沉淀卡片 → 定期睡眠整理（巩固）→ 在体系中审计全部写入（溯源）。

---

## 三、视觉体系（为什么是这个样子）

参考意象是**深空**：不是"深色模式的表格软件"，而是有纵深、有光源、有大气辉光的空间。

- **底色**：`#05070F` → `#0C1130` 的深空渐变，右上硬光源（`rgba(255,255,255,.65)` 一级星点 + 星云配色），左下压暗。
- **骨色**：紫 `violet #7B5CFF` / 洋红 `magenta #C77DFF`——用于主行动与"活着的关系"。
- **信息色**：青 `cyan #46E0FF`（数据 / 引擎状态）、蓝 `azure #5FA8FF`（层级）、薄荷 `mint #3FE0C8`（共现）、玫红 `rose #FF6B8A`（因果 / 风险）、金 `gold #D4A843`（老化 / 需处置）。
- **材质**：半透明面板 + 背板 22px 模糊 + 1px 低透明度描边；无重投影、无纯黑；所有发光由 bloom 后处理产生而非贴图叠加。
- **动作**：60fps 内的缓动（`cubic-bezier(.2,.7,.3,1)`），三维聚焦用 ease-in-out 插值同时插值机位与视点，避免"跳变"。
- **尺度**：标题栏 46px、状态栏 26px、导航 rail 74px，主舞台永不压缩到 1060×660 以下。

3D 层坚持**全程序化**：星云、星点、节点光晕、突触脉冲全部由着色器与生成器产生，**没有一个外部贴图或字体文件**——这也是"离线优先"的一部分。

---

## 四、技术结构

```
桌面壳（CJS）                        引擎（ESM，同一份源码）
┌──────────────────────────┐        ┌────────────────────────┐
│ main.js  自定义协议 neokb:// │ 动态 import │ src/storage  sandbox·store │
│          窗口 / IPC / 生命周期 │ ────────► │ src/engine   edges·diffusion│
│ preload.js contextBridge  │        │ src/viz      graph-export      │
└──────────────────────────┘        │ src/mcp      tools(12)         │
           ▲                          │ src/consolidation 巩固        │
           │ ipcRenderer.invoke       └────────────────────────┘
渲染层（浏览器环境，纯 ESM）
└── ui/index.html + app.js + cosmos.js + views/{nebula,recall,compose,sleep,console}.js
```

关键约束与设计取舍：

1. **引擎只有一份**。桌面端用动态 `import()` 加载与 CLI / MCP Server **完全相同**的 `src/`；`src/viz/graph-export.js` 同时供 CLI、Web 原型与桌面端调用。任何布局/导出逻辑都不<｜hy_place▁holder▁no▁813｜>第二份。
2. **进程模型**：渲染进程 `nodeIntegration:false` + `contextIsolation:true` + 沙箱，唯一通道是 preload 的 `contextBridge`；主进程持有 store 单例并对每个写操作记 journal。
3. **资源协议**：UI 走自定义协议 `neokb://app/`，ES Module 与 importmap 才能正常加载；`resources/app` 之外一律拒绝。
4. **CSP**：收紧到 `default-src 'none'`，仅对内联 importmap 注入其精确 SHA-256（构建时计算），既不放宽策略也不怕映射改动。
5. **离线**：three.js 及其后处理链路全量本地化；`connect-src 'none'`，运行时不发起任何网络请求。

---

## 五、交付形态（Windows）

| 环节 | 工具 | 说明 |
|---|---|---|
| 品牌图标 | `tools/make-icon.mjs` | 自写 PNG 编码器（zlib + CRC32）与 ICO 容器，程序化绘制，7 个尺寸 |
| 资源编排 | `tools/stage-app.mjs` | 组装壳 / UI / 引擎 / 本地 three.js / 示例语料，并注入 CSP 哈希 |
| exe 品牌化 | `tools/rebrand-exe.mjs` | 用纯 JS 的 `resedit` 写 PE 资源：替换图标组 + 写版本信息，**无需 rcedit 二进制** |
| 安装包 | `tools/installer.nsi` | NSIS 3.10：开始菜单 + 桌面快捷方式 + 卸载项，默认安装到 `%LOCALAPPDATA%\Programs\NeoCosmos-Personal`（无需管理员） |
| 一键串联 | `tools/build-win.mjs` | 依次执行上面四个工具，产出 `build/dist/NeoCosmos-Personal-Setup.exe`（约 79 MB） |

卸载只删程序目录。**知识库默认在 `文档\NeoCosmos Vault`，卸载绝不动它。**

本机实现要点（踩过的坑，别重踩）：

- 本机 Electron 33 二进制不支持 ESM 主进程 → 主进程/预加载必须 CJS，引擎保持 ESM 由动态 `import()` 载入。
- `ELECTRON_RUN_AS_NODE=1` 会让 exe 退化为纯 Node 且不建窗口，调试时要 `env -u`。
- NSIS 脚本需 UTF-8 BOM，换行用 `$\r$\n`（`$CRLF` 非法）。
- `new URL(import.meta.url).pathname` 在中文路径下会被百分号编码，必须用 `fileURLToPath`。

---

## 六、验证

`NEOCOSMOS_SMOKE=1 env -u ELECTRON_RUN_AS_NODE NeoCosmosPersonal.exe` 会以无人工介入的方式启动真实 exe，并执行：

- 引擎 `init` → 自动创建/加载知识库
- `graph` 导出 → 节点/突触/类型数
- `search` → 扩散命中数
- 载入示例网络 → 重挂载星图 → WebGL canvas 是否建立
- 收集渲染进程 console 错误

验收标准：**`rendererErrors` 为空且 `canvas ≥ 1`**。当前实测全部通过（60 节点 / 82 突触 / 0 错误）。
