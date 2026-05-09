const BASE_URL = process.env.OMBRE_BASE_URL!
const SESSION = process.env.OMBRE_SESSION!

const headers = {
  Cookie: `ombre_session=${SESSION}`,
}

export async function getBuckets() {
  const res = await fetch(`${BASE_URL}/api/buckets`, { headers })
  if (!res.ok) throw new Error('Failed to fetch buckets')
  return res.json()
}

export async function getBucket(id: string) {
  const res = await fetch(`${BASE_URL}/api/bucket/${id}`, { headers })
  if (!res.ok) throw new Error('Failed to fetch bucket')
  return res.json()
}

export async function searchBuckets(q: string) {
  const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(q)}`, { headers })
  if (!res.ok) throw new Error('Failed to search')
  return res.json()
}