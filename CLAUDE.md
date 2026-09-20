@docs/architecture.md
# ob-dashboard2

Ombre Brain 记忆系统前端看板。Next.js 16 App Router + Tailwind CSS + TypeScript。前端与 OB 后端（Haven）均部署在 VPS，由 Coolify 管理。

## 启动

```bash
npm install
npm run dev      # localhost:3000
npm run build && npm run start   # 生产构建
```

VPS production 使用根目录 `Dockerfile` 多阶段构建，容器内非 root 用户运行。

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

## 文件结构速查

| 目录/文件 | 说明 |
|-----------|------|
| `app/page.tsx` | 主页（时间线/记忆格） |
| `app/memory/` | 记忆库（三格切换） |
| `app/cc/` | 聊天主页（cc / selfhost）；手机端默认进入对话列表，可手动指定每个协作者唯一主窗，点入窗口后聊天，历史聊天与已删除窗口分子列表；支持同一时间线按日期跳转，以及在本窗口设置中手动维护“原换窗 / 按天滚动”的原文、日回顾、不带三态拼接和钉选桶、日记、最近普通桶、feel、随机高重要度桶长期层；损坏的滚动窗口可经二次确认舍弃旧原生细节并用当前 raw 日期的 Haven 正文重建 transcript，不复制窗口或页面历史；从滚动切回固定模式会提示用“换窗继续”保留最新衔接；召回按钮显示完整注入的估算 token，详情弹窗分别标明完整注入与卡片/日期正文 token |
| `app/workbench/` | 工作台；“调参”下提供默认收起的本轮上下文审计，按当前会话只读展示滚动原文、各长期层的已保存/实际生效 ID、背景拼接、SDK SessionStore 实际落盘的文本/召回/`tool_use`/`tool_result`、正文恢复标记、最近一次持久重建凭据、最近实际与当前/下一轮 Dashboard system prompt、Claude 工具名称，以及安全去密后的 MCP instructions/description/input schema、最近实际/当前定义 hash 和模型表面的上一版/本轮期望/iterator 启动指纹，不触发额外模型请求 |
| `app/conversation-slices/` | 聊天切片检查：按日期和 session 查看离线切片、永久消息原文、版本/状态与任务；支持批准/拒绝、原因备注、重切、单日 slice-only 生成及先估算后创建的历史任务，手机端先日期列表再钻取详情；切片不进入 Context |
| `app/recall-lens/` | 召回透镜（按 session 查看 necessity、统一 relevance、utility 三档、最终生效单卡结果、完整审核候选、保留资格但未获单卡位的候选、检索来源/检索分/无 freshness 排序分，以及 explicit/contextual 语义查询故障降级证据） |
| `app/settings/` | 设置聚合页及子页 |
| `app/impressions/` | 日回顾月历 |
| `app/journal/` | 日记页 |
| `app/journey/` | 关系轨迹页 |
| `app/components/` | 共享组件 |
| `app/api/` | API 路由（大部分透传 Haven）；`edit-bucket` 保留上游状态码并转换非 JSON 错误；`cc-chat` / `cc-chat-selfhost` 在固定模式沿用 handoff；滚动模式把手动选定的日回顾、实时钉选桶和日记放入背景 Context，把原文日期从 Haven 永久消息重建为真正的 `user/assistant` 对话流，CC 冷启动不续接旧包装版原生会话，且非首次明确迁移时缺少完整 transcript 必须 fail closed；`cc-rolling-recovery` 只在用户精确确认当前窗口后，从当前 raw 日期的 Haven 正文先物化全新持久 transcript，再以旧 session ID + state version CAS 原子切换当前活跃 lane；`cc-context-audit` 复用同一滚动拼接器返回当前会话选入的 Haven 原文和背景正文，只读检查持久滚动 transcript、原文逐条匹配及包装命中，并读取模型请求前单独落盘的 Dashboard system prompt 快照、当前热更新重建结果及最近一轮白名单化 SDK 诊断，不截获 OAuth/原始 HTTP 请求；`cc-diagnostics/rolling-ab` 复用 wake runner Bearer，仅以目标窗口的 rolling transcript 内存副本对照普通 fresh query 与 `SessionStore + resume`，不写回正式 rolling store，也不返回凭证正文；`cc-agent-wake` 以 CAS 管理当前窗口 wake/silence/Bark 开关；`cc-agent-wake-runner` 以独立 Bearer 接受 Haven 的持久 wake callback，认证失败时暂停该窗口自动唤醒并返回一小时 `Retry-After`，Pro 额度耗尽时同样返回一小时退避但不保存额度提示为 wake 消息；`cc-notifications` 服务端代理 Bark 掩码配置、最近状态与测试推送；`cc-turns` 支持按 `after_round_id`、`chat_days` 读取消息，读写滚动上下文、主窗置顶，并以 `offset + total` 分页区分活动/软删除窗口；`conversation-slices` 以 Dashboard Cookie 代理 Haven 的离线切片检查、额度估算和任务/人工反馈接口，不参与召回或 Context |
| `app/api/cc-context-audit/` | 滚动窗口额外只读预检双向对齐：除隔离的失败/中断半截轮次、失败类别及无正文候选记录的序号/UUID/主动唤醒标记外，还列出当前原文中缺少旧 transcript 完整轮次的 Haven ID、日期、时间及重建是否要求完整原生轮次（不返回诊断正文）；同时返回长期层已保存/实际生效 ID、Claude 工具名称、安全去密后的当前 MCP 模型表面，以及最近实际/当前工具和 MCP hash、Agent Wake 版本与 instructions hash、模型表面的上一版/期望/iterator 启动指纹和 `cold_rebased` 状态；无用户/助手正文且无旧 transcript 轮次的空唤醒另计数，不列为缺失完整轮次；紧接 wake 的旧前台并发轮次若能按十分钟内唯一最近 Haven 输入恢复关联则单独计数，同期完全未写入 Haven且双方正文各不超过 200 字的一问一答纯文字错误轮次另计隔离数；主动唤醒期间由 CLI/SDK 返回的 session-limit 状态另计排除数，保留 Haven 审计记录但不进入模型 transcript；不生成新版本、不修改设置或会话指针。 |
| `app/lib/` | 客户端库与工具函数；`recallDisplay.ts` 统一召回 token 估算与模块拆分，`havenPersonas.ts` 每轮按 Haven 最新配置拼装基础提示词、“关于我”和可热更新提示词模块；召回背景使用规则由提示词模块维护，动态正文不重复说明 |
| `globals.css` | 设计 Token 定义 |
| `DESIGN.md` | 完整设计规范 |

