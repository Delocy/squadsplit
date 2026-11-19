import { createClerkClient, verifyToken } from '@clerk/backend'
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
        return payload.sub
      } catch {
        return null
      }
    },
    async fetchProfile(userId) {
      const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
      const user = await clerk.users.getUser(userId)
      return {
        displayName: user.fullName || user.username || user.emailAddresses[0]?.emailAddress || 'Someone',
        avatarUrl: user.imageUrl ?? null,
      }
    },
  }
}
