import type { NextRequest } from 'next/server'
import { importPolarisConversations } from '@/app/lib/havenTurns'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (
    !body
    || body.format !== 'polaris-export'
    || Number(body.version) !== 1
    || !Array.isArray(body.conversations)
    || body.conversations.length === 0
  ) {
    return Response.json({ ok: false, error: '无效的 Polaris export v1 对话数据' }, { status: 400 })
  }

  const result = await importPolarisConversations({
    format: 'polaris-export',
    version: 1,
    conversations: body.conversations,
  })
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error || 'Haven 导入接口不可用' },
      { status: result.httpStatus ?? 502 },
    )
  }
  return Response.json(result.payload, { status: result.httpStatus ?? (result.ok ? 200 : 502) })
}
