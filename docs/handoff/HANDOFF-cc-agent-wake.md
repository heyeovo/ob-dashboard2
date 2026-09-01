# HANDOFF — CC 缓存保活与 Claude 主动唤醒

> 建立时间：2026-08-31
> 最后更新：2026-09-02
> 仓库：`ob-dashboard2`、`Ombre-Brain-Haven`
> 状态：阶段 1–4 已完成；下一窗口只进入阶段 5

## 当前完成状态

- 产品决策与跨仓库实施方案仍以 `docs/cc-agent-wake-design.md` 为唯一事实源。
- 2026-09-02 已完成线上缓存异常修复：前台开启 WebSearch/WebFetch、后台 wake 删除两项工具定义，曾导致 A/B cache prefix 分叉。现在两项 schema 始终固定，前台关闭开关或后台 wake 均在运行时 hook 拒绝；cache fingerprint 日志可直接对照 system/tools/MCP/options hash、lane、CC session 和 iterator 冷热状态。
- No-op wake 现在允许在 `[agent_wake_noop]` 后带最多 30 字自然状态，后台只把状态显示为 wake 事件小字，不生成正式助手气泡；SDK 返回的 thinking 会持久化并折叠展示，事件名称使用当前协作者，token usage 复用普通消息的右下角角标与展开详情。`set_agent_wake` reason 上限为 50 字。
- 主动唤醒设置仍严格按 profile/session/lane 隔离；保活关闭时页面显示“未开启”，不会再把仅供计算的 deadline 表达成实际调度。
- 线上初测中 conversation silence 与 Claude 主动安排的 wake 都已连续命中正常缓存；用户将继续整晚观察 foreground → wake → foreground 的 cache read/write，当前不做 wake 100–500 token 级增量压缩。
- 阶段 1–3 的持久控制面、统一 turn、原子消息提交、silence timer、历史映射、分段气泡、主动唤醒设置 Tab 和页面增量刷新保持不变。
- 阶段 4 已接通 Haven Brain → Dashboard：
  - Brain 启动独立的 30 秒持久 scheduler，从 `gateway_state.db` 按 `due_at` 原子 claim，并用独立 Bearer token 调用 `/api/cc-agent-wake-runner`。
  - Dashboard 只有在同一 `SessionTurnCoordinator` 取得后台门禁后，才向 Haven 原子 begin run；busy、compacting、待审批、前台等待均直接 deferred，不请求模型、不产生假的 wake event。
  - Begin 同时校验 profile/session/lane、schedule version、lease 和 silence 来源 user turn；下一条用户消息、后续 user turn、旧 version 或失活 lane 都会使旧 callback 失效。
  - 已开始的后台 turn 不强停；用户 turn 排在其后。尚未开始时前台优先。
  - 相同 `wake_id` 已落库时直接回放；重复 callback 不重复模型请求或重复落消息。Dashboard/Haven 重启复用持久 due、run、wake id、lease 和绝对 silence 时间。
  - Lease 过期恢复复用同一 wake id；deferred 使用短延迟，失败使用持久指数退避，连续 5 次失败后暂停领取，错误保存在控制面。
  - Silence timer 只由正常用户 turn 成功提交时采样一次；用户回复可取消，silence wake 无论 no-op 或有正文都不会链式创建下一次 timer。
  - Agent schedule 在对应 wake 成功提交时一次性消费；Claude 同轮设置的新 schedule 不会被旧 callback 清除。Cache heartbeat 若没有 usage 确认 cache read/write，不伪造 refresh，并进入 cold，避免对过期 deadline 自旋。
  - 滚动 24 小时后台 turn 上限按整个窗口跨 lane 统计；达到上限时不请求模型，保存可见 `last_error`，并延后到最早额度释放时间。用户 turn 不计数。
  - 24 小时无用户活动时只暂停固定 keepalive、进入 cooling；未来 agent schedule 保留，下一条用户消息恢复持久保活。
  - 非最后活跃 lane 的旧 schedule 会进入 dormant；该 lane 再次收到正常用户 turn 时才重新计算 due，不扫描或同时保活其他 lane。

## 验证结果

- 2026-09-02 Dashboard 全量 Vitest：45 个测试文件，235 项通过、1 项跳过；`npm run build` 与 `git diff --check` 通过。未修改 Haven 代码或数据结构。
- 2026-09-02 no-op wake token 角标补丁：复用普通消息的 token 角标和展开详情；定向测试 19 项通过，Dashboard production build 与 `git diff --check` 通过。

- Haven 阶段 4 定向：47 项通过。
- Haven 全量 unittest：175 项全部通过。
- Dashboard 阶段 4 定向：12 项通过。
- Dashboard 全量 Vitest：229 项通过、1 项跳过、1 项既有失败。既有失败仍是 `tests/automation-pro-runner.test.ts` 期待旧 `append_content`，而当前既有实现使用 `revised_content`，与 agent wake 无关，本窗口未扩散修改。
- Dashboard `npm run build`：通过，包含 `/api/cc-agent-wake-runner`。
- 两仓库 `git diff --check`：通过。
- 首次线上验收曾出现 callback 401：原因是 Dashboard 登录代理的精确公开白名单漏掉 `/api/cc-agent-wake-runner`，请求未进入 route 自身的 Bearer 校验。现已补入精确根路径并增加回归测试；子路径仍受 Dashboard 登录保护。该修复只需重新部署 Dashboard。

## 部署前必须配置

- Haven Brain：
  - `OMBRE_AGENT_WAKE_RUNNER_URL=https://<Dashboard 域名>/api/cc-agent-wake-runner`
  - `OMBRE_AGENT_WAKE_RUNNER_TOKEN=<独立随机共享密钥>`
- Dashboard Application：
  - `OMBRE_AGENT_WAKE_RUNNER_TOKEN=<与 Brain 完全相同的共享密钥>`
- `compose.coolify.test.yml` 已把 URL/token 透传给 Brain。缺少任一变量时 scheduler 保持关闭，不创建内存替代计时器。
- 正式发布仍按项目规则：用户分别 commit + push；Dashboard 在 Coolify 部署；Haven 更新 `HAVEN_RELEASE_SHA` 为已验收完整 commit SHA 后 Restart/Deploy，并确认 Brain 与 Gateway 都恢复 `Running (healthy)`。

## 下一窗口范围：只做阶段 5

1. Haven 增加 profile 级 Bark 私密配置与持久 notification outbox。
2. 主动 wake 的可见 assistant 消息成功落库后，按已保存的 `display_segments` 生成幂等通知项。
3. Dashboard 增加通知配置与测试入口；“本窗口设置 → 主动唤醒”只增加窗口级 Bark 开关和最近状态。
4. 实现首条正常、后续较轻、默认 1 秒间隔、默认每轮最多 8 条的可调策略。
5. 实现 deep link、失败重试、重启恢复、敏感 key 脱敏和可选隐藏正文模式。

## 不得扩散的边界

- 不支持 selfhost wake，不同时保活多条 CC lane。
- 不增加夜间 03:00–09:00 策略，不做阶段 6 的真实 55 分钟成本实验。
- 不增加新的 Context GC 策略或 WebSocket。
- 不允许后台扩大 Bash、写文件或 MCP 批准权限。
- 阶段 5 不重写阶段 4 scheduler、coordinator、silence 或后台上限状态机；只在成功落库后的通知副作用上接 outbox。
