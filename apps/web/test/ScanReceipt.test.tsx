import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReceiptScanDTO } from '@squadsplit/shared'
import { downscaleImage, UnsupportedPhotoError } from '../src/receipt/downscale'
import { expense, groupHandlers } from './group-fixtures'
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
  const calls = fakeApi(
    groupHandlers({}, { 'POST /groups/g1/receipts/scan': scan, 'POST /groups/g1/expenses': () => ({ status: 201, body: expense() }) }),
  )
  renderApp('/groups/g1/expenses/new')
  const dialog = within(await screen.findByRole('dialog', { name: 'New expense' }))
  fireEvent.click(dialog.getByRole('button', { name: 'By item' }))
  return { calls, dialog }
}

const photo = () => new File(['receipt photo'], 'receipt.jpg', { type: 'image/jpeg' })
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true'
const choose = (input: HTMLElement) => fireEvent.change(input, { target: { files: [photo()] } })
const itemRows = (dialog: ReturnType<typeof within>) =>
  dialog.queryAllByRole('group', { name: /^Item \d+$/ }).map((row: HTMLElement) => {
    const [name, price] = within(row).getAllByRole('textbox') as HTMLInputElement[]
    return [name!.value, price!.value]
  })
const serviceToggle = (dialog: ReturnType<typeof within>) => dialog.getByRole('checkbox', { name: /^Service charge/ }) as HTMLInputElement
const gstToggle = (dialog: ReturnType<typeof within>) => dialog.getByRole('checkbox', { name: /^GST/ }) as HTMLInputElement

