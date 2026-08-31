# CC 缓存保活与 Claude 主动唤醒方案

> 状态：产品方案已确认；阶段 1 Haven 持久控制面已实施，阶段 2–6 待实施
> 建立时间：2026-08-31  
> 涉及仓库：`ob-dashboard2`、`Ombre-Brain-Haven`

## 1. 目标与边界

在 Dashboard 的同一个 CC 会话中加入两种后台触发能力：

1. 缓存保活：在 1h prompt cache 失效前，用一次真实模型 turn 刷新缓存。
2. 主动唤醒：Claude 可以给未来的自己设置下一次 wake 时间和一条很短的原因备注。

另外增加一种条件性触发：正常聊天中 Claude 回复后，如果用户突然没有继续回复，由外部 scheduler 在一次随机等待后唤醒 Claude，让它当场判断是否值得追问；Claude 不需要在每轮提前猜测用户会不会离开。

两者必须共用当前 CC lane、现有 Agent SDK session 和正常 turn 串行入口。Scheduler 持久化在 Haven，Claude 进程不得自行 `sleep`。

第一版只支持 CC，不支持 selfhost 主动唤醒；只保活当前最后活跃的 CC lane，不同时维持多条 subscription/API provider 线路。

## 2. 已确认的产品决定

- 即使 Claude 没设置下一次 wake，只要缓存保活开启，55 分钟兜底也会真正唤醒 Claude。它可以 no-op、发消息、调用允许的工具或设置下一次 wake。
- 不设安静时段，任何时间都允许 Claude 主动说话。
- 第一版夜间持续保活，不增加凌晨 03:00–09:00 自动停止规则；上线后根据真实 55 分钟样本再决定。
- 连续 24 小时没有用户活动时，只自动停止缓存保活，不删除 Claude 已经设置的未来 wake。
- “缓存保活”和“允许主动唤醒”是两个独立开关。关闭保活后，已有 schedule 仍可在未来冷启动执行；如果没有已安排的 wake，就只能等待用户或外部任务再次触发。
- 提供“暂停保活直到下次用户消息”快捷操作；用户下一次发言时自动重新进入保活。
- Claude 主动设置 wake 的最短间隔暂定 10 分钟。
- 每窗口滚动 24 小时后台模型 turn 上限暂定 48 次，可动态调整；用户消息不计入上限。达到上限后停止后台请求，允许 cache 自然冷掉。
- 主动 wake 可以使用已开启且按现有规则自动允许的 MCP 与只读工具。需要人工批准的 MCP、Bash 和文件写入在后台不等待审批；Claude 如确有需要，应发普通消息请用户处理。
- UI 不占用对话窗口顶部。在“本窗口设置”增加第 4 个 Tab“主动唤醒”，排在“会话信息 / Context 分析 / 窗口减负”之后。
- Claude 的一轮完整 assistant message 在模型 Context 和 Haven 中仍保持一条；前端只把其中可拆的普通聊天文字显示成连续气泡，代码、列表、表格等结构化内容不机械拆分。
- Bark 只作为消息成功落库后的服务端通知通道，不作为 Claude MCP，不进入模型 Context。第一版默认只推送主动 wake 产生的可见 assistant 消息；heartbeat no-op 和只有 next wake 的轮次不推送。
- Bark 按前端同一份气泡分段顺序推送：首条正常提醒，后续分段使用较轻通知；默认每轮最多 8 条、约 1 秒间隔，均可动态调整。
- 正常用户 turn 的 assistant 回复结束后，外部系统创建一次条件性 `conversation_silence_check_at`。等待时间不是固定 10 分钟：默认在 8–25 分钟内抽取一次，概率偏向 12–16 分钟；用户到期前回复即取消，不请求模型、不增加 Context。
- Silence check 每轮最多一次。Silence wake no-op 后不重复检查；Claude 因 silence 主动追问后也不自动再开下一轮检查，避免连续催促。

## 3. 基础双时钟与条件性沉默检查

每次真实模型请求成功后，同时更新：

- `cache_keepalive_deadline = last_cache_refresh_at + 55min`
- Claude 可选设置的 `next_agent_wake_at`

实际调度时间：

```text
due_at = min(
  next_agent_wake_at,
  cache_keepalive_deadline,
  conversation_silence_check_at
)
```

前两个是持续存在的基础双时钟；`conversation_silence_check_at` 只在正常用户对话后的 assistant 回复结束时临时创建，不是 Claude 主动设置的 wake。

示例：

