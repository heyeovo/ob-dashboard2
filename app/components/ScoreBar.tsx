'use client'

/**
 * Pipeline 4D scoring bar — label, weight, colored bar.
 */
export default function ScoreBar({ label, score, weight, color }: {
  label: string; score: number; weight: number; color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">{label}x{weight}</span>
      <div className="flex-1 bg-[var(--color-border-subtle)] rounded-full h-1.5 min-w-[2rem]">
        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(score * 100, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-[var(--color-text-secondary)] tabular-nums w-10 text-right">{score.toFixed(2)}</span>
    </div>
  )
}
