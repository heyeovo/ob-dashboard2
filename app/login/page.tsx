import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '登录 · Ombre Brain',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; logged_out?: string; next?: string }>
}) {
  const params = await searchParams
  const error = params.error === 'invalid'
  const loggedOut = params.logged_out === '1'

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-5 text-[var(--color-text-primary)]">
      <main className="w-full max-w-sm rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl sm:p-8">
        <div className="mb-7">
          <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-[var(--color-text-tertiary)]">OMBRE BRAIN</p>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-heading)]">回到小言和小羊的家</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">输入 Dashboard 口令继续。</p>
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            口令不正确，请稍后重试。
          </p>
        ) : null}
        {loggedOut ? (
          <p className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
            已安全退出。
          </p>
        ) : null}

        <form action="/api/auth/login" method="post" className="space-y-4">
          <input type="hidden" name="next" value={params.next || '/'} />
          <label className="block">
            <span className="mb-2 block text-sm font-medium">登录口令</span>
            <input
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 outline-none transition focus:border-[var(--color-text-tertiary)] focus:ring-2 focus:ring-black/5"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-xl bg-[var(--color-text-heading)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            登录
          </button>
        </form>
        <p className="mt-5 text-xs leading-5 text-[var(--color-text-tertiary)]">口令只通过加密连接的 POST 请求提交，不会写入网址。</p>
      </main>
    </div>
  )
}
