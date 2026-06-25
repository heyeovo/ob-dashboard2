'use client'

export default function KnobRow({ label, desc, value, min, max, step, onChange }: {
  label: string; desc: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="text-xs font-bold text-[var(--color-primary)] tabular-nums">{value}</span>
      </div>
      <p className="text-[10px] text-[var(--color-text-disabled)]">{desc}</p>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${pct}%, var(--color-border-subtle) ${pct}%)` }}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[var(--color-primary)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-[var(--color-primary)] [&::-webkit-slider-thumb]:rounded-full [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-[var(--color-primary)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0"
      />
    </div>
  )
}
