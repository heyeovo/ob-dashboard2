# GPT 订阅聊天 UI 交接

更新：2026-11-15。窗口 3 本地实现与自动检查完成；用户已明确回复“推”，授权下列 24 个文件 commit + 普通 push，随后进入窗口 4 集成与真实环境验收。最终提交 SHA 与远端核对结果以 Git 和本聊天收尾为准。未合并、未部署。

## 版本与文件边界

- 目录：`C:/Users/yangh/projects/gpt-subscription-window3/dashboard`；分支：`feat/gpt-subscription-chat-window3`。
- 已依次快进引入窗口 2 固定提交 `46d9a126f64e089307223899f7b070ccde85bf61` 和代理补件 `95a0bd242323e9aefb4b76205afc8f59c14b0b12`。均无冲突，保留窗口 3 原有修改，没有重复应用 runner。
- 用户给定 Haven 交付目标为 `ea52a9d87f0a63e5281965152cf7becb75239be8`；本窗口未修改 Haven、原始工作目录或窗口 2 目录。
- 本窗口仅编辑 app/cc（排除 types.ts）、UI 定向测试和本独立 handoff。相对 95a0bd2，app/lib、app/api、types.ts 无本地差异。中央 handoff/索引/reference 仍归窗口 2/最终集成维护者。

## 已实现与产品决定

- 线路为 `gpt_subscription`。远程模式明确选择 GPT 时保留该选择；原 CC/selfhost 远程规则不变。切换前拦截工作模式、草稿附件、待批准工具和未结束/保存不明轮次；确认文字能力边界后才切换。已有工具、联网和 wake 配置保留，明确说明 GPT 不执行。
- 用户最终确认的界面：原“本窗口设置 → 引擎”的 cc / 自建 旁增加 GPT；选中后复用原“模型”下拉框，选择即调用 session-settings 保存，不增加独立保存按钮。已撤掉此前多做的授权卡和独立模型保存区域；CC/selfhost 设置不出现 GPT 状态区。
- 每窗口模型以 Haven 为事实源，保存成功才更新已保存值；失败时原下拉框保留原选择，并在原提示区报错。重开 GPT 窗口重新读取 Haven，新窗口清空选择。下拉仅使用当前账号真实目录；已保存模型若不在目录中仍展示原值并禁用发送，不自动回退或编造模型。GPT 不需要到“模型与中转站”手填模型或中转配置，原 CC/selfhost 配置不变。
- `useGptConnection.ts` 只读取同源 Cookie 代理的 connection GET 和 models GET；不读取登记列表，也不提供授权选择/断开操作。浏览器不持有或发送 Gateway Bearer。状态、模型和错误使用共享 types.ts 导出类型；只作内存展示，不另存授权配置。
- 状态区分未读取、读取失败、未配置、未连接、处理中、需重授权、共享未开启和已保存授权。配置/存储 error 优先于 connected 标签；“已保存授权”不冒充真实模型调用已成功。缺失额度为未知，额度异常提示到 ChatGPT 设置检查。
- 授权状态仅在选择 GPT 后显示一行，附刷新操作；异常时显示必要的配置/重连提示。用户已明确选择最小复用界面，不提供单独授权管理面板，不将选择/断开授权记成后续待做 UI。窗口 2 已有后端管理代理保持不变。
- 登录/重连指引为电脑专用管理工具 + SSH 安全交接；手机不能直接完成服务器授权，无 token 输入、伪登录按钮或虚构连接。存储故障要求先修配置并保留原文件。
- `useGptChat.ts` / `gptChatUi.ts` 接发送、GET 活跃/接回/保存核对、精确 DELETE 停止。按 Content-Type 同时处理 SSE 与 JSON 快照，按事件序号去重，同 request_id 原位替换并保留 renderKey；完整重放替换正文，不重复追加。
- 仅 outcome=completed 为正常完成；cancelled/failed 即使保存成功仍标中断。停止只是取消请求，等服务器确认保存后才标记结果。缓冲丢失额外核对 Haven 历史，不重新生成。授权/共享等流中错误会触发状态刷新；部分失败回复保存后仍保留可操作错误原因，刷新历史也保留。
- `gptRetryRequest` 保留完整原 body；`gptRetryDraft.ts` 在 sessionStorage 保存本标签页临时请求副本，以支持刷新后明确核对/重试。副本仅含 GptRequest，不含令牌；不是模型偏好、授权或已保存历史的事实源。严格保存成功才按匹配 ID 清除。存储不可用时仍有内存副本；跨设备/副本丢失仅 GET 核对，不重建 body 或自动换标识生成。无法恢复的草稿需核对历史后新建窗口继续。
- `ccHistory.ts` 识别 GPT source、ob2-gpt 协作者、native usage/outcome，保留空的中断助手轮次；不当作 Claude 模式锁或原生 session。消息始终标来源；nullable GPT 用量不转换成 Claude 成本、Pro 余量或缓存统计。
- 顶栏/设置/消息不显示虚构 thinking、工具权限或精确上下文上限。GPT 隐藏旧 CC 批准卡和自动放行控件；旧 CC 行为不变。设置内保留独立滚动上下文入口，其余 CC 专有能力显示不支持。
- 输入区禁用添加/粘贴/拖放附件并保留旧草稿附件；发送前再次拦截。GPT 不走小红书附件加载分支，不静默清除附件或调用旧引擎。
- 设置复用原布局和控件，GPT 显示引用现有 Token；模型 select 16px、必要操作至少 44px、窄屏可换行。没有新增页面、共享设计 Token 或页面其他区域改动。

