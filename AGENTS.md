<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
