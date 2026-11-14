# GPT 订阅聊天首版交接

更新：2026-11-15。当前状态以本目录 README 索引为准。本文是本次跨窗口实施的交接依据；长期实现事实在实现后按维护契约写入正式文档。

## 已确认范围

- 用户仅自己使用系统，目标是通过 ChatGPT 订阅授权在现有 dashboard 聊天。
- 保留 Haven 人设、记忆召回、历史存储、日回顾与现有上下文规则；新增 GPT 线路及模型选择、流式回复、授权持久化、续期与失效提示。
- 首版不接模型工具调用、房间、文件操作、主动唤醒、工作模式，不做 ACP / Leader / 终端共享会话。
- 不把 GPT 的 history 和 Claude 原生 session/transcript 直接混用；切换线路后的正文上下文从 Haven 按已有窗口规则取得。
- 首版不新增附件能力；入口必须明确处理现有附件状态，不能静默忽略图片或文件。若需要支持附件，先与用户讨论范围。
- 用户已授权这份首版范围；具体窗口动手前按项目规则列清涉及的文件与行为边界。不得顺手重构现有 CC。
- 最初估算为累计 2–4 个工作日，含联调；是粗估而非时限承诺。窗口 1 验证刷新和存储方案后再更新。

## 仓库与分支

| 仓库 | 本地分支 | 起点 |
|---|---|---|
| dashboard / ob-dashboard2 | `feat/gpt-subscription-chat` | `53f568c` |
| Haven / Ombre-Brain-Haven | `feat/gpt-subscription-chat` | `b2eb9aa` |

建分支前已快进同步 main。窗口 1 已在上述分支完成本地代码和定向测试；2026-11-15 用户明确同意两仓库 commit + push，再同时启动窗口 2、3。Haven 已推送 `76bca8c6f0d12b3595d1c61d401728dc83bce7ed`，Dashboard 仅提交本交接及索引，不包含 UI 或 runner。后续窗口先核对分支、本地修改与上一步交接，不盲目从 main 新建分支或覆盖前一步成果。窗口 1 开工 git fetch 曾因沙箱代理连接失败；获授权后普通本机环境 push 与 ls-remote 已成功核对 Haven 目标分支，Dashboard 收尾同样须核对远端。

## 窗口 1 交付状态（2026-11-15）

**本地实现完成，Linux/真实授权待验收。** 用户已确认按具体方案动手，并明确将 Linux 实测留到后续窗口；本次没有启动 Docker、访问 VPS、迁移任何真实凭据、修改线上 secret 或部署。没有开始 UI 或聊天 runner。以下属于窗口 1 的交接状态，长期接口事实只维护在 Haven 正式文档。

已实现及事实源：

- Haven `gpt_subscription.py` + `gateway.py` 接入服务端文字传输；官方 DevKit 固定源码及 Node 辅助进程位于 `integrations/gpt_subscription/`，Docker 和现有 CI 测试任务加入 Node 构建/测试，部署任务未改。
- 加密密钥独立于整个 buckets 数据卷；profile 隔离、跨进程刷新锁、轮换 checkpoint、稳定 host ID、幂等导入回执及全局登记唯一归属已实现。Node 管理命令独占原始凭据导入，Python 和 HTTP 不提供导入操作。本机登录工具先加密冻结再 SSH stdin 交接，失败可恢复；未读取独立验证目录的 DPAPI 文件。
- SDK 来源、版本、许可及本地修改见 Haven `integrations/gpt_subscription/vendor/UPSTREAM.md`；新增依赖锁与本地独立验证目录无运行依赖。本次复用已有安装环境验证，`npm ci --dry-run --offline` 通过；干净 Linux npm ci 和完整 Docker build 尚未实测。
- 接口、事件、错误、持久化与单 Gateway 运行边界：Haven `docs/reference.md`「GPT 订阅授权与传输（Gateway）」是唯一详细事实源。环境变量只在 Haven `ENV_VARS.md`；管理员初始化、登录/重新登录和失败恢复操作在 `integrations/gpt_subscription/README.md`；系统及部署概述已同步 Haven `README.md`。

验证证据：

