@docs/architecture.md
# ob-dashboard2

Ombre Brain 记忆系统前端看板。Next.js 16 App Router + Tailwind CSS + TypeScript。前端与 OB 后端（Haven）均部署在 VPS，由 Coolify 管理。

## 启动

```bash
npm install
npm run dev      # localhost:3000
npm run build && npm run start   # 生产构建
```

VPS production 使用根目录 `Dockerfile` 多阶段构建，容器内非 root 用户运行。

## 环境变量（.env.local）

production 必须配置以下六项：

| 变量 | 用途 |
|------|------|
| `HAVEN_GATEWAY_URL` | Haven 基础 URL（不带末尾斜杠） |
| `OMBRE_SESSION` | Haven Brain 登录密码 |
| `OMBRE_GATEWAY_TOKEN` | Haven Gateway Bearer token |
| `DASHBOARD_LOGIN_SECRET` | 公网登录口令（>=12 字符） |
| `DASHBOARD_SESSION_SECRET` | session 签名 secret（>=32 字符） |
| `OMBRE_AGENT_WAKE_RUNNER_TOKEN` | Haven 主动唤醒 callback 的独立 Bearer 共享密钥；与 Brain 相同，不返回浏览器 |

本机 `npm run dev` 继续兼容旧 `OMBRE_BASE_URL` / `NEXT_PUBLIC_OMBRE_*`。

## 文件结构速查

| 目录/文件 | 说明 |
|-----------|------|
| `app/page.tsx` | 主页（时间线/记忆格） |
| `app/memory/` | 记忆库（三格切换） |
| `app/cc/` | 聊天主页（cc / selfhost） |
| `app/workbench/` | 工作台 |
| `app/recall-lens/` | 召回透镜（按 session 查看 necessity、relevance、utility 三档、正式/Shadow 单卡结果、候选证据与中文规则解释） |
| `app/settings/` | 设置聚合页及子页 |
| `app/impressions/` | 日回顾月历 |
| `app/journal/` | 日记页 |
| `app/journey/` | 关系轨迹页 |
| `app/components/` | 共享组件 |
| `app/api/` | API 路由（大部分透传 Haven）；`edit-bucket` 保留上游状态码并转换非 JSON 错误；`cc-agent-wake` 以 CAS 管理当前窗口 wake/silence 控制面；`cc-agent-wake-runner` 以独立 Bearer 接受 Haven 的持久 wake callback；`cc-turns` 支持按 `after_round_id` 增量补消息 |
| `app/lib/` | 客户端库与工具函数 |
| `globals.css` | 设计 Token 定义 |
| `DESIGN.md` | 完整设计规范 |

## 设计规范

凡涉及页面、组件、布局、样式或交互的任务，修改前必须完整阅读 `DESIGN.md`。优先复用现有组件；颜色、边框、背景、圆角、阴影和动效必须使用现有设计 Token，禁止硬编码或自行拼装重复组件。确实缺少语义 Token 时，先更新 `globals.css` 和 `DESIGN.md`，再使用。

`CLAUDE.md` 是本仓库唯一的顶层项目规则入口，不另建内容重复的 `AGENTS.md`。完整设计规范见 `DESIGN.md`。

## 移动端优先

手机是主要使用场景，新功能和样式调整优先保证手机端体验。

## 组件约定

- **弹窗**：统一使用 `DetailPanel`（`mode="drawer"` 右侧滑入，`mode="modal"` 居中弹出）
- **卡片**：统一使用 `Card`（variant: interactive / outline / ghost / empty）
- **导航**：桌面端 `SideRail` 左侧竖栏，手机端 `BottomTabBar` 底部 5 Tab，全站 `MobileShell` 包裹
- **Next.js 动态路由**：params 是 Promise，必须 `const { id } = await params`

## 协作规范

- 先讨论后动手：高风险改动先列清单等确认；单文件小改可直接执行
- 不扩散修改范围：用户说改什么只改什么
- 排障用假设→验证，先问用户再翻代码
- 结论导向，不贴大段代码走查
- Git：CC 可直接 commit + push；VPS 部署需用户到 Coolify 手动触发
- 换窗交接：一个窗口一个问题，换窗前更新 handoff

## Token 控制

Pro 额度有限（200k context），工作窗口必须节省 token：

- 读文件先 Grep 定位行号，再 Read offset+limit 只读需要的区域
- 多次编辑同一文件不重复 Read
- git diff / build 输出过长时 `| head -80` 截断
- 回复不贴大段未修改代码
- 预判超 25 轮时主动建议拆窗口

