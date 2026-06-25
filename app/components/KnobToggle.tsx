'use client'

/**
 * Toggle switch for scoring knobs.
 * checked=true → orange (right), checked=false → gray (left)
 */
export default function KnobToggle({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-xs font-medium text-[var(--color-text-primary)]">{label}</span>
        <p className="text-[10px] text-[var(--color-text-disabled)]">{desc}</p>
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-text-divider)]'}`}>
        <span className={`absolute top-[3px] left-[3px] w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-[16px]' : 'translate-x-0'}`} />
      </button>
    </div>
  )
}