| 层级 | 结果 | 边界 |
|---|---|---|
| Node 官方回归 + 新增契约测试 | 67 项：66 通过、1 项按上游原有条件在 Windows 跳过 | 全部使用合成凭据和模拟 provider；含真实独立 Node 进程、AES 落盘/重开、跨 profile 密文不可读与登记不可复用、两进程只刷新一次、轮换后 JWKS 故障恢复、不重用旧 refresh token、导入失败不覆盖、跨进程幂等回执、真实辅助进程取消及流中额度失败 |
| Python 定向与相邻旧接口回归 | 16 通过、9 subtests 通过 | `test_gpt_subscription.py`、`test_reference_routes.py`、`test_rolling_pinned_snapshot_route.py`；含真实 Python→Node 私有管道、认证先行、profile 不受请求控制、文字能力边界、取消/变更隔离、部分输出后失败及密钥缺失保留文件 |
| Dashboard 必跑 build | 通过 | 初次沙箱字体下载失败，普通本机权限重跑成功；无 UI/字体代码修改 |
| Linux 文件权限/符号链接、Linux 重启恢复、完整 Docker 镜像 | 未验证 | 用户明确留到后续窗口；Windows 跳过项为上游 `owner-only file enforcement and symlink rejection survive encryption changes` |
| 真实账号刷新/轮换/撤销、真实本机交接、VPS secret 与服务恢复 | 未验证 | 前序短期 access token 成功不等于这些项目完成；需单独授权真实凭据交接和正式配置 |

后续可依赖的入口：连接状态与授权选择/断开、登记列表、模型列表、文字 Responses SSE、取消请求均已在 Haven 注册并有测试。窗口 2 可以据正式 reference 开始本地 runner 开发；这不代表窗口 1 的 Linux/生产验收已完成。用户已要求同时启动窗口 2、3，隔离和文件归属见下节。

### 窗口 2、3 并行安排

用户于 2026-11-15 明确要求新任务同时启动。父聊天负责提交窗口 1、准备独立本地 Git 克隆并创建聊天，不再修改后续业务代码。独立克隆只含已提交内容，不复制真实配置、密钥、本机授权或 node_modules。

| 窗口 | 独立目录（下有 dashboard / haven） | 两仓库工作分支 | 归属 |
|---|---|---|---|
| 2：聊天后端与 Haven 上下文 | `C:/Users/yangh/projects/gpt-subscription-window2/` | `feat/gpt-subscription-chat-window2` | Dashboard `app/lib/**`、`app/api/**`、共享 `app/cc/types.ts`、后端定向测试；Haven 所有必要代码/测试/正式文档；Dashboard 正式 reference/architecture、中央 handoff 与索引 |
| 3：界面与能力边界 | `C:/Users/yangh/projects/gpt-subscription-window3/` | `feat/gpt-subscription-chat-window3` | Dashboard `app/cc/**`（除 types.ts）、确需改动的现有 UI 组件和 UI 定向测试；如需独立交接，使用 `docs/handoff/HANDOFF-gpt-subscription-chat-ui.md`，不改中央 handoff/索引/reference；Haven 只读 |

两个窗口开始前都要按全局规则读取约束、列具体 3–5 行修改清单；涉及尚未确认的数据结构或交互选择时让用户确认，不把此安排视为具体方案的默认批准。commit + push 授权仅覆盖窗口 1 已列明内容；后续新分支完成后仍须独立确认，不合并 main。

并行先做窗口 1 已稳定的状态/模型/授权界面和窗口 2 后端；窗口 3 的发送、停止、流式、恢复和持久模型选择，要等窗口 2 给出可测试的聊天路由、共享类型及偏好持久化契约后再接。不得通过猜路由、虚构事件、静默 mock 或各自改共享文件来抢跑。窗口 2 优先冻结这些接口，落盘到正式 reference，并在本聊天向用户报告可交接的 commit；跨聊天消息仍按应用要求取得用户授权。父聊天不自动合并两个分支，最终集成在窗口 4 审阅后进行。

窗口 2 必须遵守的边界：

