import { RedirectToSignIn, Show } from '@clerk/react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'

/** Renders `children` for a signed-in user. Anyone else goes to sign-in and comes back to this exact URL. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation()
  const here = `${window.location.origin}${pathname}${search}${hash}`
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <RedirectToSignIn signInForceRedirectUrl={here} signUpForceRedirectUrl={here} />
      </Show>
    </>
  )
}
