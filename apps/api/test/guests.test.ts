import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  defaultAvatar,
  firstFreeAvatar,
  GUEST_JOINS_PER_GROUP_PER_HOUR,
  MAX_GROUP_MEMBERS,
  type ApiErrorBody,
  type FeedItem,
  type GroupDTO,
  type GuestJoinDTO,
  type InvitePreviewDTO,
  type SettlementDTO,
} from '@squadsplit/shared'
import { expenseShares, expenses, guestSessions, memberships, receiptScans, settlements, spins, users } from '../src/db/schema'
import { db, json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const anon = app.anon
type Send = typeof alice

async function errorCode(res: Response) {
  return ((await res.json()) as ApiErrorBody).error.code
}

async function createGroup(members?: string[], as: Send = alice) {
  const res = await as('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️', ...(members && { members }) }))
  expect(res.status).toBe(201)
  return (await res.json()) as GroupDTO & { inviteCode: string }
}

const idOf = (g: GroupDTO, name: string) => g.members.find((m) => m.displayName === name)!.userId

async function getGroup(id: string, as: Send = alice) {
  const res = await as(`/groups/${id}`)
  expect(res.status).toBe(200)
  return (await res.json()) as GroupDTO
}

const guestJoin = (code: string, body: object) => anon(`/invites/${code}/guest`, json('POST', body))

/** Joins as a guest and returns the answer, failing the test unless it is 201. */
async function joinAsGuest(code: string, body: object) {
  const res = await guestJoin(code, body)
  expect(res.status).toBe(201)
  return (await res.json()) as GuestJoinDTO
}

const preview = async (code: string, as: Send = anon) => (await (await as(`/invites/${code}`)).json()) as InvitePreviewDTO

const expense = (groupId: string, body: object, as: Send = alice) =>
  as(`/groups/${groupId}/expenses`, json('POST', { description: 'Dinner', category: '🍕', spentOn: '2026-11-19', ...body }))

async function resetLink(groupId: string) {
  const res = await alice(`/groups/${groupId}/invite/reset`, { method: 'POST' })
  expect(res.status).toBe(200)
  return ((await res.json()) as { inviteCode: string }).inviteCode
}

const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
/** The header of a 800x600 PNG: enough for the scan route to read its size. */
const PNG = btoa(
  String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...[...'IHDR'].map((c) => c.charCodeAt(0)), ...be32(800), ...be32(600), 8, 2, 0, 0, 0),
)

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Every row that names someone in the group's history, for checking that a claim moved nothing. */
async function historyRows() {
  return {
    expenses: await db().select().from(expenses).orderBy(expenses.id),
    shares: await db().select().from(expenseShares).orderBy(expenseShares.expenseId, expenseShares.userId),
    settlements: await db().select().from(settlements).orderBy(settlements.id),
    spins: await db().select().from(spins).orderBy(spins.id),
  }
}

describe('GET /invites/:code with no sign-in', () => {
  it('previews the group and its unclaimed names for anyone with the link', async () => {
    const group = await createGroup(['Dave'])

    const res = await anon(`/invites/${group.inviteCode}`)

    expect(res.status).toBe(200)
    const body = (await res.json()) as InvitePreviewDTO
    expect(body).toMatchObject({ groupId: group.id, name: 'Bali trip', memberCount: 2, alreadyMember: false, myFormerAvatar: null })
    expect(body.placeholders.map((p) => p.name)).toEqual(['Dave'])
  })

  it('still knows a signed-in caller, and a bad sign-in is still 401', async () => {
    const group = await createGroup()
    expect((await preview(group.inviteCode, alice)).alreadyMember).toBe(true)
    expect((await app.as('')(`/invites/${group.inviteCode}`)).status).toBe(401)
  })

  it('no longer lists a name a guest has taken', async () => {
    const group = await createGroup(['Dave', 'Erin'])
    await joinAsGuest(group.inviteCode, { claim: idOf(group, 'Dave') })
    expect((await preview(group.inviteCode)).placeholders.map((p) => p.name)).toEqual(['Erin'])
  })

  it('is 404 for an unknown code', async () => {
    expect((await anon('/invites/ZZZZZZZZ')).status).toBe(404)
  })
})

