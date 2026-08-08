@AGENTS.md
# ob-dashboard2 开发文档

> 供新窗口快速了解项目全貌，开窗口时 fetch 此文件。

## 项目概述

ob-dashboard2 是 Ombre Brain 记忆系统的前端看板，Next.js 15 App Router + Tailwind CSS + TypeScript，部署在 Vercel。OB 后端（Python FastMCP + Starlette）部署在 Zeabur。

- **前端仓库**：github.com/heyeovo/ob-dashboard2
- **OB后端仓库**：github.com/heyeovo/Ombre-Brain
- **Vercel 域名**：ob-dashboard2.vercel.app
- **Zeabur 域名**：https://foryan.zeabur.app

## 启动

```bash
npm install
npm run dev      # 本地开发 → http://localhost:3000
npm run build    # 生产构建
```

## 环境变量（.env.local）

```
OMBRE_BASE_URL=https://foryan.zeabur.app
OMBRE_SESSION=<密码>
NEXT_PUBLIC_OMBRE_BASE_URL=https://foryan.zeabur.app
NEXT_PUBLIC_OMBRE_SESSION=<密码>
```

## 认证方式

`lib/api.ts` 中 `getSessionCookie()` 统一管理。已加 5 分钟内存缓存，避免每次 fetch 重复 POST `/auth/login`。所有 API proxy route 共用同一份。

---

## 文件结构

### 共享组件 `app/components/`

**导航系：**
| 文件 | 说明 |
|------|------|
| `SideRail.tsx` | 桌面端左侧竖栏（4.6 导航重构后取代原 NavBar，`md:flex`） |
| `BottomTabBar.tsx` | 手机端底部 5 栏 Tab Bar（主页/记忆库/聊天/工作台/设置，聊天为中间突起） |
| `MemoryViewSwitch.tsx` | 记忆页时间线/记忆格/待处理三格切换 |
| `MobileShell.tsx` | 全站布局容器：桌面端渲染 `SideRail`（fixed），手机端加底部安全间距 |

**弹窗系：**
| 文件 | 说明 |
|------|------|
| `DetailPanel.tsx` | 统一弹窗壳：`mode="drawer"` 右侧滑入，`mode="modal"` 居中弹出 |
| `BucketDetailDrawer.tsx` | 桶详情内容区，含噪声标记、相似记忆推荐、合并预览 |

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
| `edit-bucket/route.ts` | POST — 噪声标记/撤销、字段修改、delete:true 软删除 |
| `breath-debug/route.ts` | GET — 模拟 breath 四维评分 |
| `gateway/[...path]/route.ts` | cc 生态总代理 → OB Gateway（Bearer 网关鉴权） |
| `haven/[...path]/route.ts` | 通用 OB 后端代理（Haven 接口） |
| `mcp-relay/[...path]/route.ts` | cc MCP 工具调用中继 |
| `provider-relay/route.ts` | 上游 provider 测试中继 |
| `cc-chat/route.ts` | cc 聊天主入口：严格发送 payload、Haven 幂等预检/重放、SSE 流式执行，写入成功后才完成 |
| `cc-chat-selfhost/route.ts` | 自建聊天入口：服务端读取 Haven 配置/历史/MCP 配置，按 cc 同一格式注入本轮隐藏北京时间，直连 Anthropic-compatible SSE 并执行远程 MCP 工具循环，记录上游生成耗时/速度，严格写回成功后才完成 |
| `cc-attachments/route.ts` + `[id]/route.ts` | `/cc` 图片上传、私有读取与清除：浏览器先压缩，服务端用网关密钥转存 Haven；浏览器不接触密钥或永久公开 URL |
| `cc-turns/route.ts` | 会话轮次 + Haven 窗口状态：读取/保存本地引擎首选、列出软删除窗口、严格永久删除 |
| `cc-stop/route.ts` | 停止生成（保留已生成部分） |
| `cc-personas/route.ts` | 协作者（persona 列表/保存/删除） |
| `cc-upstream/route.ts` | 上游模型配置 |
| `cc-mcp/route.ts` | cc MCP 工具配置 |
| `cc-permission/route.ts` | 写权限批准 |
| `cc-session-settings/route.ts` | 本窗会话配置：cc 运行时模型/力度/思考；selfhost 供应商/模型合并写入 Haven 窗口覆盖 |
| `cc-web-settings/route.ts` | web 工具开关 |
| `cc-workbench/route.ts` | 工作台数据 |
| `cc-polaris-import/route.ts` | Polaris 聊天历史导入 |
| `cc-test/route.ts`, `cc-hook-test/route.ts` | 测试 hook |
| `care/[...path]/route.ts` | 照顾备忘/待办 |
| `persona/route.ts` | 用户画像状态 |
| `daily-chat-memory/route.ts` | 每日聊天记忆 |

