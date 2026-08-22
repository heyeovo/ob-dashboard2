# HANDOFF — Dashboard / Claude Code / Haven 迁移到 VPS

> 建立时间：2026-08-17  
> 涉及仓库：`ob-dashboard2`、`Ombre-Brain-Haven`  
> 状态：方案已完成；第一阶段步骤 1–9 与第二阶段窗口 1–4 已完成；Dashboard/Haven 已切至 VPS Coolify 内网，并通过真实写入、Restart 持久化、自动部署隔离、rollback、Claude Pro 登录持久化及三线路同会话手动往返验收，Zeabur 保持逻辑停写  
> 当前阶段：VPS Haven 已成为当前主数据侧，sslip Dashboard 已经由 Coolify 内网切换至 VPS；Coolify 正式资源不会因普通 GitHub push 自动更新。`CC Pro ↔ CC API ↔ 自建 API` 同会话手动往返已完成。日回顾与每周轨迹的逐任务 API/Claude Pro 选择已完成本地实现和验证，尚未提交、发布或真实运行；Zeabur 已不承接正式流量，严禁盲目回切或删除回滚材料，正式域名仍为低优先级  
> 工作方式：后续一个窗口只处理一个步骤；每一步通过验收后再进入下一步

---

## 1. 一句话结论

沿用当前已经工作的 Claude Code 接入，不做架构重写：

```text
浏览器
  → HTTPS Dashboard 域名
  → VPS 上的 Next.js /api/cc-chat
  → @anthropic-ai/claude-agent-sdk
  → 同一 Dashboard 容器内按会话启动并复用 Claude Code 子进程
  → 只读写 bind mount 进容器的两个 VPS Git workspace
```

第一阶段只迁 Dashboard + Claude Code，Haven 继续运行在 Zeabur；验证稳定后，第二阶段再把 Haven Brain、Gateway 和持久化数据迁到同一台 VPS。

迁移期间本机版本、Zeabur Haven 都保持原样。VPS 版本在独立域名完成验证前，不切换正式入口。

---

## 2. 已确认的当前现状

### 2.1 当前 Claude Code 调用链

实际链路是：

```text
Dashboard /cc 页面
  → POST /api/cc-chat（SSE 流式响应）
  → @anthropic-ai/claude-agent-sdk 0.3.220
  → SDK 自带的 Claude Code 2.1.220 运行时
  → Claude Code 子进程
  → 本机项目目录 / MCP / Haven
```

不是浏览器直接调用 Claude Code，也不是另有一个独立、对公网监听的 Claude 服务。

### 2.2 进程和 session 行为

- 每个活跃聊天窗口对应一个可复用的 Agent SDK `query()` / Claude Code 子进程。
- 子进程不是全局永久守护进程，也不是每句话都启动一次。
- 会话闲置约 10 分钟后会回收；下一次可根据 Claude session ID `resume`。
- Node 进程内保存活跃连接、批准队列、正在生成的回合和临时状态。
- Claude session/history 写入 Claude 配置目录，可跨子进程回收恢复。

容器重启后：

- 可以恢复：已落盘对话历史、Claude session 上下文、已完成的文件修改、Git working tree。
- 不能恢复：正在流式输出的回答、正在运行的命令、活跃 SSE、待批准队列、等待点击允许的那一轮。
- 重启后的 `resume` 是启动新子进程并加载原 session，不是恢复原进程现场。

### 2.3 `npm run dev` 当前承担的作用

当前 `npm run dev` 运行 Next.js 开发服务器，同时承载：

- Dashboard 页面；
- `/api/cc-chat` 等后端 API；
- Agent SDK 和 Claude Code 子进程生命周期；
- SSE、批准队列和活跃 session 内存态。

生产环境不继续长期运行 `npm run dev`。VPS 使用 `npm run build` 生成生产构建，再用 `npm run start` 运行，由 Coolify/Docker 负责重启。

### 2.4 当前与迁移直接相关的代码事实

- `app/lib/ccEnv.ts` 已从空对象按明确 allowlist 构造 Claude 子进程环境，API 与 subscription/OAuth 模式分开处理。
- `app/lib/ccDirs.ts` 在 production 只允许两个固定 Linux workspace 根，并对已有目标和新目标父目录执行 `realpath` 防 symlink 越界。
- `app/lib/ccMcp.ts` 在 production 不再使用本机 `127.0.0.1:18001/mcp` fallback；缺少安全的 Haven MCP 配置时保持禁用。
- Dashboard 已使用独立 HTTPS 登录/session；production 不接受旧 `?k=` 与明文 cookie，登录/退出使用相对跳转兼容 Coolify/Traefik。
- production Dockerfile、固定非 root 身份、`npm run start` 和 Coolify HTTP healthcheck 所需 `curl` 已落地。

### 2.5 当前迁移状态

以下为步骤 6 验收后的状态：

- 本机 Dashboard 继续可运行；
- Dashboard + Claude Code 已作为 Coolify 单实例测试 Application 运行；
- Haven 继续在 Zeabur；
- Zeabur Haven 服务、业务数据、环境变量和域名未改；只对 Haven 已保存且保持停用的 Tavily MCP 项完成 query key 到 Authorization header 的兼容迁移；
- GitHub 已包含 VPS production、运行边界、登录与反向代理兼容改动；
- 尚未创建 Coolify Haven 资源，也未切换正式 Dashboard 域名。

---

## 3. VPS 当前基础设施状态

> 以下是用户于 2026-08-17 提供的当前真实状态，尚未在本任务中远程复核。

| 项目 | 当前状态 |
|---|---|
| VPS OS | Ubuntu 24.04 |
| CPU / RAM | 6 vCPU / 6GB RAM |
| Swap | 3GB |
| SSH key | 已配置 |
| SSH 密码登录 | 已关闭 |
| UFW | 已启用 |
| Coolify | 4.3.5 已安装 |
| Coolify 主机状态 | localhost Ready |
| Traefik | Proxy Running |
| 自定义域名 | 正式域名暂无；Dashboard 使用临时测试域名 `dashboard-vps.23.95.136.46.sslip.io` |
| Dashboard | Coolify 单实例测试 Application 已部署，HTTPS 与 healthcheck 正常 |
| Claude Code | 已随 Dashboard production 容器部署；步骤 7 的 API 模式、workspace 读取/写入批准、越界防护和子进程 env 隔离均已通过 |
| Haven / Zeabur | 服务、业务数据、环境变量和域名未改；Dashboard 到 Haven/MCP 真实只读链路已验收；停用的 Tavily MCP 项已完成认证格式兼容迁移 |
| 本机环境 | 未改动 |

步骤 5 已用临时 sslip 域名完成 HTTPS/公网登录验收，步骤 6 已完成现有 Zeabur Haven/MCP 真实链路验收；正式 Dashboard 子域名仍留待后续正式切换窗口，不在当前阶段处理。

---

## 4. 已确定的最终 VPS 架构

### 4.1 最终访问链路

```text
手机 / 公司电脑 / 家里电脑
  → HTTPS
  → Traefik（Coolify 管理证书与反向代理）
  → Dashboard 容器（Next.js production，单实例）
      ├─ 页面与受保护的 backend API
      ├─ Agent SDK
      └─ Claude Code 子进程
          ├─ /workspace/dashboard
          ├─ /workspace/haven
          ├─ /home/cc/.claude
          └─ Haven MCP / API
  → Coolify 内部 Docker 网络
      ├─ haven-brain:8000
      └─ haven-gateway:8010
```

### 4.2 为什么第一版继续让 Claude Code 在 Dashboard 容器内运行

- 当前代码已经是 Agent SDK 由 `/api/cc-chat` 直接管理子进程。
- 会话、SSE、批准队列和工具 hook 都与 Node 进程紧密关联。
- 放在同一容器只需解决 Linux 路径、持久卷、权限和生产启动，不需要新增一套 RPC/service 协议。
- 容器本身就是宿主机文件边界：只挂载允许的 workspace，不挂载宿主机其他目录。

保留的边界事实：Dashboard backend 与 Claude 子进程之间不是硬隔离。子进程仍能看到容器自身文件、被传入的环境变量和容器可访问的内部网络。首期通过环境 allowlist、非 root、最小挂载、工具批准和目录白名单控制；如果以后要求 Claude 连 Dashboard 容器内部秘密也完全看不到，再单独安排一个窗口拆成独立 Claude service。

### 4.3 单实例要求

Dashboard + CC 第一阶段必须只运行 1 个实例：

- 活跃 session 和批准队列在 Node 内存中；
- 多副本没有共享 session registry；
- SSE 请求被分配到另一副本会丢失当前内存态。

在没有引入外部 session/queue 之前，不开启 Coolify 横向副本。

### 4.4 Codex 不在本迁移范围

- 第一、二阶段都不把 Codex 加入 VPS。
- 如果以后接 Dashboard，优先作为本机可选 Worker；电脑关闭时该功能不可用，但不占 VPS 内存。
- 若以后要求 Codex 也 24 小时在线，再作为独立内部 Worker 评估；不要与本次 Claude 迁移绑在一起。

---

## 5. Coolify 中各服务怎么部署

当前测试资源位于 Coolify Project `Ombre Brain` 的 `production` environment；后续资源继续使用独立 Application/Service 管理生命周期。

| 资源 | 部署方式 | 是否公网 | 持久化 | 备注 |
|---|---|---:|---|---|
| Coolify | 已安装在宿主机 | 管理入口按 Coolify 安全配置 | Coolify 自管 | 不交给自身重复部署 |
| Traefik | Coolify 已运行 | 只开放 80/443 | 证书由 Coolify 管理 | 应用不直接开放宿主机端口 |
| Dashboard + CC | GitHub → Coolify Application / Dockerfile | 是，仅 HTTPS 域名 | bind mount workspaces + `.claude` | 单实例、非 root、非 privileged |
| Haven Brain | 第二阶段 Coolify Compose service | 否 | `/data`、`/state` bind mount | 容器内 8000，提供 `/mcp` 和兼容 API |
| Haven Gateway | 第二阶段同一 Compose 的独立 service | 否 | 与 Brain 共享必要 state/buckets | 容器内 8010，不映射公网端口 |
| Haven DB | 当前不建独立 DB 容器 | 否 | SQLite 文件位于 Haven state 持久目录 | 当前代码不是 Postgres 架构 |
| Coolify 自用 DB/Redis | Coolify 自管 | 否 | Coolify 自管 | 不等于 Haven 应用数据库 |

“同一个 Coolify Project”只是组织关系，不自动保证服务互通。第二阶段要显式加入同一个内部 Docker 网络，并设置稳定服务名 `haven-brain`、`haven-gateway`。

---

## 6. 宿主机目录与 bind mount

### 6.1 推荐宿主机目录

```text
/srv/ob-workspaces/
├── dashboard/                 # CC 可编辑的 Dashboard 独立 Git clone
└── haven/                     # CC 可编辑的 Haven 独立 Git clone

/srv/ob-data/
├── claude/                    # /home/cc/.claude
├── claude-home-json/          # 可选：持久化 /home/cc/.claude.json
└── haven/
    ├── buckets/               # Haven 记忆桶
    ├── state/                 # SQLite、runtime config、持久状态
    └── config/config.yaml     # 基础配置，按只读/可写需求挂载

/srv/ob-backups/
├── haven/
├── claude/
└── workspaces/
```

Coolify 自己用于拉代码/build 的 checkout 不属于上述 workspace，不允许 Claude Code 修改。

### 6.2 Dashboard 容器挂载

| 宿主机 | 容器内 | 权限 | 用途 |
|---|---|---|---|
| `/srv/ob-workspaces/dashboard` | `/workspace/dashboard` | rw | Claude 修改 Dashboard 工作副本 |
| `/srv/ob-workspaces/haven` | `/workspace/haven` | rw | Claude 修改 Haven 工作副本 |
| `/srv/ob-data/claude` | `/home/cc/.claude` | rw | OAuth、Claude session/history、设置 |
| `/srv/ob-data/claude-home-json/.claude.json` | `/home/cc/.claude.json` | rw，可选 | onboarding/trust 等非核心状态 |

Dashboard 镜像中的 `/app` 是正在运行的生产构建，不作为 Claude workspace，不从宿主机覆盖挂载。

### 6.3 Haven 第二阶段挂载

Brain：

```text
/srv/ob-data/haven/buckets  → /data
/srv/ob-data/haven/state    → /state
/srv/ob-data/haven/config/config.yaml → /app/config.yaml
```

Gateway：

```text
/srv/ob-data/haven/buckets  → /data
/srv/ob-data/haven/state    → /state
/srv/ob-data/haven/config/config.yaml → /app/config.yaml:ro
```

生产环境不把整个宿主机 `/srv`、`/home`、`/` 或 Docker socket 挂入任何 agent 容器。

---

## 7. `/home/cc/.claude` 持久化

当前 Agent SDK 0.3.220 在 Linux 上的实际读取规则：

- 设置 `CLAUDE_CONFIG_DIR` 时，credential 为 `$CLAUDE_CONFIG_DIR/.credentials.json`；
- 未设置时，默认是 `$HOME/.claude/.credentials.json`；
- session/history 位于同一配置根下的 `projects/`。

生产容器明确设置：

```env
HOME=/home/cc
CLAUDE_CONFIG_DIR=/home/cc/.claude
```

并挂载：

```text
/srv/ob-data/claude:/home/cc/.claude
```

这样会保留：

- OAuth credential / 登录状态；
- Claude session/history；
- 与 Claude 配置目录一起保存的设置。

注意：

- OAuth 被撤销、过期或 Anthropic 要求重新认证时仍需重新登录。
- `.claude` 备份含 credential，必须加密，目录权限建议 `0700`，credential 文件建议 `0600`。
- 不把 `.claude` 放进任何 Git 仓库。
- 容器重启只恢复已落盘 session，不恢复内存批准队列和正在运行的回合。

---

## 8. Linux 路径替换和目录白名单

### 8.1 路径映射

| 本机/现状示例 | VPS 容器内目标 |
|---|---|
| `C:\Users\...\ob-dashboard2` | `/workspace/dashboard` |
| `C:\Users\...\Ombre-Brain-Haven` | `/workspace/haven` |
| `process.cwd()` 作为默认可写根 | 不再隐式可写；读写根由生产环境显式配置 |
| `http://127.0.0.1:18001/mcp` | 第一阶段 Zeabur HTTPS MCP；第二阶段 `http://haven-brain:8000/mcp` |

需要修改/复核的位置至少包括：

- `app/lib/ccDirs.ts`：VPS allowed roots、真实路径校验；
- 协作者保存在 Haven 中的 `dirs` / `write_dirs`：替换为容器内路径；
- `app/cc/CcPersonaDialog.tsx`：Windows placeholder 改成跨平台提示；
- `app/lib/ccMcp.ts`：删除生产环境对 `127.0.0.1:18001` 的默认依赖；
- 文档、示例环境变量和 Coolify mount 配置。

### 8.2 目录边界必须同时满足

1. 只允许两个固定根：`/workspace/dashboard`、`/workspace/haven`。
2. 路径先做绝对化和规范化。
3. 已存在目标使用 `realpath` 后再次确认仍在根内。
4. 新文件使用最近已存在父目录的 `realpath` 校验，防止通过符号链接创建到根外。
5. `..`、绝对路径、符号链接都不能绕过。
6. 写工具仍需批准；白名单表示“最多能写到哪里”，不表示自动同意写。
7. Bash 永远进入批准流程，不能因为 cwd 在 workspace 就自动放行任意命令。
8. 保留现有 `.env`、SSH key、credential、`.git/config` 等敏感文件 denylist。

### 8.3 容器级限制

- 使用固定非 root 用户 `cc`；
- 不使用 `privileged`；
- 不挂载 `/var/run/docker.sock`；
- 不使用 host PID/network namespace；
- 启用 `no-new-privileges`；
- 删除不需要的 Linux capabilities；
- 只暴露 Next.js 内部端口给 Traefik；
- Claude 控制接口没有独立公网端口。

---

## 9. MCP 和 Haven 地址分阶段处理

### 9.1 第一阶段：Haven 仍在 Zeabur

Dashboard VPS 不能使用容器内 `localhost/127.0.0.1` 访问 Haven。

Coolify 中应配置：

```env
HAVEN_GATEWAY_URL=<当前已确认可从 VPS 访问的 Zeabur HTTPS 基础地址>
OMBRE_GATEWAY_TOKEN=<Zeabur 当前 gateway token>
```

MCP 配置使用：

```text
<当前已确认的 Zeabur Haven MCP HTTPS URL>
```

实施时请用户在 Zeabur 约 1 分钟内人工确认并提供：

- 当前 Haven 对外基础 URL；
- MCP 完整 URL（可能是 `/mcp` 或现行反向代理路径）；
- Gateway token 对应的当前有效值；
- 是否存在 Zeabur IP/来源限制。

不要根据示例域名猜线上真实地址。

### 9.2 第二阶段：Haven 已迁到 Coolify

为少改现有 Dashboard 路径拼接逻辑，第一版让 Dashboard 的 Haven 基础地址指向 Brain 的兼容入口：

```env
HAVEN_GATEWAY_URL=http://haven-brain:8000
```

MCP 改为：

```text
http://haven-brain:8000/mcp
```

Brain 到独立 Gateway 的管理连接：

```env
OMBRE_GATEWAY_ADMIN_URL=http://haven-gateway:8010/api/config
```

原因：当前 Dashboard 多处在基础地址后拼接 `/gateway/api/*`，Brain 的 `server.py` 提供这些兼容路由；standalone Gateway 自身使用 `/api/*`。迁移阶段先保持兼容，不顺手重写全部 Haven client。后续若要拆成 `HAVEN_BRAIN_URL` / `HAVEN_GATEWAY_URL` 两套清晰客户端，另开优化窗口。

Brain、Gateway 都不映射公网宿主机端口。只有确实仍需让外部 Claude/ChatGPT 直接连接 Haven MCP 时，才为 Brain 单独配置受认证的 HTTPS 路由；这不属于 Dashboard 内部调用的必需条件。

---

## 10. Claude OAuth / API 两种模式

现有代码已支持两种模式，迁移不改变主调用链。

### 10.1 API 模式（第一阶段先用）

子进程只接收本次选定的：

```env
ANTHROPIC_BASE_URL=...
ANTHROPIC_AUTH_TOKEN=...
```

来源可以是当前 Haven 保存的上游配置或 Coolify secret。API 模式便于首次部署、排查网络和验证工作目录，不依赖 VPS OAuth 登录。

### 10.2 Subscription / OAuth 模式（购买 Pro 后再启用）

必须从子进程环境删除：

```env
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_API_KEY
```

让 Claude Code 使用 `/home/cc/.claude` 中的登录状态。可以在容器内完成官方 `/login`，或按官方支持方式使用长期 OAuth token。

切换 API/OAuth 后必须新建对话或回收当前 CC 子进程，因为 credential/provider 在子进程启动时确定。

### 10.3 已定使用顺序

1. 第一阶段用 API 完成全部 VPS 验收。
2. API 稳定后再购买/登录 Pro。
3. 新建对话验证请求确实使用 subscription。
4. API 永久保留为 OAuth 失效、订阅达到限额或政策变化时的 fallback。
5. 不把 Pro 当无限 API；个人 Dashboard 只允许本人使用。

---

## 11. Claude 子进程环境变量隔离

### 11.1 当前必须修的问题

`app/lib/ccEnv.ts` 当前以 `{ ...process.env }` 为基础，再删除少量变量。这在本机开发尚可，在公网 VPS 上不够安全。

迁移时改成“从空对象开始的 allowlist”，而不是“继承全部再 deny”。

### 11.2 可以传给 Claude 子进程的最小集合

按实际运行需要选择：

```text
PATH
HOME=/home/cc
USER=cc
SHELL
LANG
LC_ALL
TERM
TMPDIR
CLAUDE_CONFIG_DIR=/home/cc/.claude
CLAUDE_AGENT_SDK_CLIENT_APP
```

API 模式额外只传本次选定的：

```text
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_*_MODEL（确有需要的模型别名）
```

OAuth 模式不传任何 Anthropic API credential。

如 Git/build 明确需要其他非密钥变量，逐个加入 allowlist，并为加入原因写注释。

### 11.3 绝不能传给 Claude 子进程的变量

至少包括：

```text
Dashboard 登录/session 签名密钥
OB2_LAN_SECRET（兼容期若仍存在）
OMBRE_SESSION
OMBRE_GATEWAY_TOKEN
Haven 管理密码
DATABASE_URL / DB_PASSWORD / POSTGRES_*
REDIS_URL / Redis 密码
Coolify token
GitHub/GitLab deploy token
GITHUB_TOKEN / GH_TOKEN
SSH 私钥或私钥路径
AWS_* / AZURE_* / GOOGLE_* 云凭据
OPENAI_API_KEY
其他项目、模型、中转站的 API key
DOCKER_HOST
KUBECONFIG
```

即使做了子进程 env allowlist，同容器仍不是秘密硬隔离：Claude 若能通过被批准的 Bash 读取 Dashboard 进程可见信息，仍存在残余风险。因此还要同时做到最小容器 secret、严格 Bash 批准、敏感路径拦截；若未来要求硬隔离，再拆独立 Claude service。

