# CC 自动聊天切片摘要实施方案

## 当前状态

- 阶段一“数据契约与幂等/失效”已于 2026-09-12 完成；用户已确认其验收 commit 通过 `HAVEN_RELEASE_SHA` 部署成功，并人工报告 Coolify 中 Brain、Gateway 的真实状态均健康。当前 handoff 未获得该线上 SHA 的具体值，不用本地 commit 反推。
- 阶段二“离线生成与人工检查”已于 2026-09-12 在本地完成代码、测试、Dashboard build 和隔离的手机点击验收；尚未 commit、push 或部署。
- 当前已经有联合日回顾/切片生成、slice-only 恢复、raw 退出排队、任务状态/额度估算、人工检查 REST 与 Dashboard 页面。开发与验收没有调用真实摘要模型、没有生成 embedding、没有执行任何真实日期或历史 backfill，也没有接入召回或正式 Context。
- 前置的 CC 按天滚动上下文、手机对话列表、每协作者唯一主窗、软删除修正、真实删除计数/分页和固定模式切换警告均已按 Haven → Dashboard 顺序部署，并完成手机点击验收。
- 本文件是自动聊天切片摘要的唯一阶段计划与交接事实源；滚动上下文的既有事实继续维护在 `HANDOFF-cc-daily-rolling-context.md`。
- 阶段一功能 bug 已在 Dashboard 本地修复：手机“新对话”恢复旧弹窗；滚动原文改为以 SDK transcript seed + resume 恢复真实 `user/assistant` 对话流，assistant-only 主动唤醒按隐藏 wake 输入 → 原 assistant 消息还原。此前 `shouldQuery=false` 推送 assistant 会触发 SDK role 错误的路径已删除；store-backed 恢复也已按 SDK 约束关闭与其互斥的文件 checkpoint，固定窗口不受影响；尚未部署。该修复不修改自动切片代码。完成 Dashboard 部署与真实输入检查后，再决定阶段二部署及少量真实日期人工检查；首次历史回填仍必须先展示额度估算并获得用户明确确认。

## 一、目标

在不改变现有手动桶体系的前提下，把 CC 聊天按自然话题或事件切成更局部、更省 token 的第一人称摘要，用于补足没有手动存桶的生活细节。

切片需要满足：

- 能从永久 message ID 回查准确原文。
- 能重复执行而不产生重复数据。
- 能在 Prompt、模型、原文或切片边界变化时安全重建并保留追溯。
- 能按滚动上下文的 `原文 / 日回顾 / 不带` 状态动态决定召回资格。
- 先离线生成和人工检查，再做不注入 Context 的影子召回，最后才考虑正式接入。

## 二、不可扩散的边界

- 不把切片写入现有桶表或桶文件。
- 不修改手动桶的生成、评分、合并、存桶、关系边或正式单卡召回流程。
- 不把不同 `session_id` 的消息合并成一个切片，也不把所有 session 合成一个长期窗口。
- 设计和影子观察稳定前，不把切片注入正式聊天 Context。
- 不用自动切片替代日回顾、手动桶、旧 handoff、Context GC 或独立测试窗口。
- 不在正式聊天召回过程中临时调用模型生成或重切切片。
- 第一版不处理旧消息编辑/重新生成；数据契约只预留原文变化后的失效能力。

## 三、已确认的产品决定

### 3.1 切片单位与边界

- 生成与重切片的最小原子范围是 `profile_id + persona_id + session_id + chat_day`。
- `chat_day` 由 CC 统一的聊天日计算规则产生，切片系统不自行重新判断日界线。
- 当前固定日界线（默认北京时间 04:00）下，消息保存时即可确定 `chat_day`。
- 将来若实现“凌晨 03:00 后沉默超过 1 小时才结束当天”，应由聊天日计算器锁定日期；切片只处理已经结束并锁定的聊天日，同时记录 `chat_day_rule_version`。
- 一个切片不得跨 `session_id` 或 `chat_day`。同一事件跨日继续时，拆成两个切片。
- 每个切片的 source 是同一 session、同一 chat day 内的一段连续永久消息范围。相邻切片的 canonical source 不重叠。
- 自然边界优先由话题转换、事件结束、明显时间跳转和长时间沉默决定；只有输入过长时才用安全上限强制拆分，并记录 `boundary_reason=length_limit`。
- 不要求每天或每个 session 必须生成切片；没有长期回忆价值时允许生成 0 条。

