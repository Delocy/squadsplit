import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuickSplitDTO, QuickSplitInput, QuickSplitSummaryDTO } from '@squadsplit/shared'
import { fakeApi, renderApp, type Handler } from './harness'
import { readmeSplit } from './quick-fixtures'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const EMOJI = /\p{Extended_Pictographic}/u
const WEI_LING_TICK = '2026-11-19T05:52:00.000Z'

/** The owner's API for the README split, holding its ticks and link as the server would. */
function ownerApi(extra: Record<string, Handler> = {}) {
  let paid: Record<string, [string, 'guest' | 'payer']> = { weiling: [WEI_LING_TICK, 'guest'] }
  let share = readmeSplit().share
  const current = (): QuickSplitDTO => ({ ...readmeSplit({}, paid), share })
  const mark = (id: string) => (body: unknown) => {
    const { [id]: _was, ...rest } = paid
    paid = (body as { paid: boolean }).paid ? { ...rest, [id]: ['2026-11-19T06:14:00.000Z', 'payer'] } : rest
    return { status: 200, body: current() }
  }
  const calls = fakeApi({
    'GET /quick-splits/q1': () => ({ status: 200, body: current() }),
    'GET /quick-splits': () => ({ status: 200, body: [] }),
    'PATCH /quick-splits/q1/people/arjun': mark('arjun'),
    'PATCH /quick-splits/q1/people/weiling': mark('weiling'),
    'POST /quick-splits/q1/share/stop': () => {
      share = { ...share, revokedAt: '2026-11-19T07:00:00.000Z', state: 'off' }
      return { status: 200, body: current() }
    },
    'DELETE /quick-splits/q1': () => ({ status: 204 }),
    'GET /groups': () => ({ status: 200, body: [] }),
    'PUT /quick-splits/q1': (body) => ({ status: 200, body: { ...current(), title: (body as QuickSplitInput).title } }),
    ...extra,
  })
  return calls
}

const history = async () => within(await screen.findByRole('region', { name: 'Who has paid' }))
const row = (h: ReturnType<typeof within>, name: string) => within(h.getByRole('listitem', { name }))

