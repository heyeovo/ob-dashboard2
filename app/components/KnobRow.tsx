'use client'
import { useState, useRef, useEffect } from 'react'

export default function KnobRow({ label, desc, value, min, max, step, onChange }: {
  label: string; desc: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100
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
    <div className="space-y-1 relative" ref={ref}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowTip(v => !v) }}
          className="flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity"
        >
          <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
          <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--color-border)] text-[9px] text-[var(--color-text-tertiary)] leading-none">?</span>
        </button>
        <span className="text-xs font-bold text-[var(--color-primary)] tabular-nums">{value}</span>
      </div>
      {showTip && (
        <div className="absolute left-0 top-6 z-20 bg-[var(--color-text-primary)] text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap
          before:content-[''] before:absolute before:-top-1 before:left-3 before:w-2 before:h-2 before:bg-[var(--color-text-primary)] before:rotate-45">
          {desc}
        </div>
      )}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${pct}%, var(--color-border-subtle) ${pct}%)` }}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[var(--color-primary)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:rounded-full [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-[var(--color-primary)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0"
      />
    </div>
  )
}
