# 技术债务归档

> 从 `TECH_DEBT.md` 搬出的已关闭项，只作追溯。按关闭时间倒序追加。

## 2026-09-27

### ✅ Dashboard 死代码清理与测试恢复

- 已删：4.6 导航重构死代码（`NavBar`、`MobileViewSwitch`、`app/chat/`、`app/review/` 及随之成为孤儿的 `api/review-status`）、孤儿 route（`api/provider-relay`、`api/mcp-relay`）、根目录调试残留（`cookiejar.txt`、`test.txt`、`tmp_headers.txt`）。需要回退从 git 历史取。
- 测试恢复全绿（352 项）：召回规则 / 召回透镜文案两处断言对齐 9.13、9.20 的有意改动；滚动冷启动测试改用真实临时 cwd（Windows 假路径在 Linux 上与 SDK 算出不同 project key，生产不受影响）；登录篡改断言修掉末位恰为 `x` 时的随机失败。原「display_segments.version」断言项早已不再失败。

### ✅ Haven `state/`、`data/` 目录是否被 git 跟踪

- 已查实：两个目录都在 `.gitignore`（`state/`、`data/`），`git ls-files` 为 0，不存在把运行态提交进仓库的风险。

### ✅ 未接入功能 / 长期遗留中已关闭的项

- **LLM 自动唤醒**：已由 Dashboard 侧 CC Agent Wake 实现并日常使用（2026-09-01 跑通，Bark 推送），不再走原设想的 Haven 服务端调度。事实源见 `docs/handoff/HANDOFF-cc-agent-wake.md`；唤醒时段自定义等后续需求在 OB Todo。
- **重新脱水（redehydrate）**：现在基本由协作者直接写桶，不走脱水，不再需要。
- **控制台配置页**：Haven 已有 `settings/*` 配置子页，视为已实现。
- **自动备份**：VPS B2 每日备份已上线（见 `HANDOFF-cc-VPS迁移.md` §21）。
- **情感唤起罗盘**：用户决定暂不做。

#### ✅ CC-03｜cc 引擎 + 部分 Kiro 模型 `Invalid tool use format`（2026-09-27 关闭）

- **关闭原因：**用户已不再使用 Kiro 模型，cc 引擎主要走 Pro 订阅；以后若换回并复现，按下面的旧记录重开。
- **原状态：**未排期。localhost 的 cc 引擎曾在同一中转站 / 模型下返回 `400 REQUEST_BODY_INVALID / Invalid tool use format`，而 selfhost 成功。selfhost 10.6 中“空工具说明导致 breath 400”已经解决，不能把两者视为同一个问题。
- **开工第一步：**请用户用当前部署重新确认是否仍能复现，并提供本次模型、启用工具集合、错误时间和完整错误码；能在 1 分钟内人工确认时，不先追代码。
- **定位入口：**若仍复现，先对照同端点 cc / selfhost 的实际工具清单和 schema；`rg -n "mcpServers|strictMcpConfig|disallowedTools|Invalid tool use" app/api/cc-chat app/lib`，只读决定工具注入的最小文件集。
- **边界：**不修改 selfhost 已验收的 10.6 工具循环、thinking、权限或持久化；不预设是 Kiro、中转站或 SDK 的责任；不靠删工具长期规避。

#### ✅ CC-P04｜花费单价表（2026-09-27 关闭）

- **关闭原因：**用户决定不做。
- **原记录：**每轮已有 Provider usage；历史 `total_cost_usd` 可能使用不同中转站 / 模型口径，不能直接相加冒充统一成本。若重开，先定单价来源（手填 / Provider 接口 / 静态表）和“中转站 × 模型 × 生效时间”版本规则；不回算无可靠单价的旧历史，未知单价显示未知而非 `$0`。

#### ✅ CC-P05｜cc 会话备份导出（2026-09-27 关闭）

- **关闭原因：**灾备已由 VPS B2 每日加密备份覆盖（Haven `docs/operations/vps-backup.md`）；可读导出 / 可重新导入的迁移包暂无需求，真要搬家或导出时再单独开。
- **原记录：**会话原文、raw process、usage、附件元数据和私有文件都在 Haven。若重开，先定用途是“人工备份”还是“可重新导入的迁移包”、是否含图片 / 文件原件；不得导出 Provider / MCP 密钥；保持原始 `session_id`、Persona、轮次顺序和来源；支持导入时先定义幂等键和冲突行为。
- **验收：**原失败模型在相同工具集合下可正常首轮调用；其他模型、无工具聊天、权限 allow/ask/deny 与工具结果保存不回退。

## 2026-08-09

#### ✅ CC-01｜切换长窗口重复加载 / 性能（2026-08-09）

- **结论：**实测 9 轮短窗首次首屏约 2.39 秒，509 轮长窗约 5.11 秒；二次切回仍分别约 2.24 秒和 3.95 秒。根因是 `switchSession` 先清空消息，再无条件重复读取最近 100 条历史；长窗 DOM 量会放大差距，但不是唯一瓶颈。
- **已解决：**浏览器按 `session_id` 保留最近 5 个窗口的内存快照，60 秒内切回不重复读取历史；过期快照先即时显示、再后台更新。首次读取缩为最近 50 条，更早历史仍按原顺序手动加载；切换中的旧请求会取消，避免快速换窗串数据。
- **手机体验：**`/cc` 消息区右侧增加仅手机显示的可拖动快速滚动条；原顶部 / 底部跳转按钮保留。
- **边界保持：**未修改 Haven 原文、分页顺序、刷新 / 换设备读取语义，也未改 selfhost 发送时读取完整 Haven 历史的逻辑。
- **验证：**Dashboard 15 个测试文件 / 76 项测试、TypeScript、定向 ESLint、生产 build 全部通过。
