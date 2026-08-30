# HANDOFF — CC 当前 Context 与自动压缩状态展示

> 建立时间：2026-08-23  
> 完成时间：2026-08-23；2026-08-30 补充模块占比与 SDK 官方分析
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
- 2026-08-30：本窗口设置改为“会话信息 / Context 分析”两个顶层 Tab。原宏观占比搬到 Context 页，只展示提示词、换窗资料、MCP、Web、本窗对话和“未归因差额”；模块明确标为产品预估，不再把差额命名成 CC/SDK 开销。
- 2026-08-30：Context 页新增用户手动触发的 `Query.getContextUsage()` 官方精确分析，展示 SDK categories、前缀聚合及消息历史中的用户/助手/工具调用/工具结果/附件/重定向/SDK 未归因 token。只复用当前在线、空闲且 lane 匹配的原生会话，不新建 query、不自动轮询；读取结果在 live session 内缓存，每次模型调用完成后失效。因历史实测该控制接口可能额外发出多次上游请求，按钮旁持续显示 Pro/API 成本警告。
- 2026-08-30：Context 页两个一级区域统一复用 `Card variant="outline"`，边框、白色表面、圆角和 padding 不再各自拼装。仓库 `CLAUDE.md` 同时补充强制规则：所有 UI 修改前必须完整阅读 `DESIGN.md`，并明确 `CLAUDE.md` 是唯一顶层项目规则入口，不恢复重复的仓库 `AGENTS.md`。
- 2026-08-30：“本窗口设置”外框统一为 `86vh`，会话信息与 Context 分析切换时保持同一高度，内容只在各自 Tab 内滚动。
- 2026-08-30：MCP 配置页按服务与工具显示下轮 token 预估及占全部 MCP 的比例。`tools/list` 的 `inputSchema` 随目录持久化，服务/工具开关即时重算，保存失败回滚；旧目录需点一次“刷新工具清单”补齐 schema。
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
- 未改 Pro 额度实验接口的持久化策略（仅指本节原压缩任务；后续修复见第 9 节）。
- 用户原有未跟踪 `.claude/` 未修改、删除或加入提交。

## 6. 验证

- `npx vitest run tests/cc-sse-consumer.test.ts tests/cc-history.test.ts tests/cc-runTurn.test.ts`：35/35 通过。
- 定向 ESLint：通过。
- `npm run build`：通过，`/api/cc-compact` 已进入 route 清单。
- 2026-08-30 模块占比补充：`npm run build` 通过；本地浏览器被 Dashboard 登录页阻挡，未代填口令，待登录后做手机端视觉验收。
- 2026-08-30 SDK Context 分析补充：production build 通过，`/api/cc-context-analysis` 已进入 route 清单；定点 13 项测试通过（新增路由 lane/离线边界 + 原 token 估算/MCP 配置测试）。
- 2026-08-30 本次完整 `npm test`：201 通过、1 跳过、1 个既有 `automation-pro-runner append_current` 断言失败；失败模块不在本次范围，未修改。
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
8. 打开“本窗 → Context 分析”，确认宏观占比条不展开 MCP 服务，“CC/SDK 其他”已改为“未归因差额”。点击“读取官方分析”，确认出现 SDK 官方分类、前缀明细和消息明细；重新发一轮后需要再次手动读取。若 Dashboard 刚重部署，先在目标线路发一条消息让原生会话上线。
9. 前往“工具 · MCP”，刷新一次工具清单后确认服务/工具 token 会随开关即时变化，下一句话后总 Context 再更新。

## 8. 部署

只改 Dashboard，需要重新构建/部署 Dashboard；Haven 不需要部署。按项目惯例由用户 commit + push，再观察 Coolify 自动部署；若未触发或失败，再在 Coolify 对 Dashboard 服务执行 Redeploy。

## 9. 2026-08-30 Dashboard 重部署缓存与 Pro 额度持久化修复

