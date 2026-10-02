# 技术债务 / 技术卡

> 给 AI 看的账本：代码层面的债务、刻意保留项和需要细节的技术卡。**不通读**——先看下面的索引，要处理哪张再 Grep 卡号（如 `CC-02`）定点读。
> 想做的功能 / 活记 OB Todo（一句话）；需要细节时在这里开卡，卡里写对应 Todo ID。已关闭的卡搬到 `docs/tech-debt-archive.md`，本文件只留还开着的。规则见 `MAINTENANCE_CONTRACT.md` 铁律 4。
>
> 状态：🟥 确认废弃可删 · 🟨 待确认 / 待决策 · 🟦 刻意保留（别当孤儿删）· ⬜ 未排期

## 索引

| 卡号 | 一句话 | 状态 | OB Todo |
|---|---|---|---|
| KEEP-01 | Dashboard `cc-test` / `cc-hook-test` 回归对比路由 | 🟦 | — |
| KEEP-02 | Haven `CLAUDE_PROMPT.md`、`docs/Tool Guide.md` 外部接入指引 | 🟦 | — |
| H-01 | Haven 内置单文件 `dashboard.html`（355KB）要不要继续维护 | 🟨 产品决策 | — |
| H-02 | Haven 根目录 `INTERNALS.md` / `BEHAVIOR_SPEC.md` 旧文档归档 | 🟨 随 Haven 文档梳理处理 | `9c6c8cedd0ca4860` |
| L-01 | 旧 session 诊断表补 profile 隔离 | ⬜ | — |
| MEM-01 | 待处理界面已删除，重启每日记忆人工审核时确认新入口 | 🟦 | `ccd4751631644fd9` |
| CC-02 | 缓存 usage 与中转站账单口径不一致 / 连续缓存写 | ⬜ | — |
| CC-04 | Agent SDK MCP `tool_result` 后的续写边界 | ⬜ | — |
| CC-05 | Polaris 导入旧 MCP 工具结果正文缺失 | ⬜ | — |
| CC-06 | 浏览器断开后中转站仍继续生成 / 计费 | ⬜ 前提已变，待重评 | — |
| CC-07 | selfhost 跨引擎后历史图片占 token 但模型看不见 | ⬜ | `e87e2e85c3d545e0` |
| CC-08 | Context GC 旧 Claude transcript 的有界保留 | ⬜ | — |
| CC-09 | Pro 自动化遇到部署 503 后缺少同次任务自动重试 | ⬜ | 待录 |
| T-01 | `dashboard-auth` 篡改末位字符用例偶发失败 | ⬜ | — |
| CC-P01 | UI 设置与聊天信息层级整理 | 产品候选 | `ea074ff139f64c54` |
| CC-P03 | 群聊 / 多协作者 | 产品候选（低优先级） | `b9ee09a407be43be` |

---

## 刻意保留

#### KEEP-01｜Dashboard 回归对比路由

| 项 | 说明 |
|---|---|
| `app/api/cc-test/route.ts` | 注释明确「第 1 步的 /api/cc-test 保持原样不动，出问题时回归对比」 |
| `app/api/cc-hook-test/route.ts` | 同上，hook 回归对比用 |

#### KEEP-02｜Haven 外部接入指引

| 项 | 说明 |
|---|---|
| `CLAUDE_PROMPT.md` | 给 Claude/ChatGPT 的行为指引，与代码文档是不同用途 |
| `docs/Tool Guide.md` | 粘贴给外部平台的使用指南 |

---

## Haven 待评估

#### H-01｜内置单文件 Dashboard

- `dashboard.html`（355KB）+ `dashboard_assets/` **仍在被使用**：`server.py` 的 `/dashboard` 路由服务它，README 也把它当正式 Dashboard 入口。
- 它是「后端内置单文件 Dashboard」，与 ob-dashboard2 **并存**。体积很大，是否继续维护 / 瘦身 / 用前端取代，是产品决策。

#### H-02｜旧开发文档

- `INTERNALS.md`（608 行，写「最后更新 2026-04-19」）、`BEHAVIOR_SPEC.md`（632 行，4/21 后未动）与 Haven 参考文档 / README 大面积重叠，建议归档到 `docs/`。随 Haven `docs/` 梳理一起处理。

---

## 长期遗留

#### MEM-01｜每日记忆人工审核入口

