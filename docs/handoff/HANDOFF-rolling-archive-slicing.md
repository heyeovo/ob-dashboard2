# HANDOFF：滚动窗口改为「原生存档按天切」

> 2026-09-30 定。CC（Opus 5.5）出方案与验收，GPT 执行代码。
> 起因：固定 → 滚动切换和 revision 重建长期不稳（用户体感十次八次半出问题）。9.30 主窗「窗口3」切滚动时整份对齐失败，降级为 Haven 正文重建，丢了全部 thinking / 工具 / 召回 / 图片。

## 一、根因（为什么要重写而不是再修）

现行实现（`app/lib/cc/rollingHistory.ts`）每次重建都把 Claude 原生 transcript **逐轮对齐** Haven turn（`alignEnvelopesToTurns`：Haven turn ID → 原生 user UUID → 正文包含匹配 → 各种特例），任何一轮对不上整份 fail closed，再由 `allow_fixed_body_restore` 等开关降级为纯正文重建。

两份记录形状天然不同：图片轮次的 `[Image: source: …]` 行、SDK 续写提示（`Continue from where you left off.` / `Your response above was cut off…`）、中断半截轮次、wake 与前台并发、`forkSession` 重写 UUID（窗口减负会触发）……每种都是一次补丁（9.16–9.20 的提交记录几乎全是这类），新形状出现就再坏一次。

9.30 离线复现（主窗真实数据）：减负前的 transcript `0e342407` 有 12 个 envelope 无候选（7 个图片轮次、2 组中断续写、1 个 cut-off 续写），减负后 `17159cec` 为 22 个（fork 把图片轮次拆成两个 envelope）。所以不是减负导致，是对齐本身撑不住。

**而滚动配置本来就是按天的**（每天 raw / 日回顾 / 不带）。只需要知道「这段属于哪天」，不需要知道「这段是 Haven 第几轮」。

## 二、新模型（已定）

### 1. 每个窗口一份只追加的原生存档（archive）

- 位置：与现有 RollingSeedStore 同根（`$CLAUDE_CONFIG_DIR/ob2-rolling-session-store-v1/`），按 **Haven session ID + lane ID** 分文件，例如 `archive/<base64url(havenSessionId)>/<base64url(laneId)>.jsonl`。该目录已在持久卷上（RollingSeedStore 跨部署可恢复即依赖它）。
- 内容：模型真实见过的原生 transcript entry，原样保存（thinking、tool_use / tool_result、图片、召回、SDK attachment 全保留）。每条带 `ob2ArchiveUuid`（首次入档时的原生 uuid）。
- 只追加：不删、不改。旧日期的删减只发生在「生成 revision」时，不回写存档。
- 追加时机：每个成功轮次结束、现有 `syncRollingNativeSession`（`runTurn.ts` 约 1300 行）同步 RollingSeedStore 的同一位置、同一把锁下。追加规则：当前原生 transcript 中**有原生 `uuid` 且没有 `ob2ArchiveUuid` 的 entry** 即为新 entry，按顺序追加并补上 `ob2ArchiveUuid`；同时把标记写回当前 transcript / RollingSeedStore，避免下轮重复入档。
- 不生成 ID。无 `uuid` 的 SDK 元数据 entry（`queue-operation` / `file-history-snapshot` / `ai-title` / `last-prompt` / `mode` / `atis-latch` / `cost-state` 等）不入档，也不带入 revision；它们不是模型可见内容，SDK resume 时按当前 options 重建所需状态。实测主窗 transcript 的 `user` / `assistant` / `attachment` 三类 100% 带 `uuid`；这三类若缺 `uuid`，报错停下，不补 ID。单测覆盖混入无 UUID 元数据后的入档过滤及重复同步幂等。
- 前台 turn 与后台 wake 都走这条路径。

### 2. 生成 revision = 从存档按天筛

