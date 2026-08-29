# 架构与实现细节

> 从 CLAUDE.md 拆出的详细实现文档。日常开窗不需要全读，改到对应模块时参考。

## 仓库与部署

- **前端仓库**：github.com/heyeovo/ob-dashboard2
- **OB后端仓库**：github.com/heyeovo/Ombre-Brain
- **部署**：前端与 Haven 均部署在 VPS，由 Coolify 管理

VPS production 使用仓库根目录 `Dockerfile` 多阶段构建，容器内以固定 UID/GID `10001:10001` 的非 root `cc` 用户运行 `npm run start`。运行镜像包含 `curl`，供 Coolify 对公开 `/api/health` 执行容器内 HTTP healthcheck。`/workspace/dashboard`、`/workspace/haven` 和 `/home/cc/.claude` 作为 Coolify bind mount 目标。

## cc 文件工具安全边界

cc 文件工具在 VPS production（`NODE_ENV=production`）只允许 `/workspace/dashboard` 与 `/workspace/haven` 两个根；Persona 未配置读目录时默认 `/workspace/dashboard`，写目录仍为空即全拒。`Read/Grep/Glob/Write/Edit/NotebookEdit` 对已存在目标校验 `realpath`，新目标校验最近已存在父目录的 `realpath`，因此 workspace 内文件/目录 symlink 不能逃到根外；Bash 仍逐次人工批准。本机 `npm run dev` 保留 Windows 绝对路径、按 `process.cwd()` 解析相对路径及空读目录回退本机仓库根的现有方式。

Claude Code 子进程环境从空对象按明确 allowlist 构造，不继承 Dashboard/Haven/数据库/部署平台或其他模型 secret。Linux production 只传运行所需的基础系统变量、`CLAUDE_CONFIG_DIR` 与固定 SDK client 标识；Windows 本机开发另保留系统、用户配置和临时目录等标准路径变量。API 模式只额外传当次选定的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 与主模型 family 映射，未从 Haven 取得覆盖时仍可逐键回退本机 `.env.local`；subscription/OAuth 模式不传任何 `ANTHROPIC_*`，继续使用 Claude 配置目录中的登录状态。

## 认证流程

Dashboard 自身公网入口由根 `proxy.ts` 统一保护。`/login` 只通过 POST body 提交口令；成功后签发 HMAC-SHA256 签名、7 天过期的 `ob2_session` cookie，production 设置 `HttpOnly + Secure + SameSite=Strict + Path=/`。production 缺少或弱化 `DASHBOARD_LOGIN_SECRET` / `DASHBOARD_SESSION_SECRET` 任一项时，私人页面和 API 都返回 503，不默认开放；旧 `?k=` 与明文 `ob2_lan` cookie 不再接受。未配置鉴权变量的本机 `npm run dev` 继续直开，非 production 可用旧 `OB2_LAN_SECRET` 作为兼容登录口令并派生仅开发用签名 key。

登录失败按客户端做指数退避，并有单实例全局失败上限；这部分只属于允许重启丢失的运行态，不作为持久用户数据。登录成功、失败和退出均返回相对 `Location`，避免 Coolify/Traefik 反向代理下把容器内 `localhost:3000` 泄露为浏览器跳转目标。退出入口位于设置页，POST `/api/auth/logout` 清 cookie 与浏览器 cache；轮换 `DASHBOARD_SESSION_SECRET` 会让全部旧 session 失效。公开边界只含登录、`/api/health`、精确 PWA 文件、`/_next/static/*`，以及由自身共享 Bearer token 严格认证的精确 `/api/automation-pro-runner`；其余 Dashboard 页面、cc/批准接口、Gateway/Haven/MCP 代理和私人 API 都校验 session。service worker 只缓存不可变代码资源，不缓存 HTML、API 或私人图片。

Dashboard 到 Haven Brain 的后端认证仍由 `lib/api.ts` 中 `getSessionCookie()` 统一管理，并使用 5 分钟内存缓存避免每次 fetch 重复 POST Haven `/auth/login`；Gateway/cc 持久化调用只由服务端注入 `OMBRE_GATEWAY_TOKEN`，不接受浏览器提供的 Haven 认证头。这与浏览器访问 Dashboard 的 `ob2_session` 是两套隔离凭据。

