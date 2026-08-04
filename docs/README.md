# KeyVault 文档目录

术语与产品定位（Vault / 记录 / 厂商预设 / 接口规范 / 迁移）见仓库根的 **`CONTEXT.md`**；关键决策记录在 **`docs/adr/`**（ADR-0001 技术栈、ADR-0002 明文化无密码）。

接手优化/修复请按此顺序读:

1. **[HANDOFF.md](HANDOFF.md)** — 先读这份。当前状态、构建环境、明文化重构（v0.3.0）要点、v0.2.0 功能（厂商预设/接口规范/表单重设计）、待优化项。
2. **[DESIGN.md](DESIGN.md)** — 设计文档。问题陈述、威胁模型、架构决策、三栏 UI 线框、表单、故障模式表、NOT-in-scope。
3. **[TEST-PLAN.md](TEST-PLAN.md)** — QA 测试计划:要测哪些页面、交互、边界、关键路径，以及发布前的人工端到端走查清单。
4. **tasks-eng-review.jsonl / tasks-design-review.jsonl** — 历史实现任务清单(JSONL,带优先级/工作量/来源)。

构建步骤见仓库根的 `README.md`,待办见根的 `TODOS.md`,版本更新记录见 `CHANGELOG.md`。
