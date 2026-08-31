# HANDOFF — CC 缓存保活与 Claude 主动唤醒

> 建立时间：2026-08-31  
> 仓库：`ob-dashboard2`、`Ombre-Brain-Haven`  
> 状态：阶段 1 Haven 持久控制面已完成；消息气泡拆分与 Bark 已纳入后续方案；阶段 2–6 待实施

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
- 尚未接 Dashboard 模型执行、Haven scheduler 回调或前端 UI。
- 后续方案新增“assistant 普通聊天分气泡 + Bark 分段通知”：模型 Context/Haven 原文仍保持一轮一条；版本化 `display_segments` 只服务前端与通知。Bark 在主动消息落库后由持久 outbox 发送，不作为 Claude MCP。完整规则只见主方案第 10.4、10.5 节。

## 下一窗口范围

只推进方案的“阶段 2：Dashboard 后台 turn”：

1. 抽出用户 turn / wake 共用的 `SessionTurnCoordinator`，保持前台高优先级和单 SDK iterator 串行。
2. 从 Haven 还原当前最后活跃 CC lane、Persona、冻结 prompt 与 resume id。
3. 加入固定进程内 `set_agent_wake` 工具及后台权限策略，但暂不做前端 UI。
4. 修正 cache refresh 只在 usage 确认 cache read/write 后按请求开始时间记账。
5. 不提前接阶段 3 的消息展示/UI，也不接阶段 4 的 Haven scheduler 回调。

开始实施前仍需按全局规则重新列出精确文件与修改清单，让用户确认后再动代码。

## 不得扩散的边界

- 不支持 selfhost wake。
- 不同时保活多条 CC lane。
- 不增加夜间 03:00–09:00 停机规则。
- 不允许后台扩大 Bash、写文件或 MCP 权限。
- 不在阶段 2 提前实现前端气泡、Bark 配置或 notification outbox；它们分别属于阶段 3 和阶段 5。

## 阶段 1 验收（已完成）

- 新库、旧库升级和重复初始化均成功。
- `profile_id + session_id + lane_id` 隔离成立。
- 相同到期 schedule 只能被一个 owner claim。
- lease 过期后可以恢复；schedule version 变化后旧回调失效。
- 相同 `wake_id` 不重复创建 run；conversation event 的原子创建归阶段 3。
- 旧 conversation turn 默认仍按普通用户 turn 读取。
