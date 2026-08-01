'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

/**
 * 自动化与状态配置页（dashboard.html「配置」tab 移植）。
 *
 * 六个 section：Persona / 夜梦 Dream / 关系记忆整理 / 每日画像 / 自我入口 / 合并阈值。
 * 全部走已有 /api/config GET/POST 代理，POST 带 persist:true 写回 config.yaml。
 * 骨架照 app/settings/memory-processing/page.tsx：扁平单 FormState + 单 dirty。
 */

type HavenConfig = {
  persona?: {
    enabled?: boolean
    event_recording_enabled?: boolean
    model?: string
    base_url?: string
    api_key_masked?: string
    api_ready?: boolean
  }
  dream?: {
    enabled?: boolean
    auto_enabled?: boolean
    surface_enabled?: boolean
    inject_enabled?: boolean
    retain_after_inject?: boolean
    model?: string
    base_url?: string
    api_key_masked?: string
    api_ready?: boolean
    daily_hour?: number
    daily_probability?: number
    min_material_count?: number
    material_window_hours?: number
    identity_anchor_id?: string
  }
  reflection?: {
    enabled?: boolean
    auto_enabled?: boolean
    daily_enabled?: boolean
    daily_min_memory_items?: number
    daily_conversation_turn_limit?: number
    daily_chat_memory_mode?: 'auto' | 'review' | 'off'
    daily_chat_memory_turn_limit?: number
    memory_affect_anchor_enabled?: boolean
    relationship_weather_affect_anchor_enabled?: boolean
  }
  portrait?: {
    enabled?: boolean
    auto_enabled?: boolean
    auto_initial_enabled?: boolean
    daily_enabled?: boolean
    material_limit?: number
    first_run_material_limit?: number
  }
  self_anchor?: {
    entry_bucket_id?: string
  }
  merge_threshold?: number
}

type FormState = {
  personaEnabled: boolean
  personaEventRecording: boolean
  personaModel: string
  personaBaseUrl: string
  personaApiKey: string
  dreamEnabled: boolean
  dreamAutoEnabled: boolean
  dreamSurfaceEnabled: boolean
  dreamInjectEnabled: boolean
  dreamRetainEnabled: boolean
  dreamModel: string
  dreamBaseUrl: string
  dreamApiKey: string
  dreamAnchorId: string
  dreamHour: string
  dreamProbability: string
  dreamMinMaterial: string
  dreamMaterialWindow: string
  reflectionEnabled: boolean
  reflectionAutoEnabled: boolean
  reflectionDailyEnabled: boolean
  reflectionMinMemory: string
  reflectionConversationTurns: string
  reflectionChatMemoryMode: 'auto' | 'review' | 'off'
  reflectionChatMemoryTurns: string
  reflectionMemoryAnchorEnabled: boolean
  reflectionWeatherAnchorEnabled: boolean
  portraitEnabled: boolean
  portraitAutoEnabled: boolean
  portraitAutoInitialEnabled: boolean
  portraitDailyEnabled: boolean
  portraitMaterialLimit: string
  portraitFirstRunLimit: string
  selfAnchorEntryBucketId: string
  mergeThreshold: string
}

type KeyStatus = {
  persona: string
  dream: string
}

type Notice = { kind: 'success' | 'error'; text: string } | null

const EMPTY_FORM: FormState = {
  personaEnabled: true,
  personaEventRecording: true,
  personaModel: '',
  personaBaseUrl: '',
  personaApiKey: '',
  dreamEnabled: true,
  dreamAutoEnabled: true,
  dreamSurfaceEnabled: true,
  dreamInjectEnabled: false,
  dreamRetainEnabled: true,
  dreamModel: '',
  dreamBaseUrl: '',
  dreamApiKey: '',
  dreamAnchorId: '',
  dreamHour: '3',
  dreamProbability: '0.4',
  dreamMinMaterial: '5',
  dreamMaterialWindow: '48',
  reflectionEnabled: true,
  reflectionAutoEnabled: true,
  reflectionDailyEnabled: true,
  reflectionMinMemory: '5',
  reflectionConversationTurns: '12',
  reflectionChatMemoryMode: 'review',
  reflectionChatMemoryTurns: '0',
  reflectionMemoryAnchorEnabled: true,
  reflectionWeatherAnchorEnabled: true,
  portraitEnabled: true,
  portraitAutoEnabled: true,
  portraitAutoInitialEnabled: false,
  portraitDailyEnabled: true,
  portraitMaterialLimit: '18',
  portraitFirstRunLimit: '160',
  selfAnchorEntryBucketId: '',
  mergeThreshold: '90',
}

