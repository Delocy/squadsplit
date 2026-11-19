import { useEffect, useState } from 'react'
import { EXIT_MS, useReducedMotion } from './motion'

/**
 * Keeps showing something for a moment after it goes away, so it can animate out. `shown` is `value` while it is
 * set, and the last value for EXIT_MS after it is cleared, with `leaving` true meanwhile (give the element the `out`
 * class). Under reduced motion it goes at once.
 */
export function useExitTransition<T>(value: T | null): { shown: T | null; leaving: boolean } {
  const reduced = useReducedMotion()
  const [last, setLast] = useState(value)
  if (value !== null && value !== last) setLast(value)
  const leaving = value === null && last !== null && !reduced

  const gone = value === null && last !== null
  useEffect(() => {
    if (!gone) return
    const timer = setTimeout(() => setLast(null), reduced ? 0 : EXIT_MS)
    return () => clearTimeout(timer)
  }, [gone, reduced])

  return { shown: value ?? (leaving ? last : null), leaving }
}
