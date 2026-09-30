import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import WeekCalendar, { type WeekCalendarDay } from '@/app/components/WeekCalendar'

const days: WeekCalendarDay[] = [
  { date: '2026-09-29', label: '二', hasReview: true, hasMemory: true },
  { date: '2026-09-30', label: '三', hasReview: false, hasMemory: false },
  { date: '2026-10-01', label: '四', hasReview: false, hasMemory: true },
]
describe('shared home and daily review week calendar', () => {
  it('keeps the same day typography, today circle and dot slot on empty days', () => {
    const html = renderToStaticMarkup(createElement(WeekCalendar, { days, today: '2026-09-30', selectedDate: '2026-09-29', onSelect: () => {} }))
    expect(html.match(/class="home-week-number"/g)).toHaveLength(3)
    expect(html).toContain('is-today')
    expect(html).toContain('<span class="home-week-dots"><i></i><b></b></span>')
    expect(html).toContain('<span class="home-week-dots"></span>')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('has-selection-fill')
  })
  it('adds review selection fill while preserving today marking and disabling future dates', () => {
    const html = renderToStaticMarkup(createElement(WeekCalendar, { days, today: '2026-09-30', selectedDate: '2026-09-30', onSelect: () => {}, highlightSelection: true, disableFuture: true }))
    expect(html).toMatch(/is-today[^\"]*is-selected[^\"]*has-selection-fill/)
    expect(html).toContain('aria-pressed="true"')
    expect(html.match(/disabled=""/g)).toHaveLength(1)
  })
})
