'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  EFFORT_OPTIONS,
  EMPTY_UPSTREAM,
  draftProvider,
  upstreamFromHaven,
  upstreamToPayload,
  type CcEffort,
  type CcProvider,
  type CcUpstreamConfig,
} from '@/app/cc/upstream'

/**
 * 上游模型配置（5.2）。
 *
 * 存 Haven（cc_upstream_config 一行 JSON），不存浏览器 —— 手机和电脑读同一份。
 * /cc 的「本窗口设置」列的就是这里配的中转站和模型名。
 *
 * ⚠️ token 不回传浏览器：读回来是 `sk-abc•••` 这种遮掉的样子。
 * 想换 token 就整条重填；不动它的话原样留着（服务端认出遮罩会保留原值）。
 * ⚠️ 模型名要人工填 —— 中转站基本都不给可靠的模型列表接口。
 */

function linesToList(text: string) {
  return text
    .split(/[\n,，]/)
    .map(s => s.trim())
    .filter(Boolean)
}

export default function UpstreamSettingsPage() {
  const [config, setConfig] = useState<CcUpstreamConfig>(EMPTY_UPSTREAM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/cc-upstream', { cache: 'no-store' })
        const data = await res.json()
        if (data.ok) setConfig(upstreamFromHaven(data.config as Record<string, unknown>))
        else setNote(String(data.error || '读不到配置'))
      } catch {
        setNote('读不到配置，检查 Haven 是不是没起来')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const patch = (next: Partial<CcUpstreamConfig>) => setConfig(prev => ({ ...prev, ...next }))

  const patchProvider = (id: string, next: Partial<CcProvider>) =>
    setConfig(prev => ({
      ...prev,
      providers: prev.providers.map(p => (p.id === id ? { ...p, ...next } : p)),
    }))

  const save = async () => {
    setSaving(true)
    setNote('')
    try {
      const res = await fetch('/api/cc-upstream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upstreamToPayload(config)),
      })
      const data = await res.json()
      if (!data.ok) {
        setNote(String(data.error || '没存上'))
        return
      }
      // 存完用服务端那份覆盖：token 会变成遮掉的样子，省得下次保存把明文又发一遍
      if (data.config) setConfig(upstreamFromHaven(data.config as Record<string, unknown>))
      setNote('已保存。新对话生效')
    } catch {
      setNote('没存上，检查 Haven')
    } finally {
      setSaving(false)
    }
  }

  const box = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm'
  const label = 'mb-1 block text-xs text-[var(--color-text-tertiary)]'

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-28 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <Link href="/settings" className="text-xs text-[var(--color-text-tertiary)]">
          ← 设置
        </Link>
        <span className="text-sm font-semibold">上游模型</span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
            上游模型配置
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            这里配好的中转站和模型名，会出现在 /cc 的「本窗口设置」里。改完记得保存。
          </p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-disabled)]">读取中</div>
        ) : (
          <div className="space-y-8">
            {/* ── 中转站 ── */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">API 中转站</h2>
                <button
                  type="button"
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs"
                  onClick={() => patch({ providers: [...config.providers, draftProvider()] })}
                >
                  加一个
                </button>
              </div>

              {config.providers.length === 0 ? (
                <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-xs text-[var(--color-text-disabled)]">
                  还没有中转站。不配也能用 —— 会走 .env.local 里那一条
                </div>
              ) : (
                <div className="space-y-4">
                  {config.providers.map(p => (
                    <div
                      key={p.id}
                      className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4"
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <input
                          className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-1.5 text-sm font-medium"
                          value={p.label}
                          placeholder="显示名"
                          onChange={e => patchProvider(p.id, { label: e.target.value })}
                        />
                        <button
                          type="button"
                          className="shrink-0 text-xs text-[var(--color-danger)]"
                          onClick={() =>
                            patch({ providers: config.providers.filter(x => x.id !== p.id) })
                          }
                        >
                          删除
                        </button>
                      </div>

                      <label className={label}>Base URL</label>
                      <input
                        className={`${box} mb-3`}
                        value={p.baseUrl}
                        placeholder="https://example.com"
                        onChange={e => patchProvider(p.id, { baseUrl: e.target.value })}
                      />

                      <label className={label}>Token（不改就别动，显示的是遮掉的）</label>
                      <input
                        className={`${box} mb-3 font-mono text-xs`}
                        value={p.token}
                        placeholder="sk-..."
                        onChange={e => patchProvider(p.id, { token: e.target.value })}
                      />

                      <label className={label}>模型名，一行一个</label>
                      <textarea
                        className={`${box} font-mono text-xs`}
                        rows={3}
                        value={p.models.join('\n')}
                        placeholder={'claude-opus-4-6\nclaude-sonnet-4-5'}
                        onChange={e => patchProvider(p.id, { models: linesToList(e.target.value) })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 订阅侧 ── */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-heading)]">
                订阅（本机 claude 登录态）
              </h2>
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4">
                <label className={label}>能选的模型名，一行一个（留空就用 claude 自己的默认）</label>
                <textarea
                  className={`${box} font-mono text-xs`}
                  rows={3}
                  value={config.subscriptionModels.join('\n')}
                  placeholder={'opus\nsonnet'}
                  onChange={e => patch({ subscriptionModels: linesToList(e.target.value) })}
                />
              </div>
            </section>

            {/* ── 新对话默认值 ── */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-heading)]">新对话默认用</h2>
              <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4">
                <div>
                  <label className={label}>供应商</label>
                  <div className="flex gap-2">
                    {(['subscription', 'api'] as const).map(kind => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => patch({ defaultKind: kind })}
                        className={`flex-1 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
                          config.defaultKind === kind
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]'
                            : 'border-[var(--color-border)] bg-white'
                        }`}
                      >
                        {kind === 'subscription' ? '订阅' : 'api 中转站'}
                      </button>
                    ))}
                  </div>
                </div>

                {config.defaultKind === 'api' && config.providers.length > 0 ? (
                  <div>
                    <label className={label}>默认中转站</label>
                    <select
                      className={box}
                      value={config.defaultProviderId}
                      onChange={e => patch({ defaultProviderId: e.target.value })}
                    >
                      <option value="">（第一个）</option>
                      {config.providers.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div>
                  <label className={label}>默认模型名（留空 = 上面清单里的第一个）</label>
                  <input
                    className={`${box} font-mono text-xs`}
                    value={config.defaultModel}
                    onChange={e => patch({ defaultModel: e.target.value })}
                  />
                </div>

                <div>
                  <label className={label}>默认力度</label>
                  <div className="flex gap-1.5">
                    {EFFORT_OPTIONS.map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => patch({ defaultEffort: o.id as CcEffort })}
                        className={`flex-1 rounded-[var(--radius-md)] border px-2 py-1.5 text-xs ${
                          config.defaultEffort === o.id
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary-muted)]'
                            : 'border-[var(--color-border)] bg-white'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => patch({ defaultThinking: !config.defaultThinking })}
                  className="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <span>默认开深度思考</span>
                  <span
                    className={
                      config.defaultThinking
                        ? 'text-[var(--color-primary)]'
                        : 'text-[var(--color-text-disabled)]'
                    }
                  >
                    {config.defaultThinking ? '开' : '关'}
                  </span>
                </button>
              </div>
            </section>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? '保存中' : '保存'}
              </button>
              {note ? <span className="text-xs text-[var(--color-text-tertiary)]">{note}</span> : null}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