describe('POST /invites/:code/guest, claiming a name', () => {
  it('turns the placeholder into the guest in place: same id, kind guest, and no history row changes', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    expect((await expense(group.id, { amountCents: 900, paidBy: dave, split: { type: 'equal', participantIds: ['alice', dave] } })).status).toBe(201)
    expect((await alice(`/groups/${group.id}/spins`, { method: 'POST' })).status).toBe(201)
    const before = await historyRows()

    const res = await guestJoin(group.inviteCode, { claim: dave })

    expect(res.status).toBe(201)
    const joined = (await res.json()) as GuestJoinDTO
    expect(joined.groupId).toBe(group.id)
    expect(joined.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(joined.member).toMatchObject({ userId: dave, displayName: 'Dave', role: 'member', active: true, placeholder: false, guest: true })
    expect(await db().select({ kind: users.kind }).from(users).where(eq(users.id, dave))).toEqual([{ kind: 'guest' }])
    expect(await historyRows()).toEqual(before)
  })

  it('stores only the SHA-256 of the token', async () => {
    const group = await createGroup(['Dave'])
    const { token } = await joinAsGuest(group.inviteCode, { claim: idOf(group, 'Dave') })
    const rows = await db().select().from(guestSessions)
    expect(rows).toEqual([
      { tokenHash: await sha256Hex(token), userId: idOf(group, 'Dave'), groupId: group.id, createdAt: expect.any(String), lastSeenAt: expect.any(String) },
    ])
    expect(JSON.stringify(rows)).not.toContain(token)
  })

  it('applies the look and nickname sent, by the rules of joining', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    const look = { animal: 'penguin', color: 'lemon' } as const

    const taken = await guestJoin(group.inviteCode, { claim: dave, avatar: defaultAvatar('alice') })
    expect(taken.status).toBe(409)
    expect(await errorCode(taken)).toBe('avatar_taken')

    const { member } = await joinAsGuest(group.inviteCode, { claim: dave, avatar: look, nickname: 'Davey' })
    expect(member).toMatchObject({ userId: dave, displayName: 'Davey', nickname: 'Davey', avatar: look })
  })

  it('is 409 already_claimed for a name already taken, or lost in a race', async () => {
    const group = await createGroup(['Dave', 'Erin'])
    await joinAsGuest(group.inviteCode, { claim: idOf(group, 'Dave') })
    expect(await errorCode(await guestJoin(group.inviteCode, { claim: idOf(group, 'Dave') }))).toBe('already_claimed')
    expect(await errorCode(await guestJoin(group.inviteCode, { claim: 'alice' }))).toBe('already_claimed')

    const erin = idOf(group, 'Erin')
    const both = await Promise.all([guestJoin(group.inviteCode, { claim: erin }), guestJoin(group.inviteCode, { claim: erin })])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await db().select().from(guestSessions).where(eq(guestSessions.userId, erin))).toHaveLength(1)
  })

  it('is 404 for an unknown or old code, and 422 without exactly one of claim or name', async () => {
    const group = await createGroup(['Dave'])
    const old = group.inviteCode
    await resetLink(group.id)
    expect((await guestJoin(old, { claim: idOf(group, 'Dave') })).status).toBe(404)
    expect((await guestJoin('ZZZZZZZZ', { name: 'Zed' })).status).toBe(404)
    const code = (await getGroup(group.id)).inviteCode!
    expect((await guestJoin(code, {})).status).toBe(422)
    expect((await guestJoin(code, { claim: idOf(group, 'Dave'), name: 'Dave' })).status).toBe(422)
  })

  it('shows in the feed as a join', async () => {
    const group = await createGroup(['Dave'])
    await joinAsGuest(group.inviteCode, { claim: idOf(group, 'Dave') })
    const feed = (await (await alice(`/groups/${group.id}/feed`)).json()) as FeedItem[]
    expect(feed.filter((i) => i.type === 'join').map((i) => i.type === 'join' && i.userId)).toEqual([idOf(group, 'Dave'), 'alice'])
  })
})