- 记忆库「待处理」界面及 `ReviewSection`、`PendingSection`、`AutoMemoryQueue.tsx` 已删除。Dashboard `/api/daily-chat-memory` 路由与 Haven 接口保留；每日自动记忆目前由 `legacy_daily_memory_paused` 暂停。
- 若重新开启 `review` 模式，先确认入口是否放到 OB Todo `ccd4751631644fd9` 的日视图，再实现界面。

#### L-01｜旧 session 诊断表补 profile 隔离

- `request_rounds`、`injected_buckets`、`injection_debug`、`recent_context_injections`、`upstream_usage`、`handoff_blocks` 只有 session_id；为避免跨 profile 误删，当前永久删除保留这些后台记录，后续迁移 profile_id 后再纳入清理。

---

## cc 任务卡（均未排期）

#### CC-09｜Pro 自动化遇到部署 503 后缺少同次任务自动重试

- Todo ID：待录。Todo 原句：让 Haven 的 Pro 自动化在 dashboard 部署排空返回 503 时自动重试同次任务（部署 drain 验收发现，详见 CC-09）。
- 证据：Haven `automation_model_runner.py::_call_pro_runner` 把非成功响应转换为 `AutomationModelError`，没有在此处理 `Retry-After`；不同于 wake 的 deferred 会由 `agent_wake_store.py::finish_run` 30 秒后重试。
- 影响：dashboard 排空拒绝开新模型任务，返回 `503 server_draining`、`retry_after_ms`、`Retry-After` 和 retryable，但当前 Haven 调用方会把这一执行记为失败；可人工重跑或等下一次正常调度，不保证补跑同一次。
- 暂不处理原因：本次规格明确只改 dashboard，不动 Haven。未来处理时必须在 Haven 加持久重试与幂等测试，避免重复执行日回顾/周轨迹。

> cc 前端 v1 主体已于 2026-08-09 收口。以后用户选中一张卡后，一次只处理这一张。
>
> **开工必读：**`AGENTS.md`、`MAINTENANCE_CONTRACT.md` + 被选中的这一张卡；涉及 Haven 才加读 Haven `AGENTS.md`。`HANDOFF-cc*.md` 都是历史档案，**默认不读**；只有卡片证据与现状冲突、需要追溯旧实验时才定点查。

#### CC-02｜缓存 usage 与中转站账单口径不一致 / 连续缓存写

- **状态：**未排期、停止付费盲测。曾出现 Dashboard 显示 cache write 33,227，而中转站记录 53,667，相差 20,440；连续数轮只有缓存写、没有缓存读。selfhost 当前没有主动发送 `cache_control`。
- **2026-09-02 补充：**foreground / background wake 的 Web 工具 schema 分叉已修复。wake 正常增量仍可能约 100–500 token（含上一轮 assistant、wake XML、thinking、tool block 等）；用户决定暂不做成本压缩，待稳定线上数据证明存在可观收益后再评估。
- **开工第一步：**先确认中转站现在能否查看原始 SSE usage 帧；若不能，只新增一条不含密钥、正文和附件的 usage 帧诊断，再用最少轮次复现一次。
- **定位入口：**`rg -n "cache_creation_input_tokens|cache_read_input_tokens|usage" app/api/cc-chat-selfhost app/lib/selfhost app/cc`，从 SSE 解析、usage 累计和持久化三个命中点中选择最小证据集。
- **待判定分支：**中转站计费口径不同；同一响应含多条非标准 usage 事件；解析器错误覆盖后值；上游没有缓存命中。没有原始帧前不选分支。
- **边界：**不记录请求正文、密钥或附件内容；不直接修改累计 / 覆盖规则；不把旧 cc 的 `getContextUsage()` 历史问题当成本问题；不安排无诊断的连续付费实验。
- **验收：**能用一组原始帧解释 Dashboard 与账单差异；若改代码，新增对应回归测试，并在最少真实请求中确认读写数字与选定口径一致。

#### CC-04｜cc Agent SDK MCP `tool_result` 后的续写边界

