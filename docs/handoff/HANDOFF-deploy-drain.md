# HANDOFF：部署时旧容器等轮次跑完再退出（B）

> 2026-10-02 CC 写规格，Codex 执行，CC 验收。只改 dashboard，不动 Haven。
> 开工先读 `AGENTS.md`、`MAINTENANCE_CONTRACT.md`、`docs/reference.md`「cc 数据持久化契约」，以及已归档的 `HANDOFF-cc-turn-survives-disconnect.md`（本项建在它的 `turnBroadcast` 之上）。

## 一、问题与现状

push `main` → Coolify 自动构建新镜像（数分钟，旧容器照常服务）→ 切换。切换时旧容器收到 SIGTERM 立即退出，正在跑的轮次（含 CC 自己 push 的那一轮、用户在构建期间发的消息、后台 wake）整轮丢失：`turnBroadcast` 是进程内运行态，Haven 里没有这一轮。

Coolify 侧事实（2026-10-02 用户截图确认）：
- 应用 Health Check 已开：`GET http://localhost:3000/api/health`，期望 200；间隔 10s、超时 5s、重试 6、启动期 30s。
- Advanced → Operations → **Stop grace period** 存在，由用户改为 **600 秒**（原默认 30）。
- Coolify 在「健康检查通过 + 默认容器名 + 无宿主端口映射 + 非 compose」时做滚动更新：新容器健康后才停旧容器，`docker stop` 等待 grace period 后才 SIGKILL。若当前不满足滚动更新条件，就是先停旧再起新——下面的排空逻辑同样适用，只是切换期间无新容器接请求。
- 容器入口：`ENTRYPOINT ["tini", "--"]`，`CMD ["npm", "run", "start"]`，`start` = `next start`。
- Next.js 自托管文档（`node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`「Manual Graceful Shutdowns」）：设 `NEXT_MANUAL_SIG_HANDLE=true` 后 Next 不再自行处理 SIGTERM/SIGINT，由应用注册处理器。

## 二、目标行为

- 旧容器收到 SIGTERM 后进入**排空**：不再开始新轮次，已经在跑的轮次照常跑完、写进 Haven、推完事件，然后才退出。
- CC 在一轮里 push 之后可以继续工作直到这一轮自然结束（上限见下）。
- 排空期间用户新发的消息不丢：前端自动用同一个 `request_id` 重发，最终由新容器处理。
- 快到上限仍未跑完：按「停止」路径优雅收尾（已生成内容写库），再退出。

## 三、服务端

### 1. 让信号到达应用

- `Dockerfile` runner 阶段 `ENV NEXT_MANUAL_SIG_HANDLE=true`，并让 `next` 直接作为 tini 的子进程（不经 npm / sh，避免信号被吞或转发不一致），例如 `CMD ["node", "node_modules/next/dist/bin/next", "start"]`。以实际 Next 16 路径为准，先查文档。
- `package.json` 的 `start` 同步加 `NEXT_MANUAL_SIG_HANDLE=true`（本地 `npm run start` 行为一致）；`dev` 不变。
- 在 `instrumentation.ts` 的 nodejs 分支注册 SIGTERM / SIGINT 处理器，调用排空模块。处理器必须幂等（重复信号不重复启动排空）。

### 2. 排空模块（新文件建议 `app/lib/serverDrain.ts`，挂 `globalThis`）

- `isDraining()`：进程级标志。
- `startDrain(signal)`：
  1. 置 `draining = true`，打日志。
  2. 写跨容器标记（见第 4 条）。
  3. 每秒检查是否空闲：没有未完成的 `turnBroadcast` 轮次、`ccSession` registry 里没有 `busy` / `compacting` 的会话、没有进行中的后台 wake（`sessionTurnCoordinator` 现有状态，以实际代码为准）、selfhost 没有进行中的轮次。空闲后再等 **2 秒**（让最后的 SSE 事件和 Haven 写入落地），删除标记，`process.exit(0)`。
  4. 截止时间 `DRAIN_TIMEOUT_MS`（环境变量，默认 **570000**，即 600 秒 grace 留 30 秒余量；写进 `docs/reference.md` 环境变量表，并注释它必须小于 Coolify Stop grace period）：到点仍有轮次，对每个进行中轮次调用与 `/api/cc-stop` 相同的优雅停止（`turnBroadcast` 的 `turn.stop()`；selfhost 用其现有停止方式），最多再等 **20 秒**，然后删除标记并退出。
- 排空期间停止所有调度器开新活（`contextGcScheduler` 及其它 `instrumentation` 启动的定时任务，以实际代码为准）。

### 3. 排空期间各入口的行为

| 入口 | 排空时 |
|---|---|
| `POST /api/cc-chat` 新轮次 | `503 { ok:false, error:'server_draining', retry_after_ms: 3000 }`。**例外**：同 `request_id` 的已有进行中轮次（现有 replay / `turnStream` 分支）照常接上 |
| `POST /api/cc-chat-selfhost` 新轮次 | 同上 503 |
| `GET /api/cc-chat/attach`、`GET /api/cc-chat`（stats / `active_turn`）、`POST /api/cc-stop`、待批准相关接口 | 照常服务——正在看旧轮次的人要能看完、能停、能批准 |
| 后台 wake runner / automation runner 开新轮次 | 不开始；返回现有的 deferred / 可重试语义（查清调用方如何重试，必要时返回 503，让下一次调度落到新容器） |
| `GET /api/health` | 返回 **503**，让 Docker 健康检查转为 unhealthy、反向代理停止把流量分给旧容器 |

### 4. 跨容器标记（防新旧容器同时动同一个会话）