describe("the payer's quick split page", () => {
  it('shows who has ticked, who ticked them and when, and the link', async () => {
    ownerApi()
    renderApp('/quick/q1')
    const h = await history()
    expect(h.getByText('2 of 3 paid')).toBeTruthy()
    expect(h.getByText(/you paid \$110\.43/)).toBeTruthy()
    expect(row(h, 'You').getByText('You paid the bill')).toBeTruthy()
    expect(row(h, 'Wei Ling').getByText(/^Ticked by Wei Ling · \d{1,2}:52(am|pm)$/)).toBeTruthy()
    expect(row(h, 'Arjun').getByText('Not ticked yet')).toBeTruthy()
    expect(h.getByText('Link on')).toBeTruthy()
    expect(h.getByText(/\/s\/tok_7fK2qaAAAAAAAAAAAAAA$/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Share card' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(EMOJI)
  })

  it('lets the payer mark someone paid, and undo a tick', async () => {
    const calls = ownerApi()
    renderApp('/quick/q1')
    const h = await history()
    fireEvent.click(h.getByRole('button', { name: 'Mark Arjun paid' }))
    expect(await row(h, 'Arjun').findByText(/^Marked paid by you · \d{1,2}:14(am|pm)$/)).toBeTruthy()
    expect(await h.findByText('All paid')).toBeTruthy()
    fireEvent.click(h.getByRole('button', { name: 'Untick Wei Ling' }))
    expect(await row(h, 'Wei Ling').findByText('Not ticked yet')).toBeTruthy()
    expect(calls.filter((c) => c.key.startsWith('PATCH')).map((c) => [c.key, c.body])).toEqual([
      ['PATCH /quick-splits/q1/people/arjun', { paid: true }],
      ['PATCH /quick-splits/q1/people/weiling', { paid: false }],
    ])
    expect(h.queryByRole('button', { name: /Dan|You/ })).toBeNull() // the payer's own tick is fixed
  })

  it('stops sharing after a confirm, and then says the link is off', async () => {
    const calls = ownerApi()
    renderApp('/quick/q1')
    const h = await history()
    fireEvent.click(h.getByRole('button', { name: 'Stop sharing' }))
    expect(calls.some((c) => c.key === 'POST /quick-splits/q1/share/stop')).toBe(false)
    fireEvent.click(h.getByRole('button', { name: 'Yes, stop sharing' }))
    expect(await h.findByText('Link off · you stopped sharing')).toBeTruthy()
    expect(h.queryByRole('button', { name: 'Stop sharing' })).toBeNull()
    expect(h.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })

  it('deletes the split after a confirm and goes back to your groups', async () => {
    const calls = ownerApi()
    const router = renderApp('/quick/q1')
    const h = await history()
    fireEvent.click(h.getByRole('button', { name: 'Delete' }))
    fireEvent.click(h.getByRole('button', { name: 'Yes, delete it' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    expect(calls.map((c) => c.key)).toContain('DELETE /quick-splits/q1')
  })

  it('edits through the flow, sending everyone with their id so their ticks stay', async () => {
    const calls = ownerApi()
    const router = renderApp('/quick/q1')
    const h = await history()
    fireEvent.click(h.getByRole('link', { name: 'Edit' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/quick/q1/edit'))
    expect(await screen.findByRole('heading', { name: 'Edit quick split' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("What's it for?"), { target: { value: 'Team lunch (fixed)' } })
    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))
    fireEvent.click(screen.getByRole('button', { name: /Next: who had what/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/quick/q1'))
    const put = calls.find((c) => c.key === 'PUT /quick-splits/q1')!.body as QuickSplitInput
    expect(put.title).toBe('Team lunch (fixed)')
    expect(put.people.map((p) => [p.id, p.name, p.isPayer])).toEqual([
      ['dan', 'Dan', true],
      ['weiling', 'Wei Ling', false],
      ['arjun', 'Arjun', false],
    ])
    expect(put.items).toEqual(readmeSplit().items.map((it) => ({ name: it.name, amountCents: it.amountCents, personIndexes: it.personIds.map((id) => ['dan', 'weiling', 'arjun'].indexOf(id)) })))
    expect(put).toMatchObject({ serviceChargeBps: 1000, gstBps: 900, place: 'Tanjong Pagar' })
  })
})

describe('the groups page', () => {
  const summary = (over: Partial<QuickSplitSummaryDTO>): QuickSplitSummaryDTO => ({
    id: 'q1', title: 'Team lunch', place: 'Tanjong Pagar', spentOn: '2026-11-19', currency: 'SGD', totalCents: 11043,
    paidCount: 2, peopleCount: 3, link: 'on', names: ['Dan', 'Wei Ling', 'Arjun'], createdAt: '2026-11-19T05:00:00.000Z', ...over,
  })

  it('offers a Quick split next to New group, and lists recent quick splits with their progress', async () => {
    fakeApi({
      'GET /groups': () => ({ status: 200, body: [{ id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'owner', myBalanceCents: 0 }] }),
      'GET /quick-splits': () => ({
        status: 200,
        body: [summary({}), summary({ id: 'q2', title: 'Dim sum', place: null, spentOn: '2026-11-14', paidCount: 3, link: 'off' })],
      }),
    })
    renderApp('/groups')
    const quick = await screen.findByRole('link', { name: 'Quick split' })
    expect(quick.getAttribute('href')).toBe('/quick/new')
    const recent = within(await screen.findByRole('region', { name: 'Recent quick splits' }))
    const lunch = recent.getByRole('link', { name: /Team lunch/ })
    expect(lunch.getAttribute('href')).toBe('/quick/q1')
    expect(lunch.textContent).toContain('2 of 3 paid')
    expect(lunch.textContent).toContain('$110.43')
    const dimSum = recent.getByRole('link', { name: /Dim sum/ })
    expect(dimSum.textContent).toContain('All paid')
    expect(dimSum.textContent).toContain('Link off')
    expect(document.body.textContent).not.toMatch(EMOJI)
  })

  it('offers a Quick split in the empty state too, and shows no recent card without any', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 200, body: [] }), 'GET /quick-splits': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    expect(await screen.findByText('No groups yet')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Quick split' })).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Recent quick splits' })).toBeNull()
  })
})