- 底层传输不保存聊天正文、不提供长期 request_id 幂等，也不注入人设或记忆；runner 仍需接 Haven 上下文和持久轮次。
- 底层 HTTP 断线会取消传输；若聊天需要断线后继续，runner 要持有后台请求并另接 UI 事件，不能把浏览器连接直接当生成任务。仅收到 completed 才算模型成功，部分输出/取消/额度不足不能假成功。
- 单个 Gateway worker/实例拥有该数据卷；本次未做多副本取消协调。切换/断开授权会取消本 profile 活跃请求。使用量为官方终态实际数字或 null，不展示虚假剩余额度。
- 不修改旧 CC/selfhost 行为，不开始工具、附件、房间、唤醒或工作模式。不把 GPT 正文当 Claude 原生 transcript。

后续 Linux/联调验收：先在临时环境用合成数据运行 Node tests 和 Python 定向测试、干净 npm ci/完整 Docker build，补验证 Linux owner-only 和符号链接项；再按用户确认的真实平台值准备独立 secret 和授权交接，验证真实轮换、撤销与重启恢复。不得把本机或示例路径当作生产配置。后续任务已有明确窗口安排，留在本文，不另记成技术债。

## 窗口 2 交付状态（2026-11-15）

**用户已回复“开始动手”，确认本窗口的五项具体修改方案和三个产品决定：每窗口独立记住 GPT 模型、刷新继续生成、停止保留部分回复。** 后端实现与本地定向验证完成；没有修改 UI、原始工作目录、窗口 3 克隆、真实授权、VPS 或平台配置。两仓库当前分支均为 `feat/gpt-subscription-chat-window2`，工作目录仍是上方列出的 window2 独立克隆。用户随后已明确同意按本窗口列明的两仓库范围 commit + push。Haven 已推送 `ea52a9d87f0a63e5281965152cf7becb75239be8`，并用 ls-remote 核对；Dashboard 的交付提交为包含本节的 runner 实现提交，目标分支同为 `feat/gpt-subscription-chat-window2`。最终提交 SHA 与远端核对结果以本聊天收尾报告及 Git 为准；未授权合并或部署。

### 接口可测试阶段与窗口 3 入口

接口已由可直接运行的契约测试固定，详细事实唯一维护在 Dashboard `docs/reference.md`「GPT 订阅聊天（文字）」；不要从旧聊天摘要猜路由或自行改共享类型。引擎固定 `gpt_subscription`；路由为 `/api/cc-chat-gpt` 的 POST（发送）、GET（active/接回/核对历史）和 DELETE（精确停止）；模型偏好经已有 `/api/cc-session-settings` 存 Haven 的独立 GPT overrides。共享浏览器安全类型从 `app/cc/types.ts` 导出。窗口 2 独占该共享类型、app/lib 和后端文件。

可交接证据（均为合成数据）：

| 检查 | 结果与边界 |
|---|---|
| Dashboard GPT 契约/runner 及相邻回归 | 11 文件、70 项通过：GPT 流解析/请求校验/上下文/重复与冲突/停止/断线接回/保存失败重试/额度错误/排空；窗口设置、Claude 唤醒隔离、windowPrompt、selfhost runner、serverDrain、CC 原有接回及跨引擎事件/历史隔离。未调用真实账号；runner 编排使用模拟 Gateway/Haven 依赖，传输和真实 SQLite 持久层另有独立契约测试。命令：`node node_modules/vitest/vitest.mjs run tests/gpt-contract.test.ts tests/gpt-runner.test.ts tests/cc-session-settings-route.test.ts tests/cc-background-turn-inputs.test.ts tests/window-prompt.test.ts tests/selfhost-runTurn.test.ts tests/server-drain.test.ts tests/gpt-engine-boundary.test.ts tests/cc-turn-broadcast.test.ts tests/cc-chat-strict-route.test.ts tests/cc-chat-disconnect-route.test.ts`。 |
| Haven 新增聊天契约 | `test_gpt_chat_contracts.py` 9 项通过：旧库迁移、重复初始化、偏好 CAS/profile 隔离、跨连接原子准入、进程重开防重、lease/owner、真实轮次提交及日期统计、HTTP 认证先行与可信 profile。 |
| Haven 相邻回归 | `test_gateway_state_contracts.py` 57 项通过；`test_gpt_subscription.py` 10 项通过（含真实本地 Node 辅助进程、合成临时数据）；`test_reference_routes.py` 2 项通过。 |
| Dashboard build | `npm run build -- --webpack` 通过，含 TypeScript。默认 Turbopack 因独立克隆 node_modules 连接指向项目外而拒绝；没有修改 next.config 或 package scripts。沙箱字体网络/目录权限失败后，在普通本机权限运行 webpack 成功。仅在本克隆创建依赖目录连接，未安装依赖、未复制原环境私密配置；Haven 本克隆同样复用既有 Node 依赖并生成本地编译产物。 |