滚动更新时新旧容器共享持久卷。排空开始时，旧容器为每个进行中会话写标记文件 `$CLAUDE_CONFIG_DIR/ob2-drain/<sessionId>.json`（内容：`{ sessionId, requestId, startedAt, drainStartedAt, pid }`），该会话轮次结束即删除；退出前清空自己写的全部标记。

新容器（任何非排空进程）在**开始一轮前**（前台 `cc-chat` / selfhost、后台 wake、手动压缩、Context GC、rolling recovery 等会占用该会话 Claude transcript 的入口，以实际代码为准）检查该会话标记：
- 标记存在且 `drainStartedAt` 在 **11 分钟**内 → 前台返回 `409 { ok:false, error:'previous_instance_finishing', retry_after_ms: 5000 }`；后台按 deferred 处理。
- 标记超过 11 分钟 → 视为残留，删除并继续。

这是允许丢失的运行态协调文件，不是长期配置；写进 `docs/reference.md` 契约并说明为何放持久卷（两个容器都要看到）。

## 四、前端（`app/cc/useCcChat.ts`）

1. `send()` 收到 `503 server_draining` 或 `409 previous_instance_finishing`：**不报错、不删气泡**，助手气泡保持生成中样式，提示用现有 detached 的灰色样式，文案「正在切换到新版本，稍后自动重发」；按 `retry_after_ms` 用**同一个 `request_id`、同一个 `expected_last_round_id`** 自动重发，最长重试 **12 分钟**，超时后按现有失败处理并保留「重试」入口。
2. `recoverTurn()` 里 detached 气泡在「`active_turn` 为空且 Haven 也查不到」时，现在会立刻标「没有保存下来」。部署期间这一轮可能还在旧容器上收尾（请求被分到了新容器），改为：在 **12 分钟**内保持 detached 并继续定时检查；超过 12 分钟仍查不到才标「没有保存下来」。
3. selfhost 的 `send()` 同样处理第 1 条。

## 五、不做

- 不关 Coolify 自动部署、不接 Coolify API、不建新 token。
- 不动 Haven。
- 不改 `turnBroadcast` 的缓冲 / 无人值守语义。
- 不改 UI 样式。

## 六、测试与验收

**自动（vitest，Linux 全量）**
- `serverDrain`（假时钟）：空闲立即退出（退出函数可注入，测试里不真退出）；有轮次时等待其结束；到 `DRAIN_TIMEOUT_MS` 调用 stop 再等 20 秒；重复信号幂等；标记写入与删除。
- 路由：排空时 `cc-chat` 新轮次 503、同 `request_id` 进行中轮次仍可接上；`health` 503；attach / stop 正常。
- 标记：新进程遇到新鲜标记返回 409 / deferred；过期标记被清理。
- 前端：503 / 409 自动重发同一 `request_id`；detached 在 12 分钟内不判未保存。
- `npm run build` 通过。

**线上（CC + 用户 iPhone）**
1. CC 在一轮里 push 一个无害提交，随后在同一轮继续跑约 5 分钟的命令并输出 → 这一轮完整结束、写进 Haven；Coolify 日志显示旧容器在轮次结束后才退出。
2. 构建期间用户发一条消息 → 正常回复（旧容器处理）。
3. 切换 / 排空期间用户发一条消息 → 灰色「正在切换」提示后自动重发，由新容器回复，无重复、无丢失。
4. 排空期间锁屏再解锁 → 仍能接上旧容器上的轮次或拿到 Haven 结果。

## 七、文档同步

- `docs/reference.md`：环境变量 `DRAIN_TIMEOUT_MS`；「cc 数据持久化契约」加排空与跨容器标记；`app/api` 行写 `health` 排空时 503、`cc-chat` 的 503 / 409 语义。
- `AGENTS.md`「Git 与部署」：push 后旧容器会等进行中轮次结束（上限约 10 分钟）再退出；Coolify Stop grace period 必须大于 `DRAIN_TIMEOUT_MS`。
- `docs/handoff/README.md`：本文件状态。

## 八、状态

- 2026-10-02：规格完成；用户已在 Coolify 将 Stop grace period 设为 600。待 Codex 执行。
- 2026-10-02 Codex：dashboard 实现完成，交付分支 `feat/deploy-drain`；未合并 main、未部署。已接入信号排空、跨容器运行态标记、前台/后台及 transcript 写入口门禁、前端原请求自动重发和 detached 等待；正式机制以 `docs/reference.md` 为准。
- 本地验证：最终 `npm run build` 通过（授权网络下载项目现有 Google Fonts）；Windows 全量 vitest 427 通过、2 失败、1 原有跳过。失败仅 `artifacts > lists newest first and ignores symlinks and other files` 与 `cc workspace 路径边界 > 工作模式内置 yanzhi files 目录；闲聊、未挂载和 symlink 挂载点都不加`，均创建符号链接时报 EPERM，未改动/跳过它们。新增排空、门禁、重试及空助手气泡渲染测试通过；`npm run start -- --help` 确认生产入口，新增文件引用及 diff 检查通过。独立 `tsc --noEmit` 仍有 29 条原有测试夹具类型错误，均在本次未修改的测试文件；生产 build 自带类型检查通过。
- 已知边界：Pro 自动化部署 503 的同次任务自动重试尚需 Haven 支持，未扩散实现；长期记录只放 `TECH_DEBT.md` 的 CC-09。
- 下一步由 CC 在 Linux 运行全量 vitest/build，再与用户 iPhone 按 §六 4 项实测（同轮 push 后继续工作、构建期间发消息、切流自动重发、锁屏恢复），确认 Coolify 实际日志和共享卷标记。只修 drain 验收问题，不改 Haven、聊天样式、广播缓冲或 main 部署设置；合并与部署须用户另行授权。验收后将索引标归档。
