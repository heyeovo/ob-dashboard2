'use client'

import SubpageBackButton from '@/app/components/SubpageBackButton'
import Link from 'next/link'
import { useRef, useState } from 'react'
import Card from '@/app/components/Card'
import { useAppearance } from '@/app/components/AppearanceProvider'
import { useChatDisplayPreferences } from '@/app/lib/chatDisplayPreferences'
import type { Appearance } from '@/app/lib/appearance'

const optionClass = (active: boolean) =>
  `min-h-11 rounded-[var(--radius-lg)] border px-4 py-2 text-sm transition-colors ${
    active
      ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]'
  }`

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-sm text-[var(--color-text-primary)]">
        <span>{label}</span>
        <output className="text-xs tabular-nums text-[var(--color-text-tertiary)]">{display}</output>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-3 w-full accent-[var(--color-primary)]"
      />
    </label>
  )
}

export default function AppearancePage() {
  const { appearance, status, update, uploadBackground, deleteBackground } = useAppearance()
  const {
    showRuntimeInfo, showTokenInfo, setShowRuntimeInfo, setShowTokenInfo,
  } = useChatDisplayPreferences()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const change = (modify: (current: Appearance) => Appearance) => update(modify)

  async function onFile(file?: File) {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      await uploadBackground(file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '背景图上传失败')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function removeImage() {
    setError('')
    try {
      await deleteBackground()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '背景图删除失败')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] pb-28 text-[var(--color-text-primary)]">
      <header className="flex flex-col items-start gap-4 px-4 pt-5 md:sticky md:top-0 md:z-10 md:min-h-14 md:flex-row md:items-center md:gap-0 md:border-b md:border-[var(--glass-border)] md:bg-[var(--glass-fill)] md:py-0 md:backdrop-blur-md">
        <SubpageBackButton href="/settings" label="返回设置" className="md:hidden" />
        <Link href="/settings" className="mr-3 hidden text-sm text-[var(--color-text-secondary)] md:inline-flex">← 设置</Link>
        <h1 className="text-2xl text-[var(--color-text-heading)] md:text-lg">外观</h1>
        <span aria-live="polite" className="text-xs text-[var(--color-text-tertiary)] md:ml-auto">
          {status === 'saving' ? '保存中…' : status === 'error' ? '保存失败，请再调整一次' : '已同步'}
        </span>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 pt-7 sm:px-6">
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-[var(--label-tracking)] text-[var(--color-text-tertiary)]">Theme</p>
          <h2 className="mt-1 text-2xl text-[var(--color-text-heading)]">主题</h2>
          <Card className="mt-4 overflow-hidden" padding="none">
            <div className="h-24 p-4" style={{ backgroundImage: 'var(--bg-gradient)' }}>
              <div className="h-full rounded-[var(--radius-lg)] border border-[var(--glass-border)] bg-[var(--glass-fill)] p-3 shadow-[var(--glass-shadow)]">
                <div className="h-2 w-24 rounded-full bg-[var(--color-primary)]/70" />
                <div className="mt-3 h-2 w-40 rounded-full bg-[var(--color-text-tertiary)]/25" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium text-[var(--color-text-heading)]">暖白 · Linen</p>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">柔和纸色、暖棕文字和轻玻璃</p>
              </div>
              <span className="rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-xs text-[var(--color-primary)]">当前主题</span>
            </div>
          </Card>
        </section>

        <section>
          <h2 className="text-xl text-[var(--color-text-heading)]">背景</h2>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">图片会同步到 Haven；当前只保留一张。</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" className={optionClass(appearance.background.kind === 'gradient')} onClick={() => change(current => ({ ...current, background: { ...current.background, kind: 'gradient' } }))}>渐变</button>
            <button type="button" className={optionClass(appearance.background.kind === 'upload')} onClick={() => appearance.background.assetId ? change(current => ({ ...current, background: { kind: 'upload', assetId: current.background.assetId } })) : fileInput.current?.click()}>我的图片</button>
            <button type="button" className={optionClass(appearance.background.kind === 'none')} onClick={() => change(current => ({ ...current, background: { ...current.background, kind: 'none' } }))}>纯色</button>
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => void onFile(event.target.files?.[0])} />
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} className="min-h-11 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm disabled:opacity-50">
              {uploading ? '上传中…' : '上传或更换图片'}
            </button>
            {appearance.background.assetId && <button type="button" onClick={() => void removeImage()} className="min-h-11 text-sm text-[var(--color-danger)]">删除已上传图片</button>}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">支持 JPEG、PNG、WebP，最大 5 MB。</p>
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
        </section>

        <section className="space-y-5">
          <h2 className="text-xl text-[var(--color-text-heading)]">质感</h2>
          <Slider label="毛玻璃模糊" value={appearance.glass.blur} min={0} max={30} step={1} display={`${appearance.glass.blur}px`} onChange={blur => change(current => ({ ...current, glass: { ...current.glass, blur } }))} />
          <Slider label="玻璃不透明度" value={appearance.glass.opacity} min={0.4} max={1} step={0.02} display={`${Math.round(appearance.glass.opacity * 100)}%`} onChange={opacity => change(current => ({ ...current, glass: { ...current.glass, opacity } }))} />
        </section>

        <section>
          <h2 className="text-xl text-[var(--color-text-heading)]">字体</h2>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">标题和名字可选字体，正文保持清晰的黑体。</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" className={optionClass(appearance.font.display === 'serif')} onClick={() => change(current => ({ ...current, font: { ...current.font, display: 'serif' } }))}>衬线标题</button>
            <button type="button" className={optionClass(appearance.font.display === 'sans')} onClick={() => change(current => ({ ...current, font: { ...current.font, display: 'sans' } }))}>黑体标题</button>
          </div>
          <div className="mt-5">
            <Slider label="整体字号" value={appearance.font.scale} min={0.85} max={1.3} step={0.05} display={`${Math.round(appearance.font.scale * 100)}%`} onChange={scale => change(current => ({ ...current, font: { ...current.font, scale } }))} />
          </div>
        </section>

        <section>
          <h2 className="text-xl text-[var(--color-text-heading)]">雨痕</h2>
          <label className="mt-4 flex min-h-11 items-center justify-between gap-4">
            <span className="text-sm">显示雨痕效果</span>
            <input type="checkbox" checked={appearance.effects.rain.mode === 'on'} onChange={event => change(current => ({ ...current, effects: { rain: { ...current.effects.rain, mode: event.target.checked ? 'on' : 'off' } } }))} className="h-5 w-5 accent-[var(--color-primary)]" />
          </label>
          {appearance.effects.rain.mode === 'on' && <div className="mt-4"><Slider label="雨痕强度" value={appearance.effects.rain.intensity} min={0} max={1} step={0.05} display={`${Math.round(appearance.effects.rain.intensity * 100)}%`} onChange={intensity => change(current => ({ ...current, effects: { rain: { ...current.effects.rain, intensity } } }))} /></div>}
          <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">页面不可见或系统开启减少动态效果时，雨痕保持静止。</p>
        </section>

        <section className="border-t border-[var(--color-border)] pt-6">
          <h2 className="text-xl text-[var(--color-text-heading)]">聊天显示</h2>
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">这两个开关仍只影响本机界面，不改变聊天内容或模型设置。</p>
          <div className="mt-3 divide-y divide-[var(--color-border-light)] rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-4">
            <label className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm">
              <span>显示运行信息<span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">引擎、Provider、模型与上下文入口</span></span>
              <input type="checkbox" checked={showRuntimeInfo} onChange={event => setShowRuntimeInfo(event.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
            </label>
            <label className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm">
              <span>显示 Token 数<span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">消息下方的 Token 总数与明细</span></span>
              <input type="checkbox" checked={showTokenInfo} onChange={event => setShowTokenInfo(event.target.checked)} className="h-5 w-5 accent-[var(--color-primary)]" />
            </label>
          </div>
        </section>
      </main>
    </div>
  )
}
