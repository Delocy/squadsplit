import type { Badge, FeedItem, FunDTO } from '@squadsplit/shared'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BalanceCard } from '../src/components/BalanceCard'
import { stickerSheet } from '../src/components/StickerSheet'
import { ME } from './clerk-mock'
import { BOB, expense, group, groupHandlers, settlement } from './group-fixtures'
import { fakeApi, renderApp } from './harness'
import { mockReducedMotion } from './motion-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const badge = (key: Badge['key'], title: string, userId: string): Badge => ({ key, emoji: '', title, userId })
const fun = (badges: Badge[]): FunDTO => ({ leaderboard: [{ userId: ME, netCents: 0, rank: 1 }, { userId: BOB, netCents: 0, rank: 1 }], badges })
const payback = (status: 'pending' | 'confirmed' | 'rejected' | 'cancelled'): FeedItem => ({
  type: 'settlement',
  at: '2026-11-19T10:00:00.000Z',
  settlement: settlement({ id: 's1', status }),
})

describe('stickerSheet', () => {
  it('counts each title once, however many people hold it, out of all six', () => {
    const sheet = stickerSheet([badge('ghost', 'Ghost', ME), badge('ghost', 'Ghost', BOB), badge('debt_goblin', 'Debt Goblin', BOB)])
    expect(sheet.collected).toBe(2)
    expect(sheet.slots).toHaveLength(6)
    expect(sheet.slots.map((s) => s.key)).toEqual(['debt_goblin', 'biggest_spender', 'ghost', 'bar_tab', 'good_egg', 'wheel_victim'])
    expect(sheet.slots.find((s) => s.key === 'ghost')!.holders).toEqual([ME, BOB])
    expect(sheet.slots.find((s) => s.key === 'good_egg')!.holders).toEqual([])
  })
})

