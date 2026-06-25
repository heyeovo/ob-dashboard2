import { getBuckets } from '@/app/lib/api'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const full = new URL(req.url).searchParams.get('full') === '1'
  try {
    const data = await getBuckets(full)
    return NextResponse.json(data)
  } catch (e: any) {
    console.error('/api/buckets error:', e.message)
    return NextResponse.json({ error: e.message || 'Unknown' }, { status: 500 })
  }
}
