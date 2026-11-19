import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api'
import { membershipErrorText } from '../src/membershipErrors'
import { ME } from './clerk-mock'
import { BOB, BOB_AVATAR, CAROL, CAROL_AVATAR, group, groupHandlers, ME_AVATAR, member } from './group-fixtures'
import { fakeApi, renderApp, type Handler } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))

const writeText = vi.fn<(text: string) => Promise<void>>()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

const conflict = (code: string, message = 'Blocked'): Handler => () => ({ status: 409, body: { error: { code, message } } })
const region = (name: string | RegExp) => within(screen.getByRole('region', { name }))
const hasCall = (calls: { key: string }[], key: string) => calls.some((c) => c.key === key)

/** The group as Alice sees it when Bob owns it: no invite code. */
const bobsGroup = () =>
  group({
    ownerId: BOB,
    inviteCode: null,
    members: [
      member(BOB, 'Bob', BOB_AVATAR, { role: 'owner' }),
      member(ME, 'Alice', ME_AVATAR),
      member(CAROL, 'Carol', CAROL_AVATAR, { active: false }),
    ],
  })

describe('Group settings', () => {
  describe('as the owner', () => {
    it('shows the invite link and a QR code, and copies the link', async () => {
      fakeApi(groupHandlers())
      renderApp('/groups/g1/settings')

      const link = `${location.origin}/join/ABCD2345`
      expect(((await screen.findByLabelText('Invite link')) as HTMLInputElement).value).toBe(link)
      const invite = region('Invite friends')
      expect(invite.getByRole('img', { name: 'QR code for the invite link' }).querySelector('path')!.getAttribute('d')).toBeTruthy()

      fireEvent.click(invite.getByRole('button', { name: 'Copy' }))
      expect(await invite.findByRole('button', { name: 'Copied' })).toBeTruthy()
      expect(writeText).toHaveBeenCalledWith(link)
      expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    })

    it('says so when the link cannot be copied', async () => {
      writeText.mockRejectedValue(new Error('denied'))
      fakeApi(groupHandlers())
      renderApp('/groups/g1/settings')
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
      expect(await screen.findByText("Couldn't copy it. Select the link and copy it yourself.")).toBeTruthy()
    })

    it('resets the invite link only after a confirm, and shows the new one', async () => {
      let code = 'ABCD2345'
      const calls = fakeApi(
        groupHandlers({}, {
          'GET /groups/g1': () => ({ status: 200, body: group({ inviteCode: code }) }),
          'POST /groups/g1/invite/reset': () => {
            code = 'WXYZ6789'
            return { status: 200, body: { inviteCode: code } }
          },
        }),
      )
      renderApp('/groups/g1/settings')
      await screen.findByLabelText('Invite link')
      const qr = () => screen.getByRole('img', { name: 'QR code for the invite link' }).querySelector('path')!.getAttribute('d')
      const before = qr()

      fireEvent.click(screen.getByRole('button', { name: 'Reset invite link' }))
      expect(screen.getByText('The old link will stop working.')).toBeTruthy()
      expect(hasCall(calls, 'POST /groups/g1/invite/reset')).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: 'Yes, reset it' }))

      await vi.waitFor(() =>
        expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toBe(`${location.origin}/join/WXYZ6789`),
      )
      expect(qr()).not.toBe(before)
      expect(screen.queryByRole('button', { name: 'Yes, reset it' })).toBeNull()
    })

    it('renames the group', async () => {
      const calls = fakeApi(groupHandlers({}, { 'PATCH /groups/g1': () => ({ status: 200, body: group({ name: 'Bali 2027' }) }) }))
      renderApp('/groups/g1/settings')
      const name = (await screen.findByLabelText('Group name')) as HTMLInputElement
      expect(name.value).toBe('Bali Trip')
      fireEvent.change(name, { target: { value: '  Bali 2027 ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
      await vi.waitFor(() => expect(calls.find((c) => c.key === 'PATCH /groups/g1')?.body).toEqual({ name: 'Bali 2027' }))
    })

    it('lists members, keeps former members tucked away, and removes others after a confirm', async () => {
      const calls = fakeApi(groupHandlers({}, { 'DELETE /groups/g1/members/user_bob': () => ({ status: 204 }) }))
      renderApp('/groups/g1/settings')

      const members = within(await screen.findByRole('list', { name: 'Members' }))
      const rows = members.getAllByRole('listitem')
      expect(rows.map((r) => r.textContent!.trim())).toEqual(['Alice (you)Owner', 'BobMemberRemove'])
      expect(screen.getByText('Left the group (1)')).toBeTruthy()
      expect(within(screen.getByRole('list', { name: 'Former members' })).getByText('Carol')).toBeTruthy()
      // The owner can't leave, so there is no Leave button.
      expect(screen.queryByRole('button', { name: 'Leave group' })).toBeNull()

      fireEvent.click(members.getByRole('button', { name: 'Remove' }))
      expect(hasCall(calls, 'DELETE /groups/g1/members/user_bob')).toBe(false)
      fireEvent.click(members.getByRole('button', { name: 'Yes, remove Bob' }))
      await vi.waitFor(() => expect(hasCall(calls, 'DELETE /groups/g1/members/user_bob')).toBe(true))
    })

    it('shows how many of the 12 places are taken, counting only active members', async () => {
      fakeApi(groupHandlers())
      renderApp('/groups/g1/settings')
      await screen.findByRole('list', { name: 'Members' })
      expect(region('Members').getByText('2/12 members')).toBeTruthy()
    })

    it('says who needs to settle up when a removal is blocked', async () => {
      fakeApi(groupHandlers({}, { 'DELETE /groups/g1/members/user_bob': conflict('balance_not_zero') }))
      renderApp('/groups/g1/settings')
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
      fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Bob' }))
      expect(await screen.findByText('Bob needs to settle up first')).toBeTruthy()
    })
  })

  describe('as a member', () => {
    it('hides the invite code, rename and remove, and points to the owner', async () => {
      fakeApi(groupHandlers({ group: bobsGroup() }))
      renderApp('/groups/g1/settings')

      expect(await screen.findByText('Ask Bob for the invite link')).toBeTruthy()
      expect(screen.queryByLabelText('Invite link')).toBeNull()
      expect(screen.queryByRole('img', { name: 'QR code for the invite link' })).toBeNull()
      expect(screen.queryByLabelText('Group name')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
      expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    })

    it('leaves the group after a confirm and goes back to your groups', async () => {
      const calls = fakeApi(groupHandlers({ group: bobsGroup() }, { 'DELETE /groups/g1/members/user_me': () => ({ status: 204 }) }))
      const router = renderApp('/groups/g1/settings')

      fireEvent.click(await screen.findByRole('button', { name: 'Leave group' }))
      expect(hasCall(calls, 'DELETE /groups/g1/members/user_me')).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: 'Yes, leave' }))
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups'))
      expect(hasCall(calls, 'DELETE /groups/g1/members/user_me')).toBe(true)
    })

    it.each([
      ['balance_not_zero', 'Settle up before leaving'],
      ['pending_settlement', 'Finish the pending payment first'],
    ])('explains a blocked leave (%s)', async (code, text) => {
      fakeApi(groupHandlers({ group: bobsGroup() }, { 'DELETE /groups/g1/members/user_me': conflict(code) }))
      const router = renderApp('/groups/g1/settings')
      fireEvent.click(await screen.findByRole('button', { name: 'Leave group' }))
      fireEvent.click(screen.getByRole('button', { name: 'Yes, leave' }))
      expect(await screen.findByText(text)).toBeTruthy()
      expect(router.state.location.pathname).toBe('/groups/g1/settings')
    })
  })

  describe('you in this group', () => {
    const you = () => region('You in this group')
    const animal = (name: string | RegExp) => within(you().getByRole('group', { name: 'Animal' })).getByRole('button', { name })
    const colour = (name: string | RegExp) => within(you().getByRole('group', { name: 'Colour' })).getByRole('button', { name })

    it('shows your name and look in the group, greying out only active members’ looks', async () => {
      fakeApi(groupHandlers())
      renderApp('/groups/g1/settings')

      const nickname = (await screen.findByLabelText('What should this group call you?')) as HTMLInputElement
      expect(nickname.value).toBe('Alice')
      expect(animal('Fox').getAttribute('aria-pressed')).toBe('true')
      expect(colour('Peach').getAttribute('aria-pressed')).toBe('true')
      expect((you().getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

      fireEvent.click(animal('Koala'))
      expect((colour(/Mint/) as HTMLButtonElement).disabled).toBe(true) // Bob is the mint koala
      fireEvent.click(animal('Panda'))
      expect((colour('Sky') as HTMLButtonElement).disabled).toBe(false) // Carol left, so her look is free
    })

    it('saves the nickname and look together and refetches the group', async () => {
      const calls = fakeApi(
        groupHandlers({}, {
          'PATCH /groups/g1/members/me': () => ({ status: 200, body: member(ME, 'Captain', { animal: 'bear', color: 'lemon' }) }),
        }),
      )
      renderApp('/groups/g1/settings')

      fireEvent.change(await screen.findByLabelText('What should this group call you?'), { target: { value: ' Captain ' } })
      fireEvent.click(animal('Bear'))
      fireEvent.click(colour('Lemon'))
      fireEvent.click(you().getByRole('button', { name: 'Save' }))

      await vi.waitFor(() =>
        expect(calls.find((c) => c.key === 'PATCH /groups/g1/members/me')?.body).toEqual({
          avatar: { animal: 'bear', color: 'lemon' },
          nickname: 'Captain',
        }),
      )
      await vi.waitFor(() => expect(calls.filter((c) => c.key === 'GET /groups/g1').length).toBeGreaterThan(1))
    })

    it('sends only what changed, and an empty nickname to clear it', async () => {
      const calls = fakeApi(groupHandlers({}, { 'PATCH /groups/g1/members/me': () => ({ status: 200, body: member(ME, 'Alice', ME_AVATAR) }) }))
      renderApp('/groups/g1/settings')

      fireEvent.change(await screen.findByLabelText('What should this group call you?'), { target: { value: '' } })
      fireEvent.click(you().getByRole('button', { name: 'Save' }))

      await vi.waitFor(() => expect(calls.find((c) => c.key === 'PATCH /groups/g1/members/me')?.body).toEqual({ nickname: '' }))
    })

    it('explains a look someone else just took', async () => {
      fakeApi(groupHandlers({}, { 'PATCH /groups/g1/members/me': conflict('avatar_taken', 'That look was just taken.') }))
      renderApp('/groups/g1/settings')

      fireEvent.click(await screen.findByRole('button', { name: 'Bear' }))
      fireEvent.click(you().getByRole('button', { name: 'Save' }))

      // The API's own words.
      expect(await you().findByText('That look was just taken.')).toBeTruthy()
    })
  })

  it('maps every membership conflict to plain words', () => {
    const err = (code: string) => new ApiError(409, code, 'Raw API message')
    expect(membershipErrorText(err('balance_not_zero'), null)).toBe('Settle up before leaving')
    expect(membershipErrorText(err('balance_not_zero'), 'Bob')).toBe('Bob needs to settle up first')
    expect(membershipErrorText(err('pending_settlement'), 'Bob')).toBe('Finish the pending payment first')
    expect(membershipErrorText(err('owner_cannot_leave'), null)).toBe("The owner can't leave the group")
    expect(membershipErrorText(err('something_else'), null)).toBe('Raw API message')
  })

  it('links to settings from the group home', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1')
    expect((await screen.findByRole('link', { name: 'Group settings' })).getAttribute('href')).toBe('/groups/g1/settings')
  })
})
