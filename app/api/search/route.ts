import { searchBuckets } from '@/app/lib/api'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  try {
    const data = await searchBuckets(q)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
