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

`lib/api.ts` 中 `getSessionCookie()` 统一管理。**已加 5 分钟内存缓存**，避免每次 fetch 重复 POST `/auth/login`。所有 API proxy route 共用同一份。

---

## 文件结构

### 共享组件 `app/components/`

**导航系：**
| 文件 | 说明 |
|------|------|
| `NavBar.tsx` | 桌面端顶部导航栏（`hidden md:block`），全站 8 页共用 |
| `BottomTabBar.tsx` | 🆕 手机端底部 5 栏 Tab Bar（记忆/审阅/日记/Breath/设置） |
| `MobileViewSwitch.tsx` | 🆕 手机端记忆页时间线/记忆格切换 |
| `MobileShell.tsx` | 🆕 手机端布局容器（加底部间距，包装全站） |

**弹窗系：**
| 文件 | 说明 |
|------|------|
| `DetailPanel.tsx` | 🆕 统一弹窗壳：`mode="drawer"` 右侧滑入，`mode="modal"` 居中弹出。替代了各页面独立弹窗 |
| `BucketDetailDrawer.tsx` | 桶详情内容区，含噪声标记、相似记忆推荐、合并预览（壳已换成 DetailPanel） |

**UI 原子组件：**
| 文件 | 说明 |
|------|------|
| `StatusBadge.tsx` | 🆕 桶状态标签（pinned/resolved/digested/noise/feel/wish），导出 `statusLabel()` 判断函数 |
| `TagPill.tsx` | 🆕 domain/tag 标签胶囊，区分 domain 和 tag 两种变体 |
| `DataBadge.tsx` | 🆕 score/imp 等数字展示胶囊 |
| `Stat.tsx` | 🆕 统计格子 |
| `Card.tsx` | 🆕 统一卡片壳（variant: interactive/outline/ghost/empty） |
| `SearchBar.tsx` | 🆕 全站统一药丸搜索框 |
| `FilterBar.tsx` | 🆕 筛选按钮行容器 + `FilterPill` 单个筛选药丸 |
| `KnobRow.tsx` | 🆕 评分旋钮滑条 |
| `KnobToggle.tsx` | 🆕 评分旋钮开关 |
| `ScoreBar.tsx` | 🆕 Pipeline 四维评分条 |

> 完整设计规范见 `DESIGN.md`。

### `app/api/` — Next.js API Routes（代理到 OB 后端）

| 路径 | 方法 | 说明 |
|------|------|------|
| `buckets/route.ts` | GET | 桶列表 |
| `bucket/[id]/route.ts` | GET | 单个桶详情 |
| `add-bucket/route.ts` | POST | 新建桶 |
| `edit-bucket/route.ts` | POST | 编辑/删除桶（噪声标记、字段修改、delete:true） |
| `search/route.ts` | GET | **透传全部 query params**（含 simulate, include_vector, limit 等） |
| `breath-debug/route.ts` | GET | 模拟 breath |
| `journal/route.ts` | GET/POST | 日记列表 / 新建日记 |
| `to-journal/route.ts` | POST | 桶转日记 |
| `config/route.ts` | GET/POST | fuzzy_threshold 配置 |
| `prompts/route.ts` | GET/POST | prompt 配置 |
| `prompts/test/route.ts` | POST | prompt 效果测试 |
| `touch/[id]/route.ts` | POST | 轻触 / 激活 |
| `archive/[id]/route.ts` | POST | 归档 |
| `review-status/route.ts` | POST | 审阅状态 |
| `hit-stats/route.ts` | GET/POST | 🆕 命中统计 |
| `recent-searches/route.ts` | GET | 🆕 检索追溯 |
| `scoring-config/route.ts` | GET/POST | 🆕 检索评分旋钮 |
| `import-upload/route.ts` | POST | 🆕 上传导入文件 |
| `import-status/route.ts` | GET | 🆕 导入进度 |
| `import-results/route.ts` | GET | 🆕 导入结果列表 |
| `bucket/[id]/similar/route.ts` | GET | 🆕 相似桶查找 |
| `bucket/[id]/merge-preview/route.ts` | POST | 🆕 合并预览 |
| `bucket/[id]/merge-commit/route.ts` | POST | 🆕 确认合并 |
| `bucket/[id]/restore/route.ts` | POST | 🆕 恢复桶 |
| `bucket/[id]/purge/route.ts` | POST | 🆕 彻底删除 |
| `trash/route.ts` | GET/POST | 🆕 回收站列表 / 清空 |

### `app/` — 页面

| 路径 | 说明 |
|------|------|
| `page.tsx` | 主页面（时间线/记忆格/审阅，含噪声筛选 + 隐藏开关 + 乐观更新） |
| `breath-sim/page.tsx` | **重写** — 5 Tab：Pipeline / 即时模拟 / 检索评分旋钮 / 命中统计 / 检索追溯 |
| `graph/page.tsx` | 关系图谱（力导向 + 抽屉） |
| `journal/page.tsx` | 日记页（垂直时间轴） |
| `import/page.tsx` | 🆕 **导入工作台**：拖拽/粘贴、大/小模式、试跑、进度+费用、完成后审查 |
| `trash/page.tsx` | 🆕 **回收站**：恢复/彻底删除/清空 |
| `review/page.tsx` | 审阅页面 |
| `prompts/page.tsx` | Prompt 配置 |

### `app/lib/api.ts`

- `getSessionCookie()` — 带 5min 缓存
- `clearSessionCookie()` — 手动清除缓存
- `getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`

