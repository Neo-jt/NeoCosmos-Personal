# 合规审查报告 · Compliance Review

> NeoCosmos 个人版 · v10.18.9 · 审查日期 2026-11-19
>
> 本报告为面向开源发布的**合规自查记录**，不构成法律意见。重大商业决策请咨询执业律师。

## 一、开源范围（只开源个人版）

| 项目 | 处置 | 依据 |
| --- | --- | --- |
| 产品形态 | 源码版本锁 `EDITION_LOCK='personal'`、进程身份 `EDITION='personal'` | 本仓库仅面向个人版；企业形态不可达 |
| 企业版页面实现（企业管理 / 企业控制台） | **不随仓库分发**，以无实现 stub 保持模块引用自洽 | 企业版专有知识产权 |
| 企业版许可协议（ENTERPRISE-EULA） | **不随仓库分发** | 企业版专有 |
| 双版构建脚本 / 企业构建入口 | **不随仓库分发** | 企业版构建专有 |
| 企业版安装包 / 构建中间产物 / userData 探针 | **不随仓库分发** | 专有产物 |

结论：公开仓库中不含任何企业版专有实现、许可或构建产物。

## 二、许可证合规（强传染性 + 商用授权双轨）

| 内容 | 许可 | SPDX | 全文 |
| --- | --- | --- | --- |
| 自研源码（引擎 / 桌面 / 工具 / 测试） | GNU Affero General Public License v3.0 或更高 | `AGPL-3.0-or-later` | `legal/AGPL-3.0.txt` |
| 项目文档 | CC 署名-相同方式共享 4.0 国际 | `CC-BY-SA-4.0` | `legal/CC-BY-SA-4.0.md` |
| 闭源商用 / 不开源场景 | 专有商业许可 | `LicenseRef-Commercial` | `legal/COMMERCIAL-LICENSE.md` |

- **强传染性**：AGPL-3.0 第 13 条要求「修改后作为网络服务提供须向用户开放源码」，已由 `legal/AGPL-3.0.txt` 全文与 README「授权与许可」章节明示。
- **商用授权**：README、NOTICE、LICENSES.md、商业许可文件四处一致给出开发者联系方式，明确「个人/学习/研究/内网免费；闭源商用须取得授权」。
- **AGPL 允许商业使用**：已按 FSF/开源定义如实说明——开源轨道不歧视使用领域，收费针对「不开源」，避免误导用户或过度承诺。

## 三、第三方资产归因（不侵权核查）

| 组件 | 版本 | 许可 | 归因位置 |
| --- | --- | --- | --- |
| Electron | 33.x | MIT | `LICENSES.md` / `NOTICE` |
| three.js | r160 | MIT | `desktop/ui/vendor/three/LICENSE` |
| Noto Sans / Serif CJK SC | 可变字重 | SIL OFL 1.1 | `desktop/assets/fonts/FONT-LICENSES.txt`、`OFL.txt` |
| 6 款中文手写字体 | — | SIL OFL 1.1 | 同上（仅源码库保留，逐款版权声明已登记） |
| NSIS | 3.10 | zlib/libpng | `LICENSES.md`（仅构建期） |
| resedit / pe-library / pinyin-pro | — | MIT | `LICENSES.md`（仅构建期） |

- 逐款字体版权声明按 OFL 条件条款 2 随许可全文附上；保留字体名 "Source" 未 modification，不触发 RFN 限制。
- 全部第三方组件为 MIT / OFL / zlib 宽松许可，与本项目整体 AGPL 并存不冲突，不存在 GPL 污染。
- **运行时零第三方依赖**（`package.json` dependencies 为空），避免传染性许可意外引入。

## 四、知识产权保护（开发者治理投入）

- **版权 / 署名权**：© 2026 宋锦涛；源码开放但版权与署名权保留（`LICENSE` 头部 / `NOTICE`）。
- **商标**：`NeoCosmos` / `NeoLink` / `NeoLM` 及品牌标记为开发者所有，开源许可**不授予**商标与背书使用权（`NOTICE`）。
- **原创性**：图标、Logo、环境贴图由 `tools/make-icon.mjs` / `tools/gen-*-assets.mjs` 数学程序原创生成；净室开发，不复刻第三方代码 / 界面 / 文案（`docs/ORIGINALITY.md`）。
- **贡献协议**：PR 即表示贡献者有权贡献并同意按 AGPL-3.0 开源（`CONTRIBUTING.md`）。
- **贡献鼓励二维码**：`desktop/assets/donate-qr.png` 保留于 README 与 CONTRIBUTING，明示「自愿、不构成授权」。

## 五、敏感信息与残留清洗

| 检查项 | 处置 |
| --- | --- |
| 签名私钥 / 测试证书 / 证书生成脚本 | 全部排除（签名目录、.pfx/.cer/.key、make-test-cert.ps1、sign.ps1） |
| 明文测试口令 | 文本中出现的测试证书名片段已清洗为 `REDACTED-TEST-STRING` |
| 训练语料 / 词表 / 模型权重 | 不随仓库分发（属可复现资产，非源码；README 已说明） |
| 内置知识库 | 客户端零内置；无用户数据 / 真实机构 / 客户名称随包 |
| 内部交付 QA / 交付记录 / 开发机探针截图 | 全部排除（DELIVERY-* / probe-* / shoot-* / e2e-* 等） |
| 安装包 / 构建目录 / 企业 userData | 全部排除 |

## 六、可直接上传 GitHub 确认

- 根目录含 `README.md`、`LICENSE`、`NOTICE`、`LICENSES.md`、`.gitignore`、`COMPLIANCE-REVIEW.md`。
- 版本标识统一为 v10.18.9；无历史版本残留文案。
- 未含 `.git` 目录，可在该目录直接 `git init && git add . && git commit` 后 push。
- 所有正文口令残留已清洗；无私钥、无明文口令、无企业版资产。

> 免责声明：本报告为合规自查，不构成法律意见。若涉及跨境分发、商标使用、商业授权谈判等重大事项，请咨询执业律师。
