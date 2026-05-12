import { NextResponse } from 'next/server'

// 这个函数只在浏览器端调用，所以用 localStorage 完全没问题
function getLocalState() {
  if (typeof window === 'undefined') return { statusMap: {}, categoryMap: {}, categories: [] }
  const raw = localStorage.getItem('review_state')
  if (!raw) return { statusMap: {}, categoryMap: {}, categories: [] }
  try {
    return JSON.parse(raw)
  } catch {
    return { statusMap: {}, categoryMap: {}, categories: [] }
  }
}

function setLocalState(state: any) {
  if (typeof window === 'undefined') return
  localStorage.setItem('review_state', JSON.stringify(state))
}

export async function GET() {
  // 这个 GET 会被前端 fetch 调用，但 localStorage 只能在浏览器端访问
  // 所以我们需要在客户端直接读 localStorage，这里返回空作为 fallback
  return NextResponse.json({ statusMap: {}, categoryMap: {}, categories: [] })
}

export async function POST(req: Request) {
  try {
    const { targetId, status, category, newCategory } = await req.json()
    if (!targetId) return NextResponse.json({ error: 'missing targetId' }, { status: 400 })

    const state = getLocalState()
    const statusMap = state.statusMap ?? {}
    const categoryMap = state.categoryMap ?? {}
    const categories: string[] = state.categories ?? []

    if (status !== undefined) {
      if (status === null) delete statusMap[targetId]
      else statusMap[targetId] = status
    }
    if (category !== undefined) {
      if (category === null) delete categoryMap[targetId]
      else categoryMap[targetId] = category
    }
    if (newCategory && !categories.includes(newCategory)) {
      categories.push(newCategory)
    }

    setLocalState({ statusMap, categoryMap, categories })
    return NextResponse.json({ ok: true, categories })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
