'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { readPolarisExport, type PolarisExportPreview } from '@/app/lib/polarisExport'

type ImportResult = {
  ok?: boolean
  imported_conversations?: number
  imported_turns?: number
  reimported_conversations?: number
  failed_conversations?: number
  error?: string
}

export default function PolarisImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [filename, setFilename] = useState('')
  const [preview, setPreview] = useState<PolarisExportPreview | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setError('')
    setResult(null)
    setPreview(null)
    setFilename(file.name)
    try {
      setPreview(await readPolarisExport(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }

  const runImport = async () => {
    if (!preview || importing) return
    setImporting(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch('/api/cc-polaris-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: preview.format,
          version: preview.version,
          conversations: preview.conversations,
        }),
      })
      const data = await response.json().catch(() => ({})) as ImportResult
      if (!response.ok && !data.imported_conversations) {
        setError(data.error || `导入失败（HTTP ${response.status}）`)
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const exportedAt = preview?.createdAt
    ? new Date(preview.createdAt).toLocaleString('zh-CN')
    : '未知'

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 py-6 text-[var(--color-text-primary)] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-tertiary)]">cc chat · 数据迁移</div>
            <h1 className="mt-1 text-2xl font-semibold">导入 Polaris 对话</h1>
          </div>
          <Link href="/cc" className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm hover:bg-[var(--color-surface-secondary)]">
            返回对话
          </Link>
        </div>

        <section className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            只读取 ZIP 中的对话清单，不导入 Persona、运行配置、空间、集合，也不会修改 cc chat 设置。ZIP 中的图片文件本轮不迁移。
          </p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={reading || importing}
            className="mt-5 w-full rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-5 py-8 text-center transition-colors hover:border-[var(--color-primary)] disabled:opacity-60"
          >
            <span className="block text-sm font-medium">{reading ? '正在读取…' : filename || '选择 Polaris 导出的 ZIP'}</span>
            <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">文件只在确认导入后提交对话 JSON</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={event => void chooseFile(event.target.files?.[0])}
          />

          {error ? <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          {preview ? (
            <div className="mt-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['对话', preview.conversationCount],
                  ['轮次', preview.turnCount],
                  ['消息', preview.messageCount],
                  ['含图片消息', preview.attachmentMessageCount],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-[var(--color-surface-secondary)] px-3 py-3">
                    <div className="text-xs text-[var(--color-text-tertiary)]">{label}</div>
                    <div className="mt-1 text-xl font-semibold">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs leading-5 text-[var(--color-text-tertiary)]">
                Polaris {preview.appVersion || '未知版本'} · 导出时间 {exportedAt} · {preview.systemMessageCount} 条系统记录仅随原始 JSON 保存
              </div>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={importing}
                className="mt-5 w-full rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {importing ? '正在写入 Haven…' : `确认导入 ${preview.conversationCount} 个对话`}
              </button>
            </div>
          ) : null}

          {result ? (
            <div className={`mt-5 rounded-xl px-4 py-4 text-sm ${result.failed_conversations ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
              <div className="font-medium">导入完成</div>
              <div className="mt-1 leading-6">
                成功 {result.imported_conversations || 0} 个对话、{result.imported_turns || 0} 轮；
                重复导入更新 {result.reimported_conversations || 0} 个；失败 {result.failed_conversations || 0} 个。
              </div>
              <Link href="/cc" className="mt-2 inline-block underline underline-offset-2">回到 cc chat 查看</Link>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
