import { relayRooms, roomIdValid } from '@/app/lib/roomServer'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return roomIdValid(id) ? relayRooms(`/api/rooms/${id}`) : Response.json({ error: '房间不存在' }, { status: 404 })
}
