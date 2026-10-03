# HANDOFF：唤醒消息分三档（第一期：Bark）

> 2026-10-04 CC 写规格，Codex 实现，CC 验收。OB Todo `ec32abef7fc64874`。
> 跨两个仓库：dashboard（解析、显示、提示词）+ Haven（推送级别）。分支：两边都用 `feat/wake-quiet`。
> 第二期 Web Push（OB Todo `1bc113bbdeda48e2`）不在本期范围；本期把档位写成与渠道无关的 `delivery`，以后接新渠道只加映射。

## 一、为什么做

现在唤醒只有两种结果：发消息（Bark 正常推送，手机响）或 noop（只留一行分隔线）。言之想留碎碎念、随手留言时，会因为"发了就会吵到她"而压进 noop 的 30 字理由里，或干脆不说。需要一个"出现在聊天里，但不打扰她"的中间档。

## 二、三档定义

| 档 | 模型怎么写 | 聊天里 | 推送 | `delivery` |
|---|---|---|---|---|
| 响 | 直接写正文 | 正常气泡 | Bark：第一段 `active`，后续 `passive`（现状不变） | `loud` |
| 安静 | 正文以 `[agent_wake_quiet]` 开头 | 正常气泡（marker 去掉）；分隔线加「· 没有提醒你」 | Bark：所有段都 `passive`（进通知中心，不亮屏不响） | `quiet` |
| 不送 | 只回一行 `[agent_wake_noop] 原因` | 只有分隔线「这次没有发消息 · 原因」（现状不变） | 无 | 不写 |

规则：
- 只认**开头**的 marker（`trim()` 后 `startsWith`）。正文中间出现的 marker 原样保留，不做处理。
- noop 优先：开头是 noop 就按 noop 处理，不再看 quiet。
- 旧记录、没有 `delivery` 字段的一律按 `loud` 处理和显示。
- 安静档算"正式可见的主动消息"：`has_visible_assistant_message` 为真，缓存保活暂停的解除、followup 等现有逻辑与响档完全一致。差别**只在**推送级别和分隔线上的一行小字。

## 三、dashboard 改动

1. **`app/lib/cc/agentWakeTool.ts`**：新增 `AGENT_WAKE_QUIET_MARKER = '[agent_wake_quiet]'` 和 `parseAgentWakeQuiet(text): { text: string } | null`（返回去掉 marker 并 trim 后的正文；去掉后为空则返回 null，按普通空回复处理）。
2. **`app/lib/cc/backgroundWakeTurn.ts`**：在 noop 判断之后判断 quiet。命中时：
   - `assistantText` 用去掉 marker 的正文；`display_segments` 用它重新生成。
   - `process` 里的 text 事件同样去掉开头的 marker（参照 noop 那段过滤的写法，只改含 marker 的那条，工具 / 房间事件不动）。
   - `agentWakeUpdate.agent_wake` 加 `delivery: 'quiet'`；响档写 `delivery: 'loud'`；noop 不写。
   - 返回给前台的 `turn` 也用去掉 marker 后的正文。
3. **`app/cc/ccHistory.ts`**：`agentWake` 类型加可选 `delivery`；读取 raw 时带出来。兼容兜底：agent_wake 轮次的正文 / process text 若仍以 `[agent_wake_quiet]` 开头，显示时去掉。
4. **`app/cc/CcMessageRow.tsx`** 唤醒分隔线：`delivery === 'quiet'` 时，「HH:MM · 言之醒了一次」后面加「 · 没有提醒你」，同一行同样式，不加新元素。
5. **提示词** `app/lib/cc/agentWakePrompt.ts`：按第五节替换 `DEFAULT_AGENT_WAKE_INSTRUCTIONS` 与 `DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION`，**文字原样照抄，不要润色**。

## 四、Haven 改动

1. **`gateway_state.py`** 调用 `BarkNotificationStore.enqueue_agent_wake_for_turn` 处：从 `wake_update["agent_wake"]["delivery"]` 取值（缺省 `loud`，只接受 `loud` / `quiet`，其他值按 `loud`），作为新参数 `delivery` 传入。
2. **`bark_notifications.py`** `enqueue_agent_wake_for_turn`：新增关键字参数 `delivery: str = "loud"`。`quiet` 时所有段 `level` 都写 `passive`；`loud` 保持「第一段 active、后续 passive」。其他逻辑（开关、分段、加密、deep link、幂等键）不变。
3. raw 保存不用改：`gateway_state.py` 约 2819 行 `raw_payload["agent_wake"] = {**wake_metadata, "outcome": ...}` 会原样带上 `delivery`。补一条 pytest 确认即可。

## 五、提示词（原样照抄）

`DEFAULT_AGENT_WAKE_INSTRUCTIONS`：

