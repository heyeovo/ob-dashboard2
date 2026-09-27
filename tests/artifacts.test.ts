import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isArtifactName, listArtifacts, parseArtifactHead, readArtifact } from '@/app/lib/artifacts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'artifacts-root-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('artifacts', () => {
  it('accepts flat html/svg names only', () => {
    expect(isArtifactName('snake.html')).toBe(true)
    expect(isArtifactName('奶糖-cat.svg')).toBe(true)
    expect(isArtifactName('../x.html')).toBe(false)
    expect(isArtifactName('a/b.html')).toBe(false)
    expect(isArtifactName('note.md')).toBe(false)
    expect(isArtifactName('.hidden.html')).toBe(false)
  })

  it('parses title and description from the head', () => {
    expect(parseArtifactHead('<html><head><title> 贪吃蛇 &amp; 奶糖 </title><meta name="description" content="用方向键玩"></head>'))
      .toEqual({ title: '贪吃蛇 & 奶糖', description: '用方向键玩' })
    expect(parseArtifactHead('<svg></svg>')).toEqual({ title: '', description: '' })
  })

  it('lists newest first and ignores symlinks and other files', async () => {
    const dir = path.join(root, 'artifacts')
    await mkdir(dir)
    await writeFile(path.join(dir, 'old.html'), '<title>Old</title>')
    await writeFile(path.join(dir, 'new.html'), '<title>New</title><meta content=\'desc\' name=description>')
    await writeFile(path.join(dir, 'notes.md'), 'x')
    await writeFile(path.join(root, 'secret.html'), 'secret')
    await symlink(path.join(root, 'secret.html'), path.join(dir, 'link.html'))
    await utimes(path.join(dir, 'old.html'), new Date('2026-01-01'), new Date('2026-01-01'))

    const items = await listArtifacts(root)
    expect(items.map(item => item.name)).toEqual(['new.html', 'old.html'])
    expect(items[0]).toMatchObject({ title: 'New', description: 'desc', kind: 'html' })
    await expect(readArtifact('link.html', root)).resolves.toBeNull()
    await expect(readArtifact('../secret.html', root)).resolves.toBeNull()
    expect((await readArtifact('old.html', root))?.body.toString()).toBe('<title>Old</title>')
  })

  it('returns an empty list before the folder exists', async () => {
    await expect(listArtifacts(root)).resolves.toEqual([])
  })
})
