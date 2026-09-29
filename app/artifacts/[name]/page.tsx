'use client'
import { use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { artifactBaseName, isArtifactName } from '@/app/lib/artifactMeta'

// 全屏查看一个作品。页面本身在 iframe 沙箱里跑（无同源），
// 服务端响应头也带 CSP sandbox，直接打开 /api/artifacts/xxx 一样隔离。

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads'

export default function ArtifactViewPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: rawName } = use(params)
  const router = useRouter()
  let name = rawName
  try { name = decodeURIComponent(rawName) } catch { /* 交给名字校验 */ }
  const valid = isArtifactName(name)
  const src = `/api/artifacts/${encodeURIComponent(name)}`

  const back = () => {
    if (window.history.length > 1) router.back()
    else router.push('/artifacts')
  }

  return (
    <div className="artifact-viewer z-50 flex flex-col bg-[var(--color-bg)]">
      <header
        className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2"
      >
        <button
          type="button"
          onClick={back}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]"
        >
          ‹ 返回
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-[var(--color-text-heading)]">
          {artifactBaseName(name)}
        </span>
        <Link
          href="/artifacts"
          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-tertiary)]"
        >
          全部
        </Link>
        {valid ? (
          <a
            href={src}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)]"
          >
            新窗口
          </a>
        ) : null}
      </header>
      {valid ? (
        <iframe
          key={name}
          src={src}
          title={artifactBaseName(name)}
          sandbox={SANDBOX}
          className="min-h-0 w-full flex-1 border-0 bg-[var(--color-surface)]"
        />
      ) : (
        <div className="m-auto text-sm text-[var(--color-text-tertiary)]">这个名字不对，找不到作品。</div>
      )}
    </div>
  )
}
