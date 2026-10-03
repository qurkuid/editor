// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
  getOrCreateRenderer,
  initializeRenderer,
  type RendererInitScheduler,
  RendererInitTimeoutError,
} from './renderer-init'

type FakeRenderer = {
  init(): Promise<void>
  dispose(): void
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createScheduler() {
  let nextHandle = 0
  const callbacks = new Map<number, () => void>()
  const scheduler: RendererInitScheduler & {
    fireLatest(): void
    lastDelay?: number
    pendingCount(): number
  } = {
    setTimeout(callback, delayMs) {
      const handle = nextHandle++
      scheduler.lastDelay = delayMs
      callbacks.set(handle, callback)
      return handle
    },
    clearTimeout(handle) {
      callbacks.delete(handle as number)
    },
    fireLatest() {
      const handle = [...callbacks.keys()].at(-1)
      if (handle === undefined) throw new Error('No renderer-init timer is pending')
      const callback = callbacks.get(handle)
      callbacks.delete(handle)
      callback?.()
    },
    pendingCount() {
      return callbacks.size
    },
  }
  return scheduler
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function fakeRenderer(init: Promise<void>, dispose = () => {}) {
  return { init: () => init, dispose } satisfies FakeRenderer
}

describe('renderer initialization lifecycle', () => {
  afterEach(() => {
    // Keep console output from a deliberately failing disposal out of the
    // focused test runner while still asserting the separate callback below.
    spyOn(console, 'warn').mockRestore()
  })

  test('rejects an unresolved renderer at the 10 second deadline', async () => {
    const scheduler = createScheduler()
    const renderer = fakeRenderer(new Promise<void>(() => {}))
    const attempt = initializeRenderer(renderer, { scheduler })

    scheduler.fireLatest()

    await expect(attempt).rejects.toBeInstanceOf(RendererInitTimeoutError)
    expect(scheduler.lastDelay).toBe(10_000)
    expect(scheduler.pendingCount()).toBe(0)
  })

  test('returns the original renderer and clears the timer on early success', async () => {
    const scheduler = createScheduler()
    const init = deferred<void>()
    let disposeCount = 0
    const renderer = fakeRenderer(init.promise, () => {
      disposeCount += 1
    })

    const attempt = initializeRenderer(renderer, { scheduler })
    init.resolve()

    await expect(attempt).resolves.toBe(renderer)
    expect(scheduler.pendingCount()).toBe(0)
    expect(disposeCount).toBe(0)
  })

  test('preserves an initialization rejection that arrives before the deadline', async () => {
    const scheduler = createScheduler()
    const init = deferred<void>()
    const error = new Error('driver rejected initialization')
    const renderer = fakeRenderer(init.promise)
    const attempt = initializeRenderer(renderer, { scheduler })

    init.reject(error)

    await expect(attempt).rejects.toBe(error)
    expect(scheduler.pendingCount()).toBe(0)
  })

  test('disposes a renderer that fulfills after the timeout without recovering the attempt', async () => {
    const scheduler = createScheduler()
    const init = deferred<void>()
    let disposeCount = 0
    const renderer = fakeRenderer(init.promise, () => {
      disposeCount += 1
    })
    const attempt = initializeRenderer(renderer, { scheduler })

    scheduler.fireLatest()
    await expect(attempt).rejects.toBeInstanceOf(RendererInitTimeoutError)

    init.resolve()
    await flushMicrotasks()

    expect(disposeCount).toBe(1)
  })

  test('observes a late rejection and disposes exactly once', async () => {
    const scheduler = createScheduler()
    const init = deferred<void>()
    let disposeCount = 0
    const renderer = fakeRenderer(init.promise, () => {
      disposeCount += 1
    })
    const attempt = initializeRenderer(renderer, { scheduler })

    scheduler.fireLatest()
    await expect(attempt).rejects.toBeInstanceOf(RendererInitTimeoutError)

    init.reject(new Error('late backend failure'))
    await flushMicrotasks()

    expect(disposeCount).toBe(1)
  })

  test('keeps the timeout failure and exposes a disposal failure separately', async () => {
    const scheduler = createScheduler()
    const init = deferred<void>()
    const disposeError = new Error('dispose failed')
    const observedDisposeErrors: unknown[] = []
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    const renderer = fakeRenderer(init.promise, () => {
      throw disposeError
    })
    const attempt = initializeRenderer(renderer, {
      scheduler,
      onDisposeError: (error) => observedDisposeErrors.push(error),
    })

    scheduler.fireLatest()
    await expect(attempt).rejects.toBeInstanceOf(RendererInitTimeoutError)

    init.resolve()
    await flushMicrotasks()

    expect(observedDisposeErrors).toEqual([disposeError])
    expect(warning).toHaveBeenCalledWith('[viewer] Late renderer disposal failed', disposeError)
  })

  test('disposes a fully initialized renderer when the ready hook fails', async () => {
    const scheduler = createScheduler()
    const init = deferred<void>()
    const readyError = new Error('viewer setup failed')
    const disposeError = new Error('dispose failed after setup')
    const observedDisposeErrors: unknown[] = []
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    let disposeCount = 0
    const renderer = fakeRenderer(init.promise, () => {
      disposeCount += 1
      throw disposeError
    })
    const attempt = initializeRenderer(renderer, {
      scheduler,
      onReady: () => {
        throw readyError
      },
      onDisposeError: (error) => observedDisposeErrors.push(error),
    })

    init.resolve()

    await expect(attempt).rejects.toBe(readyError)
    expect(disposeCount).toBe(1)
    expect(observedDisposeErrors).toEqual([disposeError])
    expect(warning).toHaveBeenCalledWith('[viewer] Late renderer disposal failed', disposeError)
  })

  test('shares duplicate creation for one canvas and removes only the failed current attempt', async () => {
    const scheduler = createScheduler()
    const cache = new WeakMap<object, Promise<FakeRenderer>>()
    const canvas = {}
    const firstInit = deferred<void>()
    const first = fakeRenderer(firstInit.promise)
    let createCount = 0

    const firstAttempt = getOrCreateRenderer(
      cache,
      canvas,
      () => {
        createCount += 1
        return first
      },
      { scheduler },
    )
    const duplicateAttempt = getOrCreateRenderer(
      cache,
      canvas,
      () => {
        createCount += 1
        return first
      },
      { scheduler },
    )

    expect(duplicateAttempt).toBe(firstAttempt)
    expect(createCount).toBe(0)
    firstInit.resolve()
    await expect(firstAttempt).resolves.toBe(first)
    expect(createCount).toBe(1)

    const second = fakeRenderer(Promise.resolve())
    const failedInit = deferred<void>()
    const failed = fakeRenderer(failedInit.promise)
    const secondCanvas = {}
    const staleAttempt = getOrCreateRenderer(cache, secondCanvas, () => failed, { scheduler })
    await flushMicrotasks()
    scheduler.fireLatest()
    const replacementAttempt = Promise.resolve(second)
    cache.set(secondCanvas, replacementAttempt)
    await expect(staleAttempt).rejects.toBeInstanceOf(RendererInitTimeoutError)
    await flushMicrotasks()

    failedInit.resolve()
    await flushMicrotasks()
    expect(cache.get(secondCanvas)).toBe(replacementAttempt)
    expect(getOrCreateRenderer(cache, secondCanvas, () => second, { scheduler })).toBe(
      replacementAttempt,
    )
  })
})
