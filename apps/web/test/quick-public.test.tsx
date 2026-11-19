import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Root } from '../src/Root'
import { clerk, signIn } from './clerk-mock'
import { fakeApi, renderApp, type Handler } from './harness'
import { readmePublic } from './quick-fixtures'

vi.mock('@clerk/react', () => import('./clerk-mock'))

const TOKEN = 'tok_7fK2qaAAAAAAAAAAAAAA'
const PICK_KEY = `squadsplit:quick-split:${TOKEN}:me`
const EMOJI = /\p{Extended_Pictographic}/u
const PAID_AT = '2026-11-19T06:14:00.000Z'

beforeEach(() => {
  signIn.state = false
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  signIn.state = true
  clerk.loaded = true
  clerk.failed = false
  window.history.replaceState(null, '', '/')
})

/** The public API with Arjun's tick held in `paid` (the server's state). */
function linkApi(extra: Record<string, Handler> = {}) {
  let paid: Record<string, [string, 'guest' | 'payer']> = { weiling: ['2026-11-19T05:52:00.000Z', 'guest'] }
  return fakeApi({
    [`GET /s/${TOKEN}`]: () => ({ status: 200, body: readmePublic(paid) }),
    [`POST /s/${TOKEN}/people/arjun/paid`]: (body) => {
      const { arjun: _arjun, ...rest } = paid
      paid = (body as { paid: boolean }).paid ? { ...rest, arjun: [PAID_AT, 'guest'] } : rest
      return { status: 200, body: readmePublic(paid) }
    },
    ...extra,
  })
}

const row = (name: string) => within(screen.getByRole('listitem', { name }))

