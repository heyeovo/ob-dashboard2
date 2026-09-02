# HANDOFF — CC 缓存保活与 Claude 主动唤醒

> 建立时间：2026-08-31
> 最后更新：2026-09-02
> 仓库：`ob-dashboard2`、`Ombre-Brain-Haven`
> 状态：阶段 1–5 已完成；Bark HTTP 400 已解决，阶段 6 尚未开始

## 当前完成状态

- 产品决策与跨仓库实施方案仍以 `docs/cc-agent-wake-design.md` 为唯一事实源。
- 2026-09-02 已完成阶段 5 Bark：Haven 新增 profile 级私密配置、持久 notification outbox 和独立 worker；只有带正式 `assistant_text` 的 agent wake 在消息同一事务内按已保存 `display_segments` 入队，no-op、普通前台回复、失败和幂等重放不重复推送。
- Bark 首段固定 `active`、后续固定 `passive`，默认间隔 1 秒、每轮最多 8 条且两项可调；超限最后一条提示打开会话。Outbox 使用 `profile_id + turn_id + segment_index + splitter_version` 唯一键、持久 lease、固定指数退避和 8 次最终失败上限，重启后恢复，通知失败不回滚聊天。
- Bark server、device key、可选 16 字节 AES-128-CBC key、隐藏正文、Dashboard 地址和分段策略按 profile 存在 Haven `gateway_state.db`；浏览器只收到掩码。每条加密通知使用随机 IV，真实 key 不进入 outbox、Claude Context、MCP、浏览器存储或日志。
- Dashboard 新增“设置 → 通知”、测试推送和最近状态；“本窗口设置 → 主动唤醒”只增加当前 scope 的 Bark 开关及最近状态。通知 deep link 使用 `/cc?session_id=...` 并能直接恢复对应窗口。
- 2026-09-02 Bark 首次线上测试曾返回 `HTTP 400`，用户已解决；该问题不再是当前阻塞项，不继续排查。
- Dashboard 通知设置页已在本地补充固定底部 Tab 与 iPhone safe area 留白，解决手机端“保存设置”按钮被 Tab 遮挡；`git diff --check` 与 `npm run build` 已通过，等待用户提交、推送并重新部署 Dashboard。
- 2026-09-02 已完成线上缓存异常修复：前台开启 WebSearch/WebFetch、后台 wake 删除两项工具定义，曾导致 A/B cache prefix 分叉。现在两项 schema 始终固定，前台关闭开关或后台 wake 均在运行时 hook 拒绝；cache fingerprint 日志可直接对照 system/tools/MCP/options hash、lane、CC session 和 iterator 冷热状态。
- No-op wake 允许在 `[agent_wake_noop]` 后带最多 30 字用户可见 skip reason；它不是 `set_agent_wake` 参数。解析、写库和历史映射链已存在，本轮进一步把精确格式与示例同时写进 MCP instructions 和始终加载的工具描述，避免 Claude 只看 schedule/cancel 参数而不知道 marker 后可附带文字。wake UI 将可选原因显示为“这次没有发消息”，SDK thinking 独立折叠并明确标注为 Claude 的真实思考，token usage 位于整组右下角并独立展开。`set_agent_wake` reason 上限为 50 字。
- 本轮修改了始终加载的 agent wake MCP instructions/工具描述，因此 Dashboard 部署后的第一轮会建立一次新的稳定缓存前缀；该次 cache miss 属于预期。缓存异常调查必须比较同一部署版本建立新前缀之后的连续轮次，不得拿部署前后的 tools/MCP hash 直接判定为再次失效。
- 2026-09-02 第二次缓存异常已定点到 `ob2-20260901-c7s6jz` round 71：round 70（07:24:50）读 35,354 / 写 95，round 71（08:19:58）读 18,272 / 写 17,267，间隔仅 55 分 08 秒；三轮均为 subscription lane、Opus 4.6、`cache_keepalive`、输入 3 / 输出 11 的 no-op。失去的是约 17k 的后半段 1h session/transcript prefix，前 18,272 的 system/tools prefix 仍命中，5m 写入为 0；下一轮已恢复。历史 raw 未保存当时 iterator/hash/CC session，旧 Coolify 日志也已消失，因此只能把原因收窄到 cold resume 后 transcript 漂移或 Anthropic 单次 cache unavailable，不能事后强行二选一。
- Dashboard 已为后续轮次增加持久 `raw_json.cache_diagnostic` 黑匣子：保存 Dashboard 进程实例、模型请求开始时间、lane、CC session、resume hint、iterator 的 `reused/cold_resumed/cold_started`、system/tools/MCP/options hash 及工具/MCP 名称。该对象不含 prompt 正文、密钥，不进入 Claude Context，也不改变前端展示；foreground 与 background wake 都保存，不需要依赖 Coolify 历史日志。
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

- 2026-09-02 阶段 5 Haven 定向：56 项通过；Haven 全量 unittest：184 项全部通过。当前本机 Haven venv 未安装 pytest，因此按项目既有 unittest discover 全量入口执行。
- 2026-09-02 阶段 5 Dashboard 定向：8 项通过；全量 Vitest：47 个测试文件、241 项通过、1 项跳过；production build 通过并包含 `/api/cc-notifications` 与 `/settings/notifications`。
- 2026-09-02 阶段 5 两仓库 `git diff --check` 通过；Dashboard build 首次因沙箱无法连接 Google Fonts 失败，允许联网后同一最终代码重跑通过。

