'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

type HavenConfig = {
  gateway?: {
    cooldown_hours?: number
    skip_recent_rounds?: number
    recent_context_cooldown_hours?: number
    recent_context_reentry_idle_hours?: number
    recent_context_budget?: number
    recalled_memory_budget?: number
    related_memory_budget?: number
    memory_detail_recall_enabled?: boolean
    memory_detail_recall_max_ids?: number
    memory_detail_recall_budget?: number
    current_inner_state_interval_rounds?: number
    direct_render_mode?: string
    retrieval_mode?: string
    operit_context_rewrite_enabled?: boolean
    word_map_hint_enabled?: boolean
    query_planner_enabled?: boolean
  }
  recall?: {
    query_resurface_enabled?: boolean
  }
  memory_diffusion?: {
    enabled?: boolean
    top_k?: number
    min_activation?: number
    chain_walk_enabled?: boolean
    chain_max_hops?: number
    chain_min_confidence?: number
    chain_max_frontier?: number
  }
}

type FormState = {
  recentEnabled: boolean
  personaEnabled: boolean
  personaRounds: number
  cooldownHours: number
  skipRecentRounds: number
  recentCooldownHours: number
  reentryIdleHours: number
  recentBudget: number
  recalledBudget: number
  relatedBudget: number
  detailRecallEnabled: boolean
  detailMaxIds: number
  detailBudget: number
  directRenderMode: string
  retrievalMode: string
  operitRewriteEnabled: boolean
  wordMapHintEnabled: boolean
  queryPlannerEnabled: boolean
  queryResurfaceEnabled: boolean
  diffusionEnabled: boolean
  diffusionTopK: number
  diffusionMinActivation: number
  chainWalkEnabled: boolean
  chainMaxHops: number
  chainMinConfidence: number
  chainMaxFrontier: number
}

type Notice = { kind: 'success' | 'error'; text: string } | null

const DEFAULT_FORM: FormState = {
  recentEnabled: true,
  personaEnabled: true,
  personaRounds: 15,
  cooldownHours: 6,
  skipRecentRounds: 5,
  recentCooldownHours: 6,
  reentryIdleHours: 24,
  recentBudget: 300,
  recalledBudget: 900,
  relatedBudget: 220,
  detailRecallEnabled: false,
  detailMaxIds: 3,
  detailBudget: 1200,
  directRenderMode: 'auto',
  retrievalMode: 'graph',
  operitRewriteEnabled: false,
  wordMapHintEnabled: false,
  queryPlannerEnabled: false,
  queryResurfaceEnabled: false,
  diffusionEnabled: true,
  diffusionTopK: 4,
  diffusionMinActivation: 0.18,
  chainWalkEnabled: false,
  chainMaxHops: 6,
  chainMinConfidence: 0.72,
  chainMaxFrontier: 24,
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

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-[var(--color-text-heading)]">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs text-[var(--color-text-tertiary)]">{label}</label>
      {children}
      {hint ? (
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-disabled)]">{hint}</p>
      ) : null}
    </div>
  )
}