其余 route（buckets、bucket/[id]、add-bucket、journal、to-journal、config、prompts、touch、archive、review-status、import-*、trash、scoring-config、hit-stats、recent-searches 等）均为透传代理，完整接口参考见 **Ombre Brain CLAUDE.md**。

### `app/` — 页面

| 路径 | 说明 |
|------|------|
| `page.tsx` | 主页面（时间线/记忆格，含噪声筛选 + 隐藏开关 + 乐观更新） |
| `memory/page.tsx` | 记忆库页（时间线/记忆格/待处理三格切换） |
| `cc/page.tsx` | **聊天主页**（本地 cc/selfhost 人工切换、Vercel 强制 selfhost、统一 SSE/严格保存状态、实际引擎/Provider/模型/上下文/usage 展示、用户消息显示完整本地日期时间、手机上下文详情受模型信息卡边界约束、对话顶部/底部快捷跳转、已删除窗口永久删除） |
| `workbench/page.tsx` | 工作台（批准执行 + 四格面板） |
| `settings/page.tsx` | 设置聚合页（入口） |
| `settings/upstream/page.tsx` | 上游模型配置 |
| `settings/memory-processing/page.tsx` | 记忆处理设置 |
| `settings/models/page.tsx` | 召回/自动记忆模型设置 |
| `settings/recall/page.tsx` | 召回设置 |
| `settings/automation/page.tsx` | 自动化设置 |
| `persona/page.tsx` | 用户画像（状态/编辑/事实/提案 tabs） |
| `polaris/page.tsx` | Polaris 聊天历史导入 |
| `impressions/page.tsx` | 日印象日历 |
| `care/page.tsx` | 照顾备忘 + 待办 |
| `breath-sim/page.tsx` | 5 Tab：Pipeline / 即时模拟 / 检索评分旋钮 / 命中统计 / 检索追溯 |
| `graph/page.tsx` | 关系图谱（力导向 + 抽屉） |
| `journal/page.tsx` | 日记页（垂直时间轴） |
| `import/page.tsx` | 导入工作台：拖拽/粘贴、大/小模式、试跑、进度+费用、完成后审查 |
| `trash/page.tsx` | 回收站：恢复/彻底删除/清空 |
| `prompts/page.tsx` | Prompt 配置 |
| `cc/import/page.tsx` | cc 会话导入 |
| `tools/mcp/page.tsx` | MCP 工具管理页 |

> 注：旧 `review/`、`chat/` 页面已在 4.6 导航重构后删除（导航无入口）。审阅功能并入记忆页筛选。

### `app/lib/`

`api.ts`：`getSessionCookie()`（带 5min 缓存）、`clearSessionCookie()`、`getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`。

