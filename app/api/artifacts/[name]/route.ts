import { ARTIFACT_CONTENT_TYPES, ARTIFACT_CSP, readArtifact } from '@/app/lib/artifacts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params
  let decoded = name
  try { decoded = decodeURIComponent(name) } catch { /* 已解码或非法，按原样交给名字校验 */ }
  const artifact = await readArtifact(decoded)
  if (!artifact) return Response.json({ ok: false, error: '找不到这个作品' }, { status: 404 })
  return new Response(new Uint8Array(artifact.body), {
    status: 200,
    headers: {
      'Content-Type': ARTIFACT_CONTENT_TYPES[artifact.kind],
      'Content-Security-Policy': ARTIFACT_CSP,
      'Cache-Control': 'no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
