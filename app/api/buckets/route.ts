import { getBuckets, getBucketsPaginated } from '@/app/lib/api'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const full = url.searchParams.get('full') === '1'
  const limit = url.searchParams.get('limit')
  const offset = url.searchParams.get('offset')

  try {
    if (limit !== null) {
      const data = await getBucketsPaginated(
        parseInt(limit, 10),
        parseInt(offset || '0', 10),
        full,
      )
      return NextResponse.json(data)
    }
    const data = await getBuckets(full)
    return NextResponse.json(data)
  } catch (e: any) {
    console.error('/api/buckets error:', e.message)
    return NextResponse.json({ error: e.message || 'Unknown' }, { status: 500 })
  }
}
