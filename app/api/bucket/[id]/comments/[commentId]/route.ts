import { getHavenBaseUrl, getSessionCookie } from '@/app/lib/api'
import { NextResponse } from 'next/server'

async function proxy(
  request: Request,
  params: Promise<{ id: string; commentId: string }>,
  method: 'PATCH' | 'DELETE',
) {
  try {
    const { id, commentId } = await params
    const cookie = await getSessionCookie()
    const response = await fetch(
      `${getHavenBaseUrl()}/api/bucket/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
      {
        method,
        headers: method === 'PATCH'
          ? { 'Content-Type': 'application/json', Cookie: cookie }
          : { Cookie: cookie },
        body: method === 'PATCH' ? await request.text() : undefined,
      },
    )
    const text = await response.text()
    let data: Record<string, unknown> = {}
    try { data = text ? JSON.parse(text) as Record<string, unknown> : {} } catch { data = { error: text } }
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  return proxy(request, params, 'PATCH')
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  return proxy(request, params, 'DELETE')
}
