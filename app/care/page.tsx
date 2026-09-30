'use client'

import SubpageBackButton from '@/app/components/SubpageBackButton'
import Link from 'next/link'
import { ComponentProps, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BucketDetailDrawer from '../components/BucketDetailDrawer'
import DetailPanel from '../components/DetailPanel'

// 仅待办编辑 / 新增弹窗跟随可视视口，键盘弹起时保留底部保存区。
function TodoFormPanel({ open, onClose, onSubmit, children }: { open: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!open) return
    const panel = formRef.current?.parentElement?.parentElement
    if (!panel) return
    const viewport = window.visualViewport
    const update = () => {
      const height = viewport?.height || window.innerHeight
      const top = viewport?.offsetTop || 0
      panel.style.top = `${top + height / 2}px`
      panel.style.bottom = 'auto'
      panel.style.margin = '0 auto'
      panel.style.transform = 'translateY(-50%)'
      panel.style.maxHeight = `${height - 24}px`
      panel.style.setProperty('--todo-visible-height', `${height - 24}px`)
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])
  return <DetailPanel open={open} onClose={onClose} mode="modal" width="max-w-2xl" className="!p-4 sm:!p-6">
    <form ref={formRef} onSubmit={onSubmit} className="flex max-h-[calc(var(--todo-visible-height,85dvh)-3rem)] min-h-0 flex-col gap-4">{children}</form>
  </DetailPanel>
}

type ReminderStatus = 'active' | 'done' | 'archived'
type Reminder = {
  id: string
  title: string
  content: string
  status: ReminderStatus
  start_at?: string | null
  end_at?: string | null
  next_due_at?: string | null
  repeat_rule: string
  interval_rounds: number
  daily_limit: number
  max_injections: number
  cooldown_minutes: number
  channel: string
  session_id: string
}

type TodoDomain = 'tech' | 'emotional' | 'unclassified'
type TodoItem = {
  id: string
  source: 'standalone' | 'bucket'
  content: string
  domain: TodoDomain
  source_bucket: string
  source_bucket_name: string
  context: string
  done: boolean
  created_at: string
}

type ReminderForm = {
  title: string
  content: string
  start_at: string
  end_at: string
  next_due_at: string
  repeat_rule: string
  interval_rounds: string
  daily_limit: string
  max_injections: string
  cooldown_minutes: string
  channel: string
  session_id: string
}

type TodoForm = {
  content: string
  domain: 'tech' | 'emotional'
  source_bucket: string
  context: string
}

type DrawerSelected = ComponentProps<typeof BucketDetailDrawer>['selected']

const EMPTY_REMINDER: ReminderForm = {
  title: '', content: '', start_at: '', end_at: '', next_due_at: '',
  repeat_rule: 'every_n_rounds', interval_rounds: '6', daily_limit: '1',
  max_injections: '0', cooldown_minutes: '0', channel: 'global', session_id: '',
}
const EMPTY_TODO: TodoForm = { content: '', domain: 'tech', source_bucket: '', context: '' }

const panel = 'rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm'
const input = 'w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]'
const button = 'rounded-xl px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/care/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
  return data
}

function localTime(value?: string | null) {
  return value ? value.slice(0, 16) : ''
}

function displayTime(value?: string | null) {
  if (!value) return '未设置'
  return value.replace('T', ' ').slice(0, 16)
}

function todoDate(value: string) {
  if (!value || Number.isNaN(new Date(value).getTime())) return ''
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(value))
  const part = (key: string) => Number(parts.find(item => item.type === key)?.value || 0)
  const [year, month, day] = [part('year'), part('month'), part('day')]
  if (!year || !month || !day) return ''
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Hong_Kong', year: 'numeric' }).format(new Date()))
  return `${year === currentYear ? '' : `${year}年`}${month}月${day}日`
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? 'space-y-1 md:col-span-2' : 'space-y-1'}><span className="text-xs text-[var(--color-text-tertiary)]">{label}</span>{children}</label>
}

