# 维护契约（Maintenance Contract）

> **给 AI 看的**。每次代码改动收尾时，必须先读这份，按「变更 → 同步表」确认哪些文档要更新，再算完成。
>
> 铁律：
> 1. **一份事实只写一处。** 同一件事不要在两个文档里各写一份，否则必然对不齐。
> 2. **文档是交付物的一部分，不是可选项。** 改完代码没同步文档 = 没改完。
> 3. **只同步命中的行。** 没动的东西不顺手改。
> 4. **已排期工作不是技术债务。** 后续窗口已确定要做的内容写入对应 handoff；没有明确排期、当前接受保留的遗留问题才进入 `TECH_DEBT.md`。

---

## 一、变更 → 同步表

### dashboard（ob-dashboard2）

| 你改了什么 | 必须同步 | 说明 |
|---|---|---|
| 新增 / 删除 / 改名页面（`app/*/page.tsx`） | dashboard `CLAUDE.md`「页面」表 | 页面表 = 导航真相，漏了新窗口就找不到页 |
| 改导航结构（`SideRail` / `BottomTabBar` / 设置聚合页） | dashboard `CLAUDE.md`「导航架构」 | |
| 新增 / 改有特殊逻辑的 API route | dashboard `CLAUDE.md`「app/api」表 | 纯透传的不写 |
| 新增 / 改共享组件 | dashboard `CLAUDE.md`「组件」表 | |
| 改设计 token / 配色 / 圆角 / 间距 | `DESIGN.md` + `globals.css` | |
| 新增 cc 数据 / 配置 / 用户开关 | 先查 `AGENTS.md`「cc 数据持久化规则」→ 判断存 Haven 还是浏览器 | 含密钥只能服务端读写 |
| 已确定由后续窗口继续实施 | 对应 `HANDOFF-*.md` | 写明当前状态、已定决定、下一步和验收方法 |
| 短期不处理且没有明确排期的遗留 / 风险 / 刻意保留项 | `TECH_DEBT.md` | 记录影响、暂不处理原因和未来处理条件 |
| 改的是以前记录过的遗留项 | `TECH_DEBT.md` 对应项标 ✅ | 附解决日期 |

### Haven（Ombre-Brain-Haven）

| 你改了什么 | 必须同步 | 说明 |
|---|---|---|
| 新增 / 改后端模块 | Haven `CLAUDE.md`「核心模块」表 | |
| 新增 / 改 REST 路由 | Haven `CLAUDE.md`「REST API」分组 | 全量以代码为准，用 `grep -oE "@mcp\.custom_route\(\"[^\"]*\"" server.py` 实时核对 |
| 改环境变量 / 启动 / 部署 | `ENV_VARS.md` + `README.md`「部署」 | 环境变量只写一份在 ENV_VARS，别复制进 CLAUDE.md |
| 改行为 / 记忆逻辑 / 影响外部接入 | `README.md`（系统级总览） | |
| 改给 Claude / ChatGPT 用的行为指引 | `CLAUDE_PROMPT.md` + `docs/Tool Guide.md` | 改行为后同步，否则外部接入用的是旧指引 |
| 改 cc 持久化 / 表结构 | Haven `CLAUDE.md`「cc 持久化」节 | |
| 改合并 / 评分 / 召回算法 | Haven `CLAUDE.md`「关键实现细节」对应节 | |

### 跨仓库

| 场景 | 要动的 |
|---|---|
| 后端接口改了，前端调用方跟着改 | dashboard `CLAUDE.md`「app/api」表 + Haven `CLAUDE.md`「REST API」 |
| 已排入后续窗口的跨仓库功能新增 / 完成 | 对应 handoff；完成事实再同步两端正式文档 |
| 没有近期实施窗口的跨仓库遗留新增 / 完成 | `TECH_DEBT.md` 对应项新增 / 标 ✅ |

---

