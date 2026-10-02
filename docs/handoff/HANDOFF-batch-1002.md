# 2026-10-02 小 bug 批次交接

## 当前状态

- 仓库：`ob-dashboard2`。这一批跨窗口修复，最后由 Claude / CC 统一验收、合并并上线。
- 目标统一分支：`fix/batch-1002`，已从实时 `origin/main`（`7ffba8b`）建立。
- 第一项 bug 原分支已推 `d1f1f5f`，现已 cherry-pick 到统一分支为 `153ecd8`；统一分支已推送，修复未合并、未上线。
- 本窗口 Todo 创建时间倒序（`68b2e0f`）与条目控件居中（`5abae80`）已分别提交并推送；后续窗口只处理当次指定范围。
- 用户已确认本窗口代码与 handoff / 索引的提交、推送；交接文档单独提交。工作区另有用户的未跟踪 `.claude/`，不得顺带提交。

## 批次工作约定

1. 全部小 bug 最终归入 `fix/batch-1002`；每个 bug 独立一个 commit，commit message 清楚描述修复对象，不把几个 bug 混在一笔提交里。
2. 每项修完做最小有效验证并记录结果；本批次按用户要求，完整 build 和测试留到全部修完后统一执行。定向测试失败要先处理，不能仅等最终验收。
3. 每项按 `MAINTENANCE_CONTRACT.md` 同步命中的正式文档；本 handoff 只保存批次进度、边界和验收交接，不复制长期系统契约。
4. commit / push 继续遵守用户全局规则：列出仓库、精确文件范围和建议 commit message，取得用户确认后执行。此前的“推”仅授权了第一项 bug，不代表以后自动推送或合并 main。若用户以后明确授权整批，则按新授权执行。
5. 换窗前更新本文件中的提交、验证结果和下一步，并同步索引状态；全部修完的最终报告按 commit 逐条列出“修了什么、改了哪些文件、同步了哪些文档”。

## 统一分支前的边界

2026-10-02 本窗口已刷新远端引用：最新 main 为 `7ffba8b`，包含 `03eaae8`（经 `0813d56` 合并），不包含 `d1f1f5f`。已从该 main 建统一分支，仅 cherry-pick 首项 bug 为 `153ecd8`，无冲突；相对该 main 仅增加此修复提交。未提交的 handoff 索引已保留恢复，`.claude/` 未动。以下为归并前记录及长期边界。

- `fix/wake-noop-process-text` 从 `feat/wake-multi` 的 `03eaae8` 建立，当前提交历史包含多闹钟功能。
- 本次核对本地 `origin/main..HEAD` 有 `03eaae8`（多闹钟）与 `d1f1f5f`（本 bug）。本地远端引用不代替实时远端状态，归并前须重新核对。
- 多闹钟按 `HANDOFF-agent-wake-multi.md` 单独验收，不能因为合并小 bug 批次而顺带上线。
- 下一步建立 `fix/batch-1002` 时，先确认最新 main 是否已包含多闹钟；以已验收的 main 为基础，仅归入 `d1f1f5f`。若已包含该 bug，不重复 cherry-pick。不要直接从当前 HEAD 建批次分支后整条合并。
- 不改写或强推已发布分支；发生冲突时只解决与本 bug 有关的行。若 main 上尚无本 bug 所需结构，先交 Claude 确认依赖顺序，不扩散去移植多闹钟。

## 已完成提交

### `d1f1f5f` — `fix: hide wake noop process text`

**修复内容**：唤醒 noop 轮次调用工具 / 进入房间后，process 中残留的 `[agent_wake_noop] 理由` 被渲染成气泡，与“这次没有发消息 · 理由”重复；刷新仍出现。

**代码与测试文件**：

