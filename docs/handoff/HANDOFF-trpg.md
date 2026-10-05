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
| 言之的人设 | 主窗口协作者配置全量 + 跑团说明（2026-10-05） | 坐在对面的要是完整的言之 |
| 言之挂 OB | 挂（2026-10-05 改） | 言之只看得到玩家可见内容，没有可漏的秘密；一起跑团是真实经历，要能长期留存 |
| 言之的模型 | 每局一个设置，默认 Opus 4.6，局中可改、下一回合生效 | 和主窗口同一个言之；想换时不用改代码 |

## 1. 阶段

| 阶段 | 内容 | 谁做 |
|---|---|---|
| P0 验证 | §7 三项验证，全部通过才进 P1 | CC |
| P1 Haven | `trpg_store` + 骰子 + 两套 MCP + 页面用的 REST | ✅ 2026-10-05 Codex（VPS 上由 CC 直接派活）实现，CC 验收：新增 36 项 + Haven 全量 327 通过，合并 main（`c956926`）。限制：每个 profile 同时只有一局 |
| P2 dashboard | 跑团页 + 跑团模式 + 调度器 | 新会话背景注入 + 输入框贴底已实现，待 CC 验收。 ① P2a 页面 + Haven 小补（预设调查员列表、前情提要）：✅ 2026-10-05 Codex 实现，CC 验收（Haven 全量 330、dashboard Vitest 532 + build 通过）合并 main，待上线后 iPhone 走查；② P2b 调度器 + 言之的跑团会话：规格见 §13，✅ 2026-10-05 Codex 实现，CC 验收（Haven 333、Vitest 552 + build；OB 工具放行名单核对为全名）合并 main。**下一步（新窗口）**：① 上线前小羊在 Coolify 给 dashboard 加 `TRPG_PLAYER_MCP_TOKEN`（与 Haven 同值）；② 结束这局 / 删除模组已实现，待 CC 验收（OB Todo `dbed839c`）；验收后用假模组建局，iPhone 实测言之的桌边话 / 行动 / 掷骰（`33576909`）；③ P3。已知：容器在言之回合中途被重建时 `running_since` 会残留，页面一直显示「言之在想…」，直到下一次触发覆盖。Codex，CC 验收 |
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
- **桌边话也会叫醒言之（P2）**：小羊发桌边话 → 触发一轮「言之桌边回合」，言之的回复记成言之的桌边话，phase 不变。可以连续聊很多轮，DM 不接话。只有小羊提交行动或点结算才推进
- 桌边话 `visible_to=all`，DM 能看到（像真的桌子一样），DM 的规矩里写明「桌边话不当作角色行动、不据此惩罚或改剧情」

### 上下文（P2 / P3）

- **事实源是 Haven 的 `trpg_log`**，永久完整；言之的 CC 会话和 DM 的 Codex 线程都是一次性的，随时可以扔掉重开
- **前情提要**：DM 在切场景、一次团结束时调用 `write_recap(public, keeper)`：`public` 是玩家可见的前情提要（`visible_to=all`，页面上小羊也能看），`keeper` 是 DM 自己的备忘（NPC 知道什么、计时器、伏笔，`visible_to=dm`）。P2 给 DM MCP 加这个工具和 log kind `recap`
- **换会话**：任一方会话超过阈值（先定 8 万 token）或新一次团开始时，开新会话，注入：人设与规矩 + 角色卡 + 最新的前情提要（言之只拿 public，DM 拿两份）+ 已公开线索 + 最近 N 条可见日志。旧会话不续
- 不依赖 CC / Codex 自带的自动压缩：自己控制的重开更省、也不会把 DM 内容压进言之的上下文

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
  "scenes":  [{ "id": "s1", "title": "玩家可见的地点名，不剧透", "keeper_text": "..." }],
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
3. **言之的会话**（2026-10-05 修订，细节见 §13）——
   - 不走聊天引擎：照 `automation-pro-runner` 单独起 SDK 会话，不写 Haven 聊天归档，因此天然不进日回顾、做梦、自动召回、`search_chat`
   - system prompt = 主窗口协作者配置**全量** + 「现在在跑团」一节
   - 挂**玩家 MCP + Ombre Brain**：言之只拿得到玩家可见内容，OB 里存的就是两人在桌边真实经历的事。不挂 `yanzhi's files`、房间、唤醒，没有 Read / Bash / Web；`autoMemoryEnabled: false`
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