---

## 12. 公网鉴权与 API 安全

### 12.1 上线前必须完成

当前 `?k=口令` 方案不能原样用于公网生产。第一阶段至少改为：

- 独立 `/login` 页面，使用 POST 提交口令；
- 服务端只保存密码哈希或与高强度 secret 做恒时比较；
- 登录成功签发不可伪造的 session cookie；
- cookie 设置 `HttpOnly`、`Secure`、`SameSite=Lax/Strict`、合理过期；
- 支持退出和 session 失效；
- 所有页面、`/api/cc-*`、批准接口、Haven 代理接口统一鉴权；
- 登录接口做基础限速/失败退避；
- 不在 URL query、访问日志、浏览器历史中传口令；
- 只通过 HTTPS 域名访问。

个人单用户不必引入企业 SSO，但不能让“未设置 secret 就全部放行”的开发行为进入公网生产。

### 12.2 Claude/API 暴露边界

- 浏览器只能调用 Dashboard backend；
- Agent SDK/Claude Code 没有公网监听端口；
- Haven token、上游 token 不回传浏览器；
- Haven proxy 继续使用明确的路径+方法白名单，不提供任意 URL 代理；
- MCP relay 保持 host allowlist，生产环境不能允许任意目标；
- 写文件、Bash、敏感 MCP 继续进入现有批准流程；
- 对 session ID、workspace ID、文件路径做服务端校验，不能信任浏览器参数。

---

## 13. GitHub / Coolify 自动部署与 Claude 工作副本隔离

### 13.1 必须是两份 checkout

```text
Coolify deployment checkout / Docker image
  用途：构建和运行正式 Dashboard/Haven
  特性：只在用户明确手动发布时更新，不随普通 GitHub push 替换

/srv/ob-workspaces/dashboard 和 /srv/ob-workspaces/haven
  用途：Claude Code 工作副本
  特性：独立 Git clone，Coolify 不覆盖
```

Claude 修改 `/workspace/dashboard` 不会直接改变正在运行的 `/app`。用户检查 diff、自己 commit + push 后，仍须在 Coolify 明确手动发布，正式服务才从指定版本构建新镜像。

### 13.2 建议工作流

1. 每项工作使用独立分支，例如 `cc/dashboard-20260817-topic`。
2. Claude 只修改和验证，不代用户 commit/push。
3. 用户检查 diff 后自己 commit + push。
4. GitHub push 不触发正式资源；用户确认上线版本后，在 Coolify 手动 Redeploy/Restart。
5. 新部署通过 health check 后切换；失败保留上一 deployment。
6. 拉取远端前先确认 workspace 干净；有未 commit 修改时禁止 reset/强制覆盖。

### 13.3 避免 6GB 内存峰值

- Dashboard 和 Haven 不并行 build/deploy；
- Claude 正在执行 `npm install/build/test` 时，不同时触发 Coolify 大构建；
- 第一阶段最多一个活跃 agent 执行重任务；
- 保留 3GB swap 并监控 swap/OOM；
- 定期清理 Docker build cache，但不能误删运行中 volume/image；
- 60GB 磁盘重点监控 Docker layers、build cache、`node_modules` 和日志。

---

## 14. 第一阶段：只迁 Dashboard + Claude Code

### 14.1 第一阶段边界

要做：

- Dashboard production container；
- Agent SDK / Claude Code 在 VPS 容器内运行；
- 两个 VPS workspace bind mount；
- `.claude` 持久化；
- API 模式；
- 公网 HTTPS 登录；
- Dashboard 从 VPS 继续调用 Zeabur Haven；
- 自动部署和 rollback。

不做：

- 不迁 Haven 数据；
- 不关闭或修改 Zeabur Haven；
- 不迁 Codex；
- 不删除本机任何配置/代码；
- 不先做 Claude 独立 RPC service；
- 不启用多副本。

### 14.2 实施顺序、验证标准和 rollback

#### 步骤 1：建立迁移基线

操作：

- 记录本机 Dashboard 当前 commit、Node/npm 版本和 `.env.local` 键名（不抄明文 secret）。
- 本机运行当前测试/production build，记录已知警告。
- 验证当前本机 `/cc`：发消息、读文件、批准一次写入、resume。
- 备份当前 Zeabur Haven 配置和数据状态；本步骤不改 Zeabur。

验收：

- 本机现行版本仍正常；
- 有一份明确的 commit/hash 和验收记录可对照；
- 所有 secret 都未写入 Git/handoff。

失败/rollback：本步骤只读，不需要 rollback；若本机基线已失败，先另开窗口处理，不能带病迁移。

完成记录（2026-08-17）：

- Dashboard 基线为 `main` 分支、commit `f8d33a15659ef760dabf0bfe3703504b2a9519f5`；检查时除未跟踪的 `.claude/settings.local.json` 外无其他 working tree 变更。该文件尚未被 `.gitignore` 忽略，本步骤未读取或修改其内容。
- 本机运行时为 Node `v25.9.0`、npm `11.12.1`；实际依赖为 Next.js `16.2.4`、`@anthropic-ai/claude-agent-sdk` `0.3.220`、TypeScript `5.9.3`、Vitest `4.1.10`。dashboard `CLAUDE.md` 仍写 Next.js 15，后续代码窗口必须以仓库内 Next 16 文档和实际依赖为准。
- `.env.local` 只记录了键名，未记录任何值：`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`、`NEXT_PUBLIC_OMBRE_BASE_URL`、`NEXT_PUBLIC_OMBRE_SESSION`、`OB2_LAN_SECRET`、`OMBRE_BASE_URL`、`OMBRE_GATEWAY_TOKEN`、`OMBRE_SESSION`。
- `npm test` 通过：21 个测试文件、98 项测试全部成功。保留一条既有 Vitest 警告：`vitest.config.ts` 以 CommonJS 加载时使用 ESM 语法。
- `npm run build` 通过：Next.js 16.2.4 production build、TypeScript 和 67 个静态页面生成成功。保留一条既有 Turbopack 警告：`app/lib/ccDirs.ts` 的动态文件系统路径令 NFT 推断可能意外追踪整个项目；留待既定 workspace 路径窗口处理，不在基线窗口顺手修改。
- 用户人工确认本机 `/cc` 当前使用正常；本步骤未改本机 Dashboard、`.env.local` 或 Claude 配置。
- Zeabur Haven 人工确认仍为 Running；持久卷为 `ombre-buckets → /app/buckets`（检查时约 67.46 MB）与 `ombre-state → /app/state`（检查时约 85.34 MB）。
- Zeabur 原生离线备份连续失败，平台事件为 `backup/restore pod could not be scheduled ... FailedScheduling: insufficient memory`；文件管理器直接下载目录也因 `folder compression took too long` 超时。这是 Zeabur 备份资源/压缩限制，不是 Haven 数据校验失败，未继续重复重试。
- 已改用容器内只读/临时导出完成本机安全副本：`/app/buckets` 归档为 `haven-buckets-20260817.tar.gz`（约 30 MB）；`/app/state` 的 10 个 SQLite 数据库先通过 Python `sqlite3.backup()` 生成一致副本，逐库 `PRAGMA integrity_check` 均为 `ok`，再连同其他 state 文件归档为 `haven-state-20260817.tar.gz`（约 25 MB）。两份归档均已下载到用户本机私密保存。
- Zeabur 项目配置已由用户导出并私密保存；配置导出和两份数据归档均可能含 secret / 私人记忆，不进入 Git、不写入本 handoff。该安全副本只用于第一阶段基线；第二阶段迁 Haven 时仍必须执行正式停写、最终导出、checksum 与 SQLite 完整性校验。

#### 步骤 2：准备域名和 DNS

操作：

- 选择独立测试子域名，例如 `dashboard-vps.<domain>`。
- DNS A 记录指向 VPS IPv4；如 VPS/防火墙未完整支持 IPv6，不先添加 AAAA。
- 初期 TTL 使用较短值，便于切换。

验收：

- 公网 DNS 正确解析 VPS；
- 80/443 可由 Traefik 接收；
- 不影响现有本机入口和 Zeabur 域名。

失败/rollback：删除/恢复该测试子域名记录；现有环境不受影响。

完成记录（2026-08-17）：

- 用户当前没有自有主域名；本阶段不购买域名、不修改 Zeabur 域名，改用 Coolify 支持的 `sslip.io` 临时主机名 `dashboard-vps.23.95.136.46.sslip.io`。
- 通过 Google DNS-over-HTTPS 公网解析验证，该主机名 A 记录正确指向 VPS IPv4 `23.95.136.46`；未添加、未使用 AAAA。
- RackNerd VPS 为 New York 节点。用户人工确认 UFW 为 `active`，默认入站 `deny`、出站 `allow`，TCP 80/443 已放行；RackNerd 是否另有独立云防火墙尚未确认。
- 用户人工确认 Coolify `4.3.5` 的 localhost Server 为 `Ready`、Traefik Proxy 为 `Running`、Sentinel 为 `In sync`。
- 从外部网络对 VPS 强制 Host 请求验证：80 端口返回 HTTP 404，443 端口返回 HTTP 503；这证明公网流量已到达 Traefik，当前尚无对应 Application 路由符合预期。
- Coolify 官方规则是在 Application 域名字段使用 `https://`时由 Traefik 申请 Let's Encrypt 证书。因本步骤不创建 Dashboard Application，实际证书签发与浏览器验证留到步骤 5；本步骤的 DNS 和 80/443 前置已验收。

#### 步骤 3：创建宿主机目录和独立 Git workspace

操作：

- 建立 `/srv/ob-workspaces/*`、`/srv/ob-data/claude`、`/srv/ob-backups/*`。
- 以部署用户/容器 `cc` 可用的 UID/GID 设置权限。
- 从 GitHub 独立 clone Dashboard 和 Haven 到两个 workspace。
- 不复制本机 `.env`、`.claude`、SSH 私钥、`node_modules`、`.next`。

验收：

- 两个目录均为正常 Git repo；
- 容器计划使用的 UID 能读写；
- workspace 与 Coolify build checkout 是不同路径；
- 宿主机其他目录未加入挂载清单。

失败/rollback：删除本步骤新建且确认无数据的目录即可；不得动 GitHub、本机或 Zeabur。

完成记录（2026-08-17）：

- 用户人工确认 VPS 当前登录用户为 `root`（UID/GID `0:0`），`/srv` 为 `root:root`，步骤 3 目标目录此前均不存在；VPS 未配置 GitHub SSH key、PAT 或 HTTPS credential，两个仓库均为 Public，因此本步骤只使用公开 HTTPS clone，不新增 GitHub 身份或写入凭据。
- 在宿主机创建不可登录、不创建 home 的 `cc` 用户/组，固定 UID/GID 为 `10001:10001`；后续 Dashboard 容器内非 root `cc` 必须沿用同一数字 UID/GID，不能另选导致 bind mount 无法写入。
- 已创建 `/srv/ob-workspaces/dashboard`、`/srv/ob-workspaces/haven`、`/srv/ob-data/claude`，以及 `/srv/ob-backups/{haven,claude,workspaces}`。workspace 父目录为 `root:cc 0750`，两个 repo 为 `cc:cc 0750`，Claude 数据目录为 `cc:cc 0700`，备份目录为 `root:root 0700`；未创建 Haven 数据目录或任何 Coolify Application/mount。
- Dashboard 已独立 clone 到 `/srv/ob-workspaces/dashboard`：`main`，commit `f8d33a15659ef760dabf0bfe3703504b2a9519f5`；Haven 已独立 clone 到 `/srv/ob-workspaces/haven`：`main`，commit `57d70e52e4e17dc66b55db1302056128edb96a87`。两个 origin 均为对应 GitHub 公共 HTTPS URL，均为正常 Git repo，工作树干净且全部文件归 `cc:cc`。
- 以宿主机 `cc` 身份分别在两个 workspace 和 `/srv/ob-data/claude` 完成创建/删除探针文件，读写权限通过。root 直接运行 Git 会触发正常的 dubious ownership 保护；未添加 `safe.directory` 例外，后续宿主机 workspace Git 操作应继续以 `cc` 身份执行。
- fresh clone 中发现 Dashboard 的 `polaris/.next/trace`、`polaris/.next/trace-build`，以及 Haven 的 `.claude/hooks/session_breath.py`、`.claude/settings.json`；本机 Git 追踪清单确认它们是公共仓库已追踪文件，不是从本机复制的 `.next` 或个人 `.claude`，因此本步骤不删除、不制造工作树改动。未发现 `.env`、`.env.local` 或 `node_modules`。
- Coolify 尚未创建 Dashboard Application，因此不存在会与 workspace 混用的 Dashboard build checkout；规划路径固定为 `/srv/ob-workspaces/*`，后续 Coolify 只从 GitHub 构建运行镜像，不得把 deployment checkout 指向或覆盖这两个目录。

#### 步骤 4：完成 Dashboard 的 VPS 兼容改动

操作范围：

- production Dockerfile/启动方式；
- 非 root `cc` 用户；
- Linux workspace 配置；
- `realpath` 防符号链接越界；
- 子进程 env allowlist；
- 正式公网登录/session；
- MCP 地址改为环境配置，不默认依赖容器 localhost；
- health check；
- 保留本机开发 fallback，不破坏 `npm run dev`。

验收：

- `npm run test`、TypeScript/ESLint 命中范围检查、`npm run build` 通过；
- Docker image 可 build；
- 本机 `npm run dev` 仍可使用；
- 不设置生产变量时不会意外开放公网；
- secret 不出现在构建产物和日志。

失败/rollback：精确还原本步骤改动；不改本机 `.env.local` 和 Zeabur。代码未验收前不 push 正式分支。

首个代码子窗口完成记录（2026-08-17）：

- 只完成 production Dockerfile、容器内非 root `cc` 用户和 production build/start 方式；未进入 workspace 白名单、`realpath`/symlink、防子进程 env 泄露、公网登录、Haven/MCP 地址、Coolify Application/mount 或 Haven 迁移。
- Dashboard 新增多阶段 `Dockerfile`，使用满足 Next.js 16 要求的 `node:22-bookworm-slim`。构建阶段执行 `npm ci` 与 `npm run build`；运行阶段重新安装完整 production dependencies 后执行既有 `npm run start`，没有启用 standalone tracing，确保 Agent SDK 的 Linux 原生 Claude Code 可选包随目标平台正确安装。
- 运行镜像安装 `ca-certificates`、`git`、`tini`，由 `tini` 托管既有 `next start`；设置 `NODE_ENV=production`、`HOSTNAME=0.0.0.0`、`PORT=3000`、`HOME=/home/cc`、`CLAUDE_CONFIG_DIR=/home/cc/.claude`。
- 容器创建固定 UID/GID `10001:10001` 的非 root `cc`，并预建归其所有的 `/workspace/dashboard`、`/workspace/haven`、`/home/cc/.claude`；数字身份与步骤 3 宿主机目录一致，未来 bind mount 后可直接读写。
- 新增 `.dockerignore`，排除 `.env*`、`.claude`、`.git`、本机 `node_modules`、`.next` 和 Polaris 构建缓存；未读取或修改本机 `.env.local`、`.claude`，没有把它们送入 Docker build context。
- `package.json` 的 `dev`、`dev:lan`、`build`、`start` scripts 和 `next.config.ts` 均未修改；本机继续使用 `npm run dev`，production 才使用 Docker 内的 `npm run start`。
- 验证结果：`npm test` 为 21 个文件、98 项全部通过；`npm run build` 与 Docker 内 Next.js 16.2.4 production build/TypeScript/67 个静态页面生成均通过。保留步骤 1 已记录的 `ccDirs.ts` 动态路径 NFT 警告，按既定下一窗口处理。
- 全仓 `npm run lint` 仍失败于既有源码和 `public/chat-app` 预构建产物，共 290 errors / 5873 warnings；本窗口没有 TypeScript/JavaScript 改动，也未越界修复既有 lint 账本。
- Docker image `ob-dashboard2:vps-step4-window1` 构建成功；临时容器通过 `next start` 在约 102ms ready，本机 `127.0.0.1:3010/` 返回 HTTP 200。容器内核验为 `uid=10001(cc) gid=10001(cc)`，三个目标目录均为 `10001:10001` 且实际创建/删除探针成功；Linux x64 Agent SDK 原生 `claude` 可执行文件和 Git 均存在。临时容器已停止并自动删除。
- 当前仍未创建 Coolify Dashboard Application、未配置 bind mount、未部署 VPS Dashboard，Zeabur Haven 与本机现行环境保持原样。步骤 4 下一代码子窗口只处理 workspace 根白名单与 `realpath`/symlink 防护。

第二个代码子窗口完成记录（2026-08-17）：

- 只完成 Dashboard 的 Linux workspace 根白名单与 `realpath`/symlink 越界防护；未进入 Claude 子进程 env allowlist、公网登录/session、Haven/MCP 地址、Coolify Application/bind mount、Haven 迁移，也未修改 production Dockerfile。
- VPS production 由既有 `NODE_ENV=production` 启用固定上限，只允许 `/workspace/dashboard` 与 `/workspace/haven`。Persona 未配置读目录时默认 `/workspace/dashboard`；`/workspace/haven` 需明确配置。写目录继续保持空清单全拒，配置目录本身必须存在且 `realpath` 仍在固定根内。
- 本机 `npm run dev` 保留现有 Windows 用法：Persona 仍可配置本机绝对路径，相对路径按 Dashboard `process.cwd()` 解析，空读目录回退本机仓库根；本窗口未读取或修改 `.env.local`、`.claude`。
- `Read`、`Grep`、`Glob`、`Write`、`Edit`、`NotebookEdit` 已在统一 PreToolUse 入口校验路径。已存在目标校验自身 `realpath`；新文件/目录逐级寻找最近已存在父目录并校验其 `realpath`；dangling symlink 直接拒绝。写工具在自动放行或展示批准卡前仍会再次校验；Bash 保持逐次人工批准，敏感文件 denylist 与 Grep 输出擦除不变。
- 新增 `tests/cc-dirs.test.ts`，覆盖根目录本身、根内绝对路径、`..`、白名单外路径、相似前缀、新文件/多级新目录、文件 symlink、目录 symlink、新文件父目录 symlink 逃逸，以及六个文件工具的真实路径字段。Windows 本机因系统权限跳过文件 symlink 创建，Linux builder 容器中 6 项全部通过。
- 验证结果：命中范围 ESLint 通过；完整 `npm test` 为 22 个文件、103 项通过、Windows 文件 symlink 1 项按平台跳过；本机 `npm run build` 和 Linux Docker builder 的 Next.js 16.2.4 production build/TypeScript/67 个静态页面均通过。此前 `ccDirs.ts` 动态路径 NFT 警告不再出现。
- 最终镜像 `ob-dashboard2:vps-step4-paths` 构建成功；临时 production 容器以 `uid=10001(cc) gid=10001(cc)` 运行，`/workspace/dashboard`、`/workspace/haven` 均为 `10001:10001`，本机 `127.0.0.1:3011/` 返回 HTTP 200。临时容器已停止并自动删除。
- 当前仍未创建 Coolify Dashboard Application、未配置 bind mount、未部署 VPS Dashboard，Zeabur Haven 与本机现行环境保持原样。步骤 4 下一代码子窗口只处理 Claude 子进程 env allowlist。

第三个代码子窗口完成记录（2026-08-17）：

