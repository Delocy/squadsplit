import { eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { effectiveAvatar, type AvatarChoice } from '@squadsplit/shared'
import type { Db } from './db'
import { db } from './db'
import { users } from './db/schema'
import type { AuthDeps } from './deps'
import type { AppEnv } from './env'

/** Ids of placeholder users (names in a group for someone who hasn't joined). Never a Clerk id, which starts `user_`. */
export const PLACEHOLDER_ID_PREFIX = 'ph_'

export const isPlaceholderId = (userId: string) => userId.startsWith(PLACEHOLDER_ID_PREFIX)

/** Creates the caller's `users` row the first time we see them. Never refetches an existing profile. */
export const ensureUser =
  (deps: AuthDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const id = c.var.userId
    const existing = await db(c.env).select({ id: users.id }).from(users).where(eq(users.id, id)).get()
    if (!existing) {
      const profile = await deps.fetchProfile(id)
      await db(c.env)
        .insert(users)
        .values({ id, ...profile, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
    }
    await next()
  }

/** The user's profile look: what they picked for themselves, or their default. */
export async function profileAvatarOf(d: Db, userId: string): Promise<AvatarChoice> {
  const row = await d
    .select({ animal: users.profileAnimal, color: users.profileColor })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  return effectiveAvatar(userId, row ?? { animal: null, color: null })
}
