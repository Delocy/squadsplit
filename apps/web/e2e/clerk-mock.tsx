// A fake Clerk for the browser checks: the signed-in user is localStorage['e2e.user'] (absent = signed out).
import type { ReactElement, ReactNode } from 'react'
import { cloneElement, isValidElement } from 'react'

const KEY = 'e2e.user'
const current = (): string | null => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
export const useAuth = () => {
  const userId = current()
  return { isLoaded: true, isSignedIn: !!userId, userId, getToken: async () => (current() ? `fake:${current()}` : null) }
}
export const Show = ({ when, children }: { when: string; children?: ReactNode }) => ((when === 'signed-in') === !!current() ? <>{children}</> : null)
export const RedirectToSignIn = () => <div>[Clerk sign-in]</div>
const wrap = (children: ReactNode) => (isValidElement(children) ? cloneElement(children as ReactElement) : <>{children}</>)
export const SignInButton = ({ children }: { children?: ReactNode }) => wrap(children)
export const SignUpButton = SignInButton
export const SignOutButton = SignInButton
const pass = ({ children }: { children?: ReactNode }) => <>{children}</>
export const ClerkProvider = pass
export const ClerkLoaded = pass
export const ClerkLoading = () => null
export const ClerkFailed = () => null