- 11:00 用户发言，缓存保活时间变为 11:55。
- Claude 设置 12:30 主动醒来。
- 11:55 先执行缓存保活 wake，并把新的缓存保活时间推到 12:50。
- Claude 若未修改原计划，12:30 仍会主动 wake。
- 12:30 的真实模型请求又把缓存保活时间推到 13:25。

任何更早发生的用户消息或主动 wake 都会刷新缓存时钟，因此不会在原定 55 分钟点再重复 heartbeat。

### 3.1 沉默检查

```text
正常用户 turn 的 assistant 回复成功落库
  → 在 8–25 分钟内抽取一次等待时间
  → 持久化 conversation_silence_check_at
      ├─ 用户提前回复：原子取消，零模型调用
      └─ 到期仍未回复：触发一次 cause=conversation_silence 的 wake
```

随机值采用中间概率更高的有界分布，默认重点落在 12–16 分钟，而不是简单固定值或每个分钟等概率。每个源 turn 只抽一次；抽中的绝对时间、`source_turn_id` 和 `policy_version` 一起持久化。Scheduler 轮询、重试、Dashboard/Haven 重启都复用同一时间，禁止重新抽样导致 deadline 漂移。

Silence wake 只收到一条极短结构化触发信息，例如：

```xml
<agent_wake v="1" cause="conversation_silence" idle="14m" source_turn="123"/>
```

Claude 在确认用户确实没有回复以后，才判断 no-op、补充、追问、调用允许的工具或设置真正的下一次 wake。该规则只在稳定 system prompt 中说明一次。

Cache TTL 必须按模型请求开始时间计算。只有成功 result 的 usage 能确认本次发生 cache read/write 时，才把该请求的 `started_at` 写成 `last_cache_refresh_at`；不能用回复结束时间高估剩余 TTL。

## 4. 开关与生命周期

### 4.1 两个独立开关

| 缓存保活 | 允许主动唤醒 | 行为 |
|---|---|---|
| 开 | 开 | 55 分钟兜底，同时执行 Claude schedule |
| 关 | 开 | 不做固定 heartbeat；已有 schedule 仍执行，可能冷启动 |
| 开 | 关 | 只做缓存 heartbeat，不接受 Claude 的主动 schedule |
| 关 | 关 | 不发生后台模型请求 |

关闭“允许主动唤醒”时不删除已有 schedule，只标记暂停；重新开启后重新计算是否仍应执行，过期 schedule 不补跑多次。

### 4.2 自动停止

当 `now - last_user_activity_at >= 24h`：

1. 自动停止缓存保活。
2. 不删除未来 `next_agent_wake_at` 和 `wake_reason`。
3. 已安排的 wake 到时仍可执行，但不会因为那次后台模型请求自动恢复 55 分钟循环。
4. 用户再次发言时，如果本窗口的持久保活开关仍为开启，则重新 arm 缓存保活。

### 4.3 停止保活到 Context GC

```text
keepalive stop
  → cache cooling
  → last_cache_refresh_at + 60min + grace
  → cache cold / gc eligible
  → 现有 Context GC 才可处理
```

第一版只预留 `gc_eligible_at` 和停止原因，不新增自动 GC 策略。现有 GC 仍需遵守 busy、compacting、待审批和 lane 校验。

## 5. Context 与 token 控制

### 5.1 不重复注入行为说明

Claude 收到 wake 后应该如何判断、何时 no-op、如何调用调度工具，只在稳定 system prompt 中说明一次。每次 heartbeat 不重复整段说明。

调度工具是固定的进程内 SDK MCP 工具，工具 schema 进入稳定缓存前缀，不随每轮增长。

### 5.2 每次 wake 的动态 Context

每次只加入一条短结构，例如：

```xml
<agent_wake v="1" id="wake_xxx" at="2026-08-31T11:55:00+08:00" cause="cache_keepalive" reason="看看她有没有下班"/>
```

- `wake_reason` 是 Claude 留给未来自己的短备注，限制为最多 30 个中文字符或等价长度。
- 没话说时使用固定内部 no-op 标记；UI 不生成普通 assistant 气泡。
- UI 文案与模型 Context 分离，不把“Claude 醒了一次”等展示文字重复塞回 Context。
- 历史重建、跨引擎补齐和 Context GC 后都由同一个 renderer 从结构化 metadata 生成上述短格式。

### 5.3 成本观察

第一版整晚保活，但必须记录每次后台 turn 的：