## 共享组件

### 导航系
| 文件 | 说明 |
|------|------|
| `SideRail.tsx` | 桌面端左侧竖栏（`md:flex`；次级入口含日记、轨迹） |
| `BottomTabBar.tsx` | 手机端底部 5 栏 Tab Bar（主页/记忆库/聊天/工作台/设置，聊天为中间突起） |
| `MemoryViewSwitch.tsx` | 记忆页时间线/记忆格/待处理三格切换 |
| `MobileShell.tsx` | 全站布局容器 |

### 弹窗系
| 文件 | 说明 |
|------|------|
| `DetailPanel.tsx` | 统一弹窗壳：`mode="drawer"` / `mode="modal"` |
| `BucketDetailDrawer.tsx` | 桶详情内容区（噪声标记、moments、关联、年轮、相似记忆、合并预览） |

### UI 原子组件
| 文件 | 说明 |
|------|------|
| `StatusBadge.tsx` | 桶状态标签，导出 `statusLabel()` |
| `TagPill.tsx` | domain/tag 标签胶囊 |
| `DataBadge.tsx` | 数字展示胶囊 |
| `Stat.tsx` | 统计格子 |
| `Card.tsx` | 统一卡片壳（4 variant） |
| `SearchBar.tsx` | 药丸搜索框 |
| `FilterBar.tsx` | 筛选按钮行 + `FilterPill` |
| `KnobRow.tsx` | 评分旋钮滑条 |
| `KnobToggle.tsx` | 评分旋钮开关 |
| `ScoreBar.tsx` | Pipeline 四维评分条 |
| `TimelineDayGroup.tsx` | 时间线按天分组容器 |
| `EntryGrid.tsx` | 记忆格视图网格容器 |
| `HomeToolDrawer.tsx` | 主页工具抽屉 |
| `McpManager.tsx` | MCP 工具管理组件 |
| `ServiceWorkerRegister.tsx` | PWA service worker 注册 |

> 完整设计规范见 `DESIGN.md`。

## API 路由

大部分 route 是简单透传。以下是有特殊处理逻辑的：

| 路径 | 说明 |
|------|------|
| `search/route.ts` | GET — 透传全部 query params（simulate, include_vector, include_noise, limit 等） |
| `historical-chats/route.ts` | GET — 历史聊天只读代理；只允许窗口目录与单窗口原文分页参数 |
| `edit-bucket/route.ts` | POST — 噪声标记/撤销、字段修改、delete:true 软删除 |
| `breath-debug/route.ts` | GET — 模拟 breath 四维评分 |
| `gateway/[...path]/route.ts` | cc 生态总代理 → OB Gateway |
| `haven/[...path]/route.ts` | 通用 OB 后端代理（Haven Brain `/api/*`） |
| `mcp-relay/[...path]/route.ts` | cc MCP 工具调用中继 |
| `provider-relay/route.ts` | 上游 provider 测试中继 |
| `cc-chat/route.ts` | cc 聊天主入口：SSE 流式执行，幂等预检/重放，写入成功后才完成 |
| `cc-chat-selfhost/route.ts` | 自建聊天入口：无状态链路，服务端读取配置/历史/MCP，直连 SSE |
| `cc-attachments/route.ts` + `[id]/route.ts` | 图片/文件上传、私有读取与分类清除 |
| `cc-turns/route.ts` | 会话轮次 + Haven 窗口状态 |
| `cc-stop/route.ts` | 停止生成（保留已生成部分） |
| `cc-compact/route.ts` | 复用在线空闲 CC 会话发送 `/compact` |
| `cc-personas/route.ts` | 协作者配置 |
| `cc-upstream/route.ts` | 上游模型配置 |
| `cc-mcp/route.ts` | MCP 工具配置 |
| `cc-permission/route.ts` | 写权限批准 |
| `cc-session-settings/route.ts` | 本窗会话配置 |
| `cc-pro-usage/route.ts` | Pro 用量读取 |
| `automation-pro-runner/route.ts` | 日回顾/每周轨迹 Claude Pro 单次执行入口 |
| `cc-web-settings/route.ts` | web 工具开关 |
| `cc-workbench/route.ts` | 工作台数据 |
| `cc-polaris-import/route.ts` | Polaris 聊天历史导入 |
| `care/[...path]/route.ts` | 照顾备忘/待办 |
| `persona/route.ts` | 用户画像状态 |
| `daily-chat-memory/route.ts` | 每日聊天记忆 |
| `daily-reviews/route.ts` | 日回顾列表、手动微调与指定日期生成代理 |
| `journeys/route.ts` + `[id]/route.ts` | 关系轨迹目录、详情与认证人工纠错代理 |
| `automations/[...path]/route.ts` | 自动化白名单代理 |
| `auth/login/route.ts` + `auth/logout/route.ts` | 公网登录/退出 |
| `health/route.ts` | 公开存活检查 |

