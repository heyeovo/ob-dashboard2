# HANDOFF：主动唤醒多闹钟

> 2026-10-02 CC 写规格，用户已定：上限 5 条；窗口设置只显示最近一条 + 「共 N 条」。OB Todo `362f0f178d764364`。Codex 执行、CC 验收；动两个仓库，分支都叫 `feat/wake-multi`。

## 一、问题

每个窗口只有一格闹钟：Haven `agent_wake_schedules.next_agent_wake_at` / `wake_reason` 各一个值，`set_agent_wake(schedule)` 覆盖旧值，同一轮里也是最后一次调用生效。已经定了零点的闹钟，就没法再定一个二十分钟后的（例：房间锁三分钟，想到期醒来开门）。

followup（她没回才醒）是另一格，语义不变，**不在本次范围**。

## 二、原则

- `next_agent_wake_at` / `wake_reason` **保留，改为派生镜像**：永远等于最早一条闹钟的时间和原因，没有闹钟时为空。`_computed_due_at`、`_cause`、claim、lease、版本 CAS、scheduler 一律不改，只换数据来源。
- 本轮的闹钟操作仍和现在一样：工具调用只记在轮次内存里，**随轮次保存在 Haven 同一事务里落库**（`gateway_state.py` 现在处理 `wake_decision` 的位置）。轮次失败 = 操作不生效。

## 三、Haven

### 1. 表

`gateway_state.db` 新表 `agent_wake_alarms`：`profile_id, session_id, lane_id, alarm_id, at, reason, source_turn_id, created_at`，主键 `(profile_id, session_id, lane_id, alarm_id)`，`at` 建索引。建表放在 `initialize_agent_wake_schema`。

- 启动迁移：已有非空 `next_agent_wake_at` 的 schedule 转成一条闹钟（`alarm_id` 用 `w_` + 6 位随机），幂等（该 scope 已有闹钟就跳过）。
- 镜像重算函数 `_sync_alarm_mirror(conn, scope)`：取该 scope 最早一条写回 `next_agent_wake_at` / `wake_reason`，再走现有 due_at 计算。所有改闹钟的地方改完都调它。
- `delete_agent_wake_session_records`（软删除窗口）同时删闹钟。
- schedule payload（GET / PATCH 返回、轮次开始读取的那份）加 `alarms: [{alarm_id, at, reason}]`，按 `at` 升序。

### 2. 轮次保存时应用操作

`wake_decision`（单个对象）改为 `wake_ops`（数组，按调用顺序），旧字段兼容一版：

| op | 行为 |
|---|---|
| `{action:'schedule', alarm_id, at, reason}` | 插入；`agent_wake_enabled` 关着时忽略（同现在） |
| `{action:'cancel', alarm_id}` | 删这一条，不存在就忽略 |
| `{action:'cancel'}`（无 id） | 删全部闹钟 + 清 followup（同现在的 cancel） |
| `{action:'followup', at, reason}` | 同现在 |

应用完 > 5 条时按 `at` 保留最早 5 条（dashboard 已经挡过，这里是兜底）。turn `raw_json` 里 `next_wake` 改记 `wake_ops`（只记 schedule / cancel / followup 的 at 与 reason，供前端显示）；历史里的旧 `next_wake` 前端照旧能读。

### 3. 响铃与消耗

- claim 时（`claim_due_schedule` 建 run 那里），若 `_cause` 为 `agent_schedule`：把该 scope 内 `at <= now` 的闹钟 id 存进 run 新列 `fired_alarm_ids`（JSON 数组），原因按时间顺序用「；」拼起来存 run 新列 `reason`。recovered run 沿用原值。
- scheduler 发给 dashboard 的 `reason` 改读 run 的 `reason`（现在读的是 `schedule.wake_reason`）。另加 `pending_alarms`：claim 时未到期的其余闹钟 `[{alarm_id, at, reason}]`。
- wake 轮次保存时（现在 `wake_cause == 'agent_schedule' and wake_at == next_agent_wake_at` 清空的那段）改为：删除该 run 的 `fired_alarm_ids`，再重算镜像。失败 / deferred 不删，闹钟留着下次再响（同现在）。
- 现有 `PATCH next_agent_wake_at = ''`（设置页「取消」、登录失效暂停）语义 = 删全部闹钟。PATCH 非空值 = 清空后只留这一条（旧行为兼容，目前无调用方）。

## 四、dashboard

### 1. 工具 `set_agent_wake`（`app/lib/cc/agentWakeTool.ts`）

- 输入加 `alarm_id`（可选），action 加 `list`。`AGENT_WAKE_MCP_VERSION` 升到 `1.3.0`（模型表面变化，换版后首轮缓存会写一次，正常）。
- 轮次开始 `beginAgentWakeTurn` 收下 schedule 里的 `alarms`；轮次状态改为「已有闹钟 + 本轮 ops」。`endAgentWakeTurn` 返回 ops 数组。
- `schedule`：在 dashboard 生成 `alarm_id`（`w_` + 6 位随机，和已有不重复），追加；时间校验同现在（`agent_wake_min_minutes`、7 天上限、reason ≤ 50）；合并后 > 5 条报错「最多同时挂 5 个闹钟，先取消一个」。
- `cancel` 带 `alarm_id`：只取消那条，id 不存在报错；不带：全部取消（同现在）。
- `followup`：同现在，同一轮最后一次生效。
- 每次调用（含 `list`）的工具结果都列出**本轮操作后**的全部闹钟，一行一条：`w_xxxxxx · 10-02 21:00 · 原因`，最后一行写 followup（有的话）。时间按北京时间显示。

