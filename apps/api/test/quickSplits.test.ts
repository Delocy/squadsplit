import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  defaultAvatar,
  firstFreeAvatar,
  QUICK_SPLIT_LINK_DAYS,
  type ApiErrorBody,
  type QuickSplitDTO,
  type QuickSplitSummaryDTO,
} from '@squadsplit/shared'
import { json, testApp } from './helpers'
import { README_INPUT, createSplit, personNamed } from './quickSplitFixtures'

const app = testApp()
const alice = app.as('alice')
const bob = app.as('bob')
type Send = typeof alice

const errorCode = async (res: Response) => ((await res.json()) as ApiErrorBody).error.code

const getSplit = async (id: string, as: Send = alice) => {
  const res = await as(`/quick-splits/${id}`)
  expect(res.status).toBe(200)
  return (await res.json()) as QuickSplitDTO
}

/** The input that puts `split` back as it is, with ids, so an edit can change one thing. */
const asInput = (s: QuickSplitDTO) => ({
  title: s.title,
  place: s.place,
  spentOn: s.spentOn,
  serviceChargeBps: s.serviceChargeBps,
  gstBps: s.gstBps,
  people: s.people.map((p) => ({ id: p.id, name: p.name, isPayer: p.isPayer })),
  items: s.items.map((it) => ({ name: it.name, amountCents: it.amountCents, personIndexes: it.personIds.map((id) => s.people.findIndex((p) => p.id === id)) })),
})