其余 route（buckets、bucket/[id]、add-bucket、journal、to-journal、config、prompts、touch、archive、review-status、import-*、trash、scoring-config、hit-stats、recent-searches 等）均为透传代理。

## 页面

| 路径 | 说明 |
|------|------|
| `page.tsx` | 主页面（时间线/记忆格，噪声筛选 + 乐观更新） |
| `memory/page.tsx` | 记忆库页（时间线/记忆格/待处理三格切换） |
| `cc/page.tsx` | 聊天主页（cc/selfhost 可切换，Vercel 强制 selfhost；SSE/严格保存、引擎/Provider/模型/上下文展示、附件、转发、历史聊天） |
| `workbench/page.tsx` | 工作台（批准执行 + 四格面板） |
| `settings/page.tsx` | 设置聚合页 |
| `login/page.tsx` | 登录页 |
| `settings/upstream/page.tsx` | 上游模型配置 |
| `settings/memory-processing/page.tsx` | 记忆处理设置 |
| `settings/models/page.tsx` | 召回/自动记忆/日回顾模型设置 |
| `settings/recall/page.tsx` | 召回设置 |
| `settings/automation/page.tsx` | 自动化与状态 |
| `persona/page.tsx` | 用户画像 |
| `impressions/page.tsx` | 日回顾月历 |
| `care/page.tsx` | 照顾备忘 + 待办 |
| `breath-sim/page.tsx` | 5 Tab Pipeline 模拟 |
| `graph/page.tsx` | 关系图谱 |
| `journal/page.tsx` | 日记页 |
| `journey/page.tsx` | 关系轨迹页 |
| `import/page.tsx` | 导入工作台 |
| `trash/page.tsx` | 回收站 |
| `prompts/page.tsx` | 产品 Prompt 配置 |
| `cc/import/page.tsx` | cc 会话导入 |
| `tools/mcp/page.tsx` | MCP 工具管理页 |

## `app/lib/`

`havenConfig.ts`：Haven/Gateway 服务端运行时配置、URL 校验/拼接、production loopback 拒绝和错误 secret 擦除。`api.ts`：`getSessionCookie()`（带 5min 缓存）、`clearSessionCookie()`、`getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`。

cc 生态客户端库：`ccMcp*`、`ccModes.ts`、`ccChannel.ts`、`ccSession.ts`、`ccEnv.ts`、`ccDirs.ts`、`haven*`（Personas/Upstream/Turns/Attachments/Recall/Permissions）、`attachments/*`（PDF/DOCX/CSV/纯文本解析）、`cc/runTurn.ts`、`cc/ccOptions.ts`、`cc/ccHistory.ts`、`cc/processCollector.ts`、`cc/sseEvents.ts`、`cc/turnState.ts`、`selfhost/mcp.ts`、`polarisExport.ts`、`format.ts`、`ccDiff.ts`。

## 噪声系统

