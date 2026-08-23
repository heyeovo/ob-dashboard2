@AGENTS.md
# ob-dashboard2 开发文档

> 供新窗口快速了解项目全貌，开窗口时 fetch 此文件。

## 项目概述

ob-dashboard2 是 Ombre Brain 记忆系统的前端看板，Next.js 16 App Router + Tailwind CSS + TypeScript。当前线上版本部署在 Vercel，仓库同时提供 VPS production Docker 构建与启动配置；OB 后端（Python FastMCP + Starlette）部署在 Zeabur。

- **前端仓库**：github.com/heyeovo/ob-dashboard2
- **OB后端仓库**：github.com/heyeovo/Ombre-Brain
- **Vercel 域名**：ob-dashboard2.vercel.app
- **Zeabur 域名**：https://foryan.zeabur.app

## 启动

```bash
npm install
npm run dev      # 本地开发 → http://localhost:3000
npm run build    # 生产构建
npm run start    # 启动已经完成 build 的生产服务器
```

VPS production 使用仓库根目录 `Dockerfile` 多阶段构建，容器内以固定 UID/GID `10001:10001` 的非 root `cc` 用户运行 `npm run start`。运行镜像包含 `curl`，供 Coolify 对公开 `/api/health` 执行容器内 HTTP healthcheck。`/workspace/dashboard`、`/workspace/haven` 和 `/home/cc/.claude` 作为 Coolify bind mount 目标；本机开发继续使用 `npm run dev`，不通过 Docker 启动。

cc 文件工具在 VPS production（`NODE_ENV=production`）只允许 `/workspace/dashboard` 与 `/workspace/haven` 两个根；Persona 未配置读目录时默认 `/workspace/dashboard`，写目录仍为空即全拒。`Read/Grep/Glob/Write/Edit/NotebookEdit` 对已存在目标校验 `realpath`，新目标校验最近已存在父目录的 `realpath`，因此 workspace 内文件/目录 symlink 不能逃到根外；Bash 仍逐次人工批准。本机 `npm run dev` 保留 Windows 绝对路径、按 `process.cwd()` 解析相对路径及空读目录回退本机仓库根的现有方式。

Claude Code 子进程环境从空对象按明确 allowlist 构造，不继承 Dashboard/Haven/数据库/部署平台或其他模型 secret。Linux production 只传运行所需的基础系统变量、`CLAUDE_CONFIG_DIR` 与固定 SDK client 标识；Windows 本机开发另保留系统、用户配置和临时目录等标准路径变量。API 模式只额外传当次选定的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 与主模型 family 映射，未从 Haven 取得覆盖时仍可逐键回退本机 `.env.local`；subscription/OAuth 模式不传任何 `ANTHROPIC_*`，继续使用 Claude 配置目录中的登录状态。

## 环境变量（.env.local）

```
# Dashboard 服务端连接 Haven（production 三项必须配置）
HAVEN_GATEWAY_URL=<Haven 基础 URL，不带末尾斜杠>
OMBRE_SESSION=<Haven Brain 登录密码>
OMBRE_GATEWAY_TOKEN=<Haven Gateway Bearer token>

# Dashboard 公网登录（production 两项都必须配置）
DASHBOARD_LOGIN_SECRET=<至少 12 字符的登录口令>
DASHBOARD_SESSION_SECRET=<至少 32 字符的独立随机签名 secret>
```

production 只认服务端 `HAVEN_GATEWAY_URL`、`OMBRE_SESSION` 与 `OMBRE_GATEWAY_TOKEN`，不使用 `OMBRE_BASE_URL` 或 `NEXT_PUBLIC_OMBRE_*` fallback。基础 URL 在请求期校验，只接受 http/https，不得携带账号密码、query 或 hash，并拒绝 localhost、`127.0.0.0/8`、`::1` 与 `0.0.0.0`；缺配置时对应 Haven/Gateway 功能返回明确错误，不会静默连接容器自身。本机 `npm run dev` 继续兼容旧 `OMBRE_BASE_URL` / `NEXT_PUBLIC_OMBRE_*` 与原有默认地址。

## 认证方式

