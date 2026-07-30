// claude code 子进程的环境变量构造。
//
// 额度维度（订阅 / API 中转站）只体现在这里的几个变量上，引擎代码本身不变：
//   subscription → 删掉 ANTHROPIC_*，让子进程用本机 claude 的登录态
//   api          → 显式设 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
//
// ⚠️ SDK 的 env 选项设了就**完全替换**子进程环境，必须先 spread process.env。

export type CredMode = 'api' | 'subscription'

// dev server 若是从某个 claude code 会话里启动的，process.env 会带父会话标记。
// 原样传下去会让子进程误认归属、上报遥测失败（一堆 403）。
const PARENT_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AGENT_SDK_VERSION',
]
const PARENT_SESSION_PREFIXES = ['CLAUDE_CODE_', 'OTEL_']

export function buildCcEnv(
  mode: CredMode,
  overrides: { baseUrl?: string; authToken?: string; mainModel?: string } = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }

  for (const key of Object.keys(env)) {
    if (PARENT_SESSION_VARS.includes(key)) delete env[key]
    else if (PARENT_SESSION_PREFIXES.some((p) => key.startsWith(p))) delete env[key]
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'ob-dashboard2/0.1.0'

  if (mode === 'subscription') {
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_API_KEY
  } else {
    const baseUrl = overrides.baseUrl || process.env.ANTHROPIC_BASE_URL
    const authToken = overrides.authToken || process.env.ANTHROPIC_AUTH_TOKEN
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken
  }

  // 辅助调用和 Claude Code 内部的 family alias 都跟随当次主模型。
  // 不能继承 .env.local 里的固定 Sonnet，否则换中转 / 换模型后辅助请求仍会跑旧模型。
  const mainModel = overrides.mainModel?.trim()
  delete env.ANTHROPIC_SMALL_FAST_MODEL
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL
  delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  if (mainModel) {
    env.ANTHROPIC_SMALL_FAST_MODEL = mainModel
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = mainModel
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = mainModel
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mainModel
  }

  return env
}
