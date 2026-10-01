# ob-dashboard2 查表资料

> 从原 `CLAUDE.md` 搬来的查表内容（2026-09-27）。不通读：先 Grep 关键词，再按行读。
> 入口和硬规矩在 `AGENTS.md`；详细机制说明在 `docs/architecture.md`。

## 环境变量（.env.local）

production 必须配置以下六项：

| 变量 | 用途 |
|------|------|
| `HAVEN_GATEWAY_URL` | Haven 基础 URL（不带末尾斜杠） |
| `OMBRE_SESSION` | Haven Brain 登录密码 |
| `OMBRE_GATEWAY_TOKEN` | Haven Gateway Bearer token |
| `DASHBOARD_LOGIN_SECRET` | 公网登录口令（>=12 字符） |
| `DASHBOARD_SESSION_SECRET` | session 签名 secret（>=32 字符） |
| `OMBRE_AGENT_WAKE_RUNNER_TOKEN` | Haven 主动唤醒 callback 的独立 Bearer 共享密钥；与 Brain 相同，不返回浏览器 |

本机 `npm run dev` 继续兼容旧 `OMBRE_BASE_URL` / `NEXT_PUBLIC_OMBRE_*`。
本机 `npm run dev:iphone` 从 `.env.local` 读取登录口令及 Haven 凭据，启动脚本仅在该进程设置 VPS HTTPS `HAVEN_GATEWAY_URL` 与 `DASHBOARD_PREVIEW_READ_ONLY=1`；`proxy.ts` 拦截预览中的非读取请求（登录、退出除外）。LAN 地址自动选择，也可作为脚本参数指定；VPS 公网入口变化时用 `DASHBOARD_PREVIEW_HAVEN_URL` 覆盖。该预览连接正式数据，只用于读取和 UI 验收。

## 文件结构速查