Dashboard 自身公网入口由根 `proxy.ts` 统一保护。`/login` 只通过 POST body 提交口令；成功后签发 HMAC-SHA256 签名、7 天过期的 `ob2_session` cookie，production 设置 `HttpOnly + Secure + SameSite=Strict + Path=/`。production 缺少或弱化 `DASHBOARD_LOGIN_SECRET` / `DASHBOARD_SESSION_SECRET` 任一项时，私人页面和 API 都返回 503，不默认开放；旧 `?k=` 与明文 `ob2_lan` cookie 不再接受。未配置鉴权变量的本机 `npm run dev` 继续直开，非 production 可用旧 `OB2_LAN_SECRET` 作为兼容登录口令并派生仅开发用签名 key。

登录失败按客户端做指数退避，并有单实例全局失败上限；这部分只属于允许重启丢失的运行态，不作为持久用户数据。登录成功、失败和退出均返回相对 `Location`，避免 Coolify/Traefik 反向代理下把容器内 `localhost:3000` 泄露为浏览器跳转目标。退出入口位于设置页，POST `/api/auth/logout` 清 cookie 与浏览器 cache；轮换 `DASHBOARD_SESSION_SECRET` 会让全部旧 session 失效。公开边界只含登录、`/api/health`、精确 PWA 文件、`/_next/static/*`，以及由自身共享 Bearer token 严格认证的精确 `/api/automation-pro-runner`；其余 Dashboard 页面、cc/批准接口、Gateway/Haven/MCP 代理和私人 API 都校验 session。service worker 只缓存不可变代码资源，不缓存 HTML、API 或私人图片。

Dashboard 到 Haven Brain 的后端认证仍由 `lib/api.ts` 中 `getSessionCookie()` 统一管理，并使用 5 分钟内存缓存避免每次 fetch 重复 POST Haven `/auth/login`；Gateway/cc 持久化调用只由服务端注入 `OMBRE_GATEWAY_TOKEN`，不接受浏览器提供的 Haven 认证头。这与浏览器访问 Dashboard 的 `ob2_session` 是两套隔离凭据。

---

## 文件结构

### 共享组件 `app/components/`

**导航系：**
| 文件 | 说明 |
|------|------|
| `SideRail.tsx` | 桌面端左侧竖栏（4.6 导航重构后取代原 NavBar，`md:flex`；次级入口含日记、轨迹） |
| `BottomTabBar.tsx` | 手机端底部 5 栏 Tab Bar（主页/记忆库/聊天/工作台/设置，聊天为中间突起） |
| `MemoryViewSwitch.tsx` | 记忆页时间线/记忆格/待处理三格切换 |
| `MobileShell.tsx` | 全站布局容器：桌面端渲染 `SideRail`（fixed），手机端加底部安全间距 |

**弹窗系：**
| 文件 | 说明 |
|------|------|
| `DetailPanel.tsx` | 统一弹窗壳：`mode="drawer"` 右侧滑入，`mode="modal"` 居中弹出 |
| `BucketDetailDrawer.tsx` | 桶详情内容区，含噪声标记、moments/桶内与跨桶关联/年轮展示、相似记忆推荐、合并预览 |

**UI 原子组件：**
| 文件 | 说明 |
|------|------|
| `StatusBadge.tsx` | 桶状态标签（pinned/resolved/digested/noise/feel/wish），导出 `statusLabel()` |
| `TagPill.tsx` | domain/tag 标签胶囊，区分 domain 和 tag 两种变体 |
| `DataBadge.tsx` | score/imp 等数字展示胶囊 |
| `Stat.tsx` | 统计格子 |
| `Card.tsx` | 统一卡片壳（variant: interactive/outline/ghost/empty） |
| `SearchBar.tsx` | 全站统一药丸搜索框 |
| `FilterBar.tsx` | 筛选按钮行容器 + `FilterPill` 单个筛选药丸 |
| `KnobRow.tsx` | 评分旋钮滑条 |
| `KnobToggle.tsx` | 评分旋钮开关 |
| `ScoreBar.tsx` | Pipeline 四维评分条 |
| `TimelineDayGroup.tsx` | 时间线按天分组容器 |
| `EntryGrid.tsx` | 记忆格视图网格容器 |
| `HomeToolDrawer.tsx` | 主页工具抽屉（MCP 工具入口） |
| `McpManager.tsx` | cc MCP 工具管理组件；每个服务卡片内可折叠工具与权限，缺失的工具说明在界面中显示通用兜底文案 |
| `ServiceWorkerRegister.tsx` | PWA service worker 注册 |

