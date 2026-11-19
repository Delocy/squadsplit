import type { InvitePreviewDTO } from '@squadsplit/shared'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signIn } from './clerk-mock'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  signIn.state = true
})

const preview = (over: Partial<InvitePreviewDTO> = {}): InvitePreviewDTO => ({
  groupId: 'g1', name: 'Bali Trip', emoji: '🧡', memberCount: 3, alreadyMember: false, ...over,
})

describe('Join page', () => {
  it('previews the group, joins it and opens it', async () => {
    const calls = fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview() }),
      'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
    })
    const router = renderApp('/join/ABCD2345')

    expect(await screen.findByText('Bali Trip')).toBeTruthy()
    expect(screen.getByText('3 members')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(calls.map((c) => c.key)).toContain('POST /invites/ABCD2345/join')
  })

  it('shows the loading state inside the page container', async () => {
    fakeApi({ 'GET /invites/ABCD2345': () => new Promise(() => {}) })
    renderApp('/join/ABCD2345')
    const loading = await screen.findByText('Checking the invite…')
    expect(loading.closest('main.narrow.page')).toBeTruthy()
  })

  it('offers to open the group when you are already a member', async () => {
    fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ alreadyMember: true, memberCount: 1 }) }) })
    renderApp('/join/ABCD2345')
    expect(await screen.findByText(/already in this group/)).toBeTruthy()
    expect(screen.getByText('1 member')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open group/ }).getAttribute('href')).toBe('/groups/g1')
  })

  it('explains a dead invite link', async () => {
    fakeApi({ 'GET /invites/OLDCODE1': () => ({ status: 404, body: { error: { code: 'not_found', message: 'Invite not found' } } }) })
    renderApp('/join/OLDCODE1')
    expect(await screen.findByText(/This invite link doesn't work any more/)).toBeTruthy()
  })

  it('sends a signed-out visitor to sign in and back to the invite link', async () => {
    signIn.state = false
    const calls = fakeApi({})
    renderApp('/join/ABCD2345')
    expect(await screen.findByText(/Redirecting to sign-in, then back to .*\/join\/ABCD2345/)).toBeTruthy()
    expect(calls).toHaveLength(0)
  })
})
