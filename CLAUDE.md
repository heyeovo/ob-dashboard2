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
| `McpManager.tsx` | cc MCP 工具管理组件 |
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
| `cc-chat/route.ts` | cc 聊天主入口（SSE 流式，runTurn + ccOptions + ccHistory 架构） |
| `cc-chat-selfhost/route.ts` | 自建纯聊天入口：服务端读取 Haven 配置/历史，直连 Anthropic-compatible SSE，严格写回成功后才完成 |
| `cc-turns/route.ts` | 会话轮次（conversation_turns 表） |
| `cc-stop/route.ts` | 停止生成（保留已生成部分） |
| `cc-personas/route.ts` | 协作者（persona 列表/保存/删除） |
| `cc-upstream/route.ts` | 上游模型配置 |
| `cc-mcp/route.ts` | cc MCP 工具配置 |
| `cc-permission/route.ts` | 写权限批准 |
| `cc-session-settings/route.ts` | 本窗会话配置 |
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
| `cc/page.tsx` | **聊天主页**（协作者 Rail + 会话 Rail + SSE 流式消息，thinking/工具/召回内联展示） |
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

cc 生态的客户端库：`ccMcp*`（`ccMcp.ts`/`ccMcpDiscovery.ts`/`ccMcpTypes.ts`）、`ccModes.ts`、`ccChannel.ts`、`ccSession.ts`、`ccEnv.ts`、`ccDirs.ts`、`haven*`（`havenPersonas.ts`/`havenUpstream.ts`/`havenTurns.ts`/`havenRecall.ts`/`havenPermissions.ts`）、`cc/runTurn.ts`、`cc/ccOptions.ts`、`cc/ccHistory.ts`、`cc/processCollector.ts`、`cc/sseEvents.ts`、`cc/turnState.ts`、`polarisExport.ts`、`format.ts`、`ccDiff.ts`。

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
`cc-chat/route.ts` 是 SSE 流式入口，内部拆 `runTurn` / `ccOptions` / `ccHistory` + `processCollector`（进程收集）+ 一轮状态机。浏览器断连后子进程会被回收，防止下次发言卡死。前端 `useCcChat.ts` + `ccSseConsumer.ts` 消费 SSE 事件（事件契约见 `lib/cc/sseEvents.ts`）。14 条 vitest 集成测试覆盖 9.5 验收清单。

`cc-chat-selfhost/route.ts` 是独立的无状态纯聊天链路：浏览器只提交 `session_id`、`request_id`、`expected_last_round_id`、`persona_id` 和当前正文；服务端从 Haven 读取 Persona、窗口覆盖、完整分页历史和上游密钥。`lib/selfhost/` 负责 Persona → recall 参考块、保守上下文预算、Anthropic-compatible `/v1/messages` 请求与 SSE 解析。上游完成后使用 Haven 严格 compare-and-append，写入成功才发送 `done`；幂等命中从 Haven 原轮次重放，生成后 409/写库失败只发送结构化 `error`。thinking 不设本地开关或请求参数，上游若返回 `thinking_delta` 就透传。

---

## 待办事项

待删 / 冗余 / 未接入功能统一维护在 **`TECH_DEBT.md`**（本仓库），前端特有项：

- [ ] 关系图谱页 UI 和其他页面风格统一