| 目录/文件 | 说明 |
|-----------|------|
| `app/page.tsx` | 主页（时间线/记忆格） |
| `app/memory/` | 记忆库（时间线 / 记忆格双视图） |
| `app/cc/` | 聊天主页（cc / selfhost）；手机端默认进入对话列表，可手动指定每个协作者唯一主窗，点入窗口后聊天，历史聊天与已删除窗口分子列表；支持同一时间线按日期跳转，以及在本窗口设置中手动维护“原换窗 / 按天滚动”的原文、日回顾、不带三态拼接和钉选桶、日记、最近普通桶、feel、随机高重要度桶长期层；滚动日期分列正文、工具、附件视觉/文件正文、召回、有效 thinking、时间戳、消息框架和 agent wake 的 token 预估，较早 raw 日期的留档 thinking 显示为已剥离，手动设为“不带”的日期默认折叠且不改变任何日期模式；损坏的滚动窗口可经二次确认舍弃旧原生细节并用当前 raw 日期的 Haven 正文重建 transcript，不复制窗口或页面历史；从滚动切回固定模式会提示用“换窗继续”保留最新衔接；召回按钮显示完整注入的估算 token，详情弹窗分别标明完整注入与卡片/日期正文 token |
| `app/collaborators/` | 协作者提示词独立页：`[id]` 身份和模块，`[id]/base` 基础提示词，`[id]/modules/[moduleId]` 模块编辑，`new` 新建；目录权限在工作台维护，经 `/api/cc-personas` 存 Haven。 |
| `app/workbench/` | 工作台首页按作品、文件、引擎分组；`files/[root]/[[...path]]` 浏览和预览文件，`dirs` 编辑当前协作者的读写目录，`context` 展示只读上下文审计，`session` 展示当前工作窗口状态。 |
| `app/api/files/` | 服务端文件浏览 API：`yanzhi` 映射 `YANZHI_FILES_ROOT`、`dashboard` 映射 `/workspace/dashboard`、`haven` 映射 `/workspace/haven`、`notes` 只映射 `/home/cc/.claude/projects/*/memory` 中非空目录。真实路径必须留在根内，隐藏以点开头的段、`node_modules`、`.pem`、`.key`、含 `credential` / `secret` 的名字；只有 yanzhi 可上传和删单个文件。 |
| `app/conversation-slices/` | 聊天切片检查：按日期和 session 查看离线切片、永久消息原文、版本/状态与任务；支持批准/拒绝、原因备注、重切、单日 slice-only 生成及先估算后创建的历史任务，手机端先日期列表再钻取详情；切片不进入 Context |
| `app/recall-lens/` | 召回透镜（按 session 查看 necessity、统一 relevance、utility 三档、最终生效单卡结果、完整审核候选、保留资格但未获单卡位的候选、检索来源/检索分/无 freshness 排序分，以及 explicit/contextual 语义查询故障降级证据） |
| `app/settings/` | 设置聚合页按常用、记忆与引擎、数据三组提供 10 个入口；外观行即时显示当前主题与背景状态，底部退出登录需确认。子页保留各自配置功能 |
| `app/settings/appearance/` | 外观设置：杏雾/樱粉/雾蓝/夜四主题、背景（含背景浓度、照片强调色跟随主题 / 图片）、玻璃强度、标题字体、字号、雨痕；「聊天显示」两个本机开关语义不变 |
| `app/impressions/` | 日回顾：默认周条，可展开月历，过去空白日可补写 |
| `app/journal/` | 日记本按月阅读；月份名只取钉选「YYYY年关系时间线」桶的正文；列表与 `[id]` 阅读页共用允许丢失的模块缓存，先显示缓存再后台刷新，返回列表恢复搜索与滚动位置；单篇原地编辑、前后篇与删除 |
| `app/journey/` | 关系轨迹页 |
| `app/components/` | 共享组件 |
| `app/api/` | API 路由（大部分透传 Haven）；`edit-bucket` 保留上游状态码并转换非 JSON 错误；`bucket/[id]/comments/[commentId]` 代理单条年轮修改/删除；`cc-chat` / `cc-chat-selfhost` 在固定模式沿用 handoff；`cc-chat` stats 返回 `active_turn`，`cc-chat/attach` 按 SSE `id` / `after_seq` 补齐缓冲并订阅实时事件；浏览器断线只移除订阅，显式丢弃轮次才取消进程内队列与 Pro 文件锁等待，跨进程锁记录宿主机和 PID，同机持有进程死亡时立即回收；滚动模式的原文从每窗口／lane 的只追加原生存档按天筛选，日回顾、实时钉选桶和日记仍放入背景 Context；`cc-rolling-recovery` 仅在原生存档、持久 revision 与原生 transcript 均不可用且用户精确确认窗口时，把全量 Haven 正文初始化为新存档，再物化当前 raw 日期的 seed，以旧 session ID + state version CAS 切换当前活跃 lane；`cc-context-audit` 只读显示存档及按天筛选结果、当前持久 transcript、请求前保存的 system prompt 与去密后的模型表面诊断，不生成 revision 或修改指针；`cc-agent-wake` 以 CAS 管理当前窗口 wake/silence/Bark 开关；`cc-agent-wake-runner` 以独立 Bearer 接受 Haven 的持久 wake callback（含 `agent_followup`），认证失败时暂停该窗口自动唤醒并返回一小时 `Retry-After`，Pro 额度耗尽时同样返回一小时退避但不保存额度提示为 wake 消息；`cc-notifications` 服务端代理 Bark 掩码配置、最近状态与测试推送；`cc-turns` 支持按 `after_round_id`、`chat_days` 读取消息，并通过 `days=1` 按 profile/session 查询不含正文的月历日期与轮数，读写滚动上下文、主窗置顶，并以 `offset + total` 分页区分活动/软删除窗口；读取 `context_days` 时同时取得 Haven 按日汇总的正文、工具、附件、召回、thinking、时间戳、消息框架、agent wake token 预估及未知附件数；严格轮次提交会同步 `recalled_bucket_ids`、`created_bucket_ids` 和 `breath_bucket_ids` 给 Haven 隔离账本；`conversation-slices` 以 Dashboard Cookie 代理 Haven 的离线切片检查、额度估算和任务/人工反馈接口，不参与召回或 Context |
| `app/api/appearance/` | 服务端代理 Haven 外观配置与单张背景图；GET 首屏读取失败回默认值，POST 保存白名单 normalize 后的配置，图片 GET/POST/DELETE 经 Dashboard 登录保护且不暴露 Haven Bearer |
| `app/api/care/` | 代理 Haven reminders/todos，Todo 的 DELETE 保留鉴权 Cookie 与上游状态码 |
| `app/api/cc-turns/` | 窗口状态 PATCH 可单独写入 `recall_mode` 三态到 Haven，GET 按 session 返回该值供本窗设置刷新恢复。 |
| `app/api/cc-context-audit/` | 只读读取活跃 lane 的原生存档：entry 数、首末 chat_day、每日轮数、本 revision 重建时的每日处理与 thinking／召回／attachment 清理数量、按当前配置重建预览；保留逐日预算、持久 transcript 的工具／召回／正文恢复统计、长期层已保存／生效 ID、当前工具和 MCP 模型表面、最近请求的 hash 与 iterator 状态。不与 Haven 逐轮或逐条正文匹配，不生成 seed、不改变设置或会话指针。 |
| `app/lib/` | 客户端库与工具函数；`recallDisplay.ts` 统一召回 token 估算与模块拆分，`havenPersonas.ts` 每轮按 Haven 最新配置拼装基础提示词、“关于我”和可热更新提示词模块；召回背景使用规则由提示词模块维护，动态正文不重复说明 |
| `globals.css` | 设计 Token 定义 |
| `DESIGN.md` | 完整设计规范 |

