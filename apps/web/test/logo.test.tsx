import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signIn } from './clerk-mock'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  signIn.state = true
})

describe('the logo', () => {
  it('is the pup in the top bar, with no emoji on the page', async () => {
    fakeApi({ 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups')
    await screen.findByText('No groups yet')
    const mark = screen.getByRole('banner').querySelector('.logo .mark')
    expect(mark?.querySelector('svg.mascot-dog')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('is the pup on the landing page, above all eight avatar animals', async () => {
    signIn.state = false
    renderApp('/')
    await screen.findByRole('heading', { name: 'Split bills, not friendships.' })
    expect(document.querySelector('.landing .logo .mark svg.mascot-dog')).toBeTruthy()
    const squad = [...document.querySelectorAll('.landing .squad svg')].map((svg) => svg.getAttribute('class'))
    expect(squad).toEqual([
      'mascot-bunny', 'mascot-bear', 'mascot-panda', 'mascot-kitty',
      'mascot-fox', 'mascot-hamster', 'mascot-penguin', 'mascot-koala',
    ])
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