1. 按轮分组：复用 `transcriptEnvelopes`（以 primary user entry 起一轮，SDK 内部续写并入上一轮）。**删掉** `toEnvelope` 里 Haven 相关字段，只保留 `entries` 与 `timestamp`。
2. 算日期：取该轮 primary user entry 的 `timestamp`，按窗口的 `rolling_context.timezone` + `day_start_hour`（默认 4）计算 `chat_day`，公式与 Haven `gateway_state.py::_conversation_chat_day` 一致（`timezone` 缺省 `Asia/Shanghai`；先转时区，再减 `day_start_hour` 小时，取日期）。整轮归这一天，跨零点的回复不拆。Haven 用轮次保存时间算日期，这里用用户消息时间，日界线附近个别轮次可能落在相邻一天——可接受，**不要**为此再引入与 Haven 的逐轮对齐。
3. 按当天模式处理：
   - **不带 / 日回顾**：整轮去掉（日回顾照旧进背景 Context，逻辑不变）。
   - **raw 且不是最后一天**：保留，但删 thinking（现有 `pruneCompletedThinking`）和召回（现有 `prunePersistedRecall`）；同时删掉该轮里的 SDK 过期 attachment（environment / model / total_tokens_reminder / date 等，复用 `stripStaleSystemReminders` 的判定）。
   - **最后一天**（存档中最新的 chat_day）：原样保留，thinking 和召回都在。
4. 存档 prefix（第一轮之前的 entry）不带入 revision。
   压缩产物也只保留在存档：`type: 'system'` 且 `subtype: 'compact_boundary'` 的 entry，以及 `isCompactSummary: true` 的 user entry 不带入 revision，避免 SDK resume 忽略分界线之前的原文。
5. `cloneRollingTranscriptForSession` 重新编 uuid / 串 `parentUuid`，照旧落 RollingSeedStore + 物化原生 transcript + resume。**clone 时必须保留 `ob2ArchiveUuid`**。
6. 存档里完全没有某个 raw 日期时（例如存档建立前就已被丢弃的日期）：仅对**整天**用现有 `buildRollingTranscriptEntries` 从 Haven 正文重建，打 `ob2RollingFidelity: 'body_restored'`，上下文检查页可见。不做逐轮拼补。
7. 筛选结果为空（没有任何 raw 日期的轮次）时：不生成 seed、不 resume，开新的 Claude 会话，只注入现有背景 Context；原生存档不动。该空会话后续产生的新轮次照常按「无 `ob2ArchiveUuid` 即新 entry」追加进存档。之后任意日期改回 raw 时从存档恢复。单测覆盖：全部日期为日回顾／不带 → 开空会话 → 聊一轮 → 该轮入档 → 某天改回 raw → 该天与新轮次都在 revision 里。

### 3. 迁移入口统一为「建存档」

| 场景 | 做法 |
|---|---|
| 固定 → 滚动首次切换 | 用 `importSessionToStore` 读固定窗口的原生 transcript，整份作为存档初值，再按 §2 生成 revision。**无对齐、无降级确认**。 |
| 已在滚动、尚无存档（上线时的存量窗口） | 当前 revision 的 RollingSeedStore 整份作为存档初值（已丢弃的旧日期按 §2.6 处理）。 |
| 模型表面变化 rebase（`createModelSurfaceRebaseSeed`） | 同样从存档生成，不再退回正文重建。 |
| 存档与原生 transcript 都丢失 | 明确报错，由用户在上下文检查页确认后走整份正文重建（保留现有 `cc-rolling-recovery` 的二次确认交互，内部改为：正文重建结果作为新存档初值）。 |

`ensureRollingArchive` 只读取迁移来源，不对固定原始 transcript 或旧 RollingSeedStore 写回标记；原生 UUID 足以去重。成功轮次的当前 transcript 同步仍按 §二.1 写回标记。

### 4. 删除（执行时逐项 grep 确认无引用）

