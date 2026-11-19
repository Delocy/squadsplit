import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReceiptScanDTO } from '@squadsplit/shared'
import { downscaleImage, UnsupportedPhotoError } from '../src/receipt/downscale'
import { groupHandlers } from './group-fixtures'
import { fakeApi, renderApp, type Handler } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))

// No canvas in jsdom: the downscale helper (tested on its own) answers with a marker of the size it was asked for.
const downscale = vi.hoisted(() => ({ calls: [] as Blob[] }))
vi.mock('../src/receipt/downscale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/receipt/downscale')>()),
  downscaleImage: vi.fn(async (file: Blob, maxEdge: number) => {
    downscale.calls.push(file)
    return `data:image/jpeg;base64,SMALL${maxEdge}`
  }),
}))

// Tesseract.js stands in for the on-phone reader; it must only ever load on the fallback path.
const tesseract = vi.hoisted(() => {
  const ocr = { text: '' }
  const worker = { recognize: vi.fn(async (_image: string) => ({ data: { text: ocr.text } })), terminate: vi.fn(async () => {}) }
  return { ocr, worker, createWorker: vi.fn(async (..._args: unknown[]) => worker) }
})
vi.mock('tesseract.js', () => ({ default: { createWorker: tesseract.createWorker } }))

const EMOJI = /\p{Extended_Pictographic}/u

const AI_SCAN: ReceiptScanDTO = {
  items: [
    { name: 'Laksa', amountCents: 6000 },
    { name: 'Satay x10', amountCents: 1800 },
  ],
  serviceChargeBps: 1000,
  gstBps: 900,
  totalCents: 9352,
  totalMatches: true,
  source: 'ai',
}

const PHONE_TEXT = `KOPITIAM\n2 x Kopi O     2.40\nKaya Toast     3.20\nTOTAL          5.60\nCash          10.00\n`

