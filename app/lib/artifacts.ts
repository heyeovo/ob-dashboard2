import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ARTIFACTS_DIR, YANZHI_FILES_ROOT, artifactBaseName, artifactKind, isArtifactName, parseArtifactHead, type ArtifactKind } from './artifactMeta'

export { isArtifactName, parseArtifactHead }

// 言之做的小页面/小游戏：yanzhi's files 下 artifacts/ 里的平铺文件。
// 只认一层、只认 html/svg，名字不合规一律当不存在，不做路径拼接之外的解析。

export type ArtifactMeta = {
  name: string
  kind: ArtifactKind
  title: string
  description: string
  size: number
  updated_at: string
}

const HEAD_BYTES = 16 * 1024
const MAX_SERVE_BYTES = 1024 * 1024

export const ARTIFACT_CONTENT_TYPES: Record<ArtifactKind, string> = {
  html: 'text/html; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
}

/** 页面在无同源的沙箱里跑：脚本能动，碰不到 dashboard 的 cookie、存储和接口。 */
export const ARTIFACT_CSP = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads'

export function artifactsDir(root = YANZHI_FILES_ROOT): string {
  return path.join(root, ARTIFACTS_DIR)
}

async function regularFile(file: string) {
  const info = await lstat(file).catch(() => null)
  return info && info.isFile() && !info.isSymbolicLink() ? info : null
}

export async function listArtifacts(root = YANZHI_FILES_ROOT): Promise<ArtifactMeta[]> {
  const dir = artifactsDir(root)
  const dirInfo = await lstat(dir).catch(() => null)
  if (!dirInfo?.isDirectory() || dirInfo.isSymbolicLink()) return []
  const names = (await readdir(dir)).filter(isArtifactName)
  const items = await Promise.all(names.map(async (name): Promise<ArtifactMeta | null> => {
    const file = path.join(dir, name)
    const info = await regularFile(file)
    if (!info) return null
    const head = info.size > 0 ? (await readFile(file)).subarray(0, HEAD_BYTES).toString('utf8') : ''
    const parsed = parseArtifactHead(head)
    return {
      name,
      kind: artifactKind(name),
      title: parsed.title || artifactBaseName(name),
      description: parsed.description,
      size: info.size,
      updated_at: info.mtime.toISOString(),
    }
  }))
  return items
    .filter((item): item is ArtifactMeta => item !== null)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function readArtifact(name: string, root = YANZHI_FILES_ROOT): Promise<{ body: Buffer; kind: ArtifactKind } | null> {
  if (!isArtifactName(name)) return null
  const file = path.join(artifactsDir(root), name)
  const dirInfo = await lstat(artifactsDir(root)).catch(() => null)
  if (!dirInfo?.isDirectory() || dirInfo.isSymbolicLink()) return null
  const info = await regularFile(file)
  if (!info || info.size > MAX_SERVE_BYTES) return null
  return { body: await readFile(file), kind: artifactKind(name) }
}