- 只完成 Dashboard 的 Claude Code 子进程 env allowlist；未进入公网登录/session、Haven/MCP 地址、Coolify Application/bind mount、Haven 迁移，也未继续调整 workspace 防护或 production Dockerfile。
- `app/lib/ccEnv.ts` 已从“继承全部 `process.env` 再删除少量变量”改为从空对象构造。Linux production 与通用本机环境只允许 `PATH`、`HOME`、`USER`、`SHELL`、`LANG`、`LC_ALL`、`TERM`、`TMPDIR`、`CLAUDE_CONFIG_DIR`，并固定写入 `CLAUDE_AGENT_SDK_CLIENT_APP`；Agent SDK 自己继续补运行所需的 entrypoint/version 标记。
- Windows 本机 `npm run dev` 按平台额外允许 `SystemRoot`、`WINDIR`、`ComSpec`、`PATHEXT`、`TEMP`、`TMP`、`USERPROFILE`、`HOMEDRIVE`、`HOMEPATH`、`APPDATA`、`LOCALAPPDATA`、`USERNAME`，供原生 Claude、Git、shell、临时目录与本机 OAuth 配置使用；未放行 Git credential、SSH agent、代理认证或其他平台凭据。
- API 模式只额外传当次选定的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 与四个跟随当次主模型的 family 映射变量；Haven 上游覆盖缺失时仍只逐键回退本机 `.env.local` 的 URL/token，不继承其他变量。subscription/OAuth 模式不传任何 `ANTHROPIC_*`，继续使用 `/home/cc/.claude` 或本机 Claude 配置目录中的登录状态；模型仍通过 SDK CLI option 选择。
- `app/api/cc-test/route.ts` 删除了复制的旧 `buildEnv`，与正式 `ccOptions.ts`、`cc-hook-test` 统一使用 `buildCcEnv`；两个最小测试入口也把当次模型交给 API family 映射。静态检索确认三个 Claude `query()` 入口全部由同一 allowlist 控制。独立 stdio MCP 的自定义 `server.env` 不属于 Claude 子进程，本窗口未改。
- 新增 `tests/cc-env.test.ts` 6 项，覆盖基础 allowlist、Windows 平台兼容、API override 与本机 fallback、OAuth 全部 `ANTHROPIC_*` 拒绝、相似前缀变量和未列入变量默认拒绝，并明确验证 Dashboard/Haven/数据库/Redis/Coolify/GitHub/GitLab/SSH/AWS/Azure/Google/OpenAI/Gemini/Mistral/Docker/Kubernetes/父 Claude 会话/OTEL secret 不进入构造结果。
- 验证结果：命中 ESLint 通过；完整 `npm test` 为 23 个文件、109 项通过、Windows 文件 symlink 1 项按平台跳过；本机 `npm run build` 的 Next.js 16.2.4 production build、TypeScript 与 67 个静态页面均通过。
- Linux builder 镜像 `ob-dashboard2:vps-step4-env-builder` 构建成功，镜像内 production build/TypeScript 通过；容器内新增 env 测试 6 项全部通过，确认 Windows 专用变量在 Linux 分支不放行。本窗口不需要修改 Dockerfile，也未读取或修改本机 `.env.local`、`.claude`。
- 当前仍未创建 Coolify Dashboard Application、未配置 bind mount、未部署 VPS Dashboard，Zeabur Haven 与本机现行环境保持原样。步骤 4 下一代码子窗口只处理正式公网登录/session。

第四个代码子窗口完成记录（2026-08-17）：

- 只完成 Dashboard 正式公网登录/session；未处理 MCP/Haven 地址配置、Coolify Application/环境变量/bind mount、Haven 迁移，也未继续调整 workspace 防护、Claude env allowlist 或 production Dockerfile。
- 删除旧 `OB2_LAN_SECRET + ?k= + ob2_lan 明文 cookie` 的 production 门禁。新增独立 `/login` 页面，只通过 POST body 提交口令；设置页提供 POST 退出入口。production 只认 `DASHBOARD_LOGIN_SECRET`（至少 12 字符）与独立 `DASHBOARD_SESSION_SECRET`（至少 32 字符），任一缺失/过短时所有私人页面和 API 安全返回 503，旧 `OB2_LAN_SECRET` 在 production 被忽略。
- 登录成功签发 HMAC-SHA256 签名、带随机 nonce、7 天明确过期的 `ob2_session` cookie；production 属性为 `HttpOnly + Secure + SameSite=Strict + Path=/`。伪造、篡改、过期 cookie 或轮换签名 secret 后均失效；退出会清除 cookie 并要求浏览器清 cache。口令与签名 secret 不进入 URL、响应、应用日志或构建产物。
- 根 `proxy.ts` 统一覆盖 Dashboard 页面、全部 `/api/cc-*`、批准接口、Gateway/Haven/MCP relay 和其他私人 API。公开边界精确限制为 `/login`、`/api/auth/login`、无私人信息的 `/api/health`、`/_next/static/*`、manifest/service worker/favicon 与两个 PWA 图标；普通图片、`chat-app` 和 `/api/auth/logout` 仍受保护。未登录页面跳转登录，未登录私人 API 返回 401。
- 登录口令使用固定长度 SHA-256 摘要的恒时比较；失败按客户端指数退避（最高 30 秒）并设置 10 分钟内 20 次失败的单实例全局上限。限速状态属于允许重启丢失的运行态，不新增持久用户数据。非 production 未配置任何鉴权变量时继续保留本机 `npm run dev` 直开；旧 `OB2_LAN_SECRET` 只在非 production 兼容，并派生仅开发用 session key。
- `public/sw.js` 升级 cache 版本并停止缓存 HTML、API 和私人图片，避免退出后从 PWA cache 显示私人页面；只继续缓存不可变 JS/CSS/font 代码资源。
- 新增 3 个测试文件、15 项鉴权测试，覆盖 production 缺/弱 secret、开发 fallback、正确/错误登录、恒时校验、签名/伪造/过期/轮换失效、退出、客户端/全局限速、旧 `?k=` 与旧 cookie 拒绝、公开资源边界，以及登录响应和 console 不含测试 secret。完整 `npm test` 为 26 个文件、124 项通过、Windows 文件 symlink 1 项按平台跳过；命中 ESLint、本机 Next.js 16.2.4 production build/TypeScript/71 个静态页面均通过。
- Docker image `ob-dashboard2:vps-step4-auth` 构建成功，镜像内 production build/TypeScript 通过。无 secret 临时容器实测页面/API 为 503，登录页/health 为 200；配置虚构测试 secret 后，未登录 `/cc` 307 跳登录、POST 登录 303、cookie 四项安全属性与 7 天有效期正确、带 session 页面 200，私人 API 已通过鉴权进入业务校验，退出 303 且清 cookie。容器仍以 `uid=10001(cc) gid=10001(cc)` 运行，日志不含两个测试 secret；两个临时容器均已停止并自动删除。
- 当前仍未创建 Coolify Dashboard Application、未配置真实登录 secret 或 bind mount、未部署 VPS Dashboard，未修改本机 `.env.local`、`.claude` 或 Zeabur。步骤 4 下一代码子窗口只处理 MCP/Haven 地址配置化与第一阶段 Zeabur 联调。

第五个代码子窗口完成记录（2026-08-17）：

- 只完成 Dashboard 的 Haven/Gateway/MCP 地址配置化与第一阶段连接 Zeabur 所需代码准备；未创建或修改 Coolify Application、环境变量、bind mount，未部署 Dashboard，未修改 Zeabur/Haven 数据或服务，也未继续调整登录/session、workspace、Claude env allowlist 或 Dockerfile。
- 新增服务端 `app/lib/havenConfig.ts`，统一在请求期读取并校验 Haven 配置。production 只认 `HAVEN_GATEWAY_URL`、`OMBRE_SESSION` 与 `OMBRE_GATEWAY_TOKEN`，不再使用 `OMBRE_BASE_URL`、`NEXT_PUBLIC_OMBRE_BASE_URL`、`NEXT_PUBLIC_OMBRE_SESSION` 或写死域名 fallback；基础 URL 只接受 http/https、不得含账号密码/query/hash，并拒绝 localhost、`127.0.0.0/8`、`::1` 与 `0.0.0.0`。本机 `npm run dev` 继续兼容旧变量、旧默认地址和本机 MCP fallback。
- Brain 继续保持 `/api/* + /auth/login cookie` 契约，Gateway/cc 持久化继续保持 `/gateway/api/*` 契约；九个分散的 Gateway/Haven 读取点与全部普通 Brain API route 已收口到统一配置，并在每次请求时读取运行环境，避免 Docker build 未注入地址时把空值固化进镜像。通用 Gateway 代理不再转发浏览器提交的 `Authorization` / `x-api-key`，只由 Dashboard 服务端注入 `OMBRE_GATEWAY_TOKEN`；错误响应会擦除已知 Haven secret。
- cc MCP 仍以 Haven 持久配置为事实源。production 不再读取 `.data/cc-mcp.json` 或启用 `127.0.0.1:18001/mcp` 默认项；Haven 尚无 MCP 行时只种入空清单，读取失败或已保存 HTTP/SSE 地址指向 loopback 时明确失败并保持禁用，不会静默连接容器自身。开发环境保留原行为。
- 用户人工确认第一阶段 Zeabur HTTPS 基础地址、MCP 完整地址和 Gateway token 已存在；Zeabur Networking 页面未显示 IP allowlist、Access Control 或其他来源限制。公网无凭据探测确认 HTTP 会跳转 HTTPS、HTTPS 根入口可达、MCP 路径抵达 Haven 并按协议返回拒绝；未调用真实 MCP 工具、未发送 token。
- 新增 4 个测试文件、29 项定点测试，覆盖 production 正常/缺配置、非法 URL、IPv4/IPv6 loopback、开发 fallback、Brain `/auth/login + /api/*`、Gateway `/gateway/*`、MCP `/gateway/api/cc/mcp` 路径、服务端 token 注入、浏览器认证头拒绝与错误 secret 擦除。完整 `npm test` 为 30 个文件、153 项通过、Windows 文件 symlink 1 项按平台跳过；命中 ESLint与本机 Next.js 16.2.4 production build/TypeScript/71 个静态页面通过。
- Docker image `ob-dashboard2:vps-step4-haven-config` 构建成功。缺 `HAVEN_GATEWAY_URL` 的 production 容器对 Gateway 返回 503；配置 loopback 的容器对 Gateway 与 MCP 均返回 503，不发出错误上游连接；镜像 build 阶段不提供 Haven 地址、运行阶段注入保留的虚构域名后，Gateway 与普通 Brain route 均进入网络连接分支并安全返回 502，证明运行时配置未被 build 空值覆盖。容器仍以 `uid=10001(cc) gid=10001(cc)` 运行，日志不含虚构的 Dashboard/Haven/Gateway secret；三个临时容器均已停止并自动删除。
- `.dockerignore` 继续排除 `.env*`。production `.next/server`、`.next/static` 与镜像构建未发现本机或测试 secret；发现旧 `.next/dev` 缓存含历史开发期内联值后，已精确删除该可再生成目录并复扫通过，未读取回显或修改 `.env.local`。
- 下一窗口进入步骤 5：只在 Coolify 创建 Dashboard 测试 Application、单实例、配置测试域名/HTTPS、三个既定 bind mount 与第一阶段服务端环境变量，并按步骤 5 验收；不在本窗口继续，不迁移 Haven。

步骤 5 完成记录（2026-08-17）：

- 在 Coolify 4.3.5 的 `Ombre Brain / production` 中创建了唯一一个 Dashboard 测试 Application，来源为公开 GitHub 仓库 `heyeovo/ob-dashboard2` 的 `main` 分支，使用仓库 production `Dockerfile`、容器内部端口 3000 与 `npm run start`；保持单实例、手动部署、Preview disabled，不启用自动部署。
- 临时测试入口为 `https://dashboard-vps.23.95.136.46.sslip.io`，DNS 与当前 HTTPS 证书验证通过，并设置 `noindex`。该 sslip 域名只用于测试，Coolify 已提示公共 sslip 域名存在 Let's Encrypt 限速风险；未配置或切换正式域名。
- production 运行时配置的服务端键名为 `DASHBOARD_LOGIN_SECRET`、`DASHBOARD_SESSION_SECRET`、`HAVEN_GATEWAY_URL`、`OMBRE_SESSION`、`OMBRE_GATEWAY_TOKEN`；均只在 runtime 可用，不在 buildtime 注入。没有 `NEXT_PUBLIC_OMBRE_*`。当前 Claude API 上游仍以 Haven 已保存配置为事实源，因此没有在 Coolify 重复配置 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`。文档、聊天、截图和验收输出均未记录任何 secret 值。
- 三个实际 bind mount 已验收为 `/srv/ob-workspaces/dashboard → /workspace/dashboard`、`/srv/ob-workspaces/haven → /workspace/haven`、`/srv/ob-data/claude → /home/cc/.claude`；容器内三个目标均为目录且归 `10001:10001` 所有。实际 mount 清单只有这三项，没有 Docker socket。
- Coolify HTTP healthcheck 使用 `GET http://localhost:3000/api/health`、期望 200，当前 deployment 首次检查即为 healthy；公网 `/api/health` 返回 200 和无私人信息的 `{\"ok\":true}`。为兼容 Dockerfile/image 型 healthcheck，commit `2e1014c` 只在运行镜像增加 `curl`，没有改 production 启动方式。
- 首次公网登录暴露了反向代理兼容问题：`request.url` 在容器内为 `localhost:3000`，导致登录结果跳向本机地址。commit `33e48a9` 将登录成功、失败和退出改为相对 `Location`，保持原口令校验、session、cookie、限速和私人路由保护不变；定点测试、完整 153 项测试与 production build 通过。修复部署后，正确口令可进入 Dashboard，刷新仍保持登录。
- 外部只读验收确认 HTTPS 有效；未登录根页面 307 到 `/login`，未登录私人 `/api/config` 返回 401，`X-Robots-Tag` 为 `noindex, nofollow`。容器内 `id` 为 `uid=10001(cc) gid=10001(cc)`，五个必要服务端键均存在且 `NEXT_PUBLIC_OMBRE_*` 不存在。
- 宿主机 `docker inspect` 确认 `Privileged=false`、`CapDrop=[\"ALL\"]`、`PortBindings={}`，不挂 Docker socket、不映射主机端口、不开放 Agent SDK/Claude 额外端口；按 Application UUID 筛选只有一个运行容器。Coolify 4.3.5 会把自定义 `--security-opt no-new-privileges` 错误解析为无效的 `security-opt: \"no\"`，因此该选项未保留；当前仍由非 root、非 privileged、`cap-drop ALL`、最小挂载和无主机端口映射约束。
- Haven/Zeabur 服务、数据、域名和运行配置均未修改；没有执行真实 Haven API、MCP 工具或 Claude workspace 功能调用，也未处理 restart/resume、自动部署、正式域名切换或第二阶段迁移。步骤 6 只能在用户另行确认后开始。

#### 步骤 5：在 Coolify 创建 Dashboard 测试资源（✅ 2026-08-17 完成）

操作：

- 从 GitHub 创建 Dashboard Application。
- 单实例，production build/start。
- 加入三个 bind mount。
- 配置测试域名和 HTTPS。
- 配置 Dashboard 登录 secret 与 Zeabur Haven URL/token；Claude API 上游继续读取 Haven 已保存配置，不在 Coolify 重复保存中转站凭据。
- 不开放 Agent SDK/Claude 额外端口。

验收：

- Coolify deployment 成功；
- health check 为 healthy；
- HTTPS 证书有效；
- 未登录访问页面/API 都被拒绝；
- `docker inspect` 中无 privileged、Docker socket 或意外挂载。

失败/rollback：在 Coolify 停止/删除测试 Application；bind mount 数据保留，本机与 Zeabur不受影响。

步骤 6 完成记录（2026-08-17）：

- 用户在 Zeabur 当前页面人工确认 Haven 为 Running；真实基础地址为 `https://foryan.zeabur.app`，真实 MCP 地址为 `https://foryan.zeabur.app/mcp`。Gateway token 仅确认存在且长度为 5，未回显真实值；Zeabur 未配置来源限制。
- Dashboard production 容器内确认运行身份为 `uid=10001`、工作目录 `/app`、`NODE_ENV=production`。Haven 地址为 HTTPS、非 loopback，DNS 成功解析；TLS 证书授权有效，协商 TLS 1.3。Haven API 与 MCP 均不依赖容器内 `localhost` / `127.0.0.1`。
- Haven 登录返回 200 并收到 session cookie；Brain session 读取返回 200；会话列表返回 1 项，Persona 列表返回 2 项。使用用户提供的非敏感召回词 `【全家福】` 得到 2 张卡片、2 个 recalled ID 和非空 context，未输出记忆正文。
- 直接连接 Zeabur `/mcp` 的 `tools/list` 返回 23 个 Ombre Brain 工具；选用明确只读的 `pulse(include_archive=false)` 调用成功，返回非空结果，未输出结果正文，也未调用任何写工具。
- Dashboard 登录后 `/api/cc-turns?limit=1` 与正确的 `/api/gateway/api/cc/personas`、`/api/gateway/api/cc/mcp` 读取链路成功。迁移前的精确值扫描确认 Gateway token 不在浏览器响应正文、响应头或 URL；Coolify Runtime Logs 仅有 Next.js production 启动信息，未出现 token 或请求凭据。
- 发现一个直接兼容问题：Haven 中保持停用的 Tavily MCP 项仍把 key 放在 URL query，Dashboard production 会校验全部已保存服务，因此 `/api/cc-mcp` 返回 503 `MCP URL 不得携带 query 或 hash`；Ombre Brain 自身的 Zeabur MCP 地址与调用不受影响。
- 经用户明确选择并确认，保留 Tavily 项与原 key：先用 `Authorization: Bearer` 对无 query 的 `https://mcp.tavily.com/mcp/` 执行只读 `tools/list`，成功返回 5 个工具后，才把同一 key 从 URL query 迁移到该 header。Tavily 始终保持 `enabled=false`，未调用搜索或其他 Tavily 工具；未修改 Ombre Brain 项、Zeabur 环境变量、服务、业务数据或域名。
- 迁移后 Haven 回读确认 Tavily URL 无 query/hash、Authorization header 存在且 Tavily 仍停用；Dashboard `/api/cc-mcp` 恢复返回完整配置，浏览器只看到 `Authorization: ********`。`/tools/mcp` 正常显示 Ombre Brain 23 个工具与停用的 Tavily 5 个工具，不再出现 503。
- 本步骤未修改 Dashboard 代码、登录/session、workspace 防护、Claude env allowlist、Dockerfile 或 Coolify 部署参数；未进入步骤 7，未处理 restart/resume、自动部署、正式域名切换或第二阶段迁移。

#### 步骤 6：验证 Zeabur Haven 和 MCP 连接（✅ 2026-08-17 完成）

操作：

- 人工确认 Zeabur 真实基础 URL、MCP URL、token。
- 从 Dashboard 容器测试 DNS/TLS/health。
- 验证会话列表、召回、Persona、MCP 工具清单及一个只读 MCP 调用。

验收：

- 容器中没有任何对 Haven 的 `localhost/127.0.0.1` 依赖；
- Haven API 和 MCP 均走 HTTPS Zeabur 地址；
- token 不出现在浏览器响应和应用日志；
- Zeabur 原服务继续正常服务现有客户端。

失败/rollback：把 Coolify 环境变量恢复为上一个值并 redeploy；不要修改 Zeabur 数据或域名。

#### 步骤 7：验证 Claude API 模式和 workspace 边界（✅ 2026-08-17 完成）

步骤 7 进度记录（2026-08-17）：

- 首次只读访问 Coolify Dashboard `/cc` 确认登录/session 有效；兼容修复部署前未执行 Claude 或 workspace 调用。
- 发现直接兼容问题：前端原先把所有非 localhost/局域网 hostname 都当成 Vercel，因而 Coolify 临时 HTTPS 域名被强制为 selfhost，`cc` 按钮禁用，阻断 Claude API 模式验收。
- 经用户确认最短修改范围，`app/cc/useIsRemote.ts` 已改为只把 `*.vercel.app` 官方域名识别为 Vercel；Coolify sslip、以后的 VPS 正式公网域名和本机仍允许 cc/selfhost 切换。未改登录/session、workspace 防护、Claude env allowlist、Dockerfile、Coolify 参数或 Haven。
- 新增定点测试 `tests/cc-runtime-surface.test.ts`；该测试与现有 engine routing 测试共 6 项通过，`npm run build` 通过。用户已自行 commit/push 并在自动部署关闭状态下手动重新部署成功；Coolify 公网 `/cc` 恢复 `cc` 与 API 模式入口。
- 使用专用测试 Persona `Ombre3` 和专用工作模式会话完成验证，没有使用个人 Persona「言之」。读目录精确为 `/workspace/dashboard`、`/workspace/haven`，首个目录作为当前工作目录；分别只读两个 workspace 的 `README.md` 成功，未输出正文或敏感信息。
- 写入验证前只把 `/workspace/dashboard/.cc-step7-test` 临时加入可写目录。一次 Write 仅创建 `write-test.txt`，一次 Bash 仅创建测试目录和指向 `/etc/hostname` 的测试 symlink；两类操作都先显示明确批准卡，并且均只批准一次，没有对整段对话放行。未修改业务文件、未 commit、未 push。
- workspace 防护共 7 项全部按预期拒绝，且未输出文件内容：白名单外 `/etc/hostname`、`..` 路径穿越、workspace 内指向外部的 symlink、`/workspace/dashboard/.env`、`/workspace/dashboard/.git/config`、Claude credential 路径与 SSH key 路径。`.env` 与 `.git/config` 命中凭据保护，其余越界项命中 workspace 边界。
- Claude 子进程环境只检查键名与 PRESENT/ABSENT，不读取值。API 运行所需的 base URL、auth token、SDK client 标记和四个模型 family 映射键存在；Dashboard、Haven、Ombre、数据库/Postgres、Coolify、GitHub/GH 相关固定键或敏感前缀均未继承。整个验证没有显示任何 secret。
- 验证完成后，以精确非递归命令删除测试文件、测试 symlink 和空测试目录；随后从 `Ombre3` 移除唯一临时写目录并保存。最终读目录仍精确为 `/workspace/dashboard`、`/workspace/haven`，写目录为空，页面显示“没配，所以现在只能看不能改”。专用测试会话保留作为验收记录。
- 本步骤未修改登录/session、workspace 防护实现、Claude env allowlist、Dockerfile、Coolify 部署参数或 Haven/Zeabur 配置；未测试 restart/resume，未进入步骤 8、自动部署、正式域名或第二阶段迁移。

