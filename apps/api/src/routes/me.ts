import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { MeDTO } from '@squadsplit/shared'
import { db } from '../db'
import { users } from '../db/schema'
import type { AuthDeps, Profile } from '../deps'
import type { AppEnv } from '../env'

export function meRoutes(deps: AuthDeps) {
  return new Hono<AppEnv>().get('/', async (c) => {
    const id = c.var.userId
    let profile: Profile
    try {
      profile = await deps.fetchProfile(id)
    } catch (err) {
      // Clerk is down: keep the app usable with the profile we already have. A first-time user has none, so rethrow.
      console.error('fetchProfile failed, using the stored profile', err)
      const stored = await db(c.env)
        .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, id))
        .get()
      if (!stored) throw err
      return c.json<MeDTO>({ id, ...stored })
    }
    await db(c.env)
      .insert(users)
      .values({ id, ...profile, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: users.id, set: profile })
    return c.json<MeDTO>({ id, ...profile })
  })
}