- `alignEnvelopesToTurns` 及全部特例：`envelopeMatchesTurn` / `envelopeUserMatchesTurn` / `isPlainTextPairEnvelope` / `isInterruptedStatusOnlyEnvelope` / `isLegacyExplicitFailureEnvelope` / `havenNativeTurnUuid` / `closestCompletedTurnIndex` / `isUnrepresentedEmptyWake` 等。
- `createRevisionSeedFromEntries`、`createRollingHistoryRevisionSeed`、`createFixedTranscriptMigrationSeed`、`inspectRollingHistoryAlignment`、`RollingAlignmentIssue` / `RollingMissingRawTurn`。
- 配置字段：`rollingRequiredFullRawDays`、`requireRollingSource`、`allowFixedBodyRestore`、`allowRollingBodySeed`、`rollingAllHistory`（`ccOptions.ts`、`turnInputs.ts`、`cc-chat/route.ts`、`runTurn.ts`）。Haven 侧 `allow_fixed_body_restore` / `previous_day_modes` 若不再使用，前端不再读写，Haven 字段保留不动（另记 Todo 清理）。
- `ob2HavenTurnId` 写入 / 读取。
- 前端「允许正文降级」确认弹窗（切换时的 `allow_fixed_body_restore` 交互）。
- `cc-diagnostics/rolling-ab`：评估是否仍有用，无用则删。
- 固定→滚动迁移时对 turn-outcomes 账本的依赖。账本本身保留（其他地方若仍在用）。

### 5. 不改

- Haven 的滚动配置、revision、日回顾、钉选桶 / 日记背景 Context、`chat_day` 计算。
- resume key 含 revision 的规则；物化到真实 `CLAUDE_CONFIG_DIR/projects` 再普通 `resume`、不给长期 query 传 `SessionStore` 的规则。
- 固定窗口、selfhost 引擎、窗口减负（滚动窗口仍禁用减负）。

## 三、上下文检查页（`cc-context-audit`）

对齐诊断整块替换为存档视角，只读：

- 存档：entry 数、首 / 末日期、每个 chat_day 的轮数。
- 本 revision：每天的处理方式（完整 / 删 thinking+召回 / 去掉 / body_restored），以及 thinking / 召回 / attachment 删除数量。
- 保留现有逐日 token 预估、「持久 transcript 统计」（工具调用 / 工具结果 / 召回包装 / 正文恢复标记）。
- 删掉「缺少完整轮次」「无正文候选」「wake 并发隔离」等对齐指标。

## 四、主窗「窗口3」修复（一次性）

- 存档初值 = `projects/-workspace-dashboard/17159cec-3ae0-4158-9c56-52173f3df065.jsonl`（减负后版本，工具结果已按用户选择清理，更轻）**+** 当前滚动 transcript `76c6d239-3385-45c6-a876-18a741d430b1` 中切换之后新产生的 entry（没有 `ob2HavenTurnId` 标记、时间晚于 2026-09-30T14:26Z 的那部分；body 重建出来的旧历史都带 `ob2HavenTurnId`，不要）。
- 备份：`0e342407-8d90-4f9d-ab40-4c6f5da7fcd0.jsonl`（减负前原版）保留不动，作为兜底。
- 执行方式：写一个一次性脚本（放 `scripts/`，文件头注明一次性、用后可删），把上面拼成存档文件；再在 Haven 把该窗口 `context_revision` +1，触发下一轮从存档生成。**先在测试窗口跑通全流程再动主窗**，动主窗前告知用户。

## 五、执行顺序（GPT）

1. 新模块 `app/lib/cc/rollingArchive.ts`：存档读写（追加 / 读取 / 初始化）、按天分组、按模式筛、生成 seed。纯函数部分与 IO 分开，便于测试。
2. `runTurn.ts`：历史 seed 选择收敛为一条路径：持久 seed 命中则 resume → 否则从存档生成 → 否则明确报错。`turnInputs.ts` / `cc-chat/route.ts` 同步删字段。
3. 成功轮次后的存档追加（与 `syncRollingNativeSession` 同锁）。
4. 删除 §二.4 列出的旧代码，逐项 grep。
5. `cc-context-audit` 与前端检查页按 §三 改。
6. 测试：重写 `tests/rolling-context.test.ts`、`tests/cc-rolling-recovery-route.test.ts` 中相关用例，覆盖下面验收项。**测试夹具一律合成数据，禁止提交真实聊天内容**。
7. §四 主窗修复脚本。
8. 文档同步：`docs/reference.md`「cc 数据持久化契约」滚动相关条目、`cc-context-audit` / `cc-chat` / `cc-rolling-recovery` 行、`docs/architecture.md` 滚动章节，删掉对齐描述。