操作：

- 新建测试会话，选择 API 模式。
- 分别读取两个 workspace 的无敏感测试文件。
- 在专用测试分支写入/修改一个可删除测试文件。
- 尝试访问白名单外目录、`..` 和 workspace 内指向外部的 symlink。
- 检查批准队列、Bash 询问和敏感文件 denylist。

验收：

- 两个允许 workspace 可正常读写；
- 白名单外、路径穿越、symlink 逃逸均被拒；
- `.env`、credential、SSH key、`.git/config` 内容不可读；
- Bash/写操作按当前规则弹出批准；
- Claude 子进程环境中没有 Dashboard/Haven/DB/Coolify/GitHub secret；
- 测试改动只出现在 workspace，不改变运行中的 `/app`。

失败/rollback：停止 Dashboard Application；删除测试分支/测试文件时只精确处理本步骤创建内容，不 reset 整个 workspace。

#### 步骤 8：验证持久化、restart 和 resume（✅ 2026-08-17 完成）

步骤 8 进度记录（2026-08-17）：

- 使用专用 Persona `Ombre3` 和专用窗口；UI 显示的 Dashboard/Haven 窗口 ID 为 `ob2-20260816-0m3g5r`。第一次 Restart 约 40 秒，Dashboard 无需重新登录；原会话和重启前轮次仍在，准确续聊并正常保存，验证了跨容器重启后的既有 resume 行为。
- Coolify terminal 只做存在性检查，不显示名称或内容；固定标记 `CLAUDE_MOUNT_OK`、`DASHBOARD_MOUNT_OK`、`HAVEN_MOUNT_OK` 均出现，说明 `.claude` 非空且两个 workspace 目录存在。
- 重启后复核确认 Ombre3 仍有两个读目录 `/workspace/dashboard`、`/workspace/haven`，写目录为空；Haven Persona、会话、权限、MCP 和 5 个上游配置仍存在。
- 第二次在 Bash `pwd` 批准卡等待时 Restart 约 40 秒；旧批准卡消失，并明确显示“连接提前结束，没有收到这一轮的完成结果”。随后在不调用工具的情况下正常回复并保存，证明待批准队列失效且应用未永久卡死。
- 没有批准或执行 `pwd`，没有显示 secret，没有修改业务文件、配置或 Zeabur。UI 只显示 Dashboard/Haven 窗口 ID，不显示原生 Claude session ID。
- 步骤 7 测试文件已清理；本步骤按“不修改业务文件”边界未另建文件，因此“已完成文件修改仍存在”无保留样本可复核；两个 workspace 挂载本身已确认存在。

操作：

- 完成一轮对话并记录 Claude session ID。
- 重启/重新部署 Dashboard 容器。
- 重新打开原对话并继续一轮。
- 在等待批准时做一次测试重启，确认产品提示符合真实行为。

验收：

- `/home/cc/.claude` 在重启后仍存在；
- API 模式 session/history 可 resume；
- 已完成文件修改仍存在；
- 待批准队列在重启后明确失效，不假装仍在执行；
- 应用不会因找不到旧内存 session 而永久卡死。

失败/rollback：恢复上一 Coolify deployment；`.claude` 和 workspace volume 不删除。必要时只恢复迁移前的加密 `.claude` 备份。

#### 步骤 9：验证 GitHub → Coolify 自动部署隔离

操作：

- 在测试分支做一项无害变更，由用户 commit + push。
- 观察 Coolify 自动 build/deploy。
- 同时确认 Claude workspace 的未 commit 测试内容没有被覆盖。

验收：

- GitHub push 自动触发正确 resource；
- build 成功后新版本 healthy；
- build 失败仍保留上一可用 deployment；
- workspace 与部署 checkout 完全独立；
- 未 commit 文件在重新部署后仍存在。

失败/rollback：Coolify 回滚到上一 deployment；Git commit 由用户决定是否 revert，Codex 不代 push。

#### 步骤 10：24–48 小时试运行与正式切换

操作：

- 使用测试域名完成手机、公司电脑、家里电脑访问。
- 观察 RAM、swap、CPU、磁盘、Docker cache、应用重启和错误日志。
- 确认一次实际的小功能修改→测试→用户 push→自动部署完整链路。
- 验证通过后，才把正式 Dashboard 域名/DNS 切向 VPS。

验收：

- 家用电脑完全关机时 Dashboard + Claude Code 仍可用；
- 未授权请求无法访问页面/API/批准接口；
- 无持续内存增长、频繁 swap 或 OOM；
- 本机版本仍可独立启动，尚未删除。

失败/rollback：正式 DNS 指回旧入口或继续使用测试域名；Coolify 回滚上一 deployment。本机和 Zeabur未被替换，可立即继续使用。

并行被动观察规则（步骤 8 完成后持续进行，观察不是停工等待）：

- 观察 Dashboard Application 持续 Healthy、是否发生非人工 restart/OOM，以及 RAM、swap、CPU、磁盘趋势。
- 观察 Runtime/Proxy 是否出现重复错误、登录或 Claude session/resume 是否卡死。
- 观察 Dashboard 到现有 Zeabur Haven/MCP 的稳定性。

---

## 15. 第二阶段：Haven 迁移

步骤 8 完成后允许开始第二阶段前半段，并另开窗口推进；但最终停写、最终导入、Dashboard Haven URL/MCP 切换、真实写入、停止/取消 Zeabur，仍必须在 Dashboard 关键稳定性与 Haven 预迁移验收通过后执行。

### 15.1 目标部署

```text
Dashboard
  → http://haven-brain:8000/gateway/api/*（现有兼容路径）
  → http://haven-brain:8000/api/*（Brain 直连接口）
  → http://haven-brain:8000/mcp

haven-brain
  → http://haven-gateway:8010/api/config

Brain + Gateway
  → /data（buckets）
  → /state（SQLite、runtime config、其他持久状态）
```

### 15.2 迁移前人工确认

由于 Zeabur 的实际 volume/export 方式属于外部平台真实配置，先让用户在 Zeabur 控制台确认：

- `/app/buckets`、`/app/state` 当前挂载是否仍有效；
- 数据导出/下载方式；
- 当前服务使用的 commit/image；
- 环境变量清单；
- 当前真实 DB/SQLite 文件和大小；
- 是否有定时任务或后台写入；
- 当前域名、端口和健康检查。

#### 第二阶段窗口 1 完成记录（2026-08-17）

- 用户在 Zeabur 控制台人工确认 Haven 当前为 `Running`，最近一次部署约 3 天前，使用 commit `57d70e5`，未发现异常 restart、OOM 或 Crash；Zeabur 未单独显示 image 名称。项目卡显示 `1/1` 个服务运行，没有独立 Cron Job、Worker 或 Scheduled Job。
- 两个真实 volume 仍有效：`ombre-buckets → /app/buckets`，当前 67.55 MB；`ombre-state → /app/state`，当前 85.37 MB。`/app/buckets` 顶层目录为 `archive/`、`cc-attachments/`、`dynamic/`、`feel/`、`journal/`、`permanent/`、`trash/`，文件总数 334。
- `/app/state` 顶层可见 `.env`、`config.runtime.yaml`、JSON/JSONL 状态文件、`darkroom/`、`dreams/`、`raw-archives/` 等；本窗口只看名称和元数据，没有读取内容。实际数据库共 10 个、合计 46,473,216 bytes（约 44.32 MiB）：`automations.sqlite` 98,304 bytes、`identity_semantics.sqlite` 28,672 bytes、`memory_moments.sqlite` 1,482,752 bytes、`memory_nodes.sqlite` 94,208 bytes、`persona_state.db` 1,187,840 bytes、`prompt_overrides.sqlite` 12,288 bytes、`raw_events.sqlite` 41,951,232 bytes、`reminders.sqlite` 20,480 bytes、`todos.sqlite` 16,384 bytes、`word_map.sqlite` 1,581,056 bytes。
- 当前环境变量只记录键名，不记录值：`OMBRE_API_KEY`、`OMBRE_BUCKETS_DIR`、`OMBRE_DASHBOARD_PASSWORD`、`OMBRE_DOMAIN_SENTINEL_ENABLED`、`OMBRE_DOMAIN_SENTINEL_LLM_ENABLED`、`OMBRE_EMBEDDING_API_KEY`、`OMBRE_ENV_PATH`、`OMBRE_GATEWAY_TOKEN`、`OMBRE_GATEWAY_UPSTREAM_API_KEY`、`OMBRE_QUERY_PLANNER_ENABLED`、`OMBRE_RUNTIME_CONFIG_PATH`、`OMBRE_STATE_DIR`、`OMBRE_TRANSPORT`、`PASSWORD`、`PORT`。
- 当前公网域名为 `https://foryan.zeabur.app`，容器端口 `8080`、协议 HTTP；Zeabur 页面未配置/未显示应用 healthcheck。服务仍为 Running，现有 Dashboard 到 Haven/MCP 的登录、session/resume、页面与工具清单均由用户人工确认正常。
- Haven 内部定时任务仍有写入可能：日回顾已启用，每天 04:30；Weekly Journey 已启用，每周一 05:00，协作者为「言之」。Weekly Journey 最近一次失败，用户判断可能与已保存的中转站模型不可用有关；本窗口未诊断或修改。没有其他已知设备持续写入，但在最终停写前不能把 Zeabur 数据视为静止。
- Zeabur 原生 Backup/Restore 当前可操作但已连续两次因平台资源不足失败；文件管理器目录下载会长时间压缩后超时。当前唯一已验证成功的完整导出路径仍是 Terminal：buckets 直接归档，state 中 SQLite 先用 `sqlite3.backup()` 生成一致副本并逐库通过 `PRAGMA integrity_check`，再归档下载。
- 第一阶段保存的 `haven-buckets-20260817.tar.gz`（约 30 MB）、`haven-state-20260817.tar.gz`（约 25 MB）和 Zeabur 项目 YAML 仍由用户私密保存，足以作为第二阶段窗口 2 的预迁移输入；当前 volume 已有少量增长，因此这些副本不是最终切换副本。最终切换仍必须先停止定时任务和所有写入，再按已验证的 Terminal 路径重新导出并做 checksum、SQLite integrity 与记录数校验。
- Zeabur 订阅页人工确认：取消订阅/停止自动续费不会立即停服，降级在当前账单周期结束时生效；周期结束后付费功能不可用，共享集群服务可能被暂停。下次扣款日为 2026-08-21。本窗口已退出取消弹窗，没有执行继续、取消订阅或停止续费；在 VPS Haven 完成真实写入、持久化、备份恢复和切换验收前不得取消。
- Dashboard 被动观察正常：Coolify localhost 为 Ready，当前主机 5.8 GiB RAM 中约 4.2 GiB available，3.0 GiB swap 仅使用 524 KiB，根盘 96 GiB 中使用 8.3 GiB（10%），load average 为 `0.47 / 0.40 / 0.38`；Dashboard 容器观察时约 121.6 MiB、0.02% CPU。用户确认 Dashboard Running/Healthy、无异常 restart/OOM/Crash、登录、原会话打开/resume 及 Zeabur Haven/MCP 均正常，没有重复错误。Coolify 历史 Metrics 当前为 Disabled，本窗口没有启用或修改。
- 第二阶段窗口 1 全程只读：未修改 Zeabur service、volume、环境变量、域名、续费或运行状态；未停止后台任务，未重新部署、导入、切换 Dashboard Haven URL/MCP、切流量或创建 VPS Haven 测试栈；未显示 secret、credential 或私人记忆正文。
- 准入结论：已具备进入第二阶段窗口 2 的条件。窗口 2 只能用现有私密副本创建不接正式写流量的 Haven Compose/Coolify 内网测试栈；Zeabur 必须继续运行。8 月 21 日前的主要风险是最终一致导出仍依赖 Terminal、Zeabur 定时任务仍启用、Weekly Journey 当前有一次失败，以及真实写入/持久化/备份恢复/切换验收尚未完成；这些不阻塞窗口 2，但阻塞最终停服或取消续费。

#### 第二阶段窗口 2 完成记录（2026-08-17）

- 第一阶段本机旧下载被复核为截断归档，不能继续作为迁移输入。Zeabur 原生 Backup 再次因 `FailedScheduling: insufficient memory` 失败；未继续重复尝试，也未停止 Haven。
- 已按验证过的 Terminal 路径重新生成预迁移副本：buckets 直接归档为 30,837,530 bytes；state 的 10 个 SQLite 先用 `sqlite3.backup()` 生成一致副本，逐库 `PRAGMA integrity_check` 均通过，再归档为 25,997,375 bytes。由于 Zeabur 单文件下载会提前截断，两份归档均拆成小片下载后在本机合并；最终 tar/gzip、大小和目录身份校验通过。Zeabur 项目 YAML 也已确认存在且可读。所有副本只在用户本机私密保存，未写入 Git，且不是最终切换副本。
- Haven 仓库新增 `compose.coolify.test.yml`，只定义 `haven-brain`、`haven-gateway` 和内部网络；构建源固定到与当前 Zeabur 一致的 commit `57d70e52e4e17dc66b55db1302056128edb96a87`。Brain 显式监听 8000，Gateway 显式监听 8010，未配置 `ports` 或公网域名。
- Coolify 已创建 `haven-test-stack`。两个服务共享 `haven-test-internal` 与 Coolify stack network；Brain 通过 `http://haven-gateway:8010` 访问 Gateway。宿主机 `/srv/ob-data/haven-test/buckets` 挂载为两服务 `/data`，`/srv/ob-data/haven-test/state` 挂载为两服务 `/state`，`/srv/ob-data/haven-test/config` 挂载为 `/config`；Gateway 首次初始化基础 `config.yaml`，Brain 只读该目录。镜像原有 `/app/buckets` 匿名 volume 仍会出现，但运行时已由 `OMBRE_BUCKETS_DIR=/data` 明确使用 VPS bind mount。
- 基础启动验收通过：Coolify 显示 `Running / Healthy`，两个容器均 healthy；Brain 容器内 `127.0.0.1:8000/health` 返回 200，Brain 通过内部服务名访问 `haven-gateway:8010/health` 返回 200。`docker ps` 未出现 `0.0.0.0:host->container` 映射，镜像显示的 `8080/tcp` 仅为 `EXPOSE` 元数据。
- 本窗口没有把预迁移归档导入测试栈，没有配置正式 secret、没有接入 Dashboard/MCP、没有真实业务写入、没有切流量。Zeabur service、volume、环境变量、域名、续费和后台任务均未修改，Zeabur 继续 Running；仅在其容器 `/tmp` 生成了本次私密导出的临时文件。
- 准入结论：已具备进入第二阶段窗口 3 的基础设施条件。窗口 3 只做预迁移、checksum/SQLite/数量校验和只读联调；仍不得执行最终停写、最终导入、真实写入、Dashboard URL/MCP 切换、备份恢复演练或 Zeabur 退场。

#### 第二阶段窗口 3 完成记录（2026-08-17）

- 开始前由用户人工确认：Coolify `haven-test-stack` 为 `Running / Healthy`，Dashboard 正常，Zeabur 为 `Running` 且现有 Haven/MCP 正常；本窗口没有启用 Coolify Metrics。用户确认操作范围后，只临时停止并重启测试栈容器，没有停止或修改 Zeabur，也没有修改正式 Dashboard Haven URL/MCP、切流量或产生正式新增数据。
- 两份预迁移归档上传前后均按大小、SHA-256 和 tar 可读性复核一致：buckets 为 `30,837,530 bytes`、`34645c47091c0c86feee6d87817f75bb2828565933189323880af95713c39cd8`；state 为 `25,997,375 bytes`、`2650a9489a08e0f185032c08e043f946b846001044fc46effb5f7090b0272cf6`。只导入 `/srv/ob-data/haven-test/buckets` 与 `/srv/ob-data/haven-test/state`，没有触碰其他 `/srv/ob-data` 路径，`/srv/ob-data/haven-test/config` 未覆盖；目录层级正确，没有额外套一层目录。导入与校验完成后已删除 VPS `/tmp/haven-window3-pre` 中的临时上传件，避免窗口 4 误用；用户本机原始归档未删除。
- 覆盖前已保存空测试栈快照 `/tmp/haven-window3-empty-stack-20260817.tar.gz`，大小 `10,428 bytes`、SHA-256 `75ce271407d2dbf03a8e142ccf76cf0b54fd300864fc017851dbe06ba4dbda86`。测试副本禁写控制前的 `automations.sqlite` 与 `config.runtime.yaml` 备份保存在 `/tmp/haven-window3-prestart-controls-20260817/`；启动前后无正文清单分别保存在 `/tmp/haven-window3-prestart-manifest.json` 与 `/tmp/haven-window3-poststart-manifest.json`。
- 导入后 buckets 共 `334` 个文件、`70,831,132 bytes`；顶层仍为 `archive/`、`cc-attachments/`、`dynamic/`、`feel/`、`journal/`、`permanent/`、`trash/` 以及根级索引/状态文件。`/state` 仍有 10 个 SQLite/DB；启动前后逐库 `PRAGMA integrity_check` 全部为 `ok`，关键状态文件 `config.runtime.yaml`、`daily_chat_memory_candidates.json`、`gateway_config.json`、`portrait_state.json` 均存在。本窗口只比较文件数量、大小、哈希、表记录数和字段名，没有输出数据库正文或私人记忆正文。
- 为防止测试副本产生定时写入，已仅在测试副本中禁用 `daily_review`、`weekly_journey` schedule 并清空其 next-run/lease；同时将 `daily_review.enabled`、`dream.auto_enabled`、`portrait.auto_enabled`、`portrait.daily_enabled`、`word_map.daily_rebuild_enabled` 设为 `false`。重启后复查两项 schedule 仍 inactive、五项开关仍为 false，`automations.sqlite` integrity 为 `ok`；`.env` 仅检查是否存在相关覆盖键，没有显示内容。
- Gateway 先启动并 healthy，Brain 后启动并 healthy；最终两容器均 `running/healthy`、restart `0`、OOM `false`。两服务的 `/data`、`/state`、`/config` 仍分别绑定到 `/srv/ob-data/haven-test/buckets`、`state`、`config`，没有宿主机端口映射。Brain `/health`、Gateway `/health`、Brain 容器内 `127.0.0.1:8000`、Gateway 容器内 `127.0.0.1:8010`、Brain 到 `http://haven-gateway:8010/health` 均返回 `200`。
- MCP streamable HTTP 初始化和工具清单通过，共 23 个工具；只调用了只读 `list_buckets_light(include_archive=true, limit=1, offset=0)`，成功返回逻辑 bucket 总数 `300`，没有输出 bucket 名称或正文。没有调用任何写工具、真实聊天、自动生成、配置保存或测试记忆新增。
- 测试栈未配置 `OMBRE_DASHBOARD_PASSWORD`，因此 Brain `/api/status`、`/api/config`、`/api/buckets` 返回 `401`；Gateway 未配置测试用 token，因此 Brain 访问 Gateway `/api/config` 返回 `503`。这些是缺少测试认证配置，不是内部 DNS/端口故障。Dashboard 与测试栈当前不共享 Docker network；没有为临时探测连接网络，也没有修改正式 Dashboard 配置，所以本窗口没有完成 Dashboard→测试 Haven 的应用级只读联调。正式 Dashboard→Zeabur Haven/MCP 在开始前仍由用户人工确认正常。
- 启动前后对比显示：bucket 数量、总字节和 tree hash 完全不变，关键状态文件 hash 不变，10 库表记录数不变；只有 `memory_moments.sqlite` 的大小/hash 变化。脱敏逐表核对确认没有新增或删除记录，变化只包括 43 条 edge 的 `created_at`、220 条 moment 的 `updated_at` 与容器路径元数据、954 条 alias 的 `updated_at`。代码定位表明 Gateway `lifespan` 每次启动都会执行 `warm_recall_runtime()`，根据未变 bucket 等量重建派生检索索引；这是测试副本启动预热写入，不是后台日/周任务、写工具或正式记忆新增，但最终导入后 checksum 验收必须区分源数据与可重建派生索引。
- 准入结论：数据导入、SQLite 一致性、持久挂载、内部网络、health、重启读取和 MCP 只读链路已具备进入第二阶段窗口 4 的数据基础；但不代表可以立即切流量或承接真实写入。窗口 4 开始时必须先明确测试/正式认证 secret 的配置方式，完成 Gateway 与 Dashboard 的认证只读预检，并把 Gateway 启动预热会改写 `memory_moments.sqlite` 纳入最终停写后的 checksum/验收顺序。窗口 4 仍必须重新停止 Zeabur 写入后导出最终切换副本，不能复用本窗口的预迁移副本。

#### 第二阶段窗口 4 完成记录（2026-08-17 至 2026-08-21）

