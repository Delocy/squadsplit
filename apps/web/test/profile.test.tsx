import { AVATAR_COLORS, defaultAvatar } from '@squadsplit/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { groupHandlers } from './group-fixtures'
import { fakeApi, held, renderApp, type Handler } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const LOOK = { animal: 'penguin', color: 'mint' } as const
const meWith = (profileAvatar: typeof LOOK | ReturnType<typeof defaultAvatar>): Handler => () => ({
  status: 200,
  body: { id: ME, displayName: 'Me', avatarUrl: null, profileAvatar },
})
const pressed = (group: 'Animal' | 'Colour') =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('aria-label'))

describe('profile look', () => {
  it('shows your profile look in the top bar outside a group', async () => {
    fakeApi({ 'GET /me': meWith(LOOK), 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    await vi.waitFor(() => expect(screen.getByRole('img', { name: 'You' }).style.getPropertyValue('--c')).toBe(AVATAR_COLORS.mint))
    expect(screen.getByRole('img', { name: 'You' }).querySelector('svg.mascot-penguin')).toBeTruthy()
  })

  it('opens a menu from your avatar with a link to your profile look', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 200, body: [] }) })
    const router = renderApp('/groups')
    const button = await screen.findByRole('button', { name: 'Your menu' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('link', { name: 'Your profile look' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(screen.queryByRole('link', { name: 'Your profile look' })).toBeNull()
  })

  it('closes the menu with Escape', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    fireEvent.click(await screen.findByRole('button', { name: 'Your menu' }))
    fireEvent.keyDown(screen.getByRole('link', { name: 'Your profile look' }), { key: 'Escape' })
    expect(screen.queryByRole('link', { name: 'Your profile look' })).toBeNull()
  })

  it('lets you pick any look on the profile page and saves it', async () => {
    const calls = fakeApi({
      'GET /me': meWith(LOOK),
      'PATCH /me': (body) => ({ status: 200, body: { id: ME, displayName: 'Me', avatarUrl: null, ...(body as object) } }),
    })
    renderApp('/me')
    expect(await screen.findByRole('heading', { name: 'Your profile look' })).toBeTruthy()
    await vi.waitFor(() => expect(pressed('Animal')).toEqual(['Penguin']))
    expect(pressed('Colour')).toEqual(['Mint'])
    // It's yours alone: nothing is taken.
    expect(screen.getAllByRole('button').filter((b) => (b as HTMLButtonElement).disabled && b.textContent !== 'Save')).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Koala' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lemon' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(calls.find((c) => c.key === 'PATCH /me')?.body).toEqual({ profileAvatar: { animal: 'koala', color: 'lemon' } }))
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'You' }).style.getPropertyValue('--c')).toBe(AVATAR_COLORS.lemon)
  })

  it('falls back to your profile look inside a group until the group loads', async () => {
    fakeApi(groupHandlers({}, { 'GET /me': meWith(LOOK), 'GET /groups/g1': () => new Promise(() => {}) }))
    renderApp('/groups/g1')
    await vi.waitFor(() => expect(screen.getByRole('img', { name: 'You' }).style.getPropertyValue('--c')).toBe(AVATAR_COLORS.mint))
  })

  it('holds your avatar’s place in the top bar until your profile loads, instead of flashing the default look', async () => {
    const me = held({ status: 200, body: { id: ME, displayName: 'Me', avatarUrl: null, profileAvatar: LOOK } })
    fakeApi({ 'GET /me': me.handler, 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    const button = await screen.findByRole('button', { name: 'Your menu' })
    expect(within(button).queryByRole('img', { name: 'You' })).toBeNull()
    expect(button.querySelector('.sk')).toBeTruthy()

    me.release()
    await vi.waitFor(() => expect(within(button).getByRole('img', { name: 'You' }).style.getPropertyValue('--c')).toBe(AVATAR_COLORS.mint))
  })

  it('shows a skeleton on the profile page until your profile loads, then starts from your look', async () => {
    const me = held({ status: 200, body: { id: ME, displayName: 'Me', avatarUrl: null, profileAvatar: LOOK } })
    fakeApi({ 'GET /me': me.handler })
    renderApp('/me')
    expect(await screen.findByText('Loading your profile look…')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Animal' })).toBeNull()

    me.release()
    await vi.waitFor(() => expect(pressed('Animal')).toEqual(['Penguin']))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Bunny' }))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