噪声 = `resolved=true AND importance=1`。标记时保存 `importance_before_noise`；撤销时自动恢复。`search()` 默认排除，`include_noise=true` 可包含。

## 回收站

软删除：文件移到 `buckets/trash/`，保留 `original_type` + `trashed_at`。

## 相似记忆与合并

1. BucketDetailDrawer 打开时自动查询 top 5 相似桶
2. 点击「合并预览」→ POST merge-preview → LLM 生成合并结果 + 费用估算
3. 弹窗三栏对比（A 源 / B 目标 / 合并结果）
4. 确认 → POST merge-commit → 更新 B 内容+元数据，删除 A

## 桶详情可观测性

`BucketDetailDrawer` 打开普通桶时通过 `/api/moments?bucket_id=...` 读取派生 moments、桶内 moment 边和带目标桶名称的跨桶边，并从桶 metadata 单独展示年轮。跨桶目标链接到 `/memory?bucket=...` 自动打开对应桶。

## 乐观更新

主页对 touch、archive、noise 标记等操作使用乐观更新，先改 UI 再等后端确认。

## 会话 Cookie 缓存

`getSessionCookie()` 5min 内存缓存。避免每次 API 请求重复 POST `/auth/login`。

## Prompt 配置

Prompt 页面以 Haven `/api/prompts` 为唯一事实源，不使用 `sessionStorage` 或浏览器持久化。每项携带 `source/customized/revision/updated_at`，以及只读的 `runtime_layers/model_hard_constraints/server_validations`；页面把可编辑产品层、运行时自动叠加、实际模型固定约束和模型返回后程序校验分区展示，后三区不能编辑。保存和恢复默认都带 expected revision，冲突时要求刷新，不静默覆盖。只有自动打标和记忆合并提供草稿试跑，日回顾和 weekly journey 不创建测试记录或候选。自动打标的模型运行参数来自「记忆处理」页面现有 dehydration 配置，不在 Prompt 页面重复维护。

## cc 聊天架构

"本窗口设置"同时显示 Prompt cache 的 1 小时系统缓存与 5 分钟会话缓存倒计时估算。

协作者的基础提示词可独立编辑；其余长期提示词按模块保存到 Haven，每条包含名称、正文、排序位置和"新窗口默认开启"状态。旧的单一 `prompt` 会无损显示为一个默认开启模块，保存后迁入新结构。协作者设置页负责新增、编辑、排序、删除和全局默认，聊天输入框「＋ → 提示词模块」只保存当前窗口的启停覆盖。窗口覆盖缺省时跟随协作者默认。

新对话与换窗共用折叠选择弹窗，分为日回顾、全量钉选桶、最近记忆、feel、journal 和旧窗口聊天原文；每组可逐项勾选并有独立的全选/全不选。只有钉选桶默认全选，其余默认全不选；日回顾默认展示最近 5 天、可调 0–366 天，最近记忆、feel、未锁定且有正文的 journal、旧聊天候选数量均可输入任意非负整数，不设 50 轮上限，旧聊天由 Dashboard 经 Haven 500 条一页完整分页后展示。弹窗显示每组及总计的字数与统一预估 token；handoff 预算为 100,000 预估 token，超出时明确警告，逐项选择的非聊天资料优先保留，聊天从最新轮次向前装入，最终恢复时间正序。确认后把裁剪完成的统一正文和统计作为窗口固定快照首次写入 Haven `conversation_sessions`，后续不得覆盖；CC 每条原生线路启动时与无状态 selfhost 每轮都读取同一份快照，因此切引擎、重启或换设备不会丢失或重新筛选。

订阅、API 中转站和 selfhost 共用同一份协作者基础提示词；默认值是原 cc 闲聊模式提示词。cc 工作模式仍保留 Claude Code preset，再追加同一份协作者配置。最终都按"协作者基础 system + 定位 + 当前有效提示词模块 + 记忆"组装，每个模块以 `【模块名称】` 开头。selfhost 每轮重组；cc 对协作者配置组合计算启动指纹，内容变化时回收空闲 SDK query，并用原 Claude session resume。换窗 handoff 不计入该指纹。每轮隐藏运行时信息直接提供北京时间和中文星期。