- 开始前由用户人工确认：Coolify `haven-test-stack` 的 Brain/Gateway 均正常，Dashboard 正常，Zeabur 为 Running 且现有 Haven/MCP 正常。
- 认证键名与配置位置已只读核对且未显示任何值：Dashboard 以 `HAVEN_GATEWAY_URL + OMBRE_SESSION` 登录 Brain，Brain 侧对应 `OMBRE_DASHBOARD_PASSWORD`；Dashboard/Brain/Gateway 共用同一 `OMBRE_GATEWAY_TOKEN` 完成 Gateway Bearer 认证；Brain 通过 `OMBRE_GATEWAY_ADMIN_URL=http://haven-gateway:8010/api/config` 访问 Gateway；Gateway upstream key 与上述两类认证隔离。
- 用户只在 Coolify `haven-test-stack` 配置了 `OMBRE_DASHBOARD_PASSWORD` 与 `OMBRE_GATEWAY_TOKEN`，随后 Restart；Brain/Gateway 恢复 Healthy。没有配置或调用 Gateway upstream，没有显示 secret。
- Dashboard 容器 `rbkzmxmi9wyauoxacw6lcwjq-233411658282` 曾临时连接 `haven-test-internal`。从该正式 Dashboard 容器使用现有服务端凭据验证测试 Brain `/health`、Brain `/auth/login`、登录后 `/api/status`、Gateway `/api/config` 均返回 200；MCP streamable HTTP initialize/listTools 成功，工具数仍为 23。没有调用任何 MCP 工具、真实聊天、自动生成、配置保存或新增测试记忆。
- 认证预检结束后已将 Dashboard 容器从 `haven-test-internal` 断开；用户再次确认 Dashboard、Zeabur Haven 与 MCP 均正常。Dashboard 正式 `HAVEN_GATEWAY_URL` 未修改，Zeabur 正式写入和后台任务仍在继续，VPS 数据未覆盖。
- Secret 边界补充：当前 `compose.coolify.test.yml` 仍把 `OMBRE_GATEWAY_UPSTREAM_API_KEY` 变量引用同时放在 Gateway 与 Brain environment 中，但 Brain 代码不使用该变量。认证预检未配置它；最终启用 upstream 前应限制为仅 Gateway 可见，不得交给 Brain 或 Dashboard。
- 已向用户列出第二确认点的高风险范围：Zeabur 逻辑停写与两次静止清单、`/tmp/haven-window4-final-20260821/` 最终导出、10 个 SQLite `sqlite3.backup()` + integrity、VPS 覆盖前 `/tmp/haven-window4-vps-pre-final-20260821.tar.gz` 快照、只覆盖 `/srv/ob-data/haven-test/buckets` 与 `state`、启动前后派生索引规则及 rollback。该路径最初沿用窗口开始日误写为 `20260817`，在下载前已统一更正为实际最终导出日 `20260821`；归档内容与 SHA 未改变。
- 当前安全状态：最终停写、最终导出、最终导入、VPS 覆盖、Dashboard 切换和真实写入均未开始；窗口 3 预迁移副本仍不得作为最终副本。下一窗口应先重新人工确认三项运行状态，再复述并取得第二确认点后才执行最终迁移。
- 2026-08-20 恢复推进时，用户重新人工确认 Coolify Haven、sslip Dashboard、Zeabur Haven/MCP 均正常，8 月 17 日后除已记录的测试栈两个认证变量外，没有修改 Haven/Coolify 环境变量、挂载或 Compose。期间误打开旧 Vercel Dashboard 出现“暂未开放”，确认并非当前 VPS sslip Dashboard 故障，未因此修改任何配置。
- 运行容器只读核对显示：测试 Gateway 与 Brain 的 `OMBRE_GATEWAY_UPSTREAM_API_KEY` 当前均为 absent/False。用户决定不在最终数据迁移前同步该 key，改为 Dashboard 正式切换前自行重新填写；在此之前不得做真实聊天验收。填写时仍须保证 upstream key 只进入 Gateway，不进入 Brain/Dashboard。
- 用户已于 2026-08-20 明确回复“确认最终迁移”，第二确认点已经通过；但因本窗口上下文已使用约 71%，为避免在停写、导出、覆盖或校验中途压缩丢失逐项数字，本窗口仍未执行任何最终停写或迁移动作。下一窗口可直接从 Zeabur 逻辑停写开始，无需重复窗口 1–3 或认证预检；执行中必须把每个阶段的清单、checksum、integrity 和 rollback 路径即时追加到本 handoff 或保存为无正文落盘清单。
- 2026-08-20 窗口 4 最终停写阶段 1A 已完成：用户已停止一切 Haven/Dashboard 写操作；Zeabur `/app/state/automations.sqlite` 中 `daily_review`、`weekly_journey` 两条 schedule 均已设为 `enabled=0`，并清空 `next_run_at`、`lease_owner`、`lease_until`。运行配置已确认 `reflection.legacy_daily_memory_paused=true`、`reflection.auto_enabled=false`、`reflection.daily_enabled=false`、`reflection.daily_chat_memory_mode=off`、`daily_review.enabled=false`、`dream.auto_enabled=false`、`portrait.auto_enabled=false`、`portrait.daily_enabled=false`、`word_map.daily_rebuild_enabled=false`。`automations.sqlite` `PRAGMA integrity_check=ok`。修改前控制项回滚包当前名称为 Zeabur `/tmp/haven-window4-zeabur-controls-before-20260821.tar.gz`，大小 `12,325 bytes`，SHA-256 `d9695d440733bc7f5eb83240aedde82a67c83b2fb2e7f0ab58d01dd1a2a2d396`。
- 为保证 Restart 后仍可回滚，控制项回滚包已复制到 Zeabur 持久卷，当前路径 `/app/state/.migration-rollback/haven-window4-zeabur-controls-before-20260821.tar.gz`；大小仍为 `12,325 bytes`，SHA-256 仍为 `d9695d440733bc7f5eb83240aedde82a67c83b2fb2e7f0ab58d01dd1a2a2d396`，复制后 checksum match 为 true。该 `.migration-rollback/` 仅为本次迁移控制项回滚材料，生成最终 state 副本时已明确排除，不得导入 VPS 正式 state。
- Zeabur Restart 后已恢复 Running，阶段 1 第一次无正文静止清单已保存到持久路径 `/app/state/.migration-rollback/window4-stop-manifest-1.json`，manifest SHA-256 `bd465d97b09ec0774fcc9d4a89655dec12ff587ff5b1d357cf7712af516e86fb`。Restart 后两条 schedule 仍为 disabled 且 next-run/lease 为空，九项禁写配置仍保持预期值。Buckets 基线为 `335 files / 70,832,206 bytes / tree SHA-256 b8aa447c116b7b517905f10cf01b7c7ad429525b37d38cbe923b6055ac679fec`；排除 SQLite/WAL/SHM 与 `.migration-rollback` 后的 state 非数据库基线为 `10 files / 43,048,307 bytes / tree SHA-256 6c337c4b2de5eb3dcd68a2d619bdf77e318606a55d31bb43026b43e8ad40a625`。10 个 SQLite 一致备份均 `PRAGMA integrity_check=ok`；SHA-256 分别为：`automations.sqlite ecdd219d83f237416d554289aef80f6a5366c608e173b104630da37cf1b2a5d4`、`identity_semantics.sqlite 16b2e329d91813daa05ede17e773a06d8f423e2083a07956fc3f2d53aca0b6db`、`memory_moments.sqlite f39d21507100078b1097a70883e026fe5c17120dd100a83b5791949fef64b8a7`、`memory_nodes.sqlite 1145d047a244dee54378776d8d4fa38cd91ed9472b3fd4a9e3951fa9ef1b3d8d`、`persona_state.db a022ff477e65070b8c4e473de4635fbdecbbcb7a311cfe5a079f75fc7af87150`、`prompt_overrides.sqlite 7e690a192cf5d06926bd2bd16cf0a0e20b4f4f5709da2fb1d08af632ba2a7cc1`、`raw_events.sqlite f7d7cca89895b4515dac6d879e46de1168c385ace63836205cda7ddffc8da536`、`reminders.sqlite 8b24b1b3905b1f69c10e65bf644df837a72d975be2bb524b238ac9308a282f46`、`todos.sqlite 0e8002ba70125cfe7bf59d569eff988ec8b4b284a0365c22d8d8478a0b11248d`、`word_map.sqlite 28a851e30b018e4f0246147e14bc32876e01cf919dcf6ca92839c418ad481e99`。逐表记录数保存在该 manifest 中且不含正文；尚待第二次静止清单逐项比较。
- 阶段 1 第二次无正文静止清单已保存到 `/app/state/.migration-rollback/window4-stop-manifest-2.json`，SHA-256 `5ab5c685f2eb3c09aed608cd64f2cc76f7f7031eb149e2b3277c7815d336d5e9`；初版比较文件为 `/app/state/.migration-rollback/window4-stop-comparison.json`，SHA-256 `338b183d99b9ae5af51184abd19adfae4b2b487e034b7e39e73c42057977f3d2`。两次 buckets 总清单一致、排除控制目录/SQLite/WAL/SHM 的 state 非数据库清单一致；10 个 SQLite 的一致备份大小、SHA-256、`integrity_check=ok` 和逐表记录数均逐库一致。初版比较唯一显示 `controls_match=false`，已定位为比较脚本把第一次 JSON 反序列化后的 schedule `list` 与第二次尚在内存中的 SQLite row `tuple` 直接比较造成的类型假阴性；`automations.sqlite` SHA 与非数据库 state tree SHA 均一致，实际控制数据没有变化。需生成规范化比较文件后再正式判定 `all_static=true`。
- 规范化比较已完成并保存到 `/app/state/.migration-rollback/window4-stop-comparison-normalized.json`，SHA-256 `ae840d48dc0bff8865209ec53f6b3d05b0ebfd718c88e636d2bbc27ca6bdd168`；结果为 `buckets_match=true`、`state_non_sqlite_match=true`、`controls_match=true`、`all_databases_match=true`、`all_static=true`。因此 Zeabur 逻辑停写和两次安全清单阶段已正式通过；从此清单起源数据视为冻结，仍禁止 Haven/Dashboard/MCP/聊天的任何写操作。
- 阶段 2 最终副本当前位于 Zeabur `/tmp/haven-window4-final-20260821/`，manifest 为 `/tmp/haven-window4-final-20260821/final-export-manifest.json`，改名后 SHA-256 `6bdda0ac4bb2e1bb74406002521e1e26d8dbe2d4233ebdb14060f09bbe89c20f`。Buckets 归档 `/tmp/haven-window4-final-20260821/haven-buckets-final-20260821.tar.gz`：`30,755,294 bytes`，SHA-256 `c69e116b9ef36e9e83c5b9697f105cd9ef79375846f9cd5f3ac59f74cbc357f2`，改名后 checksum 未变且 tar 可读，`335` 个文件成员、解压文件总字节 `70,832,206`。State 归档 `/tmp/haven-window4-final-20260821/haven-state-final-20260821.tar.gz`：`25,962,790 bytes`，SHA-256 `2fcad4adda86f1f8f9542bfe293b2994961c96cc6857f9271935c1f7c1685731`，改名后 checksum 未变且 tar 可读，`20` 个文件成员、解压文件总字节 `89,533,811`；非 SQLite tree 与冻结源一致，10 个 SQLite 均以 `sqlite3.backup()` 生成并逐库匹配冻结 checksum/integrity/记录数。`.migration-rollback`、SQLite WAL/SHM 均已排除。
- 最终归档分片当前位于 `/tmp/haven-window4-final-20260821/download-parts/`，分片清单 `/tmp/haven-window4-final-20260821/download-parts-manifest.json`，改名后 SHA-256 `b91c5c987a0d7205ca191a8cec6f73a638c360ebbc5cc5050c44721026040f63`。Buckets 6 片、State 5 片，11 片均在改名后重新通过原大小和原 SHA 校验；两份原归档 SHA 未变化。最终目录和两个 manifest 中均无 `20260817` 名称或文本残留。尚未下载到本机、上传 VPS、保存 VPS 覆盖前快照或覆盖任何目录。
- 阶段 3 下载与本机合并校验已完成。Windows `C:\Users\yangh\Downloads` 中已确认 11 个 `20260821` 分片及 `download-parts-manifest.json`、`final-export-manifest.json` 共 13 个下载件，文件名无浏览器 `(1)` 重命名；两个 manifest SHA 分别精确匹配 Zeabur 的 `b91c5c987a0d7205ca191a8cec6f73a638c360ebbc5cc5050c44721026040f63` 与 `6bdda0ac4bb2e1bb74406002521e1e26d8dbe2d4233ebdb14060f09bbe89c20f`，11 个分片逐片大小与 SHA 全部匹配且无失败项。本机已合并生成 `C:\Users\yangh\Downloads\haven-buckets-final-20260821.tar.gz`（`30,755,294 bytes`，SHA-256 `c69e116b9ef36e9e83c5b9697f105cd9ef79375846f9cd5f3ac59f74cbc357f2`）与 `C:\Users\yangh\Downloads\haven-state-final-20260821.tar.gz`（`25,962,790 bytes`，SHA-256 `2fcad4adda86f1f8f9542bfe293b2994961c96cc6857f9271935c1f7c1685731`）；本机 tar 复核均可读，members 分别为 `364` 与 `26`，顶层分别仅为 `buckets` 与 `state`。用户已确认 8 月 17 日后没有未记录的环境变量、挂载或 Compose 修改，因此既有 Zeabur 项目 YAML/环境配置私密副本继续有效，无需重复下载。分片未删除；尚未上传 VPS、保存 VPS 覆盖前快照或覆盖任何目录。
- VPS 直传大归档首次尝试失败且已安全止步：目标仅为宿主机临时目录 `/tmp/haven-window4-final-20260821/`，没有停止测试栈、保存/覆盖 `/srv/ob-data` 或切换任何流量。远端只出现截断的 `haven-buckets-final-20260821.tar.gz`，实际 `12,156,928 bytes`、SHA-256 `5a338833940c084c73eaf13118d7d18aaf9b8fcafb3e27854bc06556d09bb51d`，tar 检查报 gzip EOF；state tar 与两个 manifest 均未到达。该失败件不是有效副本。fallback 固定为在同一临时目录的新 `download-parts/` 子目录逐个上传已在本机验证的 11 个 5 MiB 分片，再在 VPS 合并到新临时文件、核对大小/SHA/tar 后替换失败件；正式数据和 rollback 状态仍未改变。
- 阶段 4 VPS 上传最终完成：最初的大文件 `scp` 实际仍在后台继续，安全脚本因目标状态变化拒绝替换；等待该单一传输自然结束后再验收，没有并发覆盖。VPS `/tmp/haven-window4-final-20260821/` 中 buckets tar、state tar、两个 manifest 均与 Zeabur/本机原件大小和 SHA 完全一致；buckets/state tar 分别为 `364/26` members、顶层仅 `buckets/state`，tar 可读且所有成员路径安全。备用 `download-parts/` 中 11 个分片集合完整，逐片大小和 SHA 全部匹配。无正文上传验证清单保存为 `/tmp/haven-window4-final-20260821/vps-upload-verification.json`，SHA-256 `1f5564e4d2c92c1680a2334ad43a8e91a3d25ce1f29298e348fb67bda2e5b61d`，`all_upload_checks_passed=true`。失败截断件已被后续完成的同一原始传输写成正确完整件，无残留错误 canonical tar；正式 `/srv/ob-data` 尚未覆盖，测试栈仍未停止，rollback 状态安全。
- 阶段 5 覆盖前保护已完成：通过 Compose service 标签识别实际容器 `haven-brain-5jhemgqroisbatkrbgbefueu`、`haven-gateway-5jhemgqroisbatkrbgbefueu`，确认 `/data`、`/state`、`/config` 挂载仍分别指向 `/srv/ob-data/haven-test/buckets`、`state`、`config`；按 Brain 后 Gateway 顺序停止，两容器均为 `exited/running=false`。覆盖前快照 `/tmp/haven-window4-vps-pre-final-20260821.tar.gz` 已生成：`56,715,944 bytes`，SHA-256 `9b600ff9c8a625d5df2c0b9a7ebdf6f5227ebd1c9b545c2c056a82a0bad70f68`，tar 可读、`389` members、顶层仅 `buckets/state`、路径安全。快照 manifest `/tmp/haven-window4-vps-pre-final-20260821-manifest.json`，SHA-256 `322ca82a288815b84e48c55c056577047da2c30bf840035b7188b6b5268e1ffc`。旧 VPS buckets 为 `334 files / 70,831,132 bytes / tree SHA-256 2034897c578665964258dc3bfa131a3a1fd96dd21e4ec6c90e4bb5f5c8e7ab58`；旧 state 为 `20 files / 89,587,023 bytes / tree SHA-256 71063b22ddba802cb58d3ff345c9a39bf22527c8d44d1a3b0d374f8e0f547cc2`；10 个 SQLite/DB 均 `integrity_check=ok`，逐库 checksum 与记录数完整保存在 manifest，`rollback_ready=true`。尚未覆盖 buckets/state，`config` 未动，Zeabur 仍保持逻辑停写和 Running。
- 阶段 6 正式离线导入已完成：在容器停止状态下先解压到 `/srv/ob-data/haven-test/.window4-incoming-20260821` 并按最终 manifest 校验，随后以目录级换位只替换 `/srv/ob-data/haven-test/buckets` 与 `state`；`config` 未修改。换位前 incoming 与换位后正式目标均为 buckets `335 files / 70,832,206 bytes / tree SHA-256 b8aa447c116b7b517905f10cf01b7c7ad429525b37d38cbe923b6055ac679fec`，state 非 SQLite `10 files / 43,048,307 bytes / tree SHA-256 6c337c4b2de5eb3dcd68a2d619bdf77e318606a55d31bb43026b43e8ad40a625`；10 个 SQLite/DB 的大小、SHA、逐表记录数与最终冻结源逐库完全一致，全部 `integrity_check=ok`。离线导入 manifest `/tmp/haven-window4-final-20260821/vps-offline-import-manifest.json`，SHA-256 `3e9a6ed31127f067de71efe4f61fcf604e77f5bb301f814f94c14a5ecdcd8563`，`offline_import_complete=true`。旧 VPS 目录未删除，保存在 `/srv/ob-data/haven-test/.window4-pre-final-live-20260821/{buckets,state}`；同时保留 `/tmp/haven-window4-vps-pre-final-20260821.tar.gz`，`rollback_ready=true`。两个容器仍停止，尚未启动、切 Dashboard 或产生真实写入。
- 阶段 7 后台禁写与启动前清单已完成：最终 state 中两条 schedule 已是 `enabled=0` 且 next-run/lease 为空，九项运行开关全部为预期禁写值，`.env` 未发现 `OMBRE_DREAM_ENABLED` 阻塞覆盖键；幂等复核结果 `controls_changes_needed=false`、`controls_changes_applied=false`、`controls_ok=true`，因此没有改动最终副本任何字节。启动前 buckets 仍为 `335 files / 70,832,206 bytes / tree SHA-256 b8aa447c116b7b517905f10cf01b7c7ad429525b37d38cbe923b6055ac679fec`，state 非 SQLite tree 仍为 `6c337c4b2de5eb3dcd68a2d619bdf77e318606a55d31bb43026b43e8ad40a625`，10 个 SQLite/DB SHA 与冻结源完全一致且全部 `integrity_check=ok`。启动前 manifest `/tmp/haven-window4-final-20260821/vps-prestart-manifest.json`，SHA-256 `bcfccb7f0118c8c135b58ea0115c1876f4517c4519643e4b8d5fad76cf78b7d5`。两个容器仍停止；即时目录回滚与 tar 快照均保留。
- 阶段 8 启动与启动后验收已完成：严格按 Gateway 后 Brain 顺序启动；两容器均 `running/healthy`、restart `0`、OOM `false`。Gateway 容器内 `127.0.0.1:8010/health`、Brain 容器内 `127.0.0.1:8000/health`、Brain 到 `http://haven-gateway:8010/health` 均返回 HTTP 200；挂载仍准确指向 `/srv/ob-data/haven-test/{buckets,state,config}`，Brain 的 `/config` 只读、Gateway 的 `/config` 可写，两容器均无宿主机端口发布。启动后 buckets 与启动前逐字节一致，state 非 SQLite tree 逐字节一致，`automations.sqlite` 等其余 9 个数据库逐字节一致且 10 库 integrity 均为 `ok`；只有 `memory_moments.sqlite` 从 `1,495,040 bytes / f39d...` 变为 `1,548,288 bytes / f42b00bc822d7748a001864304a0eabd5fe41fd6e9682e4c3fade0f553ac4976`，三张表记录数不变且无新增/删除主键。脱敏差异：`memory_moment_edges` 43 行只变 `created_at`；`memory_moments` 220 行只变 `updated_at` 与 `metadata_json`，后者 JSON 内仅 `bucket_path` 220 行、`source_ref.path` 216 行变化；`memory_retrieval_aliases` 954 行只变 `updated_at`，符合已知启动预热派生索引规则，无正文/业务字段变化。原始清单 `/tmp/haven-window4-final-20260821/vps-poststart-raw-manifest.json` SHA `4fcdf41f3b191236d02e1fb2629a8b5aec67786246d1a8a7e3645d267adc81e2`；逐表差异清单 SHA `7b03ac47a3608d58326445b7cee2416a2461de25d74ca62ad644d7a2f5adcb4c`；metadata 键差异清单 SHA `12858912802799663e86ef387a80750e3da1fb5bc352087125f37665e6c075f3`；最终启动后 manifest `/tmp/haven-window4-final-20260821/vps-poststart-manifest.json`，SHA `06eccfb0fcfb4f17bd2946deb09187d104241c6d8e60cc75df4df29e878ebc3a`，`poststart_ready=true`。即时目录回滚与 tar 快照仍保留；Zeabur 仍 Running 且逻辑停写。Dashboard 仍连接 Zeabur，尚未正式切换、尚未真实聊天或写入。
- 2026-08-21 用户已明确回复“确认 Dashboard 正式切换”，Dashboard 切换的独立确认点已通过。授权范围仅包括：把 upstream key 的可见范围限制为 Gateway、将 Dashboard 持久接入 `haven-test-internal`、把 Dashboard Haven 地址切到 VPS Brain、redeploy 后做只读验收，并在 upstream key 边界复核通过后执行一次受控真实聊天/写入验收。仍不删除或取消 Zeabur、不清理任何回滚材料、不做窗口 5、不 commit、不 push。
- Dashboard 切换阶段 9A 的 upstream 边界核对：用户已在 Coolify Compose 的 `haven-brain.environment` 中删除 `OMBRE_GATEWAY_UPSTREAM_API_KEY` 引用，Compose Validate 显示 success 并已保存；尚未 redeploy。进一步只读核对纠正了此前“必须重新填写该变量”的假设：最终 state 的 `gateway_config.json` 已迁移 6 个具名中转站配置，真实密钥通过各自的私密环境项加载；运行中 Gateway `/api/config` 脱敏状态显示 6 个中转站均 `key_count=1`、`ready=true`。当前 Gateway/Brain 容器中的旧版单上游兜底变量 `OMBRE_GATEWAY_UPSTREAM_API_KEY` 均为空；它不承载现行 6 个中转站，不需要从 Zeabur 复制旧值，也不需要填写 OpenAI 官方 key。下一步只需 redeploy Haven stack，让 Brain 不再收到该空变量名，再复核 Gateway 仍为 6/6 ready、Brain 中变量 absent、两服务 healthy；不得修改或显示各中转站密钥。
- 阶段 9A 最终结果：Coolify `Restart` 已按保存后的 Compose 重建 Haven 两容器，创建时间更新且 Gateway/Brain 均 `running/healthy`、restart `0`、OOM `false`；两条 schedule、九项禁写控制及 `automations.sqlite integrity=ok` 均保持。实际生成 Compose `/data/coolify/services/5jhemgqroisbatkrbgbefueu/docker-compose.yml` 中 `OMBRE_GATEWAY_UPSTREAM_API_KEY` 只由 `haven-gateway` 引用；Brain 运行环境中虽仍可见镜像自带的同名空占位，但值为空、Compose 未注入、Brain 代码不使用，故没有 secret 泄露。6 个具名中转站仍全部 `key_count=1/ready=true`。过严的初版清单 `/tmp/haven-window4-final-20260821/dashboard-cutover-haven-boundary.json` 保留作调查轨迹；最终边界清单 `/tmp/haven-window4-final-20260821/dashboard-cutover-haven-boundary-final.json`，SHA-256 `0a24cca9f5ab748bf62da4610595fc028ccaf25229a93f708c8e1ec14cf611f5`，`compose_boundary_ok=true`、`brain_has_no_upstream_secret=true`、`all_6_upstreams_ready=true`、`boundary_ready=true`。Dashboard 仍连接 Zeabur且仅在 `coolify` 网络，尚未切地址或产生真实写入。
- 阶段 9B 持久内网已完成：按 Coolify 官方跨资源网络方式，将 `haven-test-stack` 的 Network attachment 从 `Use the stack network only` 改为 `Connect to the predefined Coolify network`，保存后 Restart；Gateway/Brain 均恢复 `running/healthy`，同时保留原 stack network 与 `haven-test-internal`，并新增共享 `coolify` 网络。Dashboard 原本就在 `coolify` 网络，无需临时 `docker network connect`。从正式 Dashboard 容器只读访问 `http://haven-brain-5jhemgqroisbatkrbgbefueu:8000/health` 返回 200；短名 `haven-brain` 在共享网络上为 ENOTFOUND，因此 Dashboard 正式 `HAVEN_GATEWAY_URL` 必须使用带固定服务 UUID 的内部名，不能沿用短名。Haven 两容器仍无宿主机 published ports。无正文网络清单 `/tmp/haven-window4-final-20260821/dashboard-cutover-network.json`，SHA-256 `a9a99f4c087be0c6255d39c0f8b06129b6045816d753107f9d7c0839fdfadbbc`，`network_ready=true`。Dashboard 尚未修改 URL 或 redeploy，仍连接 Zeabur，rollback 仍为恢复原 Zeabur URL 后 redeploy。
- 阶段 9C Dashboard 切换前 rollback 已保存：`/tmp/haven-window4-final-20260821/dashboard-pre-cutover-rollback.json`，SHA-256 `844ddf55d481ad4414afdb0ec3eeea2305940b814edbafd82b2376493016e18f`。清单记录当前 Dashboard `running/healthy`、仍在 `coolify` 网络、`HAVEN_GATEWAY_URL` 为 Zeabur 地址、`OMBRE_SESSION` 与 `OMBRE_GATEWAY_TOKEN` 均已配置（仅布尔值，不记录 secret），`rollback_ready=true`。回滚操作为把 Coolify Dashboard 的 `HAVEN_GATEWAY_URL` 恢复为该清单中的原 Zeabur URL并 Restart。当前尚未修改 URL。
- 阶段 9C Dashboard 正式 URL 切换与服务器端只读验收已完成：Coolify Production `HAVEN_GATEWAY_URL` 已改为 `http://haven-brain-5jhemgqroisbatkrbgbefueu:8000`，因页面显示 Changes pending，使用普通 `Redeploy`（非 without cache）应用。新 Dashboard 容器 `rbkzmxmi9wyauoxacw6lcwjq-173141177433` 为 `running/healthy`、restart `0`、OOM `false`，仅在共享 `coolify` 网络。Dashboard 容器运行时 URL 已确认是 VPS 内网；从容器执行的只读链路：Brain `/health`、`/auth/login`、登录后 `/api/status`、`/api/config`、`/api/buckets`、Brain 兼容 Gateway `/gateway/api/config`、MCP initialize、MCP `tools/list` 均 HTTP 200，工具数 `23`。未调用任何 MCP 工具、未访问上游模型、未产生聊天或业务写入。无正文清单 `/tmp/haven-window4-final-20260821/dashboard-post-cutover-readonly.json`，SHA-256 `91c8f57593d9235efb900c758f5a35ddb583bd6c4e649423169329de3a045de2`，`readonly_ready=true`。下一步为用户浏览器端只读页面验收；通过前不做真实聊天。
- 用户浏览器端第一项只读验收通过：sslip Dashboard 可正常登录，Haven 页面正常，迁移前原数据可见，没有“未开放”、连接失败或空白错误。未新增、编辑或聊天。下一步只读查看既有会话、Persona、Gateway 具名中转站列表与 MCP 23 工具清单；不得保存配置、调用工具或发送消息。
- 用户浏览器端第二组只读验收通过：原有会话可正常打开，Persona 原状态存在，Gateway 原 6 个具名中转站可见，MCP 23 个工具可见。没有发送消息、保存配置或调用工具。服务器端与浏览器端只读验收均已完成；下一步先保存真实写入前无正文基线，再执行窗口 4 唯一一次受控真实聊天/写入。真实写入发生后不得盲目把 Dashboard 切回旧 Zeabur，否则会丢失 VPS 新增数据。
- 真实写入前基线已保存到 `/tmp/haven-window4-final-20260821/dashboard-real-write-before.json`，SHA-256 `eb0fb60096c2917e624fe03ede2301af95e29a80006ae6399af0f79364a5b7ca`。Buckets 为 `335 files / 70,832,206 bytes / tree SHA-256 b8aa447c116b7b517905f10cf01b7c7ad429525b37d38cbe923b6055ac679fec`；state 非 SQLite 为 `10 files / 43,048,307 bytes / tree SHA-256 6c337c4b2de5eb3dcd68a2d619bdf77e318606a55d31bb43026b43e8ad40a625`；10 个 SQLite/DB 全部 `integrity_check=ok`，逐库 checksum 与逐表记录数保存在清单中且不含正文。Zeabur 仍 Running 且逻辑停写，VPS pre-final tar、旧 live dirs 和 Dashboard 切换前 rollback manifest 均存在；一旦下一步产生 VPS 新写入，`blind_return_to_zeabur_allowed_after_write=false`。
- 第一次受控聊天尝试未形成 Haven 写入：因操作指引误让用户在一个迁移前原会话中发送，该会话仍保存本机 Windows 工作区路径，Dashboard CC 引擎在 VPS 上 `realpath` 该路径时返回 HTTP 500。脱敏日志原因明确为“VPS 容器内不存在旧 Windows 工作区路径”，不是 Haven 内网、中转站或数据错误；与真实写入前基线比较，10 个 Haven 数据库无任何 checksum/表记录数差异，失败轮次未落库，仍可从原基线继续。诊断清单 `/tmp/haven-window4-final-20260821/dashboard-real-write-failed-old-workspace.json`，SHA-256 `15d0d31d0faf8634da8a13039ad14cfdf184173afd1af5ff5e40f98e8dd6414b`。Dashboard 容器有效工作区挂载为 `/workspace/dashboard` 与 `/workspace/haven`；下一次只能新建 CC 会话并选择其中一个有效 VPS 工作区，不得重试旧会话。
- 为修复旧 Windows 路径，用户已把当前协作者的读目录 `dirs` 与写目录 `write_dirs` 都改为且仅为 `/workspace/dashboard`、`/workspace/haven`。该必要配置写入只改变 buckets 中 `gateway_state.db`：与最终归档逐文件比较，其他 334 个 bucket 文件完全不变，state 非 SQLite 文件完全不变；运行中出现的 6 个 `-wal/-shm` 是 SQLite sidecar，已从非数据库比较中排除。`gateway_state.db` 启动前后 integrity 均 `ok`；`cc_personas` 仍 2 行，其中 1 行仅更新 `dirs/write_dirs/updated_at`；界面操作另创建 2 个空 `conversation_sessions` 壳，`conversation_turns` 仍为 `1493`、新增 `0`，没有聊天正文落库。最终目录配置清单 `/tmp/haven-window4-final-20260821/dashboard-vps-read-write-dirs-final.json`，SHA-256 `4745a02e7a4022c9cdbe5b61ef2e4dc5712af18ae28b2b20414777c10006b56b`，`configuration_ready=true`；逐文件差异清单 SHA `698f60c7a8af92bf956612f4a36fdaf65a03fa8d8e7900a6ddd91ba294ad95fe`，列名级差异清单 SHA `b60984bfa4ddeaa3541afc844c85b33969d59fdee154445e93c9a4efad7411fb`。VPS 已产生配置写入，禁止盲目回切旧 Zeabur。
- 用户在新建空白 CC 会话、有效 VPS 目录及原有 api 中转站/模型下完成唯一一次受控真实聊天，正常收到完整回复。初版写入后清单因误把“一轮”设成必须新增 2 条 `conversation_turns` 而给出 `real_write_ready=false`；实际该表一行即一整轮，修正后验收通过。最终清单 `/tmp/haven-window4-final-20260821/dashboard-real-write-final.json`，SHA-256 `38adaee16ba118d962149609403ab211ad30f1ff79ee80a5a68f8b4803b4f86a`，8 秒复查数据库静止。与最终归档相比，buckets 无新增/删除文件且仅 `gateway_state.db` 变化，integrity `ok`；`conversation_sessions 121→124`（前述 2 个空壳 + 本次新会话）、`conversation_turns 1493→1494`（恰好 1 整轮）。10 个 state 数据库中仅 `persona_state.db` 按本轮写入变化且 integrity `ok`：`persona_events 485→486`、`persona_exchange_log 679→680`、`persona_session_state 103→104`；其余 9 库、state 非 SQLite、其他 334 个 bucket 文件不变，10 库 integrity 全部 `ok`。后台禁写控制保持，Gateway/Brain/Dashboard 均 healthy，`real_write_ready=true`。VPS 已含独有真实新增数据，任何 rollback 必须先导出/合并这段差异，严禁直接恢复 Dashboard Zeabur URL。
- Dashboard 普通 Restart 后，用户确认刚产生的新 CC 会话和完整回复仍可见，持久化验收通过。最终无正文清单 `/tmp/haven-window4-final-20260821/dashboard-persistence-after-restart.json`，SHA-256 `e8c9ab80d9ba752902f467080d9fe106ee6d2e2a8fa3d47e9a4ddae9097590f6`，`persistence_ready=true`。最终计数为 `cc_personas=2`、`conversation_sessions=124`、`conversation_turns=1494`、`persona_events=486`、`persona_exchange_log=680`、`persona_global_state=1`、`persona_session_state=104`；`gateway_state.db`、`persona_state.db` 及全部 10 个 state 数据库 integrity 均为 `ok`。两条 schedule 与九项后台禁写配置仍保持预期，Dashboard/Gateway/Brain 均 running/healthy、restart `0`、OOM `false`；运行时仍使用 VPS 内网 URL，Brain health、MCP initialize/list 均为 200，工具数 `23`。
- 按维护契约同步长期部署事实：`Ombre-Brain-Haven/compose.coolify.test.yml` 已移除 Brain 对旧式 `OMBRE_GATEWAY_UPSTREAM_API_KEY` 的环境变量引用，仅 Gateway 保留；`ENV_VARS.md` 与 `README.md` 已明确上游模型 secret 只能进入 Gateway，具名多中转站优先使用各自 `api_key_env`。`docker compose ... config --quiet` 已通过 Compose 语法校验；仅出现本机 Docker `config.json` 访问权限警告，不是 Compose 错误。未 commit、未 push。
- 2026-08-21 在窗口 4 完成后尝试为 VPS Brain 增加临时公网 MCP 域名：Coolify 自动生成 `ygao2jdgxlqzxfoasmjpvxcf.23.95.136.46.sslip.io`，服务选择 `haven-brain`、内部端口 `8000`、HTTPS、空 Path，并设为 `Noindex`。Restart 后 `/health` 正常，但不带 token 的标准 MCP initialize 请求仍返回 `200` 和 Ombre Brain `1.27.2` 初始化结果，证明当前 Brain `/mcp` 未启用公网认证；未调用 `tools/list` 或任何 MCP 工具。为避免裸开放，已立即删除该域名并普通 Restart，Gateway/Brain 均恢复 healthy；外部 `/health` 复查返回 `503`，公网入口已关闭。代码核对确认 `/mcp` 只在 `OMBRE_CHATGPT_OAUTH_CLIENT_ID + OMBRE_CHATGPT_OAUTH_ACCESS_TOKEN` 启用且 host 命中保护列表时要求 Bearer，`OMBRE_GATEWAY_TOKEN` 不保护 MCP。重新开放前必须使用独立 MCP token（不得复用 Gateway token），先验证无 token 为 `401`，再验证携带 token 的 initialize/tools list 为 23；Dashboard MCP 管理器支持自定义请求 Headers。该临时域名当前不得写入任何客户端。
- 用户随后明确最终用途是让 Claude App（含手机端）直接连接 Ombre Brain Remote MCP，而不只是 Dashboard/CC 在 Coolify 内网调用。Anthropic Remote MCP 从其云端访问公网地址，Claude App 自定义 Connector 应走 OAuth；不能用 Dashboard MCP 管理器的自定义 Header 方案代替。最终方案：先在域名关闭状态下为 Brain 注入 `OMBRE_CHATGPT_OAUTH_CLIENT_ID`、`OMBRE_CHATGPT_OAUTH_CLIENT_SECRET`、`OMBRE_CHATGPT_OAUTH_ACCESS_TOKEN`、`OMBRE_CHATGPT_OAUTH_REFRESH_TOKEN`、`OMBRE_CHATGPT_OAUTH_PUBLIC_BASE_URL`、`OMBRE_CHATGPT_OAUTH_PROTECTED_HOSTS`；client/access/refresh 三类凭据相互独立，保存在 Bitwarden，不在聊天、Git、handoff 或清单中记录真值。随后重启并重新添加同一 HTTPS sslip 域名，先验证无 token initialize 为 `401`，再通过 Claude 自定义 Connector 的 URL + Advanced OAuth Client ID/Secret 完成授权、确认 23 工具和手机同步。日常使用不需重复输入这些机器凭据。认证未通过前不得再次保留公网域名。
- 2026-08-21 用户已确认将 Claude App MCP OAuth 的 Client ID、独立 Client Secret、Access Token、Refresh Token、Public Base URL 与 Protected Host 保存至 Bitwarden；任何 secret 真值均未进入聊天、Git 或 handoff。仓库 `compose.coolify.test.yml` 已补充上述 6 个 Brain OAuth 环境变量引用，但没有写入真值。公网 Brain 域名仍处于删除状态，下一步只在 Coolify 保存这 6 个变量并重启内网服务，公网域名不得提前恢复。
- 2026-08-21 Coolify `haven-test-stack` 的在线 Compose 已成功保存上述 6 个 Brain OAuth 环境变量引用，且 6 个 Production 变量均已由用户从 Bitwarden/固定非秘密值分别保存；聊天与 handoff 未接触任何 secret 真值。此记录点公网 Brain 域名仍未恢复，服务尚待普通 Restart 载入变量。若 Restart 后任一容器不 healthy，保持公网关闭并按 Restart 前配置回退；不得带故障开放域名。
- 2026-08-21 用户已对 `haven-test-stack` 执行普通 Restart（未 pull latest），Haven Gateway 与 Haven Brain 均恢复 `Running (healthy)`；公网 Brain 域名仍未恢复。当前 rollback 是继续保持域名删除并移除/清空新增 OAuth 变量后普通 Restart；在完成容器内无正文变量存在性检查前不得开放域名。
- 2026-08-21 已在实际 Brain 容器 `haven-brain-5jhemgqroisbatkrbgbefueu` 中完成无正文 OAuth 变量检查：Client ID 为预定非秘密标识，Client Secret / Access Token / Refresh Token 均仅返回 `set=true`，Public Base URL 与 Protected Host 均命中预定 sslip 主机；未输出或落盘任何 secret。Gateway/Brain 当时均 healthy，公网域名仍删除。至此允许恢复同一临时 HTTPS 域名；恢复后必须立即验证无凭据 MCP initialize 为 `401`，否则立刻删除域名并普通 Restart。
- 2026-08-21 已恢复临时 HTTPS Brain 域名 `ygao2jdgxlqzxfoasmjpvxcf.23.95.136.46.sslip.io`，内部端口 `8000`、空 Path、`Noindex`，普通 Restart 后 Gateway/Brain 均 healthy。外部无凭据 MCP initialize 返回 `HTTP 401 Unauthorized`，`WWW-Authenticate: Bearer realm="Ombre Brain"`，且响应包含 `X-Robots-Tag: noindex, nofollow`；未执行 tools/list 或工具调用。公网 `/health` 返回 `200`，OAuth authorization-server metadata 返回 `200` 并声明 authorization_code / refresh_token，`/.well-known/oauth-protected-resource` 与 `/mcp/.well-known/oauth-protected-resource` 均返回 `200`。认证安全门与 OAuth 发现链路通过；下一步只在 Claude App 添加自定义 Connector 并完成授权。若 Claude 授权异常或无凭据请求不再为 401，立即删除域名并普通 Restart 回滚。
- 2026-08-21 用户已在 Claude 端完成新版 `Ombre Brain` 自定义 Connector 的 OAuth 连接，未在聊天中暴露 Client Secret。连接成功只确认授权链路完成；尚待确认 23 个工具可见、执行一次只读工具以及手机端同步。完成这些验收前不调用任何写入工具；失败时保留 VPS 主数据不动，可在 Claude 端 Disconnect/Remove 新 Connector，必要时删除临时 Brain 域名并普通 Restart 回滚。
- 2026-08-21 Claude App 已确认可使用新版 OAuth Connector。Dashboard 曾误用同一公网 OAuth URL，并因携带旧 token 返回 `invalid_token`；已按链路职责改回 Coolify 内网 MCP 地址 `http://haven-brain-5jhemgqroisbatkrbgbefueu:8000/mcp`，连接成功。最终分工固定为：Claude App 使用临时公网 HTTPS `/mcp` + OAuth，Dashboard 使用 Coolify 内网 `/mcp`，不得互换。`ENV_VARS.md` 与 `README.md` 已同步该长期部署事实；未记录任何 secret。公网回滚仍为删除 Brain 临时域名并普通 Restart，Dashboard 内网链路与 VPS 主数据不受影响。

