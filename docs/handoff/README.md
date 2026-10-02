# handoff 状态索引

> 2026-09-27 整理。这里的文件都是**历史档案**：记录当时的方案、验收和踩坑，默认不读，需要追溯时再定点查。
> 待办不在这里维护——想做的活看 OB Todo（`list_todos`），代码债务和技术卡看根目录 `TECH_DEBT.md`。
> 文件正文里的“尚未提交 / 待部署 / 下一步”是写作当时的状态，以本索引为准。
> 部署方式也以当前为准：Dashboard 与 Haven 现在都是 push `main` 后自动部署（见两边仓库的 `AGENTS.md`）；VPS 迁移 handoff 里“普通 push 不会自动更新”“手动 Redeploy”的描述已过时。

| 文件 | 状态 | 备注 |
|---|---|---|
| `HANDOFF-4c-1-polish.md` | 🔎 待 iPhone 走查 | 两轮均由 CC 验收（Linux 全量测试含符号链接用例、build）并于 2026-10-01 合并 main（`f0cc3bd`、`6b262c6`）：提示词页、全高加载态、日记日期与缓存、日回顾共享周条与补写入口、待办手机全屏编辑 |
| `HANDOFF-auto-tag-runtime.md` | 📦 已完成归档 | 已提交：Dashboard `8d29fdc`、Haven `4efd135` / `6cc656b` |
| `HANDOFF-cc-VPS迁移.md` | 📦 已完成归档 | 核心迁移、B2 每日备份已完成；§21 列的附加项（额外加密副本、备份失败通知等）未排期 |
| `HANDOFF-cc-agent-wake.md` | 📦 已完成归档 | 主动唤醒日常在用；唤醒时段、主动性等后续想法在 OB Todo |
| `HANDOFF-cc-chat-mode-tooling.md` | 📦 已完成归档 | 闲聊 / 工作模式工具边界 |
| `HANDOFF-cc-context-compaction.md` | 📦 已完成归档 | Context 展示与压缩 |
| `HANDOFF-bucket-drawer-redesign.md` | 📦 已完成归档 | 2026-10-02 iPhone 走查通过。2026-10-02 CC 写规格，Codex 实现（`2b372ee`），CC 验收：Linux build + 全量 408 测试通过，逐行对过旧版行为（事件时间、噪声、权重来源一致；相似记忆可点开跳记忆库）。视觉事实源 `assets/bucket-drawer-v2.html`。`/api/moments`、merge-*、`/api/to-journal` 已无抽屉调用方，route 暂留 |
| `HANDOFF-deploy-drain.md` | 🔎 待线上实测 | 2026-10-02 Codex 实现，CC 验收（Linux 全量 445 + build、代码逐段对规格）后合并 main（`3b2db49`）。这次部署旧容器尚无排空，从下一次 push 起生效，届时按 §六 线上 4 项实测；验证结果及下一步见正文 §八。只动 dashboard；Pro 自动化同次重试限制见 CC-09 |
| `HANDOFF-room.md` | 🔨 进行中 | A 已上线并实测（③④⑥⑧ 通过、⑦ 以单测为准、门牌锁时间修复 `a7e9ca2`），①②⑤ 待主窗与唤醒实测。**B 规格 2026-10-02 定稿（第五节）**，视觉稿 `assets/room-b-preview.html`，B 已在两边 feat/room-b 实现，待 CC 按第五节 7 验收后合并；不直接上线。OB Todo `797b44d13354469e` |
| `HANDOFF-cc-turn-survives-disconnect.md` | 📦 已完成归档 | 2026-10-02 iPhone 实测 ①–⑤ 通过（`e2d3605`、`fea2030`）；⑥待批准卡片未遇到，下次顺带确认 |
| `HANDOFF-cc-daily-rolling-context.md` | 📦 已完成归档 | 按天滚动在用；文内“低优先级后续”未排期 |
| `HANDOFF-chat-search.md` | 📦 已完成归档 | 排序优化在 OB Todo「search_chat 优化」 |
| `HANDOFF-daily-review-input-budget.md` | 📦 已完成归档 | |
| `HANDOFF-memory-continuity-fixes.md` | 📦 已完成归档 | |
| `HANDOFF-cc-auto-chat-slices.md` | ⏸ 暂停 | 阶段一、二代码已提交（Haven `c250299` / `ab43aa3`，Dashboard `96a2668`），9.13 与日回顾解耦后停下。重开时以本文件为事实源；OB Todo「自动化原文切片摘要」 |
| `HANDOFF-rolling-archive-slicing.md` | 🔎 观察中 | 2026-10-01 上线（`691a86f` + 断链修复 `92cc2f5`），主窗「窗口3」已从存档修复。剩 §六 测试窗口全流程未专门跑，先观察主窗日常跨日重建；Haven 旧字段 `allow_fixed_body_restore` / `previous_day_modes` 待清理。OB Todo `0a39f9fba0434c3c` |
| `HANDOFF-ui-design-system.md` | 📦 已被取代 | 第一步清理硬编码已完成；其余草案以 `HANDOFF-ui-redesign.md` 为准 |
| `HANDOFF-ui-redesign.md` | 🔨 进行中 | 阶段 1/1.5、2a、3a/3b 待 iPhone 走查勾选；阶段 2 前置 / 2b / 4 前置 / 4a / 4b 已上线。4c-1 日记本／日回顾／待办由 CC 验收，2026-10-01 与 Haven `feat/todo-delete` 一起合并 main，待 iPhone 走查；下一步 4c-② 模型与中转站（底栏高度备选在 `try/tabbar-74`）。Clawd 已随房间 B 摆上窗台，待 CC 验收。Codex 执行、CC 验收；OB Todo `ea074ff139f64c54` |
| `OB待处理大问题清单.md` | 📦 已完成归档 | P0 两项、journey、聊天原文库已完成；语录、moments、官端开窗已转入 OB Todo |
