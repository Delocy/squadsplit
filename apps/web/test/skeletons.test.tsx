import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, group, groupHandlers, settlement } from './group-fixtures'
import { fakeApi, renderApp, type Handler } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A handler that holds its reply until `release` is called, so a test can look at the page while it loads. */
function held(reply: Awaited<ReturnType<Handler>>) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const handler: Handler = async () => {
    await gate
    return reply
  }
  return { handler, release }
}
const ok = (body: unknown) => ({ status: 200, body })
const skeletons = (el: ParentNode = document) => el.querySelectorAll('.sk').length

describe('skeletons while loading', () => {
  it('shows group-card skeletons on the group list, then the groups', async () => {
    const groups = held(ok([{ id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'owner', myBalanceCents: 0 }]))
    fakeApi({ 'GET /groups': groups.handler })
    renderApp('/groups')
    expect((await screen.findByRole('status')).textContent).toBe('Loading your groups…')
    expect(document.querySelectorAll('.group-card .sk').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Loading your groups/, { selector: '.empty' })).toBeNull()

    groups.release()
    expect(await screen.findByRole('link', { name: /Bali Trip/ })).toBeTruthy()
    expect(skeletons()).toBe(0)
  })

  it('lays the group home out in skeletons until the group loads, then each card fills in on its own', async () => {
    const g = held(ok(group()))
    const balances = held(ok({ balances: { [ME]: 1200, [BOB]: -1200 }, suggestions: [] }))
    const feed = held(ok([]))
    const fun = held(ok({ badges: [], leaderboard: [] }))
    const expenses = held(ok([]))
    fakeApi(
      groupHandlers({}, {
        'GET /groups/g1': g.handler,
        'GET /groups/g1/balances': balances.handler,
        'GET /groups/g1/feed': feed.handler,
        'GET /groups/g1/badges': fun.handler,
        'GET /groups/g1/expenses': expenses.handler,
      }),
    )
    renderApp('/groups/g1')
    expect((await screen.findByRole('status')).textContent).toBe('Loading the group…')
    const page = document.querySelector('main[aria-busy="true"]')!
    // The same grid as the real page: summary strip, main column and side column.
    expect(page.querySelector('.summary .card.balance .sk')).toBeTruthy()
    expect(page.querySelectorAll('.main > .col')).toHaveLength(2)
    expect(page.querySelector('.wheel-card.compact .wheel .sk')).toBeTruthy()

    g.release()
    const balance = await screen.findByRole('region', { name: 'Your balance' })
    expect(balance.getAttribute('aria-busy')).toBe('true')
    expect(skeletons(balance)).toBeGreaterThan(0)
    expect(skeletons(screen.getByRole('region', { name: 'Group stats' }))).toBe(3)
    expect(skeletons(screen.getByRole('region', { name: /^Activity/ }))).toBeGreaterThan(0)
    // One leaderboard row per current member while the board loads.
    expect(screen.getByRole('region', { name: 'Leaderboard' }).querySelectorAll('.lb-row')).toHaveLength(2)
    expect(skeletons(screen.getByRole('list', { name: 'Odds' }))).toBe(2)

    balances.release()
    feed.release()
    fun.release()
    expenses.release()
    await vi.waitFor(() => expect(skeletons()).toBe(0))
    expect(screen.getByRole('region', { name: 'Your balance' }).textContent).toContain('$12.00')
  })

  it('keeps showing the group, not skeletons, while it refetches after a change', async () => {
    let refetching = false
    const slow = (body: unknown): Handler => async () => {
      if (refetching) await new Promise((r) => setTimeout(r, 50))
      return ok(body)
    }
    const calls = fakeApi(
      groupHandlers(
        {},
        {
          'GET /groups/g1/balances': slow({ balances: { [ME]: 1200, [BOB]: -1200 }, suggestions: [] }),
          'GET /groups/g1/feed': slow([]),
          'GET /groups/g1/settlements?status=pending': slow([settlement()]),
          'POST /settlements/s1/confirm': () => ok(settlement({ status: 'confirmed' })),
        },
      ),
    )
    renderApp('/groups/g1')
    const confirm = await screen.findByRole('button', { name: 'Confirm' })
    await vi.waitFor(() => expect(skeletons()).toBe(0))
    refetching = true
    fireEvent.click(confirm)
    await vi.waitFor(() => expect(calls.filter((c) => c.key === 'GET /groups/g1/balances').length).toBe(2))
    expect(skeletons()).toBe(0)
    expect(within(screen.getByRole('region', { name: 'Your balance' })).getByText('$12.00')).toBeTruthy()
  })

  it('shows skeletons on the settings, wheel and join pages while they load', async () => {
    const g = held(ok(group()))
    const invite = held(ok({ groupId: 'g1', name: 'Bali Trip', emoji: '🧡', memberCount: 2, alreadyMember: false, takenAvatars: [], myFormerAvatar: null }))
    fakeApi(groupHandlers({}, { 'GET /groups/g1': g.handler, 'GET /invites/ABCD2345': invite.handler }))

    for (const [url, status] of [
      ['/groups/g1/settings', 'Loading the group…'],
      ['/groups/g1/wheel', 'Loading the group…'],
      ['/join/ABCD2345', 'Checking the invite…'],
    ] as const) {
      renderApp(url)
      expect((await screen.findByRole('status')).textContent).toBe(status)
      expect(skeletons(document.querySelector('main[aria-busy="true"]')!)).toBeGreaterThan(0)
      cleanup()
    }
    g.release()
    invite.release()
  })
})
