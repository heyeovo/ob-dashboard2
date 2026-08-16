import 'server-only'

const DEVELOPMENT_HAVEN_BASE_URL = 'https://foryan.zeabur.app'

type HavenEnvironment = NodeJS.ProcessEnv

export class HavenConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HavenConfigurationError'
  }
}

export function isProductionEnvironment(env: HavenEnvironment = process.env): boolean {
  return env.NODE_ENV === 'production'
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.')
  )
}

function parseHttpUrl(value: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new HavenConfigurationError(`${label} 不是有效 URL`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HavenConfigurationError(`${label} 只接受 http/https URL`)
  }
  if (parsed.username || parsed.password) {
    throw new HavenConfigurationError(`${label} 不得在 URL 中携带账号或密码`)
  }
  if (parsed.search || parsed.hash) {
    throw new HavenConfigurationError(`${label} 不得携带 query 或 hash`)
  }
  return parsed
}

export function normalizeHavenBaseUrl(
  value: string,
  env: HavenEnvironment = process.env,
): string {
  const parsed = parseHttpUrl(value.trim(), 'HAVEN_GATEWAY_URL')
  if (isProductionEnvironment(env) && isLoopbackHostname(parsed.hostname)) {
    throw new HavenConfigurationError('production 的 HAVEN_GATEWAY_URL 不得指向 localhost 或 loopback 地址')
  }
  return parsed.toString().replace(/\/+$/, '')
}

export function getHavenBaseUrl(env: HavenEnvironment = process.env): string {
  const configured = isProductionEnvironment(env)
    ? env.HAVEN_GATEWAY_URL
    : env.HAVEN_GATEWAY_URL || env.OMBRE_BASE_URL || env.NEXT_PUBLIC_OMBRE_BASE_URL || DEVELOPMENT_HAVEN_BASE_URL

  if (!configured?.trim()) {
    throw new HavenConfigurationError('production 缺少 HAVEN_GATEWAY_URL，Haven 连接已禁用')
  }
  return normalizeHavenBaseUrl(configured, env)
}

export function getHavenSessionPassword(env: HavenEnvironment = process.env): string {
  const password = isProductionEnvironment(env)
    ? env.OMBRE_SESSION
    : env.OMBRE_SESSION || env.NEXT_PUBLIC_OMBRE_SESSION
  if (!password) {
    throw new HavenConfigurationError('缺少 OMBRE_SESSION，Haven Brain 连接已禁用')
  }
  return password
}

export function getHavenGatewayToken(env: HavenEnvironment = process.env): string {
  const token = env.OMBRE_GATEWAY_TOKEN
  if (!token) {
    throw new HavenConfigurationError('缺少 OMBRE_GATEWAY_TOKEN，Haven Gateway 连接已禁用')
  }
  return token
}

export function getHavenGatewayConnection(env: HavenEnvironment = process.env): {
  baseUrl: string
  token: string
} {
  return {
    baseUrl: getHavenBaseUrl(env),
    token: getHavenGatewayToken(env),
  }
}

export function joinHavenUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`
}

export function redactHavenSecrets(
  message: string,
  env: HavenEnvironment = process.env,
): string {
  let redacted = message
  const secrets = [
    env.OMBRE_GATEWAY_TOKEN,
    env.OMBRE_SESSION,
    env.NEXT_PUBLIC_OMBRE_SESSION,
  ].filter((value): value is string => Boolean(value))
  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, '[REDACTED]')
  }
  return redacted
}

export function assertProductionMcpUrl(
  value: string,
  env: HavenEnvironment = process.env,
): void {
  if (!isProductionEnvironment(env)) return
  const parsed = parseHttpUrl(value.trim(), 'MCP URL')
  if (isLoopbackHostname(parsed.hostname)) {
    throw new HavenConfigurationError('production 的 MCP URL 不得指向 localhost 或 loopback 地址')
  }
}