### 3.2 内容范围与写作视角

- 保留真实事件、感受、关系互动、偏好变化、决定、计划及结果。
- 纯代码过程、工具输出、普通问答、寒暄和助手泛泛建议不生成切片。
- 技术工作如果体现用户的压力、成就、选择或项目阶段，可以记录这些个人意义，但不复述执行日志。
- 第一人称固定指 profile 所属用户的视角；助手正文只用于理解指代和事件发展，不得把助手推测写成用户事实。
- 摘要使用自然的一小段第一人称文字，允许情绪、态度和个人视角，不写成僵硬标签堆。
- 输入只包含最终可见的 user/assistant 正文及附件的可见解析内容；不包含隐藏 thinking、系统 Prompt、工具调用日志或报错堆栈。

### 3.3 日回顾联合生成

- 正常向前生成时，优先复用现有每日回顾读取当天全部聊天材料的离线环节。
- 模型一次读取按 session 分组的当天材料，同时返回“全日回顾 + 各 session 独立切片”，减少重复输入 token。
- 日回顾可以综合同一 persona 当天的多个窗口；切片输出必须按 `session_id` 隔离。
- 两类产物共享当天 `daily_source_snapshot_hash`，但各自具有独立的 Prompt 版本、生成版本、内容 hash、校验、保存和重试状态。
- 日回顾成功而切片失败时只重试切片；切片成功而日回顾失败时只重试日回顾。
- 重跑切片不得覆盖已经生成或人工修改过的日回顾。
- 日回顾被关闭、跳过或生成失败时，切片仍能由独立恢复任务或人工入口生成。

### 3.4 人工检查与召回观察

- 不要求逐条审批。未检查但系统有效的切片可以参加影子召回；人工拒绝的切片立即退出资格。
- Dashboard 提供独立的按日期切片检查入口：桌面左侧日期列表、右侧当天切片；手机先看日期列表，点入日期后查看切片。
- 同一天来自多个 session 的切片在右侧按 session 分组展示，不混为一个切片。
- 人工动作第一版包括：标记正确、标记有问题、选择问题原因、填写备注、重新生成；第一版不直接编辑正文。
- 召回效果观察接入现有“工作台 → 调参 → 召回透镜”，新增自动切片线路和最终组合视图，不另建第二套召回调试页。

### 3.5 历史处理

- 默认从功能启用日向前自动生成，不一次性处理从 4 月至今的全部历史聊天。
- 首次只回填用户指定主滚动窗口最近 14 个“实际有聊天”的 `chat_day`。
- 已存在的历史日回顾不因回填切片而重新生成；历史回填使用 slice-only 任务读取原始聊天。
- 更早历史通过“协作者 + session + 日期范围”人工选择后离线补生成。
- 历史任务执行前显示消息量、预计输入 token、预计调用次数；支持暂停、继续和失败重试。
- Prompt 或生成版本升级后不默认全量重切。新日期使用新版本；旧切片继续有效，只有人工判错、近期高频命中或用户指定的日期才重切。

## 四、数据契约

建议在 Haven `gateway_state.db` 中使用独立的切片表组，不进入任何 bucket 表。最终表名可在实现时按现有迁移命名规范调整，但职责不得合并。

### 4.1 生成批次 `conversation_slice_batches`

一个批次代表一个 `session_id + chat_day` 的完整切片结果，包括合法的 0 切片结果。

