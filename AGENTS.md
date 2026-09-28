# ob-dashboard2

Ombre Brain 记忆系统的前端 + cc 聊天引擎。Next.js 16 App Router + Tailwind CSS + TypeScript。和后端 Haven（相邻仓库 `Ombre-Brain-Haven`）一起部署在 VPS，由 Coolify 管理。手机是主要使用场景。

本文件是本仓库唯一的入口：Codex 自动读取，Claude Code 通过 `CLAUDE.md` 的 `@AGENTS.md` 读取。只放每次都要知道的东西，查表资料放 `docs/reference.md`。

## 开工必读

| 什么时候 | 读什么 |
|---|---|
| 每个工作窗口 | 本文件 + `MAINTENANCE_CONTRACT.md`（改完怎么同步文档、待办记在哪） |
| 涉及 Haven | Haven 仓库的 `AGENTS.md` |
| 动页面 / 组件 / 布局 / 样式 / 交互 | `DESIGN.md` 完整读一遍 |
| 动 cc 聊天引擎 / 持久化 / 滚动窗口 / 唤醒 | `docs/reference.md`「cc 数据持久化契约」对应条目 |
| 找页面、API、环境变量 | `docs/reference.md`，先 Grep 再定点读 |
| 处理技术债或技术卡 | `TECH_DEBT.md` 顶部索引，再按卡号定点读 |

## 文档地图

| 文档 | 职责 |
|---|---|
| `AGENTS.md` | 入口：必读清单、硬规矩 |
| `MAINTENANCE_CONTRACT.md` | 改动收尾流程、变更 → 文档同步表、待办分流 |
| `docs/reference.md` | 查表：环境变量、文件结构、API 特殊逻辑、cc 持久化契约 |
| `docs/architecture.md` | 详细实现：换窗 / 滚动 / 注入等机制说明 |
| `DESIGN.md` + `app/globals.css` | 设计规范与 Token |
| `TECH_DEBT.md` | 代码债务、刻意保留项、技术卡 |
| `docs/handoff/README.md` | handoff 历史档案的状态索引；handoff 正文默认不读 |

## 待办去哪

想做的功能 / 活 → OB Todo（`list_todos` / `create_todo`，一句话）；代码债和需要细节的技术卡 → `TECH_DEBT.md`，卡里写对应 Todo ID；handoff 只作历史档案。细则（含没有 OB 工具时怎么办）见 `MAINTENANCE_CONTRACT.md` 铁律 4。

## 协作规范

- 先讨论后动手：高风险改动先列清单等确认；单文件小改可直接执行
- 不扩散修改范围：用户说改什么只改什么
- 排障用假设→验证，先问用户再翻代码
- 结论导向，不贴大段代码走查
- 一个窗口一个问题；换窗前按「待办去哪」把未完成事项落盘
- 读文件先 Grep 定位，再按行读需要的区域；不通读大文档
- Pro 额度按 token 计，git diff / build 输出过长时截断

## Git 与部署

- CC 可直接 commit + push `main`；commit message 由 AI 拟
- push `main` 后 Coolify 自动部署；确认最新 deployment 对应目标 commit 且健康，未触发或失败时再手动 Redeploy
- 每次任务收尾主动告知是否需要上线
- 启动：`npm install` → `npm run dev`（localhost:3000）；同 Wi-Fi 的 iPhone 只读预览用 `npm run dev:iphone`（详见 README）；生产 `npm run build && npm run start`，VPS 用根目录 `Dockerfile`

## 设计与组件

- 动 UI 前完整读 `DESIGN.md`。优先复用现有组件；颜色、边框、背景、圆角、阴影和动效必须用现有设计 Token，禁止硬编码或自行拼装重复组件。缺语义 Token 时先更新 `globals.css` 和 `DESIGN.md` 再用
- 字号只用 `DESIGN.md` 的命名档位类，不再写 `text-[Npx]`；标题、正文、小字各由独立系数缩放
- 移动端优先：新功能和样式调整先保证手机端体验
- 弹窗统一 `DetailPanel`（`mode="drawer"` 右侧滑入，`mode="modal"` 居中）
- 卡片统一 `Card`（variant: interactive / outline / ghost / empty）
- 手机子页面返回入口统一 `SubpageBackButton`（小圆形半透明玻璃、居中 SVG 箭头与不小于 44px 的点击范围），不要各页另画箭头；正文大标题随页面滚动，主页面顶栏保持固定
- 记忆详情用共享 `BucketDetailDrawer`（年轮可逐条编辑 / 确认后删除）
- 导航：桌面 `SideRail`，手机 `BottomTabBar` 底部 5 Tab（主页 / 记忆库 / 聊天 / 工作台 / 设置），全站 `MobileShell` 包裹；手机点聊天 Tab 回 `/cc` 对话列表，session deep link 直接进聊天；设置 → 外观在 `/settings/appearance`
- 全站外观由 `AppearanceProvider` 即时预览并保存到 Haven，`RainLayer` 在效果开启时挂载；背景图和配置均以 Haven 为事实源，`localStorage` 仅镜像缓存。固定导航外框可用玻璃模糊，长列表卡片和聊天气泡不逐项模糊
- Next.js 16 动态路由 params 是 Promise：`const { id } = await params`。这版 Next.js 有破坏性变更，写之前查 `node_modules/next/dist/docs/` 里的对应文档

## cc 数据持久化（硬规矩）

- 长期配置由 Haven 持久化，不得用 `process.cwd()`、`.data`、`/tmp` 或模块全局变量作唯一存储
- 进程内状态只用于允许丢失的运行态
- `localStorage` 只用于换设备后丢失也没关系的界面偏好
- 含密钥配置只能服务端读写，浏览器只接收掩码
- 新功能自查时写明数据属于哪一类、最终存在哪；不能先用临时文件上线再补持久化
- 具体契约（滚动 revision、唤醒、锁、Bark、窗口减负、闲聊/工作模式等）见 `docs/reference.md`
