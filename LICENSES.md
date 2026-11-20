# 许可与第三方声明（License & Notices）

> 版本 10.18.9 · 个人版开源仓库 · 最后更新 2026-11
>
> 本文件说明「本项目的代码用什么许可」与「随包第三方组件各用什么许可」。所有条目均可核对：许可证全文位于本仓库 `legal/` 与 `desktop/assets/fonts/`，组件版权头位于源码或二进制内嵌元数据。

## 一、本项目自身许可（多协议）

本项目按内容类型采用不同许可，均遵循 SPDX 标准标识：

| 内容范围 | 许可 | SPDX 标识 | 全文位置 |
| --- | --- | --- | --- |
| 自研源码：`src/`、`desktop/`、`tools/`、`test/` | GNU Affero General Public License v3.0 或更高版本 | `AGPL-3.0-or-later` | [`legal/AGPL-3.0.txt`](legal/AGPL-3.0.txt) |
| 项目文档：`docs/`、`*.md`（不含第三方许可证原文） | Creative Commons 署名-相同方式共享 4.0 国际 | `CC-BY-SA-4.0` | [`legal/CC-BY-SA-4.0.md`](legal/CC-BY-SA-4.0.md) |
| 单独商业授权 | 专有许可（双轨制） | `LicenseRef-Commercial` | [`legal/COMMERCIAL-LICENSE.md`](legal/COMMERCIAL-LICENSE.md) |

**双轨授权要点**：AGPL-3.0 允许任何用途（含商业）但要求履行 copyleft 义务——分发修改版须开源对应源码，作为网络服务提供须向用户开放源码（第 13 条）。若你的场景不愿/不能履行该义务（闭源集成、SaaS 不开放源码等），请取得商业许可。详见 [`legal/COMMERCIAL-LICENSE.md`](legal/COMMERCIAL-LICENSE.md)。

企业版为专有商用许可（`LicenseRef-Enterprise`），其专有构建产物不在本仓库分发；与本版共用的源码模块按 AGPL-3.0 一并开源。

## 二、运行时第三方组件（随安装包分发）

| 组件 | 版本 | 许可 | SPDX | 用途 | 许可证全文位置 |
| --- | --- | --- | --- | --- | --- |
| Electron | 33.x | MIT | `MIT` | 桌面应用外壳（Chromium + Node） | Electron 官方随附 `LICENSE` 与 `LICENSES.chromium.html`（含 Chromium/V8 等全部子依赖版权） |
| three.js | r160 | MIT | `MIT` | 3D 星图 / 智脑 WebGL 渲染（本地 vendored，离线） | `desktop/ui/vendor/three/LICENSE` |
| Noto Sans CJK SC（思源黑体，可变） | 2.004 | SIL Open Font License 1.1 | `OFL-1.1` | 正文中文字体 | `desktop/assets/fonts/OFL.txt`、`FONT-LICENSES.txt` |
| Noto Serif CJK SC（思源宋体，可变） | 2.002 | SIL Open Font License 1.1 | `OFL-1.1` | 标题中文字体 | 同上 |

字体逐款版权声明（含仅存于源码库、不随包分发的 6 款手写字体）见 `desktop/assets/fonts/FONT-LICENSES.txt`，OFL 1.1 全文见 `desktop/assets/fonts/OFL.txt`。

## 三、构建期依赖（仅开发/构建，不随安装包分发）

| 依赖 | 许可 | SPDX | 用途 |
| --- | --- | --- | --- |
| resedit | MIT（Copyright © 2018 jet） | `MIT` | 品牌化 exe 版本资源 |
| pe-library | MIT（Copyright © 2018 jet） | `MIT` | PE 解析（resedit 传递依赖） |
| pinyin-pro | MIT（Copyright © 2022-present zh-lx） | `MIT` | 离线拼音索引生成 |
| NSIS | 3.10 · zlib/libpng | `zlib` | 安装包编译工具 |

上述构建期依赖位于构建目录，不进入 Electron 运行时目录，不被 NSIS 打进安装包。

## 四、自研模块（零第三方运行时依赖）

| 模块 | 来源 | 许可 |
| --- | --- | --- |
| Markdown / frontmatter 解析器 | 自研（按 CommonMark 公开规范与社区 `[[wikilink]]` 通用约定实现） | AGPL-3.0-or-later |
| 激活扩散 / RRF 检索 | 自研（力导向布局、Reciprocal Rank Fusion、阻尼随机游走） | AGPL-3.0-or-later |
| 突触可塑性（LTP/LTD 权重动力学） | 自研规格，见 `docs/spec/02-mechanisms.md` | AGPL-3.0-or-later |
| 索引存储（JSON + JSONL journal） | 自研，零依赖，可删可重建 | AGPL-3.0-or-later |
| MCP(stdio) 协议帧 | 自研最小实现（Node 内置 `stdio` + JSON，不依赖 `@modelcontextprotocol/sdk`） | AGPL-3.0-or-later |
| QS-Shield 完整性防护层 | 自研，零第三方依赖 | AGPL-3.0-or-later |
| NeoLM / RAM 关联模型 / 语义回流层 | 自研训练与算法，权重为本项目训练产物 | AGPL-3.0-or-later |

## 五、个人信息与商标合规

- 界面「关于」与 `legal/COMMERCIAL-LICENSE.md` 明确给出商用授权联系开发者（宋锦涛 · 13869162267）；个人/学习/研究/内网免费，闭源商用或 SaaS 须取得授权。
- 本项目不含任何真实律所名称、客户名称或第三方机构背书声明；品牌标记、图标、环境贴图均为数学程序原创生成（生成脚本见 `tools/`）。
- 设计上仅参考公开产品的**通用交互原则**（本地优先、双链、图谱），提炼理念，不复刻任何界面、图标、文案或代码。
- `NeoCosmos`、`NeoLink`、`NeoLM` 及品牌标识为开发者所有，开源许可不授予商标使用权，见 [`NOTICE`](NOTICE)。

## 六、许可证兼容性与 copyleft 说明

本项目坚持零第三方**运行时**依赖；随包第三方组件均为 MIT / OFL / zlib 等宽松许可，不存在 GPL/AGPL 污染自研代码的风险。个人版整体以 AGPL-3.0 授权属**主动选择**，与第三方组件的宽松许可并存不冲突——AGPL 的 copyleft 作用于本项目整体，第三方组件仍按其原始许可分发。项目文档的 CC-BY-SA-4.0 仅适用于 `docs/` 与 Markdown 文档，不影响源码许可。

如需核对，可运行仓库内真实性/门禁脚本。

资产边界（如实说明）：
- **签名私钥 / 测试证书**：仅存在于私有构建脚本目录（`tools/signing/`），随源码仓库分发但不进入对外开源目录；对外发布包使用开发者持有的代码签名证书。
- **NeoLM 训练语料快照**（`neolm.corpus.raw.txt` / `neolm.corpus.md.txt`）：作为模型真实性的可复现证据，随**源码仓库**提供，但由开源编排脚本硬排除、**不进入对外开源目录**；其中可能含开发过程中的路径与笔记，不代表产品内置知识。
- **内置知识库**：客户端零内置、零预置、零示例语料；知识库即用户本机上的普通 `.md` 文件夹。
- 词表文件 `neolm.vocab.json` 是从上述语料统计出的真实 n-gram，可能含开发期字符串片段；它是模型权重的组成部分，不含可执行代码，也不对应任何当前有效的凭据。
