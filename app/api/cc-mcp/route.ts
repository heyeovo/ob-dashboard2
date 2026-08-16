import { NextRequest } from 'next/server'
import {
  loadMcpConfig,
  publicMcpConfig,
  saveMcpConfig,
} from '@/app/lib/ccMcp'
import { discoverMcpServer } from '@/app/lib/ccMcpDiscovery'
import { applyMcpServersToLiveSessions } from '@/app/lib/ccSession'
import type { CcMcpConfig, CcMcpServerStatus } from '@/app/lib/ccMcpTypes'
import { redactHavenSecrets } from '@/app/lib/havenConfig'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = await loadMcpConfig()
    return Response.json({ ok: true, config: publicMcpConfig(config) })
  } catch (error) {
    return Response.json(
      { ok: false, error: redactHavenSecrets((error as Error).message || String(error)) },
      { status: 503 },
    )
  }
}

async function refreshCatalog(
  config: CcMcpConfig,
  names: string[],
): Promise<{ config: CcMcpConfig; servers: CcMcpServerStatus[] }> {
  const wanted = new Set(names)
  const targets = config.servers.filter(server => wanted.has(server.name))
  const statuses = await Promise.all(targets.map(discoverMcpServer))
  const byName = new Map(statuses.map(status => [status.name, status]))
  const syncedAt = new Date().toISOString()
  const next: CcMcpConfig = {
    version: 1,
    servers: config.servers.map(server => {
      const status = byName.get(server.name)
      if (!status || status.status !== 'connected') return server
      return { ...server, tools: status.tools, lastSyncedAt: syncedAt }
    }),
  }
  return { config: await saveMcpConfig(next), servers: statuses }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    let config = await saveMcpConfig({
      version: 1,
      servers: Array.isArray(body.servers) ? body.servers : [],
    })
    const discover = Array.isArray(body.discover)
      ? body.discover.map(String).filter(name => config.servers.some(server => server.name === name))
      : []
    let status: { servers: CcMcpServerStatus[] } | undefined
    if (discover.length) {
      const refreshed = await refreshCatalog(config, discover)
      config = refreshed.config
      status = { servers: refreshed.servers }
    }
    const apply = await applyMcpServersToLiveSessions()
    return Response.json({ ok: true, config: publicMcpConfig(config), apply, status })
  } catch (error) {
    return Response.json(
      { ok: false, error: redactHavenSecrets((error as Error).message || String(error)) },
      { status: 400 },
    )
  }
}

export async function POST() {
  try {
    const current = await loadMcpConfig()
    const names = current.servers.filter(server => server.enabled).map(server => server.name)
    const refreshed = await refreshCatalog(current, names)
    const apply = await applyMcpServersToLiveSessions()
    return Response.json({
      ok: true,
      config: publicMcpConfig(refreshed.config),
      status: { servers: refreshed.servers },
      apply,
    })
  } catch (error) {
    return Response.json(
      { ok: false, error: redactHavenSecrets((error as Error).message || String(error)) },
      { status: 500 },
    )
  }
}
