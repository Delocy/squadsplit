import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultAvatar, type QuickSplitInput, type QuickSplitSummaryDTO, type ReceiptScanDTO } from '@squadsplit/shared'
import { ME } from './clerk-mock'
import { fakeApi, renderApp, type Handler } from './harness'
import { readmeSplit } from './quick-fixtures'

vi.mock('@clerk/react', () => import('./clerk-mock'))
// No canvas in jsdom: the downscale helper (tested on its own) answers with a marker.
vi.mock('../src/receipt/downscale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/receipt/downscale')>()),
  downscaleImage: vi.fn(async () => 'data:image/jpeg;base64,SMALL'),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const EMOJI = /\p{Extended_Pictographic}/u

const summary = (names: string[], over: Partial<QuickSplitSummaryDTO> = {}): QuickSplitSummaryDTO => ({
  id: 'old', title: 'Dim sum', place: null, spentOn: '2026-11-14', currency: 'SGD', totalCents: 8662,
  paidCount: 1, peopleCount: names.length, link: 'off', names, createdAt: '2026-11-14T05:00:00.000Z', ...over,
})

function start(handlers: Record<string, Handler> = {}) {
  const calls = fakeApi({
    'GET /quick-splits': () => ({ status: 200, body: [summary(['Me', 'Priya', 'Marcus', 'wei ling'])] }),
    'POST /quick-splits': () => ({ status: 201, body: readmeSplit() }),
    'GET /quick-splits/q1': () => ({ status: 200, body: readmeSplit() }),
    ...handlers,
  })
  const router = renderApp('/quick/new')
  return { calls, router }
}

const type = (label: string | RegExp, value: string, within_: ReturnType<typeof within> = screen as never) =>
  fireEvent.change(within_.getByLabelText(label), { target: { value } })

/** Types the README's dishes into the bill step. */
async function fillBill() {
  type("What's it for?", 'Team lunch')
  type('Where? (optional)', 'Tanjong Pagar')
  type('Date', '2026-11-19')
  const dishes: [string, string][] = [
    ['Laksa', '10'],
    ['Satay', '20.00'],
    ['Chilli crab', '48'],
    ['Char kway teow', '8.50'],
    ['Iced barley (2)', '5.60'],
  ]
  for (const [i, [name, price]] of dishes.entries()) {
    if (i > 0) fireEvent.click(screen.getByRole('button', { name: 'Add a dish' }))
    const row = within(screen.getByRole('group', { name: `Dish ${i + 1}` }))
    type('Dish name', name, row)
    type('Price', price, row)
  }
}

async function addPeople(...names: string[]) {
  for (const name of names) {
    type('Add a name', name)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  }
}

/** Taps who had a dish. */
function tap(dish: string, ...who: string[]) {
  const row = within(screen.getByRole('group', { name: dish }))
  for (const name of who) fireEvent.click(row.getByRole('button', { name }))
}

const totalsCard = () => within(screen.getByRole('region', { name: 'Each person, with the charges' }))

