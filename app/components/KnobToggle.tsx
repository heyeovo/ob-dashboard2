'use client'
import { useState, useRef, useEffect } from 'react'

export default function KnobToggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  const [showTip, setShowTip] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showTip) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowTip(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [showTip])

  return (
    <div className="flex items-center justify-between relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowTip(v => !v) }}
        className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
      >
        <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--color-border)] text-[9px] text-[var(--color-text-tertiary)] leading-none">?</span>
      </button>
      {showTip && (
        <div className="absolute left-0 top-6 z-20 bg-[var(--color-text-primary)] text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap
          before:content-[''] before:absolute before:-top-1 before:left-3 before:w-2 before:h-2 before:bg-[var(--color-text-primary)] before:rotate-45">
          {desc}
        </div>
      )}
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-divider)]'}`}>
        <span className={`absolute top-[3px] left-[3px] w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-[16px]' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}
