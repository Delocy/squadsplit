import type { GroupSummaryDTO } from '@squadsplit/shared'
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const group = (over: Partial<GroupSummaryDTO>): GroupSummaryDTO => ({
  id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'member', myBalanceCents: 0, ...over,
})

describe('Groups page', () => {
  it('lists each group with your balance and role, and never shows the stored emoji', async () => {
    const calls = fakeApi({
      'GET /groups': () => ({
        status: 200,
        body: [
          group({ id: 'g1', name: 'Bali Trip', role: 'owner', myBalanceCents: 4250 }),
          group({ id: 'g2', name: 'Flat bills', myBalanceCents: -1200, currency: 'USD' }),
          group({ id: 'g3', name: 'Dinner club', myBalanceCents: 0 }),
        ],
      }),
    })
    renderApp('/groups')

    const bali = await screen.findByRole('link', { name: /Bali Trip/ })
    expect(bali.getAttribute('href')).toBe('/groups/g1')
    expect(bali.textContent).toContain("You're owed")
    expect(bali.textContent).toContain('$42.50')
    expect(bali.textContent).toContain('Owner')

    const flat = screen.getByRole('link', { name: /Flat bills/ })
    expect(flat.textContent).toContain('You owe')
    expect(flat.textContent).toContain('US$12.00')
    expect(flat.textContent).toContain('Member')

    expect(screen.getByRole('link', { name: /Dinner club/ }).textContent).toContain('All square')
    expect(document.body.textContent).not.toContain('🧡')
    expect(calls[0]!.auth).toBe('Bearer test_token')
  })

  it('shows an empty state with a way to start a group', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    expect(await screen.findByText('No groups yet')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /New group/ })[0]!.getAttribute('href')).toBe('/groups/new')
  })

  it('shows the error when the groups cannot load', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 500, body: { error: { code: 'internal', message: 'Something broke' } } }) })
    renderApp('/groups')
    expect(await screen.findByText(/Something broke/)).toBeTruthy()
  })
})
