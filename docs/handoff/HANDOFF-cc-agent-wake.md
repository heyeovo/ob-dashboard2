# HANDOFF — CC 缓存保活与 Claude 主动唤醒

> 建立时间：2026-08-31  
> 仓库：`ob-dashboard2`、`Ombre-Brain-Haven`  
> 状态：产品与技术方案已落盘，尚未实施

## 当前完成状态

- 已调查 Dashboard 的 Agent SDK 长会话、`busy` 串行边界、缓存统计、消息持久化和 Context GC scheduler。
- 已调查 Haven 的 conversation session/turn 持久层，以及现有 SQLite automation schedule、lease、过期恢复和 30 秒轮询基础。
- 已完成产品决策与跨仓库实施方案，唯一事实源见：
  - `docs/cc-agent-wake-design.md`
- 尚未修改任何运行代码、数据库结构或 UI。

## 下一窗口范围

只推进方案的“阶段 1：Haven 持久控制面”：

1. 在 Haven 增加会话/lane 级 wake schedule 与 wake run 持久化。
2. 为 conversation turn 增加兼容的 `turn_kind`。
3. 实现 schedule CRUD、due claim、lease、CAS 和幂等契约测试。
4. 不接 Dashboard 模型执行、不做前端 UI、不改 Context GC 行为。

开始实施前仍需按全局规则列出精确文件与修改清单，让用户确认后再动代码。

## 不得扩散的边界

- 不支持 selfhost wake。
- 不同时保活多条 CC lane。
- 不增加夜间 03:00–09:00 停机规则。
- 不允许后台扩大 Bash、写文件或 MCP 权限。
- 不把后续阶段提前塞进 Haven 阶段 1。

## 阶段 1 验收

- 新库、旧库升级和重复初始化均成功。
- `profile_id + session_id + lane_id` 隔离成立。
- 相同到期 schedule 只能被一个 owner claim。
- lease 过期后可以恢复；schedule version 变化后旧回调失效。
- 相同 `wake_id` 不重复创建运行或会话事件。
- 旧 conversation turn 默认仍按普通用户 turn 读取。

