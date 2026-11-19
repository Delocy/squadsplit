import { defaultAvatar, firstFreeAvatar, type InvitePreviewDTO } from '@squadsplit/shared'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { animalLabel, colorLabel } from '../src/design/Avatar'
import { ME, signIn } from './clerk-mock'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  signIn.state = true
})

const preview = (over: Partial<InvitePreviewDTO> = {}): InvitePreviewDTO => ({
  groupId: 'g1', name: 'Bali Trip', emoji: '🧡', memberCount: 3, alreadyMember: false, takenAvatars: [], myFormerAvatar: null, placeholders: [], ...over,
})

const animalButton = (name: string | RegExp) => within(screen.getByRole('group', { name: 'Animal' })).getByRole('button', { name })
const colourButton = (name: string | RegExp) => within(screen.getByRole('group', { name: 'Colour' })).getByRole('button', { name })
const pressed = (group: 'Animal' | 'Colour') =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('aria-label'))
const joinBody = (calls: { key: string; body: unknown }[]) => calls.find((c) => c.key === 'POST /invites/ABCD2345/join')?.body

describe('Join page', () => {
  it('previews the group, joins it and opens it', async () => {
    const calls = fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview() }),
      'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
    })
    const router = renderApp('/join/ABCD2345')

    expect(await screen.findByText('Bali Trip')).toBeTruthy()
    expect(screen.getByText('3 members')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    // No avatar (you kept the look the server would give you anyway: your default) and no nickname (still your profile name).
    expect(joinBody(calls)).toEqual({})
  })

  it('pre-selects the look you left with when you rejoin, and leaves it to the server', async () => {
    const old = { animal: 'penguin', color: 'lemon' } as const
    const calls = fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ myFormerAvatar: old }) }),
      'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
    })
    renderApp('/join/ABCD2345')

    await screen.findByRole('group', { name: 'Animal' })
    expect(pressed('Animal')).toEqual(['Penguin'])
    expect(pressed('Colour')).toEqual(['Lemon'])
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

    await vi.waitFor(() => expect(joinBody(calls)).toEqual({}))
  })

  it('moves on from the look you left with when someone took it while you were away', async () => {
    const old = { animal: 'penguin', color: 'lemon' } as const
    fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ myFormerAvatar: old, takenAvatars: [old] }) }) })
    renderApp('/join/ABCD2345')

    const expected = firstFreeAvatar(old, [old])
    await screen.findByRole('group', { name: 'Animal' })
    expect(pressed('Animal')).toEqual([animalLabel(expected.animal)])
    expect(pressed('Colour')).toEqual([colorLabel(expected.color)])
  })

  it('sends the look you picked when it differs from the one you were given', async () => {
    const old = { animal: 'penguin', color: 'lemon' } as const
    const calls = fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ myFormerAvatar: old }) }),
      'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
    })
    renderApp('/join/ABCD2345')

    await screen.findByRole('group', { name: 'Colour' })
    fireEvent.click(colourButton('Mint'))
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

    await vi.waitFor(() => expect(joinBody(calls)).toEqual({ avatar: { animal: 'penguin', color: 'mint' } }))
  })

  it('pre-selects the first free look, starting from your default', async () => {
    const taken = [defaultAvatar(ME), { animal: 'bear', color: 'sky' } as const]
    fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ takenAvatars: taken }) }) })
    renderApp('/join/ABCD2345')

    const expected = firstFreeAvatar(defaultAvatar(ME), taken)
    await screen.findByRole('group', { name: 'Animal' })
    expect(pressed('Animal')).toEqual([animalLabel(expected.animal)])
    expect(pressed('Colour')).toEqual([colorLabel(expected.color)])
  })

  it('greys out looks other members have', async () => {
    fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ takenAvatars: [{ animal: 'koala', color: 'mint' }] }) }),
    })
    renderApp('/join/ABCD2345')

    fireEvent.click(await screen.findByRole('button', { name: 'Koala' }))
    expect((colourButton(/Mint/) as HTMLButtonElement).disabled).toBe(true)
    expect(colourButton(/Mint/).getAttribute('title')).toBe('Taken')
  })

  it('joins with the chosen look and nickname, previewing them together', async () => {
    const calls = fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview() }),
      'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
    })
    renderApp('/join/ABCD2345')

    const nickname = (await screen.findByLabelText('What should this group call you?')) as HTMLInputElement
    await vi.waitFor(() => expect(nickname.value).toBe('Me'))
    expect(nickname.placeholder).toBe('Me')
    fireEvent.change(nickname, { target: { value: '  Captain ' } })
    fireEvent.click(animalButton('Koala'))
    fireEvent.click(colourButton('Mint'))

    const you = screen.getByRole('img', { name: 'You: Koala on Mint' })
    expect(you.parentElement!.textContent).toContain('Captain')
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

    await vi.waitFor(() => expect(joinBody(calls)).toEqual({ avatar: { animal: 'koala', color: 'mint' }, nickname: 'Captain' }))
  })

  it('asks for a shorter nickname without emoji instead of joining', async () => {
    const calls = fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview() }) })
    renderApp('/join/ABCD2345')

    fireEvent.change(await screen.findByLabelText('What should this group call you?'), { target: { value: 'Cap 🍕' } })
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

    expect(await screen.findByText('Keep it to 24 characters, with no emoji.')).toBeTruthy()
    expect(joinBody(calls)).toBeUndefined()
  })

  it('explains a look taken just before joining, refetches, and moves to a free one', async () => {
    let taken: InvitePreviewDTO['takenAvatars'] = []
    const calls = fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ takenAvatars: taken }) }),
      'POST /invites/ABCD2345/join': () => {
        taken = [defaultAvatar(ME)]
        return { status: 409, body: { error: { code: 'avatar_taken', message: 'That look was just taken.' } } }
      },
    })
    renderApp('/join/ABCD2345')
    fireEvent.click(await screen.findByRole('button', { name: /Join group/ }))

    // The API's own words.
    expect(await screen.findByText('That look was just taken.')).toBeTruthy()
    await vi.waitFor(() => expect(calls.filter((c) => c.key === 'GET /invites/ABCD2345')).toHaveLength(2))
    const next = firstFreeAvatar(defaultAvatar(ME), [defaultAvatar(ME)])
    await vi.waitFor(() => expect(pressed('Colour')).toEqual([colorLabel(next.color)]))
    expect(pressed('Animal')).toEqual([animalLabel(next.animal)])
  })

  it('shows the loading state inside the page container', async () => {
    fakeApi({ 'GET /invites/ABCD2345': () => new Promise(() => {}) })
    renderApp('/join/ABCD2345')
    const loading = await screen.findByText('Checking the invite…')
    expect(loading.closest('main.narrow.page')).toBeTruthy()
  })

  it('offers to open the group when you are already a member', async () => {
    fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ alreadyMember: true, memberCount: 1 }) }) })
    renderApp('/join/ABCD2345')
    expect(await screen.findByText(/already in this group/)).toBeTruthy()
    expect(screen.getByText('1 member')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open group/ }).getAttribute('href')).toBe('/groups/g1')
  })

  it('says the group is full instead of offering to join', async () => {
    fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ memberCount: 12 }) }) })
    renderApp('/join/ABCD2345')
    expect(await screen.findByText(/This group is full/)).toBeTruthy()
    expect(screen.getByText('12 members')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Join group/ })).toBeNull()
  })

  it('still opens a full group for someone already in it', async () => {
    fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ memberCount: 12, alreadyMember: true }) }) })
    renderApp('/join/ABCD2345')
    expect(await screen.findByRole('link', { name: /Open group/ })).toBeTruthy()
    expect(screen.queryByText(/This group is full/)).toBeNull()
  })

  it('says the group is full when it fills up before you join', async () => {
    fakeApi({
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview({ memberCount: 11 }) }),
      'POST /invites/ABCD2345/join': () => ({
        status: 409, body: { error: { code: 'group_full', message: 'This group is full (12 people).' } },
      }),
    })
    renderApp('/join/ABCD2345')
    fireEvent.click(await screen.findByRole('button', { name: /Join group/ }))
    expect(await screen.findByText(/This group is full/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Join group/ })).toBeNull()
  })

  it('explains a dead invite link', async () => {
    fakeApi({ 'GET /invites/OLDCODE1': () => ({ status: 404, body: { error: { code: 'not_found', message: 'Invite not found' } } }) })
    renderApp('/join/OLDCODE1')
    expect(await screen.findByText(/This invite link doesn't work any more/)).toBeTruthy()
  })

  describe('which one are you?', () => {
    const DAVE_LOOK = { animal: 'bear', color: 'lemon' } as const
    const ERIN_LOOK = { animal: 'kitty', color: 'sky' } as const
    const named = (over: Partial<InvitePreviewDTO> = {}) =>
      preview({
        takenAvatars: [{ animal: 'fox', color: 'peach' }, DAVE_LOOK, ERIN_LOOK],
        placeholders: [
          { userId: 'ph_dave', name: 'Dave', avatar: DAVE_LOOK },
          { userId: 'ph_erin', name: 'Erin', avatar: ERIN_LOOK },
        ],
        ...over,
      })
    const whoAreYou = async () => within(await screen.findByRole('group', { name: 'Which one are you?' }))

    it('lists the names nobody has claimed, and asks before showing the join form', async () => {
      fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: named() }) })
      renderApp('/join/ABCD2345')
      const who = await whoAreYou()
      expect(who.getAllByRole('button').map((b) => b.textContent!.trim())).toEqual(['Dave', 'Erin', "I'm new"])
      expect(screen.queryByRole('button', { name: /Join group/ })).toBeNull()
      expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    })

    it('claims the name you pick, starting from its look and name', async () => {
      const calls = fakeApi({
        'GET /invites/ABCD2345': () => ({ status: 200, body: named() }),
        'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
      })
      const router = renderApp('/join/ABCD2345')
      fireEvent.click((await whoAreYou()).getByRole('button', { name: 'Dave' }))

      expect(((await screen.findByLabelText('What should this group call you?')) as HTMLInputElement).value).toBe('Dave')
      expect(pressed('Animal')).toEqual(['Bear'])
      expect(pressed('Colour')).toEqual(['Lemon'])
      // Dave's own look is not taken from Dave; Erin's still is.
      fireEvent.click(animalButton('Kitty'))
      expect((colourButton(/Sky/) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(animalButton('Bear'))
      fireEvent.click(colourButton('Lemon'))
      fireEvent.click(screen.getByRole('button', { name: /Join group/ }))

      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
      expect(joinBody(calls)).toEqual({ claim: 'ph_dave' })
    })

    it("joins as someone new with I'm new", async () => {
      const calls = fakeApi({
        'GET /invites/ABCD2345': () => ({ status: 200, body: named() }),
        'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
      })
      renderApp('/join/ABCD2345')
      fireEvent.click((await whoAreYou()).getByRole('button', { name: "I'm new" }))
      fireEvent.click(await screen.findByRole('button', { name: /Join group/ }))
      await vi.waitFor(() => expect(joinBody(calls)).toEqual({}))
    })

    it('offers only the names in a full group, since claiming one takes no new place', async () => {
      const calls = fakeApi({
        'GET /invites/ABCD2345': () => ({ status: 200, body: named({ memberCount: 12 }) }),
        'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
      })
      renderApp('/join/ABCD2345')
      const who = await whoAreYou()
      expect(who.queryByRole('button', { name: "I'm new" })).toBeNull()
      expect(screen.queryByText(/This group is full/)).toBeNull()
      fireEvent.click(who.getByRole('button', { name: 'Erin' }))
      fireEvent.click(await screen.findByRole('button', { name: /Join group/ }))
      await vi.waitFor(() => expect(joinBody(calls)).toEqual({ claim: 'ph_erin' }))
    })

    it('does not ask a former member, who rejoins as themselves', async () => {
      fakeApi({ 'GET /invites/ABCD2345': () => ({ status: 200, body: named({ myFormerAvatar: { animal: 'panda', color: 'mint' } }) }) })
      renderApp('/join/ABCD2345')
      expect(await screen.findByRole('button', { name: /Join group/ })).toBeTruthy()
      expect(screen.queryByRole('group', { name: 'Which one are you?' })).toBeNull()
    })

    it('says so when someone claimed the name first, and asks again', async () => {
      let placeholders = named().placeholders
      fakeApi({
        'GET /invites/ABCD2345': () => ({ status: 200, body: named({ placeholders }) }),
        'POST /invites/ABCD2345/join': () => {
          placeholders = placeholders.slice(1)
          return { status: 409, body: { error: { code: 'already_claimed', message: 'Someone has already claimed that name.' } } }
        },
      })
      renderApp('/join/ABCD2345')
      fireEvent.click((await whoAreYou()).getByRole('button', { name: 'Dave' }))
      fireEvent.click(await screen.findByRole('button', { name: /Join group/ }))
      expect(await screen.findByText('Someone has already claimed that name.')).toBeTruthy()
      await vi.waitFor(async () => expect((await whoAreYou()).queryByRole('button', { name: 'Dave' })).toBeNull())
    })
  })

  it('starts on your profile look', async () => {
    const look = { animal: 'hamster', color: 'lilac' } as const
    const calls = fakeApi({
      'GET /me': () => ({ status: 200, body: { id: ME, displayName: 'Me', avatarUrl: null, profileAvatar: look } }),
      'GET /invites/ABCD2345': () => ({ status: 200, body: preview() }),
      'POST /invites/ABCD2345/join': () => ({ status: 200, body: { groupId: 'g1' } }),
    })
    renderApp('/join/ABCD2345')
    await screen.findByRole('group', { name: 'Animal' })
    await vi.waitFor(() => expect(pressed('Animal')).toEqual(['Hamster']))
    expect(pressed('Colour')).toEqual(['Lilac'])
    fireEvent.click(screen.getByRole('button', { name: /Join group/ }))
    // The server starts you on your profile look too, so there is nothing to send.
    await vi.waitFor(() => expect(joinBody(calls)).toEqual({}))
  })
})
