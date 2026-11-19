import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPIED } from '../src/components/InviteCard'
import { BOB, BOB_AVATAR, expense, group, groupHandlers, member, ME_AVATAR } from './group-fixtures'
import { ME } from './clerk-mock'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))

const writeText = vi.fn<(text: string) => Promise<void>>()
const share = vi.fn<(data: ShareData) => Promise<void>>()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  share.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(navigator, 'share')
})
const withShareSheet = () => Object.defineProperty(navigator, 'share', { value: share, configurable: true })

const link = `${location.origin}/join/ABCD2345`
const card = async () => within(await screen.findByRole('region', { name: 'Invite friends' }))
const bobsGroup = group({ ownerId: BOB, members: [member(BOB, 'Bob', BOB_AVATAR, { role: 'owner' }), member(ME, 'Alice', ME_AVATAR)] })
const withExpense = { expenses: [expense()] }

describe('the invite card', () => {
  it('shows the link as text and the code spaced out for reading aloud, with the QR folded away', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/settings')
    const invite = await card()

    expect(invite.getByText('ABCD2345').closest('p')!.textContent).toBe(link)
    // A no-break space keeps the two halves on one line.
    expect(invite.getByText('ABCD 2345').closest('p')!.textContent).toBe('Code: ABCD\u00a02345')
    const qr = invite.getByText('Show QR code').closest('details')!
    expect(qr.open).toBe(false)
    expect(within(qr).getByRole('img', { name: 'QR code for the invite link', hidden: true })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('leads with Share where the phone has a share sheet, and shares the link with the group name', async () => {
    withShareSheet()
    fakeApi(groupHandlers())
    renderApp('/groups/g1/settings')
    const invite = await card()

    expect(invite.getByRole('button', { name: 'Share invite link' }).className).toContain('primary')
    expect(invite.getByRole('button', { name: 'Copy' }).className).not.toContain('primary')
    fireEvent.click(invite.getByRole('button', { name: 'Share invite link' }))
    expect(share).toHaveBeenCalledWith({ title: 'Join Bali Trip on SquadSplit', text: 'Split with us on SquadSplit:', url: link })
  })

  it('makes Copy the main button where there is no share sheet, and confirms a copy with a toast', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/settings')
    const invite = await card()

    expect(invite.queryByRole('button', { name: 'Share invite link' })).toBeNull()
    expect(invite.getByRole('button', { name: 'Copy' }).className).toContain('primary')
    fireEvent.click(invite.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText(COPIED)).toBeTruthy()
    expect(COPIED).toBe('Link copied. Paste it in your chat')
    expect(writeText).toHaveBeenCalledWith(link)
  })

  it('selects the link text when the clipboard says no, so it can be copied by hand', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    fakeApi(groupHandlers())
    renderApp('/groups/g1/settings')
    fireEvent.click((await card()).getByRole('button', { name: 'Copy' }))

    expect(await screen.findByText("Couldn't copy it. The link is selected: copy it from there.")).toBeTruthy()
    expect(window.getSelection()!.toString()).toBe(link)
  })

  it('lets the owner make a new link from the ⋯ menu, after a confirm, then focuses Share', async () => {
    withShareSheet()
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
    const invite = await card()

    fireEvent.click(invite.getByRole('button', { name: 'Invite link options' }))
    fireEvent.click(invite.getByRole('button', { name: 'Reset link' }))
    expect(
      invite.getByText(
        'Make a new link? The current link and code stop working. Friends with accounts stay in. Guests on their phones are signed out and need the new link.',
      ),
    ).toBeTruthy()
    expect(calls.some((c) => c.key === 'POST /groups/g1/invite/reset')).toBe(false)
    fireEvent.click(invite.getByRole('button', { name: 'Make new link' }))

    expect(await invite.findByText('WXYZ6789')).toBeTruthy()
    expect(invite.getByText('New link ready')).toBeTruthy()
    await vi.waitFor(() => expect(document.activeElement).toBe(invite.getByRole('button', { name: 'Share invite link' })))
    // Shared, it has done its job.
    fireEvent.click(invite.getByRole('button', { name: 'Share invite link' }))
    await vi.waitFor(() => expect(invite.queryByText('New link ready')).toBeNull())
  })

  it('names the card by its heading alone, with the ⋯ menu beside it', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/settings')
    const card = await screen.findByRole('region', { name: 'Invite friends' })
    const heading = within(card).getByRole('heading', { name: 'Invite friends' })
    expect(heading.contains(within(card).getByRole('button', { name: 'Invite link options' }))).toBe(false)
  })

  it('shows the card to a member, with no ⋯ menu, and never sends them to ask the owner', async () => {
    fakeApi(groupHandlers({ group: bobsGroup }))
    renderApp('/groups/g1/settings')
    const invite = await card()

    expect(invite.getByText('ABCD2345')).toBeTruthy()
    expect(invite.queryByRole('button', { name: 'Invite link options' })).toBeNull()
    expect(screen.queryByText(/Ask Bob/)).toBeNull()
  })
})

describe('inviting from the group home', () => {
  it('opens the card in a sheet from the Invite button, and closes back to the group', async () => {
    fakeApi(groupHandlers(withExpense))
    const router = renderApp('/groups/g1')

    fireEvent.click(await screen.findByRole('link', { name: 'Invite' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Invite friends' }))
    expect(router.state.location.pathname).toBe('/groups/g1/invite')
    expect(sheet.getByText('ABCD2345')).toBeTruthy()

    await act(async () => fireEvent.click(sheet.getByRole('button', { name: 'Close' })))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
  })

  it('leads an empty group with the invite card, and not once it has an expense', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1')
    const first = (await screen.findByRole('region', { name: 'Invite friends' })).closest('main')!.firstElementChild
    expect(first!.getAttribute('aria-labelledby')).toBe('invite-h')
    cleanup()

    fakeApi(groupHandlers(withExpense))
    renderApp('/groups/g1')
    await screen.findByRole('link', { name: 'Invite' })
    expect(screen.queryByRole('region', { name: 'Invite friends' })).toBeNull()
  })
})
