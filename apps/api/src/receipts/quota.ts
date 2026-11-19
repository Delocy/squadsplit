import { RECEIPT_SCAN_DAILY_CAP, RECEIPT_SCAN_DAYS_KEPT, RECEIPT_SCANS_PER_USER_PER_DAY } from './config'

/** Today's UTC day, YYYY-MM-DD: the limits reset at 00:00 UTC, like the Workers AI free allowance. */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10)

const daysBefore = (day: string, days: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000))

/**
 * Counts one scan for the user if they and the app are both under today's limits. The count is one statement,
 * so two scans at once can't both slip under a limit: the insert only happens when the counts allow it. False when
 * over a limit. Counts older than a week are dropped in the same round trip.
 */
export async function takeScan(d1: D1Database, userId: string, day: string): Promise<boolean> {
  const [, counted] = await d1.batch<{ count: number }>([
    d1.prepare('DELETE FROM receipt_scans WHERE day < ?').bind(daysBefore(day, RECEIPT_SCAN_DAYS_KEPT)),
    d1
      .prepare(
        `INSERT INTO receipt_scans (user_id, day, count)
         SELECT ?1, ?2, 1
         WHERE (SELECT COALESCE(SUM(count), 0) FROM receipt_scans WHERE day = ?2) < ?3
           AND COALESCE((SELECT count FROM receipt_scans WHERE user_id = ?1 AND day = ?2), 0) < ?4
         ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(userId, day, RECEIPT_SCAN_DAILY_CAP, RECEIPT_SCANS_PER_USER_PER_DAY),
  ])
  return (counted?.results.length ?? 0) > 0
}

/** Gives back a scan the model never answered (it failed or the account's allowance was used up). */
export async function refundScan(d1: D1Database, userId: string, day: string): Promise<void> {
  await d1
    .prepare('UPDATE receipt_scans SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0')
    .bind(userId, day)
    .run()
}
