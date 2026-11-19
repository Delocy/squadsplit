import { Hono } from 'hono'
import { MarkPaidInput, QuickSplitInput } from '@squadsplit/shared'
import { db } from '../db'
import type { AppEnv } from '../env'
import { parseBody } from '../errors'
import { quickSplitDTO, quickSplitSummary } from '../quickSplits/dto'
import { newShareToken, shareExpiry } from '../quickSplits/shareLink'
import {
  deleteSplit,
  guestToTick,
  insertSplit,
  loadOwnSplit,
  loadOwnSplits,
  markPaid,
  planPeople,
  replaceSplit,
  stopSharing,
} from '../quickSplits/store'
import { profileAvatarOf } from '../users'

/** The owner's quick splits. Only the owner ever sees one here: anyone else gets 404. */
export function quickSplitRoutes() {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const splits = await loadOwnSplits(db(c.env), c.var.userId)
      return c.json(splits.map((s) => quickSplitSummary(s)))
    })

    // Saving a split opens its share link at once.
    .post('/', async (c) => {
      const d = db(c.env)
      const me = c.var.userId
      const input = await parseBody(c, QuickSplitInput)
      const people = planPeople(input, [], await profileAvatarOf(d, me))
      const id = crypto.randomUUID()
      const created = Date.now()
      const now = new Date(created).toISOString()
      await d.batch(insertSplit(d, { id, ownerId: me, now, shareToken: newShareToken(), shareExpiresAt: shareExpiry(created) }, input, people))
      return c.json(quickSplitDTO(await loadOwnSplit(d, id, me)), 201)
    })

    .get('/:id', async (c) => c.json(quickSplitDTO(await loadOwnSplit(db(c.env), c.req.param('id'), c.var.userId))))

    // A full replace. People sent with their id keep their tick and look; people left out are deleted.
    .put('/:id', async (c) => {
      const d = db(c.env)
      const me = c.var.userId
      const before = await loadOwnSplit(d, c.req.param('id'), me)
      const input = await parseBody(c, QuickSplitInput)
      const people = planPeople(input, before.people, await profileAvatarOf(d, me))
      await d.batch(replaceSplit(d, before.split.id, new Date().toISOString(), input, people))
      return c.json(quickSplitDTO(await loadOwnSplit(d, before.split.id, me)))
    })

    .delete('/:id', async (c) => {
      const d = db(c.env)
      const s = await loadOwnSplit(d, c.req.param('id'), c.var.userId)
      await deleteSplit(d, s.split.id)
      return c.body(null, 204)
    })

    // The payer fixes a tick, or marks someone paid themselves.
    .patch('/:id/people/:personId', async (c) => {
      const d = db(c.env)
      const s = await loadOwnSplit(d, c.req.param('id'), c.var.userId)
      const person = guestToTick(s, c.req.param('personId'))
      const { paid } = await parseBody(c, MarkPaidInput)
      await markPaid(d, person, paid, 'payer', new Date().toISOString())
      return c.json(quickSplitDTO(await loadOwnSplit(d, s.split.id, c.var.userId)))
    })

    // Turns the link off straight away, for good (v1 has no turning it back on).
    .post('/:id/share/stop', async (c) => {
      const d = db(c.env)
      const s = await loadOwnSplit(d, c.req.param('id'), c.var.userId)
      await stopSharing(d, s.split.id, new Date().toISOString())
      return c.json(quickSplitDTO(await loadOwnSplit(d, s.split.id, c.var.userId)))
    })
}