| 字段 | 含义 |
|---|---|
| `batch_id` | 不可变批次 ID |
| `profile_id` / `persona_id` / `session_id` | 所属用户、协作者和原窗口 |
| `chat_day` | 已确定的聊天日期 |
| `chat_day_rule_version` | 产生该日期的日界规则版本 |
| `daily_source_snapshot_hash` | 联合日回顾任务所读全日材料的 hash；slice-only 可为空 |
| `session_source_snapshot_hash` | 本 session 当日规范化原文快照 hash |
| `source_message_count` | 参与快照的永久消息数 |
| `segmenter_version` | 自然边界算法/指令版本 |
| `slice_prompt_version` | 切片风格 Prompt 版本 |
| `slice_schema_version` | 模型输出与持久字段契约版本 |
| `generator_provider` / `generator_model` | 实际生成来源和模型 |
| `reslice_revision` | 同一材料和版本下的人工重切序号；普通任务从 1 开始 |
| `idempotency_key` | 批次唯一幂等键 |
| `status` | `candidate / active / superseded / failed` |
| `supersedes_batch_id` | 新批次替代的上一 active 批次 |
| `coverage_json` | 被切片覆盖和明确忽略的 message ID 及原因 |
| `created_at` / `activated_at` / `superseded_at` | 生命周期时间 |
| `error_code` / `error_detail` | 失败诊断，不放进模型 Context |

批次幂等键按固定编码计算：

```text
SHA-256(
  profile_id + persona_id + session_id + chat_day
  + session_source_snapshot_hash
  + segmenter_version + slice_prompt_version + slice_schema_version
  + reslice_revision
)
```

同一个任务的网络重试必须沿用同一 `reslice_revision` 和幂等键。用户明确点击“重新生成”时，先用 CAS 分配新的 `reslice_revision`，再创建新任务，避免把主动重切误判成普通重试。

### 4.2 切片 `conversation_slices`

| 字段 | 含义 |
|---|---|
| `slice_id` | 独立、不可变 slice ID，不复用 bucket ID |
| `batch_id` | 所属生成批次 |
| `sequence_no` | 当批次内稳定顺序 |
| `profile_id` / `persona_id` / `session_id` / `chat_day` | 冗余归属字段，便于资格过滤与查询 |
| `source_start_message_id` / `source_end_message_id` | 连续 source 范围的起止永久 message ID |
| `source_message_ids_json` | 范围内完整、有序的永久 message ID 列表 |
| `source_content_hash` | 此 source 范围规范化内容 hash |
| `source_time_start` / `source_time_end` | 消息实际发送时间范围 |
| `event_time_start` / `event_time_end` | 原文能确定时记录的事件时间，否则为空 |
| `summary` | 第一人称自然摘要正文 |
| `summary_content_hash` | 规范化摘要正文 hash |
| `boundary_reason` | `topic_shift / event_complete / time_gap / day_end / length_limit` |
| `lifecycle_status` | `active / superseded / source_changed`；正常替换主要由批次控制 |
| `review_status` | `unreviewed / approved / rejected` |
| `review_reason` / `review_note` / `reviewed_at` | 人工反馈 |
| `created_at` / `updated_at` | 创建与更新时间 |

单切片幂等身份由以下内容计算，并在同一批次内唯一：

```text
session_id + chat_day
+ source_start_message_id + source_end_message_id
+ source_content_hash
+ segmenter_version + slice_prompt_version + slice_schema_version
+ reslice_revision
```

### 4.3 source 规范化与 hash

- 按 `conversation_turns` 的稳定顺序展开为永久 user/assistant message。
- 每条纳入：message ID、角色、最终可见正文、附件 ID 与附件内容 hash；使用固定 JSON key 顺序和 UTF-8 编码。
- 不把数据库更新时间、重试次数、隐藏 thinking 或工具日志纳入内容 hash。
- `source_content_hash` 负责证明单个切片原文未变；`session_source_snapshot_hash` 负责证明整日切片输入未变。
- `summary_content_hash` 只用于摘要重复检查，不参与证明原文一致性。

### 4.4 向量索引

- 自动切片使用独立于 bucket 的向量命名空间/表，主键为 `slice_id`。
- 至少保存 `slice_id + embedding_version + summary_content_hash + embedding`。
- 摘要 hash 未变化时不得重复计算同版本 embedding。
- embedding 模型升级只重建向量，不重新调用摘要生成模型。
- 删除、拒绝或失效切片必须同步退出向量检索资格。

### 4.5 生命周期与原子替换

