# HANDOFF｜日回顾输入预算优化

## 当前状态

- 2026-08-22 已完成日回顾输入预算优化与定向测试。
- 当前窗口已完成 OB2 内置 Polaris 前端剥离；该改动与本任务无关，下一窗口不得扩散或返工 Polaris。
- 日回顾的事实源是 Haven `conversation_turns` 中的 `user_text` 与 `assistant_text`。CC 的 Bash、Read、Grep 等工具返回和 thinking 不进入日回顾材料；助手可见正文中已经表达的工具结论会进入。

## 当前实现

- Haven `daily_review_engine.py` 按窗口分组当天轮次。
- 先组装当天所有闲聊和工作窗口的全部可见正文；总材料不超过 `max_input_chars`（默认 240000 字符）时不做预摘要，只调用一次最终日回顾模型。
- 只有总材料超预算时才压缩工作窗口的较早轮次。每个工作窗口先保留 `work_tail_turns`（默认 10）轮最近原文，再轮流补回各窗口较近的完整轮次，剩余较早部分各自摘要。
- 最终材料不再整体取尾部，因此不会因窗口拼接顺序静默丢失前面的整个工作窗口。
- 这不是 Claude Code 的内部 context compaction。压缩由 `DailyReviewEngine` 发起，经 `AutomationModelRouter` 使用日回顾当前选择的 API 或 Claude Pro 执行线路。
- 超预算时，较早正文仍由摘要调用读取一次，最终调用再读摘要；预算内不会产生这次额外调用。

## 已确认产品决定

- 安全预算继续按字符判断，复用现有 `max_input_chars`。
- 多个工作窗口各自保留最近原文，并轮流分配可补回额度，不按全局拼接顺序截断。
- `work_tail_turns=10` 保留为超预算模式下每个工作窗口的最低原文尾部，不再作为日常固定压缩触发器。
- 极端情况下若闲聊全文与各工作窗口最低原文尾部本身已超过安全阈值，不静默截断这些受保护正文；`max_input_chars` 是压缩触发与正常可压缩材料的安全预算。

## 下一窗口范围

- 本任务代码已完成，无后续实现项。若以后要修“本窗口设置”的字数统计口径，应另开窗口处理 Dashboard；它与本任务无关。

## 不得扩散的边界

- 不修改日回顾产品 Prompt、输出格式、定时排程、API/Pro 路由选择或日回顾保存结构。
- 不把 Bash/Read/Grep/MCP 工具正文加入日回顾。
- 不修改 weekly journey、记忆提取或 CC 实时上下文管理。
- 不删除 Polaris 历史导入兼容。

## 验收方法

- `python -m unittest tests.test_daily_review_engine`：10 项通过。
- 已覆盖预算内超过 10 轮只调用一次最终模型、超预算才摘要并保留最近原文、多个工作窗口均保留且分别摘要三类场景。
- Dashboard 没有代码改动，不要求 Dashboard build。