> 完整设计规范见 `DESIGN.md`。注：4.6 导航重构已删除 `NavBar.tsx`（桌面横条，被 `SideRail` 取代）和 `MobileViewSwitch.tsx`（两格，被 `MemoryViewSwitch` 取代）。

### `app/api/` — API Routes（代理到 OB 后端）

大部分 route 是简单透传。以下是有特殊处理逻辑的：

| 路径 | 说明 |
|------|------|
| `search/route.ts` | GET — 透传全部 query params（simulate, include_vector, include_noise, limit 等） |
| `historical-chats/route.ts` | GET — 历史聊天只读代理；只允许窗口目录与单窗口原文分页参数，后端硬限定 `historical_archive` |
| `edit-bucket/route.ts` | POST — 噪声标记/撤销、字段修改、delete:true 软删除 |
| `breath-debug/route.ts` | GET — 模拟 breath 四维评分 |
| `gateway/[...path]/route.ts` | cc 生态总代理 → OB Gateway；保持 `/gateway/*` 契约并只由服务端注入 Bearer 网关鉴权 |
| `haven/[...path]/route.ts` | 通用 OB 后端代理（Haven Brain `/api/*` 接口），地址与登录凭据只在服务端读取 |
| `mcp-relay/[...path]/route.ts` | cc MCP 工具调用中继 |
| `provider-relay/route.ts` | 上游 provider 测试中继 |
| `cc-chat/route.ts` | cc 聊天主入口：严格发送 payload、初始化窗口模式与固定日回顾快照、按 Pro/API provider 恢复独立 Claude session、补齐该线路未见的 Haven 文字轮次、幂等预检/重放、SSE 流式执行，写入成功后才完成；SDK 非成功终态返回结构化原因，并以完整 session/request 记录无正文诊断日志 |
| `cc-chat-selfhost/route.ts` | 自建聊天入口：服务端读取 Haven 配置/历史/MCP 配置，初始化并注入固定日回顾快照，按 cc 同一格式注入本轮隐藏北京时间，直连 Anthropic-compatible SSE 并执行远程 MCP 工具循环，记录上游生成耗时/速度，严格写回成功后才完成 |
| `cc-attachments/route.ts` + `[id]/route.ts` | `/cc` 图片/文件上传、私有读取与分类清除：图片先压缩，PDF/DOCX/MD/TXT/CSV 在浏览器提取受限正文后与原文件一起转存 Haven；浏览器不接触网关密钥或永久公开 URL |
| `cc-turns/route.ts` | 会话轮次 + Haven 窗口状态：所有来源严格按协作者归属过滤，读取/保存本地引擎首选与提示词模块覆盖、列出软删除窗口、严格永久删除 |
| `cc-stop/route.ts` | 停止生成（保留已生成部分） |
| `cc-compact/route.ts` | 仅复用当前在线、空闲的 CC 工作会话发送原生 `/compact`；不唤醒已回收 query，返回真实 `compact_boundary` 前后 token 与压缩结果 |
| `cc-personas/route.ts` | 协作者（persona 列表/保存/删除，含可自定义基础提示词、可排序提示词模块及默认启停） |
| `cc-upstream/route.ts` | 上游模型配置 |
| `cc-mcp/route.ts` | cc MCP 工具配置；production 只使用 Haven 持久配置，拒绝 loopback，缺失时安全禁用 |
| `cc-permission/route.ts` | 写权限批准 |
| `cc-session-settings/route.ts` | 本窗会话配置：CC Pro/API 路由及各自 provider/模型/力度/思考、selfhost 供应商/模型合并写入 Haven 窗口覆盖 |
| `cc-pro-usage/route.ts` | 只读取当前已有 Pro SDK session 的实验性 5 小时/本周用量与重置时间；不新建 query、不触发模型调用，失败时明确不可用 |
| `automation-pro-runner/route.ts` | 日回顾 / 每周轨迹专用 Claude Pro 单次执行入口；固定白名单任务、禁用 tools、进程内串行；每周轨迹使用纯字符串扁平 Agent SDK JSON Schema，再确定性还原 Haven 候选结构，绕开 headless 嵌套 schema 重试缺陷；日回顾保持普通正文 |
| `cc-web-settings/route.ts` | web 工具开关 |
| `cc-workbench/route.ts` | 工作台数据 |
| `cc-polaris-import/route.ts` | Polaris 聊天历史导入 |
| `cc-test/route.ts`, `cc-hook-test/route.ts` | 测试 hook |
| `care/[...path]/route.ts` | 照顾备忘/待办 |
| `persona/route.ts` | 用户画像状态 |
| `daily-chat-memory/route.ts` | 每日聊天记忆 |
| `daily-reviews/route.ts` | 日回顾列表、手动微调与指定日期生成代理 |
| `journeys/route.ts` + `[id]/route.ts` | 独立关系轨迹目录、详情与认证人工纠错代理 |
| `automations/[...path]/route.ts` | 自动化白名单代理；允许日回顾/weekly 状态、逐任务执行线路、持久 schedule、手动生成和候选读取/编辑/拒绝/确认，并原样透传冲突状态 |
| `auth/login/route.ts` + `auth/logout/route.ts` | Dashboard 正式公网登录/退出：POST 口令、签名 session cookie、失败退避、清除 session，并使用相对跳转兼容反向代理 |
| `health/route.ts` | 无私人信息的公开存活检查，只返回 `{ok:true}` |

