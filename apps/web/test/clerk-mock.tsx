// Stand-in for @clerk/react in tests: a signed-in user with a fixed id and token.
// Use with `vi.mock('@clerk/react', () => import('./clerk-mock'))`.
import type { ReactNode } from 'react'

export const ME = 'user_me'
export const signIn = { state: true }

export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: signIn.state,
  userId: signIn.state ? ME : null,
  getToken: async () => (signIn.state ? 'test_token' : null),
})

export const Show = ({ when, children }: { when: 'signed-in' | 'signed-out'; children: ReactNode }) =>
  (when === 'signed-in') === signIn.state ? <>{children}</> : null

export const RedirectToSignIn = (props: { signInForceRedirectUrl?: string }) => (
  <p>Redirecting to sign-in, then back to {props.signInForceRedirectUrl}</p>
)

const passThrough = ({ children }: { children?: ReactNode }) => <>{children}</>
export const SignInButton = passThrough
export const SignUpButton = passThrough
export const SignOutButton = passThrough
export const ClerkProvider = passThrough
