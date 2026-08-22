<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CC 工作窗口协作规范

- 先讨论后动手：高风险改动（多文件、数据结构、持久化、部署）先列 3-5 行清单等确认再改；单文件小改可以直接执行
- 不扩散修改范围：用户说改什么就只改什么，不顺手重构相邻代码
- 排障用假设→验证：开始调查前先写假设和验证方法，被推翻再换方向
- 结论导向：交付结论和操作路径，不贴大段代码走查
- Git：CC 可直接 commit + push；VPS 部署仍需用户手动到 Coolify 触发
- 换窗交接：一个窗口一个问题，换窗前更新 handoff

## cc 数据持久化规则

新增 cc 配置或用户数据前，必须先判断它是否需要跨重启、跨部署或跨设备保留。

- 需要长期保留的配置（例如 MCP、协作者、provider、Persona、用户开关）统一由 Haven 持久化。
- 不得把 `process.cwd()`、项目内 `.data`、Vercel `/tmp`、模块全局变量或单个 serverless 实例的内存作为唯一持久存储。
- 进程内状态只用于允许丢失的运行态，例如 SDK session、busy、缓存和待批准操作。
- `localStorage` 只用于换设备后丢失也没关系的纯界面偏好。
- 含密钥的配置只能由服务端读写；浏览器只接收掩码，不能拿到持久层中的明文密钥。
- 新功能的自查清单必须写明数据属于哪一类、最终存在哪里；不能先用临时文件上线再补持久化。

## 文档收尾入口

- 每次代码改动完成后，按 `MAINTENANCE_CONTRACT.md` 的「变更 → 同步表」确认需要同步的文档，文档同步后才算完成。
- 已排入后续窗口的工作写入对应 handoff；短期不处理、没有明确排期的遗留问题才写入 `TECH_DEBT.md`。具体分类遵循全局 `AGENTS.md`，本文件不重复维护通用规则。

## Coolify 手动发布

- 涉及 VPS、Coolify、发布、回滚或 Dashboard/Haven 跨仓库联动时，开始前必须同时读取本文件与相邻 `Ombre-Brain-Haven/AGENTS.md`；不能只读当前仓库规则。
- VPS 正式 Dashboard 的 Coolify Application 来源为 Public GitHub `heyeovo/ob-dashboard2`、分支 `main`、Commit SHA `HEAD`，但 `Auto deploy` 为 `Manual deployments only` 且 Preview deployments 关闭。用户 commit + push 只更新 GitHub，不会上线。
- 需要正式发布时，必须先提醒用户确认目标 commit，再到 Coolify `Ombre Brain → production → ob-dashboard2:main-… → Actions → Redeploy` 手动部署；部署完成后检查目标 commit、healthcheck 和关键功能。不得把 push 成功当成 VPS 已更新。
- 回滚路径为 `Git Source → Commit SHA` 填入上一完整 SHA，保存后手动 `Redeploy`；恢复时填回目标 SHA 或 `HEAD` 再部署。实际回滚正式 Dashboard 前必须再次取得用户确认。
- 每次涉及可部署代码的任务收尾，都要主动告诉用户“本次是否需要上线”。需要上线时给出上述点击路径；纯文档或不需上线的改动明确说“本次不用部署”。
