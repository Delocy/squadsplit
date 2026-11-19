// The wheel's geometry, from the spin weights. Angles are in degrees, clockwise from the top (where the pointer is).

export interface Slice {
  userId: string
  /** Where the slice starts and how far it reaches, in degrees. */
  start: number
  sweep: number
  /** The chance of being picked, as a whole percentage for display. */
  percent: number
}

/** One slice per person, in user-id order (the order the playground and the API's weights use), sized by weight. */
export function wheelSlices(weights: Record<string, number>): Slice[] {
  const ids = Object.keys(weights).sort()
  const total = ids.reduce((t, id) => t + weights[id]!, 0)
  let start = 0
  return ids.map((userId) => {
    const sweep = (weights[userId]! / total) * 360
    const slice = { userId, start, sweep, percent: Math.round((weights[userId]! / total) * 100) }
    start += sweep
    return slice
  })
}

/**
 * The next rotation for the wheel, from where it stands now: five full turns and then on until the
 * middle of the winner's slice is under the pointer. Only ever increases, so the wheel always spins forwards.
 */
export function landingRotation(current: number, slices: Slice[], winnerId: string): number {
  const slice = slices.find((s) => s.userId === winnerId)
  if (!slice) return current
  const centre = slice.start + slice.sweep / 2
  return current + 360 * 5 + (360 - ((current + centre) % 360))
}

// ---------- the spin itself: a long ease-out, an overshoot and a small wobble back (B's wheel in the mockups) ----------

/** How long a spin takes, wobble included. */
export const SPIN_DURATION_MS = 3400
/** The share of the spin spent turning; the rest is the wobble. */
const TURNING = 0.8
const easeOut = (u: number) => 1 - (1 - u) ** 4

/** The slice under the pointer when the wheel stands at `rotation`. */
export function sliceAt(slices: Slice[], rotation: number): Slice | undefined {
  const angle = (((-rotation % 360) + 360) % 360)
  return slices.find((s) => angle >= s.start && angle < s.start + s.sweep) ?? slices.at(-1)
}

/** How far past its stop the wheel swings: a little, and never out of the winner's slice (it stops on its middle). */
export const overshootFor = (winner: Slice) => Math.min(12, winner.sweep * 0.4)

/**
 * The wheel's rotation at `t` (0 to 1) through a spin from `from` to `to`: it turns on, slowing, to `overshoot` past
 * `to`, then swings back and forth a little less each time until it rests exactly on `to`.
 */
export function spinAngle(from: number, to: number, overshoot: number, t: number): number {
  if (t <= 0) return from
  if (t >= 1) return to
  if (t < TURNING) return from + (to + overshoot - from) * easeOut(t / TURNING)
  const w = (t - TURNING) / (1 - TURNING)
  return to + overshoot * Math.cos(2.5 * Math.PI * w) * (1 - w) ** 1.5
}

/** spinAngle sampled for a linear keyframe animation. */
export function spinFrames(from: number, to: number, overshoot: number, steps = 120): { offset: number; rotate: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({ offset: i / steps, rotate: spinAngle(from, to, overshoot, i / steps) }))
}

/**
 * When (0 to 1 through the spin) a peg passes the pointer at the top. `pegs` are the pegs' angles on the wheel; a peg
 * at angle p is under the pointer whenever p + rotation is a whole number of turns.
 */
export function pegTicks(from: number, to: number, overshoot: number, pegs: number[], steps = 4000): number[] {
  const ticks: number[] = []
  let prev = from
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const r = spinAngle(from, to, overshoot, t)
    for (const p of pegs) if (Math.floor((p + r) / 360) !== Math.floor((p + prev) / 360)) ticks.push(t)
    prev = r
  }
  return ticks
}

const FLICK = -24
const FLICK_MS = 16
const SETTLE_MS = 140
/** Ticks closer than this are one flick: at speed the pointer just stays up. */
const APART_MS = 40

/** Keyframes for the pointer: flicked back at each tick, then settling upright until the next one. */
export function pointerFrames(ticks: number[], durationMs: number): { offset: number; transform: string }[] {
  const at = (ms: number, deg: number) => ({ offset: Math.min(1, ms / durationMs), transform: `rotate(${+deg.toFixed(2)}deg)` })
  const kept: number[] = []
  for (const ms of ticks.map((t) => t * durationMs)) if (!kept.length || ms - kept.at(-1)! >= APART_MS) kept.push(ms)
  const frames = [at(0, 0)]
  kept.forEach((ms, i) => {
    const prev = kept[i - 1]
    // Where the pointer had settled to since the last flick.
    const settled = prev === undefined ? 0 : FLICK * Math.max(0, 1 - (ms - prev - FLICK_MS) / SETTLE_MS)
    frames.push(at(ms, settled), at(ms + FLICK_MS, FLICK))
    const next = kept[i + 1]
    if (next === undefined || next - (ms + FLICK_MS) > SETTLE_MS) frames.push(at(ms + FLICK_MS + SETTLE_MS, 0))
  })
  frames.push(at(durationMs, 0))
  return frames
}