- **状态：**未排期。工具调用、`tool_result` 接收、界面展示、历史保存和最终回复可以完成；遗留表现是持久 `query()` / streaming input 路径可能让模型把工具后的续跑感知为额外空 user 消息，偶尔在正文中提及。
- **开工第一步：**先确认当前锁定的 Agent SDK 版本，并用一个只返回短结果的 MCP 工具复现；记录 SDK 原始事件顺序，区分“真实多了一条输入”与“模型对 synthetic tool result 的表达”。
- **定位入口：**先读当前安装 SDK 的本地类型 / 版本说明，再 `rg -n "streamInput|tool_result|synthetic|process" app/lib/ccSession.ts app/api/cc-chat app/lib/cc`。
- **边界：**禁止发送 `"."`、空格或其他可见伪 user 消息；不为了这个现象提前重做 query 生命周期；不改变 MCP 结果的 20,000 字持久化上限和工作工具不保存大结果的规则。
- **验收：**同一轮工具返回后自动继续，模型正文不再提及额外空消息；事件时间线、工具结果弹窗、历史恢复和失败回收均保持正确。

#### CC-05｜Polaris 导入保真度：旧 MCP 工具结果正文缺失

- **状态：**未排期。当前导入承诺用户 / 助手对话正文，并能还原 thinking、中间回复和工具调用；Polaris 导入前历史中的 `breath`、`read_bucket` 等 MCP 工具返回正文没有进入续聊模型上下文。
- **开工第一步：**取得一份确实包含旧工具结果的原始 Polaris 导出样例，确认结果正文存在于哪个 store / 字段；没有样例时不改映射。
- **定位入口：**`rg -n "polaris|tool_result|thinkingText|conversation_import_archives" app/cc app/api app/lib`；确认前端导入映射后，涉及 Haven 原始归档 / 重放才读 `gateway.py` 对应 import route。
- **产品决定：**先让用户选择“只在界面还原”还是“续聊时也送进模型上下文”；两者 token、隐私和历史预算影响不同，不能默认同时做。
- **边界：**不覆盖已导入的原始 JSON；重复导入仍必须幂等更新原 session；不把旧 system 消息注入当前协作者系统提示；不顺带迁 ZIP 图片。
- **验收：**真实样例重导不产生重复会话，工具结果按已选产品口径可见 / 可用，原有 27 对话 / 587 轮的顺序和正文不回退。

#### CC-06｜浏览器断开后中转站仍继续生成 / 计费

- **2026-10-02 前提已变：**cc 引擎轮次不再随浏览器断线取消（`HANDOFF-cc-turn-survives-disconnect.md`），断开后照常生成并写 Haven，只有停止按钮 / 30 分钟无人值守会取消。本卡下面描述的是旧行为，仅 selfhost 引擎仍按断连取消；重开时先确认本卡是否只剩 selfhost 范围。
- **状态：**应用侧已完成，供应商侧能力受限。Dashboard/Vercel 已能在关闭标签页后取消消费、阻止 Haven 持久化并保证下一轮不冲突；真实测试中中转站仍生成约 4,137 输出 token，说明它没有把下游断连继续传播给模型上游。
- **开工第一步：**先由用户在中转站控制台确认是否提供“客户端断开传播”或“按 request ID 取消”能力及真实字段 / 路径。若平台不支持，本卡直接保持接受状态，不继续改 Dashboard。
- **允许方案：**中转站支持时，设计 request ID 透传和取消调用；若只能依赖 HTTP 断连，则先用最短请求验证平台确实传播，再决定是否接入。
- **边界：**不再重复增加 Dashboard AbortController；不以“不写入 Haven”冒充“已停止计费”；不进行长输出付费复测，除非已有可验证的供应商取消能力。
- **验收：**关闭页面后 Dashboard 不保存、不冲突，同时中转站账单 / 日志明确显示上游生成提前终止；两部分必须分别成立。

#### CC-07｜selfhost 跨引擎后历史图片占 token 但模型看不见

- **关联 OB Todo：**`e87e2e85c3d545e0`「现在清除图片不起效」可能与本卡同源，开工时一起确认。
- **状态：**已确认并接受保留。连续 selfhost 对话能看到历史图片；但“selfhost 发图 → cc 对话 → 切回 selfhost”时，图片仍在 Haven、仍占输入 token，模型却声称看不见。清除图片后 cache creation 从约 12k 降至 8.5k，证明图片确实被选入上下文。
- **开工第一步：**用一个最小窗口重现，并抓取脱敏后的实际 `/v1/messages` 出站 content block 顺序；分别对照无 cc 中间轮次和有 cc 中间轮次两种路径。
- **定位入口：**`rg -n "image|attachment|recent.*2|base64" app/api/cc-chat-selfhost app/lib/selfhost app/lib/havenAttachments.ts`，先确认 Dashboard 组装，不先猜中转缓存或模型行为。
- **边界：**不把历史图片强行搬到最新 user message；不新增自动 / 手动重附加 UI；不改变只重放最近 2 个 selfhost 图片轮次、清除语义或 Haven 私有附件规则，除非新产品决定另行确认。
- **验收：**相同模型 / Provider 在插入 cc 轮次后仍能识别历史图，且图片 token、清除、刷新、换设备和历史缩略图不回退。