## 验证与明确限制

- 最终定向回归：14 文件 / 97 项通过。命令：`node node_modules/vitest/vitest.mjs run tests/gpt-chat-lifecycle-ui.test.ts tests/gpt-chat-ui.test.ts tests/gpt-retry-draft-ui.test.ts tests/cc-gpt-connection-ui.test.ts tests/gpt-connection-lifecycle-ui.test.ts tests/gpt-connection-proxy.test.ts tests/cc-engine-routing.test.ts tests/cc-history.test.ts tests/cc-turn-recovery.test.ts tests/cc-sse-consumer.test.ts tests/display-segments.test.ts tests/cc-session-settings-route.test.ts tests/gpt-contract.test.ts tests/gpt-engine-boundary.test.ts`。
- 覆盖原请求重试/刷新副本、序号去重、SSE/JSON、正常/取消/失败、保存不明、额度与认证提示、附件/工作模式拦截、精确停止及失败、连接错误优先级、真实模型目录、代理字段边界、旧线路/历史回归，以及真实 CcWindowSettings 的 SSR：单一原模型下拉、无独立授权卡/保存按钮、CC/selfhost 无 GPT 状态区、保存失败保留原值。读取过期返回不会再加载旧账号模型。
- UI 生命周期测试使用 SSR 挂载真实 hook 后调用方法，配合合成 SSE/JSON 和模拟 fetch；不是浏览器、真实账号或真实 Haven 联调。模型保存接口的回归来自现有 route 测试，浏览器交互和跨设备恢复仍需验收。
- 复用原控件的最终 `npm run build -- --webpack` 通过，含 TypeScript 与 95 页生成。`git diff --check` 通过；撤掉的两个组件已无源码引用。默认 Turbopack 受外部 node_modules 链接限制；没有改构建配置或安装依赖，只复用已有依赖。
- 独立 `tsc --noEmit` 会报告本次未修改的旧测试类型错误；构建类型检查通过不代表全仓测试 TypeScript 全部通过。
- 没有完成手机视觉/交互实测。早先 IAB 本地预览连接超时，本机 Chrome 控制随后返回未授权，均停止尝试。用户询问是否必须预览后已说明可以跳过，不为此阻塞代码交付；临时预览脚本已删除，端口 3183 未发现监听。
- 尚未验证真实账号、完整 Haven→Gateway→模型多轮、跨设备、手机、Linux/Docker、VPS、真实刷新/撤销或部署。没有迁移凭据或访问 .private-connection。本次不用部署。

## 窗口 4 验收与文档承接

- 无待接代理接口；本地代码部分已齐。窗口 4 审阅后集成两个分支，不在本窗口合并 main。
- 手机验收：原入口选择 GPT→原模型下拉选择即保存→发送→流式→断网/刷新接回；停止保留部分回复；认证/共享/额度/取消/保存失败提示；模型跨设备恢复；已有附件/wake/工作模式保护；旧 CC/selfhost 切回。
- Linux、Docker、真实授权导入/刷新/撤销、重启恢复和 VPS 部署继续遵守中央 handoff 的单独授权边界。
- 已按维护契约核对；本窗口不改中央正式文档。最终集成维护者承接 reference/architecture 中 UI 恢复与临时请求副本边界的正式事实同步，以及中央 handoff/索引状态。没有新页面、共享组件约定或 Token，无需同步对应条目。
- OB Todo 仍沿用中央 handoff 原有一句话任务，由最终验收后处理；本窗口不另建重复 Todo，不把明确待验收工作记成技术债。

## 用户已确认的提交清单

仓库：本窗口 dashboard；分支 `feat/gpt-subscription-chat-window3`。仅以下 24 个本窗口文件，不包含 window2 已提交的后端文件。

```text
app/cc/CcChatComposer.tsx
app/cc/CcChatMetrics.ts
app/cc/CcChatOverlays.tsx
app/cc/CcComposer.tsx
app/cc/CcGptUsage.tsx
app/cc/CcMessageRow.tsx
app/cc/CcMessageStream.tsx
app/cc/CcTopbar.tsx
app/cc/CcWindowSettings.tsx
app/cc/ccHistory.ts
app/cc/engineRouting.ts
app/cc/gptChatUi.ts
app/cc/gptConnectionUi.ts
app/cc/gptPresentation.ts
app/cc/gptRetryDraft.ts
app/cc/useCcChat.ts
app/cc/useGptChat.ts
app/cc/useGptConnection.ts
tests/cc-gpt-connection-ui.test.ts
tests/gpt-chat-lifecycle-ui.test.ts
tests/gpt-chat-ui.test.ts
tests/gpt-connection-lifecycle-ui.test.ts
tests/gpt-retry-draft-ui.test.ts
docs/handoff/HANDOFF-gpt-subscription-chat-ui.md
```

提交消息：`feat: add GPT subscription chat using existing controls`。用户已确认上述精确范围，执行 commit + 普通 push 后用 ls-remote 核对；授权不覆盖合并、push main、改写历史或部署。
