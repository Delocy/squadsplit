import { and, eq, lt, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { Db } from '../db'
import { groups, guestSessions } from '../db/schema'
import { GUEST_TOKEN, hashGuestToken } from './token'

// A guest session signs one phone in as one guest, in one group. A guest may have several (one per phone); a phone
// holds one per group. Deleting a guest's sessions signs them out and makes their name claimable again.

export interface GuestSession {
  tokenHash: string
  userId: string
  groupId: string
}

/** last_seen_at is moved on at most this often. */
const SEEN_EVERY_MS = 60 * 60 * 1000

/** The guest a token signs in, while its group exists; undefined for a malformed or unknown token. */
export async function guestByToken(d: Db, token: string, now = new Date()): Promise<GuestSession | undefined> {
  if (!GUEST_TOKEN.test(token)) return undefined
  const tokenHash = await hashGuestToken(token)
  const row = await d
    .select({ userId: guestSessions.userId, groupId: guestSessions.groupId, lastSeenAt: guestSessions.lastSeenAt })
    .from(guestSessions)
    .innerJoin(groups, eq(groups.id, guestSessions.groupId))
    .where(eq(guestSessions.tokenHash, tokenHash))
    .get()
  if (!row) return undefined
  const seenBefore = new Date(now.getTime() - SEEN_EVERY_MS).toISOString()
  if (row.lastSeenAt < seenBefore) {
    await d
      .update(guestSessions)
      .set({ lastSeenAt: now.toISOString() })
      .where(and(eq(guestSessions.tokenHash, tokenHash), lt(guestSessions.lastSeenAt, seenBefore)))
  }
  return { tokenHash, userId: row.userId, groupId: row.groupId }
}

/** Writes the session only while `condition` holds (checked in the same statement), returning the row it wrote. */
export function insertSessionIf(d: Db, s: GuestSession, now: string, condition: SQL) {
  // Columns in table order: token hash, user, group, created, last seen.
  return d
    .insert(guestSessions)
    .select(sql`SELECT ${s.tokenHash}, ${s.userId}, ${s.groupId}, ${now}, ${now} WHERE ${condition}`)
    .returning({ userId: guestSessions.userId })
}

/** Whether `userId` has a live session: SQL, for conditions inside other statements. */
export const hasLiveSession = (userId: AnyColumn | string) =>
  sql`EXISTS (SELECT 1 FROM ${guestSessions} WHERE ${guestSessions.userId} = ${userId})`

/** Signs every guest of the group out (the owner reset the link). */
export const endGroupSessions = (d: Db, groupId: string) => d.delete(guestSessions).where(eq(guestSessions.groupId, groupId))

/** Signs one guest out on every phone. */
export const endGuestSessions = (d: Db, userId: string) => d.delete(guestSessions).where(eq(guestSessions.userId, userId))
