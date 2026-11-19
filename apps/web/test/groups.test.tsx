import type { GroupSummaryDTO, InvitePreviewDTO } from '@squadsplit/shared'
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
    const invite: InvitePreviewDTO = { groupId: 'g9', name: 'Ski club', emoji: '🧡', memberCount: 4, alreadyMember: false, takenAvatars: [], myFormerAvatar: null, placeholders: [] }
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

    it.each([
      ['a code that is too short', 'ABC234', 'Codes are 8 letters and numbers, like ABCD2345.'],
      ['a code with letters that codes never use', 'NOPE1234', "Codes don't use O, 0, I, L or 1. Check the letters."],
    ])(
      'explains %s and stays put',
      async (_, typed, says) => {
        const calls = fakeApi({ 'GET /groups': () => ({ status: 200, body: [group({})] }), 'GET /quick-splits': () => ({ status: 200, body: [] }) })
        const router = renderApp('/groups')

        const form = await joinForm()
        fireEvent.change(form.getByLabelText('Invite code'), { target: { value: typed } })
        fireEvent.click(form.getByRole('button', { name: 'Join' }))

        expect(form.getByRole('alert').textContent).toContain(says)
        expect(router.state.location.pathname).toBe('/groups')
        expect(calls.map((c) => c.key).sort()).toEqual(['GET /groups', 'GET /quick-splits'])
      },
    )

    it.each([
      ['the code as read aloud, with a space', 'abcd 2345'],
      ['a whole pasted invite link', 'https://squadsplit.app/join/ABCD2345'],
    ])('takes %s', async (_, typed) => {
      fakeApi({
        'GET /groups': () => ({ status: 200, body: [group({})] }),
        'GET /invites/ABCD2345': () => ({ status: 200, body: invite }),
      })
      const router = renderApp('/groups')
      const form = await joinForm()
      fireEvent.change(form.getByLabelText('Invite code'), { target: { value: typed } })
      fireEvent.click(form.getByRole('button', { name: 'Join' }))
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/join/ABCD2345'))
    })

    it('says a typed code that matches no group is a code it couldn’t find, not a dead link', async () => {
      fakeApi({
        'GET /groups': () => ({ status: 200, body: [group({})] }),
        'GET /invites/ZZZZZZZZ': () => ({ status: 404, body: { error: { code: 'not_found', message: 'Invite not found' } } }),
      })
      renderApp('/groups')
      const form = await joinForm()
      fireEvent.change(form.getByLabelText('Invite code'), { target: { value: 'ZZZZZZZZ' } })
      fireEvent.click(form.getByRole('button', { name: 'Join' }))

      expect(
        await screen.findByText("We couldn't find a group with code ZZZZ ZZZZ. Check it, or ask anyone in the group to send you the invite link."),
      ).toBeTruthy()
      expect(screen.queryByText(/doesn't work any more/)).toBeNull()
    })

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

  it('shows the error when the groups cannot load, with Try again', async () => {
    let fail = true
    fakeApi({
      'GET /groups': () => (fail ? { status: 500, body: { error: { code: 'internal', message: 'Something broke' } } } : { status: 200, body: [group({})] }),
      'GET /quick-splits': () => ({ status: 200, body: [] }),
    })
    renderApp('/groups')
    const card = await screen.findByRole('alert')
    expect(card.textContent).toContain('Something broke')
    fail = false
    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: /Bali Trip/ })).toBeTruthy()
  })

  it('says the app can’t be reached, not a raw error, when the network is down', async () => {
    fakeApi({ 'GET /quick-splits': () => ({ status: 200, body: [] }) })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    renderApp('/groups')
    const card = await screen.findByRole('alert')
    expect(card.textContent).toContain("Can't reach SquadSplit. Check your signal.")
    expect(within(card).getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
