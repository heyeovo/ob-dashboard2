import { NextRequest, NextResponse } from 'next/server'
import { BASE_URL, getSessionCookie } from '../../lib/api'

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''
  const searchParams = new URL(req.url).searchParams

  try {
    const cookie = await getSessionCookie()

    let res: Response
    if (contentType.includes('multipart/form-data')) {
      // Forward as multipart
      const formData = await req.formData()
      const file = formData.get('file')
      const preserveRaw = searchParams.get('preserve_raw') || ''
      const resume = searchParams.get('resume') || ''
      const maxChunks = searchParams.get('max_chunks') || '0'
      const mode = searchParams.get('mode') || 'large'

      // Build target URL
      const params = new URLSearchParams()
      if (preserveRaw) params.set('preserve_raw', preserveRaw)
      if (resume) params.set('resume', resume)
      params.set('max_chunks', maxChunks)
      params.set('mode', mode)

      const targetForm = new FormData()
      if (file) targetForm.set('file', file)

      res = await fetch(`${BASE_URL}/api/import/upload?${params}`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: targetForm,
      })
    } else {
      // Raw body (text paste)
      const params = new URLSearchParams(searchParams)
      if (!params.get('max_chunks')) params.set('max_chunks', '0')
      if (!params.get('mode')) params.set('mode', 'large')

      const body = await req.text()
      res = await fetch(`${BASE_URL}/api/import/upload?${params}`, {
        method: 'POST',
        headers: { 'Cookie': cookie, 'Content-Type': 'text/plain' },
        body,
      })
    }

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
