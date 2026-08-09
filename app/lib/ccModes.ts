// 闲聊 / 工作双模式（5.2）。服务端和前端共用，所以放 lib 而不是 app/cc。
//
// 用户的出发点：日常闲聊不需要它知道 claude code 那几万字操作说明，进工作状态才需要。
//
// ⚠️ 关键是**模式和工具一起切**，不是只换 prompt：
//
//   |                | 闲聊                        | 工作（4.5b 起的现状）        |
//   |----------------|-----------------------------|------------------------------|
//   | systemPrompt   | 协作者配置                  | preset + 协作者配置          |
//   | cc 那 7 个工具 | 不给（tools: []）           | 给                           |
//   | 日常 MCP       | 给                          | 给                           |
//   | 批准闸门       | 用不上（没有写工具）        | 照现状                       |
//   | 记忆注入       | 给（这是闲聊的核心）        | 给                           |
//
// 为什么工作模式不能也换掉 preset：那几万字里装着工具怎么用、路径怎么写、
// Edit 前要先 Read 这些规矩，换掉之后工具就废了（它会瞎试然后失败）。
//
// ⚠️ 模式绑在**新建对话**上，中途换不了 —— systemPrompt 和 tools 是子进程
// 启动时定死的参数。界面上「本窗口设置」里它是只读的。

export type CcMode = 'chat' | 'work'

export function isCcMode(raw: unknown): raw is CcMode {
  return raw === 'chat' || raw === 'work'
}

export const MODE_LABEL: Record<CcMode, string> = {
  chat: '闲聊',
  work: '工作',
}

export const MODE_HINT: Record<CcMode, string> = {
  chat: '不带 claude code 那几万字操作说明，也不给它动文件的工具；记忆与联网 MCP 照常可用。',
  work: '完整的 claude code：能读写文件、跑命令（每次都要你点批准）。',
}