### cc-chat/route.ts

cc SSE 流式入口，内部拆 `runTurn` / `ccOptions` / `ccHistory` + `processCollector` + 一轮状态机。要求 `request_id + expected_last_round_id + persona_id`；执行前查询 Haven 幂等记录，命中则重放，模型生成后以严格 compare-and-append 写入，Haven 成功后才发送 `done`。

CC Pro (`subscription`) 与每个 CC API provider (`api:<provider_id>`) 分别从 Haven `cc_lanes` 恢复自己的 Claude 原生 session 和 `seen_round_id`，切换线路时回收空闲 query。订阅模型 ID 原样交给 Claude Code，不改写成动态别名；只有 API provider 的 Opus 4.6 模型继续使用内部映射。目标线路游标之后的全部成功文字轮次作为 `<上次聊到这里>` 补入下一条 SDK user message；thinking、图片与文件不补入。浏览器断连后子进程会被回收。

### cc-chat-selfhost/route.ts

无状态聊天链路：浏览器只提交 `session_id`、`request_id`、`expected_last_round_id`、`persona_id` 和当前正文；服务端从 Haven 读取一切配置。`lib/selfhost/` 负责 Persona → recall、保守上下文预算、Anthropic-compatible `/v1/messages` 请求与 SSE 解析，以及远程 MCP 工具循环：只连接已启用的 HTTP/SSE server，一轮最多 8 次工具调用。预检阶段 GET 连接异常短暂重试一次；HTTP 错误、写入和主动取消不重试。

### 前端消费

`useCcChat.ts` + `ccSseConsumer.ts` 统一消费两种引擎的 `start / recall / context / init / thinking / delta / usage / done / error`。`local_engine_preference` 与窗口固定 `handoff_snapshot` 存 Haven，Vercel 只在运行时强制 `effective_engine=selfhost`。CC Pro、CC API 和 selfhost 各自保留供应商/模型选择，空闲时可在同一窗口人工往返。

Pro 订阅线路收到 SDK `rate_limit_event: rejected` 或额度耗尽时，按可保存的中断终态处理：用户原话与已有半截回复原子写入 Haven，`raw_json.interrupted_reason=pro_limit`。普通 provider、断流和其他上游错误不保存，但 SDK 非成功 `result` 会原样保留已生成正文和工具过程。CC thinking 开启时，对 Opus/Sonnet 4.6+ 显式使用 `adaptive + summarized`；关闭时显式 `disabled`。中途切换 thinking 会保留线路原生 session、回收空闲 query。

selfhost thinking：中转站若把 `<thinking>` / `<think>` 放进 `text_delta`，流式解析器会跨 chunk 剔除该区段。

### 附件

图片：JPEG/PNG/WebP，原图上限 25MB，每轮最多 4 张，浏览器缩到 2000px + WebP，上传硬上限 2MB。Haven 保存压缩文件和元数据。cc 组装 Agent SDK image block，selfhost 组装 base64 block 并只重放最近 2 个图片轮次。图片不进入 handoff 或跨引擎补齐。

文件：PDF/DOCX/MD/TXT/CSV，单个原文件上限 4MB。解析正文作为带边界的用户资料文本发送，不进入长期记忆或召回。每轮图片与文件合计最多 4 个。

### 消息转发

普通窗口与历史聊天支持选择可见正文作为转发块放入输入框；桌面端右上角"选择"，手机端长按消息进入。转发原文以边界标签随 user text 保存，消息行解析成紧凑转发卡片。

## Coolify 手动发布

- VPS Dashboard 的 Coolify Application 来源为 Public GitHub `heyeovo/ob-dashboard2`、分支 `main`、`Auto deploy` 关闭
- 发布：Coolify `Actions → Redeploy`；部署完成后检查 commit、healthcheck 和关键功能
- 回滚：`Git Source → Commit SHA` 填入上一 SHA，保存后 `Redeploy`

## 待办

统一维护在 `TECH_DEBT.md`。