describe('Scan receipt', () => {
  it('offers the camera and a photo from the gallery once, in a receipt card at the top of the form', async () => {
    const { dialog } = await openByItem(() => ({ status: 200, body: AI_SCAN }))
    expect(dialog.getAllByLabelText('Scan receipt')).toHaveLength(1)
    expect(dialog.getAllByLabelText('Pick a photo')).toHaveLength(1)
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

  })

  it('shows the receipt card in Equally mode on a new expense, above the description', async () => {
    fakeApi(groupHandlers())
    renderApp('/groups/g1/expenses/new')
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    expect(within(dialog).getByRole('button', { name: 'Equally' }).getAttribute('aria-pressed')).toBe('true')
    const card = within(dialog).getByRole('region', { name: 'Scan a receipt' })
    expect(card.textContent).toContain("Got a receipt? Scan it and we'll fill in the items.")
    expect(card.querySelector('svg')).toBeTruthy()
    expect(within(card).getByLabelText('Scan receipt')).toBeTruthy()
    expect(within(card).getByLabelText('Pick a photo')).toBeTruthy()
    // Above the description.
    expect(card.compareDocumentPosition(within(dialog).getByLabelText('Description')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dialog.textContent).not.toMatch(EMOJI)
  })

  it('switches an Equally split to By item when a scan works, filling in the items and the total', async () => {
    fakeApi(groupHandlers({}, { 'POST /groups/g1/receipts/scan': () => ({ status: 200, body: AI_SCAN }) }))
    renderApp('/groups/g1/expenses/new')
    const dialog = within(await screen.findByRole('dialog', { name: 'New expense' }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText('Read your receipt — total $93.52 matches. Tap who had what.')).toBeTruthy()
    expect(dialog.getByRole('button', { name: 'By item' }).getAttribute('aria-pressed')).toBe('true')
    expect(itemRows(dialog)).toEqual([['Laksa', '60.00'], ['Satay x10', '18.00']])
    expect([serviceToggle(dialog).checked, gstToggle(dialog).checked]).toEqual([true, true])
    expect((dialog.getByLabelText('Total (SGD)') as HTMLInputElement).value).toBe('93.52')
    // The receipt total is the amount too, should the split go back to Equally.
    fireEvent.click(dialog.getByRole('button', { name: 'Equally' }))
    expect((dialog.getByLabelText('Amount (SGD)') as HTMLInputElement).value).toBe('93.52')
  })

  it('asks before replacing an amount typed in Equally mode', async () => {
    fakeApi(groupHandlers({}, { 'POST /groups/g1/receipts/scan': () => ({ status: 200, body: AI_SCAN }) }))
    renderApp('/groups/g1/expenses/new')
    const dialog = within(await screen.findByRole('dialog', { name: 'New expense' }))
    fireEvent.change(dialog.getByLabelText('Amount (SGD)'), { target: { value: '40' } })

    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText("Replace what you've entered with the receipt?")).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Keep mine' }))
    expect(dialog.getByRole('button', { name: 'Equally' }).getAttribute('aria-pressed')).toBe('true')
    expect((dialog.getByLabelText('Amount (SGD)') as HTMLInputElement).value).toBe('40')

    choose(dialog.getByLabelText('Pick a photo'))
    fireEvent.click(await dialog.findByRole('button', { name: 'Replace' }))
    expect(dialog.getByRole('button', { name: 'By item' }).getAttribute('aria-pressed')).toBe('true')
    expect(itemRows(dialog)).toEqual([['Laksa', '60.00'], ['Satay x10', '18.00']])
  })

  it('leaves the receipt card out when editing an expense', async () => {
    fakeApi(groupHandlers({ expenses: [expense()] }))
    renderApp('/groups/g1/expenses/e1')
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit expense' }))
    await dialog.findByLabelText('Description')
    expect(dialog.queryByRole('region', { name: 'Scan a receipt' })).toBeNull()
    fireEvent.click(dialog.getByRole('button', { name: 'By item' }))
    expect(dialog.queryByLabelText('Scan receipt')).toBeNull()
  })

  it('shows it is reading, then fills in the items and the SG toggle and confirms the total', async () => {
    let answer!: () => void
    const { calls, dialog } = await openByItem(
      () => new Promise((resolve) => (answer = () => resolve({ status: 200, body: AI_SCAN }))),
    )
    serviceToggle(dialog).click() // off, so we can see the scan turn them back on
    gstToggle(dialog).click()
    expect([serviceToggle(dialog).checked, gstToggle(dialog).checked]).toEqual([false, false])

    choose(dialog.getByLabelText('Scan receipt'))
    expect((await dialog.findByText('Reading your receipt…')).getAttribute('role')).toBe('status')
    await vi.waitFor(() => expect(answer).toBeDefined())
    answer()

    expect((await dialog.findByText(/^Read your receipt/)).textContent).toBe('Read your receipt — total $93.52 matches. Tap who had what.')
    expect(itemRows(dialog)).toEqual([
      ['Laksa', '60.00'],
      ['Satay x10', '18.00'],
    ])
    expect([serviceToggle(dialog).checked, gstToggle(dialog).checked]).toEqual([true, true])
    expect((dialog.getByLabelText('Total (SGD)') as HTMLInputElement).value).toBe('93.52')
    expect(calls.find((c) => c.key === 'POST /groups/g1/receipts/scan')!.body).toEqual({ imageBase64: 'SMALL1024', mimeType: 'image/jpeg' })
    expect(tesseract.createWorker).not.toHaveBeenCalled()
    // Nothing is saved until the user assigns people and adds the expense.
    expect(calls.filter((c) => c.key === 'POST /groups/g1/expenses')).toEqual([])
    expect(screen.getByRole('dialog').textContent).not.toMatch(EMOJI)
  })

  it('after a scan that missed a line, shows the receipt total, blocks saving and adds the rest as Other', async () => {
    const { dialog } = await openByItem(() => ({
      status: 200,
      body: { ...AI_SCAN, items: [{ name: 'Laksa', amountCents: 6000 }], totalCents: 9352, totalMatches: false },
    }))
    choose(dialog.getByLabelText('Scan receipt'))
    await dialog.findByText('Read your receipt — check the total below, then tap who had what.')
    const total = dialog.getByLabelText('Total (SGD)') as HTMLInputElement
    expect(total.value).toBe('93.52')
    expect(total.placeholder).toBe('71.94')
    fireEvent.change(dialog.getByLabelText('Description'), { target: { value: 'Dinner' } })
    fireEvent.click(within(dialog.getByRole('group', { name: 'Who had item 1' })).getByRole('button', { name: 'Alice' }))
    const save = dialog.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement
    // One line, at the total, says how far off the items are.
    expect(dialog.getAllByText(/Items \+ charges come to/)).toHaveLength(1)
    expect(dialog.getByText('Items + charges come to $71.94, $21.58 short of the $93.52 total.')).toBeTruthy()
    expect(save.disabled).toBe(true)

    fireEvent.click(dialog.getByRole('button', { name: 'Add Other $18.00 (+ charges = $21.58)' }))
    expect(itemRows(dialog).at(-1)![0]).toBe('Other')
    expect(save.disabled).toBe(false)

    fireEvent.change(total, { target: { value: '120' } })
    expect(dialog.getByText(/short of the \$120\.00 total/)).toBeTruthy()
    expect(save.disabled).toBe(true)
  })

  it('assigns nobody after a scan, even in a group of two, and offers Everyone had this and Assign all to everyone', async () => {
    const { dialog } = await openByItem(() => ({
      status: 200,
      body: { ...AI_SCAN, items: [...AI_SCAN.items, { name: 'Kopi', amountCents: 300 }], totalCents: null, totalMatches: null },
    }))
    choose(dialog.getByLabelText('Scan receipt'))
    await dialog.findByText('Read your receipt — tap who had what.')
    const item = (n: number) => within(dialog.getByRole('group', { name: `Who had item ${n}` }))
    // The group has two people (Alice and Bob): nobody is put on a dish without a tap.
    for (const n of [1, 2, 3]) expect(item(n).getAllByRole('button').filter(pressed)).toEqual([])

    // One tap puts everyone on a dish.
    fireEvent.click(item(1).getByRole('button', { name: 'Everyone had this' }))
    expect(item(1).getAllByRole('button', { name: /Alice|Bob/ }).every(pressed)).toBe(true)
    fireEvent.click(item(2).getByRole('button', { name: 'Bob' }))

    // The shortcut does every dish nobody is on yet, and leaves the ones already tapped.
    fireEvent.click(dialog.getByRole('button', { name: 'Assign all to everyone' }))
    expect(item(2).getAllByRole('button', { name: /Alice|Bob/ }).map(pressed)).toEqual([false, true])
    expect(item(3).getAllByRole('button', { name: /Alice|Bob/ }).every(pressed)).toBe(true)
    expect(dialog.queryByRole('button', { name: 'Assign all to everyone' })).toBeNull()
  })

  it('says once, at the total, when the items do not add up to the receipt total', async () => {
    const { dialog } = await openByItem(() => ({ status: 200, body: { ...AI_SCAN, totalCents: 10_000, totalMatches: false } }))
    choose(dialog.getByLabelText('Pick a photo'))
    expect(await dialog.findByText('Read your receipt — check the total below, then tap who had what.')).toBeTruthy()
    expect(dialog.getByText('Items + charges come to $93.52, $6.48 short of the $100.00 total.')).toBeTruthy()
    expect(dialog.queryByText(/Receipt says/)).toBeNull()
  })

  it.each([
    ['GST only', { serviceChargeBps: null, gstBps: 900, totalCents: 8502 }, ['Service charge 10%', 'GST 9%'], [false, true], '$85.02', 'Subtotal $78.00 · GST 9% $7.02'],
    ['service charge only', { serviceChargeBps: 1000, gstBps: null, totalCents: 8580 }, ['Service charge 10%', 'GST 9%'], [true, false], '$85.80', 'Subtotal $78.00 · Service charge 10% $7.80'],
    ['other rates', { serviceChargeBps: 1200, gstBps: 900, totalCents: 9522 }, ['Service charge 12%', 'GST 9%'], [true, true], '$95.22', 'Subtotal $78.00 · Service charge 12% $9.36 · GST 9% $7.86'],
  ])('adds a receipt’s own charges when they are %s, so the saved total is the receipt’s', async (_, charges, labels, ons, total, breakdown) => {
    const { calls, dialog } = await openByItem(() => ({ status: 200, body: { ...AI_SCAN, ...charges, totalMatches: true } }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText(`Read your receipt — total ${total} matches. Tap who had what.`)).toBeTruthy()

    // A charge the receipt lacks starts off, at the SG rate.
    expect([serviceToggle(dialog).checked, gstToggle(dialog).checked]).toEqual(ons)
    expect([serviceToggle(dialog).closest('label')!.textContent, gstToggle(dialog).closest('label')!.textContent]).toEqual(labels)
    expect((dialog.getByLabelText('Total (SGD)') as HTMLInputElement).value).toBe(total.replace('$', ''))
    expect(dialog.getByText(/^Subtotal/).textContent).toBe(breakdown)

    // Assign both items and save: the expense carries the receipt's rates and total.
    fireEvent.change(dialog.getByLabelText('Description'), { target: { value: 'Dinner' } })
    for (const n of [1, 2]) fireEvent.click(within(dialog.getByRole('group', { name: `Who had item ${n}` })).getByRole('button', { name: 'Alice' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Add expense' }))
    await vi.waitFor(() => expect(calls.some((c) => c.key === 'POST /groups/g1/expenses')).toBe(true))
    const saved = calls.find((c) => c.key === 'POST /groups/g1/expenses')!.body as { amountCents: number; split: object }
    expect(saved.amountCents).toBe(charges.totalCents)
    expect(saved.split).toMatchObject({ type: 'itemized', serviceChargeBps: charges.serviceChargeBps ?? 0, gstBps: charges.gstBps ?? 0 })
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
    expect([serviceToggle(dialog).checked, gstToggle(dialog).checked]).toEqual([false, false])
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

  it('tries reading on the phone when the AI could not read the receipt (422 receipt_unreadable)', async () => {
    const { dialog } = await openByItem(() => ({
      status: 422,
      body: { error: { code: 'receipt_unreadable', message: "Couldn't read this receipt — add the items by hand." } },
    }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText('Read on your phone — double-check the items and prices.')).toBeTruthy()
    expect(itemRows(dialog)).toEqual([
      ['Kopi O x2', '2.40'],
      ['Kaya Toast', '3.20'],
    ])
    expect(tesseract.createWorker).toHaveBeenCalledTimes(1)
  })

  it('says to add the items by hand when neither the AI nor the phone can read it', async () => {
    tesseract.ocr.text = '|||  ~~\nTHANK YOU\n'
    const { dialog } = await openByItem(() => ({
      status: 422,
      body: { error: { code: 'receipt_unreadable', message: "Couldn't read this receipt — add the items by hand." } },
    }))
    choose(dialog.getByLabelText('Scan receipt'))
    expect(await dialog.findByText("Couldn't read this receipt — add the items by hand.")).toBeTruthy()
    expect(itemRows(dialog)).toEqual([['', '']])
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
    expect(await dialog.findByText("Replace what you've entered with the receipt?")).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Replace' }))
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
