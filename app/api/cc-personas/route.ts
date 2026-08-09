import { NextRequest } from 'next/server'
import {
  deletePersona,
  listPersonas,
  savePersona,
  type CcEngine,
  type PersonaPatch,
} from '@/app/lib/havenPersonas'
import { DEFAULT_PERSONA_BASE_PROMPT } from '@/app/lib/personaPrompt'

// 4.5b 协作者配置。代理到 Haven 的 /gateway/api/cc/personas。
//
//   GET    /api/cc-personas          → 列全部（没有任何一个时自动建一个默认的）
//   POST   /api/cc-personas          → upsert 一个（PATCH 语义：只送的字段才改）
//   DELETE /api/cc-personas?id=xxx   → 删一个
//
// ⚠️ 网关密码留在服务端（OMBRE_GATEWAY_TOKEN），浏览器只跟这条路由说话。

export const runtime = 'nodejs'

const ENGINES: CcEngine[] = ['subscription', 'api', 'selfhost']

/** 一个协作者都没有时自动落库的那个。跟 app/cc/persona.ts 的 FALLBACK_PERSONA 对齐。 */
const SEED_PERSONA: PersonaPatch = {
  id: 'ombre',
  name: 'Ombre',
  initial: 'O',
  tint: 'var(--chat-avatar-tint)',
  user_name: '',
  purpose: '',
  description: '',
  base_prompt: DEFAULT_PERSONA_BASE_PROMPT,
  prompt: '',
  prompt_modules: [],
  memory_entries: [],
  dirs: [],
  // 空 = 不能写。种子协作者也一样，写权限要用户自己去配
  write_dirs: [],
  recall_on: true,
  semantic_on: true,
  engine: 'api',
  sort_order: 0,
}

export async function GET() {
  const res = await listPersonas()
  if (!res.ok) return Response.json({ ok: false, error: res.error, personas: [] }, { status: 502 })

  // 空库时种一个，界面开局就有人可选，不用先点新建。
  if (res.personas.length === 0) {
    const seeded = await savePersona(SEED_PERSONA)
    if (seeded.ok && seeded.persona) {
      return Response.json({ ok: true, seeded: true, count: 1, personas: [seeded.persona] })
    }
  }

  return Response.json({ ok: true, seeded: false, count: res.personas.length, personas: res.personas })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ ok: false, error: '请求体不是对象' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const id = String(input.id || '').trim()
  if (!id) return Response.json({ ok: false, error: 'id 不能为空' }, { status: 400 })

  // 白名单：只把认识的字段转给 Haven，未出现的字段不动（PATCH 语义靠这个成立）
  const patch: PersonaPatch = { id }
  for (const key of ['name', 'initial', 'tint', 'user_name', 'purpose', 'description', 'base_prompt', 'prompt'] as const) {
    if (key in input) patch[key] = String(input[key] ?? '')
  }
  for (const key of ['recall_on', 'semantic_on'] as const) {
    if (key in input) patch[key] = input[key] !== false
  }
  if ('sort_order' in input) {
    const n = Number(input.sort_order)
    patch.sort_order = Number.isFinite(n) ? Math.trunc(n) : 0
  }
  // write_dirs 是第 5 步加的「能改哪些目录」，跟 dirs 一样是路径数组
  for (const key of ['memory_entries', 'dirs', 'write_dirs'] as const) {
    if (!(key in input)) continue
    const raw = input[key]
    patch[key] = Array.isArray(raw)
      ? raw.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
  }
  if ('prompt_modules' in input) {
    const raw = input.prompt_modules
    patch.prompt_modules = Array.isArray(raw)
      ? raw.flatMap((item, index) => {
          if (!item || typeof item !== 'object') return []
          const value = item as Record<string, unknown>
          const content = String(value.content || '').trim()
          if (!content) return []
          return [{
            id: String(value.id || `module-${index + 1}`).trim() || `module-${index + 1}`,
            name: String(value.name || '未命名模块').trim() || '未命名模块',
            content,
            enabled_by_default: value.enabled_by_default !== false,
          }]
        })
      : []
  }
  if ('engine' in input) {
    const engine = String(input.engine || '')
    if (!ENGINES.includes(engine as CcEngine)) {
      return Response.json({ ok: false, error: `engine 只能是 ${ENGINES.join(' / ')}` }, { status: 400 })
    }
    patch.engine = engine as CcEngine
  }

  const res = await savePersona(patch)
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })
  return Response.json({ ok: true, persona: res.persona })
}

export async function DELETE(request: NextRequest) {
  const id = String(request.nextUrl.searchParams.get('id') || '').trim()
  if (!id) return Response.json({ ok: false, error: 'id 不能为空' }, { status: 400 })
  const res = await deletePersona(id)
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 502 })
  return Response.json({ ok: true, deleted: res.deleted, id })
}
