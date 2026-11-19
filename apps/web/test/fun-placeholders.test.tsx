import type { FeedItem, SettlementDTO } from '@squadsplit/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { DAVE, dave, expense, group, groupHandlers, settlement } from './group-fixtures'
import { fakeApi, renderApp, transferLine } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Someone the owner named who hasn't joined yet: they have balances like anyone, and payments with them count at once.
const withDave = () => {
  const g = group()
  g.members.push(dave())
  return g
}
const item = (s: SettlementDTO): FeedItem => ({ type: 'settlement', at: s.createdAt, settlement: s })

/** A group home where a payment with Dave is recorded as confirmed, and then shows up in the refetched feed. */
function recordWithDave(paid: SettlementDTO, net: Record<string, number>) {
  let recorded = false
  fakeApi(
    groupHandlers(
      {
        group: withDave(),
        expenses: [expense()],
        balances: { balances: net, suggestions: [{ fromUserId: paid.fromUserId, toUserId: paid.toUserId, amountCents: paid.amountCents }] },
      },
      {
        'POST /groups/g1/settlements': () => {
          recorded = true
          return { status: 201, body: paid }
        },
        'GET /groups/g1/feed': () => ({ status: 200, body: recorded ? [item(paid)] : [] }),
      },
    ),
  )
  renderApp('/groups/g1')
}

describe('a settle-up row with someone who has not joined', () => {
  it('puts each name in its own truncating element, and the tag on its own line under them', async () => {
    const g = group()
    g.members.push(dave({ displayName: 'Bartholomew Tan' }))
    fakeApi(
      groupHandlers({
        group: g,
        expenses: [expense()],
        balances: { balances: { [ME]: 500, [DAVE]: -500 }, suggestions: [{ fromUserId: DAVE, toUserId: ME, amountCents: 500 }] },
      }),
    )
    renderApp('/groups/g1')
    const line = await within(await screen.findByRole('region', { name: /Settle up/ })).findByText(transferLine('Bartholomew Tan → You'))
    expect([...line.querySelectorAll('.nm')].map((n) => n.textContent)).toEqual(['Bartholomew Tan', 'You'])
    // Truncated names still say who in full on hover.
    expect(line.querySelector('.nm')!.getAttribute('title')).toBe('Bartholomew Tan')
    // Only the long name gives way: "You" never truncates.
    expect([...line.querySelectorAll('.nm')].map((n) => n.classList.contains('short'))).toEqual([false, true])
    const row = line.closest('.row')!
    expect(row.querySelector('.grow > .tags')!.textContent).toBe('Not joined yet')
    expect(line.textContent).not.toContain('Not joined yet')
    // The amount and Mark paid sit together at the end, so they can wrap below as one on a narrow screen.
    const end = row.querySelector('.row-end')!
    expect(end.querySelector('.amt-r')!.textContent).toBe('$5.00')
    expect(within(end as HTMLElement).getByRole('button', { name: 'Mark paid' })).toBeTruthy()
  })
})

describe('Your mix with someone who has not joined', () => {
  it('gives them a mood and sweat from their balance, like anyone', async () => {
    fakeApi(
      groupHandlers({
        group: withDave(),
        expenses: [expense()],
        balances: { balances: { [ME]: 6000, [DAVE]: -6000 }, suggestions: [{ fromUserId: DAVE, toUserId: ME, amountCents: 6000 }] },
      }),
    )
    renderApp('/groups/g1')
    const strip = within(await screen.findByRole('group', { name: 'The squad' }))
    const daveAv = strip.getByRole('img', { name: 'Dave' })
    expect(daveAv.getAttribute('data-mood')).toBe('nervous')
    expect(daveAv.parentElement!.querySelectorAll('.sweat')).toHaveLength(2)
    const row = within(screen.getByRole('region', { name: /Settle up/ })).getByText(transferLine('Dave → You')).closest('.row')!
    expect([...row.querySelectorAll('.av')].map((a) => a.getAttribute('data-mood'))).toEqual(['nervous', 'happy'])
  })

  it('celebrates recording that they paid you, and stamps the new payback in the feed', async () => {
    recordWithDave(settlement({ id: 's7', fromUserId: DAVE, toUserId: ME, amountCents: 500, status: 'confirmed' }), { [ME]: 500, [DAVE]: -500 })
    const settle = within(await screen.findByRole('region', { name: /Settle up/ }))
    fireEvent.click(await settle.findByRole('button', { name: 'Mark paid' }))
    fireEvent.click(settle.getByRole('button', { name: 'Submit' }))

    const moment = await screen.findByRole('region', { name: 'Payback confirmed' })
    expect(moment.textContent).toContain('Dave paid you back. The squad approves.')
    expect(moment.querySelector('.slip-amt')!.textContent).toBe('$5.00')
    // The heart hops from Dave (a bear) to you (a fox).
    expect(moment.querySelector('.hop-l svg.mascot-bear')).toBeTruthy()
    expect(moment.querySelector('.hop-r svg.mascot-fox')).toBeTruthy()
    // It counted straight away: a payback new to the feed, already confirmed, gets its stamp thunked on.
    const stamp = await within(screen.getByRole('region', { name: /Activity/ })).findByRole('img', { name: 'Paid' })
    expect(stamp.classList.contains('thunk')).toBe(true)
  })

  it('celebrates paying them, with the heart hopping from you to them', async () => {
    recordWithDave(settlement({ id: 's8', fromUserId: ME, toUserId: DAVE, amountCents: 500, status: 'confirmed' }), { [ME]: -500, [DAVE]: 500 })
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    const moment = await screen.findByRole('region', { name: 'Payback confirmed' })
    expect(moment.textContent).toContain('You paid Dave back. The squad approves.')
    expect([...moment.querySelectorAll('.slip-row > span:not([class])')].map((n) => n.textContent)).toEqual(['You', 'Dave'])
    expect(moment.querySelector('.hop-l svg.mascot-fox')).toBeTruthy()
    expect(moment.querySelector('.hop-r svg.mascot-bear')).toBeTruthy()
    // The form makes way for the moment (after its short exit).
    await vi.waitFor(() => expect(screen.queryByRole('form', { name: 'Mark a payment' })).toBeNull())
  })

  it('does not celebrate a payment that still needs confirming', async () => {
    recordWithDave(settlement({ id: 's9', fromUserId: ME, toUserId: DAVE, amountCents: 500, status: 'pending' }), { [ME]: -500, [DAVE]: 500 })
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await vi.waitFor(() => expect(screen.queryByRole('form', { name: 'Mark a payment' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
  })
})