### 15.3 数据迁移顺序

1. 对 Zeabur 做一次在线预备备份。
2. 在 VPS 用复制数据部署 Brain/Gateway 测试栈，不接正式写流量。
3. 校验 bucket 数量、SQLite integrity、关键配置和抽样数据。
4. 用只读/测试请求验证 Brain、Gateway、MCP、Dashboard。
5. 选择维护窗口，停止 Zeabur 后台任务和写入。
6. 做最终增量/最终完整导出。
7. 覆盖 VPS 测试数据前先快照，然后导入最终数据。
8. 再做 checksum、SQLite integrity、记录数和关键会话抽样。
9. 将 Dashboard 的 Haven URL/MCP 切到内部服务名并 redeploy。
10. 完成真实读写验收后才保持 VPS 为主。
11. Zeabur 保留停止但未删除一段观察期，不立即销毁。

### 15.4 第二阶段验收

- Brain `/health`、Gateway health 正常；
- Dashboard 所有 Haven 页面和 cc 会话接口正常；
- MCP 工具清单和一次读/写工具调用正常；
- bucket 数量和抽样内容一致；
- SQLite `integrity_check` 通过；
- `config.runtime.yaml`、`.env`/密钥路径、自动任务配置正确；
- 重启 Brain/Gateway 后数据不丢；
- Dashboard 到 Haven 全走内部 Docker 网络；
- Brain/Gateway 没有不必要的公网端口。