1. 离线任务创建 `candidate` 批次。
2. 校验所有 source ID 均属于同一 profile/persona/session/chat day，顺序合法，切片间不重叠。
3. 校验摘要格式、第一人称约束、长度和 `coverage_json`；0 切片是合法结果，但必须记录忽略原因。
4. 全批通过后，在同一事务中把新批次改为 `active`，上一 active 批次改为 `superseded`。
5. 任一步失败时新批次保持 `failed/candidate`，上一 active 批次继续有效，禁止半批替换。
6. 检测到 source hash 改变时，旧切片标记 `source_changed` 并退出召回，等待离线重建。
7. 人工 `rejected` 不删除数据，但立即退出召回；`approved` 只表示人工确认，不改变版本身份。

### 4.6 删除规则

- source session 软删除：切片和检查记录保留，但停止召回；恢复 session 后可恢复资格。
- source session 永久删除：级联删除对应批次、切片、向量和人工检查记录。
- 删除切片不会反向删除聊天原文、日回顾或手动桶。

## 五、离线任务契约

### 5.1 触发来源

- `daily_bundle`：聊天日结束后，复用日回顾任务材料，一次生成日回顾与切片。
- `slice_recovery`：日回顾关闭、切片部分失败、进程重启或遗漏扫描时，仅补切片。
- `raw_exit`：某日从“原文”改为“日回顾/不带”且没有有效切片时，优先入队但不阻塞配置保存。
- `manual_backfill`：用户按 persona/session/日期范围补历史。
- `manual_reslice`：人工检查页针对一个 session/day 重切。
- `version_backfill`：只处理人工选定或策略命中的旧版本日期，不自动全量运行。

### 5.2 联合生成输入输出

输入是一个 persona 已结束聊天日的不可变材料快照，内部按 session 分组。概念输出：

```json
{
  "daily_review": {
    "content": "..."
  },
  "session_slices": [
    {
      "session_id": "ob2-...",
      "slices": [
        {
          "source_start_message_id": "msg_...",
          "source_end_message_id": "msg_...",
          "source_message_ids": ["msg_..."],
          "summary": "...",
          "event_time_start": null,
          "event_time_end": null,
          "boundary_reason": "topic_shift"
        }
      ],
      "ignored_source_ranges": []
    }
  ]
}
```

服务端必须分别校验并提交 `daily_review` 与 `session_slices`，不得因为同一次模型调用就把两者绑成同一事务。

### 5.3 Prompt 分层

- 硬约束层由 Haven 固定：输出 schema、source 边界、session 隔离、不得编造、事实归属、第一人称含义、允许 0 切片和服务端校验条件。
- 风格层由用户日常使用的 Claude 起草和调校：情绪浓度、叙事视角、细节选择及避免僵硬表达。
- 风格 Prompt 保存为明确的 `slice_prompt_version`；生产任务不得每次自行改写 Prompt。
- Prompt 升级不静默覆盖旧结果，按版本和重切规则生成新批次。

### 5.4 额度控制

- 正常路径优先联合生成，避免当天原文被日回顾和切片分别输入两次。
- 历史 backfill 在创建任务前计算消息数、估算输入 token 和预计调用次数。
- backfill 需要可暂停、继续、限批次运行；普通重试复用幂等结果。
- 第一批只回填主滚动窗口最近 14 个有聊天日，检查质量后再决定是否扩大到 30 天或人工范围。
- 召回阶段只做关键词、向量和代码排序，不产生额外摘要 LLM 调用。

## 六、资格过滤

召回资格每次按当前状态动态计算，不写死在切片正文或生成批次中。

同时满足以下条件才有资格：

- 批次和切片均为 active，source hash 未变化。
- `review_status != rejected`。
- source session 未软删除或永久删除。
- 滚动 source day 当前不是 `原文`；`日回顾` 和 `不带` 均有资格。

固定模式 source session 没有三态。影子阶段可展示其候选，但正式接入前使用以下保守规则：

- source session 等于当前聊天 session：不注入，避免与原生 transcript/handoff 重复。
- source session 不等于当前聊天 session：可进入切片候选。

该固定模式规则必须在阶段四根据影子证据再次确认，未确认前不得扩大正式注入范围。

## 七、人工检查界面

### 7.1 按日期切片检查

Dashboard 新增独立入口，具体导航位置在实现 UI 前按现有 Workbench 结构和 `DESIGN.md` 确认。

桌面布局：

