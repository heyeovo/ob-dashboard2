# HANDOFF — CC 缓存保活与 Claude 主动唤醒

> 建立时间：2026-08-31  
> 仓库：`ob-dashboard2`、`Ombre-Brain-Haven`  
> 状态：阶段 1–3 已完成；阶段 4–6 待实施

## 当前完成状态

- 产品决策与跨仓库实施方案仍以 `docs/cc-agent-wake-design.md` 为唯一事实源。
- Haven 阶段 1 已完成：
  - 新增 `agent_wake_store.py`，schedule/run 与 conversation 共用 `gateway_state.db`。
  - `agent_wake_schedules` 按 `profile_id + session_id + lane_id` 隔离，`due_at` 由双开关、暂停状态和两个时钟派生。
  - 已实现 schedule CRUD、版本 CAS、原子 due claim、lease 过期恢复、旧 run 失效和幂等 run 状态流转。
  - `conversation_turns` 新增兼容字段 `turn_kind`，旧数据默认 `user`。
  - 窗口永久删除会在同一事务内清理目标 profile/session 的 wake schedule/run，不影响其他窗口或 profile。
- Haven 阶段 1–3 的 wake/state 定向测试共 36 项全部通过。
- Haven 全量 unittest 本窗口执行到 139 项；除 2 项既有 skip 外，唯一未运行成功项因 bundled Python 缺少 `httpx`，在导入 `gateway.py` 时中断，与本次代码无关。
- Dashboard 阶段 2 已完成：
  - `SessionTurnCoordinator` 是前台用户 turn 与后台 wake 的统一进程内入口；已开始的后台 turn 不强停，排队中的前台优先于尚未开始的后台，后台遇到 busy、compacting 或待审批直接 deferred。
  - 两类 turn 共用 `ccSession.ts` 中同一个长寿命 Agent SDK iterator；`live.busy` 继续作为底层防并发保护。
  - 后台 runner 只从 Haven 恢复 `cc_overrides.active_cred` 对应的最后活跃 CC lane、该窗口 Persona、冻结 prompt 和 lane resume id；没有成功 CC resume 点的旧窗口不允许后台冷启动。
  - 固定进程内 `set_agent_wake` 已进入稳定 MCP 前缀，同轮最后一次有效 schedule/cancel 决定覆盖前一次。
  - 后台仅允许固定 wake 工具、自动允许 MCP 与受路径约束的只读工具；Bash、Edit、Write、NotebookEdit 和 ask/deny MCP 立即拒绝，不创建批准卡。
  - Cache refresh 仅在成功 result usage 确认 cache read/write 后更新，时间取真正送入模型前的请求开始时间；无 cache usage 不刷新倒计时。
- Dashboard 阶段 3 已完成：
  - agent wake 的可见消息、无正文结果、wake event、next wake、usage、cache refresh 和活动时间由同一次 Haven 严格提交原子落库；`set_agent_wake` 仍只以同轮最后一次有效决定生效。
  - `conversation_turns.raw_json` 保存版本化 `display_segments`；模型 Context/Haven assistant 原文仍是一轮一条，前端只按保存的 Markdown 语义段显示连续气泡，旧消息只在读取时兼容派生，不回写。
  - 历史映射显示 wake event、可选 assistant 正文和 next wake；页面可见且没有发送/载入历史时按 `after_round_id` 增量刷新，并在重新聚焦时立即刷新。
  - “本窗口设置”增加第 4 个 Tab“主动唤醒”，可管理双开关、暂停、下一次 wake、最短间隔、silence 范围和停止全部；后台次数上限只显示，阶段 4 才执行。
  - 正常用户 turn 成功提交时在同一事务只采样一次 silence timer；下一条用户消息进入模型前原子取消尚未触发的 timer；停止全部也清除 silence timer。
  - 阶段 3 Dashboard 定向 52 项测试全部通过，production build 通过。全量 Vitest 为 222 通过、1 跳过、1 个既有 `automation-pro-runner` 断言失败，与本阶段无关。
- 尚未接 Haven scheduler 回调、30 秒调度、lease 故障验证、后台次数上限执行或 Bark/outbox。

## 下一窗口范围

下一窗口只推进方案的“阶段 4：调度接通与故障验证”：

1. 接通 Haven scheduler 到 Dashboard 后台 runner，并把持久化 silence timer 纳入 due-time 执行；所有 wake 仍必须经过现有 `SessionTurnCoordinator`。
2. 验证 30 秒调度、重启恢复、重复回调、lease 过期、busy defer、用户碰撞、失败退避，以及 silence timer 不重采样、不漂移、不链式续挂。
3. 执行滚动 24 小时后台次数上限；只恢复最后活跃 CC lane，不扫描其他 lane。
4. 不接阶段 5 Bark/outbox，不做阶段 6 真实 55 分钟成本实验，不扩大后台工具批准权限。

开始阶段 4 前仍需按全局规则列出精确文件、修改内容与明确不改项，让用户确认后再动代码。

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
- 相同 `wake_id` 不重复创建 run；conversation event 已在阶段 3 与 turn/schedule 原子提交。
- 旧 conversation turn 默认仍按普通用户 turn 读取。
