import { Hono } from 'hono'
import { computeBadges, computeLeaderboard, pickWeighted, spinWeights, type FunDTO, type SpinDTO } from '@squadsplit/shared'
import { requireMember } from '../access'
import { db } from '../db'
import { loadFeed, toSpinDTO } from '../db/feed'
import { loadLedger } from '../db/ledger'
import { spins } from '../db/schema'
import type { AppEnv } from '../env'
import { HttpError } from '../errors'

/** Routes under /groups/:id: badges and leaderboard, the "who pays?" wheel, and the activity feed. */
export function funRoutes() {
  return new Hono<AppEnv>()
    .get('/:id/badges', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      const ledger = await loadLedger(d, groupId)
      const body: FunDTO = { badges: computeBadges(ledger), leaderboard: computeLeaderboard(ledger) }
      return c.json(body)
    })

    .post('/:id/spins', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      const spunBy = c.var.userId
      await requireMember(d, groupId, spunBy)
      const weights = spinWeights(await loadLedger(d, groupId))
      if (Object.keys(weights).length === 0) throw new HttpError(409, 'no_candidates', 'Nobody in this group can be picked')

      const r = crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32
      const [created] = await d
        .insert(spins)
        .values({
          id: crypto.randomUUID(),
          groupId,
          spunBy,
          winnerId: pickWeighted(weights, r),
          weightsJson: JSON.stringify(weights),
          createdAt: new Date().toISOString(),
        })
        .returning()
      const body: SpinDTO = toSpinDTO(created!)
      return c.json(body, 201)
    })

    .get('/:id/feed', async (c) => {
      const d = db(c.env)
      const groupId = c.req.param('id')
      await requireMember(d, groupId, c.var.userId)
      return c.json(await loadFeed(d, groupId))
    })
}