## cc 数据持久化契约

> 通用硬规矩（Haven 持久化、localStorage、密钥掩码）见 `AGENTS.md`。以下是各机制的具体契约。

- 外观配置与当前背景图在 Haven `gateway_state.db` 持久化，Dashboard 根布局逐请求从 Haven 读取，渲染前把主题、字体、雨痕和滑条变量写入 `<html>`；Haven 不可用时用 `apricot` 默认值，旧 `linen` 映射为 `apricot`。客户端只用 `localStorage` 保存镜像以应对慢请求，保存结果以 Haven 为准。设置 → 外观里的「聊天显示」仍是本机开关。
- 手机底栏回聊天的位置与聊天草稿只存浏览器（`app/cc/ccNavMemory.ts`）：离开 `/cc` 时在哪个对话记进 `sessionStorage` `ob2-cc-return-session`（在列表或历史窗口则清空），从别的 Tab 点「聊天」回到 `/cc?session_id=…`；已在 `/cc` 时点「聊天」仍回列表。各对话草稿存 `localStorage` `ob2-cc-drafts`，最多 30 条，发送后清掉；草稿里已上传到 Haven 的附件信息按窗口存 `localStorage` `ob2-cc-draft-attachments`（同样最多 30 个窗口，发送或移除后清掉）。这些丢了都无所谓，不进 Haven。