const countRows = async (table: string, splitId: string) =>
  table === 'quick_split_item_people'
    ? env.DB.prepare(`SELECT COUNT(*) AS n FROM quick_split_item_people WHERE item_id IN (SELECT id FROM quick_split_items WHERE split_id = ?)`).bind(splitId).first<number>('n')
    : env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE split_id = ?`).bind(splitId).first<number>('n')

describe('POST /quick-splits', () => {
  it('saves the split and works the README example out to the cent', async () => {
    const s = await createSplit()
    expect(s).toMatchObject({
      title: 'Team lunch',
      place: 'Tanjong Pagar',
      spentOn: '2026-11-19',
      currency: 'SGD',
      serviceChargeBps: 1000,
      gstBps: 900,
      subtotalCents: 9210,
      serviceChargeCents: 921,
      gstCents: 912,
      totalCents: 11043,
    })
    expect(s.people.map((p) => [p.name, p.totalCents, p.isPayer])).toEqual([
      ['Dan', 3055, true],
      ['Wei Ling', 3916, false],
      ['Arjun', 4072, false],
    ])
    expect(s.payerId).toBe(s.people[0]!.id)
    expect(personNamed(s, 'Dan').dishes).toEqual([
      { name: 'Satay', shareCents: 668, sharedBy: 3 },
      { name: 'Chilli crab', shareCents: 1600, sharedBy: 3 },
      { name: 'Iced barley (2)', shareCents: 280, sharedBy: 2 },
    ])
    expect(s.items.map((it) => [it.name, it.personIds.length])).toEqual([
      ['Laksa', 1],
      ['Satay', 3],
      ['Chilli crab', 3],
      ['Char kway teow', 1],
      ['Iced barley (2)', 2],
    ])
    expect(s.people.every((p) => p.paidAt === null && p.paidMarkedBy === null)).toBe(true)
  })

  it("gives a shared dish's spare cent by entry order, as the web's preview does, whatever the saved ids are", async () => {
    const input = {
      ...README_INPUT,
      items: [
        { name: 'Laksa', amountCents: 1000, personIndexes: [0] },
        { name: 'Teh tarik', amountCents: 325, personIndexes: [1, 2] },
      ],
    }
    for (let i = 0; i < 4; i++) {
      const s = await createSplit(input)
      expect(personNamed(s, 'Wei Ling').dishes).toEqual([{ name: 'Teh tarik', shareCents: 163, sharedBy: 2 }])
      expect(personNamed(s, 'Arjun').dishes).toEqual([{ name: 'Teh tarik', shareCents: 162, sharedBy: 2 }])
      expect([personNamed(s, 'Wei Ling').totalCents, personNamed(s, 'Arjun').totalCents]).toEqual([196, 194])
    }
  })

  it(`opens a share link at once: 128 random bits as 22 base64url characters, for ${QUICK_SPLIT_LINK_DAYS} days`, async () => {
    const a = await createSplit()
    const b = await createSplit()
    expect(a.share.token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(b.share.token).not.toBe(a.share.token)
    expect(a.share.state).toBe('on')
    expect(a.share.revokedAt).toBeNull()
    expect(Date.parse(a.share.expiresAt) - Date.parse(a.createdAt)).toBe(QUICK_SPLIT_LINK_DAYS * 86_400_000)
  })

  it('starts you (the first person) on your profile look, and gives everyone else a look of their own', async () => {
    await alice('/me', json('PATCH', { profileAvatar: { animal: 'fox', color: 'peach' } }))
    const s = await createSplit()
    expect(s.people[0]!.avatar).toEqual({ animal: 'fox', color: 'peach' })
    const looks = s.people.map((p) => `${p.avatar.animal}/${p.avatar.color}`)
    expect(new Set(looks).size).toBe(3)
    const weiLing = personNamed(s, 'Wei Ling')
    expect(weiLing.avatar).toEqual(firstFreeAvatar(defaultAvatar(weiLing.id), [s.people[0]!.avatar]))
  })

  it('keeps a look the request asks for, if it is free', async () => {
    const look = firstFreeAvatar({ animal: 'koala', color: 'lilac' }, [defaultAvatar('alice')]) // not the owner's look
    const people = [README_INPUT.people[0], { ...README_INPUT.people[1], avatar: look }, README_INPUT.people[2]]
    const s = await createSplit({ ...README_INPUT, people })
    expect(personNamed(s, 'Wei Ling').avatar).toEqual(look)
  })

  it('refuses an invalid split with 422', async () => {
    const res = await alice('/quick-splits', json('POST', { ...README_INPUT, people: [{ name: 'Dan', isPayer: true }] }))
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('validation_failed')
    const tiny = await alice('/quick-splits', json('POST', { ...README_INPUT, items: [{ name: 'Mint', amountCents: 2, personIndexes: [0, 1, 2] }] }))
    expect(tiny.status).toBe(422)
  })

  it('refuses an id that is not a person in the split with 422', async () => {
    const people = [{ ...README_INPUT.people[0], id: 'made-up' }, README_INPUT.people[1], README_INPUT.people[2]]
    const res = await alice('/quick-splits', json('POST', { ...README_INPUT, people }))
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('unknown_person')
  })
})

describe('GET /quick-splits', () => {
  it("lists only the caller's splits, newest first, as summaries", async () => {
    const first = await createSplit()
    const second = await createSplit({ ...README_INPUT, title: 'Dim sum', place: null })
    await createSplit({ ...README_INPUT, title: "Bob's" }, bob)
    await alice(`/quick-splits/${first.id}/people/${personNamed(first, 'Wei Ling').id}`, json('PATCH', { paid: true }))
    await alice(`/quick-splits/${second.id}/share/stop`, { method: 'POST' })

    const res = await alice('/quick-splits')
    expect(res.status).toBe(200)
    expect((await res.json()) as QuickSplitSummaryDTO[]).toEqual([
      {
        id: second.id, title: 'Dim sum', place: null, spentOn: '2026-11-19', currency: 'SGD', totalCents: 11043,
        paidCount: 1, peopleCount: 3, link: 'off', names: ['Dan', 'Wei Ling', 'Arjun'], createdAt: second.createdAt,
      },
      {
        id: first.id, title: 'Team lunch', place: 'Tanjong Pagar', spentOn: '2026-11-19', currency: 'SGD', totalCents: 11043,
        paidCount: 2, peopleCount: 3, link: 'on', names: ['Dan', 'Wei Ling', 'Arjun'], createdAt: first.createdAt,
      },
    ])
  })

  it('says the link is off once it has expired', async () => {
    const s = await createSplit()
    await env.DB.prepare('UPDATE quick_splits SET share_expires_at = ? WHERE id = ?').bind('2026-01-01T00:00:00.000Z', s.id).run()
    const [summary] = (await (await alice('/quick-splits')).json()) as QuickSplitSummaryDTO[]
    expect(summary!.link).toBe('off')
    expect((await getSplit(s.id)).share.state).toBe('off')
  })
})

describe('the owner-only routes', () => {
  it('answers 404 to anyone but the owner, and changes nothing', async () => {
    const s = await createSplit()
    const weiLing = personNamed(s, 'Wei Ling').id
    const attempts = [
      bob(`/quick-splits/${s.id}`),
      bob(`/quick-splits/${s.id}`, json('PUT', README_INPUT)),
      bob(`/quick-splits/${s.id}`, { method: 'DELETE' }),
      bob(`/quick-splits/${s.id}/people/${weiLing}`, json('PATCH', { paid: true })),
      bob(`/quick-splits/${s.id}/share/stop`, { method: 'POST' }),
    ]
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('not_found')
    }
    expect(await getSplit(s.id)).toEqual(s)
  })

  it('needs a signed-in caller (401)', async () => {
    const s = await createSplit()
    for (const [path, init] of [
      ['/quick-splits', undefined],
      ['/quick-splits', json('POST', README_INPUT)],
      [`/quick-splits/${s.id}`, undefined],
      [`/quick-splits/${s.id}/share/stop`, { method: 'POST' }],
    ] as const) {
      expect((await app.anon(path, init)).status).toBe(401)
    }
  })
})

describe('PUT /quick-splits/:id', () => {
  it('replaces the split, keeping the ticks and looks of people sent with their id, and deleting people left out', async () => {
    const s = await createSplit()
    const weiLing = personNamed(s, 'Wei Ling')
    const arjun = personNamed(s, 'Arjun')
    await alice(`/quick-splits/${s.id}/people/${weiLing.id}`, json('PATCH', { paid: true }))
    const ticked = personNamed(await getSplit(s.id), 'Wei Ling')

    // Arjun goes, Priya comes, Wei Ling is renamed, and the bill changes.
    const input = {
      ...asInput(s),
      title: 'Team lunch (fixed)',
      people: [
        { id: s.people[0]!.id, name: 'Dan', isPayer: true },
        { id: weiLing.id, name: 'Wei Ling T', isPayer: false },
        { name: 'Priya', isPayer: false },
      ],
      items: [
        { name: 'Laksa', amountCents: 1000, personIndexes: [1] },
        { name: 'Nasi lemak', amountCents: 700, personIndexes: [2] },
      ],
    }
    const res = await alice(`/quick-splits/${s.id}`, json('PUT', input))
    expect(res.status).toBe(200)
    const after = (await res.json()) as QuickSplitDTO
    expect(after.title).toBe('Team lunch (fixed)')
    expect(after.people.map((p) => p.name)).toEqual(['Dan', 'Wei Ling T', 'Priya'])
    expect(after.people[1]).toMatchObject({ id: weiLing.id, avatar: weiLing.avatar, paidAt: ticked.paidAt, paidMarkedBy: 'payer' })
    expect(after.people[2]!.paidAt).toBeNull()
    expect(after.people.some((p) => p.id === arjun.id)).toBe(false)
    expect(after.totalCents).toBe(2038)
    expect(after.share).toEqual(s.share)
    expect(after.createdAt).toBe(s.createdAt)
    expect(await getSplit(s.id)).toEqual(after)
    expect(await countRows('quick_split_people', s.id)).toBe(3)
    expect(await countRows('quick_split_items', s.id)).toBe(2)
    expect(await countRows('quick_split_item_people', s.id)).toBe(2)
  })

  it('can make someone else the payer, whose tick no longer counts', async () => {
    const s = await createSplit()
    const weiLing = personNamed(s, 'Wei Ling')
    await alice(`/quick-splits/${s.id}/people/${weiLing.id}`, json('PATCH', { paid: true }))
    const input = asInput(s)
    input.people = input.people.map((p) => ({ ...p, isPayer: p.id === weiLing.id }))
    const res = await alice(`/quick-splits/${s.id}`, json('PUT', input))
    expect(res.status).toBe(200)
    const after = (await res.json()) as QuickSplitDTO
    expect(after.payerId).toBe(weiLing.id)
    expect(after.people[1]).toMatchObject({ isPayer: true, paidAt: null, paidMarkedBy: null })
  })

  it("refuses another split's person id with 422 unknown_person", async () => {
    const mine = await createSplit()
    const other = await createSplit()
    const input = asInput(mine)
    input.people[2]!.id = other.people[2]!.id
    const res = await alice(`/quick-splits/${mine.id}`, json('PUT', input))
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('unknown_person')
    expect(await getSplit(other.id)).toEqual(other)
  })
})

describe('DELETE /quick-splits/:id', () => {
  it('deletes the split and everything in it', async () => {
    const s = await createSplit()
    const res = await alice(`/quick-splits/${s.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect((await alice(`/quick-splits/${s.id}`)).status).toBe(404)
    for (const table of ['quick_split_people', 'quick_split_items', 'quick_split_item_people', 'quick_split_ticks']) {
      expect(await countRows(table, s.id)).toBe(0)
    }
    expect((await app.anon(`/s/${s.share.token}`)).status).toBe(404)
  })
})

