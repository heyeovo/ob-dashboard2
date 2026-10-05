# handoff 状态索引

> 2026-09-27 整理。这里的文件都是**历史档案**：记录当时的方案、验收和踩坑，默认不读，需要追溯时再定点查。
> 待办不在这里维护——想做的活看 OB Todo（`list_todos`），代码债务和技术卡看根目录 `TECH_DEBT.md`。
> 文件正文里的“尚未提交 / 待部署 / 下一步”是写作当时的状态，以本索引为准。
> 部署方式也以当前为准：Dashboard 与 Haven 现在都是 push `main` 后自动部署（见两边仓库的 `AGENTS.md`）；VPS 迁移 handoff 里“普通 push 不会自动更新”“手动 Redeploy”的描述已过时。

| 文件 | 状态 | 备注 |
|---|---|---|
| `HANDOFF-trpg.md` | 🔨 进行中 | 2026-10-05 CC 起草：CoC 7 速成规则 +《闹鬼》，小羊 + 言之当玩家，GPT（Codex 走 Plus）当守秘人，先不接 Foundry。P0 通过；P1（Haven）2026-10-05 上线（`c956926`）；P2a 页面、P2b 调度器与言之会话均已验收合并（2026-10-05）；下一步：dashboard 加 `TRPG_PLAYER_MCP_TOKEN`、补删局 / 删模组（`dbed839c`），再 iPhone 实测，见文内 §1 |
| `HANDOFF-batch-1002.md` | 🔎 待 iPhone 走查 | Codex 实现，CC 验收：Linux 全量 Vitest 491 + build 通过，逐段核对后 2026-10-04 合并 main（`6ecd377`）。含 noop 过程文字、待办排序 / 居中 / 短 ID、日历跳转、时间线状态小框、房间列表间距、桶正文编辑与键盘适配、召回入口挪到 token 旁（`e72b4b4`）、搜索框玻璃底（`0aafb1d`）。`dashboard-auth` 篡改用例偶发失败为既有问题，待下一批修 |
| `HANDOFF-4c-1-polish.md` | 🔎 待 iPhone 走查 | 两轮均由 CC 验收（Linux 全量测试含符号链接用例、build）并于 2026-10-01 合并 main（`f0cc3bd`、`6b262c6`）：提示词页、全高加载态、日记日期与缓存、日回顾共享周条与补写入口、待办手机全屏编辑 |
| `HANDOFF-auto-tag-runtime.md` | 📦 已完成归档 | 已提交：Dashboard `8d29fdc`、Haven `4efd135` / `6cc656b` |
| `HANDOFF-cc-VPS迁移.md` | 📦 已完成归档 | 核心迁移、B2 每日备份已完成；§21 列的附加项（额外加密副本、备份失败通知等）未排期 |
| `HANDOFF-cc-agent-wake.md` | 📦 已完成归档 | 主动唤醒日常在用；唤醒时段、主动性等后续想法在 OB Todo |
| `HANDOFF-agent-wake-multi.md` | 📦 已完成归档 | 2026-10-02 Codex 实现，CC 验收合并 main。线上多闹钟日常使用正常，2026-10-04 归档；OB Todo `362f0f17` 已勾 |
| `HANDOFF-wake-quiet.md` | 📦 已完成归档 | 2026-10-04 Codex 实现，CC 验收：Linux 全量 Vitest 503 + build、Haven pytest 277 通过后合并上线（Dashboard `558a38f`、Haven `0e10466`）。同日线上第九节实测：quiet 不亮屏不响、进通知中心 ✅，普通推送照常响 ✅，noop 只留分隔线 ✅；quiet 后回复的保活 / followup 随日常使用观察。OB Todo `ec32abef` 已勾 |
| `HANDOFF-cc-chat-mode-tooling.md` | 📦 已完成归档 | 闲聊 / 工作模式工具边界 |
| `HANDOFF-cc-context-compaction.md` | 📦 已完成归档 | Context 展示与压缩 |
| `HANDOFF-bucket-drawer-redesign.md` | 📦 已完成归档 | 2026-10-02 iPhone 走查通过。2026-10-02 CC 写规格，Codex 实现（`2b372ee`），CC 验收：Linux build + 全量 408 测试通过，逐行对过旧版行为（事件时间、噪声、权重来源一致；相似记忆可点开跳记忆库）。视觉事实源 `assets/bucket-drawer-v2.html`。`/api/moments`、merge-*、`/api/to-journal` 已无抽屉调用方，route 暂留 |
| `HANDOFF-deploy-drain.md` | 📦 已完成归档 | 2026-10-02 Codex 实现，CC 验收合并 main（`3b2db49`）。线上实测（push `55cb177`）：①同轮 push 后继续工作直到收尾 ✅（18:29:42 开始排空，轮次存完后旧容器退出、标记清空）；②构建期间另一窗口发消息 ✅（因 Pro 订阅全局锁排在 CC 轮次后，最终由旧容器回复）；④锁屏后接上 ✅。③切换期间自动重发线上难以撞上（旧容器空闲 2 秒即退出），用户同意按单测通过归档。观感问题记 CC-10 |
| `HANDOFF-room.md` | 📦 已完成归档 | A、B 均已上线。2026-10-02 唤醒中进房锁门、10-03 零点主窗开门显影均正常，其余实测项以日常使用为准，2026-10-04 归档；OB Todo `797b44d1` 已勾 |
| `HANDOFF-cc-turn-survives-disconnect.md` | 📦 已完成归档 | 2026-10-02 iPhone 实测 ①–⑤ 通过（`e2d3605`、`fea2030`）；⑥待批准卡片未遇到，下次顺带确认 |
| `HANDOFF-cc-daily-rolling-context.md` | 📦 已完成归档 | 按天滚动在用；文内“低优先级后续”未排期 |
| `HANDOFF-chat-search.md` | 📦 已完成归档 | 排序优化在 OB Todo「search_chat 优化」 |
| `HANDOFF-daily-review-input-budget.md` | 📦 已完成归档 | |
| `HANDOFF-memory-continuity-fixes.md` | 📦 已完成归档 | |
| `HANDOFF-cc-auto-chat-slices.md` | ⏸ 暂停 | 阶段一、二代码已提交（Haven `c250299` / `ab43aa3`，Dashboard `96a2668`），9.13 与日回顾解耦后停下。重开时以本文件为事实源；OB Todo「自动化原文切片摘要」 |
| `HANDOFF-rolling-archive-slicing.md` | 📦 已完成归档 | 2026-10-01 上线（`691a86f` + 断链修复 `92cc2f5`），主窗跨日重建观察三天无问题，2026-10-04 归档；OB Todo `0a39f9fb` 已勾。Haven 旧字段 `allow_fixed_body_restore` / `previous_day_modes` 待清理（未排期） |
| `HANDOFF-ui-design-system.md` | 📦 已被取代 | 第一步清理硬编码已完成；其余草案以 `HANDOFF-ui-redesign.md` 为准 |
| `HANDOFF-ui-redesign.md` | 🔨 进行中 | 阶段 1/1.5、2a、3a/3b 待 iPhone 走查勾选；阶段 2 前置 / 2b / 4 前置 / 4a / 4b 已上线。4c-1 日记本／日回顾／待办由 CC 验收，2026-10-01 与 Haven `feat/todo-delete` 一起合并 main，待 iPhone 走查；下一步 4c-② 模型与中转站（底栏高度备选在 `try/tabbar-74`）。Clawd 已随房间 B 摆上窗台，待 CC 验收。Codex 执行、CC 验收；OB Todo `ea074ff139f64c54` |
| `OB待处理大问题清单.md` | 📦 已完成归档 | P0 两项、journey、聊天原文库已完成；语录、moments、官端开窗已转入 OB Todo |
