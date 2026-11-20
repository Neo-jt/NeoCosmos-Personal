# NeoCosmos 架构（自研五层）

```
L5 客户端/宿主  桌面壳（未来）· 外部 Agent（WorkBuddy / AutoClaw 经 MCP）
        │
L4 接入层       MCP Server(stdio + 可选 127.0.0.1 HTTP) · Agent Skill · CLI
        │
L3 类脑引擎     ActivationEngine(扩散+RRF) · Plasticity(权重动力学) · ConsolidationScheduler
        │
L2 索引层       零依赖索引：node/edge/hit_log/qa_pair/journal/concept/review_item（JSON + JSONL）
        │
L1 存储层       用户磁盘真实文件夹：Markdown + 附件 + 旁路覆盖层 .neokb/overlay/
        └────── 真相源只有 L1。L2 全可从 L1 重建（可删可重建）。
```

## 铁律（对应需求 R1~R7）

- **R1 文件是唯一真相源**：正文 = 磁盘 `.md`；索引只是索引，删索引不丢内容。
- **R2 绝不破坏原文**：机器元数据进旁路覆盖层 `.neokb/overlay/`；仅 `neokb_id` 进 frontmatter，且首次弹窗同意。
- **R3 回写只追加重写**：追加到 `<!-- neokb:沉淀区 begin/end -->` 受保护区，或新建独立卡片；永不覆盖人写段落。
- **R4 全量写审计**：`.neokb/journal/` 记 before 哈希 + diff + 操作者 + 时间，可一键回滚。
- **R5 严格目录沙箱**：只读写授权根目录，拦截 `..` / 绝对路径 / symlink·junction 逃逸，统一 `SafeResolver`。
- **R6 断网无 Key 也能用**：全文检索 / 图谱 / 双链 / 沉淀回写全可用；语义降级 BM25。
- **R7 外部 Agent 默认无写正文权**：新宿主只读 + 弹窗确认；已授权仅可写 `_memory/` 沉淀区与建边。

## 目录约定（根目录下）

```
.neokb/{index/, overlay/, journal/, report/}
_inbox/           工作记忆
_memory/episodic/ 情景记忆（带时间戳）
_memory/semantic/ 语义记忆（抽象概念卡）
_graveyard/       软删归档
```

首次接管已有目录：**不得修改任何已有文件**，只新增 `.neokb/` 与按需 `_memory/`。
