import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, CAROL, expense, groupHandlers } from './group-fixtures'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true'

async function openNewExpense(extra = {}) {
  const calls = fakeApi(groupHandlers({}, extra))
  const router = renderApp('/groups/g1/expenses/new')
  const dialog = await screen.findByRole('dialog', { name: 'New expense' })
  return { calls, router, dialog: within(dialog) }
}

describe('Expense form', () => {
  it('only offers current members as payer and participants, and starts with you paying', async () => {
    const { dialog } = await openNewExpense()
    const payers = within(dialog.getByRole('group', { name: 'Paid by' }))
    expect(payers.getAllByRole('button').map((b) => b.textContent!.trim())).toEqual(['Alice', 'Bob'])
    expect(pressed(payers.getByRole('button', { name: 'Alice' }))).toBe(true)
    const split = within(dialog.getByRole('group', { name: 'Split equally between' }))
    expect(split.getAllByRole('button').map((b) => b.textContent!.trim())).toEqual(['Alice', 'Bob'])
  })

  it('previews equal shares with splitEqual: the payer takes the leftover cent', async () => {
    const { dialog } = await openNewExpense()
    type(dialog.getByLabelText('Amount (SGD)'), '10.01')
    expect(dialog.getByTestId('preview').textContent).toBe('Each share: Alice $5.01 · Bob $5.00')

    fireEvent.click(within(dialog.getByRole('group', { name: 'Paid by' })).getByRole('button', { name: 'Bob' }))
    expect(dialog.getByTestId('preview').textContent).toBe('Each share: Alice $5.00 · Bob $5.01')
  })

  it('adds an equal expense and goes back to the group', async () => {
    const { calls, router, dialog } = await openNewExpense({
      'POST /groups/g1/expenses': () => ({ status: 201, body: expense() }),
    })
    type(dialog.getByLabelText('Description'), '  Dinner at Lau Pa Sat ')
    type(dialog.getByLabelText('Amount (SGD)'), '90')
    fireEvent.click(dialog.getByRole('button', { name: 'Drinks' }))
    fireEvent.click(within(dialog.getByRole('group', { name: 'Split equally between' })).getByRole('button', { name: 'Bob' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Add expense' }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    const post = calls.find((c) => c.key === 'POST /groups/g1/expenses')!
    expect(post.body).toMatchObject({
      description: 'Dinner at Lau Pa Sat',
      amountCents: 9000,
      paidBy: ME,
      category: '🍻',
      currency: 'SGD',
      split: { type: 'equal', participantIds: [ME] },
    })
  })

  it('explains what is missing instead of calling the API', async () => {
    const { calls, dialog } = await openNewExpense()
    fireEvent.click(dialog.getByRole('button', { name: 'Add expense' }))
    expect(dialog.getByRole('alert').textContent).toBe('Add a description.')
    type(dialog.getByLabelText('Description'), 'Snacks')
    type(dialog.getByLabelText('Amount (SGD)'), '0.01')
    fireEvent.click(dialog.getByRole('button', { name: 'Add expense' }))
    expect(dialog.getByRole('alert').textContent).toBe("That's too small to split between that many people.")
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false)
  })

  it('in exact mode, shows what is left to assign and only enables submit when the shares add up', async () => {
    const { calls, router, dialog } = await openNewExpense({
      'POST /groups/g1/expenses': () => ({ status: 201, body: expense() }),
    })
    type(dialog.getByLabelText('Description'), 'Groceries')
    type(dialog.getByLabelText('Amount (SGD)'), '10.00')
    fireEvent.click(dialog.getByRole('button', { name: 'Exact amounts' }))

    type(dialog.getByLabelText("Alice's share"), '4.00')
    type(dialog.getByLabelText("Bob's share"), '5.00')
    expect(dialog.getByText('$1.00 left to assign')).toBeTruthy()
    const submit = dialog.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    type(dialog.getByLabelText("Bob's share"), '6.00')
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(calls.find((c) => c.key === 'POST /groups/g1/expenses')!.body).toMatchObject({
      amountCents: 1000,
      split: {
        type: 'exact',
        shares: [
          { userId: ME, amountCents: 400 },
          { userId: BOB, amountCents: 600 },
        ],
      },
    })
  })

  it('in exact mode, says when the shares go over the total', async () => {
    const { dialog } = await openNewExpense()
    type(dialog.getByLabelText('Amount (SGD)'), '10.00')
    fireEvent.click(dialog.getByRole('button', { name: 'Exact amounts' }))
    type(dialog.getByLabelText("Alice's share"), '7.00')
    type(dialog.getByLabelText("Bob's share"), '5.00')
    expect(dialog.getByText('$2.00 too much assigned')).toBeTruthy()
    expect((dialog.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('by item: SG service charge and GST, a live total, and each share from splitItemized', async () => {
    const { calls, router, dialog } = await openNewExpense({
      'POST /groups/g1/expenses': () => ({ status: 201, body: expense() }),
    })
    type(dialog.getByLabelText('Description'), 'Hawker dinner')
    fireEvent.click(dialog.getByRole('button', { name: 'By item' }))
    // On by default in By item mode, as in the playground.
    const sg = dialog.getByRole('checkbox', { name: /Restaurant bill \(SG\)/ }) as HTMLInputElement
    expect(sg.checked).toBe(true)

    const first = within(dialog.getByRole('group', { name: 'Item 1' }))
    type(first.getByLabelText('Item name'), 'Laksa')
    type(first.getByLabelText('Price'), '10.00')
    fireEvent.click(first.getByRole('button', { name: 'Alice' }))

    fireEvent.click(dialog.getByRole('button', { name: 'Add item' }))
    const second = within(dialog.getByRole('group', { name: 'Item 2' }))
    type(second.getByLabelText('Item name'), 'Satay')
    type(second.getByLabelText('Price'), '20.00')
    fireEvent.click(second.getByRole('button', { name: 'Bob' }))

    expect(dialog.getByTestId('bill-total').textContent).toBe('$35.97')
    expect(dialog.getByTestId('preview').textContent).toBe('Each share: Alice $11.99 · Bob $23.98')

    fireEvent.click(dialog.getByRole('button', { name: 'Add expense' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(calls.find((c) => c.key === 'POST /groups/g1/expenses')!.body).toMatchObject({
      description: 'Hawker dinner',
      amountCents: 3597,
      split: {
        type: 'itemized',
        serviceChargeBps: 1000,
        gstBps: 900,
        items: [
          { name: 'Laksa', amountCents: 1000, userIds: [ME] },
          { name: 'Satay', amountCents: 2000, userIds: [BOB] },
        ],
      },
    })
  })

  it('by item with the SG toggle switched off: the total is the plain subtotal', async () => {
    const { dialog } = await openNewExpense()
    fireEvent.click(dialog.getByRole('button', { name: 'By item' }))
    fireEvent.click(dialog.getByRole('checkbox', { name: /Restaurant bill \(SG\)/ }))
    const first = within(dialog.getByRole('group', { name: 'Item 1' }))
    type(first.getByLabelText('Price'), '12.50')
    fireEvent.click(first.getByRole('button', { name: 'Alice' }))
    fireEvent.click(first.getByRole('button', { name: 'Bob' }))
    expect(dialog.getByTestId('bill-total').textContent).toBe('$12.50')
    expect(dialog.getByTestId('preview').textContent).toBe('Each share: Alice $6.25 · Bob $6.25')
  })

  it('shows the API message when saving fails', async () => {
    const { dialog } = await openNewExpense({
      'POST /groups/g1/expenses': () => ({
        status: 422,
        body: { error: { code: 'not_a_member', message: 'The payer and everyone in the split must be current members' } },
      }),
    })
    type(dialog.getByLabelText('Description'), 'Taxi')
    type(dialog.getByLabelText('Amount (SGD)'), '12')
    fireEvent.click(dialog.getByRole('button', { name: 'Add expense' }))
    expect(await dialog.findByText('The payer and everyone in the split must be current members')).toBeTruthy()
  })

  it('edits an existing expense with its values filled in', async () => {
    const existing = expense({
      id: 'e7',
      description: 'Groceries',
      amountCents: 1000,
      splitType: 'exact',
      shares: [
        { userId: ME, amountCents: 300 },
        { userId: BOB, amountCents: 700 },
      ],
    })
    const calls = fakeApi(
      groupHandlers({ expenses: [existing] }, { 'PATCH /expenses/e7': () => ({ status: 200, body: existing }) }),
    )
    const router = renderApp('/groups/g1/expenses/e7')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect((dialog.getByLabelText('Description') as HTMLInputElement).value).toBe('Groceries')
    expect((dialog.getByLabelText("Bob's share") as HTMLInputElement).value).toBe('7.00')

    type(dialog.getByLabelText("Alice's share"), '2.00')
    type(dialog.getByLabelText("Bob's share"), '8.00')
    fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(calls.find((c) => c.key === 'PATCH /expenses/e7')!.body).toMatchObject({
      description: 'Groceries',
      split: { type: 'exact', shares: [{ userId: ME, amountCents: 200 }, { userId: BOB, amountCents: 800 }] },
    })
  })

  it('turns the SG toggle on when an equal expense is switched to By item', async () => {
    fakeApi(groupHandlers({ expenses: [expense({ id: 'e7' })] }))
    renderApp('/groups/g1/expenses/e7')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    fireEvent.click(dialog.getByRole('button', { name: 'By item' }))
    expect((dialog.getByRole('checkbox', { name: /Restaurant bill \(SG\)/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('keeps the SG toggle off for an itemized expense saved without it', async () => {
    const existing = expense({
      id: 'e9',
      amountCents: 1000,
      splitType: 'itemized',
      serviceChargeBps: 0,
      gstBps: 0,
      items: [{ name: 'Laksa', amountCents: 1000, userIds: [ME] }],
    })
    fakeApi(groupHandlers({ expenses: [existing] }))
    renderApp('/groups/g1/expenses/e9')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect((dialog.getByRole('checkbox', { name: /Restaurant bill \(SG\)/ }) as HTMLInputElement).checked).toBe(false)
    expect(dialog.getByTestId('bill-total').textContent).toBe('$10.00')
  })

  it('edits an itemized expense with its items and the SG toggle filled in', async () => {
    const existing = expense({
      id: 'e8',
      amountCents: 3597,
      splitType: 'itemized',
      serviceChargeBps: 1000,
      gstBps: 900,
      items: [
        { name: 'Laksa', amountCents: 1000, userIds: [ME] },
        { name: 'Satay', amountCents: 2000, userIds: [BOB] },
      ],
    })
    fakeApi(groupHandlers({ expenses: [existing] }))
    renderApp('/groups/g1/expenses/e8')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect((dialog.getByRole('checkbox', { name: /Restaurant bill \(SG\)/ }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog.getByRole('group', { name: 'Item 2' })).getByLabelText('Item name') as HTMLInputElement).value).toBe('Satay')
    expect(dialog.getByTestId('bill-total').textContent).toBe('$35.97')
  })

  it('deletes an expense after a second tap', async () => {
    const calls = fakeApi(
      groupHandlers({ expenses: [expense({ id: 'e7' })] }, { 'DELETE /expenses/e7': () => ({ status: 204 }) }),
    )
    const router = renderApp('/groups/g1/expenses/e7')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }))
    expect(calls.some((c) => c.key === 'DELETE /expenses/e7')).toBe(false)
    fireEvent.click(dialog.getByRole('button', { name: 'Yes, delete it' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(calls.some((c) => c.key === 'DELETE /expenses/e7')).toBe(true)
  })

  it('will not edit a locked expense', async () => {
    fakeApi(groupHandlers({ expenses: [expense({ id: 'e7', locked: true })] }))
    renderApp('/groups/g1/expenses/e7')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect(dialog.getByText(/locked/)).toBeTruthy()
    expect(dialog.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('will not edit an expense someone who has left took part in, and offers no delete', async () => {
    const calls = fakeApi(
      groupHandlers({
        expenses: [expense({ id: 'e7', shares: [{ userId: ME, amountCents: 500 }, { userId: CAROL, amountCents: 500 }] })],
      }),
    )
    renderApp('/groups/g1/expenses/e7')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    expect(dialog.getByText("Carol has left the group, so this expense can't be changed.")).toBeTruthy()
    expect(dialog.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(dialog.queryByLabelText('Description')).toBeNull()
    expect(calls.some((c) => c.key.startsWith('PATCH') || c.key.startsWith('DELETE'))).toBe(false)
  })

  it('in exact mode, asks for the total first when it is blank or zero', async () => {
    const { dialog } = await openNewExpense()
    fireEvent.click(dialog.getByRole('button', { name: 'Exact amounts' }))
    expect(dialog.getByText('Enter the total first')).toBeTruthy()
    type(dialog.getByLabelText('Amount (SGD)'), '0')
    expect(dialog.getByText('Enter the total first')).toBeTruthy()
    expect((dialog.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled).toBe(true)
    type(dialog.getByLabelText('Amount (SGD)'), '5')
    expect(dialog.queryByText('Enter the total first')).toBeNull()
    expect(dialog.getByText('$5.00 left to assign')).toBeTruthy()
  })

  it('closes back to the group', async () => {
    const { router, dialog } = await openNewExpense()
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
  })
})
