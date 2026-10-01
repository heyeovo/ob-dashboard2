import { NextResponse } from 'next/server'
import { isDraining } from '@/app/lib/serverDrain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { ok: !isDraining(), ...(isDraining() ? { error: 'server_draining' } : {}) },
    { status: isDraining() ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
