@AGENTS.md
# ob-dashboard2 开发文档

> 供新窗口快速了解项目全貌，开窗口时 fetch 此文件。

## 项目概述

ob-dashboard2 是 Ombre Brain 记忆系统的前端看板，Next.js 15 App Router 构建，部署在 Vercel。OB 后端（Python FastMCP + Starlette）部署在 Zeabur。

- **前端仓库**：github.com/heyeovo/ob-dashboard2
- **OB后端仓库**：github.com/heyeovo/Ombre-Brain
- **Vercel 域名**：ob-dashboard2.vercel.app
- **Zeabur 域名**：https://forxiaoyan.zeabur.app

## 环境变量（.env.local）

```
OMBRE_BASE_URL=https://forxiaoyan.zeabur.app
OMBRE_SESSION=<密码>
NEXT_PUBLIC_OMBRE_BASE_URL=https://forxiaoyan.zeabur.app
NEXT_PUBLIC_OMBRE_SESSION=<密码>
```

## 认证方式

所有服务端 API 调用统一用 `getSessionCookie()`：每次调用 OB 前 POST `/auth/login` 重新获取 session cookie。**不依赖浏览器 cookie**（跨域无法传递）。

`lib/api.ts` 有一份，所有 route.ts 都 import 同一份，已统一。

---

## 文件结构

### `app/api/` — Next.js API Routes（代理到 OB 后端）

| 路径 | 方法 | 说明 |
|------|------|------|
| `buckets/route.ts` | GET | 获取所有桶列表 |
| `bucket/[id]/route.ts` | GET | 单个桶详情 |
| `add-bucket/route.ts` | POST | 新建桶（已从 MCP 迁移到 REST POST /api/bucket） |
| `edit-bucket/route.ts` | POST | 编辑桶（已从 MCP 迁移到 REST PATCH/DELETE /api/bucket/{id}，支持 content/pinned/resolved/digested/tags/importance/delete） |
| `journal/route.ts` | GET/POST | GET 日记列表；POST 创建新日记 |
| `to-journal/route.ts` | POST | 将已有桶转为日记（不可逆，body: { id, author, locked, unlock_hint }） |
| `search/route.ts` | GET | 搜索桶（?q=&include_archive=） |
| `review-status/route.ts` | POST | 审阅状态 |
| `breath-debug/route.ts` | GET | 模拟 breath（?q=&valence=&arousal=&threshold=） |
| `config/route.ts` | GET/POST | 读写后端配置（fuzzy_threshold） |
| `prompts/route.ts` | GET/POST | 读写 prompt 配置 |
| `prompts/test/route.ts` | POST | 测试 prompt 效果（绕过缓存，支持 prompt_override） |
| `touch/[id]/route.ts` | POST | 轻触（默认）或完整激活（?ripple=true） |
| `archive/[id]/route.ts` | POST | 物理归档桶 |

### `app/` — 页面

| 路径 | 说明 |
|------|------|
| `page.tsx` | 主页面（~1100行，含时间线/记忆格/审阅三个 tab） |
| `breath-sim/page.tsx` | 模拟 Breath 页面（四维评分可视化，threshold 动态调控） |
| `graph/page.tsx` | 关系图谱页（力导向聚类图 + 三级缓存 + BucketDetailDrawer 抽屉） |
| `journal/page.tsx` | 日记页（垂直时间轴布局 + 日期分组 + 搜索/日期筛选 + 居中详情弹窗） |
| `review/page.tsx` | 审阅页面 |
| `prompts/page.tsx` | Prompt 配置页面（可折叠编辑，测试弹窗） |
| `bucket/[id]/page.tsx` | 桶详情独立页面（旧版，graph 页已改用 BucketDetailDrawer） |

### `app/lib/api.ts`

统一 API 函数：`getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`

### `components/BucketDetailDrawer`

桶详情抽屉，主页面、breath-sim、graph 页共用。

```typescript
interface Props {
  selected: BucketDetail | null
  detailLoading: boolean
  editing: boolean
  editContent: string
  saving: boolean
  operating: boolean
  copied: boolean
  onClose: () => void
  onStartEdit: (content: string) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onTraceOp: (id: string, args: Record<string, unknown>) => Promise<void>
  onCopyId: () => void
  onImportanceChange?: (id: string, val: number) => void
  onTouch: (id: string) => Promise<void>
  onActivate: (id: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onConvertToJournal?: (id: string, args: { author: string; locked: boolean; unlock_hint: string }) => Promise<void>
}
```

---

## OB 后端接口（Zeabur）

### 认证
```
POST /auth/login  { password }  →  set-cookie
```

### 桶管理
```
GET  /api/buckets                        # 所有桶（include_archive=True，含已归档）
GET  /api/bucket/{id}                    # 单个桶详情
POST /api/bucket                         # 新增桶（已从 MCP 迁移到 REST）
PATCH /api/bucket/{id}                   # 更新桶字段（已从 MCP 迁移到 REST）
DELETE /api/bucket/{id}                  # 硬删除桶（已从 MCP 迁移到 REST）
GET  /api/search?q=&include_archive=&limit=  # 搜索（limit默认=max_results，show_all默认false）
POST /api/touch/{id}?ripple=true/false   # 轻触(false) 或完整激活(true，+1激活+涟漪)
POST /api/archive/{id}                   # 物理归档（移文件到archive_dir）
POST /api/unarchive/{id}                 # 恢复归档
```

