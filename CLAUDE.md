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

production 必须配置以下五项：

| 变量 | 用途 |
|------|------|
| `HAVEN_GATEWAY_URL` | Haven 基础 URL（不带末尾斜杠） |
| `OMBRE_SESSION` | Haven Brain 登录密码 |
| `OMBRE_GATEWAY_TOKEN` | Haven Gateway Bearer token |
| `DASHBOARD_LOGIN_SECRET` | 公网登录口令（>=12 字符） |
| `DASHBOARD_SESSION_SECRET` | session 签名 secret（>=32 字符） |

本机 `npm run dev` 继续兼容旧 `OMBRE_BASE_URL` / `NEXT_PUBLIC_OMBRE_*`。

## 文件结构速查

| 目录/文件 | 说明 |
|-----------|------|
| `app/page.tsx` | 主页（时间线/记忆格） |
| `app/memory/` | 记忆库（三格切换） |
| `app/cc/` | 聊天主页（cc / selfhost） |
| `app/workbench/` | 工作台 |
| `app/recall-lens/` | 召回透镜（按 session 查看 Gateway 召回轨迹、候选与中文规则解释） |
| `app/settings/` | 设置聚合页及子页 |
| `app/impressions/` | 日回顾月历 |
| `app/journal/` | 日记页 |
| `app/journey/` | 关系轨迹页 |
| `app/components/` | 共享组件 |
| `app/api/` | API 路由（大部分透传 Haven）；`edit-bucket` 保留上游状态码，并把非 JSON 错误转为可读错误 |
| `app/lib/` | 客户端库与工具函数 |
| `globals.css` | 设计 Token 定义 |
| `DESIGN.md` | 完整设计规范 |

## 设计规范

所有颜色、圆角、阴影必须引用 `globals.css` CSS 变量，禁止硬编码 hex/rgba。新色值先在 `:root` 定义语义变量再引用。详见 `DESIGN.md`。

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
- cc 换窗选择、日回顾快照、全量钉选桶与 feel 注入契约见 `docs/architecture.md`，两种聊天引擎必须保持一致

## 文档与部署

- 代码改动完成后按 `MAINTENANCE_CONTRACT.md` 确认需同步的文档
- 排入后续窗口的工作写入 handoff；短期不处理的遗留写入 `TECH_DEBT.md`
- VPS 发布需到 Coolify 手动 Redeploy，push 不等于上线
- 每次任务收尾主动告知是否需要上线

> 详细实现参考 `docs/architecture.md`
