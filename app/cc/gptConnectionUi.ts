import type { GptConnectionError, GptConnectionResponse } from './types'

export function gptConnectionReady(connection: GptConnectionResponse | null): boolean {
  return Boolean(connection?.ok && connection.configured && !connection.error
    && connection.status === 'connected' && connection.sharing)
}
export function gptConnectionLabel(connection: GptConnectionResponse | null, loading: boolean): string {
  if (loading) return '正在读取状态'
  if (!connection) return '尚未读取授权状态'
  if (!connection.ok) return '状态读取失败'
  if (connection.error?.code === 'revocation_failed') return '本地已断开，远端撤销待确认'
  if (connection.error) return connection.error.action === 'reconnect' ? '需要重新授权' : '连接需要检查'
  if (!connection.configured) return '服务器尚未配置'
  if (connection.status === 'reauth_required') return '需要重新授权'
  if (connection.status === 'connecting') return '授权处理中'
  if (connection.status === 'disconnected') return '尚未连接'
  if (!connection.sharing) return '订阅共享未开启'
  return '已保存授权'
}
export function gptConnectionErrorNote(error: GptConnectionError): string {
  const action = error.code === 'revocation_failed' ? '本地已断开，请到 ChatGPT 设置检查远端授权是否已撤销。'
    : error.action === 'inspect' ? '请先检查服务器配置或授权文件，保留原文件，不要用重新登录覆盖存储故障。'
    : error.action === 'reconnect' ? '请在电脑上用专用管理工具重新登录，再通过 SSH 安全交接。手机不能直接完成此操作。'
    : error.action === 'usage_settings' ? '请到 ChatGPT 设置查看共享额度；剩余额度与重置时间未知。'
    : error.action === 'enable_sharing' ? '请到 ChatGPT 设置开启订阅共享，再刷新状态。'
    : '请刷新状态重试；若页面登录已失效，请先重新登录此页面。'
  return `${error.message} ${action}`
}
