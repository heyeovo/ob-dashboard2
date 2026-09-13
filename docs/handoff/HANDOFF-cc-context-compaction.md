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
- 清理边界：识别 `ombre:<bucket_id>#...` 的 OB 动态卡片，以及 `breath`、`search_chat`、`WebSearch`、`WebFetch` 的纯文字 tool result。OB 卡片压成“召回内容已清理：title（bucket_id）”；breath/search/fetch 结果压成“已清理：…”单行，而完整重取参数继续存在于原 tool_use block。用户/助手正文、`date_recall`、报错/非文字结果和名单外工具不动，不调用额外 LLM 摘要。
- 会话边界：Agent SDK `forkSession` 先复制原 Claude transcript，只原子改写副本；Haven 同时校验 `state_version` 与旧 `cc_session_id` 后才更新对应 lane。Dashboard `ob2-*` session 不变，`conversation_turns` 不复制、不新增，因此不会重复聊天消息。旧 Claude transcript 暂时保留，供回退。
- 持久化：Haven `conversation_sessions.context_gc_json` 保存默认关闭的自动开关、固定 05:30、保护 key、最近 20 次 GC 记录和释放 token 估算；`cc_lanes_json` 只替换对应 lane 的 Claude 内部 session 指针。
- 自动边界：Dashboard Node 启动时注册香港时区分钟调度，05:30–05:59 内重试；默认关闭。启用后处理窗口各 CC lane 的未保护安全候选；Haven 日回顾/周轨迹任一最新 run/execution 仍为 running、本地 Pro runner 忙、窗口回复中或有工具待批准时跳过并等待下一分钟；状态接口不可读时 fail closed。Dashboard 进程未运行则当日不会补跑。
- 验收：部署 Haven 与 Dashboard 后，先保持自动关闭；打开一个有 OB 召回或 `search_chat` 的窗口，扫描并只选一项执行，确认窗口 ID/正文/轮次不变、下一句能继续、列表释放量合理、始终保留项不会被选中。真实结果可接受后再按窗口开启 05:30 自动减负。
- 发布顺序：用户分别 commit + push；先更新 Haven Coolify 的 `HAVEN_RELEASE_SHA` 为完整 Haven commit SHA 并 Deploy/Restart，确认 Brain/Gateway healthy，再部署 Dashboard。未部署 Haven 前不要在 Dashboard 执行减负。

## 11. 2026-09-12 下一窗口：滚动模式下的窗口减负复核

- 当前 Dashboard 已完成滚动 SessionStore 跨部署持久化，以及“工作台 → 调参 → 本轮上下文审计”：可核对 Haven 原文与 SDK transcript 落盘角色、`rolling_window_context` 包装命中、背景拼接、最近实际/当前下一轮 Dashboard system prompt 和 cache/context 用量。该功能只改 Dashboard，完整测试与 production build 已通过，尚待用户提交部署后真实验收。
- 下一窗口只讨论“按天滚动模式下，现有窗口减负到底如何运行、是否真的有效、会不会破坏持久 transcript/resume/cache”；先调查和解释，不直接修改。
- 必查交点：Context GC 的 `forkSession`/副本改写使用哪个 SessionStore；滚动会话的持久 `RollingSeedStore` 是否能读取和承接 fork 后 session；Haven lane `cc_session_id + context_revision` CAS 切换后，Dashboard 重启能否继续恢复；revision 变化从 Haven 重建时，已减负结果是否保留或自然失效。
- 还要区分三类内容：原文 `user/assistant` transcript、工具/召回结果、system prompt 中的日回顾/钉选桶/日记。明确窗口减负实际能扫描和改写哪一类，哪些 token 无论如何不会因此下降。
- 讨论输出应面向非技术用户：先给现行流程图/步骤，再列真实风险与可验证日志/审计项，最后给“保持现状 / 暂停滚动窗减负 / 需要修复”的建议。没有用户再次明确说“改吧”前不动代码。

## 12. 2026-09-12 已确认：滚动 revision 的 raw 保真边界

