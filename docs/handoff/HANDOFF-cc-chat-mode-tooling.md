# HANDOFF — CC 闲聊模式误注入工作模式工具说明

> 建立时间：2026-09-20
> 仓库：`ob-dashboard2`
> 状态：工具边界修复与闲聊受限文件 MCP 已于 commit `9c44bdd` 部署；挂载权限与内置批准策略修复已完成，等待上线验收

## 背景与当前状态

- 用户发现闲聊模式的模型上下文中仍出现工作模式工具说明。这一问题优先于 Agent Wake 上线验收，因为每次改变顶层 tools 都会触发一次缓存前缀重建；用户额度有限，希望两项修复合并部署后只验收一次。
- Agent Wake 重构已在 Dashboard commit `312c369` 推送：`ombre_agent_wake` 是“工具 · MCP”页面可开关的内置 MCP，无 server instructions，完整说明只位于 `set_agent_wake` 顶层 tool description。
- 目标旧窗口尚未发送部署后的第一条消息，因此 transcript 控制迁移 v3 的一次性 `cold_rebased` 和预期 cache write 还没有被主动触发。不要先单独验收 Agent Wake。
- Haven 没有为 Agent Wake 重构改代码；内置开关复用 Haven 现有 MCP JSON 持久化。
- 根因已由实际 options 证据确认：`buildCcOptions()` 原本无条件向闲聊/工作两种 mode 注入 `Read` / `Grep` / `Glob` / `Write` / `Edit` / `Bash` / Web 工具，`claudeToolAudit()` 也无视 mode 展示同一清单；不是 Claude 自述造成的误判。
- 工作模式 prompt 未串入闲聊：闲聊的 `systemPrompt` 始终是纯 persona 文本，只有工作模式使用 `claude_code` preset。
- 已修复：闲聊顶层 tools 只保留既定 `WebSearch` / `WebFetch`，工作模式保持原工具；tools fingerprint 和上下文审计均按 mode 生成。`MODEL_SURFACE_FORMAT_VERSION` 保持 3，不触发 transcript rebase。
- 已新增 chat-only 内置 MCP：内部 ID `yanzhi`，管理页显示 `yanzhi's files`，Claude 工具名为 `mcp__yanzhi__files`，默认开启且可手动关闭；只有一个 `files` 工具，无 server instructions，支持受限 `list` / `search` / `read` / `write` / `mkdir`。
- 文件根目录固定为容器内 `/data/cc-chat-files`。部署前必须在 Coolify 将 VPS 宿主机持久目录挂载到该路径；未挂载时工具 fail closed，不会静默写入容器临时目录。
- 安全边界：只接受相对路径，拒绝绝对路径、`..` 和符号链接越界；不提供删除、移动或命令；覆盖既有文件必须显式 `overwrite=true`；列表、搜索、读取与写入均有体积上限。
- 首次上线实测发现宿主机 `/srv/ob-data/yanzhi-files` 为 `root:root 755`，容器 `cc` 用户（UID/GID `10001:10001`）只能读、不能写。已在宿主机改为 `10001:10001 750`，无需再改挂载或协作者目录设置。
- 首次实测还发现页面把所有内置 MCP 固定标为“自动允许”，但运行时只特判 Agent Wake，`mcp__yanzhi__files` 回落为每次询问。已改为 Agent Wake 固定自动允许，`yanzhi's files` 默认自动允许并可切换为每次询问；权限写入 Haven MCP JSON 的 `builtInPermissions`，不参与模型表面 hash。
- 最终验证已通过：相关 CC / Agent Wake / MCP 定向测试 8 个文件、48 项全通过，`npm run build` 通过。

## 下一步范围

1. 部署内置 MCP 批准策略修复；该变化不改工具 description/schema/server 清单或 system prompt，不得升级 transcript 控制版本。
2. 同一旧闲聊窗口重新执行 `mkdir` / `write` / `list` / `search` / `read`：默认自动允许时不得弹批准卡，切换为每次询问后应弹卡。
3. 通过上下文审计补验工具/MCP hash 与迁移状态；批准策略部署后不应再出现 `cold_rebased`。
4. 不修改 Agent Wake 的新承载结构，不触碰用户既有 thinking 删除逻辑、上下文拼接内容、Haven transcript 同步、scheduler、silence、coordinator 或 lane 状态机。

## 合并验收方法

在闲聊/工作模式工具边界修复部署后，再用同一个旧窗口一次性验收：

1. 第一条消息应显示 `cold_rebased`，这是 v3 唯一一次旧 SDK 控制记录迁移；观察该轮 cache write。
2. 上下文审计中闲聊模式不再出现工作模式文件/命令工具定义。
3. MCP 页显示已开启的 `yanzhi's files`；其 Server instructions 为空，只有一个 `files` 工具。在挂载目录内实测建目录、写文件、搜索和分段读取；关闭后整个服务不得出现在当前模型表面。
4. `ombre_agent_wake` 的 Server instructions 为空；`set_agent_wake` description 显示完整最新版 Wake 指令；MCP 最近与当前 hash 一致。
5. 第二条消息应显示 `reused`，不应再次全量写缓存。
6. Claude 不应再把旧 Agent Wake system-reminder 当成当前指令；历史 assistant thinking 保留，不作为当前控制面验收依据。

## 必做验证

- 增加闲聊/工作模式工具清单的定向回归测试。
- 运行相关 CC/Agent Wake/MCP 定向测试、`npm run build` 和 `git diff --check`。
- 提交前按 `MAINTENANCE_CONTRACT.md` 同步命中的正式事实文档。