- `cache_read_input_tokens`
- `ephemeral_1h_input_tokens`
- `ephemeral_5m_input_tokens`
- output tokens
- Pro/API 可观察额度变化

夜间策略不能只根据理论价格决定。当前 prompt 同时存在 1h 稳定前缀和 5m 会话段，必须用真实 55 分钟间隔验证会话段的重写量。

## 6. Claude 调度工具

固定内建工具：`set_agent_wake`。

建议输入：

```json
{
  "action": "schedule",
  "after_minutes": 30,
  "at": null,
  "reason": "等结果出来"
}
```

或：

```json
{ "action": "cancel" }
```

规则：

- `after_minutes` 与 `at` 二选一；`at` 使用带时区 RFC 3339。
- `schedule` 最短 10 分钟；最远时间第一版限制为 7 天。
- 同一 turn 多次调用时，最后一次有效决定生效。
- 工具只在当前 turn 内暂存决定，不立即写 Haven。
- turn 成功后，消息、wake event、next schedule 和活动时间原子提交。
- 工具始终存在，不跟普通可开关 MCP 一起被移除，避免工具前缀频繁变化。

## 7. 持久化设计

### 7.1 `agent_wake_schedules`

Haven 新增会话级持久表，主键：

```text
(profile_id, session_id, lane_id)
```

核心字段：

| 字段 | 含义 |
|---|---|
| `keepalive_enabled` | 本窗口持久保活开关 |
| `keepalive_paused_until_user` | 是否暂停到下次用户消息 |
| `agent_wake_enabled` | 是否允许 Claude schedule |
| `last_user_activity_at` | 真实用户最后活动，heartbeat 不得刷新 |
| `last_model_activity_at` | 最近一次实际模型请求开始时间 |
| `last_cache_refresh_at` | usage 已确认的 cache read/write 请求开始时间 |
| `last_heartbeat_at` | 最近一次实际后台 wake |
| `next_agent_wake_at` | Claude 设置的下一次 wake，可空 |
| `wake_reason` | 给未来自己的短备注 |
| `conversation_silence_check_at` | 正常对话后一次性抽取的沉默检查时间，可空 |
| `silence_source_turn_id` | 本次沉默检查对应的正常 assistant 回复 |
| `silence_policy_version` | 抽样规则版本，保证升级与幂等可追踪 |
| `cache_keepalive_deadline` | 缓存兜底时间 |
| `due_at` | 两个时钟的最小值，建立到期索引 |
| `cache_state` | `unarmed / warm / cooling / cold` |
| `schedule_version` | 更新、取消和重复回调的 CAS 版本 |
| `lease_owner / lease_until` | 多实例互斥与崩溃恢复 |
| `background_turn_limit` | 动态上限，默认 48/滚动 24h |
| `consecutive_failures / last_error` | 重试退避和熔断 |
| `gc_eligible_at` | Context GC 生命周期接口 |

这张表放在 Haven 的 profile/session 持久层；复用现有 automation scheduler 的到期查询、原子 lease 和过期 lease 恢复模式，但不直接复用按固定 `task_type` 设计的 `automation_schedules` 表。

### 7.2 `agent_wake_runs`

保存每次后台 job 的幂等与运维状态：

```text
wake_id, profile_id, session_id, lane_id, schedule_version,
cause, due_at, status, started_at, completed_at, turn_id, error
```

状态：`claimed / running / completed / deferred / failed / superseded`。

### 7.3 `conversation_turns`

新增兼容字段：

```text
turn_kind = user | agent_wake
```

旧数据默认 `user`。Wake turn 允许 `user_text` 和 `assistant_text` 同时为空，真实语义写入短 metadata：

```json
{
  "version": 1,
  "turn_kind": "agent_wake",
  "agent_wake": {
    "wake_id": "wake_xxx",
    "cause": "cache_keepalive",
    "at": "2026-08-31T11:55:00+08:00",
    "outcome": "noop"
  },
  "next_wake": {
    "at": "2026-08-31T12:35:00+08:00",
    "reason": "想看看小羊有没有去吃饭"
  }
}
```

## 8. 调度、并发与去重

### 8.1 Haven scheduler

- 复用现有 30 秒持久调度循环的结构。
- 查询 `due_at <= now` 且 lease 空闲/过期的 schedule。
- 原子 claim 后生成唯一 `wake_id`，携带 `schedule_version` 调用 Dashboard 内部 wake runner。
- 重启后从 Haven 数据恢复；相同 `wake_id` 不重复执行。
- 失败使用短退避，连续失败达到阈值后暂停后台 wake，避免错误循环。

