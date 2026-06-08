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

`lib/api.ts` 有一份，各 route.ts 也各自有一份（待重构统一）。

---

## 文件结构

### `app/api/` — Next.js API Routes（代理到 OB 后端）

| 路径 | 方法 | 说明 |
|------|------|------|
| `buckets/route.ts` | GET | 获取所有桶列表 |
| `bucket/[id]/route.ts` | GET | 单个桶详情 |
| `add-bucket/route.ts` | POST | 新建桶（走 MCP trace） |
| `edit-bucket/route.ts` | POST | 编辑桶（MCP trace，支持 content/pinned/resolved/digested/tags/importance/delete） |
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
| `prompts/page.tsx` | Prompt 配置页面（可折叠编辑，测试弹窗） |
| `bucket/[id]/page.tsx` | 桶详情独立页面 |

### `app/lib/api.ts`

统一 API 函数：`getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`

### `components/BucketDetailDrawer`

桶详情抽屉，主页面和 breath-sim 共用。

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
GET  /api/search?q=&include_archive=&limit=  # 搜索（limit默认=max_results，show_all默认false）
POST /api/touch/{id}?ripple=true/false   # 轻触(false) 或完整激活(true，+1激活+涟漪)
POST /api/archive/{id}                   # 物理归档（移文件到archive_dir）
POST /api/unarchive/{id}                 # 恢复归档
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

### MCP（不走 REST）
```
edit-bucket / add-bucket 走 MCP trace 工具，通过 getMcpSession() 获取 session
```

---

## 关键实现细节

### Next.js 15 动态路由
params 是 Promise，必须 `const { id } = await params`，**不能直接用 params.id**（会是 undefined）。

### MCP vs REST 边界
- `trace/hold/grow/breath` 等 OB 工具 → MCP 协议
- `buckets/search/touch/archive/config/prompts` → REST API
- `edit-bucket/add-bucket` 目前走 MCP，待迁移到 REST

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

---

## 待办事项

### Bug / 优化
- [ ] getSessionCookie 统一到 lib/api.ts，各 route.ts 不再各自实现
- [ ] MCP 接口迁移到 REST（add-bucket, edit-bucket）
- [ ] Prompt 修改持久化（目前只改内存，重启丢失）
- [ ] dehydrate 缓存失效策略（prompt 改了后旧缓存应清除）

### 新功能（按优先级）
- [ ] breath-sim：语义关联桶展示
- [ ] 单个桶详情显示语义关联桶
- [ ] 导入记忆页面（从开发者 dashboard 移植）
- [ ] 梦境展示页面
- [ ] 情绪系统前端页面
- [ ] 桶合并功能
- [ ] 记忆密度可视化
- [ ] 里程碑时间线 / 纪念日倒计时