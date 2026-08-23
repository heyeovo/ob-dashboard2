# HANDOFF — CC 当前 Context 与自动压缩状态展示

> 建立时间：2026-08-23  
> 完成时间：2026-08-23  
> 仓库：`ob-dashboard2`  
> 状态：代码完成，目标测试、ESLint、production build 均通过；等待用户本机实际 CC 会话验收

## 1. 已实现

- `result.usage` 只作为“本轮累计消耗”；不再拿整轮累计 cache read 冒充当前窗口 Context。
- `runTurn.ts` 被动读取每次 `message_start.message.usage` 与 `message_delta.usage`；若 `iterations` 存在，只取最后一次 iteration。工具循环触发下一次模型请求时会替换快照，不跨请求累加。
- 当前 Context = 最后一次模型请求的 input + cache read + cache creation + output。没有恢复 `getContextUsage()`，正常每轮不增加额外模型请求。
- 接入 `system/compact_boundary`，记录 `manual|auto`、`pre_tokens`、`post_tokens`、耗时和时间；自动压缩在当轮过程的真实位置显示：`自动压缩已完成 · 186k → 42k`。
- 接入 `system/status: compacting`，自动压缩进行中时桌面运行信息行显示“Context 压缩中”，结束状态不额外请求模型。
- 桌面端沿用原有标题下运行信息行显示 Context 与缓存；未新增入口按钮，“本窗”按钮保持原位。手机顶栏不加状态行，只在“本窗”弹窗查看。
- “本窗口设置”始终显示当前/上次模型调用 Context、百分比、约剩 token、模型切换待确认、最近压缩及次数。Prompt cache 继续使用原有两档 TTL，字段与展示均独立。
- 每轮把最后真实模型调用时间写入 `cache_snapshot`；live query 闲置回收、页面刷新或服务重启后，前端仍按该时间计算 1h 系统缓存和 5m 会话缓存。到期显示“已过期”，无记录显示“待确认”，不再整项消失。
- 新字段上线前的旧 CC 轮次以 Haven `created_at` 作为兼容缓存基线；它只比模型 result 晚数秒，旧缓存到期后会稳定显示“已过期”。
- 手动压缩按钮只出现在 CC 工作模式，只允许当前在线、空闲会话。按钮发送 Claude Code 原生 `/compact`，先确认并明确提示会消耗一次摘要模型调用；不会唤醒已回收 query。
- Pro 与 API 使用 `subscription` / `api:<provider>` lane 隔离 Context 与压缩记录；切线路不显示另一条线路的旧数字。
- 每轮成功写 Haven 时把 `context_snapshot`、`last_compaction`、`compaction_count` 和过程内压缩事件写入该轮 `raw_json`，刷新后可恢复。

## 2. SDK 真实字段结论

当前固定依赖：`@anthropic-ai/claude-agent-sdk 0.3.220`。

- `message_start`：`event.message.usage`。
- `message_delta`：`event.usage`，含可能为 nullable 的输入/cache 字段、最终 output，以及 `iterations`。
- `compact_boundary`：`type=system`、`subtype=compact_boundary`；`compact_metadata.trigger/pre_tokens/post_tokens/duration_ms`。
- 当前 SDK 的 `Query` 没有 `compact()`；官方手动压缩入口是 streaming input 中发送 `/compact`，只有实际压缩时才出现 `compact_boundary`。
- `/compact` 是模型摘要调用，会产生 usage；本实现只在用户点击时调用，不是每轮自动请求。

## 3. 模型上限

- Pro/subscription 的原生 Opus 4.6 按 200k 展示。
- Dashboard 现有 API provider 映射会把 Opus 4.6 送成 `opus[1m]`，该 lane 按 1M 展示。
- 未识别模型上限时不编造分母或百分比。

## 4. 持久化边界

- 自动压缩发生在正常轮次内部，随该轮立刻持久化。
- 手动压缩发生在两轮之间：浏览器立即插入独立系统分隔线；服务端把事件暂存在当前 live session，并在下一次成功正常轮次的 `pre_compactions` 中落库，从而恢复到该用户消息之前。
- 如果手动压缩后、下一轮成功保存前同时刷新页面且服务端 query 随后重启/回收，尚未落库的独立分隔线可能丢失；压缩后的 Claude 原生上下文本身不受此 UI 记录影响。当前没有为一条 UI 事件新增 Haven 表或伪造空对话轮次。

## 5. 明确未改

- 未修改 Haven 仓库或表结构。
- 未接 Agent/subagent。
- 未扩散到召回、Persona、自动化、provider 设置或其他页面。
- 未保存或展示压缩摘要正文。
- 未改 Pro 额度实验接口的持久化策略。
- 用户原有未跟踪 `.claude/` 未修改、删除或加入提交。

## 6. 验证

- `npx vitest run tests/cc-sse-consumer.test.ts tests/cc-history.test.ts tests/cc-runTurn.test.ts`：35/35 通过。
- 定向 ESLint：通过。
- `npm run build`：通过，`/api/cc-compact` 已进入 route 清单。
- `git diff --check`：通过。
- 完整 `npm test` 为 181 通过、1 跳过、1 个既有 selfhost 断言失败；失败项仍期待隐藏运行时信息不含 `session_id`，与本次 CC 改动无关，按范围未修改 selfhost。

新增测试覆盖：多次模型请求只保留最后一次 Context、`iterations` 最后一项、累计 usage 不覆盖 Context、自动压缩事件顺序与 raw 持久化、缓存时间戳新旧历史恢复、手动分隔线历史位置、SSE 新事件分发、Pro/API 原生 session 隔离。

## 7. 用户验收步骤

1. 桌面端确认 Context 与缓存出现在标题下方原运行信息行；右侧只有原来的“本窗”，没有独立 Context 按钮。
2. 手机端确认顶栏没有新增 Context/缓存行；打开“本窗”后能看到两项，未知也显示“待确认”。
3. 等 query 闲置回收或刷新页面，确认 Context 继续显示最后值；缓存继续倒计时，过期后显示“已过期”而非消失。
4. 发一轮含多个工具的任务，确认 Context 不会按工具次数成倍膨胀，消息 token 面板仍叫“本轮累计消耗”。
5. 在线且空闲时点“立即压缩”；确认弹出成本提示，并在消息间出现“手动压缩已完成 · Nk → Nk”。历史不足时应明确显示没有发生压缩。
6. 若真实发生自动压缩，确认分隔线出现在当轮真实位置，Context 切到 post tokens，刷新后仍能恢复。
7. 切换 Pro/API，确认两条线路不串 Context 或缓存时间。

## 8. 部署

只改 Dashboard，需要重新构建/部署 Dashboard；Haven 不需要部署。按项目惯例由用户 commit + push，再观察 Coolify 自动部署；若未触发或失败，再在 Coolify 对 Dashboard 服务执行 Redeploy。
