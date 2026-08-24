'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type HavenConfig = {
  dehydration?: {
    model?: string
    base_url?: string
    api_key_masked?: string
    max_tokens?: number
    temperature?: number
    thinking_mode?: string
  }
  embedding?: {
    enabled?: boolean
    model?: string
    base_url?: string
    api_key_masked?: string
    has_own_api_key?: boolean
  }
  reranker?: {
    enabled?: boolean
    model?: string
    base_url?: string
    api_key_masked?: string
    has_own_api_key?: boolean
    api_ready?: boolean
    timeout_seconds?: number
    candidate_limit?: number
    score_weight?: number
  }
}

type FormState = {
  dehydrationModel: string
  dehydrationBaseUrl: string
  dehydrationApiKey: string
  dehydrationMaxTokens: string
  dehydrationTemperature: string
  dehydrationThinkingMode: '' | 'enabled'
  embeddingEnabled: boolean
  embeddingModel: string
  embeddingBaseUrl: string
  embeddingApiKey: string
  rerankerEnabled: boolean
  rerankerModel: string
  rerankerBaseUrl: string
  rerankerApiKey: string
  rerankerTimeout: string
  rerankerCandidates: string
  rerankerWeight: string
}

type KeyStatus = {
  dehydration: string
  embedding: string
  reranker: string
}

type Notice = { kind: 'success' | 'error'; text: string } | null

const EMPTY_FORM: FormState = {
  dehydrationModel: '',
  dehydrationBaseUrl: '',
  dehydrationApiKey: '',
  dehydrationMaxTokens: '1024',
  dehydrationTemperature: '0.1',
  dehydrationThinkingMode: '',
  embeddingEnabled: false,
  embeddingModel: '',
  embeddingBaseUrl: '',
  embeddingApiKey: '',
  rerankerEnabled: false,
  rerankerModel: '',
  rerankerBaseUrl: '',
  rerankerApiKey: '',
  rerankerTimeout: '12',
  rerankerCandidates: '20',
  rerankerWeight: '0.65',
}

const EMPTY_KEY_STATUS: KeyStatus = {
  dehydration: '未设置',
  embedding: '复用脱水 API',
  reranker: '未设置',
}

function formFromConfig(config: HavenConfig): FormState {
  const dehydration = config.dehydration || {}
  const embedding = config.embedding || {}
  const reranker = config.reranker || {}

  return {
    dehydrationModel: dehydration.model || '',
    dehydrationBaseUrl: dehydration.base_url || '',
    dehydrationApiKey: '',
    dehydrationMaxTokens: String(dehydration.max_tokens ?? 1024),
    dehydrationTemperature: String(dehydration.temperature ?? 0.1),
    dehydrationThinkingMode: dehydration.thinking_mode === 'enabled' ? 'enabled' : '',
    embeddingEnabled: Boolean(embedding.enabled),
    embeddingModel: embedding.model || '',
    embeddingBaseUrl: embedding.base_url || '',
    embeddingApiKey: '',
    rerankerEnabled: Boolean(reranker.enabled),
    rerankerModel: reranker.model || '',
    rerankerBaseUrl: reranker.base_url || '',
    rerankerApiKey: '',
    rerankerTimeout: String(reranker.timeout_seconds ?? 12),
    rerankerCandidates: String(reranker.candidate_limit ?? 20),
    rerankerWeight: String(reranker.score_weight ?? 0.65),
  }
}

