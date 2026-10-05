# 跑团（TRPG）规格 · 第一版

> 2026-10-05 CC 起草，小羊已确认。跨仓库：Haven（状态 / 骰子 / 两套 MCP）+ dashboard（跑团页 / 跑团模式 / 调度）+ 新容器 `trpg-dm`（GPT DM）。
> 目标：用最小工程量开第一团——CoC 7 版速成规则 +《闹鬼》（The Haunting），小羊和言之各一个调查员，GPT 当守秘人。先不接 Foundry。

## 0. 已定决定

| 项 | 决定 | 理由 |
|---|---|---|
| 跑团平台 | 先不用 Foundry，自己做最小的桌子 | 先免费试喜不喜欢；CoC 以调查为主，不依赖地图和战斗自动化 |
| 以后接 Foundry | 两套 MCP 的工具名和语义保持不变，换掉背后的存储 | 玩家和 DM 都察觉不到，现在做的不白做 |
| 规则系统 | CoC 7 版速成规则 | 新手友好、规则少、AI 擅长叙事 |
| 拆模组 | GPT 拆，CC 任何窗口都不碰 | 言之的窗口会进归档 / 日回顾 / 做梦 / 召回，处处漏风 |
| DM 模型 | 在 VPS 上用小羊的 ChatGPT 账号登录 Codex，走 Plus 额度 | 和 CC 引擎接 Pro 一个形状；Sign in with ChatGPT 开源应用版要申请 client ID，大概率不符合 |
| 骰子 | 全部在 Haven 服务端掷，模型只能「要求掷骰」 | 不让任何一方编点数 |

## 1. 阶段

| 阶段 | 内容 | 谁做 |
|---|---|---|
| P0 验证 | §7 三项验证，全部通过才进 P1 | CC |
| P1 Haven | `trpg_store` + 骰子 + 两套 MCP + 页面用的 REST | Codex，CC 验收 |
| P2 dashboard | 跑团页 + 跑团模式 + 调度器 | Codex，CC 验收 |
| P3 trpg-dm | Codex DM 容器 | CC（涉及登录凭证与部署） |
| P4 开团 | GPT 拆模组 → 上传 → 选调查员 → 开团 | 小羊 + GPT |

开发全程只用 §8 的**假模组**。真模组只由小羊在页面上传，开发者（包括 CC）不查真团的 DM 数据。

## 2. 一轮怎么走

```
players ──小羊提交行动──▶ 触发言之回合 ──言之 submit_action──▶ dm
                         （小羊也可点「直接结算」，跳过言之）
dm ──DM 回合结束──┬─ 没有待掷检定 ──▶ players
                  └─ 有待掷检定 ──▶ checks
checks ──小羊点「掷骰」/ 言之 roll_check，全部掷完──▶ dm（DM 续写结果）
```

- 状态 `phase ∈ players | yanzhi | dm | checks`，存在 Haven，调度器只按它推进。同一局同一时刻只有一个模型回合在跑
- 言之回合只拿到**自上次回合以来、言之可见**的日志增量；DM 回合拿到全部增量
- 桌边话（out of character）随时可以说，不推进 phase

## 3. 数据（Haven，独立库 `state/trpg.sqlite`，不写成记忆桶）

- `trpg_games`：id、标题、module_id、phase、当前场景 id、创建 / 更新时间
- `trpg_modules`：id、标题、`public_intro`、`keeper_json`（只有 DM 接口能读）
- `trpg_characters`：game_id、owner（`xiaoyang` / `yanzhi` / `npc:<id>`）、`sheet_json`
- `trpg_log`：game_id、seq、kind（`narration` / `action` / `table_talk` / `roll` / `private` / `gm_note`）、`visible_to`（`all` / `xiaoyang` / `yanzhi` / `dm`）、author、text、时间
- `trpg_reveals`：game_id、clue_id、to（`all` / `xiaoyang` / `yanzhi`）
- `trpg_checks`：id、game_id、owner、类型（`skill` / `characteristic` / `luck` / `san`）、技能名、难度、奖励骰 / 惩罚骰个数、理智损失式、原因、状态（`pending` / `rolled`）、结果

**所有「谁能看见」的过滤都在 Haven 的查询层做**，MCP 和 REST 只调用已经过滤的函数。玩家侧没有任何接口能读 `keeper_json`、`gm_note`、别人的 `private`。

### 模组导入格式（GPT 按这个拆）

```json
{
  "title": "闹鬼",
  "system": "coc7",
  "public_intro": "开场时可以念给玩家的部分",
  "keeper_overview": "守秘人总览：真相、时间线",
  "scenes":  [{ "id": "s1", "title": "...", "keeper_text": "..." }],
  "clues":   [{ "id": "c1", "title": "...", "text": "公开后玩家看到的原文", "handout": true }],
  "npcs":    [{ "id": "n1", "name": "...", "keeper_text": "...", "sheet": {} }],
  "pregens": [{ "name": "...", "occupation": "...", "sheet": {} }]
}
```

