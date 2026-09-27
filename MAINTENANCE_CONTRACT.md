# 维护契约（Maintenance Contract）

> **给 AI 看的**。每个工作窗口开工时和当前仓库 `AGENTS.md` 一起读；每次代码改动收尾时，按「变更 → 同步表」确认哪些文档要更新，再算完成。
>
> 铁律：
> 1. **一份事实只写一处。** 同一件事不要在两个文档里各写一份，否则必然对不齐。
> 2. **文档是交付物的一部分，不是可选项。** 改完代码没同步文档 = 没改完。
> 3. **只同步命中的行。** 没动的东西不顺手改。
> 4. **待办分三处，各管一件事。** 想做的功能 / 活 → OB Todo（`create_todo` / `list_todos`，每条一句话）；代码层面的债务和需要细节的技术卡 → `TECH_DEBT.md`（卡里写对应 Todo ID，新卡同时加进顶部索引；闲聊窗口只能记 Todo，需要细节时由工作窗口补卡）；`docs/handoff/` 是历史档案，每份状态只看 `docs/handoff/README.md`。没有 OB 工具的 AI（如 Codex）不另找地方记待办：把 Todo 原句（一句话 + 背景）列在最终回复里由用户转交；需要细节的照常开 `TECH_DEBT.md` 卡，Todo ID 栏先填 `待录`。

---

## 一、变更 → 同步表

### dashboard（ob-dashboard2）

| 你改了什么 | 必须同步 | 说明 |
|---|---|---|
| 新增 / 删除 / 改名页面（`app/*/page.tsx`） | dashboard `docs/reference.md`「文件结构速查」 | 页面表 = 导航真相，漏了新窗口就找不到页 |
| 改导航结构（`SideRail` / `BottomTabBar` / 设置聚合页） | dashboard `AGENTS.md`「设计与组件」导航条 | |
| 新增 / 改有特殊逻辑的 API route | dashboard `docs/reference.md`「文件结构速查」`app/api` 行 | 纯透传的不写 |
| 新增 / 改共享组件 | dashboard `AGENTS.md`「设计与组件」 | 只写统一约定，不列全部组件 |
| 改 cc 引擎 / 持久化 / 滚动 / 唤醒契约 | dashboard `docs/reference.md`「cc 数据持久化契约」 | 机制说明较长的放 `docs/architecture.md` |
| 改协作 / git / 部署规矩 | 对应仓库 `AGENTS.md` | |
| 改设计 token / 配色 / 圆角 / 间距 | `DESIGN.md` + `globals.css` | |
| 新增 cc 数据 / 配置 / 用户开关 | 先查 `AGENTS.md`「cc 数据持久化规则」→ 判断存 Haven 还是浏览器 | 含密钥只能服务端读写 |
| 想做但这次不做的功能 / 活 | OB Todo（一句话） | 需要细节的另开 `TECH_DEBT.md` 技术卡，Todo 背景里写卡号 |
| 跨窗口进行中的大活 | 对应 `HANDOFF-*.md` + `docs/handoff/README.md` 登记 | 写明当前状态、已定决定、下一步和验收方法；做完在索引里标归档 |
| 代码层面的遗留 / 风险 / 刻意保留项 | `TECH_DEBT.md` | 记录影响、暂不处理原因和未来处理条件 |
| 关闭以前记录过的卡 | 从 `TECH_DEBT.md` 移到 `docs/tech-debt-archive.md`，索引删掉对应行 | 附关闭日期；有 Todo 的一起勾掉 |

### Haven（Ombre-Brain-Haven）

| 你改了什么 | 必须同步 | 说明 |
|---|---|---|
| 新增 / 改后端模块 | Haven `docs/reference.md`「核心模块」表 | |
| 新增 / 改 REST 路由 | Haven `docs/reference.md`「REST API」分组 | 全量以代码为准，用 `grep -oE "@mcp\.custom_route\(\"[^\"]*\"" server.py` 实时核对 |
| 改环境变量 / 启动 / 部署 | `ENV_VARS.md` + `README.md`「部署」 | 环境变量只写一份在 ENV_VARS，别复制进 reference / AGENTS |
| 改行为 / 记忆逻辑 / 影响外部接入 | `README.md`（系统级总览） | |
| 改给 Claude / ChatGPT 用的行为指引 | `CLAUDE_PROMPT.md` + `docs/Tool Guide.md` | 改行为后同步，否则外部接入用的是旧指引 |
| 改 cc 持久化 / 表结构 | Haven `docs/reference.md`「cc 持久化（Haven 侧）」节 | |
| 改合并 / 评分 / 召回算法 | Haven `docs/reference.md`「关键实现细节」对应节；召回链路同步 `docs/recall-pipeline.md` | |