---

## OB 后端接口汇总

### 认证
```
POST /auth/login  { password }  →  set-cookie
```

### 桶管理
```
GET    /api/buckets                         # 所有桶
GET    /api/bucket/{id}                     # 单个桶
POST   /api/bucket                          # 新建
PATCH  /api/bucket/{id}                     # 更新字段
DELETE /api/bucket/{id}                     # 软删除（移入回收站）
POST   /api/touch/{id}?ripple=true/false    # 轻触/激活
POST   /api/archive/{id}                    # 归档
POST   /api/unarchive/{id}                  # 恢复归档
```

### 搜索 & 模拟
```
GET /api/search?q=&simulate=&include_vector=&include_noise=&limit=
# simulate=true → 返回 matched_fields + vector_similarity
# include_vector=true → 附加 embedding 向量相似度
# include_noise=true → 包含噪声桶
GET /api/breath-debug?q=&valence=&arousal=&threshold=
# 四维评分可视化，top 50
```

### 回收站 🆕
```
GET  /api/trash                  # 列表
POST /api/trash/empty            # 清空
POST /api/bucket/{id}/restore    # 恢复
POST /api/bucket/{id}/purge      # 彻底删除
```

### 相似 & 合并 🆕
```
GET  /api/bucket/{id}/similar?n=5                # embedding 相似桶
POST /api/bucket/{id}/merge-preview?into={id}    # LLM 合并预览 + 费用
POST /api/bucket/{id}/merge-commit?into={id}     # 确认合并
```

### 可观测性 🆕
```
GET  /api/hit-stats?limit=&include_zero=&order=   # 命中统计
POST /api/hit-stats/reset                         # 重置统计
GET  /api/recent-searches?limit=                  # 检索追溯
GET  /api/scoring-config                          # 读旋钮
POST /api/scoring-config                          # 写旋钮
POST /api/scoring-config/reset                    # 重置旋钮
```

### 日记
```
GET  /api/journal                         # 列表（60s 缓存）
POST /api/journal                         # 新建
POST /api/bucket/{id}/to-journal          # 桶转日记
```

### 导入
```
POST /api/import/upload?mode=&max_chunks=  # 上传 + 启动导入
GET  /api/import/status                    # 进度（含 total_cost_usd）
GET  /api/import/results?limit=            # 导入结果列表
POST /api/import/review                    # 审查决策
```

### 配置
```
GET  /api/config                     # { fuzzy_threshold, max_results }
POST /api/config { fuzzy_threshold } # 更新（重启恢复默认，持久化待做）
GET  /api/prompts                    # 读 prompt
POST /api/prompts                    # 写 prompt
POST /api/prompts/test               # 测试 prompt
```

---

## 导航架构

### 桌面端
`NavBar` 横向排列全部页面入口（`hidden md:block`），`max-w-6xl` 统一宽度。

### 手机端
`BottomTabBar` 固定在底部（`md:hidden`），5 个 Tab：
- 审阅 → `/?tab=review`
- 日记 → `/journal`
- **记忆**（中间圆形突起）→ `/`
- Breath → `/breath-sim`
- 设置（点击向上弹出菜单：关系图谱/导入/回收站/权重配置）

记忆页顶部 mini header：左 Ombre Brain logo，右 `MobileViewSwitch`（时间线/记忆格切换）。所有页面通过 `MobileShell` 包裹获得底部安全间距。

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
软删除：文件移到 `buckets/trash/`，保留 `original_type` + `trashed_at`。恢复/彻底删除/清空均通过 BucketManager 方法。

### 相似记忆
依赖 embedding 引擎。BucketDetailDrawer 打开时自动查询 top 5，可手动刷新。显示相似度 + 内容预览 + 合并预览按钮。

### 合并流程
1. 点击「合并预览」→ POST merge-preview → LLM 生成合并结果 + 费用估算
2. 弹窗三栏对比（A 源 / B 目标 / 合并结果）
3. 确认 → POST merge-commit → 更新 B 内容+元数据，删除 A

### 命中统计 & 追溯
`buckets/hit_stats.json` 持久化。search() 自动记录（`record_stats=True`），即时模拟（`simulate=true`）不记录。

### 检索评分旋钮
5 个运行时旋钮，通过 `/api/scoring-config` 读写，持久化到 `runtime_config.json`，重启不丢。全部默认值 = 跟上游行为一致。

### Journal 缓存
GET `/api/journal` 60s TTL 内存缓存。新建日记时自动 invalidate。

### 会话 Cookie 缓存
`getSessionCookie()` 5min 内存缓存。避免每次 API 请求重复 POST `/auth/login`。

---

## 待办事项

### 未接入的 Fork 功能
- [ ] 重新脱水（redehydrate）— 不满意 LLM 结果可重做 + 预览对比
- [ ] 控制台配置页 — 多组 LLM profile 切换、衰减权重可视化
- [ ] 自动备份 — GitHub Actions 每天备份 buckets
- [ ] 导入增强 — 长摘要 source_excerpt、Claude Exporter 插件支持、原文时间戳嵌入
- [ ] 即时模拟增强 — 分词器命中详情可视化、最近浮现/检索分离标记

### Bug / 优化
- [ ] Prompt 修改持久化（目前只改内存，重启丢失）
- [ ] dehydrate 缓存失效策略（prompt 改了后旧缓存应清除）
- [ ] 关系图谱页 UI 和其他页面风格统一