export default function CarePage() {
  const [tab, setTab] = useState<'reminders' | 'todos'>('todos')
  const [message, setMessage] = useState('')

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 pb-24 pt-5 text-[var(--color-text-primary)] md:px-8 md:pt-8">
      <div className={`mx-auto ${tab === 'reminders' ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <header className="mb-6 flex flex-col items-start gap-4 md:flex-row md:gap-3">
          <SubpageBackButton href="/" label="返回主页" className="md:hidden" />
          <Link href="/" className={`${button} hidden border border-[var(--color-border)] bg-[var(--color-surface)] md:inline-flex`}>← Home</Link>
          {tab === 'reminders' && <div><h1 className="text-2xl font-semibold text-[var(--color-text-heading)]">照顾备忘</h1><p className="mt-1 text-sm text-[var(--color-text-tertiary)]">Reminder 与 Todo 分开保存、分开使用。</p></div>}
        </header>

        <div className="mb-5 inline-flex rounded-[var(--radius-xl)] bg-[var(--color-surface-tertiary)] p-1">
          {([['todos', '待办'], ['reminders', '照顾备忘']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => { setTab(key); setMessage('') }}
              className={`${button} ${tab === key ? 'bg-[var(--color-surface)] text-[var(--color-primary)] shadow-sm' : 'text-[var(--color-text-secondary)]'}`}>
              {label}
            </button>
          ))}
        </div>

        {message && <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm">{message}</div>}
        {tab === 'reminders'
          ? <ReminderPanel onMessage={setMessage} />
          : <TodoPanel onMessage={setMessage} />}
      </div>
    </main>
  )
}

function ReminderPanel({ onMessage }: { onMessage: (value: string) => void }) {
  const [items, setItems] = useState<Reminder[]>([])
  const [status, setStatus] = useState<'active' | 'done' | 'archived' | 'all'>('active')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<ReminderForm>(EMPTY_REMINDER)

  const load = useCallback(async () => {
    try {
      const data = await api<{ reminders: Reminder[] }>(`reminders?status=${status}&limit=200`)
      setItems(data.reminders || [])
    } catch (error) {
      onMessage(String(error))
    } finally {
      setLoading(false)
    }
  }, [onMessage, status])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function startCreate() {
    setEditing(null)
    setForm(EMPTY_REMINDER)
    setFormOpen(true)
  }

  function startEdit(item: Reminder) {
    setEditing(item.id)
    setForm({
      title: item.title, content: item.content, start_at: localTime(item.start_at),
      end_at: localTime(item.end_at), next_due_at: localTime(item.next_due_at),
      repeat_rule: item.repeat_rule || 'every_n_rounds', interval_rounds: String(item.interval_rounds ?? 6),
      daily_limit: String(item.daily_limit ?? 1), max_injections: String(item.max_injections ?? 0),
      cooldown_minutes: String(item.cooldown_minutes ?? 0), channel: item.channel || 'global',
      session_id: item.session_id || '',
    })
    setFormOpen(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const payload = {
      ...form,
      interval_rounds: Number(form.interval_rounds || 0), daily_limit: Number(form.daily_limit || 0),
      max_injections: Number(form.max_injections || 0), cooldown_minutes: Number(form.cooldown_minutes || 0),
      source: 'dashboard',
    }
    try {
      await api(editing ? `reminders/${encodeURIComponent(editing)}` : 'reminders', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      })
      onMessage(editing ? '照顾备忘已更新。' : '照顾备忘已新增。')
      setFormOpen(false)
      await load()
    } catch (error) { onMessage(String(error)) }
  }

  async function patch(id: string, payload: object, success: string) {
    try {
      await api(`reminders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      onMessage(success)
      await load()
    } catch (error) { onMessage(String(error)) }
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {([['active', '进行中'], ['done', '已完成'], ['archived', '已归档'], ['all', '全部']] as const).map(([key, label]) =>
          <button key={key} type="button" onClick={() => { setLoading(true); setStatus(key) }} className={`${button} ${status === key ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)]' : 'border border-[var(--color-border)] bg-[var(--color-surface)]'}`}>{label}</button>)}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => { setLoading(true); void load() }} className={`${button} border border-[var(--color-border)] bg-[var(--color-surface)]`}>刷新</button>
        <button type="button" onClick={startCreate} className={`${button} bg-[var(--color-primary)] text-[var(--color-on-primary)]`}>新增备忘</button>
      </div>
    </div>

    {formOpen && <form onSubmit={submit} className={`${panel} space-y-4 p-4 md:p-5`}>
      <div className="flex items-center justify-between"><h2 className="font-medium">{editing ? '编辑照顾备忘' : '新增照顾备忘'}</h2><button type="button" onClick={() => setFormOpen(false)} className="text-sm text-[var(--color-text-tertiary)]">取消</button></div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="标题" wide><input required className={input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="正文" wide><textarea required rows={4} className={input} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} /></Field>
        <Field label="开始时间"><input type="datetime-local" className={input} value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })} /></Field>
        <Field label="结束时间"><input type="datetime-local" className={input} value={form.end_at} onChange={e => setForm({ ...form, end_at: e.target.value })} /></Field>
        <Field label="下次提醒"><input type="datetime-local" className={input} value={form.next_due_at} onChange={e => setForm({ ...form, next_due_at: e.target.value })} /></Field>
        <Field label="重复方式"><select className={input} value={form.repeat_rule} onChange={e => setForm({ ...form, repeat_rule: e.target.value })}><option value="once">仅一次</option><option value="none">不重复</option><option value="every_n_rounds">每 N 轮</option><option value="daily">每天</option><option value="morning_evening">早晚</option></select></Field>
      </div>
      <details className="rounded-xl bg-[var(--color-surface-secondary)] p-3">
        <summary className="cursor-pointer text-sm text-[var(--color-text-secondary)]">高级字段</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="间隔轮数 interval_rounds"><input type="number" min="0" className={input} value={form.interval_rounds} onChange={e => setForm({ ...form, interval_rounds: e.target.value })} /></Field>
          <Field label="每天上限 daily_limit"><input type="number" min="0" className={input} value={form.daily_limit} onChange={e => setForm({ ...form, daily_limit: e.target.value })} /></Field>
          <Field label="最大注入次数 max_injections"><input type="number" min="0" className={input} value={form.max_injections} onChange={e => setForm({ ...form, max_injections: e.target.value })} /></Field>
          <Field label="冷却分钟 cooldown_minutes"><input type="number" min="0" className={input} value={form.cooldown_minutes} onChange={e => setForm({ ...form, cooldown_minutes: e.target.value })} /></Field>
          <Field label="渠道 channel"><input className={input} value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} /></Field>
          <Field label="会话 session_id"><input className={input} value={form.session_id} onChange={e => setForm({ ...form, session_id: e.target.value })} /></Field>
        </div>
      </details>
      <button className={`${button} bg-[var(--color-primary)] text-[var(--color-on-primary)]`} type="submit">保存</button>
    </form>}

    {loading ? <Empty text="加载中…" /> : items.length === 0 ? <Empty text="这里还没有照顾备忘。" /> :
      <div className="grid gap-3 md:grid-cols-2">{items.map(item => <article key={item.id} className={`${panel} p-4`}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium text-[var(--color-text-heading)]">{item.title}</h3><span className="mt-1 inline-block text-xs text-[var(--color-text-tertiary)]">{item.status}</span></div><button type="button" onClick={() => startEdit(item)} className="text-sm text-[var(--color-primary)]">编辑</button></div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-tertiary)]"><div>下次：{displayTime(item.next_due_at)}</div><div>重复：{item.repeat_rule}</div><div>开始：{displayTime(item.start_at)}</div><div>结束：{displayTime(item.end_at)}</div></dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {item.status !== 'done' && <button type="button" onClick={() => void patch(item.id, { status: 'done' }, '已标记完成。')} className={`${button} bg-[var(--color-primary)] text-[var(--color-on-primary)]`}>标完成</button>}
          {item.status !== 'active' && <button type="button" onClick={() => void patch(item.id, { status: 'active' }, '已重新打开。')} className={`${button} border border-[var(--color-border)] bg-[var(--color-surface)]`}>重新打开</button>}
          {item.status === 'active' && <button type="button" onClick={() => void patch(item.id, { snooze_minutes: 60 }, '已稍后提醒 60 分钟。')} className={`${button} border border-[var(--color-border)] bg-[var(--color-surface)]`}>稍后 1 小时</button>}
          {item.status !== 'archived' && <button type="button" onClick={() => void patch(item.id, { status: 'archived' }, '已归档。')} className={`${button} border border-[var(--color-border)] bg-[var(--color-surface)]`}>归档</button>}
        </div>
      </article>)}</div>}
  </section>
}