describe('the share link page', () => {
  it('works signed out: pick your name, tick "I\'ve paid", then Undo', async () => {
    const calls = linkApi()
    renderApp(`/s/${TOKEN}`)

    expect(await screen.findByText('Which one are you?')).toBeTruthy()
    expect(screen.getByText('2 of 3 paid')).toBeTruthy()
    expect(row('Dan').getByText('Paid the bill')).toBeTruthy()
    expect(row('Wei Ling').getByText(/^Paid · \d{1,2}:52(am|pm)$/)).toBeTruthy()
    expect(row('Arjun').getByText('Not ticked yet')).toBeTruthy()
    expect(screen.getByText("Tap your own name. Dan can see who's ticked, and can fix a wrong tick.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Dan/ })).toBeNull() // the payer is never picked

    fireEvent.click(screen.getByRole('button', { name: /^Arjun/ }))
    expect(row('Arjun').getByText('That’s me')).toBeTruthy()
    expect(localStorage.getItem(PICK_KEY)).toBe('arjun')
    fireEvent.click(screen.getByRole('button', { name: 'I’ve paid Dan $40.72' }))

    expect(await screen.findByText('Thanks, Arjun. Dan can see you’ve paid.')).toBeTruthy()
    expect(await screen.findByText("Everyone's paid")).toBeTruthy()
    expect(document.querySelector('.pub-progress .paid-stamp[aria-hidden="true"] svg')).toBeTruthy()
    expect(row('Arjun').getByText(/^Paid · \d{1,2}:14(am|pm)$/)).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Arjun' }).querySelector('svg.pub-tick')).toBeTruthy()

    fireEvent.click(row('Arjun').getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('2 of 3 paid')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'I’ve paid Dan $40.72' })).toBeTruthy()

    const posts = calls.filter((c) => c.key.startsWith('POST'))
    expect(posts.map((c) => c.body)).toEqual([{ paid: true }, { paid: false }])
    expect(calls.every((c) => c.auth === null)).toBe(true)
    expect(document.body.textContent).not.toMatch(EMOJI)
  })

  it('remembers which one you are on this phone, and lets you pick again', async () => {
    localStorage.setItem(PICK_KEY, 'arjun')
    linkApi()
    renderApp(`/s/${TOKEN}`)
    expect(await screen.findByRole('button', { name: 'I’ve paid Dan $40.72' })).toBeTruthy()
    expect(screen.queryByText('Which one are you?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Not you?' }))
    expect(screen.getByText('Which one are you?')).toBeTruthy()
    expect(localStorage.getItem(PICK_KEY)).toBeNull()
  })

  it('still works when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    linkApi()
    renderApp(`/s/${TOKEN}`)
    fireEvent.click(await screen.findByRole('button', { name: /^Arjun/ }))
    expect(screen.getByRole('button', { name: 'I’ve paid Dan $40.72' })).toBeTruthy()
    vi.restoreAllMocks()
  })

  it('shows a friendly card when the link has been turned off (410)', async () => {
    fakeApi({
      [`GET /s/${TOKEN}`]: () => ({ status: 410, body: { error: { code: 'link_off', message: 'This link has been turned off. Ask Dan for the breakdown.' } } }),
    })
    renderApp(`/s/${TOKEN}`)
    const card = await screen.findByRole('alert')
    expect(card.textContent).toContain('This link has been turned off. Ask Dan for the breakdown.')
    expect(card.querySelector('svg.mascot-dog')).toBeTruthy()
  })

  it('swaps to the friendly card on its next refetch once the link is turned off, instead of showing stale data', async () => {
    let off = false
    linkApi({
      [`GET /s/${TOKEN}`]: () =>
        off
          ? { status: 410, body: { error: { code: 'link_off', message: 'This link has been turned off. Ask Dan for the breakdown.' } } }
          : { status: 200, body: readmePublic() },
    })
    renderApp(`/s/${TOKEN}`)
    await screen.findByText('Which one are you?')
    off = true
    window.dispatchEvent(new Event('visibilitychange'))
    expect((await screen.findByRole('alert')).textContent).toContain('This link has been turned off. Ask Dan for the breakdown.')
    expect(screen.queryByText('Which one are you?')).toBeNull()
  })

  it('swaps to the friendly card when a tick finds the link turned off', async () => {
    localStorage.setItem(PICK_KEY, 'arjun')
    let off = false
    const gone = { status: 410, body: { error: { code: 'link_off', message: 'This link has been turned off. Ask Dan for the breakdown.' } } }
    linkApi({
      [`GET /s/${TOKEN}`]: () => (off ? gone : { status: 200, body: readmePublic() }),
      [`POST /s/${TOKEN}/people/arjun/paid`]: () => {
        off = true
        return gone
      },
    })
    renderApp(`/s/${TOKEN}`)
    fireEvent.click(await screen.findByRole('button', { name: 'I’ve paid Dan $40.72' }))
    expect((await screen.findByRole('alert')).textContent).toContain('This link has been turned off. Ask Dan for the breakdown.')
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'I’ve paid Dan $40.72' })).toBeNull())
  })

  it("shows a friendly card for a link that doesn't exist (404)", async () => {
    fakeApi({ [`GET /s/${TOKEN}`]: () => ({ status: 404, body: { error: { code: 'not_found', message: 'This link does not exist.' } } }) })
    renderApp(`/s/${TOKEN}`)
    expect((await screen.findByRole('alert')).textContent).toMatch(/can't find this split/)
  })

  it('explains, without losing the page, when ticks are resting (429)', async () => {
    localStorage.setItem(PICK_KEY, 'arjun')
    linkApi({
      [`POST /s/${TOKEN}/people/arjun/paid`]: () => ({ status: 429, body: { error: { code: 'slow_down', message: 'Lots of ticks.' } } }),
    })
    renderApp(`/s/${TOKEN}`)
    fireEvent.click(await screen.findByRole('button', { name: 'I’ve paid Dan $40.72' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Lots of ticks on this link/)
    expect(screen.getByText('2 of 3 paid')).toBeTruthy()
  })

  it('asks search engines not to index it', async () => {
    linkApi()
    renderApp(`/s/${TOKEN}`)
    await screen.findByText('Which one are you?')
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
    cleanup()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('refetches every 30 seconds and when you come back to the tab, so ticks show up live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval'] })
    try {
      const calls = linkApi()
      renderApp(`/s/${TOKEN}`)
      await screen.findByText('Which one are you?')
      const reads = () => calls.filter((c) => c.key === `GET /s/${TOKEN}`).length
      expect(reads()).toBe(1)
      vi.advanceTimersByTime(30_000)
      await vi.waitFor(() => expect(reads()).toBe(2))
      window.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => expect(reads()).toBe(3))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the share link in the real app shell', () => {
  it.each([
    ['signed out', () => {}],
    ['while Clerk is still loading', () => (clerk.loaded = false)],
    ["when Clerk can't load at all", () => ((clerk.loaded = false), (clerk.failed = true))],
  ])('renders %s', async (_, setUp) => {
    setUp()
    linkApi()
    window.history.replaceState(null, '', `/s/${TOKEN}`)
    render(<Root publishableKey="pk_test_example" />)
    expect(await screen.findByText('Which one are you?')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading SquadSplit' })).toBeNull()
    expect(screen.queryByText(/Can't reach sign-in/)).toBeNull()
  })

  it('renders even before a Clerk key is set up', async () => {
    linkApi()
    window.history.replaceState(null, '', `/s/${TOKEN}`)
    render(<Root publishableKey={undefined} />)
    expect(await screen.findByText('Which one are you?')).toBeTruthy()
  })
})

