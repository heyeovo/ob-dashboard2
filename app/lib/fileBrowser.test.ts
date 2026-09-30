import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanUploadName, isBlockedSegment, isInside, numberedName, resolveExistingInside, safeSegments } from './fileBrowser'

describe('file browser boundary', () => {
  it('blocks hidden, dependency and credential paths', () => {
    for (const name of ['.env', '.env.local', '.git', '.next', 'node_modules', 'private.pem', 'private.key', 'my-credentials.json', 'secret-notes.md']) {
      expect(isBlockedSegment(name)).toBe(true)
      expect(safeSegments(`folder/${name}`)).toBeNull()
    }
    expect(safeSegments('../outside')).toBeNull()
    expect(safeSegments('a/../outside')).toBeNull()
    expect(safeSegments('/etc/passwd')).toBeNull()
    expect(safeSegments('folder\\outside')).toBeNull()
    expect(safeSegments('folder/normal.md')).toEqual(['folder', 'normal.md'])
  })

  it('requires the resolved path to remain within its root, including notes memory', () => {
    const root = path.resolve('projects', 'example', 'memory')
    expect(isInside(root, path.join(root, 'MEMORY.md'))).toBe(true)
    expect(isInside(root, path.resolve(root, '..', 'credentials.json'))).toBe(false)
    expect(isInside(root, `${root}-other`)).toBe(false)
  })

  it('cleans uploads and names duplicates without overwriting', () => {
    expect(cleanUploadName('../../.report.md')).toBe('report.md')
    expect(cleanUploadName('C:\\temp\\photo.png')).toBe('photo.png')
    expect(numberedName('国庆.md', 1)).toBe('国庆.md')
    expect(numberedName('国庆.md', 2)).toBe('国庆 (2).md')
    expect(numberedName('plain', 3)).toBe('plain (3)')
  })
})

describe('realpath checks', () => {
  let base = ''
  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'ob-file-browser-'))
    await mkdir(path.join(base, 'allowed'))
    await writeFile(path.join(base, 'allowed', 'ok.txt'), 'ok')
    await writeFile(path.join(base, 'outside.txt'), 'secret')
  })
  afterAll(async () => {
    if (base && isInside(os.tmpdir(), base)) await rm(base, { recursive: true, force: true })
  })
  it('accepts a file inside the root and rejects a symlink escape when supported', async () => {
    const root = path.join(base, 'allowed')
    expect(await resolveExistingInside(root, 'ok.txt')).toBe(path.join(root, 'ok.txt'))
    try { await symlink(path.join(base, 'outside.txt'), path.join(root, 'link.txt')) }
    catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) return
      throw error
    }
    expect(await resolveExistingInside(root, 'link.txt')).toBeNull()
  })
})
