// claude code 子进程的环境变量构造。
//
// 额度维度（订阅 / API 中转站）只体现在这里的几个变量上，引擎代码本身不变：
//   subscription → 不传任何 ANTHROPIC_*，让子进程用本机 claude 的登录态
//   api          → 显式设 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
//
// ⚠️ SDK 的 env 选项设了就**完全替换**子进程环境。这里故意从空对象开始，
// 只传 Claude Code 实际运行需要的系统变量，不能把 Dashboard 的 secret 整包继承下去。

export type CredMode = 'api' | 'subscription'

/** Linux production 与本机开发都需要的非密钥运行环境。 */
const BASE_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'CLAUDE_CONFIG_DIR',
] as const

/**
 * Windows 本机 `npm run dev` 兼容项。
 *
 * Claude 原生可执行文件虽然由 SDK 用绝对路径启动，但其后的 Git、shell、临时目录、
 * 用户配置与 Windows 系统工具仍依赖这些标准路径变量。这里只允许路径/身份信息，
 * 不允许 Git credential、SSH agent、云平台或代理认证变量。
 */
const WINDOWS_ENV_VARS = [
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'USERNAME',
] as const

function copyIfPresent(
  target: Record<string, string | undefined>,
  source: NodeJS.ProcessEnv,
  key: string,
): void {
  const value = source[key]
  if (typeof value === 'string') target[key] = value
}

export function buildCcEnv(
  mode: CredMode,
  overrides: { baseUrl?: string; authToken?: string; mainModel?: string } = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const key of BASE_ENV_VARS) copyIfPresent(env, process.env, key)
  if (process.platform === 'win32') {
    for (const key of WINDOWS_ENV_VARS) copyIfPresent(env, process.env, key)
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'ob-dashboard2/0.1.0'

  if (mode === 'api') {
    const baseUrl = overrides.baseUrl || process.env.ANTHROPIC_BASE_URL
    const authToken = overrides.authToken || process.env.ANTHROPIC_AUTH_TOKEN
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken

    // API 中转站的辅助调用和 Claude Code family alias 都跟随当次主模型。
    // subscription 走官方登录态和 CLI model 参数，不需要、也不得继承这些 ANTHROPIC_*。
    const mainModel = overrides.mainModel?.trim()
    if (mainModel) {
      env.ANTHROPIC_SMALL_FAST_MODEL = mainModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = mainModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = mainModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mainModel
    }
  }

  return env
}
