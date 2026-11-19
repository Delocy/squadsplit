import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, group, groupHandlers, member } from './group-fixtures'
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
  it('focuses its first field, slides out on Cancel and gives focus back to Mark paid', async () => {
    fakeApi(groupHandlers({ balances: owing }))
    renderApp('/groups/g1')
    const markPaid = await screen.findByRole('button', { name: 'Mark paid' })
    fireEvent.click(markPaid)
    const form = screen.getByRole('form', { name: 'Mark a payment' })
    await vi.waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Paid to')))

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
    inviteCode: null,
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
})