- 当前完成状态：Dashboard 与 Haven 跨仓库代码、兼容迁移、契约测试和正式文档均已完成；尚待用户 commit、push 与 Coolify 发布。
- 已确认决定：CC 最终 `personaAppend` 按窗口首次写入 Haven 后冻结，进程内 Map 只作加速；Dashboard 重部署不再重新计算该前缀。Anthropic 上游 TTL、模型或工具集合变化仍可能正常重写缓存。
- 已确认决定：Pro 额度属于 profile 的订阅账号，Haven 只保留一条最近快照，新值覆盖旧值；所有窗口共用，重部署后显示为带读取时间的上次值，下一次在线实时读取再覆盖。
- 边界：未改 selfhost、召回、聊天正文、API provider 统计或 Prompt Cache 的 1h/5m 策略；用户原有未跟踪 `.claude/` 未修改。
- 验证：Haven `tests.test_gateway_state_contracts` 22 项通过并完成 Python 语法检查；Dashboard 定点 24 项通过，production build 通过。完整前端测试 199 通过、1 跳过、1 个既有 `automation-pro-runner append_current` 断言失败，本次未改该模块。
- 发布顺序：先由用户提交 Haven，并在 Coolify `Ombre Brain → production → haven-test-stack → Environment Variables` 把 `HAVEN_RELEASE_SHA` 更新为完整 commit SHA，再普通 Restart/Deploy，确认 Brain/Gateway healthy；随后提交并 Redeploy Dashboard。
- 验收：在同一 CC Pro 窗口发言并记录 1h/5m 缓存写入和 Pro 额度时间，重部署 Dashboard 后立即再发一句；1h 系统前缀应继续命中（仍受上游有效期约束），Pro 额度应先显示同一份上次值，在线查询成功后刷新时间。打开其他窗口应看到同一额度快照。

## 10. 2026-08-31 Context GC / 窗口减负

- 当前完成状态：Dashboard 与 Haven 实现完成，定向转换测试、Haven 23 项状态契约测试和 Dashboard production build 通过；尚未在用户真实长会话执行减负，自动开关默认关闭。
- 产品决定：入口为“本窗口设置”的第三个 Tab“窗口减负”。默认不勾选任何候选；可逐项清理、暂时不选或按稳定 key“始终保留”。
- 清理边界：只识别 `ombre:<bucket_id>#...` 的 OB 动态卡片和纯文字 `search_chat` tool result。OB 卡片替换为 `read_bucket(bucket_id)` 最小引用；search 只留“曾搜索「query」”。用户/助手正文、`date_recall`、普通 breath 结果和结构未知的工具结果不动，不调用额外 LLM 摘要。
- 会话边界：Agent SDK `forkSession` 先复制原 Claude transcript，只原子改写副本；Haven 同时校验 `state_version` 与旧 `cc_session_id` 后才更新对应 lane。Dashboard `ob2-*` session 不变，`conversation_turns` 不复制、不新增，因此不会重复聊天消息。旧 Claude transcript 暂时保留，供回退。
- 持久化：Haven `conversation_sessions.context_gc_json` 保存默认关闭的自动开关、固定 05:30、保护 key、最近 20 次 GC 记录和释放 token 估算；`cc_lanes_json` 只替换对应 lane 的 Claude 内部 session 指针。
- 自动边界：Dashboard Node 启动时注册香港时区分钟调度，05:30–05:59 内重试；默认关闭。启用后处理窗口各 CC lane 的未保护安全候选；Haven 日回顾/周轨迹任一最新 run/execution 仍为 running、本地 Pro runner 忙、窗口回复中或有工具待批准时跳过并等待下一分钟；状态接口不可读时 fail closed。Dashboard 进程未运行则当日不会补跑。
- 验收：部署 Haven 与 Dashboard 后，先保持自动关闭；打开一个有 OB 召回或 `search_chat` 的窗口，扫描并只选一项执行，确认窗口 ID/正文/轮次不变、下一句能继续、列表释放量合理、始终保留项不会被选中。真实结果可接受后再按窗口开启 05:30 自动减负。
- 发布顺序：用户分别 commit + push；先更新 Haven Coolify 的 `HAVEN_RELEASE_SHA` 为完整 Haven commit SHA 并 Deploy/Restart，确认 Brain/Gateway healthy，再部署 Dashboard。未部署 Haven 前不要在 Dashboard 执行减负。