describe('POST /invites/:code/guest, as someone new', () => {
  it('adds a gs_ guest as a member with a free look, and signs them in', async () => {
    const group = await createGroup()

    const { token, member } = await joinAsGuest(group.inviteCode, { name: ' Zed ', nickname: 'Zeddy' })

    expect(member.userId).toMatch(/^gs_[0-9a-f-]{36}$/)
    expect(member).toMatchObject({ displayName: 'Zeddy', nickname: 'Zeddy', role: 'member', active: true, placeholder: false, guest: true })
    expect(member.avatar).toEqual(firstFreeAvatar(defaultAvatar(member.userId), [defaultAvatar('alice')]))
    expect(await db().select({ kind: users.kind, name: users.displayName }).from(users).where(eq(users.id, member.userId))).toEqual([
      { kind: 'guest', name: 'Zed' },
    ])
    expect((await app.guest(token)(`/groups/${group.id}`)).status).toBe(200)
    const feed = (await (await alice(`/groups/${group.id}/feed`)).json()) as FeedItem[]
    expect(feed.some((i) => i.type === 'join' && i.userId === member.userId)).toBe(true)
  })

  it('takes the look sent, unless someone has it', async () => {
    const group = await createGroup()
    const look = { animal: 'koala', color: 'mint' } as const
    expect((await joinAsGuest(group.inviteCode, { name: 'Zed', avatar: look })).member.avatar).toEqual(look)
    expect(await errorCode(await guestJoin(group.inviteCode, { name: 'Yan', avatar: look }))).toBe('avatar_taken')
  })

  it('is 409 group_full at 12 people, writing nothing', async () => {
    const group = await createGroup(Array.from({ length: MAX_GROUP_MEMBERS - 1 }, (_, i) => `P${i}`))
    const res = await guestJoin(group.inviteCode, { name: 'Zed' })
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('group_full')
    expect(await db().select().from(users).where(eq(users.kind, 'guest'))).toEqual([])
    expect(await db().select().from(guestSessions)).toEqual([])
  })
})

describe('the guest join limit', () => {
  it(`takes ${GUEST_JOINS_PER_GROUP_PER_HOUR} guest joins per group per hour, then answers 429 slow_down`, async () => {
    const group = await createGroup()
    const other = await createGroup()
    // Eleven fill the group; the attempts after that are refused as full, but still count.
    for (let i = 0; i < GUEST_JOINS_PER_GROUP_PER_HOUR; i++) {
      expect((await guestJoin(group.inviteCode, { name: `G${i}` })).status).toBe(i < MAX_GROUP_MEMBERS - 1 ? 201 : 409)
    }
    const over = await guestJoin(group.inviteCode, { name: 'One more' })
    expect(over.status).toBe(429)
    expect(await errorCode(over)).toBe('slow_down')
    // Each group has its own count, and only the group and hour are kept: no address.
    expect((await guestJoin(other.inviteCode, { name: 'Zed' })).status).toBe(201)
    const columns = await env.DB.prepare('SELECT * FROM guest_joins WHERE group_id = ?').bind(group.id).first()
    expect(Object.keys(columns!).sort()).toEqual(['count', 'group_id', 'hour'])
  })
})

describe('the guest join limit and a reset', () => {
  it('starts the count afresh with the new link, so a leaked link can’t block the rejoins', async () => {
    const group = await createGroup()
    for (let i = 0; i < GUEST_JOINS_PER_GROUP_PER_HOUR; i++) await guestJoin(group.inviteCode, { name: `G${i}` })
    expect((await guestJoin(group.inviteCode, { name: 'Late' })).status).toBe(429)

    const code = await resetLink(group.id)

    expect((await guestJoin(code, { claim: (await preview(code)).placeholders[0]!.userId })).status).toBe(201)
  })
})