## 二、每次改动固定收尾流程（AI 照做）

1. **动手前列范围清单**：改哪个文件 / 改什么逻辑 / 不改什么 → 用户确认。
2. **改代码**。
3. **验证**（缺一不可）：
   - `npm run build` 通过（dashboard）；
   - 新增文件确认「被用」（grep 引用）；
   - 删除文件确认「无引用」（grep 引用）。
4. **打开这份维护契约**，按第一节表命中行，同步对应文档。
5. **归档未完成事项**：已安排后续窗口 → 更新对应 handoff；没有明确排期、当前接受保留 → 写入 `TECH_DEBT.md`。
6. **给用户建议 commit message**（用户自己 push）。
7. **改了 Haven 后端** → 用户 push 后确认 Zeabur 最新 deployment 已成功运行；当前自动部署成功时不要求重复部署，只有未触发或失败时才手动重新部署。

---

## 三、开发流程规范（防对不齐 / 防历史遗留）

> 用户非专业背景，靠口头交接 + 直接 push 容易积累对不齐。以下机制把「交接物」从口头变成文档，AI 必须维护。

1. **一次一个改动。** 一件事查完 / 改完再开下一件，不要一个会话里堆积多个不相干改动。
2. **改完必验证才交付。** 「build 过了 + 引用查过了」才算完，不给用户埋雷。
3. **文档同步 = 完成。** 改完代码 → 查维护契约 → 同步 → 才算 done。
4. **未完成事项即时归档。** 已确定下一窗口继续的写 handoff；没有明确排期的「以后再说」写 `TECH_DEBT.md`。
5. **commit message 由 AI 拟。** 用户 push 时用它，git log 可追溯（这条本身就是防对不齐）。
6. **回退件必须注释说明。** 刻意留着的代码（NavBar、cc-test 这类）在文件头写明「留作回退」，否则下个窗口会当孤儿误删。
7. **换窗口前结论已落盘。** 口头说清的不算；当前进度、已定决定、下一步和验收方法写进对应 handoff 后才能换窗。
8. **易错项用文档钉死。** 域名、端口、环境变量这类写进对应文档，不靠每次重查。

---

## 四、跨仓库文档地图（定位用）

### ob-dashboard2（前端，Vercel）
| 文档 | 职责 |
|---|---|
| `CLAUDE.md` | 前端全貌：页面 / API / 导航 / 组件 / 实现细节 |
| `AGENTS.md` | cc 数据持久化规则 + Next.js 版本警告 |
| `MAINTENANCE_CONTRACT.md` | **本文件**：维护契约 |
| `TECH_DEBT.md` | 没有近期排期的待删 / 冗余 / 遗留 / 刻意保留项账本 |
| `DESIGN.md` | 设计 token 规范 |

### Ombre-Brain-Haven（后端，Zeabur）
| 文档 | 职责 |
|---|---|
| `README.md` | 系统级总览 / 架构 / 部署 / 客户端接入（**系统事实源**） |
| `AGENTS.md` | Codex/代理在 Haven 中的项目级工作规则 |
| `CLAUDE.md` | 开发入口：模块 / REST 路由 / 实现细节 |
| `ENV_VARS.md` | 环境变量唯一清单 |
| `CLAUDE_PROMPT.md` | 给 Claude/ChatGPT 的行为指引 |
| `docs/Tool Guide.md` | 粘贴给外部平台的工具指南 |
| `docs/memory-layer-contract.md` | 记忆层契约 |
| `docs/deploy-zeabur.md` | Zeabur 部署步骤 |

### 记忆库（OB记忆系统/）
| 文档 | 职责 |
|---|---|
| `代码侧速查手册.md` | 我想干什么 → 去哪改 |
| `部署速查.md` | 部署精确步骤 |
| `调试速查.md` | 出问题怎么查 |
| `链路优化清单.md` | 已知未修坑（P0/P1/P2） |