beforeEach(() => {
  tesseract.ocr.text = PHONE_TEXT
  tesseract.createWorker.mockClear()
  tesseract.worker.recognize.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openByItem(scan: Handler) {
  const calls = fakeApi(groupHandlers({}, { 'POST /groups/g1/receipts/scan': scan }))
  renderApp('/groups/g1/expenses/new')
  const dialog = within(await screen.findByRole('dialog', { name: 'New expense' }))
  fireEvent.click(dialog.getByRole('button', { name: 'By item' }))
  return { calls, dialog }
}

const photo = () => new File(['receipt photo'], 'receipt.jpg', { type: 'image/jpeg' })
const choose = (input: HTMLElement) => fireEvent.change(input, { target: { files: [photo()] } })
const itemRows = (dialog: ReturnType<typeof within>) =>
  dialog.queryAllByRole('group', { name: /^Item \d+$/ }).map((row: HTMLElement) => {
    const [name, price] = within(row).getAllByRole('textbox') as HTMLInputElement[]
    return [name!.value, price!.value]
  })
const sgToggle = (dialog: ReturnType<typeof within>) => dialog.getByRole('checkbox', { name: /Restaurant bill/ }) as HTMLInputElement

describe('Scan receipt', () => {
  it('offers the camera and a photo from the gallery in By item mode only', async () => {
    const { dialog } = await openByItem(() => ({ status: 200, body: AI_SCAN }))
    const camera = dialog.getByLabelText('Scan receipt') as HTMLInputElement
    expect(camera.type).toBe('file')
    // An explicit list, not image/*: some desktop and embedded pickers apply image/* badly and grey out .jpeg files.
    const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif'
    expect(camera.accept).toBe(ACCEPT)
    expect(camera.accept.split(',')).toEqual(expect.arrayContaining(['.jpg', '.jpeg']))
    expect(camera.getAttribute('capture')).toBe('environment')
    const gallery = dialog.getByLabelText('Pick a photo') as HTMLInputElement
    expect(gallery.accept).toBe(ACCEPT)
    expect(gallery.hasAttribute('capture')).toBe(false)

    fireEvent.click(dialog.getByRole('button', { name: 'Equally' }))
    expect(dialog.queryByLabelText('Scan receipt')).toBeNull()
  })

  it('shows it is reading, then fills in the items and the SG toggle and confirms the total', async () => {
    let answer!: () => void
    const { calls, dialog } = await openByItem(
      () => new Promise((resolve) => (answer = () => resolve({ status: 200, body: AI_SCAN }))),
    )
    sgToggle(dialog).click() // off, so we can see the scan turn it back on
    expect(sgToggle(dialog).checked).toBe(false)

    choose(dialog.getByLabelText('Scan receipt'))
    expect((await dialog.findByText('Reading your receipt…')).getAttribute('role')).toBe('status')
    await vi.waitFor(() => expect(answer).toBeDefined())
    answer()

    expect((await dialog.findByText(/^Read your receipt/)).textContent).toBe('Read your receipt — total $93.52 matches. Tap who had what.')
    expect(itemRows(dialog)).toEqual([
      ['Laksa', '60.00'],
      ['Satay x10', '18.00'],
    ])
    expect(sgToggle(dialog).checked).toBe(true)
    expect(dialog.getByTestId('bill-total').textContent).toBe('$93.52')
    expect(calls.find((c) => c.key === 'POST /groups/g1/receipts/scan')!.body).toEqual({ imageBase64: 'SMALL1024', mimeType: 'image/jpeg' })
    expect(tesseract.createWorker).not.toHaveBeenCalled()
    // Nothing is saved until the user assigns people and adds the expense.
    expect(calls.filter((c) => c.key === 'POST /groups/g1/expenses')).toEqual([])
    expect(screen.getByRole('dialog').textContent).not.toMatch(EMOJI)
  })

  it('asks to check the items when they do not add up to the receipt total', async () => {
    const { dialog } = await openByItem(() => ({ status: 200, body: { ...AI_SCAN, totalCents: 10_000, totalMatches: false } }))
    choose(dialog.getByLabelText('Pick a photo'))
    expect(await dialog.findByText('Receipt says $100.00, items add up to $93.52 — please check the items.')).toBeTruthy()
  })

  it('turns the SG toggle off when the receipt has other charges, and says so', async () => {
    const { dialog } = await openByItem(() => ({
      status: 200,
      body: { ...AI_SCAN, serviceChargeBps: null, totalCents: 8502 },
    }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText(/the restaurant bill toggle is off\.$/)).toBeTruthy()
    expect(sgToggle(dialog).checked).toBe(false)
  })

  it.each([
    ['resting for the day (429)', () => ({ status: 429, body: { error: { code: 'scan_limit', message: 'Receipt scanning is resting until tomorrow — enter the items by hand.' } } })],
    ['unavailable (503)', () => ({ status: 503, body: { error: { code: 'scan_unavailable', message: "Receipt scanning isn't available right now." } } })],
    ['unreachable', () => { throw new TypeError('Failed to fetch') }],
  ] as [string, Handler][])('reads the receipt on the phone when the scan is %s', async (_, handler) => {
    const { calls, dialog } = await openByItem(handler)
    choose(dialog.getByLabelText('Scan receipt'))

    expect(await dialog.findByText('Read on your phone — double-check the items and prices.')).toBeTruthy()
    expect(itemRows(dialog)).toEqual([
      ['Kopi O x2', '2.40'],
      ['Kaya Toast', '3.20'],
    ])
    expect(sgToggle(dialog).checked).toBe(false)
    expect(calls.filter((c) => c.key === 'POST /groups/g1/receipts/scan')).toHaveLength(1)

    // Self-hosted: worker, core and language data all come from our own origin, never a CDN.
    const [lang, , options] = tesseract.createWorker.mock.calls[0]!
    expect(lang).toBe('eng')
    expect(options).toMatchObject({
      workerPath: `${location.origin}/tesseract/worker.min.js`,
      corePath: `${location.origin}/tesseract/core`,
      langPath: `${location.origin}/tesseract/lang`,
    })
    expect(tesseract.worker.recognize).toHaveBeenCalledWith('data:image/jpeg;base64,SMALL2048')
    expect(tesseract.worker.terminate).toHaveBeenCalled()
  })

  it('says to add the items by hand when nothing on the receipt can be read', async () => {
    const { dialog } = await openByItem(() => ({
      status: 422,
      body: { error: { code: 'receipt_unreadable', message: "Couldn't read this receipt — add the items by hand." } },
    }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText("Couldn't read this receipt — add the items by hand.")).toBeTruthy()
    expect(itemRows(dialog)).toEqual([['', '']])
    expect(tesseract.createWorker).not.toHaveBeenCalled()
  })

  it('says to add the items by hand when the phone cannot read the receipt either', async () => {
    tesseract.ocr.text = '|||  ~~\nTHANK YOU\n'
    const { dialog } = await openByItem(() => ({ status: 503, body: { error: { code: 'scan_unavailable', message: 'x' } } }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText("Couldn't read this receipt — add the items by hand.")).toBeTruthy()
  })

  it('asks before replacing items the user already typed', async () => {
    const { dialog } = await openByItem(() => ({ status: 200, body: AI_SCAN }))
    fireEvent.change(dialog.getByLabelText('Item name'), { target: { value: 'Chicken Rice' } })

    choose(dialog.getByLabelText('Scan receipt'))
    fireEvent.click(await dialog.findByRole('button', { name: 'Keep mine' }))
    expect(itemRows(dialog)).toEqual([['Chicken Rice', '']])
    expect(dialog.queryByText(/^Read your receipt/)).toBeNull()

    choose(dialog.getByLabelText('Scan receipt'))
    expect((await dialog.findByText(/Replace the items you typed/)).textContent).toBe('Replace the items you typed with the 2 from the receipt?')
    fireEvent.click(dialog.getByRole('button', { name: 'Replace items' }))
    expect(itemRows(dialog)).toEqual([
      ['Laksa', '60.00'],
      ['Satay x10', '18.00'],
    ])
    expect(dialog.getByText('Read your receipt — total $93.52 matches. Tap who had what.')).toBeTruthy()
  })

  it('shows any other API error and leaves the items alone', async () => {
    const { dialog } = await openByItem(() => ({ status: 404, body: { error: { code: 'not_found', message: 'Group not found' } } }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect((await dialog.findByText('Group not found')).getAttribute('role')).toBe('alert')
    expect(tesseract.createWorker).not.toHaveBeenCalled()
  })

  it('reads a .jpeg photo that the picker gave no MIME type', async () => {
    const { calls, dialog } = await openByItem(() => ({ status: 200, body: AI_SCAN }))
    const untyped = new File(['receipt photo'], 'IMG_0042.jpeg', { type: '' })
    downscale.calls.length = 0
    fireEvent.change(dialog.getByLabelText('Pick a photo'), { target: { files: [untyped] } })
    await vi.waitFor(() => expect(itemRows(dialog)).toEqual([['Laksa', '60.00'], ['Satay x10', '18.00']]))
    expect(downscale.calls[0]).toBe(untyped)
    expect(calls.filter((c) => c.key === 'POST /groups/g1/receipts/scan')).toHaveLength(1)
  })

  it("says to try a JPEG or PNG when the browser can't decode the photo (an iPhone HEIC on desktop Chrome)", async () => {
    const { calls, dialog } = await openByItem(() => ({ status: 200, body: AI_SCAN }))
    vi.mocked(downscaleImage).mockRejectedValueOnce(new UnsupportedPhotoError())
    fireEvent.change(dialog.getByLabelText('Pick a photo'), { target: { files: [new File(['heic'], 'IMG_0043.HEIC', { type: 'image/heic' })] } })
    expect((await dialog.findByRole('alert')).textContent).toBe(
      "This photo format can't be read here — try a JPEG or PNG, or take the photo again with the camera button.",
    )
    expect(calls.some((c) => c.key === 'POST /groups/g1/receipts/scan')).toBe(false)
    // Still usable: the buttons are back.
    expect(dialog.getByLabelText('Scan receipt')).toBeTruthy()
  })
})
