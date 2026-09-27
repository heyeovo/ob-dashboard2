import { listArtifacts } from '@/app/lib/artifacts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return Response.json({ ok: true, items: await listArtifacts() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, error: (error as Error).message || '读取作品失败' }, { status: 500 })
  }
}
