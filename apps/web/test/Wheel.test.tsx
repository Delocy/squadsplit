import type { FeedItem, SpinDTO } from '@squadsplit/shared'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, groupHandlers } from './group-fixtures'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
beforeEach(() => {
  // Fake timers that still follow the real clock, so findBy/waitFor keep working while we jump the 3s spin.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const spin = (over: Partial<SpinDTO> = {}): SpinDTO => ({
  id: 'w1',
  groupId: 'g1',
  spunBy: ME,
  winnerId: BOB,
  weights: { [ME]: 1, [BOB]: 3 },
  createdAt: '2026-11-19T10:00:00.000Z',
  ...over,
})
const spinItem = (s: SpinDTO): FeedItem => ({ type: 'spin', at: s.createdAt, spin: s })

const slices = () => [...document.querySelectorAll<SVGPathElement>('path[data-user]')].map((p) => p.dataset.user)
const odds = () => within(screen.getByRole('list', { name: 'Odds' }))
const count = (calls: { key: string }[], key: string) => calls.filter((c) => c.key === key).length

describe('Wheel', () => {
  it('draws a slice per current member, with the odds from the balances, before the first spin', async () => {
    fakeApi(groupHandlers({ balances: { balances: { [ME]: 3000, [BOB]: -3000 }, suggestions: [] } }))
    renderApp('/groups/g1/wheel')

    expect(await screen.findByRole('heading', { name: 'Who pays next?' })).toBeTruthy()
    // Carol has left the group, so she is not on the wheel. Slices go in user-id order, as after a spin.
    expect(slices()).toEqual([BOB, ME])
    // Bob owes the most: weight 1 + 3 = 4 against your 1.
    expect(await odds().findByText('80%')).toBeTruthy()
    expect(odds().getByText('Alice').querySelector('b')!.textContent).toBe('20%')
    expect(odds().getByText('Bob')).toBeTruthy()
    expect(screen.getByText('Spin to find out')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('gives everyone an equal slice when nobody owes anything', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/wheel')
    await screen.findByRole('heading', { name: 'Who pays next?' })
    expect(await odds().findAllByText('50%')).toHaveLength(2)
  })

  it("spins to the server's winner and announces them when the 3s animation ends", async () => {
    const calls = fakeApi(groupHandlers({}, { 'POST /groups/g1/spins': () => ({ status: 201, body: spin() }) }))
    renderApp('/groups/g1/wheel')
    fireEvent.click(await screen.findByRole('button', { name: 'Spin' }))

    // The slices and odds now come from the server's weights (ids sorted: Bob, then you).
    expect(await screen.findByText('Spinning…')).toBeTruthy()
    expect(slices()).toEqual([BOB, ME])
    expect(odds().getByText('75%')).toBeTruthy()
    expect(odds().getByText('25%')).toBeTruthy()
    // Bob's slice covers 0°–270° from the top, so its centre (135°) lands under the pointer after five turns.
    const wheel = screen.getByRole('img', { name: 'The wheel' })
    expect(wheel.style.transform).toBe('rotate(2025deg)')
    expect((screen.getByRole('button', { name: 'Spin' }) as HTMLButtonElement).disabled).toBe(true)

    const feedReads = count(calls, 'GET /groups/g1/feed')
    act(() => vi.advanceTimersByTime(2900))
    expect(screen.queryByText('Bob pays next')).toBeNull()
    // No spoilers: the feed (which lists the spin) is only refetched once the wheel stops.
    expect(count(calls, 'GET /groups/g1/feed')).toBe(feedReads)

    act(() => vi.advanceTimersByTime(200))
    expect(within(screen.getByRole('status')).getByText('Bob pays next')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Spin' }) as HTMLButtonElement).disabled).toBe(false)
    await vi.waitFor(() => expect(count(calls, 'GET /groups/g1/feed')).toBeGreaterThan(feedReads))
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('says "You pay next" when you are picked, and spins on from where it stopped', async () => {
    const replies = [spin({ id: 'w1', winnerId: BOB }), spin({ id: 'w2', winnerId: ME })]
    fakeApi(groupHandlers({}, { 'POST /groups/g1/spins': () => ({ status: 201, body: replies.shift() }) }))
    renderApp('/groups/g1/wheel')
    fireEvent.click(await screen.findByRole('button', { name: 'Spin' }))
    await screen.findByText('Spinning…')
    act(() => vi.advanceTimersByTime(3100))

    fireEvent.click(screen.getByRole('button', { name: 'Spin' }))
    await screen.findByText('Spinning…')
    // Your slice is 270°–360°, centred on 315°: 2025 + 1800 + 360 − (2025 + 315) mod 360 = 4005.
    expect(screen.getByRole('img', { name: 'The wheel' }).style.transform).toBe('rotate(4005deg)')
    act(() => vi.advanceTimersByTime(3100))
    expect(within(screen.getByRole('status')).getByText('You pay next')).toBeTruthy()
  })

  it('shows why the wheel could not spin', async () => {
    fakeApi(
      groupHandlers({}, {
        'POST /groups/g1/spins': () => ({ status: 409, body: { error: { code: 'no_candidates', message: 'Nobody in this group can be picked' } } }),
      }),
    )
    renderApp('/groups/g1/wheel')
    fireEvent.click(await screen.findByRole('button', { name: 'Spin' }))
    expect(await screen.findByText('Nobody in this group can be picked')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Spin' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('lists the last five spins from the feed', async () => {
    const spins = [
      spin({ id: 'w6', winnerId: ME, spunBy: BOB }),
      spin({ id: 'w5', winnerId: BOB }),
      spin({ id: 'w4', winnerId: BOB }),
      spin({ id: 'w3', winnerId: BOB }),
      spin({ id: 'w2', winnerId: BOB }),
      spin({ id: 'w1', winnerId: BOB }),
    ]
    fakeApi(groupHandlers({ feed: [spinItem(spins[0]!), { type: 'join', at: '2026-11-18T10:00:00.000Z', userId: BOB }, ...spins.slice(1).map(spinItem)] }))
    renderApp('/groups/g1/wheel')

    const recent = within(await screen.findByRole('region', { name: 'Recent spins' }))
    const rows = await recent.findAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('.t')!.textContent)).toEqual([
      'You were picked',
      'Bob was picked',
      'Bob was picked',
      'Bob was picked',
      'Bob was picked',
    ])
    expect(rows[0]!.textContent).toContain('Spun by Bob')
  })
})