- `app/lib/cc/backgroundWakeTurn.ts`：仅在现有 noop 判定命中后，过滤含 marker 或仅空白的 process text；工具、房间和 thinking 保留。持久化及返回结果使用过滤后的 process。
- `app/cc/ccHistory.ts`：读取 agent_wake 轮次时，从展示用 process 过滤以 marker 开头的 text（允许前导空白），兼容已有存档；普通轮次不受影响。
- `tests/cc-background-wake.test.ts`：覆盖带工具与房间事件的 noop 保存，断言 marker / 空白 text 消失、其他事件保留。
- `tests/wake-display.test.ts`：覆盖旧记录 marker 位于过程前后时的实际气泡渲染，以及普通轮次保持原样。

**同步文档**：`docs/reference.md` 的 cc 数据持久化契约，说明 noop process 保存与旧记录展示规则。

**验证结果**：

- 定向 Vitest：`tests/cc-background-wake.test.ts`、`tests/wake-display.test.ts`、`tests/agent-wake-tool.test.ts`，共 23 个测试通过。
- `git diff --check` 通过。
- 曾执行 `npm run build`，因现有 Google Fonts 下载连接失败而中止，未取得 build 通过结果；未修改字体或构建配置。
- 补充执行 `npx tsc --noEmit --incremental false`：本次修改文件无类型错误；全仓类型检查仍有其他测试文件报错，未扩大范围处理。

**不得扩散的边界**：不改 noop 判定规则、不改提示词、不动三档设计及待办 `ec32abef`；不修改已有存档，不修改 Haven。

## 下一窗口范围与最终验收

### 本窗口 Todo 两项（已分别提交并推送）

- 文件：仅 `app/care/page.tsx`，不改照顾备忘、筛选、表单、API 或 Haven。
- 排序：未完成与已完成列表都按 `created_at` 倒序，最新添加在前；无效日期排末尾，排序不修改原始状态数组。commit：`68b2e0f` — `fix: sort todos newest first`。
- 对齐：两种列表的勾选框和右侧日期均在条目内垂直居中，去掉未完成勾选框的顶部偏移；标题和背景说明保持自然排列。commit：`5abae80` — `fix: center todo row controls vertically`。
- 验证：直接运行页面实际比较器，跨时区的新旧时间、无效日期及输入数组不变检查通过。页面 ESLint 与 `git diff --check` 通过；未新增测试文件。完整 build 和测试仍留批次结束执行。
- 按维护契约核对：未新增页面、共享组件、API 或设计 Token，无需修改正式文档；本批次进度同步本文件与索引。
- 人工验收：在 `/care` 的技术 / 情感分类新增两条 Todo，最新一条在首位；检查单行、多行、带背景说明、展开以及已完成条目的勾选框和日期居中，完成 / 重新打开操作正常。尚未执行浏览器或 iPhone 实机验收。

下一窗口在统一分支上只修用户指定的下一项 bug。开工前核对工作区、当前分支和是否有尚未提交的交接文档；不要丢弃其他窗口或用户的修改。当前两项代码已推修复分支，尚未合并 main 或上线；本次“推”仅覆盖本窗口列明范围，后续 bug 仍需适用的提交授权。

全部 bug 修完后，由 Claude / CC：

1. 核对 `fix/batch-1002` 相对最新 main 的提交与文件范围，确认不夹带未验收的功能；按每个 bug 检查对应文档和测试。
2. 统一跑 Dashboard build 和测试；涉及 Windows 符号链接限制的用例在 Linux 验证。区分环境故障、已有错误和本批次回归，结果写明。
3. noop 验收：带工具 / 房间的 noop 新轮次保存后，raw.process 无 marker text 和空白 text，工具 / 房间仍在；旧记录刷新后无重复 marker 气泡；“这次没有发消息 · 理由”仍显示；普通轮次正常正文与 noop 判定保持原样。
4. 提供按 commit 列出的最终报告。取得适用的合并 / 推送授权后合并 main、推送并核对自动部署目标提交与健康状态；仅推修复分支不算上线。
5. 完成验收、上线后在 handoff 索引标记归档。
