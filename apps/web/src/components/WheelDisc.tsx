import type { AvatarChoice } from '@squadsplit/shared'
import { useLayoutEffect, useRef } from 'react'
import { mascot } from '../design/art'
import { lookOf } from '../design/Avatar'
import { useReducedMotion } from '../design/motion'
import { overshootFor, pegTicks, pointerFrames, sliceAt, SPIN_DURATION_MS, spinFrames, type Slice } from '../wheel'

const INK = '#3d2c42'
const R = 100

const point = (deg: number, r: number) => {
  const rad = ((deg - 90) * Math.PI) / 180
  return [r * Math.cos(rad), r * Math.sin(rad)] as const
}

/** One pastel slice per person in their avatar colour, with their animal on it. Ported from the playground's renderWheel. */
function SliceArt({ slice, avatar }: { slice: Slice; avatar: AvatarChoice }) {
  const look = lookOf(avatar)
  const sweepRad = (slice.sweep * Math.PI) / 180
  const size = Math.min(42, 20 + sweepRad * 14)
  const [fx, fy] = point(slice.start + slice.sweep / 2, 62)
  const art = mascot(look.kind, look.face, 'calm').replace('<svg', `<svg width="${size}" height="${size}"`)
  const [x1, y1] = point(slice.start, R)
  const [x2, y2] = point(slice.start + slice.sweep, R)
  // A lone slice is the whole disc; an arc from a point back to itself would draw nothing.
  const shape =
    slice.sweep >= 359.999
      ? { d: `M0 ${-R} A${R} ${R} 0 1 1 0 ${R} A${R} ${R} 0 1 1 0 ${-R} Z` }
      : { d: `M0 0 L${x1} ${y1} A${R} ${R} 0 ${slice.sweep > 180 ? 1 : 0} 1 ${x2} ${y2} Z` }
  return (
    <>
      <path {...shape} data-user={slice.userId} fill={look.bg} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      {/* Static, trusted art from design/art. */}
      <g transform={`translate(${fx - size / 2} ${fy - size / 2})`} dangerouslySetInnerHTML={{ __html: art }} />
    </>
  )
}

/**
 * The wheel: a dark rim with a peg between every two slices, the slices, a white hub, and the pointer at the top.
 * `rotation` is where it rests. When it changes the disc spins there (a long ease-out, an overshoot and a small
 * wobble back) while the pointer flicks at each peg that passes; it always ends exactly on `rotation`, so the wheel
 * only ever shows the winner the server picked. Under reduced motion it goes straight there.
 */
export function WheelDisc({
  slices,
  rotation,
  avatarOf,
}: {
  slices: Slice[]
  rotation: number
  /** Each person's look in the group. */
  avatarOf: (userId: string) => AvatarChoice
}) {
  const reduced = useReducedMotion()
  const disc = useRef<SVGSVGElement>(null)
  const pointer = useRef<HTMLDivElement>(null)
  const pegs = slices.length > 1 ? slices.map((s) => s.start) : []
  // Where the wheel last rested. A new `rotation` spins from there; the spin is then marked as played, so nothing
  // else (reduced motion switched on and off, say) can replay it. React's strict mode only re-runs effects on mount,
  // when there is nothing to play.
  const rested = useRef(rotation)

  useLayoutEffect(() => {
    const from = rested.current
    const to = rotation
    rested.current = to
    // jsdom and very old browsers have no Web Animations; the wheel just rests on its rotation there.
    if (from === to || reduced || typeof disc.current?.animate !== 'function') return
    const winner = sliceAt(slices, to)
    const overshoot = winner ? overshootFor(winner) : 0
    const options = { duration: SPIN_DURATION_MS, easing: 'linear' }
    const turning = disc.current.animate(
      spinFrames(from, to, overshoot).map((f) => ({ offset: f.offset, transform: `rotate(${f.rotate}deg)` })),
      options,
    )
    const flicking = pointer.current?.animate(pointerFrames(pegTicks(from, to, overshoot, pegs), SPIN_DURATION_MS), options)
    // A new spin, reduced motion switched on, or the wheel going away stops this one where it is meant to end.
    return () => {
      turning.cancel()
      flicking?.cancel()
    }
    // Only a new rotation starts a spin; the slices change with it (the server's weights).
  }, [rotation, reduced])

  return (
    <div className="wheel">
      <div className="ptr" aria-hidden="true" ref={pointer}>
        <svg viewBox="0 0 24 24">
          <path d="M4 3h16L12 21z" fill="#f0609a" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
        </svg>
      </div>
      <svg viewBox="-112 -112 224 224" role="img" aria-label="The wheel" ref={disc} style={{ transform: `rotate(${rotation}deg)` }}>
        <circle r={104} fill={INK} />
        {slices.map((s) => (
          <SliceArt key={s.userId} slice={s} avatar={avatarOf(s.userId)} />
        ))}
        {pegs.map((angle) => {
          const [x, y] = point(angle, 103)
          return <circle key={angle} className="peg" cx={x} cy={y} r={4.5} fill="#ffe08a" stroke={INK} strokeWidth={2} />
        })}
        <circle r={13} fill="#fff" stroke={INK} strokeWidth={3} />
      </svg>
    </div>
  )
}