### 日记系统
```
GET  /api/journal                        # 日记列表（返回 [{ id, name, author, created, locked, content?, unlock_hint? }]）
POST /api/journal                        # 创建新日记（body: { content, name?, author, locked, unlock_hint? }）
POST /api/bucket/{id}/to-journal         # 已有桶转为日记（body: { author, locked, unlock_hint? }，不可逆）
```

### 模拟 Breath（Debug）
```
GET /api/breath-debug?q=&valence=&arousal=&threshold=
# 返回所有桶的四维评分详情（top 50，含未过阈值的桶置灰显示）
```

### 配置
```
GET  /api/config                        # 返回 { fuzzy_threshold, max_results }
POST /api/config { fuzzy_threshold }    # 更新内存值（重启恢复 config.yaml 默认 55）
```

### Prompt 配置
```
GET  /api/prompts                              # 返回 { dehydrate, analyze }
POST /api/prompts { name, content }            # 更新内存中的 prompt（name: dehydrate/analyze）
POST /api/prompts/test { name, content, prompt_override? }
# 测试 prompt，绕过 SQLite 缓存直接调 LLM，prompt_override 不需先应用即可测试
```

---

## 关键实现细节

### Next.js 15 动态路由
params 是 Promise，必须 `const { id } = await params`，**不能直接用 params.id**（会是 undefined）。

### MCP vs REST 边界（全部已迁移到 REST，不再走 MCP）
所有前端操作现在都通过 REST API 代理到 OB 后端，不再经过 MCP 协议。

### OB 目录结构
桶存文件系统：`{buckets_dir}/permanent/`, `dynamic/`, `feel/`, `archive/`
`bucket_mgr.list_all(include_archive=False)` 只扫描前三个目录。
`/api/buckets` 用 `include_archive=True`（主页面展示所有桶包括已归档）。

### 脱水缓存
`dehydrate()` 有 SQLite 缓存，相同 content 直接返回缓存，不重新调 LLM。
测试接口直接调 `_api_dehydrate()` 绕过缓存。
`analyze()` 无缓存，直接调 LLM。

### Prompt 实例变量
`dehydrator.dehydrate_prompt` / `dehydrator.analyze_prompt`
初始值来自模块常量 DEHYDRATE_PROMPT / ANALYZE_PROMPT，
可动态修改，**重启后恢复**（待做持久化到 runtime_config.json）。

### DEHYDRATE_PROMPT 第 7 条
"保留内容类型标签（如：剧情游戏、故事虚构、角色扮演）"
防止游戏剧情内容被脱水成真实事件记录。

### 图谱页缓存策略（`app/graph/page.tsx`）
三级缓存以减少重复加载：
1. **sessionStorage `graph_data`** — 缓存 API 返回的桶列表，刷新/切Tab回来时不重拉
2. **localStorage `graph_positions`** — 缓存力导向布局计算结果（200节点 × 150迭代 = O(n²) 计算），带指纹校验
3. **`computedKeyRef`** — 内存级防重复计算，相同数据 hash 不重新跑力导向
- 指纹 `simpleHash()` 基于桶列表的 id + score + domain 拼接
- 数据变化时自动失效重算

### 日记页设计（`app/journal/page.tsx`）
- 垂直时间轴布局：CSS `.tl-line`（2px 竖线，left:21）、`.tl-dot`（14px 圆点，绝对定位 left: -39）
- 卡片内容区域统一 `marginLeft: 54`（为时间轴留空），标题和弹窗用不同的组件样式
- 详情弹窗：居中 overlay，`max-h-[80vh]` 固定高度，内容区 `overflow-y-auto custom-scroll`
- 弹窗样式**和 BucketDetailDrawer 不同** — 日记弹窗是自己实现的居中 modal，不是侧边抽屉
- 搜索框：仿主页面搜索样式（圆角 container + 放大镜 SVG icon + input）
- 日期筛选：合并为单个组件，两个 date input 用"至"连接
- 底部统计：言之（橙）、小羊（蓝）、共同（灰）三种 author 标签色

---

## 待办事项

### Bug / 优化
- [ ] Prompt 修改持久化（目前只改内存，重启丢失）
- [ ] dehydrate 缓存失效策略（prompt 改了后旧缓存应清除）

### 新功能（按优先级）
- [ ] 关系图谱页和主页面等 UI 风格统一（graph 页视觉和其他页面有不一致）
- [ ] 导入记忆页面（从开发者 dashboard 移植）
- [ ] 梦境展示页面
- [ ] 情绪系统前端页面
- [ ] 桶合并功能
- [ ] 记忆密度可视化
- [ ] 里程碑时间线 / 纪念日倒计时