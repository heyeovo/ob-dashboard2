import { getConversationWordStats } from '@/app/lib/havenTurns'

// 主页「说过多少字」：转给 Haven sessions?word_stats=1，只有按天的数字，没有正文

export const runtime = 'nodejs'

export async function GET() {
  const result = await getConversationWordStats()
  return Response.json(
    { ok: result.ok, days: result.days, error: result.error || undefined },
    { status: result.ok ? 200 : 502 },
  )
}