- 2026-09-02 Dashboard 全量 Vitest：45 个测试文件，235 项通过、1 项跳过；`npm run build` 与 `git diff --check` 通过。未修改 Haven 代码或数据结构。
- 2026-09-02 no-op wake token 角标补丁：复用普通消息的 token 角标和展开详情；定向测试 19 项通过，Dashboard production build 与 `git diff --check` 通过。
- 2026-09-02 wake UI 分层与 noop skip reason 展示：定向 Vitest 24 项通过；Dashboard 全量 Vitest 47 个文件、242 项通过、1 项跳过；production build 通过。未修改 Haven、scheduler、silence、cache、coordinator 或 lane 状态机，阶段 6 未开始。
- 2026-09-02 cache diagnostic 黑匣子：Dashboard 全量 Vitest 47 个文件、243 项通过、1 项跳过；production build 与 `git diff --check` 通过。首次全量运行仅有既有 `dashboard-auth` 随机 token 尾字符用例偶发失败，单测与第二次全量复跑均通过。本补丁只增加 raw 诊断持久化与测试，不修改前端展示、Haven、缓存策略或状态机。

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

## 下一步

1. 用户提交并推送 Dashboard，在 Coolify 的 Dashboard Application 点击 `Redeploy`；本轮没有 Haven 改动，不部署 Haven。
2. 手机刷新 `/cc`，查看一条已有或新产生的 no-op wake：轻量事件、可选“这次没有发消息”原因、独立 thinking 折叠区和右下角 token 应分层显示；裸 marker 不应出现空状态行。
3. 等待后续真实 no-op 样本，确认 Claude 是否主动附带 30 字内自然状态；完整功能链已经存在，不为强制出现短文本修改 prompt 或后端。
4. 后续再出现缓存异常时，不要求用户记参数或翻 Coolify 日志。由排查助手读取本节“缓存诊断查看方法”，从对应消息的 `raw_json.cache_diagnostic` 与 `usage` 比较相邻三轮；先确认样本发生在本次 MCP 文案部署之前还是之后，部署后的首轮预期建立新前缀，不算异常。
5. 当前仍不调整 10 分钟 iterator 闲置回收策略；它使约 55 分钟 wake 通常走 `cold_resumed`，但多数冷恢复仍正常命中，尚不足以证明它就是 round 71 单轮 miss 的根因。不要顺手改 scheduler、silence、coordinator、lane 状态机或后台权限，也不要开始阶段 6 的真实 55 分钟成本实验。

## 缓存诊断查看方法（给后续排查窗口）

用户不需要记网址。排查助手根据 session id 自己生成 Dashboard 同源只读地址：

```text
/api/cc-turns?session_id=<session_id>&limit=<N>&raw=1
```

- 异常刚发生、仍在会话末尾：用较小的 `limit` 直接取最后几轮。
- 异常已被后续消息埋住：先用不带 `raw=1` 的 `limit=20` 页面，从第一条数据库 `id` 继续传 `before_id=<id>` 向前分页；定位准确 round 后，用 `before_id=<目标最后一轮数据库 id + 1>&limit=<轮数>&raw=1` 只取目标范围。不要把 `round_id` 当数据库 `id`，也不要假设 `after_round_id + limit` 会从指定轮次向后取；现有 Haven 查询会返回符合条件的最新一页。
- 每次至少比较异常前一轮、异常轮、恢复轮的 `created_at`、`usage` 和 `cache_diagnostic`。

判断顺序：

1. `dashboard_instance_id` 变化：Dashboard 重部署、进程或 worker 切换。
2. `lane` / `cc_session_id` / `resume_hint` 变化：线路、原生 CC session 或 resume point 切换。
3. `iterator` 变化：区分 `reused`、`cold_resumed`、`cold_started`；结合 `iterator_created_at` 判断 query 是否重建。
4. `system_hash` / `tools_hash` / `mcp_hash` / `options_hash`：定位稳定前缀的哪一层发生变化；工具/MCP 名称用于解释 hash 差异。
5. 用 `model_request_started_at` 计算相邻请求是否越过 cache TTL，不能用回复落库时间代替。
6. 若上述字段全部相同、未越过 TTL，但 cache read 突降并发生对应 write，则优先考虑 SDK 未暴露的 transcript 字节差异或 Anthropic 单次 cache unavailable；现有 Agent SDK 没有暴露官方 `previous_message_id/cache_miss_reason`，不要无证据硬判。

## 不得扩散的边界

- 不支持 selfhost wake，不同时保活多条 CC lane。
- 不增加夜间 03:00–09:00 策略，不做阶段 6 的真实 55 分钟成本实验。
- 不增加新的 Context GC 策略或 WebSocket。
- 不允许后台扩大 Bash、写文件或 MCP 批准权限。
- 阶段 5 不重写阶段 4 scheduler、coordinator、silence 或后台上限状态机；只在成功落库后的通知副作用上接 outbox。
