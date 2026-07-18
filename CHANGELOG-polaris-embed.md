# Polaris 嵌入 ob-dashboard2 — 变更记录

> 2026-07-19 完成，阶段一 / 三步中的第一步

## 概述

将聊天前端 Polaris 作为 `/chat` 模块嵌入 ob-dashboard2，方案 B（Monorepo + Vercel Rewrites），ob-dashboard2 作为统一壳。一个域名、一个 PWA、一次部署。

## 新增文件

| 文件 | 用途 |
|------|------|
| `scripts/build-polaris.sh` | 从 `../polaris-local-first/` 构建 Polaris（`base: /chat/`），复制产物到 `public/chat/` |
| `vercel.json` | `/chat` → `/chat/index.html`，`/chat/:path*` 静态资源 rewrites |
| `app/api/gateway/chat/completions/route.ts` | OpenAI-compatible 代理到 Haven Gateway，支持 SSE 流式透传，`X-Ombre-Session-Id` 传递 |
| `public/sw.js` | PWA Service Worker：Cache First（静态资源）/ Network First（API + HTML）/ SWR（图片图标） |
| `app/components/ServiceWorkerRegister.tsx` | SW 注册客户端组件，在 `layout.tsx` 中引用 |

## 修改文件

### ob-dashboard2

| 文件 | 改动 |
|------|------|
| `package.json` | +2 script：`build:polaris` / `prebuild`（Vercel 自动串联） |
| `app/components/NavBar.tsx` | `PAGE_LINKS` 首位新增 `{ slug: 'chat', href: '/chat', label: '聊天' }` |
| `app/components/BottomTabBar.tsx` | 重新布局 5 Tab：聊天/记忆/审阅/Breath/设置。日记迁入「更多」弹出菜单 |
| `app/layout.tsx` | 引入 `ServiceWorkerRegister` |
| `next.config.ts` | `headers()` 配置 `Service-Worker-Allowed: /` |
| `.gitignore` | 忽略 `/public/chat/`（构建产物） |

### polaris-local-first

| 文件 | 改动 |
|------|------|
| `vite.config.ts` | `base: '/chat/'` — 仅此一行 |

## 关键决策

- **Polaris 不放在 ob-dashboard2 目录内**：git submodule 会导致 Turbopack 错误扫描 `polaris/src/app/` 目录。改为外部路径 `../polaris-local-first/`，构建脚本通过 `POLARIS_SOURCE` 环境变量指向它
- **Polaris 零业务改动**：只改 Vite base path，不影响任何 UI 或逻辑
- **Gateway 代理暂时可用**：Polaris 用户配 Provider → Base URL `/api/gateway` → Gateway 注入记忆上下文后转发 upstream LLM
- **Session MVP 级别**：不映射 Polaris conversation ↔ Haven session_id，Gateway 用默认 `main` session

## 本地构建已知问题

Next.js 16 workspace root 检测因 `C:\Users\yangh\package-lock.json` 选错根目录。本地 `npm run dev` 正常，`npm run build` 需在 `ob-dashboard2` 目录下运行。Vercel 部署不受影响。

## Vercel 环境变量

| 变量 | 值 |
|------|-----|
| `OMBRE_BASE_URL` | `https://foryan.zeabur.app` |
| `NEXT_PUBLIC_OMBRE_BASE_URL` | 同上 |
| `OMBRE_SESSION` | (密码) |
| `NEXT_PUBLIC_OMBRE_SESSION` | (密码) |
| `HAVEN_GATEWAY_URL` | (Gateway URL，同 OMBRE_BASE_URL 直到 Gateway 独立部署) |

## 变更统计

- ob-dashboard2：5 新文件, 6 修改, ~200 行净增
- polaris-local-first：1 行
