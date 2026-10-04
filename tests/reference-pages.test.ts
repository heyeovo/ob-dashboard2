import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')

/** app 下每个含 page.tsx 的顶层路由目录；子路由由父目录那一行覆盖。 */
function topLevelPageDirs(): string[] {
  const app = path.join(ROOT, 'app')
  const dirs: string[] = []
  const hasPage = (dir: string): boolean => readdirSync(dir).some(name => {
    const full = path.join(dir, name)
    if (name === 'page.tsx') return true
    return statSync(full).isDirectory() && name !== 'api' && hasPage(full)
  })
  for (const name of readdirSync(app)) {
    const full = path.join(app, name)
    if (name === 'api' || !statSync(full).isDirectory()) continue
    if (hasPage(full)) dirs.push(`app/${name}/`)
  }
  return dirs.sort()
}

describe('docs/reference.md 文件结构速查', () => {
  it('每个页面目录都登记在页面表里', () => {
    const doc = readFileSync(path.join(ROOT, 'docs/reference.md'), 'utf8')
    const section = doc.slice(doc.indexOf('## 文件结构速查'), doc.indexOf('## cc 数据持久化契约'))
    const missing = topLevelPageDirs().filter(dir => !section.includes(`\`${dir}`))
    expect(missing).toEqual([])
  })
})
