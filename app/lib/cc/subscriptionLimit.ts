const CLAUDE_SESSION_LIMIT_NOTICE = /^you(?:'|’)ve hit your session limit\s*[·•-]\s*resets\s+.+\s+\(utc\)$/i

/** Claude CLI/SDK quota status shown to the user; it is not model-authored dialogue. */
export function isClaudeSessionLimitNotice(value: unknown): boolean {
  return CLAUDE_SESSION_LIMIT_NOTICE.test(String(value || '').trim())
}
