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
| `NavBar.tsx` | 桌面端顶部导航栏（`hidden md:block`），全站 8 页共用 |
| `BottomTabBar.tsx` | 手机端底部 5 栏 Tab Bar（记忆/审阅/日记/Breath/设置） |
| `MobileViewSwitch.tsx` | 手机端记忆页时间线/记忆格切换 |
| `MobileShell.tsx` | 手机端布局容器（加底部间距，包装全站） |

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

> 完整设计规范见 `DESIGN.md`。

### `app/api/` — API Routes（代理到 OB 后端）

大部分 route 是简单透传。以下是有特殊处理逻辑的：

| 路径 | 说明 |
|------|------|
| `search/route.ts` | GET — 透传全部 query params（simulate, include_vector, include_noise, limit 等） |
| `edit-bucket/route.ts` | POST — 噪声标记/撤销、字段修改、delete:true 软删除 |
| `breath-debug/route.ts` | GET — 模拟 breath 四维评分 |

其余 route（buckets、bucket/[id]、add-bucket、journal、to-journal、config、prompts、touch、archive、review-status、import-*、trash、scoring-config、hit-stats、recent-searches 等）均为透传代理，完整接口参考见 **Ombre Brain CLAUDE.md**。

### `app/` — 页面

| 路径 | 说明 |
|------|------|
| `page.tsx` | 主页面（时间线/记忆格/审阅，含噪声筛选 + 隐藏开关 + 乐观更新） |
| `breath-sim/page.tsx` | 5 Tab：Pipeline / 即时模拟 / 检索评分旋钮 / 命中统计 / 检索追溯 |
| `graph/page.tsx` | 关系图谱（力导向 + 抽屉） |
| `journal/page.tsx` | 日记页（垂直时间轴） |
| `import/page.tsx` | 导入工作台：拖拽/粘贴、大/小模式、试跑、进度+费用、完成后审查 |
| `trash/page.tsx` | 回收站：恢复/彻底删除/清空 |
| `review/page.tsx` | 审阅页面 |
| `prompts/page.tsx` | Prompt 配置 |

### `app/lib/api.ts`

- `getSessionCookie()` — 带 5min 缓存
- `clearSessionCookie()` — 手动清除缓存
- `getBuckets()`, `getBucket(id)`, `searchBuckets(q, includeArchived)`

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

---

## 待办事项

未接入 / 已知问题统一维护在 **Ombre Brain CLAUDE.md**。前端特有项：

- [ ] 关系图谱页 UI 和其他页面风格统一