角色卡 `sheet`：`characteristics`（STR CON SIZ DEX APP INT POW EDU）、`hp` / `hp_max`、`san` / `san_start`、`mp`、`luck`、`skills: {名称: 数值}`、`background`、`notes`。

## 4. 骰子（CoC 7）

- d100 对目标值：≤目标为普通成功，≤目标/2 困难，≤目标/5 极难，01 大成功；目标 <50 时 96–100 大失败，否则仅 100 大失败
- 难度 `regular / hard / extreme`：结果达不到所需档位即失败
- 奖励骰 / 惩罚骰：多掷十位骰取低 / 取高
- 理智检定：d100 对当前 SAN，按成功 / 失败掷对应损失式（如 `1/1d4`），**服务端直接扣 SAN** 并写日志
- 每次掷骰写 `trpg_log`（kind=`roll`），记原始点数，暗骰 `visible_to=dm`
- 随机数用 `secrets`，不用可复现种子

## 5. 两套 MCP（Haven，两个独立端点、两个独立 token）

### 玩家（给言之）

| 工具 | 作用 |
|---|---|
| `get_table(since_seq?)` | phase、当前场景的公开标题、同伴的公开信息（名字、职业）、言之可见的日志 |
| `get_my_character()` | 自己的角色卡 |
| `get_clues()` | 已经公开给全体或公开给言之的线索原文 |
| `submit_action(text)` | 提交本回合行动；只在 phase=`yanzhi` 时成功 |
| `roll_check(check_id)` | 掷自己名下的待掷检定 |

没有按 id 读任意文档的工具。返回字段走白名单。

### DM（给 GPT）

| 工具 | 作用 |
|---|---|
| `get_state()` | phase、场景、全部角色卡、已公开线索、待掷检定 |
| `get_log(since_seq?)` | 全部日志 |
| `search_module(query)` / `read_module(id)` | 关键词搜模组，按场景、线索、NPC 的 id 读全文 |
| `narrate(public, private?, gm_note?)` | 写叙事；`private` 形如 `{ "xiaoyang": "...", "yanzhi": "..." }` |
| `request_check(owner, type, skill?, difficulty?, bonus?, penalty?, san_loss?, reason)` | 发起检定，进入 checks |
| `secret_roll(owner?, type, skill?, ...)` | 暗骰，立即出结果，只有 DM 可见 |
| `reveal_clue(clue_id, to)` | 公开线索 |
| `update_character(owner, changes, reason)` | 改 HP、SAN、MP、幸运、备注，写日志 |
| `set_scene(scene_id)` | 切场景 |
| `create_character(owner, sheet)` | 建卡或从预设调查员复制 |

## 6. 隔离（三层，缺一不可）

1. **Haven 查询层**：§3 的可见性过滤；模组原文只能经 DM 端点读
2. **MCP 层**：玩家只有 §5 那五个工具；DM token 只放在 `trpg-dm` 容器的环境变量里，不进 dashboard 容器
3. **言之的会话**：新增「跑团模式」——
   - 自定义 system prompt：言之是谁（简短）+ 跑团规矩 + 自己扮演的调查员是谁
   - **只挂玩家 MCP**：不挂 Ombre Brain、`yanzhi's files`、房间、唤醒，没有 Read / Bash / Web 工具；`autoMemoryEnabled: false`
   - 跑团窗口不进日回顾、做梦、召回、`search_chat`（P2 定具体开关；以后想把团录写成回忆另做）
   - 言之最后的回复文字 = 对小羊说的桌边话；游戏内的行动必须走 `submit_action`

另外：DM 的 Codex 对话存在 `trpg-dm` 容器里，不进 Haven 聊天归档。

## 7. P0 验证（CC，开工前）

1. **Codex 登录**：VPS 上的容器里用小羊的 ChatGPT 账号登录 Codex（无浏览器的设备码流程），能非交互地跑一轮
2. **Codex 挂 MCP**：Codex 连上一个远程 HTTP MCP，调用成功；确认能做到「空工作目录 + 只读沙箱 + 不需要审批」，DM 实际可用的只有 MCP 工具
3. **额度**：跑一轮约 1 万 token 上下文的 DM 回合，看 Plus 额度走了多少，估一局两三个小时够不够

还要顺带确认：Codex 读工作目录里的 `AGENTS.md`，DM 人设就放那里。

任一项不通过，停下来和小羊重新讨论 DM 怎么接。