## 六、验收

- [x] 单测：图片轮次、SDK 续写提示、中断半截轮次、wake 轮次、跨零点回复、`day_start_hour` 边界（03:59 / 04:00）各至少一例，按天筛结果正确。
- [x] 单测：最后一天 thinking / 召回保留；更早的 raw 日期删除；工具块与正文不动；tool_use 未配对时不删 thinking（沿用现有保护）。
- [x] 单测：「不带」→ 改回 raw 时从存档恢复原样（存档不因筛选而缺失）。
- [x] 单测：存档追加幂等，同一轮重复同步不重复入档。
- [ ] `npm run build` 通过，`npx vitest run` 全绿。
- [ ] CC 离线用主窗真实数据跑按天筛（不提交）：thinking 仅最后一天有、工具块数与存档一致、无「body_restored」。
- [ ] 测试窗口实测：固定→滚动切换一次、跨日重建一次、改某天为「不带」再改回一次，上下文检查页数据正确，对话正常续接。
- [ ] 主窗修复后：上下文检查页工具调用 / 召回 / thinking 数量合理，切换后那几轮在。

## 七、状态

- [x] GPT：§五 1–6 实现完成，并同步正式文档；分支 `feat/rolling-archive`，供 CC 拉取验收。
- [x] CC 首轮：Linux build／全量测试、主窗真实数据离线切片通过（用户反馈）。
- [x] CC 复验两处修复（`e115781`），2026-10-01 合并 main 上线（`691a86f`）。
- [x] 主窗「窗口3」修复（CC 一次性执行，未留脚本）：存档 = `17159cec` 1503 条 + `76c6d239` 切换后 36 条；Haven revision 以「9.21 改 omit 再改回 review」两次 PATCH 触发重建。
- [x] 上线后发现链断：`forkSession`（窗口减负）写入带 uuid、无 `parentUuid` 的 `custom-title`，被串进 revision 链，resume 只读到其后 41 条（约 3 万 token）。修复 `92cc2f5`：revision 只收 `parentUuid` 链节点，clone 不以非链节点作前驱；新增链可达性单测。复修后主窗 752/752 链可达、每轮约 8.5 万 token，工具 19 组、图片 11 张、thinking 32 块。
- [ ] §六 测试窗口完整流程（固定→滚动、跨日重建、不带↔raw 往返）未专门跑；先以主窗日常跨日重建观察，异常再补。

**验收教训**：离线演练必须从 revision 最后一条沿 `parentUuid` 走回开头（或用 SDK `getSessionMessages`）确认全链可达，只数块类型会漏掉断链。
**用户侧提醒**：上下文重建后，模型会被上下文里「之前说丢了」的旧对话带偏、误报缺失；核对时问具体内容，不问「完整吗」。

### 本次验收交接

2026-10-01 CC 首轮验收（用户反馈）：Linux 全量测试和 build 通过，主窗真实数据离线切片正确。此次只补两处：切片排除压缩分界线／摘要，迁移来源改为只读；新增单测覆盖前后原文保留、存档不删压缩产物、两种来源文件迁移前后字节不变及原生 UUID 去重。对应代码仅 `rollingArchive.ts`，测试仅 `rolling-context.test.ts`，其余改动是命中的文档同步。本轮相关测试 64 条通过，build 通过；交付采用同分支 commit + push，由 CC 复验这两处。主窗修复仍不做。

已确认的补充规则：空筛选不生成 seed、不 resume，但后续新会话轮次照常入档（§二.2 第 7 点）；无 UUID 元数据不入档、不进入 revision，模型可见类型缺 UUID 报错，不补 ID（§二.1）。两项都有合成测试，空会话还经过 runTurn 集成测试确认没有 resume 且成功轮次进入存档。

首轮 Windows 验证记录：`npm run build` 通过；全量 `npx vitest run` 为 366 通过、1 条原有跳过、2 条失败。以下两条原样保留，未改、未跳过，当时用户确认由 CC 在 Linux 验证；CC 首轮 Linux 验证现已通过：

