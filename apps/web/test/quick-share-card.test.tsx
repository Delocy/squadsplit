import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
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

  /** Waits until the card's PNG has been drawn ahead of time, as it is whenever the card shows. */
  async function imageReady() {
    await vi.waitFor(() => expect(image.toBlob).toHaveBeenCalledOnce())
    await act(async () => {})
  }
  const stubDownload = () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:card', revokeObjectURL: () => {} }))
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  }

  it('draws the PNG as soon as the card shows, so a tap opens the share sheet at once, inside the tap', async () => {
    const share = vi.fn(async (_data: ShareData) => {})
    Object.assign(navigator, { canShare: () => true, share })
    const card = await openCard()
    await imageReady()
    expect(image.toBlob.mock.calls[0]![0]).toBe(card.getByText('Team lunch').closest('section'))

    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    // Called in the same tick as the tap (no drawing first), while the phone still counts it as the user's gesture.
    expect(share).toHaveBeenCalledOnce()
    expect(image.toBlob).toHaveBeenCalledOnce()
    const file = (share.mock.calls[0]![0].files as File[])[0]!
    expect(file.name).toBe('squadsplit-team-lunch.png')
    expect(file.type).toBe('image/png')
  })

  it('downloads the PNG instead when the phone refuses the share sheet, never showing the raw error', async () => {
    const share = vi.fn(async (_data: ShareData) => {
      throw new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError')
    })
    Object.assign(navigator, { canShare: () => true, share })
    const click = stubDownload()
    await openCard()
    await imageReady()
    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('squadsplit-team-lunch.png')
    expect((await screen.findByRole('status')).textContent).toContain('Saved the card as an image.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/not allowed/)
  })

  it('does nothing more when the share sheet is closed', async () => {
    const share = vi.fn(async (_data: ShareData) => {
      throw new DOMException('Share canceled', 'AbortError')
    })
    Object.assign(navigator, { canShare: () => true, share })
    const click = stubDownload()
    await openCard()
    await imageReady()
    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    await act(async () => {})
    expect(share).toHaveBeenCalledOnce()
    expect(click).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('downloads it as squadsplit-<title>.png where the phone cannot share files, drawing it then if it is not ready', async () => {
    let finish = (_b: Blob) => {}
    image.toBlob.mockImplementationOnce(() => new Promise<Blob>((resolve) => (finish = resolve)))
    const click = stubDownload()
    await openCard()
    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    expect(actions().getByRole('button', { name: /Saving/ })).toBeTruthy()
    await act(async () => finish(new Blob(['png'], { type: 'image/png' })))
    await vi.waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('squadsplit-team-lunch.png')
    expect(imageFileName('Dim sum, Chinatown!')).toBe('squadsplit-dim-sum-chinatown.png')
  })

  it('says so, without a raw error, when the card cannot be drawn', async () => {
    image.toBlob.mockRejectedValue(new Error('SecurityError: tainted canvas'))
    await openCard()
    fireEvent.click(actions().getByRole('button', { name: 'Save image' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't make the image. Take a screenshot of the card instead.")
    image.toBlob.mockReset()
    image.toBlob.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }))
  })

  it('offers no dead link once sharing has stopped', async () => {
    const off = readmeSplit({ share: { ...readmeSplit().share, revokedAt: '2026-11-19T07:00:00.000Z', state: 'off' } })
    fakeApi({ 'GET /quick-splits/q1': () => ({ status: 200, body: off }), 'GET /quick-splits': () => ({ status: 200, body: [] }) })
    renderApp('/quick/q1')
    const card = within(await screen.findByRole('region', { name: 'Share card' }))
    expect(card.queryByText(/Tick yours/)).toBeNull()
    expect(card.queryByText(/\/s\//)).toBeNull()
    expect(actions().queryByRole('button', { name: 'Copy link' })).toBeNull()
    fireEvent.click(actions().getByRole('button', { name: 'Copy text' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const text = writeText.mock.calls[0]![0]
    expect(text).not.toMatch(/\/s\/|Tick when/)
    expect(text.split('\n').at(-1)).toBe('Pay Dan: Wei Ling $39.16, Arjun $40.72')
  })
})
