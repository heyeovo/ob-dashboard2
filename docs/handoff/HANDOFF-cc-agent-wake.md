# HANDOFF — CC 缓存保活与 Claude 主动唤醒

> 建立时间：2026-08-31  
> 仓库：`ob-dashboard2`、`Ombre-Brain-Haven`  
> 状态：阶段 1 Haven 持久控制面与阶段 2 Dashboard 后台 turn 已完成；阶段 3–6 待实施

## 当前完成状态

- 产品决策与跨仓库实施方案仍以 `docs/cc-agent-wake-design.md` 为唯一事实源。
- Haven 阶段 1 已完成：
  - 新增 `agent_wake_store.py`，schedule/run 与 conversation 共用 `gateway_state.db`。
  - `agent_wake_schedules` 按 `profile_id + session_id + lane_id` 隔离，`due_at` 由双开关、暂停状态和两个时钟派生。
  - 已实现 schedule CRUD、版本 CAS、原子 due claim、lease 过期恢复、旧 run 失效和幂等 run 状态流转。
  - `conversation_turns` 新增兼容字段 `turn_kind`，旧数据默认 `user`。
  - 窗口永久删除会在同一事务内清理目标 profile/session 的 wake schedule/run，不影响其他窗口或 profile。
- 新增 7 个 wake 持久化契约测试，并扩充 Gateway migration/delete 契约；相关 31 项测试全部通过。
- Haven 全量 unittest 共发现 134 项；除 2 项既有 skip 外，唯一未运行成功项因当前 bundled Python 缺少 `httpx`，在导入 `gateway.py` 时中断，与本次代码无关。
- Dashboard 阶段 2 已完成：
  - `SessionTurnCoordinator` 是前台用户 turn 与后台 wake 的统一进程内入口；已开始的后台 turn 不强停，排队中的前台优先于尚未开始的后台，后台遇到 busy、compacting 或待审批直接 deferred。
  - 两类 turn 共用 `ccSession.ts` 中同一个长寿命 Agent SDK iterator；`live.busy` 继续作为底层防并发保护。
  - 后台 runner 只从 Haven 恢复 `cc_overrides.active_cred` 对应的最后活跃 CC lane、该窗口 Persona、冻结 prompt 和 lane resume id；没有成功 CC resume 点的旧窗口不允许后台冷启动。
  - 固定进程内 `set_agent_wake` 已进入稳定 MCP 前缀，同轮最后一次有效 schedule/cancel 决定覆盖前一次；阶段 2 只返回 turn-local 决定，不写 Haven schedule。
  - 后台仅允许固定 wake 工具、自动允许 MCP 与受路径约束的只读工具；Bash、Edit、Write、NotebookEdit 和 ask/deny MCP 立即拒绝，不创建批准卡。
  - Cache refresh 仅在成功 result usage 确认 cache read/write 后更新，时间取真正送入模型前的请求开始时间；无 cache usage 不刷新倒计时。
  - 定向 37 项测试全部通过，Dashboard production build 通过。全量 Vitest 为 214 通过、1 跳过、1 个既有 `automation-pro-runner` 断言失败，与本阶段无关。
- 尚未接 wake 消息原子持久化、Haven scheduler 回调或前端 UI。
- 后续方案新增“assistant 普通聊天分气泡 + Bark 分段通知”：模型 Context/Haven 原文仍保持一轮一条；版本化 `display_segments` 只服务前端与通知。Bark 在主动消息落库后由持久 outbox 发送，不作为 Claude MCP。完整规则只见主方案第 10.4、10.5 节。
- 后续方案新增应用层“条件性沉默检查”：正常用户 turn 完成后，在可动态配置的范围内随机采样一次（首版默认 8–25 分钟、偏向 12–16 分钟）并持久化；用户提前回复则零模型成本取消，到点仍无回复才触发一次 `conversation_silence` wake，且不会自行链式重复。兼容字段归阶段 3，调度执行与故障验证归阶段 4。

## 下一窗口范围

下一窗口只推进方案的“阶段 3：消息持久化与前端”：

1. 将 agent wake turn、可见/无正文结果、next wake 决定与活动时间按方案原子写入 Haven；阶段 2 的 `RunTurnResult` 已提供 assistant text、usage、cache refresh 与 turn-local wake decision 接口。
2. 增加 wake event / next wake 的历史映射、版本化 `display_segments` 与“本窗口设置 → 主动唤醒”第 4 个 Tab。
3. 正常用户 turn 成功提交后只采样一次并持久化 conversation silence timer；下一条用户消息进入时原子取消尚未触发的 timer。
4. 页面可见且空闲时增量刷新后台消息。
5. 不提前接阶段 4 的 Haven scheduler/30 秒回调，不接阶段 5 Bark，不做真实 55 分钟实验。

开始实施前仍需按全局规则重新列出精确文件与修改清单，让用户确认后再动代码。

## 不得扩散的边界

- 不支持 selfhost wake。
- 不同时保活多条 CC lane。
- 不增加夜间 03:00–09:00 停机规则。
- 不允许后台扩大 Bash、写文件或 MCP 权限。
- 前端气泡与 wake UI 只归阶段 3，Bark 配置和 notification outbox 只归阶段 5。
- 沉默检查持久化只归阶段 3，Scheduler 执行只归阶段 4；后续接入必须继续经过当前单会话 coordinator。

## 阶段 1 验收（已完成）

- 新库、旧库升级和重复初始化均成功。
- `profile_id + session_id + lane_id` 隔离成立。
- 相同到期 schedule 只能被一个 owner claim。
- lease 过期后可以恢复；schedule version 变化后旧回调失效。
- 相同 `wake_id` 不重复创建 run；conversation event 的原子创建归阶段 3。
- 旧 conversation turn 默认仍按普通用户 turn 读取。
