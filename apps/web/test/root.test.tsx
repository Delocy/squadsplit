import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Root } from '../src/Root'
import { signIn } from './clerk-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  signIn.state = true
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
})