- 左侧日期列表：聊天日、切片数量、未检查数量、失败/失效状态、生成版本。
- 右侧当天切片：按 session 分组，显示摘要、source 起止、时间范围、版本和状态。
- 展开切片后读取永久 message ID 对应原文，明确显示哪些 source 被摘要、哪些被忽略。

手机布局：

- 首屏只显示日期列表。
- 点日期进入当天切片，按 session 分组。
- 左上角返回日期列表，不强塞桌面左右栏。

人工反馈：

- “正确” → `approved`。
- “有问题” → `rejected` 并要求选择 `编造 / 太僵硬 / 情绪不准 / 遗漏重点 / 切分错误 / 重复 / 其他`，可写备注。
- “重新生成” → 创建新的 `reslice_revision`；旧 active 批次在新批次成功前继续有效。
- 第一版不直接编辑摘要；如果观察中大量问题只需局部改词，再单独设计人工修订正文及其版本来源。

## 八、独立召回与跨线去重

### 8.1 自动切片候选

- 关键词检索用于人名、地点、物品、事件名和原话等精确信息。
- 向量检索用于不同措辞下的相似经历、感受和事件。
- 两路候选在切片线路内部合并并去重，保留各自原始分和统一切片相关分供观察。
- 第一版不建立切片关系图、关系边或 importance 评分，不复制手动桶结构。

### 8.2 独立限额

- 手动桶继续使用现有正式召回上限和 token 规则，完全不改。
- 自动切片使用独立候选池、独立最大条数和独立 token 预算。
- 影子观察初始按“最多 2 条切片”模拟；正式 token 上限必须根据真实摘要长度和召回透镜数据再确认。
- 两条线路先分别选满自己的候选，再进行跨线去重。

### 8.3 跨线去重

- 能取得共同 source message 证据时先做精确来源重叠判断。
- 无共同 source ID 时使用摘要/桶正文向量相似度和关键词证据判断语义重复。
- 手动桶和切片重复时始终保留手动桶，淘汰切片。
- 被淘汰的切片可以由切片候选下一名补位，但不得突破切片自己的条数和 token 上限。
- 跨线去重不得反向改变手动桶本轮正式排序或选卡结果。

## 九、召回透镜扩展

现有召回透镜保留手动桶正式结果，增加以下视图：

1. **手动桶**：保持当前候选、necessity、relevance、utility、正式单卡结果和排除原因。
2. **自动切片**：显示关键词/向量来源、各自分数、统一相关分、日期状态、资格、source 范围、排序和未入选原因。
3. **最终组合（假设）**：显示两条线路各自限额、跨线重复、切片补位及分线路/合计 token 估算。

影子阶段的硬要求：

- 手动桶仍按现状真实注入。
- 自动切片只对同一真实查询计算和记录候选，不进入模型 Context。
- “最终组合”只是反事实预览，不得淘汰、替换或改变手动桶真实结果。
- 日志至少能解释：低相关、原文日、失效、人工拒绝、软删除、线路限额、token 限额、切片内重复、与手动桶重复。

影子退出不按固定天数，必须以真实结果满足以下条件：

- 原文/日回顾/不带资格过滤无误。
- 没有跨 profile、persona、session 或 chat day 串线。
- 前两条切片大多数情况下相关，重复率和无关率可接受。
- 与手动桶重复时稳定保留手动桶，并能正确补位。
- token 增量稳定且可以解释。
- 人工检查中的编造、视角错误和切分错误已降到可接受范围。

## 十、分阶段实施计划

每个阶段使用独立实施窗口、独立提交、独立部署和验收。未通过当前阶段门禁，不进入下一阶段。

### 阶段一：数据契约与幂等/失效

Haven：

- 确认现有 `conversation_turns`、日回顾输入和聊天日锁定逻辑的最小接入点。
- 新增批次、切片、任务/状态及独立向量索引所需迁移；迁移只能新增，不删除旧表数据。
- 实现规范化 hash、批次/切片幂等键、CAS 重切 revision、原子激活和删除级联。
- 先提供内部读写与测试，不调用摘要模型，不接召回。

Dashboard：

- 本阶段只在确有必要时增加最小诊断代理；不做完整页面。

验收门禁：

