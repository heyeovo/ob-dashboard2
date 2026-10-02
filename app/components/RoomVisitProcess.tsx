'use client'
import { useState } from 'react'
import CcToolDialog from '@/app/cc/CcToolDialog'
import CcMarkdown from '@/app/cc/CcMarkdown'
import type { CcProcessEvent, CcToolEvent } from '@/app/cc/types'

export default function RoomVisitProcess({ process }: { process: CcProcessEvent[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [tool, setTool] = useState<CcToolEvent | null>(null)
  const groups: ({ type: 'thinking'; id: string; text: string; durationMs?: number } | { type: 'text'; id: string; text: string } | { type: 'tools'; id: string; tools: CcToolEvent[] })[] = []
  for (const event of process) {
    if (event.type === 'thinking' || event.type === 'text') groups.push(event)
    else if (event.type === 'tool') {
      const last = groups.at(-1)
      if (last?.type === 'tools') last.tools.push(event.tool)
      else groups.push({ type: 'tools', id: event.id, tools: [event.tool] })
    }
  }
  return <div className="cc-process pl-3">
    {groups.map(event => event.type === 'text' ? <CcMarkdown key={event.id} text={event.text} /> : <div key={event.id} className={event.type === 'thinking' ? 'cc-think' : 'cc-toolstrip'}>
      <button type="button" className="cc-think-toggle" aria-expanded={!!open[event.id]} onClick={() => setOpen(previous => ({ ...previous, [event.id]: !previous[event.id] }))}>
        <span>{event.type === 'thinking' ? `Thought process${event.durationMs ? ` · ${(event.durationMs / 1000).toFixed(1)}s` : ''}` : `Tools · ${event.tools.length}`}</span><span className={`cc-fold-caret${open[event.id] ? ' open' : ''}`} aria-hidden="true" />
      </button>
      {open[event.id] && (event.type === 'thinking' ? <div className="cc-think-body">{event.text}</div> : event.tools.map(item => <button type="button" key={item.id} className="cc-toolchip pl-4" onClick={() => setTool(item)}><span className="cc-toolchip-name">{item.name.replace(/^mcp__[^_]+__/, '')}</span><span className="cc-fold-caret" aria-hidden="true" /></button>))}
    </div>)}
    {tool && <CcToolDialog tool={tool} onClose={() => setTool(null)} />}
  </div>
}