- 产品定义已经确认：`raw` 不只是 Haven 中可见的 user/assistant 正文，而是该日期在 Claude 原生 transcript 中的完整上下文，包括动态召回卡、工具调用、工具结果及原有顺序。
- 当 5 个 raw 日期中的最早 1 天改为 `review` 或 `omit` 时，只允许该日期的完整轮次退出；其余仍为 raw 的 4 天必须逐项保持原样，不能因为 `context_revision` 增加而重新降级为仅 user/assistant 正文。
- 低频场景允许降级：一个已经退出 raw 的旧日期以后重新切回 raw 时，只需从 Haven 恢复可见 user/assistant 正文，不要求恢复当年的工具调用、工具结果和召回卡；设置界面必须明确提示这是“正文恢复”，不是“完整原生上下文恢复”。
- 当前实现不符合上述定义：新 revision 下一轮会从 Haven 为全部 raw 日期重建仅含可见 user/assistant 的新种子，从而隐式清掉仍为 raw 日期的历史工具与召回过程。
- 下一窗口范围：设计并实现“保留旧 transcript 中仍为 raw 日期的完整轮次，只替换退出 raw 的日期”，同时修复 Context GC 与持久 RollingSeedStore 的 fork/扫描/恢复链路；在真实验收完成前，滚动窗口的手动与 05:30 自动减负均应保持禁用。
- 必须先解决完整轮次的日期归属与边界，保证 `tool_use` / `tool_result` 不被拆散；禁止只按单行时间戳粗暴删除。固定窗口、召回评分、手动桶、自动聊天切片和其他页面不在范围内。

## 13. 2026-09-12 已实现：滚动 revision 完整轮次保真

- Dashboard 新 revision 不再为全部 raw 日期从 Haven 重建纯正文。旧持久 RollingSeedStore transcript 现在按“外部 user 输入到下一外部 user 输入前”为完整轮次包；只含 `tool_result` 的 user entry 归属于上一轮，整包内的动态召回、assistant、`tool_use`、`tool_result` 与原顺序一起保留或退出。
- 轮次日期不看 transcript 单行时间戳，而是把完整轮次的 user/assistant 可见正文与 Haven 永久 turn 做全局唯一、顺序保持的对齐，再以 Haven `turn_id/chat_day` 决定保留。无法唯一对齐时 fail closed，不更新该 revision 的 Claude 会话；上一 revision 已是滚动模式但持久 transcript 缺失时同样拒绝静默正文降级。
- 新 revision 的 seed 在进入 SDK 前先原子写入 RollingSeedStore。仍为 raw 的旧轮次从原 transcript 克隆；已退出后重新加入 raw、因而旧 transcript 中不存在的轮次，才从 Haven 补入 user/assistant，并在内部标为 `body_restored`。
- Haven 的 `rolling_context_json.previous_strategy` 记录紧邻上一 revision 的策略，用来区分首次从固定窗口启用滚动和必须保真迁移的滚动→滚动更新；该字段不参与用户配置等价比较，不会导致重复保存额外递增 revision。
- 设置页常驻说明正文恢复边界；用户把 `review/omit` 改回 `raw` 时，该日期显示“正文恢复”，保存前再次确认不会恢复旧工具与召回过程。
- 本阶段没有改 Context GC 的扫描、fork、CAS 或清理实现。daily rolling 的 GC GET/POST 被服务端拦截、自动开关不能开启，05:30 scheduler 也无条件跳过；固定窗口 GC 保持原行为。下一阶段才接 RollingSeedStore 版 GC。
- 自动化验证：Dashboard 全量 `270` 通过、`1` 跳过；保真/运行时/GC 门禁定向 `39` 项通过；production build 通过；Haven `tests.test_gateway_state_contracts` `36` 项通过，`gateway_state.py` 语法检查通过；两仓 `git diff --check` 通过。测试未调用模型或额外 Context 分析。
- 本节实现后的首次真实验收曾失败，随后完成加固并通过第二次验收，完整证据见 13.1。重新加入 raw 的正文恢复提示仍需在以后实际触发该低频场景时复核；daily rolling 手动或 05:30 自动减负继续保持禁用。

### 13.1 2026-09-13 首次真实验收失败后的加固

