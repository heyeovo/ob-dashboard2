import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const mount = vi.hoisted(() => ({ root: '' }))
vi.mock('@/app/lib/artifactMeta', async original => ({
  ...await original<typeof import('@/app/lib/artifactMeta')>(),
  get YANZHI_FILES_ROOT() { return mount.root },
}))
import { appendThinkingProcess, enterRoom, leaveRoom, newTurnBucket, pushToolEvent, setTurnBucket, deleteTurnBucket } from '@/app/lib/cc/processCollector'
import { attachSend, detachSend, emit, recordCommand, recordFileChange, turnSnapshot } from '@/app/lib/ccChannel'
import { isPrivateRoomWrite, isRoomTool, roomFileList, sealRoomVisits } from '@/app/lib/cc/room'
import { buildCcOptions, type TurnConfig } from '@/app/lib/cc/ccOptions'
import { parseTurnRaw, turnsToMessages } from '@/app/cc/ccHistory'
import { DEFAULT_WEB_SETTINGS } from '@/app/cc/webSettings'
import { publicRoomTranscript } from '@/app/lib/cc/roomAudit'
import { safeSegments } from '@/app/lib/fileBrowser'

afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); if (mount.root) await rm(mount.root, { recursive: true, force: true }); mount.root = '' })

describe('房间边界', () => {
  it('浏览器文件接口屏蔽 .room 和 Haven 封存数据目录', () => {
    for (const name of ['.room/room_abc/x.html', 'state/darkroom/entries.jsonl', 'state/darkroom/rooms.json', 'state/darkroom/visits.jsonl']) {
      expect(safeSegments(name)).toBeNull()
    }
  })
  it('配置改名仍识别 room，不把未配置工具当房间', () => {
    expect(isRoomTool('mcp__renamed__room', { renamed: {} })).toBe(true)
    expect(isRoomTool('mcp__other__room', { renamed: {} })).toBe(false)
  })
  it('hook 与 files/command 既不发事件，也不留下工作台内容', () => {
    const bucket = newTurnBucket()
    setTurnBucket('room-hook', bucket)
    const send = vi.fn()
    attachSend('room-hook', send)
    enterRoom(bucket, { room_id: 'room_abc' })
    pushToolEvent('room-hook', { name: 'Write', id: 'w', input: { content: 'secret' } })
    emit('room-hook', 'files', { path: 'secret' })
    recordFileChange('room-hook', { path: 'secret', tool: 'Write', added: 1, removed: 0 })
    recordCommand('room-hook', { id: 'cmd', command: 'secret', output: 'secret', failed: false })
    expect(send).not.toHaveBeenCalled()
    expect(turnSnapshot('room-hook').files).toEqual([])
    expect(turnSnapshot('room-hook').commands).toEqual([])
    expect(bucket.processEvents).toEqual([])
    expect(bucket.room.process).toHaveLength(1)
    deleteTurnBucket('room-hook', bucket); detachSend('room-hook', send)
  })
  it('房间中需批准的操作直接拒绝，.room 写入允许且不生成批准卡', async () => {
    mount.root = await mkdtemp(path.join(tmpdir(), 'room-perm-'))
    const bucket = newTurnBucket()
    setTurnBucket('room-perm', bucket)
    enterRoom(bucket, { room_id: 'room_abc' })
    const options = buildCcOptions({ sessionId: 'room-perm', mode: 'work', cwd: mount.root,
      personaAppend: '', systemPromptKey: '', modelSurfaceKey: '', mcpDefinitionKey: '', contextRevision: 0,
      sdkMcpServers: {}, builtInMcpStates: {}, additionalDirectories: [], sdkModel: '', model: '', cred: 'api',
      laneId: '', providerId: '', providerLabel: '', effort: '', thinking: false, disabledTools: [], permanentAllowRules: [],
      envOverrides: {}, webSettings: DEFAULT_WEB_SETTINGS } as TurnConfig, null)
    const meta = { requestId: 'p', signal: new AbortController().signal } as Parameters<NonNullable<typeof options.canUseTool>>[2]
    expect(await options.canUseTool!('Bash', { command: 'echo secret' }, meta)).toMatchObject({ behavior: 'deny', message: '在房间里，需要小羊批准的操作出门再做' })
    const file = path.join(mount.root, '.room', 'room_abc', 'x.html')
    expect(await options.canUseTool!('Write', { file_path: file, content: 'private' }, meta)).toMatchObject({ behavior: 'allow' })
    expect(await isPrivateRoomWrite('Write', { file_path: path.join(mount.root, 'elsewhere') }, mount.root)).toBe(false)
    expect(await isPrivateRoomWrite('Bash', { command: `mkdir -p "${path.dirname(file)}"` }, mount.root)).toBe(true)
    expect(await isPrivateRoomWrite('Bash', { command: `touch "${file}"; echo leaked` }, mount.root)).toBe(false)
    expect(await isPrivateRoomWrite('Bash', { command: `printf '%s' 'private' > "${file}"` }, mount.root)).toBe(true)
    expect(await isPrivateRoomWrite('Bash', { command: `cat > "${file}" <<'EOF'\nsecret $(command)\nEOF` }, mount.root)).toBe(true)
    expect(await isPrivateRoomWrite('Bash', { command: `cat > "${file}" <<'EOF'\nEOF\necho leaked\nEOF` }, mount.root)).toBe(false)
    deleteTurnBucket('room-perm', bucket)
  })
  it('成功封存先于历史写库，失败只标记门牌；相同来访不重复提交', async () => {
    vi.stubEnv('HAVEN_GATEWAY_URL', 'http://localhost:18001')
    vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'token')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const bucket = newTurnBucket()
    enterRoom(bucket, { room_id: 'room_abc' }); appendThinkingProcess(bucket, 'sealed secret')
    leaveRoom(bucket, 's', 'r', 'chat')
    await sealRoomVisits(bucket)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).process[0].text).toBe('sealed secret')
    expect(bucket.processEvents[0].sealed).toBe(true)
    expect(JSON.stringify(bucket.processEvents)).not.toContain('sealed secret')
    await sealRoomVisits(bucket)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('历史回读保留空正文的房间门牌和 sealed 标记', () => {
    const raw = { process: [{ type: 'room', id: 'v', roomId: 'room_abc', roomTitle: '礼物', enteredAt: 1, leftAt: 2, durationMs: 1, sealed: false }] }
    expect(parseTurnRaw(JSON.stringify(raw)).process[0]).toMatchObject({ type: 'room', sealed: false })
    const messages = turnsToMessages([{ id: 1, session_id: 's', round_id: 1, created_at: '2026-10-02', user_text: '', assistant_text: '', source: 'cc', client: 'ob2-chat/ombre', raw_json: JSON.stringify(raw), turn_kind: 'agent_wake' }] as Parameters<typeof turnsToMessages>[0])
    expect(messages.find(m => m.role === 'assistant')?.process?.[0].type).toBe('room')
  })
  it('打开时列文件，拒绝不合法 room id', async () => {
    mount.root = await mkdtemp(path.join(tmpdir(), 'room-files-'))
    await mkdir(path.join(mount.root, '.room', 'room_abc'), { recursive: true })
    await writeFile(path.join(mount.root, '.room', 'room_abc', 'x.html'), 'private')
    expect(await roomFileList('room_abc')).toContain('x.html · 7 字节')
    expect(await roomFileList('../escape')).toBe('')
  })
  it('上下文核对封存原生 transcript 的房间内容，但不改原数据', () => {
    const entries = [
      { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret-before' }, { type: 'tool_use', id: 'enter', name: 'mcp__ob__room', input: { action: 'enter' } }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'enter', content: 'secret-note' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'secret-body' }, { type: 'tool_use', id: 'leave', name: 'mcp__ob__room', input: { action: 'leave', note: 'secret-note' } }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'leave', content: 'secret-result' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: '我回来了' }] } },
    ]
    const original = JSON.stringify(entries)
    const result = publicRoomTranscript(entries)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).toContain('我回来了')
    expect(JSON.stringify(entries)).toBe(original)
  })
})
