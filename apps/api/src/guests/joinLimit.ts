import { eq } from 'drizzle-orm'
import { GUEST_JOINS_PER_GROUP_PER_HOUR } from '@squadsplit/shared'
import type { Db } from '../db'
import { guestJoins } from '../db/schema'
import { utcHour } from '../quickSplits/ticks'

// The hourly limit on guest joins (claims and new names), per group: an invite link that leaks can't fill the
// group or churn its names faster than this. Counted per group in fixed UTC hours; no address is stored.

/**
 * Counts one guest join for the group if it is under this hour's limit, in one statement so two at once can't both
 * slip under it. False when over. Counts from before yesterday are dropped in the same round trip.
 */
export async function takeGuestJoin(d1: D1Database, groupId: string, hour = utcHour()): Promise<boolean> {
  const dayAgo = utcHour(new Date(Date.parse(`${hour}:00:00Z`) - 86_400_000))
  const [, counted] = await d1.batch<{ count: number }>([
    d1.prepare('DELETE FROM guest_joins WHERE hour < ?').bind(dayAgo),
    d1
      .prepare(
        `INSERT INTO guest_joins (group_id, hour, count)
         SELECT ?1, ?2, 1
         WHERE COALESCE((SELECT count FROM guest_joins WHERE group_id = ?1 AND hour = ?2), 0) < ?3
         ON CONFLICT (group_id, hour) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(groupId, hour, GUEST_JOINS_PER_GROUP_PER_HOUR),
  ])
  return (counted?.results.length ?? 0) > 0
}

/** Clears the group's count (the owner reset the link): the old link's attempts don't hold up joins with the new one. */
export const resetGuestJoins = (d: Db, groupId: string) => d.delete(guestJoins).where(eq(guestJoins.groupId, groupId))
