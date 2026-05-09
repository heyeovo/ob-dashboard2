import { getBuckets } from '@/app/lib/api'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const data = await getBuckets()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}