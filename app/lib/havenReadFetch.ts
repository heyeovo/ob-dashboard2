const READ_RETRY_DELAY_MS = 250

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

async function waitForRetry(signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw abortError()

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, READ_RETRY_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

/**
 * Haven 的只读 GET 遇到连接级异常时短暂重试一次。
 * HTTP 错误会正常返回 Response；写入请求和主动取消永不重试。
 */
export async function fetchHavenWithReadRetry(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    const method = String(init.method || 'GET').toUpperCase()
    if (method !== 'GET' || init.signal?.aborted) throw error
    await waitForRetry(init.signal)
    return fetch(input, init)
  }
}

/** 保留 Node fetch/undici 的 cause，避免日志里只剩一句 `fetch failed`。 */
export function describeFetchError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error

  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const record = current as { message?: unknown; code?: unknown; cause?: unknown }
    const message = typeof record.message === 'string' ? record.message.trim() : ''
    const code = typeof record.code === 'string' ? record.code.trim() : ''
    const detail = code && message ? `${code}: ${message}` : code || message
    if (detail && !parts.includes(detail)) parts.push(detail)
    current = record.cause
  }

  return parts.join(' <- ') || String(error)
}