### 8.2 Dashboard `SessionTurnCoordinator`

用户 turn、主动 wake 和缓存 heartbeat 必须经过同一协调器：

- foreground 用户 turn 高优先级。
- background wake 低优先级。
- 现有 `live.busy` 保留，保护 Agent SDK iterator；Haven lease 处理多实例和重启，两者不能互相替代。
- session 正在生成、压缩或等待工具审批时，wake 不生成 UI event、不调用模型，标记 deferred。
- 正常 turn 完成后主动重新计算 `due_at`，scheduler 轮询只作兜底。

### 8.3 同时到达

- Wake 尚未开始模型请求：用户 turn 胜出，wake 标记 `superseded`。
- 已到期的 wake reason 用极短 metadata 合并进该用户 turn，让 Claude 知道自己原本为什么想醒。
- Wake 已经开始模型请求：不并发、不强行中断；用户 turn 排在后面。
- 任一成功真实模型请求都会重新计算缓存 deadline，原 heartbeat 不再重复触发。
- 用户消息一旦被接受，应在进入模型前先按 `silence_source_turn_id/schedule_version` 原子取消未到期 silence check；取消只改持久 timer，不产生 wake event 或 Context。
- 只有 `turn_kind=user` 的正常 assistant 回复可以创建下一次 silence check；`agent_wake` 回复、silence 追问、heartbeat 和后台工具结果都不得自动连锁创建。

## 9. 后台工具权限

- `set_agent_wake`：自动允许。
- 已开启且当前权限为自动允许的 MCP：允许。
- 只读工具：按现有规则允许。
- 需要浏览器批准的 MCP、Bash、Edit、Write、NotebookEdit：后台拒绝，不创建等待批准卡片。
- Claude 如果需要用户参与，应发送普通 assistant message，说明需要用户做什么。

后台拒绝只影响本次 wake，不改变该工具在正常用户 turn 中的权限。

Conversation silence 不通过 `set_agent_wake` 创建。它是应用层根据正常 turn 成功提交自动生成的一次性条件 timer，因此 Claude 不需要在聊天中途莫名其妙预设“过几分钟看看用户回没回”。

## 10. 消息类型和 UI

### 10.1 历史映射

`agent_wake` turn 在前端拆成：

1. 一条轻量 system event：`11:55 · Claude 醒了一次`
2. 可选的普通 assistant message
3. 可选的 next wake 行

Claude 有可见回复时，next wake 显示在回复下方：

```text
↳ 下次唤醒 12:35 · 想看看小羊有没有去吃饭
```

Claude no-op 时，不生成普通 assistant message；next wake 显示在 wake event 下方。

### 10.2 “本窗口设置”第 4 个 Tab

名称：“主动唤醒”。第一版包含：

- 允许主动唤醒开关
- 缓存保活开关
- “暂停保活直到下次用户消息”
- 当前 cache 状态
- 最近一次 cache refresh
- 下一次固定保活时间
- Claude 设置的下一次 wake 与 reason
- 取消下一次 wake
- 24 小时无用户活动自动停止说明
- 主动 wake 最短间隔，默认 10 分钟，可调
- 对话沉默检查范围，默认 8–25 分钟，可调；具体抽中时间只在本 Tab 显示
- 后台 turn 上限，默认 48/滚动 24h，可调
- 最近后台 wake 次数与最近错误
- “立即停止所有后台唤醒”

不在对话窗口顶部增加入口或状态，避免挤占现有空间。

### 10.3 页面打开时更新

后台 wake 没有当前用户请求的浏览器 SSE。第一版在页面可见且没有正在发送时增量拉取新 turn，并在页面重新获得焦点时立即刷新。先不引入 WebSocket。

### 10.4 Assistant 消息气泡拆分

拆分只属于 presentation，不能改变模型和持久化的 turn 语义：

```text
Claude Context：一条完整 assistant message
Haven conversation_turns：一轮、一条完整 assistant_text
前端：同一 assistant message 显示为多个连续气泡
Bark：复用同一份分段逐条通知
```

服务端在完整回复结束后使用 Markdown block parser 生成带版本的 `display_segments`，随该轮 presentation metadata 保存。前端历史与 Bark 都读取这份结果，不在两个调用方各写一套分割规则；旧消息没有 metadata 时可以按当前版本即时派生，但不能回写或改变原始 `assistant_text`。

可拆内容：

