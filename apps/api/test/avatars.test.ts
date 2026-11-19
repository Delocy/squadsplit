import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  defaultAvatar,
  firstFreeAvatar,
  sameAvatar,
  type ApiErrorBody,
  type AvatarChoice,
  type GroupDTO,
  type InvitePreviewDTO,
  type MemberDTO,
} from '@squadsplit/shared'
import { memberships } from '../src/db/schema'
import { db, json, testApp } from './helpers'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
const carol = app.as('carol')
type Send = typeof alice

const FOX: AvatarChoice = { animal: 'fox', color: 'peach' }
const KOALA: AvatarChoice = { animal: 'koala', color: 'mint' }

async function createGroup() {
  const res = await alice('/groups', json('POST', { name: 'Bali trip', emoji: '🏝️' }))
  expect(res.status).toBe(201)
  return (await res.json()) as GroupDTO & { inviteCode: string }
}

const join = (as: Send, code: string, body?: object) =>
  as(`/invites/${code}/join`, body === undefined ? { method: 'POST' } : json('POST', body))
const leave = (as: Send, groupId: string, userId: string) => as(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' })
const setAvatar = (as: Send, groupId: string, avatar: unknown) => as(`/groups/${groupId}/members/me`, json('PATCH', { avatar }))

async function avatarOf(groupId: string, userId: string): Promise<AvatarChoice | undefined> {
  const group = (await (await alice(`/groups/${groupId}`)).json()) as GroupDTO
  return group.members.find((m) => m.userId === userId)?.avatar
}

const storedRow = async (groupId: string, userId: string) =>
  db()
    .select({ animal: memberships.avatarAnimal, color: memberships.avatarColor })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)))
    .get()

async function errorOf(res: Response) {
  return ((await res.json()) as ApiErrorBody).error
}

describe('POST /groups', () => {
  it("stores the owner's default avatar and returns it on the member", async () => {
    const group = await createGroup()

    expect(group.members[0]?.avatar).toEqual(defaultAvatar('alice'))
    expect(await storedRow(group.id, 'alice')).toEqual(defaultAvatar('alice'))
  })
})

describe('GET /groups/:id', () => {
  it('shows the default avatar for a member stored before avatars existed (null columns)', async () => {
    const group = await createGroup()
    await db().update(memberships).set({ avatarAnimal: null, avatarColor: null }).where(eq(memberships.userId, 'alice'))

    expect(await avatarOf(group.id, 'alice')).toEqual(defaultAvatar('alice'))
  })
})

describe('GET /invites/:code takenAvatars', () => {
  it("lists the active members' avatars, not former members'", async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await join(carol, group.inviteCode, { avatar: KOALA })
    expect((await leave(carol, group.id, 'carol')).status).toBe(204)

    const preview = (await (await app.as('dave')(`/invites/${group.inviteCode}`)).json()) as InvitePreviewDTO

    expect(preview.takenAvatars).toEqual([defaultAvatar('alice'), FOX])
  })
})