## 设计规范

凡涉及页面、组件、布局、样式或交互的任务，修改前必须完整阅读 `DESIGN.md`。优先复用现有组件；颜色、边框、背景、圆角、阴影和动效必须使用现有设计 Token，禁止硬编码或自行拼装重复组件。确实缺少语义 Token 时，先更新 `globals.css` 和 `DESIGN.md`，再使用。

`CLAUDE.md` 是本仓库唯一的顶层项目规则入口，不另建内容重复的 `AGENTS.md`。完整设计规范见 `DESIGN.md`。

## 移动端优先

手机是主要使用场景，新功能和样式调整优先保证手机端体验。

## 组件约定

- **弹窗**：统一使用 `DetailPanel`（`mode="drawer"` 右侧滑入，`mode="modal"` 居中弹出）
- **卡片**：统一使用 `Card`（variant: interactive / outline / ghost / empty）
- **导航**：桌面端 `SideRail` 左侧竖栏，手机端 `BottomTabBar` 底部 5 Tab，全站 `MobileShell` 包裹
- **聊天导航**：手机端点击聊天 Tab 回到 `/cc` 对话列表；具体 session deep link 仍直接进入聊天。桌面端继续使用左侧会话栏
- **Next.js 动态路由**：params 是 Promise，必须 `const { id } = await params`

## 协作规范

- 先讨论后动手：高风险改动先列清单等确认；单文件小改可直接执行
- 不扩散修改范围：用户说改什么只改什么
- 排障用假设→验证，先问用户再翻代码
- 结论导向，不贴大段代码走查
- Git：CC 可直接 commit + push；`main` push 后由 Coolify 自动部署，需确认 deployment 成功
- 换窗交接：一个窗口一个问题，换窗前更新 handoff

## Token 控制

Pro 额度有限（200k context），工作窗口必须节省 token：

- 读文件先 Grep 定位行号，再 Read offset+limit 只读需要的区域
- 多次编辑同一文件不重复 Read
- git diff / build 输出过长时 `| head -80` 截断
- 回复不贴大段未修改代码
- 预判超 25 轮时主动建议拆窗口

## cc 数据持久化

