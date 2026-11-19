import { defaultAvatar, firstFreeAvatar, type GroupDTO, type InvitePreviewDTO } from '@squadsplit/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveGuestPass } from '../src/guest/guestPass'
import { ME, signIn } from './clerk-mock'
import { BOB, BOB_AVATAR, group, groupHandlers, member, ME_AVATAR } from './group-fixtures'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
  signIn.state = true
})

const TOKEN = 'G'.repeat(43)
const DAVE = 'ph_dave'
const DAVE_LOOK = { animal: 'bear', color: 'lemon' } as const
const ERIN_LOOK = { animal: 'kitty', color: 'sky' } as const

const preview = (over: Partial<InvitePreviewDTO> = {}): InvitePreviewDTO => ({
  groupId: 'g1',
  name: 'Bali Trip',
  emoji: '🧡',
  memberCount: 4,
  alreadyMember: false,
  takenAvatars: [ME_AVATAR, BOB_AVATAR, DAVE_LOOK, ERIN_LOOK],
  myFormerAvatar: null,
  placeholders: [
    { userId: DAVE, name: 'Dave', avatar: DAVE_LOOK },
    { userId: 'ph_erin', name: 'Erin', avatar: ERIN_LOOK },
  ],
  ...over,
})

/** The group as its guest Dave sees it: the owner is someone else (Alice). */
const guestView = (over: Partial<GroupDTO> = {}) =>
  group({
    members: [
      member(ME, 'Alice', ME_AVATAR, { role: 'owner' }),
      member(BOB, 'Bob', BOB_AVATAR),
      member(DAVE, 'Dave', DAVE_LOOK, { guest: true }),
    ],
    ...over,
  })

const passFor = (userId = DAVE) => ({ token: TOKEN, userId, groupName: 'Bali Trip', code: 'ABCD2345' })
const storedPass = () => JSON.parse(localStorage.getItem('squadsplit.guest.g1') ?? 'null') as unknown
const whoAreYou = async () => within(await screen.findByRole('group', { name: 'Which one are you?' }))
const ok = (body: unknown) => () => ({ status: 200, body })
const SIGNED_OUT = { error: { code: 'guest_signed_out', message: "You've been signed out of this group." } }

