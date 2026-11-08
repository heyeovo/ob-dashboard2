import type { CcMcpConfig } from './ccMcpTypes'

function windowOverride(overrides: Record<string, boolean>, name: string): boolean | undefined {
  return Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : undefined
}

export function effectiveMcp(globalEnabled: boolean, defaultInWindows = true, override?: boolean): boolean {
  return globalEnabled && (override ?? defaultInWindows)
}

/** Keep the old config (including order) intact when the window follows enabled defaults. */
export function windowMcpConfig(config: CcMcpConfig, overrides: Record<string, boolean> = {}): CcMcpConfig {
  const servers = config.servers.map(server => ({
    ...server,
    enabled: effectiveMcp(server.enabled, server.defaultInWindows, windowOverride(overrides, server.name)),
  }))
  const builtIns = { ...config.builtIns }
  for (const name of new Set([...Object.keys(config.builtInDefaults || {}), ...Object.keys(overrides)])) {
    if (name === 'ombre_agent_wake' || servers.some(server => server.name === name)) continue
    builtIns[name] = effectiveMcp(config.builtIns?.[name] !== false, config.builtInDefaults?.[name], windowOverride(overrides, name))
  }
  return { ...config, servers, builtIns }
}

export function windowMcpToolDisabled(toolName: string, config: CcMcpConfig, overrides: Record<string, boolean> = {}): boolean {
  if (!toolName.startsWith('mcp__')) return false
  const name = toolName.slice(5).split('__')[0]
  if (name === 'ombre_agent_wake') return config.builtIns?.[name] === false
  const server = config.servers.find(server => server.name === name)
  return !effectiveMcp(server ? server.enabled : config.builtIns?.[name] !== false,
    server ? server.defaultInWindows : config.builtInDefaults?.[name], windowOverride(overrides, name))
}