### 2. 醒来时的提示

`backgroundWakeTurn.ts` 的 `<agent_wake …/>` 保持现在的属性（`reason` 现在可能是多条拼起来的）。有 `pending_alarms` 时在标签后加一行：`还挂着的闹钟：w_xxx 21:00 叫她吃药；w_yyy 10-03 08:30 叫她起床`。没有就不加，避免平白多 token。

### 3. 默认说明文字（`agentWakePrompt.ts`）

- 工具说明：删「同一轮里最后一次调用生效」，改为「schedule 是加一个闹钟，最多同时 5 个，可以多次调用；cancel 带 alarm_id 只取消那一个，不带取消全部（含 followup）；list 看现在挂着哪些」。
- 醒来说明里 `- cancel：取消所有已安排的 wake 和 followup。` 同步改。
- 用户如果在提示词页自定义过这两段，不覆盖（现有逻辑）。

### 4. 前端显示

- 聊天消息下的「↳ 下次唤醒 HH:mm · 原因」：改读 `wake_ops`，每条 schedule 一行「↳ 闹钟 HH:mm · 原因」，取消一行「↳ 取消闹钟 HH:mm」/「↳ 取消全部闹钟」，followup 同现在。旧历史只有 `next_wake` 的照旧显示。
- `CcAgentWakeSettings`「Claude 安排的下一次 wake」：最近一条 + 有多条时后面加 `· 共 N 条`；按钮文字改「取消全部闹钟」（走现有 `cancel_next`）。不做列表。

## 五、不做

- followup 多条。
- 设置页逐条管理闹钟。
- 改 `agent_wake_min_minutes` 等时间策略。

## 六、测试与验收

- Haven 单测：迁移（旧单值 → 一条，幂等）；ops 顺序应用（加两条、按 id 取消一条、无 id 全取消含 followup）；镜像始终是最早一条；超 5 条兜底；claim 记录 `fired_alarm_ids` 与拼接原因，两条同一分钟合并为一次；wake 成功只删已响的、失败不删；新加闹钟导致 schedule_version 变化后旧 run 被拒（现有 CAS 不回归）；PATCH 空值删全部；软删除删闹钟。
- dashboard 单测：一轮内多次 schedule 全部生效；第 6 条报错；按 id 取消 / 不存在报错；`list` 输出；工具结果按北京时间；醒来提示带 / 不带 pending 行；消息下显示读 `wake_ops` 与旧 `next_wake`。
- 全量：dashboard Vitest + `npm run build`，Haven pytest。
- CC 线上实测：主窗一轮内定两个闹钟（如 10 分钟后、15 分钟后）→ 设置页显示最近一条「共 2 条」→ 第一条响、我能看到还挂着第二条 → 第二条响；再定两条后按 id 取消一条，只剩一条；旧窗口原有的单个闹钟迁移后仍会响。

## 七、文档同步

dashboard `docs/reference.md`「cc 数据持久化契约」唤醒条：多闹钟、镜像、ops 随轮次落库。Haven `docs/reference.md`：`agent_wake_store` 行与 cc 持久化节加闹钟表；REST 不新增路由，`/gateway/api/conversation/agent-wake` 返回加 `alarms`。完成后更新 `docs/handoff/README.md` 本行。

## 实施交接（2026-10-02 Codex）

两仓库均从当时最新 main 创建 `feat/wake-multi`；功能和第六节单测已实现，两端正式契约及 Haven README 已同步。只提交并推功能分支，不合并 main、不部署；状态为待 CC 验收。完成验收后再勾 OB Todo `362f0f178d764364` 并归档索引。

验证：dashboard `npm run build` 通过；全量 Vitest 最终 463 passed / 5 failed / 0 skipped。四个失败为 Windows symlink EPERM：

- `tests/artifacts.test.ts` → `lists newest first and ignores symlinks and other files`
- `tests/cc-dirs.test.ts` → `拒绝文件 symlink 逃出根目录`
- `tests/cc-dirs.test.ts` → `工作模式内置 yanzhi files 目录；闲聊、未挂载和 symlink 挂载点都不加`
- `tests/room-b.test.ts` → `rejects symbolic links in the room file path`

遵照不跳过要求，移除了 cc-dirs 文件逃逸用例原有的 Windows skipIf。第五个失败是既有 `tests/dashboard-proxy.test.ts` → `accepts a valid session and rejects forged, expired, and retired plaintext cookies` 的末位篡改偶发问题（已有技术债 T-01）；此前一次全量及单独复测通过，最终全量再次失败。未改登录逻辑，需 CC 在 Linux 全量检查结果中核对。Haven 全量 pytest：267 passed，4 subtests passed。

实施时补充的兼容决定：`pending_alarms` 也持久为 run 快照，恢复时沿用；升级前未完成的旧 run 在首次新增列迁移中补齐已响 ID、原因和剩余闹钟快照；无持久 run 的旧 caller 仍仅消耗与 wake_at 相等的闹钟。对应回归测试已覆盖，claim/lease/CAS/调度算法未改。

下一步仅由 CC 执行第六节线上多闹钟及旧窗口迁移实测、Linux 全量测试，然后验收合并两分支。边界继续为最多 5 条、followup 单条、设置只显示最近一条及数量；不扩大到逐条设置管理或时间策略修改。
