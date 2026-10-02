import { relayRooms } from '@/app/lib/roomServer'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams
  const query = new URLSearchParams()
  query.set('limit', String(Math.max(1, Math.min(100, Number(input.get('limit')) || 50))))
  if (input.get('before')) query.set('before', input.get('before')!)
  return relayRooms(`/api/rooms/visits?${query}`)
}
