import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupHandlers } from './group-fixtures'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const summary = { id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'owner', myBalanceCents: 0 }
const CORE = ['GET /groups/g1', 'GET /groups/g1/balances', 'GET /groups/g1/expenses', 'GET /groups/g1/feed']
const count = (calls: { key: string }[], key: string) => calls.filter((c) => c.key === key).length

async function groupCard() {
  const calls = fakeApi(groupHandlers({}, { 'GET /groups': () => ({ status: 200, body: [summary] }) }))
  const router = renderApp('/groups')
  const card = await screen.findByRole('link', { name: /Bali Trip/ })
  return { calls, router, card }
}

describe('prefetching a group', () => {
  it.each([
    ['pointing at', (el: Element) => fireEvent.pointerEnter(el)],
    ['focusing', (el: Element) => fireEvent.focus(el)],
    ['touching', (el: Element) => fireEvent.touchStart(el)],
  ])('starts loading the group, its balances, expenses and feed on %s its card', async (_, warm) => {
    const { calls, card } = await groupCard()
    expect(calls.some((c) => CORE.includes(c.key))).toBe(false)
    warm(card)
    await vi.waitFor(() => CORE.forEach((key) => expect(count(calls, key), key).toBe(1)))
  })

  it('opens the group from the prefetched data without fetching it again', async () => {
    const { calls, router, card } = await groupCard()
    fireEvent.pointerEnter(card)
    fireEvent.pointerEnter(card)
    await vi.waitFor(() => CORE.forEach((key) => expect(count(calls, key), key).toBe(1)))
    fireEvent.click(card)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    await screen.findByRole('region', { name: 'Group stats' })
    // The rest of the page loads as usual.
    await vi.waitFor(() => expect(count(calls, 'GET /groups/g1/badges')).toBe(1))
    CORE.forEach((key) => expect(count(calls, key), key).toBe(1))
  })
})
