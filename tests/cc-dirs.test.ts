import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isPathWithinRoots,
  pathTargetFromToolInput,
  resolveDirs,
  resolveWriteDirs,
} from '@/app/lib/ccDirs'

describe('cc workspace 路径边界', () => {
  let fixture = ''
  let dashboard = ''
  let haven = ''
  let outside = ''

  beforeEach(async () => {
    fixture = await mkdtemp(path.join(os.tmpdir(), 'cc-dirs-'))
    dashboard = path.join(fixture, 'workspace', 'dashboard')
    haven = path.join(fixture, 'workspace', 'haven')
    outside = path.join(fixture, 'outside')
    await Promise.all([
      mkdir(dashboard, { recursive: true }),
      mkdir(haven, { recursive: true }),
      mkdir(outside, { recursive: true }),
    ])
  })

  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true })
  })

  it('本机 dev 保留 cwd fallback，production 默认 dashboard 且只接收两个根内目录', async () => {
    const local = await resolveDirs(undefined, { cwd: dashboard, production: false })
    expect(local).toEqual({ cwd: await realpath(dashboard), additionalDirectories: [] })

    const productionOptions = {
      production: true,
      productionRoots: [dashboard, haven],
    }
    const production = await resolveDirs(undefined, productionOptions)
    expect(production).toEqual({ cwd: await realpath(dashboard), additionalDirectories: [] })
    await expect(resolveDirs([outside], productionOptions)).rejects.toThrow('不在 VPS workspace 白名单内')
    await expect(resolveWriteDirs(undefined, productionOptions)).resolves.toEqual([])
  })

  it('允许根目录本身、根内绝对路径和正常的新文件/目录', async () => {
    const root = await realpath(dashboard)
    const existing = path.join(dashboard, 'existing.txt')
    await writeFile(existing, 'ok')

    await expect(isPathWithinRoots(root, [root], root)).resolves.toBe(true)
    await expect(isPathWithinRoots(existing, [root], root)).resolves.toBe(true)
    await expect(isPathWithinRoots('new.txt', [root], root)).resolves.toBe(true)
    await expect(isPathWithinRoots(path.join('new-dir', 'nested.txt'), [root], root)).resolves.toBe(true)
  })

  it('拒绝 .. 越界、白名单外绝对路径和相似前缀目录', async () => {
    const root = await realpath(dashboard)
    const similar = `${dashboard}-backup`
    await mkdir(similar)

    await expect(isPathWithinRoots(path.join('..', '..', 'outside', 'x.txt'), [root], root)).resolves.toBe(false)
    await expect(isPathWithinRoots(path.join(outside, 'x.txt'), [root], root)).resolves.toBe(false)
    await expect(isPathWithinRoots(path.join(similar, 'x.txt'), [root], root)).resolves.toBe(false)
  })

  it.skipIf(process.platform === 'win32')('拒绝文件 symlink 逃出根目录', async () => {
    const root = await realpath(dashboard)
    const outsideFile = path.join(outside, 'secret.txt')
    const fileLink = path.join(dashboard, 'file-link.txt')
    await writeFile(outsideFile, 'secret')
    await symlink(outsideFile, fileLink, 'file')

    await expect(isPathWithinRoots(fileLink, [root], root)).resolves.toBe(false)
  })

  it('拒绝目录 symlink 和新文件父目录逃出根目录', async () => {
    const root = await realpath(dashboard)
    const directoryLink = path.join(dashboard, 'directory-link')
    await symlink(outside, directoryLink, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(isPathWithinRoots(directoryLink, [root], root)).resolves.toBe(false)
    await expect(isPathWithinRoots(path.join(directoryLink, 'new.txt'), [root], root)).resolves.toBe(false)
  })

  it('六个读写工具只从真实路径字段取目标，Grep/Glob 缺省回到 SDK cwd', () => {
    expect(pathTargetFromToolInput('Read', { file_path: 'read.txt' }, dashboard)).toBe('read.txt')
    expect(pathTargetFromToolInput('Grep', { path: 'src', glob: '*.ts' }, dashboard)).toBe('src')
    expect(pathTargetFromToolInput('Glob', { pattern: '**/*.ts' }, dashboard)).toBe(dashboard)
    expect(pathTargetFromToolInput('Write', { file_path: 'write.txt' }, dashboard)).toBe('write.txt')
    expect(pathTargetFromToolInput('Edit', { file_path: 'edit.txt' }, dashboard)).toBe('edit.txt')
    expect(pathTargetFromToolInput('NotebookEdit', { notebook_path: 'book.ipynb' }, dashboard)).toBe('book.ipynb')
  })
})
