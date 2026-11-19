import { createClerkClient, verifyToken, type User } from '@clerk/backend'
import type { Bindings } from './env'

export interface Profile {
  displayName: string
  avatarUrl: string | null
}

export interface AuthDeps {
  /** Returns the user id for a valid session token, or null. */
  verifyToken(token: string): Promise<string | null>
  fetchProfile(userId: string): Promise<Profile>
}

export function clerkDeps(env: Bindings): AuthDeps {
  return {
    async verifyToken(token) {
      try {
        const payload = await verifyToken(token, {
          secretKey: env.CLERK_SECRET_KEY,
          authorizedParties: [env.WEB_ORIGIN],
        })
        // A pending session has signed in but not finished a required step (e.g. a session task), so it isn't a user yet.
        if (payload.sts === 'pending') return null
        return payload.sub
      } catch (err) {
        // Log only the reason (e.g. token-expired vs jwk-remote-failed-to-load), never the token,
        // so a misconfigured secret key is visible in the logs rather than a silent wave of 401s.
        console.warn('verifyToken failed', (err as { reason?: string } | null)?.reason ?? err)
        return null
      }
    },
    async fetchProfile(userId) {
      const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
      const user = await clerk.users.getUser(userId)
      return {
        displayName: displayNameOf(user),
        avatarUrl: user.imageUrl ?? null,
      }
    },
  }
}

/** The name other members see. Falls back to the email's local part, never the whole address. */
function displayNameOf(
  user: Pick<User, 'fullName' | 'firstName' | 'username' | 'primaryEmailAddress' | 'emailAddresses'>,
): string {
  const email = (user.primaryEmailAddress ?? user.emailAddresses[0])?.emailAddress
  const emailName = email?.split('@')[0]
  return user.fullName || user.firstName || user.username || emailName || 'Someone'
}
