// 切页等服务端返回时的反馈。延迟 150ms 才淡入，快的切页不会闪一下
export default function Loading() {
  return <div className="page-enter pointer-events-none fixed inset-0 flex items-center justify-center text-note text-[var(--color-text-tertiary)]" style={{ animationDelay: '150ms', animationFillMode: 'both' }} role="status" aria-live="polite">正在打开…</div>
}
