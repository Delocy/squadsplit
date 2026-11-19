import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME, signIn } from './clerk-mock'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  signIn.state = true
})

const count = (calls: { key: string }[], key: string) => calls.filter((c) => c.key === key).length
const me = { status: 200, body: { id: ME, displayName: 'Alice Tan', avatarUrl: null, profileAvatar: { animal: 'fox', color: 'mint' } } }

describe('profile refresh after sign-in', () => {
  it('calls GET /me once, then refetches the groups so the fresh name shows', async () => {
    const calls = fakeApi({ 'GET /me': () => me, 'GET /groups': () => ({ status: 200, body: [] }) })
    const router = renderApp('/groups')

    await screen.findByText('No groups yet')
    await vi.waitFor(() => expect(count(calls, 'GET /groups')).toBe(2))
    expect(count(calls, 'GET /me')).toBe(1)

    // Moving between signed-in pages does not ask again.
    await router.navigate('/groups/new')
    await router.navigate('/groups')
    await screen.findByText('No groups yet')
    expect(count(calls, 'GET /me')).toBe(1)
  })

  it('does not call GET /me for a signed-out visitor', async () => {
    signIn.state = false
    const calls = fakeApi({ 'GET /me': () => me })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Split bills, not friendships.' })
    expect(count(calls, 'GET /me')).toBe(0)
  })

  it('leaves the groups alone when GET /me fails', async () => {
    const calls = fakeApi({
      'GET /me': () => ({ status: 500, body: { error: { code: 'internal', message: 'Something went wrong' } } }),
      'GET /groups': () => ({ status: 200, body: [] }),
    })
    renderApp('/groups')
    await screen.findByText('No groups yet')
    await vi.waitFor(() => expect(count(calls, 'GET /me')).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 50)) // let the failed /me settle
    expect(count(calls, 'GET /groups')).toBe(1)
  })
})