describe('POST /invites/:code/join with an avatar', () => {
  it('stores the chosen avatar', async () => {
    const group = await createGroup()

    const res = await join(bob, group.inviteCode, { avatar: FOX })

    expect(res.status).toBe(200)
    expect(await avatarOf(group.id, 'bob')).toEqual(FOX)
  })

  it('is 409 avatar_taken when an active member already has it, and does not join', async () => {
    const group = await createGroup()

    const res = await join(bob, group.inviteCode, { avatar: defaultAvatar('alice') })

    expect(res.status).toBe(409)
    expect(await errorOf(res)).toEqual({ code: 'avatar_taken', message: 'Someone in this group already looks like that — pick another.' })
    expect(await storedRow(group.id, 'bob')).toBeUndefined()
  })

  it("lets a joiner take a former member's avatar", async () => {
    const group = await createGroup()
    await join(carol, group.inviteCode, { avatar: FOX })
    await leave(carol, group.id, 'carol')

    expect((await join(bob, group.inviteCode, { avatar: FOX })).status).toBe(200)
  })

  it('is 422 for an avatar outside the palette', async () => {
    const group = await createGroup()

    const res = await join(bob, group.inviteCode, { avatar: { animal: 'dog', color: 'peach' } })

    expect(res.status).toBe(422)
    expect((await errorOf(res)).code).toBe('validation_failed')
  })

  it('is 422 for a body that is not JSON', async () => {
    const group = await createGroup()

    const res = await bob(`/invites/${group.inviteCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    })

    expect(res.status).toBe(422)
  })
})

describe('POST /invites/:code/join without an avatar', () => {
  it('gives the joiner their default avatar when it is free (no body, or an empty object)', async () => {
    const group = await createGroup()

    expect((await join(bob, group.inviteCode)).status).toBe(200)
    expect((await join(carol, group.inviteCode, {})).status).toBe(200)

    expect(await avatarOf(group.id, 'bob')).toEqual(defaultAvatar('bob'))
    expect(await storedRow(group.id, 'bob')).toEqual(defaultAvatar('bob'))
    expect(await avatarOf(group.id, 'carol')).toEqual(defaultAvatar('carol'))
  })

  it('walks on to the first free avatar when the default is taken', async () => {
    const group = await createGroup()
    expect((await setAvatar(alice, group.id, defaultAvatar('bob'))).status).toBe(200)

    expect((await join(bob, group.inviteCode)).status).toBe(200)

    const expected = firstFreeAvatar(defaultAvatar('bob'), [defaultAvatar('bob')])
    expect(expected).not.toEqual(defaultAvatar('bob'))
    expect(await avatarOf(group.id, 'bob')).toEqual(expected)
  })
})

describe('POST /invites/:code/join for a former member', () => {
  it('reuses their old avatar when it is still free', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await leave(bob, group.id, 'bob')

    expect((await join(bob, group.inviteCode)).status).toBe(200)

    expect(await avatarOf(group.id, 'bob')).toEqual(FOX)
  })

  it('moves them to the first free avatar when someone took theirs while they were away', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await leave(bob, group.id, 'bob')
    await join(carol, group.inviteCode, { avatar: FOX })

    expect((await join(bob, group.inviteCode)).status).toBe(200)

    const taken = [defaultAvatar('alice'), FOX]
    expect(await avatarOf(group.id, 'bob')).toEqual(firstFreeAvatar(FOX, taken))
  })

  it('takes a newly chosen avatar, with the same 409 when it is taken', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await leave(bob, group.id, 'bob')

    expect((await join(bob, group.inviteCode, { avatar: defaultAvatar('alice') })).status).toBe(409)
    expect((await join(bob, group.inviteCode, { avatar: KOALA })).status).toBe(200)
    expect(await avatarOf(group.id, 'bob')).toEqual(KOALA)
  })
})

describe('POST /invites/:code/join for an active member', () => {
  it('stays a 200 no-op and keeps their avatar, even if they send another', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })

    const res = await join(bob, group.inviteCode, { avatar: KOALA })

    expect(res.status).toBe(200)
    expect(await avatarOf(group.id, 'bob')).toEqual(FOX)
  })
})

describe('PATCH /groups/:id/members/me with an avatar', () => {
  it('changes the caller’s avatar and returns their member', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })

    const res = await setAvatar(bob, group.id, KOALA)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<MemberDTO>({
      userId: 'bob', displayName: 'User bob', nickname: null, avatarUrl: null, role: 'member', active: true, avatar: KOALA, placeholder: false, guest: false,
    })
    expect(await avatarOf(group.id, 'bob')).toEqual(KOALA)
  })

  it('is 200 for the avatar the caller already has', async () => {
    const group = await createGroup()

    const res = await setAvatar(alice, group.id, defaultAvatar('alice'))

    expect(res.status).toBe(200)
  })

  it('is 409 avatar_taken when another active member has it', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })

    const res = await setAvatar(alice, group.id, FOX)

    expect(res.status).toBe(409)
    expect((await errorOf(res)).code).toBe('avatar_taken')
    expect(await avatarOf(group.id, 'alice')).toEqual(defaultAvatar('alice'))
  })

  it('counts a member stored before avatars existed as having their default', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await db().update(memberships).set({ avatarAnimal: null, avatarColor: null }).where(eq(memberships.userId, 'alice'))

    const res = await setAvatar(bob, group.id, defaultAvatar('alice'))

    expect(res.status).toBe(409)
  })

  it("lets the caller take a former member's avatar", async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await leave(bob, group.id, 'bob')

    expect((await setAvatar(alice, group.id, FOX)).status).toBe(200)
  })

  it('is 422 for an avatar outside the palette', async () => {
    const group = await createGroup()

    const res = await setAvatar(alice, group.id, { animal: 'fox', color: 'red' })

    expect(res.status).toBe(422)
    expect((await errorOf(res)).code).toBe('validation_failed')
  })

  it('is 404 for a non-member and for a former member', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode)
    await leave(bob, group.id, 'bob')

    expect((await setAvatar(carol, group.id, FOX)).status).toBe(404)
    expect((await setAvatar(bob, group.id, FOX)).status).toBe(404)
  })
})

describe('GET /invites/:code myFormerAvatar', () => {
  it('is null for a newcomer and for an active member', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })

    const forCarol = (await (await carol(`/invites/${group.inviteCode}`)).json()) as InvitePreviewDTO
    const forBob = (await (await bob(`/invites/${group.inviteCode}`)).json()) as InvitePreviewDTO

    expect(forCarol.myFormerAvatar).toBeNull()
    expect(forBob.myFormerAvatar).toBeNull()
  })

  it('is the look a former member left with, or their default when they never stored one', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await join(carol, group.inviteCode)
    await db().update(memberships).set({ avatarAnimal: null, avatarColor: null }).where(eq(memberships.userId, 'carol'))
    await leave(bob, group.id, 'bob')
    await leave(carol, group.id, 'carol')

    const forBob = (await (await bob(`/invites/${group.inviteCode}`)).json()) as InvitePreviewDTO
    const forCarol = (await (await carol(`/invites/${group.inviteCode}`)).json()) as InvitePreviewDTO

    expect(forBob.myFormerAvatar).toEqual(FOX)
    expect(forCarol.myFormerAvatar).toEqual(defaultAvatar('carol'))
  })
})

const stored = (avatar: AvatarChoice) => ({ avatarAnimal: avatar.animal, avatarColor: avatar.color })

/** A user id other than `userId` whose default look is the same as `userId`'s. */
function defaultTwinOf(userId: string): string {
  for (let i = 0; ; i++) {
    const candidate = `twin-${i}`
    if (candidate !== userId && sameAvatar(defaultAvatar(candidate), defaultAvatar(userId))) return candidate
  }
}

describe('no two active members ever look the same', () => {
  it('moves the later joiner on when two members without a stored look share a default', async () => {
    const group = await createGroup()
    const twin = defaultTwinOf('alice')
    await join(app.as(twin), group.inviteCode)
    await db().update(memberships).set({ avatarAnimal: null, avatarColor: null })

    const shifted = firstFreeAvatar(defaultAvatar('alice'), [defaultAvatar('alice')])
    expect(await avatarOf(group.id, 'alice')).toEqual(defaultAvatar('alice'))
    expect(await avatarOf(group.id, twin)).toEqual(shifted)
    const preview = (await (await carol(`/invites/${group.inviteCode}`)).json()) as InvitePreviewDTO
    expect(preview.takenAvatars).toEqual([defaultAvatar('alice'), shifted])
  })

  it('moves a later stored look that matches an earlier member’s default, and keeps both looks taken', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await db().update(memberships).set({ avatarAnimal: null, avatarColor: null }).where(eq(memberships.userId, 'alice'))
    await db().update(memberships).set(stored(defaultAvatar('alice'))).where(eq(memberships.userId, 'bob'))

    const shifted = firstFreeAvatar(defaultAvatar('alice'), [defaultAvatar('alice')])
    expect(await avatarOf(group.id, 'bob')).toEqual(shifted)
    expect((await join(carol, group.inviteCode, { avatar: shifted })).status).toBe(409)
    expect((await setAvatar(alice, group.id, shifted)).status).toBe(409)
  })

  it('refuses a second active member with the same stored look at the database, but not a former one', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: FOX })
    await leave(bob, group.id, 'bob')
    expect((await join(carol, group.inviteCode, { avatar: FOX })).status).toBe(200) // bob, who left, still has it stored

    await expect(
      env.DB.prepare(`UPDATE memberships SET avatar_animal = 'fox', avatar_color = 'peach' WHERE user_id = 'alice'`).run(),
    ).rejects.toThrow(/UNIQUE constraint failed/)
  })

  it('lets only one of two people joining at once take the same look', async () => {
    const group = await createGroup()

    const results = await Promise.all([join(bob, group.inviteCode, { avatar: FOX }), join(carol, group.inviteCode, { avatar: FOX })])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const refused = results.find((r) => r.status === 409)!
    expect((await errorOf(refused)).code).toBe('avatar_taken')
    const looks = [await storedRow(group.id, 'bob'), await storedRow(group.id, 'carol')]
    expect(looks.filter((l) => l?.animal === FOX.animal && l.color === FOX.color)).toHaveLength(1)
  })

  it('lets only one of two members switching at once take the same look', async () => {
    const group = await createGroup()
    await join(bob, group.inviteCode, { avatar: KOALA })
    await join(carol, group.inviteCode)

    const results = await Promise.all([setAvatar(bob, group.id, FOX), setAvatar(carol, group.id, FOX)])

    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await errorOf(results.find((r) => r.status === 409)!)).code).toBe('avatar_taken')
  })
})
