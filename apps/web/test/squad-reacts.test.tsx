import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BalanceCard } from '../src/components/BalanceCard'
import { Avatar } from '../src/design/Avatar'
import { balanceMood } from '../src/design/mood'
import { squadQuip } from '../src/squadQuip'
import { ME } from './clerk-mock'
import { BOB, expense, group, groupHandlers, member, settlement } from './group-fixtures'
import { fakeApi, renderApp, transferLine } from './harness'
import { mockReducedMotion } from './motion-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const DAVE = 'user_dave'
const FOX = { animal: 'fox', color: 'peach' } as const
const BUNNY = { animal: 'bunny', color: 'pink' } as const

describe('balanceMood', () => {
  it('is happy with a sparkle when owed, calm when even, nervous when owing', () => {
    expect(balanceMood(1)).toEqual({ mood: 'happy', sweat: 0, sparkle: true })
    expect(balanceMood(0)).toEqual({ mood: 'calm', sweat: 0, sparkle: false })
    expect(balanceMood(-1)).toEqual({ mood: 'nervous', sweat: 0, sparkle: false })
  })

  it('sweats one drop from 20.00 owed, two from 50.00 and three from 150.00 (in cents)', () => {
    const drops = (cents: number) => balanceMood(cents).sweat
    expect(drops(-1999)).toBe(0)
    expect(drops(-2000)).toBe(1)
    expect(drops(-4999)).toBe(1)
    expect(drops(-5000)).toBe(2)
    expect(drops(-14999)).toBe(2)
    expect(drops(-15000)).toBe(3)
    expect(drops(-9_999_999)).toBe(3)
    // Being owed a lot is no reason to sweat.
    expect(drops(9_999_999)).toBe(0)
  })
})

describe('Avatar moods', () => {
  it('draws one sweat drop per level, and a sparkle only when there is no sweat', () => {
    const { container, rerender } = render(<Avatar avatar={FOX} {...balanceMood(-16000)} />)
    expect(container.querySelectorAll('.sweat')).toHaveLength(3)
    expect(container.querySelector('.av')!.getAttribute('data-mood')).toBe('nervous')

    rerender(<Avatar avatar={FOX} {...balanceMood(500)} />)
    expect(container.querySelectorAll('.sweat')).toHaveLength(0)
    expect(container.querySelector('.glint')).toBeTruthy()
    expect(container.querySelector('.av')!.getAttribute('data-mood')).toBe('happy')
  })

  it('stays a bare avatar when there is nothing to add', () => {
    const { container } = render(<Avatar avatar={FOX} />)
    expect(container.firstElementChild!.classList.contains('av')).toBe(true)
    expect(container.querySelector('.avw')).toBeNull()
  })
})