function TodoPanel({ onMessage }: { onMessage: (value: string) => void }) {
  const [items, setItems] = useState<TodoItem[]>([])
  const [completed, setCompleted] = useState<TodoItem[]>([])
  const [completedCount, setCompletedCount] = useState(0)
  const [domain, setDomain] = useState<TodoDomain>('tech')
  const [showCompleted, setShowCompleted] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TodoItem | null>(null)
  const [form, setForm] = useState<TodoForm>(EMPTY_TODO)
  const [selectedBucket, setSelectedBucket] = useState<DrawerSelected>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [drawerEditing, setDrawerEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [operating, setOperating] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const [data, count] = await Promise.all([api<{ todos: TodoItem[] }>('todos?limit=500&done=false'), api<{ count: number }>('todos?limit=500&done=true&count_only=1')])
      setItems(data.todos || [])
      setCompletedCount(count.count || 0)
      if (showCompleted) {
        const finished = await api<{ todos: TodoItem[] }>('todos?limit=500&done=true')
        setCompleted(finished.todos || [])
      }
    } catch (error) { onMessage(String(error)) } finally { setLoading(false) }
  }, [showCompleted, onMessage])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const groups = useMemo(() => {
    const result: Record<TodoDomain, TodoItem[]> = { tech: [], emotional: [], unclassified: [] }
    for (const item of items) result[item.domain]?.push(item)
    return result
  }, [items])

  const visible = groups[domain]
  const completedVisible = completed.filter(item => item.domain === domain)
  const domains: TodoDomain[] = groups.unclassified.length || completed.some(item => item.domain === 'unclassified') ? ['tech', 'emotional', 'unclassified'] : ['tech', 'emotional']

  async function expandCompleted() {
    if (!showCompleted) {
      try {
        const data = await api<{ todos: TodoItem[] }>('todos?limit=500&done=true')
        setCompleted(data.todos || [])
      } catch (error) { onMessage(String(error)); return }
    }
    setShowCompleted(!showCompleted)
  }

  function startCreate() { setEditing(null); setForm(EMPTY_TODO); setFormOpen(true) }
  function startEdit(item: TodoItem) {
    setEditing(item)
    setForm({ content: item.content, domain: item.domain === 'emotional' ? 'emotional' : 'tech', source_bucket: item.source_bucket || '', context: item.context || '' })
    setFormOpen(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      if (editing) {
        const payload = editing.source === 'bucket'
          ? { content: form.content, domain: form.domain }
          : form
        await api(`todos/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api('todos', { method: 'POST', body: JSON.stringify(form) })
      }
      onMessage(editing ? 'Todo 已更新。' : 'Todo 已新增。')
      setFormOpen(false)
      await load()
    } catch (error) { onMessage(String(error)) }
  }

  async function toggle(item: TodoItem) {
    try {
      await api(`todos/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ done: !item.done }) })
      await load()
    } catch (error) { onMessage(String(error)) }
  }

  async function remove(item: TodoItem) {
    if (!window.confirm('确定删除这件待办？不可恢复。')) return
    try {
      await api(`todos/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      setExpanded(null)
      await load()
    } catch (error) { onMessage(String(error)) }
  }

  const fetchBucket = useCallback(async (id: string) => {
    const response = await fetch(`/api/bucket/${encodeURIComponent(id)}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error || '桶详情加载失败')
    return data
  }, [])

  async function openBucket(id: string) {
    setDrawerEditing(false)
    setDetailLoading(true)
    try {
      setSelectedBucket(await fetchBucket(id))
    } catch (error) {
      onMessage(String(error))
    } finally {
      setDetailLoading(false)
    }
  }

  async function refreshSelected(id: string) {
    setSelectedBucket(await fetchBucket(id))
  }

  async function traceOp(id: string, args: Record<string, unknown>) {
    setOperating(true)
    try {
      const response = await fetch('/api/edit-bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...args }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error || '记忆修改失败')
      await refreshSelected(id)
      await load()
    } catch (error) {
      onMessage(String(error))
    } finally {
      setOperating(false)
    }
  }

  async function saveBucketEdit() {
    if (!selectedBucket) return
    setSaving(true)
    try {
      await traceOp(selectedBucket.id, { content: editContent })
      setDrawerEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function copyBucketId() {
    if (!selectedBucket) return
    await navigator.clipboard.writeText(selectedBucket.id)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return <section className="space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[var(--label-tracking)] text-[var(--color-primary)]">TODO · 待办</p><h1 className="mt-1 font-[var(--font-display)] text-3xl text-[var(--color-text-heading)]">待办</h1><p className="mt-1 text-sm text-[var(--color-text-tertiary)]">还有 {items.length} 件没做完</p></div>
      <button type="button" onClick={startCreate} aria-label="新增待办" className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-fill)] text-xl text-[var(--color-primary)] shadow-[var(--glass-shadow)]">＋</button>
    </div>
    <div className="flex gap-2">{domains.map(key => <button key={key} type="button" onClick={() => setDomain(key)} className={`rounded-full px-4 py-2 text-xs ${domain === key ? 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'}`}>{{ tech: '技术', emotional: '情感', unclassified: '未分类' }[key]} {groups[key].length}</button>)}</div>

    <TodoFormPanel open={formOpen} onClose={() => setFormOpen(false)} onSubmit={submit}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-2">
      <div className="flex items-center justify-between"><h2 className="font-medium">{editing ? '编辑 Todo' : '新增独立 Todo'}</h2><button type="button" onClick={() => setFormOpen(false)} className="text-sm text-[var(--color-text-tertiary)]">取消</button></div>
      <Field label="Todo 正文" wide><textarea required rows={3} className={input} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} /></Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="类型"><select className={input} value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value as TodoForm['domain'] })}><option value="tech">技术</option><option value="emotional">情感</option></select></Field>
        {editing?.source !== 'bucket' && <Field label="关联桶 ID（可选）"><input className={input} value={form.source_bucket} onChange={e => setForm({ ...form, source_bucket: e.target.value })} /></Field>}
        {editing?.source !== 'bucket' && <Field label="背景说明（无关联桶时必填）" wide><textarea required={!form.source_bucket.trim()} rows={6} ref={node => { if (node) { node.style.height = 'auto'; node.style.height = `${node.scrollHeight}px` } }} className={`${input} resize-none overflow-hidden`} value={form.context} onChange={e => setForm({ ...form, context: e.target.value })} /></Field>}
      </div>
      </div>
      <div className="shrink-0 border-t border-[var(--color-border-light)] pt-3"><button className={`${button} bg-[var(--color-primary)] text-[var(--color-on-primary)]`} type="submit">保存</button></div>
    </TodoFormPanel>

    {loading ? <Empty text="加载中…" /> : <div className="overflow-hidden rounded-[var(--radius-reading-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">{visible.length ? visible.map(item => <article key={item.id} className="flex gap-3 border-b border-[var(--color-border-light)] p-4 last:border-b-0">
      <button type="button" aria-label="标记完成" onClick={() => void toggle(item)} className="mt-0.5 h-[var(--todo-check-size)] w-[var(--todo-check-size)] shrink-0 rounded-full border border-[var(--color-border-hover)]" />
      <div className="min-w-0 flex-1"><button type="button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} className="w-full text-left"><p className={`whitespace-pre-wrap text-sm leading-6 ${expanded === item.id ? '' : 'line-clamp-2'}`}>{item.content}</p>{item.context && <p className={`mt-1 text-xs text-[var(--color-text-tertiary)] ${expanded === item.id ? 'whitespace-pre-wrap' : 'truncate'}`}>{item.context}</p>}</button>
      {expanded === item.id && <div className="mt-3 space-y-3 text-xs text-[var(--color-text-tertiary)]"><div>{item.source === 'bucket' ? <>来自 <button type="button" onClick={() => void openBucket(item.source_bucket)} className="text-[var(--color-primary)]">《{item.source_bucket_name || item.source_bucket}》</button></> : `独立 Todo · ${todoDate(item.created_at)}`}</div><div className="flex gap-2"><button type="button" onClick={() => startEdit(item)} className="rounded-full bg-[var(--color-surface-tertiary)] px-3 py-1.5">编辑</button><button type="button" onClick={() => void remove(item)} className="rounded-full bg-[var(--color-danger-bg)] px-3 py-1.5 text-[var(--color-danger)]">删除</button></div></div>}
      </div><span className="shrink-0 text-2xs text-[var(--color-text-tertiary)]">{todoDate(item.created_at)}</span>
    </article>) : <p className="p-6 text-sm text-[var(--color-text-tertiary)]">这里还没有待办。</p>}</div>}

    <div className="overflow-hidden rounded-[var(--radius-reading-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]"><button type="button" onClick={() => void expandCompleted()} className="w-full px-4 py-3 text-left text-sm text-[var(--color-text-secondary)]">已完成 · {completedCount} 件 {showCompleted ? '⌄' : '›'}</button>{showCompleted && <div>{completedVisible.map(item => <div key={item.id} className="flex gap-3 border-t border-[var(--color-border-light)] p-4"><button type="button" aria-label="重新打开" onClick={() => void toggle(item)} className="h-[var(--todo-check-size)] w-[var(--todo-check-size)] shrink-0 rounded-full bg-[var(--color-primary)] text-xs text-[var(--color-on-primary)]">✓</button><span className="flex-1 text-sm text-[var(--color-text-tertiary)] line-through">{item.content}</span><span className="text-2xs text-[var(--color-text-tertiary)]">{todoDate(item.created_at)}</span></div>)}</div>}</div>

    <BucketDetailDrawer
      selected={selectedBucket}
      detailLoading={detailLoading}
      editing={drawerEditing}
      editContent={editContent}
      saving={saving}
      operating={operating}
      copied={copied}
      onClose={() => { setSelectedBucket(null); setDrawerEditing(false) }}
      onStartEdit={(content) => { setDrawerEditing(true); setEditContent(content) }}
      onCancelEdit={() => setDrawerEditing(false)}
      onSaveEdit={saveBucketEdit}
      onTraceOp={traceOp}
      onCopyId={copyBucketId}
      onTouch={async (id) => {
        const response = await fetch(`/api/touch/${encodeURIComponent(id)}`, { method: 'POST' })
        if (!response.ok) throw new Error('轻触失败')
        await refreshSelected(id)
      }}
      onArchive={async (id) => {
        const isArchived = selectedBucket?.metadata?.type === 'archived'
        setOperating(true)
        try {
          const endpoint = isArchived ? `/api/unarchive/${encodeURIComponent(id)}` : `/api/archive/${encodeURIComponent(id)}`
          const response = await fetch(endpoint, { method: 'POST' })
          const data = await response.json().catch(() => ({}))
          if (!response.ok || !data.ok) throw new Error(data.error || '归档操作失败')
          setSelectedBucket(null)
          await load()
        } catch (error) {
          onMessage(String(error))
        } finally {
          setOperating(false)
        }
      }}
      onActivate={async (id) => {
        const response = await fetch(`/api/touch/${encodeURIComponent(id)}?ripple=true`, { method: 'POST' })
        if (!response.ok) throw new Error('激活失败')
        await refreshSelected(id)
      }}
    />
  </section>
}

function Empty({ text }: { text: string }) {
  return <div className={`${panel} px-4 py-12 text-center text-sm text-[var(--color-text-tertiary)]`}>{text}</div>
}