其余 route（buckets、bucket/[id]、add-bucket、journal、to-journal、config、prompts、touch、archive、review-status、import-*、trash、scoring-config、hit-stats、recent-searches 等）均为透传代理，完整接口参考见 **Ombre Brain CLAUDE.md**。

### `app/` — 页面

| 路径 | 说明 |
|------|------|
| `page.tsx` | 主页面（时间线/记忆格，含噪声筛选 + 隐藏开关 + 乐观更新） |
| `memory/page.tsx` | 记忆库页（时间线/记忆格/待处理三格切换） |
| `cc/page.tsx` | **聊天主页**（本地与 Coolify/VPS 可在 cc/selfhost 间人工切换，只有 `*.vercel.app` 官方入口强制 selfhost；统一 SSE/严格保存状态、实际引擎/Provider/模型/上下文/usage 展示、图片/文件底部添加抽屉、附件与文字分离显示、用户消息完整本地日期时间、手机上下文详情受模型信息卡边界约束、对话顶部/底部快捷跳转、已删除窗口永久删除；会话栏含可折叠的 Claude/Kelivo 历史聊天，只读按时间向下分页和窗口内原文搜索，归档 thinking 与正文分离并复用现有折叠样式） |
| `workbench/page.tsx` | 工作台（批准执行 + 四格面板） |
| `settings/page.tsx` | 设置聚合页（入口） |
| `login/page.tsx` | Dashboard 独立登录页；表单只向 `/api/auth/login` POST 口令，不使用 URL 口令 |
| `settings/upstream/page.tsx` | 上游模型配置 |
| `settings/memory-processing/page.tsx` | 记忆处理设置 |
| `settings/models/page.tsx` | 召回/自动记忆/日回顾模型设置 |
| `settings/recall/page.tsx` | 召回设置 |
| `settings/automation/page.tsx` | 自动化与状态；日回顾、weekly journey 分别持久选择 API / Claude Pro；轨迹设置显示并编辑“已梳理至”和服务端计算的连续读取范围，积压最多 31 天分段；另支持排程、手动候选、实际线路与分类失败，仍无自动写入或自动 fallback |
| `persona/page.tsx` | 用户画像（状态/编辑/事实/提案 tabs） |
| `impressions/page.tsx` | 日回顾月历：同时标记日回顾/记忆事件，查看与微调日回顾，并保留当天记忆事件及详情抽屉 |
| `care/page.tsx` | 照顾备忘 + 待办 |
| `breath-sim/page.tsx` | 5 Tab：Pipeline / 即时模拟 / 检索评分旋钮 / 命中统计 / 检索追溯 |
| `graph/page.tsx` | 关系图谱（力导向 + 抽屉） |
| `journal/page.tsx` | 日记页（按 event time 的垂直时间轴；专属接口完整编辑；详情使用宽屏工作区，编辑时正文为主区、元数据为右侧栏，窄屏自动单列） |
| `journey/page.tsx` | 独立关系轨迹页：阶段时间轴与人工纠错；页面顶部审核 weekly journey 候选，展示原始 preview、当前 draft/revision/hash、输入完整性、证据与预计差异，确认只提交 revision + hash |
| `import/page.tsx` | 导入工作台：拖拽/粘贴、大/小模式、试跑、进度+费用、完成后审查 |
| `trash/page.tsx` | 回收站：恢复/彻底删除/清空 |
| `prompts/page.tsx` | 四类产品 Prompt 配置：自动打标、记忆合并、独立日回顾、每周关系轨迹；显示系统默认/用户自定义，支持持久保存、撤销草稿、恢复默认与无污染试跑，并只读展示运行时叠加、模型硬约束全文和返回后服务端校验 |
| `cc/import/page.tsx` | cc 会话导入 |
| `tools/mcp/page.tsx` | MCP 工具管理页 |