新增页面，不改现有聊天页。入口在主页抽屉「家里的其他房间」→ 游戏室 `/games`（2026-10-05 小羊定，原定工作台），不加底部 Tab。叙事流、输入框、抽屉尽量复用聊天和 `DetailPanel` 的现有组件和样式。

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

## 12. P2a 任务单（Codex · 页面 + Haven 小补）

两个分支、两个工作副本：Haven `feat/trpg-p2a`、dashboard `feat/trpg-p2a`。不碰 cc 引擎（`app/lib/cc/**`、`app/api/cc-*`）、不调用任何模型、不写调度器逻辑。全程只用 §8 假模组。

### Haven（先做，dashboard 依赖它的接口）

1. **预设调查员列表**：`GET /trpg/api/modules/{module}/pregens` → `[{index, name, occupation, sheet}]`。只取 `pregens`，其他模组字段一律不返回；在 `trpg_store` 写成函数，REST 只调它
2. **前情提要**：log kind 新增 `recap`。`trpg_store.write_recap(game, public, keeper)` 写两条：`public` → `visible_to=all`，`keeper` → `visible_to=dm`（任一可省略，都空则报错）；DM MCP 加工具 `write_recap(public, keeper?)`。`trpg_store.latest_recap(game, viewer)`：玩家视角只返回最新的 public，dm 返回最新的两份。前情提要不改 phase
3. **测试**：pregens 响应里没有 `keeper_*` / scenes / clues / npcs；keeper 版前情提要在玩家 MCP 的 `get_table`、小羊 REST `table`、`latest_recap(…, 'xiaoyang'|'yanzhi')` 里都看不到；DM 能看到两份；已有测试全过
4. **文档**：Haven `docs/reference.md` 的 trpg REST 分组加 pregens 一行、核心模块表 `trpg_store` 提一句 recap

### dashboard

**转发层**
- `app/api/trpg/[...path]/route.ts`：白名单转发到 Haven 的 `/trpg/api/*`（`modules`、`modules/{id}/pregens`、`games`、`games/{id}/table|action|table-talk|settle`、`games/{id}/checks/{id}/roll`）。**不转发 `games/{id}/phase`**（只给服务端调度器用）。鉴权用 `getHavenBaseUrl()` + `getHavenGatewayToken()` 加 Bearer，不转发浏览器 Cookie；token 不出服务端。Haven 的 400 / 409 原样带给页面
- `action`、`table-talk`、`settle`、`roll` 成功后调 `app/lib/trpg/scheduler.ts` 的 `kickTrpgTurn(gameId, trigger)`。这次它只是**空函数**，文件头写明「P2b 由 CC 实现：按 phase 叫言之 / DM 的回合」，不要自己实现

**页面**（动手前完整读 `DESIGN.md`；复用现有组件和 token，耦合太深的组件复用样式类，不整段复制）
- 入口：工作台条目列表加「跑团」，不加底部 Tab
- `/trpg`：局列表（标题 + phase 中文）· 新建局：选模组 → 拉 pregens，分别给「小羊」「言之」选调查员（显示名字 + 职业，默认第 1、第 2 个）→ 可填局名 → 创建。Haven 现在每个 profile 只允许一局，409 时提示「已经有一局在跑了」· 上传模组：选 JSON 文件，按钮旁小字「交给 DM，别打开」，成功只显示 Haven 返回的标题和场景 / 线索 / NPC 数量，**页面不解析、不显示模组内容**
- `/trpg/[id]`：
  - 叙事流：按 `seq` 增量合并 `log`（`since_seq` = 已有最大 seq）。`narration` 用 `CcMarkdown` 显示成正文；`action` 标出谁的行动（小羊 / 言之 + 角色名）；`table_talk` 小一号、像聊天气泡，标「桌边」；`roll` 显示成骰子结果行；`private` 加「只有你看得到」；`recap` 显示成可折叠的「前情提要」卡片
  - 顶部状态：`players`「轮到你们」· `yanzhi`「言之在想…」· `dm`「守秘人在写…」· `checks`「等掷骰」；当前场景标题
  - 底部输入框：切换「行动 / 桌边话」。行动只在 `players` 可发（其他时候灰掉并说明）；桌边话随时可发。`players` 和 `yanzhi` 时显示「直接结算」（`settle` 带当前 phase）
  - `checks`：自己名下的 pending 检定逐条列出（技能、难度、奖励 / 惩罚骰、原因）+「掷骰」按钮
  - 角色卡抽屉（`my_character` 全量 + 同伴名字职业）、线索抽屉（`clues`，handout 标出来），都用 `DetailPanel`
  - 刷新：页面在前台且 phase ≠ `players` 时每 3 秒拉一次增量；`players` 时 15 秒；切到后台停
  - 返回用 `SubpageBackButton`；加载 / 空状态撑满 `min-h-screen`；手机优先
