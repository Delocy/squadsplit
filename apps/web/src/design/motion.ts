import { useSyncExternalStore } from 'react'

const REDUCE = '(prefers-reduced-motion: reduce)'

/** Whether the user asked for less motion. All animation is off then (see the end of tokens.css). */
export const prefersReducedMotion = () => window.matchMedia?.(REDUCE).matches ?? false

function subscribe(onChange: () => void) {
  const query = window.matchMedia?.(REDUCE)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** `prefersReducedMotion`, kept up to date while the component is on screen. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, prefersReducedMotion, () => false)

/** How long dialogs, the settle form and confirm bars take to animate out (the `-out` animations in tokens.css). */
export const EXIT_MS = 160