> 注：旧 `review/`、`chat/` 页面已在 4.6 导航重构后删除（导航无入口）。审阅功能并入记忆页筛选。

### `app/lib/`

`havenConfig.ts`：Haven/Gateway 服务端运行时配置、URL 校验/拼接、production loopback 拒绝和错误 secret 擦除。`api.ts`：`getSessionCookie()`（带 5min 缓存）、`clearSessionCookie()`、`getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`。

cc 生态的客户端库：`ccMcp*`（`ccMcp.ts`/`ccMcpDiscovery.ts`/`ccMcpTypes.ts`）、`ccModes.ts`、`ccChannel.ts`、`ccSession.ts`、`ccEnv.ts`、`ccDirs.ts`、`haven*`（`havenPersonas.ts`/`havenUpstream.ts`/`havenTurns.ts`/`havenAttachments.ts`/`havenRecall.ts`/`havenPermissions.ts`）、`attachments/*`（移植自 Polaris 的 PDF/DOCX/CSV/纯文本浏览器解析）、`cc/runTurn.ts`、`cc/ccOptions.ts`、`cc/ccHistory.ts`、`cc/processCollector.ts`、`cc/sseEvents.ts`、`cc/turnState.ts`、`selfhost/mcp.ts`、`polarisExport.ts`、`format.ts`、`ccDiff.ts`。

---

## 导航架构

### 桌面端
`SideRail` 左侧竖栏（fixed，`md:flex`）：上半段 = 手机 5 Tab 同批入口（主页/记忆库/聊天/工作台/设置），下半段 = 次级入口（日记/轨迹）。

### 手机端
`BottomTabBar` 固定在底部（`md:hidden`），5 个 Tab：
- 主页 → `/`
- 记忆库 → `/memory`
- **聊天**（中间圆形突起）→ `/cc`
- 工作台 → `/workbench`
- 设置 → `/settings`

次级入口（日记/轨迹）收在主页入口区。所有页面通过 `MobileShell` 包裹。

---

## 关键实现细节

### 设计 Token
所有颜色/圆角/阴影/间距统一在 `globals.css` 的 `:root` 中定义。修改一处全局生效。详见 `DESIGN.md`。

### 弹窗规范
所有弹窗统一使用 `DetailPanel`。桶详情用 `mode="drawer"`，其他（新增记忆/日记、合并预览、日记查看、Prompt 测试）用 `mode="modal"`。

### 卡片规范
`Card` 壳提供 4 个变体：`interactive`（可点击+hover效果）、`outline`（普通白底+边框）、`ghost`（淡底+细边框）、`empty`（虚线边框空状态）。

### Next.js 15 动态路由
params 是 Promise，必须 `const { id } = await params`。

### 噪声系统
噪声 = `resolved=true AND importance=1`。标记时保存 `importance_before_noise`；撤销时自动恢复。search() 默认排除，`include_noise=true` 可包含。

### 回收站
软删除：文件移到 `buckets/trash/`，保留 `original_type` + `trashed_at`。

### 相似记忆 & 合并流程
1. BucketDetailDrawer 打开时自动查询 top 5 相似桶
2. 点击「合并预览」→ POST merge-preview → LLM 生成合并结果 + 费用估算
3. 弹窗三栏对比（A 源 / B 目标 / 合并结果）
4. 确认 → POST merge-commit → 更新 B 内容+元数据，删除 A

