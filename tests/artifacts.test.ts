import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listArtifacts, readArtifact } from '@/app/lib/artifacts'
import { artifactFromToolCall, isArtifactName, parseArtifactHead, slimToolInputForStorage } from '@/app/lib/artifactMeta'

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

  it('recognizes artifact writes and patches from yanzhi files tool calls', () => {
    expect(artifactFromToolCall('mcp__yanzhi__files', { action: 'write', path: 'artifacts/snake.html', content: '<title>贪吃蛇</title>' }))
      .toEqual({ name: 'snake.html', action: 'write', title: '贪吃蛇' })
    expect(artifactFromToolCall('mcp__yanzhi__files', { action: 'patch', path: './artifacts/snake.html', old_text: 'a', new_text: 'b' }))
      .toEqual({ name: 'snake.html', action: 'patch', title: '' })
    expect(artifactFromToolCall('mcp__yanzhi__files', { action: 'read', path: 'artifacts/snake.html' })).toBeNull()
    expect(artifactFromToolCall('mcp__yanzhi__files', { action: 'write', path: 'notes/a.html', content: '' })).toBeNull()
    expect(artifactFromToolCall('mcp__yanzhi__files', { action: 'write', path: 'artifacts/deep/a.html', content: '' })).toBeNull()
    expect(artifactFromToolCall('Write', { file_path: 'artifacts/a.html' })).toBeNull()
  })

  it('recognizes native Write/Edit on the mounted artifacts folder', () => {
    expect(artifactFromToolCall('Write', { file_path: '/data/cc-chat-files/artifacts/rain.html', content: '<title>下雨天</title>' }))
      .toEqual({ name: 'rain.html', action: 'write', title: '下雨天' })
    expect(artifactFromToolCall('Edit', { file_path: '/data/cc-chat-files/artifacts/rain.html', old_string: 'a', new_string: 'b' }))
      .toEqual({ name: 'rain.html', action: 'patch', title: '' })
    expect(artifactFromToolCall('Read', { file_path: '/data/cc-chat-files/artifacts/rain.html' })).toBeNull()
    expect(artifactFromToolCall('Write', { file_path: '/data/cc-chat-files/artifacts/../x.html', content: '' })).toBeNull()
    expect(artifactFromToolCall('Write', { file_path: '/data/cc-chat-files/notes/a.html', content: '' })).toBeNull()
    const write = { file_path: '/data/cc-chat-files/artifacts/rain.html', content: '<title>下雨天</title><p>long</p>' }
    expect(slimToolInputForStorage('Write', write))
      .toEqual({ file_path: write.file_path, title: '下雨天', content_chars: write.content.length })
  })

  it('slims stored artifact writes but leaves other tool inputs alone', () => {
    const write = { action: 'write', path: 'artifacts/a.html', content: '<title>A</title><p>long</p>', overwrite: true }
    const slim = slimToolInputForStorage('mcp__yanzhi__files', write)
    expect(slim).toEqual({ action: 'write', path: 'artifacts/a.html', overwrite: true, title: 'A', content_chars: write.content.length })
    expect(artifactFromToolCall('mcp__yanzhi__files', slim)).toEqual({ name: 'a.html', action: 'write', title: 'A' })
    const note = { action: 'write', path: 'notes/a.md', content: 'keep' }
    expect(slimToolInputForStorage('mcp__yanzhi__files', note)).toBe(note)
  })

  it('returns an empty list before the folder exists', async () => {
    await expect(listArtifacts(root)).resolves.toEqual([])
  })
})