- 数据分类：全部在 Haven，页面只存界面偏好（如输入框模式）可用 `localStorage`

**测试（Vitest）**：转发白名单（`phase` 和白名单外路径 404、带 Bearer、不带 Cookie）；成功的 action / table-talk / settle / roll 会调 `kickTrpgTurn`，失败不调；日志增量合并（去重、按 seq 排序）

**文档**：`docs/reference.md` 页面表加 `/trpg`、`/trpg/[id]`，`app/api` 行加 trpg 转发；本文件 §1 P2 行写「P2a 已交，待验收」

**不做**：调度器、跑团模式会话、DM 容器、`trpg-dm`、SSE / 推送、模组内容展示、多局。

## 13. P2b 规格（调度器 + 言之的跑团会话）

P2a 验收合并后再派。两个分支：Haven `feat/trpg-p2b`、dashboard `feat/trpg-p2b`。**不改聊天引擎**：`runTurn`、`ccSession`、`havenTurns`、`cc-chat` 一行不动，只复用导出的函数。

### Haven

1. **每局设置**：`trpg_games` 加 `settings_json`（迁移可重复执行），字段 `yanzhi_model`（默认 `claude-opus-4-6`）、`persona_id`（默认空 = dashboard 取主协作者）。REST：`GET/PATCH /trpg/api/games/{game}/settings`，`yanzhi_model` 只收 `^claude-(opus|sonnet)-[a-z0-9-]+$`
2. **言之会话运行态**：`runtime_json`，字段 `session_id`、`session_tokens`、`last_seen_seq`、`last_error`、`running_since`。REST：`GET/PUT /trpg/api/games/{game}/yanzhi-runtime`。丢了也没关系（下回合当新会话开），但存 Haven，重启后能续
3. **给调度器的言之视角**：`GET /trpg/api/games/{game}/yanzhi-view?since_seq=` → `view_for(game,'yanzhi')` + `latest_recap(game,'yanzhi')`。`POST /trpg/api/games/{game}/yanzhi-table-talk {text}`：以言之名义写桌边话（kind `table_talk`、`visible_to=all`、author `yanzhi`），不改 phase
4. 以上都用 `OMBRE_GATEWAY_TOKEN`。测试：yanzhi-view 不含 `keeper_*`、`gm_note`、小羊的 `private`、keeper 版前情提要、DM 暗骰；settings 模型校验；迁移重复执行

### dashboard

**页面转发白名单不加**这三组新接口里的 `yanzhi-view`、`yanzhi-table-talk`、`yanzhi-runtime` 的写方法；页面只能读 `settings`（PATCH 可以转发，用于改模型）和 `yanzhi-runtime` 的 GET（显示状态 / 错误）。

**`app/lib/trpg/scheduler.ts`：`kickTrpgTurn(gameId, trigger)`**
- 转发接口里改成 `void kickTrpgTurn(...)`：只触发不等待（P2a 是 `await` 空函数），否则小羊点发送要等言之整轮跑完
- 每局一把进程内互斥锁；正在跑时再被叫，只记「还要再看一次」，当前回合结束后再循环一次（合并多次触发）。`isDraining()` 时直接返回；跑的时候 `trackDrainWork`
- 循环：读 yanzhi-view，按顺序判断，都不满足就停
  1. 小羊有言之还没回应过的新桌边话（seq > `last_seen_seq`）→ **桌边回合**
  2. phase=`yanzhi` 且这次进入 yanzhi 后还没叫过言之 → **行动回合**（言之可以不交行动，只说话；不重复叫）
  3. phase=`checks` 且有言之名下的 pending 检定、这批检定还没叫过 → **掷骰回合**
  4. phase=`dm` → `runDmTurn(gameId)`：P3 才实现，现在是空函数，文件头写明