窗口 3 对接要求：

- 发送须保留整份 GptRequest，保存不明时用同一 request_id 和原 body 核对/重试；不得自动换 request_id 重新调用模型。
- 接回须按 Content-Type 处理 SSE 与 JSON 已保存快照；同请求正文原位替换，不能重复追加。失去缓冲/进程后只用 Haven 已保存轮次恢复，未落库草稿丢失不能声称可恢复。
- 展示 native gptUsage/null 和 outcome；只有 completed 才显示正常完成，cancelled/failed 即使已保存也要标明中断。不可展示虚构的 Claude 成本、Pro 余量、工具或精确 GPT context window。
- 已有附件或 wake/工作模式状态的线路切换须显式说明/阻止，不静默忽略；后端已拒绝非文字能力，持久偏好为 GPT 的窗口不能进入 Claude 后台唤醒输入加载。旧 wake 配置没有被删改。

本窗口复用了 Haven 人设/模块与固定事实、固定 handoff/日回顾、滚动日期选择与冻结钉选 revision、历史召回正文、严格提交及事件订阅缓冲；GPT 原生传输和后台轮次独立，不进入 Claude SDK 或订阅账号锁。数据库新增项与准入登记长期事实维护在 Haven reference，ENV_VARS 未变。

### 窗口 3 提出的浏览器代理补件（2026-11-15）

用户明确要求补 connection GET/POST、connections GET、models GET 的浏览器 Cookie 认证代理，不改窗口 3 UI 或 Haven。补件仅在窗口 2 Dashboard 分支实施：新 `/api/gpt-subscription/[operation]`，仍使用既有 Cookie 门禁和服务端 Haven Bearer；按白名单重建状态/列表/错误、再次掩码账号、替换任意上游错误文本，不透传令牌、请求头或上游响应头。浏览器路由、请求与返回类型唯一维护在 Dashboard reference「GPT 授权与模型的浏览器代理」，`app/cc/types.ts` 重导出类型。

主 runner 的已推固定版本仍是 Dashboard `46d9a126f64e089307223899f7b070ccde85bf61` 和 Haven `ea52a9d87f0a63e5281965152cf7becb75239be8`。本补件固定提交为包含本节的 `fix: proxy GPT subscription connection endpoints`；用户要求提供固定提交，因此生成本地 commit，新增范围的 push 仍须单独确认。最终 SHA 与是否已推以本聊天报告和远端核对为准。窗口 3 应先引入主 runner 固定版本，再引入该补件；不得猜测路径或自行透传授权数据。

补件测试：`gpt-connection-proxy.test.ts`、`dashboard-proxy.test.ts`、`gpt-contract.test.ts` 共 23 项，覆盖 Cookie 门禁、只读预览、服务端 Bearer、输出字段白名单、掩码、错误/状态保留、输入能力限制和异常不泄漏；使用模拟 fetch/合成数据，未操作真实授权。webpack build 含 TypeScript；默认 Turbopack 仍有前述独立克隆依赖链接限制。本补件不改变 runner 生成与 Haven 数据结构，不部署，真实联调继续留窗口 4。

### 留给窗口 4 的验收

窗口 2/3 分支尚未集成；由窗口 4 审阅后集成，不在任一窗口擅自合并。需在集成环境补全真实 Haven→Gateway→模型多轮实测、手机 UI 接回/停止/模型跨设备恢复、部署切换和进程异常恢复；Linux、Docker、真实刷新/撤销/授权交接及 VPS 验收继续按上方窗口 1 边界，尚未执行。本窗口本地测试通过不等于线上完成。本次暂不部署。

## 已完成的独立验证

