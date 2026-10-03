export const RENDERER_INIT_TIMEOUT_MS = 10_000

export type RendererLike = {
  init(): PromiseLike<unknown>
  dispose(): void
}

export type RendererInitScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export class RendererInitTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Renderer initialization timed out after ${timeoutMs}ms`)
    this.name = 'RendererInitTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export type RendererInitOptions<T extends RendererLike> = {
  timeoutMs?: number
  scheduler?: RendererInitScheduler
  onReady?: (renderer: T) => void
  onDisposeError?: (error: unknown) => void
}

const defaultScheduler: RendererInitScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function reportDisposeError(error: unknown, onDisposeError?: (error: unknown) => void) {
  try {
    onDisposeError?.(error)
  } catch {
    // The diagnostic callback must never replace the primary initialization
    // error or prevent the warning below from being emitted.
  }
  console.warn('[viewer] Late renderer disposal failed', error)
}

/**
 * Bounds a non-abortable renderer init while retaining ownership of its late
 * settlement. A renderer that finishes after the deadline is disposed rather
 * than allowed to resurrect an already-failed viewer attempt.
 */
export function initializeRenderer<T extends RendererLike>(
  renderer: T,
  options: RendererInitOptions<T> = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? RENDERER_INIT_TIMEOUT_MS
  const scheduler = options.scheduler ?? defaultScheduler

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let disposed = false
    let timer: unknown
    let timerPending = false

    const clearDeadline = () => {
      if (!timerPending) return
      scheduler.clearTimeout(timer)
      timerPending = false
      timer = undefined
    }

    const disposeLateRenderer = () => {
      if (disposed) return
      disposed = true
      try {
        renderer.dispose()
      } catch (error) {
        reportDisposeError(error, options.onDisposeError)
      }
    }

    const settleSuccess = () => {
      if (settled) {
        disposeLateRenderer()
        return
      }

      try {
        options.onReady?.(renderer)
      } catch (error) {
        settled = true
        clearDeadline()
        disposeLateRenderer()
        reject(error)
        return
      }

      settled = true
      clearDeadline()
      resolve(renderer)
    }

    const settleFailure = (error: unknown) => {
      if (settled) {
        disposeLateRenderer()
        return
      }

      settled = true
      clearDeadline()
      reject(error)
    }

    let initPromise: Promise<unknown>
    try {
      initPromise = Promise.resolve(renderer.init())
    } catch (error) {
      settleFailure(error)
      return
    }

    // Attach both handlers immediately. This keeps a late rejection observed
    // after timeout even though the bounded promise has already settled.
    initPromise.then(settleSuccess, settleFailure)

    timerPending = true
    timer = scheduler.setTimeout(() => {
      if (settled) return
      settled = true
      clearDeadline()
      reject(new RendererInitTimeoutError(timeoutMs))
    }, timeoutMs)
  })
}

export type RendererCacheOptions<T extends RendererLike> = RendererInitOptions<T> & {
  onFailure?: (error: unknown) => void
}

/**
 * Shares one bounded renderer attempt per canvas. Cache eviction is identity
 * checked so a late rejection from an old attempt cannot evict a newer one.
 */
export function getOrCreateRenderer<T extends RendererLike>(
  cache: WeakMap<object, Promise<T>>,
  key: object,
  create: () => T,
  options: RendererCacheOptions<T> = {},
): Promise<T> {
  const cached = cache.get(key)
  if (cached) return cached

  const attempt = Promise.resolve().then(() => initializeRenderer(create(), options))
  cache.set(key, attempt)

  void attempt.catch((error) => {
    if (cache.get(key) === attempt) cache.delete(key)
    try {
      options.onFailure?.(error)
    } catch {
      // Failure reporting must not create a second unhandled rejection.
    }
  })

  return attempt
}