function keyStatusFromConfig(config: HavenConfig): KeyStatus {
  const dehydration = config.dehydration || {}
  const embedding = config.embedding || {}
  const reranker = config.reranker || {}

  return {
    dehydration: dehydration.api_key_masked || '未设置',
    embedding:
      embedding.api_key_masked || (embedding.has_own_api_key ? '已配置' : '复用脱水 API'),
    reranker:
      reranker.api_key_masked ||
      (reranker.has_own_api_key
        ? '已配置'
        : reranker.api_ready
          ? '复用向量 API'
          : '未设置'),
  }
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

function validateNumber(
  value: string,
  label: string,
  min: number,
  max: number,
  integer = false,
) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label}须为 ${min}–${max}${integer ? ' 的整数' : ''}`)
  }
  return parsed
}

export default function MemoryProcessingSettingsPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(EMPTY_KEY_STATUS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const applyConfig = useCallback((config: HavenConfig) => {
    setForm(formFromConfig(config))
    setKeyStatus(keyStatusFromConfig(config))
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
      const payload: Record<string, unknown> = {
        persist: true,
        dehydration: {
          model: form.dehydrationModel,
          base_url: form.dehydrationBaseUrl,
          max_tokens: validateNumber(
            form.dehydrationMaxTokens,
            'Max Tokens',
            128,
            8192,
            true,
          ),
          temperature: validateNumber(form.dehydrationTemperature, 'Temperature', 0, 2),
          thinking_mode: form.dehydrationThinkingMode,
        },
        embedding: {
          enabled: form.embeddingEnabled,
          model: form.embeddingModel,
          base_url: form.embeddingBaseUrl,
        },
        reranker: {
          enabled: form.rerankerEnabled,
          model: form.rerankerModel,
          base_url: form.rerankerBaseUrl,
          timeout_seconds: validateNumber(form.rerankerTimeout, 'Timeout', 1, 120),
          candidate_limit: validateNumber(
            form.rerankerCandidates,
            '候选上限',
            1,
            100,
            true,
          ),
          score_weight: validateNumber(form.rerankerWeight, '重排权重', 0, 1),
        },
      }

      if (form.dehydrationApiKey) {
        ;(payload.dehydration as Record<string, unknown>).api_key = form.dehydrationApiKey
      }
      if (form.embeddingApiKey) {
        ;(payload.embedding as Record<string, unknown>).api_key = form.embeddingApiKey
      }
      if (form.rerankerApiKey) {
        ;(payload.reranker as Record<string, unknown>).api_key = form.rerankerApiKey
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJson(res)
      if (!res.ok || (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false)) {
        throw new Error(responseMessage(data, `保存失败（HTTP ${res.status}）`))
      }

      const refreshed = await fetch('/api/config', { cache: 'no-store' })
      const refreshedData = await readJson(refreshed)
      if (!refreshed.ok || !refreshedData || typeof refreshedData !== 'object') {
        setForm(prev => ({
          ...prev,
          dehydrationApiKey: '',
          embeddingApiKey: '',
          rerankerApiKey: '',
        }))
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
    label: string,
    field: 'dehydrationApiKey' | 'embeddingApiKey' | 'rerankerApiKey',
    current: string,
    help: string,
  ) => (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type="password"
        autoComplete="new-password"
        className={`${inputClass} font-mono text-xs`}
        value={form[field]}
        placeholder={`当前：${current}`}
        onChange={event => patch(field, event.target.value)}
      />
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-disabled)]">{help}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-28 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <Link href="/settings" className="text-xs text-[var(--color-text-tertiary)]">
          ← 设置
        </Link>
        <span className="text-sm font-semibold">记忆处理</span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
            记忆处理
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            配置记忆脱水、向量化和重排序。保存后立即生效，并由 Haven 跨部署保留。
          </p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-disabled)]">读取中</div>
        ) : loadError ? (
          <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>读取失败：{loadError}</p>
            <button
              type="button"
              className="mt-3 rounded-[var(--radius-md)] border border-red-300 bg-white px-3 py-1.5 text-xs"
              onClick={() => void loadConfig()}
            >
              重试
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold text-[var(--color-text-heading)]">
                脱水 / 打标 API
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    className={inputClass}
                    value={form.dehydrationModel}
                    placeholder="gemini-2.5-flash-lite"
                    onChange={event => patch('dehydrationModel', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input
                    className={inputClass}
                    value={form.dehydrationBaseUrl}
                    placeholder="https://..."
                    onChange={event => patch('dehydrationBaseUrl', event.target.value)}
                  />
                </div>
                {secretField(
                  'API Key',
                  'dehydrationApiKey',
                  keyStatus.dehydration,
                  '留空表示不修改现有密钥。',
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelClass}>Max Tokens</label>
                    <input
                      type="number"
                      min="128"
                      max="8192"
                      className={inputClass}
                      value={form.dehydrationMaxTokens}
                      onChange={event => patch('dehydrationMaxTokens', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Temperature</label>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      className={inputClass}
                      value={form.dehydrationTemperature}
                      onChange={event => patch('dehydrationTemperature', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Thinking</label>
                    <select
                      className={inputClass}
                      value={form.dehydrationThinkingMode}
                      onChange={event => patch(
                        'dehydrationThinkingMode',
                        event.target.value === 'enabled' ? 'enabled' : '',
                      )}
                    >
                      <option value="">关闭</option>
                      <option value="enabled">开启</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">
                    向量化 Embedding
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
                    关闭只停止使用，不会清空下面的配置。
                  </p>
                </div>
                <select
                  className={`${inputClass} w-auto min-w-24`}
                  value={form.embeddingEnabled ? 'true' : 'false'}
                  onChange={event => patch('embeddingEnabled', event.target.value === 'true')}
                >
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    className={inputClass}
                    value={form.embeddingModel}
                    placeholder="Qwen/Qwen3-Embedding-0.6B"
                    onChange={event => patch('embeddingModel', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input
                    className={inputClass}
                    value={form.embeddingBaseUrl}
                    placeholder="https://api.siliconflow.cn/v1"
                    onChange={event => patch('embeddingBaseUrl', event.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  {secretField(
                    'API Key',
                    'embeddingApiKey',
                    keyStatus.embedding,
                    '留空表示不修改；未单独配置时复用脱水 API。',
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">
                    重排序 Reranker
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
                    关闭后 Gateway 和 Breath 不再等待重排序模型。
                  </p>
                </div>
                <select
                  className={`${inputClass} w-auto min-w-24`}
                  value={form.rerankerEnabled ? 'true' : 'false'}
                  onChange={event => patch('rerankerEnabled', event.target.value === 'true')}
                >
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    className={inputClass}
                    value={form.rerankerModel}
                    placeholder="Qwen/Qwen3-Reranker-4B"
                    onChange={event => patch('rerankerModel', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input
                    className={inputClass}
                    value={form.rerankerBaseUrl}
                    placeholder="留空复用 Embedding Base URL"
                    onChange={event => patch('rerankerBaseUrl', event.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  {secretField(
                    'API Key',
                    'rerankerApiKey',
                    keyStatus.reranker,
                    '留空表示不修改；未单独配置时复用 Embedding API Key。',
                  )}
                </div>
                <div>
                  <label className={labelClass}>Timeout（秒）</label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    step="0.5"
                    className={inputClass}
                    value={form.rerankerTimeout}
                    onChange={event => patch('rerankerTimeout', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>候选上限</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className={inputClass}
                    value={form.rerankerCandidates}
                    onChange={event => patch('rerankerCandidates', event.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>重排权重</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    className={inputClass}
                    value={form.rerankerWeight}
                    onChange={event => patch('rerankerWeight', event.target.value)}
                  />
                </div>
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
