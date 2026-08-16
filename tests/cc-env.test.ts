import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCcEnv } from '@/app/lib/ccEnv'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Claude Code 子进程环境 allowlist', () => {
  it('只复制明确允许的基础运行变量', () => {
    vi.stubEnv('PATH', 'allowed-path')
    vi.stubEnv('HOME', 'allowed-home')
    vi.stubEnv('LANG', 'zh_CN.UTF-8')
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'allowed-claude-config')
    vi.stubEnv('UNLISTED_NON_SECRET', 'must-not-pass')
    vi.stubEnv('PATH_TO_SECRET', 'must-not-pass')
    vi.stubEnv('HOME_SECRET', 'must-not-pass')
    vi.stubEnv('CLAUDE_CONFIG_DIR_BACKUP', 'must-not-pass')

    const env = buildCcEnv('subscription')

    expect(env).toMatchObject({
      PATH: 'allowed-path',
      HOME: 'allowed-home',
      LANG: 'zh_CN.UTF-8',
      CLAUDE_CONFIG_DIR: 'allowed-claude-config',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'ob-dashboard2/0.1.0',
    })
    expect(env.UNLISTED_NON_SECRET).toBeUndefined()
    expect(env.PATH_TO_SECRET).toBeUndefined()
    expect(env.HOME_SECRET).toBeUndefined()
    expect(env.CLAUDE_CONFIG_DIR_BACKUP).toBeUndefined()
  })

  it('只在 Windows 传递本机 Claude、Git 和命令启动所需的系统路径', () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe')
    vi.stubEnv('PATHEXT', '.COM;.EXE;.BAT;.CMD')
    vi.stubEnv('USERPROFILE', 'C:\\Users\\tester')
    vi.stubEnv('APPDATA', 'C:\\Users\\tester\\AppData\\Roaming')
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\tester\\AppData\\Local')
    vi.stubEnv('TEMP', 'C:\\Users\\tester\\AppData\\Local\\Temp')

    const env = buildCcEnv('subscription')

    if (process.platform === 'win32') {
      expect(env).toMatchObject({
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        USERPROFILE: 'C:\\Users\\tester',
        APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
        TEMP: 'C:\\Users\\tester\\AppData\\Local\\Temp',
      })
    } else {
      expect(env.SystemRoot).toBeUndefined()
      expect(env.ComSpec).toBeUndefined()
      expect(env.USERPROFILE).toBeUndefined()
    }
  })

  it('API 模式只增加本次选定的上游凭据和必要模型映射', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://fallback.example')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'fallback-token')
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-pass')
    vi.stubEnv('ANTHROPIC_MODEL', 'must-not-pass')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN_BACKUP', 'must-not-pass')

    const env = buildCcEnv('api', {
      baseUrl: 'https://selected.example',
      authToken: 'selected-token',
      mainModel: 'provider-opus-4-6',
    })

    expect(env.ANTHROPIC_BASE_URL).toBe('https://selected.example')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('selected-token')
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('provider-opus-4-6')
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('provider-opus-4-6')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('provider-opus-4-6')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('provider-opus-4-6')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN_BACKUP).toBeUndefined()
  })

  it('API 模式未提供覆盖时只读取既有本机 API fallback', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://fallback.example')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'fallback-token')

    const env = buildCcEnv('api')

    expect(env.ANTHROPIC_BASE_URL).toBe('https://fallback.example')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('fallback-token')
  })

  it('subscription 模式不传任何 ANTHROPIC 变量', () => {
    for (const key of [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_SMALL_FAST_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_FUTURE_CREDENTIAL',
    ]) {
      vi.stubEnv(key, 'must-not-pass')
    }

    const env = buildCcEnv('subscription', {
      baseUrl: 'https://must-not-pass.example',
      authToken: 'must-not-pass',
      mainModel: 'must-not-pass',
    })

    expect(Object.keys(env).filter(key => key.startsWith('ANTHROPIC_'))).toEqual([])
  })

  it('默认拒绝 Dashboard、Haven、数据库、部署、GitHub、云平台及其他模型 secret', () => {
    const forbidden = [
      'OB2_LAN_SECRET',
      'DASHBOARD_SESSION_SECRET',
      'OMBRE_SESSION',
      'OMBRE_GATEWAY_TOKEN',
      'HAVEN_ADMIN_PASSWORD',
      'DATABASE_URL',
      'DB_PASSWORD',
      'POSTGRES_PASSWORD',
      'REDIS_URL',
      'COOLIFY_TOKEN',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'GITLAB_TOKEN',
      'SSH_AUTH_SOCK',
      'SSH_PRIVATE_KEY_PATH',
      'AWS_SECRET_ACCESS_KEY',
      'AZURE_CLIENT_SECRET',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'MISTRAL_API_KEY',
      'DOCKER_HOST',
      'KUBECONFIG',
      'CLAUDECODE',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_AGENT_SDK_VERSION',
      'OTEL_EXPORTER_OTLP_HEADERS',
    ]
    for (const key of forbidden) vi.stubEnv(key, `secret:${key}`)

    const env = buildCcEnv('api', {
      baseUrl: 'https://selected.example',
      authToken: 'selected-token',
    })

    for (const key of forbidden) expect(env[key], key).toBeUndefined()
    expect(Object.values(env).some(value => value?.startsWith('secret:'))).toBe(false)
  })
})
