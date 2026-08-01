# 技术债务 / 待删 / 冗余 清单

> 给 AI 看的账本。凡是有「没做完 / 不确定 / 留待处理 / 疑似废弃 / 刻意保留」的东西，都记在这里，**不靠记忆**。
> 每次改动收尾时检查一遍：新增的遗留要补进来，已解决的标 ✅ 并附日期。
>
> 状态标记：
> - 🟥 **确认废弃 / 可删** —— 已查实无引用，删之前看「删除前置」栏
> - 🟨 **待确认** —— 疑似废弃，但还没查实或涉及决策
> - 🟦 **刻意保留** —— 明确为回退 / 对比 / 兜底保留，别当孤儿误删
> - ✅ **已解决**

---

## dashboard（ob-dashboard2）

### 🟥 4.6 导航重构死代码（用户已拍板删，等执行）

| 项 | 说明 | 删除前置 |
|---|---|---|
| `app/components/NavBar.tsx` | 桌面顶部横条，被 `SideRail` 取代，无引用 | 已确认无 import，直接删 |
| `app/components/MobileViewSwitch.tsx` | 两格切换，被 `MemoryViewSwitch` 取代，无引用 | 已确认无 import，直接删 |
| `app/chat/` | 聊天旧页面，导航无入口，无引用 | 已确认无引用，直接删 |
| `app/review/` | 审阅旧页面，导航无入口，无引用 | 已确认无引用，直接删 |

> ⚠️ 关联：删 `review/` 页后，`app/api/review-status/route.ts` 会变成孤儿（它只有 review 页在用），届时一并处理。

### 🟥 孤儿 API route（0 引用，已查实）

| 项 | 说明 | 删除前置 |
|---|---|---|
| `app/api/provider-relay/route.ts` | 全项目无 fetch / 字符串引用 | 可能是早期 cc 方案遗留，删前确认不需要回归 |
| `app/api/mcp-relay/[...path]/route.ts` | 全项目无引用 | 同上 |

### 🟦 刻意保留（别删）

| 项 | 说明 |
|---|---|
| `app/api/cc-test/route.ts` | 注释明确「第 1 步的 /api/cc-test 保持原样不动，出问题时回归对比」 |
| `app/api/cc-hook-test/route.ts` | 同上，hook 回归对比用 |

---

## Haven（Ombre-Brain-Haven）

### 🟨 待评估

| 项 | 说明 | 为什么待定 |
|---|---|---|
| `dashboard.html`（355KB）+ `dashboard_assets/` | **仍在被使用**：`server.py` 的 `/dashboard` 路由（~13055 行）服务它，README 也把它当正式 Dashboard 入口 | 它是「后端内置单文件 Dashboard」，与 Vercel 前端 ob-dashboard2 **并存**。体积很大，是否继续维护 / 瘦身 / 用前端取代，是产品决策 |
| `INTERNALS.md`（608 行） | 内部开发文档，写「最后更新 2026-04-19」 | 与 CLAUDE.md / README 大面积重叠，建议归档 `docs/` |
| `BEHAVIOR_SPEC.md`（632 行） | 行为规格旧版，4/21 后未动 | 同上，建议归档 |
| `state/`、`data/` 目录 | 运行时状态 / 数据 | 需确认是否被 git 跟踪（违反「.data 不做唯一持久存储」原则的风险） |

### 🟦 刻意保留

| 项 | 说明 |
|---|---|
| `CLAUDE_PROMPT.md` | 给 Claude/ChatGPT 的行为指引，与代码文档是不同用途 |
| `docs/Tool Guide.md` | 粘贴给外部平台的使用指南 |

---

## 未接入功能 / 遗留（规范列表）

> dashboard 的 CLAUDE.md 与 Haven 的 CLAUDE.md 都引用这份，以这里为准。

- [ ] **重新脱水（redehydrate）** —— Fork 有 `/api/bucket/{id}/redehydrate` + redehydrate-commit
- [ ] **控制台配置页** —— 多组 LLM profile、衰减权重 UI 调节。⚠️ 待确认：Haven 已做 `settings/upstream` 等 5 个配置子页，这条可能已实现
- [ ] **自动备份** —— GitHub Actions 每天备份 buckets 到私有仓库
- [ ] **情感唤起罗盘** —— 手机端 2D 心情坐标选记忆 + LLM 叙事

---

## 排查注意事项（每次动 TECH_DEBT 里的项之前）

1. **查引用用 grep，不信记忆**：删文件前 `grep -rn "名字" app --include=*.tsx`，确认 0 引用。
2. **动态拼接要防**：有的 route 被 `fetch(\`/api/${x}\`)` 动态调用，grep 字面串会漏。确认时连 `lib/`、`cc/`、动态模板串一起查。
3. **注释不是引用**：cc-test 只被 cc-hook-test 的注释提到，算 0 引用。
4. **后端还在服务的文件≠废弃**：dashboard.html 就是反例，查 `server.py` 路由再下结论。