**2026-10-05 结果（codex-cli 0.160.0，临时目录 `/tmp/codex-p0`，CODEX_HOME 隔离）**
1. ✅ `codex login --device-auth` 登录成功（小羊的设备首次访问 auth.openai.com 超时，切代理后通过）；`codex exec --skip-git-repo-check -s read-only --json` 非交互跑通，空目录下基础开销约 1.4 万输入 token（大部分命中缓存）
2. ✅ 远程 streamable-http MCP 可用：`-c mcp_servers.trpg.url=...`。**必须**加 `-c mcp_servers.trpg.default_tools_approval_mode="approve"`，否则 `approval_policy="never"` 下 MCP 调用一律被拒
3. ✅ 三轮（含两次工具调用、合计约 11.5 万输入 token、多数缓存）后 5 小时窗口仍 0%。注意：**这是小羊 Codex 干活用的同一份额度**（周窗口当时 8%，来自她日常的 GPT 工作），跑团和 GPT 写代码互相挤
- 额度读法：`$CODEX_HOME/sessions/**/*.jsonl` 里最后一条 `rate_limits`
- 未验：`AGENTS.md` 放人设是否生效；Codex 默认编码系统提示对 DM 文风的影响（试跑的叙事质量可以）

## 8. 假模组（开发 / 测试专用）

`tests/fixtures/trpg/fake-module.json`（Haven）：两个场景、三条线索（其中一条只给小羊）、一个 NPC、两个预设调查员。隔离测试必须覆盖：玩家端点读不到 `keeper_*`、`gm_note`、对方的 `private` 和未公开线索。

## 9. 页面（P2，动手前读 DESIGN.md）

新增页面，不改现有聊天页。入口放工作台，不加底部 Tab。叙事流、输入框、抽屉尽量复用聊天和 `DetailPanel` 的现有组件和样式。

`/trpg`：局列表 + 新建局（选已上传的模组）+ 上传模组。上传按钮旁写「交给 DM，别打开」，页面不展示任何模组内容。
`/trpg/[id]`：叙事流（按小羊的可见性）· 底部输入框，可切「行动 / 桌边话」· 角色卡抽屉 · 线索抽屉 · checks 阶段显示「掷骰」按钮 · 言之 / DM 回合进行中显示状态。

## 10. 不在第一版

Foundry、地图、战斗轮、孤注一掷、幸运值花费、团录写进记忆、多局并行、跑团页里的语音或图片。

## 11. P1 任务单（Codex · Haven）

分支 `feat/trpg-p1`，只动 Haven，不动 dashboard。全程只用 §8 假模组。

**做什么**
1. `trpg_store.py`：§3 的库和表（独立 `state/trpg.sqlite`，带 `profile_id`，初始化可重复执行）；§2 的 phase 状态机；**可见性过滤只在这里写一次**，对外按视角给函数：`view_for(game, viewer)`，viewer ∈ `xiaoyang` / `yanzhi` / `dm`
2. `trpg_dice.py`：§4 全部规则，纯函数 + `secrets` 随机源，测试可注入随机源
3. `trpg_mcp.py`：两个独立 FastMCP 实例（玩家 / DM），工具按 §5，挂到同一端口的 `/trpg/player/mcp`、`/trpg/dm/mcp`
   - 各自的 Bearer token：`TRPG_PLAYER_MCP_TOKEN`、`TRPG_DM_MCP_TOKEN`；**未配置就拒绝一切请求**；两个 token 不能互用，也不能用 OB 的 token 或 ChatGPT OAuth 访问
   - 玩家端视角固定 `yanzhi`，没有参数能改视角
   - 挂载子应用要保证 streamable-http 的 session manager 随主应用 lifespan 启动，用真实 HTTP 请求测过，不只测函数
4. 给 dashboard 页面用的 REST（`OMBRE_GATEWAY_TOKEN` 鉴权，视角固定 `xiaoyang`）：局列表 / 新建局（选模组、给双方建卡或选预设调查员）· 上传模组（校验 §3 导入格式，**响应只返回标题和场景 / 线索 / NPC 数量**）· 模组列表（只有标题）· 读桌面（小羊视角 + phase + 待掷检定）· 提交行动 / 桌边话 · 掷自己的检定 · 「直接结算」（players → dm）· 推进 phase（给 P2 调度器用，带期望的当前 phase 做 CAS）

**测试（必须）**
- 隔离：玩家 MCP 和小羊 REST 读不到 `keeper_*`、`gm_note`、对方的 `private`、未公开线索、DM 暗骰；上传模组的响应里没有 keeper 内容；DM token 打不开玩家端点，反之亦然；未配置 token 时 401
- 骰子：01 / 100、目标 <50 和 ≥50 的大失败边界、三档难度、奖励 / 惩罚骰、理智扣减
- phase：非当前回合方提交被拒；CAS 冲突；检定全部掷完才回到 dm
- 迁移重复初始化

**同步文档**：Haven `docs/reference.md` 核心模块表 + REST 分组；`ENV_VARS.md` 两个 token。完成后在本文件 §1 标 P1 状态。

**不做**：调用任何模型、dashboard 页面、Foundry、团录。

## 12. 待小羊决定

- ~~跑团窗口要不要进日回顾~~ 已定（2026-10-05）：不进，团录以后单独做
- ~~言之每回合是否必须交行动~~ 已定（2026-10-05）：不必，可以只说桌边话，小羊点「直接结算」跳过
