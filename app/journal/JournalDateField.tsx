'use client'

export default function JournalDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [date, time] = value.split('T')
  const [year, month, day] = (date || '').split('-')
  const label = value ? `${year}年${Number(month)}月${Number(day)}日 ${time}` : '选择日记时间'
  return <label className="relative block rounded-[var(--radius-md)] py-2 text-base text-[var(--color-text-primary)]">
    <span>{label}</span>
    <input aria-label="日记时间（北京时间）" type="datetime-local" value={value} onClick={event => { try { event.currentTarget.showPicker?.() } catch { /* 不支持 showPicker 时使用原生聚焦选择 */ } }} onChange={event => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 text-base" />
  </label>
}