const EMPTY_KEY_STATUS: KeyStatus = { persona: '未设置', dream: '未设置' }

/** enabled 系默认 true，只有显式 false 才关 */
function enabledDefault(value: boolean | undefined): boolean {
  return value === false ? false : true
}

function formFromConfig(config: HavenConfig): FormState {
  const persona = config.persona || {}
  const dream = config.dream || {}
  const reflection = config.reflection || {}
  const portrait = config.portrait || {}
  const selfAnchor = config.self_anchor || {}

  return {
    personaEnabled: enabledDefault(persona.enabled),
    personaEventRecording: enabledDefault(persona.event_recording_enabled),
    personaModel: persona.model || '',
    personaBaseUrl: persona.base_url || '',
    personaApiKey: '',
    dreamEnabled: enabledDefault(dream.enabled),
    dreamAutoEnabled: enabledDefault(dream.auto_enabled),
    dreamSurfaceEnabled: enabledDefault(dream.surface_enabled),
    dreamInjectEnabled: dream.inject_enabled === true,
    dreamRetainEnabled: enabledDefault(dream.retain_after_inject),
    dreamModel: dream.model || '',
    dreamBaseUrl: dream.base_url || '',
    dreamApiKey: '',
    dreamAnchorId: dream.identity_anchor_id || '',
    dreamHour: String(dream.daily_hour ?? 3),
    dreamProbability: String(dream.daily_probability ?? 0.4),
    dreamMinMaterial: String(dream.min_material_count ?? 5),
    dreamMaterialWindow: String(dream.material_window_hours ?? 48),
    reflectionEnabled: enabledDefault(reflection.enabled),
    reflectionAutoEnabled: enabledDefault(reflection.auto_enabled),
    reflectionDailyEnabled: enabledDefault(reflection.daily_enabled),
    reflectionMinMemory: String(reflection.daily_min_memory_items ?? 5),
    reflectionConversationTurns: String(reflection.daily_conversation_turn_limit ?? 12),
    reflectionChatMemoryMode: reflection.daily_chat_memory_mode || 'review',
    reflectionChatMemoryTurns: String(reflection.daily_chat_memory_turn_limit ?? 0),
    reflectionMemoryAnchorEnabled: enabledDefault(reflection.memory_affect_anchor_enabled),
    reflectionWeatherAnchorEnabled: enabledDefault(
      reflection.relationship_weather_affect_anchor_enabled,
    ),
    portraitEnabled: enabledDefault(portrait.enabled),
    portraitAutoEnabled: enabledDefault(portrait.auto_enabled),
    portraitAutoInitialEnabled: portrait.auto_initial_enabled === true,
    portraitDailyEnabled: enabledDefault(portrait.daily_enabled),
    portraitMaterialLimit: String(portrait.material_limit ?? 18),
    portraitFirstRunLimit: String(portrait.first_run_material_limit ?? 160),
    selfAnchorEntryBucketId: selfAnchor.entry_bucket_id || '',
    mergeThreshold: String(config.merge_threshold ?? 90),
  }
}