describe('Sticker book on the leaderboard', () => {
  it('shows the titles as a sticker sheet: collected stickers with their holders, dashed slots for the rest', async () => {
    fakeApi(
      groupHandlers({
        fun: fun([
          badge('debt_goblin', 'Debt Goblin', BOB),
          badge('biggest_spender', 'Biggest Spender', ME),
          badge('bar_tab', 'Bar Tab Champion', BOB),
          badge('wheel_victim', 'Wheel Victim', BOB),
        ]),
      }),
    )
    renderApp('/groups/g1')
    const sheet = within(await screen.findByRole('group', { name: 'Sticker book' }))
    expect(sheet.getByText('4 of 6')).toBeTruthy()
    expect(sheet.getByText('Debt Goblin').nextElementSibling!.textContent).toBe('Bob')
    expect(sheet.getByText('Biggest Spender').nextElementSibling!.textContent).toBe('Alice')
    const stickers = screen.getByRole('group', { name: 'Sticker book' }).querySelectorAll('.sticker')
    expect(stickers).toHaveLength(6)
    expect(screen.getByRole('group', { name: 'Sticker book' }).querySelectorAll('.sticker.locked')).toHaveLength(2)
    // Stickers already in the book are simply there: nothing slaps on when the page loads.
    expect(screen.getByRole('group', { name: 'Sticker book' }).querySelectorAll('.sticker.slap')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('starts at 0 of 6 with six empty slots', async () => {
    fakeApi(groupHandlers({ expenses: [expense()] }))
    renderApp('/groups/g1')
    const sheet = await screen.findByRole('group', { name: 'Sticker book' })
    expect(within(sheet).getByText('0 of 6')).toBeTruthy()
    expect(sheet.querySelectorAll('.sticker.locked')).toHaveLength(6)
  })
})

describe('PAID stamp', () => {
  it('stamps confirmed paybacks in the feed, and only those', async () => {
    for (const status of ['pending', 'rejected', 'cancelled'] as const) {
      fakeApi(groupHandlers({ feed: [payback(status)] }))
      renderApp('/groups/g1')
      const activity = within(await screen.findByRole('region', { name: /Activity/ }))
      expect(await activity.findByText(status)).toBeTruthy()
      expect(activity.queryByRole('img', { name: 'Paid' })).toBeNull()
      cleanup()
    }
    fakeApi(groupHandlers({ feed: [payback('confirmed')] }))
    renderApp('/groups/g1')
    const activity = within(await screen.findByRole('region', { name: /Activity/ }))
    const stamp = await activity.findByRole('img', { name: 'Paid' })
    // Already paid when the page loaded: it is just there, no thunk.
    expect(stamp.classList.contains('thunk')).toBe(false)
    expect(activity.queryByText('confirmed')).toBeNull()
  })

  it('thunks onto the payback slip after the cheer, and a newly earned Good Egg slaps on, when you confirm', async () => {
    let confirmed = false
    fakeApi(
      groupHandlers(
        { expenses: [expense()], pending: [settlement({ id: 's1', fromUserId: BOB, toUserId: ME, amountCents: 1200 })] },
        {
          'POST /settlements/s1/confirm': () => {
            confirmed = true
            return { status: 200, body: settlement({ status: 'confirmed' }) }
          },
          'GET /groups/g1/badges': () => ({ status: 200, body: fun(confirmed ? [badge('good_egg', 'Good Egg', BOB)] : []) }),
          'GET /groups/g1/settlements?status=pending': () => ({
            status: 200,
            body: confirmed ? [] : [settlement({ id: 's1', fromUserId: BOB, toUserId: ME, amountCents: 1200 })],
          }),
          'GET /groups/g1/feed': () => ({ status: 200, body: [payback(confirmed ? 'confirmed' : 'pending')] }),
        },
      ),
    )
    renderApp('/groups/g1')
    const activity = within(await screen.findByRole('region', { name: /Activity/ }))
    expect(await activity.findByText('pending')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))

    const moment = within(await screen.findByRole('status', { name: 'Payback confirmed' }))
    const slip = screen.getByRole('status', { name: 'Payback confirmed' }).querySelector('.slip')!
    expect(slip.querySelector('.slip-amt')!.textContent).toBe('$12.00')
    expect(within(slip as HTMLElement).getByRole('img', { name: 'Paid' }).classList.contains('big-stamp')).toBe(true)
    // The new sticker shows once the refetched titles say Bob earned it.
    expect(await moment.findByText('New sticker for Bob')).toBeTruthy()
    expect(moment.getByText('Good Egg')).toBeTruthy()
    // In the feed, the payback that just turned confirmed gets its stamp thunked on.
    const feedStamp = await activity.findByRole('img', { name: 'Paid' })
    expect(feedStamp.classList.contains('thunk')).toBe(true)
    // And the sticker sheet slaps the new sticker on.
    const sheet = await screen.findByRole('group', { name: 'Sticker book' })
    await vi.waitFor(() => expect(sheet.querySelectorAll('.sticker.slap')).toHaveLength(1))
    expect(sheet.querySelector('.sticker.slap')!.textContent).toContain('Good Egg')
  })

  it('has the stamp already down under reduced motion', async () => {
    mockReducedMotion(true)
    fakeApi(
      groupHandlers(
        { expenses: [expense()], pending: [settlement({ id: 's1', fromUserId: BOB, toUserId: ME })] },
        { 'POST /settlements/s1/confirm': () => ({ status: 200, body: settlement({ status: 'confirmed' }) }) },
      ),
    )
    renderApp('/groups/g1')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    const moment = await screen.findByRole('status', { name: 'Payback confirmed' })
    expect(moment.classList.contains('still')).toBe(true)
    expect(within(moment).getByRole('img', { name: 'Paid' })).toBeTruthy()
  })
})

describe('Sticker Book bits', () => {
  it('puts your balance mascot in a taped polaroid', () => {
    render(<BalanceCard cents={-500} currency="SGD" avatar={{ animal: 'fox', color: 'peach' }} seed={0} />)
    const card = screen.getByRole('region', { name: 'Your balance' })
    const polaroid = card.querySelector('.polaroid')!
    expect(polaroid.querySelector('.buddy svg.mascot-fox')).toBeTruthy()
    expect(polaroid.querySelector('.tape')).toBeTruthy()
  })

  it('lays the napping squad on an album page with six sticker slots to collect', async () => {
    fakeApi(groupHandlers({ group: group() }))
    renderApp('/groups/g1')
    const nap = await screen.findByRole('region', { name: 'The squad is napping.' })
    expect(nap.classList.contains('album')).toBe(true)
    expect(within(nap).getByText('Six stickers to collect:')).toBeTruthy()
    expect(nap.querySelectorAll('.slots .slot-s')).toHaveLength(6)
    // A former member doesn't nap with the squad.
    expect(nap.querySelectorAll('.sleeper .av')).toHaveLength(2)
  })
})
