import { openedRoom, readRoomFile, roomHeaders } from '@/app/lib/roomServer'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  try {
    const { id, path } = await params
    if (!await openedRoom(id)) return Response.json({ error: '找不到房间文件' }, { status: 404, headers: roomHeaders })
    return readRoomFile(id, path.join('/'), new URL(request.url).searchParams.get('raw') === '1')
  } catch { return Response.json({ error: '暂时无法读取文件' }, { status: 502, headers: roomHeaders }) }
}