export default function RecallSettingsPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const applyConfig = useCallback((config: HavenConfig) => {
    const gateway = config.gateway ?? {}
    const recall = config.recall ?? {}
    const diffusion = config.memory_diffusion ?? {}
    const recentBudget = gateway.recent_context_budget ?? 300
    const personaRounds = gateway.current_inner_state_interval_rounds ?? 15

    setForm({
      recentEnabled: recentBudget > 0,
      personaEnabled: personaRounds > 0,
      personaRounds: personaRounds > 0 ? personaRounds : 15,
      cooldownHours: gateway.cooldown_hours ?? 6,
      skipRecentRounds: gateway.skip_recent_rounds ?? 5,
      recentCooldownHours: gateway.recent_context_cooldown_hours ?? 6,
      reentryIdleHours: gateway.recent_context_reentry_idle_hours ?? 24,
      recentBudget: recentBudget > 0 ? recentBudget : 300,
      recalledBudget: gateway.recalled_memory_budget ?? 900,
      relatedBudget: gateway.related_memory_budget ?? 220,
      detailRecallEnabled: gateway.memory_detail_recall_enabled ?? false,
      detailMaxIds: gateway.memory_detail_recall_max_ids ?? 3,
      detailBudget: gateway.memory_detail_recall_budget ?? 1200,
      directRenderMode: gateway.direct_render_mode || 'auto',
      retrievalMode: gateway.retrieval_mode || 'graph',
      operitRewriteEnabled: gateway.operit_context_rewrite_enabled ?? false,
      wordMapHintEnabled: gateway.word_map_hint_enabled ?? false,
      queryPlannerEnabled: gateway.query_planner_enabled ?? false,
      queryResurfaceEnabled: recall.query_resurface_enabled ?? false,
      diffusionEnabled: diffusion.enabled ?? true,
      diffusionTopK: diffusion.top_k ?? 4,
      diffusionMinActivation: diffusion.min_activation ?? 0.18,
      chainWalkEnabled: diffusion.chain_walk_enabled ?? false,
      chainMaxHops: diffusion.chain_max_hops ?? 6,
      chainMinConfidence: diffusion.chain_min_confidence ?? 0.72,
      chainMaxFrontier: diffusion.chain_max_frontier ?? 24,
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
    setForm(previous => ({ ...previous, [key]: value }))
    setDirty(true)
    setNotice(null)
  }

  const save = async () => {
    setSaving(true)
    setNotice(null)

    try {
      const gateway = {
        cooldown_hours: form.cooldownHours,
        skip_recent_rounds: form.skipRecentRounds,
        recent_context_cooldown_hours: form.recentCooldownHours,
        recent_context_reentry_idle_hours: form.reentryIdleHours,
        recent_context_budget: form.recentEnabled ? form.recentBudget || 300 : 0,
        recalled_memory_budget: form.recalledBudget,
        related_memory_budget: form.relatedBudget,
        memory_detail_recall_enabled: form.detailRecallEnabled,
        memory_detail_recall_max_ids: form.detailMaxIds,
        memory_detail_recall_budget: form.detailBudget,
        current_inner_state_interval_rounds: form.personaEnabled ? form.personaRounds || 15 : 0,
        direct_render_mode: form.directRenderMode,
        retrieval_mode: form.retrievalMode,
        operit_context_rewrite_enabled: form.operitRewriteEnabled,
        word_map_hint_enabled: form.wordMapHintEnabled,
        query_planner_enabled: form.queryPlannerEnabled,
      }
      const recall = {
        query_resurface_enabled: form.queryResurfaceEnabled,
      }
      const memory_diffusion = {
        enabled: form.diffusionEnabled,
        top_k: form.diffusionTopK,
        min_activation: form.diffusionMinActivation,
        chain_walk_enabled: form.chainWalkEnabled,
        chain_max_hops: form.chainMaxHops,
        chain_min_confidence: form.chainMinConfidence,
        chain_max_frontier: form.chainMaxFrontier,
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persist: true, gateway, recall, memory_diffusion }),
      })
      const data = await readJson(res)
      if (!res.ok || (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false)) {
        throw new Error(responseMessage(data, `保存失败（HTTP ${res.status}）`))
      }

      const refreshed = await fetch('/api/config', { cache: 'no-store' })
      const refreshedData = await readJson(refreshed)
      if (!refreshed.ok || !refreshedData || typeof refreshedData !== 'object') {
        setDirty(false)
        setNotice({ kind: 'success', text: '已保存，但未能重新读取当前配置' })
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
    'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)] disabled:text-[var(--color-text-disabled)]'
  const numberValue = (value: string) => (value === '' ? 0 : Number(value))
  const numberField = (
    key: keyof FormState,
    options: { min: number; max: number; step?: number; disabled?: boolean },
  ) => (
    <input
      type="number"
      className={inputClass}
      value={form[key] as number}
      min={options.min}
      max={options.max}
      step={options.step}
      disabled={options.disabled}
      onChange={event => patch(key, numberValue(event.target.value) as never)}
    />
  )
  const toggle = (key: keyof FormState, label = '启用') => (
    <label className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm">
      <input
        type="checkbox"
        checked={form[key] as boolean}
        onChange={event => patch(key, event.target.checked as never)}
      />
      {label}
    </label>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-28 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <Link href="/settings" className="text-xs text-[var(--color-text-tertiary)]">
          ← 设置
        </Link>
        <span className="text-sm font-semibold">记忆浮现配置</span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
            记忆浮现配置
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            控制 Haven 何时召回记忆、注入多少上下文，以及如何沿关系图扩散。
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
            <Section title="注入节奏" description="控制最近记忆和 Persona 状态何时进入模型上下文。">
              <Field
                label="最近记忆"
                hint="关闭后不自动注入 Recent Context；直命中和扩散不受影响。"
              >
                {toggle('recentEnabled')}
              </Field>
              <Field label="Persona 提示" hint="关闭只停止提示注入，Persona 仍会在后台更新。">
                {toggle('personaEnabled')}
              </Field>
              <Field label="Persona 轮数" hint="每隔多少轮注入一次 Persona State。">
                {numberField('personaRounds', { min: 0, max: 200, disabled: !form.personaEnabled })}
              </Field>
              <Field label="冷却时间（小时）" hint="同一条记忆再次浮现前的时间冷却。">
                {numberField('cooldownHours', { min: 0, max: 168, step: 0.5 })}
              </Field>
              <Field label="冷却轮数" hint="优先避开最近若干轮已经浮现过的记忆。">
                {numberField('skipRecentRounds', { min: 0, max: 50 })}
              </Field>
              <Field label="最近冷却（小时）" hint="Recent Context 自动重复注入前的冷却。">
                {numberField('recentCooldownHours', { min: 0, max: 168, step: 0.5 })}
              </Field>
              <Field label="再进入（小时）" hint="达到此闲置时长后触发再进入；0 表示关闭。">
                {numberField('reentryIdleHours', { min: 0, max: 168, step: 0.5 })}
              </Field>
            </Section>

            <Section title="上下文预算" description="限制各类记忆最多占用的上下文 token。">
              <Field label="最近预算" hint="Recent Context 的预算；关闭最近记忆时保存为 0。">
                {numberField('recentBudget', { min: 0, max: 4000, disabled: !form.recentEnabled })}
              </Field>
              <Field label="直命中预算" hint="Recalled Memory 直命中最多携带的内容。">
                {numberField('recalledBudget', { min: 0, max: 4000 })}
              </Field>
              <Field label="扩散预算" hint="Diffused Memory 的上下文预算；0 表示不注入。">
                {numberField('relatedBudget', { min: 0, max: 4000 })}
              </Field>
              <Field label="细节二次取回" hint="允许非流式回复按本轮已注入的 bucket_id 取回细节。">
                {toggle('detailRecallEnabled')}
              </Field>
              <Field label="细节条数">
                {numberField('detailMaxIds', { min: 1, max: 3, disabled: !form.detailRecallEnabled })}
              </Field>
              <Field label="细节预算">
                {numberField('detailBudget', {
                  min: 200,
                  max: 4000,
                  disabled: !form.detailRecallEnabled,
                })}
              </Field>
            </Section>

            <Section title="召回策略" description="控制直命中形状、检索路径和辅助召回能力。">
              <Field label="直命中形状" hint="auto 会按桶长度和请求类型选择呈现方式。">
                <select
                  className={inputClass}
                  value={form.directRenderMode}
                  onChange={event => patch('directRenderMode', event.target.value)}
                >
                  <option value="auto">auto</option>
                  <option value="compact">compact</option>
                  <option value="full">full</option>
                </select>
              </Field>
              <Field label="召回模式" hint="graph 使用图召回；bucket 使用直命中对照路径。">
                <select
                  className={inputClass}
                  value={form.retrievalMode}
                  onChange={event => patch('retrievalMode', event.target.value)}
                >
                  <option value="graph">graph</option>
                  <option value="bucket">bucket</option>
                </select>
              </Field>
              <Field label="Operit 拆包" hint="只处理 Operit 文本轮，不改变工具和文件协议。">
                {toggle('operitRewriteEnabled')}
              </Field>
              <Field label="词图辅助" hint="把词图作为弱候选提示，仍需通过召回门控。">
                {toggle('wordMapHintEnabled')}
              </Field>
              <Field label="LLM 拆句" hint="额外调用脱水模型拆分检索词。">
                {toggle('queryPlannerEnabled')}
              </Field>
              <Field label="旧记忆随机" hint="直命中稀疏时可能追加久未触碰的旧记忆。">
                {toggle('queryResurfaceEnabled')}
              </Field>
            </Section>

            <Section title="图扩散" description="控制可靠直命中之外的关系图背景记忆。">
              <Field label="图扩散" hint="关闭后只保留可靠直接命中。">
                {toggle('diffusionEnabled')}
              </Field>
              <Field label="扩散条数" hint="最多返回多少条扩散背景。">
                {numberField('diffusionTopK', { min: 0, max: 20, disabled: !form.diffusionEnabled })}
              </Field>
              <Field label="最小激活" hint="越高越保守。">
                {numberField('diffusionMinActivation', {
                  min: 0,
                  max: 10,
                  step: 0.01,
                  disabled: !form.diffusionEnabled,
                })}
              </Field>
              <Field label="链式扩散" hint="允许沿可靠关系继续遍历。">
                {toggle('chainWalkEnabled')}
              </Field>
              <Field label="链路深度">
                {numberField('chainMaxHops', {
                  min: 1,
                  max: 12,
                  disabled: !form.diffusionEnabled || !form.chainWalkEnabled,
                })}
              </Field>
              <Field label="链路置信">
                {numberField('chainMinConfidence', {
                  min: 0,
                  max: 1,
                  step: 0.01,
                  disabled: !form.diffusionEnabled || !form.chainWalkEnabled,
                })}
              </Field>
              <Field label="链路前沿">
                {numberField('chainMaxFrontier', {
                  min: 1,
                  max: 200,
                  disabled: !form.diffusionEnabled || !form.chainWalkEnabled,
                })}
              </Field>
            </Section>

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
