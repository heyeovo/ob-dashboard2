export const DEPLOY_RETRY_MS = 12 * 60_000
export const DEPLOY_RETRY_NOTE = '正在切换到新版本，稍后自动重发'
export class DeploymentRetryTimeout extends Error {
  constructor() { super('版本切换等待超时，点重试核对或重新发送。') }
}

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Reuse the exact serialized body, including request ID and optimistic watermark. */
export async function fetchWithDeploymentRetry(
  endpoint: string, init: RequestInit, onRetry: (startedAt: number) => void,
  startedAt?: number,
): Promise<Response> {
  let retryStartedAt = startedAt
  for (;;) {
    if (retryStartedAt !== undefined && Date.now() - retryStartedAt >= DEPLOY_RETRY_MS) throw new DeploymentRetryTimeout()
    const deadline = retryStartedAt === undefined ? undefined
      : AbortSignal.timeout(Math.max(1, DEPLOY_RETRY_MS - (Date.now() - retryStartedAt)))
    const signal = deadline ? AbortSignal.any(init.signal ? [init.signal, deadline] : [deadline]) : init.signal
    let response: Response
    try { response = await fetch(endpoint, { ...init, signal }) }
    catch (error) {
      if (deadline?.aborted && !init.signal?.aborted) throw new DeploymentRetryTimeout()
      throw error
    }
    const failure = response.status === 503 || response.status === 409
      ? await response.clone().json().catch(() => ({})) : {}
    const retryable = (response.status === 503 && failure.error === 'server_draining')
      || (response.status === 409 && failure.error === 'previous_instance_finishing')
    if (!retryable) return response
    retryStartedAt ??= Date.now()
    onRetry(retryStartedAt)
    const remaining = DEPLOY_RETRY_MS - (Date.now() - retryStartedAt)
    if (remaining <= 0) throw new DeploymentRetryTimeout()
    const delay = Number(failure.retry_after_ms)
    await wait(Math.min(remaining, Number.isFinite(delay) && delay > 0 ? delay : 3000), init.signal)
  }
}

export function detachedWaitExpired(detachedAt: number, now = Date.now()) {
  return now - detachedAt >= DEPLOY_RETRY_MS
}
