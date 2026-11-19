import { useCallback } from 'react'
import { Link, useNavigate, type LinkProps, type NavigateOptions, type To } from 'react-router'
import { useReducedMotion } from '../design/motion'

/** Browsers without view transitions just navigate; there is no polyfill. */
const canTransition = () => typeof document !== 'undefined' && 'startViewTransition' in document

/** Whether moving to another page should cross-fade (see ::view-transition in tokens.css): never under reduced motion. */
function useSmoothPages(): boolean {
  return !useReducedMotion() && canTransition()
}

/** A link to another page of the app. The page changes with a short cross-fade, or instantly under reduced motion. */
export function PageLink(props: LinkProps) {
  const smooth = useSmoothPages()
  return <Link viewTransition={smooth} {...props} />
}

/** `navigate` for moving to another page, with the same cross-fade as PageLink. */
export function usePageNavigate() {
  const navigate = useNavigate()
  const smooth = useSmoothPages()
  return useCallback(
    (to: To, options?: NavigateOptions) => navigate(to, { viewTransition: smooth, ...options }),
    [navigate, smooth],
  )
}