describe('squadQuip', () => {
  const squad = [
    { name: 'Alice', cents: 21680 },
    { name: 'Bob', cents: -5900 },
    { name: 'Carol', cents: 3400 },
  ]

  it('names your animal and compares you with the squad', () => {
    expect(squadQuip({ animal: 'fox', cents: -21680, squad, seed: 0 })).toBe('Your fox is sweating. Alice is not.')
    expect(squadQuip({ animal: 'bunny', cents: 21680, squad, seed: 0 })).toBe('Your bunny is grinning. Bob is sweating.')
    expect(squadQuip({ animal: 'panda', cents: 0, squad, seed: 0 })).toBe('Your panda is relaxed. Bob is sweating, though.')
    expect(squadQuip({ animal: 'panda', cents: 0, squad: [{ name: 'Alice', cents: 0 }], seed: 0 })).toBe(
      'Your panda is relaxed. So is the whole squad.',
    )
  })

  it('only says sweating where the avatar shows sweat (20.00 owed or more)', () => {
    expect(squadQuip({ animal: 'fox', cents: -1999, squad: [], seed: 0 })).toBe('Your fox is getting nervous. Time to pay up.')
    expect(squadQuip({ animal: 'fox', cents: -2000, squad: [], seed: 0 })).toBe('Your fox is sweating. Time to pay up.')
    const small = [{ name: 'Bob', cents: -500 }]
    expect(squadQuip({ animal: 'bunny', cents: 500, squad: small, seed: 0 })).toBe('Your bunny is grinning. Bob is a little nervous.')
    expect(squadQuip({ animal: 'bunny', cents: 0, squad: small, seed: 0 })).toBe('Your bunny is relaxed. Bob is a little nervous, though.')
    for (let seed = 0; seed < 4; seed++) {
      expect(squadQuip({ animal: 'fox', cents: -500, squad: [], seed })).not.toContain('sweating')
      expect(squadQuip({ animal: 'fox', cents: -5000, squad: [], seed })).toContain('sweating')
    }
  })

  it('still reads well on your own, and the seed picks the wording', () => {
    expect(squadQuip({ animal: 'fox', cents: -2500, squad: [], seed: 0 })).toBe('Your fox is sweating. Time to pay up.')
    expect(squadQuip({ animal: 'fox', cents: -500, squad: [], seed: 1 })).not.toBe(squadQuip({ animal: 'fox', cents: -500, squad: [], seed: 0 }))
    for (let seed = 0; seed < 6; seed++) {
      expect(squadQuip({ animal: 'fox', cents: -500, squad, seed })).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})

describe('BalanceCard squad strip', () => {
  it('shows everyone else in the group with their mood and sweat, and your mascot sweats too', () => {
    render(
      <BalanceCard
        cents={-21680}
        currency="SGD"
        avatar={FOX}
        seed={0}
        squad={[
          { userId: 'a', name: 'Alice', avatar: BUNNY, cents: 21680 },
          { userId: 'b', name: 'Bob', avatar: FOX, cents: -5900 },
        ]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Your balance' })
    expect(card.querySelector('.quip')!.textContent).toBe('Your fox is sweating. Alice is not.')
    const strip = within(within(card).getByRole('group', { name: 'The squad' }))
    expect(strip.getByRole('img', { name: 'Alice' }).getAttribute('data-mood')).toBe('happy')
    const bob = strip.getByRole('img', { name: 'Bob' })
    expect(bob.getAttribute('data-mood')).toBe('nervous')
    expect(bob.parentElement!.querySelectorAll('.sweat')).toHaveLength(2)
    // Your own mascot: three drops at 216.80 owed. The amount itself is untouched.
    expect(card.querySelectorAll('.buddy-w > .sweat')).toHaveLength(3)
    expect(card.querySelector('.amt')!.textContent).toBe('$216.80')
  })

  it('has no strip in a group of one', () => {
    render(<BalanceCard cents={0} currency="SGD" avatar={FOX} seed={0} squad={[]} />)
    expect(screen.queryByRole('group', { name: 'The squad' })).toBeNull()
  })
})

describe('Squad Reacts on the group home', () => {
  const g = group({
    members: [member(ME, 'Alice', FOX, { role: 'owner' }), member(BOB, 'Bob', { animal: 'koala', color: 'mint' }), member(DAVE, 'Dave', BUNNY)],
  })

  it('gives every avatar on the leaderboard and in settle up its owner’s mood from the balances', async () => {
    fakeApi(
      groupHandlers({
        group: g,
        balances: { balances: { [ME]: 9000, [BOB]: -6000, [DAVE]: -3000 }, suggestions: [{ fromUserId: BOB, toUserId: ME, amountCents: 6000 }] },
        expenses: [expense()],
        fun: {
          leaderboard: [
            { userId: ME, netCents: 9000, rank: 1 },
            { userId: DAVE, netCents: -3000, rank: 2 },
            { userId: BOB, netCents: -6000, rank: 3 },
          ],
          badges: [],
        },
      }),
    )
    renderApp('/groups/g1')
    const board = await screen.findByRole('region', { name: /Leaderboard/ })
    const bobRow = (await within(board).findByText('Bob')).closest('.lb-row')!
    expect(bobRow.querySelector('.av')!.getAttribute('data-mood')).toBe('nervous')
    expect(bobRow.querySelectorAll('.sweat')).toHaveLength(2)
    expect(within(board).getByText('Alice').closest('.lb-row')!.querySelector('.glint')).toBeTruthy()

    const settle = screen.getByRole('region', { name: /Settle up/ })
    const transfer = within(settle).getByText(transferLine('Bob → You')).closest('.row')!
    expect([...transfer.querySelectorAll('.av')].map((a) => a.getAttribute('data-mood'))).toEqual(['nervous', 'happy'])

    // The squad strip on your balance card, and your own avatar in the top bar.
    const strip = within(screen.getByRole('group', { name: 'The squad' }))
    expect(strip.getByRole('img', { name: 'Bob' }).getAttribute('data-mood')).toBe('nervous')
    expect(strip.getByRole('img', { name: 'Dave' }).getAttribute('data-mood')).toBe('nervous')
    expect(screen.getByRole('img', { name: 'You' }).getAttribute('data-mood')).toBe('happy')
  })

  it('plays the heart hop and cheer wave when you confirm a payback, and lets you close it', async () => {
    fakeApi(
      groupHandlers(
        { group: g, expenses: [expense()], pending: [settlement({ id: 's1', fromUserId: BOB, toUserId: ME, amountCents: 1200 })] },
        { 'POST /settlements/s1/confirm': () => ({ status: 200, body: settlement({ status: 'confirmed' }) }) },
      ),
    )
    renderApp('/groups/g1')
    const settle = within(await screen.findByRole('region', { name: /Settle up/ }))
    fireEvent.click(await settle.findByRole('button', { name: 'Confirm' }))

    const moment = await screen.findByRole('region', { name: 'Payback confirmed' })
    // The moment takes the confirmed row's place at once (this fake API keeps listing it as pending).
    expect(settle.queryByText('Bob says they paid you $12.00')).toBeNull()
    expect(moment.textContent).toContain('Bob paid you back. The squad approves.')
    expect(moment.querySelector('.slip-amt')!.textContent).toBe('$12.00')
    expect(moment.querySelector('.heart-hop')).toBeTruthy()
    // The payer stops frowning: a nervous face fades off a happy one.
    const payer = moment.querySelector('.hop-l')!
    expect(payer.querySelector('.swap-from .av')!.getAttribute('data-mood')).toBe('nervous')
    expect(payer.querySelector(':scope > .swap > .av')!.getAttribute('data-mood')).toBe('happy')
    // Everyone else cheers: Dave here (the payer and you are in the duo).
    const cheer = [...moment.querySelectorAll('.cheer .wave .av')]
    expect(cheer.map((a) => a.getAttribute('aria-label'))).toEqual(['Dave'])
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)

    fireEvent.click(within(moment).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Payback confirmed' })).toBeNull()
  })

  it('shows the moment’s final, still state under reduced motion', async () => {
    mockReducedMotion(true)
    fakeApi(
      groupHandlers(
        { group: g, expenses: [expense()], pending: [settlement({ id: 's1', fromUserId: BOB, toUserId: ME, amountCents: 1200 })] },
        { 'POST /settlements/s1/confirm': () => ({ status: 200, body: settlement({ status: 'confirmed' }) }) },
      ),
    )
    renderApp('/groups/g1')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    const moment = await screen.findByRole('region', { name: 'Payback confirmed' })
    expect(moment.classList.contains('still')).toBe(true)
    // Only the happy end of the face swap, with nothing left to fade.
    expect(moment.querySelector('.swap-from')).toBeNull()
    expect(moment.querySelector('.hop-l .av')!.getAttribute('data-mood')).toBe('happy')
  })

  it('lets the squad nap on a cushion until the first expense', async () => {
    fakeApi(groupHandlers({ group: g }))
    renderApp('/groups/g1')
    const nap = await screen.findByRole('region', { name: 'The squad is napping.' })
    expect(within(nap).getByText('Add the first expense to wake them up.')).toBeTruthy()
    expect(within(nap).getByRole('link', { name: /Add expense/ }).getAttribute('href')).toBe('/groups/g1/expenses/new')
    expect(nap.querySelectorAll('.sleeper .av')).toHaveLength(3)
    expect(nap.querySelector('.cushion')).toBeTruthy()
    cleanup()

    fakeApi(groupHandlers({ group: g, expenses: [expense()] }))
    renderApp('/groups/g1')
    await screen.findByRole('region', { name: 'Your balance' })
    expect(screen.queryByRole('region', { name: 'The squad is napping.' })).toBeNull()
  })
})
