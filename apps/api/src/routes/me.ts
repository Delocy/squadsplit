import { Hono } from 'hono'
import type { MeDTO } from '@squadsplit/shared'
import { db } from '../db'
import { users } from '../db/schema'
import type { AuthDeps } from '../deps'
import type { AppEnv } from '../env'

export function meRoutes(deps: AuthDeps) {
  return new Hono<AppEnv>().get('/', async (c) => {
    const id = c.var.userId
    const profile = await deps.fetchProfile(id)
    await db(c.env)
      .insert(users)
      .values({ id, ...profile, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: users.id, set: profile })
    return c.json<MeDTO>({ id, ...profile })
  })
}