- 真实窗口 `ob2-20260907-ivxczo` 暴露静默正文重建：调整前截图确认存在“赴约之旅”动态召回和两次 `breath`；调整后持久 transcript 的连续索引证明这些调用不在旧轮次中，只有 Haven user/assistant 正文，调整后的新召回才正常出现。该窗口已判定验收失败，不再用它重复覆盖证据。
- 第二轮修复把迁移门禁改为 fail closed：只有 Haven 明确返回 `previous_strategy=fixed_window` 时允许首次正文建种；daily→daily 或缺失 `previous_strategy` 的未知 revision 都必须取得旧 RollingSeedStore，否则本轮直接失败。Haven 新增内部 `previous_day_modes`，Dashboard 据此区分 raw→raw 与 review/omit→raw；任何 raw→raw 轮次未从旧 transcript 完整命中都会报错，只有真正重新加入 raw 的日期可标记 `body_restored`。
- 审计不再隐藏纯 `tool_use` / `tool_result` entry，并显示工具名、召回包装、正文恢复标记和各类数量。成功重建的旧/新 session、源/目标 entry 数、完整保留轮数、正文恢复轮数、工具和召回数量随首个成功 turn 写入 Haven `raw_json.rolling_seed`；工作台从最近 50 轮中读取，不再依赖易淘汰的 Coolify 首条日志。
- 自动化验证：Dashboard 全量 `272` 通过、`1` 跳过，定向 `14` 项通过，ESLint 与 production build 通过；Haven `36` 项状态契约测试与 Python 语法检查通过。没有调用模型或额外 Context 分析。
- 2026-09-13 第二次真实验收已通过。测试窗口先以 `new_seed=1d0bcda5-87df-4759-9702-081a451d74f9` 建立 RollingSeedStore，随后在 raw 日期内产生两次 MCP 调用（`breath`、`hold`）、对应两条 `tool_result` 和两张完整动态召回卡；把 9 月 9 日改为日回顾后，重建凭据为 `source=revision_seed`、`sourceSessionId=1d0bcda5-87df-4759-9702-081a451d74f9`、`newSessionId=2c8f57f3-8eee-4cc5-935f-5c9edda09619`、`sourceEntryCount=56`、`retainedEnvelopeCount=10`、`bodyRestoredTurnCount=0`。新 transcript 中两组工具调用/结果的 ID、正文和顺序均保持，两张召回卡正文完整，退出日期轮次不再出现。
- 同一新 session 经 Dashboard Redeploy 后仍能从持久 RollingSeedStore 读取，SessionStore 从 49 条继续增长到 53 条；再次发言后工具、结果、召回卡和 `bodyRestored=0` 均保持。因此“同进程 daily→daily 日期调整 → 原子新 seed → Haven lane 写回 → Dashboard 重部署 → 下一轮继续”主链路真实验收通过。
- 当时已知边界“首次 fixed→daily_rolling 只建立正文 `new_seed`”已由下方 13.2 的原生迁移实现解决。审计页当前“召回包装”按文本关键词计数，助手正文或 thinking 仅提到 `memory_card` / `<记忆召回>` 时会产生假阳性；本次显示 4 条而真实注入为 2 张，不影响 transcript 内容或本次保真结论。
- Context GC 仍未接入 RollingSeedStore；daily rolling 的手动与 05:30 自动减负继续硬禁，固定窗口不变。后续若继续实现 GC，必须另开阶段并重新验收 fork/CAS/重部署链路。

### 13.2 2026-09-13 已实现：首次 fixed → rolling 原生迁移

- 首次开启按天滚动不再必然从 Haven 生成纯正文 `new_seed`。Dashboard 根据 Haven lane 的旧 `cc_session_id`，通过当前 Agent SDK 官方 `importSessionToStore()` 从默认本地 transcript 导入完整 entry，再复用同一轮次边界与 Haven 全量 turn/date 对齐，仅把当前 raw 日期的原生轮次克隆进新的 RollingSeedStore；thinking/signature、动态召回、`tool_use`、`tool_result` 和顺序均随整轮保留。
- 新 seed 来源标为 `fixed_transcript_migration`，进入 SDK 前完成原子落盘与重新打开校验，并把源/目标 session、entry 数、完整保留轮数、正文恢复轮数及工具/召回计数写入持久重建凭据。
- 设置页首次 fixed→rolling 保存时明确告知：系统优先完整迁移；若旧默认 transcript 已不存在，用户确认后才允许缺失轮次从 Haven 恢复正文。确认状态持久化为 `allow_fixed_body_restore`，仅用于 fixed→rolling；未确认时旧 session 缺失或任一所选 raw 日期无法完整匹配都会停止首轮，不会静默降级。后续 daily→daily 的 raw→raw 强门禁不变。
- 自动化验证：新增固定 transcript 导入后按日期裁剪并保留召回/工具链、缺源需明确确认及显式同意后才可正文降级的回归测试；Dashboard 全量 `275` 通过、`1` 跳过，production build 与本次改动文件定向 ESLint 通过；Haven `36` 项状态契约测试和 Python 语法检查通过。未调用模型或额外 Context 分析。
- 仍需一次真实首次开启验收：选择尚未启用 rolling、固定窗口默认 transcript 仍存在且包含工具/召回的多日窗口；保存按天滚动后发第一句，审计应显示 `source=fixed_transcript_migration`、`bodyRestoredTurnCount=0`，且 raw 日期的原工具/召回完整存在。若源确实不存在，需验证未确认时停止、确认后才出现正文恢复。该验收不改变 Context GC 仍被硬禁的状态。

