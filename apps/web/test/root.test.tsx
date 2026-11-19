import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Root } from '../src/Root'
import { clerk, signIn } from './clerk-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  signIn.state = true
  clerk.loaded = true
  clerk.failed = false
  vi.restoreAllMocks()
})

describe('Root', () => {
  it.each([undefined, ''])('shows a setup screen instead of crashing when the Clerk key is %j', (key) => {
    render(<Root publishableKey={key} />)
    expect(screen.getByRole('heading', { name: /Almost ready/ })).toBeTruthy()
    expect(document.body.textContent).toContain('VITE_CLERK_PUBLISHABLE_KEY')
  })

  it('renders the app, starting with the landing page for a signed-out visitor, when the Clerk key is set', async () => {
    signIn.state = false
    render(<Root publishableKey="pk_test_example" />)
    expect(await screen.findByRole('heading', { name: 'Split bills, not friendships.' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Almost ready/ })).toBeNull()
  })

  it('shows the bobbing logo pup, not a blank page, while Clerk loads', () => {
    clerk.loaded = false
    render(<Root publishableKey="pk_test_example" />)
    const loading = screen.getByRole('status', { name: 'Loading SquadSplit' })
    expect(loading.querySelector('.bob svg.mascot-dog')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Split bills, not friendships.' })).toBeNull()
  })

  it('offers a retry, with the logo pup, when Clerk cannot load', () => {
    clerk.loaded = false
    clerk.failed = true
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    render(<Root publishableKey="pk_test_example" />)

    const card = screen.getByRole('alert')
    expect(card.textContent).toContain("Can't reach sign-in. Check your connection and try again.")
    expect(card.querySelector('svg.mascot-dog')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading SquadSplit' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