describe('PATCH /quick-splits/:id/people/:personId', () => {
  it('lets the payer mark someone paid and unpaid', async () => {
    const s = await createSplit()
    const arjun = personNamed(s, 'Arjun').id
    const paid = await alice(`/quick-splits/${s.id}/people/${arjun}`, json('PATCH', { paid: true }))
    expect(paid.status).toBe(200)
    const after = personNamed((await paid.json()) as QuickSplitDTO, 'Arjun')
    expect(after.paidMarkedBy).toBe('payer')
    expect(Date.now() - Date.parse(after.paidAt!)).toBeLessThan(60_000)

    const unpaid = await alice(`/quick-splits/${s.id}/people/${arjun}`, json('PATCH', { paid: false }))
    expect(personNamed((await unpaid.json()) as QuickSplitDTO, 'Arjun')).toMatchObject({ paidAt: null, paidMarkedBy: null })
  })

  it('refuses the payer with 422, and an unknown person with 404', async () => {
    const s = await createSplit()
    const payer = await alice(`/quick-splits/${s.id}/people/${s.payerId}`, json('PATCH', { paid: false }))
    expect(payer.status).toBe(422)
    expect(await errorCode(payer)).toBe('payer_paid')
    expect((await alice(`/quick-splits/${s.id}/people/nobody`, json('PATCH', { paid: true }))).status).toBe(404)
  })
})

describe('POST /quick-splits/:id/share/stop', () => {
  it('turns the link off for good, straight away', async () => {
    const s = await createSplit()
    const res = await alice(`/quick-splits/${s.id}/share/stop`, { method: 'POST' })
    expect(res.status).toBe(200)
    const after = (await res.json()) as QuickSplitDTO
    expect(after.share.state).toBe('off')
    expect(after.share.revokedAt).not.toBeNull()
    expect((await app.anon(`/s/${s.share.token}`)).status).toBe(410)
    // Stopping again keeps the first time.
    const again = (await (await alice(`/quick-splits/${s.id}/share/stop`, { method: 'POST' })).json()) as QuickSplitDTO
    expect(again.share.revokedAt).toBe(after.share.revokedAt)
  })
})
