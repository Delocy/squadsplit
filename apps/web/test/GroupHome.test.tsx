import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ME } from './clerk-mock'
import { BOB, CAROL, expense, group, groupHandlers, settlement } from './group-fixtures'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const region = (name: string | RegExp) => within(screen.getByRole('region', { name }))
const count = (calls: { key: string }[], key: string) => calls.filter((c) => c.key === key).length

describe('Group home', () => {
  it('shows the group, your balance, the stats and no emoji', async () => {
    fakeApi(
      groupHandlers({
        balances: { balances: { [ME]: 4250, [BOB]: -4250 }, suggestions: [{ fromUserId: BOB, toUserId: ME, amountCents: 4250 }] },
        expenses: [
          expense({ amountCents: 9000, paidBy: ME, shares: [{ userId: ME, amountCents: 4500 }, { userId: BOB, amountCents: 4500 }] }),
          expense({ id: 'e2', amountCents: 500, paidBy: BOB, shares: [{ userId: BOB, amountCents: 500 }] }),
        ],
      }),
    )
    renderApp('/groups/g1')

    expect(await screen.findByText('Bali Trip')).toBeTruthy()
    expect(screen.getByText('· 2 members')).toBeTruthy()
    const balance = await screen.findByRole('region', { name: 'Your balance' })
    expect(balance.textContent).toContain("You're owed")
    expect(balance.textContent).toContain('$42.50')
    const stats = region('Group stats')
    expect(stats.getByText('Group spend').nextElementSibling!.textContent).toBe('$95.00')
    expect(stats.getByText('Your share').nextElementSibling!.textContent).toBe('$45.00')
    expect(stats.getByText('You paid').nextElementSibling!.textContent).toBe('$90.00')
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('links Add expense to the form and Who pays next to the wheel', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1')
    const add = await screen.findAllByRole('link', { name: /Add expense/ })
    expect(add[0]!.getAttribute('href')).toBe('/groups/g1/expenses/new')
    const wheel = screen.getAllByRole('link', { name: /Who pays next|Spin the wheel/ })
    expect(wheel.every((a) => a.getAttribute('href') === '/groups/g1/wheel')).toBe(true)
  })

  it('says the group cannot be found when you are not a member', async () => {
    fakeApi(groupHandlers({}, { 'GET /groups/g1': () => ({ status: 404, body: { error: { code: 'not_found', message: 'Group not found' } } }) }))
    renderApp('/groups/g1')
    expect(await screen.findByText(/can't find this group/)).toBeTruthy()
  })

  describe('Settle up', () => {
    it('asks the creditor to confirm or reject, counts it, and confirms', async () => {
      const calls = fakeApi(
        groupHandlers(
          { pending: [settlement({ id: 's1', fromUserId: BOB, toUserId: ME, amountCents: 1200 })] },
          { 'POST /settlements/s1/confirm': () => ({ status: 200, body: settlement({ status: 'confirmed' }) }) },
        ),
      )
      renderApp('/groups/g1')
      const settle = await screen.findByRole('region', { name: /Settle up/ })
      expect(await within(settle).findByText('Bob says they paid you $12.00')).toBeTruthy()
      expect(within(settle).getByLabelText('1 needs your action').textContent).toBe('1')
      expect(within(settle).getByRole('button', { name: 'Reject' })).toBeTruthy()

      const before = count(calls, 'GET /groups/g1/balances')
      fireEvent.click(within(settle).getByRole('button', { name: 'Confirm' }))
      await vi.waitFor(() => expect(count(calls, 'POST /settlements/s1/confirm')).toBe(1))
      // Every mutation refetches everything about the group.
      await vi.waitFor(() => {
        for (const key of ['GET /groups/g1', 'GET /groups/g1/balances', 'GET /groups/g1/expenses', 'GET /groups/g1/settlements?status=pending', 'GET /groups/g1/badges', 'GET /groups/g1/feed']) {
          expect(count(calls, key), key).toBeGreaterThan(1)
        }
      })
      expect(count(calls, 'GET /groups/g1/balances')).toBeGreaterThan(before)
    })

    it('rejects', async () => {
      const calls = fakeApi(
        groupHandlers(
          { pending: [settlement({ id: 's1' })] },
          { 'POST /settlements/s1/reject': () => ({ status: 200, body: settlement({ status: 'rejected' }) }) },
        ),
      )
      renderApp('/groups/g1')
      fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
      await vi.waitFor(() => expect(count(calls, 'POST /settlements/s1/reject')).toBe(1))
    })

    it('lets the debtor undo a payment that is waiting for confirmation', async () => {
      const calls = fakeApi(
        groupHandlers(
          { pending: [settlement({ id: 's2', fromUserId: ME, toUserId: BOB, amountCents: 800 })] },
          { 'POST /settlements/s2/cancel': () => ({ status: 200, body: settlement({ status: 'cancelled' }) }) },
        ),
      )
      renderApp('/groups/g1')
      expect(await screen.findByText('Waiting for Bob to confirm')).toBeTruthy()
      expect(screen.getByText('You marked $8.00 as paid.')).toBeTruthy()
      expect(screen.queryByLabelText(/needs your action/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await vi.waitFor(() => expect(count(calls, 'POST /settlements/s2/cancel')).toBe(1))
    })

    it('opens a settle form pre-filled with the suggestion, minus what is already waiting for confirmation', async () => {
      const calls = fakeApi(
        groupHandlers(
          {
            balances: { balances: { [ME]: -3000, [BOB]: 3000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 3000 }] },
            pending: [settlement({ id: 's2', fromUserId: ME, toUserId: BOB, amountCents: 1000 })],
          },
          { 'POST /groups/g1/settlements': () => ({ status: 201, body: settlement({ id: 's3', fromUserId: ME, toUserId: BOB }) }) },
        ),
      )
      renderApp('/groups/g1')
      const settle = await screen.findByRole('region', { name: /Settle up/ })
      expect(await within(settle).findByText('You → Bob')).toBeTruthy()
      fireEvent.click(within(settle).getByRole('button', { name: 'Mark paid' }))
      // Nothing is sent until the form is submitted.
      expect(count(calls, 'POST /groups/g1/settlements')).toBe(0)
      const form = within(within(settle).getByRole('form', { name: 'Mark a payment' }))
      expect((form.getByLabelText('Paid to') as HTMLSelectElement).value).toBe(BOB)
      expect((form.getByLabelText('Amount') as HTMLInputElement).value).toBe('20.00')
      fireEvent.click(form.getByRole('button', { name: 'Submit' }))
      await vi.waitFor(() => expect(count(calls, 'POST /groups/g1/settlements')).toBe(1))
      expect(calls.find((c) => c.key === 'POST /groups/g1/settlements')!.body).toEqual({ toUserId: BOB, amountCents: 2000 })
      await vi.waitFor(() => expect(within(settle).queryByRole('form', { name: 'Mark a payment' })).toBeNull())
    })

    it('posts a partial amount as typed', async () => {
      const calls = fakeApi(
        groupHandlers(
          { balances: { balances: { [ME]: -3000, [BOB]: 3000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 3000 }] } },
          { 'POST /groups/g1/settlements': () => ({ status: 201, body: settlement({ id: 's3', fromUserId: ME, toUserId: BOB }) }) },
        ),
      )
      renderApp('/groups/g1')
      fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: ' 12.5 ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await vi.waitFor(() => expect(count(calls, 'POST /groups/g1/settlements')).toBe(1))
      expect(calls.find((c) => c.key === 'POST /groups/g1/settlements')!.body).toEqual({ toUserId: BOB, amountCents: 1250 })
    })

    it('lets you pay a creditor other than the suggested one, up to what they are owed', async () => {
      const DAVE = 'user_dave'
      const withDave = group()
      withDave.members.push({ userId: DAVE, displayName: 'Dave', avatarUrl: null, role: 'member', active: true })
      const calls = fakeApi(
        groupHandlers(
          {
            group: withDave,
            balances: { balances: { [ME]: -3000, [BOB]: 2500, [DAVE]: 500, [CAROL]: 0 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 2500 }] },
          },
          { 'POST /groups/g1/settlements': () => ({ status: 201, body: settlement({ id: 's3', fromUserId: ME, toUserId: DAVE }) }) },
        ),
      )
      renderApp('/groups/g1')
      fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      const payee = screen.getByLabelText('Paid to') as HTMLSelectElement
      // Only current members who are owed money (and never you).
      expect([...payee.options].map((o) => o.textContent)).toEqual(['Bob', 'Dave'])
      fireEvent.change(payee, { target: { value: DAVE } })
      expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('5.00')
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await vi.waitFor(() => expect(count(calls, 'POST /groups/g1/settlements')).toBe(1))
      expect(calls.find((c) => c.key === 'POST /groups/g1/settlements')!.body).toEqual({ toUserId: DAVE, amountCents: 500 })
    })

    it('explains an amount over the cap, or not an amount, without posting; Cancel closes the form', async () => {
      const calls = fakeApi(
        groupHandlers({
          balances: { balances: { [ME]: -3000, [BOB]: 3000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 3000 }] },
          pending: [settlement({ id: 's2', fromUserId: ME, toUserId: BOB, amountCents: 1000 })],
        }),
      )
      renderApp('/groups/g1')
      fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      const amount = screen.getByLabelText('Amount')
      fireEvent.change(amount, { target: { value: '25.00' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      expect(screen.getByRole('alert').textContent).toBe('You can mark at most $20.00 as paid to Bob right now.')

      fireEvent.change(amount, { target: { value: '0' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      expect(screen.getByRole('alert').textContent).toBe('Enter an amount of at least $0.01.')

      fireEvent.change(amount, { target: { value: '12.345' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      expect(screen.getByRole('alert').textContent).toBe('Enter an amount like 12.50.')
      expect(count(calls, 'POST /groups/g1/settlements')).toBe(0)

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('form', { name: 'Mark a payment' })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('disables Mark paid while the whole debt is waiting for confirmation', async () => {
      fakeApi(
        groupHandlers({
          balances: { balances: { [ME]: -1000, [BOB]: 1000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 1000 }] },
          pending: [settlement({ id: 's2', fromUserId: ME, toUserId: BOB, amountCents: 1000 })],
        }),
      )
      renderApp('/groups/g1')
      const button = (await screen.findByRole('button', { name: 'Mark paid' })) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    })

    it('shows the API message when the payment is more than you owe', async () => {
      fakeApi(
        groupHandlers(
          { balances: { balances: { [ME]: -3000, [BOB]: 3000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 3000 }] } },
          {
            'POST /groups/g1/settlements': () => ({
              status: 409,
              body: { error: { code: 'exceeds_debt', message: 'You can settle at most 1500 cents with this member right now' } },
            }),
          },
        ),
      )
      renderApp('/groups/g1')
      fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      expect(await screen.findByText('You can mark at most $30.00 as paid right now.')).toBeTruthy()
      expect(screen.queryByText(/cents/)).toBeNull()
    })

    it('keeps the API message for other settlement errors', async () => {
      fakeApi(
        groupHandlers(
          { balances: { balances: { [ME]: -3000, [BOB]: 3000 }, suggestions: [{ fromUserId: ME, toUserId: BOB, amountCents: 3000 }] } },
          {
            'POST /groups/g1/settlements': () => ({
              status: 422,
              body: { error: { code: 'not_a_member', message: 'You can only settle up with a current member of the group' } },
            }),
          },
        ),
      )
      renderApp('/groups/g1')
      fireEvent.click(await screen.findByRole('button', { name: 'Mark paid' }))
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      expect(await screen.findByText('You can only settle up with a current member of the group')).toBeTruthy()
    })

    it('offers no Mark paid to someone who has left the group', async () => {
      fakeApi(
        groupHandlers({
          balances: { balances: { [ME]: -500, [CAROL]: 500 }, suggestions: [{ fromUserId: ME, toUserId: CAROL, amountCents: 500 }] },
        }),
      )
      renderApp('/groups/g1')
      expect(await screen.findByText('You → Carol')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull()
    })

    it("shows other people's transfers without a button, and says when everyone is settled", async () => {
      fakeApi(
        groupHandlers({
          balances: { balances: { [ME]: 500, [BOB]: -500 }, suggestions: [{ fromUserId: BOB, toUserId: ME, amountCents: 500 }] },
        }),
      )
      renderApp('/groups/g1')
      expect(await screen.findByText('Bob → You')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull()
      cleanup()

      fakeApi(groupHandlers())
      renderApp('/groups/g1')
      expect(await screen.findByText('Everyone is settled up.')).toBeTruthy()
    })
  })

  describe('Activity', () => {
    const feed = [
      { type: 'expense' as const, at: '2026-11-19T12:00:00.000Z', expense: expense({ id: 'e1', description: 'Hotel', category: '🏨' as const, locked: true }) },
      { type: 'expense' as const, at: '2026-11-19T11:00:00.000Z', expense: expense({ id: 'e2', description: 'Taxi', category: '🚕' as const }) },
      { type: 'expense' as const, at: '2026-11-19T10:30:00.000Z', expense: expense({ id: 'e3', description: "Bob's snacks", createdBy: BOB, paidBy: BOB }) },
      { type: 'settlement' as const, at: '2026-11-19T10:00:00.000Z', settlement: settlement({ status: 'confirmed', resolvedAt: '2026-11-19T10:00:00.000Z' }) },
      { type: 'spin' as const, at: '2026-11-19T09:00:00.000Z', spin: { id: 'sp1', groupId: 'g1', spunBy: ME, winnerId: BOB, weights: {}, createdAt: '2026-11-19T09:00:00.000Z' } },
      { type: 'join' as const, at: '2026-11-18T09:00:00.000Z', userId: CAROL },
    ]

    it('lists everything, with a lock on locked expenses and edit only where allowed', async () => {
      fakeApi(groupHandlers({ group: group({ ownerId: BOB }), feed }))
      renderApp('/groups/g1')
      const activity = await screen.findByRole('region', { name: /Activity/ })
      const rows = await within(activity).findAllByRole('listitem')
      expect(rows.map((r) => r.querySelector('.t')!.textContent)).toEqual([
        'Hotellocked',
        'Taxi',
        "Bob's snacks",
        'Bob paid you',
        'Bob was picked to pay next',
        'Carol joined the group',
      ])
      // Locked: the pill and no edit. Mine and unlocked: edit. Someone else's, and I'm not the owner: no edit.
      expect(within(rows[0]!).queryByRole('link', { name: /Edit/ })).toBeNull()
      expect(within(rows[1]!).getByRole('link', { name: /Edit/ }).getAttribute('href')).toBe('/groups/g1/expenses/e2')
      expect(within(rows[2]!).queryByRole('link', { name: /Edit/ })).toBeNull()
      // The former member is greyed out.
      expect(rows[5]!.querySelector('.av.gone')).toBeTruthy()
      expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    })

    it('lets the owner edit anyone’s unlocked expense', async () => {
      fakeApi(groupHandlers({ feed }))
      renderApp('/groups/g1')
      const activity = await screen.findByRole('region', { name: /Activity/ })
      const rows = await within(activity).findAllByRole('listitem')
      expect(within(rows[2]!).getByRole('link', { name: /Edit/ })).toBeTruthy()
    })

    it('treats an expense with a former member like a locked one: a "member left" pill, no edit', async () => {
      const withCarol = expense({
        id: 'e9',
        description: 'Beach club',
        shares: [
          { userId: ME, amountCents: 500 },
          { userId: CAROL, amountCents: 500 },
        ],
      })
      const paidByCarol = expense({ id: 'e10', description: 'Carol paid', paidBy: CAROL, shares: [{ userId: ME, amountCents: 1000 }] })
      fakeApi(
        groupHandlers({
          feed: [
            { type: 'expense', at: '2026-11-19T12:00:00.000Z', expense: withCarol },
            { type: 'expense', at: '2026-11-19T11:00:00.000Z', expense: paidByCarol },
          ],
        }),
      )
      renderApp('/groups/g1')
      const activity = await screen.findByRole('region', { name: /Activity/ })
      const rows = await within(activity).findAllByRole('listitem')
      for (const row of rows) {
        expect(row.querySelector('.lock')!.textContent).toBe('member left')
        expect(within(row).queryByRole('link', { name: /Edit/ })).toBeNull()
      }
    })

    it('filters by tab', async () => {
      fakeApi(groupHandlers({ feed }))
      renderApp('/groups/g1')
      const activity = await screen.findByRole('region', { name: /Activity/ })
      await within(activity).findByText('Taxi')
      fireEvent.click(within(activity).getByRole('button', { name: 'Paybacks' }))
      expect(within(activity).getAllByRole('listitem')).toHaveLength(1)
      fireEvent.click(within(activity).getByRole('button', { name: 'Expenses' }))
      expect(within(activity).getAllByRole('listitem')).toHaveLength(3)
    })
  })

  it('shows the leaderboard and badges with names, never the badge emoji', async () => {
    fakeApi(
      groupHandlers({
        fun: {
          leaderboard: [
            { userId: ME, netCents: 4250, rank: 1 },
            { userId: BOB, netCents: -4250, rank: 2 },
          ],
          badges: [{ key: 'debt_goblin', emoji: '👺', title: 'Debt Goblin', userId: BOB }],
        },
      }),
    )
    renderApp('/groups/g1')
    const board = await screen.findByRole('region', { name: /Leaderboard/ })
    expect(await within(board).findByText('+$42.50')).toBeTruthy()
    expect(within(board).getByText('−$42.50')).toBeTruthy()
    expect(within(board).getByText('Debt Goblin').nextElementSibling!.textContent).toBe('Bob')
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
