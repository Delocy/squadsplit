import type { SpinDTO } from '@squadsplit/shared'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WheelDisc } from '../src/components/WheelDisc'
import { landingRotation, overshootFor, pegTicks, pointerFrames, SPIN_DURATION_MS, spinAngle, spinFrames, wheelSlices } from '../src/wheel'
import { ME } from './clerk-mock'
import { BOB, group, groupHandlers, member } from './group-fixtures'
import { fakeApi, renderApp } from './harness'
import { mockReducedMotion } from './motion-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))

const DAVE = 'user_dave'
// Bob 0°–270°, you 270°–360°.
const slices = wheelSlices({ [BOB]: 3, [ME]: 1 })
const bob = slices[0]!

describe('the keyframed spin', () => {
  it('starts where the wheel stood and ends exactly on the landing rotation', () => {
    const to = landingRotation(0, slices, BOB)
    expect(spinAngle(0, to, 10, 0)).toBe(0)
    expect(spinAngle(0, to, 10, 1)).toBe(to)
    const frames = spinFrames(0, to, 10)
    expect(frames[0]).toEqual({ offset: 0, rotate: 0 })
    expect(frames.at(-1)).toEqual({ offset: 1, rotate: to })
    expect(frames.every((f, i) => i === 0 || f.offset > frames[i - 1]!.offset)).toBe(true)
  })

  it('overshoots and wobbles back, without ever leaving the winner’s slice once it is there', () => {
    const narrow = wheelSlices({ a: 1, b: 19 })[0]! // 18°
    expect(overshootFor(narrow)).toBeLessThan(narrow.sweep / 2)
    expect(overshootFor(bob)).toBeLessThanOrEqual(12)
    const to = landingRotation(0, slices, BOB)
    const over = overshootFor(bob)
    const late = Array.from({ length: 41 }, (_, i) => spinAngle(0, to, over, 0.8 + i * 0.005))
    expect(Math.max(...late)).toBeCloseTo(to + over, 5)
    expect(Math.min(...late)).toBeLessThan(to) // it swings back past the centre...
    for (const r of late) expect(Math.abs(r - to)).toBeLessThanOrEqual(over + 1e-9) // ...but stays in the slice
  })

  it('ticks once each time a peg passes the pointer', () => {
    const to = landingRotation(0, slices, BOB) // 2025°
    // Pegs at 0° and 270°: the first passes at 360°, 720° … 1800° (5 times), the second at 90°, 450° … 1890° (6).
    // The wobble around 2025° stays clear of both.
    const ticks = pegTicks(0, to, overshootFor(bob), [0, 270])
    expect(ticks).toHaveLength(11)
    expect(ticks.every((t, i) => t > 0 && t < 1 && (i === 0 || t >= ticks[i - 1]!))).toBe(true)
    // The wheel slows down, so the ticks spread out.
    expect(ticks[10]! - ticks[9]!).toBeGreaterThan(ticks[1]! - ticks[0]!)
  })

  it('flicks the pointer for each tick and leaves it upright at the end', () => {
    const ticks = [0.1, 0.105, 0.3, 0.6]
    const frames = pointerFrames(ticks, SPIN_DURATION_MS)
    expect(frames[0]).toEqual({ offset: 0, transform: 'rotate(0deg)' })
    expect(frames.at(-1)).toEqual({ offset: 1, transform: 'rotate(0deg)' })
    expect(frames.every((f, i) => i === 0 || f.offset >= frames[i - 1]!.offset)).toBe(true)
    // Ticks too close to tell apart (under 40ms) are one flick.
    expect(frames.filter((f) => f.transform === 'rotate(-24deg)')).toHaveLength(3)
  })
})

