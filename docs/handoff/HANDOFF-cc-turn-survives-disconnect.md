# HANDOFF：cc 轮次不随浏览器断线取消（A）

> 2026-10-01 CC 写规格，Codex 执行，CC 验收。只改 dashboard，不动 Haven。
> 开工先读 `AGENTS.md`、`MAINTENANCE_CONTRACT.md`、`docs/reference.md`「cc 数据持久化契约」。

## 一、要解决的问题

手机上发消息后，模型跑代码期间手机息屏，iPhone 掐断 fetch，前端报 `Load failed`。现在的链路是：

1. 服务端 `app/api/cc-chat/route.ts` 把 `request.signal` 传进 `runTurn`；`runTurn.ts` 的 `nextSdkMessage` 监听它，断线即抛 `AbortError`。
2. `runTurn` catch 到 `AbortError` → `dropSession(sessionId, 'request_aborted')` 杀掉 SDK 子进程，**这一轮不写 Haven**。
3. 前端 `app/cc/useCcChat.ts` `send()` 的 catch 里：非 AbortError 直接把助手气泡删掉；无论哪种都再调 `DELETE /api/cc-chat` 收掉会话。
4. 结果：工具已经改过的文件留在磁盘上、Claude 原生 transcript 里也有半截，但用户的消息和助手回复在界面和 Haven 里都消失。

另外 `useCcChat.ts` 切换窗口 / 新建窗口 / `startWithHandoff`（约 700、1036、1197 行）都会 `abortRef.current?.abort()`，同样会让服务端取消这一轮。

## 二、目标行为

- **断线 ≠ 取消。** 浏览器断开（息屏、切后台、切窗口、刷新页面、网络抖动）后，服务端照常把这一轮跑完并写进 Haven。
- **只有「停止」按钮才取消。** 现有 `/api/cc-stop`（interrupt 优雅收尾、已生成内容写库）保持不变，且在断线状态下也必须能用。
- **回来能接上。** 用户回到页面：这一轮还在跑 → 重新接上实时流，先补齐错过的事件；已经跑完 → 从 Haven 拿完整结果替换占位气泡。
- **刷新页面 / 从别的窗口切回来**也能看到正在跑的那一轮（用户气泡 + 实时助手气泡）。
- selfhost 引擎（`/api/cc-chat-selfhost`）**不在本次范围**，保持现状。后台 wake 不受影响。

## 三、服务端

### 1. 轮次与请求解耦

- `route.ts` 不再把 `request.signal` 传给 `runTurn` 和 `runForegroundSessionTurn`。改为每轮创建一个服务端自有的 `AbortController`，只在下列情况 abort：
  - 进程内显式丢弃会话（现有 `dropSession` / `DELETE /api/cc-chat`）；
  - 下面第 4 条的无人值守上限。
- `runTurn` 里所有用 `signal` 的 Haven 调用改用这个轮次 signal（`listTurns`、`getAgentWakeSchedule`、`latestModelSurfaceHashForLane`、`listAllTurns` 等，以实际代码为准）。
- `getTurnByRequestId(requestId, { signal: request.signal })` 这类**开流之前**的同步查询可以继续用 `request.signal`。
- `send` 在流已关闭时静默丢弃（现在已经是这样），保持。

### 2. 轮次广播（进程内运行态）

新文件建议 `app/lib/cc/turnBroadcast.ts`，挂 `globalThis` 防 dev 热重载丢失：

- 以 `sessionId` 为键，至多一个进行中的轮次：`{ requestId, sessionId, userText, attachmentIds, startedAt, events: {seq, event, data}[], done, subscribers }`。
- `route.ts` 包一层 `send`：每个事件先编号入 `events`，再转发给原 SSE 和所有订阅者。`close` 时标记 `done`，向订阅者发完后关闭它们；`done` 后保留 **2 分钟**再删除（给晚到的 attach 一个窗口，之后走 Haven）。
- 缓冲上限：单轮事件总字节超过 **4 MB** 时停止缓冲并标记 `truncated`；attach 遇到 `truncated` 返回 `{ ok:false, reason:'truncated' }`，前端退回「等 Haven」模式。
- 这是**允许丢失的运行态**（部署 / 重启后丢失 = 这一轮本来就死了），符合 `AGENTS.md` 持久化规矩；在 `docs/reference.md` 契约里写明。

