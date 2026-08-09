'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type HavenConfig = {
  gateway?: {
    domain_sentinel_enabled?: boolean
    domain_sentinel_model?: string
    domain_sentinel_base_url?: string
    domain_sentinel_api_key_masked?: string
  }
  reflection?: {
    model?: string
    thinking_mode?: string
    base_url?: string
    api_key_masked?: string
  }
  daily_review?: {
    enabled?: boolean
    model?: string
    thinking_mode?: string
    base_url?: string
    api_key_masked?: string
  }
}

type FormState = {
  sentinelEnabled: boolean
  sentinelModel: string
  sentinelBaseUrl: string
  sentinelApiKey: string
  autoMemoryModel: string
  autoMemoryThinkingMode: string
  autoMemoryBaseUrl: string
  autoMemoryApiKey: string
  dailyReviewEnabled: boolean
  dailyReviewModel: string
  dailyReviewThinkingMode: string
  dailyReviewBaseUrl: string
  dailyReviewApiKey: string
}

type KeyStatus = {
  sentinel: string
  autoMemory: string
  dailyReview: string
}

type Notice = { kind: 'success' | 'error'; text: string } | null

const EMPTY_FORM: FormState = {
  sentinelEnabled: true,
  sentinelModel: '',
  sentinelBaseUrl: '',
  sentinelApiKey: '',
  autoMemoryModel: '',
  autoMemoryThinkingMode: '',
  autoMemoryBaseUrl: '',
  autoMemoryApiKey: '',
  dailyReviewEnabled: true,
  dailyReviewModel: '',
  dailyReviewThinkingMode: '',
  dailyReviewBaseUrl: '',
  dailyReviewApiKey: '',
}

function responseMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.error === 'string' && record.error) return record.error
    if (typeof record.message === 'string' && record.message) return record.message
  }
  return fallback
}

async function readJson(res: Response) {
  return res.json().catch(() => null) as Promise<unknown>
}