cc 生态的客户端库：`ccMcp*`（`ccMcp.ts`/`ccMcpDiscovery.ts`/`ccMcpTypes.ts`）、`ccModes.ts`、`ccChannel.ts`、`ccSession.ts`、`ccEnv.ts`、`ccDirs.ts`、`haven*`（`havenPersonas.ts`/`havenUpstream.ts`/`havenTurns.ts`/`havenAttachments.ts`/`havenRecall.ts`/`havenPermissions.ts`）、`cc/runTurn.ts`、`cc/ccOptions.ts`、`cc/ccHistory.ts`、`cc/processCollector.ts`、`cc/sseEvents.ts`、`cc/turnState.ts`、`selfhost/mcp.ts`、`polarisExport.ts`、`format.ts`、`ccDiff.ts`。

---

## 导航架构

### 桌面端
`SideRail` 左侧竖栏（fixed，`md:flex`）：上半段 = 手机 5 Tab 同批入口（主页/记忆库/聊天/工作台/设置），下半段 = 次级入口（Polaris/日记）。

### 手机端
`BottomTabBar` 固定在底部（`md:hidden`），5 个 Tab：
- 主页 → `/`
- 记忆库 → `/memory`
- **聊天**（中间圆形突起）→ `/cc`
- 工作台 → `/workbench`
- 设置 → `/settings`

次级入口（Polaris/日记）收在主页汉堡和设置聚合页里。所有页面通过 `MobileShell` 包裹。

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

### 乐观更新
主页对 touch、archive、noise 标记等操作使用乐观更新，先改 UI 再等后端确认。

### 会话 Cookie 缓存
`getSessionCookie()` 5min 内存缓存。避免每次 API 请求重复 POST `/auth/login`。

### cc 聊天架构
`cc-chat/route.ts` 是 cc SSE 流式入口，内部拆 `runTurn` / `ccOptions` / `ccHistory` + `processCollector`（进程收集）+ 一轮状态机。10.3 起 cc 与 selfhost 都要求 `request_id + expected_last_round_id + persona_id`；cc 在执行前查询 Haven 幂等记录，命中则重放，模型生成后以严格 compare-and-append 写入，Haven 成功后才发送 `done`。10.4 起每轮 cc 还会从 Haven 读取 `cc_seen_round_id`，把游标后的 selfhost 用户/助手原文作为 `<上次聊到这里>` 一次性放进下一条 SDK user message；这些缺失 selfhost 轮次若保存过 `raw_json.recall.additional_context`（旧数据可回退到 `modules[].text`），还会在原续聊记录之前追加独立的隐藏 `<之前的记忆>`，确保已进入排除账本、因而不会被 cc 再召回的背景仍能随切换进入 cc 私有上下文。只有 cc 严格写入成功才由 Haven 推进游标，`done` 会带本轮补入轮数；下一轮不会重复补入同一批对话或召回参考。浏览器断连后子进程会被回收，防止下次发言卡死。

