import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuickSplitInput } from '@squadsplit/shared'
import { loadQuickDraft, saveQuickDraft } from '../src/quick/draftStore'
import { newQuickDraft } from '../src/quick/draft'
import { fakeApi, renderApp } from './harness'
import { readmeSplit } from './quick-fixtures'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

const api = () =>
  fakeApi({
    'GET /quick-splits': () => ({ status: 200, body: [] }),
    'GET /groups': () => ({ status: 200, body: [] }),
    'POST /quick-splits': () => ({ status: 201, body: readmeSplit() }),
    'PUT /quick-splits/q1': () => ({ status: 200, body: readmeSplit() }),
    'GET /quick-splits/q1': () => ({ status: 200, body: readmeSplit() }),
  })
const type = (label: string, value: string, scope = screen as unknown as ReturnType<typeof within>) =>
  fireEvent.change(scope.getByLabelText(label), { target: { value } })
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value

/** A bill with one dish, ready for the People step. */
async function fillBill() {
  await screen.findByRole('heading', { name: 'Quick split' })
  type("What's it for?", 'Team lunch')
  const dish = within(screen.getByRole('group', { name: 'Dish 1' }))
  type('Dish name', 'Laksa', dish)
  type('Price', '10', dish)
}
const next = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }))

describe('Quick split steps and Back', () => {
  it('gives each step its own history entry, so Back goes to the previous step with the bill kept', async () => {
    api()
    const router = renderApp('/quick/new')
    await fillBill()
    next(/Next: who.s in/)
    await vi.waitFor(() => expect(router.state.location.search).toBe('?step=people'))
    type('Add a name', 'Mei')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    next(/Next: who had what/)
    await vi.waitFor(() => expect(router.state.location.search).toBe('?step=assign'))

    await act(() => router.navigate(-1))
    expect(await screen.findByRole('list', { name: "Who's splitting" })).toBeTruthy()
    expect(screen.getByRole('list', { name: "Who's splitting" }).textContent).toContain('Mei')
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/quick/new')
    expect(value("What's it for?")).toBe('Team lunch')
  })

  it("the step bar's Back steps back through history too", async () => {
    api()
    const router = renderApp('/quick/new')
    await fillBill()
    next(/Next: who.s in/)
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await vi.waitFor(() => expect(router.state.location.search).toBe(''))
    expect(value("What's it for?")).toBe('Team lunch')
    // Forward is the People step again.
    await act(() => router.navigate(1))
    expect(router.state.location.search).toBe('?step=people')
  })

  it('keeps the draft in this tab, so coming back to the same entry (a reload, say) restores it', async () => {
    api()
    const router = renderApp('/quick/new')
    await fillBill()
    next(/Next: who.s in/)
    await vi.waitFor(() => expect(router.state.location.search).toBe('?step=people'))
    const { draftId } = router.state.location.state as { draftId: string }
    cleanup()

    // The same tab's history after a reload: the Bill entry, then People.
    api()
    renderApp([
      { pathname: '/quick/new', state: { draftId } },
      { pathname: '/quick/new', search: '?step=people', state: { draftId, viaNext: true } },
    ])
    expect(await screen.findByRole('list', { name: "Who's splitting" })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await vi.waitFor(() => expect(value("What's it for?")).toBe('Team lunch'))
  })

  it('starts a fresh bill from the Quick split button, not an old draft', async () => {
    api()
    saveQuickDraft('old', { start: newQuickDraft('', '2026-11-19', { animal: 'fox', color: 'peach' }), draft: { ...newQuickDraft('', '2026-11-19', { animal: 'fox', color: 'peach' }), title: 'Old one' } })
    renderApp('/quick/new')
    await screen.findByRole('heading', { name: 'Quick split' })
    expect(value("What's it for?")).toBe('')
  })

  it('lands on the bill when a later step is opened with nothing to show', async () => {
    api()
    const router = renderApp('/quick/new?step=assign')
    await screen.findByRole('heading', { name: 'Quick split' })
    await vi.waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.getByLabelText("What's it for?")).toBeTruthy()
  })

  it('asks before leaving a bill with changes, and leaves only on Leave', async () => {
    api()
    const router = renderApp('/quick/new')
    await fillBill()
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    const ask = within(await screen.findByRole('group', { name: "Leave this bill? Your dishes won't be saved." }))
    expect(ask.getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep editing', 'Leave'])
    fireEvent.click(ask.getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe('/quick/new')
    expect(value("What's it for?")).toBe('Team lunch')

    // Back from the first step asks too.
    await act(() => router.navigate('/groups'))
    fireEvent.click(within(await screen.findByRole('group', { name: /Leave this bill/ })).getByRole('button', { name: 'Leave' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
  })

  it('leaves an untouched bill without asking', async () => {
    api()
    const router = renderApp('/quick/new')
    await screen.findByRole('heading', { name: 'Quick split' })
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
  })

  it('gives the share card its own entry: Back returns to Assign, and saving again updates the same split', async () => {
    const calls = api()
    const router = renderApp('/quick/new')
    await fillBill()
    next(/Next: who.s in/)
    type('Add a name', 'Mei')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    next(/Next: who had what/)
    fireEvent.click(within(await screen.findByRole('group', { name: 'Laksa' })).getByRole('button', { name: 'Mei' }))
    next(/Make the share card/)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/quick/q1'))

    // Saved, the draft is gone from storage: Back opens the saved split at Assign, to edit.
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('squadsplit.quickDraft.'))).toEqual([])
    await act(() => router.navigate(-1))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/quick/q1/edit'))
    expect(router.state.location.search).toBe('?step=assign')
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => expect(calls.some((c) => c.key === 'PUT /quick-splits/q1')).toBe(true))
    expect(calls.filter((c) => c.key === 'POST /quick-splits')).toHaveLength(1)
    expect((calls.find((c) => c.key === 'PUT /quick-splits/q1')!.body as QuickSplitInput).people.every((p) => p.id)).toBe(true)
    // Saving again is an edit: the card isn't "just made".
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/quick/q1'))
    expect(router.state.location.state).toEqual({ fresh: false })
  })

  it('forgets the draft on Leave, and Back to it goes to your groups, never an empty bill', async () => {
    api()
    const router = renderApp('/groups')
    await screen.findByRole('heading', { name: 'Your groups' })
    await act(() => router.navigate('/quick/new'))
    await fillBill()
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    fireEvent.click(within(await screen.findByRole('group', { name: /Leave this bill/ })).getByRole('button', { name: 'Leave' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('squadsplit.quickDraft.'))).toEqual([])

    await act(() => router.navigate(-1))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
  })

  it('gives focus back to what tried to leave when you keep editing', async () => {
    api()
    renderApp('/quick/new')
    await fillBill()
    const cancel = screen.getByRole('link', { name: 'Cancel' })
    cancel.focus()
    fireEvent.click(cancel)
    fireEvent.click(within(await screen.findByRole('group', { name: /Leave this bill/ })).getByRole('button', { name: 'Keep editing' }))
    expect(document.activeElement).toBe(cancel)
  })
})

describe('the quick split draft store', () => {
  it('reads back what it saved, per draft', () => {
    const d = newQuickDraft('Dan', '2026-11-19', { animal: 'fox', color: 'peach' })
    saveQuickDraft('a', { start: d, draft: { ...d, title: 'A' } })
    expect(loadQuickDraft('a')?.draft.title).toBe('A')
    expect(loadQuickDraft('b')).toBeNull()
  })

  it('never throws when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const d = newQuickDraft('Dan', '2026-11-19', { animal: 'fox', color: 'peach' })
    expect(() => saveQuickDraft('a', { start: d, draft: d })).not.toThrow()
    expect(loadQuickDraft('a')).toBeNull()
  })
})