export default function ModelsSettingsPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({
    sentinel: '未配置',
    autoMemory: '未配置',
    dailyReview: '未配置',
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const applyConfig = useCallback((config: HavenConfig) => {
    const gateway = config.gateway ?? {}
    const reflection = config.reflection ?? {}
    const dailyReview = config.daily_review ?? {}

    setForm({
      sentinelEnabled: gateway.domain_sentinel_enabled ?? true,
      sentinelModel: gateway.domain_sentinel_model ?? '',
      sentinelBaseUrl: gateway.domain_sentinel_base_url ?? '',
      sentinelApiKey: '',
      autoMemoryModel: reflection.model ?? '',
      autoMemoryThinkingMode: reflection.thinking_mode ?? '',
      autoMemoryBaseUrl: reflection.base_url ?? '',
      autoMemoryApiKey: '',
      dailyReviewEnabled: dailyReview.enabled ?? true,
      dailyReviewModel: dailyReview.model ?? '',
      dailyReviewThinkingMode: dailyReview.thinking_mode ?? '',
      dailyReviewBaseUrl: dailyReview.base_url ?? '',
      dailyReviewApiKey: '',
    })
    setKeyStatus({
      sentinel: gateway.domain_sentinel_api_key_masked || '未配置',
      autoMemory: reflection.api_key_masked || '未配置',
      dailyReview: dailyReview.api_key_masked || '未配置',
    })
    setDirty(false)
  }, [])

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch('/api/config', { cache: 'no-store' })
      const data = await readJson(res)
      if (!res.ok) throw new Error(responseMessage(data, `读取失败（HTTP ${res.status}）`))
      if (!data || typeof data !== 'object') throw new Error('Haven 返回了无法识别的配置')
      applyConfig(data as HavenConfig)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取配置失败')
    } finally {
      setLoading(false)
    }
  }, [applyConfig])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setDirty(true)
    setNotice(null)
  }

  const save = async () => {
    setSaving(true)
    setNotice(null)

    try {
      const gateway: Record<string, unknown> = {
        domain_sentinel_enabled: form.sentinelEnabled,
        domain_sentinel_model: form.sentinelModel,
        domain_sentinel_base_url: form.sentinelBaseUrl,
      }
      const reflection: Record<string, unknown> = {
        model: form.autoMemoryModel,
        thinking_mode: form.autoMemoryThinkingMode,
        base_url: form.autoMemoryBaseUrl,
      }
      const daily_review: Record<string, unknown> = {
        enabled: form.dailyReviewEnabled,
        model: form.dailyReviewModel,
        thinking_mode: form.dailyReviewThinkingMode,
        base_url: form.dailyReviewBaseUrl,
      }

      if (form.sentinelApiKey) gateway.domain_sentinel_api_key = form.sentinelApiKey
      if (form.autoMemoryApiKey) reflection.api_key = form.autoMemoryApiKey
      if (form.dailyReviewApiKey) daily_review.api_key = form.dailyReviewApiKey

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persist: true, persist_env: true, gateway, reflection, daily_review }),
      })
      const data = await readJson(res)
      if (!res.ok || (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false)) {
        throw new Error(responseMessage(data, `保存失败（HTTP ${res.status}）`))
      }

      const refreshed = await fetch('/api/config', { cache: 'no-store' })
      const refreshedData = await readJson(refreshed)
      if (!refreshed.ok || !refreshedData || typeof refreshedData !== 'object') {
        setForm(prev => ({ ...prev, sentinelApiKey: '', autoMemoryApiKey: '', dailyReviewApiKey: '' }))
        setDirty(false)
        setNotice({ kind: 'success', text: '已保存，但未能重新读取密钥状态' })
        return
      }

      applyConfig(refreshedData as HavenConfig)
      setNotice({ kind: 'success', text: '已保存并立即生效' })
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : '保存失败',
      })
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]'
  const labelClass = 'mb-1 block text-xs text-[var(--color-text-tertiary)]'

  const secretField = (
    field: 'sentinelApiKey' | 'autoMemoryApiKey' | 'dailyReviewApiKey',
    current: string,
  ) => (
    <div>
      <label className={labelClass}>API Key</label>
      <input
        type="password"
        autoComplete="new-password"
        className={`${inputClass} font-mono text-xs`}
        value={form[field]}
        placeholder={`当前：${current}`}
        onChange={event => patch(field, event.target.value)}
      />
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-disabled)]">
        留空表示不修改现有密钥。
      </p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-28 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <Link href="/settings" className="text-xs text-[var(--color-text-tertiary)]">
          ← 设置
        </Link>
        <span className="text-sm font-semibold">召回、自动记忆与日回顾模型</span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
            召回、自动记忆与日回顾模型
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            分别配置召回判断、已暂停的自动记忆，以及每天独立生成的日回顾。
          </p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-disabled)]">读取中…</div>
        ) : loadError ? (
          <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>读取失败：{loadError}</p>
            <button
              type="button"
              className="mt-3 rounded-[var(--radius-md)] border border-red-300 px-3 py-1.5"
              onClick={() => void loadConfig()}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-[var(--color-text-heading)]">
                    召回模型 / 主域哨兵
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    判断当前对话是否需要进入记忆召回；它不是聊天回复模型。
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.sentinelEnabled}
                    onChange={event => patch('sentinelEnabled', event.target.checked)}
                  />
                  启用
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>模型</label>
                  <input
                    className={inputClass}
                    value={form.sentinelModel}
                    placeholder="例如：provider/model"
                    onChange={event => patch('sentinelModel', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input
                    className={inputClass}
                    value={form.sentinelBaseUrl}
                    placeholder="https://..."
                    onChange={event => patch('sentinelBaseUrl', event.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  {secretField('sentinelApiKey', keyStatus.sentinel)}
                </div>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-[var(--color-text-heading)]">日回顾模型</h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                    每天凌晨 4 点整理前一天的对话，单独保存，不进入记忆桶或语义召回。
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.dailyReviewEnabled}
                    onChange={event => patch('dailyReviewEnabled', event.target.checked)}
                  />
                  启用
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>模型</label>
                  <input className={inputClass} value={form.dailyReviewModel} placeholder="例如：provider/model" onChange={event => patch('dailyReviewModel', event.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>思考模式</label>
                  <select className={inputClass} value={form.dailyReviewThinkingMode} onChange={event => patch('dailyReviewThinkingMode', event.target.value)}>
                    <option value="">跟随模型默认</option>
                    <option value="enabled">启用</option>
                    <option value="disabled">禁用</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input className={inputClass} value={form.dailyReviewBaseUrl} placeholder="https://..." onChange={event => patch('dailyReviewBaseUrl', event.target.value)} />
                </div>
                <div>{secretField('dailyReviewApiKey', keyStatus.dailyReview)}</div>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="font-semibold text-[var(--color-text-heading)]">自动记忆模型（已暂停）</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
                  保留原配置和历史候选；后台自动生成机制当前停用。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>模型</label>
                  <input
                    className={inputClass}
                    value={form.autoMemoryModel}
                    placeholder="例如：provider/model"
                    onChange={event => patch('autoMemoryModel', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>思考模式</label>
                  <select
                    className={inputClass}
                    value={form.autoMemoryThinkingMode}
                    onChange={event => patch('autoMemoryThinkingMode', event.target.value)}
                  >
                    <option value="">跟随模型默认</option>
                    <option value="enabled">启用</option>
                    <option value="disabled">禁用</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input
                    className={inputClass}
                    value={form.autoMemoryBaseUrl}
                    placeholder="https://..."
                    onChange={event => patch('autoMemoryBaseUrl', event.target.value)}
                  />
                </div>
                <div>{secretField('autoMemoryApiKey', keyStatus.autoMemory)}</div>
              </div>
            </section>

            <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-5 text-sm">
                {notice ? (
                  <span className={notice.kind === 'error' ? 'text-red-600' : 'text-emerald-700'}>
                    {notice.text}
                  </span>
                ) : dirty ? (
                  <span className="text-[var(--color-text-tertiary)]">有未保存的修改</span>
                ) : (
                  <span className="text-[var(--color-text-disabled)]">当前没有未保存的修改</span>
                )}
              </div>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void save()}
                className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