- 普通聊天段落。
- 普通聊天文字中自然结束后的换行。
- 独立短句、承接句和模拟连续发言的短段。
- 在结构化 Markdown 之外，单换行也可作为气泡边界；空行必定是候选边界。

保持原子、不机械拆分：

- fenced code block。
- Markdown 表格。
- 有序/无序列表和任务列表。
- blockquote。
- 标题与紧随其后的内容。
- 工具过程、thinking、附件、召回卡片、compaction 与 wake system event。
- 其他内部依赖换行保持结构的 Markdown block。

分段器必须保留原始 Markdown 文本及顺序。流式生成时，只有在边界已确认后才新开下一气泡；不能为了提早显示而把尚未闭合的代码块或列表切开。复制整轮、Context token、usage、回退和搜索仍以原始完整消息为准。

### 10.5 Bark 分段推送

Bark 是应用层的确定性副作用，不让 Claude 自己决定是否调用通知工具：

```text
主动 wake 生成可见 assistant message
  → Haven 原子保存 turn + display_segments + notification outbox
  → outbox worker 按 segment_index 顺序 POST Bark
  → Bark/APNs 推送到 iPhone
  → 点击通知打开对应 Dashboard 会话
```

第一版规则：

- 只推 `turn_kind=agent_wake` 且存在可见 `assistant_text` 的回复；普通前台问答默认不推。
- heartbeat no-op、只设置 next wake、失败或未确认落库的消息不推。
- 每个普通聊天气泡对应一条 Bark；使用同一 session group 和会话 deep link。
- 第一条使用正常提醒；同一轮后续分段使用较轻通知，避免连续响铃和亮屏。
- 相邻通知默认间隔约 1 秒。
- 每轮默认最多 8 条，可在设置中动态调整；超出部分合并到最后一条，并提示打开会话查看后续。
- 代码、表格、长列表等原子 block 不把完整技术正文塞进锁屏，只推“Claude 还发来了一段代码/列表，点开查看”一类展示提示。
- 幂等键使用 `turn_id + segment_index + splitter_version`；重启和网络重试不能重复推送已成功分段。
- Bark 失败不回滚聊天消息；outbox 独立记录重试、成功和最终失败。
- Bark server URL、device key 和加密配置只保存在 Haven 服务端/profile 配置，浏览器只接收掩码；不得把 key 放进前端、Claude Context、MCP 工具定义或日志。

“本窗口设置 → 主动唤醒”Tab 增加窗口级开关“Claude 主动发消息时推送到 Bark”，并显示最近一次推送结果。Profile 级 Bark 地址、key、测试通知、正文隐藏/摘要模式、通知轻重、分段间隔和每轮上限放在统一通知配置中；具体入口在 Phase 5 UI 实施前确认，不在每个窗口重复保存密钥。

## 11. 状态机

```text
UNARMED
  └─ 首次成功的真实模型请求
       → WARM_IDLE
           └─ due_at 到达
                → CLAIMED
                    ├─ busy / user queued → DEFERRED → WARM_IDLE
                    ├─ version changed    → SUPERSEDED
                    └─ turn gate acquired → RUNNING
                                             ├─ success → WARM_IDLE
                                             └─ error   → RETRY_BACKOFF

停止保活：
WARM_IDLE → COOLING → COLD → GC_ELIGIBLE → GC_RUNNING
```

旧窗口升级后保持 `UNARMED`，不能因为启用功能立刻触发一次昂贵冷启动。用户下一次正常请求成功后才开始 55 分钟计时。

## 12. 分阶段实施

### 阶段 1：Haven 持久控制面（已完成）

- 兼容迁移：schedule、run、`turn_kind`。
- schedule CRUD、CAS、due claim、lease 恢复、幂等测试。
- profile/session/lane 隔离与删除边界测试。

### 阶段 2：Dashboard 后台 turn

- 抽出用户/wake 共用的 `SessionTurnCoordinator`。
- 后台 wake runner 从 Haven 还原最后活跃 lane、Persona、冻结 prompt 和 resume id。
- 加入固定进程内 `set_agent_wake` 工具和后台权限策略。
- 修正 cache refresh 时间语义。

### 阶段 3：消息持久化与前端

- Wake turn 与 schedule 原子提交。
- 在 Haven 控制面增加兼容迁移字段：`conversation_silence_check_at`、`silence_source_turn_id`、`silence_policy_version`。
- 正常用户 turn 的 assistant 回复提交成功后，按当前配置只采样一次随机延迟并持久化；下一条用户消息进入时先取消尚未触发的沉默检查。
- 历史转换增加 wake event 和 next wake metadata。
- 为新 assistant 回复生成并保存版本化 `display_segments`；前端按 Markdown 语义把普通聊天显示成连续气泡，原子 block 保持完整。
- “本窗口设置”新增第 4 个 Tab。
- 页面可见时增量刷新后台消息。

