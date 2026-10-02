import { openedRoom, listRoomFiles, roomHeaders } from '@/app/lib/roomServer'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!await openedRoom(id)) return Response.json({ error: '找不到房间文件' }, { status: 404, headers: roomHeaders })
    return Response.json({ files: await listRoomFiles(id) }, { headers: roomHeaders })
  } catch { return Response.json({ error: '暂时无法读取文件' }, { status: 502, headers: roomHeaders }) }
}