## cc 数据持久化

- 长期配置由 Haven 持久化，不得用 `process.cwd()`、`.data`、`/tmp` 或模块全局变量作唯一存储
- 进程内状态只用于允许丢失的运行态
- `localStorage` 只用于换设备后丢失也没关系的界面偏好
- 含密钥配置只能服务端读写，浏览器只接收掩码
- CC 最终系统提示词追加前缀按窗口首次写入 Haven 后冻结；进程内 Map 只作加速，Dashboard 重部署后继续读取同一前缀
- Claude Pro 最近额度按 profile 在 Haven 保存全局单条快照，各窗口共用并显示上次读取时间，新值覆盖旧值
- CC 前台用户 turn 与后台 wake 共用进程内 `SessionTurnCoordinator` 和同一个长寿命 Agent SDK iterator：前台排队优先，后台遇到生成、压缩或待审批直接 deferred；后台只恢复 Haven 中 `cc_overrides.active_cred` 对应的最后活跃 lane、冻结 prompt 与该 lane 的 resume id。`WebSearch` / `WebFetch` schema 在前台、后台及关闭联网开关时始终固定存在，实际联网权限按每轮状态在 `PreToolUse` 拒绝，避免模式切换产生 prompt-cache 分支；每轮只记录 prompt/tools/MCP/options hash、工具名称、lane、CC session 与 iterator 冷热状态，不记录提示词正文。固定进程内 `set_agent_wake` 工具始终存在，同轮最后一次有效决定随 assistant 原文、usage、cache refresh、活动时间和 wake event 原子写入 Haven；后台禁止联网、Bash、写文件及所有需要人工批准的 MCP。No-op wake 可在固定 marker 后带一行短状态，状态与 SDK 返回的 thinking 写入 raw 历史但不生成正式助手气泡；页面以当前协作者名称显示并可折叠查看 thinking。`set_agent_wake` reason 最多 50 字。Cache refresh 只在成功 result 的 usage 确认 cache read/write 后，按模型请求开始时间计算。
- 正常用户 turn 成功提交时在 Haven 事务内只采样一次 conversation silence timer；下一条用户消息进入模型前原子取消尚未触发的 timer。新 assistant 轮次保存版本化 `display_segments`，历史仍保留一轮一条原文；页面可见且空闲时按 round 游标增量刷新后台 wake 消息。
- Haven 每 30 秒按持久 `due_at` claim 后调用 `cc-agent-wake-runner`；Dashboard 只有取得同一 `SessionTurnCoordinator` 的后台门禁后才向 Haven 原子 begin。旧 schedule version、无效 silence 来源、重复 `wake_id`、busy/compacting/待审批、失败退避、过期 lease、24 小时无用户活动和滚动后台 turn 上限均在模型请求前处理；deferred 不生成 wake event。
- cc 换窗的折叠逐项选择、统一 token 预算、Haven 固定快照及 CC/selfhost 一致注入契约见 `docs/architecture.md`
- 「本窗口设置 → 窗口减负」只处理 Claude transcript 中可重取的 `ombre:<bucket_id>#...` 动态召回，以及 `breath`、`search_chat`、`WebSearch`、`WebFetch` 的纯文字结果；OB 单行引用为“召回内容已清理：title（bucket_id）”，工具结果单行以“已清理：…”标识，原工具调用 block 和完整参数始终保留。用户/助手正文、`date_recall`、报错/非文字结果及名单外工具不得修改。执行时用 Agent SDK `forkSession` 复制会话、只原子改写副本，再由 Haven CAS 切换该 CC lane 的 `cc_session_id`；Dashboard `ob2-*` 窗口 ID 和 `conversation_turns` 不变。每窗口可保存“始终保留”、释放 token 估算和历史；05:30 香港时区自动 runner 默认关闭，Dashboard Node 进程在线时才调度，并在 Haven 日回顾/周轨迹仍运行、窗口忙或工具待批时延后重试。

## 文档与部署

- 代码改动完成后按 `MAINTENANCE_CONTRACT.md` 确认需同步的文档
- 排入后续窗口的工作写入 handoff；短期不处理的遗留写入 `TECH_DEBT.md`
- VPS 发布需到 Coolify 手动 Redeploy，push 不等于上线
- 每次任务收尾主动告知是否需要上线

> 详细实现参考 `docs/architecture.md`