- 同一任务重复执行不重复建批次或切片。
- 人工重切能获得新 revision；失败不影响旧 active 批次。
- 不合法跨 session/day/source 顺序被拒绝。
- 0 切片批次可合法激活并有 coverage 原因。
- 软删除停止资格，恢复可恢复，永久删除能级联清理切片数据。
- 现有 Haven cc contract 测试和 Dashboard build 不回归。

### 阶段二：离线生成与人工检查

Haven：

- 在现有每日回顾材料读取基础上实现版本化联合输出，同时保留 slice-only 恢复路径。
- 增加日界后生成、失败恢复、raw 退出补任务、人工 backfill/reslice。
- 实现 Prompt 硬约束与 Claude 起草的版本化风格层。
- 实现额度预估、任务暂停/继续和状态查询。

Dashboard：

- 新增按日期切片检查入口，完成桌面左右布局和手机日期钻取。
- 展示 source 原文、版本、状态、额度估算和任务进度。
- 支持正确/有问题/原因/备注/重新生成，不提供正文编辑。

验收门禁：

- 同一全日材料只读取一次并能分别保存日回顾和各 session 切片。
- 任一产物失败不会覆盖另一产物。
- 切片不跨 session/day，原文可凭永久 message ID 完整回查。
- 先用少量真实日期人工检查风格、事实、情绪和边界。
- 第一批历史仅回填主滚动窗口最近 14 个有聊天日，并在执行前展示额度估算。
- 此阶段仍没有任何自动切片召回或 Context 注入。

### 阶段三：独立影子召回与召回透镜

Haven：

- 建立切片关键词索引与独立向量索引。
- 实现切片资格过滤、独立候选/排序/限额及跨线去重模拟。
- 复用已有 query embedding 时不得重复付费计算；召回过程中不调用摘要模型。
- 保存足够的 shadow trace 供召回透镜解释，不改变手动桶正式结果。

Dashboard：

- 在现有召回透镜增加“自动切片”和“最终组合（假设）”视图。
- 展示候选来源分、资格过滤、跨线去重、补位和 token 估算。

验收门禁：

- 手动桶正式召回与当前行为完全一致。
- 自动切片只记录、不注入，并能在透镜解释每个选择和淘汰原因。
- 完成一段真实使用观察，满足第九节影子退出条件。
- 由用户单独确认是否允许进入阶段四。

### 阶段四：正式模型 Context 接入

- 只有用户在影子观察后明确批准才实施。
- 保持手动桶优先；自动切片使用经过确认的独立条数和 token 上限。
- 在请求追踪中明确记录本轮真实注入的 slice ID、版本、source day 和 token。
- 提供全局/运行时快速关闭开关；关闭后手动桶与现有滚动 Context 完全照旧。
- 先小范围启用并完成真实聊天体验验收，再决定是否扩大历史回填或默认范围。

## 十一、部署、验证与回退

- 跨仓库阶段统一按 Haven → Dashboard 顺序部署。
- Haven 每阶段先跑定向 contract 测试和相关全量测试；Dashboard 跑定向测试及 `npm run build`。
- 涉及页面的阶段必须做手机点击验收，不能只以 build 通过代替。
- 阶段一迁移只新增表/字段；旧代码忽略新数据，可以先回退应用代码。
- 阶段二生成失败时保留旧 active 批次；可以关闭任务触发而不影响日回顾旧路径。
- 阶段三 shadow 开关关闭后停止切片检索，手动桶正式线路不变。
- 阶段四总开关关闭后停止切片 Context 注入，不删除已生成切片，便于诊断和恢复。
- 用户自行 commit + push；每个阶段使用可独立 revert 的提交，不把四阶段塞进同一提交。

## 十二、实现时必须同步的正式文档

按 `MAINTENANCE_CONTRACT.md` 在各阶段只同步已经落地的事实：

- Haven 新表/cc 持久化：更新 Haven `CLAUDE.md` 的 cc 持久化章节。
- Haven 新 REST 路由：更新 Haven `CLAUDE.md` REST API 分组。
- 生成、召回或外部行为变化：按命中项更新 Haven `README.md`。
- Dashboard 新页面、导航、特殊 API：更新 Dashboard `CLAUDE.md` 对应表；UI 实现前完整读取 `DESIGN.md`。
- 当前阶段进度和下一窗口范围：只更新本 handoff，不把阶段进度复制进 CLAUDE 或 TECH_DEBT。

