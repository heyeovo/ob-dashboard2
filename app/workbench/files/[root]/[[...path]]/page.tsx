import FileBrowserPage from './FileBrowserPage'

export default async function Page({ params }: { params: Promise<{ root: string; path?: string[] }> }) {
  const { root, path = [] } = await params
  return <FileBrowserPage root={root} parts={path} />
}
