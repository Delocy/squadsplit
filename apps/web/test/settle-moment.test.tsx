import type { FeedItem, SettlementDTO, SettlementStatus } from '@squadsplit/shared'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, expense, groupHandlers, settlement } from './group-fixtures'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const settleCard = () => screen.getByRole('region', { name: /Settle up/ })
const announcer = () => within(settleCard()).getAllByRole('status')
const item = (s: SettlementDTO): FeedItem => ({ type: 'settlement', at: s.createdAt, settlement: s })

describe('the payer’s settle-up moment', () => {
  // You marked 30.00 paid to Bob; Bob resolves it somewhere else, and a refetch brings the news.
  const mine = settlement({ id: 's1', fromUserId: ME, toUserId: BOB, amountCents: 3000 })
  function waitingOnBob(initial: SettlementStatus = 'pending') {
    let status: SettlementStatus = initial
    const calls = fakeApi(
      groupHandlers(
        { expenses: [expense()] },
        {
          'GET /groups/g1/settlements?status=pending': () => ({ status: 200, body: status === 'pending' ? [mine] : [] }),
          'GET /groups/g1/feed': () => ({ status: 200, body: [item({ ...mine, status })] }),
          'POST /settlements/s1/cancel': () => {
            status = 'cancelled'
            return { status: 200, body: { ...mine, status } }
          },
        },
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderApp('/groups/g1', queryClient)
    return {
      calls,
      /** Bob resolves it on his phone, and this page refetches (as it does on focus). */
      resolve: async (next: SettlementStatus) => {
        status = next
        await act(() => queryClient.invalidateQueries())
      },
    }
  }

  it('plays for you when Bob confirms the payment you were waiting on, without taking your focus', async () => {
    const bob = waitingOnBob()
    expect(await screen.findByText('Waiting for Bob to confirm')).toBeTruthy()
    const before = document.activeElement
    await bob.resolve('confirmed')

    const moment = await screen.findByRole('region', { name: 'Payback confirmed' })
    expect(moment.querySelector('.caption')!.textContent).toBe('Bob confirmed. The squad approves.')
    // The heart hops from you (the payer, whose face stops frowning) to Bob.
    expect(moment.querySelector('.hop-l .swap-from')).toBeTruthy()
    expect(moment.querySelector('.slip-amt')!.textContent).toBe('$30.00')
    expect(announcer().map((s) => s.textContent)).toContain('Bob confirmed your payback.')
    // It came from a refetch, not from something you did: focus stays where it was.
    expect(document.activeElement).toBe(before)
  })

  it('never replays a payment that was already confirmed when the page loaded', async () => {
    waitingOnBob('confirmed')
    await screen.findByRole('region', { name: /Activity/ })
    expect(await within(screen.getByRole('region', { name: /Activity/ })).findByRole('img', { name: 'Paid' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
  })

  it('stays quiet when Bob rejects it, or when you undo it', async () => {
    const bob = waitingOnBob()
    await screen.findByText('Waiting for Bob to confirm')
    await bob.resolve('rejected')
    await vi.waitFor(() => expect(screen.queryByText('Waiting for Bob to confirm')).toBeNull())
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
    cleanup()

    const undo = waitingOnBob()
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await vi.waitFor(() => expect(screen.queryByText('Waiting for Bob to confirm')).toBeNull())
    expect(undo.calls.some((c) => c.key === 'POST /settlements/s1/cancel')).toBe(true)
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
  })
})

describe('the creditor’s settle-up moment: focus and announcements', () => {
  function bobSaysHePaid() {
    fakeApi(
      groupHandlers(
        { expenses: [expense()], pending: [settlement({ id: 's1', fromUserId: BOB, toUserId: ME, amountCents: 1200 })] },
        {
          'POST /settlements/s1/confirm': () => ({ status: 200, body: settlement({ status: 'confirmed' }) }),
          'POST /settlements/s1/reject': () => ({ status: 200, body: settlement({ status: 'rejected' }) }),
        },
      ),
    )
    renderApp('/groups/g1')
  }

  it('announces through a live region that is already there, and moves focus into the moment, then back to Settle up', async () => {
    bobSaysHePaid()
    const confirm = await screen.findByRole('button', { name: 'Confirm' })
    // The live region exists, empty, before anything is said in it.
    expect(announcer().some((s) => s.textContent === '')).toBe(true)
    confirm.focus()
    fireEvent.click(confirm)

    const moment = await screen.findByRole('region', { name: 'Payback confirmed' })
    expect(announcer().map((s) => s.textContent)).toContain('Bob paid you back. Payback confirmed.')
    // The row you were on is gone, so focus goes into the moment rather than to the page.
    expect(moment.contains(document.activeElement)).toBe(true)

    fireEvent.click(within(moment).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
    expect(document.activeElement!.id).toBe('settle-h')
  })

  it('does not hide the row or celebrate a rejection', async () => {
    bobSaysHePaid()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Rejecting…' })).toBeNull())
    // The fake API keeps listing it as pending, so the row stays.
    expect(screen.getByText('Bob says they paid you $12.00')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
  })
})
