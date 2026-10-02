import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
const mount = vi.hoisted(() => ({ root: '' }))
vi.mock('@/app/lib/artifactMeta', async original => ({ ...await original<typeof import('@/app/lib/artifactMeta')>(), get YANZHI_FILES_ROOT() { return mount.root } }))
import { roomHasNewVisit, roomVisitHref, parseRoomReveal, type Room } from '@/app/lib/roomTypes'
import { ROOM_DOOR_TITLE, redactRoomDoors, redactRoomDoorsDeep } from '@/app/lib/roomPrivacy'
import { loadRoomDoors, roomFilePath } from '@/app/lib/roomServer'
import { buildRollingWindowAppend, loadRollingWindowAppend } from '@/app/lib/cc/windowPrompt'
import { GET as detail } from '@/app/api/rooms/[id]/route'
import { GET as fileList } from '@/app/api/rooms/[id]/files/route'
import { GET as readFile } from '@/app/api/rooms/[id]/files/[...path]/route'
import { GET as roomList } from '@/app/api/rooms/route'
import { GET as visitList } from '@/app/api/rooms/visits/route'
import { proxy } from '@/proxy'
import HomeRoomEntrance from '@/app/components/HomeRoomEntrance'
import HomePage from '@/app/page'
import CcMessageRow from '@/app/cc/CcMessageRow'
import RoomRevealCard from '@/app/components/RoomRevealCard'
import RoomDoor from '@/app/components/RoomDoor'

const door = (extra: Partial<Room> = {}): Room => ({ id: 'room_abc', title: '礼物', status: 'closed', lock_until: '', created_at: '', opened_at: '', last_visit: '2026-10-02T12:00:00Z', visit_count: 1, total_duration_ms: 60000, ...extra })
const tool = { id: 'open', name: 'mcp__renamed__room', input: { action: 'open' }, startedAt: 1000, result: JSON.stringify({ result: '房间已打开 [room_abc] 半年\n#1\n正文\n\n房间文件：\ngift.html · 68 字节' }) }
function env() { vi.stubEnv('HAVEN_GATEWAY_URL', 'https://haven.example'); vi.stubEnv('OMBRE_GATEWAY_TOKEN', 'test-token') }
function upstream(body: unknown) { env(); return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(body)) }
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); if (mount.root) await rm(mount.root, { recursive: true, force: true }); mount.root = '' })