## 十三、阶段一落地记录（2026-09-12）

### 实际持久化契约

- `conversation_slice_batches`：不可变候选/active/superseded/failed 批次；同一 `profile + persona + session + chat_day` 最多一个 active。
- `conversation_slices`：保存连续、有序、不重叠的永久 message ID 范围、source/summary hash、边界、生命周期和人工检查状态。
- `conversation_slice_tasks`：保存触发类型、任务幂等键、状态、attempt、错误与关联 batch 的预留字段。
- `conversation_slice_revisions`：按材料与三个版本维度，用 `BEGIN IMMEDIATE` 和 expected revision CAS 分配人工重切序号。
- `conversation_slice_embeddings`：独立于 bucket embedding 的 slice/version/summary hash 元数据表；阶段一不计算或检索向量。
- 所有迁移均为 `CREATE TABLE/INDEX IF NOT EXISTS`，不删除或重建现有表；`GatewayStateStore` 重复初始化安全。
- source snapshot 固定展开同一 profile/persona/session/chat day 的可见永久消息，只 hash message ID、角色、正文和附件 ID/SHA-256。服务端规范化保存 covered/ignored coverage；合法 0 切片必须有明确原因。
- 普通重试复用同一幂等键；人工重切必须先 CAS 取得新 revision。新批次全量校验并激活成功后才原子 supersede 旧 active，候选失败不影响旧 active。
- source 内容改变后 active 读取会先重新计算 snapshot hash，将旧切片标为 `source_changed` 并停止返回。
- 软删除不删切片，只因 `conversation_sessions.deleted_at` 暂停 active 读取；清除软删除状态后恢复。永久删除由现有窗口删除事务按 `profile_id + session_id` 清理全部切片表组及 embedding。

### 实际 API 与边界

- 没有新增 REST API 或 Dashboard 代理。
- 只提供 `ConversationSliceStore` 内部读写：source snapshot、候选批次、任务幂等、CAS revision、原子激活、source 失效刷新和 active 读取。
- `daily_review_engine.py`、手动桶、召回 pipeline、滚动 Context 和正式模型请求均未修改。

### 验证结果

- `tests.test_conversation_slice_contracts`：8 项通过。
- 新增切片测试 + 现有 `test_gateway_state_contracts`：44 项通过。
- 日回顾相关回归：15 项通过。
- Haven 全量 `unittest discover`：210 项通过。
- Dashboard `npm run build`：通过，83 个静态页面生成完成。
- `git diff --check`：通过；只有既有 Windows LF/CRLF 提示。

### 部署状态

- 用户已确认阶段一 commit 通过 `HAVEN_RELEASE_SHA` 部署成功，并人工确认 Brain 与 Gateway 均健康；本 handoff 没有记录具体 SHA。

## 十四、阶段二落地记录（2026-09-12）

### Haven 实现

- 新增 `conversation_slice_engine.py`，固定 `natural-topic-boundaries-v1` 与 `first-person-life-memory-v1` 两个版本标识；联合输出严格使用第五节 JSON 契约，并在服务端校验 session/day、永久 message ID 连续覆盖、边界、第一人称与合法 0 切片。
- 正常日界任务只读取一次全日材料、只调用一次模型，同时生成全日回顾与各 session 切片；两类结果分别提交。已有或人工编辑日回顾时只生成切片，不覆盖日回顾；任一切片失败只创建 `slice_recovery`。
- `raw_exit` 在某日离开原文态且缺少有效切片时只入队，不阻塞滚动配置保存；持久 scheduler 每轮限量处理 queued 的 `raw_exit` / `slice_recovery`，失败任务不自动无限重试。
- 任务表新增消息数、预计输入 token、预计调用次数和各生命周期时间；任务原子 claim 防重复调用。任务排队后原消息变化时，旧任务以 `source_changed` 失败且不调用模型，并为新快照创建恢复任务。
- 历史估算返回消息量、预计输入 token、预计调用次数、逐日范围与签名；签名匹配后只创建 queued 任务，不自动执行。首次范围硬限制最多 14 个实际有聊天日。
- Brain 新增 Cookie 认证的 `GET|POST|PATCH /api/conversation-slices`，提供总览/按日/source、估算/建任务/单日生成/重切/运行、批准/拒绝、暂停/继续/失败重试。任务状态动作只接受合法前置状态。
- 日回顾手动入口和持久调度均改走联合生成；配置热更新会重建切片引擎。没有修改任何手动桶生成、评分、合并、存桶或正式召回线路。

