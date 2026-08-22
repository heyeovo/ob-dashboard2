# HANDOFF: 聊天原文搜索 (search_chat + get_chat_context)

## 完成状态

### 已完成
- Haven `gateway_state.py`: 给 `conversation_turns` 加了 FTS5 虚拟表 (`conversation_turns_fts`)
- Haven `gateway_state.py`: `search_turns()` 方法，FTS5 + LIKE 双路搜索，返回带 turn_id
- Haven `gateway_state.py`: `get_turn_context()` 方法，按 turn_id 展开前后 N 轮上下文
- Haven `server.py`: `search_chat` MCP 工具 + `/api/search-chat` REST 端点
- Haven `server.py`: `get_chat_context` MCP 工具 + `/api/chat-context` REST 端点
- 三个 INSERT 入口都加了 FTS 同步（普通写入、严格写入、批量导入）
- 首次启动自动回填已有数据到 FTS 表
- profile_id 已修复：MCP 工具从 `persona_engine.profile_id` 取实际值
- exclude_session 过滤：搜索时可排除当前窗口避免返回已在上下文中的内容

### 已完成（其他）
- Dashboard `AGENTS.md`: 加了 CC 工作窗口协作规范
- Dashboard `ccOptions.ts`: Bash 自动放行（工作模式下 Bash 加入 allowedTools，去掉 hook 强制 ask）

### 已验收
- `search_chat` 关键词搜索正常，返回带 turn_id（2026-08-22）
- `get_chat_context` 已部署，下个窗口可调用验收（2026-08-22）
- `exclude_session` 已部署，下个窗口可调用验收（2026-08-22）

### 待做
- 前端注入当前 session_id 到系统提示，供 exclude_session 使用
- OB 使用指南更新 search_chat / get_chat_context 工具说明

## 技术细节

### FTS5 索引结构
```sql
CREATE VIRTUAL TABLE conversation_turns_fts
USING fts5(user_text, assistant_text, session_id,
           content='conversation_turns', content_rowid='id')
```
- content table 模式：FTS 表不存数据副本，读时 JOIN 回主表
- 首次启动时检查 FTS 行数，为 0 且主表有数据时自动回填

### 三个 INSERT 同步点
1. `record_conversation_turn()` — 普通写入（旧路径）
2. `commit_conversation_turn()` — 严格写入（cc/selfhost）
3. `import_conversation()` — 批量导入（Polaris），用全量重建

### search_chat MCP 工具参数
- `query`: 关键词（必填）
- `session_id`: 限定窗口
- `exclude_session`: 排除指定窗口（如当前窗口）
- `since` / `until`: 日期范围 (YYYY-MM-DD)
- `role`: "user" 或 "assistant"，只看一方
- `limit`: 最多返回条数，默认 20，上限 50

### get_chat_context MCP 工具参数
- `turn_id`: search_chat 返回的 turn_id（必填）
- `rounds`: 前后几轮，默认 3，上限 20

### 两步操作流程
1. `search_chat` 搜关键词 → 返回匹配列表（每条带 turn_id）
2. 锁定目标后用 `get_chat_context(turn_id=..., rounds=N)` 展开上下文

### 输出格式
- search_chat: 每条带时间、turn_id、session 前 8 位、小羊/言之原话（截断 2000 字符）
- get_chat_context: 按 round_id 排序，匹配轮标记 `← 匹配`

## 环境备注

- Git push 已切换为 SSH key（ed25519），不再需要临时 PAT token
- 两个仓库（Haven + Dashboard）remote 均已改为 SSH URL

## 不得扩散的边界

- 不动现有的 `raw_events` 搜索和 FTS
- 不动 `conversation_turns` 表结构
- 不动 Gateway 的写入逻辑（只在写入后追加 FTS 同步）
