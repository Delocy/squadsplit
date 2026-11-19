import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../src/queryKeys'
import { ME } from './clerk-mock'
import { BOB, expense, group, groupHandlers, member } from './group-fixtures'
import { fakeApi, renderApp } from './harness'
import { mockReducedMotion } from './motion-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const owing = { balances: { [ME]: -3000, [BOB]: 3000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 3000 }] }

describe('the expense dialog', () => {
  it('focuses the description when it opens', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    await vi.waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Description')))
  })

  it('on a touch screen, focuses the dialog instead, so the keyboard does not cover the receipt card', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    fakeApi(groupHandlers())
    renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    await vi.waitFor(() => expect(document.activeElement).toBe(dialog))
    expect(within(dialog).getByRole('region', { name: 'Scan a receipt' })).toBeTruthy()
  })

  it('fades out before going back to the group, then gives focus back to the link that opened it', async () => {
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1')
    const add = (await screen.findAllByRole('link', { name: /Add expense/ }))[0]!
    add.focus()
    fireEvent.click(add)
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(dialog.classList.contains('out')).toBe(true)
    expect(router.state.location.pathname).toBe('/groups/g1/expenses/new')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(add)
  })

  it('is a sheet with a grab handle, and its Cancel and Save stay in a footer at the bottom', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    expect(dialog.classList.contains('sheet')).toBe(true)
    expect(dialog.querySelector('.dlg-grab')).toBeTruthy()
    const footer = within(dialog).getByRole('button', { name: 'Add expense' }).closest('.sheet-foot')!
    expect([...footer.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cancel', 'Add expense'])
  })

  it('asks before closing over unsaved changes, from Cancel, Escape or the ×', async () => {
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Dinner' } })

    for (const close of [
      () => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })),
      () => fireEvent(dialog, new Event('cancel', { cancelable: true })),
      () => fireEvent.click(within(dialog).getByRole('button', { name: 'Close' })),
    ]) {
      close()
      const ask = within(dialog).getByRole('group', { name: 'Discard this expense?' })
      expect(dialog.classList.contains('out')).toBe(false)
      fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
      await vi.waitFor(() => expect(within(dialog).queryByRole('group', { name: 'Discard this expense?' })).toBeNull())
      expect((within(dialog).getByLabelText('Description') as HTMLInputElement).value).toBe('Dinner')
    }

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
  })

  it('opens again, still asking, when the browser closes it past the question (a second Escape or Back)', async () => {
    // Like a real modal: showModal opens it, and the browser's own close takes the open attribute away.
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true })
    try {
      fakeApi(groupHandlers())
      const router = renderApp('/groups/g1/expenses/new')
      const dialog = await screen.findByRole('dialog', { name: 'New expense' })
      fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Dinner' } })
      fireEvent(dialog, new Event('cancel', { cancelable: true }))
      expect(within(dialog).getByRole('group', { name: 'Discard this expense?' })).toBeTruthy()

      // The second one can't be cancelled: the browser closes the dialog.
      fireEvent(dialog, new Event('cancel', { cancelable: false }))
      dialog.removeAttribute('open')
      fireEvent(dialog, new Event('close'))

      expect(dialog.hasAttribute('open')).toBe(true)
      expect(showModal).toHaveBeenCalledTimes(2)
      expect(within(dialog).getByRole('group', { name: 'Discard this expense?' })).toBeTruthy()
      expect(router.state.location.pathname).toBe('/groups/g1/expenses/new')
      expect((within(dialog).getByLabelText('Description') as HTMLInputElement).value).toBe('Dinner')
    } finally {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    }
  })

  it('follows the browser closing it while nothing was typed: back to the group', async () => {
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    dialog.removeAttribute('open')
    fireEvent(dialog, new Event('close'))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
  })

  it('asks before a swipe-back (or any route change) drops unsaved changes, and focuses Cancel on Keep editing', async () => {
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Dinner' } })

    await act(() => router.navigate('/groups/g1'))
    const ask = within(within(dialog).getByRole('group', { name: 'Discard this expense?' }))
    expect(router.state.location.pathname).toBe('/groups/g1/expenses/new')
    fireEvent.click(ask.getByRole('button', { name: 'Keep editing' }))
    await vi.waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })))

    await act(() => router.navigate('/groups/g1'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
  })

  it('says why when the expenses fail to load, not "may have been deleted"', async () => {
    // A 4xx, so the page doesn't retry first (Try again itself is ErrorCard's, tested with the groups list).
    const calls = fakeApi(groupHandlers({}, { 'GET /groups/g1/expenses': () => ({ status: 409, body: { error: { code: 'blocked', message: 'Something broke' } } }) }))
    renderApp('/groups/g1/expenses/e7')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect((await dialog.findByRole('alert')).textContent).toContain('Something broke')
    expect(dialog.queryByText(/may have been deleted/)).toBeNull()
    // Read by the home (and its prefetch), not again by the sheet: no loop of refetches.
    await new Promise((r) => setTimeout(r, 200))
    expect(calls.filter((c) => c.key === 'GET /groups/g1/expenses').length).toBeLessThanOrEqual(2)
  })

  it('closes without asking when nothing was typed', async () => {
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
  })

  it('closes at once under reduced motion', async () => {
    mockReducedMotion(true)
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Close' })))
    expect(dialog.classList.contains('out')).toBe(false)
    expect(router.state.location.pathname).toBe('/groups/g1')
  })
})