describe('WheelDisc', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }))
  beforeEach(() => {
    animate.mockClear()
    Object.assign(Element.prototype, { animate })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    delete (Element.prototype as { animate?: unknown }).animate
  })
  const avatarOf = () => ({ animal: 'fox', color: 'peach' }) as const

  it('has a peg on the rim between every two slices', () => {
    const { container, rerender } = render(<WheelDisc slices={slices} rotation={0} avatarOf={avatarOf} />)
    expect(container.querySelectorAll('circle.peg')).toHaveLength(2)
    rerender(<WheelDisc slices={wheelSlices({ [ME]: 1 })} rotation={0} avatarOf={avatarOf} />)
    expect(container.querySelectorAll('circle.peg')).toHaveLength(0)
  })

  it('animates the disc to the new rotation and flicks the pointer, then rests on the rotation itself', () => {
    const { rerender } = render(<WheelDisc slices={slices} rotation={0} avatarOf={avatarOf} />)
    expect(animate).not.toHaveBeenCalled()
    rerender(<WheelDisc slices={slices} rotation={2025} avatarOf={avatarOf} />)
    const disc = screen.getByRole('img', { name: 'The wheel' })
    expect(disc.style.transform).toBe('rotate(2025deg)')
    const call = animate.mock.calls.find((_, i) => animate.mock.contexts[i] === disc) as unknown as [Keyframe[], KeyframeAnimationOptions]
    expect(call[0][0]!.transform).toBe('rotate(0deg)')
    expect(call[0].at(-1)!.transform).toBe('rotate(2025deg)')
    expect(call[1].duration).toBe(SPIN_DURATION_MS)
    expect(animate.mock.contexts.some((el) => (el as Element).classList.contains('ptr'))).toBe(true)
  })

  it('stops the spin if the wheel goes away mid-spin', () => {
    const cancel = vi.fn()
    animate.mockImplementation(() => ({ cancel }))
    const { rerender, unmount } = render(<WheelDisc slices={slices} rotation={0} avatarOf={avatarOf} />)
    rerender(<WheelDisc slices={slices} rotation={2025} avatarOf={avatarOf} />)
    expect(animate).toHaveBeenCalledTimes(2) // the disc and the pointer
    unmount()
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('never replays the last spin when reduced motion is switched on and off again', () => {
    const motion = mockReducedMotion(false)
    const { rerender } = render(<WheelDisc slices={slices} rotation={0} avatarOf={avatarOf} />)
    rerender(<WheelDisc slices={slices} rotation={2025} avatarOf={avatarOf} />)
    expect(animate).toHaveBeenCalledTimes(2)
    act(() => motion.set(true))
    act(() => motion.set(false))
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('jumps straight to the rotation under reduced motion', () => {
    mockReducedMotion(true)
    const { rerender } = render(<WheelDisc slices={slices} rotation={0} avatarOf={avatarOf} />)
    rerender(<WheelDisc slices={slices} rotation={2025} avatarOf={avatarOf} />)
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'The wheel' }).style.transform).toBe('rotate(2025deg)')
  })
})

describe('the ticket', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const spin: SpinDTO = { id: 'w1', groupId: 'g1', spunBy: ME, winnerId: BOB, weights: { [ME]: 1, [BOB]: 3, [DAVE]: 1 }, createdAt: '2026-11-19T10:00:00.000Z' }
  const g = group({ members: [member(ME, 'Alice', { animal: 'fox', color: 'peach' }), member(BOB, 'Bob', { animal: 'koala', color: 'mint' }), member(DAVE, 'Dave', { animal: 'bunny', color: 'pink' })] })

  it('slides out with the server’s winner, shivering and sweating, and then everyone else sighs phew', async () => {
    fakeApi(groupHandlers({ group: g }, { 'POST /groups/g1/spins': () => ({ status: 201, body: spin }) }))
    renderApp('/groups/g1/wheel')
    const card = within(await screen.findByRole('region', { name: /Who pays next/ }))
    // Before a spin the squad waits by the slot; nobody says phew yet.
    expect(card.getByRole('status').textContent).toBe('Spin to find out')
    const relief = () => screen.getByRole('region', { name: /Who pays next/ }).querySelector('.relief')!
    expect(relief().querySelectorAll('.sigh')).toHaveLength(3)
    expect(relief().classList.contains('on')).toBe(false)

    fireEvent.click(card.getByRole('button', { name: 'Spin' }))
    await card.findByText('Spinning…')
    // The wheel lands on the server's winner: Bob's slice (0°–216°) centred under the pointer after five turns.
    expect(card.getByRole('img', { name: 'The wheel' }).style.transform).toBe('rotate(2052deg)')
    act(() => vi.advanceTimersByTime(SPIN_DURATION_MS))
    expect(card.queryByText('Bob pays next')).toBeNull()
    act(() => vi.advanceTimersByTime(200))

    const ticket = card.getByRole('status').querySelector('.ticket')!
    expect(within(ticket as HTMLElement).getByText('Bob pays next')).toBeTruthy()
    expect(within(ticket as HTMLElement).getByText('60% odds')).toBeTruthy()
    const winner = ticket.querySelector('.av')!
    expect(winner.getAttribute('data-mood')).toBe('nervous')
    expect(winner.closest('.shiver')).toBeTruthy()
    expect(ticket.querySelectorAll('.sweat').length).toBeGreaterThan(0)
    // Everyone else: happy, with a phew. Bob keeps his place in the row, but hidden, so nothing moves.
    expect(relief().classList.contains('on')).toBe(true)
    const sighs = [...relief().querySelectorAll('.sigh')]
    expect(sighs.filter((s) => !s.classList.contains('picked')).map((s) => s.querySelector('.av')!.getAttribute('data-mood'))).toEqual(['happy', 'happy'])
    expect(sighs.find((s) => s.classList.contains('picked'))!.querySelector('[aria-label="Bob"]')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
