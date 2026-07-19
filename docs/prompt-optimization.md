# Polaris Prompt 优化方案

> 现状：每轮请求约 50k tokens，缓存命中率低（走 Gateway 时约 5k/50k，直连中转站约 47k/53k）。
> 目标：纯聊天场景降到 12-15k，稳定前缀命中缓存，动态内容放末尾。

---

## 块一：工具系统 ✅ 已分析

### 现状

| 组成部分 | 文件 | 估算 tokens | 每轮是否变化 |
|----------|------|------------|-------------|
| **tools 字段**（JSON Schema） | `toolRegistryCards.ts` 等 6 个注册表 | ~12,000-18,000 | 偶尔变（附件/工作区状态变化） |
| **工具清单**（system 内 brief） | `toolManifest.ts`（90 个 label） | ~1,500-2,000 | 偶尔变 |
| **工具引导语 + 协议示例** | `assistantToolProtocolPrompt.ts` | ~300-500 | 偶尔变 |
| **工具规则去重** | 各注册表的 `.rules` 数组 | ~4,000-8,000 | 偶尔变 |
| **工作区写入规范** | `assistantToolProtocolPrompt.ts` | ~400-600 | 偶尔变 |
| **任务交接指引** | `assistantToolProtocolPrompt.ts` | ~200-300 | 偶尔变 |
| **富文本规范** | `assistantToolProtocolPrompt.ts` | ~150 | 不变 |
| **小计** | | **~18,500-30,000** | |

### 现有过滤机制

`toolVisibility.ts` 已有场景判断（`chat-only` / `in-room` / `in-workspace`）：

- `chat-only`：card、project、cross-boundary 组从 `tools` 字段隐藏
- 没有附件：attachment、archive 组隐藏
- 没有桌面宿主：desktop 18 个工具隐藏
- 没有图片生成：generateImage 隐藏

**但有两个问题：**

1. `chat-only` 仍保留 utility(14 个)、theme(11 个)、proactive(4 个)、MCP(全部) 的 tools 和规则
2. system prompt 里的**规则去重是全量的**——card、project、desktop 等组的 rules 即使工具不在 `tools` 字段，规则仍然注入

### 优化方案

**改文件：** `toolVisibility.ts` + `assistantToolProtocolPrompt.ts`

**思路：** 利用已有的 `userContext` 判断，按场景进一步裁剪 tools 和 rules。

| 场景 | tools 字段 | system 规则 |
|------|-----------|------------|
| **纯聊天**（无卡片、无工作区、无附件、无桌面） | 只保留：writeMemory, readMemoryDoc, searchMemory, webSearch, readWebPage, startTask, completeTask, invokeMcpTool（~8 个） | 只注入对应组的 rules |
| **有卡片** | 纯聊天 + card 组（~20 个） | 加 card rules |
| **有工作区** | 纯聊天 + project 组 + cross-boundary（~25 个） | 加 project/cross-boundary rules |
| **换肤中**（toolEnforcementScope='theme-only'） | theme 组 only（7 个） | 只 theme rules |
| **有附件** | 按需加 attachment/archive 组 | 按需加 |
| **桌面环境** | 按需加 desktop 组（18 个） | 按需加 |

**预计节省：**

| 场景 | 优化前 tools+rules | 优化后 | 节省 |
|------|-------------------|--------|------|
| 纯聊天 | ~25,000 | ~5,000-7,000 | **~18,000** |
| 有卡片 | ~25,000 | ~10,000-12,000 | **~13,000** |
| 有工作区 | ~25,000 | ~14,000-16,000 | **~9,000** |

---

## 块二：Persona 提示词三段 ⏳ 待分析

- `persona_identity_core`（核心身份 + 关系骨架）
- `persona_identity_motive`（认知风味 + 深层动机）
- `persona_identity_style`（语言质地 + 边界）

---

## 块三：工具引导语、协议、规则去重、工作区规范 ⏳ 待分析

---

## 块四：记忆段、语义召回、运行时上下文等动态块 ⏳ 待分析

---

## 块五：富文本规范、任务交接等小尾巴 ⏳ 待分析