describe('a guest token', () => {
  async function guestIn(names = ['Dave']) {
    const group = await createGroup(names)
    const { token, member } = await joinAsGuest(group.inviteCode, { claim: idOf(group, names[0]!) })
    return { group, token, guestId: member.userId, as: app.guest(token) }
  }

  it('reads and writes its own group like a member', async () => {
    const { group, guestId, as } = await guestIn()
    expect((await getGroup(group.id, as)).members.find((m) => m.userId === guestId)).toMatchObject({ guest: true })
    expect((await expense(group.id, { amountCents: 600, paidBy: guestId, split: { type: 'equal', participantIds: ['alice', guestId] } }, as)).status).toBe(201)
    expect((await as(`/groups/${group.id}/balances`)).status).toBe(200)
    expect((await as(`/groups/${group.id}/spins`, { method: 'POST' })).status).toBe(201)
    expect((await as(`/groups/${group.id}/members/me`, json('PATCH', { nickname: 'D' }))).status).toBe(200)
  })

  it('is 404 for any other group', async () => {
    const { as } = await guestIn()
    const other = await createGroup(['Erin'])
    expect((await as(`/groups/${other.id}`)).status).toBe(404)
    expect((await as(`/groups/${other.id}/expenses`)).status).toBe(404)
    expect((await expense(other.id, { amountCents: 100, paidBy: 'alice', split: { type: 'equal', participantIds: ['alice'] } }, as)).status).toBe(404)
    expect((await as('/groups/%E0%A4%A')).status).toBe(404)
  })

  it('is 404 for another group’s expense or settlement', async () => {
    const { as } = await guestIn()
    const other = await createGroup()
    await bob(`/invites/${other.inviteCode}/join`, { method: 'POST' })
    const e = await expense(other.id, { amountCents: 1000, paidBy: 'alice', split: { type: 'equal', participantIds: ['alice', 'bob'] } })
    const { id: expenseId } = (await e.json()) as { id: string }
    const s = await bob(`/groups/${other.id}/settlements`, json('POST', { toUserId: 'alice', amountCents: 500 }))
    const { id: settlementId } = (await s.json()) as SettlementDTO
    expect((await as(`/expenses/${expenseId}`, json('PATCH', { description: 'Mine' }))).status).toBe(404)
    expect((await as(`/expenses/${expenseId}`, { method: 'DELETE' })).status).toBe(404)
    expect((await as(`/settlements/${settlementId}/confirm`, { method: 'POST' })).status).toBe(404)
  })

  it('acts as the guest when an account’s sign-in comes with it', async () => {
    const { group, guestId, token } = await guestIn()
    const res = await expense(group.id, { amountCents: 300, paidBy: guestId, split: { type: 'equal', participantIds: [guestId] } }, app.guest(token, 'bob'))
    expect(res.status).toBe(201)
    expect((await db().select().from(expenses))[0]).toMatchObject({ createdBy: guestId })
    expect(await db().select().from(users).where(eq(users.id, 'bob'))).toEqual([])
  })

  it('is 403 on owner-only routes', async () => {
    const { group, as } = await guestIn(['Dave', 'Erin'])
    expect((await as(`/groups/${group.id}`, json('PATCH', { name: 'Mine now' }))).status).toBe(403)
    expect((await as(`/groups/${group.id}/invite/reset`, { method: 'POST' })).status).toBe(403)
    expect((await as(`/groups/${group.id}/placeholders`, json('POST', { name: 'Frank' }))).status).toBe(403)
    expect((await as(`/groups/${group.id}/members/${idOf(group, 'Erin')}`, { method: 'DELETE' })).status).toBe(403)
  })

  it('is 401 on account-only routes: /me, the group list, creating groups, quick splits and signed-in joins', async () => {
    const { as } = await guestIn()
    const other = await createGroup()
    expect((await as('/me')).status).toBe(401)
    expect((await as('/groups')).status).toBe(401)
    expect((await as('/groups', json('POST', { name: 'Mine', emoji: '🏝️' }))).status).toBe(401)
    expect((await as('/quick-splits')).status).toBe(401)
    expect((await as(`/invites/${other.inviteCode}/join`, { method: 'POST' })).status).toBe(401)
  })

  it('is 401 guest_signed_out when bad or unknown, so the phone knows to forget it', async () => {
    const { group, token } = await guestIn()
    for (const bad of ['', 'nope', `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, 'x'.repeat(43)]) {
      const res = await app.guest(bad)(`/groups/${group.id}`)
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('guest_signed_out')
    }
  })

  it('is a plain 401 unauthenticated, never guest_signed_out, on an account-only route with a live token', async () => {
    const { token, as } = await guestIn()
    for (const path of ['/me', '/groups', '/quick-splits']) {
      const res = await as(path)
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('unauthenticated')
    }
    expect((await db().select().from(guestSessions)).map((s) => s.tokenHash)).toEqual([await sha256Hex(token)])
  })

  it('moves last_seen_at on at most once an hour', async () => {
    const { group, as } = await guestIn()
    const seen = async () => (await db().select({ at: guestSessions.lastSeenAt }).from(guestSessions))[0]!.at
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    await db().update(guestSessions).set({ lastSeenAt: tenMinutesAgo })
    await as(`/groups/${group.id}`)
    expect(await seen()).toBe(tenMinutesAgo)

    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()
    await db().update(guestSessions).set({ lastSeenAt: twoHoursAgo })
    await as(`/groups/${group.id}`)
    expect(Date.parse(await seen())).toBeGreaterThan(Date.now() - 60_000)
  })

  it('counts receipt scans as the guest’s own, under the same daily limit', async () => {
    const { group, guestId, as } = await guestIn()
    const day = new Date().toISOString().slice(0, 10)
    await db().insert(receiptScans).values({ userId: guestId, day, count: 20 })
    const res = await as(`/groups/${group.id}/receipts/scan`, json('POST', { imageBase64: PNG, mimeType: 'image/png' }))
    expect(res.status).toBe(429)
    expect(await errorCode(res)).toBe('scan_limit')
  })
})

describe('Clerk subjects', () => {
  it('refuses a gs_ id as a signed-in user', async () => {
    expect((await app.as('gs_anything')('/me')).status).toBe(401)
    expect((await app.as('gs_anything')('/groups')).status).toBe(401)
  })
})

describe('CORS', () => {
  it('lets the web app send the guest token header', async () => {
    const res = await anon('/groups', {
      method: 'OPTIONS',
      headers: { Origin: env.WEB_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-guest-token' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(env.WEB_ORIGIN)
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-guest-token')
  })
})

describe('the owner resetting the link', () => {
  it('signs every guest out, keeps their expenses, and frees their names to claim again', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    const { token } = await joinAsGuest(group.inviteCode, { claim: dave })
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    expect((await expense(group.id, { amountCents: 800, paidBy: dave, split: { type: 'equal', participantIds: ['alice', dave] } }, app.guest(token))).status).toBe(201)
    const joinedAt = async () => (await db().select({ at: memberships.joinedAt }).from(memberships).where(eq(memberships.userId, dave)))[0]!.at
    const firstJoin = await joinedAt()

    const code = await resetLink(group.id)

    expect(await db().select().from(guestSessions)).toEqual([])
    const signedOut = await app.guest(token)(`/groups/${group.id}`)
    expect(signedOut.status).toBe(401)
    expect(await errorCode(signedOut)).toBe('guest_signed_out')
    expect((await app.guest(zed.token)(`/groups/${group.id}`)).status).toBe(401)
    const g = await getGroup(group.id)
    expect(g.members.find((m) => m.userId === dave)).toMatchObject({ placeholder: true, guest: false, active: true })
    expect((await preview(code)).placeholders.map((p) => p.name)).toEqual(['Dave', 'Zed'])
    expect((await db().select().from(expenses)).map((e) => e.paidBy)).toEqual([dave])

    // Claiming it again signs in as the same id, with the history intact, and isn't a new join.
    const again = await joinAsGuest(code, { claim: dave })
    expect(again.member.userId).toBe(dave)
    expect(await joinedAt()).toBe(firstJoin)
    expect((await (await app.guest(again.token)(`/groups/${group.id}/expenses`)).json()) as unknown[]).toHaveLength(1)
  })

  it('lets a signed-in account claim a signed-out guest’s name, like a placeholder', async () => {
    const group = await createGroup()
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    expect((await expense(group.id, { amountCents: 400, paidBy: zed.member.userId, split: { type: 'equal', participantIds: [zed.member.userId] } }, app.guest(zed.token))).status).toBe(201)
    const code = await resetLink(group.id)

    expect((await bob(`/invites/${code}/join`, json('POST', { claim: zed.member.userId }))).status).toBe(200)

    expect((await db().select().from(expenses)).map((e) => e.paidBy)).toEqual(['bob'])
    expect(await db().select().from(users).where(eq(users.id, zed.member.userId))).toEqual([])
  })
})

describe('POST /groups/:id/members/:userId/release', () => {
  it('signs that guest out (a lost phone) and frees the name', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    const { token } = await joinAsGuest(group.inviteCode, { claim: dave })
    const other = await joinAsGuest(group.inviteCode, { name: 'Zed' })

    const res = await alice(`/groups/${group.id}/members/${dave}/release`, { method: 'POST' })

    expect(res.status).toBe(204)
    const released = await app.guest(token)(`/groups/${group.id}`)
    expect(released.status).toBe(401)
    expect(await errorCode(released)).toBe('guest_signed_out')
    expect((await app.guest(other.token)(`/groups/${group.id}`)).status).toBe(200)
    expect((await preview(group.inviteCode)).placeholders.map((p) => p.userId)).toEqual([dave])
  })

  it('is for the owner, and for guests only', async () => {
    const group = await createGroup(['Dave'])
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    await bob(`/invites/${group.inviteCode}/join`, { method: 'POST' })
    const release = (userId: string, as: Send = alice) => as(`/groups/${group.id}/members/${userId}/release`, { method: 'POST' })
    expect((await release(zed.member.userId, bob)).status).toBe(403)
    expect((await release(zed.member.userId, app.guest(zed.token))).status).toBe(403)
    expect((await release('bob')).status).toBe(404)
    expect((await release(idOf(group, 'Dave'))).status).toBe(404)
    expect((await release('alice')).status).toBe(404)
  })
})

describe('removing a guest', () => {
  it('is 409 name_in_use once anything names them, else deletes them and their sessions', async () => {
    const group = await createGroup()
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    const yan = await joinAsGuest(group.inviteCode, { name: 'Yan' })
    expect((await expense(group.id, { amountCents: 100, paidBy: zed.member.userId, split: { type: 'equal', participantIds: [zed.member.userId] } })).status).toBe(201)

    const used = await alice(`/groups/${group.id}/members/${zed.member.userId}`, { method: 'DELETE' })
    expect(used.status).toBe(409)
    expect(await errorCode(used)).toBe('name_in_use')

    expect((await alice(`/groups/${group.id}/members/${yan.member.userId}`, { method: 'DELETE' })).status).toBe(204)
    expect(await db().select().from(users).where(eq(users.id, yan.member.userId))).toEqual([])
    expect((await app.guest(yan.token)(`/groups/${group.id}`)).status).toBe(401)
  })
})

describe('POST /groups/:id/guest/upgrade', () => {
  it('moves the guest, their membership and every reference to the account, and deletes the guest', async () => {
    const group = await createGroup(['Dave'])
    const dave = idOf(group, 'Dave')
    const look = { animal: 'penguin', color: 'lemon' } as const
    const { token } = await joinAsGuest(group.inviteCode, { claim: dave, avatar: look })
    const asDave = app.guest(token)
    expect((await expense(group.id, { amountCents: 900, paidBy: dave, split: { type: 'equal', participantIds: ['alice', dave] } }, asDave)).status).toBe(201)
    expect((await asDave(`/groups/${group.id}/spins`, { method: 'POST' })).status).toBe(201)

    const res = await app.guest(token, 'bob')(`/groups/${group.id}/guest/upgrade`, { method: 'POST' })

    expect(res.status).toBe(200)
    const g = (await res.json()) as GroupDTO
    expect(g.members.find((m) => m.userId === 'bob')).toMatchObject({ displayName: 'Dave', avatar: look, guest: false, placeholder: false })
    expect(g.members.some((m) => m.userId === dave)).toBe(false)
    expect(await db().select().from(users).where(eq(users.id, dave))).toEqual([])
    expect(await db().select().from(guestSessions)).toEqual([])
    const [e] = await db().select().from(expenses)
    expect(e).toMatchObject({ paidBy: 'bob', createdBy: 'bob' })
    expect((await db().select().from(expenseShares)).map((s) => s.userId).sort()).toEqual(['alice', 'bob'])
    expect((await db().select().from(spins))[0]).toMatchObject({ spunBy: 'bob' })
    expect((await db().select().from(spins))[0]!.weightsJson).not.toContain(dave)
    expect((await getGroup(group.id, bob)).id).toBe(group.id)
    expect(((await (await bob('/groups')).json()) as { id: string }[]).map((s) => s.id)).toEqual([group.id])
    expect((await asDave(`/groups/${group.id}`)).status).toBe(401)
  })

  it('is 409 already_in_group when the account has been in the group, changing nothing', async () => {
    const group = await createGroup()
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    await bob(`/invites/${group.inviteCode}/join`, { method: 'POST' })

    const res = await app.guest(zed.token, 'bob')(`/groups/${group.id}/guest/upgrade`, { method: 'POST' })

    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('already_in_group')
    expect((await app.guest(zed.token)(`/groups/${group.id}`)).status).toBe(200)
  })

  it('needs both a sign-in and the guest token for that group', async () => {
    const group = await createGroup()
    const other = await createGroup()
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    const upgrade = (as: Send, groupId = group.id) => as(`/groups/${groupId}/guest/upgrade`, { method: 'POST' })
    expect((await upgrade(bob)).status).toBe(401)
    expect((await upgrade(app.guest(zed.token))).status).toBe(401)
    expect((await upgrade(app.guest('x'.repeat(43), 'bob'))).status).toBe(401)
    expect((await upgrade(app.guest(zed.token, 'bob'), other.id)).status).toBe(404)
    // A sign-in that fails with a live guest token is the account's problem: the guest stays signed in.
    for (const res of [await upgrade(app.guest(zed.token)), await upgrade(app.guest(zed.token, ''))]) {
      expect(res.status).toBe(401)
      expect(await errorCode(res)).toBe('unauthenticated')
    }
    expect((await app.guest(zed.token)(`/groups/${group.id}`)).status).toBe(200)
    expect(await db().select().from(memberships).where(and(eq(memberships.groupId, group.id), eq(memberships.userId, 'bob')))).toEqual([])
  })
})

describe('settling up with a guest', () => {
  it('is pending until the guest confirms it', async () => {
    const group = await createGroup()
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    const zedId = zed.member.userId
    expect((await expense(group.id, { amountCents: 1000, paidBy: zedId, split: { type: 'equal', participantIds: ['alice', zedId] } })).status).toBe(201)

    const res = await alice(`/groups/${group.id}/settlements`, json('POST', { toUserId: zedId, amountCents: 500 }))
    expect(res.status).toBe(201)
    const s = (await res.json()) as SettlementDTO
    expect(s.status).toBe('pending')

    const confirmed = await app.guest(zed.token)(`/settlements/${s.id}/confirm`, { method: 'POST' })
    expect(confirmed.status).toBe(200)
    expect(((await confirmed.json()) as SettlementDTO).status).toBe('confirmed')
  })

  it('counts straight away, like a placeholder’s, while the guest is signed out everywhere', async () => {
    const group = await createGroup()
    const zed = await joinAsGuest(group.inviteCode, { name: 'Zed' })
    const zedId = zed.member.userId
    expect((await expense(group.id, { amountCents: 1000, paidBy: 'alice', split: { type: 'equal', participantIds: ['alice', zedId] } })).status).toBe(201)
    await resetLink(group.id)

    const res = await alice(`/groups/${group.id}/settlements`, json('POST', { fromUserId: zedId, toUserId: 'alice', amountCents: 500 }))

    expect(res.status).toBe(201)
    expect(((await res.json()) as SettlementDTO).status).toBe('confirmed')
  })
})
