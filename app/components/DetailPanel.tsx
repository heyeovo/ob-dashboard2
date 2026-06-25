'use client'
import type { ReactNode } from 'react'

/**
 * Unified detail panel — shared shell for drawers and modals.
 *
 * mode="drawer"  — slides in from the right (desktop) / bottom sheet (mobile)
 * mode="modal"   — centered overlay with rounded card
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

export default function DetailPanel({
  open, onClose, mode = 'drawer', width, loading = false, className = '', children,
}: DetailPanelProps) {
  if (!open) return null

  const isDrawer = mode === 'drawer'
  const w = width || (isDrawer ? 'sm:max-w-2xl' : 'max-w-lg')

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ animation: 'dpFadeIn 0.18s ease-out' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[var(--color-text-primary)]/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        className={
          isDrawer
            ? `absolute right-0 top-0 h-full w-full ${w} bg-white shadow-2xl
               transition-transform duration-300 transform translate-x-0`
            : `absolute inset-0 m-auto h-fit max-h-[85vh] ${w} bg-white rounded-2xl shadow-2xl
               overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`
        }
        style={isDrawer ? {} : { animation: 'dpPop 0.22s cubic-bezier(.2,.8,.2,1)' }}
      >
        <div className={`p-6 sm:p-8 ${isDrawer ? 'h-full' : ''} ${className}`}>
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--color-text-disabled)]">读取中...</div>
          ) : (
            children
          )}
        </div>
      </div>

      {/* Animation keyframes injected once */}
      <style>{`
        @keyframes dpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dpPop { from { opacity: 0; transform: scale(0.96) translateY(-10px) } to { opacity: 1; transform: scale(1) translateY(0) } }
      `}</style>
    </div>
  )
}
