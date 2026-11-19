import { QUICK_SPLIT_TICKS_PER_HOUR } from '@squadsplit/shared'

// The share link's hourly limit on ticks. Counted per link (never per person or IP: no address is stored), in fixed
// UTC hours.

/** The UTC hour, 'YYYY-MM-DDTHH'. */
export const utcHour = (now = new Date()) => now.toISOString().slice(0, 13)

/**
 * Counts one tick change on the link if it is under this hour's limit, in one statement so two at once can't both
 * slip under it. False when over. Counts from before yesterday are dropped in the same round trip.
 */
export async function takeTick(d1: D1Database, splitId: string, hour: string): Promise<boolean> {
  const dayAgo = utcHour(new Date(Date.parse(`${hour}:00:00Z`) - 86_400_000))
  const [, counted] = await d1.batch<{ count: number }>([
    d1.prepare('DELETE FROM quick_split_ticks WHERE hour < ?').bind(dayAgo),
    d1
      .prepare(
        `INSERT INTO quick_split_ticks (split_id, hour, count)
         SELECT ?1, ?2, 1
         WHERE COALESCE((SELECT count FROM quick_split_ticks WHERE split_id = ?1 AND hour = ?2), 0) < ?3
         ON CONFLICT (split_id, hour) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(splitId, hour, QUICK_SPLIT_TICKS_PER_HOUR),
  ])
  return (counted?.results.length ?? 0) > 0
}