### 桶详情可观测性
`BucketDetailDrawer` 打开普通桶时通过 `/api/moments?bucket_id=...` 读取派生 moments、桶内 moment 边和带目标桶名称的跨桶边，并从桶 metadata 单独展示年轮。跨桶目标链接到 `/memory?bucket=...` 自动打开对应桶；这些展示不改变 Markdown 正文、moment 索引或年轮的事实源。

### 乐观更新
主页对 touch、archive、noise 标记等操作使用乐观更新，先改 UI 再等后端确认。

### 会话 Cookie 缓存
`getSessionCookie()` 5min 内存缓存。避免每次 API 请求重复 POST `/auth/login`。

### Prompt 配置
Prompt 页面以 Haven `/api/prompts` 为唯一事实源，不使用 `sessionStorage` 或浏览器持久化。每项携带 `source/customized/revision/updated_at`，以及只读的 `runtime_layers/model_hard_constraints/server_validations`；页面把可编辑产品层、运行时自动叠加、实际模型固定约束和模型返回后程序校验分区展示，后三区不能编辑。保存和恢复默认都带 expected revision，冲突时要求刷新，不静默覆盖。保存成功明确显示“已保存并立即生效”。只有自动打标和记忆合并提供草稿试跑，测试正文只作为本次请求的局部 override，不会保存或修改正式运行实例；日回顾和 weekly journey 不创建测试表记录或自动化候选。

### cc 聊天架构
“本窗口设置”同时显示 Prompt cache 的 1 小时系统缓存与 5 分钟会话缓存倒计时估算，供手机端查看；倒计时来自最近模型调用时间，不冒充上游实时缓存状态，单条消息 usage 仍是实际命中依据。

协作者的基础提示词可独立编辑；其余长期提示词按模块保存到 Haven，每条包含名称、正文、排序位置和“新窗口默认开启”状态。旧的单一 `prompt` 会无损显示为一个默认开启模块，保存后迁入新结构。协作者设置页负责新增、编辑、排序、删除和全局默认，聊天输入框「＋ → 提示词模块」只保存当前窗口的启停覆盖；不在输入框或消息详情增加模块标签。窗口覆盖缺省时跟随协作者默认，因此以后新增模块仍可自然继承默认状态。

新对话与换窗共用的弹窗默认勾选“注入最近三天日回顾”。首次发送时把 `mode` 和该选择写入 Haven，并复制最近三个已结束日历日的日回顾正文成为窗口固定快照；之后日期推进或日回顾被微调都不会改变已创建窗口。cc 和 selfhost 都把这份快照作为稳定 system 背景注入，关闭选项则该窗口固定为空快照。

订阅、API 中转站和 selfhost 共用同一份协作者基础提示词；默认值是原 cc 闲聊模式提示词，cc 闲聊不再另外注入写死副本。cc 工作模式仍保留 Claude Code preset，再追加同一份协作者配置。最终都按“协作者基础 system + 定位 + 当前有效提示词模块 + 记忆”组装，每个模块以 `【模块名称】` 开头，便于模型区分边界；界面用的协作者名字和对方称呼不再机械生成独立 system 句子，身份关系由基础提示词、定位和模块自然表达。selfhost 每轮重组；cc 对协作者配置组合计算启动指纹，内容变化时回收空闲 SDK query，并用原 Claude session resume，使下一轮使用新 system 且保留对话上下文。换窗 handoff 不计入该指纹，避免第二轮误重启后丢失稳定背景。每轮隐藏运行时信息直接提供北京时间对应的中文星期，避免模型自行换算日期。

`cc-chat/route.ts` 是 cc SSE 流式入口，内部拆 `runTurn` / `ccOptions` / `ccHistory` + `processCollector`（进程收集）+ 一轮状态机。10.3 起 cc 与 selfhost 都要求 `request_id + expected_last_round_id + persona_id`；cc 在执行前查询 Haven 幂等记录，命中则重放，模型生成后以严格 compare-and-append 写入，Haven 成功后才发送 `done`。CC Pro (`subscription`) 与每个 CC API provider (`api:<provider_id>`) 分别从 Haven `cc_lanes` 恢复自己的 Claude 原生 session 和 `seen_round_id`，切换线路时回收空闲 query，绝不把 Pro OAuth 与 API token 放进同一 SDK session。订阅模型的完整 ID 原样交给 Claude Code，不能把固定 `claude-opus-4-6` 改写成会随版本变化的 `opus[1m]`；只有 API provider 的 Opus 4.6 模型为适配中转站上下文能力继续使用该内部映射，界面也不得把裸动态别名冒充成固定 4.6。目标线路游标之后的全部成功文字轮次（含其他 CC 线路和 selfhost）作为 `<上次聊到这里>` 一次性放进下一条 SDK user message；thinking、图片与文件内容不补入。只有该线路严格写入成功才推进自身游标，下一轮不重复；旧单一 `cc_seen_round_id` 只作升级兼容。浏览器断连后子进程会被回收，防止下次发言卡死。