- 本地：官方 SIWC DevKit 登录成功，返回 `connected` 且 `sharing=true`；模型列表可读；GPT-6-Luna 完整返回测试回复。
- 本地进程退出后重开，复用 Windows DPAPI 加密授权，无需重新登录，再次调用成功。
- VPS：通过本机 SSH 别名 `racknerd` 密钥登录成功。宿主未发现 node，可用 Docker 及已缓存的 `node:22-bookworm-slim`。
- VPS 隔离临时容器：通过 SSH stdin 仅传短期 access token，测试回复和无副作用的模拟工具闭环成功；容器以 `--rm` 退出，凭据未在 VPS 落盘，也未传 refresh token。
- 未验证：刷新令牌轮换、过期续期、撤销后的表现、Linux 持久化、服务/容器重启后的授权恢复、实际 Haven 上下文接入。
- 正式 Dashboard/Haven 服务未修改、未部署。已有 Dashboard 挂载目标包含 `/workspace/dashboard`、`/workspace/haven`、`/home/cc/.claude`、`/data/cc-chat-files`；这些只是检查时观察，不能据此选择新授权存储位置。

独立测试目录为相邻 `gpt-plus-connection-check/`，来自 `openai/sign-in-with-chatgpt-devkit`。`verify-plus.mjs`、`verify-vps.mjs` 是本次本地测试入口；`.private-connection/` 含 Windows 加密凭据。此目录不属于两个产品仓库，不作为正式依赖、部署源或配置事实源。不要把凭据、登录 URL、个人账号资料复制进文档、提交或日志。Windows DPAPI 密文不可直接复制到 Linux 解密。

官方参考：

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://github.com/openai/sign-in-with-chatgpt-devkit

官方 VM 说明针对开源应用，私有应用开放范围仍需按届时官方规则核对；本次请求成功只证明技术链路，不代表获准对外提供托管服务。用户当前仅本人使用，不能扩大用途。

## 四个实施窗口与依赖

执行顺序：窗口 1 → 窗口 2、3 可并行 → 窗口 4。窗口 2、3 只有在接口已冻结、分别准备独立工作目录/分支并划清共享文件归属后才并行；独立环境已创建，实际目录与归属以上方并行安排为准；后续仍按各窗口验收和提交确认推进。

### 窗口 1：授权、持久化与执行接口

目标：解决正式运行所需的授权生命周期，交付稳定的服务端调用接口。

- 核对官方 SDK 的版本、许可和正式依赖接入方式；不要把本地测试目录当作产品依赖。
- 确定并记录登录/重新授权流程。手机访问 VPS 时 loopback 回调不在 VPS；首版可采用本地辅助登录后安全导入，不能假设服务器能自己弹浏览器完成登录。
- 按项目契约设计 Haven 服务端授权持久化、加密、profile 隔离与前端掩码状态；加密密钥和密文分开管理。不得以容器临时文件或环境变量中的固定 access token 作为长期方案。
- 明确只有一个执行端负责 refresh token 轮换，防止本地与 VPS 同时刷新同一份注册授权；导入失败可恢复，不覆盖可用授权。
- 定义后续所需的能力：连接状态、可用模型、发起/取消流式请求、额度/认证错误及输出用量。先交付可测试接口，再接聊天。
- 官方 DevKit 简单 `streamResponse` 当前只暴露文字与简单文本输入，不能假定它已覆盖项目的用量统计和错误细分。

验收：Linux 安全存储可恢复；重启调用通过；过期刷新与轮换持久化有证据（实测与定向测试分别注明）；失效返回可理解的重新连接提示；凭据不出服务端、不入日志；存储迁移覆盖幂等与隔离。

收尾：把接口、存储位置、错误类型、已验证/未验证项写回本文，正式事实同步 Haven reference 与必要环境变量文档，供窗口 2 使用。

### 窗口 2：聊天后端与 Haven 上下文

依赖：窗口 1 的授权/调用接口稳定。