### 15.5 第二阶段 rollback

- 最终切换前不允许测试栈承接真实新增数据。
- 如果最终导入或验收失败，在 VPS 尚未接收真实写入前，恢复 Dashboard 的 Zeabur URL并 redeploy，重新开启 Zeabur 写入。
- 如果 VPS 已经产生真实新写入，不能直接切回 Zeabur，否则会丢这段数据；必须先导出/合并差异，另开数据恢复窗口。
- Zeabur 的 volume、service、域名在观察期内不删除。

---

## 16. 最终备份策略

### 16.1 Haven 数据库和状态

备份对象：

- `/srv/ob-data/haven/buckets`；
- `/srv/ob-data/haven/state` 中所有 SQLite/状态文件；
- `config.runtime.yaml`；
- 持久化 `.env`/密钥文件（加密）；
- 基础 `config.yaml`。

策略：

- 每日加密备份；
- SQLite 使用一致性备份方式或停写快照，不能在活跃写入时简单复制半个数据库；
- 建议保留 7 个日备份、4 个周备份、3 个按月备份；
- 每月至少做一次恢复演练和 SQLite integrity 检查；
- VPS provider snapshot 只能作为第二层，不替代应用级备份。

### 16.2 `.claude`

备份对象：`/srv/ob-data/claude`。

- 每日加密备份；
- 严格限制备份读取权限；
- 恢复后校验目录/文件权限；
- 不同步到公开云盘或 Git；
- credential 泄露时按泄露处理，撤销并重新登录。

### 16.3 未 commit workspace

GitHub 只保护已 push 的 commit，不能保护未 commit 修改。

备份对象：

- `/srv/ob-workspaces/dashboard`；
- `/srv/ob-workspaces/haven`。

策略：

- 每日文件级增量快照，排除 `node_modules`、`.next`、build cache、测试临时目录；
- 保留 `.git`、源码和未跟踪但非敏感的工作文件；
- `.env`、credential、SSH key 不应存在于 workspace；若意外存在，应阻止备份并清理；
- 大修改前做一次即时快照；
- 恢复时先恢复到临时目录并检查 diff，不直接覆盖活跃 workspace。

### 16.4 Coolify 配置和日志

- 环境变量/secret 清单单独加密归档，只记录键名的文档不能代替 secret 备份；
- Coolify/Compose 配置纳入私有配置备份；
- 应用日志设置大小和天数限制，通常保留 7–14 天，不做永久全量备份；
- 对 RAM、swap、磁盘、container restart、health check 和备份失败配置告警。

---

## 17. 资源结论

当前 VPS 已是 6C6G + 3GB swap，符合本方案的建议容量。

预估：

- 常驻约 2.2–4GB；
- Next/Docker build、`npm install`、测试时整机峰值可能到 4.5–6.5GB；
- 最大风险是 Claude build/test 与 Coolify build 同时发生，不是模型推理本身。

规则：

- 一次只让一个 agent 执行重任务；
- Dashboard/Haven deployment 串行；
- 观察 swap 和 OOM；
- 60GB SSD 定期检查 Docker layers/build cache。

如以后把 Codex 也放 VPS 并允许与 Claude 并发，再评估升级到 8GB；Codex 本机运行不增加 VPS 常驻负担。

---

## 18. 哪些东西可以完全不改

- `/cc` 前端交互、SSE 展示和现有工具卡总体不需要重写；
- `/api/cc-chat → Agent SDK → Claude Code` 主调用链不改；
- 现有一会话一 query、闲置回收和 session ID resume 机制沿用；
- API / subscription 两种 provider 选择沿用；
- Haven 中现有 cc 会话、Persona、权限、MCP、上游配置持久化接口沿用；
- 浏览器仍只访问 Dashboard backend，不直接访问 Claude 控制接口；
- 本机 `npm run dev` 开发方式保留；
- 用户自己 commit + push；Coolify 正式资源保持手动部署；
- 第一阶段 Zeabur Haven 完全不迁、不停、不删。

---

## 19. 已知风险和不得模糊的边界

1. Dashboard 与 Claude 同容器不是秘密硬隔离；env allowlist 只能减少直接继承，不能等价于独立容器。
2. 当前 `?k=` 门禁是局域网方案，不能作为生产登录直接上线。
3. Dashboard 单实例重启会丢活跃回合和批准队列，这是已接受行为；UI/错误处理必须明确。
4. 第一阶段 Haven/MCP 仍依赖 Zeabur 公网可达性；真实 URL 必须人工确认，不能猜。
5. 第二阶段 standalone Gateway 的 `/api/*` 与 Brain 兼容入口 `/gateway/api/*` 路径不同；迁移先指向 Brain 兼容入口，避免顺手大改客户端。
6. Coolify deployment checkout 与 Claude workspace 混用会导致未提交改动被覆盖，必须物理分开。
7. 6GB 最大风险是并发 build；需要串行部署和任务约束。
8. `.claude` 备份含 OAuth credential，备份泄露等同 credential 泄露。
9. Zeabur→VPS 数据切换后如已产生新写入，不能无差别回切旧 Zeabur 数据。

---

## 20. 后续窗口拆分

后续严格按“一窗口一个问题”推进：

步骤 8 完成后，下一实际窗口先执行“第二阶段窗口 1”；步骤 9、步骤 10 作为另行安排的并行待办，与被动观察协调，不阻塞第二阶段前半段。

1. 窗口 1：建立本机基线和迁移检查表。
2. 窗口 2：域名/DNS/Coolify HTTPS 前置。
3. 窗口 3：Dashboard production Dockerfile、Linux 用户和启动方式。
4. 窗口 4：workspace 根白名单、`realpath`/symlink 防护。
5. 窗口 5：Claude 子进程 env allowlist。
6. 窗口 6：公网登录/session 改造。
7. 窗口 7：MCP/Haven 地址配置化与第一阶段 Zeabur 联调。
8. 窗口 8：Coolify bind mount、API 模式部署。
9. 窗口 9：自动部署隔离、rollback 验收（步骤 9，另行安排并与并行观察协调）。
10. 窗口 10：24–48 小时试运行和正式域名切换（步骤 10，另行安排并与并行观察协调）。
11. 第二阶段窗口 1：Zeabur 数据和真实 volume/export 人工确认（✅ 2026-08-17 完成）。
12. 第二阶段窗口 2：Haven Compose/Coolify 内网部署（✅ 2026-08-17 完成）。
13. 第二阶段窗口 3：预迁移、校验和只读联调（✅ 2026-08-17 完成）。
14. 第二阶段窗口 4：最终停写、导出、导入和切换（✅ 2026-08-21 完成）。
15. 第二阶段窗口 5：备份、恢复演练和 Zeabur 退场。

每个代码窗口完成后都必须：

- 按各仓库 `AGENTS.md` 执行；
- 运行命中的测试/类型检查/production build；
- 读取 `MAINTENANCE_CONTRACT.md` 并同步命中文档；
- 更新本 handoff 的完成状态和下一窗口；
- 给出建议 commit message，由用户自己 commit + push。

---

## 21. 当前下一步

第一阶段步骤 1–8 已完成。Dashboard 测试 Application 已在 Coolify 以 production Dockerfile、`npm run start`、固定 `10001:10001` 非 root 身份和单实例运行；临时 sslip HTTPS 域名、公开 healthcheck、正式登录/session、三个既定 bind mount、服务端运行时键名、无 `NEXT_PUBLIC_OMBRE_*`、非 privileged、`cap-drop ALL`、无 Docker socket、无主机端口映射均已验收。Dashboard 到现有 Zeabur Haven/MCP 的 HTTPS 真实链路、登录/session、会话列表、召回、Persona、MCP 工具清单和只读调用均已通过；Claude API 模式、两个既定 workspace、写入/Bash 逐次批准、越界与敏感路径拒绝、子进程环境隔离也已通过。步骤 8 进一步确认 `.claude` 和两个 workspace 挂载跨容器 Restart 仍在、原会话可准确 resume，待批准队列在重启后失效且应用不会永久卡死。Haven 继续运行在 Zeabur，本机现行环境未修改；只对保持停用的 Tavily MCP 项完成了用户确认的认证格式兼容迁移。

第二阶段窗口 1–4 已完成。当前 sslip Dashboard 的 Production `HAVEN_GATEWAY_URL` 为 VPS Coolify 内网地址 `http://haven-brain-5jhemgqroisbatkrbgbefueu:8000`；页面、原数据、既有会话、Persona、6 个具名中转站和 MCP 23 工具均已完成只读验收，新建 CC 会话已完成一次真实回复，并在 Dashboard Restart 后继续存在。最终持久化清单为 `/tmp/haven-window4-final-20260821/dashboard-persistence-after-restart.json`，SHA-256 `e8c9ab80d9ba752902f467080d9fe106ee6d2e2a8fa3d47e9a4ddae9097590f6`，`persistence_ready=true`。VPS 已包含 Zeabur 没有的独有配置和会话写入，严禁直接恢复旧 Zeabur URL；如将来需要回退，必须先导出并合并 VPS 差异。

用户现在可以继续使用 sslip Dashboard，并应优先新建 CC 会话；迁移前旧会话的历史仍可查看，但其中保存的 Windows 工作区路径在 VPS CC 引擎中无效，不应直接重试，除非先改成 `/workspace/dashboard` 或 `/workspace/haven`。迁移后正常使用未发现页面、会话、回复、MCP 或数据异常；Claude App 的新版 `Ombre Brain` OAuth Connector 已确认在手机端可见且能够正常使用。日回顾和轨迹桶/每周旅程已由用户在 Dashboard 中重新启用，并显示下一次运行时间；其余自动后台任务的恢复与引擎选择留待后续逐项处理。所有最终归档、VPS 覆盖前快照、旧 live dirs、Zeabur 控制项回滚包和无正文清单目前继续保留。

2026-08-21 换窗前补充：核心切换无待修故障，Dashboard 内网 MCP 与 Claude App 公网 OAuth MCP 均已连接成功。仓库中的 Coolify OAuth Compose 引用和配套文档当前仍未 commit/push，在线配置已生效但存在 live/repo 漂移；继续遵守本任务“不 commit、不 push”，后续须另行处理持久化归档。当前临时 sslip Brain 域名已启用 OAuth 且无凭据请求为 401，Dashboard 必须继续使用内网地址。

2026-08-22 收尾审计决定：Zeabur 自动续费已经关闭且无法继续扣款，供应商通知数据可能于 2026-08-28 永久销毁。用户已决定不续费、不主动删除，允许 Zeabur 按平台流程自然到期；Zeabur 已不承接正式流量、数据落后于 VPS 且不能直接回切，不再把 VPS 独立备份错误地视为“不续费 Zeabur”的技术前置条件。正式数据与新增写入均以 VPS 为主。

后续工作按独立窗口依次执行，不重复核心迁移：

1. 注册 Backblaze B2，建立 VPS 到 B2 的客户端加密独立备份，并在隔离位置完成一次恢复验证；本机另保留关键恢复副本，restic 解密密码与 B2 凭据仅存 Bitwarden，不进入聊天、Git 或普通文档。
2. 备份验收后，统一整理并验证 Coolify OAuth Compose 引用、`README.md`、`ENV_VARS.md` 及 B2 的备份范围、频率、恢复方法和验收事实；不得写入任何 secret。由用户自己 commit + push。
3. ✅ Coolify 自动部署隔离与 rollback 路径已于 2026-08-22 验收完成；普通代码 push 不会更新 VPS 正式服务，详细事实见下方完成记录。
4. ✅ Claude Pro 购买前规则、Claude Code 支持方式、VPS 登录持久化及现有 Dashboard 适配性已于 2026-08-22 核对并完成购买、登录与 Restart/Redeploy 验收；详细事实见下方完成记录。
5. ✅ `CC Pro ↔ CC API ↔ 自建 API` 同会话手动往返已于 2026-08-22 完成代码、部署与真实验收；只支持手动 fallback，不实现自动切换，详细事实见下方记录。
6. 🟡 日回顾与每周轨迹的逐任务 API / Claude Pro 选择已完成本地代码与验证；默认 API，Pro 固定单次无工具、串行执行，只记录并展示实际线路与分类失败，不自动 fallback。其他自动化任务与本地引擎明确搁置。下一步由用户自行 commit/push 后，先发布 Dashboard runner 并配置两端共享 runner token，再发布 Haven，最后分别执行一条人工验收任务。
7. 正式域名降为低优先级；继续使用当前 sslip Dashboard 与受 OAuth 保护的 Brain 公网 MCP。未来更换正式域名时，必须同步更新 Brain OAuth Public Base URL、Protected Host 与 Claude Connector 地址。

上述顺序已经确认，但不构成对后续步骤的执行授权；每个独立窗口开始时仍须按当时范围确认。三线路手动往返已经完成；日回顾/每周轨迹之外不得扩展自动化引擎接入，也不得扩展为自动 fallback、B2 配置、自动部署修改、额外自动化恢复、Zeabur 删除、由 Codex commit 或 push。

### 2026-08-22 Backblaze B2 独立备份完成记录

- Backblaze B2 已在 US East 建立专用 Private Bucket，默认 SSE-B2 已启用、Object Lock 未启用；Bucket 名称、Key ID、Application Key 与 restic 密码均只保存在 Bitwarden，handoff/Git/聊天不记录真值。专用 Key 仅限该 Bucket，权限为 Read and Write，并允许列出 Bucket 名称。
- VPS 宿主机已安装 Ubuntu 官方 restic `0.16.4` 与 SQLite `3.45.1`。凭据保存在 `/etc/ombre-backup/` 的四个 `0600 root:root` 文件中，目录为 root-only；脚本和日志均不输出值。
- 完整备份范围包括 Haven 正式 `buckets/state/config`、`/srv/ob-data/claude`、两个未 commit workspace、Coolify custom-format 数据库 dump，以及 Haven stack 的私密 Compose/`.env`。workspace 会排除构建缓存，并在发现 `.env`、credential 或 SSH key 等敏感文件时阻止任务。
- 13 个 Haven SQLite/DB 均使用 `.backup` 生成一致副本并逐库通过 `PRAGMA integrity_check=ok`。最终人工里程碑 snapshot 为 `d70eaaf7`；恢复验收为 `929/929` 文件、全文件 SHA match、13/13 数据库 integrity ok、Coolify dump 可列出 `579` 个条目，恢复后的 `.env` 与 dump 权限仍为 `0600 root:root`。`restic check --read-data` 无错误。
- `/usr/local/sbin/ombre-vps-backup` 已手工和 systemd 两种路径试跑成功；systemd 试跑 snapshot 为 `0a7aca4a`，日志含 `OMBRE_VPS_BACKUP_OK`，仓库检查通过。每日 timer 已 enabled/active，计划为 `19:00 UTC`（香港次日 03:00）并随机延迟最多 5 分钟。
- 每周 prune timer 已 enabled/active，计划为星期六 `20:00 UTC`（香港星期日 04:00）并随机延迟最多 5 分钟。策略只处理 `ombre-vps-daily` 标签：保留 7 日、4 周、3 月；先执行完整 `restic check --read-data`，成功后才 `forget --prune`。retention dry-run 已确认人工快照不受影响；实际自动清理尚未发生。
- 三个约 200 MB 的本地明文 staging/restore 目录在 B2 最终验收后已按精确路径删除，`/srv/ob-backups/haven` 当前只保留脚本运行缓存与基础目录。B2 snapshots、正式数据、凭据、脚本和 timers 均保留。
- 非秘密运行手册已归档到 `Ombre-Brain-Haven/docs/operations/vps-backup.md`，宿主机脚本与 systemd 单元源文件已归档到 `Ombre-Brain-Haven/ops/vps-backup/`。`OB基础知识` 不再保留重复副本；仓库改动当前未 commit、未 push。
- B2 主任务已完成。尚未完成的附加项：本机额外加密恢复副本、备份失败外部通知、Coolify dump 向独立 PostgreSQL 的完整回灌、第一次实际周日 prune 后复核。Compose/OAuth/B2 文档归档与仓库同步准备已完成，等待用户 commit/push；下一独立工作项为自动部署隔离，随后才进入 Claude Pro/三引擎切换。

### 2026-08-22 Compose/OAuth/B2 仓库归档完成记录

- `compose.coolify.test.yml` 已把上游模型 Key 限制在 Gateway，并只向 Brain 注入代码实际读取的 6 个 `OMBRE_CHATGPT_OAUTH_*` 变量；README 与 `ENV_VARS.md` 已同步公网 OAuth、Coolify 内网连接和密钥注入边界。
- B2 runbook、两个宿主机备份脚本和四个 systemd 单元的非秘密源文件已归档到 `Ombre-Brain-Haven` 正式仓库位置；文档只记录变量名、路径、备份范围、计划、恢复步骤和验收事实，不记录 Bucket 名称、B2 Key、restic 密码或 OAuth/API secret。
- 收尾验证已通过：两个 Bash 脚本通过 `bash -n`，四个 systemd 单元在补齐默认依赖和真实安装路径的隔离 root 中通过 `systemd-analyze verify`，`docker compose -f compose.coolify.test.yml config --quiet` 通过；Dashboard `MAINTENANCE_CONTRACT.md` 命中的 `ENV_VARS.md` 与 README 部署文档均已同步。
- 本窗口没有操作 VPS 在线配置、B2、timer、Zeabur、Claude Pro、业务自动化、commit 或 push。用户完成仓库 commit/push 后，下一窗口只处理 Coolify 自动部署隔离与 rollback 验收，不扩散到 Claude Pro/三引擎切换。

### 2026-08-22 Coolify 自动部署隔离与 rollback 验收完成记录

- VPS Coolify `4.3.9` 的 Dashboard Application 代码源为 Public GitHub `heyeovo/ob-dashboard2`、分支 `main`、Commit SHA 配置 `HEAD`；`Advanced → Deployment` 已人工确认 `Auto deploy = Manual deployments only`、`Preview deployments = Disabled`。部署历史 10/10 均显示 `Source = Manual`，当前运行版本短 SHA 为 `0435ae3`。
- Dashboard 的 GitHub push 只更新仓库，不会触发正式部署；只有人工选择 `Redeploy` 才会按当时 Git Source 构建。当前保留 `HEAD` 以维持手动发布便利，没有改成固定 SHA。
- Dashboard 在 Coolify `4.3.9` UI 中没有独立 Rollback 按钮。已验收的 UI 回滚路径为：在 `Git Source → Commit SHA` 填入上一完整 SHA，保存后手动 `Redeploy`；恢复时填回目标 SHA 或 `HEAD` 再部署。本次没有让正式 Dashboard 实际运行旧代码。
- 旧 Dashboard 成功版本 `33e48a99648b9c94b6a31b2289c98335c149268d` 的本地 Docker 镜像仍存在，`docker image inspect` 返回镜像 ID `sha256:004a1c40aac68cb953c8a18a99a438b0cd7ca91fcb3147d78c46bc8ea6319ef2`，因此具备快速复用旧镜像的实际前提。
- Haven `haven-test-stack` 是 Coolify 内保存的手工 Docker Compose Service，不绑定 Git repository/branch 自动事件；其 Webhooks 页面只有需外部主动调用的 Deploy Webhook。仓库工作流审计只发现测试和 Docker Hub 镜像发布，没有 Coolify URL、`/api/v1/deploy`、`curl`/`wget` 部署旁路；`ob-dashboard2` 没有 GitHub Actions 工作流。
- Haven Brain 与 Gateway 已从两处硬编码 commit 改为共同引用必填的非秘密变量 `HAVEN_RELEASE_SHA`；当前值仍为已验收的 `57d70e52e4e17dc66b55db1302056128edb96a87`。Source Compose 使用 `${HAVEN_RELEASE_SHA:?}`，空值会阻止部署，不会隐式漂到 `main`；该变量仅在 build time 可用，不注入运行中容器。
- 在线 Compose 两处变量解析、Validate 和 Deployable Compose 已人工检查；两次普通 `Restart` 后 Brain/Gateway 均恢复 `Running (healthy)`，未选择 `Restart (pull latest)`，未升级代码。以后发布只改一次 `HAVEN_RELEASE_SHA` 后手动 Restart/Redeploy；回滚改回上一完整 SHA。为避免旧代码与当前正式数据不兼容，本次未让 Haven 实际运行旧版本。
- 本窗口只操作 Coolify 自动部署隔离及 rollback 路径，并同步 `compose.coolify.test.yml`、`ENV_VARS.md`、README 与本 handoff；没有操作 B2、timer、Zeabur、Claude Pro、正式域名、业务自动化、commit 或 push。
- 用户进一步确认需要每个后续代码窗口主动提醒发布方式；`Ombre-Brain-Haven/AGENTS.md` 已移除旧 Zeabur 自动部署规则并写入 `HAVEN_RELEASE_SHA` 手动发布/回滚约束，`ob-dashboard2/AGENTS.md` 已写入 Dashboard 手动 Redeploy/回滚约束。部署事实继续以 README/`ENV_VARS.md` 为准，不重复写入两端 `CLAUDE.md`。
- 两端 `AGENTS.md` 已互相引用：任何涉及 VPS、Coolify、发布、回滚或 Dashboard/Haven 联动的任务，开始前必须同时读取两份项目规则，用户无需在每个新窗口重复提醒。

