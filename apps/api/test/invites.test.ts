import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { defaultAvatar, MAX_GROUP_MEMBERS, type ApiErrorBody, type GroupDTO, type InvitePreviewDTO } from '@squadsplit/shared'
import { memberships } from '../src/db/schema'
import { newInviteCode } from '../src/routes/invites'
import { db, json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
type Send = typeof alice

async function createGroup() {
  const res = await alice('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️' }))
  expect(res.status).toBe(201)
  return (await res.json()) as GroupDTO & { inviteCode: string }
}

const join = (as: Send, code: string) => as(`/invites/${code}/join`, { method: 'POST' })
const preview = (as: Send, code: string) => as(`/invites/${code}`)
const membershipRows = (groupId: string, userId: string) =>
  db().select().from(memberships).where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))

describe('newInviteCode', () => {
  it('returns 8 characters from the unambiguous alphabet', () => {
    const codes = Array.from({ length: 200 }, newInviteCode)
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('GET /invites/:code', () => {
  it('previews the group with its active member count', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)

    const res = await preview(carol, group.inviteCode)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<InvitePreviewDTO>({
      groupId: group.id, name: 'Bali trip', emoji: '🏝️', memberCount: 2, alreadyMember: false,
      takenAvatars: [defaultAvatar('alice'), defaultAvatar('bob')],
    })
  })

  it('says alreadyMember for an active member, and not for one who left', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    expect(await (await preview(bob, group.inviteCode)).json()).toMatchObject({ alreadyMember: true })

    await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })

    expect(await (await preview(bob, group.inviteCode)).json()).toMatchObject({ alreadyMember: false, memberCount: 1 })
  })

  it('matches the code case-insensitively', async () => {
    const group = await createGroup()
    const res = await preview(bob, group.inviteCode.toLowerCase())
    expect(res.status).toBe(200)
  })

  it('is 404 not_found for an unknown code', async () => {
    const res = await preview(bob, 'ZZZZZZZZ')
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found')
  })
})

describe('POST /invites/:code/join', () => {
  it('makes the caller a member and returns the group id', async () => {
    const group = await createGroup()

    const res = await join(bob, group.inviteCode.toLowerCase())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ groupId: group.id })
    expect((await bob(`/groups/${group.id}`)).status).toBe(200)
    expect(await membershipRows(group.id, 'bob')).toMatchObject([{ role: 'member', leftAt: null }])
  })

  it('does nothing when the caller is already a member', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    const [before] = await membershipRows(group.id, 'bob')

    const again = await join(bob, group.inviteCode)
    const owner = await join(alice, group.inviteCode)

    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ groupId: group.id })
    expect(owner.status).toBe(200)
    expect(await membershipRows(group.id, 'bob')).toEqual([before])
    expect(await membershipRows(group.id, 'alice')).toMatchObject([{ role: 'owner', leftAt: null }])
  })

  it('reactivates a former member with a fresh join time', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    await db().update(memberships).set({ joinedAt: '2000-01-01T00:00:00.000Z' }).where(eq(memberships.userId, 'bob'))
    expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)

    expect((await join(bob, group.inviteCode)).status).toBe(200)

    const rows = await membershipRows(group.id, 'bob')
    expect(rows).toMatchObject([{ role: 'member', leftAt: null }])
    expect(rows[0]?.joinedAt).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('is 404 not_found for an unknown code', async () => {
    const res = await join(bob, 'ZZZZZZZZ')
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found')
  })
})

describe('POST /invites/:code/join with a full group', () => {
  /** Creates a group owned by alice and fills it to the cap with `filler-1` ... `filler-11`. */
  async function fullGroup() {
    const group = await createGroup()
    for (let i = 1; i < MAX_GROUP_MEMBERS; i++) {
      expect((await join(app.as(`filler-${i}`), group.inviteCode)).status).toBe(200)
    }
    return group
  }

  it('caps a group at 12 members', () => {
    expect(MAX_GROUP_MEMBERS).toBe(12)
  })

  it('is 409 group_full for a newcomer when 12 members are active', async () => {
    const group = await fullGroup()

    const res = await join(bob, group.inviteCode)

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual<ApiErrorBody>({
      error: { code: 'group_full', message: 'This group is full (12 people).' },
    })
    expect(await membershipRows(group.id, 'bob')).toEqual([])
  })

  it('still lets an active member re-join a full group (no-op)', async () => {
    const group = await fullGroup()

    const res = await join(app.as('filler-3'), group.inviteCode)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ groupId: group.id })
  })

  it('is 409 group_full for a former member when the group filled up after they left', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    expect((await bob(`/groups/${group.id}/members/bob`, { method: 'DELETE' })).status).toBe(204)
    for (let i = 1; i < MAX_GROUP_MEMBERS; i++) await join(app.as(`filler-${i}`), group.inviteCode)

    const res = await join(bob, group.inviteCode)

    expect(res.status).toBe(409)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('group_full')
    expect((await membershipRows(group.id, 'bob'))[0]?.leftAt).not.toBeNull()
  })

  it('does not count former members towards the cap', async () => {
    const group = await fullGroup()
    expect((await app.as('filler-1')(`/groups/${group.id}/members/filler-1`, { method: 'DELETE' })).status).toBe(204)

    const res = await join(bob, group.inviteCode)

    expect(res.status).toBe(200)
  })
})

describe('invite reset', () => {
  it('stops the old code working and the new code works', async () => {
    const group = await createGroup()
    const reset = await alice(`/groups/${group.id}/invite/reset`, { method: 'POST' })
    const { inviteCode } = (await reset.json()) as { inviteCode: string }

    expect((await preview(bob, group.inviteCode)).status).toBe(404)
    expect((await join(bob, group.inviteCode)).status).toBe(404)
    expect((await preview(bob, inviteCode)).status).toBe(200)
    expect((await join(bob, inviteCode)).status).toBe(200)
    expect((await bob(`/groups/${group.id}`)).status).toBe(200)
  })
})
