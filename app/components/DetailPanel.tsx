'use client'
import type { ReactNode } from 'react'
import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Unified detail panel — shared shell for drawers and modals.
 *
 * mode="drawer"  — right-side panel (desktop) / bottom sheet (mobile)
 * mode="modal"   — centered overlay with rounded card
 *
 * Mobile bottom sheet supports pull-down-to-dismiss via touch.
 *
 * Usage:
 *   <DetailPanel open={!!selected} onClose={fn} mode="drawer">
 *     <BucketContent ... />
 *   </DetailPanel>
 */
interface DetailPanelProps {
  open: boolean
  onClose: () => void
  mode?: 'drawer' | 'modal'
  width?: string          // e.g. "max-w-2xl", "max-w-4xl" — defaults by mode
  loading?: boolean
  className?: string
  children: ReactNode
}

const DRAG_THRESHOLD = 100 // px of downward drag to close

export default function DetailPanel({
  open, onClose, mode = 'drawer', width, loading = false, className = '', children,
}: DetailPanelProps) {
  if (!open) return null

  const isDrawer = mode === 'drawer'
  const w = width || (isDrawer ? 'sm:max-w-2xl' : 'max-w-lg')

  return (
    <>
    {isDrawer ? (
      <DrawerPanel onClose={onClose} width={w} className={className} loading={loading}>
        {children}
      </DrawerPanel>
    ) : (
      <ModalPanel onClose={onClose} width={w} className={className} loading={loading}>
        {children}
      </ModalPanel>
    )}
    </>
  )
}

// ─── Drawer: desktop right panel / mobile bottom sheet ───
function DrawerPanel({
  onClose, width, className, loading, children,
}: {
  onClose: () => void; width: string; className: string; loading: boolean; children: ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startYRef = useRef(0)
  const startScrollRef = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (contentRef.current) {
      startScrollRef.current = contentRef.current.scrollTop
    }
    startYRef.current = e.touches[0].clientY
    setDragging(true)
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    // Only allow pull-down when content is scrolled to top
    if (contentRef.current && contentRef.current.scrollTop > 0) return
    const delta = e.touches[0].clientY - startYRef.current
    if (delta > 0) {
      setDragY(delta)
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    setDragging(false)
    if (dragY > DRAG_THRESHOLD) {
      onClose()
    }
    setDragY(0)
  }, [dragY, onClose])

  // Reset drag state on close
  useEffect(() => {
    return () => { setDragY(0); setDragging(false) }
  }, [])

  return (
    <div className="fixed inset-0 z-50" style={{ animation: 'dpFadeIn 0.18s ease-out' }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-text-primary)]/20 backdrop-blur-sm" onClick={onClose} />

      {/* Desktop: right-side panel */}
      <div
        className={`hidden md:block absolute right-0 top-0 h-full ${width} bg-white shadow-2xl
          transition-transform duration-300 translate-x-0`}
        onClick={e => e.stopPropagation()}
        style={{ animation: 'dpSlideIn 0.22s cubic-bezier(.2,.8,.2,1)' }}
      >
        <div className={`p-6 sm:p-8 h-full overflow-y-auto ${className}`}>
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--color-text-disabled)]">读取中...</div>
          ) : children}
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <div
        className={`md:hidden absolute left-0 right-0 bottom-0 bg-white rounded-t-2xl shadow-2xl flex flex-col
          transition-transform duration-300 ease-out`}
        onClick={e => e.stopPropagation()}
        style={{
          maxHeight: '88vh',
          transform: dragging ? `translateY(${dragY}px)` : 'translateY(0)',
          transition: dragging ? 'none' : undefined,
          animation: !dragging ? 'dpSheetUp 0.3s cubic-bezier(.2,.8,.2,1)' : undefined,
        }}
      >
        {/* Drag handle */}
        <div
          className="flex-shrink-0 flex justify-center pt-2.5 pb-1.5"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-slate-300/70" />
        </div>

        {/* Close X */}
        <button onClick={onClose}
          className="absolute top-3 right-4 z-10 text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] p-1.5 bg-[var(--color-surface-secondary)] rounded-full transition-colors text-sm leading-none">
          ✕
        </button>

        {/* Scrollable content */}
        <div
          ref={contentRef}
          className={`flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${className}`}
          style={{ minHeight: 0 }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[var(--color-text-disabled)]">读取中...</div>
          ) : children}
        </div>
      </div>

      <style>{`
        @keyframes dpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dpSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes dpSheetUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  )
}

// ─── Modal: centered overlay ───
function ModalPanel({
  onClose, width, className, loading, children,
}: {
  onClose: () => void; width: string; className: string; loading: boolean; children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50" style={{ animation: 'dpFadeIn 0.18s ease-out' }}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-text-primary)]/20 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        className={`absolute left-3 right-3 sm:inset-0 sm:m-auto top-1/2 sm:top-0 -translate-y-1/2 sm:translate-y-0 h-fit max-h-[85vh] ${width} bg-white rounded-2xl shadow-2xl
          overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`}
        style={{ animation: 'dpPop 0.22s cubic-bezier(.2,.8,.2,1)' }}
      >
        <div className={`p-6 sm:p-8 ${className}`}>
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--color-text-disabled)]">读取中...</div>
          ) : children}
        </div>
      </div>

      <style>{`
        @keyframes dpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dpPop { from { opacity: 0; transform: scale(0.96) translateY(-10px) } to { opacity: 1; transform: scale(1) translateY(0) } }
      `}</style>
    </div>
  )
}