### Dashboard 实现

- 新增 `/conversation-slices` 检查页与同名 Cookie 代理，并从工作台增加入口；召回透镜没有修改。
- 页面支持 persona/session/date、单日 slice-only 生成、历史额度预估后建队列、任务状态与控制、按 session 分组、永久 message ID 原文展开、正确/有问题及原因备注、重切。
- 手机 390×844 隔离 mock 验收已完成：日期列表 → 当日详情 → 展开永久消息原文 → 返回日期列表；未点击任何会产生写入或模型调用的按钮。

### 验证结果

- Haven 定向：`tests.test_conversation_slice_contracts tests.test_conversation_slice_engine tests.test_daily_review_engine tests.test_gateway_state_contracts`，61 项通过。
- Haven 全量：`python -m unittest discover -s tests`，217 项通过。
- Dashboard `npm run build`：通过，85 个静态页面生成完成，包含 `/conversation-slices` 与 `/api/conversation-slices`。
- 新文件均有实际引用；临时 mock 文件和本地测试服务已清理。
- 没有执行真实日期生成、历史 backfill 或真实模型调用。

### 阶段二部署状态

- 尚未 commit、push 或部署；用户自行提交两个仓库。
- 部署顺序仍为 Haven → Dashboard。Haven push 后把完整 commit SHA 写入 Coolify `Ombre Brain → production → haven-test-stack → Environment Variables → HAVEN_RELEASE_SHA`，普通 Restart/Deploy，并由用户人工确认 Brain 与 Gateway 真实健康；之后再部署 Dashboard。

## 十五、下一窗口与后续门禁

阶段一 bug 已在 Dashboard 本地完成独立修复，未改 Haven 或自动切片代码，尚未部署。先提交并部署该修复，确认手机新对话弹窗与滚动原文真实角色流；之后再部署阶段二，并用少量真实日期人工检查风格、事实、情绪和切片边界。

首次历史 backfill 前必须在页面实际展示主滚动窗口最多 14 个有聊天日的消息量、预计输入 token 和调用次数，并再次获得用户明确确认；创建 queued 任务和逐个运行也要区分，不能把“看估算”视为授权执行。

后续仍不得做：

- 关键词或向量召回。
- 召回透镜改造。
- 自动切片正式 Context 注入。
- 未展示额度估算前执行历史 backfill，或超出主滚动窗口最近 14 个有聊天日的首次回填。

## 十六、2026-09-13 正式日回顾解耦修复

- 阶段二把正式 04:30 日回顾和页面手动生成提前接入 `ConversationSliceEngine.generate_daily_bundle()`，但 Dashboard Claude Pro runner 对 `daily_review` 仍返回普通正文；切片引擎把正文强制解析为 JSON，线上因此出现 `slice model output is not valid JSON`。
- 用户确认自动切片尚未完成。本次 Haven 修复把定时和手动日回顾恢复为直接调用 `DailyReviewEngine.generate()`；每周轨迹及其既有结构化输出不改。
- 切片数据库、引擎、检查页、估算、历史任务、人工重切和显式运行入口全部保留。`raw_exit` 仍可入队，但持久 scheduler 暂不自动消费 `raw_exit` / `slice_recovery`，避免未完成切片继续消耗 Claude Pro 额度或影响正式自动化。
- 下一次继续自动切片时，只在本 handoff 范围内补齐明确的结构化输出契约、独立错误与额度控制、真实小范围验收；未经再次确认不得把切片成败重新绑定到日回顾，也不得扩散到召回或正式 Context 注入。
- 验收：页面手动生成一个缺少切片的日期，应得到普通日回顾正文且不出现 slice JSON 错误；下一次 04:30 日回顾应独立成功；未人工点击运行时，queued 切片任务不应产生模型调用。