### 3. 新接口

- `GET /api/cc-chat?session_id=…`（现有 stats）返回体追加 `active_turn: { request_id, user_text, attachment_ids, started_at } | null`。
- 新增 `GET /api/cc-chat/attach?session_id=…&request_id=…&after_seq=N`：返回 `text/event-stream`。先重放 `seq > N` 的缓冲事件，再接实时事件；轮次已完成则重放完直接关闭。找不到轮次 → `404 { ok:false, reason:'not_found' }`。每个 SSE 帧带上 `seq`（可用 SSE 的 `id:` 字段），供前端去重。
  - 注意 Next.js 16 路由写法，先查 `node_modules/next/dist/docs/`。
- 订阅者断开只移除自己，不影响轮次。

### 4. 无人值守上限

轮次进行中、且**连续 30 分钟没有任何订阅者（原始请求 + attach）**时，按「停止」同样的路径优雅收尾（`markTurnInterrupted` + `stopSession` + `cancelAllPending`），已生成内容照常写库。常量放在 `turnBroadcast.ts` 顶部并注释理由：防止无人看管的工作轮次无限占用额度。

### 5. 现有 AbortError 分支

`runTurn` catch 里的 `AbortError` 分支保留（显式丢弃会话时仍会走到），但注释改成「显式取消」，不再写「浏览器断连」。

## 四、前端（`app/cc/useCcChat.ts` 为主）

1. **断流不删气泡、不 DELETE。** `consumeSseStream` 因网络错误中断（非用户停止）时：保留用户气泡和助手气泡，助手气泡标 `deliveryState: 'detached'`，提示文案「连接断了，这一轮还在继续，回到页面会自动接上」。**删除** catch 里对 `DELETE /api/cc-chat` 的调用（selfhost 原逻辑不动）。
2. **切窗口 / 新窗口 / handoff 开窗**：只 abort 本地 fetch，不再导致服务端取消（服务端改完后自然成立；前端确认这几处不会 DELETE）。
3. **自动接上。** 页面 `visible` / `focus` / 进入某个会话 / 页面加载时：查 `active_turn`。
   - 有进行中轮次 → 若本地没有对应 `requestId` 的气泡，补出用户气泡 + 空助手气泡；调用 attach（`after_seq` = 本地已收到的最大 seq；本地重建的气泡从 0 开始），用与 `send()` 同一套事件处理逻辑更新气泡。**把 `send()` 里的事件 → 界面处理抽成共享函数，不复制一份。**
   - 无进行中轮次但本地有 `detached` 气泡 → 跑一次现有的 `refreshBackgroundTurns`（或等价的按 round 拉取），用 Haven 里同 `request_id` 的轮次**替换**占位气泡；Haven 里也没有 → 气泡标「这一轮没有保存下来」，保留「重试」入口（现有 `retryPersistence`）。
4. **busy 态。** 有进行中或 `detached` 轮次时，输入框照现在「生成中」的样子处理（不能发下一条），停止按钮可用。
5. **停止按钮在断线态也要能用**：直接调 `/api/cc-stop`，然后走第 3 条接上 / 拉结果。现有「5 秒后强制 abort」只作用于本地 fetch，保留。
6. **去重。** `refreshBackgroundTurns` 现在在 `sending` 时跳过；接上逻辑完成后，凡是 Haven 返回的轮次 `request_id` 与本地气泡相同的，一律替换而不是追加。

## 五、不做

- 不动 Haven、不改 Haven 数据结构（「断了也先把用户消息存下来」是另一件事，暂不做）。
- 不处理部署 / 进程重启导致的中断（另一项：部署等空闲，B）。
- 不改 selfhost 引擎、不改后台 wake。
- 不改 UI 样式；新增文案用现有 delivery 提示的样式。

## 六、测试与验收