describe('the settle form', () => {
  it('opens inside the row you tapped, scrolls to it and focuses the amount', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    fakeApi(groupHandlers({ balances: owing }))
    renderApp('/groups/g1')
    const markPaid = await screen.findByRole('button', { name: 'Mark paid' })
    fireEvent.click(markPaid)
    const form = screen.getByRole('form', { name: 'Mark a payment' })

    expect(form.closest('li')).toBe(markPaid.closest('li'))
    await vi.waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Amount')))
    expect(scrolled.mock.contexts[0]).toBe(form)
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  it('names what its button will record, and never says Submit', async () => {
    fakeApi(groupHandlers({ balances: owing }))
    renderApp('/groups/g1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
    const form = within(screen.getByRole('form', { name: 'Mark a payment' }))

    expect(form.getByRole('button', { name: 'Record $30.00 to Bob' })).toBeTruthy()
    fireEvent.change(form.getByLabelText('Amount'), { target: { value: '12.4' } })
    expect(form.getByRole('button', { name: 'Record $12.40 to Bob' })).toBeTruthy()
    fireEvent.change(form.getByLabelText('Amount'), { target: { value: '' } })
    expect(form.getByRole('button', { name: 'Mark as paid' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Submit')
  })

  it('closes the form and says why when its row goes while it is open', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fakeApi(groupHandlers({ balances: owing }))
    renderApp('/groups/g1', queryClient)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12.40' } })

    // Someone added an expense: the suggestions changed, and "You → Bob" is gone.
    act(() => queryClient.setQueryData(queryKeys.balances('g1'), { balances: { [ME]: 0, [BOB]: 0 }, suggestions: [] }))
    expect(await screen.findByText('Settle up changed while you had that open. Have another look before you mark it paid.')).toBeTruthy()
    await vi.waitFor(() => expect(screen.queryByRole('form', { name: 'Mark a payment' })).toBeNull())
  })

  it('slides out on Cancel and gives focus back to Mark paid', async () => {
    fakeApi(groupHandlers({ balances: owing }))
    renderApp('/groups/g1')
    const markPaid = await screen.findByRole('button', { name: 'Mark paid' })
    fireEvent.click(markPaid)
    const form = screen.getByRole('form', { name: 'Mark a payment' })
    await vi.waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Amount')))

    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(form.classList.contains('out')).toBe(true)
    await vi.waitFor(() => expect(screen.queryByRole('form', { name: 'Mark a payment' })).toBeNull())
    expect(document.activeElement).toBe(markPaid)
  })

  it('goes at once under reduced motion', async () => {
    mockReducedMotion(true)
    fakeApi(groupHandlers({ balances: owing }))
    renderApp('/groups/g1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    expect(screen.queryByRole('form', { name: 'Mark a payment' })).toBeNull()
  })
})

describe('confirm bars', () => {
  const bobsGroup = group({
    ownerId: BOB,
    members: [member(BOB, 'Bob', { animal: 'koala', color: 'mint' }, { role: 'owner' }), member(ME, 'Alice', { animal: 'fox', color: 'peach' })],
  })

  it('focus Cancel when they open, slide out on Cancel and give focus back to the button that opened them', async () => {
    fakeApi(groupHandlers({ group: bobsGroup }))
    renderApp('/groups/g1/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Leave group' }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await vi.waitFor(() => expect(document.activeElement).toBe(cancel))

    fireEvent.click(cancel)
    expect(cancel.closest('.confirm')!.classList.contains('out')).toBe(true)
    const leave = await screen.findByRole('button', { name: 'Leave group' })
    expect(document.activeElement).toBe(leave)
  })

  it('ask their question on its own line, with Cancel and a filled danger button in a row under it', async () => {
    fakeApi(groupHandlers({ group: bobsGroup }))
    renderApp('/groups/g1/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Leave group' }))
    const bar = screen.getByRole('group', { name: 'Leave Bali Trip?' })
    const [question, actions] = [...bar.children]
    expect(question!.textContent).toBe('Leave Bali Trip?')
    expect(within(actions as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Yes, leave'])
    expect(within(bar).getByRole('button', { name: 'Yes, leave' }).className).toBe('btn danger solid')
  })
})