- CC 前台轮次与浏览器请求解耦：生成、Haven 查询与严格提交使用服务端轮次 signal；息屏、隐藏页面、刷新或切窗口只断开本地订阅。用户停止走 interrupt 优雅收尾并保存已有内容；显式丢弃会话仍可取消轮次，内部更换凭据/提示词重建 SDK 不取消。等待会话/账号锁时停止会直接取消排队，不启动模型。后台 wake、selfhost 保持原行为。
- `app/lib/cc/turnBroadcast.ts` 以 session 为键维护一个前台轮次，挂 globalThis 防开发热重载：用户原文、附件 ID、序号事件快照和订阅者只属允许丢失的进程内运行态，不替代 Haven 持久化。完成后保留 2 分钟；事件 UTF-8 累计超过 4 MB 时清除缓冲并标记 truncated，实时订阅仍继续，补流退回等待 Haven。连续 30 分钟无原始/attach 订阅者时沿停止路径自动收尾（排队轮次取消等待），防止无限占用额度；进程重启/部署恢复不在此契约范围。
- 前端发送与 attach 共用事件处理，按 seq 去重；页面加载、进入会话、focus/visible 时恢复 active_turn（可见页面每 5 秒再核对）。断流保留用户与助手气泡并标 detached，期间输入保持生成中且停止可用。无活跃轮次后以 Haven 同 request_id 的完整用户/助手消息原位替换占位并保留 renderKey；未找到保存结果则保留核对/重试入口。
- CC 只把窗口创建时选定的统一 handoff 固定在 Haven；没有 handoff 的历史窗口才读取旧独立日回顾快照，二者不同时注入。协作者基础 system、定位、提示词模块及 session 静态信息每轮按最新配置重组，不从旧 `frozen_persona_append` 恢复整串。
- 注入 OB 记忆按窗口决定，cc 与 selfhost 同序：请求体显式 `recall` → Haven `conversation_sessions.recall_mode`（`on` / `off`）→ 模式默认（CHAT 开、WORK 关）。本窗设置的三态写入 Haven，下一轮生效并在刷新后保留；空值表示跟随模式。协作者旧 `recall_on` 值继续保存、透传，但不再决定是否召回。
- Haven 持久保存永久消息 ID、滚动配置、revision 与 turn watermark；Claude resume key 包含 lane 和 revision。滚动原文由 `app/lib/cc/rollingArchive.ts` 从每窗口／lane 的只追加原生存档按天生成，禁止与 Haven 逐轮对齐。迁移来源只读；压缩分界线与摘要只保存在存档，不进入 revision。存档位于现有持久卷 `$CLAUDE_CONFIG_DIR/ob2-rolling-session-store-v1/archive/`，不是进程内或临时目录唯一存储；只记录有原生 UUID 的 entry，无 UUID 的 user／assistant／attachment 报错，其余无 UUID 元数据不入档也不进入 revision。详细迁移、筛选与恢复流程见 `docs/architecture.md`「原生存档按天切」。
- seed 必须先原子落 RollingSeedStore，再物化到真实 `CLAUDE_CONFIG_DIR/projects`，然后只用普通 `resume` 启动；长期 query 禁止传 `SessionStore`。成功轮次在现有同一把 SessionTurnCoordinator 锁下，追加未入档的原生 entry，把 `ob2ArchiveUuid` 写回当前 transcript 与 RollingSeedStore；clone 保留此标记。前台 turn、后台 wake 与空筛选后新建的 Claude 会话均走同一路径。
- 日回顾、钉选桶和日记继续作为背景 Context；selfhost 仍使用 Haven 原生 messages。滚动设置不再读取／写入 `allow_fixed_body_restore` 或 `previous_day_modes`，Haven 字段本次保留。审计页以存档与持久 transcript 为证据，不使用正文候选、缺失轮次或失败隔离等旧对齐指标。
- 请求终态账本 `turn-outcomes-v1.jsonl` 继续保留 UUID、request ID、终态、短原因和时间，服务于请求诊断；滚动存档迁移和 revision 重建不再读取或依赖它。召回隔离规则不变：原文期 `hold`、原文期 `breath`、最新 raw 日／当前 revision 已召回三类；内容离开 Context 且无其他隔离原因时重新获得召回资格。
- 每个协作者可手动指定一个主窗，`pinned_at` 只用于列表置顶，不等同于滚动模式。软删除会清除主窗标记与该窗口 wake 记录；已删除窗口禁止通过后续 turn 隐式复活。
- Claude Pro 最近额度按 profile 在 Haven 保存全局单条快照，各窗口共用并显示上次读取时间，新值覆盖旧值
- CC 前台用户 turn 与后台 wake 共用进程内 `SessionTurnCoordinator` 和同一个长寿命 Agent SDK iterator：前台排队优先，后台遇到生成、压缩或待审批直接 deferred；后台取得锁后重新读取当前 Haven 窗口版本，且必须在 Claude transcript 同步与 Haven 严格追加全部完成后才释放会话锁，禁止前台消息在 wake 的 CAS 保存阶段插入。所有 Claude Pro 前台 turn 和 Pro 自动化共用账号级互斥，并在持久 `CLAUDE_CONFIG_DIR` 中使用跨进程/跨容器锁，Pro 后台 wake 遇到其他 Pro 调用时 deferred；回收会话必须调用 SDK `Query.close()` 终止底层 Claude CLI。subscription query 启动时只保存 `.credentials.json` 的不可逆指纹，每轮前发现文件已刷新就关闭旧 query，按原 Claude session 用新凭证 resume，不记录或输出凭证正文；任一 assistant/result 报 `authentication_failed` 或 401 时立即关闭旧 Query，认证错误不写成正常 assistant 记录，后台 wake 同时暂停到下一条用户消息并返回一小时退避；后台 wake 命中现有 `pro_limit` 判定时不写 conversation turn，把额度状态返回 runner 并使用一小时 `Retry-After`，普通前台仍保存用户原话和额度中断状态。后台只恢复 Haven 中 `cc_overrides.active_cred` 对应的最后活跃 lane、固定窗口 handoff、最新热更新提示词与该 lane 的 resume id。协作者提示词、工具或 MCP 定义变化都会更新 request-prefix 指纹，回收旧 iterator 后按原 Claude session `cold_resumed`；闲聊 custom 与工作 preset 都显式设置 `snapshot: false`，确保 SDK 续接旧会话时采用最新 system prompt，固定窗口 handoff 仍保持开窗快照；普通定义变化不复制 transcript。只有 transcript 控制格式版本升级时才一次性 `cold_rebased`：复制原生对话，移除 SDK system 控制记录和 user 文本中的旧 `<system-reminder>`，保留用户/助手正文、thinking、`tool_use`/`tool_result`，原 transcript 不改。内置 MCP 统一登记实例、模型可见定义和管理页目录；开关持久化在 Haven MCP JSON 中，无 URL 的内置服务也能在工具 · MCP 页面启停。`WebSearch` / `WebFetch` schema 在前台、后台及关闭联网开关时始终固定存在，实际联网权限按每轮状态在 `PreToolUse` 拒绝，避免模式切换产生 prompt-cache 分支；每轮只记录 prompt/tools/MCP/迁移版本/options hash、工具名称、lane、CC session 与 iterator 冷热状态，不记录提示词正文。`ombre_agent_wake` v1.2.0 不再提供 server instructions；完整 Wake 行为说明和调用规则合并进始终加载的 `set_agent_wake` 顶层工具 description，MCP 页面关闭后整个服务及说明都不进入上下文。工具同轮最后一次有效决定随 assistant 原文、usage、cache refresh、活动时间和 wake event 原子写入 Haven；后台禁止联网、Bash、写文件及所有需要人工批准的 MCP。No-op wake 可在固定 marker 后带一行最多 30 字的用户可见 skip reason；短文本与 SDK thinking 写入 raw 历史但不生成正式助手气泡。页面显示当前协作者和可选 no-op 原因，SDK thinking 使用独立折叠区，token usage 复用普通消息右下角入口与消耗明细。`set_agent_wake` reason 最多 50 字。Cache refresh 只在成功 result 的 usage 确认 cache read/write 后，按模型请求开始时间计算。
- 正常用户 turn 成功提交时在 Haven 事务内只采样一次 conversation silence timer；下一条用户消息进入模型前原子取消尚未触发的 timer。缓存保活临时暂停会在下一条用户消息进入模型前解除，或在 Claude 正式主动消息成功保存时于同一 Haven 事务解除；后台 no-op、失败和 deferred 不解除。新 assistant 轮次保存版本化 `display_segments`，历史仍保留一轮一条原文；页面可见且空闲时按 round 游标增量刷新后台 wake 消息。
- Haven 每 30 秒按持久 `due_at` claim 后调用 `cc-agent-wake-runner`；Dashboard 只有取得同一 `SessionTurnCoordinator` 的后台门禁后才向 Haven 原子 begin。旧 schedule version、无效 silence 来源、重复 `wake_id`、busy/compacting/待审批、失败退避、过期 lease、24 小时无用户活动和滚动后台 turn 上限均在模型请求前处理；deferred 不生成 wake event。
- Bark profile 配置和密钥只存 Haven，Dashboard 读取只得到掩码；窗口设置只持久化 `bark_notification_enabled` 并显示该 scope 最近状态。可见 agent wake 与 outbox 在 Haven 同一事务提交，no-op 和普通前台回复不推送；通知复用已保存 `display_segments`，首条 active、后续 passive，支持持久重试、AES-128-CBC 正文加密和 `/cc?session_id=...` deep link。
- CC 每轮 Context 快照优先采用 Agent SDK result 的 `modelUsage[当前模型].contextWindow`，同步本轮 usage 和本窗设置的百分比；缺值才按模型名回退到预置上限。selfhost 的 Context 预算另行计算。
- cc 换窗的折叠逐项选择、统一 token 预算、Haven 固定快照及 CC/selfhost 一致注入契约见 `docs/architecture.md`
- 「本窗口设置 → 窗口减负」只处理 Claude transcript 中可重取的 `ombre:<bucket_id>#...` 动态召回，以及 `breath`、`search_chat`、`WebSearch`、`WebFetch` 的纯文字结果；OB 单行引用为“召回内容已清理：title（bucket_id）”，工具结果单行以“已清理：…”标识，原工具调用 block 和完整参数始终保留。用户/助手正文、`date_recall`、报错/非文字结果及名单外工具不得修改。执行时用 Agent SDK `forkSession` 复制会话、只原子改写副本，再由 Haven CAS 切换该 CC lane 的 `cc_session_id`；Dashboard `ob2-*` 窗口 ID 和 `conversation_turns` 不变。每窗口可保存“始终保留”、释放 token 估算和历史；05:30 香港时区自动 runner 默认关闭。固定窗口保持原行为；按天滚动窗口在 RollingSeedStore 版 GC 完成并通过真实验收前，服务端硬性禁止手动减负且自动 runner 无条件跳过。

