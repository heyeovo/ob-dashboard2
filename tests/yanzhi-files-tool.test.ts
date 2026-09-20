import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  executeYanzhiFiles,
  yanzhiFilesMcpModelSurface,
} from '@/app/lib/cc/yanzhiFilesTool'
import {
  builtInMcpCatalog,
  builtInMcpModelSurfaces,
  builtInMcpPermissionForTool,
  builtInMcpServerNames,
} from '@/app/lib/cc/builtInMcp'

let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yanzhi-files-root-'))
  outside = await mkdtemp(path.join(tmpdir(), 'yanzhi-files-outside-'))
})

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ])
})

describe("yanzhi's files built-in MCP", () => {
  it('has one compact tool, no server instructions, and appears in the MCP catalog', () => {
    const surface = yanzhiFilesMcpModelSurface()
    expect(surface).not.toHaveProperty('instructions')
    expect(surface.tools).toHaveLength(1)
    expect(JSON.stringify(surface).length).toBeLessThan(2_000)
    expect(builtInMcpCatalog().find(item => item.name === 'yanzhi')).toMatchObject({
      label: "yanzhi's files",
      enabled: true,
      permission: 'allow',
      permissionConfigurable: true,
    })
    expect(builtInMcpCatalog({}, { yanzhi: 'ask' }).find(item => item.name === 'yanzhi'))
      .toMatchObject({ permission: 'ask' })
  })

  it('is injected only in chat mode and can be completely disabled', () => {
    expect(builtInMcpServerNames({}, 'chat')).toContain('yanzhi')
    expect(builtInMcpServerNames({}, 'work')).not.toContain('yanzhi')
    expect(builtInMcpModelSurfaces({ yanzhi: false }, 'chat'))
      .not.toContainEqual(expect.objectContaining({ name: 'yanzhi' }))
  })

  it('applies configurable runtime permission without changing Agent Wake policy', () => {
    expect(builtInMcpPermissionForTool('mcp__yanzhi__files')).toBe('allow')
    expect(builtInMcpPermissionForTool('mcp__yanzhi__files', {}, { yanzhi: 'ask' })).toBe('ask')
    expect(builtInMcpPermissionForTool('mcp__yanzhi__files', { yanzhi: false })).toBe('deny')
    expect(builtInMcpPermissionForTool('mcp__ombre_agent_wake__set_agent_wake', {}, { ombre_agent_wake: 'ask' }))
      .toBe('allow')
  })

  it('creates folders, writes, lists, searches, and reads by line range', async () => {
    await executeYanzhiFiles({ action: 'mkdir', path: 'notes/daily' }, root)
    await executeYanzhiFiles({ action: 'write', path: 'notes/daily/one.md', content: 'alpha\nneedle here\nomega' }, root)

    await expect(executeYanzhiFiles({ action: 'write', path: 'notes/daily/one.md', content: 'replace' }, root))
      .rejects.toMatchObject({ code: 'EEXIST' })
    await expect(executeYanzhiFiles({ action: 'list', path: 'notes/daily' }, root))
      .resolves.toContain('file\tone.md')
    await expect(executeYanzhiFiles({ action: 'search', path: 'notes', query: 'needle' }, root))
      .resolves.toContain('notes/daily/one.md:2: needle here')
    await expect(executeYanzhiFiles({ action: 'read', path: 'notes/daily/one.md', offset: 1, limit: 1 }, root))
      .resolves.toContain('2: needle here')
    await expect(executeYanzhiFiles({ action: 'write', path: 'notes/daily/one.md', content: 'replaced', overwrite: true }, root))
      .resolves.toContain('已写入')
  })

  it('blocks absolute paths, traversal, and symbolic-link escape', async () => {
    await expect(executeYanzhiFiles({ action: 'list', path: '/etc' }, root)).rejects.toThrow('相对路径')
    await expect(executeYanzhiFiles({ action: 'read', path: '../outside.txt' }, root)).rejects.toThrow('..')

    await writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8')
    const link = path.join(root, 'escape')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(executeYanzhiFiles({ action: 'read', path: 'escape/secret.txt' }, root)).rejects.toThrow('符号链接')
  })
})