`cc-chat-selfhost/route.ts` 是独立的无状态聊天链路：浏览器只提交 `session_id`、`request_id`、`expected_last_round_id`、`persona_id` 和当前正文；服务端从 Haven 读取 Persona、窗口覆盖、完整分页历史、上游密钥与 MCP 配置，因此 cc 写入的历史会原样进入 selfhost 上下文，密钥和 MCP 请求头不返回浏览器。每轮当前用户内容末尾会按 cc 同一格式追加隐藏的北京时间运行时块；预算计算和真实上游请求使用同一份带时间文本，但浏览器气泡与 Haven `user_text` 仍只保存用户原话。预检阶段访问 Haven 的配置、Persona、会话与历史 GET 遇到连接级异常会短暂重试一次；HTTP 错误、写入和主动取消不重试，最终网络错误保留 undici `cause` 便于定位。`lib/selfhost/` 负责 Persona → recall 参考块、保守上下文预算、Anthropic-compatible `/v1/messages` 请求与 SSE 解析，以及远程 MCP 工具循环：只连接已启用的 HTTP/SSE server，并按服务端实时 `listTools` schema 注入权限最终为 `allow` 的工具；`ask`、`deny` 和 stdio 不注入。工具定义计入固定上下文预算，一轮最多执行 8 次工具调用；结果按现有 MCP 设置决定是否把截断正文持久化，状态与调用元数据仍随轮次保存。连接、发现或调用失败会作为工具错误/警告返回，不阻断普通聊天；达到上限后不再提供工具，要求模型完成正文。usage 累加各次上游调用，并只记录上游生成耗时，不混入工具、召回和 Haven 保存耗时。每个 selfhost 响应流持有独立 AbortController；浏览器取消 response stream 或入站 request signal 中断时都会 abort 召回、上游 fetch 与尚未完成的 Haven 写入，取消后不再发送 SSE 或保存该轮。cc 与 selfhost 召回前都读取 Haven 持久排除集合（已召回桶 + 本窗口新建桶），本轮召回/新建 ID 随严格写入落回 Haven，不依赖进程内缓存或 localStorage；MCP `hold` 只有结构化结果为 `status=success, action=created` 时才追加 `created_bucket_ids`，`merged/commented` 不算新桶，cc 仍兼容旧文本标记。selfhost 还会读取历史轮次 `raw_json.recall`，把此前已注入、因此不会再次召回的正文随对应历史轮次继续重放，并计入历史预算；实时和刷新后的召回按钮都从同一持久正文展示。上游完成后使用 Haven 严格 compare-and-append，写入成功才发送 `done`；幂等命中从 Haven 原轮次重放，生成后 409/写库失败只发送结构化 `error`。thinking 不设本地开关或请求参数：正式 `thinking_delta` 照常展示与保存；中转站若又把另一份字面 `<thinking>...</thinking>` 或 `<think>...</think>` 放进 `text_delta`，流式解析器会分别按配对标签跨 chunk 剔除该区段，避免进入正文和历史。

前端 `useCcChat.ts` + `ccSseConsumer.ts` 统一消费两种引擎的 `start / recall / context / init / thinking / delta / usage / done / error`。`local_engine_preference` 存 Haven，Vercel 只在运行时强制 `effective_engine=selfhost`，不会覆盖本地首选；引擎切换保持同一个 `session_id`。cc 与 selfhost 各自保留供应商/模型选择：cc provider 随 SDK 子进程锁定，selfhost 每轮重新直连，允许在同一窗口途中换中转站；selfhost 选择合并写入 Haven `selfhost_overrides`，保存成功才显示生效，重新打开窗口也从该事实源恢复。Vercel 恢复窗口时，设置卡按实际 `effective_engine` 显示 selfhost 覆盖，不会因本地首选仍为 cc 而回退到全局默认；卡内“正在用 / 上下文”与页面顶部共用最后一轮实际 Provider、模型和上下文元数据，缺少历史元数据时才回退到当前选择或 cc 进程 stats。Polaris/gateway 导入窗口在 selfhost 下可直接用 Haven 历史原窗续聊，切到 cc 时仍要求换窗启动新的 SDK session。浏览器始终不向严格聊天请求提交上游地址或密钥。生成后未保存、`persistence_unknown`、409 跨设备冲突、保存中、正常完成和幂等重放均为独立界面状态。

图片附件第一版只支持 JPEG/PNG/WebP：原图选择上限 25MB，每轮最多 4 张，浏览器缩到最长边 2000px 并转成 WebP，上传后的硬上限 2MB。Haven 保存压缩文件和附件元数据，严格请求只携带有序 `attachment_ids`；cc 组装 Agent SDK image block，selfhost 组装 Anthropic-compatible base64 image block，并只重放最近 2 个 selfhost 图片轮次。图片不进入 handoff 或跨引擎补齐；清除会永久删除 Haven 文件并保留“图片已清除”占位，但不能从已建立的 cc SDK 私有上下文中单独撤回。

---

## 待办事项

待删 / 冗余 / 未接入功能统一维护在 **`TECH_DEBT.md`**（本仓库），前端特有项：

- [ ] 关系图谱页 UI 和其他页面风格统一