### 跨仓库

| 场景 | 要动的 |
|---|---|
| 后端接口改了，前端调用方跟着改 | dashboard `docs/reference.md`「文件结构速查」`app/api` 行 + Haven `docs/reference.md`「REST API」 |
| 跨仓库功能想做 / 完成 | OB Todo 新增 / 勾掉；完成事实同步两端正式文档 |
| 跨仓库代码遗留新增 / 关闭 | `TECH_DEBT.md` 新增卡 / 移入归档 |

---

## 二、每次改动固定收尾流程（AI 照做）

1. **动手前列范围清单**：改哪个文件 / 改什么逻辑 / 不改什么 → 用户确认。
2. **改代码**。
3. **验证**（缺一不可）：
   - `npm run build` 通过（dashboard）；
   - 新增文件确认「被用」（grep 引用）；
   - 删除文件确认「无引用」（grep 引用）。
4. **打开这份维护契约**，按第一节表命中行，同步对应文档。
5. **归档未完成事项**：想做的功能 / 活 → OB Todo（一句话）；代码层面的债务或需要细节的技术卡 → `TECH_DEBT.md`；handoff 只作历史档案，状态更新到 `docs/handoff/README.md`。
6. **commit + push**：CC 可直接提交并 push `main`（见 `AGENTS.md`「Git 与部署」）。
7. **确认部署**：Dashboard push `main` 后由 Coolify 自动部署；Haven push `main` 后先跑 GitHub Actions `Tests`，通过后由 `deploy-haven` job 更新 `HAVEN_RELEASE_SHA` 并部署（见 Haven `AGENTS.md`）。确认最新 deployment 对应目标 commit 且健康，未触发或失败时才手动 Redeploy。

---

## 三、开发流程规范（防对不齐 / 防历史遗留）

> 用户非专业背景，靠口头交接 + 直接 push 容易积累对不齐。以下机制把「交接物」从口头变成文档，AI 必须维护。

1. **一次一个改动。** 一件事查完 / 改完再开下一件，不要一个会话里堆积多个不相干改动。
2. **改完必验证才交付。** 「build 过了 + 引用查过了」才算完，不给用户埋雷。
3. **文档同步 = 完成。** 改完代码 → 查维护契约 → 同步 → 才算 done。
4. **未完成事项即时归档。** 按铁律 4 分流：活 → OB Todo，代码债 / 技术卡 → `TECH_DEBT.md`。
5. **commit message 由 AI 拟。** 用户 push 时用它，git log 可追溯（这条本身就是防对不齐）。
6. **回退件必须注释说明。** 刻意留着的代码（cc-test、cc-hook-test 这类）在文件头写明「留作回退」，否则下个窗口会当孤儿误删。
7. **换窗口前结论已落盘。** 口头说清的不算；小活记进 OB Todo / `TECH_DEBT.md`，跨窗口大活把当前进度、已定决定、下一步和验收方法写进对应 handoff 并在索引登记后才能换窗。
8. **易错项用文档钉死。** 域名、端口、环境变量这类写进对应文档，不靠每次重查。

---

## 四、跨仓库文档地图（定位用）

### ob-dashboard2（前端，VPS / Coolify）
| 文档 | 职责 |
|---|---|
| `AGENTS.md` | 入口：开工必读、协作 / git / 部署 / 设计 / 持久化硬规矩 |
| `CLAUDE.md` | 只有一行 `@AGENTS.md`，不放内容 |
| `MAINTENANCE_CONTRACT.md` | **本文件**：维护契约 |
| `docs/reference.md` | 查表：环境变量、文件结构、API 特殊逻辑、cc 持久化契约 |
| `docs/architecture.md` | 详细实现机制 |
| `TECH_DEBT.md` | 开着的代码债务 / 刻意保留项 / 技术卡，顶部索引 |
| `docs/tech-debt-archive.md` | 已关闭的卡 |
| `docs/handoff/README.md` | handoff 历史档案的状态索引 |
| `DESIGN.md` | 设计 token 规范 |

### Ombre-Brain-Haven（后端，VPS / Coolify）
| 文档 | 职责 |
|---|---|
| `README.md` | 系统级总览 / 架构 / 部署 / 客户端接入（**系统事实源**） |
| `AGENTS.md` | 入口：开工必读、持久化 / 发布硬规矩 |
| `CLAUDE.md` | 只有一行 `@AGENTS.md`，不放内容 |
| `docs/reference.md` | 查表：模块 / 配置 / REST 路由 / 实现细节 / 调试命令 |
| `docs/recall-pipeline.md` | 召回链路架构 |
| `docs/memory-system-roadmap.md` | 记忆系统运行基线与后续方向 |
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
