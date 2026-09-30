// 切页等服务端返回时的反馈。延迟 150ms 才淡入，快的切页不会闪一下。
// 要用 min-h-screen 撑出文档高度、不能用 fixed：iOS 26 主屏幕模式下文档太矮时，
// 底栏的 fixed bottom:0 会停在 Home 条上方，整条往上跳一截。
export default function Loading() {
  return <div className="page-enter pointer-events-none flex min-h-screen items-center justify-center text-note text-[var(--color-text-tertiary)]" style={{ animationDelay: '150ms', animationFillMode: 'both' }} role="status" aria-live="polite">正在打开…</div>
}