describe('room B presentation', () => {
  it('Clawd is present when there is no anniversary card', () => {
    const home = renderToStaticMarkup(createElement(HomePage))
    expect(home).toContain('aria-label="言之的房间"')
    expect(home).toContain('/home/clawd.webp')
    expect(home).not.toContain('aria-label="下一个纪念日"')
    expect(renderToStaticMarkup(createElement(HomeRoomEntrance, { onCard: false }))).toContain('href="/room"')
  })
  it('only a newer closed visit lights the local dot', () => {
    expect(roomHasNewVisit([door()], '2026-10-02T11:00:00Z')).toBe(true)
    expect(roomHasNewVisit([door()], '2026-10-02T12:00:00Z')).toBe(false)
    expect(roomHasNewVisit([door({ status: 'opened' })], null)).toBe(false)
    expect(roomHasNewVisit([door()], null)).toBe(true)
  })
  it('door geometry has panels, handle and locked/open states', () => {
    expect(renderToStaticMarkup(createElement(RoomDoor, { kind: 'locked' }))).toContain('translate(43 60)')
    expect(renderToStaticMarkup(createElement(RoomDoor, { kind: 'open' }))).toContain('room-door-svg')
  })
  it('unwraps historic JSON open results and refuses denied or other tools', () => {
    expect(parseRoomReveal(tool)).toMatchObject({ id: 'room_abc', title: '半年', body: '#1\n正文', files: ['gift.html · 68 字节'] })
    expect(parseRoomReveal({ ...tool, result: '房间未打开：锁没到' })).toBeNull()
    expect(parseRoomReveal({ ...tool, input: { action: 'read' } })).toBeNull()
  })
  it('places successful open in the process position outside Tools and disables historic animation', () => {
    const html = renderToStaticMarkup(createElement(CcMessageRow, { message: { id: 'm', role: 'assistant', text: '', createdAt: 1000, fromHistory: true, process: [{ type: 'tool', id: 't', tool }] }, isCurrentTurn: false, onCopy: () => {} }))
    expect(html).toContain('房间打开了'); expect(html).not.toContain('Tools ·'); expect(html).not.toContain('room-reveal-live')
    expect(renderToStaticMarkup(createElement(RoomRevealCard, { tool, live: true }))).toContain('room-reveal-live')
  })
  it('links completed door lines and keeps an active door inert', () => {
    const render = (leftAt?: number) => renderToStaticMarkup(createElement(CcMessageRow, { message: { id: 'm', role: 'assistant', text: '', createdAt: 1000, process: [{ type: 'room', id: 'v', roomId: 'room_abc', roomTitle: '', enteredAt: 0, leftAt }] }, isCurrentTurn: false, onCopy: () => {} }))
    expect(render(1000)).toContain('href="/room/room_abc#visit-v"')
    expect(render()).not.toContain('href="/room/')
    expect(roomVisitHref('', 'v')).toBe('/room#visit-v')
  })
})
describe('room B server boundaries', () => {
  it('all browser room routes require login through the proxy', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('DASHBOARD_LOGIN_SECRET', 'room-test-passphrase'); vi.stubEnv('DASHBOARD_SESSION_SECRET', 'test-session-secret-with-at-least-32-bytes')
    for (const url of ['/api/rooms', '/api/rooms/visits', '/api/rooms/room_abc', '/api/rooms/room_abc/files', '/api/rooms/room_abc/files/a.html']) expect(proxy(new NextRequest(`https://dashboard.example${url}`)).status).toBe(401)
  })
  it('defensively strips note fields from details without dropping opened process', async () => {
    upstream({ ...door({ status: 'opened' }), note: 'private', visits: [{ process: [{ tool: { input: { note: 'private' }, result: 'public' } }] }] })
    const result = await detail(new Request('https://dashboard.example'), { params: Promise.resolve({ id: 'room_abc' }) })
    const text = await result.text(); expect(text).not.toContain('private'); expect(text).toContain('public')
  })
  it('does not forward arbitrary paths or POST/private snapshot routes', async () => {
    const fetch = upstream({ rooms: [] })
    expect((await detail(new Request('https://dashboard.example'), { params: Promise.resolve({ id: 'door-snapshot' }) })).status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
    await roomList(); await visitList(new Request('https://dashboard.example?limit=999&key=private'))
    expect(String(fetch.mock.calls[1][0])).toBe('https://haven.example/api/rooms/visits?limit=100')
  })
  it('closed rooms return 404 before listing or reading any file', async () => {
    upstream(door())
    expect((await fileList(new Request('https://dashboard.example'), { params: Promise.resolve({ id: 'room_abc' }) })).status).toBe(404)
    expect((await readFile(new Request('https://dashboard.example'), { params: Promise.resolve({ id: 'room_abc', path: ['gift.html'] }) })).status).toBe(404)
  })
  it('opened files are listed and served sandboxed; traversal and dot files are rejected', async () => {
    mount.root = await mkdtemp(path.join(tmpdir(), 'room-b-'))
    await mkdir(path.join(mount.root, '.room', 'room_abc'), { recursive: true })
    await writeFile(path.join(mount.root, '.room', 'room_abc', 'gift.html'), '<h1>gift</h1>')
    upstream(door({ status: 'opened' }))
    const listing = await fileList(new Request('https://dashboard.example'), { params: Promise.resolve({ id: 'room_abc' }) })
    expect((await listing.json()).files).toHaveLength(1)
    const response = await readFile(new Request('https://dashboard.example?raw=1'), { params: Promise.resolve({ id: 'room_abc', path: ['gift.html'] }) })
    expect(await response.text()).toContain('gift'); expect(response.headers.get('Content-Security-Policy')).toBe('sandbox')
    expect(await roomFilePath('room_abc', '../gift.html')).toBeNull()
    expect(await roomFilePath('room_abc', '.secret')).toBeNull()
  })
  it('rejects symbolic links in the room file path', async () => {
    mount.root = await mkdtemp(path.join(tmpdir(), 'room-b-link-'))
    const base = path.join(mount.root, '.room', 'room_abc')
    await mkdir(base, { recursive: true }); await writeFile(path.join(mount.root, 'outside.txt'), 'secret')
    await symlink(path.join(mount.root, 'outside.txt'), path.join(base, 'innocent.txt'))
    expect(await roomFilePath('room_abc', 'innocent.txt')).toBeNull()
  })
  it('uses revision:chat_day snapshot keys, omits title-only and upstream failure', async () => {
    const fetch = upstream({ content: `${ROOM_DOOR_TITLE}\n[room_abc] 私密便条` })
    expect(await loadRoomDoors('session', 7, '2026-10-02')).toContain('私密便条')
    expect(String(fetch.mock.calls[0][0])).toContain('key=7%3A2026-10-02')
    fetch.mockResolvedValueOnce(Response.json({ content: ROOM_DOOR_TITLE }))
    expect(await loadRoomDoors('session', 7, '2026-10-02')).toBe('')
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await loadRoomDoors('session', 7, '2026-10-02')).toBe('')
  })
  it('appends doors after reviews only in rolling windows', () => {
    const doors = `${ROOM_DOOR_TITLE}\n私密便条`
    const session = { rolling_context: { strategy: 'daily_rolling', day_modes: { '2026-10-01': 'review' } }, context_revision: 1 } as never
    const content = buildRollingWindowAppend(session, [], [{ day: '2026-10-01', review: { content: '日回顾正文' } }] as never, [], [], [], [], [], doors)
    expect(content.indexOf('日回顾正文')).toBeLessThan(content.indexOf(ROOM_DOOR_TITLE))
    expect(buildRollingWindowAppend({} as never, [], [], [], [], [], [], [], doors)).toBe('')
  })
  it('does not request door snapshots in fixed windows', async () => {
    const fetch = upstream({ content: 'should not load' })
    expect((await loadRollingWindowAppend('fixed', {} as never, [])).content).toBe('')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('redacts the entire last snapshot section, preserves the fixed module and seals nested browser surfaces', () => {
    const text = `【我的房间】\n固定说明\n<rolling_window_context>\n回顾\n${ROOM_DOOR_TITLE}\n[room_abc] 私密\n便条\n\n</rolling_window_context>\n公共尾段`
    const redacted = redactRoomDoors(text)
    expect(redacted).toContain('固定说明'); expect(redacted).toContain('公共尾段'); expect(redacted).not.toContain('私密'); expect(redacted).not.toContain('便条')
    expect(redactRoomDoorsDeep({ current: text, latest: { append: text }, snippets: [text] })).toEqual({ current: redacted, latest: { append: redacted }, snippets: [redacted] })
  })
})