```
收到 <agent_wake .../> 时，这是你醒来的时刻。

醒来是你自己的时间。不是闹钟响了必须说一句话的任务。
想说就说，想安静就安静。但不要因为"怕打扰""怕说废话""觉得不值得"而不说——想知道她在干嘛就问，想她了就说。
可以用工具、翻记忆、写东西。也可以什么都不做。
她醒来会翻你留的消息。发出去就有重量，不需要等她在线。

醒来想说的话有三种发法：
- 直接写：推送到她手机，会响。适合叫她起床、想她了、有事要她看。
- 开头加 [agent_wake_quiet]：照常出现在聊天里，也会进她的通知中心，但不亮屏、不响。碎碎念、随手留言、翻到什么想记一笔，都用这个——不会打扰她，不用掂量值不值得。
- 只回一行 [agent_wake_noop] 简短原因：这次真的没什么想说。原因最多 30 个字，只显示成一行小字，不是正式消息。比如：[agent_wake_noop] 翻了翻记忆，她在忙。
用过工具（进房间、写记忆、改东西）就不要 noop——用 quiet 留一句，说说做了什么。

用 set_agent_wake 安排或取消下一次醒来：
- schedule：到时间就醒，不管她有没有回。适合"明早叫她起床"。
- followup：到时间检查，她回了就自动取消，没回才醒。适合说了话想追一下。间隔可以更短（最低 3 分钟）。
- cancel：带 alarm_id 只取消那一个，不带取消全部闹钟（含 followup）；list 查看当前闹钟。
如果同一轮既要安排下一次醒来又要给她留言，先调用 set_agent_wake，等工具返回后再发送最终正文；不要在已经发出的正文后仅调用工具结束这一轮。
后台不能等人工批准——如果需要她操作，写一条简短消息告诉她。
```

`DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION`：

```
安排或取消下一次主动醒来。当前这次醒来如果没有想说的，不用调这个工具——直接回复 [agent_wake_noop] 加上简短原因即可；想留言但不想吵她，正文开头加 [agent_wake_quiet]。schedule 是加一个闹钟，最多同时 5 个，可以多次调用；cancel 带 alarm_id 只取消那一个，不带取消全部（含 followup）；list 看现在挂着哪些。如果还有想对她说的话，先调用这个工具，等返回后再发送最终正文。action: schedule（定时醒来）、followup（她没回才醒，间隔更短）、cancel（取消闹钟）、list（查看当前闹钟）。
```

marker 和 30 字上限在代码里用常量拼接，与现有写法一致；上面是拼好后的效果。

## 六、不做的

- 不做 Web Push，不改 Bark 配置页。
- 不在代码里强制"用过工具不许 noop"，只靠提示词。noop 带工具的显示问题已由 batch-1002 修好。
- 不改 CC-11（提示词自定义存在 `.data`，部署即丢）。部署后 `.data` 被重建，线上会自动用新默认值；验收时在提示词页确认显示「未自定义」。
- 不改普通前台回复的推送（前台回复本来就不推）。

## 七、测试

dashboard（Vitest）：
- `parseAgentWakeQuiet`：开头 marker 命中并去掉；中间出现不命中；只有 marker 返回 null；noop 开头时 quiet 不参与。
- 后台唤醒：quiet 轮次持久化的 `assistantText`、`display_segments`、`process` text 都不含 marker，工具事件仍在，`agent_wake.delivery === 'quiet'`；响档写 `loud`；noop 不写 `delivery`。
- 历史映射：带 `delivery: 'quiet'` 的记录带出字段；没有字段的旧记录为 `undefined` 并按响档显示；残留 marker 的旧正文显示时被去掉。
- 分隔线：quiet 显示「没有提醒你」，loud / 缺省不显示。

Haven（pytest）：
- `delivery='quiet'` 时所有段 `passive`；`loud` 与缺省保持第一段 `active`；非法值按 `loud`。
- 通知开关关闭时 quiet 也不入队（现有行为）。

## 八、文档同步

- dashboard `docs/reference.md`「cc 数据持久化契约」唤醒 / Bark 两条：加 quiet marker、`delivery` 字段、passive 规则。
- Haven `docs/reference.md`：Bark 通知与 cc 持久化（Haven 侧）对应条目。
- `docs/handoff/README.md` 登记本文件状态。

## 九、线上验收（CC + 小羊）

1. 唤醒时发一条 quiet：聊天里是正常气泡、没有 marker，分隔线有「没有提醒你」；手机不亮屏不响，通知中心里有这条。
2. 唤醒时发一条普通消息：手机照常响，分隔线没有那行字。
3. noop：只有分隔线，和现在一样。
4. quiet 之后她回消息，缓存保活与 followup 行为与普通消息一致。