### 13.3 2026-09-13 已修复：同 revision 重部署不得正文降级

- 真实主窗 `ob2-20260829-42ehxs` 在 Dashboard 修复期间重部署后，约 01:35 的下一轮输入从约 63.6k 降至 48.6k，旧动态召回在当前 transcript 中消失。后续 Coolify 日志确认该窗实际已是 `daily_rolling` revision 1；Haven 请求恢复 `cc_session_id=6ae6b3da-554e-4760-ac74-c2e78e312a25`，但当时 `hasUsableResumeHint=false`。旧实现会在“revision 未变、专用 RollingSeedStore 不存在”时静默执行 Haven 正文 `new_seed`，这正是丢失隐藏召回/工具过程的缺口，不是 fixed→rolling 日期裁剪误伤。
- `new_seed` 现在也必须在 Agent SDK 启动前原子写入并重新打开确认，Haven 因此不会先得到一个尚无持久文件的 rolling session ID。
- 同 revision 冷恢复时，若专用 RollingSeedStore 不存在，Dashboard 会先用 SDK 官方 `importSessionToStore()` 原样导入同一 `cc_session_id` 的默认 transcript，并以 `legacy_transcript_recovery` 来源落入专用 store；不按 Haven 日期重组，不删除 thinking、召回或工具链。专用 store 与默认 transcript 均不存在时本轮直接失败，禁止再次用 Haven user/assistant 正文静默降级。
- 已经在 01:35 前从该主窗当前 transcript 消失的隐藏召回无法由 Haven 反向恢复；本修复保护现存 transcript 和后续窗口。真实复验应在部署前记录审计 entry/召回/工具数量，部署后发一轮，日志应为 `storeSource=persisted`；若触发兼容补回则为 `legacy_transcript_recovery` 且 `bodyRestoredTurnCount=0`。两份源都不存在时应明确报错，数量不得悄悄减少。
- 自动化验证：新增 `new_seed` 预落盘、同 revision 默认 transcript 原样恢复、双源缺失 fail closed 测试；Dashboard 全量 `278` 通过、`1` 跳过，相关运行时/滚动定向 `43` 项通过，production build、定向 ESLint 与 `git diff --check` 通过。未调用模型或额外 Context 分析；daily rolling 手动和 05:30 自动 Context GC 继续硬禁，固定窗口未改。

### 13.4 2026-09-13 已实现：正文恢复时间戳与旧 thinking 精简

- `body_restored` 不再只写 Haven user/assistant 正文。普通 user entry 现在复用正常实时消息的 `beijingRuntimeContext()`，把 Haven `created_at` 转成同样的 `[北京时间 YYYY-MM-DD HH:mm 周X]` 并放在正文尾部；Claude 看不到“恢复”提示，内部 `body_restored` 标记继续只供审计。
- Haven 中 assistant-only 的 `agent_wake` 仍按隐藏 user trigger → assistant 还原；隐藏 `<agent_wake/>` 输入同样带正常尾部时间戳，优先使用 `raw_json.agent_wake.at`，缺失或无效时退回该 turn 的 `created_at`。
- 每次 fixed→rolling 或 daily→daily 生成新 revision seed 时，只保留最新一个实际有消息的 raw `chat_day` 的 `thinking` / `redacted_thinking`。更早 raw 日期会删除已完成轮次里的 thinking，但保留 user/assistant 正文、动态召回、`tool_use`、`tool_result` 和顺序；若某轮存在没有对应 `tool_result` 的工具调用，该轮 thinking 不清理。
- `raw_json.rolling_seed.thinkingPrunedBlockCount` 记录本次删除的 thinking block 数，工作台现有“最近一次重建凭据”可直接复核；同 revision 冷恢复不再次清理，只有用户保存产生新 revision 时执行。
- 自动化验证：滚动定向测试 `18` 项通过，Dashboard 全量 `281` 通过、`1` 跳过，改动文件定向 ESLint、production build 与 `git diff --check` 通过。未调用模型或额外 Context 分析；固定窗口和 daily rolling Context GC 门禁均未修改。
- 上线后真实验收：先记录一个多 raw 日期窗口的审计 thinking/tool 数，修改最早日期并发下一句；确认重建凭据的 `thinkingPrunedBlockCount` 大于零、最新 raw 日仍有 thinking、较早 raw 日无 thinking、工具调用/结果顺序不变。再把已退出日期切回 raw，确认恢复 user 消息尾部只有正常北京时间戳且没有恢复提示；含主动消息的日期还应确认隐藏 `<agent_wake/>` 后时间戳来自其 wake 时间。
