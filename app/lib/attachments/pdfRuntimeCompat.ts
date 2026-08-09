type PromiseResolvers<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type PromiseCompat = PromiseConstructor & {
  withResolvers?: <T>() => PromiseResolvers<T>
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<T>
}

type UrlCompat = typeof URL & {
  parse?: (url: string | URL, base?: string | URL) => URL | null
}

/** pdfjs 5 uses a few very new browser APIs. Keep its shims at this boundary. */
export function ensurePdfRuntimeCompat() {
  const promise = Promise as PromiseCompat
  if (typeof promise.withResolvers !== 'function') {
    Object.defineProperty(promise, 'withResolvers', {
      configurable: true,
      writable: true,
      value: function withResolvers<T>(): PromiseResolvers<T> {
        let resolve!: (value: T | PromiseLike<T>) => void
        let reject!: (reason?: unknown) => void
        const result = new Promise<T>((nextResolve, nextReject) => {
          resolve = nextResolve
          reject = nextReject
        })
        return { promise: result, resolve, reject }
      },
    })
  }
  if (typeof promise.try !== 'function') {
    Object.defineProperty(promise, 'try', {
      configurable: true,
      writable: true,
      value: <T>(callback: () => T | PromiseLike<T>) => Promise.resolve().then(callback),
    })
  }
  const url = URL as UrlCompat
  if (typeof url.parse !== 'function') {
    Object.defineProperty(url, 'parse', {
      configurable: true,
      writable: true,
      value: (value: string | URL, base?: string | URL) => {
        try {
          return base == null ? new URL(String(value)) : new URL(String(value), String(base))
        } catch {
          return null
        }
      },
    })
  }
}
