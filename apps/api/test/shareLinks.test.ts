import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { QUICK_SPLIT_TICKS_PER_HOUR, type ApiErrorBody, type PublicQuickSplitDTO, type QuickSplitDTO } from '@squadsplit/shared'
import { json, testApp } from './helpers'
import { createSplit, personNamed } from './quickSplitFixtures'

const app = testApp()
const alice = app.as('alice')

const view = (token: string) => app.anon(`/s/${token}`)
const tick = (token: string, personId: string, paid: boolean, init: RequestInit = {}) =>
  app.anon(`/s/${token}/people/${personId}/paid`, { ...json('POST', { paid }), ...init })
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error

describe('GET /s/:token (public, no sign-in)', () => {
  it('shows names and amounts, and nothing that identifies an account', async () => {
    const s = await createSplit()
    const res = await view(s.share.token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as PublicQuickSplitDTO

    expect(Object.keys(body).sort()).toEqual(
      ['currency', 'gstBps', 'gstCents', 'payerId', 'payerName', 'people', 'place', 'serviceChargeBps', 'serviceChargeCents', 'spentOn', 'subtotalCents', 'title', 'totalCents'].sort(),
    )
    for (const p of body.people) {
      expect(Object.keys(p).sort()).toEqual(['avatar', 'dishes', 'id', 'name', 'paidAt', 'paidMarkedBy', 'totalCents'])
      for (const d of p.dishes) expect(Object.keys(d).sort()).toEqual(['name', 'shareCents', 'sharedBy'])
    }
    const text = JSON.stringify(body)
    expect(text).not.toContain('alice')
    expect(text).not.toContain(s.share.token)
    expect(text).not.toContain(s.id)

    expect(body).toMatchObject({ title: 'Team lunch', place: 'Tanjong Pagar', spentOn: '2026-11-19', currency: 'SGD', totalCents: 11043, payerId: s.payerId, payerName: 'Dan' })
    expect(body.people.map((p) => [p.name, p.totalCents])).toEqual([
      ['Dan', 3055],
      ['Wei Ling', 3916],
      ['Arjun', 4072],
    ])
  })

  it('answers 404 not_found for a token that never existed', async () => {
    const res = await view('AAAAAAAAAAAAAAAAAAAAAA')
    expect(res.status).toBe(404)
    expect((await errorOf(res)).code).toBe('not_found')
  })

  it('answers 410 link_off, naming the payer, once the owner stops sharing', async () => {
    const s = await createSplit()
    await alice(`/quick-splits/${s.id}/share/stop`, { method: 'POST' })
    const res = await view(s.share.token)
    expect(res.status).toBe(410)
    expect(await errorOf(res)).toEqual({ code: 'link_off', message: 'This link has been turned off. Ask Dan for the breakdown.' })
  })

  it('answers 410 link_off once the link has expired', async () => {
    const s = await createSplit()
    await env.DB.prepare('UPDATE quick_splits SET share_expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), s.id).run()
    expect((await view(s.share.token)).status).toBe(410)
    expect((await tick(s.share.token, personNamed(s, 'Arjun').id, true)).status).toBe(410)
  })

  it('needs no Authorization header, while the signed-in routes still answer 401', async () => {
    const s = await createSplit()
    expect((await view(s.share.token)).status).toBe(200)
    expect((await tick(s.share.token, personNamed(s, 'Arjun').id, true)).status).toBe(200)
    expect((await app.anon('/quick-splits')).status).toBe(401)
    expect((await app.anon('/groups')).status).toBe(401)
  })

  it('ignores a bad Authorization header', async () => {
    const s = await createSplit()
    expect((await view(s.share.token)).status).toBe(200)
    const res = await app.anon(`/s/${s.share.token}`, { headers: { Authorization: 'Bearer ph_nobody' } })
    expect(res.status).toBe(200)
  })

  it('allows the web app (CORS), and nobody else', async () => {
    const s = await createSplit()
    const ok = await app.anon(`/s/${s.share.token}`, { headers: { Origin: 'http://localhost:5173' } })
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    const other = await app.anon(`/s/${s.share.token}`, { headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
    const preflight = await app.anon(`/s/${s.share.token}/people/x/paid`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})

describe('POST /s/:token/people/:personId/paid (public)', () => {
  it("ticks and unticks a guest, which the owner sees as the guest's tick", async () => {
    const s = await createSplit()
    const arjun = personNamed(s, 'Arjun').id
    const res = await tick(s.share.token, arjun, true)
    expect(res.status).toBe(200)
    const ticked = personNamed((await res.json()) as PublicQuickSplitDTO, 'Arjun')
    expect(ticked.paidMarkedBy).toBe('guest')
    expect(Date.now() - Date.parse(ticked.paidAt!)).toBeLessThan(60_000)

    const owner = (await (await alice(`/quick-splits/${s.id}`)).json()) as QuickSplitDTO
    expect(personNamed(owner, 'Arjun')).toMatchObject({ paidAt: ticked.paidAt, paidMarkedBy: 'guest' })

    // Ticking again keeps the first time.
    const again = (await (await tick(s.share.token, arjun, true)).json()) as PublicQuickSplitDTO
    expect(personNamed(again, 'Arjun')).toMatchObject({ paidAt: ticked.paidAt })

    const undone = (await (await tick(s.share.token, arjun, false)).json()) as PublicQuickSplitDTO
    expect(personNamed(undone, 'Arjun')).toMatchObject({ paidAt: null, paidMarkedBy: null })
  })

  it('refuses to tick the payer with 422', async () => {
    const s = await createSplit()
    const res = await tick(s.share.token, s.payerId, true)
    expect(res.status).toBe(422)
    expect((await errorOf(res)).code).toBe('payer_paid')
  })

  it("answers 404 for someone who isn't in this split, 404 for an unknown token and 410 for a stopped link", async () => {
    const s = await createSplit()
    const other = await createSplit()
    expect((await tick(s.share.token, personNamed(other, 'Arjun').id, true)).status).toBe(404)
    expect((await tick('AAAAAAAAAAAAAAAAAAAAAA', personNamed(s, 'Arjun').id, true)).status).toBe(404)
    await alice(`/quick-splits/${s.id}/share/stop`, { method: 'POST' })
    const res = await tick(s.share.token, personNamed(s, 'Arjun').id, true)
    expect(res.status).toBe(410)
    expect((await errorOf(res)).code).toBe('link_off')
  })

  it('refuses a body that is not { paid: boolean } with 422', async () => {
    const s = await createSplit()
    const res = await app.anon(`/s/${s.share.token}/people/${personNamed(s, 'Arjun').id}/paid`, json('POST', { paid: 'yes' }))
    expect(res.status).toBe(422)
  })

  it(`takes ${QUICK_SPLIT_TICKS_PER_HOUR} tick changes per link per hour, then answers 429 slow_down`, async () => {
    const s = await createSplit()
    const other = await createSplit()
    const arjun = personNamed(s, 'Arjun').id
    for (let i = 0; i < QUICK_SPLIT_TICKS_PER_HOUR; i++) {
      expect((await tick(s.share.token, arjun, i % 2 === 0)).status).toBe(200)
    }
    const over = await tick(s.share.token, arjun, true)
    expect(over.status).toBe(429)
    expect((await errorOf(over)).code).toBe('slow_down')
    // The tick wasn't applied, and the link can still be read.
    const now = (await (await view(s.share.token)).json()) as PublicQuickSplitDTO
    expect(personNamed(now, 'Arjun')).toMatchObject({ paidAt: null })
    // Each link has its own count.
    expect((await tick(other.share.token, personNamed(other, 'Arjun').id, true)).status).toBe(200)
  })

  it('counts each hour afresh, and keeps no IP address', async () => {
    const s = await createSplit()
    await env.DB.prepare('INSERT INTO quick_split_ticks (split_id, hour, count) VALUES (?, ?, ?)')
      .bind(s.id, '2026-01-01T09', QUICK_SPLIT_TICKS_PER_HOUR)
      .run()
    const res = await tick(s.share.token, personNamed(s, 'Arjun').id, true, { headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' } })
    expect(res.status).toBe(200)
    const rows = await env.DB.prepare('SELECT * FROM quick_split_ticks').all()
    expect(JSON.stringify(rows.results)).not.toContain('203.0.113.9')
    expect(rows.results).toEqual([{ split_id: s.id, hour: new Date().toISOString().slice(0, 13), count: 1 }])
  })
})
