// 助手侧的身份（头像 + 名字）。
//
// ⚠️ 第一版硬编码。下一轮（4.5b 协作者体系）会把这里换成读服务端配置，
// 届时只替换这一个数据源，CcMessageRow 不用改。
// 协作者的提示词要落到 /api/cc-chat 的 systemPrompt.append，那是 4.5b 的活。

export type CcPersona = {
  /** 显示名 */
  name: string
  /** 没有头像图时显示的字 */
  initial: string
  /** 头像底色 */
  tint: string
}

export const DEFAULT_PERSONA: CcPersona = {
  name: 'Ombre',
  initial: 'O',
  tint: 'var(--chat-avatar-tint)',
}
