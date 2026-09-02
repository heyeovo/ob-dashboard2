'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { BarkNotificationConfig, BarkNotificationRecent } from '@/app/lib/havenTurns'

type Payload = {
  ok?: boolean
  config?: BarkNotificationConfig
  recent?: BarkNotificationRecent | null
  queued?: boolean
  error?: string
}

const INPUT = 'mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]'
const BUTTON = 'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] disabled:opacity-50'

function statusText(recent: BarkNotificationRecent | null) {
  if (!recent) return '还没有发送记录'
  const labels: Record<string, string> = {
    pending: '等待发送', sending: '正在发送', retrying: '发送失败，等待重试', sent: '发送成功', failed: '最终失败',
  }
  const time = recent.sent_at || recent.updated_at
  return `${labels[recent.status] || recent.status} · ${recent.sent_count}/${recent.total_count}${time ? ` · ${new Date(time).toLocaleString('zh-CN')}` : ''}`
}

export default function NotificationSettingsPage() {
  const [config, setConfig] = useState<BarkNotificationConfig | null>(null)
  const [recent, setRecent] = useState<BarkNotificationRecent | null>(null)
  const [deviceKey, setDeviceKey] = useState('')
  const [encryptionKey, setEncryptionKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/cc-notifications', { cache: 'no-store' })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok || !payload.config) throw new Error(payload.error || '读取失败')
      setConfig(current => ({
        ...payload.config!,
        dashboard_base_url: payload.config!.dashboard_base_url || current?.dashboard_base_url || window.location.origin,
      }))
      setRecent(payload.recent || null)
    } catch (cause) {
      setError((cause as Error).message || '读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async (extra: Record<string, unknown> = {}) => {
    if (!config) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const changes: Record<string, unknown> = {
        enabled: config.enabled,
        server_url: config.server_url,
        dashboard_base_url: config.dashboard_base_url,
        encryption_enabled: config.encryption_enabled,
        hide_body: config.hide_body,
        segment_interval_ms: config.segment_interval_ms,
        max_segments: config.max_segments,
        ...extra,
      }
      if (deviceKey.trim()) changes.device_key = deviceKey.trim()
      if (encryptionKey) changes.encryption_key = encryptionKey
      const response = await fetch('/api/cc-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok || !payload.config) throw new Error(payload.error || '保存失败')
      setConfig(payload.config)
      setDeviceKey('')
      setEncryptionKey('')
      setMessage('已保存')
    } catch (cause) {
      setError((cause as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/cc-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const payload = await response.json() as Payload
      if (!response.ok || !payload.ok || !payload.queued) throw new Error(payload.error || '测试推送失败')
      setMessage('测试推送已进入发送队列')
      window.setTimeout(() => void load(), 1800)
    } catch (cause) {
      setError((cause as Error).message || '测试推送失败')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-[var(--color-text-tertiary)]">正在读取通知设置…</div>

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 text-[var(--color-text-primary)] sm:px-6">
      <Link href="/settings" className="text-xs text-[var(--color-text-tertiary)]">← 返回设置</Link>
      <h1 className="mt-4 text-2xl font-bold text-[var(--color-text-heading)]">Bark 通知</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-tertiary)]">
        Claude 主动发来正式消息后，由 Haven 服务端推送到 iPhone。Device Key 和加密密钥不会返回浏览器。
      </p>

      {config ? (
        <div className="mt-6 space-y-5">
          <section className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>启用 Bark 通知通道</span>
              <input type="checkbox" checked={config.enabled} onChange={event => setConfig({ ...config, enabled: event.target.checked })} />
            </label>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              Bark Server 地址
              <input className={INPUT} value={config.server_url} onChange={event => setConfig({ ...config, server_url: event.target.value })} placeholder="https://api.day.app" />
            </label>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              Device Key {config.has_device_key ? `（已保存 ${config.device_key_masked}）` : ''}
              <input className={INPUT} type="password" value={deviceKey} onChange={event => setDeviceKey(event.target.value)} placeholder={config.has_device_key ? '留空表示保留原值' : '从 Bark App 复制'} autoComplete="new-password" />
            </label>
            {config.has_device_key ? <button className={BUTTON} disabled={saving} onClick={() => void save({ clear_device_key: true, enabled: false })}>删除 Device Key</button> : null}
            <label className="block text-xs text-[var(--color-text-secondary)]">
              Dashboard 公开地址（通知点击后打开）
              <input className={INPUT} value={config.dashboard_base_url} onChange={event => setConfig({ ...config, dashboard_base_url: event.target.value })} placeholder="https://dashboard.example.com" />
            </label>
          </section>

          <section className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>加密通知正文</span>
              <input type="checkbox" checked={config.encryption_enabled} onChange={event => setConfig({ ...config, encryption_enabled: event.target.checked })} />
            </label>
            <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">需要在 Bark App 的“推送加密”中设置同一个 16 字节密钥。</p>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              加密密钥 {config.has_encryption_key ? `（已保存 ${config.encryption_key_masked}）` : ''}
              <input className={INPUT} type="password" value={encryptionKey} onChange={event => setEncryptionKey(event.target.value)} placeholder={config.has_encryption_key ? '留空表示保留原值' : '恰好 16 个 ASCII 字符'} autoComplete="new-password" />
            </label>
            {config.has_encryption_key ? <button className={BUTTON} disabled={saving} onClick={() => void save({ clear_encryption_key: true, encryption_enabled: false })}>删除加密密钥</button> : null}
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>隐藏正文，只显示新消息提示</span>
              <input type="checkbox" checked={config.hide_body} onChange={event => setConfig({ ...config, hide_body: event.target.checked })} />
            </label>
          </section>

          <section className="grid gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2">
            <label className="block text-xs text-[var(--color-text-secondary)]">
              分段间隔（毫秒）
              <input className={INPUT} type="number" min={250} max={10000} value={config.segment_interval_ms} onChange={event => setConfig({ ...config, segment_interval_ms: Number(event.target.value) })} />
            </label>
            <label className="block text-xs text-[var(--color-text-secondary)]">
              每轮最多通知数
              <input className={INPUT} type="number" min={1} max={20} value={config.max_segments} onChange={event => setConfig({ ...config, max_segments: Number(event.target.value) })} />
            </label>
          </section>

          <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
            <div className="font-medium text-[var(--color-text-heading)]">最近发送状态</div>
            <div className="mt-2 text-xs text-[var(--color-text-tertiary)]">{statusText(recent)}</div>
            {recent?.last_error ? <div className="mt-2 text-xs text-[var(--color-danger)]">{recent.last_error}</div> : null}
          </section>

          {error ? <div className="text-sm text-[var(--color-danger)]">{error}</div> : null}
          {message ? <div className="text-sm text-[var(--color-digested)]">{message}</div> : null}
          <div className="flex flex-wrap gap-3">
            <button className={BUTTON} disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button>
            <button className={BUTTON} disabled={testing || saving || !config.has_device_key} onClick={() => void test()}>{testing ? '正在入队…' : '发送测试通知'}</button>
          </div>
        </div>
      ) : <div className="mt-6 text-sm text-[var(--color-danger)]">{error || '通知设置不可用'}</div>}
    </main>
  )
}