- 优先复用 `app/lib/selfhost/runSelfhostTurn.ts` 的召回、历史、上下文预算和保存规则，新增 GPT Responses 适配；是否独立 runner 以最小安全改动为准，不硬塞进 Claude SDK。
- 转换人设/指令、正文消息及流式输出；HTTP 按官方要求使用 `store:false` / `stream:true`，自行带上所需历史，不依赖 OpenAI 代存会话。
- 接续 Haven 的钉选背景、日回顾、滚动日期选择与 revision 规则；旧 Claude 原生工具过程不转换为 GPT 原生 session。
- 保存 GPT 轮次来源、所选模型、用量与请求身份，确保后续日回顾仍能读取正文，避免沿用 Claude 特有字段作事实源。
- 覆盖中断、部分回复、持久化失败、重复 request_id、并发窗口、停止生成与部署排空；前端断线恢复行为必须明确。
- 首版不挂工具，不沿用 Claude 的订阅锁与额度查询；GPT 窗口不能误入 Claude 主动唤醒执行器。

验收：多轮对话记住前文；人设、召回、日回顾和滚动上下文实际进入请求；刷新后可见已保存历史；同轮不重复保存、不串窗口；停止/断线/额度不足不会显示假成功。

收尾：记录路由与事件契约、实际复用部分、已知界面待接项，同步正式 reference；不修改其他引擎行为。

### 窗口 3：界面、窗口选择与能力边界

依赖：窗口 2 可由定向测试调用。动 UI 前完整读 `DESIGN.md`。

- 在现有线路/模型入口加入 GPT 订阅及模型列表、连接状态、重新连接与额度提示；复用现有组件与 token。
- 调整目前 `cc | selfhost` 的引擎枚举、Haven 窗口偏好校验、协作者默认值及恢复路径，兼容旧值。
- 保存并恢复模型和线路选择；重开页面/更换设备后以 Haven 为准，不仅依赖浏览器状态。
- 将 GPT 状态/文本映射到现有消息显示与历史。不要展示虚假的 Claude Pro 用量、思考过程、工具权限或上下文精确统计。
- GPT 首版未接能力在该线路中说明或禁用：工具、房间、工作模式、主动唤醒与附件发送；切换已有附件/已有 wake 开关的窗口时不能静默丢失或调用错误引擎。

验收：手机端选模型→发消息→流式回复→刷新恢复；认证失效可操作；GPT 与旧线路可切换且不混用配置；旧 CC/selfhost 定向回归通过。

收尾：同步引擎/设置契约与必要设计文档；本文标出部署待验项。

### 窗口 4：VPS 联调与验收

依赖：前三窗口的实现、必要测试和文档完成。

- 先对分支做整体检查与项目必跑检查；Windows 符号链接测试限制按仓库规则交 Linux 验证。
- 准备可审阅的授权导入、密钥与配置、部署顺序和失败恢复步骤。通过审核并获部署授权后再改正式平台设置。
- 在 VPS 验证真实 Haven 记忆聊天、重启恢复、授权刷新、失效重连、额度耗尽、停止/断线/重复提交和旧引擎回归；需要等待时间的刷新观察要单独列出，不能提前勾通过。
- 用户手机验收普通连续聊天、记忆召回和刷新后的历史，再决定是否作为日常使用线路。
- 依维护契约同步长期事实，更新本文与索引状态，提交精确范围；不自行合并 main 或顺手扩大到工具功能。

验收：首版范围实测闭环，凭据生命周期可恢复，生产目标版本及服务健康明确；未验证项逐条写清，不能宣称完整替代 CC。

## 下一窗口入口与待办

窗口 3 按上方「窗口 2 交付状态」及 Dashboard 正式接口契约接 UI；先核对本窗口提交状态，不直接依赖另一个克隆未提交的文件。窗口 4 负责集成和 Linux/真实授权/部署验收，需另行获得正式配置与凭据操作授权。不要扩大到工具或整套 Codex app-server 重建。

OB Todo 本窗口尝试写入失败：连接器仍指向旧 Zeabur MCP，返回 404；未创建成功，不为此修改连接配置。待转交的 Todo 原句：

> 实现 GPT 订阅聊天首版：授权持久化、Haven 记忆与历史、聊天界面及 VPS 验收。背景：按本交接文档四窗口计划，Dashboard/Haven 分支均为 `feat/gpt-subscription-chat`；首版不接工具、房间、文件操作、主动唤醒和工作模式。
