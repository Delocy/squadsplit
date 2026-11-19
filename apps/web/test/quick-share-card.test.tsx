import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shareCardText } from '../src/quick/format'
import { imageFileName } from '../src/quick/saveImage'
import { fakeApi, renderApp } from './harness'
import { readmeSplit } from './quick-fixtures'

vi.mock('@clerk/react', () => import('./clerk-mock'))
const image = vi.hoisted(() => ({ toBlob: vi.fn(async (_node: HTMLElement, _options: unknown) => new Blob(['png'], { type: 'image/png' })) }))
vi.mock('html-to-image', () => image)

const LINK = `${window.location.origin}/s/tok_7fK2qaAAAAAAAAAAAAAA`
const EMOJI = /\p{Extended_Pictographic}/u
const writeText = vi.fn(async (_text: string) => {})

beforeEach(() => {
  writeText.mockClear()
  image.toBlob.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.assign(navigator, { canShare: undefined, share: undefined })
})

const actions = () => within(screen.getByRole('group', { name: 'Share the card' }))

async function openCard() {
  fakeApi({ 'GET /quick-splits/q1': () => ({ status: 200, body: readmeSplit() }), 'GET /quick-splits': () => ({ status: 200, body: [] }) })
  renderApp('/quick/q1')
  return within(await screen.findByRole('region', { name: 'Share card' }))
}

describe('the share card', () => {
  it("shows everyone's dishes and total, the charges in one line, who pays the payer, and the link", async () => {
    const card = await openCard()
    expect(card.getByText('Team lunch')).toBeTruthy()
    expect(card.getByText('Tanjong Pagar · Thu 19 Nov')).toBeTruthy()
    expect(card.getByText('Dan paid').nextSibling?.textContent).toBe('$110.43')
    expect(card.getByText('Satay ÷3 $6.68 · Chilli crab ÷3 $16.00 · Iced barley (2) ÷2 $2.80')).toBeTruthy()
    expect(card.getByText('$39.16')).toBeTruthy()
    expect(card.getByText(/Dishes \$92\.10 \+ 10% service \$9\.21 \+ 9% GST \$9\.12 = \$110\.43\. Each total is that person’s dishes × 1\.199\./)).toBeTruthy()
    expect(card.getByText('Pay Dan')).toBeTruthy()
    expect(card.getByText('Wei Ling $39.16 · Arjun $40.72')).toBeTruthy()
    expect(card.getByText(`Tick yours: ${LINK.replace(/^https?:\/\//, '')}`)).toBeTruthy()
    // The avatars are inline SVG, so they draw into the saved image too.
    expect(card.getAllByRole('listitem').every((li) => li.querySelector('.av svg'))).toBe(true)
    expect(document.body.textContent).not.toMatch(EMOJI)
  })

  it('copies the plain text and shows it, with how it looks in a chat', async () => {
    await openCard()
    fireEvent.click(actions().getByRole('button', { name: 'Copy text' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(shareCardText(readmeSplit(), LINK)))
    expect((await screen.findByRole('status')).textContent).toContain('Copied. Paste it into your chat.')
    const panel = within(screen.getByRole('region', { name: 'Copy as text' }))
    expect(panel.getByText(/Tick when you've paid:/).textContent).toBe(shareCardText(readmeSplit(), LINK))
    expect(screen.getByRole('region', { name: 'How it looks in a chat' }).textContent).toContain('Dan paid $110.43')
    fireEvent.click(panel.getByRole('button', { name: 'Back to the card' }))
    expect(screen.queryByRole('region', { name: 'Copy as text' })).toBeNull()
  })

  it('copies the link', async () => {
    await openCard()
    fireEvent.click(actions().getByRole('button', { name: 'Copy link' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK))
  })

  it("saves the card as a PNG through the phone's share sheet when it can share files", async () => {
    const share = vi.fn(async (_data: ShareData) => {})
    Object.assign(navigator, { canShare: () => true, share })
    const card = await openCard()
    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce())
    expect(image.toBlob.mock.calls[0]![0]).toBe(card.getByText('Team lunch').closest('section'))
    const file = (share.mock.calls[0]![0].files as File[])[0]!
    expect(file.name).toBe('squadsplit-team-lunch.png')
    expect(file.type).toBe('image/png')
  })

  it('otherwise downloads it as squadsplit-<title>.png', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:card', revokeObjectURL: () => {} }))
    await openCard()
    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('squadsplit-team-lunch.png')
    expect(imageFileName('Dim sum, Chinatown!')).toBe('squadsplit-dim-sum-chinatown.png')
  })
})