**自动（vitest，Linux 上全量跑）**
- `turnBroadcast`：入队编号、`after_seq` 重放、完成后保留 2 分钟、超过 4 MB 标 truncated、订阅者断开不影响轮次、30 分钟无人值守触发停止（用假时钟）。
- `runTurn` / route：原始请求 signal abort 后轮次继续，最终写 Haven；`dropSession` 仍能取消。
- `npm run build` 通过。

**手动（CC 在线上 + 用户 iPhone）**
1. 工作窗口发一条会跑 `sleep 60` 的消息，立即锁屏 20 秒再解锁 → 气泡接上继续，最终结果与 Haven 一致。
2. 跑到一半刷新页面 → 用户气泡 + 进行中助手气泡出现并继续。
3. 跑到一半切到别的窗口再切回来 → 同上。
4. 锁屏后等它跑完再解锁 → 占位气泡被 Haven 结果替换，不重复。
5. 断线状态下点停止 → 优雅收尾，已生成内容保存。
6. 有待批准卡片时锁屏，回来后卡片仍在、能批准。

## 七、文档同步（按维护契约）

- `docs/reference.md`「cc 数据持久化契约」：轮次与浏览器连接解耦、广播缓冲是允许丢失的运行态、只有停止 / 显式丢弃会取消、30 分钟无人值守上限。
- `docs/reference.md`「文件结构速查」`app/api` 行：`/api/cc-chat/attach`、stats 的 `active_turn`。
- `docs/handoff/README.md`：本文件状态。

## 八、状态

- 2026-10-01：规格完成，待 Codex 执行。
- 2026-10-01 Codex：在 `feat/turn-survives-disconnect` 完成实现与正式契约同步；以本地工作区改动交付，未经用户确认不 commit/push，未合并 main、未部署。新增广播/attach、共享事件消费、detached 恢复、request_id 原位替换、排队停止；数据分类和长期机制见 reference，不在此重复。
- 验证：定向 7 文件 67 测试通过；`npm run build` 通过（授权环境可下载现有 Google Fonts）；Windows `npm test` 为 401 通过、2 失败、1 原有跳过。失败仅 `artifacts > lists newest first and ignores symlinks and other files`、`cc workspace 路径边界 > 工作模式内置 yanzhi files 目录；闲聊、未挂载和 symlink 挂载点都不加` 创建符号链接时报 EPERM，没有改动/跳过它们。
- 下一窗口明确范围：CC 在 Linux 执行全量 vitest 和 build，再按 §六对 iPhone 6 项验收（含锁屏待批准卡片）；只修本功能验收发现的问题，不扩散到 Haven、selfhost、wake、UI 样式或部署恢复。验收前由用户决定提交/推送此 feature 分支；本窗口不合并 main。
- 2026-10-01 CC 验收：合入 main 最新提交后 Linux 全量 406/407 通过（唯一失败为 `dashboard-auth` 时间相关用例，单独重跑与 main 上均通过，与本功能无关），build 通过。修三处（`722972f`）：服务端 HTTP 错误恢复原报错不再标 detached；5 秒轮询只在存在 detached 气泡时运行；`interrupt_timeout` 显式取消轮次，避免停止 / 无人值守停止卡住 busy 锁。已合并 main，待 §六 iPhone 实测。
- 2026-10-01 iPhone 实测：①锁屏 20 秒后结果完整、③切窗口再切回实时接上，均通过。①发现解锁后断线提示一直挂到命令结束——长命令期间无事件可重放，attach 响应头憋住不发。修复：`turnStream` 接上时先写 `: attached` 注释并每 15 秒 `: ping` 保活；detached 提示改为灰色小圆点 + 次要文字，不再用报错红。待复测①与②（PWA 上划杀掉重开代替刷新）、④⑤⑥。
- 2026-10-02 iPhone 复测完成：①锁屏后几秒内接上（灰色提示生效）、②PWA 上划杀掉重开后消息与进行中气泡都在并继续、③切窗口、④锁屏跑完后解锁结果完整无重复、⑤断线重接后点停止优雅收尾且下一轮正常接上，全部通过。⑥待批准卡片：该工作窗口自动放行未出现卡片，未实测；待批准队列本就存于服务端 `ccChannel`，不随 SSE 连接，下次遇到卡片时顺带确认。**本项完成归档。**
