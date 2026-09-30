import FileBrowserPage from './FileBrowserPage'

// 动态段里的中文（如「小羊给的」）到这里还是百分号编码，先解码，否则调 API 时会被再编码一次
function decode(segment: string): string {
  try { return decodeURIComponent(segment) } catch { return segment }
}

export default async function Page({ params }: { params: Promise<{ root: string; path?: string[] }> }) {
  const { root, path = [] } = await params
  return <FileBrowserPage root={decode(root)} parts={path.map(decode)} />
}
