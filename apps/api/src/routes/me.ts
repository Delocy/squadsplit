import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { effectiveAvatar, UpdateProfileInput, type MeDTO } from '@squadsplit/shared'
import { db } from '../db'
import { users } from '../db/schema'
import type { AuthDeps, Profile } from '../deps'
import type { AppEnv } from '../env'
import { parseBody } from '../errors'
import { ensureUser } from '../users'

type StoredLook = { profileAnimal: string | null; profileColor: string | null }

const meDTO = (id: string, profile: Profile, look: StoredLook): MeDTO => ({
  id,
  ...profile,
  profileAvatar: effectiveAvatar(id, { animal: look.profileAnimal, color: look.profileColor }),
})

export function meRoutes(deps: AuthDeps) {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const id = c.var.userId
      let profile: Profile
      try {
        profile = await deps.fetchProfile(id)
      } catch (err) {
        // Clerk is down: keep the app usable with the profile we already have. A first-time user has none, so rethrow.
        console.error('fetchProfile failed, using the stored profile', err)
        const stored = await db(c.env)
          .select({ displayName: users.displayName, avatarUrl: users.avatarUrl, profileAnimal: users.profileAnimal, profileColor: users.profileColor })
          .from(users)
          .where(eq(users.id, id))
          .get()
        if (!stored) throw err
        const { profileAnimal, profileColor, ...rest } = stored
        return c.json<MeDTO>(meDTO(id, rest, { profileAnimal, profileColor }))
      }
      // The Clerk profile replaces the stored name and picture; the profile look is ours, so it is left alone.
      const [look] = await db(c.env)
        .insert(users)
        .values({ id, ...profile, createdAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: users.id, set: profile })
        .returning({ profileAnimal: users.profileAnimal, profileColor: users.profileColor })
      return c.json<MeDTO>(meDTO(id, profile, look!))
    })

    // Your look outside groups, and the one new groups start you on. It's yours alone, so any look is allowed.
    .patch('/', ensureUser(deps), async (c) => {
      const d = db(c.env)
      const id = c.var.userId
      const { profileAvatar } = await parseBody(c, UpdateProfileInput)
      const [row] = await d
        .update(users)
        .set({ profileAnimal: profileAvatar.animal, profileColor: profileAvatar.color })
        .where(eq(users.id, id))
        .returning({ displayName: users.displayName, avatarUrl: users.avatarUrl })
      return c.json<MeDTO>({ id, ...row!, profileAvatar })
    })
}
