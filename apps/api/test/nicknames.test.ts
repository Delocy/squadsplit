import { describe, expect, it } from 'vitest'
import { type ApiErrorBody, type GroupDTO, type MemberDTO } from '@squadsplit/shared'
import { json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
type Send = typeof alice

async function createGroup(input: object = {}) {
  const res = await alice('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️', ...input }))
  expect(res.status).toBe(201)
  return (await res.json()) as GroupDTO & { inviteCode: string }
}

const join = (as: Send, code: string, body?: object) =>
  as(`/invites/${code}/join`, body === undefined ? { method: 'POST' } : json('POST', body))
const leave = (as: Send, groupId: string, userId: string) => as(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' })
const updateMe = (as: Send, groupId: string, body: unknown) => as(`/groups/${groupId}/members/me`, json('PATCH', body))

async function memberOf(groupId: string, userId: string) {
  const group = (await (await alice(`/groups/${groupId}`)).json()) as GroupDTO
  const member = group.members.find((m) => m.userId === userId)
  return member && { displayName: member.displayName, nickname: member.nickname }
}

const errorCode = async (res: Response) => ((await res.json()) as ApiErrorBody).error.code

describe('POST /groups nickname', () => {
  it("names the owner by their nickname, keeping the profile name when there isn't one", async () => {
    const named = await createGroup({ nickname: '  Captain  ' })
    const plain = await createGroup()

    expect(named.members[0]).toMatchObject({ displayName: 'Captain', nickname: 'Captain' })
    expect(plain.members[0]).toMatchObject({ displayName: 'User alice', nickname: null })
  })

  it('is 422 for a nickname with emoji, and creates nothing', async () => {
    const res = await alice('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️', nickname: 'Al 🍕' }))

    expect(res.status).toBe(422)
    expect(await (await alice('/groups')).json()).toEqual([])
  })
})

describe('POST /invites/:code/join nickname', () => {
  it('stores the nickname as the effective name in the group', async () => {
    const group = await createGroup()

    expect((await join(bob, group.inviteCode, { nickname: 'Bobby' })).status).toBe(200)

    expect(await memberOf(group.id, 'bob')).toEqual({ displayName: 'Bobby', nickname: 'Bobby' })
  })

  it('uses the profile name without a nickname, or with a blank one', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    await join(carol, group.inviteCode, { nickname: '   ' })

    expect(await memberOf(group.id, 'bob')).toEqual({ displayName: 'User bob', nickname: null })
    expect(await memberOf(group.id, 'carol')).toEqual({ displayName: 'User carol', nickname: null })
  })

  it('lets two members share a nickname', async () => {
    const group = await createGroup({ nickname: 'Sam' })

    expect((await join(bob, group.inviteCode, { nickname: 'Sam' })).status).toBe(200)
  })

  it('is 422 for a nickname that is too long or has control characters, and does not join', async () => {
    const group = await createGroup()

    expect((await join(bob, group.inviteCode, { nickname: 'x'.repeat(25) })).status).toBe(422)
    expect((await join(bob, group.inviteCode, { nickname: 'Bob\u0007' })).status).toBe(422)
    expect(await memberOf(group.id, 'bob')).toBeUndefined()
  })

  it('keeps a former member’s nickname when they rejoin without one, and replaces it when they send one', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { nickname: 'Bobby' })
    await leave(bob, group.id, 'bob')
    await join(bob, group.inviteCode)
    expect(await memberOf(group.id, 'bob')).toEqual({ displayName: 'Bobby', nickname: 'Bobby' })

    await leave(bob, group.id, 'bob')
    await join(bob, group.inviteCode, { nickname: 'Rob' })
    expect(await memberOf(group.id, 'bob')).toEqual({ displayName: 'Rob', nickname: 'Rob' })
  })

  it('does not change an active member’s nickname', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { nickname: 'Bobby' })

    expect((await join(bob, group.inviteCode, { nickname: 'Rob' })).status).toBe(200)

    expect(await memberOf(group.id, 'bob')).toEqual({ displayName: 'Bobby', nickname: 'Bobby' })
  })
})

describe('PATCH /groups/:id/members/me nickname', () => {
  it('sets the nickname and returns the member with it as their name', async () => {
    const group = await createGroup()

    const res = await updateMe(alice, group.id, { nickname: ' Captain ' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject<Partial<MemberDTO>>({ userId: 'alice', displayName: 'Captain', nickname: 'Captain' })
  })

  it('clears it with null or an empty string', async () => {
    const group = await createGroup({ nickname: 'Captain' })
    expect((await updateMe(alice, group.id, { nickname: null })).status).toBe(200)
    expect(await memberOf(group.id, 'alice')).toEqual({ displayName: 'User alice', nickname: null })

    await updateMe(alice, group.id, { nickname: 'Captain' })
    expect((await updateMe(alice, group.id, { nickname: '' })).status).toBe(200)
    expect(await memberOf(group.id, 'alice')).toEqual({ displayName: 'User alice', nickname: null })
  })

  it('leaves the nickname alone when only the avatar changes, and the avatar alone when only the nickname does', async () => {
    const group = await createGroup({ nickname: 'Captain' })
    const before = group.members[0]!.avatar

    await updateMe(alice, group.id, { avatar: { animal: 'koala', color: 'mint' } })
    expect(await memberOf(group.id, 'alice')).toEqual({ displayName: 'Captain', nickname: 'Captain' })

    const res = await updateMe(alice, group.id, { nickname: 'Skipper' })
    expect(((await res.json()) as MemberDTO).avatar).toEqual({ animal: 'koala', color: 'mint' })
    expect(before).not.toEqual({ animal: 'koala', color: 'mint' })
  })

  it('saves both together', async () => {
    const group = await createGroup()

    const res = await updateMe(alice, group.id, { nickname: 'Captain', avatar: { animal: 'koala', color: 'mint' } })

    expect(await res.json()).toMatchObject({ displayName: 'Captain', avatar: { animal: 'koala', color: 'mint' } })
  })

  it('changes nothing when the avatar is taken, even if the nickname is fine', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: { animal: 'fox', color: 'peach' } })

    const res = await updateMe(alice, group.id, { nickname: 'Captain', avatar: { animal: 'fox', color: 'peach' } })

    expect(res.status).toBe(409)
    expect(await memberOf(group.id, 'alice')).toEqual({ displayName: 'User alice', nickname: null })
  })

  it('is 422 for an empty body or an invalid nickname', async () => {
    const group = await createGroup()

    expect(await errorCode(await updateMe(alice, group.id, {}))).toBe('validation_failed')
    expect((await updateMe(alice, group.id, { nickname: 'Al 🍕' })).status).toBe(422)
  })

  it('is 404 for a non-member', async () => {
    const group = await createGroup()

    expect((await updateMe(carol, group.id, { nickname: 'Carol' })).status).toBe(404)
  })
})