#### CC-08｜Context GC 旧 Claude transcript 的有界保留

- **状态：**首版为安全回退暂不自动删除。每次窗口减负会保留原 Claude transcript；Haven 最近 20 条 GC 历史只限制日志，不会删除本地旧文件，长期频繁使用会增加本机 `.claude/projects` 存储。
- **开工第一步：**先由用户确认保留口径（例如每个 lane 最近 3 份或 30 天），并确认是否需要 UI 一键回退；在回退能力验收前不自动删。
- **边界：**只允许删除 Haven GC 历史明确记录、且已不是任何 `cc_lanes_json.cc_session_id` 当前指针的 fork；不得按目录时间批量删除未知 Claude 会话，不删除 Dashboard `conversation_turns` 或附件。
- **验收：**超过保留口径的非活动 GC 副本可审计地清理，当前 lane、可回退副本、普通 Claude Code 会话和 Dashboard 历史均不受影响。

#### T-01｜`dashboard-auth` 篡改末位字符用例偶发失败

- **现象：**`tests/dashboard-auth.test.ts`「compares login input and verifies only authentic, unexpired sessions」约三成概率失败。token 随机生成，用例把最后一个字符换成 `x`/`y` 再断言验签失败；base64url 末位含不参与解码的填充位，换掉后可能解出同样的字节，验签仍通过。2026-10-01 Linux 全量连续复现，单跑与 main 上同样偶发，与当时改动无关。
- **修法：**改为篡改签名中段字符（或解码后翻转一个字节再编码），不动鉴权实现。
- **验收：**该用例连续跑 20 次全部通过。

## cc 产品候选卡（尚未形成实施窗口）

> 这些是增强候选，不是 v1 欠账。选中后先做产品定案；定案前不改代码。

#### CC-P01｜UI 设置与聊天信息层级整理

- **OB Todo：**已并入 `ea074ff139f64c54`「UI 重构（含工作台优化）」。
- **2026-09-27：**已定案，执行计划见 `docs/handoff/HANDOFF-ui-redesign.md`。主题 / 字体 / 字号属于阶段 1，聊天页信息层级属于阶段 2，分开做。
- **现状：**聊天页已有 `--chat-*` 和全局设计 token；引擎、模型、上下文、usage 信息已可用，但整体信息偏多，用户目前接受现状。
- **边界：**跨设备需要保留的设置存 Haven；换设备丢失也没关系的纯界面偏好才可存浏览器。涉及全局 token 时必须同步 `DESIGN.md` 与 `globals.css`。
- **验收：**由产品定案时补写；没有定案前不继承旧 handoff 中的草案。

#### CC-P03｜群聊 / 多协作者

- **OB Todo：**`b9ee09a407be43be`（低优先级，先放着）。
- **现状：**未实现。cc 引擎一个窗口对应一个 SDK session / 子进程，不能直接照搬 Polaris 的多协作者轮流发言；selfhost 是否支持也未定案。
- **第一步：**先确定只做 selfhost 还是要求 cc/selfhost 都支持，并确定发言顺序、共享历史、Persona 归属和单轮写库模型。
- **边界：**这是数据结构和用户体验高风险功能；未完成产品 / 存储契约前不写 UI，不把“多个 Persona 可配置”误当成“群聊已经有底座”。
- **验收：**产品与数据契约定案时补写。

---

## 排查注意事项（每次动 TECH_DEBT 里的项之前）

1. **查引用用 grep，不信记忆**：删文件前 `grep -rn "名字" app --include=*.tsx`，确认 0 引用。
2. **动态拼接要防**：有的 route 被 `fetch(\`/api/${x}\`)` 动态调用，grep 字面串会漏。确认时连 `lib/`、`cc/`、动态模板串一起查。
3. **注释不是引用**：cc-test 只被 cc-hook-test 的注释提到，算 0 引用。
4. **后端还在服务的文件≠废弃**：dashboard.html 就是反例，查 `server.py` 路由再下结论。