### 2026-08-22 Claude Pro 购买、登录与持久化验收完成记录

- 购买前已按 2026-08-22 的 Anthropic 官方规则核对：个人 Pro 包含 Claude Code，但不包含 Claude Console API；Claude、Claude Code 与当前仍未切走的 Agent SDK/第三方应用用量共享订阅限制，并受 5 小时 session、每周全模型及其他可能的模型/功能限制约束。Pro 只作为个人单用户补充线路，现有 API provider 继续保留为手动 fallback；不得把个人订阅登录提供给其他用户或作为共享服务路由。
- 用户已自行购买个人 Claude Pro；购买完成时 Billing 显示 `Account plan = Pro`，Usage 显示当前 session 与每周全模型均从 `0% Used` 开始。handoff、Git 与普通文档不记录付款资料、邮箱、授权码或 token；额外付费额度开关未在本窗口验收，不在此断言其状态。
- Dashboard Coolify `Persistent Storage → Directories` 已人工确认 `/srv/ob-data/claude` bind mount 到 `/home/cc/.claude`。容器终端实际身份为固定非 root 用户 `uid=10001(cc)`，`HOME=/home/cc`、`CLAUDE_CONFIG_DIR=/home/cc/.claude`，目录可写。
- 用户在当前 Dashboard 容器中通过 Agent SDK 自带 Claude Code CLI 完成官方订阅 OAuth 登录；`auth status` 显示 Claude Pro account。凭据文件为 `/home/cc/.claude/.credentials.json`，实际属主/权限为 `cc:cc 0600`；凭据正文、授权链接和授权码均未进入聊天、Git 或普通文档。
- 现有 `/api/cc-test` 以 `cred=subscription` 完成首次最小真实调用：`ok=true`、回复 `OK`、`subscription_type=pro`、Claude Code `2.1.220`、实际模型 `claude-sonnet-5`、`apiKeySource=none`、`upstream_base_url=null`，stderr 无错误。这证明 subscription 分支没有误用 API Key 或现有中转站。
- Dashboard 普通 `Restart` 后再次建立新 SDK session 并成功使用 `claude-sonnet-5`，`subscription_type=pro` 且无错误；随后在 `main + HEAD`、Manual deployments only 保持不变的前提下人工 `Redeploy`，再次真实调用仍正常。由此确认订阅登录凭据跨 Restart 和容器替换保留。
- 本窗口没有修改 Dashboard/Haven 代码、Haven 配置、正式域名、B2、Zeabur、业务自动化或自动切换，也没有 commit/push。维护契约仅命中本 handoff 状态同步，不需要更新 README、`ENV_VARS.md`、两端 `CLAUDE.md` 或 `TECH_DEBT.md`。
- 下一独立窗口只处理步骤 5：在不重做既有 CC API ↔ 自建 API 上下文同步链路的前提下，把已验收的 CC Pro 订阅模式接入同一会话，验收 `CC Pro ↔ CC API ↔ 自建 API` 手动往返切换时上下文连续。自动切换、自动化任务引擎、正式域名及其他迁移收尾项不得扩入该窗口。

### 2026-08-22 三线路手动往返完成记录

- 产品决定：Dashboard/Haven 继续使用同一个逻辑 `session_id`；CC Pro、每个 CC API provider 分别维护独立 Claude 原生 session。进入任一 CC 线路时，该线路尚未见过的 Haven 成功 user/assistant 文字轮次以隐藏 `<上次聊到这里>` 衔接块补入，不伪装成原生 assistant transcript；selfhost 继续使用既有完整 Haven 角色历史。
- 不跨线路同步 thinking、图片或文件内容；附件仍保留在 Dashboard/Haven 历史界面。Pro 额度不足只允许用户在回复结束/失败后手动切换并重发，不实现自动 fallback。
- Haven `conversation_sessions` 新增 `cc_overrides_json` 与 `cc_lanes_json`，按 `subscription` / `api:<provider_id>` 持久保存选择、Claude session id 和各自已读游标；旧 `cc_seen_round_id` 仅兼容。严格写入成功时在同一事务推进实际线路，确保 provider、模型、凭据与 session 不串线。
- Dashboard 允许空闲时在 Pro/API provider/selfhost 间往返，选择写回 Haven。Pro 设置卡通过当前固定 Agent SDK `0.3.220` 的实验性 usage 接口显示 5 小时与本周剩余比例/香港时间重置点；只读已有 Pro SDK session，不额外触发模型请求，接口不可用时明确降级，离开 Pro 后仅显示进程内上次值。
- 本地验证：Haven `python -m unittest discover -s tests` 为 107 项通过；Dashboard `npm test` 为 31 个文件、157 项通过、1 项既有跳过；本次目标文件 ESLint 通过；`npm run build` production build 通过并识别 `/api/cc-pro-usage`。全仓 ESLint 仍有生成产物/旧页面的既有错误，不属于本次改动。
- 首版已由用户 commit/push 并按顺序发布：Haven `7719b5ce2d925b82e2a76c052174dee1dce1a1ba` 通过 `HAVEN_RELEASE_SHA` + 普通 Restart 发布，Brain/Gateway 均 healthy；Dashboard `96776e58d7b86216a137dec0fccbde4b4dcfdfd0` 保持 `main + HEAD + Manual deployments only` 手动 Redeploy 成功，运行短 SHA `96776e5`。真实三线路与额度 UI 尚未完成验收。
- 首次线上 Pro 验收暴露旧兼容问题：订阅中填写的固定 `claude-opus-4-6` 被 Dashboard 发送前改写成动态 `opus[1m]`，当前 Claude Code 将其解析为 Opus 5（1M），随后该请求被 Opus 5 safeguard 拦截。该失败轮未成功写入，不推进 Haven 游标；它不是额度不足、凭据串线或账号封禁。
- 本地已修复：subscription 完整模型 ID 原样传递，只有 API provider 保留 Opus 4.6 → `opus[1m]` 的中转映射；界面不再把动态 `opus[1m]` 假标为固定 4.6。新增定点测试后 Dashboard 全套为 31 个文件、159 项通过、1 项既有跳过，production build 通过。Haven 无需再次部署；尚待用户提交并仅 Redeploy Dashboard 后，从 Pro 轮重新开始真实三线路验收。
- 用户以 Dashboard `92114caf01c593dfbc9c90e11a5a2b310cd3de81` 重新部署后确认 Pro 4.6 模型、回复连续性和额度卡均正常，但短暗号回复没有 thinking。代码核对确认显示/保存链路完整，缺口是旧实现仅在关闭时传 `maxThinkingTokens=0`，开启时没有对默认关闭 adaptive thinking 的 Opus 4.6 显式发送 thinking 配置。
- 本地已修复 thinking：Opus/Sonnet 4.6+ 开启时显式 `adaptive + summarized`，关闭时显式 `disabled`；旧 Claude thinking 模型使用 10k 兼容预算，未知中转模型保持 SDK 默认。中途切换会保留原生 session id、回收空闲 query，并在下一轮 resume 后应用。新增测试验证关闭、开启、旧模型兼容、query 重建/resume、摘要保存；Dashboard 全套为 31 个文件、162 项通过、1 项既有跳过，production build 通过。尚待用户再次 commit/push、仅 Redeploy Dashboard，并用复杂问题验收 thinking 摘要；Haven 无需部署。
- thinking 修复最终提交为 Dashboard `6e37707b832e2ac4de84984ae859899b221d8200`，用户已手动 Redeploy 成功。真实 Pro 4.6 复杂问题出现 thinking 摘要，实际模型保持 `claude-opus-4-6`；5 小时/本周额度卡正常。
- 同一真实 Dashboard 会话最终完成 `CC API → Pro → selfhost → 原 CC API → Pro` 往返：暗号 A/B/C/D 在各目标线路均连续，selfhost、API provider 与 Pro 的实际引擎/provider/model 全部正确，未发生 session、凭据或模型串线。CC 回切只补中间成功文字，thinking 与附件继续不跨线路同步；Pro 失败后的 fallback 只允许人工换线和重发，没有自动切换。
- 至此步骤 5 完成。当前线上版本：Haven `7719b5ce2d925b82e2a76c052174dee1dce1a1ba`，Dashboard `6e37707b832e2ac4de84984ae859899b221d8200`；两仓库 tracked 工作树干净，Dashboard 仅保留用户原有未跟踪 `.claude/`。下一独立工作项是步骤 6，开始前仍须重新确认范围，不得在本窗口继续扩展。

### 2026-08-22 日回顾 / 每周轨迹逐任务执行线路本地完成记录

- 本次范围收窄为日回顾与每周轨迹；两项分别持久选择 `API` 或 `Claude Pro`，不设置全局统一引擎，也不提供本地选项。其他自动化任务保持原状并明确搁置。
- Haven 新增逐任务 `execution_engine/execution_model` 与独立执行记录，手动和排程入口在每次运行前读取该任务当前选择；记录 requested/actual engine、模型、状态、分类错误与时间。旧任务默认 API，任一路线失败都原样结束，不自动切换；人工改线后再手动重跑。
- Pro 路线由 Dashboard 专用 runner 执行：仅接受日回顾/每周轨迹白名单任务与固定 Claude 模型 ID，默认 Sonnet，单次 query、禁用 tools/MCP/交互批准，并在单个 Dashboard 实例内串行。Claude OAuth 凭据仍只留在 Dashboard；Haven 仅保存 runner URL 和共享 token 环境变量，不保存或读取 Claude 凭据。
- Dashboard 自动化页分别保存两项任务的线路/模型，并展示最近一次实际执行、失败分类和“无自动 fallback”提示。“本窗口设置”新增 Prompt cache 的 1 小时系统缓存与 5 分钟会话缓存倒计时估算，供手机端查看；估算来自最近模型调用时间，单条消息 usage 才是实际 cache 命中依据。
- 本地验证通过：Haven `python -m unittest discover -s tests` 为 109 项通过；Dashboard `npm test` 为 32 个文件、166 项通过、1 项既有跳过；本次目标 ESLint 与 `npm run build` production build 通过，build 已识别 `/api/automation-pro-runner`。
- 本窗口没有修改线上配置、运行真实自动化、操作正式域名/B2/Zeabur/自动部署，也没有 commit 或 push。当前线上版本仍为 Haven `7719b5ce2d925b82e2a76c052174dee1dce1a1ba`、Dashboard `6e37707b832e2ac4de84984ae859899b221d8200`；本地代码尚待用户提交并按手动发布规则验收。
- 发布顺序建议：先将 Dashboard 保持 `main + HEAD + Manual deployments only` 手动 Redeploy，并在 Dashboard 配置 runner token；再把同一 token 与 runner 内网 URL 配给 Haven、将 `HAVEN_RELEASE_SHA` 改为新完整 SHA 后普通 Restart/Deploy。任何线上配置或真实任务运行都必须先由用户按最短点击路径人工确认；首轮应分别手动跑一条日回顾和每周轨迹，不开启自动 fallback。
- 用户已提交并 push 首版：Haven `5bf4cc6c2207fef7317bb4fd5b25cf12f2cb9870`，Dashboard `b578d26981906a57967f4fda40adb506cecb61e6`。Dashboard 已保存仅 Runtime 的 runner token 并手动 Redeploy；部署后收尾检查发现根 `proxy.ts` 仍会先用 Dashboard session 拦截 runner，导致 Haven Bearer 请求无法到达路由。线上此时只是不可调用，并未绕过认证或泄露 token；Haven 尚未发布。
- 本地后续修复把精确 `/api/automation-pro-runner` 加入 proxy 放行表，同时保留路由自身共享 Bearer token 强校验，并补充精确路径/子路径拒绝测试。Dashboard 完整 32 个文件、166 项通过、1 项既有跳过，目标 ESLint 与 production build 均通过；尚待用户再次提交与 Dashboard Redeploy，完成前不得继续配置或发布 Haven。
- runner proxy 修复已由用户提交为 Dashboard `89b6b1f38b2ecaf1b981701235a89aa161d672a4` 并手动 Redeploy 成功；Dashboard token 使用仅 Runtime、Literal（保留 `$` 原样）。公网不带 token 的空 POST 返回 `401 unauthorized`，证明精确路由已放行且 Bearer 认证仍生效，没有触发 Agent SDK。
- Haven 已以 `HAVEN_RELEASE_SHA=5bf4cc6c2207fef7317bb4fd5b25cf12f2cb9870` 通过普通 Restart 发布，Brain/Gateway 均 `Running (healthy)`；runner URL 使用当前 sslip HTTPS 完整 endpoint，Haven token 同样按 Literal 注入。Brain 容器用环境变量发带 token 的空 JSON 返回 `400 invalid_input`，证明两端 token/URL 连通且未运行 Claude。
- Dashboard 已将日回顾与每周轨迹分别保存为 Claude Pro + Sonnet 4.6。用户在日回顾页首次为 2026-08-21 真实生成成功，约消耗当时 5 小时额度的 1–2%；这是第一条自动化 Pro 真调用。每周轨迹候选尚未运行。

### 2026-08-22 每周轨迹连续截止游标本地完成记录

- 真实运行前发现旧 weekly window 固定取“上一完整自然周”：2026-08-22 手动生成会读取 8 月 10–16 日，与现有轨迹已梳理至 8 月 11 日产生重叠。用户确认产品规则改为：每周只表示触发频率，内容从上次人工确认截止日下一天连续读取到最近完整 OB 日。
- 新规则独立持久化 `reviewed_through_date`。以本次首次值 2026-08-11 为例，8 月 22 日 04:00 后本次范围为 8 月 12–21 日；若周任务失败两天后补跑，会形成 7+2 天，确认后下周只处理剩余 5 天。首次值必须在新版本发布后由用户在 Dashboard 人工保存，代码不自动猜测或写线上值。
- 积压单次最多从最早缺口处理 31 天，确认后再处理下一段；同一协作者有 pending/applying/failed 候选时不再次调用模型。协作者和游标绑定于当前 weekly schedule，改协作者需重新填写接续日期。
- 只有候选确认完成或人工确认 `no_change` 才推进游标；候选完成与 schedule 游标推进在同一 SQLite 事务。失败、拒绝、冲突、仅生成和自动 fallback 均不推进；`no_change` 不写 journey，但确认后推进，避免安静日期永久重复。
- Dashboard 设置页显示“已梳理至”和服务端计算的“本次将读取”，积压分段会明确提示；没有新完整日或已有 pending 候选时禁用重复生成。重复/已有候选的检查记为 `skipped`，不假装发生真实 Pro/API 调用。
- 本地验证通过：Haven 完整 111 项测试；Dashboard 完整 32 个文件、167 项通过、1 项既有跳过；目标 ESLint 与 production build 通过。连续游标改动尚未 commit/push 或发布，当前线上仍是 Haven `5bf4cc6c2207fef7317bb4fd5b25cf12f2cb9870`、Dashboard `89b6b1f38b2ecaf1b981701235a89aa161d672a4`，线上每周轨迹仍是旧自然周逻辑，因此发布新版本并设置 2026-08-11 前不得点击“立即生成候选”。

### 2026-08-22 连续游标发布与 Pro 结构化输出修复记录

- 连续游标版本已由用户提交并发布：Haven `a578e53fe0ef3bf3f76fc306380d55c60f21a8c6` 通过 `HAVEN_RELEASE_SHA` + 普通 Restart 发布，Brain/Gateway 均 healthy；Dashboard `c25531b7c8a49715d782642733224ff40a06888a` 保持 `main + HEAD + Manual deployments only` 手动 Redeploy 成功。
- Dashboard 已把“已梳理至”人工保存为 `2026-08-11`，页面正确显示本次连续读取 `2026-08-12 ～ 2026-08-21`。随后首次真实 Claude Pro / `claude-sonnet-4-6` 轨迹候选生成失败，执行记录为 `model_error: weekly journey model returned invalid JSON`；未确认候选，也未启用自动 fallback。
- 诊断确认 Haven 已能剥离 Markdown code fence 和 JSON 前后说明，但 Pro runner 当时只返回普通文本；Haven 传入的 `max_tokens` 也不是 Agent SDK `query()` 的逐次输出选项。原始模型正文不会写入 Runtime Logs，因此 Coolify 只看到普通请求日志是预期的隐私边界，无法再从线上日志判定具体是截断还是 JSON 内部语法损坏。
- Dashboard 本地修复仅对 `weekly_journey` 启用当前 Agent SDK 原生 `outputFormat: json_schema`，直接使用 `result.structured_output`；日回顾继续使用普通正文。缺少结构化结果时返回明确 `pro_structured_output`，不记录模型原文；Haven 仍负责最终 candidate type、字段、证据 ID、日期和写入白名单校验。
- 修复验证：runner 定点 5 项通过，Dashboard 完整测试复跑为 32 个文件、169 项通过、1 项既有跳过；目标 ESLint 与 production build 通过。第一次全量测试曾命中既有 `dashboard-auth` 随机 token 尾字符测试波动，未改无关鉴权代码，原命令复跑通过。
- 当前结构化输出修复仅在 Dashboard 本地，尚未 commit/push/deploy；Haven 无代码变更、无需再次发布。下一步由用户提交 Dashboard 并手动 Redeploy，部署后先确认游标仍为 `2026-08-11`，再人工重试同一 `2026-08-12 ～ 2026-08-21` 候选；成功生成后先核对候选，未经人工确认不写入 journey、不推进游标。

### 2026-08-22 Pro 扁平结构化输出二次修复记录

- 首版结构化输出修复已由用户提交为 Dashboard `91dfb0f37414b3ac58c8b4e081622208c9a4f889` 并手动 Redeploy 成功；Haven 未改。部署后人工确认游标仍为 `2026-08-11`、读取范围仍为 `2026-08-12 ～ 2026-08-21`，且没有旧待确认候选。
- 第二次真实 Claude Pro / `claude-sonnet-4-6` 重试仍失败，执行记录为 `pro_runner_failed: Claude Pro 自动化执行失败`。失败发生在 Dashboard runner 内，Haven 没有收到候选；未确认或写入 journey，也不应推进游标。当前 runner 版本当时没有把 SDK error subtype 单独映射，因此线上只显示通用错误。
- 官方结构化输出文档确认 Sonnet 4.6 支持 JSON schema；但 Claude Code 官方仓库 2026-07 的 headless `--json-schema` 未解决问题记录了嵌套对象/数组可能反复校验失败并触发 `error_max_structured_output_retries`，且 `maxTurns=100` 仍可复现。当前轨迹 schema 恰好含嵌套 `proposal/close/create` 与字符串数组，因此判断为高度吻合的 SDK/CLI 路径缺陷，而不是简单增加 Agent 轮数可修复。
- 本地二次修复把 Agent SDK 的传输 schema 改为 11 个必填扁平字符串字段，仅保留 `candidate_type` enum；理由与证据 ID 用逐行字符串传输，runner 再确定性还原为 Haven 原本的 `rationale`、`evidence_bucket_ids` 和 `proposal` 嵌套对象。Haven 的候选类型、日期、证据范围、revision/hash 与零自动写入校验均不变。
- runner 现在把 `error_max_structured_output_retries` 映射为安全的 `pro_structured_output`，仍不保存或输出模型正文。定点测试覆盖 `no_change`、`append_current`、`transition`、缺失 structured output 和 retry exhaustion，共 8 项通过；Dashboard 完整测试为 32 个文件、172 项通过、1 项既有跳过，目标 ESLint 与 production build 通过。
- 二次修复当前仅在 Dashboard 本地，尚未 commit/push/deploy；Haven 仍无需发布。下一步由用户只提交 Dashboard 并保持 `main + HEAD + Manual deployments only` 手动 Redeploy；随后再次确认游标/范围未变，才进行第三次人工生成。未经人工确认不应用候选，不实现自动 fallback。