- 长期配置由 Haven 持久化，不得用 `process.cwd()`、`.data`、`/tmp` 或模块全局变量作唯一存储
- 进程内状态只用于允许丢失的运行态
- `localStorage` 只用于换设备后丢失也没关系的界面偏好
- 含密钥配置只能服务端读写，浏览器只接收掩码
- CC 只把窗口创建时选定的统一 handoff 固定在 Haven；没有 handoff 的历史窗口才读取旧独立日回顾快照，二者不同时注入。协作者基础 system、定位、提示词模块及 session 静态信息每轮按最新配置重组，不从旧 `frozen_persona_append` 恢复整串。
- 每个已保存 user/assistant 消息使用 Haven 分配的永久 `msg_*` ID，并保存按窗口日界线计算的 `chat_day`。滚动配置、revision 和保存时的 turn watermark 均持久化在 Haven；CC 的原生 resume key 必须包含 revision，禁止新配置续接旧 revision。滚动原文不再序列化进 `rolling_window_context`：CC 冷启动先把持久 RollingSeedStore 物化到真实 `CLAUDE_CONFIG_DIR/projects` 原生 transcript，再只用普通 `resume` 启动；禁止把 `SessionStore` 传给长期 query，避免 SDK 临时配置目录中的 OAuth 凭证副本缺少 refresh token。成功轮次把原生 transcript 原子同步回 RollingSeedStore，跨部署仍可恢复；前台用户 turn 和后台 wake 在 Haven 成功事务中同时保存本轮原生 user UUID，revision 重建优先用该 UUID 精确绑定 Haven turn，并把 turn ID 固化进新 transcript，禁止恢复后新增轮次再次退化为正文/时间猜测。普通轮保持真实 `user/assistant`，Haven 中 assistant-only 的 `agent_wake` 还原为隐藏 `<agent_wake/>` 输入再接原 assistant 消息；selfhost 直接以原生 messages 重建。日回顾、钉选桶和日记仍属于背景 Context。所有新 seed 都必须在 SDK 启动及 Haven 发布新 session ID 前原子落盘，并在每个生成的 envelope 写入对应 Haven turn ID；同 revision 冷恢复若专用 RollingSeedStore 缺失，先以 SDK 官方 `importSessionToStore` 原样补回默认 transcript，标记为 `legacy_transcript_recovery`，两份原生来源都不存在时 fail closed，禁止静默用 Haven 正文重建。前台用户 turn 与后台 wake/cache keepalive 必须使用同一套 rolling revision/source 判定；只有当次确实为 fixed→rolling 且用户已明确同意时，才允许 Haven 正文生成 `new_seed`，其他任何有历史的滚动冷启动无完整 seed 均立即停止。首次 fixed→rolling 同样读取固定窗口默认 transcript，再按完整轮次和 Haven `chat_day` 迁入 RollingSeedStore，保留 raw 日期的召回、工具调用/结果和顺序；每次生成新 revision seed 时只保留最新一个有消息的 raw `chat_day` 的 `thinking` / `redacted_thinking`，较早 raw 日期删除已完成轮次的 thinking，未闭合工具链保持不动。旧 transcript 缺失或部分 raw 轮次无法对齐时，只有用户在设置保存时明确允许，才可对缺失部分使用 Haven 正文恢复。同 revision 跨进程从持久 RollingSeedStore 恢复；后续 revision 变化只删除退出 raw 的整轮，并按上述 thinking 规则保留其余轮次。Haven 同时记录上一 revision 的策略和日期模式；上一版 review/omit→本版 raw 的日期允许正文恢复；重建 user 消息时按正常位置在正文尾部补 Haven `created_at` 对应的北京时间戳，`agent_wake` 优先使用 `raw_json.agent_wake.at`，模型正文不显示恢复提示。重建对齐依次使用 envelope 的 Haven turn ID、Haven 原子保存的原生 user UUID；只有两者都不存在的真正旧记录才允许用 transcript 用户进入时间与 Haven 完成时间消除重复正文歧义，仍不唯一则 fail closed。daily→daily、迁移类型未知、旧 session/持久 transcript 缺失、轮次无法唯一对应，或任一 raw→raw 轮次缺失时均 fail closed；成功重建的来源、条数、工具/召回数量、正文恢复数与 thinking 清理 block 数随首轮写入 Haven，审计页可长期复核。设置页明确提示重新加入日期的降级。选为原文的可见日期只排除这些日期内已召回/新建的桶；日回顾或不带日期退出排除集合。钉选桶每轮从 Haven 读取最新正文，不冻结进 handoff。
- 滚动 revision 对齐时，已有 Haven turn ID 或原生 user UUID 是权威关联，不再被展示正文差异否决。SDK/CLI 在工具回合后注入的固定“无可见输出请续写”提示，以及中断后固定的标记/续写提示，只在有前一真实轮次可锚定时归入该轮 envelope；原始 transcript 消息、工具顺序和正文不改写，孤立提示仍按异常处理。已有滚动窗口中，无 Haven 关联的 user-only 失败半截输入可隔离；另仅对“真实用户输入 → 固定中断提示 → 固定续写提示 → 唯一状态回复 `No response requested.`”且没有工具、图片、thinking 等其他内容、没有可对应 Haven 完整轮次的精确失败形状，在新 revision 副本中隔离，旧存档不删。固定→滚动首次迁移不得据此跳过来源。Haven 中用户/助手正文均为空、且旧 transcript 没有对应 envelope 的 `agent_wake` 保留在 Haven，但不虚构模型可见轮次，也不阻塞 raw 日期重建；已有 transcript envelope 的唤醒仍原样保留。主动唤醒期间持久化的明确 Claude session-limit 文案属于 CLI/SDK 额度状态而非模型回答：Haven 记录保留供审计，但无论旧 transcript 是否有对应 envelope 都不进入新 revision，也不阻塞 raw 日期重建。旧版 wake/前台并发导致紧接 wake 的一条完整前台 envelope 已落 transcript、但 Haven 同输入保存了不同助手正文时，仅允许绑定到进入时间后十分钟内唯一最近且顺序可行的非 wake Haven turn；重建仍原样保留 transcript envelope，并把对应 turn ID 固化供后续 revision 使用。若该时间范围内完全没有 Haven 候选，只有恰好一条普通 user 文字和一条纯文字 assistant、双方正文各不超过 200 字，且不含工具、图片、附件、thinking 等 block 的简单错误 envelope 才允许从新 revision 副本隔离，旧 transcript 不改；其他正文分叉继续 fail closed，报错只输出类别和数量，不输出聊天正文。
- 每个协作者可手动指定一个主窗，`pinned_at` 只用于列表置顶，不等同于滚动模式。软删除会清除主窗标记与该窗口 wake 记录；已删除窗口禁止通过后续 turn 隐式复活。
- Claude Pro 最近额度按 profile 在 Haven 保存全局单条快照，各窗口共用并显示上次读取时间，新值覆盖旧值
- CC 前台用户 turn 与后台 wake 共用进程内 `SessionTurnCoordinator` 和同一个长寿命 Agent SDK iterator：前台排队优先，后台遇到生成、压缩或待审批直接 deferred；后台取得锁后重新读取当前 Haven 窗口版本，且必须在 Claude transcript 同步与 Haven 严格追加全部完成后才释放会话锁，禁止前台消息在 wake 的 CAS 保存阶段插入。所有 Claude Pro 前台 turn 和 Pro 自动化共用账号级互斥，并在持久 `CLAUDE_CONFIG_DIR` 中使用跨进程/跨容器锁，Pro 后台 wake 遇到其他 Pro 调用时 deferred；回收会话必须调用 SDK `Query.close()` 终止底层 Claude CLI。subscription query 启动时只保存 `.credentials.json` 的不可逆指纹，每轮前发现文件已刷新就关闭旧 query，按原 Claude session 用新凭证 resume，不记录或输出凭证正文；任一 assistant/result 报 `authentication_failed` 或 401 时立即关闭旧 Query，认证错误不写成正常 assistant 记录，后台 wake 同时暂停到下一条用户消息并返回一小时退避；后台 wake 命中现有 `pro_limit` 判定时不写 conversation turn，把额度状态返回 runner 并使用一小时 `Retry-After`，普通前台仍保存用户原话和额度中断状态。后台只恢复 Haven 中 `cc_overrides.active_cred` 对应的最后活跃 lane、固定窗口 handoff、最新热更新提示词与该 lane 的 resume id。协作者提示词、工具或 MCP 定义变化都会更新 request-prefix 指纹，回收旧 iterator 后按原 Claude session `cold_resumed`，让顶层 system/tools 自然重建缓存；普通定义变化不复制 transcript。只有 transcript 控制格式版本升级时才一次性 `cold_rebased`：复制原生对话，移除 SDK system 控制记录和 user 文本中的旧 `<system-reminder>`，保留用户/助手正文、thinking、`tool_use`/`tool_result`，原 transcript 不改。内置 MCP 统一登记实例、模型可见定义和管理页目录；开关持久化在 Haven MCP JSON 中，无 URL 的内置服务也能在工具 · MCP 页面启停。`WebSearch` / `WebFetch` schema 在前台、后台及关闭联网开关时始终固定存在，实际联网权限按每轮状态在 `PreToolUse` 拒绝，避免模式切换产生 prompt-cache 分支；每轮只记录 prompt/tools/MCP/迁移版本/options hash、工具名称、lane、CC session 与 iterator 冷热状态，不记录提示词正文。`ombre_agent_wake` v1.2.0 不再提供 server instructions；完整 Wake 行为说明和调用规则合并进始终加载的 `set_agent_wake` 顶层工具 description，MCP 页面关闭后整个服务及说明都不进入上下文。工具同轮最后一次有效决定随 assistant 原文、usage、cache refresh、活动时间和 wake event 原子写入 Haven；后台禁止联网、Bash、写文件及所有需要人工批准的 MCP。No-op wake 可在固定 marker 后带一行最多 30 字的用户可见 skip reason；短文本与 SDK thinking 写入 raw 历史但不生成正式助手气泡。页面显示当前协作者和可选 no-op 原因，SDK thinking 使用独立折叠区，token usage 复用普通消息右下角入口与消耗明细。`set_agent_wake` reason 最多 50 字。Cache refresh 只在成功 result 的 usage 确认 cache read/write 后，按模型请求开始时间计算。
- 正常用户 turn 成功提交时在 Haven 事务内只采样一次 conversation silence timer；下一条用户消息进入模型前原子取消尚未触发的 timer。缓存保活临时暂停会在下一条用户消息进入模型前解除，或在 Claude 正式主动消息成功保存时于同一 Haven 事务解除；后台 no-op、失败和 deferred 不解除。新 assistant 轮次保存版本化 `display_segments`，历史仍保留一轮一条原文；页面可见且空闲时按 round 游标增量刷新后台 wake 消息。
- Haven 每 30 秒按持久 `due_at` claim 后调用 `cc-agent-wake-runner`；Dashboard 只有取得同一 `SessionTurnCoordinator` 的后台门禁后才向 Haven 原子 begin。旧 schedule version、无效 silence 来源、重复 `wake_id`、busy/compacting/待审批、失败退避、过期 lease、24 小时无用户活动和滚动后台 turn 上限均在模型请求前处理；deferred 不生成 wake event。
- Bark profile 配置和密钥只存 Haven，Dashboard 读取只得到掩码；窗口设置只持久化 `bark_notification_enabled` 并显示该 scope 最近状态。可见 agent wake 与 outbox 在 Haven 同一事务提交，no-op 和普通前台回复不推送；通知复用已保存 `display_segments`，首条 active、后续 passive，支持持久重试、AES-128-CBC 正文加密和 `/cc?session_id=...` deep link。
- cc 换窗的折叠逐项选择、统一 token 预算、Haven 固定快照及 CC/selfhost 一致注入契约见 `docs/architecture.md`
- 「本窗口设置 → 窗口减负」只处理 Claude transcript 中可重取的 `ombre:<bucket_id>#...` 动态召回，以及 `breath`、`search_chat`、`WebSearch`、`WebFetch` 的纯文字结果；OB 单行引用为“召回内容已清理：title（bucket_id）”，工具结果单行以“已清理：…”标识，原工具调用 block 和完整参数始终保留。用户/助手正文、`date_recall`、报错/非文字结果及名单外工具不得修改。执行时用 Agent SDK `forkSession` 复制会话、只原子改写副本，再由 Haven CAS 切换该 CC lane 的 `cc_session_id`；Dashboard `ob2-*` 窗口 ID 和 `conversation_turns` 不变。每窗口可保存“始终保留”、释放 token 估算和历史；05:30 香港时区自动 runner 默认关闭。固定窗口保持原行为；按天滚动窗口在 RollingSeedStore 版 GC 完成并通过真实验收前，服务端硬性禁止手动减负且自动 runner 无条件跳过。

## 文档与部署

- 代码改动完成后按 `MAINTENANCE_CONTRACT.md` 确认需同步的文档
- 排入后续窗口的工作写入 handoff；短期不处理的遗留写入 `TECH_DEBT.md`
- `main` push 后由 Coolify 自动部署；需确认最新 deployment 对应目标 commit 且健康，未触发或失败时再手动 Redeploy
- 每次任务收尾主动告知是否需要上线

> 详细实现参考 `docs/architecture.md`
