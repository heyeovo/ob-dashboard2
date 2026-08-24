# 自动打标运行参数交接

## 当前状态

- 已完成 Dashboard 与 Haven 跨仓库实现，尚未由用户 commit、push 和部署。
- Dashboard「设置 → 记忆处理 → 脱水 / 打标 API」的现有 Max Tokens、Temperature 现在会用于自动打标，并新增 Thinking 开关。
- Haven 继续以 dehydration 的 `max_tokens`、`temperature`、`thinking_mode` 持久化；保存后 Brain 与 Gateway 热更新，重启后继续从 runtime overlay 读取。
- 正式自动打标和「测试」按钮与记忆合并共用这组模型运行参数。
- Thinking 关闭时不发送 `thinking` 字段。

## 已确认的产品决定

- 参数保留在已有「脱水 / 打标 API」配置中，不在 Prompt 页面重复维护。
- 自动打标与记忆合并共用这组 dehydration 模型参数；其他自动化任务不受影响。
- 智谱 `glm-4.7-flash` 应配 OpenAI-compatible Base URL：`https://open.bigmodel.cn/api/paas/v4`。

## 下一步与边界

- 用户分别提交 Dashboard 和 Haven 改动；不要代替用户 push。
- 按 Haven `AGENTS.md` 的 Coolify `HAVEN_RELEASE_SHA` 流程部署 Brain 与 Gateway，再部署 Dashboard。
- 不重构模型层，不修改其他 Prompt 或自动化任务。

## 验收方法

1. 「记忆处理 → 脱水 / 打标 API」修改 Max Tokens、Temperature、Thinking 并保存，刷新页面后值仍保留。
2. 在「测试」弹窗输入正文，确认 GLM 返回结构化打标结果。
3. 分别切换 Thinking 开关，确认关闭时请求不含 `thinking`、开启时为 `thinking.type=enabled`。
4. 确认记忆合并继续共用同一组 Max Tokens、Temperature 和 Thinking 配置。

## 已完成验证

- Haven `tests.test_prompt_layering`：6/6 通过。
- 修改的 Python 文件 `py_compile` 通过。
- Dashboard `npm run build` 通过，包含 TypeScript 检查。