`cc-chat-selfhost/route.ts` 是独立的无状态聊天链路：浏览器只提交 `session_id`、`request_id`、`expected_last_round_id`、`persona_id` 和当前正文；服务端从 Haven 读取 Persona、窗口覆盖、完整分页历史、上游密钥与 MCP 配置，因此 cc 写入的历史会原样进入 selfhost 上下文，密钥和 MCP 请求头不返回浏览器。每轮当前用户内容末尾会按 cc 同一格式追加隐藏的北京时间运行时块；预算计算和真实上游请求使用同一份带时间文本，但浏览器气泡与 Haven `user_text` 仍只保存用户原话。预检阶段访问 Haven 的配置、Persona、会话与历史 GET 遇到连接级异常会短暂重试一次；HTTP 错误、写入和主动取消不重试，最终网络错误保留 undici `cause` 便于定位。`lib/selfhost/` 负责 Persona → recall 参考块、保守上下文预算、Anthropic-compatible `/v1/messages` 请求与 SSE 解析，以及远程 MCP 工具循环：只连接已启用的 HTTP/SSE server，并按服务端实时 `listTools` schema 注入权限最终为 `allow` 的工具；`ask`、`deny` 和 stdio 不注入。工具定义计入固定上下文预算，一轮最多执行 8 次工具调用；结果按现有 MCP 设置决定是否把截断正文持久化，状态与调用元数据仍随轮次保存。连接、发现或调用失败会作为工具错误/警告返回，不阻断普通聊天；达到上限后不再提供工具，要求模型完成正文。usage 累加各次上游调用，并只记录上游生成耗时，不混入工具、召回和 Haven 保存耗时。每个 selfhost 响应流持有独立 AbortController；浏览器取消 response stream 或入站 request signal 中断时都会 abort 召回、上游 fetch 与尚未完成的 Haven 写入，取消后不再发送 SSE 或保存该轮。cc 与 selfhost 召回前都读取 Haven 持久排除集合（已召回桶 + 本窗口新建桶），本轮召回/新建 ID 随严格写入落回 Haven，不依赖进程内缓存或 localStorage；MCP `hold` 只有结构化结果为 `status=success, action=created` 时才追加 `created_bucket_ids`，`merged/commented` 不算新桶，cc 仍兼容旧文本标记。selfhost 还会读取历史轮次 `raw_json.recall`，把此前已注入、因此不会再次召回的正文随对应历史轮次继续重放，并计入历史预算；实时和刷新后的召回按钮都从同一持久正文展示。上游完成后使用 Haven 严格 compare-and-append，写入成功才发送 `done`；幂等命中从 Haven 原轮次重放，生成后 409/写库失败只发送结构化 `error`。thinking 不设本地开关或请求参数：正式 `thinking_delta` 照常展示与保存；中转站若又把另一份字面 `<thinking>...</thinking>` 或 `<think>...</think>` 放进 `text_delta`，流式解析器会分别按配对标签跨 chunk 剔除该区段，避免进入正文和历史。

