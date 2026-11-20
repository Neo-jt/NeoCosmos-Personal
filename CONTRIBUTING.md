# 参与贡献 · Contributing

感谢你考虑为 NeoCosmos 做贡献。本项目以 AGPL-3.0 开源，欢迎 bug 报告、文档改进与代码 PR。

## 贡献方式

- **报告问题**：用 GitHub Issues，说明复现步骤、期望与实际行为、环境与版本（10.18.7）。
- **安全漏洞**：**不要**开公开 issue，按 [SECURITY.md](SECURITY.md) 私下报告。
- **文档改进**：文档采用 CC-BY-SA-4.0，欢迎修正与补充。
- **代码贡献**：见下方流程。

## 开发环境

```bash
Node.js >= 18        # 引擎与测试
npm test             # 引擎测试（test/run-all.js）
# 桌面客户端需 Node >= 20 与 Electron 环境
```

提交前请确认：

- `npm test` 全绿；相关契约测试（如有）通过。
- 不引入第三方**运行时**依赖——这是本项目的红线（零运行时依赖）。
- 不新增虚构能力、示例数据或占位实现；所有读数来自真实计算。
- 若改动 UI/CSS，跑 `tools/check-ui.mjs` 与 `tools/check-layout-633.mjs` 等门禁。

## Pull Request 流程

1. Fork 仓库，从最新版本建分支（如 `fix/xyz`、`docs/abc`）。
2. 小步提交，写清改动动机。
3. 确认所有测试与门禁通过，再开 PR。
4. PR 描述说明：改了什么、为什么、如何验证。

## 贡献许可与知识产权

- 你提交的任何贡献，默认按本项目的 **AGPL-3.0-or-later** 许可开源；文档贡献按 **CC-BY-SA-4.0** 开源。
- 提交 PR 即表示你**有权**提交这些内容，并同意其按上述许可分发；若你的贡献使用了第三方素材，须在 PR 中声明来源与许可。
- 请勿提交受保密义务约束的内容、他人专有代码，或无法证明来源的代码。
- 版权与商标归各自权利人；本项目不因接受贡献而转让商标权。见 [NOTICE](NOTICE)。

## 行为准则

参与即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 鼓励贡献

如果本项目对你有帮助，欢迎自愿支持开发者（微信支付收款码）：

<img src="https://raw.githubusercontent.com/Neo-jt/NeoCosmos-Personal/main/desktop/assets/donate-qr.png" width="220" alt="鼓励开发者贡献 · 微信支付收款码" />

> 捐赠完全自愿，不构成商业授权，也不改变任何许可条款。商用授权请联系开发者（宋锦涛 · 13869162267），见 [商业许可说明](legal/COMMERCIAL-LICENSE.md)。