describe('Quick split: making one', () => {
  it('builds the README example step by step and saves it, landing on its card', async () => {
    const { calls, router } = start()
    expect(await screen.findByRole('heading', { name: 'Quick split' })).toBeTruthy()
    await fillBill()
    const bill = within(screen.getByRole('region', { name: 'The bill' }))
    expect(bill.getByText('$92.10')).toBeTruthy()
    expect(bill.getByText('$9.21')).toBeTruthy()
    expect(bill.getByText('$9.12')).toBeTruthy()
    expect(bill.getByText('$110.43')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Paid by' }).textContent).toContain('You')
    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))

    type('Your name on the card', 'Dan')
    await addPeople('Wei Ling', 'Arjun')
    expect(screen.getByRole('list', { name: "Who's splitting" }).textContent).toMatch(/You[\s\S]*Wei Ling[\s\S]*Arjun/)
    fireEvent.click(screen.getByRole('button', { name: /Next: who had what/ }))

    tap('Laksa', 'Wei Ling')
    tap('Satay', 'You', 'Wei Ling', 'Arjun')
    tap('Chilli crab', 'You', 'Wei Ling', 'Arjun')
    tap('Char kway teow', 'Arjun')
    tap('Iced barley (2)', 'You', 'Arjun')
    expect(within(screen.getByRole('group', { name: 'Satay' })).getByText('shared by 3')).toBeTruthy()
    const totals = totalsCard()
    expect(totals.getByText('$30.55')).toBeTruthy()
    expect(totals.getByText('$39.16')).toBeTruthy()
    expect(totals.getByText('$40.72')).toBeTruthy()
    expect(totals.getByText('Adds up to the bill: $110.43')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Make the share card' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/quick/q1'))
    const post = calls.find((c) => c.key === 'POST /quick-splits')!
    const { people, ...body } = post.body as QuickSplitInput
    // Each look goes along, so the animals shown while splitting are the ones saved: yours is your profile look.
    expect(people[0]!.avatar).toEqual(defaultAvatar(ME))
    expect(new Set(people.map((p) => `${p.avatar!.animal}/${p.avatar!.color}`)).size).toBe(3)
    expect({ ...body, people: people.map(({ avatar: _avatar, ...p }) => p) }).toEqual({
      title: 'Team lunch',
      place: 'Tanjong Pagar',
      spentOn: '2026-11-19',
      serviceChargeBps: 1000,
      gstBps: 900,
      people: [
        { name: 'Dan', isPayer: true },
        { name: 'Wei Ling', isPayer: false },
        { name: 'Arjun', isPayer: false },
      ],
      items: [
        { name: 'Laksa', amountCents: 1000, personIndexes: [1] },
        { name: 'Satay', amountCents: 2000, personIndexes: [0, 1, 2] },
        { name: 'Chilli crab', amountCents: 4800, personIndexes: [0, 1, 2] },
        { name: 'Char kway teow', amountCents: 850, personIndexes: [2] },
        { name: 'Iced barley (2)', amountCents: 560, personIndexes: [0, 2] },
      ],
    } satisfies QuickSplitInput)
    expect(await screen.findByRole('region', { name: 'Share card' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(EMOJI)
  })

  it('has separate service charge and GST toggles, both on at the SG rates, and stores 0 for one that is off', async () => {
    const { calls } = start()
    await screen.findByRole('heading', { name: 'Quick split' })
    await fillBill()
    const service = screen.getByRole('switch', { name: /Service charge 10%/ }) as HTMLInputElement
    const gst = screen.getByRole('switch', { name: /GST 9%/ }) as HTMLInputElement
    expect(service.checked && gst.checked).toBe(true)
    fireEvent.click(service)
    const bill = within(screen.getByRole('region', { name: 'The bill' }))
    expect(bill.queryByText(/Service charge/)).toBeNull()
    expect(bill.getByText('$100.39')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))
    await addPeople('Arjun')
    fireEvent.click(screen.getByRole('button', { name: /Next: who had what/ }))
    for (const dish of ['Laksa', 'Satay', 'Chilli crab', 'Char kway teow', 'Iced barley (2)']) tap(dish, 'Arjun')
    fireEvent.click(screen.getByRole('button', { name: 'Make the share card' }))
    await vi.waitFor(() => expect(calls.some((c) => c.key === 'POST /quick-splits')).toBe(true))
    expect(calls.find((c) => c.key === 'POST /quick-splits')!.body).toMatchObject({ serviceChargeBps: 0, gstBps: 900 })
  })

  it("after a scan, turns on only the receipt's own charges at its rates; one it lacks comes back at the SG rate", async () => {
    const scan: ReceiptScanDTO = {
      items: [{ name: 'Nasi lemak', amountCents: 1000 }],
      serviceChargeBps: null,
      gstBps: 800,
      totalCents: 1080,
      totalMatches: true,
      source: 'ai',
    }
    const { calls } = start({ 'POST /receipts/scan': () => ({ status: 200, body: scan }) })
    await screen.findByRole('heading', { name: 'Quick split' })
    fireEvent.change(screen.getByLabelText('Pick a photo'), { target: { files: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })] } })
    await vi.waitFor(() => expect((screen.getByLabelText('Dish name') as HTMLInputElement).value).toBe('Nasi lemak'))
    expect(calls.map((c) => c.key)).toContain('POST /receipts/scan')

    const service = screen.getByRole('switch', { name: /Service charge 10%/ }) as HTMLInputElement
    const gst = screen.getByRole('switch', { name: /GST 8%/ }) as HTMLInputElement
    expect(service.checked).toBe(false)
    expect(gst.checked).toBe(true)
    expect(within(screen.getByRole('region', { name: 'The bill' })).getByText('$10.80')).toBeTruthy()
    fireEvent.click(service)
    expect(within(screen.getByRole('region', { name: 'The bill' })).getByText('$11.88')).toBeTruthy()
  })

  it('suggests names from recent quick splits, leaving out you and anyone already in', async () => {
    start()
    await screen.findByRole('heading', { name: 'Quick split' })
    await fillBill()
    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))
    await addPeople('Wei Ling')
    const suggestions = within(await screen.findByRole('group', { name: 'From recent quick splits' }))
    expect(suggestions.getAllByRole('button').map((b) => b.textContent)).toEqual(['+ Priya', '+ Marcus'])
    fireEvent.click(suggestions.getByRole('button', { name: '+ Priya' }))
    expect(screen.getByRole('list', { name: "Who's splitting" }).textContent).toContain('Priya')
  })

  it('puts only the first word of your profile name on the card, for you to change', async () => {
    start({ 'GET /me': () => ({ status: 200, body: { id: ME, displayName: 'Dan Tan Wei Ming', avatarUrl: null, profileAvatar: defaultAvatar(ME) } }) })
    await screen.findByRole('heading', { name: 'Quick split' })
    await fillBill()
    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))
    const mine = screen.getByLabelText('Your name on the card') as HTMLInputElement
    expect(mine.value).toBe('Dan')
    fireEvent.change(mine, { target: { value: 'Danny' } })
    expect(mine.value).toBe('Danny')
  })

  it("won't move on until each step is ready", async () => {
    start()
    await screen.findByRole('heading', { name: 'Quick split' })
    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))
    expect(screen.getByRole('alert').textContent).toMatch(/What's it for/)
    await fillBill()
    fireEvent.click(screen.getByRole('button', { name: /Next: who.s in/ }))
    fireEvent.click(screen.getByRole('button', { name: /Next: who had what/ }))
    expect(screen.getByRole('alert').textContent).toMatch(/Add at least one person/)
    await addPeople('Arjun', 'arjun')
    expect(screen.getByRole('alert').textContent).toMatch(/already/)
    fireEvent.click(screen.getByRole('button', { name: /Next: who had what/ }))
    tap('Laksa', 'Arjun')
    fireEvent.click(screen.getByRole('button', { name: 'Make the share card' }))
    expect(screen.getByRole('alert').textContent).toMatch(/Tap who had each dish/)
  })
})
