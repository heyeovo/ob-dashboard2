# HANDOFF｜钉选、feel、配置持久化与轨迹整合

## 当前状态

- 2026-08-27 首轮 Dashboard 与 Haven 修改已由用户 push 并发布；Haven 发布版本为 `b02600eea33fef3a5906819a47e4ef54f7a5a5d3`。
- 首轮发布后发现取消钉选回归：`frontmatter.Post` 没有 `.pop()`，导致 Haven PATCH 返回 500；现已在本地改为存在时 `del`。Dashboard 的 `edit-bucket` 代理也已在本地补上非 JSON 上游错误容错。这两处回归修复尚待用户 commit、push 和重新部署。
- 日回顾连续性保持原有“前两个日历日”，本轮没有修改。
- Dashboard production build 已通过；Haven 相关 `unittest` 65 项通过、2 项因本地轻量 Python 缺少 Haven 运行依赖而跳过，Python 语法检查通过。

## 已确认并实现的产品决定

- 桶抽屉更新必须使用 Haven 返回的真实 bucket，不再吞掉失败；取消普通钉选后恢复钉选前的 dynamic/type 与 importance，因此权重不再是 999。protected 或原本就是 permanent 的桶仍按自身语义保持 999。
- 换窗弹窗读取全量桶并显示所有钉选桶；新增独立 feel 注入，默认开启、默认最近 10 条，可调 1–50，排除 whisper 与日/周印象、关系天气。
- 配置页的非秘密配置继续写 `/state/config.runtime.yaml`；脱水、Embedding、Reranker、Persona、Dream 等 API key 写 `/state/.env`，容器启动时读取，Coolify 直接环境变量优先。
- weekly journey 的 `append_current` 改为 `revised_content`：模型输出去重整合后的完整开放阶段正文，默认最多 5000 字符，批准后替换正文，不再末尾追加。旧 pending 候选仍可兼容读取。
- 新增 `breath(domain="pinned")`，一次读取钉选桶全集，仍受 `max_tokens` 总预算约束。

## 不得扩散的边界

- 不改日回顾前两天连续性。
- 不改变 protected、原生 permanent、journey 隔离、人工审批和 transition 两步写入语义。
- 不把 API key 写入 YAML、浏览器或 Git。

## 发布与验收

1. 用户分别在 Dashboard 与 Haven 仓库 commit + push 当前回归修复。
2. Dashboard 重新部署；Haven 在 Coolify `Ombre Brain → production → haven-test-stack → Environment Variables` 更新 `HAVEN_RELEASE_SHA` 为 Haven 完整 commit SHA，再普通 Restart/Deploy。
3. 验收：取消一个普通钉选桶后按钮变为“钉选”且权重不为 999；换窗看到全部钉选桶并可调整 feel 数量；保存脱水 Key 后重启容器仍显示已配置且自动打标成功；下一次 weekly journey 候选显示“整合后的完整阶段正文”；调用 `breath(domain="pinned")` 能列出全部钉选桶。
