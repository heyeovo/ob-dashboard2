// 隔离测试：绕开 Next.js，直接用 Agent SDK 起子进程。
// 用途是判断 3221226505 是 Next/Turbopack 环境导致的，还是 SDK 本身。
import { query } from '@anthropic-ai/claude-agent-sdk'

const env = { ...process.env }
for (const k of Object.keys(env)) {
  if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' ||
      k === 'CLAUDE_AGENT_SDK_VERSION' ||
      k.startsWith('CLAUDE_CODE_') || k.startsWith('OTEL_')) delete env[k]
}

console.log('base_url:', env.ANTHROPIC_BASE_URL ?? '(none)')
console.log('model:', env.ANTHROPIC_MODEL ?? '(none)')

const q = query({
  prompt: '只回复两个字：收到',
  options: {
    model: env.ANTHROPIC_MODEL || undefined,
    cwd: process.cwd(),
    maxTurns: 1,
    allowedTools: [],
    permissionMode: 'dontAsk',
    settingSources: [],
    env,
    stderr: (d) => process.stderr.write('[stderr] ' + d),
  },
})

try {
  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log('INIT', msg.claude_code_version, '| model:', msg.model, '| apiKeySource:', msg.apiKeySource)
      try {
        const u = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
        console.log('subscription_type:', u.subscription_type, '| rate_limits_available:', u.rate_limits_available)
      } catch (e) { console.log('usage probe failed:', String(e)) }
    }
    if (msg.type === 'assistant') {
      for (const b of msg.message.content) if (b.type === 'text') console.log('TEXT:', b.text)
    }
    if (msg.type === 'result') {
      console.log('RESULT', msg.subtype, '| turns:', msg.num_turns, '| cost:', msg.total_cost_usd)
    }
  }
  console.log('DONE ok')
} catch (e) {
  console.log('FAILED:', e.message)
  process.exitCode = 1
}
