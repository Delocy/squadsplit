import { vi } from 'vitest'

/**
 * Stubs `window.matchMedia` so `(prefers-reduced-motion: reduce)` matches when `reduce` is true. jsdom has no
 * matchMedia, so without this the app sees "no preference". `set` flips the preference and tells listeners.
 * Undo with `vi.unstubAllGlobals()`.
 */
export function mockReducedMotion(reduce: boolean) {
  const listeners = new Set<() => void>()
  let matches = reduce
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(prefers-reduced-motion: reduce)' && matches
    },
    media: query,
    addEventListener: (_: 'change', fn: () => void) => listeners.add(fn),
    removeEventListener: (_: 'change', fn: () => void) => listeners.delete(fn),
  }))
  return {
    set(next: boolean) {
      matches = next
      listeners.forEach((fn) => fn())
    },
  }
}

/**
 * Stubs `document.startViewTransition` (jsdom has none) with one that runs the update straight away, so the
 * router takes its view-transition path. Returns the spy. Undo with the returned `restore`.
 */
export function stubViewTransitions() {
  const start = vi.fn((update: () => unknown) => {
    const done = Promise.resolve().then(() => update())
    return { finished: done, ready: done, updateCallbackDone: done, skipTransition: () => {} }
  })
  Object.assign(document, { startViewTransition: start })
  return { start, restore: () => delete (document as { startViewTransition?: unknown }).startViewTransition }
}
