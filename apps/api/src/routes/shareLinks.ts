import { Hono } from 'hono'
import { MarkPaidInput } from '@squadsplit/shared'
import { db } from '../db'
import type { AppEnv } from '../env'
import { HttpError, parseBody } from '../errors'
import { payerNameOf, publicQuickSplitDTO } from '../quickSplits/dto'
import { linkState, SHARE_TOKEN } from '../quickSplits/shareLink'
import { guestToTick, loadSplitByToken, markPaid, type StoredSplit } from '../quickSplits/store'
import { takeTick, utcHour } from '../quickSplits/ticks'

/** The split behind a live link: 404 for a token that never existed, 410 link_off once it is stopped or expired. */
async function liveSplit(d: ReturnType<typeof db>, token: string): Promise<StoredSplit> {
  const s = SHARE_TOKEN.test(token) ? await loadSplitByToken(d, token) : undefined
  if (!s) throw new HttpError(404, 'not_found', 'This link does not exist.')
  if (linkState(s.split) === 'off') {
    throw new HttpError(410, 'link_off', `This link has been turned off. Ask ${payerNameOf(s)} for the breakdown.`)
  }
  return s
}

/**
 * The share link, for anyone who has it, with no sign-in: mounted before authentication. It shows names and amounts
 * only, and a guest can tick or untick themselves (the honour system: the payer sees every tick and can fix it).
 * Reads aren't limited (the token is 128 random bits); tick changes are, per link per hour.
 */
export function shareLinkRoutes() {
  return new Hono<AppEnv>()
    .get('/:token', async (c) => c.json(publicQuickSplitDTO(await liveSplit(db(c.env), c.req.param('token')))))

    .post('/:token/people/:personId/paid', async (c) => {
      const d = db(c.env)
      const s = await liveSplit(d, c.req.param('token'))
      const { paid } = await parseBody(c, MarkPaidInput)
      const person = guestToTick(s, c.req.param('personId'))
      if (!(await takeTick(c.env.DB, s.split.id, utcHour()))) {
        throw new HttpError(429, 'slow_down', 'Lots of ticks on this link just now. Try again in a little while.')
      }
      await markPaid(d, person, paid, 'guest', new Date().toISOString())
      return c.json(publicQuickSplitDTO(await liveSplit(d, c.req.param('token'))))
    })
}