- CC 闲聊模式使用纯自定义 persona system prompt，不加载 `Read` / `Grep` / `Glob` / `Write` / `Edit` / `Bash` 及 Claude Code preset；工作模式保持完整 Claude Code preset 与文件/命令工具。闲聊可通过 chat-only 内置 MCP `yanzhi`（管理页显示名 `yanzhi's files`）在固定挂载点 `/data/cc-chat-files` 下执行受限 `list` / `search` / `read` / `write` / `patch` / `mkdir`；无 server instructions，管理页关闭后整个定义不进入上下文，且工具拒绝绝对路径、`..`、符号链接越界、删除、移动和命令执行。工作模式不挂这个 MCP，而是由 `builtInWorkDirs()` 把同一挂载点内置追加到 `additionalDirectories` 和写目录（不走协作者配置与 VPS workspace 白名单；未挂载或挂载点是 symlink 时跳过），用原生 Read/Edit/Write/Bash 操作，写入仍按原有批准规则。两种模式写到 `artifacts/*.html|svg` 都会出聊天卡片并进入小作品页，存储时整页 content 统一瘦身为标题 + 字数（`artifactMeta.ts`）。CC 自动记忆（`~/.claude/projects/<cwd>/memory`）只给工作模式：闲聊传 `settings.autoMemoryEnabled: false`，不再收到 `MEMORY.md` 索引附件；该设置不进缓存指纹，已有闲聊窗口历史里的旧附件保持不动。模式或工具定义变化只回收 iterator 并 resume 原会话，不触发 transcript rebase。
- 工作台上传文件写入 `YANZHI_FILES_ROOT`（宿主机挂载卷，持久），不写入 Dashboard 仓库或临时目录。目录权限仍经 `/api/cc-personas` 存 Haven。
- 内置 MCP 权限以 Haven MCP JSON 中的 `builtInPermissions` 持久化，不进入模型表面 hash：Agent Wake 固定自动允许；`yanzhi's files` 默认自动允许，可在 MCP 页切换为每次询问。要完全禁止时直接关闭服务，避免保留无法使用的工具定义。

