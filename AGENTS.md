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

### 开工自检（CC 工作窗口）

状态以源头为准，不靠上个窗口转述。读完上表后跑一次，把结果和上个窗口的收尾清单对一下，有出入以源头为准：

```bash
for r in /workspace/dashboard /workspace/haven; do cd $r && git fetch -q --prune origin && echo "== $r" && git status -sb | head -5 && git log --oneline origin/main..HEAD && git branch -r --no-merged origin/main; done
```

- 本地有没推的提交 → 问小羊推不推；远端有没合并的分支 → 是待验收的 GPT 活还是刻意保留的备选（如 `try/tabbar-74`）
- `docs/handoff/README.md` 里 🔨 进行中 / 🔎 待验收的行
- `list_todos(domain="tech", done=false)`：顺手核对有没有其实已经做完的，做完就勾

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

想做的功能 / 活 → OB Todo（`list_todos` / `create_todo`，一句话）；代码债和需要细节的技术卡 → `TECH_DEBT.md`，卡里写对应 Todo ID；handoff 只作历史档案。**在等的事也记 Todo**：交给 GPT 的活（「验收 GPT 分支 xxx」）、等小羊实测的改动，当场记一条，验收完勾掉。细则（含没有 OB 工具时怎么办）见 `MAINTENANCE_CONTRACT.md` 铁律 4。

## 协作规范

- 先讨论后动手：高风险改动先列清单等确认；单文件小改可直接执行
- 不扩散修改范围：用户说改什么只改什么
- 排障用假设→验证，先问用户再翻代码
- 结论导向，不贴大段代码走查
- 一个窗口一个问题；换窗前按「待办去哪」把未完成事项落盘
- 读文件先 Grep 定位，再按行读需要的区域；不通读大文档
- Pro 额度按 token 计，git diff / build 输出过长时截断
- Windows 上跑测试时，建符号链接的用例（目录越界防护等）会因 EPERM 失败：属环境限制，不改系统设置、不修改或跳过测试，在报告里列出用例名，交 CC 在 Linux 验证

## Git 与部署

- CC 可直接 commit `main`，push 前先报告并等小羊同意；commit message 由 AI 拟
- Codex 不 push `main`、不合并：一件事一个分支（`fix/…` / `feat/…`），提交并 push 分支后用 `git ls-remote origin <分支名>` 确认远端已有该分支，再停下，由 CC 验收合并。收尾报告写明：分支名、改动范围、按 `MAINTENANCE_CONTRACT.md` 同步了哪些文档、build / 测试结果、对应 OB Todo（完成的写 ID，新增的写一句话原句）
- push `main` 后 Coolify 自动部署：镜像构建先跑 `npm test` 再 build，测试失败则部署失败、旧容器继续服务；确认最新 deployment 对应目标 commit 且健康，未触发或失败时再手动 Redeploy
- 生产收到 SIGTERM/SIGINT 后旧容器排空，等进行中轮次及 Haven 写入结束后再退出（上限约 10 分钟）；Coolify Stop grace period 当前为 600 秒，必须大于 `DRAIN_TIMEOUT_MS` 并额外留出 20 秒停止收尾及退出余量，变量定义见 `docs/reference.md`。feature 分支 push 不等于已上线。
- 每次任务收尾主动告知是否需要上线
- 启动：`npm install` → `npm run dev`（localhost:3000）；同 Wi-Fi 的 iPhone 只读预览用 `npm run dev:iphone`（详见 README）；生产 `npm run build && npm run start`，VPS 用根目录 `Dockerfile`

## 设计与组件

- 动 UI 前完整读 `DESIGN.md`。优先复用现有组件；颜色、边框、背景、圆角、阴影和动效必须用现有设计 Token，禁止硬编码或自行拼装重复组件。缺语义 Token 时先更新 `globals.css` 和 `DESIGN.md` 再用
- 字号只用 `DESIGN.md` 的命名档位类，不再写 `text-[Npx]`；标题、正文、小字各由独立系数缩放
- 移动端优先：新功能和样式调整先保证手机端体验
- 弹窗统一 `DetailPanel`（`mode="drawer"` 右侧滑入，`mode="modal"` 居中）；自己写的全屏浮层包 `BodyPortal` 挂到 body，否则会被底部 Tab 压住（见 `DESIGN.md`「层级」）
- 卡片统一 `Card`（variant: interactive / outline / ghost / empty）
- 房间的门牌与关门大门共用 `RoomDoor`；聊天成功 open 用 `RoomRevealCard` 原位显影（历史和减少动态效果不播），房间来访复用聊天折叠样式与 `CcToolDialog`，HTML 共用 `ArtifactPlayer` 沙箱。
- 手机子页面返回入口统一 `SubpageBackButton`（小圆形半透明玻璃、居中 SVG 箭头与不小于 44px 的点击范围），不要各页另画箭头；正文大标题随页面滚动，主页面顶栏保持固定
- 页面自写的加载 / 空状态早返回也必须撑满 `min-h-screen`；日记编辑与新增共用 `JournalDateField`，按北京时间显示并唤起系统日期时间选择。
- 主页与日回顾周条共用 `WeekCalendar` 和 `home-week-*` 样式，新增选中态不另画一套星期、日期或圆点。
- 记忆详情用共享 `BucketDetailDrawer`：正文卡片优先、固定八格底部操作栏；抹除与年轮删除均需三秒内两次点击，年轮可逐条编辑，相似记忆展开后才请求。
- 桶正文原位编辑用 `BucketContentEditor`：视觉字号与阅读正文一致，短正文贴合高度、长正文内部滚动；只在正文编辑时开启 `DetailPanel` 的 `preserveHeight` / `keyboardAware`，其他抽屉默认行为不变。
- 记忆时间线的桶卡片标题右侧复用抽屉的 `bucket-state` 状态小框，显示所有已激活操作状态；记忆格不加状态小框。
- 导航：桌面 `SideRail`，手机 `BottomTabBar` 底部 5 Tab（主页 / 记忆库 / 聊天 / 工作台 / 设置），全站 `MobileShell` 包裹；记忆库顶栏用共享 `MemoryViewSwitch` 薄玻璃药丸切换时间线 / 记忆格；手机点聊天 Tab 回 `/cc` 对话列表，session deep link 直接进聊天；设置聚合页按常用、记忆与引擎、数据分组，外观在 `/settings/appearance`
- 全站外观由 `AppearanceProvider` 即时预览并保存到 Haven，`RainLayer` 在效果开启时挂载；背景图和配置均以 Haven 为事实源，`localStorage` 仅镜像缓存。固定导航外框可用玻璃模糊，长列表卡片和聊天气泡不逐项模糊
- Next.js 16 动态路由 params 是 Promise：`const { id } = await params`。这版 Next.js 有破坏性变更，写之前查 `node_modules/next/dist/docs/` 里的对应文档

## cc 数据持久化（硬规矩）

- 长期配置由 Haven 持久化，不得用 `process.cwd()`、`.data`、`/tmp` 或模块全局变量作唯一存储
- 进程内状态只用于允许丢失的运行态
- `localStorage` 只用于换设备后丢失也没关系的界面偏好
- 含密钥配置只能服务端读写，浏览器只接收掩码
- 新功能自查时写明数据属于哪一类、最终存在哪；不能先用临时文件上线再补持久化
- 具体契约（滚动 revision、唤醒、锁、Bark、窗口减负、闲聊/工作模式等）见 `docs/reference.md`