describe('the Join page, signed out', () => {
  it('picks a name, joins as a guest and opens the group as them, with the token in a header only', async () => {
    signIn.state = false
    const calls = fakeApi(
      groupHandlers(
        { group: guestView() },
        {
          'GET /invites/ABCD2345': ok(preview()),
          'POST /invites/ABCD2345/guest': () => ({
            status: 201,
            body: { token: TOKEN, groupId: 'g1', member: member(DAVE, 'Dave', DAVE_LOOK, { guest: true }) },
          }),
        },
      ),
    )
    const router = renderApp('/join/ABCD2345')

    expect(await screen.findByText('No account needed. This phone remembers you.')).toBeTruthy()
    fireEvent.click((await whoAreYou()).getByRole('button', { name: 'Dave' }))
    fireEvent.click(screen.getByRole('button', { name: /Join as guest/ }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(calls.find((c) => c.key === 'POST /invites/ABCD2345/guest')?.body).toEqual({ claim: DAVE })
    expect(storedPass()).toEqual(passFor())
    await screen.findByRole('region', { name: 'Group stats' })
    const groupRead = calls.find((c) => c.key === 'GET /groups/g1')!
    expect(groupRead).toMatchObject({ guest: TOKEN, auth: null })
    expect(calls.some((c) => c.key.includes(TOKEN))).toBe(false)
    const { pathname, search, hash } = router.state.location
    expect(`${pathname}${search}${hash}`).not.toContain(TOKEN)
  })

  it("joins as someone new with I'm new: a name, then a look and nickname", async () => {
    signIn.state = false
    const calls = fakeApi(
      groupHandlers(
        { group: guestView() },
        {
          'GET /invites/ABCD2345': ok(preview()),
          'POST /invites/ABCD2345/guest': () => ({
            status: 201,
            body: { token: TOKEN, groupId: 'g1', member: member('gs_zed', 'Zed', DAVE_LOOK, { guest: true }) },
          }),
        },
      ),
    )
    const router = renderApp('/join/ABCD2345')

    fireEvent.click((await whoAreYou()).getByRole('button', { name: "I'm new" }))
    fireEvent.click(screen.getByRole('button', { name: /Join as guest/ }))
    // A blank name asks for one, and puts you back in the field it's about.
    expect((await screen.findByRole('alert')).textContent).toBe('Enter your name.')
    expect(document.activeElement).toBe(screen.getByLabelText('Your name'))
    expect(screen.getByLabelText('Your name').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Zed 🍕' } })
    fireEvent.click(screen.getByRole('button', { name: /Join as guest/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Names are up to 24 characters/)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: ' Zed ' } })
    fireEvent.change(screen.getByLabelText('What should this group call you?'), { target: { value: 'Zeddy' } })
    fireEvent.click(screen.getByRole('button', { name: /Join as guest/ }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    // The look on screen is the one sent, so the server can't pick a different one.
    const look = firstFreeAvatar(defaultAvatar('gs_g1'), preview().takenAvatars)
    expect(calls.find((c) => c.key === 'POST /invites/ABCD2345/guest')?.body).toEqual({ name: 'Zed', avatar: look, nickname: 'Zeddy' })
    expect(storedPass()).toEqual(passFor('gs_zed'))
  })

  it('offers signing in instead, to keep the group in a list', async () => {
    signIn.state = false
    fakeApi({ 'GET /invites/ABCD2345': ok(preview({ placeholders: [] })) })
    renderApp('/join/ABCD2345')
    expect(await screen.findByRole('button', { name: 'Sign in to keep it in your list' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Join as guest/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Join group/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('opens the group for a phone that is already in it as a guest', async () => {
    signIn.state = false
    saveGuestPass('g1', passFor())
    fakeApi({ 'GET /invites/ABCD2345': ok(preview()) })
    renderApp('/join/ABCD2345')
    expect(await screen.findByText("You're in this group on this phone.")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open group' }).getAttribute('href')).toBe('/groups/g1')
  })
})

describe('a group page with a guest pass', () => {
  it('opens with no account, as the guest, and hides what only the owner can do', async () => {
    signIn.state = false
    saveGuestPass('g1', passFor())
    fakeApi(groupHandlers({ group: guestView() }))
    renderApp('/groups/g1/settings')

    expect(await screen.findByRole('heading', { name: 'Group settings' })).toBeTruthy()
    expect(screen.getByText('Dave (you)')).toBeTruthy()
    // A guest shares the invite link like anyone in the group, but only the owner can reset it.
    expect(within(screen.getByRole('region', { name: 'Invite friends' })).getByText('ABCD2345')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite link options' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Add a name' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Free up name/ })).toBeNull()
    // Leaving is for accounts: a guest's name stays in the group for the owner to manage.
    expect(screen.queryByRole('button', { name: 'Leave group' })).toBeNull()
  })

  it('shows the guest in the top bar with a Guest tag, and in the member list', async () => {
    signIn.state = false
    saveGuestPass('g1', passFor())
    fakeApi(groupHandlers({ group: guestView() }))
    renderApp('/groups/g1/settings')

    const bar = within(await screen.findByRole('banner'))
    expect(await bar.findByText('Guest')).toBeTruthy()
    expect(bar.queryByRole('button', { name: 'Sign out' })).toBeNull()
    const members = within(screen.getByRole('list', { name: 'Members' }))
    expect(members.getAllByText('Guest')).toHaveLength(1)
  })

  it('forgets the pass and says why when the guest has been signed out (401)', async () => {
    signIn.state = false
    saveGuestPass('g1', passFor())
    fakeApi(groupHandlers({}, { 'GET /groups/g1': () => ({ status: 401, body: SIGNED_OUT }) }))
    renderApp('/groups/g1')

    const card = await screen.findByRole('alert')
    expect(card.textContent).toContain("You've been signed out of Bali Trip. Ask for the new link to rejoin.")
    expect(within(card).getByRole('link', { name: 'Try the link again' }).getAttribute('href')).toBe('/join/ABCD2345')
    expect(storedPass()).toBeNull()
  })

  it('shows the group, not the signed-out card, once signed in (the card is only for a signed-out phone)', async () => {
    sessionStorage.setItem('squadsplit.guest-signed-out.g1', JSON.stringify({ groupName: 'Bali Trip', code: 'ABCD2345' }))
    fakeApi(groupHandlers())
    renderApp('/groups/g1')
    expect(await screen.findByRole('region', { name: 'Group stats' })).toBeTruthy()
    expect(screen.queryByText(/You've been signed out/)).toBeNull()
  })

  it('forgets the signed-out card after joining again with an account', async () => {
    sessionStorage.setItem('squadsplit.guest-signed-out.g1', JSON.stringify({ groupName: 'Bali Trip', code: 'ABCD2345' }))
    fakeApi(
      groupHandlers({}, {
        'GET /invites/WXYZ6789': ok(preview({ placeholders: [] })),
        'POST /invites/WXYZ6789/join': ok({ groupId: 'g1' }),
      }),
    )
    const router = renderApp('/join/WXYZ6789')
    fireEvent.click(await screen.findByRole('button', { name: /Join group/ }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(sessionStorage.getItem('squadsplit.guest-signed-out.g1')).toBeNull()
  })

  it('sends a signed-out visitor with no pass to sign in, as before', async () => {
    signIn.state = false
    const calls = fakeApi({})
    renderApp('/groups/g1')
    expect(await screen.findByText(/Redirecting to sign-in, then back to .*\/groups\/g1/)).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('uses the account, not the pass, when the signed-in account is in the group', async () => {
    saveGuestPass('g1', passFor())
    const calls = fakeApi(groupHandlers({}, { 'GET /groups': ok([{ id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'owner', myBalanceCents: 0 }]) }))
    renderApp('/groups/g1')
    await screen.findByRole('region', { name: 'Group stats' })
    expect(calls.find((c) => c.key === 'GET /groups/g1')).toMatchObject({ guest: null, auth: 'Bearer test_token' })
  })

  it('uses the pass for a signed-in account that is not in the group', async () => {
    saveGuestPass('g1', passFor())
    const calls = fakeApi(groupHandlers({ group: guestView() }))
    renderApp('/groups/g1')
    await screen.findByRole('region', { name: 'Group stats' })
    expect(calls.find((c) => c.key === 'GET /groups/g1')).toMatchObject({ guest: TOKEN })
  })
})

describe('the landing page, On this phone', () => {
  it('lists the groups this phone is a guest in, dropping passes that no longer work', async () => {
    signIn.state = false
    saveGuestPass('g1', passFor())
    saveGuestPass('g2', { ...passFor('gs_2'), token: 'H'.repeat(43), groupName: 'Old trip' })
    saveGuestPass('g3', { ...passFor('gs_3'), token: 'I'.repeat(43), groupName: 'Gone' })
    const calls = fakeApi({
      'GET /groups/g1': ok(guestView()),
      'GET /groups/g2': () => ({ status: 401, body: SIGNED_OUT }),
      'GET /groups/g3': () => ({ status: 404, body: { error: { code: 'not_found', message: 'Group not found' } } }),
    })
    renderApp('/')

    const list = within(await screen.findByRole('list', { name: 'On this phone' }))
    expect(await list.findByRole('link', { name: /Bali Trip/ })).toBeTruthy()
    await vi.waitFor(() => expect(localStorage.getItem('squadsplit.guest.g2')).toBeNull())
    await vi.waitFor(() => expect(localStorage.getItem('squadsplit.guest.g3')).toBeNull())
    expect(list.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/groups/g1'])
    expect(calls.find((c) => c.key === 'GET /groups/g1')?.guest).toBe(TOKEN)
    // Above the sign-in call to action.
    const onPhone = screen.getByRole('heading', { name: 'On this phone' })
    const getStarted = screen.getByRole('button', { name: 'Get started' })
    expect(onPhone.compareDocumentPosition(getStarted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows nothing extra on a phone with no passes', async () => {
    signIn.state = false
    fakeApi({})
    renderApp('/')
    await screen.findByRole('heading', { name: 'Split bills, not friendships.' })
    expect(screen.queryByRole('heading', { name: 'On this phone' })).toBeNull()
  })
})

describe('group settings, as the owner', () => {
  const withGuest = () =>
    group({ members: [member(ME, 'Alice', ME_AVATAR, { role: 'owner' }), member(BOB, 'Bob', BOB_AVATAR), member('gs_zed', 'Zed', DAVE_LOOK, { guest: true })] })

  it('tags guests, and frees up a guest’s name after a confirm', async () => {
    const calls = fakeApi(groupHandlers({ group: withGuest() }, { 'POST /groups/g1/members/gs_zed/release': () => ({ status: 204 }) }))
    renderApp('/groups/g1/settings')

    const members = within(await screen.findByRole('list', { name: 'Members' }))
    expect(members.getAllByText('Guest')).toHaveLength(1)
    expect(members.getAllByRole('button', { name: 'Free up name' })).toHaveLength(1)
    fireEvent.click(members.getByRole('button', { name: 'Free up name' }))
    expect(screen.getByText('Sign Zed out on every phone? Their name and expenses stay, ready to claim again.')).toBeTruthy()
    expect(calls.some((c) => c.key.endsWith('/release'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, free it up' }))

    await vi.waitFor(() => expect(calls.some((c) => c.key === 'POST /groups/g1/members/gs_zed/release')).toBe(true))
  })
})

describe('Save with an account', () => {
  const upgraded = () => group({ members: [member(ME, 'Alice', ME_AVATAR, { role: 'member' }), member(BOB, 'Bob', BOB_AVATAR, { role: 'owner' })] })

  it('signs in first, remembering to save the guest afterwards', async () => {
    signIn.state = false
    saveGuestPass('g1', passFor())
    const calls = fakeApi(groupHandlers({ group: guestView() }))
    renderApp('/groups/g1')

    fireEvent.click(await within(await screen.findByRole('banner')).findByRole('button', { name: 'Save with an account' }))

    expect(sessionStorage.getItem('squadsplit.guest-upgrade.g1')).toBe('1')
    expect(calls.some((c) => c.key.endsWith('/guest/upgrade'))).toBe(false)
  })

  it('saves the guest to the account once signed in, then shows the group as the account', async () => {
    saveGuestPass('g1', passFor())
    sessionStorage.setItem('squadsplit.guest-upgrade.g1', '1')
    let saved = false
    const calls = fakeApi(
      groupHandlers(
        { group: guestView() },
        {
          'GET /groups': () => ({ status: 200, body: saved ? [{ id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'member', myBalanceCents: 0 }] : [] }),
          'GET /groups/g1': () => ({ status: 200, body: saved ? upgraded() : guestView() }),
          'POST /groups/g1/guest/upgrade': () => {
            saved = true
            return { status: 200, body: upgraded() }
          },
        },
      ),
    )
    renderApp('/groups/g1')

    await vi.waitFor(() => expect(calls.some((c) => c.key === 'POST /groups/g1/guest/upgrade')).toBe(true))
    expect(calls.find((c) => c.key === 'POST /groups/g1/guest/upgrade')).toMatchObject({ guest: TOKEN, auth: 'Bearer test_token' })
    await vi.waitFor(() => expect(storedPass()).toBeNull())
    expect(sessionStorage.getItem('squadsplit.guest-upgrade.g1')).toBeNull()
    // The account's own top bar, and the group read as the account.
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(within(screen.getByRole('banner')).queryByText('Guest')).toBeNull()
    await vi.waitFor(() => expect(calls.filter((c) => c.key === 'GET /groups/g1').at(-1)).toMatchObject({ guest: null }))
  })

  it('saves straight away for a phone that is already signed in, and explains a refusal', async () => {
    saveGuestPass('g1', passFor())
    const calls = fakeApi(
      groupHandlers(
        { group: guestView() },
        {
          'POST /groups/g1/guest/upgrade': () => ({
            status: 409,
            body: { error: { code: 'already_in_group', message: "You've been in this group before, so join as yourself." } },
          }),
        },
      ),
    )
    renderApp('/groups/g1')

    fireEvent.click(await within(await screen.findByRole('banner')).findByRole('button', { name: 'Save with an account' }))

    expect(await screen.findByText("You've been in this group before, so join as yourself.")).toBeTruthy()
    expect(calls.filter((c) => c.key === 'POST /groups/g1/guest/upgrade')).toHaveLength(1)
    expect(storedPass()).toEqual(passFor())
  })

  it('keeps the guest’s pass when the account’s sign-in is refused (a plain 401)', async () => {
    saveGuestPass('g1', passFor())
    fakeApi(
      groupHandlers(
        { group: guestView() },
        { 'POST /groups/g1/guest/upgrade': () => ({ status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in required' } } }) },
      ),
    )
    renderApp('/groups/g1')

    fireEvent.click(await within(await screen.findByRole('banner')).findByRole('button', { name: 'Save with an account' }))

    expect(await screen.findByText('Sign in required')).toBeTruthy()
    expect(storedPass()).toEqual(passFor())
    expect(sessionStorage.getItem('squadsplit.guest-signed-out.g1')).toBeNull()
    expect(screen.getByRole('region', { name: 'Group stats' })).toBeTruthy()
  })
})
