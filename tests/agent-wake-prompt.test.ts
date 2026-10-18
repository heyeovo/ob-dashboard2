import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../app/lib/havenConfig', () => ({
  getHavenGatewayConnection: () => ({ baseUrl: 'https://haven.test', token: 'secret' }),
  joinHavenUrl: (base: string, path: string) => base + path,
}))
import { DEFAULT_AGENT_WAKE_INSTRUCTIONS, DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION, getAgentWakePromptConfig, getAgentWakeToolDescription, refreshAgentWakePromptConfig, saveAgentWakePromptConfig, resetAgentWakePromptConfig } from '../app/lib/cc/agentWakePrompt'
const defaults = `${DEFAULT_AGENT_WAKE_INSTRUCTIONS}\n\n${DEFAULT_AGENT_WAKE_TOOL_DESCRIPTION}`
const custom = { instructions: '醒来说明', tool_description: '工具说明', updated_at: '2026-10-18' }
afterEach(() => vi.unstubAllGlobals())
describe('Haven wake prompt', () => {
  it('keeps the exact default model description without customization', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ config: null }))
    vi.stubGlobal('fetch', fetch)
    expect((await getAgentWakePromptConfig()).customized).toBe(false)
    expect(getAgentWakeToolDescription()).toBe(defaults)
    expect(fetch).toHaveBeenCalledWith('https://haven.test/gateway/api/cc/agent-wake-prompt', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }))
  })
  it('loads custom instructions and keeps the last good read on HTTP or network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ config: custom })).mockResolvedValueOnce(new Response('', { status: 503 })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ config: null })))
    await refreshAgentWakePromptConfig()
    expect(getAgentWakeToolDescription()).toBe('醒来说明\n\n工具说明')
    await refreshAgentWakePromptConfig()
    expect(getAgentWakeToolDescription()).toBe('醒来说明\n\n工具说明')
    await refreshAgentWakePromptConfig()
    expect(getAgentWakeToolDescription()).toBe('醒来说明\n\n工具说明')
    await refreshAgentWakePromptConfig()
    expect(getAgentWakeToolDescription()).toBe(defaults)
  })
  it('invalidates after save, reloads Haven, and resets to empty', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ config: custom })).mockResolvedValueOnce(Response.json({ config: custom })).mockResolvedValueOnce(Response.json({ config: null })).mockResolvedValueOnce(Response.json({ config: null }))
    vi.stubGlobal('fetch', fetch)
    expect(await saveAgentWakePromptConfig(custom.instructions, custom.tool_description)).toEqual(custom)
    expect(getAgentWakeToolDescription()).toBe(defaults)
    expect((await getAgentWakePromptConfig()).customized).toBe(true)
    expect(getAgentWakeToolDescription()).toBe('醒来说明\n\n工具说明')
    await resetAgentWakePromptConfig()
    expect((await getAgentWakePromptConfig()).customized).toBe(false)
    expect(fetch.mock.calls.map(call => call[1].method)).toEqual(['PUT', 'GET', 'DELETE', 'GET'])
  })
})
