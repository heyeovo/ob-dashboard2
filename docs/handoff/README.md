# handoff 状态索引

> 2026-09-27 整理。这里的文件都是**历史档案**：记录当时的方案、验收和踩坑，默认不读，需要追溯时再定点查。
> 待办不在这里维护——想做的活看 OB Todo（`list_todos`），代码债务和技术卡看根目录 `TECH_DEBT.md`。
> 文件正文里的“尚未提交 / 待部署 / 下一步”是写作当时的状态，以本索引为准。
> 部署方式也以当前为准：Dashboard 与 Haven 现在都是 push `main` 后自动部署（见两边仓库的 `AGENTS.md`）；VPS 迁移 handoff 里“普通 push 不会自动更新”“手动 Redeploy”的描述已过时。

| 文件 | 状态 | 备注 |
|---|---|---|
| `HANDOFF-auto-tag-runtime.md` | 📦 已完成归档 | 已提交：Dashboard `8d29fdc`、Haven `4efd135` / `6cc656b` |
| `HANDOFF-cc-VPS迁移.md` | 📦 已完成归档 | 核心迁移、B2 每日备份已完成；§21 列的附加项（额外加密副本、备份失败通知等）未排期 |
| `HANDOFF-cc-agent-wake.md` | 📦 已完成归档 | 主动唤醒日常在用；唤醒时段、主动性等后续想法在 OB Todo |
| `HANDOFF-cc-chat-mode-tooling.md` | 📦 已完成归档 | 闲聊 / 工作模式工具边界 |
| `HANDOFF-cc-context-compaction.md` | 📦 已完成归档 | Context 展示与压缩 |
| `HANDOFF-cc-daily-rolling-context.md` | 📦 已完成归档 | 按天滚动在用；文内“低优先级后续”未排期 |
| `HANDOFF-chat-search.md` | 📦 已完成归档 | 排序优化在 OB Todo「search_chat 优化」 |
| `HANDOFF-daily-review-input-budget.md` | 📦 已完成归档 | |
| `HANDOFF-memory-continuity-fixes.md` | 📦 已完成归档 | |
| `HANDOFF-cc-auto-chat-slices.md` | ⏸ 暂停 | 阶段一、二代码已提交（Haven `c250299` / `ab43aa3`，Dashboard `96a2668`），9.13 与日回顾解耦后停下。重开时以本文件为事实源；OB Todo「自动化原文切片摘要」 |
| `HANDOFF-rolling-archive-slicing.md` | 🔎 待 CC 验收 | `feat/rolling-archive` 已实现 §五 1–6；CC 首轮 Linux 全量测试／build 和真实数据离线切片通过。10.01 补压缩产物切片排除、迁移来源只读两处，相关 64 测试通过，待 CC 复验。第 7 步主窗修复未做，不合并、不部署；OB Todo `0a39f9fba0434c3c` |
| `HANDOFF-ui-design-system.md` | 📦 已被取代 | 第一步清理硬编码已完成；其余草案以 `HANDOFF-ui-redesign.md` 为准 |
| `HANDOFF-ui-redesign.md` | 🔨 进行中 | 阶段 1/1.5、2a、3a/3b 待 iPhone 走查勾选；阶段 2 前置 / 2b / 4 前置 / 4a 已上线。阶段 4b 工作台与底栏改版已上线；4c-1 已在本地两功能分支实现，待提交与手机/正式环境验收，再按既定顺序继续 4c 子页面打磨（底栏高度备选在 `try/tabbar-74`）。Clawd 待摆上窗台。Codex 执行、CC 验收；OB Todo `ea074ff139f64c54` |
| `OB待处理大问题清单.md` | 📦 已完成归档 | P0 两项、journey、聊天原文库已完成；语录、moments、官端开窗已转入 OB Todo |