| 测试 | 原因／状态 |
|---|---|
| `tests/artifacts.test.ts` → `artifacts` → `lists newest first and ignores symlinks and other files` | 创建文件 symlink 时 `EPERM: operation not permitted`；Windows 符号链接权限，待 CC 在 Linux 验证 |
| `tests/cc-dirs.test.ts` → `cc workspace 路径边界` → `工作模式内置 yanzhi files 目录；闲聊、未挂载和 symlink 挂载点都不加` | 创建目录 symlink 时 `EPERM: operation not permitted`；Windows 符号链接权限，待 CC 在 Linux 验证 |

额外观察：一次全量运行中，未改动的 `tests/dashboard-auth.test.ts` 的 `compares login input and verifies only authentic, unexpired sessions` 随机 token 末位篡改断言失败；单独重跑 6 条及最后全量运行均通过。其签名比较把 base64url 解码后比较字节，替换末位可能仅改变未使用的编码位。认证代码与测试都没有改动，CC 验收时留意这条既有测试的波动，不把它归为滚动改造逻辑。

CC 下一步：只验收本分支的 §五 1–6 和正式文档，运行 Linux 全量测试；再用真实数据离线验证（不提交聊天内容）和测试窗口验证固定→滚动、跨日、omit→raw、空会话入档。主窗修复仍是后续独立操作；本次不含脚本或线上参数修改。Haven 旧 `allow_fixed_body_restore`／`previous_day_modes` 字段留存未动，后续清理需登记 OB Todo。

### 改动文件

- `app/api/cc-chat/route.ts`
- `app/api/cc-context-audit/route.ts`
- `app/api/cc-diagnostics/rolling-ab/route.ts`（删除）
- `app/api/cc-rolling-recovery/route.ts`
- `app/cc/CcRollingContext.tsx`
- `app/lib/cc/ccOptions.ts`
- `app/lib/cc/rollingArchive.ts`（新增）
- `app/lib/cc/rollingHistory.ts`
- `app/lib/cc/runTurn.ts`
- `app/lib/cc/turnInputs.ts`
- `app/lib/cc/windowPrompt.ts`
- `app/lib/havenTurns.ts`
- `app/workbench/ContextAuditPanel.tsx`
- `docs/architecture.md`
- `docs/handoff/HANDOFF-rolling-archive-slicing.md`
- `docs/handoff/README.md`
- `docs/reference.md`
- `proxy.ts`
- `tests/cc-background-turn-inputs.test.ts`
- `tests/cc-rolling-recovery-route.test.ts`
- `tests/cc-runTurn.test.ts`
- `tests/dashboard-proxy.test.ts`
- `tests/rolling-context.test.ts`

### 删除的运行时函数与类型

- `app/api/cc-context-audit/route.ts`：`matchTranscriptMessages`。
- `app/api/cc-diagnostics/rolling-ab/route.ts`：`bearer`、`secureMatch`、`credentialFingerprint`、`promptOnce`、`safeError`、`runProbe`、`POST`。
- `app/lib/cc/rollingHistory.ts`：`rollingRevisionRequiresSource`、`assertRequiredRollingRevisionSeed`、`assertFixedMigrationSeed`、`assertRollingResumeRecovered`、`assertRollingSeedAvailable`、`normalized`、`envelopeUserMatchesTurn`、`envelopeMatchesTurn`、`isPlainTextPairEnvelope`、`isInterruptedStatusOnlyEnvelope`、`isLegacyExplicitFailureEnvelope`、`havenNativeTurnUuid`、`closestCompletedTurnIndex`、`alignEnvelopesToTurns`、`isUnrepresentedEmptyWake`、`inspectRollingHistoryAlignment`、`createRollingTranscriptRecoverySeed`、`createRollingHistoryRevisionSeed`、`createRevisionSeedFromEntries`、`createFixedTranscriptMigrationSeed`。
- 删除类型：`RollingAlignmentIssue`、`RollingMissingRawTurn`；删除诊断专用类 `MemorySessionStore` 和类型 `ProbeResult`。
- `syncRollingNativeSession` 移入 `rollingArchive.ts`，不是删除；`toEnvelope` 只保留 entries／timestamp；`latestRawConversationDay` 改为 `latestConversationDay`，预算按最新对话日估算，实际清理以存档审计为准。
