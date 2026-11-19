import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, group, groupHandlers, member, settlement } from './group-fixtures'
import { fakeApi, held, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const count = (calls: { key: string }[], key: string) => calls.filter((c) => c.key === key).length
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
/**
 * Two presses before React re-renders: the second lands on a button that isn't disabled yet. (TanStack Query tells
 * React about a new mutation on the next tick, so busy labels are looked up with findBy.)
 */
const doublePress = (button: HTMLElement) =>
  act(() => {
    button.click()
    button.click()
  })
const failure = { status: 422, body: { error: { code: 'validation', message: 'That did not work.' } } }

describe('buttons waiting on the server', () => {
  it('adds an expense once however fast you press, says so while saving, and comes back on error', async () => {
    const post = held(failure)
    const calls = fakeApi(groupHandlers({}, { 'POST /groups/g1/expenses': post.handler }))
    renderApp('/groups/g1/expenses/new')
    const dialog = within(await screen.findByRole('dialog', { name: 'New expense' }))
    type(dialog.getByLabelText('Description'), 'Taxi')
    type(dialog.getByLabelText('Amount (SGD)'), '12')

    doublePress(dialog.getByRole('button', { name: 'Add expense' }))
    const busy = (await dialog.findByRole('button', { name: 'Adding…' })) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(busy.querySelector('.spinner')).toBeTruthy()

    post.release()
    expect(await dialog.findByText('That did not work.')).toBeTruthy()
    expect((dialog.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled).toBe(false)
    expect(count(calls, 'POST /groups/g1/expenses')).toBe(1)
  })

  it('confirms a payment once, showing which button is working', async () => {
    const post = held({ status: 200, body: settlement({ status: 'confirmed' }) })
    const calls = fakeApi(groupHandlers({ pending: [settlement()] }, { 'POST /settlements/s1/confirm': post.handler }))
    renderApp('/groups/g1')
    const settle = within(await screen.findByRole('region', { name: /Settle up/ }))
    doublePress(await settle.findByRole('button', { name: 'Confirm' }))
    expect(((await settle.findByRole('button', { name: 'Confirming…' })) as HTMLButtonElement).disabled).toBe(true)
    expect((settle.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
    post.release()
    await vi.waitFor(() => expect(settle.queryByRole('button', { name: 'Confirming…' })).toBeNull())
    expect(count(calls, 'POST /settlements/s1/confirm')).toBe(1)
  })

  it('marks a payment once', async () => {
    const post = held({ status: 201, body: settlement({ fromUserId: ME, toUserId: BOB }) })
    const calls = fakeApi(
      groupHandlers(
        { balances: { balances: { [ME]: -1200, [BOB]: 1200 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 1200 }] } },
        { 'POST /groups/g1/settlements': post.handler },
      ),
    )
    renderApp('/groups/g1')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
    const form = within(screen.getByRole('form', { name: 'Mark a payment' }))
    doublePress(form.getByRole('button', { name: 'Submit' }))
    expect(((await form.findByRole('button', { name: 'Saving…' })) as HTMLButtonElement).disabled).toBe(true)
    post.release()
    await vi.waitFor(() => expect(count(calls, 'POST /groups/g1/settlements')).toBe(1))
  })

  it('spins once, with a spinner on the button', async () => {
    const post = held({ status: 201, body: { id: 'w1', groupId: 'g1', spunBy: ME, winnerId: BOB, weights: { [ME]: 1, [BOB]: 1 }, createdAt: '2026-11-19T10:00:00.000Z' } })
    const calls = fakeApi(groupHandlers({}, { 'POST /groups/g1/spins': post.handler }))
    renderApp('/groups/g1/wheel')
    doublePress(await screen.findByRole('button', { name: 'Spin' }))
    const spin = screen.getByRole('button', { name: 'Spin' }) as HTMLButtonElement
    await vi.waitFor(() => expect(spin.querySelector('.spinner')).toBeTruthy())
    expect(spin.disabled).toBe(true)
    post.release()
    await vi.waitFor(() => expect(count(calls, 'POST /groups/g1/spins')).toBe(1))
  })

  it('creates a group once', async () => {
    const post = held({ status: 201, body: group({ id: 'g9' }) })
    const calls = fakeApi({ 'POST /groups': post.handler, 'GET /groups': () => ({ status: 200, body: [] }) })
    renderApp('/groups/new')
    type(await screen.findByLabelText('Group name'), 'NYC')
    doublePress(screen.getByRole('button', { name: 'Create group' }))
    expect(((await screen.findByRole('button', { name: 'Creating…' })) as HTMLButtonElement).disabled).toBe(true)
    post.release()
    await vi.waitFor(() => expect(count(calls, 'POST /groups')).toBe(1))
  })

  it('joins once', async () => {
    const post = held({ status: 200, body: { groupId: 'g1' } })
    const calls = fakeApi(
      groupHandlers(
        {},
        {
          'GET /invites/ABCD2345': () => ({
            status: 200,
            body: { groupId: 'g1', name: 'Bali Trip', emoji: '🧡', memberCount: 2, alreadyMember: false, takenAvatars: [], myFormerAvatar: null },
          }),
          'POST /invites/ABCD2345/join': post.handler,
        },
      ),
    )
    renderApp('/join/ABCD2345')
    doublePress(await screen.findByRole('button', { name: 'Join group' }))
    expect(((await screen.findByRole('button', { name: 'Joining…' })) as HTMLButtonElement).disabled).toBe(true)
    post.release()
    await vi.waitFor(() => expect(count(calls, 'POST /invites/ABCD2345/join')).toBe(1))
  })

  it('saves your name in the group once, and the group name once', async () => {
    const save = held({ status: 200, body: member(ME, 'Ali', { animal: 'fox', color: 'peach' }) })
    const rename = held({ status: 200, body: group({ name: 'Bali 2026' }) })
    const calls = fakeApi(groupHandlers({}, { 'PATCH /groups/g1/members/me': save.handler, 'PATCH /groups/g1': rename.handler }))
    renderApp('/groups/g1/settings')
    const you = within(await screen.findByRole('region', { name: 'You in this group' }))
    type(you.getByLabelText('What should this group call you?'), 'Ali')
    doublePress(you.getByRole('button', { name: 'Save' }))
    expect(((await you.findByRole('button', { name: 'Saving…' })) as HTMLButtonElement).disabled).toBe(true)

    const name = within(screen.getByRole('region', { name: 'Name' }))
    type(name.getByLabelText('Group name'), 'Bali 2026')
    doublePress(name.getByRole('button', { name: 'Save name' }))
    expect(((await name.findByRole('button', { name: 'Saving…' })) as HTMLButtonElement).disabled).toBe(true)
    save.release()
    rename.release()
    await vi.waitFor(() => expect(count(calls, 'PATCH /groups/g1')).toBe(1))
    expect(count(calls, 'PATCH /groups/g1/members/me')).toBe(1)
  })

  it('says what a confirm bar is doing once you say yes', async () => {
    const del = held({ status: 204 })
    fakeApi(
      groupHandlers(
        { group: group({ ownerId: BOB, inviteCode: null, members: [member(BOB, 'Bob', { animal: 'koala', color: 'mint' }, { role: 'owner' }), member(ME, 'Alice', { animal: 'fox', color: 'peach' })] }) },
        { [`DELETE /groups/g1/members/${ME}`]: del.handler },
      ),
    )
    renderApp('/groups/g1/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Leave group' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, leave' }))
    const leaving = (await screen.findByRole('button', { name: 'Leaving…' })) as HTMLButtonElement
    expect(leaving.disabled).toBe(true)
    expect(leaving.querySelector('.spinner')).toBeTruthy()
    del.release()
  })
})