- 一个回合结束后：最后的回复文字非空就 POST `yanzhi-table-talk`；更新 `last_seen_seq`（含他自己刚写的日志）、`session_id`、`session_tokens`；失败写 `last_error`（Pro 额度 / 登录失效 / 超时分别给中文），不写进跑团日志

**`app/lib/trpg/yanzhiTurn.ts`：一回合言之**
- 照 `app/api/automation-pro-runner/route.ts` 起 `query()`，外面套 `runForegroundSubscriptionTurn`（和聊天共用一把 Pro 锁，排在聊天之后）
- options：`model` = 局设置；`systemPrompt: { type: 'custom', prompt: personaAppend + '\n\n' + trpgSection, snapshot: false }`；`tools: []`；`mcpServers` = `{ trpg: 玩家 MCP（http，URL = getHavenBaseUrl() + '/trpg/player/mcp'，Bearer TRPG_PLAYER_MCP_TOKEN）, ombre_brain: 从 loadMcpConfig() 里只取 OB 那一个 }`；`strictMcpConfig: true`；`disallowedTools` = OB 配置里被关掉的工具；`allowedTools` = `mcp__trpg__*` + OB 开着的工具；`permissionMode: 'dontAsk'`；`settings: { autoMemoryEnabled: false }`；`settingSources: []`；thinking / effort 用主窗口同样的设置；`cwd` 固定一个专用目录（如 `os.tmpdir()/ob2-trpg`，不存在就建），让原生 transcript 落在单独的 project 下；`env: buildCcEnv('subscription', { mainModel })`；`resume` = runtime 里的 `session_id`
- `personaAppend`：`getPersona(局设置的 persona_id ?? 主协作者)` → `buildPersonaAppend(persona)`，模块按默认开关。「主协作者」怎么定：读现有代码里新建闲聊窗口默认用哪个，照用；找不到规则就在报告里写明，不要猜
- `trpgSection`（写在代码里，作为常量）：现在在和小羊跑团（CoC 7 速成规则），你扮演的调查员是谁（名字、职业）；游戏内行动只能用 `submit_action`，且只在轮到你时；掷骰只能用 `roll_check`；你最后说的话会作为你的桌边话显示在小羊面前；不要试图打听守秘人的秘密；觉得这段经历值得留下，就照平时的习惯存进 OB——写清楚这是你们一起跑团时发生的事
- **每回合的 prompt**：`<trpg_turn kind="table_talk|action|roll" />` + 自 `last_seen_seq` 以来言之可见的新日志（一行一条：seq、谁、类型、原文）+ 言之名下的 pending 检定
- **新会话**（没有 `session_id`、resume 失败，或 `session_tokens` > 80000）：prompt 前面再加：言之角色卡全文、最新前情提要（public）、已公开线索、最近 40 条可见日志。用 result 的 usage 估 `session_tokens`（input + cache_read + cache_creation 的最后一次）
- 超时 5 分钟；中途 `isDraining()` 不打断，靠 drain 等它结束

**页面（`/trpg/[id]`）**
- 设置抽屉：言之用的模型（Opus 4.6 / Opus 5.5 / Sonnet 5，下拉），改完下一回合生效
- 顶部状态读 `yanzhi-runtime`：`running_since` 有值显示「言之在想…」；`last_error` 有值显示一条可关闭的提示

**测试**：调度判断（四种情况各一条 + 都不满足就停 + 不重复叫）；合并触发；新会话 prompt 包含角色卡 / 前情提要 / 线索，旧会话只给增量；options 里没有 `yanzhi's files`、房间、唤醒、Read / Bash / Web；页面转发拦掉 `yanzhi-view`、`yanzhi-table-talk`、`yanzhi-runtime` 的写方法。模型调用用假的 `query`，不真调

**部署前（小羊）**：dashboard 容器加 `TRPG_PLAYER_MCP_TOKEN`（和 Haven 同值）；Haven 那边确认两个 token 都配了。DM 的 token 不进 dashboard

**同步文档**：dashboard `docs/reference.md`「cc 数据持久化契约」加一条跑团会话（存哪、不进归档、OB 挂载）；`app/api` 行；Haven `docs/reference.md` REST 分组、`ENV_VARS.md` 不变

## 14. 待小羊决定

- ~~跑团窗口要不要进日回顾~~ 已定（2026-10-05）：不进，团录以后单独做
- ~~言之每回合是否必须交行动~~ 已定（2026-10-05）：不必，可以只说桌边话，小羊点「直接结算」跳过