前端 `useCcChat.ts` + `ccSseConsumer.ts` 统一消费两种引擎的 `start / recall / context / init / thinking / delta / usage / done / error`。`local_engine_preference` 存 Haven，Vercel 只在运行时强制 `effective_engine=selfhost`，不会覆盖本地首选；引擎切换保持同一个 `session_id`。CC Pro、CC API 和 selfhost 各自保留供应商/模型选择，空闲时可在同一窗口人工往返；选择分别写入 Haven `cc_overrides` / `selfhost_overrides`。selfhost 每轮从 Haven 完整历史重组；CC 各线路恢复各自 Claude session，并用隐藏文字块补齐中间轮次，不同步 thinking 或附件内容，也不在 Pro 额度不足时自动 fallback。Pro 订阅线路收到 SDK `rate_limit_event: rejected`、`blocking_limit` / `rapid_refill_breaker` 终止原因或明确额度耗尽错误时，按可保存的中断终态处理：用户原话与已有半截回复原子写入 Haven，零输出也保存用户消息和空 assistant，并在 `raw_json.interrupted_reason=pro_limit` 标记；刷新后恢复对应额度中断状态，不会再丢最后一条用户消息。普通 provider、断流和其他上游错误仍不保存，但 SDK 非成功 `result` 会原样保留已生成的正文、thinking 与工具过程，未完成工具转为错误状态，并在消息内显示 `subtype / terminal_reason / errors` 形成的结构化失败说明；半截正文不再被当成全局错误文本。CC thinking 开启时，对 Opus/Sonnet 4.6+ 显式使用 `adaptive + summarized`，旧 Claude thinking 模型使用固定兼容预算，未知中转模型保持 SDK 默认；关闭时显式 `disabled`。中途切换 thinking 会保留该线路原生 session、回收空闲 query，并在下一轮 resume 后应用，当前轮 SDK 返回的 thinking 摘要仍实时展示和保存。Pro 设置卡每分钟读取一次当前已有 SDK session 的实验性 5 小时/本周额度；离开 Pro 后只显示内存中的上次值，SDK 不提供时显示不可用。Vercel 恢复窗口时，设置卡按实际 `effective_engine` 显示 selfhost 覆盖，不会因本地首选仍为 cc 而回退到全局默认；卡内“正在用 / 上下文”与页面顶部共用最后一轮实际 Provider、模型和上下文元数据，缺少历史元数据时才回退到当前选择或 cc 进程 stats。浏览器始终不向严格聊天请求提交上游地址或密钥。生成后未保存、`persistence_unknown`、409 跨设备冲突、保存中、正常完成和幂等重放均为独立界面状态。

普通窗口与历史聊天都支持选择可见的用户/助手正文并作为转发块放入当前输入框；桌面端从右上角“选择”进入，手机端长按消息进入并临时收起拥挤的常规顶栏。选择范围不包含 handoff、thinking、工具过程或系统事件，状态只属于当前页面运行态，切换窗口时清空，不写入 Haven 或浏览器持久化。发送时转发原文继续以边界标签随 user text 保存并进入模型上下文；消息行会把该边界块解析成紧凑转发卡片，与用户附言分开显示，点击卡片以底部弹窗查看完整内容。解析只发生在显示层，因此此前已经保存的转发消息无需迁移也会使用卡片样式。

图片附件第一版只支持 JPEG/PNG/WebP：原图选择上限 25MB，每轮最多 4 张，浏览器缩到最长边 2000px 并转成 WebP，上传后的硬上限 2MB。Haven 保存压缩文件和附件元数据，严格请求只携带有序 `attachment_ids`；cc 组装 Agent SDK image block，selfhost 组装 Anthropic-compatible base64 image block，并只重放最近 2 个 selfhost 图片轮次。图片不进入 handoff 或跨引擎补齐；清除会永久删除 Haven 文件并保留“图片已清除”占位，但不能从已建立的 cc SDK 私有上下文中单独撤回。

窗口文件支持 PDF/DOCX/MD/TXT/CSV，单个原文件上限 4MB（为包含解析正文的 multipart 留出 Vercel 4.5MB Function 请求体余量）；PDF/DOCX 最多提取 120,000 字符，CSV 最多 80,000 字符并限制 80 行 × 12 列，扫描 PDF 不做 OCR。原文件与解析正文作为 Haven 私有窗口附件保存，不进入长期记忆、召回或 handoff；cc/selfhost 都把解析正文作为带边界的用户资料文本发送，selfhost 历史按现有预算重放未清除文件。图片和文件各自支持单个永久清除及按窗口分类清除；清除文件会删除原文件和解析正文，只保留“文件已清除”占位。手机“＋”使用底部抽屉区分拍照、照片、上传文件以及两类清除入口；发送后附件卡独立位于文字气泡上方。每轮图片与文件合计最多 4 个。

---

## 待办事项

待删 / 冗余 / 未接入功能统一维护在 **`TECH_DEBT.md`**（本仓库），前端特有项：

- [ ] 关系图谱页 UI 和其他页面风格统一
