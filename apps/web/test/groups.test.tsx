import type { GroupSummaryDTO } from '@squadsplit/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
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
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(calls[0]!.auth).toBe('Bearer test_token')
  })

  it('shows an empty state with a way to start a group', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    expect(await screen.findByText('No groups yet')).toBeTruthy()
    const newGroup = screen.getAllByRole('link', { name: /New group/ })
    expect(newGroup).toHaveLength(1)
    expect(newGroup[0]!.getAttribute('href')).toBe('/groups/new')
  })

  describe('join with a code', () => {
    const invite = { groupId: 'g9', name: 'Ski club', emoji: '🧡', memberCount: 4, alreadyMember: false }
    const joinForm = async () => within(await screen.findByRole('form', { name: 'Join with a code' }))

    it('opens the invite for a typed code, tidied up', async () => {
      fakeApi({
        'GET /groups': () => ({ status: 200, body: [group({})] }),
        'GET /invites/ABCD2345': () => ({ status: 200, body: invite }),
      })
      const router = renderApp('/groups')

      const form = await joinForm()
      fireEvent.change(form.getByLabelText('Invite code'), { target: { value: '  abcd2345 ' } })
      fireEvent.click(form.getByRole('button', { name: 'Join' }))

      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/join/ABCD2345'))
      expect(await screen.findByText('Ski club')).toBeTruthy()
    })

    it.each([['a code that is too short', 'ABC234'], ['a code with letters that codes never use', 'ABCD0I1L']])(
      'explains %s and stays put',
      async (_, typed) => {
        const calls = fakeApi({ 'GET /groups': () => ({ status: 200, body: [group({})] }) })
        const router = renderApp('/groups')

        const form = await joinForm()
        fireEvent.change(form.getByLabelText('Invite code'), { target: { value: typed } })
        fireEvent.click(form.getByRole('button', { name: 'Join' }))

        expect(form.getByRole('alert').textContent).toMatch(/8 letters and numbers/)
        expect(router.state.location.pathname).toBe('/groups')
        expect(calls.map((c) => c.key)).toEqual(['GET /groups'])
      },
    )

    it('is offered in the empty state too', async () => {
      fakeApi({
        'GET /groups': () => ({ status: 200, body: [] }),
        'GET /invites/ABCD2345': () => ({ status: 200, body: invite }),
      })
      const router = renderApp('/groups')

      await screen.findByText('No groups yet')
      const forms = screen.getAllByRole('form', { name: 'Join with a code' })
      expect(forms).toHaveLength(1)
      const form = within(forms[0]!)
      fireEvent.change(form.getByLabelText('Invite code'), { target: { value: 'ABCD2345' } })
      fireEvent.click(form.getByRole('button', { name: 'Join' }))

      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/join/ABCD2345'))
    })
  })

  it('shows the error when the groups cannot load', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 500, body: { error: { code: 'internal', message: 'Something broke' } } }) })
    renderApp('/groups')
    expect(await screen.findByText(/Something broke/)).toBeTruthy()
  })
})