function keyStatusFromConfig(config: HavenConfig): KeyStatus {
  const persona = config.persona || {}
  const dream = config.dream || {}
  return {
    persona: persona.api_key_masked || (persona.api_ready ? '已设置' : '未设置'),
    dream: dream.api_key_masked || (dream.api_ready ? '已设置' : '未设置'),
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

function Section({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-white p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-[var(--color-text-heading)]">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function Field({ label, hint, wide = false, children }: {
  label: string
  hint?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs text-[var(--color-text-tertiary)]">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs leading-5 text-[var(--color-text-disabled)]">{hint}</p> : null}
    </div>
  )
}

export default function AutomationSettingsPage() {
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
    void Promise.resolve().then(loadConfig)
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
        persona: {
          enabled: form.personaEnabled,
          event_recording_enabled: form.personaEventRecording,
          model: form.personaModel,
          base_url: form.personaBaseUrl,
        },
        dream: {
          enabled: form.dreamEnabled,
          auto_enabled: form.dreamAutoEnabled,
          surface_enabled: form.dreamSurfaceEnabled,
          inject_enabled: form.dreamInjectEnabled,
          retain_after_inject: form.dreamRetainEnabled,
          model: form.dreamModel,
          base_url: form.dreamBaseUrl,
          daily_hour: validateNumber(form.dreamHour, '几点做梦', 0, 23, true),
          daily_probability: validateNumber(form.dreamProbability, '做梦概率', 0, 1),
          min_material_count: validateNumber(form.dreamMinMaterial, '至少几条素材', 1, 20, true),
          material_window_hours: validateNumber(form.dreamMaterialWindow, '回溯时间', 1, 168, true),
          identity_anchor_id: form.dreamAnchorId,
        },
        reflection: {
          enabled: form.reflectionEnabled,
          auto_enabled: form.reflectionAutoEnabled,
          daily_enabled: form.reflectionDailyEnabled,
          daily_min_memory_items: validateNumber(form.reflectionMinMemory, '最少记忆数', 0, 100, true),
          daily_conversation_turn_limit: validateNumber(
            form.reflectionConversationTurns,
            '读取对话轮次',
            0,
            80,
            true,
          ),
          daily_chat_memory_mode: form.reflectionChatMemoryMode,
          daily_chat_memory_turn_limit: validateNumber(
            form.reflectionChatMemoryTurns,
            '自动记忆轮次',
            0,
            10000,
            true,
          ),
          memory_affect_anchor_enabled: form.reflectionMemoryAnchorEnabled,
          relationship_weather_affect_anchor_enabled: form.reflectionWeatherAnchorEnabled,
        },
        portrait: {
          enabled: form.portraitEnabled,
          auto_enabled: form.portraitAutoEnabled,
          auto_initial_enabled: form.portraitAutoInitialEnabled,
          daily_enabled: form.portraitDailyEnabled,
          material_limit: validateNumber(form.portraitMaterialLimit, '当天材料上限', 1, 100, true),
          first_run_material_limit: validateNumber(
            form.portraitFirstRunLimit,
            '首次材料上限',
            1,
            500,
            true,
          ),
        },
        self_anchor: {
          entry_bucket_id: form.selfAnchorEntryBucketId.trim(),
        },
        merge_threshold: validateNumber(form.mergeThreshold, '合并阈值', 0, 100, true),
      }

      if (form.personaApiKey) {
        ;(payload.persona as Record<string, unknown>).api_key = form.personaApiKey
      }
      if (form.dreamApiKey) {
        ;(payload.dream as Record<string, unknown>).api_key = form.dreamApiKey
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
        setForm(prev => ({ ...prev, personaApiKey: '', dreamApiKey: '' }))
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
    'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)] disabled:text-[var(--color-text-disabled)]'
  const selectClass =
    'w-auto min-w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:bg-[var(--color-bg)] disabled:text-[var(--color-text-disabled)]'

  const toggle = (key: keyof FormState, label: string, disabled = false) => (
    <div className="flex items-center justify-between gap-3">
      <span
        className={`shrink-0 whitespace-nowrap text-sm ${disabled ? 'text-[var(--color-text-disabled)]' : 'text-[var(--color-text-secondary)]'}`}
      >
        {label}
      </span>
      <select
        className={selectClass}
        value={form[key] as boolean ? 'true' : 'false'}
        disabled={disabled}
        onChange={event => patch(key, (event.target.value === 'true') as never)}
      >
        <option value="true">开启</option>
        <option value="false">关闭</option>
      </select>
    </div>
  )

  const secretField = (
    label: string,
    field: 'personaApiKey' | 'dreamApiKey',
    current: string,
    disabled = false,
  ) => (
    <Field label={label} hint="留空表示不修改现有密钥。" wide>
      <input
        type="password"
        autoComplete="new-password"
        className={`${inputClass} font-mono text-xs`}
        value={form[field]}
        placeholder={`当前：${current}`}
        disabled={disabled}
        onChange={event => patch(field, event.target.value)}
      />
    </Field>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-28 text-[var(--color-text-primary)]">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-3 backdrop-blur-sm md:hidden">
        <Link href="/settings" className="text-xs text-[var(--color-text-tertiary)]">
          ← 设置
        </Link>
        <span className="text-sm font-semibold">自动化与状态</span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pt-5 sm:px-6 sm:pt-10">
        <div className="mb-6 hidden md:block">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-[var(--color-text-heading)]">
            自动化与状态
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Persona / 夜梦 / 关系整理 / 每日画像等后台引擎的开关与参数。保存后立即生效，并由 Haven 跨部署保留。
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
            {/* Persona */}
            <Section
              title="Persona"
              description="人格状态引擎：注入节奏与事件记录。"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {toggle('personaEnabled', '启用')}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  关闭后 Gateway 不再注入 Persona 状态，也不再做回复后的 Persona 更新
                </div>
                {toggle('personaEventRecording', '记录事件', !form.personaEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  关闭后仍评估数值状态，但不新增 Recent Persona Events
                </div>
                <Field label="Model">
                  <input
                    className={inputClass}
                    value={form.personaModel}
                    placeholder="deepseek-chat"
                    disabled={!form.personaEnabled}
                    onChange={event => patch('personaModel', event.target.value)}
                  />
                </Field>
                <Field label="Base URL">
                  <input
                    className={inputClass}
                    value={form.personaBaseUrl}
                    placeholder="https://api.deepseek.com/v1"
                    disabled={!form.personaEnabled}
                    onChange={event => patch('personaBaseUrl', event.target.value)}
                  />
                </Field>
                {secretField('API Key', 'personaApiKey', keyStatus.persona, !form.personaEnabled)}
              </div>
            </Section>

            {/* 夜梦 Dream */}
            <Section
              title="夜梦 Dream"
              description="后台做梦与梦境浮现。"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {toggle('dreamEnabled', '做梦引擎')}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  总开关；关闭后不生成新梦，也不做梦境浮现
                </div>
                {toggle('dreamAutoEnabled', '后台做梦', !form.dreamEnabled)}
                {toggle('dreamSurfaceEnabled', '自动浮现', !form.dreamEnabled)}
                {toggle('dreamInjectEnabled', 'Gateway 注入', !form.dreamEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  开启后 Gateway 可能把一次共振梦境作为 Dream Context 给模型静默参考
                </div>
                {toggle('dreamRetainEnabled', '浮现后保留', !form.dreamEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  开启后梦境仍只浮现一次，但原梦会保留在梦境记录里供人翻开
                </div>
                <Field label="Model">
                  <input
                    className={inputClass}
                    value={form.dreamModel}
                    placeholder="deepseek-v4-flash"
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamModel', event.target.value)}
                  />
                </Field>
                <Field label="Base URL">
                  <input
                    className={inputClass}
                    value={form.dreamBaseUrl}
                    placeholder="https://api.deepseek.com"
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamBaseUrl', event.target.value)}
                  />
                </Field>
                {secretField('API Key', 'dreamApiKey', keyStatus.dream, !form.dreamEnabled)}
                <Field label="几点做梦" hint="东八区小时。默认 3，就是凌晨 3 点后检查一次">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    className={inputClass}
                    value={form.dreamHour}
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamHour', event.target.value)}
                  />
                </Field>
                <Field label="做梦概率" hint="0 到 1。0.4 表示素材够时有 40% 概率做梦">
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    className={inputClass}
                    value={form.dreamProbability}
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamProbability', event.target.value)}
                  />
                </Field>
                <Field label="至少几条素材" hint="最近记忆和 whisper 加起来不够这个数，就先不做梦">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    className={inputClass}
                    value={form.dreamMinMaterial}
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamMinMaterial', event.target.value)}
                  />
                </Field>
                <Field label="回溯时间" hint="默认 48，就是只看最近两天的记忆和 whisper">
                  <input
                    type="number"
                    min="1"
                    max="168"
                    className={inputClass}
                    value={form.dreamMaterialWindow}
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamMaterialWindow', event.target.value)}
                  />
                </Field>
                <Field
                  label="人格锚点"
                  hint="只用来固定是谁在做梦，不会直接当作梦的剧情素材"
                  wide
                >
                  <input
                    className={inputClass}
                    value={form.dreamAnchorId}
                    placeholder="c0b8ddb7423e"
                    disabled={!form.dreamEnabled}
                    onChange={event => patch('dreamAnchorId', event.target.value)}
                  />
                </Field>
              </div>
            </Section>

            {/* 关系记忆整理 */}
            <Section
              title="关系记忆整理"
              description="关系整理、日印象、自动记忆的开关与参数。"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {toggle('reflectionEnabled', '整理引擎')}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  总开关；关闭后此区域的关系整理、日印象、自动记忆都不运行
                </div>
                {toggle('reflectionAutoEnabled', '自动整理', !form.reflectionEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  后台定时任务；开启后跑零点自动记忆、日印象，并给已有记忆补 tags、affect_anchor、边关系
                </div>
                {toggle('reflectionDailyEnabled', '日印象', !form.reflectionEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  关闭后不再自动生成 daily relationship_weather
                </div>
                <Field label="最少记忆数" hint="默认 5；只数当天普通记忆/更新项，persona events 不计入门槛">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className={inputClass}
                    value={form.reflectionMinMemory}
                    disabled={!form.reflectionEnabled}
                    onChange={event => patch('reflectionMinMemory', event.target.value)}
                  />
                </Field>
                <Field label="读取对话轮次" hint="默认 12；读取少量当天短期对话原文作为日印象材料">
                  <input
                    type="number"
                    min="0"
                    max="80"
                    className={inputClass}
                    value={form.reflectionConversationTurns}
                    disabled={!form.reflectionEnabled}
                    onChange={event => patch('reflectionConversationTurns', event.target.value)}
                  />
                </Field>
                <Field
                  label="自动记忆"
                  hint="默认自动存；每天本地 0 点后整理前一天原文并写入长期记忆"
                  wide
                >
                  <select
                    className={inputClass}
                    value={form.reflectionChatMemoryMode}
                    disabled={!form.reflectionEnabled}
                    onChange={event =>
                      patch('reflectionChatMemoryMode', event.target.value as 'auto' | 'review' | 'off')
                    }
                  >
                    <option value="auto">自动存</option>
                    <option value="review">挑选后确认</option>
                    <option value="off">关闭</option>
                  </select>
                </Field>
                <Field
                  label="自动记忆轮次"
                  hint="默认 0；0 表示按日期读取当天全部原文，只影响自动记忆候选"
                >
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    className={inputClass}
                    value={form.reflectionChatMemoryTurns}
                    disabled={!form.reflectionEnabled}
                    onChange={event => patch('reflectionChatMemoryTurns', event.target.value)}
                  />
                </Field>
                {toggle('reflectionMemoryAnchorEnabled', '普通记忆和弦', !form.reflectionEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  关闭后普通 bucket 不再自动追加 affect_anchor
                </div>
                {toggle('reflectionWeatherAnchorEnabled', '日印象和弦', !form.reflectionEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  控制日印象/关系天气正文里的 affect_anchor
                </div>
              </div>
            </Section>

            {/* 每日画像 */}
            <Section
              title="每日画像"
              description="后台每天维护的换窗画像。"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {toggle('portraitEnabled', '画像引擎')}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  总开关；只维护 state/portrait_state.json，不自动写 profile_fact、anchor 或 Core Memory
                </div>
                {toggle('portraitAutoEnabled', '自动维护', !form.portraitEnabled)}
                {toggle('portraitAutoInitialEnabled', '自动首次生成', !form.portraitEnabled)}
                <div className="sm:col-span-2 -mt-1 text-[11px] leading-relaxed text-[var(--color-text-disabled)]">
                  默认关闭；新安装或空 state 时，第一次画像需要手动点击生成
                </div>
                {toggle('portraitDailyEnabled', '每日维护', !form.portraitEnabled)}
                <Field label="当天材料上限">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className={inputClass}
                    value={form.portraitMaterialLimit}
                    disabled={!form.portraitEnabled}
                    onChange={event => patch('portraitMaterialLimit', event.target.value)}
                  />
                </Field>
                <Field
                  label="首次材料上限"
                  hint="第一次画像初始化可适当调大；之后每天只看当天新增/更新的记忆材料"
                >
                  <input
                    type="number"
                    min="1"
                    max="500"
                    className={inputClass}
                    value={form.portraitFirstRunLimit}
                    disabled={!form.portraitEnabled}
                    onChange={event => patch('portraitFirstRunLimit', event.target.value)}
                  />
                </Field>
              </div>
            </Section>

            {/* 自我入口 */}
            <Section title="自我入口" description="handoff 和画像页读取的自我总入口。">
              <Field
                label="总入口 bucket"
                hint="handoff 和画像页只读这一条；不会把它设成普通 anchor"
                wide
              >
                <input
                  className={inputClass}
                  value={form.selfAnchorEntryBucketId}
                  placeholder="留空按最高分自我桶 fallback"
                  onChange={event => patch('selfAnchorEntryBucketId', event.target.value)}
                />
              </Field>
            </Section>

            {/* 合并阈值 */}
            <Section title="合并阈值" description="相似桶合并的判据。">
              <Field label="合并阈值" hint="0-100，越高越难合并相似桶">
                <input
                  type="number"
                  min="0"
                  max="100"
                  className={inputClass}
                  value={form.mergeThreshold}
                  onChange={event => patch('mergeThreshold', event.target.value)}
                />
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