### 阶段 4：调度接通与故障验证

- Haven scheduler 调用 Dashboard runner。
- Scheduler 将持久化的 `conversation_silence_check_at` 纳入同一 due-time 计算；到点且来源 turn 仍有效时，以 `conversation_silence` 原因触发一次 wake。
- 验证随机时间只采样一次、重启后不漂移、用户回复可取消，以及沉默 wake 不会自行链式再挂一个沉默检查。
- 验证重启恢复、重复回调、lease 过期、busy defer、用户碰撞和失败退避。
- 加入滚动 24 小时后台上限。

### 阶段 5：Bark 分段通知

- Haven 增加 profile 级 Bark 私密配置和持久 notification outbox。
- 主动 wake 的可见消息成功落库后，按 `display_segments` 生成幂等通知项。
- Dashboard 增加通知配置与测试入口，“本窗口设置 → 主动唤醒”增加窗口级 Bark 开关和最近状态。
- 实现首条正常、后续较轻、默认 1 秒间隔、默认每轮最多 8 条的可调策略。
- 实现会话 deep link、失败重试、重启恢复、敏感 key 脱敏和可选隐藏正文模式。

### 阶段 6：真实成本与生命周期验收

- 收集至少 3 次真实 55 分钟 heartbeat 样本。
- 对比夜间持续保活与早晨冷启动的 cache read/write、额度和 Context 增量。
- 再决定是否增加 03:00–09:00 夜间策略。
- 验证停止保活后 cache cold，再进入现有 Context GC 的边界。

## 13. 第一版验收标准

1. 没有 Claude schedule 时，55 分钟仍触发一次真实 wake；no-op 时只有轻量 event。
2. Claude 设置 30 分钟 wake 后，30 分钟先触发，原 55 分钟 heartbeat 被重新计算，不重复执行。
3. 用户消息与 wake 同时到达时不并发，不出现两次模型请求撞同一 SDK iterator。
4. Dashboard/Haven 重启后 schedule 恢复；相同 `wake_id` 只执行一次。
5. 正在回复、压缩或待审批时，wake 延后且不产生假的“醒了一次”事件。
6. 主动回复按正常 assistant message 保存；no-op 不产生空消息气泡。
7. Next wake 时间和短 reason 刷新后仍显示，后续 Claude Context 可见。
8. Heartbeat 不刷新 `last_user_activity_at`；24 小时无用户活动能停止固定保活。
9. 关闭缓存保活后，已安排的未来 wake 仍可执行；没有 schedule 时不会自行醒来。
10. 后台不能挂起等待人工工具审批。
11. 每次动态 wake 不重复注入行为说明，纯 heartbeat 的 Context 增量保持在实测可接受量级。
12. 当前最后活跃 lane 被保活，其他历史 lane 不产生后台请求。
13. 一轮 assistant 原文在 Context/Haven 中仍是一条；普通聊天段可显示为多个气泡，代码、列表、表格和引用不被破坏。
14. 刷新、换设备和 Bark 使用同一份版本化分段，旧消息原文不因分段器升级而变化。
15. 主动 wake 的可见气泡按顺序推送；no-op、未落库消息和前台普通回复不推送。
16. Bark 重试不重复已成功分段，失败不影响聊天消息；key 不出现在浏览器、Context 或日志。
17. 每次正常用户 turn 结束后，沉默检查时间只采样并持久化一次，落在当前配置范围内；服务重启或任务重试不会重新抽样。
18. 沉默检查到点前收到用户回复时，不产生模型请求或 Context；到点仍无回复时，只触发一次 `conversation_silence` wake。
19. 沉默 wake 无论 no-op 还是主动追问，都不会继续自动安排下一次沉默检查；只有新的正常用户 turn 才能重新挂载。

## 14. 暂不实施

- selfhost 主动 wake。
- 同一窗口同时保活多条 CC lane。
- 夜间自动停机或延迟消息队列。
- WebSocket 实时后台消息。
- 新的自动 Context GC 策略。
- 允许后台自动批准 Bash、写文件或原本需要人工确认的 MCP。
- 把 Bark 暴露为 Claude MCP，或让模型承担通知发送与重试。
- 默认对普通前台问答发送 Bark。
