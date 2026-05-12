import { getBuckets } from '@/app/lib/api'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const data = await getBuckets()
    return NextResponse.json(data)
  } catch (e: any) {
    console.error('/api/buckets error:', e.message)
    return NextResponse.json({ error: e.message || 'Unknown' }, { status: 500 })
  }
}
