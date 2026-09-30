'use client'

export type WeekCalendarDay = { date: string; label: string; hasReview: boolean; hasMemory: boolean }

export default function WeekCalendar({ days, today, selectedDate, onSelect, highlightSelection = false, disableFuture = false }: {
  days: WeekCalendarDay[]
  today: string
  selectedDate: string
  onSelect: (date: string) => void
  highlightSelection?: boolean
  disableFuture?: boolean
}) {
  return <div className="home-week-days">{days.map(({ date, label, hasReview, hasMemory }) => <button
    key={date} type="button"
    className={`home-week-day ${date === today ? 'is-today' : ''} ${date > today ? 'is-future' : ''} ${date === selectedDate ? 'is-selected' : ''} ${highlightSelection ? 'has-selection-fill' : ''}`}
    disabled={disableFuture && date > today}
    onClick={() => onSelect(date)}
    aria-pressed={date === selectedDate}
    aria-label={`${date}${hasReview ? '，有日回顾' : ''}${hasMemory ? '，有新记忆' : ''}`}
  >
    <span className="home-week-label">{label}</span>
    <span className="home-week-number">{Number(date.slice(8, 10))}</span>
    <span className="home-week-dots">{hasReview && <i />}{hasMemory && <b />}</span>
  </button>)}</div>
}
